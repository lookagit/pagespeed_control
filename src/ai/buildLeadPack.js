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
    "- ALWAYS include a recommendation for Call Center (DE + SR operator notes + DE + SR email).\n" +
    "- If a chatbot exists: recommend 'chatbot + call center handoff + lead qualification + after-hours capture + missed-call recovery'.\n" +
    "- If no chatbot: recommend chatbot as #1 and call center as #2.\n" +
    "- Always include one modern, realistic hook: intent-based routing OR missed-call recovery OR after-hours lead capture.\n\n" +

    "LANGUAGE RULES (strict):\n" +
    "- 'ZA OPERATERA (DE)' and 'EMAIL (DE)' must be German.\n" +
    "- 'ZA OPERATERA (SR)' and 'EMAIL (SR)' must be Serbian.\n" +
    "- 'TEHNIČKE NAJVAŽNIJE STVARI' must be Serbian.\n\n" +

    "STYLE RULES:\n" +
    "- Emails must be plain text: no headings, no lists, no bullet points.\n" +
    "- Operator notes: aim for 5–8 sentences (not strict), concise and actionable.\n" +
    "- Email (DE): aim for 8–12 sentences total, max 2 short paragraphs.\n" +
    "- Mention company name and address if present.\n" +
    "- Mention 1–2 concrete site issues with numbers when available (prefer ms AND seconds, e.g., 12181 ms (12.2 s)).\n" +
    "- No exaggerated promises or % claims.\n" +
    "- Email should pitch ONLY the primary offer (chatbot+call center) + at most ONE supporting item (tracking OR performance).\n" +
    "- Put the full list of services into DESCRIPTION_OVERALL and UPSELL_MENU only.\n" +
    "- DESCRIPTION_OVERALL must read like internal sales notes: what to sell now, what later, and why.\n";

  const user = {
    instruction:
      "Create the LEAD PACK in the EXACT required JSON schema. " +
      "MANDATORY: Ensure the final JSON includes the correct Name, Phone, and Email of the lead. " +
      "Do not add extra keys. Do not add explanations. " +
      "Do not use bullet points in EMAIL fields.",
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
      email_de_sentence_range: [8, 12],
      tech_points_range: [4, 6],
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

  // uvek popuni odvojene sekcije:
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

  // --- 2. POST-PROCESSING: Sigurnosna mreža (Hard Merge) ---
  // Ako šema dozvoljava polja za lead info, ovde ih prisilno vraćamo ako ih je AI izostavio
  // Napomena: Ovo zavisi od toga da li LeadPackSchema ima ta polja na top-level-u.
  // Čak i ako ih nema, AI će ih sada bolje koristiti u tekstovima (email/notes).
  
  if (pack.lead_info) {
    pack.lead_info.name = lead.name || leadName;
    pack.lead_info.phone = lead.phone || leadPhone;
    pack.lead_info.email = lead.email || leadEmail;
  } else {
    pack["lead_info"] = {name: lead.name || leadName, phone: lead.phone || leadPhone, email: lead.email || leadEmail, };
  }

  // ---- hard safety clamps (prevents super long texts) ----
  pack["ZA OPERATERA (DE)"] = clampText(pack["ZA OPERATERA (DE)"], 700);
  pack["ZA OPERATERA (SR)"] = clampText(pack["ZA OPERATERA (SR)"], 700);
  pack["EMAIL (DE)"] = clampText(pack["EMAIL (DE)"], 1400);
  pack["EMAIL (SR)"] = clampText(pack["EMAIL (SR)"], 1400);

  if (pack["DESCRIPTION_OVERALL"]) {
    pack["DESCRIPTION_OVERALL"] = clampText(pack["DESCRIPTION_OVERALL"], 1200);
  }

  return pack;
}