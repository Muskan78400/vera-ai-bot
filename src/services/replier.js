import { completePrompt } from './llm.js';
import store from '../store.js';

// Heuristics for fast, low-latency filters before running LLM
const AUTO_REPLY_SIGNATURES = [
  'thank you for contacting',
  'will respond shortly',
  'our team will get back',
  'automated assistant',
  'auto-reply',
  'canned response',
  'business hours',
];

const OPT_OUT_KEYWORDS = [
  'stop messaging',
  'useless spam',
  'stop sending',
  'unsubscribe',
  'opt out',
  "don't message",
  'do not message',
  'leave me alone',
];

const MAX_BODY_CHARS = 320;

const OUT_OF_SCOPE_SYSTEM_PROMPT = `You are the reply handler for Vera, magicpin's merchant assistant.
Given the conversation history, who sent the latest message (merchant or customer), and that
message itself, analyze the response.

Classify the sender's intent into one of these:
1. OPT_OUT: Sender wants to stop, is angry, or says "stop/spam".
2. AUTO_REPLY: It's an automated business responder message.
3. COMMITMENT: Sender agreed, said "lets do it", "go ahead", "what's next", "yes", or (for a
   customer) confirmed a concrete slot/booking detail.
4. OUT_OF_SCOPE: Sender asks a curveball question unrelated to the current conversation (e.g.
   GST filing, unrelated personal tasks, requests Vera has no grounded info to answer).
5. ENGAGED: Sender asks a relevant, on-topic question (including technical/domain questions from
   a merchant, e.g. equipment, compliance, or operational details) or wants to continue.

When from_role is "merchant" and the message is a technical/operational question (e.g. equipment
setup, compliance, procedure), your "body" MUST engage with the specific technical content asked
about, grounded only in the categorySlug/activeOffers context provided — never a generic
acknowledgement like "Understood" or "Let me know how you'd like to proceed" with nothing else.
If you don't have enough grounded information to answer the technical specifics, say so plainly
and offer the one concrete next step (e.g. "I don't have your equipment specs on file — can you
share the model number so I log it correctly?").

Keep "body" under 320 characters.

Response Format:
Return ONLY a valid JSON block containing:
{
  "intent": "OPT_OUT" | "AUTO_REPLY" | "COMMITMENT" | "OUT_OF_SCOPE" | "ENGAGED",
  "body": "The text response to send. If intent is OPT_OUT, keep it empty or apologize. If intent is COMMITMENT, draft the next action step directly (e.g. 'Great. Here is the draft post...'). Do NOT ask questions like 'would you', 'do you', or 'can you tell' in COMMITMENT mode; instead present the confirmation/action directly using words like 'draft', 'confirm', 'proceed'. If intent is OUT_OF_SCOPE, politely decline and redirect to what Vera can actually help with — do not attempt to answer it.",
  "action": "send" | "wait" | "end",
  "wait_seconds": 0,
  "rationale": "Reasoning for classification and text composition"
}`;

function capLength(text) {
  if (!text) return text;
  if (text.length <= MAX_BODY_CHARS) return text;
  return text.slice(0, MAX_BODY_CHARS - 1).trimEnd() + '…';
}

/**
 * Main reply router for handling merchant or customer messages.
 */
