// ============================================================
// utils/helpers.js - Utility funkcije
// ============================================================

/**
 * Čeka određeno vreme (ms)
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Pokušava da izvrši async funkciju do maxRetries puta.
 * Između pokušaja čeka RETRY_DELAY_MS.
 *
 * @param {Function} fn        - Async funkcija za pokretanje
 * @param {string}   label     - Ime operacije (za logovanje)
 * @param {number}   maxRetries
 */
export async function withRetries(fn, label, maxRetries = 2) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 1) console.log(`   🔁 Pokušaj ${attempt}/${maxRetries}: ${label}`);
      return await fn();
    } catch (err) {
      lastError = err;
      console.log(`   ⚠️  ${label} neuspešan (${attempt}/${maxRetries}): ${err?.message}`);
      if (attempt < maxRetries) await sleep(3000);
    }
  }

  throw lastError;
}
