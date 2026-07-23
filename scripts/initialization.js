import { MODULE_ID } from "./constants.js";
import { warn } from "./debug.js";
import { registerLuckAutomation } from "./luck/gm-panel-luck-automation.js";
import { migrateLuckSettings } from "./settings.js";

let initializationPromise = null;
export function initializeLuckFeature() {
  if (initializationPromise) return initializationPromise;
  initializationPromise = (async () => {
    await migrateLuckSettings();
    if (game.system?.id !== "dnd5e") {
      warn(`Luck automation skipped for unsupported system: ${String(game.system?.id)}`);
      return;
    }
    registerLuckAutomation({ implementationVersion: game.modules.get(MODULE_ID)?.version ?? "unknown" });
  })();
  return initializationPromise;
}
