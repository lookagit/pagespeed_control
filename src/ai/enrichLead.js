// ============================================================
// ai/enrichLead.js — Narrative Outreach System
// ============================================================
//
// PENTAGRAM DIRECTIVE:
//   Every touchpoint is one story, one voice, one arc.
//   The email opens a door. The briefing arms the agent.
//   The call script closes the loop. Nothing repeats.
//   Nothing is generic. Everything earns its place.
//
// NARRATIVE ARC:
//   ACT 1 — EMAIL:    "We looked. We noticed one thing. Curious?"
//   ACT 2 — BRIEFING: "Here's exactly what to say and why."
//   ACT 3 — CALL:     "Validate, don't pitch. They already know."
//
// APPLE ENGINEERING NOTES:
//   - narrativeCore() is the single source of truth for story
//   - buildFactSheet() is the single source of truth for data
//   - All generators receive (F, N) — facts and narrative
//   - AI calls: 2 (cold_email, agent_briefing)
//   - Deterministic: 4 (call_script, website_issues, pitch, recap)
//   - Zero jargon policy enforced at prompt level
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
// FACT SHEET
// Single verified data object. Generators never read raw input.
// ─────────────────────────────────────────────────────────────

export function buildFactSheet(signalReport, analysis) {
  const meta   = signalReport?.meta   ?? {};
  const scores = signalReport?.scores ?? {};
  const orig   = signalReport?._originalLead ?? {};

  const contact       = signalReport?.contact ?? {};
  const crawlerPhones = Array.isArray(contact.phones) ? contact.phones : [];
  const crawlerEmails = Array.isArray(contact.emails) ? contact.emails : [];

  const booking         = signalReport?.booking ?? {};
  const trackingPresent = signalReport?.tracking?.present ?? [];
  const trackingMissing = signalReport?.tracking?.missing ?? [];

  const passes = analysis?._passes ?? {};
  const speed  = passes.speed      ?? {};
  const seo    = passes.seo        ?? {};
  const conv   = passes.conversion ?? {};

  const mPerf       = scores.mobile_perf  ?? null;
  const dPerf       = scores.desktop_perf ?? null;
  const industryAvg = 65;

  // Speed classification — human tier, never "blank screen"
  const speedTier = (() => {
    if (mPerf === null) return null;
    if (mPerf >= 90)    return "fast";
    if (mPerf >= 75)    return "average";
    if (mPerf >= 50)    return "slow";
    if (mPerf >= 30)    return "very_slow";
    return "critical";
  })();

  const slowerThan = mPerf !== null && mPerf < industryAvg
    ? Math.round(((industryAvg - mPerf) / industryAvg) * 100)
    : null;

  // Patient-language speed description — never technical
  const speedLabel = (() => {
    if (speedTier === "fast")      return "loads faster than most practices in your area";
    if (speedTier === "average")   return "loads about average for a dental site";
    if (speedTier === "slow")      return `loads slower than ${slowerThan ?? 20}% of dental practices`;
    if (speedTier === "very_slow") return "noticeably slower than what patients expect on mobile";
    if (speedTier === "critical")  return "slow enough that most patients leave before it finishes loading";
    return null;
  })();

  const monthlyLost = Math.round(200 * (0.53 - 0.09) * 0.03 * 350);

  return {
    // Identity
    name:    meta.name        ?? orig.name        ?? "",
    url:     meta.url         ?? orig.website_url ?? "",
    address: meta.address     ?? orig.address     ?? "",
    health:  meta.health ?? null,
    grade:   meta.grade  ?? null,

    // Performance
    mPerf, dPerf, speedTier, slowerThan, speedLabel,

    // Reputation
    rating:      orig.rating             ?? null,
    reviewCount: orig.user_ratings_total ?? null,
    mapsUrl:     orig.maps_url           ?? null,

    // Contact
    crawlerPhones,
    crawlerEmails,
    hasEmailOnSite: crawlerEmails.length > 0,

    // Presence
    hasBooking:    booking.has_booking === true,
    bookingVendor: booking.vendor ?? null,
    trackingPresent,
    trackingMissing,
    hasGA4:       trackingPresent.includes("GA4"),
    hasGTM:       trackingPresent.includes("GTM"),
    hasMeta:      trackingPresent.includes("Meta Pixel"),
    hasGoogleAds: trackingPresent.includes("Google Ads pixel"),
    hasChatbot:   signalReport?.status?.chatbot?.ok === true,

    // AI verdicts (verbatim from analysis passes)
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

    // Economics
    fixCost:     2500,
    maintCost:   199,
    monthlyLost,
    payback:     monthlyLost > 0 ? Math.ceil(2500 / monthlyLost) : 5,
  };
}

