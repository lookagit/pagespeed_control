import "dotenv/config";
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function main() {
  const res = await client.responses.create({
    model: "gpt-5.2",
    input: "Reci 'radi' i napiši jednu rečenicu na srpskom.",
  });

  console.log(res.output_text);
}

main().catch((e) => {
  console.error("❌", e?.message || e);
  process.exit(1);
});
