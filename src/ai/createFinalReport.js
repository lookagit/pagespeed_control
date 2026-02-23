import fs from "fs";
import { OpenAI } from "openai"; // OpenAI SDK (DeepSeek compatible)
import { writeFileSafe } from "../utils/writeFileSafe.js";
import "dotenv/config";
import { ENGINES } from "./strict.js";

// DeepSeek client (OpenAI‑compatible)
const deepseek = new OpenAI({
  apiKey: process.env.DEEP_SEEK_API_KEY,
  baseURL: "https://api.deepseek.com/v1",
});

// CSV escaping (ClickUp import expects quoted fields with double quotes escaped)
function csvEscape(value) {
  const s = String(value ?? "");
  const escaped = s.replace(/"/g, '""');
  return `"${escaped}"`;
}

// Updated system prompt – email templates removed
const SYSTEM_PROMPT = `TI SI “ClickUp Lead Pack Builder” za B2B prodaju (dental klinike u Nemačkoj).
Ulaz je jedan JSON lead pack (podaci + emaili + tehničke tačke + upsell + followup + site_report).

CILJ: vrati JEDAN JSON objekat koji se uklapa u šemu:
- task_name: samo ime lida (kratko, sa gradom ako postoji).
- status: uvek "New Lead"
- priority: uvek "High"
- tags: string sa tagovima odvojenim sa ";" (obavezno: berlin;dentist; + 3–6 relevantnih tagova iz podataka, npr. no-email, ga4, gtm, chatbot, performance, no-social, no-booking, callcenter)
- description: “operater miran” playbook, maksimalno koristan i kompletan.

PRAVILA:
- SVE OSIM task_name ide u description.
- Nemoj da izmišljaš email/telefon. Ako nema email: jasno napiši “Email: NEMA (uzeti tokom poziva)”.
- Ne koristi linkove ka nepoznatim stvarima; koristi samo ono što postoji u JSON-u (telefon, sajt, adresa, vendor npr. Doctolib/Cookiebot itd).
- Izvuci najkorisnije signale iz site_report (npr. nema booking/chat/social/GA4).
- Tehničke stvari napiši kratko i u brojkama gde postoje (JS KiB, CSS KiB, mobile/desktop score, load time).
- Sve što je na ENG (npr. upsell “why_now/trigger/proof/next_step”) prevedi na SR u description-u.
- DELIMIČNO: Call Script, kvalifikaciona pitanja i objection handling moraju biti na NEMAČKOM (DE). Ostalo je na SR.

FORMAT description-a (tačno ovim redosledom, jasni naslovi):
1) LEAD KARTICA (Naziv, Adresa, Telefon, Web, Email, Izvor)
2) CILJ POZIVA (10 MIN) (3–5 kratkih rečenica)
3) 2–5 KLJUČNIH PROBLEMA (iz podataka + site_report)
4) SKRIPT ZA POZIV (DE) — copy/paste
5) 5 KVALIFIKACIONIH PITANJA (DE)
6) KAKO ODGOVORITI NA PRIGOVORE (DE) (4–6 tipičnih)
7) SLEDEĆI KORACI (SR)
8) SEKVENCA NAKNADNOG PRAĆENJA (SR) (iz followup_sequence)
9) KONTROLNA LISTA (SR) (checkbox linije)
10) DODATNE USLUGE (UPSELL) (SR) – sa “Zašto sada / Okidač / Dokaz / Sledeći korak”

TVOJ ODGOVOR MORA BITI ISKLJUČIVO VALIDAN JSON OBJEKAT, BEZ DODATNOG TEKSTA ILI OZNAKA.`;

// JSON schema for the output (used for validation, optional)
const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    task_name: { type: "string" },
    status: { type: "string", enum: ["New Lead"] },
    priority: { type: "string", enum: ["High"] },
    tags: { type: "string", description: "Semicolon-separated tags" },
    description: { type: "string" },
  },
  required: ["task_name", "status", "priority", "tags", "description"],
};

/**
 * Simple JSON validation against a JSON schema (optional).
 * You can install `ajv` for full validation, but here we only check required fields.
 */
function validateOutput(obj) {
  const required = OUTPUT_SCHEMA.required;
  for (const field of required) {
    if (!(field in obj)) {
      throw new Error(`Missing required field: ${field}`);
    }
  }
  if (obj.status !== "New Lead") obj.status = "New Lead"; // enforce
  if (obj.priority !== "High") obj.priority = "High";
  return obj;
}

export async function leadPackToClickUpCsv(leadPackJson, outPath = "./out/clickup/clickup_import.csv") {
  const response = await deepseek.chat.completions.create({
    model: ENGINES.REASONING, // or use ENGINES.SMART from your config
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(leadPackJson) },
    ],
    max_tokens: 6000,
    temperature: 0, // deterministic
    response_format: { type: "json_object" },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("Empty response from DeepSeek API");
  }

  // Parse JSON (DeepSeek JSON mode should return valid JSON)
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    // Fallback: attempt to extract JSON from the response
    const firstBrace = content.indexOf('{');
    const lastBrace = content.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
      throw new Error(`Could not extract JSON from response: ${content.substring(0, 200)}...`);
    }
    const extracted = content.substring(firstBrace, lastBrace + 1);
    parsed = JSON.parse(extracted);
  }

  // Optional validation
  const out = validateOutput(parsed);

  // Build CSV
  const header = "Task Name,Description,Status,Priority,Tags\n";
  const row = [
    csvEscape(out.task_name),
    csvEscape(out.description),
    csvEscape(out.status),
    csvEscape(out.priority),
    csvEscape(out.tags),
  ].join(",") + "\n";

  console.log("Generated ClickUp Task:", header);
  console.log("Generated ClickUp Task:", row);

  await writeFileSafe(outPath, header + row);

  return { outPath, ...out };
}