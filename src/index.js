// ============================================================
// index.js - STAGE 1: Prikupljanje podataka o leadovima
// ============================================================
// Ulaz : CSV sa leadovima (LEADS_CSV u config.js)
// Izlaz: out/{url-hash}.json za svaki lead
//
// Pokretanje:
//   node src/index.js              - preskače već obrađene
//   node src/index.js --force      - obrađuje sve iznova
//   node src/index.js --concurrency 10  - broj paralelnih (default: 10)
// ============================================================

import fs from "fs";
import { CONFIG } from "./config.js";
import { LeadSchema } from "./schemas.js";
import { readCsv } from "./io/csv.js";
import { ensureDir, writeJson } from "./io/write.js";
import { sleep, withRetries } from "./utils/helpers.js";
import { runPageSpeed } from "./pagespeed/psi.js";
import { collectSignals, collectContactDetails } from "./signals/crawl.js";
import { getCrux } from "./crux/crux.js";
import { fetchHtmlWithHeaders, detectStack } from "./stack/index.js";
import { sanitizeFileName } from "./utils/sanitizeFileName.js";

// ─────────────────────────────────────────────────────────────
// NORMALIZACIJA ULAZNIH PODATAKA
// ─────────────────────────────────────────────────────────────

function looksLikeBusiness(name = "") {
  const businessWords = [
    "dental", "dentistry", "clinic", "office", "center", "family",
    "llc", "inc", "ltd", "co.", "pllc", "pc", "practice", "studio",
    "group", "associates", "partners",
  ];
  return businessWords.some(w => name.toLowerCase().includes(w));
}

function splitName(name = "") {
  const clean = String(name).trim();
  if (!clean) return { first: "", last: "", company: "" };

  if (looksLikeBusiness(clean)) {
    return { first: "", last: clean, company: clean };
  }

  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const last = parts.pop();
    return { first: parts.join(" "), last, company: "" };
  }

  return { first: "", last: clean, company: clean };
}

