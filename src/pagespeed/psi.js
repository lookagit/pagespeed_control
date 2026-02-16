function score100(v) {
  return typeof v === "number" ? Math.round(v * 100) : null;
}

function pickNumeric(audits, id) {
  const v = audits?.[id]?.numericValue;
  return typeof v === "number" ? v : null;
}

function pickScore(audits, id) {
  const v = audits?.[id]?.score;
  return typeof v === "number" ? v : null;
}

function pickDisplay(audits, id) {
  return audits?.[id]?.displayValue ?? null;
}

function pickAuditSavings(audits, id) {
  const a = audits?.[id];
  if (!a) return null;
  const details = a.details || {};
  return {
    id,
    title: a.title ?? id,
    score: typeof a.score === "number" ? a.score : null,
    displayValue: a.displayValue ?? null,
    description: a.description ?? null, // ✨ Dodato - korisno za objašnjenja
    savings_ms: typeof details?.overallSavingsMs === "number" ? details.overallSavingsMs : null,
    savings_bytes: typeof details?.overallSavingsBytes === "number" ? details.overallSavingsBytes : null,
  };
}

function topSavingsAudits(audits, ids, limit = 5) {
  const items = ids
    .map((id) => pickAuditSavings(audits, id))
    .filter(Boolean)
    .filter((x) => x.savings_ms || x.savings_bytes)
    .sort((a, b) => (b.savings_ms ?? 0) - (a.savings_ms ?? 0) || (b.savings_bytes ?? 0) - (a.savings_bytes ?? 0));
  return items.slice(0, limit);
}

// ✨ Poboljšana CrUX funkcija - pravilno parsuje metrike
function pickCruxMetrics(metricsObj) {
  if (!metricsObj) return null;
  
  const metric = (key) => {
    const m = metricsObj[key];
    if (!m) return null;
    return {
      percentile: typeof m.percentile === "number" ? m.percentile : null,
      category: m.category ?? null,
      distributions: m.distributions ?? null, // ✨ Distribucija good/needs improvement/poor
    };
  };

  return {
    lcp_ms: metric("LARGEST_CONTENTFUL_PAINT_MS"),
    fid_ms: metric("FIRST_INPUT_DELAY_MS"), // ✨ Dodato FID
    inp_ms: metric("INTERACTION_TO_NEXT_PAINT"),
    cls: metric("CUMULATIVE_LAYOUT_SHIFT_SCORE"),
    fcp_ms: metric("FIRST_CONTENTFUL_PAINT_MS"), // ✨ Dodato FCP
    ttfb_ms: metric("EXPERIMENTAL_TIME_TO_FIRST_BYTE"), // ✨ Dodato TTFB
  };
}

function pickCrux(psiResponse) {
  const le = psiResponse?.loadingExperience;
  const ole = psiResponse?.originLoadingExperience;

  return {
    page: le ? {
      metrics: pickCruxMetrics(le?.metrics),
      overall_category: le?.overall_category ?? null,
      initial_url: le?.initial_url ?? null,
    } : null,
    origin: ole ? {
      metrics: pickCruxMetrics(ole?.metrics),
      overall_category: ole?.overall_category ?? null,
      origin_fallback: ole?.origin_fallback ?? null, // ✨ Fallback info
    } : null,
  };
}

