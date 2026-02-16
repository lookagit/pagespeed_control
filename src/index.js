// ============================================================
// STAGE 1: DATA COLLECTION PIPELINE
// ============================================================
// Purpose: Collect raw data from leads and save to individual JSON files
// Output: out/{sanitized-url}-{hash}.json per lead
//
// Usage: node src/index.js
// ============================================================

import { CONFIG } from "./config.js";
import { LeadSchema } from "./schemas.js";
import { readCsv } from "./io/csv.js";
import { ensureDir, writeJson } from "./io/write.js";
import { sleep } from "./utils/sleep.js";
import { runPageSpeed } from "./pagespeed/psi.js";
import { collectSignals } from "./signals/crawl.js";
import { getCrux } from "./crux/crux.js";
import { fetchHtmlWithHeaders, detectStack } from "./stack/index.js";
import { sanitizeFileName } from "./utils/sanitizeFileName.js";
import fs from "fs";
// ============================================================
// CONFIGURATION
// ============================================================

const PIPELINE_CONFIG = {
  STAGE_NAME: "DATA_COLLECTION",
  OUTPUT_DIR: CONFIG.OUT_DIR || "./out",
  BATCH_SIZE: 1, // Process one at a time for stability
  RETRY_ATTEMPTS: 2,
  RETRY_DELAY_MS: 5000,
};

// ============================================================
// TYPES & CONSTANTS
// ============================================================

const ProcessingStage = {
  PAGESPEED: "pagespeed",
  SIGNALS: "signals",
  CRUX: "crux",
  STACK: "stack",
};

const ResultStatus = {
  SUCCESS: "success",
  PARTIAL: "partial",
  FAILED: "failed",
};

// ============================================================
// VALIDATION
// ============================================================

/**
 * Validates CSV rows and separates valid leads from errors
 */
function validateLeads(rows) {
  const validLeads = [];
  const errors = [];

  rows.forEach((row, index) => {
    const result = LeadSchema.safeParse(row);
    
    if (result.success) {
      validLeads.push(result.data);
    } else {
      errors.push({
        row: index + 2,
        data: row,
        issues: result.error.issues,
      });
    }
  });

  return { validLeads, errors };
}

function logValidationSummary(validation) {
  console.log("\n" + "=".repeat(70));
  console.log("📋 STAGE 1: DATA COLLECTION - VALIDATION SUMMARY");
  console.log("=".repeat(70));
  console.log(`✅ Valid leads: ${validation.validLeads.length}`);
  
  if (validation.errors.length > 0) {
    console.log(`❌ Invalid rows: ${validation.errors.length}`);
    console.log("\nValidation errors:");
    validation.errors.slice(0, 5).forEach(error => {
      console.log(`  Row ${error.row}:`);
      error.issues.forEach(issue => {
        console.log(`    • ${issue.path.join(".")}: ${issue.message}`);
      });
    });
    if (validation.errors.length > 5) {
      console.log(`  ... and ${validation.errors.length - 5} more errors`);
    }
  }
  
  console.log("=".repeat(70) + "\n");
}

// ============================================================
// PROGRESS TRACKING
// ============================================================

class DataCollectionProgress {
  constructor(total) {
    this.total = total;
    this.current = 0;
    this.startTime = Date.now();
    this.successful = 0;
    this.failed = 0;
    this.partial = 0;
    this.skipped = 0;
  }

  update(status) {
    this.current++;
    
    switch (status) {
      case ResultStatus.SUCCESS:
        this.successful++;
        break;
      case ResultStatus.PARTIAL:
        this.partial++;
        break;
      case ResultStatus.FAILED:
        this.failed++;
        break;
      case "skipped":
        this.skipped++;
        break;
    }
  }

  getPercentage() {
    return Math.round((this.current / this.total) * 100);
  }

  getETA() {
    if (this.current === 0) return "calculating...";
    
    const elapsed = Date.now() - this.startTime;
    const avgTime = elapsed / this.current;
    const remaining = (this.total - this.current) * avgTime;
    
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    
    return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  }

  logHeader(lead) {
    console.log("\n" + "─".repeat(70));
    console.log(`📦 [${this.current + 1}/${this.total}] ${this.getPercentage()}% • ETA: ${this.getETA()}`);
    console.log(`🌐 ${lead.website_url}`);
    console.log("─".repeat(70));
  }

