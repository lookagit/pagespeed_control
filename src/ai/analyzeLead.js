// ============================================================
// ai/analyzeLead.js — Multi-pass AI analiza leada
// ============================================================
//
// 4 fokusirana passa:
//   PASS 1 — Brzina & mobilni prikaz
//   PASS 2 — Google vidljivost (SEO)
//   PASS 3 — Zakazivanje & konverzija
//   PASS 4 — Sinteza (Australijanac pristup)
//
// AUSTRALIJANAC PRINCIP (sve u Passu 4):
//   → Poštuj sajt ako je dobar. Ne lažiraj probleme.
//   → Pronađi JEDNU konkretnu stvar koja ih košta pacijente.
//   → Kvantifikuj to u dolarima ili izgubljenim pacijentima.
//   → Ponudi fix sa timelineom, ne cenom.
//   → Nikad ne diraj ono što je dobro — samo ono što treba.
// ============================================================

import { callStrictJson } from "./strict.js";
import { getLeadView } from "./leadView.js";

// ─────────────────────────────────────────────────────────────
// PRE-SCORE — algoritmički, bez AI-a
// ─────────────────────────────────────────────────────────────
function computePreScore({ callReport }) {
  let score = 0;
  const reasons = [];

  const s = callReport.scores        || {};
  const t = callReport.tracking      || {};
  const v = callReport.vitals_mobile || {};

  const mPerf = s.mobile_perf  ?? 100;
  const dPerf = s.desktop_perf ?? 100;

  if (mPerf < 50)      { score += 20; reasons.push(`Mobile perf: ${mPerf} (critical)`); }
  else if (mPerf < 70) { score += 10; reasons.push(`Mobile perf: ${mPerf} (slow)`); }
  if (dPerf < 60)      { score += 10; reasons.push(`Desktop perf: ${dPerf}`); }
  else if (dPerf < 80) { score +=  5; reasons.push(`Desktop perf: ${dPerf}`); }

  const mSeo = s.mobile_seo ?? 100;
  if (mSeo < 70)      { score += 15; reasons.push(`SEO: ${mSeo} (poor)`); }
  else if (mSeo < 85) { score +=  7; reasons.push(`SEO: ${mSeo} (avg)`); }

  const mAcc = s.mobile_acc ?? 100;
  if (mAcc < 70) { score += 10; reasons.push(`Accessibility: ${mAcc}`); }

  const topTech = (callReport.tech_stack?.[0]?.name ?? "").toLowerCase();
  if      (topTech.includes("wix"))         { score += 15; reasons.push("Stack: Wix"); }
  else if (topTech.includes("squarespace")) { score += 10; reasons.push("Stack: Squarespace"); }
  else if (topTech.includes("weebly"))      { score += 15; reasons.push("Stack: Weebly"); }
  else if (!topTech)                        { score +=  5; reasons.push("Stack: unknown"); }

  if (!callReport.has_online_booking && !callReport.booking_vendor) {
    score += 10; reasons.push("No online booking");
  }
  if (!t.has_ga4 && !t.has_gtm) {
    score += 5; reasons.push("No GA4/GTM");
  }

  const poorCount = Object.values(v).filter(x => x?.status === "poor").length;
  if (poorCount >= 4)      { score += 10; reasons.push(`${poorCount} poor CWV`); }
  else if (poorCount >= 2) { score +=  5; reasons.push(`${poorCount} poor CWV`); }

  return { preScore: Math.min(score, 100), reasons };
}

// ─────────────────────────────────────────────────────────────
// HELPERS — prevodi metrike u patient impact jezik
// ─────────────────────────────────────────────────────────────

