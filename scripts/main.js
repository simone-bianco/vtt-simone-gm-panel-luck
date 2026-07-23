import { CORE_MODULE_ID, FEATURE_API_VERSION } from "./constants.js";
import { error } from "./debug.js";
import { initializeLuckFeature } from "./initialization.js";
import { luckFeature } from "./luck-feature.js";
import { registerSettings } from "./settings.js";

Hooks.once("init", () => {
  registerSettings();
  const coreApi = game.modules.get(CORE_MODULE_ID)?.api ?? game.simoneGmPanel?.api;
  if (!coreApi || coreApi.apiVersion !== FEATURE_API_VERSION) {
    throw new Error("simone-gm-panel-luck requires Simone GM Panel core API v1");
  }
  coreApi.registerFeature(luckFeature.descriptor());
});

Hooks.once("ready", async () => {
  try { await initializeLuckFeature(); }
  catch (cause) { error("Luck feature initialization failed; reload required", cause); }
});
