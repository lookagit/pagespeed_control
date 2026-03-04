// ============================================================
// ai/sales_intelligence.js — Sales Intelligence Engine
// ============================================================
//
// Pure deterministic module — no AI calls, no API calls.
// All signals computed from data already in the pipeline.
//
// OUTPUTS:
//   intent_signals       — buying readiness indicators
//   lead_intelligence    — composite LIS score (0-100)
//   outreach_sequence    — full 5-touch multi-channel plan
//   objection_map        — pre-computed rebuttals
//   subject_line_matrix  — A/B options scored by psychological trigger
//   competitor_context   — Google rating gap analysis
//   seasonal_angle       — time-of-year pitch hook
// ============================================================

// ─────────────────────────────────────────────────────────────
// INTENT SIGNALS
// Deterministic signals that indicate buying readiness
// ─────────────────────────────────────────────────────────────

export function computeIntentSignals({ signalReport, analysis, siteSummary, callReport }) {
  const signals = [];
  const score   = {};

  const mPerf    = signalReport?.scores?.mobile_perf  ?? null;
  const dPerf    = signalReport?.scores?.desktop_perf ?? null;
  const tracking = signalReport?.tracking ?? {};
  const booking  = signalReport?.booking  ?? {};
  const tech     = signalReport?.tech     ?? {};

  // ── Pain indicators (high intent to buy) ─────────────────
  if (mPerf !== null && mPerf < 50) {
    score.speed_pain = 30;
    signals.push({ type: "pain", key: "critical_mobile", weight: 30,
      label: "Critical mobile performance",
      pitch_hook: `Site loads in ${mPerf}/100 — most patients on phones leave before seeing anything` });
  } else if (mPerf !== null && mPerf < 70) {
    score.speed_pain = 18;
    signals.push({ type: "pain", key: "slow_mobile", weight: 18,
      label: "Slow mobile performance",
      pitch_hook: `Mobile score ${mPerf}/100 — measurably losing phone visitors` });
  }

  if (!booking.has_booking) {
    score.no_booking = 15;
    signals.push({ type: "pain", key: "no_online_booking", weight: 15,
      label: "No online booking",
      pitch_hook: "Patients under 40 won't call — they book online or move on" });
  }

  if (!tracking.present?.includes("GA4")) {
    score.no_analytics = 10;
    signals.push({ type: "pain", key: "no_analytics", weight: 10,
      label: "Flying blind — no analytics",
      pitch_hook: "Can't see how patients find them or which pages they visit" });
  }

  if (!tracking.present?.includes("Meta Pixel") && !tracking.present?.includes("Google Ads pixel")) {
    score.no_ad_tracking = 8;
    signals.push({ type: "pain", key: "no_ad_tracking", weight: 8,
      label: "Can't measure ad ROI",
      pitch_hook: "Any ad spend is untracked — burning budget blind" });
  }

  // ── Tech stack obsolescence (upgrade opportunity) ─────────
  const cms = (tech.cms ?? "").toLowerCase();
  if (cms.includes("wix")) {
    score.old_cms = 15;
    signals.push({ type: "opportunity", key: "wix_site", weight: 15,
      label: "Wix platform",
      pitch_hook: "Wix has hard performance ceilings — a rebuild could double mobile score" });
  } else if (cms.includes("squarespace")) {
    score.old_cms = 10;
    signals.push({ type: "opportunity", key: "squarespace", weight: 10,
      label: "Squarespace platform",
      pitch_hook: "Squarespace limits SEO and booking integrations" });
  }

  // ── Positive signals (reduce urgency / inform angle) ─────
  const rating = callReport?._originalLead?.rating;
  if (rating && rating >= 4.5) {
    score.strong_reviews = -5;   // strong practice = potentially less urgent
    signals.push({ type: "positive", key: "strong_reviews", weight: -5,
      label: `Strong Google rating (${rating}★)`,
      pitch_hook: "Practice already has patient trust — now fix the tech to match" });
  }

  if (booking.has_booking) {
    score.has_booking = -8;
    signals.push({ type: "positive", key: "has_booking", weight: -8,
      label: `Online booking present (${booking.vendor ?? "provider unknown"})`,
      pitch_hook: "Booking is solved — focus pitch on speed and analytics" });
  }

  const totalIntent = Math.max(0, Math.min(100,
    Object.values(score).reduce((a, b) => a + b, 0)
  ));

  return { signals, score_breakdown: score, intent_score: totalIntent };
}

