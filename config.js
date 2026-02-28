import "dotenv/config";

export const CONFIG = {
  // === INPUT ===
  LEADS_CSV: process.env.LEADS_CSV || "./data/leads.csv",

  // === API KLJUČEVI ===
  PSI_API_KEY: process.env.PSI_API_KEY,       // Google PageSpeed
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY, // DeepSeek AI

  // === DIREKTORIJUMI ===
  OUT_DIR: "./out/pagespeedReports",          // raw JSON fajlovi po leadu
  FINAL_DIR: "./out/final",  // analizirani JSON fajlovi
  REPORT_DIR: "./out/report", // finalni CSV izveštaji

  // === PIPELINE PODEŠAVANJA ===
  TEST_LIMIT: Number(process.env.TEST_LIMIT || 0), // 0 = svi leadovi
  DELAY_MS: Number(process.env.DELAY_MS || 600),   // pauza između leadova
  MAX_RETRIES: 2,
  RETRY_DELAY_MS: 3000,

  // === SKORING PRAGOVI (za prioritizaciju leadova) ===
  SCORE: {
    // Lead se smatra "hot" ako ima ukupni skor >= ovog praga
    HOT_THRESHOLD: 70,
    WARM_THRESHOLD: 40,
  },
};