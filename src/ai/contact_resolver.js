// ============================================================
// ai/contact_resolver.js — Contact Data Resolution Engine
// ============================================================
//
// SOURCE HIERARCHY (by field):
//
//   PHONE:    Google Places  →  Crawler  →  CSV
//   EMAIL:    Crawler        →  CSV           (Google Places has no email)
//   ADDRESS:  Google Places  →  (never crawler — too unreliable)
//   NAME:     Google Places  →  CSV           (authoritative business name)
//   MAPS_URL: Google Places  only
//   RATING:   Google Places  only
//
// Every resolved field carries full provenance:
//   { value, source, confidence, alternatives, resolved_at }
//
// CONFIDENCE LEVELS:
//   1.0 — Google Places (paid, verified, Google-maintained)
//   0.8 — Crawler multi-page match (found on ≥2 pages)
//   0.6 — Crawler single-page match
//   0.3 — CSV only (user-input, unverified)
//
// This module is the SINGLE place that decides which contact
// data enters every downstream consumer (factSheet, enrichLead,
// createFinalReport, master JSON).
// ============================================================

const CONFIDENCE = {
  GOOGLE_PLACES: 1.0,
  CRAWLER_MULTI:  0.8,
  CRAWLER_SINGLE: 0.6,
  CSV_ONLY:       0.3,
};

// ─────────────────────────────────────────────────────────────
// PHONE RESOLUTION
// Priority: Google Places → Crawler → CSV
// Returns primary + alternatives for CRM multi-phone support
// ─────────────────────────────────────────────────────────────

function resolvePhones({ googleLead, crawlerContact, csvLead }) {
  const googlePhone  = googleLead?.phone   ? normalisePhone(googleLead.phone)   : null;
  const csvPhone     = csvLead?.phone      ? normalisePhone(csvLead.phone)       : null;
  const crawlerPhones = (crawlerContact?.phones ?? []).map(normalisePhone).filter(Boolean);

  // Deduplicate all sources, preserve order by priority
  const seen = new Set();
  const all  = [];   // { value, source, confidence }

  if (googlePhone) {
    seen.add(googlePhone);
    all.push({ value: googlePhone, source: "google_places", confidence: CONFIDENCE.GOOGLE_PLACES });
  }

  for (const p of crawlerPhones) {
    if (seen.has(p)) continue;
    seen.add(p);
    // If found on multiple pages it's higher confidence
    const freq = crawlerPhones.filter(x => x === p).length;
    all.push({
      value: p,
      source: "crawler",
      confidence: freq >= 2 ? CONFIDENCE.CRAWLER_MULTI : CONFIDENCE.CRAWLER_SINGLE,
    });
  }

  if (csvPhone && !seen.has(csvPhone)) {
    seen.add(csvPhone);
    all.push({ value: csvPhone, source: "csv", confidence: CONFIDENCE.CSV_ONLY });
  }

  const primary     = all[0] ?? null;
  const alternatives = all.slice(1);

  return {
    primary_phone:         primary?.value ?? null,
    primary_phone_source:  primary?.source ?? null,
    primary_phone_confidence: primary?.confidence ?? null,
    all_phones:            all,
    alternatives,
  };
}

// ─────────────────────────────────────────────────────────────
// EMAIL RESOLUTION
// Priority: Crawler → CSV  (Google Places has no email field)
// ─────────────────────────────────────────────────────────────

function resolveEmails({ crawlerContact, csvLead }) {
  const crawlerEmails = (crawlerContact?.emails ?? []).map(s => s?.toLowerCase().trim()).filter(Boolean);
  const csvEmail      = csvLead?.email ? csvLead.email.toLowerCase().trim() : null;

  const seen = new Set();
  const all  = [];

  for (const e of crawlerEmails) {
    if (!e || seen.has(e)) continue;
    seen.add(e);
    all.push({ value: e, source: "crawler", confidence: CONFIDENCE.CRAWLER_SINGLE });
  }

  if (csvEmail && !seen.has(csvEmail)) {
    seen.add(csvEmail);
    all.push({ value: csvEmail, source: "csv", confidence: CONFIDENCE.CSV_ONLY });
  }

  const primary = all[0] ?? null;

  return {
    primary_email:            primary?.value ?? null,
    primary_email_source:     primary?.source ?? null,
    primary_email_confidence: primary?.confidence ?? null,
    all_emails:               all,
  };
}

// ─────────────────────────────────────────────────────────────
// IDENTITY RESOLUTION
// Google Places is authoritative for name, address, place metadata
// ─────────────────────────────────────────────────────────────

