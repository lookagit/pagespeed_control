// ai/leadView.js (ESM)

const safeMetric = (m) => {
  if (m && typeof m === "object") {
    return { value: m.value ?? "N/A", status: m.status ?? "unknown" };
  }
  return { value: "N/A", status: "unknown" };
};

export function getLeadView(input, scrapeBase = null) {
  const isSignal = !!input?.meta;

  // meta
  const name = isSignal ? input.meta?.name : input.name;
  const url  = isSignal ? input.meta?.url  : (input.website_url ?? input.url);
  const address = isSignal ? input.meta?.address : input.address;

  // scores
  const scores = isSignal ? (input.scores ?? {}) : (input.scores ?? {});

  // vitals/resources (signalReport već ima flattened vitals)
  const vitals = isSignal
    ? {
        lcp: safeMetric(input.vitals?.lcp),
        fcp: safeMetric(input.vitals?.fcp),
        tti: safeMetric(input.vitals?.tti),
        tbt: safeMetric(input.vitals?.tbt),
        cls: safeMetric(input.vitals?.cls),
        ttfb: safeMetric(input.vitals?.ttfb),
        si: safeMetric(input.vitals?.si),
        page_weight: safeMetric(input.vitals?.page_weight),
        http_requests: safeMetric(input.vitals?.http_requests),
      }
    : {
        lcp: safeMetric(input.vitals_mobile?.lcp),
        fcp: safeMetric(input.vitals_mobile?.fcp),
        tti: safeMetric(input.vitals_mobile?.tti),
        tbt: safeMetric(input.vitals_mobile?.tbt),
        cls: safeMetric(input.vitals_mobile?.cls),
        ttfb: safeMetric(input.vitals_mobile?.serverResp ?? input.vitals_mobile?.ttfb),
        si: safeMetric(input.vitals_mobile?.speedIndex ?? input.vitals_mobile?.si),
        page_weight: safeMetric(input.resources_mobile?.page_weight),
        http_requests: safeMetric(input.resources_mobile?.requests),
      };

  // SEO
  const seo = isSignal ? (input.seo ?? {}) : (input.seo ?? {});

  // booking/contact
  const booking = isSignal
    ? (input.booking ?? {})
    : {
        has_booking: !!input.has_online_booking,
        vendor: input.booking_vendor ?? null,
        type: input.booking_type ?? null,
        cta_inferred: !!(input.ctas ?? []).some(x => x?.inferred),
      };

  const contact = isSignal
    ? (input.contact ?? {})
    : {
        phones: input.phones ?? [],
        emails: input.emails ?? [],
        phone_count: (input.phones ?? []).length,
        email_count: (input.emails ?? []).length,
      };

  // tracking: signalReport = present/missing; raw = booleans
  const tracking = (() => {
    if (isSignal) return { present: input.tracking?.present ?? [], missing: input.tracking?.missing ?? [] };
    const t = input.tracking ?? {};
    const present = [];
    const missing = [];
    if (t.has_ga4) present.push("GA4"); else missing.push("GA4");
    if (t.has_gtm) present.push("GTM"); else missing.push("GTM");
    if (t.has_meta_pixel) present.push("Meta Pixel"); else missing.push("Meta Pixel");
    if (t.has_google_ads) present.push("Google Ads pixel"); else missing.push("Google Ads pixel");
    return { present, missing };
  })();

  // scrape-only conversion hints
  const scheduleOnlineSeen = scrapeBase
    ? (scrapeBase.uiText?.linkTexts ?? []).some(t => String(t).toLowerCase().includes("schedule online"))
    : null;

  const formsCount = scrapeBase?.forms?.count ?? null;
  const consentCmp = (scrapeBase?.vendors?.consent ?? [])[0] ?? null;

  const scrapeTracking = scrapeBase?.vendors?.tracking ?? [];
  const conflicts = [];
  if (scrapeTracking.includes("Meta Pixel") && tracking.missing.includes("Meta Pixel")) {
    conflicts.push("Ad tracker detected in scrape, but audit could not confirm it works (may be blocked by cookie consent or misconfigured).");
  }

  return {
    name, url, address,
    scores, vitals, seo, booking, contact, tracking,
    status: isSignal ? (input.status ?? {}) : {},
    scrape: {
      schedule_online_seen: scheduleOnlineSeen,
      forms_count: formsCount,
      consent_cmp: consentCmp,
      conflicts,
      services: scrapeBase ? (scrapeBase.headings?.h2 ?? []).filter(x =>
        /dentistry|orthodont|invisalign|implants|surgery|emergenc|restorative|cosmetic/i.test(String(x))
      ).slice(0, 10) : [],
      trust_signals: scrapeBase ? (scrapeBase.headings?.h2 ?? []).filter(x =>
        /partner|official|falcons|award|as seen/i.test(String(x))
      ).slice(0, 3) : [],
    }
  };
}