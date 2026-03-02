// ============================================================
// ai/createFinalReport.js — Zoho Leads CSV export
// ============================================================
// STANDARD ZOHO FIELDS (already exist in Zoho — do not create):
//   First Name, Last Name, Company, Phone, Email, Website,
//   Street, City, State, Zip Code, Country,
//   Lead Source, Lead Status, Industry, Description
//
// CUSTOM FIELDS to create in Zoho (Settings → Modules → Leads):
//   Multi Line (6): Cold Email Text, Call Script, Website Issues,
//                   Agent Briefing, Pitch, Lead Recap
//   (Cold Email Text includes subject line on first line)
// ============================================================

import fs from "fs";
import path from "path";

const ZOHO_COLUMNS = [
  // ── STANDARD ZOHO LEADS (do not rename) ───────────────────
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
  "Lead Source",       // → "Google Places"
  "Lead Status",       // → "New"
  "Industry",          // → "Healthcare"
  "Description",       // → Agent Briefing (visible on lead open)

  // ── CUSTOM: 6 MULTI LINE (ordered by priority) ───────────────
  "Cold Email Text",   // #1 — SUBJECT: ... \n --- \n 5-sentence email
  "Call Script",       // #2 — 30-second opener
  "Website Issues",    // #3 — Factual site problems with numbers
  "Agent Briefing",    // #4 — WHO / PROBLEM / WE OFFER / BUDGET / CALL GOAL
  "Pitch",             // #5 — Why call them + expected outcome
  "Lead Recap",        // #6 — Score, Priority, Budget, Google, Site info
];

function mapToZoho(pack) {
  const l = pack.lead     ?? {};
  const a = pack.analysis ?? {};
  const s = pack.site     ?? {};
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
    "Description": e.agent_briefing || "",  // agent sees this first when opening lead

    // Custom: Multi Line (ordered by priority)
    "Cold Email Text":  e.cold_email     || "",
    "Call Script":      e.call_script    || "",
    "Website Issues":   e.website_issues || "",
    "Agent Briefing":   e.agent_briefing || "",
    "Pitch":            e.pitch          || "",
    "Lead Recap":       e.lead_recap     || "",
  };
}

function capitalize(str) {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1);
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
  console.log(`📊 Zoho CSV (${packs.length} leads): ${outputPath}`);
}