function describeSpeed(s, v, r) {
  const mPerf = s.mobile_perf;
  const dPerf = s.desktop_perf;
  const lcp   = v?.lcp;
  const fcp   = v?.fcp;
  const tti   = v?.tti;
  const tbt   = v?.tbt;

  const lines = [];

  // Overall verdict
  if (mPerf != null) {
    if      (mPerf < 30) lines.push(`Mobile score ${mPerf}/100 — critically slow. Most patients leave before anything loads.`);
    else if (mPerf < 50) lines.push(`Mobile score ${mPerf}/100 — very slow. More than half of phone visitors likely leave.`);
    else if (mPerf < 70) lines.push(`Mobile score ${mPerf}/100 — noticeably slow on phones.`);
    else if (mPerf < 85) lines.push(`Mobile score ${mPerf}/100 — decent but has a specific loading issue.`);
    else                 lines.push(`Mobile score ${mPerf}/100 — fast.`);
  }
  if (dPerf != null) {
    if   (dPerf >= 90) lines.push(`Desktop score ${dPerf}/100 — excellent.`);
    else if (dPerf >= 70) lines.push(`Desktop score ${dPerf}/100 — good on desktop.`);
    else lines.push(`Desktop score ${dPerf}/100 — slow even on computers.`);
  }

  // Specific vitals in human terms
  if (fcp?.status === "poor") {
    lines.push(`Patients on phones wait ${fcp.value} before they see anything — a blank screen. Google's research shows 53% leave after 3 seconds.`);
  }
  if (tti?.status === "poor") {
    lines.push(`The page takes ${tti.value} before buttons and links actually work — patients try to tap and nothing happens.`);
  }
  if (lcp?.status === "poor" || lcp?.status === "warn") {
    lines.push(`Main content appears after ${lcp.value} (good is under 2.5s).`);
  }
  if (tbt?.status === "poor") {
    lines.push(`Page is unresponsive for ${tbt.value} after loading.`);
  }

  // Resources
  if (r?.page_weight?.status === "poor") {
    lines.push(`Page size is ${r.page_weight.value} — too heavy, especially for mobile data connections.`);
  }
  if (r?.requests?.status === "poor") {
    lines.push(`${r.requests.value} separate files load on each visit — reduces speed significantly.`);
  }

  return lines.join(" ");
}

function describeTracking(t) {
  const lines = [];
  if (!t) return "No tracking data available.";

  if (!t.has_ga4 && !t.has_gtm) {
    lines.push("No visitor analytics at all. The practice cannot see how many people visit, which pages they look at, or where they came from.");
  } else if (!t.has_ga4) {
    lines.push("Tag manager is installed but no visitor analytics. They can see their site exists but not how patients use it.");
  }
  if (!t.has_meta_pixel) {
    lines.push("No social media ad tracking. If they ever run Facebook or Instagram ads, they cannot tell which ads bring in patients — spending blind.");
  }
  if (!t.has_google_ads) {
    lines.push("No Google Ads tracking. Running Google Ads without this is paying for a billboard with no way to know if anyone called.");
  }
  if (!t.has_chatbot) {
    lines.push("No live chat. Patients who visit at 9pm — after hours — have no way to ask a quick question. They go to the next dentist on the list.");
  }

  return lines.join(" ");
}

function describeBooking(c) {
  const lines = [];
  if (!c.has_online_booking && !c.booking_vendor) {
    lines.push("No online booking. Patients must call during office hours — many won't bother, especially under-40 patients who expect to book the way they book everything else: online, right now.");
  } else {
    lines.push(`Online booking present${c.booking_vendor ? ` via ${c.booking_vendor}` : ""} — good.`);
  }
  if (!c.phones?.length) {
    lines.push("Phone number not found on the site.");
  }
  if (!c.emails?.length) {
    lines.push("No email address visible on the site.");
  }
  return lines.join(" ");
}

function describeSeo(seo, scores) {
  const lines = [];
  const mSeo = scores?.mobile_seo;

  if (mSeo != null) {
    if      (mSeo >= 90) lines.push(`SEO score ${mSeo}/100 — excellent. Google understands this site well.`);
    else if (mSeo >= 70) lines.push(`SEO score ${mSeo}/100 — decent but improvable.`);
    else                 lines.push(`SEO score ${mSeo}/100 — patients searching "dentist near me" are less likely to find this practice.`);
  }

  if (!seo) return lines.join(" ");

  if (!seo.has_title)            lines.push("No page title — Google doesn't know what this business is.");
  if (!seo.has_meta_description) lines.push("No description in Google search results.");
  if (!seo.has_structured_data)  lines.push("Missing local business markup — Google can't easily show their address and hours in search.");
  if (seo.images_without_alt > 2) lines.push(`${seo.images_without_alt} images have no description — minor SEO and accessibility issue.`);

  return lines.join(" ");
}

