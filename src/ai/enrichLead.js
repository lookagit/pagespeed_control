// ============================================================
// ai/enrichLead.js — CRM Field Generator + Sales Intelligence
// ============================================================
//
// SINGLE SOURCE OF TRUTH: buildFactSheet(signalReport, analysis)
// All generators read from F (factSheet). No independent reads.
//
// Google Places phone is ALWAYS primary (authoritative source).
// Crawler phones are secondary. CSV phone is last resort.
//
// AI calls:      2  -> cold_email, agent_briefing
// Deterministic: 4  -> call_script, website_issues, pitch, lead_recap
// Sales intel:   0  -> no AI cost, from sales_intelligence.js
// ============================================================

import { callText } from "./strict.js";
import {
  buildOutreachSequence,
  buildObjectionMap,
  buildSubjectLineMatrix,
  buildCompetitorContext,
  buildSeasonalAngle,
} from "./sales_intelligence.js";

// ─────────────────────────────────────────────────────────────
// FACT SHEET — single verified fact object
// Built from signalReport + analysis._passes.
// EVERY generator reads exclusively from this object.
// ─────────────────────────────────────────────────────────────

export function buildFactSheet(signalReport, analysis) {
  const meta   = signalReport?.meta   ?? {};
  const scores = signalReport?.scores ?? {};
  const orig   = signalReport?._originalLead ?? {};

  // Contact from signalReport (crawler-normalised)
  const contact = signalReport?.contact ?? {};
  const crawlerPhones = Array.isArray(contact.phones) ? contact.phones : [];
  const crawlerEmails = Array.isArray(contact.emails) ? contact.emails : [];

  const booking         = signalReport?.booking ?? {};
  const trackingPresent = signalReport?.tracking?.present ?? [];
  const trackingMissing = signalReport?.tracking?.missing ?? [];

  // AI pass verdicts (verbatim from AI, same data AI saw)
  const passes = analysis?._passes ?? {};
  const speed  = passes.speed      ?? {};
  const seo    = passes.seo        ?? {};
  const conv   = passes.conversion ?? {};

  const monthlyLost = Math.round(200 * (0.53 - 0.09) * 0.03 * 350);

  return {
    name:        meta.name        ?? orig.name        ?? "",
    url:         meta.url         ?? orig.website_url ?? "",
    address:     meta.address     ?? orig.address     ?? "",
    mPerf:       scores.mobile_perf  ?? null,
    dPerf:       scores.desktop_perf ?? null,
    health:      meta.health ?? null,
    grade:       meta.grade  ?? null,
    rating:      orig.rating             ?? null,
    reviewCount: orig.user_ratings_total ?? null,
    mapsUrl:     orig.maps_url           ?? null,

    // Crawler-found contacts (secondary to Google Places)
    crawlerPhones,
    crawlerEmails,
    hasEmailOnSite: crawlerEmails.length > 0,

    // Booking and tracking
    hasBooking:    booking.has_booking === true,
    bookingVendor: booking.vendor ?? null,
    trackingPresent,
    trackingMissing,
    hasGA4:       trackingPresent.includes("GA4"),
    hasGTM:       trackingPresent.includes("GTM"),
    hasMeta:      trackingPresent.includes("Meta Pixel"),
    hasGoogleAds: trackingPresent.includes("Google Ads pixel"),
    hasChatbot:   signalReport?.status?.chatbot?.ok === true,

    // AI verdicts (verbatim)
    speedVerdict:  speed.speed_verdict           ?? null,
    speedImpact:   speed.patient_impact          ?? null,
    seoVerdict:    seo.seo_verdict               ?? null,
    seoProblem:    seo.biggest_seo_problem       ?? null,
    convVerdict:   conv.conversion_verdict       ?? null,
    friction:      conv.biggest_friction         ?? null,
    afterHours:    conv.after_hours_situation    ?? null,
    adMeasurement: conv.ad_measurement_situation ?? null,
    convQuickWin:  conv.quick_win                ?? null,

    // Synthesis
    oneProblem:  (analysis?.the_one_problem      ?? "").trim(),
    oneCost:     (analysis?.the_one_problem_cost ?? "").trim(),
    theFix:      (analysis?.the_fix              ?? "").trim(),
    siteQuality: (analysis?.site_quality_summary ?? "").trim(),
    subjects:    analysis?.email_subject_options ?? [],

    // ROI
    fixCost:     2500,
    maintCost:   199,
    monthlyLost,
    payback:     monthlyLost > 0 ? Math.ceil(2500 / monthlyLost) : 5,
  };
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function parseUSCityState(address) {
  const parts = String(address || "").split(",").map(s => s.trim()).filter(Boolean);
  return { city: parts[1] ?? "", state: (parts[2] ?? "").split(/\s+/)[0] ?? "" };
}

function cap(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : str;
}

// ─────────────────────────────────────────────────────────────
// 1. COLD EMAIL  (AI)
// Australian: 4 sentences, 80 words. Google phone injected.
// ─────────────────────────────────────────────────────────────

async function genColdEmail(F, leadPack, resolvedContacts) {
  const { state }  = parseUSCityState(F.address);
  const costLine   = F.oneCost || ("roughly $" + F.monthlyLost + "/month in missed patients");
  const googlePhone = resolvedContacts?.phones?.primary ?? null;
  const subjectHint = F.subjects.length
    ? "\nSubject ideas (adapt, don't copy):\n" + F.subjects.slice(0, 3).map(s => "  - " + s).join("\n")
    : "";

  const contactFacts = [
    googlePhone
      ? "Phone (Google verified): " + googlePhone
      : "Phone: not available from Google",
    F.hasEmailOnSite ? "Email: found on site" : "Email: not found on site",
    F.hasBooking
      ? "Online booking: yes" + (F.bookingVendor ? " via " + F.bookingVendor : "")
      : "Online booking: not detected",
    F.hasGA4 ? "Analytics: installed" : "Analytics: not installed",
  ].join("\n");

  return await callText({
    temperature: 0.2,
    max_tokens:  450,
    prompt: "Write a cold email to a dental practice. Solo web+marketing consultant, not an agency. English.\n\n"
      + "STRUCTURE — exactly 4 sentences, under 80 words total:\n"
      + "S1: Genuine compliment + the ONE issue with a number.\n"
      + "S2: \"We have helped similar dental practices in " + (state || "your area") + " fix this.\" No invented names or results.\n"
      + "S3: \"I put together a short 1-page PDF audit — yours to keep regardless.\"\n"
      + "S4: \"Want me to send it?\" — yes/no only. No call ask. No demo ask.\n\n"
      + "NON-NEGOTIABLE:\n"
      + "- Use ONLY facts below. Null/not-detected -> omit silently.\n"
      + "- No jargon: no SEO, analytics, pixel, GTM, Core Web Vitals, schema, canonical, bounce rate.\n"
      + "- ONE issue only. Never list multiple problems.\n"
      + "- If site is genuinely strong — say so. Do not fake urgency.\n\n"
      + "VERIFIED FACTS:\n"
      + "Practice: " + F.name + (F.address ? ", " + F.address.split(",").slice(1, 3).join(",") : "") + "\n"
      + "Website: " + F.url + "\n"
      + "Site quality: " + (F.siteQuality || "not assessed") + "\n"
      + "Primary issue: " + (F.oneProblem || "not identified") + "\n"
      + "Cost to practice: " + costLine + "\n"
      + "Fix + timeline: " + (F.theFix || "not specified") + "\n"
      + "Mobile score: " + (F.mPerf != null ? F.mPerf + "/100" : "not available") + "\n"
      + "Speed verdict: " + (F.speedVerdict || "N/A") + "\n"
      + "Conversion verdict: " + (F.convVerdict || "N/A") + "\n"
      + contactFacts + "\n"
      + "Budget: " + (leadPack.estimated_budget || "TBD") + "\n"
      + subjectHint + "\n\n"
      + "SUBJECT LINE: under 40 chars, include a number, no question mark, avoid 'I noticed'\n\n"
      + "OUTPUT (nothing else):\n"
      + "SUBJECT: <subject>\n"
      + "---\n"
      + "<4 sentences, under 80 words>",
  });
}

// ─────────────────────────────────────────────────────────────
// 2. AGENT BRIEFING  (AI)
// Google phone shown with source label.
// ─────────────────────────────────────────────────────────────

async function genAgentBriefing(F, leadPack, resolvedContacts) {
  const phone  = resolvedContacts?.phones?.primary ?? null;
  const src    = resolvedContacts?.phones?.primary_source ?? null;
  const conf   = resolvedContacts?.phones?.primary_confidence ?? null;

  const contactLine = [
    phone
      ? "phone: " + phone + " [" + (src ?? "?") + (conf ? ", " + Math.round(conf * 100) + "% conf" : "") + "]"
      : "no phone resolved",
    F.hasEmailOnSite ? "email: found on site" : "no email on site",
    F.hasBooking
      ? "booking: yes" + (F.bookingVendor ? " (" + F.bookingVendor + ")" : "")
      : "no online booking",
  ].join("  |  ");

  return await callText({
    temperature: 0.2,
    max_tokens:  250,
    prompt: "Write a pre-call agent briefing. English only. Exactly 5 lines. Copy emoji format exactly.\n\n"
      + "FORMAT:\n"
      + "WHO: <what makes this practice notable + genuine compliment>\n"
      + "ISSUE: <the one issue in patient terms — include a number>\n"
      + "FIX: <what we do + realistic timeline>\n"
      + "BUDGET: <estimate>\n"
      + "GOAL: <what agent should confirm or validate — not pitch, validate>\n\n"
      + "RULES: Use ONLY facts below. Null = omit. Patient language. No jargon.\n\n"
      + "FACTS:\n"
      + "Practice: " + F.name + "\n"
      + (F.rating ? "Google: " + F.rating + "★ (" + (F.reviewCount ?? "?") + " reviews)\n" : "Google rating: not available\n")
      + "Mobile: " + (F.mPerf ?? "N/A") + "/100 | Desktop: " + (F.dPerf ?? "N/A") + "/100\n"
      + "Site quality: " + (F.siteQuality || "not assessed") + "\n"
      + "Primary issue: " + (F.oneProblem || "not identified") + "\n"
      + "Cost impact: " + (F.oneCost || "unclear") + "\n"
      + "Fix: " + (F.theFix || "not specified") + "\n"
      + "Speed: " + (F.speedVerdict || "N/A") + "\n"
      + "Conversion: " + (F.convVerdict || "N/A") + "\n"
      + "After-hours: " + (F.afterHours || "N/A") + "\n"
      + "Contact: " + contactLine + "\n"
      + "Priority: " + (leadPack.priority ?? "").toUpperCase() + " | Score: " + leadPack.score + "/100\n"
      + "Budget: " + (leadPack.estimated_budget || "unknown"),
  });
}

// ─────────────────────────────────────────────────────────────
// 3. CALL SCRIPT  (deterministic)
// ─────────────────────────────────────────────────────────────

function genCallScript(F) {
  const problem = F.oneProblem || F.friction || "a few things worth discussing";
  const fix     = F.theFix    || "a quick improvement, no rebuild needed";
  const quality = F.siteQuality || "your site is well put together";

  const closingQ = !F.hasBooking
    ? "Do patients who visit after hours have a way to request an appointment without calling?"
    : !F.hasGA4
    ? "Do you have a way to see which marketing is actually bringing patients in?"
    : "Is that the kind of thing worth a quick look at?";

  return [
    "Hi, I'm [Name] — I came across " + F.name + " while researching dental practices in your area.",
    cap(quality) + " — honestly one of the stronger ones I've come across.",
    "I noticed one thing: " + problem,
    "I put together a short summary on how to fix it — " + fix + ".",
    closingQ,
  ].join(" ");
}

// ─────────────────────────────────────────────────────────────
// 4. WEBSITE ISSUES  (deterministic, 3 sentences)
// ─────────────────────────────────────────────────────────────

function genWebsiteIssues(F) {
  const parts = [];
  if (F.speedVerdict) {
    parts.push(F.speedVerdict);
  } else if (F.mPerf != null) {
    parts.push(F.mPerf >= 85
      ? "Site loads well on mobile and desktop (mobile " + F.mPerf + "/100)."
      : "Mobile performance is " + F.mPerf + "/100 — noticeable slowdown on phones."
    );
  }
  if (F.seoVerdict) parts.push(F.seoVerdict);
  if (F.oneProblem) {
    parts.push("Primary opportunity: " + F.oneProblem + (F.oneCost ? " (" + F.oneCost + ")" : "") + ".");
  } else if (F.convQuickWin) {
    parts.push("Quick win: " + F.convQuickWin + ".");
  }
  return parts.slice(0, 3).join(" ");
}

// ─────────────────────────────────────────────────────────────
// 5. PITCH  (deterministic, internal)
// ─────────────────────────────────────────────────────────────

function genPitch(F, leadPack) {
  return [
    F.name + " — " + (F.siteQuality || "site is functional") + ". Primary opportunity: " + (F.oneProblem || "see analysis") + (F.oneCost ? " (" + F.oneCost + ")" : "") + ".",
    "Proposed scope: " + (F.theFix || "performance and conversion improvements") + ".",
    "Budget: " + (leadPack.estimated_budget || "TBD") + " | Priority: " + (leadPack.priority ?? "").toUpperCase() + " | Score: " + leadPack.score + "/100.",
  ].join(" ");
}

// ─────────────────────────────────────────────────────────────
// 6. LEAD RECAP  (deterministic, full snapshot)
// Google phone shown first with source label.
// ─────────────────────────────────────────────────────────────

function genLeadRecap(F, leadPack, resolvedContacts, lis) {
  const phone   = resolvedContacts?.phones?.primary ?? null;
  const pSource = resolvedContacts?.phones?.primary_source ?? null;
  const pConf   = resolvedContacts?.phones?.primary_confidence ?? null;
  const email   = resolvedContacts?.emails?.primary ?? null;

  const lines = [
    "━━━ LEAD RECAP ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "LIS:      " + (lis?.score ?? "N/A") + "/100 (" + (lis?.grade ?? "?") + ") — " + (lis?.interpretation ?? ""),
    "SCORE:    " + leadPack.score + "/100  |  PRIORITY: " + (leadPack.priority ?? "").toUpperCase(),
    "BUDGET:   " + (leadPack.estimated_budget || "unknown"),
    "HEALTH:   " + (F.health ?? "N/A") + "/100  (" + (F.grade ?? "?") + ")",
    "",
    "PERFORMANCE",
    "  MOBILE:   " + (F.mPerf  ?? "N/A") + "/100",
    "  DESKTOP:  " + (F.dPerf  ?? "N/A") + "/100",
    "  ROI:      ~$" + F.monthlyLost + "/mo lost | fix ~$" + F.fixCost + " | payback ~" + F.payback + "mo",
    "",
    "GOOGLE",
    "  " + (F.rating ? F.rating + "★ (" + (F.reviewCount ?? "?") + " reviews)" : "not available"),
    F.mapsUrl ? "  " + F.mapsUrl : null,
    "",
    "CONTACT",
    "  PHONE:    " + (phone ? phone + " [source: " + (pSource ?? "?") + (pConf ? ", " + Math.round(pConf * 100) + "% confidence]" : "]") : "not resolved"),
    "  EMAIL:    " + (email ?? "not found"),
    "  BOOKING:  " + (F.hasBooking ? "yes" + (F.bookingVendor ? " (" + F.bookingVendor + ")" : "") : "not detected"),
    "  CHATBOT:  " + (F.hasChatbot ? "yes" : "not detected"),
    "",
    "TRACKING",
    "  PRESENT:  " + (F.trackingPresent.length ? F.trackingPresent.join(", ") : "none"),
    "  MISSING:  " + (F.trackingMissing.length ? F.trackingMissing.join(", ") : "none"),
    "",
    "SITE",
    "  URL:      " + (F.url     || "N/A"),
    "  ADDRESS:  " + (F.address || "N/A"),
    "  TONE:     " + (leadPack.site?.tone || "unknown"),
    "  SERVICES: " + ((leadPack.site?.services || []).join(", ") || "unknown"),
    "",
    "THE OPPORTUNITY",
    "  " + (F.oneProblem || "not identified"),
    F.oneCost ? "  COST:  " + F.oneCost : null,
    F.theFix  ? "  FIX:   " + F.theFix  : null,
    "",
    "ANALYZED: " + (leadPack.analyzed_at?.replace("T", " ").slice(0, 16) ?? ""),
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
  ];

  return lines.filter(l => l !== null).join("\n");
}

// ─────────────────────────────────────────────────────────────
// ORCHESTRATOR
// ─────────────────────────────────────────────────────────────

export async function enrichLead({ leadPack, analysis, signalReport, resolvedContacts, lis }) {
  const F = buildFactSheet(signalReport, analysis);

  const enriched = {};

  // Deterministic Zoho fields (instant)
  enriched.lead_recap     = genLeadRecap(F, leadPack, resolvedContacts, lis);
  enriched.call_script    = genCallScript(F);
  enriched.website_issues = genWebsiteIssues(F);
  enriched.pitch          = genPitch(F, leadPack);

  // AI fields (2 calls)
  for (const step of [
    { key: "cold_email",     label: "Cold email",     fn: () => genColdEmail(F, leadPack, resolvedContacts) },
    { key: "agent_briefing", label: "Agent briefing", fn: () => genAgentBriefing(F, leadPack, resolvedContacts) },
  ]) {
    try {
      console.log("   Generating " + step.label + "...");
      enriched[step.key] = await step.fn();
      console.log("   Done: " + step.label);
    } catch (err) {
      console.warn("   Failed: " + step.label + " — " + err.message);
      enriched[step.key] = null;
    }
  }

  // Sales intelligence (zero API cost — all deterministic)
  const seasonal   = buildSeasonalAngle();
  const competitor = buildCompetitorContext({ resolvedContacts, analysis });
  const subjects   = buildSubjectLineMatrix({ analysis, factSheet: F });
  const objections = buildObjectionMap({ analysis, resolvedContacts, factSheet: F });
  const sequence   = buildOutreachSequence({ analysis, resolvedContacts, lis, factSheet: F });

  return {
    lead:             leadPack.lead,
    score:            leadPack.score,
    priority:         leadPack.priority,
    estimated_budget: leadPack.estimated_budget,
    analyzed_at:      leadPack.analyzed_at,
    analysis:         leadPack.analysis,
    site:             leadPack.site,
    contacts: {
      primary_phone:  resolvedContacts?.phones?.primary  ?? null,
      primary_email:  resolvedContacts?.emails?.primary  ?? null,
      phones:         resolvedContacts?.phones ?? {},
      emails:         resolvedContacts?.emails ?? {},
    },
    enriched,
    sales_intel: {
      seasonal_angle:     seasonal,
      competitor_context: competitor,
      subject_matrix:     subjects,
      objection_map:      objections,
      outreach_sequence:  sequence,
    },
  };
}