export async function runPageSpeed({ url, strategy, apiKey }) {
  if (!apiKey) throw new Error("Missing PSI_API_KEY");

  const endpoint = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  endpoint.searchParams.set("url", url);
  endpoint.searchParams.set("strategy", strategy);
  endpoint.searchParams.set("key", apiKey);
  
  // ✨ Sve kategorije za kompletan izveštaj
  ["performance", "seo", "accessibility", "best-practices"].forEach((c) => 
    endpoint.searchParams.append("category", c)
  );

  const res = await fetch(endpoint);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`PSI failed ${res.status} ${res.statusText}: ${txt.slice(0, 200)}`);
  }

  const json = await res.json();
  const lh = json?.lighthouseResult;
  const audits = lh?.audits || {};
  const cats = lh?.categories || {};

  return {
    strategy,
    final_url: lh?.finalUrl ?? null,
    fetched_at: new Date().toISOString(),
    fetch_time_ms: lh?.fetchTime ? new Date(lh.fetchTime).getTime() : null, // ✨ Kada je fetch-ovano
    
    // Ocene po kategorijama
    categories: {
      performance: score100(cats?.performance?.score),
      seo: score100(cats?.seo?.score),
      accessibility: score100(cats?.accessibility?.score),
      best_practices: score100(cats?.["best-practices"]?.score),
    },
    
    // Lab Data (simulirani uslovi)
    lab: {
      // Core Web Vitals
      fcp_ms: pickNumeric(audits, "first-contentful-paint"),
      lcp_ms: pickNumeric(audits, "largest-contentful-paint"),
      cls: pickNumeric(audits, "cumulative-layout-shift"),
      inp_ms: pickNumeric(audits, "interaction-to-next-paint") ?? 
              pickNumeric(audits, "experimental-interaction-to-next-paint") ?? null,
      
      // Dodatne metrike
      speed_index: pickNumeric(audits, "speed-index"),
      tbt_ms: pickNumeric(audits, "total-blocking-time"),
      tti_ms: pickNumeric(audits, "interactive"),
      
      // ✨ Dodato: Max Potential FID (bitno za interaktivnost)
      max_potential_fid_ms: pickNumeric(audits, "max-potential-fid"),
      
      // ✨ Dodato: Server response time
      server_response_time_ms: pickNumeric(audits, "server-response-time"),
    },
    
    // ✨ Field Data (stvarni korisnici iz CrUX)
    field: pickCrux(json),
    
    // ✨ Resource summary
    resources: {
      total_byte_weight: pickNumeric(audits, "total-byte-weight"),
      dom_size: audits?.["dom-size"]?.numericValue ?? null,
      script_count: audits?.["bootup-time"]?.details?.items?.length ?? null,
      request_count: audits?.["network-requests"]?.details?.items?.length ?? null,
    },
    
    // Opportunities (optimizacije koje najviše štede)
    opportunities: topSavingsAudits(audits, [
      // Rendering
      "render-blocking-resources",
      "unused-javascript",
      "unused-css-rules",
      "unminified-javascript",
      "unminified-css",
      
      // Images
      "uses-optimized-images",
      "uses-webp-images",
      "uses-responsive-images",
      "modern-image-formats", // ✨ Dodato
      "offscreen-images", // ✨ Dodato
      "efficient-animated-content",
      
      // Network
      "uses-text-compression",
      "uses-rel-preconnect",
      "uses-rel-preload", // ✨ Dodato
      "server-response-time",
      "uses-long-cache-ttl",
      "uses-http2", // ✨ Dodato
      
      // Fonts
      "font-display", // ✨ Dodato - važno za text visibility
      "preload-fonts", // ✨ Dodato
      
      // JavaScript
      "legacy-javascript", // ✨ Dodato - transpiled JS
      "duplicated-javascript", // ✨ Dodato
    ], 10), // ✨ Povećano na 10 najvažnijih
    
    // Diagnostics (problemi koji ne nude direktne savings)
    diagnostics: [
      "bootup-time",
      "mainthread-work-breakdown",
      "third-party-summary",
      "dom-size",
      "largest-contentful-paint-element",
      "layout-shift-elements", // ✨ Dodato - elementi koji uzrokuju CLS
      "long-tasks", // ✨ Dodato - dugotrajni taskovi
      "non-composited-animations", // ✨ Dodato
      "unsized-images", // ✨ Dodato
      "uses-passive-event-listeners", // ✨ Dodato
    ]
      .map((id) => ({
        id,
        title: audits?.[id]?.title ?? null,
        displayValue: audits?.[id]?.displayValue ?? null,
        score: pickScore(audits, id),
        numericValue: pickNumeric(audits, id),
        description: audits?.[id]?.description ?? null, // ✨ Dodato
      }))
      .filter((x) => x.title),
    
    // Display friendly values
    display: {
      fcp: pickDisplay(audits, "first-contentful-paint"),
      lcp: pickDisplay(audits, "largest-contentful-paint"),
      cls: pickDisplay(audits, "cumulative-layout-shift"),
      tbt: pickDisplay(audits, "total-blocking-time"),
      tti: pickDisplay(audits, "interactive"), // ✨ Dodato
      speed_index: pickDisplay(audits, "speed-index"), // ✨ Dodato
    },
    
    // ✨ Stack/environment info
    environment: {
      network_user_agent: lh?.environment?.networkUserAgent ?? null,
      host_user_agent: lh?.environment?.hostUserAgent ?? null,
      benchmark_index: lh?.environment?.benchmarkIndex ?? null,
    },
    
    // ✨ Timing info
    timing: {
      total_ms: lh?.timing?.total ?? null,
    },
    
    // ✨ Screenshot (base64) - korisno za vizuelizaciju
    screenshot: audits?.["final-screenshot"]?.details?.data ?? null,
    
    // ✨ User timings (ako sajt koristi Performance API)
    user_timings: audits?.["user-timings"]?.details?.items ?? [],
  };
}