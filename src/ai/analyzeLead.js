import { callStrictJson, ENGINES } from "./strict.js";
import { AnalysisPackSchema } from "./schemas.js";

export async function analyzeLeadStrict(leadContext) {
  const originalLead = leadContext.lead || leadContext.item?.lead || {};

  const system =
    "You are a growth + technical auditor for local businesses. " +
    "Return ONLY the JSON that matches the provided schema. " +
    "Do not add extra keys. Do not rename keys.";

  // compact input (manje tokena)
  const compact = {
    lead: originalLead,
    mobile: leadContext.mobile ?? null,
    desktop: leadContext.desktop ?? null,
    stack: leadContext.stack ?? null,
  };
  console.log("🔍 Analyzing lead with context:", compact);

  return callStrictJson({
    schema: AnalysisPackSchema,
    schemaName: "analysis_pack",
    system,
    data: compact,
    model: ENGINES.REASONING, // ✅ mnogo jeftinije od gpt-4o
  });
}