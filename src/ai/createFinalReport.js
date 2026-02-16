import fs from "fs";
import OpenAI from "openai";
import { writeFileSafe } from "../utils/writeFileSafe.js";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// CSV escaping (ClickUp import voli polja pod navodnicima, sa dupliranjem " u tekstu)
function csvEscape(value) {
  const s = String(value ?? "");
  const escaped = s.replace(/"/g, '""');
  return `"${escaped}"`;
}

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
- Email (DE) i Email (SR) ubaci kao “copy/paste” (bez bulletova u samom emailu).

FORMAT description-a (tačno ovim redosledom, jasni naslovi):
1) LEAD KARTICA (Naziv, Adresa, Telefon, Web, Email, Izvor)
2) CILJ POZIVA (10 MIN) (3–5 kratkih rečenica)
3) 2–5 KLJUČNIH PROBLEMA (iz podataka + site_report)
4) SKRIPT ZA POZIV (DE) — copy/paste
5) 5 KVALIFIKACIONIH PITANJA (DE)
6) KAKO ODGOVORITI NA PRIGOVORE (DE) (4–6 tipičnih)
7) SLEDEĆI KORACI (SR)
8) EMAIL ŠABLON (DE)
9) EMAIL ŠABLON (SR)
10) SEKVENCA NAKNADNOG PRAĆENJA (SR) (iz followup_sequence)
11) KONTROLNA LISTA (SR) (checkbox linije)
12) DODATNE USLUGE (UPSELL) (SR) – sa “Zašto sada / Okidač / Dokaz / Sledeći korak”
`;

// JSON schema za izlaz (Structured Outputs)
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

export async function leadPackToClickUpCsv(leadPackJson, outPath = "./out/clickup/clickup_import.csv") {
  const response = await client.responses.create({
    model: "gpt-5.2",
    input: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(leadPackJson) },
    ],
    // po želji: verbosity "high" ako želiš još “punije” opise
    text: {
      verbosity: "high",
      format: {
        type: "json_schema",
        name: "clickup_task",
        strict: true,
        schema: OUTPUT_SCHEMA,
      },
    },
    // ako ti description ume da bude ogroman, podigni ovo
    max_output_tokens: 6000,
  });

  // Structured output se dobija kao JSON string u output_text
  const out = JSON.parse(response.output_text);

  const header = "Task Name,Description,Status,Priority,Tags\n";
  const row =
    [
      csvEscape(out.task_name),
      csvEscape(out.description),
      csvEscape(out.status),
      csvEscape(out.priority),
      csvEscape(out.tags),
    ].join(",") + "\n";

    console.log("Generated ClickUp Task:", header);
    console.log("Generated ClickUp Task:", row);

    writeFileSafe(outPath, header + row);

    return { outPath, ...out };
}
