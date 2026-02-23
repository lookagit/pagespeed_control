import * as cheerio from "cheerio";

// ============================================================
// CONFIGURATION & CONSTANTS
// ============================================================

/**
 * HTTP fetch configuration
 * @const {Object}
 */
const HTTP_CONFIG = {
  TIMEOUT_MS: 12000,
  MAX_BYTES: 900_000, // ~0.9MB
  USER_AGENT: "Mozilla/5.0 (compatible; LeadBot/1.0; +https://example.com/bot)",
  ACCEPTED_CONTENT_TYPES: ["text/html", "application/xhtml+xml"],
};

/**
 * Content extraction limits
 * @const {Object}
 */
const EXTRACTION_LIMITS = {
  H1_TAGS: 10,
  H2_TAGS: 12,
  H3_TAGS: 12,
  SOCIAL_LINKS: 5,
  FORM_ACTIONS: 10,
  BUTTON_TEXTS: 20,
  LINK_TEXTS: 30,
  EXTRA_PAGES: 3,
  TOKENS_MAX_LENGTH: 6000,
  EMAILS_IN_SUMMARY: 5,
  BUTTONS_IN_SUMMARY: 8,
  H2_IN_SUMMARY: 3,
};

/**
 * Vendor detection patterns
 * Organized by category for maintainability
 * @const {Object}
 */
const VENDOR_PATTERNS = {
  chat: [
    { name: "tawk.to", pattern: "tawk.to" },
    { name: "crisp", pattern: "crisp" },
    { name: "intercom", pattern: "intercom" },
    { name: "drift", pattern: "drift" },
    { name: "zendesk", pattern: "zendesk" },
    { name: "freshchat", pattern: "freshchat" },
    { name: "livechat", pattern: "livechat" },
    { name: "userlike", pattern: "userlike" },
    { name: "hubspot chat", pattern: "hubspot" },
    { name: "facebook chat", pattern: "customerchat" },
  ],
  
  booking: [
    { name: "Doctolib", pattern: "doctolib" },
    { name: "jameda", pattern: "jameda" },
    { name: "samedi", pattern: "samedi" },
    { name: "Dr. Flex", pattern: "drflex" },
    { name: "CLICKDOC", pattern: "clickdoc" },
    { name: "generic/termin", pattern: "termin" },
  ],
  
  tracking: [
    { name: "Meta Pixel", pattern: "facebook.com/tr" },
    { name: "Hotjar", pattern: "hotjar" },
    { name: "Microsoft Clarity", pattern: "clarity.ms" },
  ],
  
  consent: [
    { name: "Cookiebot", pattern: "cookiebot" },
    { name: "OneTrust", pattern: "onetrust" },
    { name: "Usercentrics", pattern: "usercentrics" },
    { name: "Borlabs", pattern: "borlabs" },
    { name: "consentmanager", pattern: "consentmanager" },
    { name: "iubenda", pattern: "iubenda" },
  ],
  
  stack: [
    { name: "WordPress", pattern: "wp-content" },
    { name: "Elementor", pattern: "elementor" },
    { name: "Wix", pattern: "wix" },
    { name: "Shopify", pattern: "shopify" },
    { name: "Webflow", pattern: "webflow" },
  ],
};

/**
 * URL scoring rules for page importance
 * Higher score = more important page
 * @const {Array<[string, number]>}
 */
const URL_SCORING_RULES = [
  ["kontakt", 100],
  ["contact", 100],
  ["termin", 95],
  ["appointment", 95],
  ["doctolib", 90],
  ["impressum", 40],
  ["datenschutz", 40],
  ["privacy", 40],
];

/**
 * Legal page detection patterns
 * @const {Array<[string, string]>}
 */
const LEGAL_PAGE_PATTERNS = [
  ["impressum", "Impressum"],
  ["datenschutz", "Datenschutz/Privacy"],
  ["privacy", "Datenschutz/Privacy"],
  ["agb", "AGB/Terms"],
  ["terms", "AGB/Terms"],
  ["cookie", "Cookie page"],
];

