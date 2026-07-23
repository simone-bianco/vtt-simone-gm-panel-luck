import { D20_OUTCOME_MODES, FEATURE_API_VERSION } from "./constants.js";
import { configureLogger } from "./debug.js";
import { initializeLuckFeature } from "./initialization.js";
import { getLuckControlState } from "./settings.js";
import { attachLuckControlListeners } from "./ui/luck-listeners.js";
import { buildLuckControlViewModel } from "./ui/gm-panel-luck-view-model.js";

class LuckFeature {
  #hostServices = null;
  descriptor() {
    return {
      apiVersion: FEATURE_API_VERSION,
      id: "luck",
      labelKey: "SIMONE_GM_PANEL.Tabs.Luck",
      icon: "fa-solid fa-clover",
      order: 10,
      template: "modules/simone-gm-panel-luck/templates/luck-tab.hbs",
      prepareContext: (hostContext) => this.prepareContext(hostContext),
      activate: (hostServices) => this.activate(hostServices),
      deactivate: () => this.deactivate(),
      bind: (element, hostServices) => this.bind(element, hostServices),
    };
  }
  async activate(hostServices) {
    this.#hostServices = hostServices;
    configureLogger(hostServices.logger);
    await initializeLuckFeature();
  }
  deactivate() { this.#hostServices = null; }
  prepareContext(hostContext) {
    return {
      luckControl: buildLuckControlViewModel(getLuckControlState(), {
        includeDistributions: hostContext.logger?.isDebugEnabled?.() === true,
      }),
      luckOutcomeModes: Object.fromEntries(
        D20_OUTCOME_MODES.map((mode) => [mode, game.i18n.localize(`SIMONE_GM_PANEL.Luck.OutcomeMode.${mode}`)]),
      ),
    };
  }
  bind(element, hostServices) {
    this.#hostServices = hostServices;
    const cleanups = [];
    attachLuckControlListeners(element, (cleanup) => cleanups.push(cleanup));
    return () => { for (const cleanup of cleanups.splice(0).reverse()) cleanup?.(); };
  }
}
export const luckFeature = new LuckFeature();
