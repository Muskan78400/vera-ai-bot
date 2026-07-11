import { completePrompt } from './llm.js';
import { deterministicFallback } from './deterministicFallback.js';

// The system prompt defines rules for message composition based on the 5-dimension rubric.
const COMPOSER_SYSTEM_PROMPT = `You are the core message composer for Vera, magicpin's merchant assistant.
Your task is to return a JSON object with: "body", "cta", "send_as", "suppression_key", and "rationale".

Strict composition rules:
1. SPECIFICITY (10/10):
   - Anchor on concrete facts from the provided context (real counts, percentages, prices, dates).
   - If citing research or compliance, ALWAYS include the source citation (e.g., "JIDA Oct 2026 p.14").
   - NEVER use generic templates like "Flat X% off" or "increase your sales".

2. CATEGORY FIT (10/10):
   - Match vertical tone:
     - Dentists: clinical, peer-to-peer, technical OK, address as "Dr. [Name]".
     - Salons: warm, friendly, practical.
     - Restaurants: operator-to-operator, use business terms ("covers", "AOV", "rush hour").
     - Gyms: coaching, motivational.
     - Pharmacies: trustworthy, precise, molecule-focused (use generic names like metformin).
   - Observe taboos. For dentists, NEVER use "guaranteed" or "cure".

3. MERCHANT FIT (10/10):
   - Personalize with the owner's first name (e.g., "Hi Suresh" or "Dr. Meera").
   - Honor language preference. If "languages" contains "hi" or preference is "hi-en mix" / "hi", write in a natural Hindi-English code-mixed style (e.g., "Apke liye slots ready hain...").
   - Reference real active offers from their context catalog.

4. TRIGGER RELEVANCE (10/10):
   - Make the reason for the message ("why now") explicit.
   - Ground the content in the trigger payload details.
   - If a "relevantDigestItem" is provided below, that is the ONLY digest item you may reference or cite —
     do not invent or substitute a different one.

5. ENGAGEMENT COMPULSION (10/10):
   - Provide one clear, low-effort next action.
   - Use psychological levers: loss aversion, social proof, effort externalization (e.g., "I've drafted it, reply YES to go").

6. HARD CONSTRAINTS:
   - NO HALLLUCINATIONS: Do not fabricate statistics, numbers, competitor names, or papers.
   - NO URLS: Never place hyperlinks in message bodies.
   - SINGLE CTA: Provide only one primary call-to-action.
   - Send As: If customer context is provided, "send_as" MUST be "merchant_on_behalf" and the body should sound like the business talking to their customer. If customer context is null, "send_as" MUST be "vera" and the body should sound like Vera talking to the merchant.

Return ONLY a valid JSON block containing:
{
  "body": "composed message body text",
  "cta": "description of call-to-action",
  "send_as": "vera" or "merchant_on_behalf",
  "suppression_key": "exact suppression key from trigger",
  "rationale": "concise explanation of design choices"
}`;

/**
 * Resolves the single digest item a trigger refers to by ID, rather than
 * handing the whole category digest array to the LLM and hoping it picks
 * the right one. Checks the common payload key variants seen across
 * trigger kinds (top_item_id, digest_item_id, item_id), plus an inlined
 * top_item object as a last resort.
 */
function resolveDigestItem(category, trigger) {
  const payload = trigger?.payload || {};
  const itemId = payload.top_item_id || payload.digest_item_id || payload.item_id || payload.top_item?.id;
  if (!itemId) return null;
  const digest = category?.digest || [];
  return digest.find((item) => item.id === itemId) || (typeof payload.top_item === 'object' ? payload.top_item : null);
}

/**
 * Composes a message based on the four context blocks.
 */
export async function composeMessage(category, merchant, trigger, customer = null) {
  const relevantDigestItem = resolveDigestItem(category, trigger);

  const userPrompt = JSON.stringify({
    categoryContext: {
      slug: category?.slug,
      voice: category?.voice,
      peer_stats: category?.peer_stats,
      offer_catalog: category?.offer_catalog,
      seasonal_beats: category?.seasonal_beats,
      trend_signals: category?.trend_signals,
      // Only the single resolved item is sent, not the whole digest —
      // removes the LLM's ability to cite the wrong research/compliance item.
      relevantDigestItem,
    },
    merchantContext: {
      merchant_id: merchant?.merchant_id,
      identity: merchant?.identity,
      performance: merchant?.performance,
      offers: merchant?.offers,
      customer_aggregate: merchant?.customer_aggregate,
      signals: merchant?.signals,
    },
    triggerContext: {
      id: trigger?.id,
      scope: trigger?.scope,
      kind: trigger?.kind,
      payload: trigger?.payload,
      urgency: trigger?.urgency,
      suppression_key: trigger?.suppression_key,
    },
    customerContext: customer
      ? {
          customer_id: customer.customer_id,
          identity: customer.identity,
          relationship: customer.relationship,
          state: customer.state,
          preferences: customer.preferences,
          consent: customer.consent,
        }
      : null,
  });

  try {
    const rawResult = await completePrompt(COMPOSER_SYSTEM_PROMPT, userPrompt);

    // Clean response markup (e.g. ```json blocks) if present
    const jsonString = rawResult.trim().replace(/^```json\s*/i, '').replace(/```$/, '');
    const composed = JSON.parse(jsonString);

    if (!composed.body || !composed.body.trim()) {
      throw new Error('LLM returned an empty body');
    }

    return {
      body: composed.body,
      cta: composed.cta || 'none',
      send_as: customer ? 'merchant_on_behalf' : 'vera',
      suppression_key: trigger?.suppression_key || '',
      rationale: composed.rationale || 'Composed based on contexts',
    };
  } catch (error) {
    console.error('Composition error, using deterministic fallback:', error.message);
    return deterministicFallback(category, merchant, trigger, customer);
  }
}
