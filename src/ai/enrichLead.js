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

const SYSTEM_COLD_EMAIL =
  "You are a solo web consultant writing cold emails to dental practice owners. "
  + "You are one person on a small team — not an agency, not a platform.\n\n"
  + "<absolute_rules>\n"
  + "- Write how you talk. Informal. Contractions OK.\n"
  + "- It's about THEM not you. No sentence starts with 'We'.\n"
  + "- One issue only. One ask only.\n"
  + "- No jargon: no SEO, PageSpeed, GTM, Core Web Vitals, pixel, analytics, schema.\n"
  + "- No fake personalization: no 'congrats on the new location', no 'love what you're building'.\n"
  + "- Banned phrases: 'worth a chat', 'if you're interested', 'I was hoping', 'would love to'.\n"
  + "- Numbers stay in the PDF — email only hints at the finding.\n"
  + "- Output only what's asked. No preamble. No commentary.\n"
  + "</absolute_rules>";
 
 
async function genColdEmail(F, N, leadPack, resolvedContacts) {
  const { state } = cityState(F.address);
  const speedPhrase = F.speedLabel ?? "loads slower than patients expect on mobile";
 
  // ── PRE-COMPUTE (deterministic, zero AI cost) ─────────────
  const problem = (() => {
    if (F.speedTier === "slow" || F.speedTier === "very_slow" || F.speedTier === "critical")
      return `site ${speedPhrase}`;
    if (!F.hasGA4 && !F.hasGTM)
      return "no way to know which marketing is bringing patients in";
    if (F.seoProblem)
      return "patients nearby may not be finding them in search";
    if (!F.hasBooking)
      return "patients who find them after hours have no way to book";
    return "website performance costing new patients before they reach booking";
  })();
 
  const proof = (() => {
    if (F.rating && F.rating >= 4.7 && F.reviewCount > 50)
      return `${F.rating}★ across ${F.reviewCount} reviews`;
    if (F.hasBooking && F.bookingVendor) return `${F.bookingVendor} booking`;
    if (F.hasChatbot) return "after-hours chat";
    if (F.mPerf >= 75)  return `strong desktop score (${F.dPerf}/100)`;
    return null;
  })();
 
  // Structured facts block — same format every time, XML-tagged
  const factsXml =
    "<facts>\n"
    + `  <practice>${F.name}${F.address ? ", " + F.address.split(",").slice(1,3).join(",").trim() : ""}</practice>\n`
    + (F.rating ? `  <google>${F.rating}★ (${F.reviewCount ?? "?"} reviews)</google>\n` : "")
    + `  <mobile>${F.mPerf ?? "unknown"}/100 — ${F.speedTier ?? "unknown"}</mobile>\n`
    + `  <problem>${problem}</problem>\n`
    + (proof ? `  <proof_of_research>${proof}</proof_of_research>\n` : "")
    + `  <booking>${F.hasBooking ? (F.bookingVendor ?? "yes") : "none"}</booking>\n`
    + `  <state>${state ?? "unknown"}</state>\n`
    + "</facts>";
 
  // ── P1: ANALYZE ───────────────────────────────────────────
  // Job: one sentence — the human problem a patient would feel
  // System: shared role + constraints
  // User: facts only
  // Prefill: forces answer format immediately
 
  const p1 = await callText({
    temperature: 0.0,
    max_tokens: 60,
    system: SYSTEM_COLD_EMAIL,
    prefill: "The one thing a patient would notice: ",
    prompt:
      "From these facts, identify the ONE problem a patient would actually feel.\n"
      + "One sentence. Patient language. No jargon.\n\n"
      + factsXml,
  });
 
  // ── P2: DRAFT ─────────────────────────────────────────────
  // Job: write the full email — 3 paragraphs, under 90 words
  // Uses XML to separate: role context / analysis / structure / examples
 
  const p2 = await callText({
    temperature: 0.2,
    max_tokens: 200,
    system: SYSTEM_COLD_EMAIL,
    prefill: "Hi [First Name],\n\n",
    prompt:
      "<task>Write a cold email to a dental practice owner.</task>\n\n"
      + "<analysis>" + p1.trim() + "</analysis>\n\n"
      + factsXml + "\n\n"
      + "<structure>\n"
      + "  P1 (1-2 sentences): who you are + specific proof you looked at them\n"
      + "  P2 (2 sentences): the problem — what their patients experience\n"
      + "  P3 (1 sentence, standalone): 'I put it in a one-pager — yours to keep, no strings. Want me to send it?'\n"
      + "  Sign-off: 'Thanks in advance,' on its own line\n"
      + "</structure>\n\n"
      + "<examples>\n"
      + "  <good_p2>Your site " + speedPhrase + " — that's likely costing you patients before they ever see what you offer.</good_p2>\n"
      + "  <bad_p2>We analyzed your website and found performance issues affecting your conversion rate.</bad_p2>\n"
      + "</examples>\n\n"
      + "Under 90 words total. Fits on one phone screen.",
  });
 
  // ── P3: REVIEW ────────────────────────────────────────────
  // Job: score the draft against 5 criteria
  // Temperature 0.0 — scoring must be consistent
  // Output: JSON scores + one note per failure
 
  const p3 = await callText({
    temperature: 0.0,
    max_tokens: 150,
    system: "You are a cold email quality reviewer. Output only valid JSON. No commentary.",
    prefill: "{",
    prompt:
      "<task>Score this cold email draft. Output JSON only.</task>\n\n"
      + "<draft>" + p2.trim() + "</draft>\n\n"
      + "<criteria>\n"
      + "  reader_focused: no sentence starts with 'We', all about their practice (0-10)\n"
      + "  assumptive_cta: CTA expects yes, not asking if interested (0-10)\n"
      + "  under_90_words: total word count under 90 (0-10)\n"
      + "  human_tone: sounds like a person, not a template (0-10)\n"
      + "  one_issue: only one problem mentioned (0-10)\n"
      + "</criteria>\n\n"
      + "Format: {\"scores\":{\"reader_focused\":N,\"assumptive_cta\":N,\"under_90_words\":N,\"human_tone\":N,\"one_issue\":N},\"fix\":\"one sentence on biggest issue or null\"}",
  });
 
  // Parse review — fallback gracefully if JSON breaks
  let review = { scores: {}, fix: null };
  try {
    review = JSON.parse("{" + p3.trim());
  } catch {
    // If parse fails, skip refinement and use draft
  }
 
  const needsRefinement = review.fix !== null
    && Object.values(review.scores).some(s => s < 7);
 
  // ── P4: REFINE (conditional) ──────────────────────────────
  // Only runs if review found issues
  // Surgical fix — change as little as possible
 
  const finalEmail = needsRefinement
    ? await callText({
        temperature: 0.2,
        max_tokens: 200,
        system: SYSTEM_COLD_EMAIL,
        prefill: "Hi [First Name],\n\n",
        prompt:
          "<task>Fix ONLY the issue below in this email. Change as little as possible.</task>\n\n"
          + "<draft>" + p2.trim() + "</draft>\n\n"
          + "<fix_needed>" + (review.fix ?? "") + "</fix_needed>\n\n"
          + "Keep everything else identical. Under 90 words total.",
      })
    : p2;
 
  // ── P5: SUBJECT LINE ──────────────────────────────────────
  // Dedicated step — subject line is high-leverage, deserves focus
  // Slightly higher temp (0.3) — most creative step
 
  const subject = await callText({
    temperature: 0.3,
    max_tokens: 30,
    system: "Output only the subject line. Nothing else. No quotes.",
    prefill: "",
    prompt:
      "<task>Write one subject line for this cold email.</task>\n\n"
      + "<email>" + finalEmail.trim() + "</email>\n\n"
      + "<rules>\n"
      + "  - Under 40 characters\n"
      + "  - Reference the doctor's name or city — something real\n"
      + "  - No question mark\n"
      + "  - No 'I noticed', no 'quick note', no 'one thing'\n"
      + "  - Feels like it came from a human\n"
      + "</rules>\n\n"
      + "<examples>\n"
      + "  <good>Dr. Wood — mobile patients</good>\n"
      + "  <good>Santa Monica dental</good>\n"
      + "  <bad>Quick note on your website</bad>\n"
      + "  <bad>I noticed something</bad>\n"
      + "</examples>\n\n"
      + "Practice: " + F.name,
  });
 
  return `SUBJECT: ${subject.trim()}\n---\n${finalEmail.trim()}`;
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
//   - First 4 seconds: project SHARP + ENTHUSIASTIC + EXPERT
//     simultaneously — through tonality, not just words
//     (45% tonality, 45% body language, 10% words)
//   - Enthusiasm is just below the surface — urgency in voice.
//     NOT excited. NOT flailing. Controlled energy.
//   - Rapport = two things the prospect must feel:
//     1. "This person cares about me" — empathetic tone, specific detail
//     2. "They're like me" — peer register, earned compliment
//   - Control = you ask smart questions, THEY talk.
//     You gather intelligence. You don't pitch.
//   - "You do the math" — let them calculate the loss themselves.
//     Never tell them what to conclude.
//   - The sale is in the VALIDATION question, not the pitch.
//     Either answer works in your favor.
// ─────────────────────────────────────────────────────────────
 
function genCallScript(F, N) {
 
  // ── BEAT 1: First 4 seconds ───────────────────────────────
  //
  // Goal: establish all three simultaneously in the first breath.
  //   SHARP      — you know exactly why you're calling
  //   ENTHUSIASTIC — urgency just below the surface, not hype
  //   EXPERT     — colleague reporting a finding, not a vendor selling
  //
  // What NOT to say:
  //   ✗ "I was hoping to speak with..."  → weak, passive
  //   ✗ "Do you have a minute?"          → gives them an exit
  //   ✗ "I just wanted to..."            → undermines authority
  // ─────────────────────────────────────────────────────────
  const beat1 = (() => {
    const { city, stateCode } = extractLocation(F.address);
    const location = city || stateCode || "the area";
 
    return (
      `Hi, may I speak with Dr. ${F.doctorName ?? "[Name]"} — `
      + `my name is [NAME]. `
      + `We analyze website performance for dental practices in ${location}, `
      + `and I was looking at the ${F.name} site — `
      + `I noticed something specific that's likely affecting your new patient flow. `
      + `\n[TONE: calm + measured + slight urgency beneath the surface. `
      + `Sound like a colleague who found something, not a vendor who wants to sell something. `
      + `Pacing: don't rush. The confidence is in the pace.]`
    );
  })();
 
  // ── BEAT 2: Rapport — earned, specific, peer-to-peer ─────
  //
  // Belfort rule: rapport is NOT flattery.
  // Rapport is two things:
  //   "They care about me"  → you noticed real things about their practice
  //   "They're like me"     → peer register, you recognize quality
  //
  // Must use real data. Vague = they know you didn't look.
  // Specific = they believe everything else you say.
  // ─────────────────────────────────────────────────────────
  const beat2 = (() => {
    const signals = [];
 
    if (F.rating && F.rating >= 4.5 && F.reviewCount)
      signals.push(
        `${F.rating} stars on Google with ${F.reviewCount} reviews — `
        + `that kind of reputation takes real work to build`
      );
    else if (F.rating && F.rating >= 4.0)
      signals.push(`solid ${F.rating}-star reputation on Google`);
 
    if (F.hasBooking && F.bookingVendor)
      signals.push(`you've got online booking through ${F.bookingVendor} running`);
    else if (F.hasBooking)
      signals.push(`online booking is already set up`);
 
    if (F.hasChatbot)
      signals.push(`the after-hours chat is live`);
 
    if (F.dPerf && F.dPerf >= 85 && (!F.mPerf || F.mPerf < 70))
      signals.push(`the desktop site is technically clean — ${F.dPerf}/100`);
 
    // Build the compliment — always 2 specifics if possible
    const praise = signals.length >= 2
      ? `${cap(signals[0])}, and ${signals[1]} — honestly, that's more set up than most practices in the area`
      : signals.length === 1
      ? cap(signals[0])
      : cap(F.siteQuality || `the practice clearly has the fundamentals in place`);
 
    return (
      praise + `. `
      + `That's exactly why what I found stood out. `
      + `\n[TONE: genuine — you mean every word. This is not a setup line. `
      + `Not flattery. They will feel the difference. `
      + `Slow down slightly on the compliment — let them receive it.]`
    );
  })();
 
  // ── BEAT 3: The one thing — visual, patient-language ──────
  //
  // Belfort: "certainty tone" — this is not an opinion.
  // You measured it. You're reporting it.
  //
  // Patient language, not tech language:
  //   ✗ "mobile performance score is below average"
  //   ✓ "blank white screen for 15 seconds before anything loads"
  //
  // "You do the math" principle:
  //   State the fact. State the patient behavior. Let THEM calculate the loss.
  //   Don't tell them what it costs — let them feel it themselves.
  // ─────────────────────────────────────────────────────────
  const beat3 = (() => {
    const tension = N.tensionSentence;
 
    // Patient cost — either from analysis or derived from speed tier
    const patientCost = F.oneCost
      || (
        (F.speedTier === "slow" || F.speedTier === "very_slow" || F.speedTier === "critical")
          ? `likely 3 to 5 patients a month who give up before they even see what you offer`
          : null
      );
 
    const mathLine = patientCost
      ? `That's ${patientCost}. You do the math on what each new patient is worth. `
      : ``;
 
    return (
      tension + ` `
      + mathLine
      + `I put together a one-page breakdown of exactly what's causing it and what a fix looks like. `
      + `\n[TONE: certainty. Slow down on the key number or phrase. `
      + `Full stop after the patient cost. `
      + `Let it land. Do NOT rush past it to the PDF offer. `
      + `The silence after that number is working for you.]`
    );
  })();
 
  // ── BEAT 4: Micro-yes — remove all pressure ───────────────
  //
  // Belfort: "reasonable man" tone.
  // This is the obviously sensible next step. Not a pitch. Not an ask.
  // The PDF is a gift. They can take it or leave it.
  // The micro-yes is: just an email address. That's it.
  // ─────────────────────────────────────────────────────────
  const beat4 = (
    `It's one page — what the issue is, what it's costing, and what a fix looks like. `
    + `Yours to keep, no obligation. `
    + `I can send it to ${F.crawlerEmails?.[0] ?? "[their email]"} — `
    + `or whatever address works best for you. `
    + `\n[TONE: matter-of-fact. "Reasonable man" register — `
    + `this is just the obvious next step, not a pitch. `
    + `Not excited. Not urgent. Just sensible. `
    + `Pause after "no obligation" — let the low pressure land.]`
  );
 
  // ── BEAT 5: Validation question — gather intelligence ─────
  //
  // Belfort: this is where you STOP TALKING.
  // The question does NOT introduce the problem — it confirms it.
  // Either answer moves you forward:
  //   "Yes, we've noticed" → pain confirmed, they're sold
  //   "No, we haven't"    → you're the expert who saw what they missed
  //
  // The silence after the question is the most important moment.
  // ─────────────────────────────────────────────────────────
  const beat5 = (
    N.cta.call
    + ` `
    + `\n[TONE: genuine curiosity. You're not closing. You're confirming. `
    + `ASK THE QUESTION. STOP. `
    + `Do not fill the silence. `
    + `Do not add "...or would you prefer email?" `
    + `The first person who speaks loses. Let it be them.]`
  );
 
  // ── OBJECTIONS ────────────────────────────────────────────
  //
  // Belfort: every objection is a buying signal in disguise.
  // Don't fight it. Acknowledge it. Reframe it. Move forward.
  // Micro-yes: all roads lead to "can I send you the PDF?"
  // ─────────────────────────────────────────────────────────
  const objections = buildObjectionSection(F);
 
  return [beat1, beat2, beat3, beat4, beat5, objections].join("\n\n");
}
 
 
// ── HELPERS ───────────────────────────────────────────────────
 
function extractLocation(address) {
  if (!address) return { city: null, stateCode: null };
  const parts = String(address).split(",").map(s => s.trim()).filter(Boolean);
  const city      = parts[1] ?? null;
  const stateCode = parts[2] ? parts[2].trim().split(/\s+/)[0] : null;
  return { city, stateCode };
}
 
function buildObjectionSection(F) {
  const email = F.crawlerEmails?.[0] ?? "[their email]";
 
  const base = [
    `── OBJECTIONS ─────────────────────────────────────────────`,
    ``,
    `"No time right now"`,
    `→ "Completely understood — that's exactly why I'm sending it written.`,
    `   Look at it when it suits you. Which email should I use?"`,
    `   [TONE: unfazed. This is still the reasonable next step.]`,
    ``,
    `"Who are you exactly?"`,
    `→ "Good question — we analyze web performance for dental practices across the area.`,
    `   Your site came up in our data and the number was specific enough that I wanted to flag it directly."`,
    `   [TONE: confident, not defensive. You expected the question. You have the answer.]`,
    ``,
    `"We already have someone for the website"`,
    `→ "That's great — means you have the infrastructure. This is one specific issue with mobile speed.`,
    `   I can send the PDF so you or your team can take a look — sometimes it's a quick fix`,
    `   once someone knows exactly where to look."`,
    `   [TONE: collaborative, not competitive. You're helping their team, not replacing it.]`,
  ];
 
  // Budget objection only added if budget is lower tier
  if (F.budget && (F.budget.includes("1k") || F.budget.includes("3k"))) {
    base.push(
      ``,
      `"Not spending on the website right now"`,
      `→ "Totally fair — the PDF is free. No pitch, just the data.`,
      `   You decide if and when it's worth acting on. Can I send it to ${email}?"`,
      `   [TONE: zero pressure. You're leaving the door open, not blocking it.]`
    );
  }
 
  return base.join("\n");
}
 
function cap(str) {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
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