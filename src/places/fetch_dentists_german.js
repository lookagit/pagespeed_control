import fs from 'fs';
import path from 'path';
import 'dotenv/config';

// ============================================================
// CONFIGURATION LOADING
// ============================================================

function loadConfig() {
  // Determine config file path: from command line arg --config or env CONFIG_PATH, else default
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

  // Validate required fields
  const required = ['center', 'radius', 'keyword', 'placeType', 'targetCount'];
  for (const field of required) {
    if (!config[field]) throw new Error(`Missing required config field: ${field}`);
  }

  // Apply defaults for optional fields
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

/**
 * Validates API key by making test request
 */
async function validateApiKey() {
  const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
  url.searchParams.set('place_id', 'ChIJN1t_tDeuEmsRUsoyG83frY4');
  url.searchParams.set('key', API_KEY);

  const res = await fetch(url);
  const data = await res.json();
  
  if (data.status !== 'OK') {
    throw new Error(
      `❌ Invalid API key or Places API not enabled. Status: ${data.status}`
    );
  }
  
  console.log('✅ API key validated');
}

/**
 * Performs Nearby Search for a location
 */
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

/**
 * Fetches next page with exponential backoff and retry logic
 */
async function fetchNextPage(token, maxAttempts = 8) {
  let delay = CONFIG.delays.retryBase;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await sleep(delay);
    const page = await nearbySearch({ pagetoken: token });

    // Success cases
    if (page.status === 'OK' || page.status === 'ZERO_RESULTS') {
      return page;
    }

    // Token not ready - increase delay
    if (page.status === 'INVALID_REQUEST') {
      console.log(`   ⏳ Token not ready, attempt ${attempt}/${maxAttempts}`);
      delay = Math.min(delay * 1.5, 10000);
      continue;
    }

    // Quota exceeded - wait longer
    if (page.status === 'OVER_QUERY_LIMIT') {
      console.warn('   ⚠️  OVER_QUERY_LIMIT, waiting 5s...');
      await sleep(CONFIG.delays.overLimitBackoff);
      continue;
    }

    // Unexpected error
    throw new Error(
      `Unexpected pagination status: ${page.status} – ${page.error_message || ''}`
    );
  }

  console.warn('   ⚠️  Pagination failed after multiple attempts – skipping');
  return null;
}

/**
 * Fetches detailed information for a place
 */
async function fetchPlaceDetails(placeId) {
  const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
  url.searchParams.set('place_id', placeId);
  url.searchParams.set('language', 'de');
  url.searchParams.set('fields', [
    'place_id',
    'name',
    'formatted_address',
    'international_phone_number',
    'formatted_phone_number',
    'website',
    'url',
    'rating',
    'user_ratings_total',
    'business_status',
  ].join(','));
  url.searchParams.set('key', API_KEY);

  const response = await fetch(url);
  const data = await response.json();

  if (data.status !== 'OK') {
    throw new Error(`Details failed: ${data.status} – ${data.error_message || ''}`);
  }
  
  return data.result;
}

// ============================================================
// COLLECTION LOGIC
// ============================================================

/**
 * Processes single grid point and collects place IDs
 */
async function processGridPoint(point, uniqueIds) {
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

  // Add IDs from first page
  for (const place of firstPage.results || []) {
    if (place.place_id) uniqueIds.add(place.place_id);
  }
  
  console.log(
    `   ✅ Page 1: ${firstPage.results?.length || 0} places, total unique: ${uniqueIds.size}`
  );

  // Fetch second page if available
  if (firstPage.next_page_token && uniqueIds.size < CONFIG.targetCount) {
    const secondPage = await fetchNextPage(firstPage.next_page_token);
    
    if (secondPage && secondPage.status === 'OK') {
      for (const place of secondPage.results || []) {
        if (place.place_id) uniqueIds.add(place.place_id);
      }
      console.log(
        `   ✅ Page 2: ${secondPage.results?.length || 0} places, total unique: ${uniqueIds.size}`
      );
    }
  }
}

