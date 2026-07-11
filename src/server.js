import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';
import config from './config.js';
import { connectMongo, isMongoConnected } from './db.js';
import store from './store.js';
import { composeMessage } from './services/composer.js';
import { handleReply } from './services/replier.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json({ limit: '10mb' }));

// Rate limiting for the challenge-facing API surface (/v1/*). The judge
// harness itself sends up to 10 req/sec; this allows a generous buffer
// above that (per IP) so legitimate bursts during a tick window aren't
// throttled, while still protecting the endpoints from runaway traffic.
const challengeApiLimiter = rateLimit({
  windowMs: 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { accepted: false, reason: 'rate_limited' },
});
app.use('/v1', challengeApiLimiter);

// Serve the built React dashboard (client/dist) if it exists, falling back
// to the legacy static /public dashboard otherwise so the server never
// 404s on `/` just because the client hasn't been built yet.
const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));
app.use(express.static(path.join(__dirname, '..', 'public')));

const startTime = Date.now();

// Logs generated during runtime for dashboard display
const systemLogs = [];
function addLog(type, message, details = null) {
  systemLogs.push({
    timestamp: new Date().toISOString(),
    type, // 'info' | 'context' | 'tick' | 'reply' | 'error'
    message,
    details,
  });
  if (systemLogs.length > 200) {
    systemLogs.shift();
  }
}

// 1. GET /v1/healthz
app.get('/v1/healthz', async (req, res) => {
  const uptime = Math.floor((Date.now() - startTime) / 1000);
  const counts = await store.getContextCounts();
  res.json({
    status: 'ok',
    uptime_seconds: uptime,
    contexts_loaded: counts,
    storage: isMongoConnected() ? 'mongodb' : 'in_memory',
  });
});

// 2. GET /v1/metadata
app.get('/v1/metadata', (req, res) => {
  res.json({
    team_name: 'Vera Express',
    team_members: ['Kavya'],
    model: config.llmProvider === 'gemini' ? config.gemini.model : config.openai.model,
    approach: 'Modular message composer & reply dispatcher with strict context mapping, MongoDB-backed context store',
    contact_email: 'antigravity@magicpin.ai',
    version: '2.0.0',
    submitted_at: new Date().toISOString(),
  });
});

// 3. POST /v1/context
app.post('/v1/context', async (req, res) => {
  const { scope, context_id, version, payload } = req.body;

  if (!scope || !context_id || version === undefined || !payload) {
    addLog('error', 'Malformed context push received', req.body);
    return res.status(400).json({ accepted: false, reason: 'malformed_payload' });
  }

  const result = await store.setContext(scope, context_id, version, payload);

  if (!result.accepted) {
    return res.status(409).json({
      accepted: false,
      reason: result.reason,
      current_version: result.currentVersion,
    });
  }

  addLog('context', `Registered ${scope} "${context_id}" (v${version})`);

  res.json({
    accepted: true,
    ack_id: `ack_${context_id}_v${version}`,
    stored_at: new Date().toISOString(),
  });
});

// 4. POST /v1/tick
app.post('/v1/tick', async (req, res) => {
  const { now, available_triggers } = req.body;
  const actions = [];

  addLog('tick', `Tick received at ${now}`, { available_triggers });

  if (!available_triggers || !Array.isArray(available_triggers)) {
    return res.json({ actions: [] });
  }

  for (const triggerId of available_triggers.slice(0, 20)) {
    const trigger = await store.getContext('trigger', triggerId);
    if (!trigger) {
      console.warn(`Trigger not found in store: ${triggerId}`);
      continue;
    }

    const merchantId = trigger.merchant_id;
    const merchant = await store.getContext('merchant', merchantId);
    if (!merchant) {
      console.warn(`Merchant not found in store for trigger: ${merchantId}`);
      continue;
    }

    const category = await store.getContext('category', merchant.category_slug);
    if (!category) {
      console.warn(`Category not found in store: ${merchant.category_slug}`);
      continue;
    }

    let customer = null;
    if (trigger.scope === 'customer' && trigger.customer_id) {
      customer = await store.getContext('customer', trigger.customer_id);
    }

    try {
      const composed = await composeMessage(category, merchant, trigger, customer);

      const conversationId = `conv_${merchantId}_${triggerId}`;
      await store.createConversation(conversationId, merchantId, customer?.customer_id, triggerId, composed.send_as);
      await store.addMessage(conversationId, composed.send_as, composed.body);

      const templateParams = [
        customer ? customer.identity?.name : merchant.identity?.owner_first_name || 'Partner',
        composed.body,
      ];

      actions.push({
        conversation_id: conversationId,
        merchant_id: merchantId,
        customer_id: customer?.customer_id || null,
        send_as: composed.send_as,
        trigger_id: triggerId,
        template_name: customer ? 'merchant_recall_reminder_v1' : 'vera_research_digest_v1',
        template_params: templateParams,
        body: composed.body,
        cta: composed.cta,
        suppression_key: composed.suppression_key,
        rationale: composed.rationale,
      });

      addLog('info', `Composed message for trigger "${triggerId}"`, {
        to: customer ? `Customer: ${customer.identity?.name}` : `Merchant: ${merchant.identity?.name}`,
        body: composed.body,
        rationale: composed.rationale,
      });
    } catch (err) {
      addLog('error', `Failed composition for trigger ${triggerId}`, err.message);
      console.error(err);
    }
  }

  res.json({ actions });
});