// ─────────────────────────────────────────────────────────────
// NARRATIVE CORE
//
// PENTAGRAM PRINCIPLE:
//   Before writing a single word of copy, define the story.
//   Who is this practice? What did we see? What do we offer?
//   What is the ONE emotional hook that makes them respond?
//
//   This object is computed once and passed to every generator.
//   It ensures every touchpoint — email, briefing, call —
//   tells the same story in a different register.
// ─────────────────────────────────────────────────────────────

function buildNarrativeCore(F, resolvedContacts) {
  const phone = resolvedContacts?.phones?.primary ?? null;

  // ── HOOK: The single most compelling thing about this lead ──
  // Used as the opening observation across all touchpoints.
  // Priority: reputation > speed > booking gap > tracking gap
  const hook = (() => {
    if (F.rating && F.rating >= 4.7 && F.reviewCount > 50) {
      return {
        type:    "reputation_strong",
        // What the agent/email opens with — earned credibility
        opening: `${F.name} has built something real — ${F.rating}★ across ${F.reviewCount} reviews.`,
        // The gap that makes them leaning in
        tension: F.speedTier === "slow" || F.speedTier === "very_slow" || F.speedTier === "critical"
          ? `The site doesn't match that reputation on mobile.`
          : !F.hasBooking
          ? `But patients who find them after hours have no way to book.`
          : `The online presence doesn't yet reflect the quality of the practice.`,
        // What the PDF/call reveals
        promise: "A short audit showing exactly what the gap is and what it would take to close it.",
      };
    }

    if (F.speedTier === "very_slow" || F.speedTier === "critical") {
      return {
        type:    "speed_critical",
        opening: `We looked at the ${F.name} website on mobile.`,
        tension: `It ${F.speedLabel ?? "loads slower than patients expect"} — and most patients search on their phones.`,
        promise: "We put together a one-page breakdown — what's causing it, what it's likely costing, and what a fix looks like.",
      };
    }

    if (!F.hasBooking) {
      return {
        type:    "booking_gap",
        opening: `Patients who find ${F.name} after hours — through Google, a friend's recommendation, Instagram —`,
        tension: `have no way to request an appointment without picking up the phone.`,
        promise: "One-page summary on what that gap looks like and the simplest way to close it.",
      };
    }

    if (!F.hasGA4 && !F.hasGTM) {
      return {
        type:    "blind_marketing",
        opening: `${F.name} is likely running some form of marketing to bring in new patients.`,
        tension: `But there's currently no way to see which of it is actually working.`,
        promise: "Short breakdown of what's missing and what it takes to connect marketing to real bookings.",
      };
    }

    if (F.seoProblem) {
      return {
        type:    "seo_gap",
        opening: `We looked at how ${F.name} shows up in local search.`,
        tension: `There's a visibility gap — patients searching nearby may not be finding them.`,
        promise: "One-page summary of what we found and what would change it.",
      };
    }

    // Fallback — site quality as hook
    return {
      type:    "general_quality",
      opening: `We came across ${F.name} while reviewing practices in the area.`,
      tension: F.siteQuality
        ? `${F.siteQuality} — with one thing worth addressing.`
        : `A few things stood out worth sharing.`,
      promise: "Short one-pager — what we noticed and what we'd suggest.",
    };
  })();

  // ── PROOF OF EFFORT: What shows we actually looked ──
  // Must be specific. Vague = ignored. Specific = credible.
  const effortProof = (() => {
    const signals = [];
    if (F.mPerf !== null)        signals.push(`checked mobile performance (${F.mPerf}/100)`);
    if (F.rating)                signals.push(`read through ${F.reviewCount ?? "the"} Google reviews`);
    if (F.hasBooking !== null)   signals.push(`checked booking flow`);
    if (trackingCount(F) > 0)   signals.push(`looked at tracking setup`);
    if (F.seoProblem)            signals.push(`checked local search visibility`);
    return signals.slice(0, 3);
  })();

  // ── TONE REGISTER: How we speak to this practice ──
  // Premium practices get peer-to-peer tone.
  // Average practices get helpful-expert tone.
  const toneRegister = (() => {
    if (F.rating >= 4.5 || (F.grade === "A") || F.siteQuality?.includes("strong"))
      return "peer";       // "We noticed..." — equals talking to equals
    if (F.grade === "D" || F.grade === "F" || F.speedTier === "critical")
      return "rescue";     // "There's something here worth fixing..."
    return "consultant";   // Default: helpful expert, not salesperson
  })();

  // ── CALL TO ACTION: What we ask in each touchpoint ──
  const cta = {
    email:    "Want me to send it?",             // Frictionless yes/no
    call:     validationQuestion(F),             // Open question, not pitch
    followUp: "Did you get a chance to look at the PDF?",
  };

  return {
    hook,
    effortProof,
    toneRegister,
    cta,
    phone,
    // Pre-built narrative sentences for deterministic generators
    openingSentence:  hook.opening,
    tensionSentence:  hook.tension,
    promiseSentence:  hook.promise,
  };
}

