// ai/enrichLead.js — Australian approach (English-only) — robust inputs
import { callText } from "./strict.js";
import { buildLeadPackFromCallReport } from "./prepareEnreachInputs.js";

function str(v) { return v == null ? "" : String(v).trim(); }
function num(v, f = 0) { const n = Number(v); return Number.isFinite(n) ? n : f; }
function arr(v) { return Array.isArray(v) ? v : []; }

function parseUSCityState(address = "") {
  const parts = String(address).split(",").map(s => s.trim()).filter(Boolean);
  const city = parts[1] ?? "";
  const stateZip = parts[2] ?? "";
  const state = stateZip.split(/\s+/)[0] ?? "";
  return { city, state };
}

function calcRoi({ mPerf }) {
  const fixCost = 2500;
  const maintCost = 199;
  const lostVisitors = Math.round(200 * (0.53 - 0.09));
  const lostAppts = Math.round(lostVisitors * 0.03);
  const monthlyLost = lostAppts * 350;
  const payback = monthlyLost > 0 ? Math.ceil(fixCost / monthlyLost) : 5;
  return { fixCost, maintCost, monthlyLost, payback };
}

/**
 * Deterministic primary issue selector:
 * chooses ONE best sales angle across website + marketing/measurement + conversion.
 * Avoids AI picking random/incorrect issues.
 */
function selectPrimaryIssue(callReport, analysis) {
  // Prefer synthesis if present
  const oneProblem = str(analysis?.the_one_problem);
  const oneFix = str(analysis?.the_fix);
  const oneCost = str(analysis?.the_one_problem_cost);

  if (oneProblem) {
    return {
      problem: oneProblem,
      fix: oneFix || "Fix it in ~2 weeks without changing what already works.",
      cost: oneCost || "",
    };
  }

  // Otherwise derive from raw facts
  const v = callReport?.vitals_mobile ?? {};
  const r = callReport?.resources_mobile ?? {};
  const t = callReport?.tracking ?? {};
  const mPerf = callReport?.scores?.mobile_perf;

  if (v.fcp?.status === "poor" || v.tti?.status === "poor") {
    const fcp = v.fcp?.value ? `blank screen for ${v.fcp.value}` : "a long blank screen";
    const tti = v.tti?.value ? `buttons respond after ${v.tti.value}` : "buttons respond late";
    return {
      problem: `On phones, patients see a ${fcp} and ${tti}.`,
      fix: "Speed tune-up: reduce heavy assets, simplify scripts, and make the page responsive within ~2 weeks.",
      cost: "",
    };
  }

  if (r.page_weight?.status === "poor" || r.requests?.status === "poor") {
    const w = r.page_weight?.value ?? "a heavy page";
    const req = r.requests?.value ?? "many requests";
    return {
      problem: `On mobile, the page loads ${w} across ${req} separate files, which slows down booking intent.`,
      fix: "Performance cleanup: optimize images/assets and reduce page weight and file count in ~2 weeks.",
      cost: "",
    };
  }

  if (!t.has_ga4) {
    return {
      problem: "There’s no clear way to see how patients are finding you online (what marketing actually brings calls).",
      fix: "Measurement setup: install proper visitor analytics and call/booking attribution in ~1 week.",
      cost: "",
    };
  }

  if (!callReport?.emails?.length) {
    return {
      problem: "There’s no visible email contact for patients who prefer to message instead of calling.",
      fix: "Conversion cleanup: add a clear contact path and lightweight inquiry form in ~1 week.",
      cost: "",
    };
  }

  // Fallback
  return {
    problem: `Mobile experience could be improved (score ${mPerf ?? "unknown"}/100).`,
    fix: "Quick performance + UX pass in ~2 weeks.",
    cost: "",
  };
}

// ─────────────────────────────────────────────────────────────
// Generators (English-only)
// ─────────────────────────────────────────────────────────────