// 5. POST /v1/reply
app.post('/v1/reply', async (req, res) => {
  const { conversation_id, merchant_id, customer_id, from_role, message, turn_number } = req.body;

  addLog('reply', `Reply received on "${conversation_id}" (Turn ${turn_number})`, {
    from: from_role,
    message,
  });

  try {
    const response = await handleReply(conversation_id, merchant_id, customer_id, message, turn_number);

    addLog('info', `Formulated response to turn ${turn_number}`, response);
    res.json(response);
  } catch (err) {
    addLog('error', `Failed processing reply for conversation ${conversation_id}`, err.message);
    res.status(500).json({
      action: 'send',
      body: 'Apologies, we encountered an error processing that message.',
      rationale: 'Error fallback response.',
    });
  }
});

// 6. POST /v1/teardown (wipe state at end of simulator run)
app.post('/v1/teardown', async (req, res) => {
  await store.clear();
  addLog('info', 'Context and conversation states torn down.');
  res.json({ accepted: true });
});

// --- DASHBOARD API ENDPOINTS ---

app.get('/api/logs', (req, res) => {
  res.json(systemLogs);
});

app.get('/api/conversations', async (req, res) => {
  res.json(await store.getAllConversations());
});

// Single conversation detail — powers the Conversation Viewer panel
app.get('/api/conversations/:id', async (req, res) => {
  const convo = await store.getConversation(req.params.id);
  if (!convo) return res.status(404).json({ error: 'Conversation not found' });
  res.json(convo);
});

app.get('/api/contexts', async (req, res) => {
  const counts = await store.getContextCounts();
  const categories = await store.listContexts('category');
  const merchants = await store.listContexts('merchant');
  res.json({
    counts,
    categories: categories.map((c) => c.contextId),
    merchants: merchants.map((m) => m.payload.identity.name),
  });
});

