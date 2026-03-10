// ============================================================
// ai/createFinalReport.js — Zoho Leads CSV export
// ============================================================
//
// STANDARD ZOHO FIELDS (exist by default — do not create):
//   First Name, Last Name, Company, Phone, Email, Website,
//   Street, City, State, Zip Code, Country,
//   Lead Source, Lead Status, Industry, Description
//
// CREATE THESE 6 CUSTOM FIELDS in Zoho (type: Multi Line):
//   Cold Email Text  — Subject on line 1, "---", then body
//   Call Script      — 30-second phone opener
//   Website Issues   — Factual CRM note
//   Agent Briefing   — WHO / ISSUE / FIX / BUDGET / GOAL
//   Pitch            — Internal 3-sentence opportunity note
//   Lead Recap       — Full metrics snapshot
//
// KEY MAPPING NOTES:
//   lead.phone       → Phone   (CSV-imported, lowercase key)
//   lead.website_url → Website (lowercase key from normalizeLead)
//   lead.street      → Street  (parsed from address by index.js)
//   lead.city        → City
//   lead.state       → State
//   lead.postal_code → Zip Code
//   lead.country     → Country
//   contacts.primary_phone → Phone (overrides if crawler found one)
//   contacts.primary_email → Email (from crawler)
// ============================================================

import fs   from "fs";
import path from "path";

const ZOHO_COLUMNS = [
  // Standard Zoho Leads
  "First Name",
  "Last Name",
  "Company",
  "Phone",
  "Email",
  "Website",
  "Street",
  "City",
  "State",
  "Zip Code",
  "Country",
  "Lead Source",
  "Lead Status",
  "Industry",
  "Description",       // = Agent Briefing (agent sees this first on lead open)

  // Custom Multi Line fields (create in Zoho before import)
  "Cold Email Text",   // #1
  "Call Script",       // #2
  "Website Issues",    // #3
  "Agent Briefing",    // #4
  "Pitch",             // #5
  "Lead Recap",        // #6
];

// ─────────────────────────────────────────────────────────────
// MAP enrichedPack → Zoho row object
// ─────────────────────────────────────────────────────────────

function mapToZoho(pack) {
  const l = pack.lead     ?? {};   // normalizeLead() output: lowercase keys
  const e = pack.enriched ?? {};
  const c = pack.contacts ?? {};   // crawler-verified contact from enrichLead

  // Phone: prefer crawler-verified, fall back to CSV phone
  const phone = c.primary_phone ?? l.phone ?? "";

  // Email: prefer crawler-found, fall back to CSV email (often empty)
  const email = c.primary_email ?? l.email ?? "";

  // Name split: normalizeLead() already split these correctly
  // For dental practices looksLikeBusiness → first="", last=name, company=name
  // Zoho requires First Name — fall back to company name if empty
  const company   = l.company    ?? l.name ?? "";
  const lastName  = l.last_name  ?? l.name ?? "";
  const firstName = l.first_name || company || lastName;

  return {
    // ── Standard Zoho fields ─────────────────────────────
    "First Name": firstName,
    "Last Name":  lastName,
    "Company":    company,
    "Phone":      phone,
    "Email":      email,
    "Website":    l.website_url ?? "",       // normalizeLead key

    // Address — normalizeLead() correctly parsed these
    "Street":     l.street      ?? "",
    "City":       l.city        ?? "",
    "State":      l.state       ?? "",
    "Zip Code":   l.postal_code ?? "",
    "Country":    l.country     || "USA",

    "Lead Source": "Google Places",
    "Lead Status": "New",
    "Industry":    "Healthcare",
    "Description": e.agent_briefing || "",   // agent sees this first in Zoho

    // ── Custom fields ────────────────────────────────────
    "Cold Email Text": e.cold_email     || "",
    "Call Script":     e.call_script    || "",
    "Website Issues":  e.website_issues || "",
    "Agent Briefing":  e.agent_briefing || "",
    "Pitch":           e.pitch          || "",
    "Lead Recap":      e.lead_recap     || "",
  };
}

// ─────────────────────────────────────────────────────────────
// CSV helpers
// ─────────────────────────────────────────────────────────────

function escapeCsv(value) {
  if (value === null || value === undefined) return "";
  const str = String(value);
  // Wrap in quotes if contains comma, quote, newline, or carriage return
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function packToRow(pack) {
  const mapped = mapToZoho(pack);
  return ZOHO_COLUMNS.map(col => escapeCsv(mapped[col] ?? "")).join(",");
}

// ─────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────

/** Write a single enriched pack to CSV. */
export async function leadPackToCsv(pack, outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const header = ZOHO_COLUMNS.join(",");
  const row    = packToRow(pack);
  fs.writeFileSync(outputPath, [header, row].join("\n"), "utf8");
}

/** Write multiple enriched packs to a single Zoho-ready CSV. */
export async function mergeLeadPacksToCsv(packs, outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const header = ZOHO_COLUMNS.join(",");
  const rows   = packs.map(packToRow);
  fs.writeFileSync(outputPath, [header, ...rows].join("\n"), "utf8");
  console.log(`📊 Zoho CSV → ${outputPath} (${packs.length} leads)`);
}