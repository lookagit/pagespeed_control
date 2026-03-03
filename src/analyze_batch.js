// ============================================================
// analyze_batch.js - STAGE 2: AI Analiza leadova
// ============================================================
// Ulaz : out/*.json  (Stage 1 output iz index.js)
// Izlaz: out/final/{basename}.json   — enriched lead pack
//        out/report/{basename}.csv   — Zoho-ready CSV
//
// FLOW PO LEADU:
//   1. Učitaj Stage 1 JSON
//   2. buildCallReport()   → bogati callReport (health, vitals, temp)
//   3. scrapeSiteSnapshot() → svež sadržaj sajta
//   4. analyzeLeadWithDeepSeek() → 4-pass AI analiza (dentist jezik)
//   5. summarizeSite()     → services, tone, booking
//   6. buildLeadPack()     → čist pack objekat
//   7. enrichLead()        → 6 AI poziva za Zoho polja
//   8. Sačuvaj JSON + CSV
//
// Pokretanje:
//   node src/analyze_batch.js
//   node src/analyze_batch.js --force   ← ponovi sve, ignoriši keš
// ============================================================

import fs   from "fs";
import path from "path";
import { CONFIG }                  from "./config.js";
import { readJson }                from "./io/readJson.js";
import { writeJson }               from "./io/write.js";
import { sleep, withRetries }      from "./utils/helpers.js";
import { buildCallReport }         from "./pagespeed/batch-reporter.js";
import { analyzeLeadWithDeepSeek } from "./ai/analyzeLead.js";
import { scrapeSiteSnapshot }      from "./utils/siteScrape.js";
import { summarizeSite }           from "./ai/checkHtmlAndUrl.js";
import { buildLeadPack }           from "./ai/buildLeadPack.js";
import { enrichLead }              from "./ai/enrichLead.js";
import { leadPackToCsv }           from "./ai/createFinalReport.js";
import { buildSignalReport } from "./ai/buildSignalReport.js";
import { ca } from "zod/v4/locales";

// ─────────────────────────────────────────────────────────────
// DISCOVERY — pronađi sve Stage 1 JSON fajlove
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

