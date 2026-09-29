export function classifyLength(length, shortMax, mediumMax) {
  if (length <= shortMax) return 'short';
  if (length <= mediumMax) return 'medium';
  return 'long';
}

export function classifyOpening(text = '') {
  const value = String(text).trim();
  if (/^context\s*:/i.test(value)) return 'context-led';
  if (/^(implementation|decision|lesson|next|update)\s*:/i.test(value)) return 'label-led';
  return 'direct';
}

export function classifyFormality(text = '') {
  const value = String(text).trim();
  if (!value) return 'neutral';
  return /\b(?:i'm|we're|we've|don't|can't|won't|it's|that's|here's)\b/i.test(value) || /!/.test(value)
    ? 'conversational'
    : 'formal';
}
