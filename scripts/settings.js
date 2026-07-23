import {
  D20_OUTCOME_MODES,
  DEFAULT_LUCK_CONTROL,
  LEGACY_MODULE_ID,
  LUCK_MAX,
  LUCK_MIN,
  MIGRATION_VERSION,
  MODULE_ID,
  PREVIOUS_MODULE_ID,
  SETTINGS,
} from "./constants.js";

const PREVIOUS_CONTROL_KEY = "diceControl";

export function registerSettings() {
  game.settings.register(MODULE_ID, SETTINGS.DISABLE_CRITICALS, {
    name: "SIMONE_GM_PANEL.Settings.DisableCriticals.Name",
    hint: "SIMONE_GM_PANEL.Settings.DisableCriticals.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
  });
  game.settings.register(MODULE_ID, SETTINGS.LUCK_CONTROL, {
    scope: "world",
    config: false,
    type: Object,
    default: DEFAULT_LUCK_CONTROL,
  });
  game.settings.register(MODULE_ID, SETTINGS.WORLD_MIGRATION, {
    scope: "world", config: false, type: Number, default: 0,
  });
  game.settings.register(MODULE_ID, SETTINGS.CLIENT_MIGRATION, {
    scope: "client", config: false, type: Number, default: 0,
  });
}

export async function migrateLuckSettings() {
  await migrateClientSettings();
  if (game.user?.isGM) await migrateWorldSettings();
}

async function migrateClientSettings() {
  if (Number(game.settings.get(MODULE_ID, SETTINGS.CLIENT_MIGRATION)) >= MIGRATION_VERSION) return;
  if (!hasPersistedSetting("client", MODULE_ID, SETTINGS.DISABLE_CRITICALS)) {
    const previous = readFirstPersistedSetting(
      "client", [PREVIOUS_MODULE_ID, LEGACY_MODULE_ID], SETTINGS.DISABLE_CRITICALS,
    );
    await game.settings.set(MODULE_ID, SETTINGS.DISABLE_CRITICALS, previous.exists ? previous.value === true : false);
  }
  await game.settings.set(MODULE_ID, SETTINGS.CLIENT_MIGRATION, MIGRATION_VERSION);
}

async function migrateWorldSettings() {
  if (Number(game.settings.get(MODULE_ID, SETTINGS.WORLD_MIGRATION)) >= MIGRATION_VERSION) return;
  if (!hasPersistedSetting("world", MODULE_ID, SETTINGS.LUCK_CONTROL)) {
    const previous = readFirstPersistedSetting(
      "world", [PREVIOUS_MODULE_ID, LEGACY_MODULE_ID], PREVIOUS_CONTROL_KEY,
    );
    const value = previous.exists ? normalizeLuckControlState(previous.value) : structuredClone(DEFAULT_LUCK_CONTROL);
    await game.settings.set(MODULE_ID, SETTINGS.LUCK_CONTROL, value);
  }
  await game.settings.set(MODULE_ID, SETTINGS.WORLD_MIGRATION, MIGRATION_VERSION);
}

export function getDisableCriticals() {
  return game.settings.get(MODULE_ID, SETTINGS.DISABLE_CRITICALS) === true;
}
export async function setDisableCriticals(value) {
  return game.settings.set(MODULE_ID, SETTINGS.DISABLE_CRITICALS, value === true);
}
export function getLuckControlState() {
  return normalizeLuckControlState(game.settings.get(MODULE_ID, SETTINGS.LUCK_CONTROL));
}
export async function setLuckControlState(next) {
  return game.settings.set(MODULE_ID, SETTINGS.LUCK_CONTROL, normalizeLuckControlState(next));
}

export function normalizeLuckControlState(raw) {
  const base = structuredClone(DEFAULT_LUCK_CONTROL);
  if (!raw || typeof raw !== "object") return base;
  for (const faction of ["allies", "enemies"]) {
    const source = raw[faction];
    if (!source || typeof source !== "object") continue;
    const target = base[faction];
    if (typeof source.d20OutcomeMode === "string" && D20_OUTCOME_MODES.includes(source.d20OutcomeMode)) {
      target.d20OutcomeMode = source.d20OutcomeMode;
    } else if (source.disableCriticals === true) target.d20OutcomeMode = "disableCritical";
    target.attackLuck = clamp(source.attackLuck, 0, LUCK_MIN, LUCK_MAX);
    target.damageLuck = clamp(source.damageLuck, 0, LUCK_MIN, LUCK_MAX);
    target.abilityLuck = clamp(source.abilityLuck, 0, LUCK_MIN, LUCK_MAX);
  }
  return base;
}

function readFirstPersistedSetting(scope, moduleIds, key) {
  for (const moduleId of moduleIds) {
    const entry = readPersistedSetting(scope, moduleId, key);
    if (entry.exists) return entry;
  }
  return { exists: false, value: undefined };
}
function hasPersistedSetting(scope, moduleId, key) {
  return readPersistedSetting(scope, moduleId, key).exists;
}
function readPersistedSetting(scope, moduleId, key) {
  const storage = game.settings.storage.get(scope);
  const fullKey = `${moduleId}.${key}`;
  if (!storage) return { exists: false, value: undefined };
  if (scope === "client" && typeof storage.getItem === "function") {
    const entry = storage.getItem(fullKey);
    return entry === null ? { exists: false, value: undefined } : { exists: true, value: decodeStoredValue(entry) };
  }
  if (typeof storage.getSetting === "function") {
    const entry = storage.getSetting(fullKey);
    return entry === undefined ? { exists: false, value: undefined } : { exists: true, value: decodeStoredValue(entry?.value) };
  }
  return { exists: false, value: undefined };
}
function decodeStoredValue(value) {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
}
function clamp(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}
