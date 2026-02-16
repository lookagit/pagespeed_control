import * as cheerio from "cheerio";

// ============================================================
// UTILITIES
// ============================================================

/**
 * Normalizes headers to lowercase keys
 */
function normalizeHeaders(headers) {
  const normalized = {};
  for (const [key, value] of Object.entries(headers || {})) {
    normalized[key.toLowerCase()] = String(value);
  }
  return normalized;
}

/**
 * Creates a technology detection object
 */
function createTech(name, category, confidence, evidence) {
  return { name, category, confidence, evidence };
}

/**
 * Deduplicates technologies by name+category, keeping highest confidence
 */
function deduplicateTechnologies(technologies) {
  const uniqueKey = (tech) => `${tech.name}::${tech.category}`;
  const techMap = new Map();

  for (const tech of technologies) {
    const key = uniqueKey(tech);
    const existing = techMap.get(key);
    
    if (!existing || (existing.confidence ?? 0) < (tech.confidence ?? 0)) {
      techMap.set(key, tech);
    }
  }

  return Array.from(techMap.values())
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
}

// ============================================================
// FETCHING
// ============================================================

/**
 * Fetches URL and returns HTML with headers
 * @param {string} url - URL to fetch
 * @returns {Promise<Object>} { finalUrl, status, html, headers }
 */
export async function fetchHtmlWithHeaders(url) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: { 
      "user-agent": "lead-pipeline/1.0" 
    },
  });

  const html = await response.text();
  
  // Convert Headers object to plain object
  const headers = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return {
    finalUrl: response.url,
    status: response.status,
    html,
    headers,
  };
}

// ============================================================
// DETECTION MODULES
// ============================================================

/**
 * Detects CDN and server technologies from headers
 */
function detectServerAndCDN(headers) {
  const detected = [];
  const h = normalizeHeaders(headers);

  // Cloudflare
  if (h["server"]?.includes("cloudflare")) {
    detected.push(createTech("Cloudflare", "CDN", 0.9, `server: ${h["server"]}`));
  }
  if (h["cf-ray"] || h["cf-cache-status"]) {
    detected.push(createTech("Cloudflare", "CDN", 0.95, "cf-* headers"));
  }

  // Fastly
  if (h["x-served-by"]?.includes("cache") || h["fastly-debug-digest"]) {
    detected.push(createTech("Fastly", "CDN", 0.85, "fastly headers"));
  }

  // Akamai
  if (h["x-akamai-transformed"] || h["akamai-cache-status"]) {
    detected.push(createTech("Akamai", "CDN", 0.9, "akamai headers"));
  }

  // AWS CloudFront
  if (h["x-amz-cf-id"] || h["via"]?.includes("CloudFront")) {
    detected.push(createTech("CloudFront", "CDN", 0.9, "aws cloudfront headers"));
  }

  // Backend servers
  if (h["x-powered-by"]?.includes("php")) {
    detected.push(createTech("PHP", "Backend", 0.75, `x-powered-by: ${h["x-powered-by"]}`));
  }
  if (h["x-powered-by"]?.includes("express")) {
    detected.push(createTech("Express", "Backend", 0.85, `x-powered-by: ${h["x-powered-by"]}`));
  }
  if (h["x-powered-by"]?.includes("next.js")) {
    detected.push(createTech("Next.js", "Framework", 0.85, `x-powered-by: ${h["x-powered-by"]}`));
  }
  if (h["x-powered-by"]?.includes("asp.net")) {
    detected.push(createTech("ASP.NET", "Backend", 0.85, `x-powered-by: ${h["x-powered-by"]}`));
  }

  // Server software
  if (h["server"]?.includes("nginx")) {
    detected.push(createTech("Nginx", "Server", 0.8, `server: ${h["server"]}`));
  }
  if (h["server"]?.includes("apache")) {
    detected.push(createTech("Apache", "Server", 0.8, `server: ${h["server"]}`));
  }
  if (h["server"]?.includes("iis")) {
    detected.push(createTech("IIS", "Server", 0.8, `server: ${h["server"]}`));
  }

  return detected;
}

/**
 * Detects CMS platforms
 */