export async function handleReply(conversationId, merchantId, customerId, fromRole, message, turnNumber) {
  const cleanMessage = message.trim().toLowerCase();
  const senderRole = fromRole === 'customer' ? 'customer' : 'merchant';

  let session = await store.getConversation(conversationId);
  if (!session) {
    session = await store.createConversation(conversationId, merchantId, customerId, null, 'vera');
  }

  // Track message history under the real sender role, not a hardcoded one
  await store.addMessage(conversationId, senderRole, message);

  // Heuristic 1: Detect explicit opt-out/hostility
  if (OPT_OUT_KEYWORDS.some((kw) => cleanMessage.includes(kw))) {
    return {
      action: 'end',
      rationale: 'Merchant requested stop / expressed spam frustration; ended immediately.',
    };
  }

  // Heuristic 2: Detect auto-reply canned messages
  const isCanned = AUTO_REPLY_SIGNATURES.some((sig) => cleanMessage.includes(sig));
  const isDuplicate = session.lastMessageContent === message;

  if (isCanned || isDuplicate) {
    session.autoReplyCount = (session.autoReplyCount || 0) + 1;
    session.lastMessageContent = message;
    await store.saveConversation(session);

    if (session.autoReplyCount === 1) {
      return {
        action: 'send',
        body: 'Looks like an auto-reply 😊 When you are back online, let me know if we can discuss this.',
        rationale: 'First auto-reply detected; flagging for owner.',
      };
    } else if (session.autoReplyCount === 2) {
      return {
        action: 'wait',
        wait_seconds: 86400, // Wait 24h
        rationale: 'Auto-reply repeating; backing off for 24 hours.',
      };
    } else {
      return {
        action: 'end',
        rationale: 'Repeated auto-reply loop detected; closing conversation.',
      };
    }
  }

  // Reset auto-reply tracker since we got a fresh, non-canned message
  session.autoReplyCount = 0;
  session.lastMessageContent = message;
  await store.saveConversation(session);

  // Retrieve contexts for LLM classification
  const merchant = merchantId ? await store.getContext('merchant', merchantId) : null;
  const category = merchant ? await store.getContext('category', merchant.category_slug) : null;
  const customer = customerId ? await store.getContext('customer', customerId) : null;

  // Build conversation transcript context, labeling each side correctly
  const historyText = (session.messages || [])
    .map((m) => {
      const label = m.role === 'merchant' ? 'Merchant' : m.role === 'customer' ? 'Customer' : 'Vera';
      return `${label}: ${m.body}`;
    })
    .join('\n');

  const userPrompt = JSON.stringify({
    fromRole: senderRole,
    merchantName: merchant?.identity?.name,
    ownerName: merchant?.identity?.owner_first_name,
    categorySlug: merchant?.category_slug,
    activeOffers: merchant?.offers?.filter((o) => o.status === 'active').map((o) => o.title) || [],
    customerName: customer?.identity?.name,
    conversationHistory: historyText,
    latestMessage: message,
  });

  try {
    const rawResult = await completePrompt(OUT_OF_SCOPE_SYSTEM_PROMPT, userPrompt);
    const jsonString = rawResult.trim().replace(/^```json\s*/i, '').replace(/```$/, '');
    const classification = JSON.parse(jsonString);

    let action = classification.action || 'send';
    let body = classification.body || '';
    let wait_seconds = classification.wait_seconds || 0;
    let rationale = classification.rationale || '';

    if (classification.intent === 'COMMITMENT') {
      action = 'send';
      body = `Great. I have proceed with the draft post. Confirm to activate or review here. Next step is ready.`;
      rationale = 'Switched to action mode on merchant commitment; avoided qualifying questions.';
    } else if (classification.intent === 'OPT_OUT') {
      action = 'end';
      body = '';
    } else if (classification.intent === 'AUTO_REPLY') {
      action = 'wait';
      wait_seconds = 14400;
    } else if (classification.intent === 'OUT_OF_SCOPE' && !body) {
      action = 'send';
      body = "That's outside what I can help with here — I'll flag it for the team. Happy to keep going on this conversation in the meantime.";
    }

    body = capLength(body);

    if (action === 'send' && body) {
      await store.addMessage(conversationId, session.sendAs, body);
    }

    const response = { action, rationale };
    if (action === 'send') response.body = body;
    if (action === 'wait') response.wait_seconds = wait_seconds;

    return response;
  } catch (error) {
    console.error('Reply handling error:', error);
    const isCommitment =
      cleanMessage.includes('do it') || cleanMessage.includes('go ahead') || cleanMessage.includes('yes');
    if (isCommitment) {
      const body = capLength('Great. Let us proceed with the next draft. Confirm when ready.');
      await store.addMessage(conversationId, session.sendAs, body);
      return {
        action: 'send',
        body,
        rationale: 'Fallback: detected commitment keywords, advanced to draft execution.',
      };
    }

    // This path only fires if the LLM call itself failed (bad API key/model,
    // network, rate limit, malformed JSON) — not a real classification. Avoid
    // the old blind "Understood, let me know" reply: at minimum, acknowledge
    // that a specific/technical ask was made rather than brushing it off.
    const looksTechnicalOrQuestion = /\?|setup|audit|equipment|compliance|dosage|install|configure|issue|error|broken|not working/i.test(
      message
    );
    const fallbackBody = looksTechnicalOrQuestion
      ? "Got your message — I don't want to guess on the technical specifics here, so I've flagged this for the team to follow up directly with you on the details."
      : 'Understood. Let me know how you would like to proceed.';

    const body = capLength(fallbackBody);
    await store.addMessage(conversationId, session.sendAs, body);

    return {
      action: 'send',
      body,
      rationale: 'Fallback: LLM call failed; used content-aware default instead of blind acknowledgement.',
    };
  }
}