// ─────────────────────────────────────────────────────────────
// PASS 1 — BRZINA
// ─────────────────────────────────────────────────────────────
async function passSpeed(callReport, scrapeBase = null) {
  const L = getLeadView(callReport, scrapeBase);

  return await callStrictJson({
    system: `You analyze dental website speed. Plain English, no jargon.
Use ONLY provided facts. If unclear, say unclear.
Return ONLY this JSON:
{
  "speed_verdict": "...",
  "patient_impact": "...",
  "biggest_speed_problem": "...",
  "speed_fixable_without_rebuild": true
}`,
    data: {
      practice: L.name,
      website: L.url,
      mobile_score: L.scores.mobile_perf,
      desktop_score: L.scores.desktop_perf,
      vitals: {
        fcp: L.vitals.fcp,
        tti: L.vitals.tti,
        lcp: L.vitals.lcp,
        page_weight: L.vitals.page_weight,
        http_requests: L.vitals.http_requests,
      },
    },
    max_tokens: 300,
  });
}
// ─────────────────────────────────────────────────────────────
// PASS 2 — SEO
// ─────────────────────────────────────────────────────────────
async function passSeo(callReport, scrapeBase = null) {
  const L = getLeadView(callReport, scrapeBase);

  return await callStrictJson({
    system: `You analyze Google visibility for dental websites. Plain English.
Use ONLY facts. If unclear, say unclear.
Return ONLY this JSON:
{
  "seo_verdict": "...",
  "local_search_situation": "...",
  "biggest_seo_problem": "...",
  "local_search_ready": true
}`,
    data: {
      practice: L.name,
      address: L.address,
      mobile_seo: L.scores.mobile_seo,
      seo_facts: {
        title: L.seo.title ?? null,
        h1: L.seo.h1 ?? null,
        has_schema: L.seo.has_schema ?? null,
        has_canonical: L.seo.has_canonical ?? null,
      },
    },
    max_tokens: 300,
  });
}