function detectCMS($, htmlLower, generator) {
  const detected = [];

  // WordPress
  if (generator.includes("wordpress") || /wp-content|wp-includes/.test(htmlLower)) {
    detected.push(createTech("WordPress", "CMS", 0.95, "wp-content/generator"));
  }

  // Drupal
  if (generator.includes("drupal") || /drupal\.js|sites\/all\//.test(htmlLower)) {
    detected.push(createTech("Drupal", "CMS", 0.9, "drupal markers"));
  }

  // Joomla
  if (generator.includes("joomla") || /\/media\/jui\//.test(htmlLower)) {
    detected.push(createTech("Joomla", "CMS", 0.9, "joomla markers"));
  }

  // TYPO3
  if (/typo3/.test(htmlLower) || generator.includes("typo3")) {
    detected.push(createTech("TYPO3", "CMS", 0.9, "typo3 markers"));
  }

  // Contentful
  if (/contentful\.com/.test(htmlLower)) {
    detected.push(createTech("Contentful", "Headless CMS", 0.85, "contentful.com"));
  }

  // Strapi
  if (/strapi/i.test(htmlLower)) {
    detected.push(createTech("Strapi", "Headless CMS", 0.85, "strapi markers"));
  }

  return detected;
}

/**
 * Detects ecommerce platforms
 */
function detectEcommerce(scripts, htmlLower) {
  const detected = [];

  // Shopify
  if (/cdn\.shopify\.com|shopify/i.test(scripts) || /shopify-section/.test(htmlLower)) {
    detected.push(createTech("Shopify", "Ecommerce", 0.95, "shopify markers"));
  }

  // WooCommerce
  if (/woocommerce|wc-/.test(htmlLower)) {
    detected.push(createTech("WooCommerce", "Ecommerce", 0.9, "woocommerce markers"));
  }

  // Magento
  if (/mage\/|magento/i.test(scripts)) {
    detected.push(createTech("Magento", "Ecommerce", 0.9, "magento scripts"));
  }

  // BigCommerce
  if (/bigcommerce/i.test(scripts)) {
    detected.push(createTech("BigCommerce", "Ecommerce", 0.9, "bigcommerce"));
  }

  // PrestaShop
  if (/prestashop/i.test(htmlLower)) {
    detected.push(createTech("PrestaShop", "Ecommerce", 0.9, "prestashop markers"));
  }

  return detected;
}

/**
 * Detects website builders
 */
function detectBuilders(scripts, htmlLower, generator) {
  const detected = [];

  // Wix
  if (/wix\.com|wixsite/i.test(scripts) || generator.includes("wix")) {
    detected.push(createTech("Wix", "Website Builder", 0.95, "wix scripts/meta"));
  }

  // Webflow
  if (/webflow/i.test(scripts) || /data-wf-page/.test(htmlLower)) {
    detected.push(createTech("Webflow", "Website Builder", 0.95, "webflow markers"));
  }

  // Squarespace
  if (/squarespace/i.test(scripts) || /static\.squarespace\.com/.test(scripts)) {
    detected.push(createTech("Squarespace", "Website Builder", 0.95, "squarespace"));
  }

  // Elementor (WordPress page builder)
  if (/elementor/i.test(htmlLower)) {
    detected.push(createTech("Elementor", "Page Builder", 0.9, "elementor markers"));
  }

  // Divi
  if (/divi-|et-db|et_builder/.test(htmlLower)) {
    detected.push(createTech("Divi", "Page Builder", 0.9, "divi markers"));
  }

  return detected;
}

/**
 * Detects frontend frameworks
 */
function detectFrontendFrameworks(scripts, htmlLower) {
  const detected = [];

  // Next.js
  if (/__next_data__|next\/static|_next\//.test(htmlLower)) {
    detected.push(createTech("Next.js", "Framework", 0.95, "__NEXT_DATA__ / next/static"));
  }

  // React
  if (/data-reactroot|data-react|__REACT/.test(htmlLower) && /react/i.test(scripts)) {
    detected.push(createTech("React", "Frontend", 0.7, "react markers"));
  }

  // Vue
  if (/vue/i.test(scripts) || /data-v-|__vue__|v-cloak/.test(htmlLower)) {
    detected.push(createTech("Vue.js", "Frontend", 0.7, "vue markers"));
  }

  // Angular
  if (/ng-version|angular/i.test(htmlLower)) {
    detected.push(createTech("Angular", "Frontend", 0.8, "angular markers"));
  }

  // Svelte
  if (/svelte/i.test(scripts)) {
    detected.push(createTech("Svelte", "Frontend", 0.75, "svelte scripts"));
  }

  // Nuxt.js
  if (/__nuxt|nuxt\.js/.test(htmlLower)) {
    detected.push(createTech("Nuxt.js", "Framework", 0.9, "nuxt markers"));
  }

  // Gatsby
  if (/gatsby/i.test(scripts) || /___gatsby/.test(htmlLower)) {
    detected.push(createTech("Gatsby", "Framework", 0.9, "gatsby markers"));
  }

  return detected;
}

