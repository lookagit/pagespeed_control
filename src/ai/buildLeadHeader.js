// ============================================================
// ai/buildLeadHeader.js — Normalizes contact info from sources
// ============================================================

function uniq(arr = []) {
  return [...new Set(arr.filter(Boolean).map(String))];
}

function normalizeNullable(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s || s === "/" || s.toLowerCase() === "none") return null;
  return s;
}

export function buildLeadHeader({ lead, analysis, siteScrape }) {
  const googlePhones   = lead?.phone ? [lead.phone] : [];
  const googleEmails   = lead?.email ? [lead.email] : [];
  const analysisEmails = analysis?.signals?.contact?.emails || [];
  const analysisPhones = analysis?.signals?.contact?.phones || [];
  const siteEmails     = siteScrape?.extracted?.emails || [];
  const sitePhones     = siteScrape?.extracted?.phones || [];

  return {
    name:        lead?.name || siteScrape?.extracted?.brand_name || "Unknown",
    website_url: lead?.website_url || lead?.website || "",
    address:     normalizeNullable(lead?.address) || normalizeNullable(siteScrape?.extracted?.address) || null,
    phones:      uniq([...googlePhones, ...analysisPhones, ...sitePhones]),
    emails:      uniq([...googleEmails, ...analysisEmails, ...siteEmails]),
    reviews: lead?.reviews
      ? { rating: lead.reviews.rating ?? null, count: lead.reviews.count ?? null }
      : null,
    source: { google: true, website: Boolean(siteScrape) },
  };
}