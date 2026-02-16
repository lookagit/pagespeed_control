import { callStrictJson } from "./strict.js";
import { AnalysisPackSchema } from "./schemas.js";

export async function analyzeLeadStrict(leadContext) {
  // Izvlačimo originalne lead informacije da bismo ih naglasili u promptu
  const originalLead = leadContext.item?.lead || {};
  
  const system =
    "You are a growth + technical auditor for local businesses. " +
    "CRITICAL: You must preserve and include all original lead information (name, phone, website_url, address) in the final output. " +
    "If an email is missing in the signals but present elsewhere, use it. Do not return null for fields that have data in the input. " +
    "Return ONLY the JSON that matches the provided schema. " +
    "Do not add extra keys. Do not rename keys.";

  // Dodajemo eksplicitnu napomenu u data objektu kako bi model bio svestan prioriteta
  const enhancedData = {
    ...leadContext,
    instruction_note: "IMPORTANT: The output must retain the following lead info: " + JSON.stringify(originalLead)
  };

  return await callStrictJson({
    schema: AnalysisPackSchema,
    schemaName: "analysis_pack",
    system,
    data: enhancedData,
  });
}