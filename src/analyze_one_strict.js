import { readJson } from "./io/readJson.js";
import { writeJson } from "./io/writeJson.js";
import { sanitizeFilenameFromUrl } from "./utils/sanitize.js";
import { analyzeLeadStrict } from "./ai/analyzeLead.js";
import { buildLeadPack } from "./ai/buildLeadPack.js";
import { scrapeSiteSnapshot } from "./utils/siteScrape.js";
import { summarizeSiteTo10 } from "./ai/checkHtmlAndUrl.js";import { leadPackToClickUpCsv } from "./ai/createFinalReport.js";
``

async function main() {
  try {
    // 1. Load input data
    const inputPath = "./out/zahnhimmel-de-34b30cc3.json";
    const data = readJson(inputPath);
    
    console.log("✅ Input data loaded:", data.item);

    // 2. Prepare lead context
    const leadContext = prepareLeadContext(data.item);
    
    console.log("✅ Lead context prepared");

    // 3. Analyze lead
    const analysis = await analyzeLeadStrict(leadContext);
    
    console.log("✅ Lead analysis complete");

    // 4. Scrape website
    const websiteUrl = leadContext.lead.website_url;
    const scrapedTokens = await scrapeSiteSnapshot(websiteUrl);
    
    console.log("✅ Website scraped");

    // 5. Summarize scraped content
    const siteSummary = await summarizeSiteTo10({
      url: websiteUrl,
      tokens: scrapedTokens,
    });
    
    console.log("✅ Site summary generated");

    // 6. Build final lead pack
    const leadPack = await buildLeadPack({
      lead: data.item.lead,
      analysis,
      siteScrape: siteSummary,
    });
    
    console.log("✅ Lead pack built");

    // 7. Save outputs
    await saveOutputs(leadPack, websiteUrl);
    
    console.log("✅ All outputs saved successfully");

  } catch (error) {
    
    console.error("❌ Error:", error?.message || error);
    throw error;
  }
}

// Helper: Prepare lead context object
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

// Helper: Save all output files
async function saveOutputs(leadPack, websiteUrl) {
  const filename = sanitizeFilenameFromUrl(websiteUrl);
  const jsonPath = `./out/final/${filename}.json`;
  const csvPath = `./out/clickup/${filename}.csv`;

  // Save JSON
  writeJson(jsonPath, leadPack);
  console.log(`  → JSON: ${jsonPath}`);

  // Save CSV
  await leadPackToClickUpCsv(leadPack, csvPath);
  console.log(`  → CSV: ${csvPath}`);
}

// Run main function
main().catch((error) => {
  console.error("❌ Fatal error:", error?.message || error);
  process.exit(1);
});