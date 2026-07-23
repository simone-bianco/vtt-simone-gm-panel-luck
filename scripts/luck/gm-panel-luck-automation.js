import { MODULE_ID, WRAPPER_API_VERSION } from "../constants.js";
import { getLuckControlState } from "../settings.js";
import { debug, warn, isDebugEnabled } from "../debug.js";
import { normalizeLuck, shouldBias, rollBiasedFace } from "./gm-panel-luck-dice.js";

/* -------------------------------------------------------------------------- */
/*  DiceTerm wrapper (installed once, scoped to marked terms)                 */
/* -------------------------------------------------------------------------- */

const WRAPPER_GUARD = Symbol.for("simone-gm-panel-luck.wrapper.v1");

function createDiceWrapper(previousFunction) {
  return async function simoneGmPanelDiceRoll(opts = {}) {
    const forcedFace = this.options?._simoneGmPanelForcedFace;
    if (forcedFace !== undefined && Number.isInteger(forcedFace)
      && forcedFace >= 1 && forcedFace <= this.faces) {
      const result = { result: forcedFace, active: true };
      this.results.push(result);
      return result;
    }

    const luck = this.options?._simoneGmPanelLuck;
    if (luck === undefined || luck === 0 || !Number.isFinite(luck)) {
      return previousFunction.call(this, opts);
    }

    const { minimize = false, maximize = false } = opts;
    const result = { result: undefined, active: true };
    if (minimize) result.result = 1;
    else if (maximize) result.result = this.faces;
    else {
      const biasedFace = rollBiasedFace(this.faces, luck, CONFIG.Dice.randomUniform);
      if (biasedFace === null) {
        warn("Dice karma: rollBiasedFace returned null, falling back to previous roll function");
        return previousFunction.call(this, opts);
      }
      result.result = biasedFace;
    }

    this.results.push(result);
    return result;
  };
}

/* -------------------------------------------------------------------------- */
/*  Hook registration                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Install the immutable session wrapper and exact dnd5e hooks once per client.
 * Existing compatible records are reused; runtime restore is intentionally unsupported.
 */