// ─────────────────────────────────────────────────────────────
// LEAD INTELLIGENCE SCORE (LIS)
// Composite 0-100. Higher = call today.
// Formula: opportunity(40%) + contact_quality(20%) +
//          engagement_likelihood(25%) + budget_probability(15%)
// ─────────────────────────────────────────────────────────────

export function computeLeadIntelligenceScore({ analysis, resolvedContacts, signalReport }) {
  const opportunityScore = Number(analysis?.score ?? 0);

  // Contact quality (0-100): do we have good data to reach them?
  const hasPhone  = !!resolvedContacts?.phones?.primary;
  const hasEmail  = !!resolvedContacts?.emails?.primary;
  const phoneConf = resolvedContacts?.phones?.primary_confidence ?? 0;
  const emailConf = resolvedContacts?.emails?.primary_confidence ?? 0;
  const contactQ  = Math.round(
    (hasPhone ? 50 * phoneConf : 0) +
    (hasEmail ? 50 * emailConf : 0)
  );

  // Engagement likelihood (0-100): signals that they care about their web presence
  let engagementL = 50;  // baseline
  const rating    = resolvedContacts?.google?.rating ?? null;
  if (rating >= 4.0) engagementL += 15;   // cares about reputation
  if (signalReport?.booking?.has_booking) engagementL += 10;  // invested in online tools
  if (signalReport?.tracking?.present?.includes("GA4")) engagementL -= 15;  // may DIY
  engagementL = Math.max(0, Math.min(100, engagementL));

  // Budget probability (0-100): can they afford it?
  const reviewCount = resolvedContacts?.google?.review_count ?? 0;
  let budgetP = 50;
  if (reviewCount >= 200) budgetP += 25;   // established = cash flow
  if (reviewCount >= 100) budgetP += 10;
  if (reviewCount <  20)  budgetP -= 20;   // brand new / tiny
  const budgetRange = analysis?.estimated_budget_range ?? "";
  if (budgetRange.includes("$1k")) budgetP += 0;
  if (budgetRange.includes("$3k")) budgetP += 5;
  if (budgetRange.includes("$8k")) budgetP += 10;
  budgetP = Math.max(0, Math.min(100, budgetP));

  const lis = Math.round(
    (opportunityScore  * 0.40) +
    (contactQ          * 0.20) +
    (engagementL       * 0.25) +
    (budgetP           * 0.15)
  );

  const lisLabel = lis >= 75 ? "A" : lis >= 55 ? "B" : lis >= 35 ? "C" : "D";

  return {
    score:                lis,
    grade:                lisLabel,
    components: {
      opportunity:         { score: opportunityScore, weight: 0.40 },
      contact_quality:     { score: contactQ,         weight: 0.20 },
      engagement_likelihood: { score: engagementL,    weight: 0.25 },
      budget_probability:  { score: budgetP,          weight: 0.15 },
    },
    interpretation: lisLabel === "A" ? "Top priority — call today" :
                    lisLabel === "B" ? "High value — call this week" :
                    lisLabel === "C" ? "Medium — start with email" :
                                       "Low priority — batch email only",
  };
}

// ─────────────────────────────────────────────────────────────
// OUTREACH SEQUENCE
// Full 5-touch multi-channel plan driven by lead data
// ─────────────────────────────────────────────────────────────