// ─────────────────────────────────────────────────────────────
// PASS 3 — KONVERZIJA & ZAKAZIVANJE
// ─────────────────────────────────────────────────────────────
async function passConversion(callReport, scrapeBase = null) {
  const L = getLeadView(callReport, scrapeBase);

  // “facts” smanjuje halucinacije
  const facts = [
    `Website: ${L.url ?? "unknown"}`,
    `Phones visible: ${L.contact.phone_count ?? (L.contact.phones?.length ?? 0)}`,
    `Email visible: ${L.contact.email_count ?? (L.contact.emails?.length ?? 0)}`,
    `Online booking: ${L.booking.has_booking ? "yes" : "no"}${L.booking.vendor ? ` (vendor: ${L.booking.vendor})` : ""}`,
    L.scrape.schedule_online_seen === null ? null : `“Schedule Online” link seen: ${L.scrape.schedule_online_seen ? "yes" : "no"}`,
    L.scrape.forms_count === null ? null : `HTML forms found: ${L.scrape.forms_count}`,
    L.scrape.consent_cmp ? `Cookie consent tool: ${L.scrape.consent_cmp}` : null,
    L.scrape.conflicts.length ? `Conflicts: ${L.scrape.conflicts.join(" | ")}` : null,
  ].filter(Boolean);

  return await callStrictJson({
    system: `You analyze whether a dental website turns visitors into booked appointments.
Plain English. Be conservative and honest.

RULES:
- Use ONLY the provided facts.
- If something is unclear/conflicting, say "unclear" and do NOT assert it.
- Do NOT use jargon words like: pixel, GTM, tag manager, conversion rate, bounce rate.
- Focus on booking flow + after-hours experience + ability to tell which marketing brings calls.

Return ONLY this JSON:
{
  "conversion_verdict": "<one honest sentence: how easy is it for a patient to book?>",
  "biggest_friction": "<the single thing most likely stopping a patient from booking — specific and factual>",
  "after_hours_situation": "<what happens when a patient visits at 9pm, based on facts>",
  "ad_measurement_situation": "<can they tell which marketing brings calls/appointments? no jargon; if unclear say unclear>",
  "quick_win": "<single fastest website change that would likely increase bookings>"
}`,

    data: {
      practice: L.name,
      facts,

      booking: {
        has_booking: !!L.booking.has_booking,
        vendor: L.booking.vendor ?? null,
        type: L.booking.type ?? null,
        cta_inferred: !!L.booking.cta_inferred,
      },

      contact: {
        phones: L.contact.phones ?? [],
        emails: L.contact.emails ?? [],
        phone_count: L.contact.phone_count ?? (L.contact.phones?.length ?? 0),
        email_count: L.contact.email_count ?? (L.contact.emails?.length ?? 0),
      },

      after_hours: {
        has_chat: L.status?.chatbot?.ok ?? null,
      },

      measurement: {
        present: L.tracking.present,
        missing: L.tracking.missing,
        conflicts: L.scrape.conflicts,
        consent_cmp: L.scrape.consent_cmp ?? null,
      },

      scrape_hints: {
        schedule_online_seen: L.scrape.schedule_online_seen,
        forms_count: L.scrape.forms_count,
      }
    },

    max_tokens: 350,
  });
}
// ─────────────────────────────────────────────────────────────
// PASS 4 — SINTEZA (Australijanac sistem)
// ─────────────────────────────────────────────────────────────
async function passSynthesis({
  callReport, speedPass, seoPass, conversionPass,
  preScore, scrapeBase,
}) {
  const mPerf       = callReport.scores?.mobile_perf;
  const healthScore = callReport.health_score;
  const tempLabel   = callReport.lead_temperature?.label ?? "WARM";
  const tempSignals = callReport.lead_temperature?.signals ?? [];

  const services = scrapeBase?.services?.join(", ") || "";
  const siteTone = scrapeBase?.tone || "";

  // ROI kalkulator
  const lostVisitors = Math.round(200 * (0.53 - 0.09));
  const lostAppts    = Math.round(lostVisitors * 0.03);
  const monthlyLost  = lostAppts * 350;

  return await callStrictJson({
    system: `You are a web consultant who sells website improvements to dental practices.
You follow the "Australian approach":

CORE PHILOSOPHY:
1. If the site is good — say so. Never fabricate problems. Respect their work.
2. Find ONE concrete thing that is costing them patients right now. Just one.
3. Quantify it in dollars or lost patients — use real numbers.
4. Offer a specific fix with a timeline. Don't lead with price.
5. Never touch what is working. Only fix what's broken.
6. Tone: peer-to-peer. Like a colleague who noticed something, not a salesperson.

LANGUAGE RULES (strictly enforced):
- NEVER say: "Meta Pixel", "GTM", "Core Web Vitals", "LCP", "FCP", "TTI", "TBT",
  "structured data", "canonical URL", "async scripts", "lazy loading",
  "conversion rate", "bounce rate", "schema markup", "tag manager"
- ALWAYS translate:
  - "FCP 3.25s" → "patients see a blank screen for over 3 seconds on their phone"
  - "no Meta Pixel" → "if you run Facebook ads, you can't tell which ones bring patients"
  - "no GA4" → "you have no way to see how patients find you online"
  - "poor TTI" → "buttons and links don't respond when patients tap them"
- Use first names or "your practice" not "the practice"
- Dollar amounts make it real — use conservative estimates

THE EMAIL YOU ARE WRITING INPUTS FOR:
Structure (4 sentences, under 80 words total):
  S1: Genuine compliment on what's good + the ONE problem (with number)
  S2: Social proof — similar practice nearby, specific result in 60 days
  S3: Free PDF audit — theirs to keep regardless
  S4: "Want me to send it?" — binary YES/NO, never ask for a call

Return ONLY this JSON:
{
  "score": <0-100, higher = better sales opportunity. A site with ONE fixable problem on an otherwise great site can still be 70+>,
  "priority": <"hot"|"warm"|"cold">,
  "estimated_budget_range": "<$1k-3k|$3k-8k|$8k+>",

  "site_quality_summary": "<honest 1-sentence assessment of the site overall — compliment if deserved>",
  "the_one_problem": "<THE single most impactful problem in plain dentist English — no jargon, has a number>",
  "the_one_problem_cost": "<what this one problem costs them — in lost patients per month OR dollars>",
  "the_fix": "<what you'd do + timeline — 'I can fix X in 2 weeks'>",

  "summary": "<one sentence for the sales agent — opportunity framing, not problem framing>",
  "problems": [
    "<problem 1 — plain English, dentist understands, has a number if possible>",
    "<problem 2 if real — skip if site is genuinely good>",
    "<problem 3 if real>"
  ],
  "quick_wins": [
    "<quick win 1 — concrete, patient-impact framing>",
    "<quick win 2>",
    "<quick win 3>"
  ],
  "red_flags": [
    "<honest reason they might not convert — e.g. 'site is strong, may not feel urgency'>"
  ],
  "pitch": "<2-3 sentences for the cold email body. Australijanac style: compliment the good, name one specific thing, quantify it, offer the fix. Dentist language. No jargon.>",
  "email_subject_options": [
    "<option 1 — under 40 chars, number included, loss or timeline framing, no question mark>",
    "<option 2>",
    "<option 3>"
  ]
}`,
    data: {
      practice:          callReport.name,
      website:           callReport.website_url,
      address:           callReport.address,
      health_score:      healthScore,
      health_grade:      callReport.health_grade,
      lead_temperature:  tempLabel,
      temp_signals:      tempSignals,
      pre_score:         preScore,
      mobile_score:      mPerf,
      services,
      site_tone:         siteTone,
      google_rating:     callReport._originalLead?.rating ?? null,
      google_reviews:    callReport._originalLead?.user_ratings_total ?? null,
      estimated_monthly_lost: monthlyLost,

      // Pass summaries
      speed: {
        verdict:       speedPass?.speed_verdict,
        patient_impact: speedPass?.patient_impact,
        top_problem:   speedPass?.biggest_speed_problem,
        fixable:       speedPass?.speed_fixable_without_rebuild,
      },
      seo: {
        verdict:       seoPass?.seo_verdict,
        local_situation: seoPass?.local_search_situation,
        top_problem:   seoPass?.biggest_seo_problem,
        local_ready:   seoPass?.local_search_ready,
      },
      conversion: {
        verdict:      conversionPass?.conversion_verdict,
        friction:     conversionPass?.biggest_friction,
        after_hours:  conversionPass?.after_hours_situation,
        ads_measurement: conversionPass?.ad_measurement_situation,
        quick_win:    conversionPass?.quick_win,
      },
    },
    max_tokens: 900,
  });
}

// ─────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────
export async function analyzeLeadWithDeepSeek({ callReport, scrapeBase = null }) {
  const { preScore, reasons } = computePreScore({ callReport });

  console.log("   🔍 Pass 1: Speed...");
  const speedPass = await passSpeed(callReport).catch(e => {
    console.log(`   ⚠️  Speed pass failed: ${e.message}`); return null;
  });

  console.log("   🔍 Pass 2: SEO...");
  const seoPass = await passSeo(callReport).catch(e => {
    console.log(`   ⚠️  SEO pass failed: ${e.message}`); return null;
  });

  console.log("   🔍 Pass 3: Conversion...");
  const conversionPass = await passConversion(callReport).catch(e => {
    console.log(`   ⚠️  Conversion pass failed: ${e.message}`); return null;
  });

  console.log("   🔍 Pass 4: Synthesis...");
  const synthesis = await passSynthesis({
    callReport, speedPass, seoPass, conversionPass, preScore, scrapeBase,
  });

  synthesis.pre_score         = preScore;
  synthesis.pre_score_reasons = reasons;
  synthesis._passes = { speed: speedPass, seo: seoPass, conversion: conversionPass };

  return synthesis;
}