// ============================================================
// ai/strict.js — Robust JSON caller for DeepSeek
// ============================================================
// Uvek vraća parsed JSON ili baca grešku.
// Pokušava direktni parse, pa fallback na brace extraction.
// ============================================================
import { deepseek, MODELS } from "./client.js";

function extractJSON(str) {
  const first = str.indexOf("{");
  const last  = str.lastIndexOf("}");
  if (first === -1 || last === -1 || last < first) return null;
  return str.substring(first, last + 1);
}

export async function callStrictJson({
  system,
  data,
  model           = MODELS.FAST,
  max_tokens      = 900,
}) {
  const enhancedSystem =
    system +
    "\n\nRULES:\n" +
    "- Use ONLY the provided data. Do NOT invent facts.\n" +
    "- Output ONLY valid JSON. No markdown, no explanation, no extra text.\n";

  const response = await deepseek.chat.completions.create({
    model,
    messages: [
      { role: "system", content: enhancedSystem },
      { role: "user",   content: JSON.stringify(data) },
    ],
    max_tokens,
    temperature:     0,
    response_format: { type: "json_object" },
  });

  const content = response.choices[0]?.message?.content ?? "";
  if (!content) throw new Error("Empty response from DeepSeek");

  // 1. Direct parse
  try {
    return JSON.parse(content);
  } catch {
    // 2. Brace extraction fallback
    const extracted = extractJSON(content);
    if (!extracted) {
      throw new Error(`No JSON found in response: ${content.slice(0, 300)}`);
    }
    return JSON.parse(extracted);
  }
}

// Convenience: plain text call (no JSON enforcement)
// ai/strict.js (or wherever callText lives)

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @param {object} args
 * @param {string} args.prompt
 * @param {number} [args.max_tokens=400]
 * @param {number} [args.temperature=0.2]
 * @param {number} [args.retries=2]
 * @param {string} [args.model=MODELS.FAST]
 * @param {(text:string)=>({ok:boolean, reason?:string}|boolean)} [args.validate]
 * @param {string} [args.repair_instructions]
 */
export async function callText({
  prompt,
  max_tokens = 400,
  temperature = 0.2,
  retries = 2,
  model = MODELS.FAST,
  validate = null,
  repair_instructions = null,
}) {
  let lastText = "";

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await deepseek.chat.completions.create({
        model,
        messages: [
          // Keep it deterministic + no “assistant chatter”
          { role: "system", content: "Return only the final answer. No markdown. No explanations." },
          { role: "user", content: prompt },
        ],
        max_tokens,
        temperature,
      });

      const text = res.choices[0]?.message?.content?.trim() ?? "";
      lastText = text;

      // If no validator, return immediately
      if (!validate) return text;

      // Validate
      const verdict = validate(text);
      const ok = typeof verdict === "boolean" ? verdict : !!verdict?.ok;

      if (ok) return text;

      // If invalid and we still have attempts left, do a repair pass (same model)
      const reason = typeof verdict === "object" ? verdict.reason : "Output did not match required format.";
      if (attempt < retries) {
        const repairPrompt = [
          prompt,
          "",
          "IMPORTANT: Your previous output was invalid.",
          `Reason: ${reason}`,
          repair_instructions
            ? `Repair instructions: ${repair_instructions}`
            : "Repair instructions: Return ONLY the corrected output. Do not add commentary.",
          "",
          "Previous output (for reference):",
          text,
        ].join("\n");

        // small backoff before repair attempt
        await sleep(200 * (attempt + 1));
        // overwrite prompt for next attempt
        prompt = repairPrompt;
        continue;
      }

      // Out of attempts -> return best effort (or throw, depending on your preference)
      return text;

    } catch (err) {
      const msg = err?.message ?? String(err);

      // Retry transient errors
      const transient =
        /timeout|ETIMEDOUT|ECONNRESET|429|rate|temporarily|overloaded|5\d\d/i.test(msg);

      if (attempt < retries && transient) {
        await sleep(350 * (attempt + 1));
        continue;
      }

      // Non-transient or out of retries
      throw err;
    }
  }

  return lastText;
}