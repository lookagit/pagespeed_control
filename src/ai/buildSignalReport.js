// ============================================================
// buildSignalReport.js  v2
// Ulaz:  callReport  (output od buildCallReport())
// Izlaz: čist, AI-ready signal JSON
// ============================================================

// ─── HELPERS ─────────────────────────────────────────────────

function grade(score) {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  return "D";
}

// ─── CHECKERS ────────────────────────────────────────────────

function checkSEO(cr) {
  const s     = cr.seo ?? {};
  const score = cr.scores?.mobile_seo ?? 0;
  const issues = [];

  if (score < 85) issues.push(`skor ${score}/100`);

  // Podržava oba oblika: raw callReport (has_meta_description) i već procesovan (nema tog polja — proveravamo score)
  if ("has_meta_description" in s && !s.has_meta_description) issues.push("nema meta description");
  if ("has_canonical"        in s && !s.has_canonical)        issues.push("nema canonical");

  // has_structured_data (raw) ili has_schema (procesovan)
  const hasSchema = s.has_structured_data ?? s.has_schema ?? true;
  if (!hasSchema) issues.push("nema schema.org");

  // images_without_alt (raw) ili images_no_alt (procesovan)
  const noAlt = s.images_without_alt ?? s.images_no_alt ?? 0;
  if (noAlt > 0) issues.push(`${noAlt} slike bez alt`);

  const ok = issues.length === 0;
  return {
    key:   "seo",
    label: "SEO",
    ok,
    flag:  !ok,
    score,
    grade: grade(score),
    details: {
      title:            s.title ?? null,
      h1:               s.h1_text ?? s.h1 ?? null,
      word_count:       s.word_count ?? 0,
      has_schema:       !!hasSchema,
      schema_type:      s.structured_data_type ?? s.schema_type ?? null,
      has_canonical:    s.has_canonical ?? s.has_canonical ?? true,
      has_og:           s.has_open_graph ?? s.has_og ?? true,
      images_total:     s.image_count ?? s.images_total ?? 0,
      images_no_alt:    noAlt,
      has_https_forms:  !!s.has_https_forms,
      has_lazy_loading: !!s.has_lazy_loading,
    },
    note: ok ? null : `Problemi: ${issues.join(" · ")}`,
  };
}

function checkMobileSpeed(cr) {
  const perf = cr.scores?.mobile_perf ?? 0;

  // Podržava oba oblika:
  //   raw callReport  → cr.vitals_mobile + cr.resources_mobile
  //   procesovan      → cr.vitals (već flatovan sa page_weight i http_requests unutra)
  const v   = cr.vitals_mobile ?? cr.vitals ?? {};
  const res = cr.resources_mobile ?? {};

  // page_weight i http_requests mogu biti u vitals (procesovan) ili resources_mobile (raw)
  const pageWeight   = res.page_weight   ?? v.page_weight   ?? null;
  const httpRequests = res.requests      ?? v.http_requests ?? null;

  const issues = [];
  if (perf < 85)                              issues.push(`perf ${perf}/100`);
  if (v.lcp?.status  === "poor")              issues.push(`LCP ${v.lcp.value}`);
  if (v.fcp?.status  === "poor")              issues.push(`FCP ${v.fcp.value}`);
  if (v.tti?.status  === "poor")              issues.push(`TTI ${v.tti.value}`);
  if (v.tti?.status  === "warn")              issues.push(`TTI ${v.tti.value}`);
  if (pageWeight?.status   === "poor")        issues.push(`težina ${pageWeight.value}`);
  if (pageWeight?.status   === "warn")        issues.push(`težina ${pageWeight.value}`);
  if (httpRequests?.status === "poor")        issues.push(`${httpRequests.value} HTTP zahteva`);
  if (httpRequests?.status === "warn")        issues.push(`${httpRequests.value} HTTP zahteva`);

  const ok = issues.length === 0;
  return {
    key:   "mobile_speed",
    label: "Mobilna brzina",
    ok,
    flag:  !ok,
    score: perf,
    grade: grade(perf),
    details: {
      mobile_perf:   perf,
      desktop_perf:  cr.scores?.desktop_perf ?? 0,
      lcp:           v.lcp   ?? null,
      fcp:           v.fcp   ?? null,
      tbt:           v.tbt   ?? null,
      cls:           v.cls   ?? null,
      ttfb:          v.ttfb  ?? null,
      tti:           v.tti   ?? null,
      si:            v.si    ?? null,
      page_weight:   pageWeight    ?? null,
      http_requests: httpRequests  ?? null,
    },
    note: ok ? null : `Spor na mobilnom: ${issues.join(" · ")}`,
  };
}

