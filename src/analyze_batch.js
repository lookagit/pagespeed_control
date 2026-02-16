// src/analyze_batch.js
// Batch runner: reads ./out/*.json and runs the SAME pipeline as analyze_one
// Usage:
//   node src/analyze_batch.js
//   node src/analyze_batch.js --force

import fs from "fs";
import path from "path";

import { readJson } from "./io/readJson.js";
import { writeJson } from "./io/writeJson.js";

import { analyzeLeadStrict } from "./ai/analyzeLead.js";
import { buildLeadPack } from "./ai/buildLeadPack.js";

import { scrapeSiteSnapshot } from "./utils/siteScrape.js";
import { summarizeSiteTo10 } from "./ai/checkHtmlAndUrl.js";

import { leadPackToClickUpCsv } from "./ai/createFinalReport.js";

// -------------------- CONFIG --------------------
const INPUT_DIR = "./out";
const FINAL_DIR = "./out/final";
const CLICKUP_DIR = "./out/clickup";

const MAX_RETRIES = 2;
const DELAY_BETWEEN_MS = 1200;

// -------------------- UTILS --------------------
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function discoverOutJsonFiles() {
  ensureDir(INPUT_DIR);

  const entries = fs.readdirSync(INPUT_DIR, { withFileTypes: true });

  return entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((name) => name.endsWith(".json"))
    // izbegni slučajno final/clickup summary fajlove ako ih ima u root out/
    .filter((name) => !name.endsWith(".error.json"))
    .filter((name) => !name.startsWith("_"))
    .map((filename) => {
      const filepath = path.join(INPUT_DIR, filename);
      const basename = path.basename(filename, ".json");
      return { filename, filepath, basename };
    });
}

function isAlreadyAnalyzed(basename) {
  const outPath = path.join(FINAL_DIR, `${basename}.json`);
  return fs.existsSync(outPath);
}

// isto kao u analyze_one
function prepareLeadContext(item) {
  return {
    lead: item.lead,
    pagespeed: item.pagespeed,
    crux: item.crux ?? null,
    signals: item.signals ?? null,
    stack: item.stack ?? null,
    snapshot: item.snapshot ?? null,
  };
}

async function withRetries(fn, label) {
  let lastErr = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 1) {
        console.log(`   🔁 retry ${attempt}/${MAX_RETRIES} (${label})...`);
      }
      return await fn();
    } catch (err) {
      lastErr = err;
      console.log(`   ⚠️  ${label} failed: ${err?.message || err}`);
      if (attempt < MAX_RETRIES) await sleep(DELAY_BETWEEN_MS);
    }
  }

  throw lastErr;
}

async function saveOutputsByBasename(basename, leadPack) {
  ensureDir(FINAL_DIR);
  ensureDir(CLICKUP_DIR);

  const jsonPath = path.join(FINAL_DIR, `${basename}.json`);
  const csvPath = path.join(CLICKUP_DIR, `${basename}.csv`);

  writeJson(jsonPath, leadPack);
  await leadPackToClickUpCsv(leadPack, csvPath);

  return { jsonPath, csvPath };
}

async function saveErrorPack(basename, itemOrNull, err) {
  ensureDir(FINAL_DIR);

  const errorPath = path.join(FINAL_DIR, `${basename}.error.json`);
  const errorPack = {
    lead: itemOrNull?.lead || {},
    error: {
      message: err?.message || String(err),
      stack: err?.stack || null,
      timestamp: new Date().toISOString(),
    },
    raw_item: itemOrNull || null,
  };

  writeJson(errorPath, errorPack);
  return errorPath;
}

// -------------------- CORE --------------------
async function processFile(fileInfo, options) {
  const { filename, filepath, basename } = fileInfo;

  console.log("\n" + "─".repeat(70));
  console.log(`📄 ${filename}`);

  // skip if already analyzed
  if (!options.force && isAlreadyAnalyzed(basename)) {
    console.log("⏭️  Skipped (already analyzed). Use --force to re-run.");
    return { status: "skipped" };
  }

  let data = null;

  try {
    // 1) Load input data
    data = readJson(filepath);

    if (!data?.item) {
      throw new Error("Invalid file format: missing data.item");
    }

    if (data.item?.status === "failed") {
      console.log("⏭️  Skipped (Stage 1 status=failed).");
      return { status: "skipped" };
    }

    console.log("✅ Input loaded");

    // 2) Prepare lead context
    const leadContext = prepareLeadContext(data.item);
    const websiteUrl = leadContext?.lead?.website_url;

    if (!websiteUrl) {
      throw new Error("Missing lead.website_url");
    }

    // 3) Analyze lead (LLM)
    const analysis = await withRetries(
      () => analyzeLeadStrict(leadContext),
      "analyzeLeadStrict"
    );
    console.log("✅ Lead analysis complete");

    // 4) Scrape website
    const scrapedTokens = await withRetries(
      () => scrapeSiteSnapshot(websiteUrl),
      "scrapeSiteSnapshot"
    );
    console.log("✅ Website scraped");

    // 5) Summarize scraped content
    const siteSummary = await withRetries(
      () => summarizeSiteTo10({ url: websiteUrl, tokens: scrapedTokens }),
      "summarizeSiteTo10"
    );
    console.log("✅ Site summary generated");

    // 6) Build final lead pack
    const leadPack = await withRetries(
      () =>
        buildLeadPack({
          lead: data.item.lead,
          analysis,
          siteScrape: siteSummary,
        }),
      "buildLeadPack"
    );
    console.log("✅ Lead pack built");

    // 7) Save outputs (use same basename as input file)
    const { jsonPath, csvPath } = await saveOutputsByBasename(basename, leadPack);
    console.log(`💾 JSON: ${jsonPath}`);
    console.log(`📊 CSV : ${csvPath}`);

    return { status: "success" };
  } catch (err) {
    console.log(`❌ Error: ${err?.message || err}`);
    const errorPath = await saveErrorPack(basename, data?.item || null, err);
    console.log(`🧾 Error saved: ${errorPath}`);
    return { status: "failed" };
  } finally {
    await sleep(DELAY_BETWEEN_MS);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const options = { force: args.includes("--force") || args.includes("-f") };

  ensureDir(FINAL_DIR);
  ensureDir(CLICKUP_DIR);

  const files = discoverOutJsonFiles();

  if (!files.length) {
    console.log(`❌ No JSON files found in ${INPUT_DIR}/`);
    process.exit(1);
  }

  console.log(`🚀 Batch analysis starting: ${files.length} files`);
  if (options.force) console.log("🔄 Force mode ON (re-analyze all)");

  let ok = 0,
    failed = 0,
    skipped = 0;

  for (const f of files) {
    const res = await processFile(f, options);
    if (res.status === "success") ok++;
    if (res.status === "failed") failed++;
    if (res.status === "skipped") skipped++;
  }

  console.log("\n" + "=".repeat(70));
  console.log("✅ BATCH DONE");
  console.log(`✅ success: ${ok}`);
  console.log(`⏭️  skipped: ${skipped}`);
  console.log(`❌ failed : ${failed}`);
  console.log(`📁 final  : ${FINAL_DIR}`);
  console.log(`📁 clickup: ${CLICKUP_DIR}`);
  console.log("=".repeat(70) + "\n");
}

main().catch((err) => {
  console.error("❌ Fatal:", err?.message || err);
  process.exit(1);
});
