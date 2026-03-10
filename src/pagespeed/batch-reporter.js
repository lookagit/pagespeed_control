/**
 * pagespeed-reporter.js  (ES Module)
 * ─────────────────────────────────────────────────────────────────────────────
 * Parsira audit JSON i generiše jedan call-report JSON.
 * Sadrži isključivo sirove, izmerene podatke – bez preporuka i analiza.
 * Preporuke i analiza se rade naknadno kroz AI API.
 *
 * Usage:
 *   import * as r from './pagespeed-reporter.js';
 *   const callReport = r.buildCallReport(auditJson);
 *
 * CLI:
 *   node pagespeed-reporter.js <audit.json>
 *   node pagespeed-reporter.js <audit.json> --dir=./out
 *   node pagespeed-reporter.js <audit.json> --print
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1 – PRAGOVI I OCENJIVANJE
// Samo klasifikacija izmerenih vrednosti: good | warn | poor | unknown
// ═══════════════════════════════════════════════════════════════════════════════

export const THRESHOLDS = {
  fcp:          { good: 1800,      warn: 3000,      unit: 'ms',    label: 'First Contentful Paint',      direction: 'lower'  },
  lcp:          { good: 2500,      warn: 4000,      unit: 'ms',    label: 'Largest Contentful Paint',    direction: 'lower'  },
  tbt:          { good: 200,       warn: 600,       unit: 'ms',    label: 'Total Blocking Time',         direction: 'lower'  },
  cls:          { good: 0.1,       warn: 0.25,      unit: '',      label: 'Cumulative Layout Shift',     direction: 'lower'  },
  tti:          { good: 3800,      warn: 7300,      unit: 'ms',    label: 'Time to Interactive',         direction: 'lower'  },
  speedIndex:   { good: 3400,      warn: 5800,      unit: 'ms',    label: 'Speed Index',                 direction: 'lower'  },
  serverResp:   { good: 600,       warn: 1500,      unit: 'ms',    label: 'Server Response Time (TTFB)', direction: 'lower'  },
  performance:  { good: 90, warn: 50, unit: '/100', label: 'Performance Score',    direction: 'higher' },
  seo:          { good: 90, warn: 70, unit: '/100', label: 'SEO Score',            direction: 'higher' },
  accessibility:{ good: 90, warn: 70, unit: '/100', label: 'Accessibility Score',  direction: 'higher' },
  bestPractices:{ good: 90, warn: 70, unit: '/100', label: 'Best Practices Score', direction: 'higher' },
  pageWeight:   { good: 500_000,   warn: 1_500_000, unit: 'bytes', label: 'Ukupna velicina stranice',    direction: 'lower'  },
  requests:     { good: 20,        warn: 50,        unit: '',      label: 'Broj HTTP zahteva',           direction: 'lower'  },
  scripts:      { good: 5,         warn: 15,        unit: '',      label: 'Broj skripti',                direction: 'lower'  },
};

/** Klasifikuje izmerenu vrednost: 'good' | 'warn' | 'poor' | 'unknown' */
export function rate(value, key) {
  if (value == null || value === '') return 'unknown';
  const t = THRESHOLDS[key];
  if (!t) return 'unknown';
  if (t.direction === 'lower') {
    if (value <= t.good) return 'good';
    if (value <= t.warn) return 'warn';
    return 'poor';
  } else {
    if (value >= t.good) return 'good';
    if (value >= t.warn) return 'warn';
    return 'poor';
  }
}

export const rateMetric = rate;

export function letterGrade(score) {
  if (score == null) return '?';
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 50) return 'D';
  return 'F';
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2 – FORMAT HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

export function fmtMs(ms) {
  if (ms == null) return 'N/A';
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;
}

export function fmtBytes(bytes) {
  if (bytes == null) return 'N/A';
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(2)} MB`;
  if (bytes >= 1_000)     return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} B`;
}

