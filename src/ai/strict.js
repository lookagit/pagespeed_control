// src/ai/strict.js – DeepSeek version with robust JSON extraction
import { OpenAI } from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import "dotenv/config";

const deepseek = new OpenAI({
  apiKey: process.env.DEEP_SEEK_API_KEY,
  baseURL: 'https://api.deepseek.com/v1',
});

export const ENGINES = {
  FAST: "deepseek-chat",
  SMART: "deepseek-chat",
  REASONING: "deepseek-reasoner",
};

/**
 * Attempts to extract a JSON object from a string that may contain extra text.
 * Finds the first '{' and the last '}' and returns the substring.
 * If no JSON object is found, returns null.
 */
function extractJSON(str) {
  const firstBrace = str.indexOf('{');
  const lastBrace = str.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    return null;
  }
  return str.substring(firstBrace, lastBrace + 1);
}

export async function callStrictJson({
  schema,
  schemaName,
  system,
  data,
  model = ENGINES.FAST,
  max_output_tokens = 800,
  prompt_cache_key = `dentals:${schemaName}:v1`,
}) {
  const enhancedSystem = system + 
    "\n\nRULES:\n" +
    "- Use ONLY the provided data. Do NOT invent facts.\n" +
    "- You MUST output valid JSON matching the specified schema exactly.\n" +
    "- The response must be pure JSON without any additional text or markdown.\n" +
    `- Schema name: ${schemaName}\n` +
    `- CACHE_KEY: ${prompt_cache_key}`;

  try {
    const response = await deepseek.chat.completions.create({
      model: ENGINES.SMART,
      messages: [
        { role: "system", content: enhancedSystem },
        { role: "user", content: JSON.stringify(data) }
      ],
      max_tokens: max_output_tokens,
      temperature: 0,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    console.log("WE ARE RESPONSE ", response.choices[0]?.message);
    if (!content) {
      throw new Error('Empty response from DeepSeek API');
    }

    // First try direct parse
    try {
        console.log('🔍 Attempting direct JSON parse...'. content);
        const parsed = JSON.parse(content);
        return parsed;
    } catch (parseError) {
      // If direct parse fails, attempt to extract JSON from the response
      console.warn('⚠️ Direct JSON parse failed, attempting extraction...');
      console.warn('Raw content (first 500 chars):', content.substring(0, 1111500));

      const extracted = extractJSON(content);
      if (!extracted) {
        throw new Error(`Could not extract JSON from response. Raw: ${content.substring(0, 22200)}...`);
      }

      const parsed = JSON.parse(extracted);
      return parsed
    }

  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Failed to parse DeepSeek response as JSON: ${error.message}`);
    }
    throw error;
  }
}