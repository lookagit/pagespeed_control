/**
 * extract-contacts.js  (ES Module)
 * ─────────────────────────────────────────────────────────────────────────────
 * Sveobuhvatni ekstraktor telefona i emailova iz HTML-a.
 *
 * 5 strategija, redosledom pouzdanosti:
 *   1. tel: / mailto: href linkovi          → 100% pouzdan izvor
 *   2. JSON-LD Schema.org blokovi           → strukturirani podaci
 *   3. data-* i aria-label atributi         → accessibility markup
 *   4. Kontekst scan (labele uz broj)       → "Phone:", "Call us:", itd.
 *   5. Full-text regex sweep                → fallback, hvata sve
 *
 * Normalizacija → E.164 (+XXXXXXXXXXX):
 *   (404) 762-9615   →  +14047629615
 *   404-762-9615     →  +14047629615
 *   404.762.9615     →  +14047629615
 *   4047629615       →  +14047629615
 *   1-800-555-1234   →  +18005551234
 *   +49 30 123456    →  +4930123456
 *   0049 30 123456   →  +4930123456
 *   762-9615         →  7629615 (lokalni, bez area code)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as cheerio from "cheerio";

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1 – PHONE PATTERNS
// ═══════════════════════════════════════════════════════════════════════════════

const PHONE_PATTERNS = [
  // +1 (404) 762-9615 | +1-404-762-9615 | +14047629615
  /(?:\+1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}\b/g,

  // 1-800-555-1234  (toll-free bez +)
  /\b1[\s.\-]\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}\b/g,

  // Internacionalni: +49 30 12345678 | +44 20 7946 0958
  /\+\d{1,3}[\s.\-]?\(?\d{1,4}\)?(?:[\s.\-]?\d{2,5}){2,4}\b/g,

  // 00 prefix: 0049301234567
  /\b00\d{7,14}\b/g,

  // Lokalni US: 762-9615 | 762.9615
  /\b\d{3}[\s.\-]\d{4}\b/g,
];

const PHONE_CONTEXT_PATTERNS = [
  // "Phone:", "Tel:", "Call us:", "Mobile:", "Cell:", "Fax:", "Hotline:"
  /(?:phones?|tele?(?:phone|fon)?|fax|calls?(?:\s+us)?|mob(?:ile)?|cell(?:ular)?|hotline|contact(?:\s+us)?|reach\s+us\s+at)\s*:?\s*([+\d()\s.\-\/]{7,25})/gi,

  // "available at (404)..." / "reach us at..."
  /\bat\s+([+\d()\s.\-]{7,20})/gi,

  // "tel: 404-..." u plain tekstu
  /tel:\s*([+\d()\s.\-]{7,20})/gi,

  // "Atlanta Dentist – (404) 762-9615"
  /[-–—]\s*(\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4})\b/g,

  // "Schedule: ...", "Office: ...", "Clinic: ..."
  /(?:schedule|appointments?|office|clinic|location)\s*:?\s*([+\d()\s.\-]{7,20})/gi,
];

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2 – EMAIL PATTERNS
// ═══════════════════════════════════════════════════════════════════════════════

const EMAIL_PATTERNS = [
  // Standardni email
  /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,

  // Obfuscirani: "info [at] domain [dot] com"
  /[a-zA-Z0-9._%+\-]+\s*[\[(]?at[\])]?\s*[a-zA-Z0-9.\-]+\s*[\[(]?dot[\])]?\s*[a-zA-Z]{2,}/gi,
];

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3 – NORMALIZACIJA
// ═══════════════════════════════════════════════════════════════════════════════

function stripToDigits(str) {
  const s = str.trim().replace(/[^\d+]/g, "");
  return s.startsWith("+")
    ? "+" + s.slice(1).replace(/\+/g, "")
    : s.replace(/\+/g, "");
}

export function normalizePhone(raw) {
  if (!raw) return null;
  const s = stripToDigits(raw);
  if (!s) return null;

  if (s.startsWith("+")) {
    const d = s.slice(1);
    return d.length >= 7 ? "+" + d : null;
  }

  if (s.startsWith("00") && s.length >= 9) return "+" + s.slice(2);
  if (s.length === 11 && s.startsWith("1")) return "+" + s;
  if (s.length === 10) return "+1" + s;
  if (s.length >= 9 && s.length <= 15) return s;
  if (s.length === 7) return s;
  return null;
}

export function normalizeEmail(raw) {
  if (!raw) return null;
  return raw
    .toLowerCase()
    .trim()
    .replace(/\s*[\[(]?at[\])]?\s*/i, "@")
    .replace(/\s*[\[(]?dot[\])]?\s*/gi, ".")
    .replace(/\s+/g, "");
}