async function processFile({ filename, filepath, basename }, options) {
  console.log("\n" + "─".repeat(60));
  console.log(`📄 ${filename}`);

  if (!options.force && isAlreadyAnalyzed(basename)) {
    console.log("⏭️  Već analiziran. --force za ponovnu analizu.");
    return { status: "skipped" };
  }

  let callReport = null;

  try {
    // ── 1. Učitaj Stage 1 JSON ─────────────────────────────
    const raw = readJson(filepath);

    if (!raw?.item?.lead?.website_url) {
      throw new Error("Neispravan format: nedostaje item.lead.website_url");
    }
    if (raw.item.status === "failed") {
      console.log("⏭️  Preskočen (Stage 1 = failed).");
      return { status: "skipped" };
    }

    // ── 2. buildCallReport() ───────────────────────────────
    // Parsira pagespeed, signals, stack iz Stage 1 JSON i vraća:
    //   health_score, health_grade, lead_temperature,
    //   scores, vitals_mobile, resources_mobile,
    //   tracking, seo, booking, tech_stack,
    //   phones, emails, ctas, description
    callReport = buildCallReport(raw);
    //console.log(`✅ Call report: health=${callReport.health_score}/100 (${callReport.health_grade}) | temp=${callReport.lead_temperature?.label ?? "N/A"}`, callReport);
    // Sačuvaj originalni lead za Zoho polja (name, phone, address, city...)
    callReport._originalLead = raw.item.lead;
    const callReportAnalyze = await withRetries(
      () => buildSignalReport(callReport),
      "Optimizovanje call reporta za AI",
      CONFIG.MAX_RETRIES
    );

    const url = callReport.website_url;
    if (!url) throw new Error("buildCallReport nije vratio website_url");

    console.log(`🌐 ${url}`);
    console.log(`   Health: ${callReport.health_score}/100 (${callReport.health_grade}) | Temp: ${callReport.lead_temperature?.label ?? "N/A"}`);
    console.log(`   Mobile: ${callReport.scores?.mobile_perf}/100 | Desktop: ${callReport.scores?.desktop_perf}/100`);

    // ── 3. Scrape sajta ────────────────────────────────────
    const scrapeResult = await withRetries(
      () => scrapeSiteSnapshot(url),
      "Scrape sajta",
      CONFIG.MAX_RETRIES
    );

    if (scrapeResult.ok) {
      console.log(`✅ Scrape: ${scrapeResult.extraPages?.length ?? 0} extra stranica`);
    } else {
      console.log(`⚠️  Scrape neuspešan: ${scrapeResult.error}`);
    }

    // ── 4. AI analiza (4 fokusirana passa) ────────────────
    // Pass 1: brzina (patient impact)
    // Pass 2: SEO / Google vidljivost
    // Pass 3: zakazivanje & konverzija
    // Pass 4: sinteza → score, problems, pitch, email hooks
    const analysis = await withRetries(
      () => analyzeLeadWithDeepSeek({
        callReport: callReportAnalyze,
        scrapeBase: scrapeResult?.base ?? null,
      }),
      "AI analiza",
      CONFIG.MAX_RETRIES
    );
    console.log("✅ AI analiza završena",);
    // ── 6. Build lead pack ────────────────────────────────
    const leadPack = await buildLeadPack({
      lead:        callReport._originalLead,
      analysis,
    });
    console.log("✅ Lead pack kreiran", leadPack);
    // ── 7. Enrichment — 6 AI poziva za Zoho polja ─────────
    // enrichLead koristi analysis._passes (speed/seo/conversion)
    // koji su već izračunati u koraku 4 — nema duplog rada
    const enrichedPack = await withRetries(
      () => enrichLead({ leadPack, analysis, item: callReport }),
      "Enrichment",
      CONFIG.MAX_RETRIES
    );
    console.log("✅ Enrichment završen");

    // ── 8. Sačuvaj outpute ────────────────────────────────
    fs.mkdirSync(CONFIG.FINAL_DIR,  { recursive: true });
    fs.mkdirSync(CONFIG.REPORT_DIR, { recursive: true });

    const jsonPath = path.join(CONFIG.FINAL_DIR,  `${basename}.json`);
    const csvPath  = path.join(CONFIG.REPORT_DIR, `${basename}.csv`);

    // Dodaj call report snapshot u final JSON (bez _originalLead koji
    // je već u enrichedPack.lead)
    delete enrichedPack._originalLead;
    enrichedPack._callReport = {
      health_score:     callReport.health_score,
      health_grade:     callReport.health_grade,
      lead_temperature: callReport.lead_temperature,
      description:      callReport.description,
    };

    writeJson(jsonPath, enrichedPack);
    await leadPackToCsv(enrichedPack, csvPath);

    console.log(`💾 JSON: ${jsonPath}`);
    console.log(`📊 CSV:  ${csvPath}`);

    return { status: "success" };

  } catch (err) {
    console.log(`❌ Greška: ${err?.message || err}`);

    fs.mkdirSync(CONFIG.FINAL_DIR, { recursive: true });
    writeJson(path.join(CONFIG.FINAL_DIR, `${basename}.error.json`), {
      lead:      { website_url: callReport?.website_url },
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

  console.log(`📦 Pronađeno fajlova: ${files.length}\n`);

  let ok = 0, failed = 0, skipped = 0;

  for (const f of files) {
    const res = await processFile(f, { force });
    if (res.status === "success") ok++;
    else if (res.status === "failed") failed++;
    else skipped++;
  }

  console.log("\n" + "=".repeat(60));
  console.log("✅ STAGE 2 ZAVRŠEN");
  console.log(`   Uspešno:    ${ok}`);
  console.log(`   Neuspešno:  ${failed}`);
  console.log(`   Preskočeno: ${skipped}`);
  console.log(`   JSON:  ${CONFIG.FINAL_DIR}/`);
  console.log(`   CSV:   ${CONFIG.REPORT_DIR}/`);
  console.log("=".repeat(60) + "\n");
}

main().catch(e => {
  console.error("❌ Fatalna greška:", e?.message || e);
  process.exit(1);
});