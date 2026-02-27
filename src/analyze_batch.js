// ============================================================
// analyze_batch.js - STAGE 2: AI Analiza leadova
// ============================================================
// Ulaz : out/*.json (output Stage 1)
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

  let data = null;

  try {
    // 1. Učitaj Stage 1 podatke
    data = readJson(filepath);
    if (!data?.item) throw new Error("Neispravan format fajla: nedostaje data.item");
    if (data.item?.status === "failed") {
      console.log("⏭️  Preskočen (Stage 1 = failed).");
      return { status: "skipped" };
    }

    const { item } = data;
    const url = item.lead?.website_url;
    if (!url) throw new Error("Nedostaje lead.website_url");

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

    // 3. AI analiza — koristi i scrapeBase za bogatiji kontekst
    const analysis = await withRetries(
      () => analyzeLeadWithDeepSeek({
        lead:       item.lead,
        mobile:     item.pagespeed?.mobile,
        desktop:    item.pagespeed?.desktop,
        signals:    item.signals   ?? {},
        stack:      item.stack     ?? {},
        scrapeBase: scrapeResult?.base ?? null,
      }),
      "AI analiza",
      CONFIG.MAX_RETRIES
    );
    console.log(`✅ AI analiza: skor=${analysis.score}/100 | prioritet=${analysis.priority}`);

    // 4. Sumiraj sadržaj sajta (tokens = LLM-ready string iz scrape-a)
    const siteSummary = scrapeResult.ok
      ? await withRetries(
          () => summarizeSite({ url, tokens: scrapeResult.tokens }),
          "Sumarizacija sajta",
          CONFIG.MAX_RETRIES
        )
      : { summary: "Sajt nije bio dostupan.", services: [], tone: "unknown" };

    console.log("✅ Sajt sumarizovan");

    // 5. Složi finalni lead pack
    const leadPack = await withRetries(
      () => buildLeadPack({ lead: item.lead, analysis, siteSummary }),
      "Build lead pack",
      CONFIG.MAX_RETRIES
    );
    console.log("✅ Lead pack kreiran");

    // 6. Enrichment — mali fokusirani AI pozivi (cold email, ponuda, SWOT, report nota...)
    const enrichedPack = await withRetries(
      () => enrichLead({ leadPack, analysis, item }),
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
      lead:      data?.item?.lead ?? {},
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