// ============================================================
// URL UTILITIES
// ============================================================

/**
 * Normalizes URL by adding https:// if needed
 * 
 * @param {string} input - Raw URL input
 * @returns {string|null} Normalized URL or null if invalid
 * 
 * @example
 * normalizeUrl('example.com') // 'https://example.com'
 * normalizeUrl('http://example.com') // 'http://example.com'
 * normalizeUrl('') // null
 */
function normalizeUrl(input) {
  if (!input) return null;
  
  const trimmed = String(input).trim();
  if (!trimmed) return null;
  
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  
  return "https://" + trimmed.replace(/^\/+/, "");
}

/**
 * Resolves relative URL against base URL
 * 
 * @param {string} baseUrl - Base URL
 * @param {string} href - Relative or absolute href
 * @returns {string|null} Resolved absolute URL or null
 */
function resolveUrl(baseUrl, href) {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

/**
 * Checks if target URL is on same domain as base URL
 * 
 * @param {string} baseUrl - Base URL
 * @param {string} targetUrl - Target URL to check
 * @returns {boolean} True if same domain
 */
function isSameDomain(baseUrl, targetUrl) {
  try {
    const base = new URL(baseUrl);
    const target = new URL(targetUrl);
    return base.host === target.host;
  } catch {
    return false;
  }
}


// ============================================================
// HTTP FETCHING
// ============================================================

/**
 * Fetches HTML with timeout and size limits
 * Uses streaming to respect max bytes limit
 * 
 * @param {string} url - URL to fetch
 * @param {Object} options - Fetch options
 * @param {number} [options.timeoutMs] - Timeout in milliseconds
 * @param {number} [options.maxBytes] - Maximum bytes to read
 * @returns {Promise<FetchResult>} Fetch result
 * 
 * @typedef {Object} FetchResult
 * @property {boolean} ok - Whether fetch succeeded
 * @property {string} url - Final URL after redirects
 * @property {number} status - HTTP status code
 * @property {string} contentType - Content-Type header
 * @property {string} html - HTML content (truncated if needed)
 * @property {string} [error] - Error message if failed
 */
async function fetchHtmlWithLimits(url, options = {}) {
  const config = {
    timeoutMs: options.timeoutMs ?? HTTP_CONFIG.TIMEOUT_MS,
    maxBytes: options.maxBytes ?? HTTP_CONFIG.MAX_BYTES,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": HTTP_CONFIG.USER_AGENT,
        "accept": HTTP_CONFIG.ACCEPTED_CONTENT_TYPES.join(","),
      },
      redirect: "follow",
    });

    const contentType = response.headers.get("content-type") || "";
    const isHtmlContent = HTTP_CONFIG.ACCEPTED_CONTENT_TYPES.some(
      type => contentType.includes(type)
    );

    // Validate response
    if (!response.ok) {
      return {
        ok: false,
        url,
        status: response.status,
        contentType,
        html: "",
      };
    }

    if (!isHtmlContent) {
      return {
        ok: false,
        url,
        status: response.status,
        contentType,
        html: "",
      };
    }

    // Stream response with size limit
    const html = await readResponseWithLimit(response, config.maxBytes);

    return {
      ok: true,
      url: response.url,
      status: response.status,
      contentType,
      html,
    };

  } catch (error) {
    return {
      ok: false,
      url,
      status: 0,
      contentType: "",
      html: "",
      error: String(error?.message || error),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Reads response body with byte limit using streaming
 * 
 * @private
 * @param {Response} response - Fetch response
 * @param {number} maxBytes - Maximum bytes to read
 * @returns {Promise<string>} HTML content
 */
async function readResponseWithLimit(response, maxBytes) {
  const reader = response.body?.getReader?.();
  
  // Fallback for environments without streaming
  if (!reader) {
    const text = await response.text();
    return text.slice(0, maxBytes);
  }

  const chunks = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    
    if (done) break;
    
    totalBytes += value.byteLength;
    
    if (totalBytes > maxBytes) {
      chunks.push(value.slice(0, maxBytes - (totalBytes - value.byteLength)));
      break;
    }
    
    chunks.push(value);
  }

  // Efficiently merge chunks
  const mergedArray = mergeUint8Arrays(chunks);
  return new TextDecoder("utf-8").decode(mergedArray);
}

/**
 * Efficiently merges Uint8Array chunks
 * 
 * @private
 * @param {Uint8Array[]} chunks - Array of byte chunks
 * @returns {Uint8Array} Merged array
 */
function mergeUint8Arrays(chunks) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(totalLength);
  
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  
  return merged;
}

