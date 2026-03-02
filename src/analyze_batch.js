// ============================================================
// analyze_batch.js - STAGE 2: AI Analiza leadova
// ============================================================
// Ulaz : out/*.json (call report iz pagespeed-reporter.js)
// Izlaz: out/final/{basename}.json
//        out/report/{basename}.csv
//
// Pokretanje:
//   node src/analyze_batch.js
//   node src/analyze_batch.js --force
// ============================================================

import fs from "fs";
import path from "path";
import { CONFIG } from "./config.js";
import { readJson } from "./io/readJson.js";
import { writeJson } from "./io/write.js";
import { sleep, withRetries } from "./utils/helpers.js";
import { analyzeLeadWithDeepSeek } from "./ai/analyzeLead.js";
import { scrapeSiteSnapshot } from "./utils/siteScrape.js";
import { summarizeSite } from "./ai/checkHtmlAndUrl.js";
import { buildLeadPack } from "./ai/buildLeadPack.js";
import { leadPackToCsv } from "./ai/createFinalReport.js";
import { enrichLead } from "./ai/enrichLead.js";

// ─────────────────────────────────────────────────────────────
// DISCOVERY
// ─────────────────────────────────────────────────────────────

function findRawLeadFiles() {
  fs.mkdirSync(CONFIG.OUT_DIR, { recursive: true });

  return fs
    .readdirSync(CONFIG.OUT_DIR, { withFileTypes: true })
    .filter(e => e.isFile() && e.name.endsWith(".json"))
    .filter(e => !e.name.endsWith(".error.json"))
    .filter(e => !e.name.startsWith("_"))
    .map(e => ({
      filename: e.name,
      filepath: path.join(CONFIG.OUT_DIR, e.name),
      basename: path.basename(e.name, ".json"),
    }));
}

function isAlreadyAnalyzed(basename) {
  return fs.existsSync(path.join(CONFIG.FINAL_DIR, `${basename}.json`));
}

// ─────────────────────────────────────────────────────────────
// OBRADA JEDNOG FAJLA
// ─────────────────────────────────────────────────────────────

