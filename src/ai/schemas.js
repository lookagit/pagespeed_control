import { z } from "zod";

const Severity = z.enum(["low", "medium", "high"]);
const Confidence = z.number().min(0).max(1);

const Finding = z.object({
  title: z.string().min(1),
  severity: Severity,
  evidence: z.string().min(1),
  why_it_matters: z.string().min(1),
  fix_hint: z.string().min(1),
});

const Offer = z.object({
  name: z.string().min(1),
  for_who: z.string().min(1),
  outcome: z.string().min(1),
  included: z.array(z.string().min(1)).min(3).max(10),
  time_to_first_result_days: z.number().int().min(1).max(60).nullable(),
  price_hint_eur: z.string().min(1).nullable(),
});

export const ExecutiveSummarySchema = z.object({
  headline: z.string().min(1),
  key_message: z.array(z.string().min(1)).min(2).max(4),
  next_step: z.string().min(1),
});

export const PerformanceSchema = z.object({
  perf_score_mobile: z.number().int().min(0).max(100).nullable(),
  perf_score_desktop: z.number().int().min(0).max(100).nullable(),
  crux_p75_lcp_ms: z.number().nullable(),
  crux_p75_inp_ms: z.number().nullable(),
  crux_p75_cls: z.number().nullable(),
  findings: z.array(Finding).min(2).max(6),
  quick_wins: z.array(z.string().min(1)).min(3).max(7),
  confidence: Confidence,
});

export const TechSeoSchema = z.object({
  meta_ok: z.boolean(),
  issues: z.array(Finding).min(1).max(6),
  quick_wins: z.array(z.string().min(1)).min(2).max(6),
  confidence: Confidence,
});

export const ConversionSchema = z.object({
  booking_type: z.enum(["embed", "form", "phone", "unknown"]).nullable(),
  friction_points: z.array(z.string().min(1)).min(2).max(6),
  improvements: z.array(z.string().min(1)).min(3).max(8),
  confidence: Confidence,
});

export const TrackingSchema = z.object({
  has_ga4: z.boolean(),
  has_gtm: z.boolean(),
  has_meta_pixel: z.boolean(),
  has_google_ads_tag: z.boolean(),
  gaps: z.array(Finding).min(1).max(6),
  recommended_setup_steps: z.array(z.string().min(1)).min(3).max(10),
  confidence: Confidence,
});

export const AdsReadinessSchema = z.object({
  landing_ready: z.boolean(),
  blockers: z.array(z.string().min(1)).min(1).max(6),
  recommended_campaigns: z.array(z.string().min(1)).min(2).max(6),
  confidence: Confidence,
});

export const ChatAutomationSchema = z.object({
  has_chatbot: z.boolean(),
  vendor: z.string().nullable(),
  opportunities: z.array(z.string().min(1)).min(2).max(8),
  recommended_flows: z.array(z.string().min(1)).min(2).max(6),
  confidence: Confidence,
});

export const TrustSchema = z.object({
  trust_gaps: z.array(z.string().min(1)).min(2).max(8),
  improvements: z.array(z.string().min(1)).min(3).max(10),
  confidence: Confidence,
});

export const StackRiskSchema = z.object({
  detected_stack: z.array(z.string().min(1)).min(1).max(12),
  risks: z.array(Finding).min(1).max(6),
  opportunities: z.array(z.string().min(1)).min(2).max(8),
  confidence: Confidence,
});

export const OfferBuilderSchema = z.object({
  offers: z.array(Offer).min(2).max(4),
  call_script_hooks: z.array(z.string().min(1)).min(3).max(8),
  confidence: Confidence,
});

export const AnalysisPackSchema = z.object({
  executive_summary: ExecutiveSummarySchema,
  performance: PerformanceSchema,
  tech_seo: TechSeoSchema,
  conversion: ConversionSchema,
  tracking: TrackingSchema,
  ads_readiness: AdsReadinessSchema,
  chat_automation: ChatAutomationSchema,
  trust: TrustSchema,
  stack_risk: StackRiskSchema,
  offer_builder: OfferBuilderSchema,
});


export const Site10Schema = z.object({
  sentences: z.array(z.string()).length(10),

  modernity: z.object({
    verdict: z.enum(["modern", "outdated", "mixed", "unknown"]),
    confidence: z.number().min(0).max(1),
    reasons: z.array(z.string()).min(2).max(5),
  }),

  extracted: z.object({
    brand_name: z.string().nullable(),
    main_service_focus: z.string().nullable(),
    emails: z.array(z.string()),
    phones: z.array(z.string()),
    address: z.string().nullable(),
    booking_vendor: z.string().nullable(),
    chat_vendor: z.string().nullable(),
    legal_pages_hint: z.array(z.string()),
  }),
});