export function registerLuckAutomation({ implementationVersion = "unknown" } = {}) {
  if (game.system?.id !== "dnd5e") return false;

  const existing = globalThis[WRAPPER_GUARD];
  if (existing) {
    if (existing.owner !== MODULE_ID || existing.apiVersion !== WRAPPER_API_VERSION) {
      throw new Error("Incompatible Simone GM Panel luck wrapper guard found; reload with a compatible module set");
    }
    debug("Luck automation already registered for this session", {
      implementationVersion: existing.implementationVersion,
    });
    return true;
  }

  const DiceTerm = CONFIG.Dice.termTypes.DiceTerm;
  const previousFunction = DiceTerm?.prototype?.roll;
  if (typeof previousFunction !== "function") {
    throw new Error("DiceTerm.prototype.roll is unavailable; dice automation was not installed");
  }

  const wrappedFunction = createDiceWrapper(previousFunction);
  const hookIds = [];
  try {
    hookIds.push(Hooks.on("dnd5e.postAttackRollConfiguration", onPostAttackRollConfig));
    hookIds.push(Hooks.on("dnd5e.preRollDamage", onPreRollDamage));
    hookIds.push(Hooks.on("dnd5e.preRollDamageV2", onPreRollDamage));
    hookIds.push(Hooks.on("dnd5e.postDamageRollConfiguration", onPostDamageRollConfig));
    hookIds.push(Hooks.on("dnd5e.postAbilityCheckRollConfiguration", onPostAbilityTestRollConfig));
    hookIds.push(Hooks.on("dnd5e.postSavingThrowRollConfiguration", onPostSaveRollConfig));
    DiceTerm.prototype.roll = wrappedFunction;
  } catch (cause) {
    for (const [index, hookName] of [
      "dnd5e.postAttackRollConfiguration",
      "dnd5e.preRollDamage",
      "dnd5e.preRollDamageV2",
      "dnd5e.postDamageRollConfiguration",
      "dnd5e.postAbilityCheckRollConfiguration",
      "dnd5e.postSavingThrowRollConfiguration",
    ].entries()) {
      if (hookIds[index] !== undefined) Hooks.off(hookName, hookIds[index]);
    }
    throw cause;
  }

  globalThis[WRAPPER_GUARD] = Object.freeze({
    owner: MODULE_ID,
    apiVersion: WRAPPER_API_VERSION,
    implementationVersion,
    wrappedFunction,
    previousFunction,
    hookIds: Object.freeze([...hookIds]),
  });
  debug("Luck automation registered once for this session", { implementationVersion });
  return true;
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Resolve the faction of the roller, if any.
 * @param {object} config - dnd5e roll configuration.
 * @returns {"allies"|"enemies"|null}
 */
function resolveFaction(config) {
  const subject = config?.subject;
  if (!subject) return null;

  const actor = subject.actor ?? subject;
  if (!actor) return null;

  const token = actor.token ?? canvas?.tokens?.placeables?.find((t) => t.actor === actor);
  if (!token) return null;

  const disposition = token.document?.disposition ?? token.disposition;
  if (disposition === 1) return "allies";
  if (disposition === -1) return "enemies";
  return null;
}

/**
 * Check whether the damage config (or any of its rolls) represents healing.
 * @param {object} config - dnd5e damage roll configuration.
 * @returns {boolean}
 */
function isHealingRoll(config) {
  // Primary: dnd5e sets rollType for healing rolls
  if (config?.rollType === "healing") return true;

  // Subject-level: activity/action healing (Midi-QOL / dnd5e)
  if (config?.subject?.actionType === "heal") return true;

  const healingTypes = CONFIG?.DND5E?.healingTypes;
  if (!healingTypes) return false;

  for (const rollConfig of config?.rolls ?? []) {
    // Signal: options.type (singular, dnd5e convention)
    const type = rollConfig?.options?.type;
    if (type && type in healingTypes) return true;

    // Signal: options.types (plural, used by some activities)
    const types = rollConfig?.options?.types;
    if (types) {
      for (const t of Object.keys(types)) {
        if (t in healingTypes) return true;
      }
    }
  }

  return false;
}

/* -------------------------------------------------------------------------- */
/*  Shared policy applicators                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Apply d20OutcomeMode to the D20Die options of each roll.
 * Must be called AFTER roll construction (post-config hook) because
 * configureModifiers() runs in the constructor and reads critical thresholds.
 *
 * @param {D20Roll[]} rolls  constructed but unevaluated attack / ability / save rolls
 * @param {string}    mode   one of D20_OUTCOME_MODES
 */
function applyD20OutcomeMode(rolls, mode) {
  if (mode === "normal") return;

  for (const roll of rolls) {
    roll.options ??= {};
    const d20 = roll.d20;
    if (!d20) continue;
    d20.options ??= {};

    switch (mode) {
      case "disableCritical":
        roll.options.criticalSuccess = 21;
        d20.options.criticalSuccess = 21;
        break;
      case "disableFailure":
        roll.options.criticalFailure = 0;
        d20.options.criticalFailure = 0;
        break;
      case "disableBoth":
        roll.options.criticalSuccess = 21;
        d20.options.criticalSuccess = 21;
        roll.options.criticalFailure = 0;
        d20.options.criticalFailure = 0;
        break;
      case "alwaysCritical":
        // Force D20Die face to 20 (wrapper handles _simoneGmPanelForcedFace)
        d20.options._simoneGmPanelForcedFace = 20;
        break;
      case "alwaysFailure":
        // Force D20Die face to 1
        d20.options._simoneGmPanelForcedFace = 1;
        break;
      default:
        break;
    }
  }
}

/**
 * Mark D20Die terms with luck value for the wrapper to bias.
 * @param {D20Roll[]} rolls
 * @param {number}    luck  normalized luck value
 */
function markD20Luck(rolls, luck) {
  const normalized = normalizeLuck(luck);
  if (!shouldBias(normalized)) return;

  for (const roll of rolls) {
    if (roll.d20) {
      roll.d20.options ??= {};
      roll.d20.options._simoneGmPanelLuck = normalized;
    }
  }
}

/**
 * Mark all DiceTerms in damage rolls with luck value.
 * @param {DamageRoll[]} rolls
 * @param {number}       luck  normalized luck value
 */
function markDamageLuck(rolls, luck) {
  const normalized = normalizeLuck(luck);
  if (!shouldBias(normalized)) return;

  for (const roll of rolls) {
    // Use roll.dice (recursive) if available; fall back to roll.terms
    const terms = roll.dice ?? roll.terms ?? [];
    for (const term of terms) {
      if (!Number.isInteger(term.faces) || term.faces < 2) continue;
      term.options ??= {};
      term.options._simoneGmPanelLuck = normalized;
    }
  }
}

/**
 * Read dice control state safely, returning null on error.
 * @returns {object|null}
 */
function readDiceState() {
  try {
    return getLuckControlState();
  } catch (e) {
    warn("Dice karma: failed to read luckControl state", e?.message);
    return null;
  }
}

/**
 * Log a dice karma intervention for debug.
 * @param {string} kind      "attack" | "ability" | "save" | "damage"
 * @param {string} faction   "allies" | "enemies"
 * @param {object} rules     faction rules from state
 * @param {number} [luck]    luck value used (if applicable)
 */
function logKarma(kind, faction, rules, luck) {
  if (!isDebugEnabled()) return;
  debug(`Dice karma: ${kind}`, {
    faction,
    mode: rules.d20OutcomeMode,
    luck: luck !== undefined ? (luck > 0 ? `+${luck}` : String(luck)) : "n/a",
  });
}

/* -------------------------------------------------------------------------- */
/*  Hook handlers                                                              */
/* -------------------------------------------------------------------------- */

/**
 * dnd5e.preRollDamage / dnd5e.preRollDamageV2
 * MUST run BEFORE DamageRoll constructor to prevent crit-dice expansion.
 * Converts d20OutcomeMode that disable criticals.
 */
function onPreRollDamage(config) {
  if (config._sgmpCriticalsApplied) return;
  config._sgmpCriticalsApplied = true;

  const faction = resolveFaction(config);
  if (!faction) return;

  const state = readDiceState();
  if (!state) return;

  const rules = state[faction];
  if (!rules) return;

  // Prevent critical dice from being added during DamageRoll construction
  // when d20OutcomeMode disables criticals
  const mode = rules.d20OutcomeMode;
  if (mode === "disableCritical" || mode === "disableBoth") {
    config.isCritical = false;
    for (const rollConfig of config.rolls ?? []) {
      rollConfig.options ??= {};
      rollConfig.options.isCritical = false;
    }
  }
}

/**
 * dnd5e.postAttackRollConfiguration
 * Fires AFTER attack rolls are constructed, BEFORE evaluate().
 * Applies d20OutcomeMode policy and marks D20Die with attack luck.
 *
 * @param {D20Roll[]} rolls   constructed but unevaluated attack rolls
 * @param {object}     config  dnd5e roll configuration (subject, etc.)
 */
function onPostAttackRollConfig(rolls, config) {
  const faction = resolveFaction(config);
  if (!faction) return;

  const state = readDiceState();
  if (!state) return;

  const rules = state[faction];
  if (!rules) return;

  applyD20OutcomeMode(rolls, rules.d20OutcomeMode);
  markD20Luck(rolls, rules.attackLuck);
  logKarma("attack", faction, rules, rules.attackLuck);
}

/**
 * dnd5e.postAbilityCheckRollConfiguration
 * Fires AFTER ability check rolls are constructed, BEFORE evaluate().
 * Applies d20OutcomeMode policy and marks D20Die with ability luck.
 * Death saves and concentration checks use different hooks — excluded by scope.
 *
 * @param {D20Roll[]} rolls
 * @param {object}    config
 */
function onPostAbilityTestRollConfig(rolls, config) {
  const faction = resolveFaction(config);
  if (!faction) return;

  const state = readDiceState();
  if (!state) return;

  const rules = state[faction];
  if (!rules) return;

  applyD20OutcomeMode(rolls, rules.d20OutcomeMode);
  markD20Luck(rolls, rules.abilityLuck);
  logKarma("ability", faction, rules, rules.abilityLuck);
}
/**
 * dnd5e.postSavingThrowRollConfiguration
 * Fires AFTER saving throw rolls are constructed, BEFORE evaluate().
 * Applies d20OutcomeMode policy and marks D20Die with ability luck.
 *
 * @param {D20Roll[]} rolls
 * @param {object}    config
 */
function onPostSaveRollConfig(rolls, config) {
  const faction = resolveFaction(config);
  if (!faction) return;

  const state = readDiceState();
  if (!state) return;

  const rules = state[faction];
  if (!rules) return;

  applyD20OutcomeMode(rolls, rules.d20OutcomeMode);
  markD20Luck(rolls, rules.abilityLuck);
  logKarma("save", faction, rules, rules.abilityLuck);
}
/**
 * dnd5e.postDamageRollConfiguration
 * Fires AFTER damage rolls are constructed, BEFORE evaluate().
 * Marks every DiceTerm with damage luck.
 * Healing rolls are skipped entirely.
 *
 * @param {DamageRoll[]} rolls   constructed but unevaluated damage rolls
 * @param {object}       config  dnd5e roll configuration
 */
function onPostDamageRollConfig(rolls, config) {
  if (isHealingRoll(config)) return;

  const faction = resolveFaction(config);
  if (!faction) return;

  const state = readDiceState();
  if (!state) return;

  const rules = state[faction];
  if (!rules) return;

  // d20OutcomeMode does NOT apply to damage dice (only d20).
  // disableCritical for crit-dice expansion is handled in onPreRollDamage.
  markDamageLuck(rolls, rules.damageLuck);
  logKarma("damage", faction, rules, rules.damageLuck);
}
