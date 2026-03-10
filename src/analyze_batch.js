// ============================================================
// analyze_batch.js — STAGE 2: AI Analysis Pipeline v2.2.0
// ============================================================
//
// MASTER JSON STRUCTURE (one file per lead):
//
//  _meta          pipeline version, timing, ai_cost, errors
//  lead           Google Places input — authoritative identity
//  triage         LIS score, priority, call_policy, ROI
//  signal         normalised signals: scores, vitals, booking, tracking
//  contacts       resolved contacts with full source provenance
//                 Google Places phone FIRST (confidence 1.0)
//  site           scrape-derived: services, tone, booking, testimonials
//  analysis       4-pass AI output: the_one_problem, passes, subjects
//  zoho           6 Zoho CRM fields ready to import
//  sales_intel    outreach_sequence, objections, competitor, seasonal
//  _debug         raw stage1, scrape metadata, factSheet snapshot
//
// CONTACT PRIORITY (enforced by contact_resolver.js):
//   phone:   Google Places (1.0) > Crawler (0.6-0.8) > CSV (0.3)
//   email:   Crawler (0.6) > CSV (0.3)
//   address: Google Places only (authoritative, geocoded)
//   name:    Google Places only (authoritative)
//
// Usage:
//   node src/analyze_batch.js
//   node src/analyze_batch.js --force
// ============================================================

import fs   from "fs";
import path from "path";

import { CONFIG }                    from "./config.js";
import { readJson }                  from "./io/readJson.js";
import { writeJson }                 from "./io/write.js";
import { sleep, withRetries }        from "./utils/helpers.js";
import { buildCallReport }           from "./pagespeed/batch-reporter.js";
import { buildSignalReport }         from "./ai/buildSignalReport.js";
import { analyzeLeadWithDeepSeek }   from "./ai/analyzeLead.js";
import { scrapeSiteSnapshot }        from "./utils/siteScrape.js";
import { summarizeSite }             from "./ai/checkHtmlAndUrl.js";
import { buildLeadPack }             from "./ai/buildLeadPack.js";
import { enrichLead, buildFactSheet } from "./ai/enrichLead.js";
import { resolveContacts }           from "./ai/contact_resolver.js";
import { leadPackToCsv }             from "./ai/createFinalReport.js";
import {
  computeIntentSignals,
  computeLeadIntelligenceScore,
} from "./ai/sales_intelligence.js";

const PIPELINE_VERSION = "2.2.0";

// ─────────────────────────────────────────────────────────────
// Timing
// ─────────────────────────────────────────────────────────────

function timer() {
  const t0 = Date.now();
  return { elapsed: () => Date.now() - t0 };
}

// ─────────────────────────────────────────────────────────────
// Discovery
// ─────────────────────────────────────────────────────────────

function findRawLeadFiles() {
  fs.mkdirSync(CONFIG.OUT_DIR, { recursive: true });
  return fs
    .readdirSync(CONFIG.OUT_DIR, { withFileTypes: true })
    .filter(e => e.isFile() && e.name.endsWith(".json"))
    .filter(e => !e.name.endsWith(".error.json"))
    .filter(e => !e.name.startsWith("_"))
    .map(e => ({
      filename: e.name,
      filepath: path.join(CONFIG.OUT_DIR, e.name),
      basename: path.basename(e.name, ".json"),
    }));
}

function isAlreadyAnalyzed(basename) {
  return fs.existsSync(path.join(CONFIG.FINAL_DIR, basename + ".json"));
}

// ─────────────────────────────────────────────────────────────
// Process one lead
// ─────────────────────────────────────────────────────────────