// ─────────────────────────────────────────────────────────────
// NARRATIVE HELPERS
// ─────────────────────────────────────────────────────────────

function trackingCount(F) {
  return (F.trackingPresent ?? []).length;
}

function validationQuestion(F) {
  if (F.speedTier === "very_slow" || F.speedTier === "critical")
    return "Have you had patients mention anything about the website, or is it more something you've been meaning to look at?";
  if (!F.hasBooking)
    return "How are most patients booking right now — do you find you get calls outside of office hours?";
  if (!F.hasGA4)
    return "Do you have a sense of which channels are driving the most new patients at the moment?";
  if (F.rating && F.rating >= 4.5)
    return "With the reputation you've built, is growing new patient volume online something you're focused on this year?";
  return "Is the website working as a new patient channel for you right now, or is most of it word of mouth?";
}

function cityState(address) {
  const parts = String(address || "").split(",").map(s => s.trim()).filter(Boolean);
  return { city: parts[1] ?? "", state: (parts[2] ?? "").split(/\s+/)[0] ?? "" };
}

function cap(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : str;
}

// ─────────────────────────────────────────────────────────────
// ACT 1 — COLD EMAIL  (AI)
//
// FRAMEWORK: Connor Murray — "Who you are / Why relevant / What you want"
//
// PRINCIPLES:
//   - 3 paragraphs, 4–6 sentences total, under 90 words
//   - Paragraph 1: who you are + the team you're part of (1–2 sentences)
//   - Paragraph 2: what priorities/challenges you work on that are
//     relevant to THEM — specific to their role/industry (2–3 sentences)
//   - Paragraph 3: assumptive close — "I'm looking to set some time"
//     NOT "is this worth a chat" or "if you're interested"
//   - Assumptive alignment: you expect this meeting to happen
//   - Eliminate ALL passive language: no "worth a chat", no "if you're free",
//     no "I was hoping", no "would love to"
//   - Subject line: specific, under 40 chars, no question mark, no "I noticed"
//   - Sign off: "Thanks in advance" — never "warmest regards" or "best"
// ─────────────────────────────────────────────────────────────
 
