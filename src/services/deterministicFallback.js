/**
 * Deterministic fallback composer.
 *
 * Used only when the LLM call in composer.js fails (timeout, bad key, rate
 * limit, malformed JSON response, etc). Rather than a single generic
 * placeholder message, this pulls real facts out of category/merchant/
 * trigger/customer — same principle as the main composer, just rule-based
 * instead of LLM-based, so a fallback still scores reasonably on
 * specificity instead of cratering to a near-zero.
 *
 * Never throws. Always returns a valid { body, cta, send_as } object.
 */

function ownerName(category, merchant) {
  const identity = merchant?.identity || {};
  const first = identity.owner_first_name || identity.name || 'there';
  if (category?.slug === 'dentists') return `Dr. ${first}`;
  return first;
}

function bizName(merchant) {
  return merchant?.identity?.name || 'your business';
}

function activeOffer(merchant) {
  return (merchant?.offers || []).find((o) => o.status === 'active') || null;
}

function customerFirstName(customer) {
  const raw = customer?.identity?.name || 'there';
  return raw.replace(/\s*\(.*?\)\s*/g, '').trim() || 'there';
}

function fmtPct(x) {
  if (typeof x !== 'number') return null;
  const v = Math.round(x * 100);
  return `${v > 0 ? '+' : ''}${v}%`;
}

function findDigestItem(category, trigger) {
  const payload = trigger?.payload || {};
  const itemId = payload.top_item_id || payload.digest_item_id || payload.item_id;
  if (!itemId) return null;
  return (category?.digest || []).find((d) => d.id === itemId) || null;
}

