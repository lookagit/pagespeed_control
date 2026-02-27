// ============================================================
// index.js - STAGE 1: Prikupljanje podataka o leadovima
// ============================================================
// Ulaz : CSV sa leadovima (LEADS_CSV u config.js)
// Izlaz: out/{url-hash}.json za svaki lead
//
// Pokretanje:
//   node src/index.js           - preskače već obrađene
//   node src/index.js --force   - obrađuje sve iznova
// ============================================================

import fs from "fs";
import { CONFIG } from "./config.js";
import { LeadSchema } from "./schemas.js";
import { readCsv } from "./io/csv.js";
import { ensureDir, writeJson } from "./io/write.js";
import { sleep, withRetries } from "./utils/helpers.js";
import { runPageSpeed } from "./pagespeed/psi.js";
import { collectSignals } from "./signals/crawl.js";
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
    // Originalni podaci
    name, phone,
    website_url: url,
    address,

    // Parsirani podaci
    first_name: first,
    last_name: last || name,
    company: company || name,

    // Adresa
    street:      addr.street,
    city:        addr.city,
    state:       addr.state,
    postal_code: addr.postal_code,
    country:     addr.country,
    full_address: addr.full,

    // Google Places (ako postoje)
    place_id:           row.place_id ?? "",
    rating:             row.rating ?? null,
    user_ratings_total: row.user_ratings_total ?? null,
    maps_url:           row.maps_url ?? "",
    business_status:    row.business_status ?? "",
  };
}

// ─────────────────────────────────────────────────────────────
// PRIKUPLJANJE PODATAKA PO LEADU
// ─────────────────────────────────────────────────────────────

async function collectPageSpeed(url) {
  console.log("  ⏳ PageSpeed (mobile + desktop)...");

  const [mobile, desktop] = await Promise.all([
    runPageSpeed({ url, strategy: "mobile", apiKey: CONFIG.PSI_API_KEY }),
    runPageSpeed({ url, strategy: "desktop", apiKey: CONFIG.PSI_API_KEY }),
  ]);

  console.log(
    `  ✅ Mobile: ${mobile.categories.performance} | Desktop: ${desktop.categories.performance}`
  );
  return { mobile, desktop };
}

async function collectSignalsData(url) {
  console.log("  ⏳ Signali (tracking, chatbot, booking)...");
  const signals = await collectSignals(url);
  const trackingCount = Object.values(signals.tracking ?? {}).filter(Boolean).length;
  console.log(
    `  ✅ Chatbot: ${signals.chatbot?.vendor || "nema"} | Tracking: ${trackingCount} alata`
  );
  return signals;
}

async function collectCrux(url) {
  console.log("  ⏳ CrUX (real-user podaci)...");
  try {
    const crux = await getCrux({
      websiteUrl: url,
      apiKey: CONFIG.PSI_API_KEY,
      formFactor: "PHONE",
      includePage: false,
    });
    console.log(`  ✅ CrUX: ${crux?.origin?.overall_category ?? "nema podataka"}`);
    return crux;
  } catch (e) {
    console.log(`  ⚠️  CrUX nije dostupan: ${e.message}`);
    return null;
  }
}