  logFinalSummary() {
    const duration = Math.round((Date.now() - this.startTime) / 1000);
    
    console.log("\n" + "=".repeat(70));
    console.log("🎉 STAGE 1 COMPLETE: DATA COLLECTION");
    console.log("=".repeat(70));
    console.log(`Total processed: ${this.total}`);
    console.log(`✅ Complete data: ${this.successful}`);
    if (this.partial > 0) {
      console.log(`⚠️  Partial data: ${this.partial}`);
    }
    if (this.failed > 0) {
      console.log(`❌ Failed: ${this.failed}`);
    }
    if (this.skipped > 0) {
      console.log(`⏭️  Skipped (already exist): ${this.skipped}`);
    }
    console.log(`⏱️  Duration: ${duration}s (avg: ${(duration / this.total).toFixed(1)}s per lead)`);
    console.log("\n📁 Output directory: " + PIPELINE_CONFIG.OUTPUT_DIR);
    console.log("=".repeat(70) + "\n");
    
    console.log("🔄 Next step: Run Stage 2 (Analysis)");
    console.log("   Command: node src/analyze_batch.js\n");
  }
}

// ============================================================
// PIPELINE STAGES
// ============================================================

async function executePageSpeedStage(url) {
  console.log("  📊 PageSpeed Insights...");
  
  try {
    const [mobile, desktop] = await Promise.all([
      runPageSpeed({ url, strategy: "mobile", apiKey: CONFIG.PSI_API_KEY }),
      runPageSpeed({ url, strategy: "desktop", apiKey: CONFIG.PSI_API_KEY }),
    ]);

    const mobileScore = mobile.categories.performance;
    const desktopScore = desktop.categories.performance;
    console.log(`    ✅ Mobile: ${mobileScore}% | Desktop: ${desktopScore}%`);
    
    return { mobile, desktop };
  } catch (error) {
    console.log(`    ❌ Failed: ${error.message}`);
    throw error;
  }
}

async function executeSignalsStage(url) {
  console.log("  🔍 Signals collection...");
  
  try {
    const signals = await collectSignals(url);
    
    const chatbot = signals.chatbot.has_chatbot ? signals.chatbot.vendor : "none";
    const booking = signals.booking.type || "none";
    
    console.log(`    ✅ Chat: ${chatbot} | Booking: ${booking}`);
    
    return signals;
  } catch (error) {
    console.log(`    ❌ Failed: ${error.message}`);
    throw error;
  }
}

async function executeCruxStage(url) {
  console.log("  📈 CrUX data...");
  
  try {
    const crux = await getCrux({
      websiteUrl: url,
      apiKey: CONFIG.PSI_API_KEY,
      formFactor: "PHONE",
      includePage: false,
    });
    
    const category = crux?.origin?.overall_category || "unknown";
    console.log(`    ✅ CrUX: ${category}`);
    
    return crux;
  } catch (error) {
    console.log(`    ⚠️  CrUX unavailable (${error.message})`);
    return null;
  }
}

async function executeStackStage(url) {
  console.log("  🔧 Stack detection...");
  
  try {
    const response = await fetchHtmlWithHeaders(url);
    const stack = {
      fetched_from: response.finalUrl,
      status: response.status,
      ...detectStack({ html: response.html, headers: response.headers }),
    };
    
    const techCount = stack.technologies?.length || 0;
    console.log(`    ✅ ${techCount} technologies detected`);
    
    return stack;
  } catch (error) {
    console.log(`    ⚠️  Stack unavailable (${error.message})`);
    return null;
  }
}

// ============================================================
// FILE MANAGEMENT
// ============================================================

function getOutputFilePath(lead) {
  const filename = sanitizeFileName(lead.website_url) + ".json";
  return `${PIPELINE_CONFIG.OUTPUT_DIR}/${filename}`;
}

function checkIfAlreadyProcessed(lead) {
  const filepath = getOutputFilePath(lead);
  try {
    return fs.existsSync(filepath);
  } catch {
    return false;
  }
}

async function saveLeadData(lead, result) {
  const filepath = getOutputFilePath(lead);
  writeJson(filepath, { item: result });
  return filepath;
}

// ============================================================
// LEAD PROCESSING
// ============================================================