/**
 * Detects analytics and tracking tools
 */
function detectAnalytics(scripts) {
  const detected = [];

  // Google Tag Manager
  if (/googletagmanager\.com\/gtm\.js\?id=gtm-/.test(scripts)) {
    detected.push(createTech("Google Tag Manager", "Analytics", 0.95, "gtm.js"));
  }

  // Google Analytics 4
  if (/gtag\/js\?id=G-/.test(scripts)) {
    detected.push(createTech("Google Analytics 4", "Analytics", 0.95, "gtag GA4"));
  }

  // Universal Analytics
  if (/google-analytics\.com\/analytics\.js/.test(scripts)) {
    detected.push(createTech("Google Analytics", "Analytics", 0.95, "analytics.js"));
  }

  // Matomo
  if (/matomo|piwik/.test(scripts)) {
    detected.push(createTech("Matomo", "Analytics", 0.9, "matomo/piwik"));
  }

  // Mixpanel
  if (/mixpanel/i.test(scripts)) {
    detected.push(createTech("Mixpanel", "Analytics", 0.9, "mixpanel"));
  }

  // Segment
  if (/cdn\.segment\.com|analytics\.js/.test(scripts)) {
    detected.push(createTech("Segment", "Analytics", 0.85, "segment"));
  }

  return detected;
}

/**
 * Detects advertising platforms
 */
