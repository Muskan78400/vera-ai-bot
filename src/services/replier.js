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

const OUT_OF_SCOPE_SYSTEM_PROMPT = `You are the reply handler for Vera, magicpin's merchant assistant.
Given the conversation history and the merchant's latest message, analyze the response.

Classify the merchant's intent into one of these:
1. OPT_OUT: Merchant wants to stop, is angry, or says "stop/spam".
2. AUTO_REPLY: It's an automated business responder message.
3. COMMITMENT: Merchant agreed, said "lets do it", "go ahead", "what's next", or "yes".
4. OUT_OF_SCOPE: Merchant asks a curveball question (e.g. GST filing, personal tasks).
5. ENGAGED: Merchant asks a relevant question or wants to continue.

Response Format:
Return ONLY a valid JSON block containing:
{
  "intent": "OPT_OUT" | "AUTO_REPLY" | "COMMITMENT" | "OUT_OF_SCOPE" | "ENGAGED",
  "body": "The text response to send. If intent is OPT_OUT, keep it empty or apologize. If intent is COMMITMENT, draft the next action step directly (e.g. 'Great. Here is the draft post...'). Do NOT ask questions like 'would you', 'do you', or 'can you tell' in COMMITMENT mode; instead present the confirmation/action directly using words like 'draft', 'confirm', 'proceed'.",
  "action": "send" | "wait" | "end",
  "wait_seconds": 0,
  "rationale": "Reasoning for classification and text composition"
}`;

/**
 * Main reply router for handling merchant messages.
 */
export async function handleReply(conversationId, merchantId, customerId, message, turnNumber) {
  const cleanMessage = message.trim().toLowerCase();
  let session = await store.getConversation(conversationId);
  if (!session) {
    session = await store.createConversation(conversationId, merchantId, customerId, null, 'vera');
  }

  // Track message history
  await store.addMessage(conversationId, 'merchant', message);

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

  // Build conversation transcript context
  const historyText = (session.messages || [])
    .map((m) => `${m.role === 'merchant' ? 'Merchant' : 'Vera'}: ${m.body}`)
    .join('\n');

  const userPrompt = JSON.stringify({
    merchantName: merchant?.identity?.name,
    ownerName: merchant?.identity?.owner_first_name,
    categorySlug: merchant?.category_slug,
    activeOffers: merchant?.offers?.filter((o) => o.status === 'active').map((o) => o.title) || [],
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
    }

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
      return {
        action: 'send',
        body: 'Great. Let us proceed with the next draft. Confirm when ready.',
        rationale: 'Fallback: detected commitment keywords, advanced to draft execution.',
      };
    }

    return {
      action: 'send',
      body: 'Understood. Let me know how you would like to proceed.',
      rationale: 'Fallback: default reply response.',
    };
  }
}
