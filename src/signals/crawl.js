import * as cheerio from "cheerio";
import { uniq } from "../utils/uniq.js";
import { fetchHtml } from "./fetch.js";
import { detectFromHtml } from "./detect.js";
import { extractContacts, mergeContactSignals } from "./extract-contacts.js";

// ============================================================
// LINK SCORING & FILTERING
// ============================================================

/**
 * Scores a URL based on keyword relevance
 * Higher score = more important page
 */
function scoreLinkRelevance(url) {
  const u = String(url || "").toLowerCase();
  let points = 0;

  // --- Highest priority: direct contact / booking intent ---
  if (u.includes("contact")) points += 6;
  if (u.includes("locations") || u.includes("location")) points += 5;
  if (u.includes("appointment") || u.includes("appointments")) points += 6;
  if (u.includes("schedule") || u.includes("scheduling")) points += 6;
  if (u.includes("book") || u.includes("booking")) points += 6;
  if (u.includes("request-appointment") || u.includes("appointment-request")) points += 7;
  if (u.includes("call") || u.includes("phone")) points += 3;

  // --- Very common on US dental sites (high conversion pages) ---
  if (u.includes("new-patient") || u.includes("new-patients")) points += 5;
  if (u.includes("patient-forms") || u.includes("forms")) points += 4;
  if (u.includes("insurance") || u.includes("insurances")) points += 4;
  if (u.includes("financing") || u.includes("payment") || u.includes("pay")) points += 4;
  if (u.includes("special-offer") || u.includes("specials") || u.includes("offers") || u.includes("coupon")) points += 3;
  if (u.includes("emergency")) points += 4;
  if (u.includes("referral") || u.includes("refer")) points += 3;

  // --- About / Team (often contains emails / bios / staff info) ---
  if (u.includes("about")) points += 3;
  if (u.includes("our-team") || u.includes("team")) points += 4;
  if (u.includes("doctor") || u.includes("doctors")) points += 4;
  if (u.includes("dentist") || u.includes("dentists")) points += 3;
  if (u.includes("staff") || u.includes("hygienist")) points += 2;
  if (u.includes("meet-the-doctor") || u.includes("meet-the-team")) points += 5;

  // --- Services (lower priority, but sometimes has contact CTA/footer emails) ---
  if (u.includes("services") || u.includes("service")) points += 2;
  if (u.includes("cosmetic") || u.includes("implants") || u.includes("invisalign")) points += 1;
  if (u.includes("family-dentistry") || u.includes("general-dentistry")) points += 1;

  // --- Blog/News typically low value for email extraction ---
  if (u.includes("blog") || u.includes("news") || u.includes("articles")) points -= 2;

  // --- Avoid junk pages that waste crawl budget ---
  if (
    u.includes("privacy") ||
    u.includes("terms") ||
    u.includes("sitemap") ||
    u.includes("accessibility") ||
    u.includes("careers") ||
    u.includes("jobs")
  ) points -= 3;

  return points;
}

/**
 * Converts relative URLs to absolute and filters by hostname
 */
function normalizeLinks(links, baseUrl) {
  const baseHost = new URL(baseUrl).host;

  return uniq(
    links
      .map(href => {
        try { return new URL(href, baseUrl).toString(); }
        catch { return null; }
      })
      .filter(Boolean)
      .filter(url => {
        try { return new URL(url).host === baseHost; }
        catch { return false; }
      })
  );
}

/**
 * Extracts and ranks important internal links from HTML.
 * Returns top N most relevant links based on scoring.
 */
function pickImportantLinks(html, baseUrl, maxLinks = 2) {
  const $ = cheerio.load(html);

  const rawLinks = $("a[href]")
    .map((_, el) => $(el).attr("href"))
    .get()
    .filter(Boolean);

  return normalizeLinks(rawLinks, baseUrl)
    .sort((a, b) => scoreLinkRelevance(b) - scoreLinkRelevance(a))
    .filter(url => scoreLinkRelevance(url) > 0)
    .slice(0, maxLinks);
}

// ============================================================
// CTA LINK EXTRACTION
// ============================================================