function detectAdvertising(scripts) {
  const detected = [];

  // Meta Pixel
  if (/connect\.facebook\.net\/.*fbevents\.js|fbq\(['"]init['"]/.test(scripts)) {
    detected.push(createTech("Meta Pixel", "Advertising", 0.95, "fbevents.js"));
  }

  // Google Ads
  if (/gtag\(['"]config['"],\s*['"]aw-/.test(scripts) || /googleadservices/.test(scripts)) {
    detected.push(createTech("Google Ads", "Advertising", 0.85, "AW-/googleadservices"));
  }

  // LinkedIn Insight
  if (/snap\.licdn\.com/.test(scripts)) {
    detected.push(createTech("LinkedIn Insight", "Advertising", 0.9, "linkedin insight"));
  }

  // Twitter/X Pixel
  if (/static\.ads-twitter\.com/.test(scripts)) {
    detected.push(createTech("Twitter Pixel", "Advertising", 0.9, "twitter ads"));
  }

  // TikTok Pixel
  if (/analytics\.tiktok\.com/.test(scripts)) {
    detected.push(createTech("TikTok Pixel", "Advertising", 0.9, "tiktok analytics"));
  }

  return detected;
}

/**
 * Detects CRO and heatmap tools
 */
function detectCRO(scripts) {
  const detected = [];

  // Hotjar
  if (/hotjar/i.test(scripts)) {
    detected.push(createTech("Hotjar", "CRO", 0.95, "hotjar"));
  }

  // Microsoft Clarity
  if (/clarity\.ms/i.test(scripts)) {
    detected.push(createTech("Microsoft Clarity", "CRO", 0.95, "clarity.ms"));
  }

  // Mouseflow
  if (/mouseflow/i.test(scripts)) {
    detected.push(createTech("Mouseflow", "CRO", 0.9, "mouseflow"));
  }

  // Crazy Egg
  if (/crazyegg/i.test(scripts)) {
    detected.push(createTech("Crazy Egg", "CRO", 0.9, "crazyegg"));
  }

  // VWO (Visual Website Optimizer)
  if (/visualwebsiteoptimizer\.com|vwo\.com/.test(scripts)) {
    detected.push(createTech("VWO", "A/B Testing", 0.9, "vwo"));
  }

  // Optimizely
  if (/optimizely\.com/.test(scripts)) {
    detected.push(createTech("Optimizely", "A/B Testing", 0.9, "optimizely"));
  }

  return detected;
}

/**
 * Detects payment providers
 */
function detectPayments(scripts) {
  const detected = [];

  // Stripe
  if (/js\.stripe\.com/.test(scripts)) {
    detected.push(createTech("Stripe", "Payments", 0.95, "js.stripe.com"));
  }

  // PayPal
  if (/paypal\.com\/sdk\/js/.test(scripts)) {
    detected.push(createTech("PayPal", "Payments", 0.95, "paypal sdk"));
  }

  // Square
  if (/squareup\.com|square\.site/.test(scripts)) {
    detected.push(createTech("Square", "Payments", 0.9, "square"));
  }

  // Braintree
  if (/braintreegateway\.com/.test(scripts)) {
    detected.push(createTech("Braintree", "Payments", 0.9, "braintree"));
  }

  return detected;
}

/**
 * Detects chat and support tools
 */
function detectChatSupport(scripts) {
  const detected = [];

  // Chatbase
  if (/chatbase\.co|window\.chatbase|chatbase/i.test(scripts)) {
    detected.push(createTech("Chatbase", "Chat", 0.95, "chatbase"));
  }

  // Intercom
  if (/widget\.intercom\.io|window\.intercom/.test(scripts)) {
    detected.push(createTech("Intercom", "Chat", 0.95, "intercom"));
  }

  // Crisp
  if (/client\.crisp\.chat/.test(scripts)) {
    detected.push(createTech("Crisp", "Chat", 0.95, "crisp"));
  }

  // Zendesk
  if (/static\.zdassets\.com|zendesk/.test(scripts)) {
    detected.push(createTech("Zendesk", "Support", 0.95, "zendesk"));
  }

  // Drift
  if (/js\.driftt\.com/.test(scripts)) {
    detected.push(createTech("Drift", "Chat", 0.95, "drift"));
  }

  // Tawk.to
  if (/tawk\.to/.test(scripts)) {
    detected.push(createTech("Tawk.to", "Chat", 0.95, "tawk.to"));
  }

  // LiveChat
  if (/livechatinc\.com/.test(scripts)) {
    detected.push(createTech("LiveChat", "Chat", 0.95, "livechat"));
  }

  return detected;
}

/**
 * Detects email marketing tools
 */
function detectEmailMarketing(scripts) {
  const detected = [];

  // Mailchimp
  if (/mailchimp/i.test(scripts)) {
    detected.push(createTech("Mailchimp", "Email Marketing", 0.9, "mailchimp"));
  }

  // HubSpot
  if (/js\.hs-scripts\.com|hubspot/i.test(scripts)) {
    detected.push(createTech("HubSpot", "Marketing", 0.9, "hubspot"));
  }

  // Klaviyo
  if (/klaviyo/i.test(scripts)) {
    detected.push(createTech("Klaviyo", "Email Marketing", 0.9, "klaviyo"));
  }

  return detected;
}

// ============================================================
// MAIN DETECTION FUNCTION
// ============================================================

/**
 * Detects technology stack from HTML and headers
 * 
 * @param {Object} params - Detection parameters
 * @param {string} params.html - HTML content
 * @param {Object} params.headers - Response headers
 * @returns {Object} { technologies: Array<{name, category, confidence, evidence}> }
 * 
 * @example
 * const stack = detectStack({ html, headers });
 * console.log(stack.technologies); // [{ name: 'React', category: 'Frontend', ... }]
 */
export function detectStack({ html, headers }) {
  const $ = cheerio.load(html);
  
  // Prepare normalized content for pattern matching
  const htmlLower = html.toLowerCase();
  const scripts = $("script")
    .map((_, el) => ($(el).attr("src") || "") + "\n" + ($(el).html() || ""))
    .get()
    .join("\n")
    .toLowerCase();
  const generator = ($("meta[name='generator']").attr("content") || "").toLowerCase();

  // Run all detection modules
  const allDetected = [
    ...detectServerAndCDN(headers),
    ...detectCMS($, htmlLower, generator),
    ...detectEcommerce(scripts, htmlLower),
    ...detectBuilders(scripts, htmlLower, generator),
    ...detectFrontendFrameworks(scripts, htmlLower),
    ...detectAnalytics(scripts),
    ...detectAdvertising(scripts),
    ...detectCRO(scripts),
    ...detectPayments(scripts),
    ...detectChatSupport(scripts),
    ...detectEmailMarketing(scripts),
  ];

  return {
    technologies: deduplicateTechnologies(allDetected),
  };
}