function resolveIdentity({ googleLead, csvLead }) {
  return {
    // Business name: Google Places is authoritative
    name: {
      value:      googleLead?.name      ?? csvLead?.name ?? null,
      source:     googleLead?.name ? "google_places" : "csv",
      confidence: googleLead?.name ? CONFIDENCE.GOOGLE_PLACES : CONFIDENCE.CSV_ONLY,
    },

    // Full address: Google Places only (normalized, geocoded)
    address: {
      value:      googleLead?.address ?? null,
      source:     "google_places",
      confidence: googleLead?.address ? CONFIDENCE.GOOGLE_PLACES : null,
      // Parsed parts (from index.js normalizeLead)
      street:      csvLead?.street      ?? null,   // from parseAddress
      city:        csvLead?.city        ?? null,
      state:       csvLead?.state       ?? null,
      postal_code: csvLead?.postal_code ?? null,
      country:     csvLead?.country     ?? "USA",
    },

    // Website: CSV / Google Places (both reliable)
    website: {
      value:      googleLead?.website_url ?? csvLead?.website_url ?? null,
      source:     googleLead?.website_url ? "google_places" : "csv",
      confidence: CONFIDENCE.GOOGLE_PLACES,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// GOOGLE PLACES SIGNALS
// Ratings, reviews, operational status — unique to Google data
// ─────────────────────────────────────────────────────────────

function resolveGoogleSignals({ googleLead }) {
  return {
    place_id:        googleLead?.place_id        ?? null,
    rating:          googleLead?.rating          ?? null,
    review_count:    googleLead?.user_ratings_total ?? null,
    maps_url:        googleLead?.maps_url        ?? null,
    business_status: googleLead?.business_status ?? null,

    // Computed signals useful for sales
    review_quality: classifyReviews(googleLead?.rating, googleLead?.user_ratings_total),
    social_proof:   buildSocialProofLine(googleLead?.rating, googleLead?.user_ratings_total),
  };
}

// ─────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────

/**
 * resolveContacts()
 *
 * @param {object} googleLead   — raw.item.lead (Google Places row, inc. phone)
 * @param {object} crawlerContact — signalReport.contact (phones[], emails[])
 * @param {object} csvLead      — same as googleLead (index.js merges CSV+Places)
 *
 * @returns {object} resolved contacts with full provenance
 */
export function resolveContacts({ googleLead, crawlerContact, csvLead }) {
  const phones   = resolvePhones({ googleLead, crawlerContact, csvLead });
  const emails   = resolveEmails({ crawlerContact, csvLead });
  const identity = resolveIdentity({ googleLead, csvLead });
  const google   = resolveGoogleSignals({ googleLead });

  return {
    // ── Primary contact (highest confidence per field) ──
    primary: {
      name:    identity.name.value,
      phone:   phones.primary_phone,
      email:   emails.primary_email,
      website: identity.website.value,
      address: identity.address.value,
    },

    // ── Phone resolution ────────────────────────────────
    phones: {
      primary:            phones.primary_phone,
      primary_source:     phones.primary_phone_source,
      primary_confidence: phones.primary_phone_confidence,
      all:                phones.all_phones,
      alternatives:       phones.alternatives,
    },

    // ── Email resolution ────────────────────────────────
    emails: {
      primary:            emails.primary_email,
      primary_source:     emails.primary_email_source,
      primary_confidence: emails.primary_email_confidence,
      all:                emails.all_emails,
    },

    // ── Identity (Google Places authoritative) ──────────
    identity,

    // ── Google Places signals ────────────────────────────
    google,

    // ── Audit trail ─────────────────────────────────────
    _provenance: {
      resolved_at:        new Date().toISOString(),
      google_phone_found: !!googleLead?.phone,
      crawler_phones_found: (crawlerContact?.phones ?? []).length,
      crawler_emails_found: (crawlerContact?.emails ?? []).length,
      csv_phone_found:    !!(csvLead?.phone),
      csv_email_found:    !!(csvLead?.email),
    },
  };
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

/** Normalise to E.164-ish: digits only after country code check */
function normalisePhone(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  // Keep +1 format if present, strip spaces/dashes/parens
  const clean = s.replace(/[\s\-().]/g, "");
  if (clean.length < 7) return null;   // too short to be real
  return clean;
}

function classifyReviews(rating, count) {
  if (!rating || !count) return "unknown";
  if (rating >= 4.5 && count >= 100) return "strong";
  if (rating >= 4.0 && count >= 50)  return "good";
  if (rating >= 4.0)                 return "decent";
  if (rating < 4.0 && count >= 20)   return "weak";   // sales angle: reputation management
  return "minimal";
}

function buildSocialProofLine(rating, count) {
  if (!rating) return null;
  if (!count)  return `${rating}★ on Google`;
  if (count >= 200) return `${rating}★ (${count} reviews) — well-established practice`;
  if (count >= 100) return `${rating}★ (${count} reviews) — strong patient base`;
  if (count >= 50)  return `${rating}★ (${count} reviews)`;
  return `${rating}★ (${count} reviews) — growing practice`;
}