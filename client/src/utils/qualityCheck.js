// Lightweight, client-side lint against challenge-brief.md's hard
// constraints (§6 in composer.js's system prompt / brief §5.8, §11).
// Heuristic, not a substitute for the actual judge — just a fast visual
// sanity check while iterating in the sandbox/trigger builder.

const TABOO_WORDS = [
  'guaranteed',
  '100% safe',
  'miracle',
  'best in city',
  'completely cure',
  'shred in 7 days',
  'fastest results',
  'permanent results',
  'instant transformation',
];

export function checkMessageQuality(body) {
  const text = (body || '').trim();
  const lower = text.toLowerCase();

  const checks = [];

  // 1. Not empty / meaningfully substantive
  checks.push({
    label: 'Non-empty & substantive',
    pass: text.length >= 15,
    detail: text.length === 0 ? 'Body is empty' : `${text.length} characters`,
  });

  // 2. No URLs
  const hasUrl = /https?:\/\//i.test(text);
  checks.push({
    label: 'No URLs',
    pass: !hasUrl,
    detail: hasUrl ? 'URL detected in body — hard constraint violation' : 'Clean',
  });

  // 3. Single CTA heuristic — more than one question mark usually signals
  // more than one ask stacked into the same message.
  const questionCount = (text.match(/\?/g) || []).length;
  checks.push({
    label: 'Single CTA (heuristic)',
    pass: questionCount <= 1,
    detail: `${questionCount} question mark${questionCount === 1 ? '' : 's'} found`,
  });

  // 4. No taboo/hype vocabulary
  const foundTaboo = TABOO_WORDS.filter((w) => lower.includes(w));
  checks.push({
    label: 'No taboo/hype words',
    pass: foundTaboo.length === 0,
    detail: foundTaboo.length ? `Found: ${foundTaboo.join(', ')}` : 'Clean',
  });

  // 5. No obvious re-introduction ("Hi, this is Vera" mid-conversation smell)
  const hasIntroPhrase = /\b(i am vera|this is vera|hi,? i'?m vera)\b/i.test(text);
  checks.push({
    label: 'No self re-introduction',
    pass: !hasIntroPhrase,
    detail: hasIntroPhrase ? 'Sounds like a first-contact intro, not a stateful follow-up' : 'Clean',
  });

  const passCount = checks.filter((c) => c.pass).length;
  return { checks, passCount, total: checks.length };
}
