// ============================================================
// ai/client.js — Singleton DeepSeek client
// ============================================================
import "dotenv/config";
import OpenAI from "openai";

if (!process.env.DEEPSEEK_API_KEY) {
  throw new Error("Missing DEEPSEEK_API_KEY in .env");
}

export const deepseek = new OpenAI({
  apiKey:  process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com",
});

export const MODELS = {
  FAST:      "deepseek-chat",      // cheap, good for text generation
  REASONING: "deepseek-reasoner",  // slower, better for scoring
};