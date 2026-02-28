// ============================================================
// ai/enrichLead.js
// ============================================================
// Email strategija bazirana na istraživanju:
//
// ✅ Pod 80 reči (Instantly 2026: elite senders = 2-4x reply rate)
// ✅ Timeline hook, ne problem hook (2.3x više reply-a vs problem)
// ✅ Loss aversion opener (2.5x jači od gain framinga)
// ✅ 3. razred čitljivosti (36% više odgovora)
// ✅ Jedan CTA, binary YES/NO (micro-commitment princip)
// ✅ Nema "I noticed", nema pozdrava, nema potpisa
// ✅ Solo founder persona, ne agencija
// ✅ Free PDF audit = reciprocity trigger
// ✅ Case study = social proof (6.53% reply rate samo od social proof)
// ✅ Konzervativni realni ROI (Google CWV data)
//
// Cilj: 10%+ reply rate (top 10% senders benchmark)
// ============================================================

import OpenAI from "openai";
import { CONFIG } from "../config.js";

const deepseek = new OpenAI({
  apiKey:  CONFIG.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com",
});

async function ask(prompt, maxTokens = 350) {
  const res = await deepseek.chat.completions.create({
    model:       "deepseek-chat",
    temperature: 0.4,
    max_tokens:  maxTokens,
    messages:    [{ role: "user", content: prompt }],
  });
  return res.choices[0]?.message?.content?.trim() ?? "";
}

// ─────────────────────────────────────────────────────────────
// ROI HELPER — Google CWV istraživanje, konzervativni brojevi
// Slow LCP (>2.5s) → 53% bounce vs 9% za brz sajt
// ─────────────────────────────────────────────────────────────
function calcRoi({ mPerf }) {
  const visitors     = 200;
  const slowBounce   = 0.53;
  const fastBounce   = 0.09;
  const conv         = 0.03;
  const apptValue    = 350;
  const fixCost      = 2500;
  const maintCost    = 199;

  const lostVisitors  = Math.round(visitors * (slowBounce - fastBounce));
  const lostAppts     = Math.round(lostVisitors * conv);
  const monthlyLost   = lostAppts * apptValue;
  const payback       = monthlyLost > 0 ? Math.ceil(fixCost / monthlyLost) : 5;

  return { visitors, lostVisitors, lostAppts, monthlyLost, fixCost, maintCost, payback };
}

// ─────────────────────────────────────────────────────────────
// 1. AGENT BRIEFING → Zoho: "Agent Briefing"
// ─────────────────────────────────────────────────────────────
async function genAgentBriefing({ lead, leadPack, analysis, item }) {
  const mPerf = item.scores?.mobile_perf  ?? "N/A";
  const dPerf = item.scores?.desktop_perf ?? "N/A";
  const name  = lead.name ?? lead.Company;

  return await ask(`
Write a short pre-call briefing for a sales agent. Max 5 lines.

Business: ${name} | ${item.address ?? ""}
Website: ${item.website_url ?? lead.website_url}
Mobile: ${mPerf}/100 | Desktop: ${dPerf}/100
Priority: ${leadPack.priority?.toUpperCase()} | Score: ${leadPack.score}/100
Top problems: ${analysis.problems.slice(0, 3).join("; ")}
Quick wins: ${analysis.quick_wins.slice(0, 2).join("; ")}
Budget: ${leadPack.estimated_budget}

Exact format:
 WHO: <one sentence>
 PROBLEM: <biggest issue with numbers>
 WE OFFER: <one concrete solution>
 BUDGET: <estimate>
 CALL GOAL: <what to achieve>
`, 250);
}

// ─────────────────────────────────────────────────────────────
// 2. CALL SCRIPT → Zoho: "Call Script"
// ─────────────────────────────────────────────────────────────
async function genCallScript({ lead, leadPack, analysis, item }) {
  const name = lead.name ?? lead.Company;
  const city = item.address?.split(",")?.[1]?.trim() ?? "";

  return await ask(`
Write a 30-second cold call opener for a dental practice.

Practice: ${name}, ${city}
Main problem: ${analysis.problems[0]}
Our offer: ${analysis.quick_wins[0]}
Budget: ${leadPack.estimated_budget}

3-4 sentences:
- Who you are + specific reason you're calling this practice
- One problem found on their site (with a number)
- What you offer + open question

Tone: peer-to-peer, not salesy. English.
`, 280);
}