function checkBooking(cr) {
  const has         = cr.has_online_booking ?? cr.booking?.has_booking ?? false;
  const cta         = cr.ctas?.[0] ?? null;
  const bookingData = cr.booking ?? {};
  return {
    key:   "booking",
    label: "Online booking",
    ok:    !!has,
    flag:  !has,
    details: {
      has_booking:    !!has,
      vendor:         cr.booking_vendor  ?? bookingData.vendor  ?? null,
      type:           cr.booking_type    ?? bookingData.type    ?? null,
      cta_above_fold: cta?.above_fold    ?? bookingData.cta_above_fold ?? false,
      cta_inferred:   cta?.inferred      ?? bookingData.cta_inferred   ?? false,
    },
    note: has ? null : "Nema online zakazivanja — pacijenti moraju da zovu",
  };
}

function checkChatbot(cr) {
  // raw: cr.tracking.has_chatbot (boolean)
  // procesovan: status.chatbot.ok or not in tracking.missing
  const rawHas = cr.tracking?.has_chatbot;
  const statusOk = cr.status?.chatbot?.ok;
  const has = rawHas !== undefined ? !!rawHas
            : statusOk !== undefined ? statusOk
            : !(cr.tracking?.missing ?? []).includes("chatbot");

  return {
    key:   "chatbot",
    label: "Chatbot / live chat",
    ok:    has,
    flag:  !has,
    details: {
      has_chatbot: has,
      vendor:      cr.tracking?.chatbot_vendor ?? null,
    },
    note: has ? null : "Nema chatbota — posetioci odlaze bez kontakta van radnog vremena",
  };
}

function checkTracking(cr) {
  const t = cr.tracking ?? {};

  // raw callReport  → has_ga4, has_gtm, has_meta_pixel, has_google_ads (boolean)
  // procesovan      → present: [...], missing: [...] (array)
  let present, missing;
  if (Array.isArray(t.present) || Array.isArray(t.missing)) {
    present = t.present ?? [];
    missing = t.missing ?? [];
  } else {
    const TOOLS = [
      { label: "GA4",              has: !!t.has_ga4 },
      { label: "GTM",              has: !!t.has_gtm },
      { label: "Meta Pixel",       has: !!t.has_meta_pixel },
      { label: "Google Ads pixel", has: !!t.has_google_ads },
    ];
    present = TOOLS.filter(x =>  x.has).map(x => x.label);
    missing = TOOLS.filter(x => !x.has).map(x => x.label);
  }

  const ok = missing.length === 0;
  return {
    key:   "tracking",
    label: "Tracking",
    ok,
    flag:  true,
    details: {
      present,
      missing,
      has_ga4:        present.includes("GA4"),
      has_gtm:        present.includes("GTM"),
      has_meta_pixel: present.includes("Meta Pixel"),
      has_google_ads: present.includes("Google Ads pixel"),
    },
    note: ok ? "Kompletno praćenje" : `Nedostaje: ${missing.join(", ")}`,
  };
}


function checkContact(cr) {
  const phones = cr.phones ?? cr.contact?.phones ?? [];
  const emails = cr.emails ?? cr.contact?.emails ?? [];
  const issues = [];
  if (!emails.length) issues.push("email nije detektovan na sajtu");

  return {
    key:   "contact",
    label: "Kontakt info",
    ok:    issues.length === 0,
    flag:  issues.length > 0,
    details: { phones, emails, phone_count: phones.length, email_count: emails.length },
    note: issues.length ? issues.join(" · ") : null,
  };
}

