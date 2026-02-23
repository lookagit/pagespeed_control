import { callStrictJson } from "./strict.js";
import { LeadPackSchema } from "./leadPackSchema.js";
import { clampText } from "./lengthGuards.js";
import { buildLeadHeader } from "./buildLeadHeader.js";

function normalizeNullable(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s || s === "/" || s.toLowerCase() === "none") return null;
  return s;
}

export async function buildLeadPack({ lead, analysis, siteScrape }) {
  const leadHeader = buildLeadHeader({ lead, analysis, siteScrape });

  const leadName = leadHeader.name || "unbekannt";
  const leadPhone = leadHeader.phones?.[0] || "keine Angabe";
  const leadEmail = leadHeader.emails?.[0] || "keine Angabe";
  const leadWebsite = leadHeader.website_url || "keine Angabe";
  const leadAddress = leadHeader.address || "keine Angabe";

  const system =
    "- You MUST preserve and use the following Lead Header (JSON): " +
    JSON.stringify(leadHeader) + "\n" +
    "You are a German-speaking B2B sales closer + conversion engineer. " +
    "Goal: produce a LEAD PACK an operator can read in ~15 seconds, and an email that converts.\n\n" +

    "CRITICAL DATA INTEGRITY RULES:\n" +
    "- You MUST preserve and use the following Lead Info: " +
    `Name: ${leadName}, Phone: ${leadPhone}, Email: ${leadEmail}, Website: ${leadWebsite}, Address: ${leadAddress}.\n` +
    "- If the phone or email is present in the input, it MUST be available in the output if the schema requires it.\n" +
    "- Do NOT invent any facts, names, addresses, tools, or results. Use ONLY the provided input facts.\n\n" +

    "PRIORITY (must follow):\n" +
    "1) AI chatbot / AI concierge\n" +
    "2) Call center takeover + chatbot handoff\n" +
    "3) Only then: performance, tracking, ads, redesign, content\n\n" +

    "NON-NEGOTIABLE SALES RULES:\n" +
    "- ALWAYS include a recommendation for Call Center (DE + SR operator notes + DE email).\n" +
    "- If a chatbot exists: recommend 'chatbot + call center handoff + lead qualification + after-hours capture + missed-call recovery'.\n" +
    "- If no chatbot: recommend chatbot as #1 and call center as #2.\n" +
    "- Always include one modern, realistic hook: intent-based routing OR missed-call recovery OR after-hours lead capture.\n\n" +

    "LANGUAGE RULES (strict):\n" +
    "- 'ZA OPERATERA (DE)' and 'EMAIL (DE)' must be German.\n" +
    "- 'ZA OPERATERA (SR)' must be Serbian.\n" +
    "- 'TEHNIČKE NAJVAŽNIJE STVARI' must be Serbian.\n" +
    "- **IMPORTANT:** 'EMAIL (SR)' must be an empty string. Do not generate any content for it.\n\n" +

    "STYLE & LENGTH RULES:\n" +
    "- Emails must be plain text: no headings, no lists, no bullet points.\n" +
    "- Operator notes (DE and SR): aim for **3–5 concise sentences** – just the key takeaways for the operator.\n" +
    "- Email (DE): aim for **5–8 sentences total**, split into max 2 short paragraphs.\n" +
    "- DESCRIPTION_OVERALL: must be a **very brief internal summary (2–3 sentences)** – what to sell now, what later, and why. No fluff.\n" +
    "- Mention company name and address if present.\n" +
    "- Mention 1–2 concrete site issues with numbers when available (prefer ms AND seconds, e.g., 12181 ms (12.2 s)).\n" +
    "- No exaggerated promises or % claims.\n" +
    "- Email should pitch ONLY the primary offer (chatbot+call center) + at most ONE supporting item (tracking OR performance).\n" +
    "- Put the full list of services into DESCRIPTION_OVERALL and UPSELL_MENU only.\n";

  const user = {
    instruction:
      "Create the LEAD PACK in the EXACT required JSON schema. " +
      "MANDATORY: Ensure the final JSON includes the correct Name, Phone, and Email of the lead. " +
      "Do not add extra keys. Do not add explanations. " +
      "Do not use bullet points in EMAIL fields.\n" +
      "REMEMBER: EMAIL (SR) must be an empty string.",
    preferences: {
      serbian_script: "latin",
      tone: "professional",
      cta: "short_call_or_reply",
    },
    sales_priorities: {
      primary_offer: "AI chatbot + call center handoff",
      secondary_offers: [
        "website redesign",
        "meta ads",
        "google ads",
        "content creation",
        "instagram management + creatives",
        "graphic design",
        "AI ERP / automation",
        "digital patient record (digitalni karton) build",
      ],
      must_include_concepts: [
        "call center",
        "handoff",
        "missed-call recovery",
        "after-hours lead capture",
        "lead qualification",
        "website redesign",
        "meta ads",
        "google ads",
        "content creation",
        "instagram management + creatives",
      ],
      packaging_rule:
        "EMAIL must stay focused: primary offer + one support item. " +
        "Everything else goes to DESCRIPTION_OVERALL and UPSELL_MENU.",
      preferred_cta: "short_call",
      niche: "lead capture / local business",
    },
    input_facts: { lead, analysis, leadHeader, siteScrape },
    output_rules: {
      email_de_sentence_range: [5, 8],          // smanjeno
      tech_points_range: [3, 5],                 // opciono
      tech_points_should_include: [
        "Numbers for FCP/LCP/TTI where available",
        "Signals like GA4/GTM/Meta Pixel/Chatbot",
        "Unused JS/CSS if mentioned",
        "One short fix hint per line",
      ],
    },
  };

  let pack = await callStrictJson({
    schema: LeadPackSchema,
    schemaName: "lead_pack",
    system,
    data: user,
  });

  // Uvek popuni lead header
  pack.lead = leadHeader;

  pack.site_report = {
    sentences: siteScrape?.sentences || [],
    modernity: siteScrape?.modernity || { verdict: "unknown", confidence: 0, reasons: [] },
    extracted: {
      brand_name: normalizeNullable(siteScrape?.extracted?.brand_name),
      main_service_focus: normalizeNullable(siteScrape?.extracted?.main_service_focus),
      emails: siteScrape?.extracted?.emails || [],
      phones: siteScrape?.extracted?.phones || [],
      address: normalizeNullable(siteScrape?.extracted?.address),
      booking_vendor: normalizeNullable(siteScrape?.extracted?.booking_vendor),
      chat_vendor: normalizeNullable(siteScrape?.extracted?.chat_vendor),
      legal_pages_hint: siteScrape?.extracted?.legal_pages_hint || [],
    },
  };

  // --- POST-PROCESSING: Osiguraj lead_info ---
  if (pack.lead_info) {
    pack.lead_info.name = leadHeader.name || leadName;
    pack.lead_info.phone = leadHeader.phones?.[0] || leadPhone;
    pack.lead_info.email = leadHeader.emails?.[0] || leadEmail;
  } else {
    pack.lead_info = {
      name: leadHeader.name || leadName,
      phone: leadHeader.phones?.[0] || leadPhone,
      email: leadHeader.emails?.[0] || leadEmail,
    };
  }

  // ---- Hard safety clamps (sprečava predugačke tekstove) ----
  pack["ZA OPERATERA (DE)"] = clampText(pack["ZA OPERATERA (DE)"], 500);   // 3‑5 rečenica
  pack["ZA OPERATERA (SR)"] = clampText(pack["ZA OPERATERA (SR)"], 500);
  pack["EMAIL (DE)"] = clampText(pack["EMAIL (DE)"], 1000);                // 5‑8 rečenica
  pack["EMAIL (SR)"] = "";                                                  // uvek prazno
  if (pack["DESCRIPTION_OVERALL"]) {
    pack["DESCRIPTION_OVERALL"] = clampText(pack["DESCRIPTION_OVERALL"], 400); // 2‑3 rečenice
  }

  return pack;
}