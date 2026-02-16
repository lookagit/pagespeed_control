 import { Site10Schema } from "./schemas.js";
import { callStrictJson } from "./strict.js";

export const ENGINES = {
  FAST: "gpt-4o-mini",    // Za brze analize, klasifikaciju, jednostavne zadatke
  SMART: "gpt-4o",        // Za kompleksne sales strategije i pisanje emailova
  REASONING: "o1-mini",   // Ako vam treba duboka logika (npr. tehnički audit)
};

export async function summarizeSiteTo10({ url, tokens }) {
  return callStrictJson({
    schema: Site10Schema,
    schemaName: "site_summary_10",
    model: ENGINES.SMART, // dovoljno brzo/jeftino za ovo
    system: [
      "Ti si auditor web-sajta za lead research.",
      "Ulaz je scraped 'tokens' tekst + URL kao referenca (ali ne smes da izmisljas nista van tokena).",
      "",
      "Zadatak:",
      "1) Napiši TAČNO 10 rečenica (srpski, latinica) sa 10 najvažnijih informacija iz tokena.",
      "2) Daj procenu modernosti sajta (modern/outdated/mixed/unknown) sa confidence 0–1 i 2–5 razloga.",
      "3) Izvuci kontakte i ključne stvari u 'extracted' (email/phone/address/vendor/legal hints).",
      "",
      "Pravila:",
      "- Ne koristi bulletove i ne numeriši rečenice.",
      "- Ne izmišljaj email/telefon/adresu ako nije eksplicitno u tokenima.",
      "- Ako nešto nije prisutno, vrati null ili prazno polje.",
    ].join("\n"),
    data: {
      url,
      tokens,
    },
  });
}
