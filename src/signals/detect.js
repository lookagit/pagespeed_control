import * as cheerio from "cheerio";
import { uniq } from "../utils/uniq.js";

// ============================================================
// TRACKING DETECTION
// ============================================================

function detectTracking(scriptBlob) {
  return {
    // Analytics
    ga4: 
      /gtag\/js\?id=G-/.test(scriptBlob) || 
      /gtag\(['"]config['"],\s*['"]g-/.test(scriptBlob),
    gtm: 
      /googletagmanager\.com\/gtm\.js\?id=gtm-/.test(scriptBlob) || 
      /gtm-/.test(scriptBlob),
    google_ads: 
      /googleadservices/.test(scriptBlob) || 
      /gtag\(['"]config['"],\s*['"]aw-/.test(scriptBlob),
    
    // Social Media Pixels
    meta_pixel: 
      /connect\.facebook\.net\/.*fbevents\.js/.test(scriptBlob) || 
      /fbq\(['"]init['"]/.test(scriptBlob),
    linkedin_insight: 
      /snap\.licdn\.com\/li\.lms-analytics/.test(scriptBlob) ||
      /_linkedin_partner_id/.test(scriptBlob),
    twitter_pixel: 
      /static\.ads-twitter\.com\/uwt\.js/.test(scriptBlob) ||
      /twq\(['"]init['"]/.test(scriptBlob),
    
    // Heatmaps & Session Recording
    hotjar: 
      /static\.hotjar\.com/.test(scriptBlob) ||
      /hj\(['"]event['"]/.test(scriptBlob),
    microsoft_clarity: 
      /clarity\.ms/.test(scriptBlob) ||
      /clarity\(['"]/.test(scriptBlob),
    mouseflow: /mouseflow\.com/.test(scriptBlob),
    
    // Other Analytics
    matomo: /matomo|piwik/.test(scriptBlob),
    mixpanel: /mixpanel/.test(scriptBlob),
  };
}

// ============================================================
// CHATBOT DETECTION
// ============================================================

function detectChatbot(scriptBlob, htmlLower) {
  const chatbotVendors = [
    ["chatbase", /chatbase\.co|window\.chatbase|chatbase/i],
    ["intercom", /widget\.intercom\.io|window\.intercom/i],
    ["crisp", /client\.crisp\.chat/i],
    ["tawk.to", /tawk\.to/i],
    ["zendesk", /static\.zdassets\.com|zE\(/i],
    ["drift", /js\.driftt\.com/i],
    ["hubspot", /js\.hs-scripts\.com|hubspotconversations/i],
    ["smartsupp", /smartsupp/i],
    ["tidio", /tidio\.co|tidiochat/i],
    ["livechat", /livechatinc/i],
    ["freshchat", /freshchat/i],
    ["chatwoot", /chatwoot/i],
    ["olark", /olark\.com/i],
    ["userlike", /userlike/i],
  ];

  for (const [name, rx] of chatbotVendors) {
    if (rx.test(scriptBlob) || rx.test(htmlLower)) {
      return { 
        has_chatbot: true, 
        vendor: name, 
        confidence: 0.95 
      };
    }
  }

  return { 
    has_chatbot: false, 
    vendor: null, 
    confidence: 0.0 
  };
}

// ============================================================
// BOOKING DETECTION
// ============================================================

function detectBooking(scriptBlob, htmlLower, bodyText, $) {
  // Known booking vendors
  const bookingVendors = [
    ["calendly", /calendly\.com|calendly\.initpopupwidget/i],
    ["simplybook", /simplybook/i],
    ["setmore", /setmore\.com/i],
    ["acuity", /acuityscheduling\.com/i],
    ["booksy", /booksy\.com/i],
    ["doctolib", /doctolib/i],
    ["practo", /practo\.com/i],
    ["zocdoc", /zocdoc\.com/i],
  ];

  // Check for vendor widgets
  for (const [name, rx] of bookingVendors) {
    if (rx.test(scriptBlob) || rx.test(htmlLower)) {
      return { 
        type: name, 
        evidence: "embed/script", 
        confidence: 0.9 
      };
    }
  }

  // Fallback: keyword + form detection
  const bookingKeywords = [
    "termin", "zakaz", "appointment", "book", 
    "online-termin", "reserv", "schedule", "buchen"
  ];
  
  const hasBookingText = bookingKeywords.some(k => bodyText.includes(k));
  const hasForm = $("form").length > 0;
  const phones = $("a[href^='tel:']").length;

  if (hasBookingText && hasForm) {
    return { 
      type: "form", 
      evidence: "form + booking keywords", 
      confidence: 0.7 
    };
  }
  
  if (phones > 0) {
    return { 
      type: "phone", 
      evidence: "tel: link present", 
      confidence: 0.6 
    };
  }

  return { 
    type: null, 
    evidence: null, 
    confidence: 0.0 
  };
}

// ============================================================
// CONTACT DETECTION
// ============================================================

function detectContact($) {
  const phones = uniq(
    $("a[href^='tel:']")
      .map((_, el) => 
        ($(el).attr("href") || "")
          .replace(/^tel:/, "")
          .trim()
      )
      .get()
  );

  const emails = uniq(
    $("a[href^='mailto:']")
      .map((_, el) => 
        ($(el).attr("href") || "")
          .replace(/^mailto:/, "")
          .split("?")[0]
          .trim()
      )
      .get()
  );

  // Extract social media links
  const socialLinks = {
    facebook: $("a[href*='facebook.com']").attr("href") || null,
    instagram: $("a[href*='instagram.com']").attr("href") || null,
    twitter: $("a[href*='twitter.com'], a[href*='x.com']").attr("href") || null,
    linkedin: $("a[href*='linkedin.com']").attr("href") || null,
    youtube: $("a[href*='youtube.com']").attr("href") || null,
  };

  return { 
    phones, 
    emails, 
    social: socialLinks 
  };
}

// ============================================================
// SEO DETECTION
// ============================================================

function detectSEO($, html) {
  // Basic meta tags
  const basic = {
    title: $("title").text().trim() || null,
    meta_description: $("meta[name='description']").attr("content")?.trim() || null,
    meta_keywords: $("meta[name='keywords']").attr("content")?.trim() || null,
    meta_robots: $("meta[name='robots']").attr("content")?.trim() || null,
    canonical: $("link[rel='canonical']").attr("href")?.trim() || null,
    viewport: $("meta[name='viewport']").attr("content")?.trim() || null,
  };

  // Open Graph tags
  const openGraph = {
    og_title: $("meta[property='og:title']").attr("content")?.trim() || null,
    og_description: $("meta[property='og:description']").attr("content")?.trim() || null,
    og_image: $("meta[property='og:image']").attr("content")?.trim() || null,
    og_url: $("meta[property='og:url']").attr("content")?.trim() || null,
    og_type: $("meta[property='og:type']").attr("content")?.trim() || null,
    og_site_name: $("meta[property='og:site_name']").attr("content")?.trim() || null,
  };

  // Twitter Cards
  const twitterCard = {
    twitter_card: $("meta[name='twitter:card']").attr("content")?.trim() || null,
    twitter_title: $("meta[name='twitter:title']").attr("content")?.trim() || null,
    twitter_description: $("meta[name='twitter:description']").attr("content")?.trim() || null,
    twitter_image: $("meta[name='twitter:image']").attr("content")?.trim() || null,
    twitter_site: $("meta[name='twitter:site']").attr("content")?.trim() || null,
  };

  // Language & internationalization
  const language = {
    lang: $("html").attr("lang") || null,
    hreflang_tags: $("link[rel='alternate'][hreflang]")
      .map((_, el) => ({
        lang: $(el).attr("hreflang"),
        href: $(el).attr("href"),
      }))
      .get(),
  };

  // Structured Data (JSON-LD)
  const structuredData = $("script[type='application/ld+json']")
    .map((_, el) => {
      try {
        return JSON.parse($(el).html() || "{}");
      } catch {
        return null;
      }
    })
    .get()
    .filter(Boolean);

  // Content analysis
  const content = {
    h1_count: $("h1").length,
    h1_text: $("h1").first().text().trim() || null,
    h2_count: $("h2").length,
    word_count: $("body").text().split(/\s+/).filter(Boolean).length,
    image_count: $("img").length,
    images_with_alt: $("img[alt]").length,
    images_without_alt: $("img:not([alt])").length,
  };

  // Performance hints
  const performance = {
    has_lazy_loading: $("img[loading='lazy']").length > 0,
    has_async_scripts: $("script[async]").length > 0,
    has_defer_scripts: $("script[defer]").length > 0,
    preload_count: $("link[rel='preload']").length,
    prefetch_count: $("link[rel='prefetch']").length,
  };

  // Security
  const security = {
    has_https_forms: $("form[action^='https://']").length > 0 || 
                      $("form:not([action])").length > 0, // Forms without action default to same origin
    external_scripts: $("script[src^='http']")
      .map((_, el) => {
        try {
          const src = $(el).attr("src");
          return src ? new URL(src).hostname : null;
        } catch {
          return null;
        }
      })
      .get()
      .filter(Boolean),
  };

  return {
    ...basic,
    open_graph: openGraph,
    twitter_card: twitterCard,
    language,
    structured_data: structuredData,
    content_analysis: content,
    performance_hints: performance,
    security,
  };
}

// ============================================================
// MAIN DETECTION FUNCTION
// ============================================================

/**
 * Detects various signals from HTML content including tracking,
 * chatbots, booking systems, contact info, and comprehensive SEO data
 * 
 * @param {string} html - Raw HTML content to analyze
 * @returns {Object} Detected signals
 * 
 * @example
 * const signals = detectFromHtml(htmlContent);
 * console.log(signals.chatbot.vendor); // 'intercom' or null
 * console.log(signals.seo.content_analysis.word_count); // 1523
 */
export function detectFromHtml(html) {
  const $ = cheerio.load(html);

  // Prepare lowercase versions for pattern matching
  const scriptBlob = $("script")
    .map((_, el) => `${$(el).attr("src") || ""}\n${$(el).html() || ""}`)
    .get()
    .join("\n")
    .toLowerCase();

  const htmlLower = html.toLowerCase();
  const bodyText = $("body").text().toLowerCase();

  // Run all detection modules
  return {
    tracking: detectTracking(scriptBlob),
    chatbot: detectChatbot(scriptBlob, htmlLower),
    booking: detectBooking(scriptBlob, htmlLower, bodyText, $),
    contact: detectContact($),
    seo: detectSEO($, html),
  };
}