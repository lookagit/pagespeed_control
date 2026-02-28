// ============================================================
// ai/analyzeLead.js - Srž sistema: AI analiza + skoring leada
// ============================================================
// Prima ceo call report (flat JSON iz pagespeed-reporter.js)
// i opciono scrapeBase iz live scrape-a.
//
// Vraća:
//   - score 0-100
//   - priority: hot / warm / cold
//   - problems, quick_wins, red_flags
//   - pitch, summary, estimated_budget_range
// ============================================================

import OpenAI from "openai";
import { CONFIG } from "../config.js";

const deepseek = new OpenAI({
  apiKey:  CONFIG.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com",
});

// ─────────────────────────────────────────────────────────────
// PRE-SCORE — lokalni skor pre AI-a
// Ulaz: callReport (flat call report objekat)
// ─────────────────────────────────────────────────────────────

function computePreScore({ callReport }) {
  let score = 0;
  const reasons = [];

  const s = callReport.scores        || {};
  const t = callReport.tracking      || {};
  const v = callReport.vitals_mobile || {};

  const mPerf = s.mobile_perf  ?? 100;
  const dPerf = s.desktop_perf ?? 100;

  // ── Performance ──────────────────────────────────────────
  if (mPerf < 50)      { score += 20; reasons.push(`Mob perf: ${mPerf} (kritično sporo)`); }
  else if (mPerf < 70) { score += 10; reasons.push(`Mob perf: ${mPerf} (sporo)`); }

  if (dPerf < 60)      { score += 10; reasons.push(`Desktop perf: ${dPerf}`); }
  else if (dPerf < 80) { score +=  5; reasons.push(`Desktop perf: ${dPerf}`); }

  // ── SEO ──────────────────────────────────────────────────
  const mSeo = s.mobile_seo ?? 100;
  if (mSeo < 70)      { score += 15; reasons.push(`SEO: ${mSeo} (loš)`); }
  else if (mSeo < 85) { score +=  7; reasons.push(`SEO: ${mSeo} (prosečan)`); }

  // ── Accessibility ─────────────────────────────────────────
  const mAcc = s.mobile_acc ?? 100;
  if (mAcc < 70) { score += 10; reasons.push(`Accessibility: ${mAcc}`); }

  // ── Tech stack ────────────────────────────────────────────
  const topTech = (callReport.tech_stack?.[0]?.name ?? "").toLowerCase();
  if      (topTech.includes("wix"))         { score += 15; reasons.push("Stack: Wix (loš za SEO/speed)"); }
  else if (topTech.includes("squarespace")) { score += 10; reasons.push("Stack: Squarespace"); }
  else if (topTech.includes("weebly"))      { score += 15; reasons.push("Stack: Weebly (zastareo)"); }
  else if (!topTech)                        { score +=  5; reasons.push("Stack: nepoznat"); }

  // ── Booking ───────────────────────────────────────────────
  if (!callReport.has_online_booking && !callReport.booking_vendor) {
    score += 10;
    reasons.push("Nema online booking sistema");
  }

  // ── Tracking ──────────────────────────────────────────────
  if (!t.has_ga4 && !t.has_gtm) {
    score += 5;
    reasons.push("Nema GA4 ni GTM trackinga");
  }

  // ── Core Web Vitals loši ──────────────────────────────────
  const poorCount = Object.values(v).filter(x => x?.status === "poor").length;
  if (poorCount >= 4)      { score += 10; reasons.push(`${poorCount} Core Web Vitals loših`); }
  else if (poorCount >= 2) { score +=  5; reasons.push(`${poorCount} Core Web Vitals loših`); }

  return { preScore: Math.min(score, 100), reasons };
}

// ─────────────────────────────────────────────────────────────
// PROMPT BUILDER
// ─────────────────────────────────────────────────────────────