async function genColdEmail(F, N, leadPack, resolvedContacts) {
  const { state } = cityState(F.address);
 
  const toneInstruction = (() => {
    if (N.toneRegister === "peer")
      return "Peer-to-peer. Two professionals. You're part of a team that supports practices like theirs. Not a vendor cold calling — a resource introducing themselves.";
    if (N.toneRegister === "rescue")
      return "Direct and warm. You're a team that works on this specific problem. You're offering to show them what you found.";
    return "Helpful expert. You analyzed their site, you work on these problems, you're introducing your team.";
  })();
 
  // Connor's framework: name what priorities/challenges you solve
  // that are SPECIFIC to a dental practice — never generic
  const relevantPriorities = (() => {
    const list = [];
    if (F.speedTier === "slow" || F.speedTier === "very_slow" || F.speedTier === "critical")
      list.push("mobile load speed and patient drop-off before booking");
    if (!F.hasGA4 && !F.hasGTM)
      list.push("connecting marketing spend to actual new patient bookings");
    if (F.seoProblem)
      list.push("local search visibility for patients searching nearby");
    if (!F.hasBooking)
      list.push("after-hours appointment capture");
    if (list.length === 0)
      list.push("website performance and new patient conversion");
    return list.slice(0, 2).join(" and ");
  })();
 
  return await callText({
    temperature: 0.25,
    max_tokens:  440,
    prompt:
      // ── ROLE ──────────────────────────────────────────────
      "You are writing a cold outreach email on behalf of a web performance team that works exclusively with dental practices.\n\n"
 
      // ── FRAMEWORK ─────────────────────────────────────────
      + "FRAMEWORK (Connor Murray — Oracle #1 SDR, 2 years running):\n"
      + "3 paragraphs. 4–6 sentences total. Under 90 words. No exceptions.\n\n"
      + "PARAGRAPH 1 — WHO YOU ARE:\n"
      + "  State your name, your company/team, and who you support.\n"
      + "  Example pattern: 'My name is [NAME] and I'm part of the [team] at [company] responsible for supporting dental practices in [state].'\n"
      + "  One to two sentences. No personalization gimmicks. No 'saw we went to the same school.'\n\n"
      + "PARAGRAPH 2 — WHY YOU'RE RELEVANT:\n"
      + "  Name the specific priorities and challenges your team works on that apply to THIS practice.\n"
      + "  Relevant priorities for this practice: " + relevantPriorities + "\n"
      + "  Describe at a high level how you solve them — what outcome you deliver for practices.\n"
      + "  Two to three sentences. Industry-specific. Patient-language only — no technical jargon.\n"
      + "  The goal: when they scan this paragraph they think 'that's actually relevant to us.'\n\n"
      + "PARAGRAPH 3 — WHAT YOU WANT:\n"
      + "  Assumptive close. You are LOOKING TO set up time — not asking if they'd be interested.\n"
      + "  Propose two specific time options OR ask what their availability looks like.\n"
      + "  End with: 'Thanks in advance, [NAME]'\n"
      + "  NEVER: 'worth a chat', 'if you're interested', 'I was hoping', 'would love to', 'is this a priority'\n\n"
 
      // ── TONE ──────────────────────────────────────────────
      + "TONE: " + toneInstruction + "\n\n"
 
      // ── RULES ─────────────────────────────────────────────
      + "RULES (non-negotiable):\n"
      + "• Assumptive alignment throughout — you expect this meeting to happen\n"
      + "• Zero passive language — every sentence moves toward the meeting\n"
      + "• No jargon: no SEO, PageSpeed, GTM, pixel, bounce rate, Core Web Vitals\n"
      + "• Patient language only: 'patients searching on their phone', 'booking an appointment'\n"
      + "• ONE issue only in paragraph 2. If multiple exist, pick the most impactful.\n"
      + "• No fake personalization: no 'congrats on the new location', no 'saw your recent review'\n"
      + "• If speed is mentioned: use ONLY this phrasing: \"" + (F.speedLabel ?? "loads slower than patients expect on mobile") + "\"\n"
      + "• Numbers and PDF details are NOT in this email — that's what the meeting is for\n\n"
 
      // ── SUBJECT LINE ──────────────────────────────────────
      + "SUBJECT LINE:\n"
      + "Under 40 characters. Specific — reference something real about their practice or location.\n"
      + "No question mark. No 'I noticed'. No 'quick note'.\n"
      + "Good examples: 'Dr. Wood — mobile patients' / 'Santa Monica dental team intro' / 'Charles Wood, DDS — [team] intro'\n\n"
 
      // ── FACTS ─────────────────────────────────────────────
      + "FACTS:\n"
      + "Practice: " + F.name + (F.address ? ", " + F.address.split(",").slice(1, 3).join(",").trim() : "") + "\n"
      + (F.rating ? "Google: " + F.rating + "★ (" + (F.reviewCount ?? "?") + " reviews)\n" : "")
      + "Speed tier: " + (F.speedTier ?? "unknown") + (F.mPerf !== null ? ` (${F.mPerf}/100 mobile)` : "") + "\n"
      + "Speed label: " + (F.speedLabel ?? "N/A") + "\n"
      + "Primary issue: " + (F.oneProblem || "performance and conversion") + "\n"
      + "Online booking: " + (F.hasBooking ? "yes" + (F.bookingVendor ? " via " + F.bookingVendor : "") : "not detected") + "\n"
      + "Analytics: " + (F.hasGA4 || F.hasGTM ? "partial" : "none installed") + "\n"
      + "State: " + (state || "unknown") + "\n\n"
 
      // ── OUTPUT FORMAT ─────────────────────────────────────
      + "OUTPUT (nothing else — no preamble, no commentary):\n"
      + "SUBJECT: <subject>\n"
      + "---\n"
      + "<3 paragraphs, 4–6 sentences, under 90 words, 'Thanks in advance, [NAME]' at end>",
  });
}
 