// Keywords that indicate a booking / contact CTA link
const CTA_HREF_KEYWORDS = [
  "appointment", "appointments", "schedule", "scheduling",
  "book", "booking", "request-appointment", "appointment-request",
  "contact", "new-patient", "new-patients", "emergency",
];

// Keywords that indicate a booking / contact CTA by button/anchor text
const CTA_TEXT_KEYWORDS = [
  "book", "schedule", "appointment", "request", "contact",
  "call us", "new patient", "get started", "reserve", "sign up",
];

/**
 * Extracts visible CTA links (booking/contact intent) from a page.
 * Returns deduplicated list of { text, href, score } sorted by score desc.
 */
function extractCtaLinks(html, baseUrl) {
  const $ = cheerio.load(html);
  const seen = new Set();
  const results = [];

  $("a[href]").each((_, el) => {
    const href    = $(el).attr("href") ?? "";
    const text    = $(el).text().trim().replace(/\s+/g, " ");
    const hrefLow = href.toLowerCase();
    const textLow = text.toLowerCase();

    // Skip anchors, tel:, mailto: – those are handled separately
    if (!href || href.startsWith("#") || href.startsWith("tel:") || href.startsWith("mailto:")) return;

    let score = scoreLinkRelevance(href);

    // Bonus if button/anchor text also signals CTA intent
    if (CTA_TEXT_KEYWORDS.some(kw => textLow.includes(kw))) score += 3;

    // Only keep links with actual CTA relevance
    if (score <= 0) return;

    // Resolve absolute URL
    let absolute;
    try { absolute = new URL(href, baseUrl).toString(); }
    catch { return; }

    // Deduplicate by href
    if (seen.has(absolute)) return;
    seen.add(absolute);

    results.push({ text: text || null, href: absolute, score });
  });

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, 10); // top 10 CTA links per page is plenty
}

// ============================================================
// SIGNAL MERGING LOGIC
// ============================================================

function mergeTrackingSignals(merged, pageSignal) {
  for (const key of Object.keys(merged.tracking)) {
    merged.tracking[key] ||= pageSignal.tracking[key];
  }
}

function mergeChatbotSignals(merged, pageSignal, pageUrl) {
  if (!merged.chatbot.has_chatbot && pageSignal.chatbot.has_chatbot) {
    merged.chatbot = { ...pageSignal.chatbot, evidence_url: pageUrl };
  }
}

function mergeBookingSignals(merged, pageSignal, pageUrl) {
  const newConfidence     = pageSignal.booking.confidence ?? 0;
  const currentConfidence = merged.booking.confidence ?? 0;
  if (newConfidence > currentConfidence) {
    merged.booking = { ...pageSignal.booking, evidence_url: pageUrl };
  }
}

function mergeSeoSignals(merged, pageSignal, pageUrl, homepageUrl) {
  if (pageUrl === homepageUrl) {
    merged.seo = pageSignal.seo;
  }
}

function createEmptySignalStructure() {
  return {
    chatbot:  { has_chatbot: false, vendor: null, confidence: 0.0, evidence_url: null },
    tracking: { ga4: false, gtm: false, meta_pixel: false, google_ads: false },
    booking:  { type: null, evidence: null, confidence: 0.0, evidence_url: null },
    contact:  { phones: [], emails: [] },
    seo:      {},
    crawled_pages: [],
  };
}

// ============================================================
// PAGE FETCHING
// ============================================================

async function fetchAdditionalPages(links) {
  const pages = [];
  for (const link of links) {
    try {
      const html = await fetchHtml(link);
      pages.push({ url: link, html });
    } catch {
      // Silently skip failed pages
    }
  }
  return pages;
}

// ============================================================
// SIGNAL PROCESSING
// ============================================================

function processAndMergeSignals(pages, homepageUrl) {
  const merged = createEmptySignalStructure();
  merged.crawled_pages = pages.map(p => p.url);

  for (const page of pages) {
    const signals = detectFromHtml(page.html);

    mergeTrackingSignals(merged, signals);
    mergeChatbotSignals(merged, signals, page.url);
    mergeBookingSignals(merged, signals, page.url);
    mergeSeoSignals(merged, signals, page.url, homepageUrl);

    // ── Kontakti: sveobuhvatni ekstraktor (5 strategija) ──────────────────
    // Prolazi kroz: tel:/mailto: hrefs → JSON-LD → data-*/aria → contact
    // sekcije (footer, header, address...) → full body text sweep.
    // Sve normalizuje u E.164, dedupliciira i odbacuje false positives.
    const { phones, emails } = extractContacts(page.html, page.url);
    mergeContactSignals(merged, { contact: { phones, emails } });
  }

  return merged;
}

