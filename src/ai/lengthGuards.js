export function clampText(text, maxChars) {
  const t = String(text || "").trim();
  if (t.length <= maxChars) return t;

  // seci na poslednjoj tački/uzvičniku/upitniku pre maxChars
  const cut = t.slice(0, maxChars);
  const idx = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("!"), cut.lastIndexOf("?"));
  if (idx > 200) return cut.slice(0, idx + 1).trim();

  return cut.trim();
}