// ─────────────────────────────────────────────────────────────
// ACT 2 — AGENT BRIEFING  (AI)
//
// PENTAGRAM BRIEF TO DEVELOPER:
//   The briefing is not a data dump. It's a performance script.
//   The agent should finish reading it and feel confident,
//   not overwhelmed. They should know exactly what to say
//   in the first 30 seconds and exactly what NOT to say.
//
//   6 lines. No more. Every line earns its place.
//   The VALIDATE line is the most important — it turns
//   the call from a pitch into a conversation.
// ─────────────────────────────────────────────────────────────

async function genAgentBriefing(F, N, leadPack, resolvedContacts) {
  const phone  = resolvedContacts?.phones?.primary ?? null;
  const src    = resolvedContacts?.phones?.primary_source ?? null;
  const conf   = resolvedContacts?.phones?.primary_confidence ?? null;

  const contactLine = [
    phone
      ? `${phone} [${src ?? "?"}${conf ? ", " + Math.round(conf * 100) + "% conf" : ""}]`
      : "no phone resolved",
    F.hasEmailOnSite ? "email on site" : "no email found",
    F.hasBooking
      ? "books online" + (F.bookingVendor ? ` (${F.bookingVendor})` : "")
      : "no online booking",
  ].join("  ·  ");

  // Tone coaching for the agent
  const toneCoach = (() => {
    if (N.toneRegister === "peer")
      return "They've built a strong practice. Lead with respect. Don't patronise.";
    if (N.toneRegister === "rescue")
      return "There's a real problem here. Be direct but warm. You're offering to help, not criticising.";
    return "Be helpful and specific. Sound like someone who did their homework.";
  })();

  return await callText({
    temperature: 0.2,
    max_tokens:  300,
    prompt:
      // ── ROLE ──────────────────────────────────────────────
      "Write a pre-call briefing for a sales agent. English. Exactly 6 lines. Copy the format exactly.\n\n"

      // ── NARRATIVE CONTEXT ─────────────────────────────────
      + "STORY WE'RE TELLING:\n"
      + "Opening: " + N.openingSentence + "\n"
      + "Tension: " + N.tensionSentence + "\n"
      + "Our offer: " + N.promiseSentence + "\n\n"

      // ── FORMAT ────────────────────────────────────────────
      + "FORMAT (copy exactly, no additions):\n"
      + "WHO:      <what makes this practice worth calling — be specific, include rating if strong>\n"
      + "NOTICED:  <the one thing we saw — patient language, shows we looked, no jargon>\n"
      + "WE OFFER: <what the PDF shows + what a fix looks like — one sentence, realistic>\n"
      + "BUDGET:   <estimate>\n"
      + "OPEN WITH: <the first sentence the agent says — natural, not scripted-sounding>\n"
      + "VALIDATE: <" + N.cta.call + ">\n\n"

      // ── TONE ──────────────────────────────────────────────
      + "AGENT TONE NOTE: " + toneCoach + "\n\n"

      // ── RULES ─────────────────────────────────────────────
      + "RULES:\n"
      + "• Never use: blank screen, broken, slow site, terrible, bad\n"
      + "• Speed language if needed: \"" + (F.speedLabel ?? "loads slower than patients expect") + "\"\n"
      + "• No tech jargon. Patient-impact language only.\n"
      + "• VALIDATE line must be a genuine question, not a pitch. The agent is confirming what we saw.\n"
      + "• OPEN WITH must sound human — not like a call centre script.\n\n"

      // ── FACTS ─────────────────────────────────────────────
      + "FACTS:\n"
      + "Practice: " + F.name + "\n"
      + (F.rating ? `Google: ${F.rating}★ (${F.reviewCount ?? "?"} reviews)\n` : "")
      + `Speed: ${F.speedTier ?? "unknown"} | ${F.speedLabel ?? "speed unknown"}\n`
      + `Mobile: ${F.mPerf ?? "N/A"}/100 · Desktop: ${F.dPerf ?? "N/A"}/100\n`
      + `Site quality: ${F.siteQuality || "not assessed"}\n`
      + `Primary issue: ${F.oneProblem || "not identified"}\n`
      + `Fix: ${F.theFix || "not specified"}\n`
      + `After-hours: ${F.afterHours || "N/A"}\n`
      + `Contact: ${contactLine}\n`
      + `Priority: ${(leadPack.priority ?? "").toUpperCase()} · Score: ${leadPack.score}/100\n`
      + `Budget: ${leadPack.estimated_budget || "unknown"}`,
  });
}

