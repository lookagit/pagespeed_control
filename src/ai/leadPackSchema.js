// ============================================================
// ai/leadPackSchema.js — Zoho lead pack validation
// ============================================================
import { z } from "zod";

export const LeadPackSchema = z.object({
  lead: z.record(z.any()),           // untouched original lead

  score:            z.number().min(0).max(100),
  priority:         z.enum(["hot", "warm", "cold"]),
  estimated_budget: z.string(),
  analyzed_at:      z.string(),

  analysis: z.object({
    summary:           z.string(),
    pitch:             z.string(),
    problems:          z.array(z.string()).min(1),
    quick_wins:        z.array(z.string()).min(1),
    red_flags:         z.array(z.string()),
    pre_score:         z.number(),
    pre_score_reasons: z.array(z.string()),
  }),

  site: z.object({
    summary:          z.string(),
    services:         z.array(z.string()),
    tone:             z.string(),
    has_booking:      z.boolean(),
    has_testimonials: z.boolean(),
  }),

  enriched: z.object({
    lead_recap:     z.string(),
    agent_briefing: z.string().nullable(),
    call_script:    z.string().nullable(),
    cold_email:     z.string().nullable(),
    website_issues: z.string().nullable(),
    pitch:          z.string().nullable(),
  }),
});