async function collectStack(url) {
  console.log("  ⏳ Stack detekcija...");
  try {
    const page = await fetchHtmlWithHeaders(url);
    const stack = {
      fetched_from: page.finalUrl,
      status: page.status,
      ...detectStack({ html: page.html, headers: page.headers }),
    };
    console.log(`  ✅ CMS: ${stack.cms || "nepoznat"} | Server: ${stack.server || "nepoznat"}`);
    return stack;
  } catch (e) {
    console.log(`  ⚠️  Stack detekcija neuspešna: ${e.message}`);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// OBRADA JEDNOG LEADA
// ─────────────────────────────────────────────────────────────

function getOutputPath(lead) {
  return `${CONFIG.OUT_DIR}/${sanitizeFileName(lead.website_url)}.json`;
}

async function processLead(lead, options = {}) {
  const outputPath = getOutputPath(lead);

  if (!options.force && fs.existsSync(outputPath)) {
    console.log(`  ⏭️  Preskočen (već postoji). --force za ponovnu obradu.`);
    return { status: "skipped" };
  }

  const result = {
    lead,
    status: "ok",
    error: null,
    pagespeed: null,
    signals: null,
    crux: null,
    stack: null,
    processed_at: new Date().toISOString(),
  };

  // PageSpeed i Signals su kritični - bez njih nema smisla nastaviti
  try {
    result.pagespeed = await withRetries(
      () => collectPageSpeed(lead.website_url),
      "PageSpeed",
      CONFIG.MAX_RETRIES
    );
  } catch (e) {
    result.status = "failed";
    result.error  = `PageSpeed failed: ${e.message}`;
    writeJson(outputPath, { item: result });
    return { status: "failed" };
  }

  try {
    result.signals = await withRetries(
      () => collectSignalsData(lead.website_url),
      "Signals",
      CONFIG.MAX_RETRIES
    );
  } catch (e) {
    result.status = "partial";
    result.error  = `Signals failed: ${e.message}`;
  }

  // CrUX i Stack su opcioni
  result.crux  = await collectCrux(lead.website_url);
  result.stack = await collectStack(lead.website_url);

  writeJson(outputPath, { item: result });
  console.log(`  💾 Sačuvano: ${outputPath}`);

  return { status: result.status };
}

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────

async function main() {
  console.log("\n🚀 STAGE 1: PRIKUPLJANJE PODATAKA\n");

  ensureDir(CONFIG.OUT_DIR);

  const args   = process.argv.slice(2);
  const force  = args.includes("--force") || args.includes("-f");
  if (force) console.log("🔄 Force mode: ponavljam sve leadove\n");

  // Učitaj CSV
  const rows = readCsv(CONFIG.LEADS_CSV);
  console.log(`📂 Učitano redova: ${rows.length}`);

  // Validiraj i normalizuj
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

  console.log(`✅ Validnih leadova: ${leads.length}`);
  if (errors.length) {
    console.log(`⚠️  Nevalidnih redova: ${errors.length}`);
    errors.slice(0, 3).forEach(e =>
      console.log(`   Red ${e.row} (${e.url}): ${e.issues.map(i => i.message).join(", ")}`)
    );
  }

  if (!leads.length) {
    console.error("❌ Nema validnih leadova. Provjeri CSV fajl i LEADS_CSV u .env");
    process.exit(1);
  }

  // Primeni TEST_LIMIT
  const toProcess = CONFIG.TEST_LIMIT > 0 ? leads.slice(0, CONFIG.TEST_LIMIT) : leads;
  if (CONFIG.TEST_LIMIT > 0) console.log(`🧪 TEST MODE: obrađujem prvih ${toProcess.length}\n`);

  // Obrada
  let ok = 0, failed = 0, skipped = 0;
  const total = toProcess.length;

  for (let i = 0; i < total; i++) {
    const lead = toProcess[i];
    const pct  = Math.round(((i + 1) / total) * 100);

    console.log("\n" + "─".repeat(60));
    console.log(`📦 [${i + 1}/${total}] ${pct}% → ${lead.website_url}`);
    console.log("─".repeat(60));

    const res = await processLead(lead, { force });
    if (res.status === "ok" || res.status === "partial") ok++;
    else if (res.status === "failed") failed++;
    else skipped++;

    if (i < total - 1) await sleep(CONFIG.DELAY_MS);
  }

  console.log("\n" + "=".repeat(60));
  console.log("✅ STAGE 1 ZAVRŠEN");
  console.log(`   Uspešno: ${ok} | Neuspešno: ${failed} | Preskočeno: ${skipped}`);
  console.log(`   Fajlovi: ${CONFIG.OUT_DIR}/`);
  console.log("=".repeat(60));
  console.log("\n👉 Sledeći korak: node src/analyze_batch.js\n");
}

main().catch(e => {
  console.error("❌ Fatalna greška:", e.message);
  process.exit(1);
});