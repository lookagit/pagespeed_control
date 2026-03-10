import fs from 'fs';
import path from 'path';
import 'dotenv/config';

// ============================================================
// CONFIGURATION LOADING
// ============================================================

function loadConfig() {
  let configPath = process.env.CONFIG_PATH || './config.json';
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--config' && args[i + 1]) {
      configPath = args[i + 1];
      break;
    }
  }

  if (!fs.existsSync(configPath)) {
    throw new Error(`❌ Config file not found: ${configPath}`);
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  const required = ['center', 'radius', 'keyword', 'placeType', 'targetCount'];
  for (const field of required) {
    if (!config[field]) throw new Error(`Missing required config field: ${field}`);
  }

  config.grid = config.grid || { steps: 3, latStep: 0.011, lngStep: 0.014 };
  config.delays = config.delays || {
    betweenPoints: 3000,
    betweenDetails: 180,
    retryBase: 2200,
    overLimitBackoff: 5000,
  };
  config.locationName = config.locationName || `${config.center.lat}_${config.center.lng}`;

  return config;
}

const CONFIG = loadConfig();
const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
if (!API_KEY) throw new Error('❌ Missing GOOGLE_MAPS_API_KEY in .env');

// ============================================================
// UTILITIES
// ============================================================
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeJson(filePath, obj) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf8');
}

function writeCsv(filePath, rows) {
  ensureDir(filePath);
  const csv = toCsv(rows);
  fs.writeFileSync(filePath, csv, 'utf8');
}

function toCsv(rows) {
  const header = [
    'name',
    'phone',
    'website_url',
    'address',
    'place_id',
    'rating',
    'user_ratings_total',
    'maps_url',
    'business_status',
  ];

  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [header.map(escape).join(',')];

  for (const row of rows) {
    lines.push(header.map(key => escape(row[key])).join(','));
  }

  return lines.join('\n');
}

// ============================================================
// GRID GENERATION
// ============================================================
function generateGridPoints(center, steps, latStep, lngStep) {
  const points = [];
  for (let i = -steps; i <= steps; i++) {
    for (let j = -steps; j <= steps; j++) {
      points.push({
        lat: center.lat + i * latStep,
        lng: center.lng + j * lngStep,
      });
    }
  }
  return points;
}

// ============================================================
// GOOGLE PLACES API
// ============================================================

async function validateApiKey() {
  const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
  url.searchParams.set('place_id', 'ChIJN1t_tDeuEmsRUsoyG83frY4');
  url.searchParams.set('key', API_KEY);

  const res = await fetch(url);
  const data = await res.json();

  if (data.status !== 'OK') {
    throw new Error(`❌ Invalid API key or Places API not enabled. Status: ${data.status}`);
  }

  console.log('✅ API key validated');
}

async function nearbySearch(params) {
  const url = new URL('https://maps.googleapis.com/maps/api/place/nearbysearch/json');

  if (params.pagetoken) {
    url.searchParams.set('pagetoken', params.pagetoken);
  } else {
    url.searchParams.set('location', `${params.location.lat},${params.location.lng}`);
    url.searchParams.set('radius', String(params.radius));
    url.searchParams.set('type', params.type);
    url.searchParams.set('keyword', params.keyword);
    url.searchParams.set('language', 'de');
  }

  url.searchParams.set('key', API_KEY);

  const response = await fetch(url);
  return await response.json();
}

async function fetchNextPage(token, maxAttempts = 8) {
  let delay = CONFIG.delays.retryBase;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await sleep(delay);
    const page = await nearbySearch({ pagetoken: token });

    if (page.status === 'OK' || page.status === 'ZERO_RESULTS') return page;

    if (page.status === 'INVALID_REQUEST') {
      console.log(`   ⏳ Token not ready, attempt ${attempt}/${maxAttempts}`);
      delay = Math.min(delay * 1.5, 10000);
      continue;
    }

    if (page.status === 'OVER_QUERY_LIMIT') {
      console.warn('   ⚠️  OVER_QUERY_LIMIT, waiting...');
      await sleep(CONFIG.delays.overLimitBackoff);
      continue;
    }

    throw new Error(`Unexpected pagination status: ${page.status} – ${page.error_message || ''}`);
  }

  console.warn('   ⚠️  Pagination failed after multiple attempts – skipping');
  return null;
}