// ─────────────────────────────────────────────────────────────
// ACT 3 — CALL SCRIPT  (deterministic)
//
// FRAMEWORK: Jordan Belfort — Straight Line Persuasion
//
// PRINCIPLES:
//   - First 4 seconds: establish SHARP + ENTHUSIASTIC + EXPERT
//     simultaneously — it comes through in tonality, not just words
//   - Tonality carries 45% of communication — instructions embedded
//     throughout so the agent knows HOW to say it, not just WHAT
//   - Control = asking smart questions, letting THEM talk
//     You gather intelligence — you don't pitch
//   - Rapport = two elements:
//     1. "They care about me" — empathetic tone, specific observation
//     2. "They're just like me" — commonality, peer register
//   - Enthusiasm is just below the surface — urgency in voice
//     NOT yelling, NOT flailing — controlled energy
//   - The sale is in the VALIDATION, not the pitch
// ─────────────────────────────────────────────────────────────
 
function genCallScript(F, N) {
 
  // ── BEAT 1: First 4 seconds — Sharp + Enthusiastic + Expert ──
  // Tone instruction embedded. Agent must project all three
  // simultaneously in the first breath.
  const beat1 = (() => {
    const location = F.address ? F.address.split(",").slice(1, 2).join("").trim() : "the area";
    return (
      `Hi, I'm [Name] — `
      + `I was looking at dental practices in ${location} and spent some time on the ${F.name} website. `
      + `[TONE: calm + confident + slight urgency — like a colleague reporting a finding, not a vendor selling]`
    );
  })();
 
  // ── BEAT 2: Rapport — earned compliment, specific detail ──
  // Must feel like you actually looked. Vague = ignored.
  // "I'm just like you" element — you recognize quality.
  const beat2 = (() => {
    const signals = [];
    if (F.rating && F.rating >= 4.5)
      signals.push(`${F.rating}★ on Google with ${F.reviewCount ?? "solid"} reviews — you've clearly built something patients trust`);
    if (F.hasBooking && F.bookingVendor)
      signals.push(`online booking through ${F.bookingVendor} is set up`);
    if (F.hasChatbot)
      signals.push(`after-hours chat is running`);
    if (F.mPerf && F.mPerf >= 70)
      signals.push(`the site is technically solid`);
 
    const praise = signals.length >= 2
      ? signals.slice(0, 2).join(", ") + " — that's more than most practices have"
      : signals.length === 1
      ? signals[0]
      : cap(F.siteQuality || "the practice clearly invests in its online presence");
 
    return (
      cap(praise) + ". "
      + `That's exactly why I kept looking. And that's why one thing stood out. `
      + `[TONE: genuine — not flattery, not a pitch setup. You mean it. They feel it.]`
    );
  })();
 
  // ── BEAT 3: The one thing — visual, patient-language, certain ──
  // Tonality: certainty. This is not an opinion. You measured it.
  // Slow down on the key number/phrase. Let it land.
  const beat3 = (() => {
    const tension = N.tensionSentence;
    const impact  = F.oneCost
      ? F.oneCost
      : F.speedTier === "slow" || F.speedTier === "very_slow" || F.speedTier === "critical"
      ? "likely 3 to 5 patients a month who leave before they ever see your services"
      : null;
 
    return (
      tension + " "
      + (impact ? `${cap(impact)}. ` : "")
      + `I put the specifics in a short one-pager. `
      + `[TONE: certainty — measured, not estimated. Slow down on the key number. Full stop. Let it land.]`
    );
  })();
 
  // ── BEAT 4: Low-pressure reframe ──
  // Removes sales pressure. Positions PDF as a gift, not a hook.
  const beat4 = `The PDF is theirs to keep — not a pitch, just what we found. [TONE: relaxed, matter-of-fact]`;
 
  // ── BEAT 5: Validation question — gather intelligence ──
  // This is where you STOP TALKING and LISTEN.
  // The question confirms the pain — it doesn't introduce it.
  // Either answer works in your favor.
  const beat5 = (
    N.cta.call
    + ` [TONE: genuine curiosity — you're confirming what you saw, not pitching. STOP. LISTEN. Do not fill the silence.]`
  );
 
  return [beat1, beat2, beat3, beat4, beat5].join("\n\n");
}
 

