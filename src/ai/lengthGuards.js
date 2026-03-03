// ============================================================
// ai/lengthGuards.js — Text clamping utility
// ============================================================

/**
 * Clamps text to maxChars, cutting at the last sentence boundary.
 */
export function clampText(text, maxChars) {
  const t = String(text || "").trim();
  if (t.length <= maxChars) return t;

  const cut = t.slice(0, maxChars);
  const idx = Math.max(
    cut.lastIndexOf("."),
    cut.lastIndexOf("!"),
    cut.lastIndexOf("?")
  );

  if (idx > 200) return cut.slice(0, idx + 1).trim();
  return cut.trim();
}