async function processFile(fileInfo, options) {
  const { filename, filepath, basename } = fileInfo;

  console.log("\n" + "─".repeat(60));
  console.log(`📄 ${filename}`);

  if (!options.force && isAlreadyAnalyzed(basename)) {
    console.log("⏭️  Već analiziran. --force za ponovnu analizu.");
    return { status: "skipped" };
  }

  let callReport = null;

  try {
    // 1. Učitaj Stage 1 podatke — podržavamo oba formata:
    //    A) Novi: flat call report  { name, website_url, scores, tracking, ... }
    //    B) Stari: wrapped format   { item: { lead: { website_url }, pagespeed, signals, ... } }
    const raw = readJson(filepath);

    if (raw?.website_url) {
      // Format A — novi flat call report
      callReport = raw;
    } else if (raw?.item?.lead?.website_url) {
      // Format B — stari wrapped format, konvertuj u call report strukturu
      const item = raw.item;
      const lead = item.lead;

      if (item.status === "failed") {
        console.log("⏭️  Preskočen (Stage 1 = failed).");
        return { status: "skipped" };
      }

      const ps = item.pagespeed || {};
      const sig = item.signals  || {};
      const t   = sig.tracking  || {};
      const b   = sig.booking   || {};
      const seo = sig.seo       || {};
      const stk = item.stack    || {};

      // Normalizuj u flat strukturu kompatibilnu sa novim kodom
      callReport = {
        name:          lead.name,
        website_url:   lead.website_url,
        address:       lead.address ?? null,
        processed_at:  item.processed_at ?? null,
        health_score:  null,
        health_grade:  null,

        phones:             item.contact_summary?.phones ?? [],
        emails:             item.contact_summary?.emails ?? [],
        has_online_booking: !!(b.type && b.type !== "unknown"),
        booking_type:       b.type   ?? "unknown",
        booking_vendor:     b.vendor ?? null,
        ctas:               [],

        seo: seo ? {
          has_title:            !!seo.title,
          title:                seo.title ?? null,
          has_meta_description: !!(seo.meta_description),
          has_canonical:        !!(seo.canonical),
          has_open_graph:       !!(seo.open_graph?.og_title),
          has_twitter_card:     !!(seo.twitter_card?.twitter_card),
          h1_count:             seo.content_analysis?.h1_count ?? null,
          h1_text:              seo.content_analysis?.h1_text  ?? null,
          word_count:           seo.content_analysis?.word_count ?? null,
          image_count:          seo.content_analysis?.image_count ?? null,
          images_without_alt:   seo.content_analysis?.images_without_alt ?? null,
          has_structured_data:  !!(seo.structured_data?.length),
          structured_data_type: seo.structured_data?.[0]?.["@type"] ?? null,
          has_https_forms:      !!(seo.security?.has_https_forms),
          has_lazy_loading:     !!(seo.performance_hints?.has_lazy_loading),
          has_async_scripts:    !!(seo.performance_hints?.has_async_scripts),
        } : null,

        tracking: {
          has_ga4:        t.ga4         ?? false,
          has_gtm:        t.gtm         ?? false,
          has_meta_pixel: t.meta_pixel  ?? false,
          has_google_ads: t.google_ads  ?? false,
          has_chatbot:    !!(sig.chatbot?.has_chatbot),
          chatbot_vendor: sig.chatbot?.vendor ?? null,
        },

        scores: {
          mobile_perf:  ps.mobile?.categories?.performance  ?? null,
          mobile_seo:   ps.mobile?.categories?.seo          ?? null,
          mobile_acc:   ps.mobile?.categories?.accessibility ?? null,
          mobile_bp:    ps.mobile?.categories?.best_practices ?? null,
          desktop_perf: ps.desktop?.categories?.performance  ?? null,
          desktop_seo:  ps.desktop?.categories?.seo          ?? null,
          desktop_acc:  ps.desktop?.categories?.accessibility ?? null,
          desktop_bp:   ps.desktop?.categories?.best_practices ?? null,
        },

        vitals_mobile:    {},
        resources_mobile: {},

        tech_stack: (stk.technologies ?? [])
          .map(t => ({ name: t.name, category: t.category, confidence: Math.round((t.confidence ?? 0) * 100) }))
          .sort((a, b) => b.confidence - a.confidence)
          .slice(0, 8),

        lead_temperature: null,
      };

      console.log("ℹ️  Stari format detektovan — konvertovan u call report strukturu");
    } else {
      throw new Error("Neispravan format fajla: nedostaje website_url ili item.lead.website_url");
    }

    const url = callReport.website_url;
    console.log(`🌐 ${url}`);

    // 2. Scrape sajta PRVO — rezultat ide i u AI analizu i u sumarizaciju
    const scrapeResult = await withRetries(
      () => scrapeSiteSnapshot(url),
      "Scrape sajta",
      CONFIG.MAX_RETRIES
    );

    if (!scrapeResult.ok) {
      console.log(`⚠️  Scrape neuspešan: ${scrapeResult.error}`);
    } else {
      console.log(`✅ Scrape: ${scrapeResult.extraPages?.length ?? 0} extra stranica`);
    }

    // 3. AI analiza — prima ceo call report + scrape
    const analysis = await withRetries(
      () => analyzeLeadWithDeepSeek({
        callReport,
        scrapeBase: scrapeResult?.base ?? null,
      }),
      "AI analiza",
      CONFIG.MAX_RETRIES
    );
    console.log(`✅ AI analiza: skor=${analysis.score}/100 | prioritet=${analysis.priority}`);

    // 4. Sumiraj sadržaj sajta
    const siteSummary = scrapeResult.ok
      ? await withRetries(
          () => summarizeSite({ url, tokens: scrapeResult.tokens }),
          "Sumarizacija sajta",
          CONFIG.MAX_RETRIES
        )
      : { summary: "Sajt nije bio dostupan.", services: [], tone: "unknown" };

    console.log("✅ Sajt sumarizovan");

    // 5. Složi finalni lead pack
    // lead objekat pravimo iz call reporta za kompatibilnost sa buildLeadPack/enrichLead
    const lead = {
      name:        callReport.name,
      website_url: callReport.website_url,
      address:     callReport.address,
    };

    const leadPack = await withRetries(
      () => buildLeadPack({ lead, analysis, siteSummary }),
      "Build lead pack",
      CONFIG.MAX_RETRIES
    );
    console.log("✅ Lead pack kreiran");

    // 6. Enrichment — mali fokusirani AI pozivi
    const enrichedPack = await withRetries(
      () => enrichLead({ leadPack, analysis, item: callReport }),
      "Enrichment",
      CONFIG.MAX_RETRIES
    );
    console.log("✅ Enrichment završen");

    // 7. Sačuvaj izlaze
    fs.mkdirSync(CONFIG.FINAL_DIR, { recursive: true });
    fs.mkdirSync(CONFIG.REPORT_DIR, { recursive: true });

    const jsonPath = path.join(CONFIG.FINAL_DIR, `${basename}.json`);
    const csvPath  = path.join(CONFIG.REPORT_DIR, `${basename}.csv`);

    writeJson(jsonPath, enrichedPack);
    await leadPackToCsv(enrichedPack, csvPath);

    console.log(`💾 JSON: ${jsonPath}`);
    console.log(`📊 CSV:  ${csvPath}`);

    return { status: "success" };

  } catch (err) {
    console.log(`❌ Greška: ${err?.message || err}`);

    fs.mkdirSync(CONFIG.FINAL_DIR, { recursive: true });
    const errorPath = path.join(CONFIG.FINAL_DIR, `${basename}.error.json`);
    writeJson(errorPath, {
      lead:      { name: callReport?.name, website_url: callReport?.website_url },
      error:     { message: err?.message, stack: err?.stack },
      timestamp: new Date().toISOString(),
    });

    return { status: "failed" };
  } finally {
    await sleep(CONFIG.DELAY_MS);
  }
}

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────

async function main() {
  const args  = process.argv.slice(2);
  const force = args.includes("--force") || args.includes("-f");

  console.log("\n🚀 STAGE 2: AI ANALIZA LEADOVA\n");
  if (force) console.log("🔄 Force mode: ponavljam sve\n");

  const files = findRawLeadFiles();

  if (!files.length) {
    console.log(`❌ Nema JSON fajlova u ${CONFIG.OUT_DIR}/`);
    console.log("   Pokreni prvo: node src/index.js");
    process.exit(1);
  }

  console.log(`📦 Pronađeno fajlova: ${files.length}`);

  let ok = 0, failed = 0, skipped = 0;

  for (const f of files) {
    const res = await processFile(f, { force });
    if (res.status === "success") ok++;
    else if (res.status === "failed") failed++;
    else skipped++;
  }

  console.log("\n" + "=".repeat(60));
  console.log("✅ STAGE 2 ZAVRŠEN");
  console.log(`   Uspešno: ${ok} | Neuspešno: ${failed} | Preskočeno: ${skipped}`);
  console.log(`   JSON:    ${CONFIG.FINAL_DIR}/`);
  console.log(`   CSV:     ${CONFIG.REPORT_DIR}/`);
  console.log("=".repeat(60) + "\n");
}

main().catch(e => {
  console.error("❌ Fatalna greška:", e?.message || e);
  process.exit(1);
});