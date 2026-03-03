// ============================================================
// ai/buildLeadPack.js — Assembles final lead pack (website-sales oriented)
// ============================================================
import { CONFIG } from "../config.js";

export async function buildLeadPack({ lead, analysis, siteSummary }) {
  const score = Number(analysis?.score ?? 0);

  // Priority is "sales opportunity" for website work:
  // HOT = big/fixable issues -> call first
  // WARM = some issues -> email first, call later
  // COLD = site already strong -> low urgency
  const derived = derivePriority(score);
  const priority = (analysis?.priority ?? derived).toLowerCase();

  const priorityExplanation = buildPriorityExplanation({
    priority,
    score,
    analysis,
    siteSummary,
  });

  const callPolicy = buildCallPolicy(priority);

  return {
    // untouched original lead object (as you had)
    lead,

    // high-level triage
    score,
    priority, // hot | warm | cold  (opportunity)
    priority_reason: priorityExplanation.reason,
    priority_signals: priorityExplanation.signals, // array of short bullets
    call_policy: callPolicy, // recommended action

    estimated_budget: analysis?.estimated_budget_range || "",

    analysis: {
      // keep your fields
      summary:           analysis?.summary           || "",
      pitch:             analysis?.pitch             || "",
      problems:          analysis?.problems          || [],
      quick_wins:        analysis?.quick_wins        || [],
      red_flags:         analysis?.red_flags         || [],
      pre_score:         analysis?.pre_score         ?? 0,
      pre_score_reasons: analysis?.pre_score_reasons || [],

      // also keep the “Australian” core outputs if present (super useful)
      site_quality_summary: analysis?.site_quality_summary || "",
      the_one_problem:      analysis?.the_one_problem      || "",
      the_one_problem_cost: analysis?.the_one_problem_cost || "",
      the_fix:              analysis?.the_fix              || "",
      email_subject_options: analysis?.email_subject_options || [],
    },

    site: {
      // site summary from scrape/summary step
      summary:          siteSummary?.summary ?? "",
      notable:          siteSummary?.notable ?? null,
      languages:        siteSummary?.languages ?? [],
    },

    analyzed_at: new Date().toISOString(),
  };
}

function derivePriority(score) {
  const HOT  = CONFIG.SCORE?.HOT_THRESHOLD  ?? 70;
  const WARM = CONFIG.SCORE?.WARM_THRESHOLD ?? 40;
  if (score >= HOT)  return "hot";
  if (score >= WARM) return "warm";
  return "cold";
}

function buildCallPolicy(priority) {
  if (priority === "hot") {
    return {
      action: "call_first",
      note: "Call first (same day if possible). Website issues are likely costing bookings.",
    };
  }
  if (priority === "warm") {
    return {
      action: "email_then_call",
      note: "Send a short email first, then call if they reply or open twice.",
    };
  }
  return {
    action: "skip_or_recheck",
    note: "Low urgency. Skip for now or re-check in 60–90 days.",
  };
}

// Explains WHY a lead is hot/warm/cold using only facts you already have
function buildPriorityExplanation({ priority, score, analysis, siteSummary }) {
  const signals = [];

  // 1) Pull strongest concrete signals (best: the_one_problem + cost)
  if (analysis?.the_one_problem) signals.push(`One main issue: ${analysis.the_one_problem}`);
  if (analysis?.the_one_problem_cost) signals.push(`Estimated cost: ${analysis.the_one_problem_cost}`);

  // 2) Next: problems list (limit)
  const probs = Array.isArray(analysis?.problems) ? analysis.problems : [];
  probs.slice(0, 3).forEach(p => {
    if (!p) return;
    if (typeof p === "string") signals.push(p);
    else if (p.note) signals.push(p.note);
    else if (p.label) signals.push(p.label);
  });

  // 3) Quick wins (limit)
  const wins = Array.isArray(analysis?.quick_wins) ? analysis.quick_wins : [];
  wins.slice(0, 2).forEach(w => w && signals.push(`Quick win: ${w}`));

  // 4) Site summary hints (lightweight, no guessing)
  if (siteSummary) {
    if (siteSummary.has_online_booking === false) signals.push("No online booking detected in site content.");
    if (siteSummary.has_testimonials === false) signals.push("Testimonials/reviews section not obvious.");
    if ((siteSummary.services ?? []).length) signals.push(`Services found: ${(siteSummary.services ?? []).slice(0, 5).join(", ")}`);
    if (siteSummary.notable) signals.push(`Notable hook: ${siteSummary.notable}`);
  }

  // 5) If COLD and we have a compliment, add it so agents know why we’re skipping
  if (priority === "cold") {
    if (analysis?.site_quality_summary) signals.unshift(`Site looks strong: ${analysis.site_quality_summary}`);
    else signals.unshift("Site appears relatively strong (low urgency).");
  }

  // Short reason (single sentence)
  const reason =
    priority === "hot"
      ? `High website-sales opportunity (score ${score}/100): clear fixable issues likely affecting bookings.`
      : priority === "warm"
        ? `Medium opportunity (score ${score}/100): some issues worth addressing, but not urgent.`
        : `Low urgency (score ${score}/100): site is already in good shape; keep for later.`;

  return { reason, signals: dedupe(signals).slice(0, 8) };
}

function dedupe(arr) {
  const out = [];
  const seen = new Set();
  for (const x of arr || []) {
    const s = String(x).trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

// supports true/false/"unknown"/null
function normalizeTriBool(val, fallback = false) {
  if (val === true || val === false) return val;
  if (val === "unknown") return fallback;
  if (val == null) return fallback;
  return fallback;
}