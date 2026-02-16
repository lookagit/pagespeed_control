import fs from "fs";
import { parse } from "csv-parse/sync";
import "dotenv/config";
import { z } from "zod";
import * as cheerio from "cheerio";
import { getCrux } from "./crux/crux.js";
import { fetchHtmlWithHeaders, detectStack } from "./stack/index.js";
import { CONFIG } from "./config.js";

const LeadSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().email(),
  website_url: z.string().url(),
  address: z.string().min(1),
});

function readCsv(filePath) {
  const csv = fs.readFileSync(filePath, "utf8");
  return parse(csv, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
}

function score100(v) {
  return typeof v === "number" ? Math.round(v * 100) : null;
}

function pickNumeric(audits, id) {
  const v = audits?.[id]?.numericValue;
  return typeof v === "number" ? v : null;
}

function pickDisplay(audits, id) {
  return audits?.[id]?.displayValue ?? null;
}

function uniq(arr) {
  return [...new Set((arr || []).filter(Boolean))];
}

function pickAuditSavings(audits, id) {
  const a = audits?.[id];
  if (!a) return null;
  const details = a.details || {};
  const overallSavingsMs = details?.overallSavingsMs;
  const overallSavingsBytes = details?.overallSavingsBytes;
  return {
    id,
    title: a.title ?? id,
    score: typeof a.score === "number" ? a.score : null,
    displayValue: a.displayValue ?? null,
    savings_ms: typeof overallSavingsMs === "number" ? overallSavingsMs : null,
    savings_bytes: typeof overallSavingsBytes === "number" ? overallSavingsBytes : null,
  };
}

function topSavingsAudits(audits, ids, limit = 5) {
  const items = ids
    .map((id) => pickAuditSavings(audits, id))
    .filter(Boolean)
    .filter((x) => x.savings_ms || x.savings_bytes);

  items.sort(
    (a, b) =>
      (b.savings_ms ?? 0) - (a.savings_ms ?? 0) ||
      (b.savings_bytes ?? 0) - (a.savings_bytes ?? 0)
  );
  return items.slice(0, limit);
}

function pickCrux(json) {
  const le = json?.loadingExperience;
  const ole = json?.originLoadingExperience;

  const pick = (obj) => {
    const m = obj?.metrics || {};
    const metric = (key) => {
      const k = m?.[key];
      if (!k) return null;
      return {
        percentile: typeof k.percentile === "number" ? k.percentile : null,
        category: k.category ?? null,
      };
    };
    return {
      lcp_ms: metric("LARGEST_CONTENTFUL_PAINT_MS"),
      inp_ms: metric("INTERACTION_TO_NEXT_PAINT"),
      cls: metric("CUMULATIVE_LAYOUT_SHIFT_SCORE"),
      overall_category: obj?.overall_category ?? null,
    };
  };

  return { page: pick(le), origin: pick(ole) };
}

async function runPageSpeed(url, strategy) {
  const apiKey = process.env.PSI_API_KEY;
  if (!apiKey) throw new Error("Missing PSI_API_KEY in .env");

  const endpoint = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  endpoint.searchParams.set("url", url);
  endpoint.searchParams.set("strategy", strategy);
  endpoint.searchParams.set("key", apiKey);

  ["performance", "seo", "accessibility", "best-practices"].forEach((c) =>
    endpoint.searchParams.append("category", c)
  );

  const res = await fetch(endpoint);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(
      `PSI failed ${res.status} ${res.statusText}: ${txt.slice(0, 200)}`
    );
  }

  const json = await res.json();

  const lh = json?.lighthouseResult;
  const audits = lh?.audits || {};
  const cats = lh?.categories || {};

  const lab = {
    fcp_ms: pickNumeric(audits, "first-contentful-paint"),
    lcp_ms: pickNumeric(audits, "largest-contentful-paint"),
    speed_index: pickNumeric(audits, "speed-index"),
    tbt_ms: pickNumeric(audits, "total-blocking-time"),
    cls: pickNumeric(audits, "cumulative-layout-shift"),
    inp_ms:
      pickNumeric(audits, "interaction-to-next-paint") ??
      pickNumeric(audits, "experimental-interaction-to-next-paint") ??
      null,
    tti_ms: pickNumeric(audits, "interactive"),
  };

  const opportunities = topSavingsAudits(audits, [
    "render-blocking-resources",
    "unused-javascript",
    "unused-css-rules",
    "unminified-javascript",
    "unminified-css",
    "uses-optimized-images",
    "uses-webp-images",
    "uses-responsive-images",
    "efficient-animated-content",
    "uses-text-compression",
    "uses-rel-preconnect",
    "server-response-time",
    "uses-long-cache-ttl",
  ]);

  const diagnostics = [
    "dom-size",
    "bootup-time",
    "mainthread-work-breakdown",
    "third-party-summary",
    "largest-contentful-paint-element",
  ]
    .map((id) => ({
      id,
      title: audits?.[id]?.title ?? null,
      displayValue: audits?.[id]?.displayValue ?? null,
      score: typeof audits?.[id]?.score === "number" ? audits[id].score : null,
    }))
    .filter((x) => x.title);

  return {
    strategy,
    final_url: lh?.finalUrl ?? null,
    fetched_at: new Date().toISOString(),
    categories: {
      performance: score100(cats?.performance?.score),
      seo: score100(cats?.seo?.score),
      accessibility: score100(cats?.accessibility?.score),
      best_practices: score100(cats?.["best-practices"]?.score),
    },
    lab,
    field: await getCrux(url, CONFIG.CRUX_API_KEY, "PHONE"),
    opportunities,
    diagnostics,
    display: {
      fcp: pickDisplay(audits, "first-contentful-paint"),
      lcp: pickDisplay(audits, "largest-contentful-paint"),
      cls: pickDisplay(audits, "cumulative-layout-shift"),
      tbt: pickDisplay(audits, "total-blocking-time"),
    },
  };
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": "lead-pipeline/1.0" },
  });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} ${res.statusText}`);
  return await res.text();
}

function pickImportantLinks(html, baseUrl) {
  const $ = cheerio.load(html);
  const links = $("a[href]")
    .map((_, el) => $(el).attr("href"))
    .get()
    .filter(Boolean);

  const abs = links
    .map((href) => {
      try {
        return new URL(href, baseUrl).toString();
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const baseHost = new URL(baseUrl).host;
  const sameHost = abs.filter((u) => {
    try {
      return new URL(u).host === baseHost;
    } catch {
      return false;
    }
  });

  const score = (u) => {
    const s = u.toLowerCase();
    let pts = 0;
    if (s.includes("kontakt") || s.includes("contact")) pts += 3;
    if (
      s.includes("termin") ||
      s.includes("zakaz") ||
      s.includes("appointment") ||
      s.includes("booking")
    )
      pts += 3;
    if (
      s.includes("team") ||
      s.includes("tim") ||
      s.includes("staff") ||
      s.includes("about") ||
      s.includes("uber-uns") ||
      s.includes("praxis")
    )
      pts += 2;
    if (s.includes("leistungen") || s.includes("services") || s.includes("usluge"))
      pts += 1;
    return pts;
  };

  const ranked = uniq(sameHost).sort((a, b) => score(b) - score(a));
  return ranked.filter((u) => score(u) > 0).slice(0, 5);
}

function detectFromHtml(html) {
  const $ = cheerio.load(html);

  const scriptBlob = $("script")
    .map((_, el) => {
      const src = $(el).attr("src") || "";
      const inline = $(el).html() || "";
      return `${src}\n${inline}`;
    })
    .get()
    .join("\n")
    .toLowerCase();

  const htmlLower = html.toLowerCase();
  const bodyText = $("body").text().toLowerCase();

  // Tracking
  const tracking = {
    ga4:
      /gtag\/js\?id=G-/.test(scriptBlob) ||
      /gtag\(['"]config['"],\s*['"]g-/.test(scriptBlob),
    gtm:
      /googletagmanager\.com\/gtm\.js\?id=gtm-/.test(scriptBlob) ||
      /gtm-/.test(scriptBlob),
    meta_pixel:
      /connect\.facebook\.net\/.*fbevents\.js/.test(scriptBlob) ||
      /fbq\(['"]init['"]/.test(scriptBlob),
    google_ads:
      /googleadservices/.test(scriptBlob) ||
      /gtag\(['"]config['"],\s*['"]aw-/.test(scriptBlob),
  };

  // Chatbot vendor
  const chatbotVendors = [
    ["chatbase", /chatbase\.co|window\.chatbase|chatbase/i],
    ["intercom", /widget\.intercom\.io|window\.intercom/],
    ["crisp", /client\.crisp\.chat/],
    ["tawk.to", /tawk\.to/],
    ["zendesk", /static\.zdassets\.com|zE\(/],
    ["drift", /js\.driftt\.com/],
    ["hubspot", /js\.hs-scripts\.com|hubspotconversations/],
    ["smartsupp", /smartsupp/],
    ["tidio", /tidio\.co|tidiochat/],
    ["livechat", /livechatinc/],
    ["freshchat", /freshchat/],
    ["chatwoot", /chatwoot/],
  ];

  let chatbot = { has_chatbot: false, vendor: null, confidence: 0.0 };
  for (const [name, rx] of chatbotVendors) {
    if (rx.test(scriptBlob) || rx.test(htmlLower)) {
      chatbot = { has_chatbot: true, vendor: name, confidence: 0.95 };
      break;
    }
  }

  // Contact
  const phones = uniq(
    $("a[href^='tel:']")
      .map((_, el) => ($(el).attr("href") || "").replace(/^tel:/, "").trim())
      .get()
  );

  const emails = uniq(
    $("a[href^='mailto:']")
      .map((_, el) =>
        ($(el).attr("href") || "").replace(/^mailto:/, "").split("?")[0].trim()
      )
      .get()
  );

  // Booking
  const bookingKeywords = ["termin", "zakaz", "appointment", "book", "online-termin", "reserv"];
  const bookingVendor = [
    ["calendly", /calendly\.com|calendly\.initpopupwidget/],
    ["simplybook", /simplybook/],
    ["setmore", /setmore\.com/],
    ["acuity", /acuityscheduling\.com/],
  ];

  let booking = { type: null, evidence: null, confidence: 0.0 };

  for (const [name, rx] of bookingVendor) {
    if (rx.test(scriptBlob) || rx.test(htmlLower)) {
      booking = { type: name, evidence: "embed/script", confidence: 0.9 };
      break;
    }
  }

  if (!booking.type) {
    const hasBookingText = bookingKeywords.some((k) => bodyText.includes(k));
    const hasForm = $("form").length > 0;
    if (hasBookingText && hasForm)
      booking = { type: "form", evidence: "form + booking keywords", confidence: 0.7 };
    else if (phones.length > 0)
      booking = { type: "phone", evidence: "tel: link present", confidence: 0.6 };
  }

  // SEO basics
  const seo = {
    title: $("title").text().trim() || null,
    meta_description: $("meta[name='description']").attr("content")?.trim() || null,
    og_title: $("meta[property='og:title']").attr("content")?.trim() || null,
    og_image: $("meta[property='og:image']").attr("content")?.trim() || null,
    canonical: $("link[rel='canonical']").attr("href")?.trim() || null,
  };

  return { tracking, chatbot, booking, contact: { phones, emails }, seo };
}

async function collectSignals(websiteUrl) {
  const homepageHtml = await fetchHtml(websiteUrl);
  const importantLinks = pickImportantLinks(homepageHtml, websiteUrl);

  const pages = [{ url: websiteUrl, html: homepageHtml }];

  for (const link of importantLinks.slice(0, 2)) {
    try {
      const html = await fetchHtml(link);
      pages.push({ url: link, html });
    } catch {
      // ignore
    }
  }

  const merged = {
    chatbot: { has_chatbot: false, vendor: null, confidence: 0.0, evidence_url: null },
    tracking: { ga4: false, gtm: false, meta_pixel: false, google_ads: false },
    booking: { type: null, evidence: null, confidence: 0.0, evidence_url: null },
    contact: { phones: [], emails: [] },
    seo: {},
    crawled_pages: pages.map((p) => p.url),
  };

  for (const p of pages) {
    const sig = detectFromHtml(p.html);

    for (const k of Object.keys(merged.tracking)) merged.tracking[k] ||= sig.tracking[k];

    if (!merged.chatbot.has_chatbot && sig.chatbot.has_chatbot) {
      merged.chatbot = { ...sig.chatbot, evidence_url: p.url };
    }

    if ((sig.booking.confidence ?? 0) > (merged.booking.confidence ?? 0)) {
      merged.booking = { ...sig.booking, evidence_url: p.url };
    }

    merged.contact.phones = uniq([...merged.contact.phones, ...sig.contact.phones]);
    merged.contact.emails = uniq([...merged.contact.emails, ...sig.contact.emails]);

    if (p.url === websiteUrl) merged.seo = sig.seo;
  }

  return merged;
}

// ---------- Main ----------

async function processLead(lead) {
  console.log(`\n🔎 Processing: ${lead.website_url}`);
  
  try {
    // 1. PageSpeed Insights
    console.log("  ⏳ Running PageSpeed (mobile & desktop)...");
    const [mobile, desktop] = await Promise.all([
      runPageSpeed(lead.website_url, "mobile"),
      runPageSpeed(lead.website_url, "desktop"),
    ]);
    
    console.log(`  ✅ PageSpeed complete (Mobile: ${mobile.categories.performance}%, Desktop: ${desktop.categories.performance}%)`);

    // 2. Signals
    console.log("  ⏳ Collecting signals...");
    const signals = await collectSignals(lead.website_url);
    console.log(`  ✅ Signals collected (Chatbot: ${signals.chatbot.vendor || 'none'}, Tracking: ${Object.values(signals.tracking).filter(Boolean).length} tools)`);

    // 3. Stack detection
    console.log("  ⏳ Detecting stack...");
    const home = await fetchHtmlWithHeaders(lead.website_url);
    const stack = {
      fetched_from: home.finalUrl,
      status: home.status,
      ...detectStack({ html: home.html, headers: home.headers }),
    };
    console.log(`  ✅ Stack detected (CMS: ${stack.cms || 'unknown'}, Server: ${stack.server || 'unknown'})`);

    // Optional: CrUX data (uncomment if needed)
    // console.log("  ⏳ Fetching CrUX data...");
    // const crux = await getCrux({
    //   websiteUrl: lead.website_url,
    //   apiKey: CONFIG.CRUX_API_KEY,
    //   formFactor: "PHONE",
    //   includePage: false,
    // });

    return {
      lead,
      pagespeed: { mobile, desktop },
      signals,
      stack,
      // crux, // uncomment if using CrUX
      processed_at: new Date().toISOString(),
    };
  } catch (error) {
    console.error(`  ❌ Error processing ${lead.website_url}:`, error.message);
    return {
      lead,
      error: error.message,
      processed_at: new Date().toISOString(),
    };
  }
}

async function main() {
  try {
    fs.mkdirSync("./out", { recursive: true });

    // Load and validate leads
    const filePath = process.env.LEADS_CSV || "./data/dentist_leads.csv";
    const rows = readCsv(filePath);

    const leads = [];
    const errors = [];

    rows.forEach((row, idx) => {
      const res = LeadSchema.safeParse(row);
      if (res.success) {
        leads.push(res.data);
      } else {
        errors.push({ row: idx + 2, issues: res.error.issues });
      }
    });

    console.log(`\n📊 Loaded ${leads.length} valid leads`);
    if (errors.length) {
      console.log(`⚠️  ${errors.length} invalid rows found`);
      console.dir(errors, { depth: 5 });
    }

    if (leads.length === 0) {
      console.log("❌ No valid leads found. Exiting.");
      return;
    }

    // Process leads (TEST MODE: first lead only)
    const results = [];
    const leadsToProcess = leads.slice(0, 1); // Change to leads.slice(0, N) for more

    for (const lead of leadsToProcess) {
      const result = await processLead(lead);
      results.push(result);
    }

    // Save results
    const outputPath = "./out/results.json";
    fs.writeFileSync(
      outputPath,
      JSON.stringify({ results, total: results.length }, null, 2),
      "utf8"
    );

    console.log(`\n✅ Processing complete!`);
    console.log(`📝 Results saved to: ${outputPath}`);
    console.log(`📊 Processed: ${results.length} leads`);
    console.log(`✅ Successful: ${results.filter(r => !r.error).length}`);
    console.log(`❌ Failed: ${results.filter(r => r.error).length}`);

  } catch (error) {
    console.error("\n❌ Fatal error:", error.message);
    process.exit(1);
  }
}

main();