// ─────────────────────────────────────────────────────────────
// WEBSITE ISSUES  (deterministic, internal CRM use)
// Full technical honesty here — this is for our team, not them.
// ─────────────────────────────────────────────────────────────

function genWebsiteIssues(F) {
  const parts = [];

  // Speed — precise for internal use
  if (F.mPerf !== null) {
    const speedMap = {
      fast:      `Mobile ${F.mPerf}/100 — above industry average. Not a priority issue.`,
      average:   `Mobile ${F.mPerf}/100 — acceptable. Room to improve conversion.`,
      slow:      `Mobile ${F.mPerf}/100 — ${F.slowerThan}% below industry average (65/100). Noticeable on 4G.`,
      very_slow: `Mobile ${F.mPerf}/100 — significantly below average. Conversion impact likely.`,
      critical:  `Mobile ${F.mPerf}/100 — critical. High abandon rate expected. Primary fix priority.`,
    };
    parts.push(speedMap[F.speedTier] ?? `Mobile ${F.mPerf}/100.`);
  } else if (F.speedVerdict) {
    parts.push(F.speedVerdict);
  }

  if (F.seoVerdict)   parts.push(F.seoVerdict);
  else if (F.seoProblem) parts.push(`SEO: ${F.seoProblem}.`);

  if (F.oneProblem) {
    parts.push(`Primary: ${F.oneProblem}${F.oneCost ? ` (${F.oneCost})` : ""}.`);
  } else if (F.convQuickWin) {
    parts.push(`Quick win: ${F.convQuickWin}.`);
  }

  return parts.slice(0, 3).join(" ");
}

// ─────────────────────────────────────────────────────────────
// PITCH  (deterministic, internal)
// ─────────────────────────────────────────────────────────────

function genPitch(F, leadPack) {
  return [
    `${F.name} — ${F.siteQuality || "functional site"}.`,
    `Primary opportunity: ${F.oneProblem || "performance + conversion"}${F.oneCost ? ` (${F.oneCost})` : ""}.`,
    `Proposed: ${F.theFix || "performance and conversion improvements"}.`,
    `Budget: ${leadPack.estimated_budget || "TBD"} · Priority: ${(leadPack.priority ?? "").toUpperCase()} · Score: ${leadPack.score}/100.`,
  ].join(" ");
}

// ─────────────────────────────────────────────────────────────
// LEAD RECAP  (deterministic, full CRM snapshot)
// ─────────────────────────────────────────────────────────────