// ─────────────────────────────────────────────────────────────
// 3. COLD EMAIL → Zoho: "Cold Email Text"
//
// NAUČNO OPTIMIZOVANO:
// • Pod 80 reči (elite sender benchmark)
// • Timeline hook (2.3x > problem hook)
// • Loss aversion u S1 (2.5x jači od gain)
// • Social proof case study u S2
// • Reciprocity: besplatni PDF audit
// • Micro-commitment CTA (binary YES/NO)
// • 3. razred čitljivosti (36% više odgovora)
// • Solo founder, nema "we"
// ─────────────────────────────────────────────────────────────
async function genColdEmail({ lead, analysis, site, item }) {
  const name   = lead.name ?? lead.Company ?? "";
  const city   = item.address?.split(",")?.[1]?.trim() ?? "";
  const state  = item.address?.split(",")?.[2]?.trim()?.split(" ")?.[1] ?? "";
  const mPerf  = item.scores?.mobile_perf  ?? null;
  const dPerf  = item.scores?.desktop_perf ?? null;
  const hasGa4 = item.tracking?.has_ga4        ?? false;
  const hasGtm = item.tracking?.has_gtm        ?? false;
  const hasPix = item.tracking?.has_meta_pixel ?? false;
  const vitals = item.vitals_mobile ?? {};

  // Najgori vital — hook broj
  const priorityVitals = ["tbt", "tti", "lcp", "fcp"];
  const worstVital     = priorityVitals
    .map(k => vitals[k] ? { key: k.toUpperCase(), ...vitals[k] } : null)
    .find(v => v?.status === "poor") ?? null;

  const lcp = vitals.lcp?.value ?? null;

  // Tracking gap — konkretan problem koji dentisti razumeju
  const blindspot = !hasGa4 && !hasGtm
    ? "no analytics — they can't see how many people visit and leave"
    : !hasPix
    ? "no Meta Pixel — visitors who don't call are gone forever, no retargeting"
    : null;

  const services = site.services?.slice(0, 2).join(" and ") || "dentistry";
  const roi      = calcRoi({ mPerf });

  // Koliko brzo možemo popraviti — timeline hook
  const fixTimeline = "2 weeks";
  const resultTimeline = "60 days";

  return await ask(`
You are writing a cold email as a SOLO web developer — one person, not an agency.
You audit dental websites and fix them. That is your entire business.

YOUR OFFER:
- Free PDF audit (they keep it, no obligation)
- Flat $${roi.fixCost} to fix + $${roi.maintCost}/month to maintain
- No retainer. No contract. No sales call needed.

PSYCHOLOGICAL FRAMEWORK (follow this exactly — it's based on research):

1. TIMELINE HOOK (not problem hook — 2.3x higher reply rate):
   Don't say "you have a problem." Say "I can fix X in Y weeks."
   Research shows timeline framing outperforms problem framing 2.3x.
   Example: "I can get ${name} from ${mPerf ?? 65}/100 to 90+ in ${fixTimeline}."

2. LOSS AVERSION (2.5x stronger than gain framing):
   Frame what they're LOSING NOW, not what they'll gain.
   Use the dollar number: ~$${roi.monthlyLost}/month in missed patients.
   People feel pain of loss 2.5x more than pleasure of gain.

3. SOCIAL PROOF CASE STUDY (raises credibility, 53% positive reply rate):
   One sentence. Similar practice, same region, specific result.
   Example: "A ${services} practice in ${state} went from similar scores to 9 new patients/month in ${resultTimeline}."

4. RECIPROCITY (free audit = obligation to respond):
   Offer the PDF audit free. No strings. They keep it regardless.
   This creates psychological obligation to at least reply.

5. MICRO-COMMITMENT CTA (lowest friction possible):
   "Want me to send it?" = binary YES/NO
   Research: interest-based CTAs have 30% success rate vs 15% for meeting requests.
   NEVER ask for a call, demo, or meeting in the first email.

THEIR DATA (use exact numbers):
Practice: ${name} | ${city}, ${state}
Mobile score: ${mPerf ?? "unknown"}/100
Desktop score: ${dPerf ?? "unknown"}/100
LCP: ${lcp ?? "unknown"} ${lcp ? "(good = under 2.5s)" : ""}
Worst vital: ${worstVital ? `${worstVital.key} at ${worstVital.value}` : "data unavailable"}
Analytics: ${hasGa4 || hasGtm ? "OK" : "NONE — completely blind"}
Meta Pixel: ${hasPix ? "OK" : "missing"}
Blind spot: ${blindspot ?? "tracking looks fine"}
Monthly revenue lost to slow site: ~$${roi.monthlyLost} (Google CWV research)
Fix timeline: ${fixTimeline} | Results visible: ${resultTimeline}
Services: ${services}

STRICT RULES:
- UNDER 80 WORDS TOTAL (this is non-negotiable — elite senders use <80 words)
- Write at 3rd-grade reading level (short words, short sentences)
- NO greeting, NO sign-off
- NO "I noticed", NO "I came across", NO "I hope"
- NO "we" — you are ONE person
- Every sentence = one idea, one number
- End with YES/NO question only
- Sound like a text from a smart friend, not a marketing email

STRUCTURE (4 sentences max — brevity is the goal):
S1: Timeline hook + loss number (what they're losing + how fast you can fix it)
S2: Case study OR specific blind spot (one line, one fact)
S3: Free PDF offer (reciprocity trigger)
S4: Binary CTA ("Want me to send it?")

OUTPUT — return ONLY this:
SUBJECT: <subject line>
---
<4 sentences, under 80 words>

SUBJECT LINE:
- Under 40 characters (37% higher open rate with short + number)
- Loss framing or timeline framing — NOT curiosity gap
- Must include a number
- No question marks, no "I noticed"
- Examples: "$${roi.monthlyLost}/mo — ${name}" or "${mPerf}/100 → 90 in 2 weeks" or "Fixed in ${fixTimeline}: ${name}"

English. Brutally short. Every word earns its place.
`, 500);
}