function checkTechStack(cr) {
  // raw: cr.tech_stack (array of objects)
  // procesovan: cr.tech.cms + cr.tech.full (already formatted)
  const stack = cr.tech_stack ?? [];
  const cms   = stack.find(t => t.category === "CMS");
  return {
    key:   "tech_stack",
    label: "Tech stack",
    ok:    true,
    flag:  false,
    details: {
      cms:  cms?.name ?? cr.tech?.cms ?? null,
      full: stack.length ? stack.map(t => `${t.name} (${t.category})`) : (cr.tech?.full ?? []),
    },
    note: null,
  };
}

// ─── MAIN EXPORT ─────────────────────────────────────────────

export function buildSignalReport(callReport) {
  const checks = [
    checkSEO(callReport),
    checkMobileSpeed(callReport),
    checkBooking(callReport),
    checkChatbot(callReport),
    checkTracking(callReport),
    checkContact(callReport),
    checkTechStack(callReport),
  ];

  const problems = checks
    .filter(c => c.flag && !c.ok)
    .map(c => ({ key: c.key, label: c.label, note: c.note }));

  const get = (key) => checks.find(c => c.key === key);

  return {

    // ── 1. IDENTITET ────────────────────────────────────
    // Podržava i raw callReport i već procesovan signalReport
    meta: {
      name:        callReport.name        ?? callReport.meta?.name        ?? null,
      url:         callReport.website_url ?? callReport.meta?.url         ?? null,
      address:     callReport._originalLead?.address ?? callReport.address ?? callReport.meta?.address ?? null,
      health:      callReport.health_score ?? callReport.meta?.health     ?? null,
      grade:       callReport.health_grade ?? callReport.meta?.grade      ?? null,
      temperature: callReport.lead_temperature?.temperature ?? callReport.meta?.temperature ?? null,
      analyzed_at: callReport.processed_at ?? callReport.meta?.analyzed_at ?? new Date().toISOString(),
    },

    // ── 2. PROBLEMI — direktno za AI prompt / mejl ──────
    // Svaki item = jedna konkretna stvar koju možeš pomenuti.
    // Ako je items: [] → lead je čist, nema pitch angle-a.
    problems: {
      count: problems.length,
      items: problems,
    },

    // ── 3. LIGHTHOUSE SCOREVI ───────────────────────────
    scores: {
      mobile_perf:  callReport.scores?.mobile_perf  ?? null,
      mobile_seo:   callReport.scores?.mobile_seo   ?? null,
      mobile_acc:   callReport.scores?.mobile_acc   ?? null,
      mobile_bp:    callReport.scores?.mobile_bp    ?? null,
      desktop_perf: callReport.scores?.desktop_perf ?? null,
      desktop_seo:  callReport.scores?.desktop_seo  ?? null,
    },

    // ── 4. CORE WEB VITALS ──────────────────────────────
    vitals: get("mobile_speed")?.details ?? {},

    // ── 5. SEO ─────────────────────────────────────────
    seo: get("seo")?.details ?? {},

    // ── 6. TRACKING ────────────────────────────────────
    tracking: {
      present: get("tracking")?.details?.present ?? [],
      missing: get("tracking")?.details?.missing ?? [],
    },

    // ── 7. BOOKING & CTA ───────────────────────────────
    booking: get("booking")?.details ?? {},

    // ── 8. KONTAKT ─────────────────────────────────────
    contact: get("contact")?.details ?? {},

    // ── 9. TECH STACK ──────────────────────────────────
    tech: get("tech_stack")?.details ?? {},

    // ── 10. FLAT STATUS — za brzu provjeru / UI ────────
    // ok: true = ne pominjati. ok: false = problem.
    status: Object.fromEntries(
      checks.map(c => [c.key, { ok: c.ok, note: c.note }])
    ),

  };
}