// Per-kind fallback builders — each returns { body, cta, send_as }
const BUILDERS = {
  research_digest(category, merchant, trigger) {
    const owner = ownerName(category, merchant);
    const item = findDigestItem(category, trigger);
    if (item) {
      return {
        body: `${owner}, this week's digest flagged: ${item.title}${item.source ? ` — ${item.source}` : ''}. Want me to pull the full item?`,
        cta: 'open_ended',
      };
    }
    return { body: `${owner}, this week's research digest is out. Want me to pull the item most relevant to ${bizName(merchant)}?`, cta: 'open_ended' };
  },

  regulation_change(category, merchant, trigger) {
    const owner = ownerName(category, merchant);
    const item = findDigestItem(category, trigger);
    const deadline = trigger?.payload?.deadline_iso;
    return {
      body: `${owner}, compliance heads-up${item ? `: ${item.title}` : ''}${deadline ? ` (effective ${deadline})` : ''}. Want me to help you audit this before the deadline?`,
      cta: 'open_ended',
    };
  },

  perf_dip(category, merchant, trigger) {
    const owner = ownerName(category, merchant);
    const p = trigger?.payload || {};
    const delta = fmtPct(p.delta_pct);
    if (delta && p.metric) {
      return {
        body: `${owner}, your ${p.metric} are down ${delta} over the last ${p.window || 'week'}. Want me to check what changed?`,
        cta: 'open_ended',
      };
    }
    return { body: `${owner}, noticed a dip in your numbers recently. Want me to dig into what's driving it?`, cta: 'open_ended' };
  },

  perf_spike(category, merchant, trigger) {
    const owner = ownerName(category, merchant);
    const p = trigger?.payload || {};
    const delta = fmtPct(p.delta_pct);
    if (delta && p.metric) {
      return { body: `${owner}, nice — your ${p.metric} are up ${delta} this week. Want to double down on whatever's working?`, cta: 'open_ended' };
    }
    return { body: `${owner}, your numbers are trending up nicely. Want to see what's driving it?`, cta: 'open_ended' };
  },

  renewal_due(category, merchant, trigger) {
    const owner = ownerName(category, merchant);
    const p = trigger?.payload || {};
    const days = p.days_remaining;
    const plan = p.plan || merchant?.subscription?.plan;
    return {
      body: `${owner}, your ${plan || 'subscription'} plan has ${days ?? 'a few'} days left. Want me to process the renewal?`,
      cta: 'binary_yes_no',
    };
  },

  winback_eligible(category, merchant, trigger) {
    const owner = ownerName(category, merchant);
    const p = trigger?.payload || {};
    return {
      body: `${owner}, it's been ${p.days_since_expiry ?? 'a while'} days since your subscription lapsed. Want to pick it back up?`,
      cta: 'open_ended',
    };
  },

  milestone_reached(category, merchant, trigger) {
    const owner = ownerName(category, merchant);
    const p = trigger?.payload || {};
    if (p.value_now && p.metric) {
      return { body: `${owner}, you're at ${p.value_now} ${String(p.metric).replace(/_/g, ' ')}! Want me to draft a quick post to mark it?`, cta: 'open_ended' };
    }
    return { body: `${owner}, you're closing in on a milestone — want me to check exactly where you stand?`, cta: 'open_ended' };
  },

  competitor_opened(category, merchant, trigger) {
    const owner = ownerName(category, merchant);
    const p = trigger?.payload || {};
    return {
      body: `${owner}, heads-up — ${p.competitor_name || 'a new competitor'} opened${p.distance_km ? ` ${p.distance_km}km away` : ''}. Want me to check how your offer compares?`,
      cta: 'open_ended',
    };
  },

  festival_upcoming(category, merchant, trigger) {
    const owner = ownerName(category, merchant);
    const p = trigger?.payload || {};
    const offer = activeOffer(merchant);
    return {
      body: `${owner}, ${p.festival || 'a festival'} is coming up${p.days_until ? ` in ${p.days_until} days` : ''}.${offer ? ` You've already got "${offer.title}" active.` : ''} Want me to draft a push around it?`,
      cta: 'open_ended',
    };
  },

  dormant_with_vera(category, merchant, trigger) {
    const owner = ownerName(category, merchant);
    const p = trigger?.payload || {};
    return {
      body: `${owner}, been a bit${p.days_since_last_merchant_message ? ` (${p.days_since_last_merchant_message} days)` : ''} since we last spoke. Still want to pick that back up?`,
      cta: 'binary_yes_no',
    };
  },

  review_theme_emerged(category, merchant, trigger) {
    const owner = ownerName(category, merchant);
    const p = trigger?.payload || {};
    return {
      body: `${owner}, ${p.occurrences_30d || 'several'} reviews this month mention "${String(p.theme || 'a recurring theme').replace(/_/g, ' ')}". Want a concrete fix?`,
      cta: 'open_ended',
    };
  },

  active_planning_intent(category, merchant, trigger) {
    const owner = ownerName(category, merchant);
    const p = trigger?.payload || {};
    return {
      body: `${owner}, picking up on ${String(p.intent_topic || 'your idea').replace(/_/g, ' ')} — I've sketched a starting structure. Reply CONFIRM and I'll turn it into a draft.`,
      cta: 'binary_confirm_cancel',
    };
  },

  gbp_unverified(category, merchant, trigger) {
    const owner = ownerName(category, merchant);
    const p = trigger?.payload || {};
    const uplift = fmtPct(p.estimated_uplift_pct);
    return {
      body: `${owner}, your Google Business Profile isn't verified yet${uplift ? ` — verifying usually brings about ${uplift} more visibility` : ''}. Want me to walk you through it?`,
      cta: 'binary_yes_no',
    };
  },

  supply_alert(category, merchant, trigger) {
    const owner = ownerName(category, merchant);
    const p = trigger?.payload || {};
    const chronic = merchant?.customer_aggregate?.chronic_rx_count;
    return {
      body: `${owner}, recall alert on ${p.molecule || 'a molecule'}${p.affected_batches ? ` (batches: ${p.affected_batches.join(', ')})` : ''}.${chronic ? ` Up to ${chronic} chronic-Rx customers may be affected.` : ''} Want me to draft the customer note?`,
      cta: 'binary_yes_no',
    };
  },

  recall_due(category, merchant, trigger, customer) {
    const biz = bizName(merchant);
    const custName = customerFirstName(customer);
    const p = trigger?.payload || {};
    const service = (p.service_due || '').replace(/_/g, ' ') || 'visit';
    const slots = p.available_slots || [];
    const slotTxt = slots.length ? slots.map((s) => s.label || s.iso).slice(0, 2).join(' or ') : null;
    const offer = activeOffer(merchant);
    return {
      body: `Hi ${custName}, ${biz} here. Your ${service} recall is due.${slotTxt ? ` We have ${slotTxt} open.` : ''}${offer ? ` ${offer.title}.` : ''} Reply to pick a time.`,
      cta: slotTxt ? 'multi_choice_slot' : 'open_ended',
      send_as: 'merchant_on_behalf',
    };
  },

  customer_lapsed_soft(category, merchant, trigger, customer) {
    const biz = bizName(merchant);
    const custName = customerFirstName(customer);
    const lastVisit = customer?.relationship?.last_visit;
    const offer = activeOffer(merchant);
    return {
      body: `Hi ${custName}, ${biz} here — it's been a bit since your last visit${lastVisit ? ` (${lastVisit})` : ''}.${offer ? ` "${offer.title}" is on right now.` : ''} Want us to hold a slot?`,
      cta: 'binary_yes_no',
      send_as: 'merchant_on_behalf',
    };
  },

  customer_lapsed_hard(category, merchant, trigger, customer) {
    const biz = bizName(merchant);
    const custName = customerFirstName(customer);
    const p = trigger?.payload || {};
    const days = p.days_since_last_visit;
    return {
      body: `Hi ${custName}, ${biz} here. It's been about ${days ? Math.round(days / 7) + ' weeks' : 'a while'} — no judgment, happens to everyone. Want me to hold a spot, no commitment?`,
      cta: 'binary_yes_no',
      send_as: 'merchant_on_behalf',
    };
  },

  chronic_refill_due(category, merchant, trigger, customer) {
    const biz = bizName(merchant);
    const custName = customerFirstName(customer);
    const p = trigger?.payload || {};
    const meds = (p.molecule_list || []).join(', ') || 'your regular medicines';
    const runsOut = (p.stock_runs_out_iso || '').split('T')[0];
    return {
      body: `Hi ${custName}, ${biz} here. Your ${meds} run${p.molecule_list?.length === 1 ? 's' : ''} out around ${runsOut || 'soon'}. Same dose ready — reply CONFIRM to dispatch.`,
      cta: 'binary_confirm_cancel',
      send_as: 'merchant_on_behalf',
    };
  },

  trial_followup(category, merchant, trigger, customer) {
    const biz = bizName(merchant);
    const custName = customerFirstName(customer);
    const p = trigger?.payload || {};
    const options = p.next_session_options || [];
    const slot = options[0]?.label;
    return {
      body: `Hi ${custName}, thanks for trying us out${p.trial_date ? ` on ${p.trial_date}` : ''}!${slot ? ` Next slot: ${slot}.` : ''} Want me to book it at ${biz}?`,
      cta: 'binary_yes_no',
      send_as: 'merchant_on_behalf',
    };
  },

  appointment_tomorrow(category, merchant, trigger, customer) {
    const biz = bizName(merchant);
    const custName = customerFirstName(customer);
    return {
      body: `Hi ${custName}, quick reminder from ${biz} — your appointment is tomorrow. Reply CONFIRM, or let us know if you need to reschedule.`,
      cta: 'binary_confirm_cancel',
      send_as: 'merchant_on_behalf',
    };
  },

  curious_ask_due(category, merchant) {
    const owner = ownerName(category, merchant);
    const biz = bizName(merchant);
    return {
      body: `Hi ${owner}! Quick one — what's been the most-asked-for service at ${biz} this week? I'll turn the answer into a ready reply you can reuse.`,
      cta: 'open_ended',
    };
  },
};