// ─────────────────────────────────────────────────────────────
// 4. WEBSITE ISSUES → Zoho: "Website Issues"
// ─────────────────────────────────────────────────────────────
async function genWebsiteIssues({ analysis, item }) {
  const mPerf       = item.scores?.mobile_perf ?? "N/A";
  const mSeo        = item.scores?.mobile_seo  ?? "N/A";
  const hasTracking = item.tracking?.has_ga4 || item.tracking?.has_gtm;
  const hasBooking  = item.has_online_booking ?? false;
  const cms         = item.tech_stack?.map(t => t.name)?.join(", ") || "unknown";

  return await ask(`
Write a factual 3-sentence CRM summary of this website's issues.

Mobile: ${mPerf}/100 | SEO: ${mSeo}/100
Analytics: ${hasTracking ? "Yes" : "No"} | Booking: ${hasBooking ? "Yes" : "No"}
Stack: ${cms}
Problems: ${analysis.problems.join(" | ")}

Facts only. Numbers only. English.
`, 160);
}

// ─────────────────────────────────────────────────────────────
// 5. PITCH → Zoho: "Pitch"
// ─────────────────────────────────────────────────────────────
async function genPitch({ lead, leadPack, analysis }) {
  const name = lead.name ?? lead.Company;

  return await ask(`
Write a 3-sentence internal pitch for why this dental practice is worth contacting.

Business: ${name} | Score: ${leadPack.score}/100 | Priority: ${leadPack.priority}
Problems: ${analysis.problems.slice(0, 3).join(" | ")}
Quick wins: ${analysis.quick_wins.join(" | ")}
Budget: ${leadPack.estimated_budget}

S1: Why strong lead (problems = opportunity)
S2: Top 2 things we fix
S3: Expected outcome (ROI)

English. Internal use only.
`, 220);
}

