import crypto from "crypto";

// ============================================================
// CONSTANTS & CONFIGURATION
// ============================================================

/**
 * Configuration for filename sanitization
 * @const {Object}
 */
const SANITIZATION_CONFIG = {
  DEFAULT_MAX_LENGTH: 80,
  HASH_ALGORITHM: "sha256",
  HASH_LENGTH: 8,
  FALLBACK_NAME: "file",
  REPLACEMENT_CHAR: "-",
};

/**
 * Character patterns for sanitization
 * @const {Object}
 */
const PATTERNS = {
  // Windows-unsafe characters per Microsoft filesystem spec
  UNSAFE_CHARS: /[/\\?%*:|"<>]/g,
  
  // Whitespace normalization
  WHITESPACE: /\s+/g,
  
  // Non-alphanumeric characters (preserve hyphens and underscores)
  NON_ALPHANUMERIC: /[^a-z0-9\-_]+/g,
  
  // Multiple consecutive hyphens
  MULTIPLE_HYPHENS: /-+/g,
  
  // Leading or trailing hyphens
  EDGE_HYPHENS: /^-+|-+$/g,
  
  // WWW prefix
  WWW_PREFIX: /^www\./i,
  
  // Trailing slashes
  TRAILING_SLASHES: /\/+$/,
};

// ============================================================
// URL PARSING
// ============================================================

/**
 * Safely extracts meaningful path from URL
 * Returns null if input is not a valid URL
 * 
 * @private
 * @param {string} input - Potential URL string
 * @returns {string|null} Extracted path or null
 * 
 * @example
 * extractUrlPath('https://example.com/path/to/file')
 * // Returns: 'example.com/path/to/file'
 */
function extractUrlPath(input) {
  try {
    const url = new URL(input);
    const cleanPath = url.pathname.replace(PATTERNS.TRAILING_SLASHES, "");
    return url.host + cleanPath;
  } catch {
    return null;
  }
}

// ============================================================
// STRING NORMALIZATION
// ============================================================

/**
 * Removes www. prefix from domain names
 * 
 * @private
 * @param {string} text - Text to normalize
 * @returns {string} Text without www prefix
 */
function removeWwwPrefix(text) {
  return text.replace(PATTERNS.WWW_PREFIX, "");
}

/**
 * Replaces unsafe filesystem characters with safe alternatives
 * Based on Windows filesystem restrictions (most restrictive)
 * 
 * @private
 * @param {string} text - Text to sanitize
 * @param {string} replacement - Replacement character
 * @returns {string} Sanitized text
 */
function replaceUnsafeCharacters(text, replacement) {
  return text
    .replace(PATTERNS.UNSAFE_CHARS, replacement)
    .replace(PATTERNS.WHITESPACE, replacement);
}

/**
 * Removes all non-alphanumeric characters except hyphens and underscores
 * 
 * @private
 * @param {string} text - Text to filter
 * @param {string} replacement - Replacement character
 * @returns {string} Filtered text
 */
function filterToAlphanumeric(text, replacement) {
  return text.replace(PATTERNS.NON_ALPHANUMERIC, replacement);
}

/**
 * Normalizes hyphens by removing duplicates and edge cases
 * 
 * @private
 * @param {string} text - Text to normalize
 * @returns {string} Normalized text
 */
function normalizeHyphens(text) {
  return text
    .replace(PATTERNS.MULTIPLE_HYPHENS, "-")
    .replace(PATTERNS.EDGE_HYPHENS, "");
}

/**
 * Truncates text to specified maximum length, ensuring no trailing hyphens
 * 
 * @private
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum allowed length
 * @returns {string} Truncated text
 */
function truncateToLength(text, maxLength) {
  if (text.length <= maxLength) {
    return text;
  }
  
  return text
    .slice(0, maxLength)
    .replace(PATTERNS.EDGE_HYPHENS, "");
}

// ============================================================
// HASH GENERATION
// ============================================================

/**
 * Generates deterministic hash from input for uniqueness guarantee
 * Uses cryptographic hash to ensure collision resistance
 * 
 * @private
 * @param {string} input - Input to hash
 * @param {string} algorithm - Hash algorithm (default: sha256)
 * @param {number} length - Output hash length (default: 8)
 * @returns {string} Truncated hexadecimal hash
 * 
 * @example
 * generateDeterministicHash('https://example.com')
 * // Returns: 'a3f5b2c1'
 */
function generateDeterministicHash(
  input,
  algorithm = SANITIZATION_CONFIG.HASH_ALGORITHM,
  length = SANITIZATION_CONFIG.HASH_LENGTH
) {
  return crypto
    .createHash(algorithm)
    .update(input, "utf8")
    .digest("hex")
    .slice(0, length);
}

// ============================================================
// MAIN SANITIZATION PIPELINE
// ============================================================

/**
 * Sanitizes input string into valid, filesystem-safe filename
 * 
 * Pipeline stages:
 * 1. URL parsing and path extraction (if applicable)
 * 2. Case normalization
 * 3. Domain prefix removal
 * 4. Unsafe character replacement
 * 5. Alphanumeric filtering
 * 6. Hyphen normalization
 * 7. Fallback handling for empty results
 * 8. Length truncation
 * 9. Uniqueness hash suffix
 * 
 * The function guarantees:
 * - Cross-platform filesystem compatibility (Windows, Linux, macOS)
 * - Deterministic output for same input
 * - Collision resistance via cryptographic hash
 * - No reserved filesystem names
 * - Human-readable base with uniqueness guarantee
 * 
 * @param {string} input - Raw input string (URL or arbitrary text)
 * @param {Object} options - Configuration options
 * @param {number} [options.maxLen=80] - Maximum filename length (excluding hash)
 * @returns {string} Sanitized filename with format: {base}-{hash}
 * 
 * @example
 * // URL input
 * sanitizeFileName('https://www.example.com/path/to/resource')
 * // Returns: 'example-com-path-to-resource-a3f5b2c1'
 * 
 * @example
 * // Arbitrary text input
 * sanitizeFileName('My Document (2024).pdf', { maxLen: 50 })
 * // Returns: 'my-document-2024-pdf-7b3e9a2f'
 * 
 * @example
 * // Edge case: empty input
 * sanitizeFileName('')
 * // Returns: 'file-e3b0c442'
 */
export function sanitizeFileName(input, options = {}) {
  const config = {
    maxLen: options.maxLen ?? SANITIZATION_CONFIG.DEFAULT_MAX_LENGTH,
  };

  // Input validation and normalization
  const rawInput = String(input ?? "").trim();
  
  if (!rawInput) {
    const hash = generateDeterministicHash(rawInput);
    return `${SANITIZATION_CONFIG.FALLBACK_NAME}-${hash}`;
  }

  // Stage 1: URL path extraction (if applicable)
  const urlPath = extractUrlPath(rawInput);
  let base = urlPath ?? rawInput;

  // Stage 2: Case normalization for consistency
  base = base.toLowerCase();

  // Stage 3: Domain prefix removal
  base = removeWwwPrefix(base);

  // Stage 4-5: Character sanitization
  base = replaceUnsafeCharacters(base, SANITIZATION_CONFIG.REPLACEMENT_CHAR);
  base = filterToAlphanumeric(base, SANITIZATION_CONFIG.REPLACEMENT_CHAR);

  // Stage 6: Hyphen normalization
  base = normalizeHyphens(base);

  // Stage 7: Fallback for empty result
  if (!base) {
    base = SANITIZATION_CONFIG.FALLBACK_NAME;
  }

  // Stage 8: Length truncation
  base = truncateToLength(base, config.maxLen);

  // Stage 9: Uniqueness guarantee via hash suffix
  const hash = generateDeterministicHash(rawInput);

  return `${base}-${hash}`;
}

// ============================================================
// UTILITY EXPORTS (for testing and extension)
// ============================================================

/**
 * Export internal utilities for testing and extension
 * @namespace SanitizationUtils
 */
export const SanitizationUtils = {
  extractUrlPath,
  generateDeterministicHash,
  removeWwwPrefix,
  replaceUnsafeCharacters,
  filterToAlphanumeric,
  normalizeHyphens,
  truncateToLength,
  PATTERNS,
  CONFIG: SANITIZATION_CONFIG,
};