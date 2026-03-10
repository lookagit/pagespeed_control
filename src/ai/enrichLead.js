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
// PENTAGRAM BRIEF TO DEVELOPER:
//   This email is a door, not a pitch deck.
//   It should feel like it was written by one intelligent person
//   who spent 20 minutes on their site and noticed one thing.
//   It does NOT reveal the full audit. It opens a question.
//   The subject line is the headline of a story, not a sales tag.
//   Length: 4 sentences. Under 85 words. No exceptions.
//
//   Narrative flow:
//     S1 — Proof of effort: something specific we saw
//     S2 — The PDF exists: "one-pager, yours to keep"
//     S3 — No pressure: "no call needed, no strings"
//     S4 — Single question: "Want me to send it?"
// ─────────────────────────────────────────────────────────────

async function genColdEmail(F, N, leadPack, resolvedContacts) {
  const { state }   = cityState(F.address);
  const subjectHint = F.subjects.length
    ? "\nSubject line ideas (adapt freely, don't copy):\n"
      + F.subjects.slice(0, 3).map(s => "  — " + s).join("\n")
    : "";

  // Tone instruction varies by register
  const toneInstruction = (() => {
    if (N.toneRegister === "peer")
      return "Peer-to-peer. You're one professional who noticed something talking to another. Not a vendor.";
    if (N.toneRegister === "rescue")
      return "Warm and direct. There's something fixable here and you're offering to show it — no drama.";
    return "Helpful expert. You looked, you noticed, you're offering to share. Low pressure.";
  })();

  // What "proof of effort" signals to weave in naturally
  const effortContext = N.effortProof.length
    ? "Proof of effort (weave in naturally — don't list):\n" + N.effortProof.map(e => "  • " + e).join("\n")
    : "";

  return await callText({
    temperature: 0.28,
    max_tokens:  440,
    prompt:
      // ── ROLE ──────────────────────────────────────────────
      "You are a solo web consultant — not an agency — writing a cold outreach email to a dental practice owner.\n\n"

      // ── NARRATIVE BRIEF ───────────────────────────────────
      + "NARRATIVE:\n"
      + "Opening observation: " + N.openingSentence + "\n"
      + "The tension: " + N.tensionSentence + "\n"
      + "What the PDF offers: " + N.promiseSentence + "\n\n"

      // ── TONE ──────────────────────────────────────────────
      + "TONE: " + toneInstruction + "\n\n"

      // ── STRUCTURE ─────────────────────────────────────────
      + "STRUCTURE — exactly 4 sentences, under 85 words total:\n"
      + "S1: ONE specific observation that proves you looked at their site. Include a detail.\n"
      + "S2: \"I put it together in a short one-page PDF" + (state ? ` — includes a quick comparison to other practices in ${state}` : "") + ".\"\n"
      + "S3: \"Yours to keep — no call needed, no strings attached.\"\n"
      + "S4: \"" + N.cta.email + "\" — nothing else after this.\n\n"

      // ── HARD RULES ────────────────────────────────────────
      + "RULES (non-negotiable):\n"
      + "• Never say: blank screen, broken, terrible, slow, failing, bad, poor\n"
      + "• If speed is mentioned, use ONLY this phrasing: \"" + (F.speedLabel ?? "loads slower than patients expect on mobile") + "\"\n"
      + "• No jargon: no SEO, PageSpeed, Core Web Vitals, GTM, pixel, bounce rate, schema, analytics\n"
      + "• Patient language only: 'patients searching on their phone', 'booking an appointment online'\n"
      + "• Hint at numbers — don't reveal them. Numbers go in the PDF.\n"
      + "• ONE issue only. If multiple exist, pick the most human one.\n"
      + "• If site is genuinely strong — lead with that. Don't manufacture urgency.\n\n"

      // ── FACTS ─────────────────────────────────────────────
      + "FACTS (use only what's relevant, omit nulls):\n"
      + "Practice: " + F.name + (F.address ? ", " + F.address.split(",").slice(1, 3).join(",").trim() : "") + "\n"
      + (F.rating ? "Google: " + F.rating + "★ (" + (F.reviewCount ?? "?") + " reviews)\n" : "")
      + "Site quality: " + (F.siteQuality || "functional") + "\n"
      + "Speed tier: " + (F.speedTier ?? "unknown") + (F.mPerf !== null ? ` (${F.mPerf}/100 mobile)` : "") + "\n"
      + "Speed label: " + (F.speedLabel ?? "N/A") + "\n"
      + "Primary issue: " + (F.oneProblem || "performance and conversion") + "\n"
      + "Online booking: " + (F.hasBooking ? "yes" + (F.bookingVendor ? " via " + F.bookingVendor : "") : "not detected") + "\n"
      + "Analytics installed: " + (F.hasGA4 || F.hasGTM ? "yes" : "no") + "\n"
      + (effortContext ? effortContext + "\n" : "")
      + subjectHint + "\n\n"

      // ── OUTPUT FORMAT ─────────────────────────────────────
      + "SUBJECT LINE: Under 40 chars. Specific — reference something real. No question mark. No 'I noticed'.\n"
      + "Good examples: 'Quick note on [Practice]' / 'Something I noticed on mobile' / '[City] dental — one thing'\n\n"
      + "OUTPUT (nothing else, no preamble, no sign-off instructions):\n"
      + "SUBJECT: <subject>\n"
      + "---\n"
      + "<4 sentences, under 85 words>",
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
// PENTAGRAM BRIEF TO DEVELOPER:
//   The call is not a pitch. By this point, they may have
//   seen the email, maybe the PDF. They know we looked.
//   The agent's job is to VALIDATE what we found —
//   confirm it's real, confirm it matters to them.
//   The sale happens in the validation, not the pitch.
//
//   5 beats. Each has a job. None is optional.
// ─────────────────────────────────────────────────────────────

function genCallScript(F, N) {
  // Beat 1 — Identity + instant credibility
  const beat1 = `Hi, I'm [Name] — I was looking at dental practices in the area and spent some time on the ${F.name} website.`;

  // Beat 2 — The compliment that's earned, not generic
  const beat2 = (() => {
    if (F.rating && F.rating >= 4.5)
      return `${F.rating}★ on Google with ${F.reviewCount ?? "solid"} reviews — clearly doing something right.`;
    if (F.siteQuality && (F.siteQuality.includes("strong") || F.siteQuality.includes("well")))
      return cap(F.siteQuality) + ".";
    if (F.hasBooking)
      return "The site is well set up — online booking, clear services.";
    return "The practice clearly invests in presenting itself well.";
  })();

  // Beat 3 — The one thing we noticed (from narrative core)
  const beat3 = (() => {
    if (N.hook.type === "speed_critical" || N.hook.type === "reputation_strong")
      return `${N.tensionSentence} I put the specifics in a short one-pager.`;
    if (N.hook.type === "booking_gap")
      return `We noticed patients who find you after hours have no way to request an appointment online. Wrote it up in a one-pager.`;
    if (N.hook.type === "blind_marketing")
      return `We noticed there's no way currently to see which marketing is driving appointments. Short summary in the PDF.`;
    return `${N.tensionSentence} Put it together in a short one-pager.`;
  })();

  // Beat 4 — Low pressure reframe
  const beat4 = `The PDF is theirs to keep — not a pitch, just what we found.`;

  // Beat 5 — The validate question (from narrative core)
  const beat5 = N.cta.call;

  return [beat1, beat2, beat3, beat4, beat5].join(" ");
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