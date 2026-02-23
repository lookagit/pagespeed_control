import "dotenv/config";

export const CONFIG = {
  LEADS_CSV: process.env.LEADS_CSV || "./out/places_melbourne_aesthetic_surgery_doctor_plastic_surgery_cosmetic_clinic_laser_clinic.csv",
  PSI_API_KEY: process.env.PSI_API_KEY,
  CRUX_API_KEY: process.env.CRUX_API_KEY,
  OUT_DIR: "./out",
  RESULTS_JSON: "./out/results.json",
  TEST_LIMIT: Number(process.env.TEST_LIMIT || 0), // 0 = svi
  DELAY_MS: Number(process.env.DELAY_MS || 400),
};