// ─────────────────────────────────────────────────────────────
// 6. EMAIL SUBJECT — 3 angla, AI bira pobednika
//    → Zoho: "Email Subject 1"
//
// Naučno: subject pod 40 karaktera + broj = 37% više otvaranja
// Loss framing i timeline framing > curiosity za dentiste
// ─────────────────────────────────────────────────────────────
async function genEmailSubject({ lead, analysis, item }) {
  const name   = lead.name ?? lead.Company ?? "";
  const city   = item.address?.split(",")?.[1]?.trim() ?? "";
  const mPerf  = item.scores?.mobile_perf  ?? null;
  const vitals = item.vitals_mobile ?? {};
  const lcp    = vitals.lcp?.value ?? null;
  const roi    = calcRoi({ mPerf });

  const raw = await ask(`
Write 3 cold email subject lines for a dental practice. Then pick the best.

Practice: "${name}" | ${city}
Mobile score: ${mPerf ?? "unknown"}/100
LCP: ${lcp ?? "unknown"}
Monthly revenue at risk: ~$${roi.monthlyLost}
Fix time: 2 weeks

RESEARCH RULES (based on 85M+ email analysis):
- Under 40 characters = 37% higher open rate
- Numbers in subject = 113% higher open rate
- Loss framing > curiosity for B2B small business owners
- Timeline framing = 2.3x higher reply rate
- No question marks

3 ANGLES:

ANGLE 1 — LOSS + NUMBER (under 40 chars):
Dollar amount they're losing. Specific. Hurts to read.
Example: "$${roi.monthlyLost}/mo — ${name}"

ANGLE 2 — TIMELINE + SCORE (under 40 chars):
How fast you can fix it. Their exact score.
Example: "${mPerf}/100 → 90 in 2 weeks"

ANGLE 3 — SPECIFICITY (under 40 chars):
Their worst metric. Feels handwritten.
Example: "LCP ${lcp ?? "4.5s"} — fixable this month"

Return ONLY:
1: <subject>
2: <subject>
3: <subject>
BEST: <1, 2, or 3>
`, 120);

  const lines    = raw.split("\n").map(l => l.trim()).filter(Boolean);
  const subjects = {};
  for (const line of lines) {
    const m = line.match(/^([123]):\s*(.+)$/);
    if (m) subjects[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
  const bestLine = lines.find(l => /^BEST:/i.test(l));
  const bestNum  = bestLine?.match(/BEST:\s*([123])/i)?.[1] ?? "1";

  return subjects[bestNum] ?? subjects["1"] ?? "";
}

// ─────────────────────────────────────────────────────────────
// 7. LEAD RECAP → Zoho: "Lead Recap"
// ─────────────────────────────────────────────────────────────
async function genLeadRecap({ lead, leadPack, item }) {
  const website = item.website_url ?? lead.website_url ?? "";
  const mPerf   = item.scores?.mobile_perf  ?? "N/A";
  const dPerf   = item.scores?.desktop_perf ?? "N/A";
  const temp    = item.lead_temperature?.label ?? "N/A";
  const roi     = calcRoi({ mPerf: item.scores?.mobile_perf });

  return [
    `SCORE: ${leadPack.score}/100`,
    `PRIORITY: ${(leadPack.priority || "").toUpperCase()}`,
    `BUDGET: ${leadPack.estimated_budget || "unknown"}`,
    `HEALTH: ${item.health_score ?? "N/A"}/100 (${item.health_grade ?? "?"})`,
    `TEMP: ${temp}`,
    `MOBILE PERF: ${mPerf}/100`,
    `DESKTOP PERF: ${dPerf}/100`,
    `MONTHLY LOST: ~$${roi.monthlyLost}`,
    `PAYBACK: ${roi.payback} month${roi.payback !== 1 ? "s" : ""}`,
    `FIX COST: $${roi.fixCost} + $${roi.maintCost}/mo`,
    `WEBSITE: ${website}`,
    `ADDRESS: ${item.address ?? "N/A"}`,
    `SITE TONE: ${leadPack.site?.tone || "unknown"}`,
    `SERVICES: ${(leadPack.site?.services || []).join(", ") || "unknown"}`,
    `ANALYZED: ${leadPack.analyzed_at ? leadPack.analyzed_at.replace("T", " ").slice(0, 16) : ""}`,
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────
// ORCHESTRATOR
// ─────────────────────────────────────────────────────────────
export async function enrichLead({ leadPack, analysis, item }) {
  console.log("\n   🚀 Enrichment (7 AI calls + 1 recap)...");

  const lead = leadPack.lead;
  const site = leadPack.site;
  const enriched = {};

  const steps = [
    { key: "agent_briefing", label: "Agent briefing", fn: () => genAgentBriefing({ lead, leadPack, analysis, item }) },
    { key: "call_script",    label: "Call script",    fn: () => genCallScript({ lead, leadPack, analysis, item }) },
    { key: "cold_email",     label: "Cold email",     fn: () => genColdEmail({ lead, analysis, site, item }) },
    { key: "website_issues", label: "Website issues", fn: () => genWebsiteIssues({ analysis, item }) },
    { key: "pitch",          label: "Pitch",          fn: () => genPitch({ lead, leadPack, analysis }) },
    { key: "email_subject",  label: "Email subject",  fn: () => genEmailSubject({ lead, analysis, item }) },
    { key: "lead_recap",     label: "Lead recap",     fn: () => genLeadRecap({ lead, leadPack, item }) },
  ];

  for (const step of steps) {
    try {
      console.log(`   ⏳ ${step.label}...`);
      enriched[step.key] = await step.fn();
      console.log(`   ✅ ${step.label} done`);
    } catch (err) {
      console.log(`   ⚠️  ${step.label} failed: ${err.message}`);
      enriched[step.key] = null;
    }
  }

  return {
    lead,
    score:            leadPack.score,
    priority:         leadPack.priority,
    estimated_budget: leadPack.estimated_budget,
    analyzed_at:      leadPack.analyzed_at,
    analysis:         leadPack.analysis,
    site:             leadPack.site,
    enriched,
  };
}