function buildPrompt({ callReport, scrapeBase, preScore, prescore_reasons }) {
  const s   = callReport.scores        || {};
  const t   = callReport.tracking      || {};
  const v   = callReport.vitals_mobile || {};
  const seo = callReport.seo           || {};

  // Vitals — samo loši
  const poorVitals = Object.entries(v)
    .filter(([, val]) => val?.status === "poor")
    .map(([k, val]) => `${k.toUpperCase()} ${val.value}`)
    .join(", ") || "nema";

  // Tech stack
  const siteStack = callReport.tech_stack?.map(t => t.name).join(", ") || "nepoznat";

  // Scrape podaci — fallback na call report vrednosti
  const chatVendors    = scrapeBase?.vendors?.chatVendors?.join(", ")             || "nema";
  const bookingVendors = scrapeBase?.vendors?.bookingVendors?.join(", ")          || "nema";
  const scrapeEmails   = scrapeBase?.contacts?.emailsInText?.slice(0, 3)?.join(", ") || "nema";
  const scrapePhones   = scrapeBase?.contacts?.tel?.slice(0, 3)?.join(", ")          || "nema";
  const h1             = scrapeBase?.headings?.h1?.slice(0, 2)?.join(" | ")       || seo.h1_text || "nema";
  const scrapeTitle    = scrapeBase?.title || "nema";

  // Kontakt — preferuj call report, fallback na scrape
  const emails = callReport.emails?.length
    ? callReport.emails.join(", ")
    : scrapeEmails;

  const phones = callReport.phones?.length
    ? callReport.phones.join(", ")
    : scrapePhones;

  return `Ti si ekspert analitičar za digitalni marketing koji radi za web agenciju.
Tvoj zadatak je da analiziraš podatke o jednom biznis leadu i odgovoriš ISKLJUČIVO JSON-om.

## Podaci o leadu
- Biznis: ${callReport.name ?? "N/A"}
- Website: ${callReport.website_url ?? "N/A"}
- Adresa: ${callReport.address ?? "N/A"}
- Health score: ${callReport.health_score ?? "N/A"}/100 (${callReport.health_grade ?? "?"})
- Lead temperatura: ${callReport.lead_temperature?.label ?? "N/A"} (score: ${callReport.lead_temperature?.score ?? "?"}/${callReport.lead_temperature?.max_score ?? "?"})

## PageSpeed Insights
Mobile:  Performance=${s.mobile_perf ?? "N/A"} | SEO=${s.mobile_seo ?? "N/A"} | Accessibility=${s.mobile_acc ?? "N/A"} | BP=${s.mobile_bp ?? "N/A"}
Desktop: Performance=${s.desktop_perf ?? "N/A"} | SEO=${s.desktop_seo ?? "N/A"} | Accessibility=${s.desktop_acc ?? "N/A"} | BP=${s.desktop_bp ?? "N/A"}

## Core Web Vitals (mobile) — loši signali
${poorVitals}

## Signali sa sajta
- Naslov (scrape): ${scrapeTitle}
- H1: ${h1}
- Tech stack: ${siteStack}
- Online booking: ${callReport.has_online_booking ? (callReport.booking_vendor ?? callReport.booking_type) : "nema"}
- GA4: ${t.has_ga4 ? "DA" : "NE"} | GTM: ${t.has_gtm ? "DA" : "NE"} | Meta Pixel: ${t.has_meta_pixel ? "DA" : "NE"} | Google Ads: ${t.has_google_ads ? "DA" : "NE"}
- Chatbot: ${t.has_chatbot ? (t.chatbot_vendor ?? "DA, vendor nepoznat") : "NE"}
- Email na sajtu: ${emails}
- Telefon na sajtu: ${phones}
- SEO: title=${seo.has_title ? "DA" : "NE"} | meta desc=${seo.has_meta_description ? "DA" : "NE"} | schema=${seo.has_structured_data ? (seo.structured_data_type ?? "DA") : "NE"} | H1 count=${seo.h1_count ?? "?"}
- Live scrape — chat: ${chatVendors} | booking vendori: ${bookingVendors}

## Lead temperature signali
${callReport.lead_temperature?.signals?.map((s, i) => `  ${i + 1}. ${s}`).join("\n") ?? "N/A"}

## Pre-skor sistema
Algoritmički skor (0-100, veći = više problema = bolji lead): ${preScore}
Razlozi: ${prescore_reasons.join("; ")}

## INSTRUKCIJE
Na osnovu SVIH podataka proceni:
1. Da li ovaj biznis ima digitalne probleme koje možemo rešiti?
2. Koliko su "vrući" kao lead za web agenciju?
3. Šta konkretno im nedostaje?

Odgovori ISKLJUČIVO validnim JSON objektom (bez objašnjenja, bez markdowna):
{
  "score": <broj 0-100, gde 100 = savršen lead sa puno problema>,
  "priority": <"hot" | "warm" | "cold">,
  "problems": [
    "<konkretan problem 1 sa brojevima ako je moguće>",
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
  "estimated_budget_range": "<$1k-3k | $3k-8k | $8k+>",
  "summary": "<jedna rečenica sažetak>"
}`;
}

// ─────────────────────────────────────────────────────────────
// GLAVNI EXPORT
// ─────────────────────────────────────────────────────────────

export async function analyzeLeadWithDeepSeek({ callReport, scrapeBase = null }) {
  const { preScore, reasons } = computePreScore({ callReport });

  const prompt = buildPrompt({
    callReport,
    scrapeBase,
    preScore,
    prescore_reasons: reasons,
  });

  const response = await deepseek.chat.completions.create({
    model:       "deepseek-chat",
    messages:    [{ role: "user", content: prompt }],
    temperature: 0.3,
    max_tokens:  800,
  });

  const raw = response.choices[0]?.message?.content?.trim() ?? "";

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`DeepSeek nije vratio validan JSON:\n${raw}`);

  const analysis = JSON.parse(jsonMatch[0]);

  analysis.pre_score         = preScore;
  analysis.pre_score_reasons = reasons;

  return analysis;
}