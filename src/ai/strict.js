import { openai } from "./client.js";
import { zodTextFormat } from "openai/helpers/zod";
export const ENGINES = {
  FAST: "gpt-4o-mini",    // Za brze analize, klasifikaciju, jednostavne zadatke
  SMART: "gpt-4o",        // Za kompleksne sales strategije i pisanje emailova
  REASONING: "o1-mini",   // Ako vam treba duboka logika (npr. tehnički audit)
};

export async function callStrictJson({ schema, schemaName, system, data, model = ENGINES.SMART }) {
  // responses.parse + zodTextFormat = server-side schema enforcement
  const res = await openai.responses.parse({
    model,
    input: [
      {
        role: "system",
        content:
          system +
          "\n\nRules:\n- Use ONLY provided data.\n- Do NOT invent facts.\n- Output MUST match schema exactly.\n",
      },
      { role: "user", content: JSON.stringify(data) },
    ],
    text: {
      format: zodTextFormat(schema, schemaName),
    },
  });

  // parse() vraća već validiran output; parsed se nalazi u output_parsed
  // (SDK ga obično mapira kao res.output_parsed)
  return res.output_parsed;
}