export function buildOutreachSequence({ analysis, resolvedContacts, lis, factSheet }) {
  const name        = resolvedContacts?.primary?.name  ?? "the practice";
  const hasPhone    = !!resolvedContacts?.phones?.primary;
  const hasEmail    = !!resolvedContacts?.emails?.primary;
  const problem     = factSheet?.oneProblem ?? "website performance issues";
  const fix         = factSheet?.theFix ?? "a quick improvement";
  const quality     = factSheet?.siteQuality ?? "your site is well put together";
  const budget      = analysis?.estimated_budget_range ?? "TBD";

  return [
    {
      day:     0,
      channel: "email",
      enabled: hasEmail,
      label:   "Cold email — Australian approach",
      goal:    "Get a YES to send the free PDF audit",
      note:    "Use the cold_email field from zoho section",
      subject_strategy: "loss_framing",   // Day 0: loss > curiosity
    },
    {
      day:     3,
      channel: "linkedin",
      enabled: true,   // always try LinkedIn even without direct profile
      label:   "LinkedIn connection request + note",
      goal:    "Build familiarity before the follow-up call",
      template: `Hi [Name], I've been researching dental practices in [City] and ${quality} — genuinely stood out. I left a quick note about something I noticed that might be worth 2 minutes. Happy to share if useful. — [Your Name]`,
      max_chars: 300,
    },
    {
      day:     7,
      channel: "email",
      enabled: hasEmail,
      label:   "Follow-up email — social proof angle",
      goal:    "Second touch: reference a result, not just a problem",
      template: [
        `Subject: Re: [PRACTICE NAME] — quick follow-up`,
        ``,
        `Hi [Name],`,
        ``,
        `I sent a note last week about ${problem}. Didn't want to let it slip — we fixed the same issue for a dental practice in [STATE] recently and they picked up 18 new appointment requests in the first 30 days.`,
        ``,
        `The PDF audit is still ready for you — just reply "send it" and it's yours.`,
        ``,
        `[Your Name]`,
      ].join("\n"),
    },
    {
      day:     14,
      channel: "phone",
      enabled: hasPhone,
      label:   "Voicemail script",
      goal:    "Leave a 20-second voicemail that gets a callback",
      template: `Hi, this is [Name] calling for [PRACTICE NAME] — I'm a web consultant and I've put together a short audit for your site. I noticed ${problem} and I think I can fix it${fix ? ` — ${fix}` : ""}. It's a 1-page PDF, yours to keep. Give me a call back at [YOUR NUMBER] or just reply to my email. Thanks.`,
      max_seconds: 25,
    },
    {
      day:     21,
      channel: "email",
      enabled: hasEmail,
      label:   "Final email — breakup / last chance",
      goal:    "Close the loop, leave door open, create mild urgency",
      template: [
        `Subject: Closing the loop on [PRACTICE NAME]`,
        ``,
        `Hi [Name],`,
        ``,
        `I've reached out a couple of times about ${problem}. I'll leave you alone after this — I know you're busy.`,
        ``,
        `If the timing is ever right, the audit is still here. ${budget !== "TBD" ? `The typical budget for this work is ${budget}` : "The work is typically affordable for practices your size"} and the fix takes 2–3 weeks.`,
        ``,
        `No pressure. Just didn't want to disappear without offering one last time.`,
        ``,
        `[Your Name]`,
      ].join("\n"),
    },
  ];
}

// ─────────────────────────────────────────────────────────────
// OBJECTION HANDLING MAP
// 5 most common dental objections + data-driven rebuttals
// ─────────────────────────────────────────────────────────────

