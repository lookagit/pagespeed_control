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

async function main() {
  ensureDir(CONFIG.OUT_DIR);

  const rows = readCsv(CONFIG.LEADS_CSV);

  const leads = [];
  const errors = [];

  rows.forEach((row, idx) => {
    const res = LeadSchema.safeParse(row);
    if (res.success) leads.push(res.data);
    else errors.push({ row: idx + 2, issues: res.error.issues });
  });

  console.log(`✅ Loaded leads: ${leads.length}`);
  if (errors.length) console.dir(errors, { depth: 10 });

  const list = CONFIG.TEST_LIMIT > 0 ? leads.slice(0, CONFIG.TEST_LIMIT) : leads;

  const results = [];

  for (let i = 0; i < list.length; i++) {
    const lead = list[i];
    console.log(`\n=== (${i + 1}/${list.length}) ${lead.website_url} ===`);

    const item = {
      lead,
      status: "ok",
      error: null,
      pagespeed: null,
      signals: null,
      processed_at: new Date().toISOString(),
    };
    console.log("🔎 LEAD INITED ", lead);
    try {
      const mobile = await runPageSpeed({ url: lead.website_url, strategy: "mobile", apiKey: CONFIG.PSI_API_KEY });
      const desktop = await runPageSpeed({ url: lead.website_url, strategy: "desktop", apiKey: CONFIG.PSI_API_KEY });
      item.pagespeed = { mobile, desktop };

      item.signals = await collectSignals(lead.website_url);
    } catch (e) {
      item.status = "error";
      item.error = String(e?.message || e);
    }
    // 1) CrUX (real users)
    try {
        item.crux = await getCrux({
            websiteUrl: lead.website_url,
            apiKey: CONFIG.PSI_API_KEY,
            formFactor: "PHONE",
            includePage: false, // true ako hoćeš i page-level
        });
    } catch (e) {
        console.warn("⚠️ CrUX error:", e.message);
        item.crux = null;
    }


    // 2) Stack (free heuristics)
    try {
        const home = await fetchHtmlWithHeaders(lead.website_url);
        item.stack = {
            fetched_from: home.finalUrl,
            status: home.status,
            ...detectStack({ html: home.html, headers: home.headers }),
        };
    } catch (e) {
        console.warn("⚠️ Stack detection error:", e.message);
        item.stack = null;
    }
    
    console.log("WE ARE ITEM AND WE ARE LOOKING LIKE THIS", item);
    results.push(item);
    writeJson(CONFIG.OUT_DIR + "/" + sanitizeFileName(item.lead.website_url) + ".json", { item });
    await sleep(CONFIG.DELAY_MS);
  }

  console.log(`📝 Wrote: ${CONFIG.RESULTS_JSON}`);
}

main().catch((e) => {
  console.error("❌ Fatal:", e.message);
  process.exit(1);
});