function parseAddress(address = "") {
  const out = { street: "", city: "", state: "", postal_code: "", country: "", full: "" };
  if (!address) return out;

  out.full = address.trim();
  const parts = out.full.split(",").map(s => s.trim()).filter(Boolean);

  out.street  = parts[0] || "";
  out.city    = parts[1] || "";
  out.country = parts[3] || "";

  const stateZip = parts[2] || "";
  const m = stateZip.match(/\b([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\b/);
  out.state       = m ? m[1] : "";
  out.postal_code = m ? m[2] : "";

  return out;
}

function normalizeLead(row) {
  const name    = row.name ?? row.Name ?? row.company ?? "";
  const phone   = row.phone ?? row.Phone ?? "";
  const url     = row.website_url ?? row.website ?? row.Website ?? "";
  const address = row.address ?? row.Address ?? "";

  const { first, last, company } = splitName(name);
  const addr = parseAddress(address);

  return {
    name, phone,
    website_url: url,
    address,
    first_name:  first,
    last_name:   last || name,
    company:     company || name,
    street:      addr.street,
    city:        addr.city,
    state:       addr.state,
    postal_code: addr.postal_code,
    country:     addr.country,
    full_address: addr.full,
    place_id:           row.place_id ?? "",
    rating:             row.rating ?? null,
    user_ratings_total: row.user_ratings_total ?? null,
    maps_url:           row.maps_url ?? "",
    business_status:    row.business_status ?? "",
  };
}

// ─────────────────────────────────────────────────────────────
// CONTACT SUMMARY BUILDER
// ─────────────────────────────────────────────────────────────

function buildContactSummary(lead, details) {
  const crawledPhones = details?.phones ?? [];
  const crawledEmails = details?.emails ?? [];
  const ctaLinks      = details?.cta_links ?? [];
  const crawledPages  = details?.crawled_pages ?? [];

  const csvPhone  = lead.phone ? String(lead.phone).trim() : null;
  const allPhones = csvPhone && !crawledPhones.includes(csvPhone)
    ? [csvPhone, ...crawledPhones]
    : [...crawledPhones];

  const phoneSource = (() => {
    if (crawledPhones.length > 0 && csvPhone) return "website+csv";
    if (crawledPhones.length > 0)             return "website";
    if (csvPhone)                             return "csv_only";
    return "none";
  })();

  return {
    phones:        allPhones,
    emails:        crawledEmails,
    cta_links:     ctaLinks,
    per_page:      details?.per_page ?? [],
    phones_count:  allPhones.length,
    emails_count:  crawledEmails.length,
    cta_count:     ctaLinks.length,
    crawled_pages: crawledPages,
    pages_crawled: crawledPages.length,
    phone_source:  phoneSource,
  };
}

// ─────────────────────────────────────────────────────────────
// PRIKUPLJANJE PODATAKA PO LEADU
// ─────────────────────────────────────────────────────────────

async function collectPageSpeed(url) {
  // mobile i desktop se vec pokrecu paralelno - dobro
  const [mobile, desktop] = await Promise.all([
    runPageSpeed({ url, strategy: "mobile",  apiKey: CONFIG.PSI_API_KEY }),
    runPageSpeed({ url, strategy: "desktop", apiKey: CONFIG.PSI_API_KEY }),
  ]);
  return { mobile, desktop };
}

async function collectSignalsData(url) {
  return await collectSignals(url);
}

async function collectContactData(url) {
  return await collectContactDetails(url);
}

async function collectCrux(url) {
  try {
    return await getCrux({
      websiteUrl: url,
      apiKey: CONFIG.PSI_API_KEY,
      formFactor: "PHONE",
      includePage: false,
    });
  } catch {
    return null;
  }
}

async function collectStack(url) {
  try {
    const page  = await fetchHtmlWithHeaders(url);
    return {
      fetched_from: page.finalUrl,
      status:       page.status,
      ...detectStack({ html: page.html, headers: page.headers }),
    };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// OBRADA JEDNOG LEADA — svi koraci paralelno gde je moguce
// ─────────────────────────────────────────────────────────────

function getOutputPath(lead) {
  return `${CONFIG.OUT_DIR}/${sanitizeFileName(lead.website_url)}.json`;
}

async function processLead(lead, options = {}) {
  const outputPath = getOutputPath(lead);

  if (!options.force && fs.existsSync(outputPath)) {
    return { status: "skipped" };
  }

  const result = {
    lead,
    status:          "ok",
    error:           null,
    pagespeed:       null,
    signals:         null,
    crux:            null,
    stack:           null,
    contact_summary: null,
    processed_at:    new Date().toISOString(),
  };

  const url = lead.website_url;

  // ── PageSpeed je kritičan — mora uspeti ──────────────────
  try {
    result.pagespeed = await withRetries(
      () => collectPageSpeed(url),
      "PageSpeed",
      CONFIG.MAX_RETRIES
    );
  } catch (e) {
    result.status          = "failed";
    result.error           = `PageSpeed failed: ${e.message}`;
    result.contact_summary = buildContactSummary(lead, null);
    writeJson(outputPath, { item: result });
    return { status: "failed" };
  }

  // ── Signals, Contacts, CrUX, Stack — sve PARALELNO ──────
  const [signalsResult, contactResult, cruxResult, stackResult] =
    await Promise.allSettled([
      withRetries(() => collectSignalsData(url),  "Signals",        CONFIG.MAX_RETRIES),
      withRetries(() => collectContactData(url),  "ContactDetails", CONFIG.MAX_RETRIES),
      collectCrux(url),
      collectStack(url),
    ]);

  // Signals
  if (signalsResult.status === "fulfilled") {
    result.signals = signalsResult.value;
  } else {
    result.status = "partial";
    result.error  = `Signals failed: ${signalsResult.reason?.message}`;
  }

  // Contacts
  let contactDetails = null;
  if (contactResult.status === "fulfilled") {
    contactDetails = contactResult.value;
  } else {
    if (!result.error) result.error = `ContactDetails failed: ${contactResult.reason?.message}`;
    if (result.status === "ok") result.status = "partial";
  }

  result.contact_summary = buildContactSummary(lead, contactDetails);

  // CrUX i Stack (opcioni — greška se tiho guta)
  result.crux  = cruxResult.status  === "fulfilled" ? cruxResult.value  : null;
  result.stack = stackResult.status === "fulfilled" ? stackResult.value : null;

  writeJson(outputPath, { item: result });

  return { status: result.status };
}

// ─────────────────────────────────────────────────────────────
// BATCH RUNNER — obrađuje N leadova paralelno
// ─────────────────────────────────────────────────────────────

/**
 * Pokreće `tasks` (array async funkcija) sa maksimalno `concurrency`
 * paralelnih izvršavanja u isto vreme. Koristi "sliding window" pattern
 * umesto čekanja da ceo batch završi — uvek ima `concurrency` aktivnih.
 */
async function runWithConcurrency(tasks, concurrency) {
  const results = new Array(tasks.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const i = nextIndex++;
      results[i] = await tasks[i]();
    }
  }

  // Pokreni `concurrency` workera paralelno
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, worker);
  await Promise.all(workers);

  return results;
}

// ─────────────────────────────────────────────────────────────
// PROGRESS TRACKER (thread-safe brojač za paralelne taskove)
// ─────────────────────────────────────────────────────────────

function makeProgress(total) {
  let done = 0;
  return {
    tick(url, status) {
      done++;
      const pct = Math.round((done / total) * 100);
      const icon = status === "failed" ? "✗" : status === "skipped" ? "→" : "✓";
      process.stdout.write(`\r[${done}/${total}] ${pct}%  ${icon} ${url.slice(0, 60).padEnd(60)}`);
      if (done === total) process.stdout.write("\n");
    },
  };
}

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────

async function main() {
  console.log("\n STAGE 1: PRIKUPLJANJE PODATAKA\n");

  ensureDir(CONFIG.OUT_DIR);

  // Parsiranje argumenata
  const args        = process.argv.slice(2);
  const force       = args.includes("--force") || args.includes("-f");
  const concIdx     = args.findIndex(a => a === "--concurrency" || a === "-c");
  const CONCURRENCY = concIdx !== -1 ? parseInt(args[concIdx + 1], 10) || 10 : 10;

  if (force) console.log("Force mode: ponavljam sve leadove");
  console.log(`Paralelnost: ${CONCURRENCY} leadova istovremeno\n`);

  const rows = readCsv(CONFIG.LEADS_CSV);
  console.log(`Učitano redova: ${rows.length}`);

  const leads  = [];
  const errors = [];

  rows.forEach((row, i) => {
    const normalized = normalizeLead(row);
    const parsed     = LeadSchema.safeParse(normalized);
    if (parsed.success) {
      leads.push(parsed.data);
    } else {
      errors.push({ row: i + 2, url: row.website_url ?? row.website, issues: parsed.error.issues });
    }
  });

  console.log(`Validnih leadova: ${leads.length}`);
  if (errors.length) {
    console.log(`Nevalidnih redova: ${errors.length}`);
    errors.slice(0, 3).forEach(e =>
      console.log(`   Red ${e.row} (${e.url}): ${e.issues.map(i => i.message).join(", ")}`)
    );
  }

  if (!leads.length) {
    console.error("Nema validnih leadova. Provjeri CSV fajl i LEADS_CSV u .env");
    process.exit(1);
  }

  const toProcess = CONFIG.TEST_LIMIT > 0 ? leads.slice(0, CONFIG.TEST_LIMIT) : leads;
  if (CONFIG.TEST_LIMIT > 0) console.log(`TEST MODE: obrađujem prvih ${toProcess.length}`);

  const total    = toProcess.length;
  const progress = makeProgress(total);

  console.log(`\nPokrećem obradu ${total} leadova (po ${CONCURRENCY} paralelno)...\n`);

  const startTime = Date.now();

  // Svaki lead = jedan task (lazy — ne pokreće se odmah)
  const tasks = toProcess.map(lead => async () => {
    const res = await processLead(lead, { force });
    progress.tick(lead.website_url, res.status);
    return res;
  });

  const results = await runWithConcurrency(tasks, CONCURRENCY);

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  let ok = 0, failed = 0, skipped = 0;
  for (const r of results) {
    if (r.status === "ok" || r.status === "partial") ok++;
    else if (r.status === "failed") failed++;
    else skipped++;
  }

  console.log("\n" + "=".repeat(60));
  console.log("STAGE 1 ZAVRŠEN");
  console.log(`   Uspešno:   ${ok}`);
  console.log(`   Neuspešno: ${failed}`);
  console.log(`   Preskočeno: ${skipped}`);
  console.log(`   Vreme:     ${elapsed} min`);
  console.log(`   Fajlovi:   ${CONFIG.OUT_DIR}/`);
  console.log("=".repeat(60));
  console.log("\n Sledeći korak: node src/analyze_batch.js\n");
}

main().catch(e => {
  console.error("Fatalna greška:", e.message);
  process.exit(1);
});