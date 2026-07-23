import { getFaceProbabilities, summarizeDistribution } from "../luck/gm-panel-luck-dice.js";

/**
 * Build a view-model from the raw luckControl state, adding signed display
 * labels for UI rendering plus distribution summary when debug is enabled.
 *
 * @param {object} state - Raw luckControl state (already normalized)
 * @param {object} [opts]
 * @param {boolean} [opts.includeDistributions] - Compute probability distributions (costly, debug-gated)
 * @returns {object} View model with `allies` / `enemies` carrying display fields
 */
export function buildLuckControlViewModel(state, opts = {}) {
  const vm = structuredClone(state);
  for (const faction of ["allies", "enemies"]) {
    const f = vm[faction];
    if (!f) continue;
    f.attackLuckLabel = formatSigned(f.attackLuck);
    f.damageLuckLabel = formatSigned(f.damageLuck);
    f.abilityLuckLabel = formatSigned(f.abilityLuck);
    f.modeLabel = formatOutcomeMode(f.d20OutcomeMode);

    if (opts.includeDistributions) {
      const attackLuck = f.attackLuck ?? 0;
      const abilityLuck = f.abilityLuck ?? 0;
      if (attackLuck !== 0) {
        const attackProbs = getFaceProbabilities(20, attackLuck);
        if (attackProbs) f.attackDistribution = summarizeDistribution(attackProbs);
      }
      if (abilityLuck !== 0) {
        const abilityProbs = getFaceProbabilities(20, abilityLuck);
        if (abilityProbs) f.abilityDistribution = summarizeDistribution(abilityProbs);
      }
    }
  }
  return vm;
}

/**
 * Format a number as a signed string, e.g. +3, -2, 0.
 * @param {number} value
 * @returns {string}
 */
export function formatSigned(value) {
  if (value > 0) return `+${value}`;
  if (value < 0) return String(value);
  return "0";
}

/**
 * Format d20OutcomeMode to a short display label.
 * @param {string} mode
 * @returns {string}
 */
export function formatOutcomeMode(mode) {
  const labels = {
    normal: "Normal",
    disableCritical: "No Crit",
    disableFailure: "No Fail",
    disableBoth: "No Crit/Fail",
    alwaysCritical: "Always Crit",
    alwaysFailure: "Always Fail",
  };
  return labels[mode] ?? mode;
}