app.post('/api/manual-sandbox-tick', async (req, res) => {
  const { merchantIndex, triggerKind } = req.body;
  try {
    const merchants = await store.listContexts('merchant');
    if (merchantIndex < 0 || merchantIndex >= merchants.length) {
      return res.status(400).json({ success: false, error: 'Invalid merchant selection' });
    }

    const merchant = merchants[merchantIndex].payload;
    const category = await store.getContext('category', merchant.category_slug);

    if (!category) {
      return res.status(400).json({ success: false, error: 'Category context missing for this merchant' });
    }

    const allTriggers = await store.listContexts('trigger');
    let trigger = allTriggers
      .map((t) => t.payload)
      .find((t) => t.kind === triggerKind && t.merchant_id === merchant.merchant_id);

    if (!trigger) {
      trigger = {
        id: `trg_mock_${Date.now()}`,
        scope: triggerKind === 'recall_due' ? 'customer' : 'merchant',
        kind: triggerKind,
        merchant_id: merchant.merchant_id,
        urgency: 2,
        suppression_key: `mock:${triggerKind}:${merchant.merchant_id}`,
        payload: {
          category: merchant.category_slug,
          metric_or_topic: triggerKind,
        },
      };
    }

    let customer = null;
    if (trigger.scope === 'customer') {
      const allCustomers = await store.listContexts('customer');
      const match = allCustomers.find((c) => c.payload.merchant_id === merchant.merchant_id);
      if (match) {
        customer = match.payload;
      } else {
        customer = {
          customer_id: `c_mock_${Date.now()}`,
          merchant_id: merchant.merchant_id,
          identity: { name: 'Raj', phone_redacted: '<phone>', language_pref: 'hi-en mix' },
          relationship: { last_visit: '2026-05-12', visits_total: 4 },
          state: 'lapsed_soft',
          preferences: { preferred_slots: 'weekday_evening', channel: 'whatsapp' },
          consent: { opted_in_at: '2025-11-04', scope: ['recall_reminders'] },
        };
      }
    }

    const action = await composeMessage(category, merchant, trigger, customer);
    res.json({ success: true, action });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Manual trigger builder — accepts a hand-written trigger JSON from the
// dashboard's Trigger Builder panel and composes against it directly,
// without requiring the trigger to already exist in the store. Useful for
// testing edge-case payloads (missing fields, unusual kinds, etc.).
app.post('/api/manual-custom-trigger', async (req, res) => {
  const { merchantIndex, customTrigger } = req.body;
  try {
    if (!customTrigger || typeof customTrigger !== 'object') {
      return res.status(400).json({ success: false, error: 'customTrigger must be a JSON object' });
    }
    if (!customTrigger.kind) {
      return res.status(400).json({ success: false, error: 'customTrigger.kind is required' });
    }

    const merchants = await store.listContexts('merchant');
    if (merchantIndex === undefined || merchantIndex < 0 || merchantIndex >= merchants.length) {
      return res.status(400).json({ success: false, error: 'Invalid merchant selection' });
    }
    const merchant = merchants[merchantIndex].payload;
    const category = await store.getContext('category', merchant.category_slug);
    if (!category) {
      return res.status(400).json({ success: false, error: 'Category context missing for this merchant' });
    }

    const trigger = {
      id: customTrigger.id || `trg_custom_${Date.now()}`,
      scope: customTrigger.scope || (customTrigger.customer_id ? 'customer' : 'merchant'),
      kind: customTrigger.kind,
      source: customTrigger.source || 'manual',
      merchant_id: merchant.merchant_id,
      customer_id: customTrigger.customer_id || null,
      payload: customTrigger.payload || {},
      urgency: customTrigger.urgency ?? 2,
      suppression_key: customTrigger.suppression_key || `manual:${customTrigger.kind}:${merchant.merchant_id}:${Date.now()}`,
      expires_at: customTrigger.expires_at || null,
    };

    let customer = null;
    if (trigger.scope === 'customer') {
      if (trigger.customer_id) {
        customer = await store.getContext('customer', trigger.customer_id);
      }
      if (!customer) {
        const allCustomers = await store.listContexts('customer');
        const match = allCustomers.find((c) => c.payload.merchant_id === merchant.merchant_id);
        customer = match ? match.payload : null;
      }
    }

    const action = await composeMessage(category, merchant, trigger, customer);
    addLog('info', `Manual trigger builder: composed "${trigger.kind}" for ${merchant.identity?.name}`, {
      trigger,
      body: action.body,
    });
    res.json({ success: true, action, resolvedTrigger: trigger });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// One-click warmup — reads the bundled dataset/ folder from disk and pushes
// every category/merchant/customer/trigger into the store, so the
// dashboard can be populated without running judge_simulator.py or any
// external script. Uses a monotonically increasing version (timestamp) so
// pressing the button again always succeeds (never rejected as stale).
const DATASET_DIR = path.join(__dirname, '..', 'dataset');

app.post('/api/warmup', async (req, res) => {
  try {
    const version = Date.now();
    const counts = { category: 0, merchant: 0, customer: 0, trigger: 0 };

    const categoriesDir = path.join(DATASET_DIR, 'categories');
    if (fs.existsSync(categoriesDir)) {
      for (const file of fs.readdirSync(categoriesDir).filter((f) => f.endsWith('.json'))) {
        const data = JSON.parse(fs.readFileSync(path.join(categoriesDir, file), 'utf-8'));
        await store.setContext('category', data.slug, version, data);
        counts.category++;
      }
    }

    const seedFiles = [
      { file: 'merchants_seed.json', scope: 'merchant', listKey: 'merchants', idKey: 'merchant_id' },
      { file: 'customers_seed.json', scope: 'customer', listKey: 'customers', idKey: 'customer_id' },
      { file: 'triggers_seed.json', scope: 'trigger', listKey: 'triggers', idKey: 'id' },
    ];

    for (const { file, scope, listKey, idKey } of seedFiles) {
      const fullPath = path.join(DATASET_DIR, file);
      if (!fs.existsSync(fullPath)) continue;
      const data = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
      for (const item of data[listKey] || []) {
        await store.setContext(scope, item[idKey], version, item);
        counts[scope]++;
      }
    }

    addLog('info', 'One-click warmup completed', counts);
    res.json({ success: true, counts });
  } catch (error) {
    console.error('Warmup failed:', error);
    addLog('error', 'One-click warmup failed', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// SPA fallback: any non-API route serves the React app's index.html
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/v1/') || req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) res.sendFile(path.join(__dirname, '..', 'public', 'index.html'), () => next());
  });
});

// Start the server
async function start() {
  await connectMongo();
  app.listen(config.port, '0.0.0.0', () => {
    addLog('info', `Vera Bot Express Server listening on port ${config.port}`);
    console.log(`Server listening on port ${config.port}`);
    console.log(`Storage backend: ${isMongoConnected() ? 'MongoDB' : 'in-memory (no MONGODB_URI set)'}`);
  });
}

start();
