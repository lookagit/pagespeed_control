// ============================================================
// ai/analyzeLead.js - Srž sistema: AI analiza + skoring leada
// ============================================================
// Šalje sve prikupljene podatke DeepSeek-u i dobija:
//   - skor 0-100 (koliko je lead "vruć")
//   - prioritet: hot / warm / cold
//   - konkretni problemi sajta
//   - predlog šta da im ponudiš
// ============================================================

import OpenAI from "openai"; // DeepSeek koristi OpenAI-kompatibilni API
import { CONFIG } from "../config.js";

const deepseek = new OpenAI({
  apiKey:  CONFIG.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com",
});

// ─────────────────────────────────────────────────────────────
// SCORE HELPER - lokalni pre-skor pre AI-a
// ─────────────────────────────────────────────────────────────

/**
 * Izračunava numerički skor na osnovu prikupljenih podataka.
 * Ovo je "signal" koji dajemo AI-u da bolje proceni.
 *
 * Visok skor = sajt ima PROBLEMA = odličan lead za web agenciju
 */
function computePreScore({ mobile, desktop, signals, stack }) {
  let score = 0;
  const reasons = [];

  const mPerf = mobile?.categories?.performance ?? 100;
  const dPerf = desktop?.categories?.performance ?? 100;

  // Performance bodovi (max 40)
  if (mPerf < 50)       { score += 20; reasons.push(`Mob performance: ${mPerf} (kritično sporo)`); }
  else if (mPerf < 70)  { score += 10; reasons.push(`Mob performance: ${mPerf} (sporo)`); }

  if (dPerf < 60)       { score += 10; reasons.push(`Desktop perf: ${dPerf}`); }
  else if (dPerf < 80)  { score +=  5; reasons.push(`Desktop perf: ${dPerf}`); }

  // SEO bodovi (max 20)
  const mSeo = mobile?.categories?.seo ?? 100;
  if (mSeo < 70) { score += 15; reasons.push(`SEO: ${mSeo} (loš)`); }
  else if (mSeo < 85) { score += 7; reasons.push(`SEO: ${mSeo} (prosečan)`); }

  // Dostupnost (max 10)
  const mAcc = mobile?.categories?.accessibility ?? 100;
  if (mAcc < 70) { score += 10; reasons.push(`Accessibility: ${mAcc}`); }

  // Stack bodovi (max 20)
  const cms = stack?.cms?.toLowerCase() ?? "";
  if (cms.includes("wix"))          { score += 15; reasons.push("CMS: Wix (loš za SEO/speed)"); }
  else if (cms.includes("squarespace")) { score += 10; reasons.push("CMS: Squarespace"); }
  else if (cms.includes("weebly"))   { score += 15; reasons.push("CMS: Weebly (zastareo)"); }
  else if (cms === "" || cms === "unknown") { score += 5; reasons.push("CMS: nepoznat"); }

  // Nema bookinga (max 10)
  if (!signals?.booking?.type || signals?.booking?.confidence < 0.6) {
    score += 10;
    reasons.push("Nema online booking sistema");
  }

  // Nema GA4/GTM (max 5)
  if (!signals?.tracking?.ga4 && !signals?.tracking?.gtm) {
    score += 5;
    reasons.push("Nema GA4 ni GTM trackinga");
  }

  return { preScore: Math.min(score, 100), reasons };
}

// ─────────────────────────────────────────────────────────────
// PROMPT BUILDER
// ─────────────────────────────────────────────────────────────