async function genColdEmail({ lead, analysis, site, item, leadPack }) {
  const name = lead.name ?? lead.Company ?? "";
  const { city, state } = parseUSCityState(item.address ?? lead.address ?? "");
  const mPerf = item.scores?.mobile_perf ?? null;
  const roi = calcRoi({ mPerf });

  const siteQuality = str(analysis?.site_quality_summary) || "Your site looks strong overall.";
  const { problem, fix, cost } = selectPrimaryIssue(item, analysis);

  // Only include $ cost if analysis explicitly provided it; otherwise keep it non-committal.
  const costLine = cost ? cost : `a conservative estimate is ~$${roi.monthlyLost}/month in missed patients`;

  return await callText({
    temperature: 0.2,
    max_tokens: 450,
    prompt: `Write a cold email to a dental practice. English only. You are a solo consultant (web + marketing + design), not an agency.

AUSTRALIAN APPROACH (4 sentences total, under 80 words):
S1: Genuine compliment + the ONE issue (with a number if available).
S2: Credibility without fake proof: "We've fixed similar issues for other dental practices in ${state || "your area"}" — NO clinic names, NO invented results.
S3: Offer a free 1-page PDF audit (theirs to keep).
S4: Micro CTA: "Want me to send it?" (yes/no). No call ask.

STRICT RULES:
- Use only the facts below. If unclear, do not invent.
- No jargon words: SEO, analytics, pixel, GTM, tag manager, Core Web Vitals, schema, canonical.
- One issue only (do not list multiple).

FACTS:
Practice: ${name}, ${city}${state ? `, ${state}` : ""}
Website: ${item.website_url}
What’s good: ${siteQuality}
Primary issue: ${problem}
What it may cost: ${costLine}
Fix + timeline: ${fix}
Mobile score (context): ${mPerf ?? "unknown"}/100
Offer: Free PDF audit + optional $${roi.fixCost} fix + $${roi.maintCost}/mo maintenance
Priority: ${String(leadPack?.priority || "").toUpperCase()} | Score: ${leadPack?.score ?? "n/a"}/100

SUBJECT RULES:
- Under 40 characters
- Include a number
- No question mark
- Avoid "I noticed"

OUTPUT ONLY:
SUBJECT: <subject>
---
<4 sentences, under 80 words>`,
  });
}

async function genCallScript({ lead, analysis, item, leadPack }) {
  const name = lead.name ?? lead.Company ?? "";
  const { city, state } = parseUSCityState(item.address ?? "");
  const { problem, fix, cost } = selectPrimaryIssue(item, analysis);

  return await callText({
    temperature: 0.2,
    max_tokens: 220,
    prompt: `Write a short call script (max 4 sentences) for a sales rep calling a dental practice. English only.

Rules:
- Start with a specific compliment.
- Mention ONE issue in patient language (include a number if available).
- Offer a fix + timeline (no price).
- End with ONE open question.
- No jargon.

Facts:
Practice: ${name}, ${city}${state ? `, ${state}` : ""}
What’s good: ${str(analysis?.site_quality_summary) || "Site looks strong overall."}
One issue: ${problem}
Cost (if known): ${cost || "unclear"}
Fix: ${fix}
Priority: ${leadPack.priority} | Score: ${leadPack.score}/100

Output only the script.`,
  });
}

async function genAgentBriefing({ lead, analysis, item, leadPack }) {
  const name = lead.name ?? lead.Company ?? "";
  const { problem, fix, cost } = selectPrimaryIssue(item, analysis);

  return await callText({
    temperature: 0.2,
    max_tokens: 220,
    prompt: `Write a compact agent briefing (max 5 lines). English only.
Format exactly:
🏥 WHO: <1 sentence compliment>
⚠️  ISSUE: <1 issue in patient terms, include number if possible>
💡 FIX: <what we do + timeline>
💰 BUDGET: <estimate or "unknown">
🎯 GOAL: <what the agent should confirm>

Facts:
Practice: ${name}
Mobile: ${item.scores?.mobile_perf ?? "N/A"}/100 | Desktop: ${item.scores?.desktop_perf ?? "N/A"}/100
Priority: ${leadPack.priority.toUpperCase()} | Score: ${leadPack.score}/100
What’s good: ${str(analysis?.site_quality_summary) || "Site looks strong overall."}
One issue: ${problem}
Cost: ${cost || "unclear"}
Fix: ${fix}
Budget estimate: ${leadPack.estimated_budget || "unknown"}`,
  });
}

async function genWebsiteIssues({ analysis, item }) {
  const mPerf = item.scores?.mobile_perf ?? "N/A";
  const mSeo = item.scores?.mobile_seo ?? "N/A";
  const { problem } = selectPrimaryIssue(item, analysis);

  return await callText({
    temperature: 0.2,
    max_tokens: 150,
    prompt: `Write exactly 3 sentences for a CRM note about this dental website. English only.

Rules:
- Dentist language, patient impact.
- No jargon.
- If 2 things are strong, say they are strong. Then mention ONE opportunity.

Facts:
Mobile score: ${mPerf}/100
SEO score: ${mSeo}/100
One opportunity: ${problem}

Output: exactly 3 sentences.`,
  });
}