/**
 * Processes pages into a detailed per-page contact breakdown.
 * Returns phones/emails/CTAs found on each page individually,
 * plus a deduplicated merged summary across all pages.
 *
 * This is the richer version used by collectContactDetails().
 */
function processContactDetails(pages) {
  const allPhones = new Set();
  const allEmails = new Set();
  const allCtaLinks = new Map(); // href → entry (deduplicated across pages)
  const perPage = [];

  for (const page of pages) {
    const { phones, emails } = extractContacts(page.html, page.url);
    const ctaLinks           = extractCtaLinks(page.html, page.url);

    // Accumulate into global sets
    phones.forEach(p => allPhones.add(p));
    emails.forEach(e => allEmails.add(e));

    // Merge CTA links – keep highest score per href
    for (const link of ctaLinks) {
      const existing = allCtaLinks.get(link.href);
      if (!existing || link.score > existing.score) {
        allCtaLinks.set(link.href, { ...link, found_on: page.url });
      }
    }

    perPage.push({
      url:       page.url,
      phones:    phones,
      emails:    emails,
      cta_links: ctaLinks,
    });
  }

  return {
    // Deduplicated merged results across all pages
    phones:     [...allPhones],
    emails:     [...allEmails],
    cta_links:  [...allCtaLinks.values()].sort((a, b) => b.score - a.score),

    // Per-page breakdown (useful for debugging which page had what)
    per_page:   perPage,
  };
}

// ============================================================
// EXPORTS
// ============================================================

/**
 * Collects signals from a website by crawling homepage and important pages.
 * Returns the standard merged signals object (tracking, chatbot, booking,
 * contact, seo, crawled_pages).
 *
 * @param {string} websiteUrl
 * @returns {Promise<Object>}
 */
export async function collectSignals(websiteUrl) {
  const homepageHtml   = await fetchHtml(websiteUrl);
  const importantLinks = pickImportantLinks(homepageHtml, websiteUrl, 2);

  const pages = [{ url: websiteUrl, html: homepageHtml }];
  pages.push(...await fetchAdditionalPages(importantLinks));

  return processAndMergeSignals(pages, websiteUrl);
}

/**
 * Collects richer contact details from a website:
 * phones, emails, and booking/contact CTA links — with
 * per-page breakdown and a merged deduplicated summary.
 *
 * Crawls the same pages as collectSignals (homepage + top 2 scored links).
 * Can be called independently or alongside collectSignals to avoid
 * double-fetching (pass pre-fetched pages via the internal helper if needed).
 *
 * Returned shape:
 * {
 *   phones:    string[],        // all unique phones (E.164) across all pages
 *   emails:    string[],        // all unique emails across all pages
 *   cta_links: Array<{          // top booking/contact CTA links, scored
 *     text: string|null,
 *     href: string,
 *     score: number,
 *     found_on: string,         // which page this link was found on
 *   }>,
 *   per_page: Array<{           // per-page breakdown for audit/debug
 *     url:       string,
 *     phones:    string[],
 *     emails:    string[],
 *     cta_links: Array<{ text, href, score }>,
 *   }>,
 *   crawled_pages: string[],    // all pages visited
 * }
 *
 * @param {string} websiteUrl
 * @returns {Promise<Object>}
 */
export async function collectContactDetails(websiteUrl) {
  const homepageHtml   = await fetchHtml(websiteUrl);
  const importantLinks = pickImportantLinks(homepageHtml, websiteUrl, 2);

  const pages = [{ url: websiteUrl, html: homepageHtml }];
  pages.push(...await fetchAdditionalPages(importantLinks));

  const details = processContactDetails(pages);

  return {
    ...details,
    crawled_pages: pages.map(p => p.url),
  };
}