// ============================================================
// PHASE 1 – FREE: Collect basic data from NearbySearch results
// (name, address, rating, user_ratings_total, business_status
//  are all returned for FREE in the NearbySearch response)
// ============================================================

/**
 * Extracts free fields from a NearbySearch result item.
 * These do NOT count as a "Place Details" billable call.
 */
function extractFreeData(place) {
  return {
    place_id: place.place_id || '',
    name: place.name || '',
    address: place.vicinity || '',           // short address, free in nearbySearch
    rating: place.rating ?? '',
    user_ratings_total: place.user_ratings_total ?? '',
    business_status: place.business_status || '',
    // Fields NOT available in nearbySearch – will be filled in Phase 2:
    phone: '',
    website_url: '',
    maps_url: '',
  };
}

/**
 * Processes a single grid point and accumulates free place data.
 * Returns a Map<place_id, freeDataObject> to avoid duplicates.
 */
async function processGridPoint(point, placeMap) {
  const firstPage = await nearbySearch({
    location: point,
    radius: CONFIG.radius,
    type: CONFIG.placeType,
    keyword: CONFIG.keyword,
  });

  if (firstPage.status !== 'OK' && firstPage.status !== 'ZERO_RESULTS') {
    console.warn(`   ⚠️  NearbySearch returned ${firstPage.status} – skipping point`);
    return;
  }

  let newCount = 0;
  for (const place of firstPage.results || []) {
    if (place.place_id && !placeMap.has(place.place_id)) {
      placeMap.set(place.place_id, extractFreeData(place));
      newCount++;
    }
  }

  console.log(`   ✅ Page 1: +${newCount} new | total unique: ${placeMap.size}`);

  // Second page
  if (firstPage.next_page_token && placeMap.size < CONFIG.targetCount) {
    const secondPage = await fetchNextPage(firstPage.next_page_token);

    if (secondPage && secondPage.status === 'OK') {
      let newCount2 = 0;
      for (const place of secondPage.results || []) {
        if (place.place_id && !placeMap.has(place.place_id)) {
          placeMap.set(place.place_id, extractFreeData(place));
          newCount2++;
        }
      }
      console.log(`   ✅ Page 2: +${newCount2} new | total unique: ${placeMap.size}`);
    }
  }
}

/**
 * Phase 1: Sweep all grid points, collect free data for up to targetCount places.
 * Cost: NearbySearch is billed per request (not per result), so this is already
 * the cheapest way to gather bulk data. NO Details calls here.
 */
async function phase1_collectFreeData() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📍 PHASE 1 — Free data via NearbySearch');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const points = generateGridPoints(
    CONFIG.center,
    CONFIG.grid.steps,
    CONFIG.grid.latStep,
    CONFIG.grid.lngStep
  );

  console.log(`📐 Generated ${points.length} grid points`);

  // Map keeps insertion order and guarantees uniqueness by place_id
  const placeMap = new Map();

  for (let idx = 0; idx < points.length; idx++) {
    const point = points[idx];
    console.log(
      `\n🔍 Point ${idx + 1}/${points.length}: ` +
      `(${point.lat.toFixed(5)}, ${point.lng.toFixed(5)})`
    );

    await processGridPoint(point, placeMap);

    if (placeMap.size >= CONFIG.targetCount) {
      console.log(`\n🎯 Target count reached: ${placeMap.size}`);
      break;
    }

    await sleep(CONFIG.delays.betweenPoints);
  }

  // Trim to targetCount
  const allEntries = Array.from(placeMap.entries()).slice(0, CONFIG.targetCount);
  const trimmedMap = new Map(allEntries);

  console.log(`\n✅ Phase 1 complete. Unique places collected: ${trimmedMap.size}`);
  return trimmedMap;
}

// ============================================================
// PHASE 2 – PAID: Enrich with Place Details (phone, website, maps_url)
// Called ONCE per place_id, ONLY at the end.
// Fields: international_phone_number, website, url
// ============================================================