// ============================================================
// CHEERIO EXTRACTION UTILITIES
// ============================================================

/**
 * Extracts and normalizes text content from selector
 * 
 * @param {CheerioAPI} $ - Cheerio instance
 * @param {string} selector - CSS selector
 * @returns {string[]} Array of normalized text
 */
function extractTextArray($, selector) {
  return unique(
    $(selector)
      .map((_, el) => $(el).text().replace(/\s+/g, " ").trim())
      .get()
  );
}

/**
 * Extracts attribute values from selector
 * 
 * @param {CheerioAPI} $ - Cheerio instance
 * @param {string} selector - CSS selector
 * @param {string} attribute - Attribute name
 * @returns {string[]} Array of attribute values
 */
function extractAttributeArray($, selector, attribute) {
  return unique(
    $(selector)
      .map((_, el) => ($(el).attr(attribute) || "").trim())
      .get()
  );
}

/**
 * Enhanced email extraction from HTML/text.
 * Handles HTML entities, obfuscation, and mailto: links.
 *
 * @param {string} html - HTML or plain text content
 * @returns {string[]} Array of unique, normalized email addresses
 */
function extractEmailsFromText(html) {
  if (!html) return [];

  let text = html;

  // 1. Decode HTML entities (basic & numeric)
  const decodeHtmlEntities = (str) => {
    return str.replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
              .replace(/&#x([0-9A-Fa-f]+);/g, (match, hex) => String.fromCharCode(parseInt(hex, 16)))
              .replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&quot;/g, '"')
              .replace(/&#39;/g, "'")
              .replace(/&nbsp;/g, ' ');
  };
  text = decodeHtmlEntities(text);

  // 2. Replace common email obfuscations (case‑insensitive)
  const obfuscationPatterns = [
    { pattern: /\s*\[?at\]?\s*/gi, replacement: '@' },
    { pattern: /\s*\(?at\)?\s*/gi, replacement: '@' },
    { pattern: /\s*\[?dot\]?\s*/gi, replacement: '.' },
    { pattern: /\s*\(?dot\)?\s*/gi, replacement: '.' },
    { pattern: /\s*\[?@\]?\s*/gi, replacement: '@' }, // sometimes [@]
  ];
  obfuscationPatterns.forEach(({ pattern, replacement }) => {
    text = text.replace(pattern, replacement);
  });

  // 3. Extract emails from mailto: links (even if href is encoded)
  const mailtoRegex = /mailto:([^"'&\s?]+)/gi;
  let mailtoMatches = [];
  let match;
  while ((match = mailtoRegex.exec(text)) !== null) {
    mailtoMatches.push(decodeURIComponent(match[1]));
  }

  // 4. Extract emails from plain text using improved regex
  //    This regex covers 99% of real‑world emails (local part allows +, etc.)
  const emailRegex = /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}/g;
  const textMatches = text.match(emailRegex) || [];

  // 5. Combine all candidates, normalize (lowercase, trim) and deduplicate
  const allEmails = [...mailtoMatches, ...textMatches]
    .map(email => email.trim().toLowerCase())
    .filter(email => email.includes('@') && email.includes('.')); // basic sanity

  return [...new Set(allEmails)];
}

// Helper to keep your original style
function unique(arr) {
  return [...new Set(arr)];
}

// ============================================================
// VENDOR DETECTION
// ============================================================

/**
 * Detects vendors from HTML content using pattern matching
 * 
 * @param {Object} params - Detection parameters
 * @param {string} params.html - Raw HTML
 * @param {CheerioAPI} params.$ - Cheerio instance
 * @param {string} params.baseUrl - Base URL
 * @returns {VendorDetectionResult} Detected vendors
 * 
 * @typedef {Object} VendorDetectionResult
 * @property {string[]} chatVendors - Detected chat vendors
 * @property {string[]} bookingVendors - Detected booking vendors
 * @property {string[]} tracking - Detected tracking tools
 * @property {string[]} consent - Detected consent management platforms
 * @property {string[]} stack - Detected technology stack
 * @property {string[]} legalPages - Detected legal pages
 */
function detectVendorsFromHtml({ html, $, baseUrl }) {
  const scriptSources = extractAttributeArray($, "script[src]", "src")
    .join(" | ")
    .toLowerCase();
  
  const normalizedHtml = html.toLowerCase();

  const hasPattern = (pattern) => 
    scriptSources.includes(pattern) || normalizedHtml.includes(pattern);

  // Detect each category
  const chatVendors = detectVendorCategory(VENDOR_PATTERNS.chat, hasPattern);
  const bookingVendors = detectVendorCategory(VENDOR_PATTERNS.booking, hasPattern);
  const baseTracking = detectVendorCategory(VENDOR_PATTERNS.tracking, hasPattern);
  const consent = detectVendorCategory(VENDOR_PATTERNS.consent, hasPattern);
  const baseStack = detectVendorCategory(VENDOR_PATTERNS.stack, hasPattern);

  // Enhanced tracking with ID extraction
  const tracking = [
    ...baseTracking,
    ...extractGoogleTrackingIds(normalizedHtml),
  ];

  // Enhanced stack with generator meta
  const stack = [
    ...baseStack,
    ...extractGeneratorInfo($),
  ];

  // Detect legal pages
  const legalPages = detectLegalPages($, baseUrl);

  return {
    chatVendors: unique(chatVendors),
    bookingVendors: unique(bookingVendors),
    tracking: unique(tracking),
    consent: unique(consent),
    stack: unique(stack),
    legalPages: unique(legalPages),
  };
}

/**
 * Detects vendors from pattern category
 * 
 * @private
 * @param {Array} patterns - Vendor patterns
 * @param {Function} hasPattern - Pattern check function
 * @returns {string[]} Detected vendor names
 */
function detectVendorCategory(patterns, hasPattern) {
  return patterns
    .filter(({ pattern }) => hasPattern(pattern))
    .map(({ name }) => name);
}

/**
 * Extracts Google tracking IDs (GTM, GA4, UA)
 * 
 * @private
 * @param {string} html - Normalized HTML
 * @returns {string[]} Tracking ID strings
 */
function extractGoogleTrackingIds(html) {
  const results = [];
  
  const gtmIds = html.match(/GTM-[A-Z0-9]+/g) || [];
  const ga4Ids = html.match(/G-[A-Z0-9]+/g) || [];
  const uaIds = html.match(/UA-\d+-\d+/g) || [];
  
  if (gtmIds.length) {
    results.push(`GTM:${unique(gtmIds.map(id => id.toUpperCase())).join(",")}`);
  }
  
  if (ga4Ids.length) {
    results.push(`GA4:${unique(ga4Ids.map(id => id.toUpperCase())).join(",")}`);
  }
  
  if (uaIds.length) {
    results.push(`UA:${unique(uaIds.map(id => id.toUpperCase())).join(",")}`);
  }
  
  return results;
}

/**
 * Extracts generator meta tag info
 * 
 * @private
 * @param {CheerioAPI} $ - Cheerio instance
 * @returns {string[]} Generator info
 */
function extractGeneratorInfo($) {
  const generator = $('meta[name="generator"]').attr("content") || "";
  const generatorLower = generator.toLowerCase();
  
  if (!generatorLower) return [];
  
  const results = [`generator:${generatorLower}`];
  
  // Add WordPress detection from generator
  if (generatorLower.includes("wordpress")) {
    results.push("WordPress");
  }
  
  return results;
}

/**
 * Detects legal pages from internal links
 * 
 * @private
 * @param {CheerioAPI} $ - Cheerio instance
 * @param {string} baseUrl - Base URL
 * @returns {string[]} Legal page names
 */
function detectLegalPages($, baseUrl) {
  const internalLinks = extractAttributeArray($, "a[href]", "href")
    .map(href => resolveUrl(baseUrl, href))
    .filter(Boolean);
  
  const detectedPages = new Set();
  
  for (const url of internalLinks) {
    const urlLower = url.toLowerCase();
    
    for (const [pattern, name] of LEGAL_PAGE_PATTERNS) {
      if (urlLower.includes(pattern)) {
        detectedPages.add(name);
      }
    }
  }
  
  return Array.from(detectedPages);
}

// ============================================================
// SIGNAL EXTRACTION
// ============================================================

/**
 * Extracts all signals from HTML content
 * 
 * @param {Object} params - Extraction parameters
 * @param {string} params.url - Page URL
 * @param {string} params.html - HTML content
 * @returns {PageSignals} Extracted signals
 * 
 * @typedef {Object} PageSignals
 * @property {string} url
 * @property {string} title
 * @property {string} metaDescription
 * @property {Object} headings
 * @property {Object} contacts
 * @property {Object} socialLinks
 * @property {Object} forms
 * @property {VendorDetectionResult} vendors
 * @property {Object} uiText
 */
function extractPageSignals({ url, html }) {
  const $ = cheerio.load(html);

  // Meta information
  const title = $("title").text().trim();
  const metaDescription = $('meta[name="description"]').attr("content")?.trim() || "";

  // Headings
  const headings = {
    h1: extractTextArray($, "h1").slice(0, EXTRACTION_LIMITS.H1_TAGS),
    h2: extractTextArray($, "h2").slice(0, EXTRACTION_LIMITS.H2_TAGS),
    h3: extractTextArray($, "h3").slice(0, EXTRACTION_LIMITS.H3_TAGS),
  };

  // Contact information
  const mailtoLinks = extractAttributeArray($, 'a[href^="mailto:"]', "href")
    .map(href => href.replace(/^mailto:/i, ""));
  
  const telLinks = extractAttributeArray($, 'a[href^="tel:"]', "href")
    .map(href => href.replace(/^tel:/i, ""));
  
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const emailsInText = extractEmailsFromText(bodyText);

  const contacts = {
    mailto: unique(mailtoLinks),
    tel: unique(telLinks),
    emailsInText,
  };

  // Social media links
  const allHrefs = extractAttributeArray($, "a[href]", "href");
  const socialLinks = {
    instagram: allHrefs
      .filter(href => href.includes("instagram.com"))
      .slice(0, EXTRACTION_LIMITS.SOCIAL_LINKS),
    facebook: allHrefs
      .filter(href => href.includes("facebook.com"))
      .slice(0, EXTRACTION_LIMITS.SOCIAL_LINKS),
    tiktok: allHrefs
      .filter(href => href.includes("tiktok.com"))
      .slice(0, EXTRACTION_LIMITS.SOCIAL_LINKS),
    whatsapp: allHrefs
      .filter(href => href.includes("wa.me") || href.includes("whatsapp"))
      .slice(0, EXTRACTION_LIMITS.SOCIAL_LINKS),
  };

  // Forms
  const forms = {
    count: $("form").length,
    actions: unique(
      extractAttributeArray($, "form[action]", "action")
        .slice(0, EXTRACTION_LIMITS.FORM_ACTIONS)
    ),
  };

  // Vendors
  const vendors = detectVendorsFromHtml({ html, $, baseUrl: url });

  // UI text (CTA analysis)
  const uiText = {
    buttons: extractTextArray($, "button")
      .filter(Boolean)
      .slice(0, EXTRACTION_LIMITS.BUTTON_TEXTS),
    linkTexts: extractTextArray($, "a")
      .filter(Boolean)
      .slice(0, EXTRACTION_LIMITS.LINK_TEXTS),
  };

  return {
    url,
    title,
    metaDescription,
    headings,
    contacts,
    socialLinks,
    forms,
    vendors,
    uiText,
  };
}

// ============================================================
// PAGE IMPORTANCE SCORING
// ============================================================

/**
 * Scores URL path for importance using heuristics
 * 
 * @param {string} urlPath - URL path in lowercase
 * @returns {number} Importance score (higher = more important)
 */
function scorePageImportance(urlPath) {
  let score = 0;
  
  for (const [keyword, points] of URL_SCORING_RULES) {
    if (urlPath.includes(keyword)) {
      score += points;
    }
  }
  
  return score;
}

/**
 * Selects most important internal pages to crawl
 * 
 * @param {string} baseUrl - Base URL
 * @param {string[]} hrefs - Array of href values
 * @returns {string[]} Top N important internal URLs
 */
function selectImportantPages(baseUrl, hrefs) {
  const absoluteUrls = hrefs
    .map(href => resolveUrl(baseUrl, href))
    .filter(Boolean)
    .filter(url => isSameDomain(baseUrl, url));

  const scoredUrls = absoluteUrls
    .map(url => ({
      url,
      score: scorePageImportance(url.toLowerCase()),
    }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return unique(scoredUrls.map(item => item.url))
    .slice(0, EXTRACTION_LIMITS.EXTRA_PAGES);
}

// ============================================================
// TOKEN GENERATION
// ============================================================

/**
 * Builds compact token representation for LLM consumption
 * Format optimized for minimal tokens while preserving signal quality
 * 
 * @param {SiteSnapshot} snapshot - Site snapshot data
 * @returns {string} Tokenized representation
 * 
 * @typedef {Object} SiteSnapshot
 * @property {PageSignals} base - Base page signals
 * @property {PageSignals[]} extraPages - Extra page signals
 */
export function buildSiteTokens(snapshot) {
  const lines = [];

  // Base page information
  const base = snapshot.base;
  
  lines.push(`URL: ${base.url}`);
  lines.push(`TITLE: ${base.title || "n/a"}`);
  lines.push(`META_DESCRIPTION: ${base.metaDescription || "n/a"}`);

  // Headings
  lines.push(`H1: ${base.headings.h1.join(" | ") || "n/a"}`);
  lines.push(`H2_TOP3: ${base.headings.h2.slice(0, EXTRACTION_LIMITS.H2_IN_SUMMARY).join(" | ") || "n/a"}`);

  // Contact information
  const contacts = base.contacts;
  lines.push(`MAILTO: ${contacts.mailto.join(", ") || "none"}`);
  lines.push(`TEL: ${contacts.tel.join(", ") || "none"}`);
  lines.push(`EMAILS_IN_TEXT: ${contacts.emailsInText.slice(0, EXTRACTION_LIMITS.EMAILS_IN_SUMMARY).join(", ") || "none"}`);

  // Vendors and technology
  const vendors = base.vendors;
  lines.push(`CHAT_VENDORS: ${vendors.chatVendors.join(", ") || "none"}`);
  lines.push(`BOOKING_VENDORS: ${vendors.bookingVendors.join(", ") || "none"}`);
  lines.push(`TRACKING: ${vendors.tracking.join(", ") || "none"}`);
  lines.push(`CONSENT_CMP: ${vendors.consent.join(", ") || "none"}`);
  lines.push(`STACK: ${vendors.stack.join(", ") || "unknown"}`);
  lines.push(`LEGAL_PAGES_HINTS: ${vendors.legalPages.join(", ") || "unknown"}`);

  // Forms
  lines.push(`FORMS_COUNT: ${base.forms.count}`);
  lines.push(`FORM_ACTIONS: ${base.forms.actions.join(" | ") || "n/a"}`);

  // CTA samples
  lines.push(`CTA_BUTTONS_SAMPLE: ${base.uiText.buttons.slice(0, EXTRACTION_LIMITS.BUTTONS_IN_SUMMARY).join(" | ") || "n/a"}`);

  // Extra pages (if available)
  if (snapshot.extraPages?.length > 0) {
    lines.push(`EXTRA_PAGES_CHECKED: ${snapshot.extraPages.map(p => p.url).join(", ")}`);
    
    for (const page of snapshot.extraPages) {
      lines.push(`PAGE:${page.url}`);
      lines.push(`  H1: ${page.headings.h1.join(" | ") || "n/a"}`);
      lines.push(`  H2_TOP3: ${page.headings.h2.slice(0, EXTRACTION_LIMITS.H2_IN_SUMMARY).join(" | ") || "n/a"}`);
      lines.push(`  MAILTO: ${page.contacts.mailto.join(", ") || "none"}`);
      lines.push(`  TEL: ${page.contacts.tel.join(", ") || "none"}`);
      lines.push(`  CHAT_VENDORS: ${page.vendors.chatVendors.join(", ") || "none"}`);
      lines.push(`  BOOKING_VENDORS: ${page.vendors.bookingVendors.join(", ") || "none"}`);
    }
  }

  // Truncate to reasonable size for LLM
  return lines.join("\n").slice(0, EXTRACTION_LIMITS.TOKENS_MAX_LENGTH);
}

// ============================================================
// MAIN SCRAPING FUNCTION
// ============================================================

/**
 * Scrapes website and returns comprehensive snapshot
 * 
 * Workflow:
 * 1. Normalizes and validates input URL
 * 2. Fetches base page HTML
 * 3. Extracts signals from base page
 * 4. Identifies important internal pages
 * 5. Fetches and processes additional pages
 * 6. Builds tokenized representation
 * 
 * @param {string} websiteUrl - Website URL to scrape
 * @returns {Promise<ScrapingResult>} Scraping result
 * 
 * @typedef {Object} ScrapingResult
 * @property {boolean} ok - Whether scraping succeeded
 * @property {string} [error] - Error message if failed
 * @property {PageSignals} base - Base page signals
 * @property {PageSignals[]} extraPages - Additional page signals
 * @property {string} tokens - Tokenized representation
 * 
 * @example
 * const result = await scrapeSiteSnapshot('https://example.com');
 * if (result.ok) {
 *   console.log(result.tokens); // Compact LLM-ready format
 *   console.log(result.base.vendors.chatVendors); // ['intercom']
 * }
 */
export async function scrapeSiteSnapshot(websiteUrl) {
  // Validate and normalize URL
  const normalizedUrl = normalizeUrl(websiteUrl);
  
  if (!normalizedUrl) {
    return {
      ok: false,
      error: "Invalid website_url",
      base: null,
      extraPages: [],
      tokens: "",
    };
  }

  // Fetch base page
  const baseFetch = await fetchHtmlWithLimits(normalizedUrl);
  
  if (!baseFetch.ok) {
    return {
      ok: false,
      error: baseFetch.error || `Fetch failed (${baseFetch.status})`,
      base: { url: normalizedUrl },
      extraPages: [],
      tokens: "",
    };
  }

  // Extract signals from base page
  const baseSignals = extractPageSignals({
    url: baseFetch.url,
    html: baseFetch.html,
  });

  // Identify important pages to crawl
  const $ = cheerio.load(baseFetch.html);
  const hrefs = extractAttributeArray($, "a[href]", "href");
  const importantUrls = selectImportantPages(baseFetch.url, hrefs);

  // Fetch and process additional pages
  const extraPages = await fetchAdditionalPages(importantUrls);

  // Build final snapshot
  const snapshot = {
    ok: true,
    base: baseSignals,
    extraPages,
  };

  return {
    ...snapshot,
    tokens: buildSiteTokens(snapshot),
  };
}

/**
 * Fetches and processes multiple pages concurrently with error handling
 * 
 * @private
 * @param {string[]} urls - URLs to fetch
 * @returns {Promise<PageSignals[]>} Array of page signals
 */
async function fetchAdditionalPages(urls) {
  const results = [];
  
  for (const url of urls) {
    const fetchResult = await fetchHtmlWithLimits(url);
    
    if (!fetchResult.ok) continue;
    
    const signals = extractPageSignals({
      url: fetchResult.url,
      html: fetchResult.html,
    });
    
    results.push(signals);
  }
  
  return results;
}