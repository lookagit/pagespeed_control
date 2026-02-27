// ============================================================
// ai/enrichLead.js - Lead enrichment with focused AI calls
// ============================================================
// 10 custom Zoho fields total:
// Multi Line (5): Agent Briefing, Call Script, Cold Email Text,
//                 Website Issues, Pitch
// Single Line (5): Lead Score, Priority, Estimated Budget,
//                  Email Subject 1, Google Rating
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
// 1. AGENT BRIEFING — first thing agent reads before calling
//    → Zoho: "Agent Briefing" (Multi Line)
// ─────────────────────────────────────────────────────────────
async function genAgentBriefing({ lead, leadPack, analysis, item }) {
  const mPerf = item.pagespeed?.mobile?.categories?.performance;
  const dPerf = item.pagespeed?.desktop?.categories?.performance;
  const name  = lead.Company || lead.name;

  return await ask(`
Write a short pre-call briefing for a sales agent. Strict format, max 5 lines.

Business: ${name} | ${lead.City}, ${lead.State}
Website: ${lead.Website || lead.website_url}
Google: ${lead["Rating Google"] || lead.rating}★ (${lead["User Ratings Total Google"] || lead.user_ratings_total} reviews)
Mobile: ${mPerf}/100 | Desktop: ${dPerf}/100
Priority: ${leadPack.priority?.toUpperCase()} | Score: ${leadPack.score}/100
Top problems: ${analysis.problems.slice(0, 3).join("; ")}
What we offer: ${analysis.quick_wins.slice(0, 2).join("; ")}
Budget estimate: ${leadPack.estimated_budget}

Use exactly this format:
🏥 WHO: <one sentence about the business>
⚠️  PROBLEM: <the single biggest website/digital problem with numbers>
💡 WE OFFER: <one concrete solution>
💰 BUDGET: <estimate>
🎯 CALL GOAL: <what the agent should achieve on this call>
`, 250);
}

// ─────────────────────────────────────────────────────────────
// 2. CALL SCRIPT — 30-second opener the agent reads out loud
//    → Zoho: "Call Script" (Multi Line)
// ─────────────────────────────────────────────────────────────
async function genCallScript({ lead, leadPack, analysis }) {
  const name = lead.Company || lead.name;
  const city = lead.City || "";

  return await ask(`
Write a call script opener for a sales agent calling a dental practice.

Practice: ${name}, ${city}
Google: ${lead["Rating Google"] || lead.rating}★ (${lead["User Ratings Total Google"] || lead.user_ratings_total} reviews)
Main problem: ${analysis.problems[0]}
What we offer: ${analysis.quick_wins[0]}
Budget: ${leadPack.estimated_budget}

Write 3-4 sentences the agent says in the first 30 seconds:
- Introduction + why we're calling them specifically (genuine compliment)
- One specific problem we noticed on their site (use numbers)
- What we propose + open-ended question to start conversation

Tone: professional, not aggressive. In English. Realistic, as if talking to the owner.
`, 280);
}

// ─────────────────────────────────────────────────────────────
// 3. COLD EMAIL TEXT — ready to send, 5 sentences
//    → Zoho: "Cold Email Text" (Multi Line)
// ─────────────────────────────────────────────────────────────
async function genColdEmail({ lead, analysis, site }) {
  const name = lead.Company || lead.name;
  const city = lead.City || "";

  return await ask(`
Write a cold email for a web agency contacting a dental practice.

Business: ${name}, ${city}
Google rating: ${lead["Rating Google"] || lead.rating} (${lead["User Ratings Total Google"] || lead.user_ratings_total} reviews)
Website: ${lead.Website || lead.website_url}
Site tone: ${site.tone}
Services: ${site.services?.join(", ")}
Top 3 problems: ${analysis.problems.slice(0, 3).join(" | ")}

Write EXACTLY 5 sentences:
1. Genuine compliment about their Google rating or reputation
2. One specific technical problem on their site (include the number)
3. What the agency can do (be concrete)
4. Benefit — more patients or appointments
5. CTA — invite to a 15-min call this or next week

First line must be: SUBJECT: <best subject line, max 8 words>
Second line: ---
Then 5 sentences (no greeting, no sign-off). In English.
`, 420);
}

// ─────────────────────────────────────────────────────────────
// 4. WEBSITE ISSUES — factual summary for CRM
//    → Zoho: "Website Issues" (Multi Line)
// ─────────────────────────────────────────────────────────────
async function genWebsiteIssues({ analysis, item }) {
  const mPerf = item.pagespeed?.mobile?.categories?.performance;
  const mSeo  = item.pagespeed?.mobile?.categories?.seo;
  const hasTracking = item.signals?.tracking?.ga4 || item.signals?.tracking?.gtm;
  const hasBooking  = (item.signals?.booking?.confidence ?? 0) >= 0.8;
  const cms = item.stack?.technologies?.map(t => t.name)?.join(", ") || "unknown";

  return await ask(`
Write a factual 3-sentence summary of this website's issues for a CRM field.

Mobile performance: ${mPerf}/100
SEO score: ${mSeo}/100
Has tracking (GA4/GTM): ${hasTracking ? "Yes" : "No"}
Has online booking: ${hasBooking ? "Yes" : "No"}
CMS: ${cms}
Identified problems: ${analysis.problems.join(" | ")}

Be concise. Use numbers. Facts only. In English.
`, 160);
}

