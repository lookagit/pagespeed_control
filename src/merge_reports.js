// ============================================================
// merge_reports.js - STAGE 3: Spoji sve CSV-ove u jedan
// ============================================================
// Ulaz : out/report/*.json fajlovi (output Stage 2)
// Izlaz: out/report/_ALL_LEADS.csv - sortirano po prioritetu
//
// Pokretanje:
//   node src/merge_reports.js
// ============================================================

import fs from "fs";
import path from "path";
import { CONFIG } from "./config.js";
import { readJson } from "./io/readJson.js";
import { mergeLeadPacksToCsv } from "./ai/createFinalReport.js";

const PRIORITY_ORDER = { hot: 0, warm: 1, cold: 2 };

async function main() {
  console.log("\n🚀 STAGE 3: SPAJANJE IZVEŠTAJA\n");

  const finalDir  = CONFIG.FINAL_DIR;
  const outputCsv = path.join(CONFIG.REPORT_DIR, "_ALL_LEADS.csv");

  if (!fs.existsSync(finalDir)) {
    console.error(`❌ Direktorijum ${finalDir} ne postoji.`);
    console.log("   Pokreni prvo: node src/analyze_batch.js");
    process.exit(1);
  }

  // Učitaj sve final JSON fajlove
  const files = fs
    .readdirSync(finalDir, { withFileTypes: true })
    .filter(e => e.isFile() && e.name.endsWith(".json"))
    .filter(e => !e.name.endsWith(".error.json"));

  if (!files.length) {
    console.log("❌ Nema analiziranih leadova u out/final/");
    process.exit(1);
  }

  console.log(`📦 Pronađeno fajlova: ${files.length}`);

  const packs = [];
  let errors = 0;

  for (const f of files) {
    try {
      const data = readJson(path.join(finalDir, f.name));
      if (data && typeof data === "object") packs.push(data);
    } catch (e) {
      console.log(`⚠️  Preskočen ${f.name}: ${e.message}`);
      errors++;
    }
  }

  // Sortiraj: hot > warm > cold, pa po score-u
  packs.sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority] ?? 99;
    const pb = PRIORITY_ORDER[b.priority] ?? 99;
    if (pa !== pb) return pa - pb;
    return (b.score ?? 0) - (a.score ?? 0);
  });

  // Statistika
  const hot  = packs.filter(p => p.priority === "hot").length;
  const warm = packs.filter(p => p.priority === "warm").length;
  const cold = packs.filter(p => p.priority === "cold").length;
  const avgScore = packs.length
    ? Math.round(packs.reduce((s, p) => s + (p.score ?? 0), 0) / packs.length)
    : 0;

  fs.mkdirSync(CONFIG.REPORT_DIR, { recursive: true });
  await mergeLeadPacksToCsv(packs, outputCsv);

  console.log("\n" + "=".repeat(60));
  console.log("✅ STAGE 3 ZAVRŠEN");
  console.log(`   🔥 Hot:  ${hot}`);
  console.log(`   🌤️  Warm: ${warm}`);
  console.log(`   ❄️  Cold: ${cold}`);
  console.log(`   📊 Prosečan skor: ${avgScore}/100`);
  if (errors) console.log(`   ⚠️  Greške: ${errors}`);
  console.log(`\n   📋 Master CSV: ${outputCsv}`);
  console.log("=".repeat(60) + "\n");
}

main().catch(e => {
  console.error("❌ Fatalna greška:", e?.message || e);
  process.exit(1);
});