async function processLead(lead, progress, options = {}) {
  progress.logHeader(lead);

  // Check if already processed (skip if force=false)
  if (!options.force && await checkIfAlreadyProcessed(lead)) {
    console.log("  ⏭️  Already processed (use --force to reprocess)");
    progress.update("skipped");
    return null;
  }

  const result = {
    lead,
    status: ResultStatus.SUCCESS,
    error: null,
    errors: {},
    pagespeed: null,
    signals: null,
    crux: null,
    stack: null,
    processed_at: new Date().toISOString(),
    pipeline_stage: "data_collection",
    pipeline_version: "1.0.0",
  };

  let criticalFailure = false;

  // Stage 1: PageSpeed (Critical)
  try {
    result.pagespeed = await executePageSpeedStage(lead.website_url);
  } catch (error) {
    result.errors[ProcessingStage.PAGESPEED] = error.message;
    criticalFailure = true;
  }

  // Stage 2: Signals (Critical)
  if (!criticalFailure) {
    try {
      result.signals = await executeSignalsStage(lead.website_url);
    } catch (error) {
      result.errors[ProcessingStage.SIGNALS] = error.message;
      criticalFailure = true;
    }
  }

  // Stage 3: CrUX (Optional)
  if (!criticalFailure) {
    const crux = await executeCruxStage(lead.website_url);
    if (crux) {
      result.crux = crux;
    } else {
      result.errors[ProcessingStage.CRUX] = "Data unavailable";
    }
  }

  // Stage 4: Stack (Optional)
  if (!criticalFailure) {
    const stack = await executeStackStage(lead.website_url);
    if (stack) {
      result.stack = stack;
    } else {
      result.errors[ProcessingStage.STACK] = "Detection unavailable";
    }
  }

  // Determine status
  if (criticalFailure) {
    result.status = ResultStatus.FAILED;
    result.error = "Critical stage failed";
  } else if (Object.keys(result.errors).length > 0) {
    result.status = ResultStatus.PARTIAL;
  }

  // Log summary
  logResultSummary(result);

  // Save to file
  const filepath = await saveLeadData(lead, result);
  console.log(`  💾 Saved: ${filepath}`);

  progress.update(result.status);
  
  return result;
}

function logResultSummary(result) {
  const icons = {
    [ResultStatus.SUCCESS]: "✅",
    [ResultStatus.PARTIAL]: "⚠️",
    [ResultStatus.FAILED]: "❌",
  };

  console.log(`\n  ${icons[result.status]} Status: ${result.status.toUpperCase()}`);
  
  if (Object.keys(result.errors).length > 0) {
    console.log("  Issues:");
    Object.entries(result.errors).forEach(([stage, error]) => {
      console.log(`    • ${stage}: ${error}`);
    });
  }
}

// ============================================================
// BATCH PROCESSING
// ============================================================

async function processBatch(leads, options = {}) {
  const progress = new DataCollectionProgress(leads.length);
  const results = [];

  for (const lead of leads) {
    try {
      const result = await processLead(lead, progress, options);
      if (result) {
        results.push(result);
      }
      
      // Rate limiting
      if (progress.current < leads.length) {
        await sleep(CONFIG.DELAY_MS);
      }
    } catch (error) {
      console.error(`  ❌ Unexpected error: ${error.message}`);
      progress.update(ResultStatus.FAILED);
    }
  }

  progress.logFinalSummary();
  
  return results;
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log("\n🚀 LEAD ENRICHMENT PIPELINE - STAGE 1: DATA COLLECTION\n");

  try {
    // Setup
    ensureDir(PIPELINE_CONFIG.OUTPUT_DIR);

    // Load CSV
    console.log("📂 Loading leads from CSV...");
    const rows = readCsv(CONFIG.LEADS_CSV);
    console.log(`   Loaded ${rows.length} rows`);

    // Validate
    const validation = validateLeads(rows);
    logValidationSummary(validation);

    if (validation.validLeads.length === 0) {
      console.error("❌ No valid leads found. Exiting.");
      process.exit(1);
    }

    // Apply test limit
    const leadsToProcess = CONFIG.TEST_LIMIT > 0
      ? validation.validLeads.slice(0, CONFIG.TEST_LIMIT)
      : validation.validLeads;

    if (CONFIG.TEST_LIMIT > 0) {
      console.log(`🧪 TEST MODE: Processing first ${leadsToProcess.length} leads\n`);
    }

    // Parse CLI arguments
    const args = process.argv.slice(2);
    const options = {
      force: args.includes("--force") || args.includes("-f"),
    };

    if (options.force) {
      console.log("🔄 Force mode: Re-processing all leads\n");
    }

    // Process
    console.log(`⚙️  Starting data collection (${leadsToProcess.length} leads)...\n`);
    await processBatch(leadsToProcess, options);

  } catch (error) {
    console.error("\n❌ FATAL ERROR:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// ============================================================
// ENTRY POINT
// ============================================================

main().catch((error) => {
  console.error("\n❌ Unhandled error:", error.message);
  process.exit(1);
});