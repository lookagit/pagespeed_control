// ============================================================
// ai/createFinalReport.js — Zoho Leads CSV export
// ============================================================
// STANDARD ZOHO FIELDS (exist by default — do not create):
//   First Name, Last Name, Company, Phone, Email, Website,
//   Street, City, State, Zip Code, Country,
//   Lead Source, Lead Status, Industry, Description
//
// CREATE THESE 6 CUSTOM FIELDS in Zoho (all Multi Line):
//   Cold Email Text  — Subject on line 1, then ---, then email body
//   Call Script      — 30-second opener
//   Website Issues   — Factual problems with numbers
//   Agent Briefing   — WHO / PROBLEM / WE OFFER / BUDGET / CALL GOAL
//   Pitch            — Why contact them + expected ROI
//   Lead Recap       — All key metrics in one glance
// ============================================================

import fs   from "fs";
import path from "path";

const ZOHO_COLUMNS = [
  // Standard Zoho Leads (do not rename)
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
  "Description",      // = Agent Briefing (agent sees this first on lead open)

  // Custom: 6 Multi Line fields
  "Cold Email Text",  // #1 priority
  "Call Script",      // #2
  "Website Issues",   // #3
  "Agent Briefing",   // #4
  "Pitch",            // #5
  "Lead Recap",       // #6 — instant, no AI
];

function mapToZoho(pack) {
  const l = pack.lead     ?? {};
  const e = pack.enriched ?? {};

  return {
    // Standard Zoho
    "First Name":  l["First Name"] || "",
    "Last Name":   l["Last Name"]  || l.name || "Lead",
    "Company":     l.Company       || l.name || "",
    "Phone":       l.Phone         || l.phone || "",
    "Email":       l.email         || "",
    "Website":     l.Website       || l.website_url || "",
    "Street":      l.Street        || "",
    "City":        l.City          || "",
    "State":       l.State         || "",
    "Zip Code":    l["Zip Code"]   || "",
    "Country":     l.Country       || "USA",
    "Lead Source": "Google Places",
    "Lead Status": "New",
    "Industry":    "Healthcare",
    "Description": e.agent_briefing || "",

    // Custom multi line
    "Cold Email Text": e.cold_email     || "",
    "Call Script":     e.call_script    || "",
    "Website Issues":  e.website_issues || "",
    "Agent Briefing":  e.agent_briefing || "",
    "Pitch":           e.pitch          || "",
    "Lead Recap":      e.lead_recap     || "",
  };
}

function escapeCsv(value) {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function packToRow(pack) {
  const mapped = mapToZoho(pack);
  return ZOHO_COLUMNS.map(col => escapeCsv(mapped[col])).join(",");
}

export async function leadPackToCsv(pack, outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const header = ZOHO_COLUMNS.join(",");
  const row    = packToRow(pack);
  fs.writeFileSync(outputPath, [header, row].join("\n"), "utf8");
}

export async function mergeLeadPacksToCsv(packs, outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const header = ZOHO_COLUMNS.join(",");
  const rows   = packs.map(packToRow);
  fs.writeFileSync(outputPath, [header, ...rows].join("\n"), "utf8");
  console.log(`📊 Zoho CSV → ${outputPath} (${packs.length} leads)`);
}