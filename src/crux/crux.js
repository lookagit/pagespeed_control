// src/crux/crux.js
const CRUX_ENDPOINT = "https://chromeuxreport.googleapis.com/v1/records:queryRecord";

function toOrigin(inputUrl) {
  const u = new URL(inputUrl);
  return `${u.protocol}//${u.host}`;
}

function pickP75(metricObj) {
  if (!metricObj?.percentiles) return null;
  // CrUX koristi "p75" u percentiles (iako docs pominju i "P75" u opisu)
  return metricObj.percentiles.p75 ?? metricObj.percentiles.P75 ?? null;
}

function safeNumberOrNull(v) {
  return typeof v === "number" ? v : null;
}

function safeStringOrNull(v) {
  return typeof v === "string" ? v : null;
}

function normalizeCruxRecord(record) {
  const metrics = record?.metrics || {};
  // metric names: largest_contentful_paint / interaction_to_next_paint / cumulative_layout_shift :contentReference[oaicite:2]{index=2}
  const lcp = pickP75(metrics.largest_contentful_paint);
  const inp = pickP75(metrics.interaction_to_next_paint);
  const clsRaw = pickP75(metrics.cumulative_layout_shift);

  return {
    collection_period: record?.collectionPeriod ?? null,
    form_factor: record?.key?.formFactor ?? null,
    // p75 values
    p75: {
      lcp_ms: safeNumberOrNull(lcp),
      inp_ms: safeNumberOrNull(inp),
      // CLS je često string (double encoded as string) :contentReference[oaicite:3]{index=3}
      cls: typeof clsRaw === "number" ? clsRaw : (typeof clsRaw === "string" ? Number(clsRaw) : null),
    },
    // histograms (ako zatreba kasnije)
    histograms: {
      lcp: metrics.largest_contentful_paint?.histogram ?? null,
      inp: metrics.interaction_to_next_paint?.histogram ?? null,
      cls: metrics.cumulative_layout_shift?.histogram ?? null,
    },
  };
}

async function cruxQuery({ apiKey, body }) {
  if (!apiKey) throw new Error("Missing CRUX_API_KEY in .env");

  const url = new URL(CRUX_ENDPOINT);
  url.searchParams.set("key", apiKey);

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "accept": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`CrUX failed ${res.status} ${res.statusText}: ${txt.slice(0, 300)}`);
  }

  const json = await res.json();
  return json?.record ?? null;
}

// Najpraktičnije: uvek radi origin, a page samo ako želiš
export async function getCrux({ websiteUrl, apiKey, formFactor = "PHONE", includePage = false }) {
  const origin = toOrigin(websiteUrl);

  const metrics = [
    "largest_contentful_paint",
    "interaction_to_next_paint",
    "cumulative_layout_shift",
  ];

  const originRecord = await cruxQuery({
    apiKey,
    body: { origin, formFactor, metrics },
  });

  let pageRecord = null;
  if (includePage) {
    pageRecord = await cruxQuery({
      apiKey,
      body: { url: websiteUrl, formFactor, metrics },
    });
  }

  return {
    origin,
    url: websiteUrl,
    origin_data: originRecord ? normalizeCruxRecord(originRecord) : null,
    page_data: pageRecord ? normalizeCruxRecord(pageRecord) : null,
    fetched_at: new Date().toISOString(),
  };
}