function isValidPhone(p) {
  if (!p) return false;
  const d = p.replace(/\D/g, "");
  if (d.length < 7) return false;
  if (new Set(d).size < 3) return false;
  if (/^5550[01]\d{2}$/.test(d)) return false;
  return true;
}

function isValidEmail(e) {
  return e ? /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/.test(e) : false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4 – EKSTRAKCIJA IZ TEKSTA
// ═══════════════════════════════════════════════════════════════════════════════

export function extractPhonesFromText(text) {
  if (!text) return [];
  const found = [];
  for (const re of PHONE_CONTEXT_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const n = normalizePhone(m[1] ?? m[0]);
      if (n && isValidPhone(n)) found.push(n);
    }
  }
  for (const re of PHONE_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const n = normalizePhone(m[0]);
      if (n && isValidPhone(n)) found.push(n);
    }
  }
  return found;
}

export function extractEmailsFromText(text) {
  if (!text) return [];
  const found = [];
  for (const re of EMAIL_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const n = normalizeEmail(m[1] ?? m[0]);
      if (n && isValidEmail(n)) found.push(n);
    }
  }
  return found;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5 – HTML STRATEGIJE
// ═══════════════════════════════════════════════════════════════════════════════

// S1: tel: / mailto: hrefs – najpouzdaniji
function fromHrefs($) {
  const phones = [], emails = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (href.startsWith("tel:")) {
      const n = normalizePhone(href.replace(/^tel:/, ""));
      if (n && isValidPhone(n)) phones.push(n);
    }
    if (href.startsWith("mailto:")) {
      const n = normalizeEmail(href.replace(/^mailto:/, "").split("?")[0]);
      if (n && isValidEmail(n)) emails.push(n);
    }
  });
  return { phones, emails };
}

// S2: JSON-LD Schema.org
function fromJsonLd($) {
  const phones = [], emails = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    let data;
    try { data = JSON.parse($(el).text()); } catch { return; }
    const nodes = Array.isArray(data) ? data : [data];
    for (const node of nodes) {
      const rawTel = node.telephone ?? node.phone;
      if (rawTel) { const n = normalizePhone(String(rawTel)); if (n && isValidPhone(n)) phones.push(n); }
      const rawMail = node.email;
      if (rawMail) { const n = normalizeEmail(String(rawMail)); if (n && isValidEmail(n)) emails.push(n); }
      const cpArr = Array.isArray(node.contactPoint) ? node.contactPoint : node.contactPoint ? [node.contactPoint] : [];
      for (const cp of cpArr) {
        if (cp.telephone) { const n = normalizePhone(String(cp.telephone)); if (n && isValidPhone(n)) phones.push(n); }
        if (cp.email)     { const n = normalizeEmail(String(cp.email));     if (n && isValidEmail(n)) emails.push(n); }
      }
    }
  });
  return { phones, emails };
}

// S3: data-* atributi i aria-label
function fromAttributes($) {
  const phones = [], emails = [];
  $("[aria-label]").each((_, el) => {
    const lbl = $(el).attr("aria-label") ?? "";
    extractPhonesFromText(lbl).forEach(p => phones.push(p));
    extractEmailsFromText(lbl).forEach(e => emails.push(e));
  });
  $("[data-phone],[data-tel],[data-telephone],[data-number],[data-mobile]").each((_, el) => {
    const val = $(el).attr("data-phone") ?? $(el).attr("data-tel") ?? $(el).attr("data-telephone") ?? $(el).attr("data-number") ?? $(el).attr("data-mobile") ?? "";
    const n = normalizePhone(val);
    if (n && isValidPhone(n)) phones.push(n);
  });
  $("[data-email]").each((_, el) => {
    const n = normalizeEmail($(el).attr("data-email") ?? "");
    if (n && isValidEmail(n)) emails.push(n);
  });
  $('a[href^="tel:"]').each((_, el) => {
    const title = $(el).attr("title") ?? "";
    if (title) { const n = normalizePhone(title); if (n && isValidPhone(n)) phones.push(n); }
  });
  return { phones, emails };
}