async function genPitch({ lead, analysis, leadPack, item }) {
  const name = lead.name ?? lead.Company ?? "";
  const { problem, fix, cost } = selectPrimaryIssue(item, analysis);

  // Internal pitch CAN mention service categories (marketing/design/web) but still keep it crisp.
  return await callText({
    temperature: 0.2,
    max_tokens: 200,
    prompt: `Write a 3-sentence INTERNAL sales pitch for the team. English only.

Goal: sell a package that can include web improvements, design/UX, and marketing measurement (as needed).
Be honest if the site is good; frame as opportunity.

Facts:
Practice: ${name}
Priority: ${leadPack.priority} | Score: ${leadPack.score}/100
Website: ${item.website_url}
Mobile perf: ${item.scores?.mobile_perf ?? "N/A"}/100 | Desktop perf: ${item.scores?.desktop_perf ?? "N/A"}/100
One opportunity: ${problem}
Cost: ${cost || "unclear"}
Fix: ${fix}

S1: Why this is a real opportunity (honest)
S2: What we do + timeline
S3: Expected patient/lead outcome (conservative)

Output only the pitch.`,
  });
}

function genLeadRecap({ lead, leadPack, item }) {
  const mPerf = item.scores?.mobile_perf ?? null;
  const roi = calcRoi({ mPerf });

  const orig = item._originalLead ?? lead ?? {};
  const rating = orig?.rating ?? null;
  const reviews = orig?.user_ratings_total ?? null;
  const mapsUrl = orig?.maps_url ?? "";

  return [
    `SCORE:         ${leadPack.score}/100`,
    `PRIORITY:      ${String(leadPack.priority || "").toUpperCase()}`,
    `BUDGET:        ${leadPack.estimated_budget || "unknown"}`,
    `HEALTH:        ${item.health_score ?? "N/A"}/100 (${item.health_grade ?? "?"})`,
    `MOBILE PERF:   ${item.scores?.mobile_perf ?? "N/A"}/100`,
    `DESKTOP PERF:  ${item.scores?.desktop_perf ?? "N/A"}/100`,
    `ROI (proxy):   ~$${roi.monthlyLost}/month | Payback ~${roi.payback} mo`,
    rating ? `GOOGLE:        ${rating}★ (${reviews ?? "?"} reviews)` : "GOOGLE:        N/A",
    mapsUrl ? `MAPS:          ${mapsUrl}` : null,
    `WEBSITE:       ${item.website_url ?? lead.website_url ?? "N/A"}`,
    `ADDRESS:       ${item.address ?? "N/A"}`,
    `SITE TONE:     ${leadPack.site?.tone || "unknown"}`,
    `SERVICES:      ${(leadPack.site?.services || []).join(", ") || "unknown"}`,
    `ANALYZED:      ${leadPack.analyzed_at ? leadPack.analyzed_at.replace("T", " ").slice(0, 16) : ""}`,
  ].filter(Boolean).join("\n");
}

// ─────────────────────────────────────────────────────────────
// ORCHESTRATOR (safe even if leadPack is missing)
// ─────────────────────────────────────────────────────────────
export async function enrichLead({ leadPack, analysis, item, siteSummary = null }) {
  // If you accidentally call enrichLead({ item: callReport, analysis }), we recover:
  if (!leadPack || typeof leadPack !== "object") {
    if (!item) throw new Error("enrichLead() requires either leadPack or item (callReport).");
    leadPack = buildLeadPackFromCallReport({ callReport: item, analysis, siteSummary });
  }
  if (!item) {
    // If someone passed leadPack only, try to use leadPack.lead as item fallback
    item = leadPack.lead ?? {};
  }

  const lead = leadPack.lead;
  const site = leadPack.site;

  const enriched = {};
  enriched.lead_recap = genLeadRecap({ lead, leadPack, item });

  const steps = [
    { key: "cold_email", label: "Cold email", fn: () => genColdEmail({ lead, analysis, site, item, leadPack }) },
    { key: "call_script", label: "Call script", fn: () => genCallScript({ lead, analysis, item, leadPack }) },
    { key: "agent_briefing", label: "Agent briefing", fn: () => genAgentBriefing({ lead, analysis, item, leadPack }) },
    { key: "website_issues", label: "Website issues", fn: () => genWebsiteIssues({ analysis, item }) },
    { key: "pitch", label: "Pitch", fn: () => genPitch({ lead, analysis, leadPack, item }) },
  ];

  for (const step of steps) {
    try {
      enriched[step.key] = await step.fn();
    } catch (err) {
      enriched[step.key] = null;
    }
  }

  return {
    lead,
    score: leadPack.score,
    priority: leadPack.priority,
    estimated_budget: leadPack.estimated_budget,
    analyzed_at: leadPack.analyzed_at,
    analysis: leadPack.analysis,
    site: leadPack.site,
    enriched,
  };
}