export function buildObjectionMap({ analysis, resolvedContacts, factSheet }) {
  const problem  = factSheet?.oneProblem ?? "a performance issue";
  const cost     = factSheet?.oneCost ?? "patient drop-off";
  const fix      = factSheet?.theFix ?? "the fix";
  const budget   = analysis?.estimated_budget_range ?? "a few thousand dollars";
  const rating   = resolvedContacts?.google?.rating;
  const reviews  = resolvedContacts?.google?.review_count;

  return [
    {
      objection: "We already have a website, it works fine",
      rebuttal:  `That's exactly what I thought too — the site looks good. The issue isn't visual, it's technical: ${problem}. Most patients never mention it, they just leave.`,
      data_hook: factSheet?.mPerf ? `Mobile score is ${factSheet.mPerf}/100 — patients on phones don't wait.` : null,
    },
    {
      objection: "We don't have the budget right now",
      rebuttal:  `Totally understand. The rough estimate for this specific fix is ${budget}. ${cost ? `The issue is currently costing roughly ${cost}, so it typically pays back in 2–3 months.` : "Most practices see payback within 90 days."} Happy to show you the numbers.`,
      data_hook: null,
    },
    {
      objection: "We're happy with our current web person",
      rebuttal:  `That makes sense — we're not replacing anyone. This is one specific fix for one specific issue: ${problem}. One-off project, you keep working with your regular team after.`,
      data_hook: null,
    },
    {
      objection: "How is this different from the last person who called?",
      rebuttal:  `Fair question. I'm not selling a package or a retainer. I noticed ${problem} on your site specifically, ran the numbers${cost ? ` (${cost})` : ""}, and built a 1-page audit. It's yours for free. If the fix makes sense, great. If not, keep the audit.`,
      data_hook: null,
    },
    {
      objection: "We get tons of patients from Google already",
      rebuttal:  rating && reviews
        ? `Your ${rating}★ rating with ${reviews} reviews is genuinely strong — patients trust you. The risk is that when they hit the site on a phone and it's slow, some of them reconsider. You're converting less than you should from that trust.`
        : `That's great. The question is how many you're getting vs how many you could — ${problem} is a conversion leak that's quiet but steady.`,
      data_hook: rating ? `${rating}★ on Google is solid social proof. The gap is converting that interest into bookings.` : null,
    },
  ];
}

// ─────────────────────────────────────────────────────────────
// SUBJECT LINE MATRIX
// Scored by psychological trigger type
// ─────────────────────────────────────────────────────────────

export function buildSubjectLineMatrix({ analysis, factSheet }) {
  const mPerf   = factSheet?.mPerf;
  const problem = factSheet?.oneProblem ?? "";
  const cost    = factSheet?.oneCost ?? "";
  const subjects = analysis?.email_subject_options ?? [];

  // Enrich AI-generated subjects with trigger scoring
  const scored = subjects.map(s => ({
    subject: s,
    trigger: detectTrigger(s),
    score:   scoreTrigger(s),
  }));

  // Add deterministic fallbacks
  const fallbacks = [];

  if (mPerf !== null && mPerf < 70) {
    fallbacks.push({
      subject:  `Your site lost ${Math.round((0.53 - 0.09) * 100)}% of phone visitors last month`,
      trigger:  "loss_aversion",
      score:    9,
      source:   "deterministic",
    });
    fallbacks.push({
      subject:  `${mPerf}/100 mobile score — here's the fix`,
      trigger:  "specificity",
      score:    8,
      source:   "deterministic",
    });
  }

  fallbacks.push({
    subject:  `Free 1-page audit for [PRACTICE NAME]`,
    trigger:  "reciprocity",
    score:    7,
    source:   "deterministic",
  });

  const all = [...scored.map(s => ({ ...s, source: "ai" })), ...fallbacks];
  all.sort((a, b) => b.score - a.score);

  return {
    recommended:  all[0] ?? null,
    all:          all,
    best_trigger: all[0]?.trigger ?? null,
  };
}

// ─────────────────────────────────────────────────────────────
// COMPETITOR CONTEXT
// Uses Google rating to frame competitive gap
// ─────────────────────────────────────────────────────────────

export function buildCompetitorContext({ resolvedContacts, analysis }) {
  const rating = resolvedContacts?.google?.rating;
  const count  = resolvedContacts?.google?.review_count;

  if (!rating) return { available: false, note: "No rating data available" };

  // Dental industry benchmarks (US, 2024)
  const DENTAL_AVG_RATING   = 4.3;
  const DENTAL_TOP10_RATING = 4.7;
  const gap_to_average      = (rating - DENTAL_AVG_RATING).toFixed(1);
  const gap_to_top10        = (DENTAL_TOP10_RATING - rating).toFixed(1);

  const position =
    rating >= 4.7 ? "top_10_percent" :
    rating >= 4.5 ? "above_average" :
    rating >= 4.0 ? "average" :
    "below_average";

  return {
    available: true,
    rating,
    review_count: count ?? null,
    industry_avg: DENTAL_AVG_RATING,
    industry_top10: DENTAL_TOP10_RATING,
    gap_to_average:    Number(gap_to_average),
    gap_to_top10:      Number(gap_to_top10),
    position,
    pitch_angle: buildCompetitorPitchAngle({ rating, count, gap_to_top10, position }),
  };
}