async function processFile({ filename, filepath, basename }, { force }) {
  console.log("\n" + "─".repeat(62));
  console.log("FILE: " + filename);

  if (!force && isAlreadyAnalyzed(basename)) {
    console.log("SKIP: Already analyzed. Use --force to rerun.");
    return { status: "skipped" };
  }

  const pipelineStart = Date.now();
  const timing  = {};
  const errors  = {};
  let callReport    = null;
  let signalReport  = null;

  try {
    // ── 1. Load ───────────────────────────────────────────
    const raw = readJson(filepath);
    if (!raw?.item?.lead?.website_url) throw new Error("Missing item.lead.website_url");
    if (raw.item.status === "failed") { console.log("SKIP: Stage 1 failed."); return { status: "skipped" }; }

    // ── 2. Call report ────────────────────────────────────
    let t = timer();
    callReport = buildCallReport(raw);
    callReport._originalLead = raw.item.lead;
    timing.build_call_report_ms = t.elapsed();

    const url = callReport.website_url;
    if (!url) throw new Error("No website_url after buildCallReport");

    console.log("URL: " + url);
    console.log("    Health " + callReport.health_score + "/100 (" + callReport.health_grade + ")"
      + "  Temp: " + (callReport.lead_temperature?.label ?? "N/A"));
    console.log("    Mobile " + callReport.scores?.mobile_perf + "/100"
      + "  Desktop " + callReport.scores?.desktop_perf + "/100");

    // ── 3. Signal report (normalised canonical object) ────
    t = timer();
    signalReport = buildSignalReport(callReport);
    // CRITICAL: carry _originalLead so Google Places data
    // (rating, reviews, maps_url, address) reaches analysis and enrichLead
    signalReport._originalLead = callReport._originalLead;
    timing.build_signal_report_ms = t.elapsed();

    // ── 4. Contact resolution ─────────────────────────────
    // Google Places phone > Crawler > CSV
    t = timer();
    const resolvedContacts = resolveContacts({
      googleLead:      callReport._originalLead,    // Google Places data
      crawlerContact:  signalReport.contact,         // normalised crawler data
      csvLead:         callReport._originalLead,     // same object (CSV merged at Stage 1)
    });
    timing.contact_resolution_ms = t.elapsed();
    console.log("    Phone: " + (resolvedContacts.phones.primary ?? "none")
      + " [" + (resolvedContacts.phones.primary_source ?? "none") + "]");

    // ── 5. Scrape ─────────────────────────────────────────
    t = timer();
    let scrapeResult = null;
    try {
      scrapeResult = await withRetries(() => scrapeSiteSnapshot(url), "Scrape", CONFIG.MAX_RETRIES);
      timing.scrape_ms = t.elapsed();
      console.log(scrapeResult.ok
        ? "SCRAPE: ok (" + (scrapeResult.extraPages?.length ?? 0) + " extra pages)"
        : "SCRAPE: failed — " + scrapeResult.error);
    } catch (e) {
      timing.scrape_ms = t.elapsed();
      errors.scrape = e.message;
    }

    // ── 6. AI analysis — 4 passes ─────────────────────────
    // Passes signalReport (not callReport) — single source of truth
    t = timer();
    const analysis = await withRetries(
      () => analyzeLeadWithDeepSeek({
        callReport: signalReport,
        scrapeBase: scrapeResult?.base ?? null,
      }),
      "AI analysis",
      CONFIG.MAX_RETRIES
    );
    timing.ai_analysis_ms = t.elapsed();
    console.log("AI: score " + analysis.score + " | priority " + analysis.priority
      + " | budget " + (analysis.estimated_budget_range ?? "?"));

    // ── 7. Site summary ───────────────────────────────────
    t = timer();
    let siteSummary = null;
    const scrapeTokens = scrapeResult?.base?.text ?? scrapeResult?.base?.tokens ?? null;
    if (scrapeTokens) {
      try {
        siteSummary = await withRetries(
          () => summarizeSite({ url, tokens: scrapeTokens }),
          "Site summary",
          CONFIG.MAX_RETRIES
        );
        timing.site_summary_ms = t.elapsed();
        console.log("SITE: tone=" + (siteSummary?.tone ?? "?")
          + " services=" + (siteSummary?.services ?? []).length);
      } catch (e) {
        timing.site_summary_ms = t.elapsed();
        errors.site_summary = e.message;
      }
    } else {
      timing.site_summary_ms = 0;
    }

    // ── 8. Lead pack ──────────────────────────────────────
    t = timer();
    const leadPack = await buildLeadPack({
      lead:        callReport._originalLead,
      analysis,
      siteSummary,
    });
    timing.build_lead_pack_ms = t.elapsed();

    // ── 9. Intent signals + LIS ───────────────────────────
    t = timer();
    const intentSignals = computeIntentSignals({
      signalReport,
      analysis,
      siteSummary,
      callReport,
    });

    const lis = computeLeadIntelligenceScore({
      analysis,
      resolvedContacts,
      signalReport,
    });
    timing.sales_intel_ms = t.elapsed();
    console.log("LIS: " + lis.score + "/100 (" + lis.grade + ") — " + lis.interpretation);

    // ── 10. Enrich — 2 AI + 4 deterministic + sales intel ─
    t = timer();
    const enrichedPack = await withRetries(
      () => enrichLead({ leadPack, analysis, signalReport, resolvedContacts, lis }),
      "Enrichment",
      CONFIG.MAX_RETRIES
    );
    timing.enrichment_ms   = t.elapsed();
    timing.total_ms        = Date.now() - pipelineStart;
    console.log("ENRICH: done (" + timing.enrichment_ms + "ms)");

    // ── 11. Build master JSON ─────────────────────────────
    const factSheet = buildFactSheet(signalReport, analysis);

    const masterJson = {

      // ══════════════════════════════════════════════════
      // _META
      // ══════════════════════════════════════════════════
      _meta: {
        version:      PIPELINE_VERSION,
        status:       "success",
        basename,
        analyzed_at:  new Date(pipelineStart).toISOString(),
        completed_at: new Date().toISOString(),
        timing: {
          total_ms:                timing.total_ms,
          build_call_report_ms:    timing.build_call_report_ms,
          build_signal_report_ms:  timing.build_signal_report_ms,
          contact_resolution_ms:   timing.contact_resolution_ms,
          scrape_ms:               timing.scrape_ms ?? 0,
          ai_analysis_ms:          timing.ai_analysis_ms,
          site_summary_ms:         timing.site_summary_ms ?? 0,
          build_lead_pack_ms:      timing.build_lead_pack_ms,
          sales_intel_ms:          timing.sales_intel_ms,
          enrichment_ms:           timing.enrichment_ms,
        },
        ai_cost: {
          model:              "deepseek-chat",
          analysis_passes:    4,
          enrichment_calls:   2,
          total_api_calls:    6,
          estimated_usd:      0.003,
          note:               "~$0.003/lead at current DeepSeek pricing. Check dashboard for actuals.",
        },
        errors: Object.keys(errors).length ? errors : null,
      },

      // ══════════════════════════════════════════════════
      // LEAD — Google Places input (authoritative identity)
      // ══════════════════════════════════════════════════
      lead: {
        name:            callReport._originalLead.name            ?? null,
        phone:           callReport._originalLead.phone           ?? null,
        website_url:     callReport._originalLead.website_url     ?? null,
        address:         callReport._originalLead.address         ?? null,
        street:          callReport._originalLead.street          ?? null,
        city:            callReport._originalLead.city            ?? null,
        state:           callReport._originalLead.state           ?? null,
        postal_code:     callReport._originalLead.postal_code     ?? null,
        country:         callReport._originalLead.country         ?? null,
        place_id:        callReport._originalLead.place_id        ?? null,
        rating:          callReport._originalLead.rating          ?? null,
        review_count:    callReport._originalLead.user_ratings_total ?? null,
        maps_url:        callReport._originalLead.maps_url        ?? null,
        business_status: callReport._originalLead.business_status ?? null,
      },

      // ══════════════════════════════════════════════════
      // CONTACTS — resolved with full provenance
      // Google Places phone is ALWAYS primary (confidence 1.0)
      // ══════════════════════════════════════════════════
      contacts: {
        // Primary contact (use these in CRM / outreach tools)
        primary_phone:  resolvedContacts.phones.primary,
        primary_email:  resolvedContacts.emails.primary,

        // Phone resolution detail
        phones: resolvedContacts.phones,
        emails: resolvedContacts.emails,

        // Google Places signals (rating, reviews, maps)
        google: resolvedContacts.google,

        // Identity (name, address from Google Places)
        identity: resolvedContacts.identity,

        // Full audit trail
        _provenance: resolvedContacts._provenance,
      },

      // ══════════════════════════════════════════════════
      // TRIAGE — sales prioritisation
      // ══════════════════════════════════════════════════
      triage: {
        // Lead Intelligence Score (composite)
        lis: {
          score:           lis.score,
          grade:           lis.grade,
          interpretation:  lis.interpretation,
          components:      lis.components,
        },

        // Opportunity score (from AI synthesis)
        opportunity_score:   leadPack.score,
        priority:            leadPack.priority,
        priority_reason:     leadPack.priority_reason,
        priority_signals:    leadPack.priority_signals,
        call_policy:         leadPack.call_policy,
        estimated_budget:    leadPack.estimated_budget,

        // Intent signals (buying readiness)
        intent: {
          score:      intentSignals.intent_score,
          signals:    intentSignals.signals,
          breakdown:  intentSignals.score_breakdown,
        },

        // ROI model
        roi: {
          model:             "conservative_dental_baseline",
          monthly_visitors:  200,
          slow_bounce_rate:  0.53,
          fast_bounce_rate:  0.09,
          conversion_rate:   0.03,
          avg_patient_value: 350,
          fix_cost:          factSheet.fixCost,
          maintenance_month: factSheet.maintCost,
          monthly_lost_usd:  factSheet.monthlyLost,
          payback_months:    factSheet.payback,
          note: "Conservative Google CWV healthcare benchmark. Actuals vary.",
        },
      },

      // ══════════════════════════════════════════════════
      // SIGNAL — normalised technical facts
      // ══════════════════════════════════════════════════
      signal: {
        health: {
          score:       callReport.health_score ?? null,
          grade:       callReport.health_grade ?? null,
          temperature: callReport.lead_temperature?.label  ?? null,
          signals:     callReport.lead_temperature?.signals ?? [],
        },
        scores:   signalReport.scores,
        vitals:   signalReport.vitals,
        seo:      signalReport.seo,
        booking:  signalReport.booking,
        contact:  signalReport.contact,
        tracking: signalReport.tracking,
        tech:     signalReport.tech,
        status:   signalReport.status,
        problems: signalReport.problems,
      },

      // ══════════════════════════════════════════════════
      // SITE — scrape-derived content signals
      // ══════════════════════════════════════════════════
      site: {
        summary:          leadPack.site?.summary          ?? "",
        tone:             leadPack.site?.tone             ?? "unknown",
        services:         leadPack.site?.services         ?? [],
        has_booking:      leadPack.site?.has_booking      ?? false,
        has_testimonials: leadPack.site?.has_testimonials ?? false,
        notable:          leadPack.site?.notable          ?? null,
        languages:        leadPack.site?.languages        ?? [],
      },

      // ══════════════════════════════════════════════════
      // ANALYSIS — full AI output across all 4 passes
      // ══════════════════════════════════════════════════
      analysis: {
        score:                  analysis.score,
        priority:               analysis.priority,
        estimated_budget_range: analysis.estimated_budget_range,
        pre_score:              analysis.pre_score,
        pre_score_reasons:      analysis.pre_score_reasons,
        site_quality_summary:   analysis.site_quality_summary,
        the_one_problem:        analysis.the_one_problem,
        the_one_problem_cost:   analysis.the_one_problem_cost,
        the_fix:                analysis.the_fix,
        summary:                analysis.summary,
        pitch:                  analysis.pitch,
        email_subject_options:  analysis.email_subject_options,
        problems:               analysis.problems,
        quick_wins:             analysis.quick_wins,
        red_flags:              analysis.red_flags,
        passes: {
          speed: analysis._passes?.speed ?? null,
          seo:   analysis._passes?.seo   ?? null,
          conversion: analysis._passes?.conversion ?? null,
        },
      },

      // ══════════════════════════════════════════════════
      // ZOHO — 6 custom CRM fields, ready to import
      // ══════════════════════════════════════════════════
      zoho: {
        cold_email:     enrichedPack.enriched?.cold_email     ?? null,
        call_script:    enrichedPack.enriched?.call_script    ?? null,
        website_issues: enrichedPack.enriched?.website_issues ?? null,
        agent_briefing: enrichedPack.enriched?.agent_briefing ?? null,
        pitch:          enrichedPack.enriched?.pitch          ?? null,
        lead_recap:     enrichedPack.enriched?.lead_recap     ?? null,
      },

      // ══════════════════════════════════════════════════
      // SALES INTEL — zero AI cost, fully deterministic
      // ══════════════════════════════════════════════════
      sales_intel: {
        // Full multi-channel outreach plan (Day 0 → Day 21)
        outreach_sequence:  enrichedPack.sales_intel?.outreach_sequence  ?? [],

        // Pre-computed objection rebuttals
        objection_map:      enrichedPack.sales_intel?.objection_map      ?? [],

        // Subject line A/B matrix with trigger scoring
        subject_matrix:     enrichedPack.sales_intel?.subject_matrix     ?? {},

        // Google rating vs industry benchmark
        competitor_context: enrichedPack.sales_intel?.competitor_context ?? {},

        // Time-of-year pitch hook
        seasonal_angle:     enrichedPack.sales_intel?.seasonal_angle     ?? {},
      },

      // ══════════════════════════════════════════════════
      // _DEBUG — raw intermediates for investigation
      // ══════════════════════════════════════════════════
      _debug: {
        stage1: {
          status:          raw.item.status,
          processed_at:    raw.item.processed_at,
          pagespeed: {
            mobile:  raw.item.pagespeed?.mobile  ?? null,
            desktop: raw.item.pagespeed?.desktop ?? null,
          },
          signals:         raw.item.signals         ?? null,
          crux:            raw.item.crux            ?? null,
          stack:           raw.item.stack           ?? null,
          contact_summary: raw.item.contact_summary ?? null,
        },
        call_report_snapshot: {
          health_score:     callReport.health_score,
          health_grade:     callReport.health_grade,
          lead_temperature: callReport.lead_temperature,
          description:      callReport.description,
          scores:           callReport.scores,
        },
        scrape: scrapeResult ? {
          ok:          scrapeResult.ok,
          error:       scrapeResult.error ?? null,
          extra_pages: scrapeResult.extraPages?.length ?? 0,
          page_urls:   (scrapeResult.extraPages ?? []).map(p => p.url ?? p).filter(Boolean),
          has_tokens:  !!(scrapeResult.base?.text ?? scrapeResult.base?.tokens),
          vendors:     scrapeResult.base?.vendors      ?? null,
          headings_h1: scrapeResult.base?.headings?.h1 ?? [],
          headings_h2: scrapeResult.base?.headings?.h2 ?? [],
          forms_count: scrapeResult.base?.forms?.count ?? null,
          link_texts:  (scrapeResult.base?.uiText?.linkTexts ?? []).slice(0, 20),
        } : null,
        site_summary_raw: siteSummary ?? null,
        fact_sheet: {
          name:            factSheet.name,
          url:             factSheet.url,
          mPerf:           factSheet.mPerf,
          dPerf:           factSheet.dPerf,
          hasBooking:      factSheet.hasBooking,
          bookingVendor:   factSheet.bookingVendor,
          hasGA4:          factSheet.hasGA4,
          hasMeta:         factSheet.hasMeta,
          hasChatbot:      factSheet.hasChatbot,
          trackingPresent: factSheet.trackingPresent,
          trackingMissing: factSheet.trackingMissing,
          oneProblem:      factSheet.oneProblem,
          oneCost:         factSheet.oneCost,
          theFix:          factSheet.theFix,
          siteQuality:     factSheet.siteQuality,
          speedVerdict:    factSheet.speedVerdict,
          seoVerdict:      factSheet.seoVerdict,
          convVerdict:     factSheet.convVerdict,
          friction:        factSheet.friction,
          afterHours:      factSheet.afterHours,
          monthlyLost:     factSheet.monthlyLost,
          payback:         factSheet.payback,
        },
      },

    };

    // ── 12. Save ──────────────────────────────────────────
    fs.mkdirSync(CONFIG.FINAL_DIR,  { recursive: true });
    fs.mkdirSync(CONFIG.REPORT_DIR, { recursive: true });

    const jsonPath = path.join(CONFIG.FINAL_DIR,  basename + ".json");
    const csvPath  = path.join(CONFIG.REPORT_DIR, basename + ".csv");

    writeJson(jsonPath, masterJson);

    // CSV uses resolvedContacts for correct phone priority
    await leadPackToCsv(
      { ...enrichedPack, contacts: { primary_phone: resolvedContacts.phones.primary, primary_email: resolvedContacts.emails.primary } },
      csvPath
    );

    const kb = Math.round(JSON.stringify(masterJson).length / 1024);
    console.log("SAVED: " + jsonPath + " (" + kb + " KB)");
    console.log("CSV:   " + csvPath);
    console.log("TOTAL: " + timing.total_ms + "ms");
    return { status: "success" };

  } catch (err) {
    console.error("ERROR: " + (err?.message || err));
    fs.mkdirSync(CONFIG.FINAL_DIR, { recursive: true });
    writeJson(path.join(CONFIG.FINAL_DIR, basename + ".error.json"), {
      _meta: {
        version:   PIPELINE_VERSION,
        status:    "failed",
        error:     err?.message,
        stack:     err?.stack,
        failed_at: new Date().toISOString(),
        timing_ms: Date.now() - pipelineStart,
      },
      lead: { website_url: callReport?.website_url ?? null },
    });
    return { status: "failed" };

  } finally {
    await sleep(CONFIG.DELAY_MS);
  }
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────

async function main() {
  const force = process.argv.slice(2).some(a => a === "--force" || a === "-f");

  console.log("\n========================================");
  console.log("  STAGE 2: AI ANALYSIS  v" + PIPELINE_VERSION);
  console.log("========================================\n");

  if (force) console.log("MODE: --force (reprocessing all)\n");

  const files = findRawLeadFiles();
  if (!files.length) {
    console.log("ERROR: No JSON files in " + CONFIG.OUT_DIR + "/");
    console.log("       Run first: node src/index.js");
    process.exit(1);
  }

  console.log("FILES: " + files.length + "\n");

  let ok = 0, failed = 0, skipped = 0;
  for (const f of files) {
    const res = await processFile(f, { force });
    if      (res.status === "success") ok++;
    else if (res.status === "failed")  failed++;
    else                               skipped++;
  }

  console.log("\n========================================");
  console.log("  COMPLETE: " + ok + " ok  " + failed + " failed  " + skipped + " skipped");
  console.log("  JSON : " + CONFIG.FINAL_DIR + "/");
  console.log("  CSV  : " + CONFIG.REPORT_DIR + "/");
  console.log("========================================\n");
}

main().catch(e => {
  console.error("FATAL:", e?.message || e);
  process.exit(1);
});