// S4: Fokusirani scan kontakt sekcija (footer, header, .contact, address...)
function fromContactSections($) {
  const phones = [], emails = [];
  const sel = [
    "footer","header","address",
    "[class*='contact'],[id*='contact']",
    "[class*='phone'],[id*='phone']",
    "[class*='tel'],[id*='tel']",
    "[class*='address'],[id*='address']",
    "[class*='reach'],[class*='call'],[class*='info']",
    ".widget,#widget,.sidebar,#sidebar",
  ].join(",");
  $(sel).each((_, el) => {
    const text = $(el).text();
    extractPhonesFromText(text).forEach(p => phones.push(p));
    extractEmailsFromText(text).forEach(e => emails.push(e));
  });
  return { phones, emails };
}

// S5: Full body sweep – fallback
function fromBodyText($) {
  const text = $("body").text();
  return {
    phones: extractPhonesFromText(text),
    emails: extractEmailsFromText(text),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6 – DEDUPLICATION
// ═══════════════════════════════════════════════════════════════════════════════

function deduplicatePhones(phones) {
  // Canon key: US/CA 11-cifreni → 10 cifara (odbaci vodeću 1)
  // Cilj: "+14047629615", "14047629615", "4047629615" → isti key "4047629615"
  function canonKey(phone) {
    const d = phone.replace(/\D/g, "");
    return (d.length === 11 && d.startsWith("1")) ? d.slice(1) : d;
  }

  // Korak 1: grupiši, preferiraj E.164
  const byKey = new Map();
  for (const p of phones) {
    const key = canonKey(p);
    const ex = byKey.get(key);
    if (!ex) byKey.set(key, p);
    else if (p.startsWith("+") && !ex.startsWith("+")) byKey.set(key, p);
  }

  const keys = [...byKey.keys()];

  // Korak 2: ukloni kratke (7-cifrene) koji su suffix dužeg
  const filtered = keys.filter(key => {
    if (key.length >= 10) return true;
    return !keys.some(other => other.length > key.length && other.endsWith(key));
  });

  // Korak 3: sortiraj – E.164 prvo, duži prvo
  return filtered
    .map(key => byKey.get(key))
    .sort((a, b) => {
      if (a.startsWith("+") && !b.startsWith("+")) return -1;
      if (!a.startsWith("+") && b.startsWith("+")) return 1;
      return b.replace(/\D/g, "").length - a.replace(/\D/g, "").length;
    });
}

function deduplicateEmails(emails) {
  const seen = new Set();
  return emails.filter(e => {
    const l = e.toLowerCase();
    if (seen.has(l)) return false;
    seen.add(l);
    return true;
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7 – GLAVNI EKSTRAKTOR
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Izvlači sve telefone i emailove iz HTML-a, koristi svih 5 strategija.
 *
 * @param {string} html  – raw HTML string
 * @param {string} [url] – opcioni URL za context
 * @returns {{ phones: string[], emails: string[] }}
 */
export function extractContacts(html, url = "") {
  const $ = cheerio.load(html);
  const allPhones = [], allEmails = [];
  const add = ({ phones, emails }) => { allPhones.push(...phones); allEmails.push(...emails); };

  add(fromHrefs($));            // S1: tel:/mailto: hrefs
  add(fromJsonLd($));           // S2: Schema.org JSON-LD
  add(fromAttributes($));       // S3: data-*, aria-label
  add(fromContactSections($));  // S4: footer, .contact, address...
  add(fromBodyText($));         // S5: full body sweep

  return {
    phones: deduplicatePhones(allPhones),
    emails: deduplicateEmails(allEmails),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 8 – MERGE HELPER (za collect.js)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Merge-uje kontakte sa jedne stranice u akumulirani signal.
 */
export function mergeContactSignals(merged, pageSig) {
  merged.contact.phones = deduplicatePhones([
    ...merged.contact.phones,
    ...(pageSig.contact?.phones ?? []),
  ]);
  merged.contact.emails = deduplicateEmails([
    ...merged.contact.emails,
    ...(pageSig.contact?.emails ?? []),
  ]);
}