function fmtCLS(val) {
  return val != null ? val.toFixed(3) : 'N/A';
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3 – PAGESPEED PARSER
// Vraća izmerene vrednosti i Lighthouse skoreve. Bez preporuka.
// ═══════════════════════════════════════════════════════════════════════════════

export function parsePagespeed(ps, strategy) {
  if (!ps) return null;

  const lab  = ps.lab        || {};
  const cats = ps.categories || {};
  const res  = ps.resources  || {};

  const vitals = [
    { key: 'fcp',        raw: lab.fcp_ms,                  fmt: fmtMs,  threshKey: 'fcp'        },
    { key: 'lcp',        raw: lab.lcp_ms,                  fmt: fmtMs,  threshKey: 'lcp'        },
    { key: 'tbt',        raw: lab.tbt_ms,                  fmt: fmtMs,  threshKey: 'tbt'        },
    { key: 'cls',        raw: lab.cls,                     fmt: fmtCLS, threshKey: 'cls'        },
    { key: 'tti',        raw: lab.tti_ms,                  fmt: fmtMs,  threshKey: 'tti'        },
    { key: 'speedIndex', raw: lab.speed_index,             fmt: fmtMs,  threshKey: 'speedIndex' },
    { key: 'serverResp', raw: lab.server_response_time_ms, fmt: fmtMs,  threshKey: 'serverResp' },
  ].map(v => ({
    key:     v.key,
    label:   THRESHOLDS[v.threshKey]?.label ?? v.key,
    raw:     v.raw,
    display: v.fmt(v.raw),
    status:  rate(v.raw, v.threshKey),   // good | warn | poor – samo klasifikacija
  }));

  const scores = [
    { key: 'performance',   raw: cats.performance,    threshKey: 'performance'   },
    { key: 'seo',           raw: cats.seo,            threshKey: 'seo'           },
    { key: 'accessibility', raw: cats.accessibility,  threshKey: 'accessibility' },
    { key: 'bestPractices', raw: cats.best_practices, threshKey: 'bestPractices' },
  ].map(s => ({
    key:     s.key,
    label:   THRESHOLDS[s.threshKey]?.label ?? s.key,
    raw:     s.raw,
    display: s.raw != null ? `${s.raw}/100` : 'N/A',
    grade:   letterGrade(s.raw),
    status:  rate(s.raw, s.threshKey),
  }));

  const resources = {
    pageWeight: {
      raw:     res.total_byte_weight,
      display: fmtBytes(res.total_byte_weight),
      status:  rate(res.total_byte_weight, 'pageWeight'),
    },
    requests: {
      raw:     res.request_count,
      display: res.request_count != null ? `${res.request_count}` : 'N/A',
      status:  rate(res.request_count, 'requests'),
    },
    scripts: {
      raw:     res.script_count,
      display: res.script_count != null ? `${res.script_count}` : 'N/A',
      status:  rate(res.script_count, 'scripts'),
    },
  };

  return {
    strategy,
    finalUrl:      ps.final_url      ?? null,
    fetchedAt:     ps.fetched_at     ?? null,
    overallScore:  cats.performance  ?? null,
    overallStatus: rate(cats.performance ?? null, 'performance'),
    vitals,
    scores,
    resources,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4 – SEO PARSER
// Čisti ekstrakt SEO signala – samo prisutno/odsutno i izmerene vrednosti.
// ═══════════════════════════════════════════════════════════════════════════════

export function parseSEO(signals) {
  if (!signals?.seo) return null;

  const seo = signals.seo;
  const ca  = seo.content_analysis  || {};
  const ph  = seo.performance_hints || {};
  const og  = seo.open_graph        || {};
  const tc  = seo.twitter_card      || {};
  const sec = seo.security          || {};
  const sd  = seo.structured_data   || [];

  return {
    // Osnovni meta tagovi
    has_title:            !!seo.title,
    title:                seo.title              ?? null,
    has_meta_description: !!seo.meta_description,
    has_canonical:        !!seo.canonical,
    canonical:            seo.canonical          ?? null,

    // Social
    has_open_graph:   !!og.og_title,
    has_twitter_card: !!tc.twitter_card,

    // Sadrzaj
    h1_count:           ca.h1_count           ?? null,
    h1_text:            ca.h1_text            ?? null,
    word_count:         ca.word_count         ?? null,
    image_count:        ca.image_count        ?? null,
    images_without_alt: ca.images_without_alt ?? null,

    // Structured data
    has_structured_data:  sd.length > 0,
    structured_data_type: sd[0]?.['@type']    ?? null,

    // Tehnicke karakteristike
    has_https_forms:   !!sec.has_https_forms,
    has_lazy_loading:  !!ph.has_lazy_loading,
    has_async_scripts: !!(ph.has_async_scripts || ph.has_defer_scripts),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5 – TRACKING PARSER
// Samo boolean detekcija instaliranih alata.
// ═══════════════════════════════════════════════════════════════════════════════

export function parseTracking(signals) {
  if (!signals) return null;

  const t = signals.tracking || {};
  const c = signals.chatbot  || {};

  const chatbotVendor = c.vendor ?? null;
  // Ako vendor postoji, chatbot sigurno postoji – bez obzira na has_chatbot flag
  const hasChatbot = !!(c.has_chatbot || chatbotVendor);

  return {
    has_ga4:        t.ga4         ?? false,
    has_gtm:        t.gtm         ?? false,
    has_meta_pixel: t.meta_pixel  ?? false,
    has_google_ads: t.google_ads  ?? false,
    has_chatbot:    hasChatbot,
    chatbot_vendor: chatbotVendor,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6 – BOOKING & KONTAKT PARSER
// Telefoni, emailovi, tip zakazivanja i CTA dugmad – samo šta postoji.
// ═══════════════════════════════════════════════════════════════════════════════

export function parseBooking(signals) {
  if (!signals) return null;

  const b        = signals.booking || {};
  const c        = signals.contact || {};
  const ctaLinks = c.cta_links     || [];

  // Poznati booking/scheduling vendori koji se mogu pojaviti u type ili vendor polju.
  // Ako je type == ime vendora → scraper nije imao posebno vendor polje, ali booking postoji.
  const KNOWN_VENDORS = [
    'calendly', 'acuity', 'setmore', 'solutionreach', 'solution reach',
    'mindbody', 'jane', 'janeapp', 'booker', 'vagaro', 'square appointments',
    'zocdoc', 'doctolib', 'healthgrades', 'patientpop', 'lighthouse 360',
    'lighthouse360', 'simplifeye', 'weave', 'nexhealth', 'nexhealth',
    'opendental', 'eaglesoft', 'dentrix', 'curve dental', 'carestack',
    'appointy', 'booksy', 'fresha', 'timely', 'cliniko', 'aesthetic record',
    'podium', 'birdeye', 'demandforce', 'thryv', 'servicetitan',
  ];

  const BOOKING_KEYWORDS = [
    'online', 'calendar', 'appointment', 'booking', 'schedule',
    'book', 'reserve', 'zakazivanje',
  ];

  const rawType   = (b.type   ?? 'unknown').toLowerCase().trim();
  const rawVendor = (b.vendor ?? '').toLowerCase().trim();

  // Detektuj vendor – iz dedicated vendor polja ILI iz type polja ako je vendor ime
  const detectedVendor =
    (b.vendor && b.vendor.trim()) ||
    (KNOWN_VENDORS.some(v => rawType.includes(v)) ? b.type : null) ||
    null;

  // Normalizovani booking type za prikaz
  const bookingType = b.type ?? 'unknown';

  const hasOnlineBook = !!(
    detectedVendor ||
    KNOWN_VENDORS.some(v => rawType.includes(v)) ||
    BOOKING_KEYWORDS.some(kw => rawType.includes(kw)) ||
    ctaLinks.some(link =>
      (link.text && BOOKING_KEYWORDS.some(kw => link.text.toLowerCase().includes(kw))) ||
      (link.href && ['book', 'schedule', 'appointment'].some(kw => link.href.includes(kw)))
    )
  );

  // CTA dugmad – deduplikovana, max 5
  const ctaRaw = b.cta || {};
  const ctaAll = [
    ...(ctaRaw.found && ctaRaw.text
      ? [{ text: ctaRaw.text, href: ctaRaw.href ?? null, above_fold: ctaRaw.above_fold ?? false }]
      : []),
    ...ctaLinks.map(l => ({ text: l.text ?? null, href: l.href ?? null, above_fold: false })),
  ];
  const ctaSeen = new Set();
  const ctas = ctaAll.filter(c => {
    const key = `${c.text}|${c.href}`;
    if (ctaSeen.has(key)) return false;
    ctaSeen.add(key);
    return true;
  }).slice(0, 5);

  // Ako booking postoji ali CTA nije eksplicitno detektovan kroz cta_links,
  // dodajemo sintetički CTA – booking vendor/forma je dokaz da CTA postoji na stranici.
  const finalCtas = ctas.length > 0
    ? ctas
    : (hasOnlineBook
        ? [{ text: detectedVendor ?? 'Online booking', href: null, above_fold: false, inferred: true }]
        : []);

  return {
    booking_type:       bookingType,
    booking_vendor:     detectedVendor,
    has_online_booking: hasOnlineBook,
    phones:             (c.phones ?? []).slice(0, 3),
    emails:             (c.emails ?? []).slice(0, 3),
    ctas:               finalCtas,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7 – TECH STACK PARSER
// ═══════════════════════════════════════════════════════════════════════════════

export function parseTechStack(item) {
  const stack = item.stack || {};
  return (stack.technologies || [])
    .map(t => ({
      name:       t.name,
      category:   t.category,
      confidence: Math.round((t.confidence ?? 0) * 100),
    }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 8);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 8 – FULL REPORT (interni agregator)
// ═══════════════════════════════════════════════════════════════════════════════

export function generateFullReport(auditJson) {
  const item    = auditJson.item ?? auditJson;
  const lead    = item.lead      || {};
  const ps      = item.pagespeed || {};
  const signals = item.signals   || {};

  const mobile  = parsePagespeed(ps.mobile,  'mobile');
  const desktop = parsePagespeed(ps.desktop, 'desktop');

  // Health score = prosek (mobile perf + desktop perf + mobile SEO)
  const scoreValues = [
    mobile?.overallScore,
    desktop?.overallScore,
    ps.mobile?.categories?.seo,
  ].filter(v => v != null);
  const healthScore = scoreValues.length
    ? Math.round(scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length)
    : null;

  return {
    meta: {
      name:         lead.name         ?? null,
      url:          lead.website_url  ?? null,
      address:      lead.address      ?? null,
      processed_at: item.processed_at ?? null,
      health_score: healthScore,
      health_grade: letterGrade(healthScore),
    },
    mobile,
    desktop,
    seo:      parseSEO(signals),
    tracking: parseTracking(signals),
    booking:  parseBooking(signals),
    tech:     parseTechStack(item),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 9 – BUILD CALL REPORT
// ─────────────────────────────────────────────────────────────────────────────
// Jedini javni output. Sadrži sve izmerene podatke i `description` polje
// kao čist plain text za CSV / CRM Description kolonu.
//
// description redosled (sve su činjenice, nema preporuka):
//   1. Header  – naziv, URL, datum, health ocena
//   2. Kontakt – telefoni, emailovi, zakazivanje, CTA
//   3. SEO     – meta tagovi, sadrzaj, tehnicke karakt.
//   4. Tracking – GA4, GTM, Meta Pixel, Google Ads, chatbot
//   5. Brzina  – Lighthouse scorevi + Core Web Vitals (mobile)
// ═══════════════════════════════════════════════════════════════════════════════

export function buildCallReport(auditJson) {
  const item = auditJson.item ?? auditJson;
  const r    = generateFullReport(auditJson);

  const { seo, tracking, booking, mobile, desktop, tech } = r;

  // ── Score shorthandovi ────────────────────────────────────────────────────
  const sc = (strategy, key) =>
    r[strategy]?.scores.find(s => s.key === key)?.raw ?? null;

  const mPerf = mobile?.overallScore  ?? null;
  const dPerf = desktop?.overallScore ?? null;
  const mSEO  = sc('mobile',  'seo');
  const dSEO  = sc('desktop', 'seo');
  const mAcc  = sc('mobile',  'accessibility');
  const mBP   = sc('mobile',  'bestPractices');
  const dAcc  = sc('desktop', 'accessibility');
  const dBP   = sc('desktop', 'bestPractices');

  // ── Vitals helper ─────────────────────────────────────────────────────────
  const vit = (strategy, key) => {
    const v = r[strategy]?.vitals.find(v => v.key === key);
    return v ? { value: v.display, status: v.status } : null;
  };

  // ── Resources helper ──────────────────────────────────────────────────────
  const res = (strategy, key) => {
    const v = r[strategy]?.resources[key];
    return v ? { value: v.display, status: v.status } : null;
  };

  // ─────────────────────────────────────────────────────────────────────────
  // description – plain text za CSV / CRM
  // ─────────────────────────────────────────────────────────────────────────
  const L  = (label, value) => `  ${(label + ':').padEnd(22)} ${value}`;
  const HR = (title)        => `\n--- ${title} ---`;
  const YN = (bool)         => bool ? 'DA' : 'NE';
  const IC = (status)       => ({ good: '✅', warn: '⚠', poor: '❌', unknown: '?' }[status] ?? '?');

  const lines = [];

  // 1. Header ─────────────────────────────────────────────────────────────────
  lines.push(`=== ${r.meta.name ?? 'N/A'} ===`);
  lines.push(L('URL',    r.meta.url          ?? 'N/A'));
  lines.push(L('Datum',  r.meta.processed_at ? new Date(r.meta.processed_at).toLocaleDateString('sr') : 'N/A'));
  lines.push(L('Health', `${r.meta.health_score ?? 'N/A'}/100 (${r.meta.health_grade})`));

  // 2. Kontakt ────────────────────────────────────────────────────────────────
  lines.push(HR('KONTAKT'));

  if (booking?.phones.length > 0)
    booking.phones.forEach((p, i) => lines.push(L(`Tel ${i + 1}`, p)));
  else
    lines.push(L('Tel', 'nije detektovan'));

  if (booking?.emails.length > 0)
    booking.emails.forEach((e, i) => lines.push(L(`Email ${i + 1}`, e)));
  else
    lines.push(L('Email', 'nije detektovan'));

  const bookingVendorStr = booking?.booking_vendor ? ` via ${booking.booking_vendor}` : '';
  lines.push(L('Online zakazivanje',
    booking ? `${YN(booking.has_online_booking)} (tip: ${booking.booking_type}${bookingVendorStr})` : 'N/A'
  ));

  if (booking?.ctas.length > 0) {
    const ctaTexts = booking.ctas
      .filter(c => c.text)
      .map(c => `"${c.text}"${c.above_fold ? ' [above fold]' : ''}`)
      .join(', ');
    if (ctaTexts) lines.push(L('CTA dugmad', ctaTexts));
  }

  // 3. SEO ────────────────────────────────────────────────────────────────────
  lines.push(HR('SEO'));
  if (seo) {
    lines.push(L('Title tag',          `${YN(seo.has_title)}${seo.title ? `: "${seo.title}"` : ''}`));
    lines.push(L('Meta description',   YN(seo.has_meta_description)));
    lines.push(L('Canonical URL',      YN(seo.has_canonical)));
    lines.push(L('Open Graph',         YN(seo.has_open_graph)));
    lines.push(L('Twitter Card',       YN(seo.has_twitter_card)));
    lines.push(L('H1 tagovi',          seo.h1_count != null ? `${seo.h1_count}${seo.h1_text ? ` ("${seo.h1_text}")` : ''}` : 'N/A'));
    lines.push(L('Broj reci',          seo.word_count         != null ? `${seo.word_count}` : 'N/A'));
    lines.push(L('Slike / bez alt',    seo.image_count        != null ? `${seo.image_count} / ${seo.images_without_alt ?? '?'} bez alt` : 'N/A'));
    lines.push(L('Schema.org',         `${YN(seo.has_structured_data)}${seo.structured_data_type ? ` (${seo.structured_data_type})` : ''}`));
    lines.push(L('HTTPS forme',        YN(seo.has_https_forms)));
    lines.push(L('Lazy loading',       YN(seo.has_lazy_loading)));
    lines.push(L('Async/defer skripte', YN(seo.has_async_scripts)));
  } else {
    lines.push('  N/A');
  }

  // 4. Tracking ───────────────────────────────────────────────────────────────
  lines.push(HR('TRACKING'));
  if (tracking) {
    lines.push(`  ${IC(tracking.has_ga4        ? 'good' : 'poor')} GA4`);
    lines.push(`  ${IC(tracking.has_gtm        ? 'good' : 'warn')} GTM`);
    lines.push(`  ${IC(tracking.has_meta_pixel ? 'good' : 'warn')} Meta Pixel`);
    lines.push(`  ${IC(tracking.has_google_ads ? 'good' : 'warn')} Google Ads`);
    const chatbotStr = tracking.chatbot_vendor ? ` (${tracking.chatbot_vendor})` : (tracking.has_chatbot ? ' (vendor nepoznat)' : '');
    lines.push(`  ${IC(tracking.has_chatbot    ? 'good' : 'warn')} Chatbot${chatbotStr}`);
  } else {
    lines.push('  N/A');
  }

  // 5. Lighthouse scorevi ─────────────────────────────────────────────────────
  lines.push(HR('LIGHTHOUSE SCOREVI'));
  lines.push(L('  Mobile perf',    mPerf != null ? `${mPerf}/100 (${letterGrade(mPerf)})` : 'N/A'));
  lines.push(L('  Mobile SEO',     mSEO  != null ? `${mSEO}/100`  : 'N/A'));
  lines.push(L('  Mobile acc',     mAcc  != null ? `${mAcc}/100`  : 'N/A'));
  lines.push(L('  Mobile BP',      mBP   != null ? `${mBP}/100`   : 'N/A'));
  lines.push(L('  Desktop perf',   dPerf != null ? `${dPerf}/100 (${letterGrade(dPerf)})` : 'N/A'));
  lines.push(L('  Desktop SEO',    dSEO  != null ? `${dSEO}/100`  : 'N/A'));
  lines.push(L('  Desktop acc',    dAcc  != null ? `${dAcc}/100`  : 'N/A'));
  lines.push(L('  Desktop BP',     dBP   != null ? `${dBP}/100`   : 'N/A'));

  // 6. Core Web Vitals (mobile) ───────────────────────────────────────────────
  lines.push(HR('CORE WEB VITALS – MOBILE'));
  [
    ['LCP',  vit('mobile', 'lcp')],
    ['FCP',  vit('mobile', 'fcp')],
    ['TBT',  vit('mobile', 'tbt')],
    ['CLS',  vit('mobile', 'cls')],
    ['TTFB', vit('mobile', 'serverResp')],
    ['TTI',  vit('mobile', 'tti')],
    ['SI',   vit('mobile', 'speedIndex')],
  ].filter(([, v]) => v).forEach(([k, v]) =>
    lines.push(`  ${IC(v.status)} ${k.padEnd(6)} ${v.value}`)
  );

  // 7. Resursi (mobile) ───────────────────────────────────────────────────────
  lines.push(HR('RESURSI – MOBILE'));
  const rPageW = res('mobile', 'pageWeight');
  const rReq   = res('mobile', 'requests');
  const rScr   = res('mobile', 'scripts');
  if (rPageW) lines.push(`  ${IC(rPageW.status)} Velicina        ${rPageW.value}`);
  if (rReq)   lines.push(`  ${IC(rReq.status)}   HTTP zahtevi   ${rReq.value}`);
  if (rScr)   lines.push(`  ${IC(rScr.status)}   Skripte        ${rScr.value}`);

  const description = lines.join('\n');

  // ═══════════════════════════════════════════════════════════════════════════
  // JSON output – isti logički redosled kao description
  // ═══════════════════════════════════════════════════════════════════════════
  const report = {

    // ── 1. Identifikacija ─────────────────────────────────────────────────
    name:         r.meta.name         ?? null,
    website_url:  r.meta.url          ?? null,
    address:      r.meta.address      ?? null,
    processed_at: r.meta.processed_at ?? null,
    health_score: r.meta.health_score ?? null,
    health_grade: r.meta.health_grade ?? null,

    // ── 2. Kontakt ────────────────────────────────────────────────────────
    phones:             booking?.phones             ?? [],
    emails:             booking?.emails             ?? [],
    has_online_booking: booking?.has_online_booking ?? false,
    booking_type:       booking?.booking_type       ?? 'unknown',
    booking_vendor:     booking?.booking_vendor     ?? null,
    ctas:               booking?.ctas               ?? [],

    // ── 3. SEO ────────────────────────────────────────────────────────────
    seo: seo ? {
      has_title:            seo.has_title,
      title:                seo.title,
      has_meta_description: seo.has_meta_description,
      has_canonical:        seo.has_canonical,
      has_open_graph:       seo.has_open_graph,
      has_twitter_card:     seo.has_twitter_card,
      h1_count:             seo.h1_count,
      h1_text:              seo.h1_text,
      word_count:           seo.word_count,
      image_count:          seo.image_count,
      images_without_alt:   seo.images_without_alt,
      has_structured_data:  seo.has_structured_data,
      structured_data_type: seo.structured_data_type,
      has_https_forms:      seo.has_https_forms,
      has_lazy_loading:     seo.has_lazy_loading,
      has_async_scripts:    seo.has_async_scripts,
    } : null,

    // ── 4. Tracking ───────────────────────────────────────────────────────
    tracking: tracking ? {
      has_ga4:        tracking.has_ga4,
      has_gtm:        tracking.has_gtm,
      has_meta_pixel: tracking.has_meta_pixel,
      has_google_ads: tracking.has_google_ads,
      has_chatbot:    tracking.has_chatbot,
      chatbot_vendor: tracking.chatbot_vendor,
    } : null,

    // ── 5. Lighthouse scorevi ─────────────────────────────────────────────
    scores: {
      mobile_perf:  mPerf, mobile_seo:  mSEO, mobile_acc:  mAcc, mobile_bp:  mBP,
      desktop_perf: dPerf, desktop_seo: dSEO, desktop_acc: dAcc, desktop_bp: dBP,
    },

    // ── 6. Core Web Vitals (mobile) ───────────────────────────────────────
    vitals_mobile: {
      lcp:  vit('mobile', 'lcp'),
      fcp:  vit('mobile', 'fcp'),
      tbt:  vit('mobile', 'tbt'),
      cls:  vit('mobile', 'cls'),
      ttfb: vit('mobile', 'serverResp'),
      tti:  vit('mobile', 'tti'),
      si:   vit('mobile', 'speedIndex'),
    },

    // ── 7. Resursi (mobile) ───────────────────────────────────────────────
    resources_mobile: {
      page_weight: res('mobile', 'pageWeight'),
      requests:    res('mobile', 'requests'),
      scripts:     res('mobile', 'scripts'),
    },

    // ── 8. Tech stack (top 8 po pouzdanosti) ─────────────────────────────
    tech_stack: tech.map(t => ({ name: t.name, category: t.category, confidence: t.confidence })),

    // ── CRM / CSV description polje ───────────────────────────────────────
    description,
  };

  // Lead temperatura
  report.lead_temperature = scoreLeadTemperature(report);

  return report;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 10 – FILE HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

export function slugifyName(name) {
  if (!name) return 'unknown';
  return (name.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20) || 'unknown');
}

export function dateSuffix(dateStr) {
  const d = dateStr ? new Date(dateStr) : new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

export function buildOutputPath(auditJson, baseDir = './out/pagespeedReports') {
  const item  = auditJson.item ?? auditJson;
  const slug  = slugifyName(item.lead?.name ?? '');
  const stamp = dateSuffix(item.processed_at ?? null);
  return path.join(baseDir, `${slug}${stamp}-call-report.json`);
}

export function writeReport(filePath, content) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

/**
 * Kompatibilnost sa starim caller skriptima koji pozivaju saveAllReports.
 * Sada generiše samo jedan call-report JSON umesto 4 fajla.
 */
export function saveAllReports(auditJson, baseDir = './out/pagespeedReports') {
  const report   = buildCallReport(auditJson);
  const filePath = buildOutputPath(auditJson, baseDir);
  writeReport(filePath, JSON.stringify(report, null, 2));
  return [filePath];
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 10b – LEAD TEMPERATURE SCORING
// ─────────────────────────────────────────────────────────────────────────────
// Klasifikuje lead kao hot | warm | cold na osnovu izmerenih podataka.
// Svaki signal nosi težinu – ukupan skor određuje temperaturu.
//
// HOT  (score >= 7) – Puno problema, laka prodaja
// WARM (score 4–6)  – Ima prostora za poboljšanje
// COLD (score <= 3) – Sajt je relativno dobro sređen
// ═══════════════════════════════════════════════════════════════════════════════

export function scoreLeadTemperature(callReport) {
  const c = callReport;
  const s = c.scores      || {};
  const t = c.tracking    || {};
  const v = c.vitals_mobile || {};
  const b = c.booking_type;

  let score  = 0;
  const hits = [];   // signali koji su doprineli score-u

  // ── Performance ───────────────────────────────────────────────────────────
  if (s.mobile_perf != null) {
    if (s.mobile_perf < 30)      { score += 3; hits.push(`Mobile perf kritičan: ${s.mobile_perf}/100`); }
    else if (s.mobile_perf < 50) { score += 2; hits.push(`Mobile perf loš: ${s.mobile_perf}/100`); }
    else if (s.mobile_perf < 70) { score += 1; hits.push(`Mobile perf slab: ${s.mobile_perf}/100`); }
  }
  if (s.desktop_perf != null && s.desktop_perf < 50) {
    score += 1; hits.push(`Desktop perf loš: ${s.desktop_perf}/100`);
  }

  // ── Core Web Vitals – broji poor signale ─────────────────────────────────
  const poorVitals = Object.entries(v)
    .filter(([, val]) => val?.status === 'poor')
    .map(([k]) => k.toUpperCase());
  if (poorVitals.length >= 4)      { score += 2; hits.push(`${poorVitals.length} Core Web Vitals loši (${poorVitals.join(', ')})`); }
  else if (poorVitals.length >= 2) { score += 1; hits.push(`${poorVitals.length} Core Web Vitals loši (${poorVitals.join(', ')})`); }

  // ── Tracking ─────────────────────────────────────────────────────────────
  if (!t.has_ga4)        { score += 2; hits.push('Nema GA4 – slepi na posete'); }
  if (!t.has_meta_pixel) { score += 1; hits.push('Nema Meta Pixel'); }
  if (!t.has_gtm)        { score += 1; hits.push('Nema GTM'); }
  if (!t.has_chatbot)    { score += 1; hits.push('Nema chatbot / live chat'); }

  // ── Kontakt & Booking ─────────────────────────────────────────────────────
  // booking_vendor je direktan dokaz – ne penalizujemo ako vendor postoji
  if (!c.has_online_booking && !c.booking_vendor) { score += 1; hits.push('Nema online zakazivanje'); }
  if ((c.phones ?? []).length === 0){ score += 2; hits.push('Telefon nije detektovan na sajtu'); }
  if ((c.emails ?? []).length === 0){ score += 1; hits.push('Email nije detektovan na sajtu'); }
  // Nema CTA penalizacije ako booking postoji – vendor forma je CTA
  const hasAnyCta = (c.ctas ?? []).length > 0;
  const ctaInferred = (c.ctas ?? []).some(x => x.inferred);
  if (!hasAnyCta)              { score += 1; hits.push('Nema CTA dugme'); }
  else if (ctaInferred)        { hits.push(`CTA inferisan iz booking sistema (${c.booking_vendor ?? c.booking_type})`); }

  // ── SEO ───────────────────────────────────────────────────────────────────
  if (c.seo === null)              { score += 2; hits.push('SEO podaci nisu dostupni / prazni'); }
  else {
    if (!c.seo.has_title)            { score += 1; hits.push('Nema title tag'); }
    if (!c.seo.has_meta_description) { score += 1; hits.push('Nema meta description'); }
    if (!c.seo.has_structured_data)  { score += 1; hits.push('Nema Schema.org markup'); }
  }
  if (s.mobile_seo != null && s.mobile_seo < 70) {
    score += 1; hits.push(`SEO score nizak: ${s.mobile_seo}/100`);
  }

  // ── Temperatura ───────────────────────────────────────────────────────────
  let temperature, label;
  if      (score >= 8) { temperature = 'hot';  label = '🔥 HOT';  }
  else if (score >= 5) { temperature = 'warm'; label = '🌤 WARM'; }
  else                 { temperature = 'cold'; label = '❄️ COLD'; }

  return {
    temperature,
    label,
    score,
    max_score: 22,
    signals: hits,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 10c – AI PROMPT BUILDER
// ─────────────────────────────────────────────────────────────────────────────
// Gradi kompaktan tekst koji se direktno šalje AI API-ju.
// Sadrži sve relevantne podatke + temperaturu leada.
// AI treba da vrati: prodajni pristup, ključne argumente i pitanja za call.
// ═══════════════════════════════════════════════════════════════════════════════

export function buildAIPrompt(callReport) {
  const temp = scoreLeadTemperature(callReport);
  const c    = callReport;
  const s    = c.scores       || {};
  const t    = c.tracking     || {};
  const v    = c.vitals_mobile || {};
  const seo  = c.seo;

  const YN  = (bool) => bool ? 'DA' : 'NE';
  const L   = (label, val) => `  ${label}: ${val}`;

  const lines = [];

  lines.push(`Ti si ekspert za digitalni marketing i web performanse. Analiziraš dental/medicinsku praksu.`);
  lines.push(`Pripremi smernice za prodajni poziv (cold call / outreach).`);
  lines.push(``);
  lines.push(`## KLIJENT`);
  lines.push(L('Naziv',       c.name         ?? 'N/A'));
  lines.push(L('Sajt',        c.website_url  ?? 'N/A'));
  lines.push(L('Adresa',      c.address      ?? 'N/A'));
  lines.push(L('Lead temp.',  `${temp.label} (score: ${temp.score}/${temp.max_score})`));
  lines.push(``);

  lines.push(`## KONTAKT`);
  lines.push(L('Telefoni',   c.phones.length > 0 ? c.phones.join(', ') : 'NIJE DETEKTOVAN'));
  lines.push(L('Emailovi',   c.emails.length > 0 ? c.emails.join(', ') : 'NIJE DETEKTOVAN'));
  lines.push(L('Online booking', `${YN(c.has_online_booking)} (${c.booking_type})`));
  lines.push(L('CTA dugmad', c.ctas.filter(x => x.text).map(x => `"${x.text}"`).join(', ') || 'NEMA'));
  lines.push(``);

  lines.push(`## SLABE TAČKE (razlozi za kontakt)`);
  temp.signals.forEach((sig, i) => lines.push(`  ${i + 1}. ${sig}`));
  lines.push(``);

  lines.push(`## PERFORMANCE`);
  lines.push(L('Health score',   `${c.health_score ?? 'N/A'}/100 (${c.health_grade})`));
  lines.push(L('Mobile perf',    s.mobile_perf  != null ? `${s.mobile_perf}/100`  : 'N/A'));
  lines.push(L('Desktop perf',   s.desktop_perf != null ? `${s.desktop_perf}/100` : 'N/A'));
  lines.push(L('Mobile SEO',     s.mobile_seo   != null ? `${s.mobile_seo}/100`   : 'N/A'));
  lines.push(L('Accessibility',  s.mobile_acc   != null ? `${s.mobile_acc}/100`   : 'N/A'));

  const poorV = Object.entries(v)
    .filter(([, val]) => val?.status === 'poor')
    .map(([k, val]) => `${k.toUpperCase()} ${val.value}`);
  if (poorV.length > 0)
    lines.push(L('Loši vitali',  poorV.join(', ')));
  lines.push(``);

  lines.push(`## TRACKING`);
  lines.push(`  GA4: ${YN(t.has_ga4)}  |  GTM: ${YN(t.has_gtm)}  |  Meta Pixel: ${YN(t.has_meta_pixel)}  |  Google Ads: ${YN(t.has_google_ads)}  |  Chatbot: ${YN(t.has_chatbot)}`);
  lines.push(``);

  if (seo) {
    lines.push(`## SEO`);
    lines.push(`  Title: ${YN(seo.has_title)}  |  Meta desc: ${YN(seo.has_meta_description)}  |  H1: ${seo.h1_count ?? '?'}  |  Reci: ${seo.word_count ?? '?'}  |  Schema: ${YN(seo.has_structured_data)}`);
    lines.push(``);
  }

  if (c.tech_stack?.length > 0) {
    lines.push(`## TECH STACK`);
    lines.push(`  ${c.tech_stack.map(t => `${t.name} (${t.category})`).join(', ')}`);
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(`Na osnovu gornjih podataka, pripremi:`);
  lines.push(`1. **Prodajni pristup** – kako otvoriti razgovor s obzirom na temperaturu leada (${temp.label})`);
  lines.push(`2. **3-5 ključnih argumenata** – konkretni problemi na ovom sajtu koje možemo rešiti`);
  lines.push(`3. **2-3 pitanja za call** – kojima otkrivamo prioritete i bolne tačke klijenta`);
  lines.push(`4. **Šta ponuditi** – koje usluge/pakete predložiti (web optimizacija, tracking setup, booking sistem, chatbot, itd.)`);
  lines.push(`Odgovor daj na srpskom jeziku. Budi konkretan i prilagođen ovom klijentu.`);

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 11 – CLI
// ═══════════════════════════════════════════════════════════════════════════════

const isMain = process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  const args    = process.argv.slice(2);
  const baseDir = args.find(a => a.startsWith('--dir='))?.split('=')[1] ?? './out/pagespeedReports';
  const doPrint = args.includes('--print');
  const inFile  = args.find(a => !a.startsWith('--'));

  if (!inFile) {
    console.error([
      '',
      'Upotreba:',
      '  node pagespeed-reporter.js <audit.json>',
      '  node pagespeed-reporter.js <audit.json> --dir=./out',
      '  node pagespeed-reporter.js <audit.json> --print',
      '',
    ].join('\n'));
    process.exit(1);
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(path.resolve(inFile), 'utf8'));
  } catch (e) {
    console.error(`Greska pri citanju "${inFile}": ${e.message}`);
    process.exit(1);
  }

  const report = buildCallReport(raw);
  const output = JSON.stringify(report, null, 2);

  if (doPrint) {
    console.log(output);
  } else {
    const filePath = buildOutputPath(raw, baseDir);
    writeReport(filePath, output);
    console.log(`\nSacuvano: ${filePath}\n`);
  }
}