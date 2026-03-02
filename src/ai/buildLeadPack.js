// ============================================================
// ai/buildLeadPack.js - Sastavlja finalni lead pack
// ============================================================

import { CONFIG } from "../config.js";

export async function buildLeadPack({ lead, analysis, siteSummary }) {
  const score    = analysis?.score ?? 0;
  const priority = analysis?.priority ?? derivePriority(score);

  return {
    // ── ORIGINALNI LEAD — netaknut, direktno iz Stage 1 ─────
    lead,

    // ── SKORING ─────────────────────────────────────────────
    score,
    priority,
    estimated_budget: analysis?.estimated_budget_range || "",

    // ── AI ANALIZA ───────────────────────────────────────────
    analysis: {
      summary:         analysis?.summary    || "",
      pitch:           analysis?.pitch      || "",
      problems:        analysis?.problems   || [],
      quick_wins:      analysis?.quick_wins || [],
      red_flags:       analysis?.red_flags  || [],
      pre_score:       analysis?.pre_score  ?? 0,
      pre_score_reasons: analysis?.pre_score_reasons || [],
    },

    // ── SITE SUMMARY ─────────────────────────────────────────
    site: {
      summary:          siteSummary?.summary            || "",
      services:         siteSummary?.services           || [],
      tone:             siteSummary?.tone               || "",
      has_booking:      siteSummary?.has_online_booking ?? false,
      has_testimonials: siteSummary?.has_testimonials   ?? false,
    },

    // ── META ─────────────────────────────────────────────────
    analyzed_at: new Date().toISOString(),
  };
}

function derivePriority(score) {
  if (score >= CONFIG.SCORE.HOT_THRESHOLD)  return "hot";
  if (score >= CONFIG.SCORE.WARM_THRESHOLD) return "warm";
  return "cold";
}