export function deterministicFallback(category, merchant, trigger, customer = null) {
  try {
    const kind = trigger?.kind || '';
    const builder = BUILDERS[kind];
    const result = builder
      ? builder(category, merchant, trigger, customer)
      : genericFallback(category, merchant, trigger, customer);

    return {
      body: result.body,
      cta: result.cta || 'open_ended',
      send_as: result.send_as || (customer ? 'merchant_on_behalf' : 'vera'),
      suppression_key: trigger?.suppression_key || '',
      rationale: `Deterministic fallback (kind=${kind}) — LLM call failed, using real-data template instead of a generic placeholder.`,
    };
  } catch (err) {
    // last-resort safety net: never let the fallback itself throw
    return genericFallbackResult(category, merchant, trigger, customer, err);
  }
}

function genericFallback(category, merchant, trigger, customer) {
  const kind = trigger?.kind || 'update';
  const topic = kind.replace(/_/g, ' ');
  if (customer) {
    return {
      body: `Hi ${customerFirstName(customer)}, ${bizName(merchant)} here — wanted to reach out about your ${topic}. Reply to let us know a good time.`,
      cta: 'open_ended',
      send_as: 'merchant_on_behalf',
    };
  }
  return {
    body: `${ownerName(category, merchant)}, quick note on a ${topic} — want me to dig into the details for ${bizName(merchant)}?`,
    cta: 'open_ended',
    send_as: 'vera',
  };
}

function genericFallbackResult(category, merchant, trigger, customer, err) {
  const result = genericFallback(category, merchant, trigger, customer);
  return {
    ...result,
    suppression_key: trigger?.suppression_key || '',
    rationale: `Generic fallback — both LLM and templated fallback failed (${err?.message || 'unknown error'}).`,
  };
}
