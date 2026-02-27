// ============================================================
// ai/checkHtmlAndUrl.js - Sumarizacija sadržaja sajta
// ============================================================

import OpenAI from "openai";
import { CONFIG } from "../config.js";

const deepseek = new OpenAI({
  apiKey:  CONFIG.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com",
});

/**
 * Uzima scrape-ovani tekst sajta i vraća strukturirani sažetak.
 * @param {object} params
 * @param {string} params.url     - URL sajta
 * @param {string} params.tokens  - Scraped tekst sajta
 */
export async function summarizeSite({ url, tokens }) {
  if (!tokens || tokens.length < 50) {
    return { summary: "Nije bilo moguće pročitati sadržaj sajta.", services: [], tone: "unknown" };
  }

  const prompt = `Analiziraj sadržaj ovog sajta i odgovori ISKLJUČIVO validnim JSON objektom.

URL: ${url}

SADRŽAJ SAJTA (prvih ~3000 karaktera):
${tokens.slice(0, 3000)}

Odgovori ovim JSON oblikom (bez markdowna, bez objašnjenja):
{
  "summary": "<2-3 rečenice: čime se bavi biznis>",
  "services": ["<usluga 1>", "<usluga 2>"],
  "tone": "<professional | outdated | modern | minimal | cluttered>",
  "has_online_booking": <true | false>,
  "has_testimonials": <true | false>,
  "has_team_page": <true | false>,
  "languages": ["<jezik>"],
  "notable": "<jedna napomena o sajtu ako postoji>"
}`;

  const response = await deepseek.chat.completions.create({
    model: "deepseek-chat",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.2,
    max_tokens: 400,
  });

  const raw = response.choices[0]?.message?.content?.trim() ?? "";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { summary: raw, services: [], tone: "unknown" };

  return JSON.parse(jsonMatch[0]);
}