/**
 * Fetches only the billable fields we can't get from NearbySearch.
 * Uses minimal `fields` param to reduce cost tier where possible.
 */
async function fetchPaidDetails(placeId) {
  const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
  url.searchParams.set('place_id', placeId);
  url.searchParams.set('language', 'de');
  // Only request fields NOT available in NearbySearch to minimize cost:
  url.searchParams.set('fields', [
    'international_phone_number',
    'formatted_phone_number',
    'website',
    'url',
  ].join(','));
  url.searchParams.set('key', API_KEY);

  const response = await fetch(url);
  const data = await response.json();

  if (data.status !== 'OK') {
    throw new Error(`Details failed: ${data.status} – ${data.error_message || ''}`);
  }

  return data.result;
}

/**
 * Phase 2: For each place collected in Phase 1, call Details API ONCE
 * to get phone + website + maps_url. Merges into existing free data.
 */
async function phase2_enrichWithPaidDetails(placeMap) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`💳 PHASE 2 — Paid Details for ${placeMap.size} places`);
  console.log('   (1 API call per place, fields: phone + website + maps_url)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const placeIds = Array.from(placeMap.keys());
  let enriched = 0;
  let failed = 0;

  for (let i = 0; i < placeIds.length; i++) {
    const placeId = placeIds[i];
    const record = placeMap.get(placeId);

    try {
      const details = await fetchPaidDetails(placeId);

      // Merge paid fields into existing free record
      record.phone = details.international_phone_number
        || details.formatted_phone_number
        || '';
      record.website_url = details.website || '';
      record.maps_url = details.url || '';

      enriched++;
    } catch (error) {
      console.warn(`   ⚠️  Skipped ${placeId}: ${error.message}`);
      failed++;
    }

    if ((i + 1) % 10 === 0) {
      console.log(`   ...enriched ${i + 1}/${placeIds.length} (${failed} failed)`);
    }

    await sleep(CONFIG.delays.betweenDetails);
  }

  console.log(`\n✅ Phase 2 complete. Enriched: ${enriched} | Failed: ${failed}`);
  return Array.from(placeMap.values());
}

// ============================================================
// OUTPUT
// ============================================================

function saveResults(results) {
  const safeName = (str) => str.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const baseFilename = `places_${safeName(CONFIG.locationName)}_${safeName(CONFIG.placeType)}_${safeName(CONFIG.keyword)}`;
  const jsonPath = path.join('./out', `${baseFilename}.json`);
  const csvPath = path.join('./out', `${baseFilename}.csv`);

  const meta = {
    timestamp: new Date().toISOString(),
    config: {
      center: CONFIG.center,
      radius: CONFIG.radius,
      keyword: CONFIG.keyword,
      type: CONFIG.placeType,
      targetCount: CONFIG.targetCount,
      gridSteps: CONFIG.grid.steps,
    },
    count: results.length,
  };

  writeJson(jsonPath, { ...meta, results });
  writeCsv(csvPath, results);

  console.log('\n📁 Files saved:');
  console.log(`   - ${jsonPath}`);
  console.log(`   - ${csvPath}`);
  console.log(`\n✅ Done. Total places: ${results.length}`);
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  console.log('🚀 Starting Google Places collection (2-phase, cost-optimized)\n');
  console.log(`📋 Config: "${CONFIG.locationName}" | keyword: "${CONFIG.keyword}" | target: ${CONFIG.targetCount}`);

  try {
    await validateApiKey();

    // PHASE 1: Free – NearbySearch sweep, no Details calls
    const placeMap = await phase1_collectFreeData();

    if (placeMap.size === 0) {
      throw new Error('No places found in Phase 1');
    }

    // PHASE 2: Paid – ONE Details call per place, only at the end
    const results = await phase2_enrichWithPaidDetails(placeMap);

    saveResults(results);

  } catch (error) {
    console.error(`\n❌ Fatal error: ${error.message}`);
    throw error;
  }
}

main().catch(error => {
  console.error(`\n❌ Unhandled error: ${error.message}`);
  process.exit(1);
});
