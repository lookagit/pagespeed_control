// ai/prepareEnrichInputs.js
// Build a consistent leadPack from a raw callReport (your big object).
// This prevents enrich from crashing and gives a stable opportunity score.

function str(v) {
  return v == null ? "" : String(v).trim();
}
function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function arr(v) {
  return Array.isArray(v) ? v : [];
}

function parseUSCityState(address = "") {
  const parts = String(address).split(",").map(s => s.trim()).filter(Boolean);
  const city = parts[1] ?? "";
  const stateZip = parts[2] ?? "";
  const state = stateZip.split(/\s+/)[0] ?? ""; // GA
  return { city, state };
}

/**
 * Deterministic "opportunity" score (0–100).
 * Higher = more problems = higher likelihood to convert.
 * This is what YOU want (call the ones with problems).
 */
export function computeOpportunityScore(callReport) {
  const s = callReport?.scores ?? {};
  const v = callReport?.vitals_mobile ?? {};
  const r = callReport?.resources_mobile ?? {};
  const t = callReport?.tracking ?? {};
  const c = callReport ?? {};

  let score = 0;
  const signals = [];

  // Website performance opportunity
  const mPerf = num(s.mobile_perf, 100);
  if (mPerf < 50) { score += 30; signals.push(`Mobile performance is very low (${mPerf}/100).`); }
  else if (mPerf < 70) { score += 18; signals.push(`Mobile performance is low (${mPerf}/100).`); }
  else if (mPerf < 85) { score += 10; signals.push(`Mobile performance is mid (${mPerf}/100).`); }

  if (v.fcp?.status === "poor") { score += 10; signals.push(`Mobile shows a blank screen for ${v.fcp.value}.`); }
  if (v.tti?.status === "poor") { score += 10; signals.push(`Buttons aren’t responsive until ${v.tti.value} on mobile.`); }

  if (r.page_weight?.status === "poor") { score += 8; signals.push(`Page is heavy (${r.page_weight.value}).`); }
  if (r.requests?.status === "poor") { score += 8; signals.push(`Too many files load (${r.requests.value} requests).`); }

  // Measurement / marketing opportunity
  if (!t.has_ga4) { score += 10; signals.push(`No visitor analytics installed (can’t see how patients find you).`); }
  if (!t.has_meta_pixel) { score += 6; signals.push(`Can’t reliably measure social ads outcomes.`); }
  if (!t.has_google_ads) { score += 4; signals.push(`Can’t reliably measure Google Ads outcomes.`); }

  // Conversion/contact opportunity
  if (!c.emails?.length) { score += 4; signals.push(`No email address visible on the site.`); }
  if (!c.phones?.length) { score += 8; signals.push(`Phone number not clearly detected.`); }
  if (!c.has_online_booking && !c.booking_vendor) { score += 10; signals.push(`No online booking detected.`); }

  // Cap
  score = Math.max(0, Math.min(100, score));

  return { score, signals };
}

export function derivePriorityFromScore(score, { hot = 70, warm = 40 } = {}) {
  if (score >= hot) return "hot";
  if (score >= warm) return "warm";
  return "cold";
}

/**
 * Minimal siteSummary derived from callReport only (no hallucinations).
 * If you already have a better siteSummary from scrape, pass it instead.
 */
export function deriveSiteSummaryFromCallReport(callReport) {
  const s = callReport?.scores ?? {};
  const r = callReport?.resources_mobile ?? {};

  const mobile = num(s.mobile_perf, null);
  const heavy = r.page_weight?.status === "poor" || r.requests?.status === "poor";

  const tone =
    mobile != null && mobile >= 90 && !heavy ? "modern" :
    mobile != null && mobile < 70 ? "cluttered" :
    heavy ? "cluttered" :
    "professional";

  return {
    summary: callReport?.seo?.title
      ? `Dental practice website: ${callReport.seo.title}`
      : `Dental practice website for ${callReport?.name ?? "unknown"}.`,
    services: [],                 // unknown from callReport alone
    tone,
    has_online_booking: !!callReport?.has_online_booking,
    has_testimonials: "unknown",  // don’t guess
    has_team_page: "unknown",
    languages: ["en"],
    notable: null,
  };
}

/**
 * Builds the exact object enrichLead expects.
 */
export function buildLeadPackFromCallReport({ callReport, analysis = null, siteSummary = null }) {
  const lead = callReport?._originalLead ?? {
    name: callReport?.name ?? null,
    phone: callReport?.phones?.[0] ?? null,
    website_url: callReport?.website_url ?? null,
    address: callReport?.address ?? null,
  };

  const { score, signals } = computeOpportunityScore(callReport);
  const priority = analysis?.priority ?? callReport?.lead_temperature?.temperature ?? derivePriorityFromScore(score);

  const ss = siteSummary ?? deriveSiteSummaryFromCallReport(callReport);

  return {
    lead,
    score: analysis?.score ?? score,
    priority,
    estimated_budget: analysis?.estimated_budget_range ?? "",
    analysis: {
      summary: analysis?.summary ?? "",
      pitch: analysis?.pitch ?? "",
      problems: analysis?.problems ?? [],
      quick_wins: analysis?.quick_wins ?? [],
      red_flags: analysis?.red_flags ?? [],
      pre_score: analysis?.pre_score ?? 0,
      pre_score_reasons: analysis?.pre_score_reasons ?? [],
      site_quality_summary: analysis?.site_quality_summary ?? "",
      the_one_problem: analysis?.the_one_problem ?? "",
      the_one_problem_cost: analysis?.the_one_problem_cost ?? "",
      the_fix: analysis?.the_fix ?? "",
      email_subject_options: analysis?.email_subject_options ?? [],
    },
    site: {
      summary: ss.summary ?? "",
      services: ss.services ?? [],
      tone: ss.tone ?? "unknown",
      has_booking: ss.has_online_booking === true,
      has_testimonials: ss.has_testimonials === true,
    },
    analyzed_at: new Date().toISOString(),

    // These two are super helpful for agents and gating:
    priority_reason: `Opportunity score ${score}/100 (${priority}).`,
    priority_signals: signals.slice(0, 8),
  };
}

/**
 * This is what you call before enrichLead to guarantee inputs are correct.
 */
export function prepareEnrichInputs({ callReport, analysis = null, siteSummary = null }) {
  const leadPack = buildLeadPackFromCallReport({ callReport, analysis, siteSummary });
  return { leadPack, item: callReport, analysis };
}