// ─────────────────────────────────────────────────────────────
// 5. PITCH — why call them + what we bring to the table
//    → Zoho: "Pitch" (Multi Line)
// ─────────────────────────────────────────────────────────────
async function genPitch({ lead, leadPack, analysis }) {
  const name = lead.Company || lead.name;

  return await ask(`
Write a 3-sentence pitch for why this dental practice is worth calling.

Business: ${name}
Google: ${lead["Rating Google"] || lead.rating}★ — ${lead["User Ratings Total Google"] || lead.user_ratings_total} reviews
Score: ${leadPack.score}/100 | Priority: ${leadPack.priority}
Main problems: ${analysis.problems.slice(0, 3).join(" | ")}
Quick wins we can offer: ${analysis.quick_wins.join(" | ")}
Budget estimate: ${leadPack.estimated_budget}

Sentence 1: Why they are a strong lead (reputation + problems = opportunity)
Sentence 2: The 2 most impactful things we can fix
Sentence 3: Expected outcome for them (more bookings, better ROI)

In English. For internal sales team use.
`, 220);
}

// ─────────────────────────────────────────────────────────────
// 6. EMAIL SUBJECTS — 3 options, best one goes to Zoho
//    → Zoho: "Email Subject 1" (Single Line) — best subject only
// ─────────────────────────────────────────────────────────────
async function genEmailSubject({ lead, analysis }) {
  const name = lead.Company || lead.name;

  const raw = await ask(`
Write the single best cold email subject line for a dental practice "${name}".
Context: ${analysis.problems[0]}
Tone: human, curious, not spammy. Not "I noticed your website..."
Max 8 words. In English. Return only the subject line, nothing else.
`, 40);

  // Parsiraj u slučaju da AI vrati numerisanu listu
  const clean = raw.replace(/^["'\d.\s-]+/, "").replace(/["']$/, "").trim();
  return clean;
}

// ─────────────────────────────────────────────────────────────
// 6. LEAD RECAP — sve key info u jednom polju (zamena za 5 single line)
//    → Zoho: "Lead Recap" (Multi Line)
//    Sadrži: Score, Priority, Budget, Google info, Site tone
// ─────────────────────────────────────────────────────────────
async function genLeadRecap({ lead, leadPack }) {
  const rating  = lead["Rating Google"] || lead.rating || "N/A";
  const reviews = lead["User Ratings Total Google"] || lead.user_ratings_total || "0";
  const maps    = lead["Maps URL"] || lead.maps_url || "";
  const website = lead.Website || lead.website_url || "";

  // Ovo ne treba AI — direktno formatiramo podatke
  return [
    `📊 SCORE: ${leadPack.score}/100`,
    `🎯 PRIORITY: ${(leadPack.priority || "").toUpperCase()}`,
    `💰 BUDGET: ${leadPack.estimated_budget || "unknown"}`,
    `⭐ GOOGLE: ${rating}★ (${reviews} reviews)`,
    `🌐 WEBSITE: ${website}`,
    `📍 MAPS: ${maps}`,
    `🎨 SITE TONE: ${leadPack.site?.tone || "unknown"}`,
    `🛒 SERVICES: ${(leadPack.site?.services || []).join(", ") || "unknown"}`,
    `📅 ANALYZED: ${leadPack.analyzed_at ? leadPack.analyzed_at.replace("T", " ").slice(0, 16) : ""}`,
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────
// ORCHESTRATOR
// ─────────────────────────────────────────────────────────────
export async function enrichLead({ leadPack, analysis, item }) {
  console.log("\n   🚀 Enrichment (6 AI calls + 1 recap)...");

  const lead = leadPack.lead;
  const site = leadPack.site;
  const enriched = {};

  const steps = [
    { key: "agent_briefing", label: "Agent briefing", fn: () => genAgentBriefing({ lead, leadPack, analysis, item }) },
    { key: "call_script",    label: "Call script",    fn: () => genCallScript({ lead, leadPack, analysis }) },
    { key: "cold_email",     label: "Cold email",     fn: () => genColdEmail({ lead, analysis, site }) },
    { key: "website_issues", label: "Website issues", fn: () => genWebsiteIssues({ analysis, item }) },
    { key: "pitch",          label: "Pitch",          fn: () => genPitch({ lead, leadPack, analysis }) },
    { key: "lead_recap",     label: "Lead recap",     fn: () => genLeadRecap({ lead, leadPack }) },
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