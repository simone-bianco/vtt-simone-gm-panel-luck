export const MODULE_ID = "simone-gm-panel-luck";
export const CORE_MODULE_ID = "simone-gm-panel";
export const PREVIOUS_MODULE_ID = "simone-gm-panel-dice";
export const LEGACY_MODULE_ID = "simone-gm-panel";
export const FEATURE_API_VERSION = 1;
export const WRAPPER_API_VERSION = 1;
export const MIGRATION_VERSION = 1;

export const SETTINGS = {
  DISABLE_CRITICALS: "disableCriticals",
  LUCK_CONTROL: "luckControl",
  WORLD_MIGRATION: "migrationWorldVersion",
  CLIENT_MIGRATION: "migrationClientVersion",
};

export const DEFAULT_LUCK_CONTROL = {
  allies: { d20OutcomeMode: "normal", attackLuck: 0, damageLuck: 0, abilityLuck: 0 },
  enemies: { d20OutcomeMode: "normal", attackLuck: 0, damageLuck: 0, abilityLuck: 0 },
};

export const D20_OUTCOME_MODES = [
  "normal", "disableCritical", "disableFailure", "disableBoth", "alwaysCritical", "alwaysFailure",
];

export const LUCK_MIN = -10;
export const LUCK_MAX = 10;