function genLeadRecap(F, N, leadPack, resolvedContacts, lis) {
  const phone   = resolvedContacts?.phones?.primary ?? null;
  const pSource = resolvedContacts?.phones?.primary_source ?? null;
  const pConf   = resolvedContacts?.phones?.primary_confidence ?? null;
  const email   = resolvedContacts?.emails?.primary ?? null;

  const speedSummary = (() => {
    if (F.mPerf === null) return "N/A";
    const labels = {
      fast:      `${F.mPerf}/100 — above average`,
      average:   `${F.mPerf}/100 — average`,
      slow:      `${F.mPerf}/100 — ${F.slowerThan}% below industry avg`,
      very_slow: `${F.mPerf}/100 — significantly below average`,
      critical:  `${F.mPerf}/100 — critical`,
    };
    return labels[F.speedTier] ?? `${F.mPerf}/100`;
  })();

  const lines = [
    "━━━ LEAD RECAP ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    `LIS:      ${lis?.score ?? "N/A"}/100 (${lis?.grade ?? "?"}) — ${lis?.interpretation ?? ""}`,
    `SCORE:    ${leadPack.score}/100  ·  PRIORITY: ${(leadPack.priority ?? "").toUpperCase()}`,
    `BUDGET:   ${leadPack.estimated_budget || "unknown"}`,
    `HEALTH:   ${F.health ?? "N/A"}/100 (${F.grade ?? "?"})`,
    "",
    "NARRATIVE",
    `  HOOK:     ${N.hook.type}`,
    `  TONE:     ${N.toneRegister}`,
    `  OPENING:  ${N.openingSentence}`,
    `  TENSION:  ${N.tensionSentence}`,
    "",
    "PERFORMANCE",
    `  MOBILE:   ${speedSummary}`,
    `  DESKTOP:  ${F.dPerf ?? "N/A"}/100`,
    `  ROI:      ~$${F.monthlyLost}/mo opportunity · fix ~$${F.fixCost} · payback ~${F.payback}mo`,
    "",
    "GOOGLE",
    `  ${F.rating ? `${F.rating}★ (${F.reviewCount ?? "?"} reviews)` : "not available"}`,
    F.mapsUrl ? `  ${F.mapsUrl}` : null,
    "",
    "CONTACT",
    `  PHONE:   ${phone ? `${phone} [${pSource ?? "?"}${pConf ? `, ${Math.round(pConf * 100)}% conf]` : "]"}` : "not resolved"}`,
    `  EMAIL:   ${email ?? "not found"}`,
    `  BOOKING: ${F.hasBooking ? `yes${F.bookingVendor ? ` (${F.bookingVendor})` : ""}` : "not detected"}`,
    `  CHATBOT: ${F.hasChatbot ? "yes" : "not detected"}`,
    "",
    "TRACKING",
    `  PRESENT: ${F.trackingPresent.length ? F.trackingPresent.join(", ") : "none"}`,
    `  MISSING: ${F.trackingMissing.length ? F.trackingMissing.join(", ") : "none"}`,
    "",
    "SITE",
    `  URL:      ${F.url || "N/A"}`,
    `  ADDRESS:  ${F.address || "N/A"}`,
    `  TONE:     ${leadPack.site?.tone || "unknown"}`,
    `  SERVICES: ${(leadPack.site?.services || []).join(", ") || "unknown"}`,
    "",
    "THE OPPORTUNITY",
    `  ${F.oneProblem || "not identified"}`,
    F.oneCost ? `  COST: ${F.oneCost}` : null,
    F.theFix  ? `  FIX:  ${F.theFix}`  : null,
    "",
    `ANALYZED: ${leadPack.analyzed_at?.replace("T", " ").slice(0, 16) ?? ""}`,
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
  ];

  return lines.filter(l => l !== null).join("\n");
}

// ─────────────────────────────────────────────────────────────
// ORCHESTRATOR
// ─────────────────────────────────────────────────────────────

export async function enrichLead({ leadPack, analysis, signalReport, resolvedContacts, lis }) {
  // Step 1: Build verified facts
  const F = buildFactSheet(signalReport, analysis);

  // Step 2: Build narrative core — the story every generator follows
  const N = buildNarrativeCore(F, resolvedContacts);

  const enriched = {};

  // Deterministic fields — instant, zero AI cost
  enriched.lead_recap     = genLeadRecap(F, N, leadPack, resolvedContacts, lis);
  enriched.call_script    = genCallScript(F, N);
  enriched.website_issues = genWebsiteIssues(F);
  enriched.pitch          = genPitch(F, leadPack);

  // AI fields — 2 calls, both narrative-directed
  for (const step of [
    { key: "cold_email",     label: "Cold email",     fn: () => genColdEmail(F, N, leadPack, resolvedContacts) },
    { key: "agent_briefing", label: "Agent briefing", fn: () => genAgentBriefing(F, N, leadPack, resolvedContacts) },
  ]) {
    try {
      console.log(`   Generating ${step.label}...`);
      enriched[step.key] = await step.fn();
      console.log(`   Done: ${step.label}`);
    } catch (err) {
      console.warn(`   Failed: ${step.label} — ${err.message}`);
      enriched[step.key] = null;
    }
  }

  // Sales intelligence — zero AI cost
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
      primary_phone: resolvedContacts?.phones?.primary  ?? null,
      primary_email: resolvedContacts?.emails?.primary  ?? null,
      phones:        resolvedContacts?.phones ?? {},
      emails:        resolvedContacts?.emails ?? {},
    },
    enriched,
    narrative: {                          // Exposed for debugging + CRM display
      hook:          N.hook.type,
      tone_register: N.toneRegister,
      opening:       N.openingSentence,
      tension:       N.tensionSentence,
      promise:       N.promiseSentence,
      effort_proof:  N.effortProof,
      validate_q:    N.cta.call,
    },
    sales_intel: {
      seasonal_angle:     seasonal,
      competitor_context: competitor,
      subject_matrix:     subjects,
      objection_map:      objections,
      outreach_sequence:  sequence,
    },
  };
}