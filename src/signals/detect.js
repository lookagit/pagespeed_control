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
  const blob = String(scriptBlob || "");
  const html = String(htmlLower || "");

  // helper: stronger confidence if it looks like a real embed (script/src/widget snippet)
  const strongHit = (rx) =>
    rx.test(blob) || rx.test(html) ||
    /<script|widget|iframe|chat|messenger|launcher/i.test(blob);

  const vendors = [
    // --- Big / common US live chat ---
    ["intercom", /widget\.intercom\.io|window\.intercom|intercomSettings/i],
    ["zendesk", /static\.zdassets\.com|zendesk\.com\/embeddable|zE\(|webWidget/i],
    ["drift", /js\.driftt\.com|drift\.load|drift\.on\(/i],
    ["hubspot", /js\.hs-scripts\.com|hubspotconversations|hsConversations/i],
    ["livechat", /livechatinc\.com|livechat\.js|__lc\.license/i],
    ["tawk.to", /tawk\.to|tawk_LoadStart/i],
    ["crisp", /client\.crisp\.chat|window\.\$crisp/i],
    ["tidio", /tidio\.co|tidioChat|tidiochat/i],
    ["smartsupp", /smartsupp|_smartsupp/i],
    ["olark", /olark\.com|olark\(/i],
    ["userlike", /userlike|userlike-cdn/i],
    ["freshchat", /freshchat|freshworks\.com\/live-chat/i],

    // --- US dental / healthcare focused (very common) ---
    ["podium", /podium\.com|podium\.io|podium-webchat|podiumchat/i],
    ["birdeye", /birdeye\.com|birdeye\.io|birdeye-widget|birdeyeChat/i],
    ["nexhealth", /nexhealth\.com|nexhealth.*widget|nexhealth-chat/i],
    ["demandforce", /demandforce\.com|demandforce.*widget|dfChat/i],
    ["solutionreach", /solutionreach\.com|solutionreach.*widget|srChat/i],
    ["weave", /getweave\.com|weave.*widget|weave-chat/i],
    ["yapi", /yapiapp\.com|yapi\.me|yapi.*widget|yapi-chat/i],
    ["patientpop", /patientpop\.com|patientpop.*widget|patientpop-chat/i],
    ["carecru", /carecru\.com|carecru.*widget|carecru-chat/i],
    ["revive", /revivesoftware\.com|revive.*chat|revive-chat/i],

    // --- Call / chat / scheduling combos that appear as widgets ---
    ["callrail", /callrail\.com|callrail.*widget/i],
    ["ringcentral", /ringcentral\.com|ringcentral.*widget/i],
    ["twilio", /twilio\.com|twilio.*chat|twilio.*conversations/i],

    // --- Other popular website chat widgets ---
    ["gorgias", /gorgias\.com|gorgias-chat|gorgias.*widget/i],
    ["zoho salesiq", /salesiq\.zoho\.com|zsiq|ZohoSalesIQ/i],
    ["helpscout beacon", /beacon-v2\.helpscout\.net|HS\.Beacon/i],
    ["kommunicate", /kommunicate\.io|kommunicate|kmChat/i],
    ["chatra", /chatra\.io|chatra\.js/i],
    ["jivochat", /jivochat\.com|jivo_api/i],
    ["liveperson", /liveperson\.net|lpTag/i],
  ];

  for (const [name, rx] of vendors) {
    if (rx.test(blob) || rx.test(html)) {
      const conf = strongHit(rx) ? 0.95 : 0.75;
      return {
        has_chatbot: true,
        vendor: name,
        confidence: conf,
      };
    }
  }

  return {
    has_chatbot: false,
    vendor: null,
    confidence: 0.0,
  };
}

// ============================================================
// BOOKING DETECTION
// ============================================================

function detectBooking(scriptBlob, htmlLower, bodyText, $) {
  const blob = String(scriptBlob || "");
  const html = String(htmlLower || "");
  const text = String(bodyText || "").toLowerCase();

  // Helper: if it looks like a real embedded widget
  const isEmbedLike = (rx) =>
    rx.test(blob) || rx.test(html) ||
    /<iframe|<script|widget|scheduler|schedule|appointment/i.test(blob);

  // USA dental / healthcare scheduling + common schedulers
  const bookingVendors = [
    // Dental-focused (very common in US)
    ["nexhealth", /nexhealth\.com|nexhealth.*(widget|book|schedule)|nexhealth/i],
    ["localmed", /localmed\.com|localmed.*(widget|schedule|appointment)|localmed/i],
    ["solutionreach", /solutionreach\.com|solutionreach.*(schedule|appointment|widget)|srchat|sr.*appointment/i],
    ["demandforce", /demandforce\.com|demandforce.*(schedule|appointment|widget)|demandforce/i],
    ["yapi", /yapiapp\.com|yapi\.me|yapi.*(forms|schedule|appointment|widget)|yapi/i],
    ["weave", /getweave\.com|weave.*(schedule|appointment|widget)|weave/i],
    ["carecru", /carecru\.com|carecru.*(schedule|appointment|widget)|carecru/i],
    ["patientpop", /patientpop\.com|patientpop.*(schedule|appointment|widget)|patientpop/i],
    ["modento", /modento\.io|modento.*(schedule|appointment|widget)|modento/i],
    ["opera dds", /operadds\.com|opera.*(schedule|appointment|widget)|operadds/i],
    ["curve dental", /curvedental\.com|curve.*(schedule|appointment|widget)|curvedental/i],
    ["dental intelligence", /dentalintel\.com|dentalintelligence|localmed/i],

    // General medical marketplace / booking
    ["zocdoc", /zocdoc\.com|zocdoc/i],

    // General schedulers (still appear on US sites)
    ["calendly", /calendly\.com|calendly\.initpopupwidget/i],
    ["acuity", /acuityscheduling\.com|acuity/i],
    ["setmore", /setmore\.com|setmore/i],
    ["simplybook", /simplybook/i],
  ];

  for (const [name, rx] of bookingVendors) {
    if (rx.test(blob) || rx.test(html)) {
      return {
        type: name,
        evidence: "embed/script",
        confidence: isEmbedLike(rx) ? 0.95 : 0.85,
      };
    }
  }

  // --- Fallback signals (US dental phrasing) ---
  const bookingKeywords = [
    // core
    "request appointment",
    "schedule appointment",
    "schedule online",
    "book appointment",
    "book online",
    "book now",
    "make an appointment",
    "appointment request",
    "online scheduling",
    "schedule a visit",
    "reserve appointment",

    // dental-specific common CTAs
    "new patient",
    "new patient forms",
    "patient forms",
    "forms",
    "check-in",
    "paperwork",
    "insurance verification",

    // urgent/after-hours
    "emergency appointment",
    "same-day appointment",
    "same day appointment",
    "walk-in",
    "walk ins",
    "urgent dental",
    "after hours",

    // consult
    "free consultation",
    "consultation request",
    "virtual consultation",
    "telehealth",
    "teledentistry",
  ];

  const hasBookingText = bookingKeywords.some((k) => text.includes(k));

  // form/portal-ish detection
  const formsCount = ($ && $("form").length) || 0;

  // common appointment-ish links/buttons
  const apptLinkCount = ($ && $("a,button").filter((i, el) => {
    const t = ($(el).text() || "").toLowerCase();
    const href = (($(el).attr && $(el).attr("href")) || "").toLowerCase();
    return (
      t.includes("appointment") ||
      t.includes("schedule") ||
      t.includes("request") ||
      t.includes("book") ||
      href.includes("appointment") ||
      href.includes("schedule") ||
      href.includes("book") ||
      href.includes("request")
    );
  }).length) || 0;

  const hasIframe = ($ && $("iframe").length > 0) || /<iframe/i.test(html);
  const phones = ($ && $("a[href^='tel:']").length) || 0;
  const mails = ($ && $("a[href^='mailto:']").length) || 0;

  // Strong-ish: booking text + (form or appt CTA or iframe)
  if (hasBookingText && (formsCount > 0 || apptLinkCount > 0 || hasIframe)) {
    return {
      type: formsCount > 0 ? "form" : "cta",
      evidence: formsCount > 0
        ? "booking keywords + form"
        : hasIframe
          ? "booking keywords + iframe"
          : "booking keywords + appointment CTA",
      confidence: formsCount > 0 ? 0.78 : 0.72,
    };
  }

  // Medium: appointment CTA without keywords (some pages are minimal)
  if (apptLinkCount > 0 || hasIframe) {
    return {
      type: hasIframe ? "embed" : "cta",
      evidence: hasIframe ? "iframe present" : "appointment CTA present",
      confidence: 0.55,
    };
  }

  // Weak: phone present (common “Call to schedule”)
  if (phones > 0) {
    return {
      type: "phone",
      evidence: "tel: link present",
      confidence: 0.6,
    };
  }

  // Weak: mail present
  if (mails > 0) {
    return {
      type: "email",
      evidence: "mailto: link present",
      confidence: 0.45,
    };
  }

  return {
    type: null,
    evidence: null,
    confidence: 0.0,
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