import * as cheerio from "cheerio";
import { uniq } from "../utils/uniq.js";
import { fetchHtml } from "./fetch.js";
import { detectFromHtml } from "./detect.js";

// ============================================================
// LINK SCORING & FILTERING
// ============================================================

/**
 * Scores a URL based on keyword relevance
 * Higher score = more important page
 */
function scoreLinkRelevance(url) {
  const normalized = url.toLowerCase();
  let points = 0;

  // High priority: Contact & booking pages
  if (normalized.includes("kontakt") || normalized.includes("contact")) points += 3;
  if (normalized.includes("termin") || normalized.includes("zakaz")) points += 3;
  if (normalized.includes("appointment") || normalized.includes("booking")) points += 3;

  // Medium priority: Team & about pages
  if (normalized.includes("team") || normalized.includes("tim")) points += 2;
  if (normalized.includes("about") || normalized.includes("uber-uns")) points += 2;
  if (normalized.includes("praxis") || normalized.includes("practice")) points += 2;

  // Low priority: Services
  if (normalized.includes("leistungen") || normalized.includes("services")) points += 1;
  if (normalized.includes("usluge") || normalized.includes("angebot")) points += 1;

  return points;
}

/**
 * Converts relative URLs to absolute and filters by hostname
 */
function normalizeLinks(links, baseUrl) {
  const baseHost = new URL(baseUrl).host;
  
  const absoluteUrls = links
    .map(href => {
      try {
        return new URL(href, baseUrl).toString();
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  // Keep only same-host URLs
  const sameHostUrls = absoluteUrls.filter(url => {
    try {
      return new URL(url).host === baseHost;
    } catch {
      return false;
    }
  });

  return uniq(sameHostUrls);
}

/**
 * Extracts and ranks important internal links from HTML
 * Returns top N most relevant links based on scoring
 */
function pickImportantLinks(html, baseUrl, maxLinks = 2) {
  const $ = cheerio.load(html);
  
  // Extract all href attributes
  const rawLinks = $("a[href]")
    .map((_, el) => $(el).attr("href"))
    .get()
    .filter(Boolean);

  // Normalize and filter to same-host
  const normalizedLinks = normalizeLinks(rawLinks, baseUrl);

  // Score, sort, and take top N with score > 0
  return normalizedLinks
    .sort((a, b) => scoreLinkRelevance(b) - scoreLinkRelevance(a))
    .filter(url => scoreLinkRelevance(url) > 0)
    .slice(0, maxLinks);
}

// ============================================================
// SIGNAL MERGING LOGIC
// ============================================================

/**
 * Merges tracking signals across multiple pages
 */
function mergeTrackingSignals(merged, pageSignal) {
  for (const key of Object.keys(merged.tracking)) {
    merged.tracking[key] ||= pageSignal.tracking[key];
  }
}

/**
 * Merges chatbot signals - keeps first detected
 */
function mergeChatbotSignals(merged, pageSignal, pageUrl) {
  if (!merged.chatbot.has_chatbot && pageSignal.chatbot.has_chatbot) {
    merged.chatbot = {
      ...pageSignal.chatbot,
      evidence_url: pageUrl,
    };
  }
}

/**
 * Merges booking signals - keeps highest confidence
 */
function mergeBookingSignals(merged, pageSignal, pageUrl) {
  const newConfidence = pageSignal.booking.confidence ?? 0;
  const currentConfidence = merged.booking.confidence ?? 0;

  if (newConfidence > currentConfidence) {
    merged.booking = {
      ...pageSignal.booking,
      evidence_url: pageUrl,
    };
  }
}

/**
 * Merges contact information - accumulates unique values
 */
function mergeContactSignals(merged, pageSignal) {
  merged.contact.phones = uniq([
    ...merged.contact.phones,
    ...pageSignal.contact.phones,
  ]);
  
  merged.contact.emails = uniq([
    ...merged.contact.emails,
    ...pageSignal.contact.emails,
  ]);
}

/**
 * Merges SEO data - only from homepage
 */
function mergeSeoSignals(merged, pageSignal, pageUrl, homepageUrl) {
  if (pageUrl === homepageUrl) {
    merged.seo = pageSignal.seo;
  }
}

/**
 * Creates initial empty signal structure
 */
function createEmptySignalStructure() {
  return {
    chatbot: {
      has_chatbot: false,
      vendor: null,
      confidence: 0.0,
      evidence_url: null,
    },
    tracking: {
      ga4: false,
      gtm: false,
      meta_pixel: false,
      google_ads: false,
    },
    booking: {
      type: null,
      evidence: null,
      confidence: 0.0,
      evidence_url: null,
    },
    contact: {
      phones: [],
      emails: [],
    },
    seo: {},
    crawled_pages: [],
  };
}

// ============================================================
// MAIN COLLECTION FUNCTION
// ============================================================

/**
 * Fetches additional pages with error handling
 */
async function fetchAdditionalPages(links) {
  const pages = [];
  
  for (const link of links) {
    try {
      const html = await fetchHtml(link);
      pages.push({ url: link, html });
    } catch (error) {
      // Silently skip failed pages
      // Could add logging here if needed: console.warn(`Failed to fetch ${link}`)
    }
  }
  
  return pages;
}

/**
 * Processes all pages and merges their signals
 */
function processAndMergeSignals(pages, homepageUrl) {
  const merged = createEmptySignalStructure();
  merged.crawled_pages = pages.map(p => p.url);

  for (const page of pages) {
    const signals = detectFromHtml(page.html);

    mergeTrackingSignals(merged, signals);
    mergeChatbotSignals(merged, signals, page.url);
    mergeBookingSignals(merged, signals, page.url);
    mergeContactSignals(merged, signals);
    mergeSeoSignals(merged, signals, page.url, homepageUrl);
  }

  return merged;
}

/**
 * Collects signals from a website by crawling homepage and important pages
 * 
 * @param {string} websiteUrl - The homepage URL to analyze
 * @returns {Promise<Object>} Merged signals from all crawled pages
 * 
 * @example
 * const signals = await collectSignals('https://example.com');
 * console.log(signals.chatbot.vendor); // 'intercom' or null
 * console.log(signals.tracking.ga4); // true or false
 */
export async function collectSignals(websiteUrl) {
  // 1. Fetch homepage
  const homepageHtml = await fetchHtml(websiteUrl);
  
  // 2. Find important internal links
  const importantLinks = pickImportantLinks(homepageHtml, websiteUrl, 2);
  
  // 3. Collect all pages
  const pages = [{ url: websiteUrl, html: homepageHtml }];
  const additionalPages = await fetchAdditionalPages(importantLinks);
  pages.push(...additionalPages);

  // 4. Process and merge signals
  return processAndMergeSignals(pages, websiteUrl);
}