// ─────────────────────────────────────────────────────────────
// SEASONAL ANGLE
// Time-of-year hooks for the pitch
// ─────────────────────────────────────────────────────────────

export function buildSeasonalAngle() {
  const month = new Date().getMonth() + 1;  // 1-12

  const seasons = {
    1:  { label: "New Year", hook: "January is when patients commit to health goals — make sure they can book the moment they decide", urgency: "high" },
    2:  { label: "Valentines / insurance reset", hook: "Q1 is peak 'use my dental benefits' season — patients are actively searching", urgency: "high" },
    3:  { label: "Q1 insurance benefits", hook: "Patients with fresh annual benefits are looking for a dentist now", urgency: "high" },
    4:  { label: "Spring", hook: "Spring is the second peak for new patient acquisition", urgency: "medium" },
    5:  { label: "Pre-summer", hook: "Families book before school ends — orthodontic consultations spike in May", urgency: "medium" },
    6:  { label: "Summer", hook: "Kids are out of school — family dentistry appointments cluster in June–July", urgency: "medium" },
    7:  { label: "Back to school prep", hook: "August back-to-school season is the 3rd highest dental inquiry period of the year", urgency: "high" },
    8:  { label: "Back to school", hook: "Back-to-school physicals drive dental traffic — families searching in August", urgency: "high" },
    9:  { label: "Fall benefits reminder", hook: "Patients start using remaining annual benefits — Q4 is high intent", urgency: "medium" },
    10: { label: "Q4 benefits burndown", hook: "Patients rushing to use dental benefits before year-end — one of the highest intent periods", urgency: "very_high" },
    11: { label: "Year-end benefits rush", hook: "November: practices that can be found online and book easily capture the year-end surge", urgency: "very_high" },
    12: { label: "December benefits", hook: "Last chance for patients to use 2024 dental benefits — they're actively looking", urgency: "very_high" },
  };

  return seasons[month] ?? { label: "Evergreen", hook: "Patients search for dentists year-round", urgency: "medium" };
}

// ─────────────────────────────────────────────────────────────
// PRIVATE HELPERS
// ─────────────────────────────────────────────────────────────

function detectTrigger(subject) {
  const s = subject.toLowerCase();
  if (/lost|losing|miss|costing|leak|left behind/i.test(s)) return "loss_aversion";
  if (/\d/.test(s) && /score|second|month|patient|percent|%/i.test(s)) return "specificity";
  if (/free|gift|yours|complimentary/i.test(s)) return "reciprocity";
  if (/quick|fast|2 min|one thing/i.test(s)) return "curiosity";
  if (/other practices|competitor|while you|they are/i.test(s)) return "social_proof";
  if (/before|deadline|last chance|this week/i.test(s)) return "urgency";
  return "general";
}

function scoreTrigger(subject) {
  const trigger = detectTrigger(subject);
  const scores  = { loss_aversion: 9, specificity: 8, reciprocity: 7, curiosity: 7, social_proof: 6, urgency: 6, general: 4 };
  return scores[trigger] ?? 4;
}

function buildCompetitorPitchAngle({ rating, count, gap_to_top10, position }) {
  if (position === "top_10_percent") {
    return `${rating}★ puts them in the top 10% of US dental practices — a strong reputation that deserves a site to match`;
  }
  if (position === "above_average") {
    return `${rating}★ is above the dental average (4.3★) — they're winning on reputation but likely losing the search-to-book conversion`;
  }
  if (position === "average") {
    return `At ${rating}★, they're average for dental practices. Better reviews + faster site = clear competitive advantage`;
  }
  return `At ${rating}★, there's a reputation gap to close alongside the website work — both are addressable`;
}