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
  const website_url = lead?.website_url || lead?.website || "";

  const googlePhones = lead?.phone ? [lead.phone] : [];
  const googleEmails = lead?.email ? [lead.email] : [];

  const analysisEmails = analysis?.signals?.contact?.emails || [];
  const analysisPhones = analysis?.signals?.contact?.phones || [];

  const siteEmails = siteScrape?.extracted?.emails || [];
  const sitePhones = siteScrape?.extracted?.phones || [];

  const emails = uniq([...googleEmails, ...analysisEmails, ...siteEmails]);
  const phones = uniq([...googlePhones, ...analysisPhones, ...sitePhones]);

  const address =
    normalizeNullable(lead?.address) ||
    normalizeNullable(siteScrape?.extracted?.address) ||
    null;

  const reviews =
    lead?.reviews
      ? {
          rating: lead.reviews.rating ?? null,
          count: lead.reviews.count ?? null,
        }
      : null;

  return {
    name: lead?.name || siteScrape?.extracted?.brand_name || "unbekannt",
    website_url,
    address,
    phones,
    emails,
    reviews,
    source: {
      google: true,
      website: Boolean(siteScrape),
    },
  };
}
