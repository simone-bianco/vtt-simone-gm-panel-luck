/**
 * Pure probability model for dice karma (soft-threshold weighted distribution).
 * No Foundry dependencies. Injectable RNG for testability.
 *
 * Model: soft-threshold sigmoid weighting with configurable knee.
 *   - threshold (0.58): normalized position where the bias "knee" sits.
 *   - softness (0.18): width of the sigmoid transition (smaller = sharper).
 *   - ratio = 1 + 6 × strength^1.4: controls maximum weight spread.
 *     At luck=0 ratio=1 → uniform. At luck=±10 ratio=7 → ≈7× bias.
 *
 * Positive luck: faces above threshold get higher weights.
 * Negative luck: faces below threshold get higher weights.
 * Invalid faces → null. ±10 is NOT deterministic (soft knee applies at extremes).
 */

/** Model constants. */
const THRESHOLD = 0.58;
const SOFTNESS = 0.18;

/** Valid luck range. */
export const KARMA_LUCK_MIN = -10;
export const KARMA_LUCK_MAX = 10;

/* -------------------------------------------------------------------------- */
/*  Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Clamp and round raw luck value to the valid integer range.
 * @param {number} raw
 * @returns {number} integer in [KARMA_LUCK_MIN, KARMA_LUCK_MAX], or 0 for invalid
 */
export function normalizeLuck(raw) {
  if (!Number.isFinite(raw)) return 0;
  return Math.min(KARMA_LUCK_MAX, Math.max(KARMA_LUCK_MIN, Math.round(raw)));
}

/**
 * Whether a luck value should trigger biased dice generation.
 * @param {number} luck  already-normalized integer
 * @returns {boolean}
 */
export function shouldBias(luck) {
  return luck !== 0 && Number.isFinite(luck);
}

/**
 * Compute soft-threshold weights for each face (unnormalized).
 * Returns null for invalid faces. Returns uniform weights for luck=0.
 *
 * @param {number} faces  die size (e.g. 4, 6, 20). Must be integer ≥ 2.
 * @param {number} luck   normalized luck in [-10, 10]
 * @returns {number[]|null} weights array of length `faces`, or null
 */
export function getSoftThresholdWeights(faces, luck) {
  if (!Number.isInteger(faces) || faces < 2) return null;
  const n = faces;

  if (luck === 0) {
    return new Array(n).fill(1);
  }

  const strength = Math.abs(luck) / KARMA_LUCK_MAX;
  const ratio = 1 + 6 * Math.pow(strength, 1.4);
  const sign = luck > 0 ? 1 : -1;
  const weights = new Array(n);

  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);                       // normalized position [0, 1]
    const z = (t - THRESHOLD) / SOFTNESS;         // sigmoid input
    const sigmoid = 1 / (1 + Math.exp(-z));       // logistic [0, 1]

    if (sign > 0) {
      weights[i] = 1 + (ratio - 1) * sigmoid;    // high faces → high weight
    } else {
      weights[i] = 1 + (ratio - 1) * (1 - sigmoid); // low faces → high weight
    }
  }

  return weights;
}

/**
 * Compute normalized face probabilities (sum to 1).
 * @param {number} faces  die size
 * @param {number} luck   normalized luck in [-10, 10]
 * @returns {number[]|null} probability array of length `faces`, or null
 */
export function getFaceProbabilities(faces, luck) {
  const weights = getSoftThresholdWeights(faces, luck);
  if (!weights) return null;

  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return new Array(weights.length).fill(1 / weights.length);

  return weights.map((w) => w / total);
}

/**
 * Roll a single biased die face using inverse CDF sampling.
 * Returns null for invalid faces (caller must handle).
 * For luck=0, falls through to uniform random (avoids unnecessary computation).
 *
 * @param {number} faces  die size (e.g. 4, 6, 20). Must be integer ≥ 2.
 * @param {number} luck   normalized luck value in [-10, 10]
 * @param {function(): number} [rng]  uniform random [0,1). Defaults to Math.random.
 * @returns {number|null} integer in [1, faces], or null for invalid faces
 */
export function rollBiasedFace(faces, luck, rng = Math.random) {
  if (!Number.isInteger(faces) || faces < 2) return null;

  const n = normalizeLuck(luck);

  // No bias → uniform random (skip weight computation for performance)
  if (!shouldBias(n)) {
    return Math.floor(rng() * faces) + 1;
  }

  const probs = getFaceProbabilities(faces, n);
  if (!probs) return null;

  // Inverse CDF sampling
  const u = rng();
  let cumulative = 0;
  for (let i = 0; i < probs.length; i++) {
    cumulative += probs[i];
    if (u < cumulative) return i + 1;
  }

  // Floating-point edge case: return last face
  return faces;
}

/**
 * Summarize a probability distribution with descriptive statistics.
 * @param {number[]} probs  probability array (must sum to 1)
 * @returns {{ faces: number, mean: number, variance: number, stdDev: number, pMin: number, pMax: number, ratio: number }|null}
 */
export function summarizeDistribution(probs) {
  if (!Array.isArray(probs) || probs.length < 2) return null;
  const n = probs.length;

  // Mean
  let mean = 0;
  for (let i = 0; i < n; i++) {
    mean += (i + 1) * probs[i];
  }

  // Variance
  let variance = 0;
  for (let i = 0; i < n; i++) {
    const diff = (i + 1) - mean;
    variance += diff * diff * probs[i];
  }

  const pMin = probs[0];
  const pMax = probs[n - 1];

  return {
    faces: n,
    mean,
    variance,
    stdDev: Math.sqrt(variance),
    pMin,
    pMax,
    ratio: pMax / Math.max(pMin, 1 / n),
  };
}