function buildPrompt({ lead, mobile, desktop, signals, stack, scrapeBase, preScore, prescore_reasons }) {
  const m = mobile?.categories ?? {};
  const d = desktop?.categories ?? {};

  // Izvuci korisne podatke iz scrape rezultata
  const chatVendors    = scrapeBase?.vendors?.chatVendors?.join(", ")    || "nema";
  const bookingVendors = scrapeBase?.vendors?.bookingVendors?.join(", ") || "nema";
  const tracking       = scrapeBase?.vendors?.tracking?.join(", ")       || "nema";
  const siteStack      = scrapeBase?.vendors?.stack?.join(", ")          || stack?.cms || "nepoznat";
  const emails         = scrapeBase?.contacts?.emailsInText?.slice(0,3)?.join(", ") || "nema";
  const phones         = scrapeBase?.contacts?.tel?.slice(0,3)?.join(", ")          || "nema";
  const hasBooking     = (scrapeBase?.vendors?.bookingVendors?.length ?? 0) > 0;
  const formCount      = scrapeBase?.forms?.count ?? 0;
  const h1             = scrapeBase?.headings?.h1?.slice(0,2)?.join(" | ") || "nema";
  const title          = scrapeBase?.title || "nema";

  return `Ti si ekspert analitičar za digitalni marketing koji radi za web agenciju.
Tvoj zadatak je da analiziraš podatke o jednom biznis leadu i odgovoriš ISKLJUČIVO JSON-om.

## Podaci o leadu
- Biznis: ${lead.company || lead.name}
- Lokacija: ${lead.city || ""} ${lead.state || ""}
- Google rating: ${lead.rating ?? "N/A"} (${lead.user_ratings_total ?? 0} recenzija)
- Website: ${lead.website_url}

## PageSpeed Insights
Mobile:  Performance=${m.performance ?? "N/A"} | SEO=${m.seo ?? "N/A"} | Accessibility=${m.accessibility ?? "N/A"}
Desktop: Performance=${d.performance ?? "N/A"} | SEO=${d.seo ?? "N/A"}

## Signali sa sajta (live scrape)
- Naslov sajta: ${title}
- H1: ${h1}
- CMS/Stack: ${siteStack}
- Online booking sistem: ${hasBooking ? bookingVendors : "nema"}
- Live chat: ${chatVendors}
- Tracking alati: ${tracking}
- Broj formi: ${formCount}
- Email (sa sajta): ${emails}
- Telefon (sa sajta): ${phones}
- Meta Pixel: ${signals?.tracking?.meta_pixel ? "DA" : "NE"}

## Pre-skor sistema
Algoritmički skor (0-100, veći = više problema): ${preScore}
Razlozi: ${prescore_reasons.join("; ")}

## INSTRUKCIJE
Na osnovu SVIH podataka proceni:
1. Da li ovaj biznis ima digitalne probleme koje možemo rešiti?
2. Koliko su "vrući" kao lead za web agenciju?
3. Šta konkretno im nedostaje?

Odgovori ISKLJUČIVO validnim JSON objektom ovog oblika (bez objašnjenja, bez markdowna):
{
  "score": <broj 0-100, gde 100 = savršen lead, puno problema>,
  "priority": <"hot" | "warm" | "cold">,
  "problems": [
    "<konkretan problem 1>",
    "<konkretan problem 2>"
  ],
  "pitch": "<2-3 rečenice: šta bi agencija predložila ovom klijentu>",
  "quick_wins": [
    "<brzo rešenje 1>",
    "<brzo rešenje 2>"
  ],
  "red_flags": [
    "<razlog zašto možda NISU dobar lead, ako postoji>"
  ],
  "estimated_budget_range": "<npr: $1k-3k | $3k-8k | $8k+>",
  "summary": "<jedna rečenica sažetak>"
}`;
}

// ─────────────────────────────────────────────────────────────
// GLAVNI EXPORT
// ─────────────────────────────────────────────────────────────

export async function analyzeLeadWithDeepSeek({ lead, mobile, desktop, signals, stack, scrapeBase = null }) {
  const { preScore, reasons } = computePreScore({ mobile, desktop, signals, stack });

  const prompt = buildPrompt({
    lead, mobile, desktop, signals, stack, scrapeBase,
    preScore,
    prescore_reasons: reasons,
  });

  const response = await deepseek.chat.completions.create({
    model: "deepseek-chat",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3, // niska temperatura = konzistentni, predvidivi izlazi
    max_tokens: 800,
  });

  const raw = response.choices[0]?.message?.content?.trim() ?? "";

  // Parsiraj JSON odgovor
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`DeepSeek nije vratio validan JSON:\n${raw}`);

  const analysis = JSON.parse(jsonMatch[0]);

  // Dodaj pre-skor podatke radi transparentnosti
  analysis.pre_score     = preScore;
  analysis.pre_score_reasons = reasons;

  return analysis;
}