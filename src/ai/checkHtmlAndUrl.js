// src/ai/checkHtmlAndUrl.js
import { Site10Schema } from "./schemas.js";
import { callStrictJson, ENGINES } from "./strict.js";

function clampTokens(tokens, maxLen = 3500) {
  if (!tokens) return "";
  const s = typeof tokens === "string" ? tokens : JSON.stringify(tokens);
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

export async function summarizeSiteTo10({ url, tokens }) {
  const compactTokens = clampTokens(tokens, 3500);

  return callStrictJson({
    schema: Site10Schema,
    schemaName: "site_summary_10",
    model: ENGINES.REASONING,               // ✅ gpt-4o-mini (mnogo jeftinije)
    max_output_tokens: 650,            // ✅ limitira cenu (10 rečenica + par polja)
    prompt_cache_key: "dentals:site10:v2", // ✅ bolji cache u batch-u
    system: [
      "Ti si auditor web-sajta za lead research.",
      "Ulaz je scraped 'tokens' tekst + URL kao referenca (ne smeš da izmišljaš ništa van tokena).",
      "",
      "Zadatak:",
      "1) Napiši TAČNO 10 rečenica (srpski, latinica) sa 10 najvažnijih informacija iz tokena.",
      "2) Proceni modernost sajta (modern/outdated/mixed/unknown) sa confidence 0–1 i 2–5 razloga.",
      "3) Izvuci kontakte i ključne stvari u 'extracted' (email/phone/address/vendor/legal hints).",
      "",
      "Pravila:",
      "- Ne koristi bulletove i ne numeriši rečenice.",
      "- Ne izmišljaj email/telefon/adresu ako nije eksplicitno u tokenima.",
      "- Ako nešto nije prisutno, vrati null ili prazno polje.",
      "- Budi kratak: svaka rečenica maksimalno ~120 karaktera.",
    ].join("\n"),
    data: {
      url,
      tokens: compactTokens,
    },
  });
}