/**
 * Collects place IDs from all grid points
 */
async function collectPlaceIds() {
  const points = generateGridPoints(
    CONFIG.center,
    CONFIG.grid.steps,
    CONFIG.grid.latStep,
    CONFIG.grid.lngStep
  );
  
  console.log(`📍 Generated ${points.length} grid points`);

  const uniqueIds = new Set();

  for (let idx = 0; idx < points.length; idx++) {
    const point = points[idx];
    console.log(
      `\n🔍 Point ${idx + 1}/${points.length}: ` +
      `(${point.lat.toFixed(5)}, ${point.lng.toFixed(5)})`
    );

    await processGridPoint(point, uniqueIds);

    if (uniqueIds.size >= CONFIG.targetCount) {
      console.log(`\n🎯 Target count reached: ${uniqueIds.size}`);
      break;
    }

    await sleep(CONFIG.delays.betweenPoints);
  }

  console.log(`\n🎯 Total unique place_ids collected: ${uniqueIds.size}`);
  return Array.from(uniqueIds).slice(0, CONFIG.targetCount);
}

/**
 * Formats place details into output structure
 */
function formatPlaceDetails(details, placeId) {
  return {
    name: details.name || '',
    phone: details.international_phone_number || details.formatted_phone_number || '',
    website_url: details.website || '',
    address: details.formatted_address || '',
    place_id: details.place_id || placeId,
    rating: details.rating || '',
    user_ratings_total: details.user_ratings_total || '',
    maps_url: details.url || '',
    business_status: details.business_status || '',
  };
}

/**
 * Fetches details for all collected place IDs
 */
async function fetchAllDetails(placeIds) {
  console.log(`\n📦 Fetching details for ${placeIds.length} places...`);
  const results = [];

  for (let i = 0; i < placeIds.length; i++) {
    const id = placeIds[i];
    
    try {
      const details = await fetchPlaceDetails(id);
      results.push(formatPlaceDetails(details, id));

      if ((i + 1) % 10 === 0) {
        console.log(`   ...processed ${i + 1}/${placeIds.length}`);
      }
    } catch (error) {
      console.warn(`   ⚠️  Error for place_id ${id}: ${error.message}`);
    }

    await sleep(CONFIG.delays.betweenDetails);
  }

  return results;
}

/**
 * Saves results to JSON and CSV files (dynamic filenames)
 */
function saveResults(results) {
  // Build output filenames based on location name, type, and keyword
  const safeName = (str) => str.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const locationPart = safeName(CONFIG.locationName);
  const typePart = safeName(CONFIG.placeType);
  const keywordPart = safeName(CONFIG.keyword);

  const baseFilename = `places_${locationPart}_${typePart}_${keywordPart}`;
  const jsonPath = path.join('./out', `${baseFilename}.json`);
  const csvPath = path.join('./out', `${baseFilename}.csv`);

  const outputMeta = {
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

  writeJson(jsonPath, { ...outputMeta, results });
  writeCsv(csvPath, results);

  console.log('\n📁 Files saved:');
  console.log(`   - ${jsonPath}`);
  console.log(`   - ${csvPath}`);
  console.log(`✅ Done. Collected ${results.length} places.`);
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  console.log('🚀 Starting Google Places collection...\n');

  try {
    // 1. Validate API key
    await validateApiKey();

    // 2. Collect place IDs
    const placeIds = await collectPlaceIds();
    
    if (placeIds.length === 0) {
      throw new Error('No place_ids found');
    }

    // 3. Fetch details
    const results = await fetchAllDetails(placeIds);

    // 4. Save results
    saveResults(results);

  } catch (error) {
    console.error(`\n❌ Fatal error: ${error.message}`);
    throw error;
  }
}

// ============================================================
// RUN
// ============================================================
main().catch(error => {
  console.error(`\n❌ Unhandled error: ${error.message}`);
  process.exit(1);
});