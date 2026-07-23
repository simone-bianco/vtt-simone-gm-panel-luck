import { delegateClick } from "../dom.js";
import { getLuckControlState, setLuckControlState } from "../settings.js";
import { debug, warn } from "../debug.js";
import { getFaceProbabilities, summarizeDistribution } from "../luck/gm-panel-luck-dice.js";

/* -------------------------------------------------------------------------- */
/*  Dice control listeners                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Dice control listeners: select (d20OutcomeMode), range sliders (attack/ability/damage luck),
 * internal faction tab switching, and distribution popup trigger.
 *
 * Data contract: each faction panel has `data-dice-faction="allies|enemies"`,
 * each control has `data-dice-field`.
 *
 * @param {HTMLElement} element - GM Panel root element
 * @param {(fn: () => void) => void} addCleanup - Register cleanup
 */
const VALID_FACTIONS = new Set(["allies", "enemies"]);
const VALID_FIELDS = new Set(["d20OutcomeMode", "attackLuck", "abilityLuck", "damageLuck"]);

export function attachLuckControlListeners(element, addCleanup) {
  _attachFactionTabListeners(element, addCleanup);
  _attachDiceFieldListeners(element, addCleanup);
  _attachDistributionListeners(element, addCleanup);
}

/* -------------------------------------------------------------------------- */
/*  Internal faction tabs                                                      */
/* -------------------------------------------------------------------------- */

function _attachFactionTabListeners(element, addCleanup) {
  const tabsContainer = element.querySelector("[data-dice-faction-tabs]");
  if (!tabsContainer) return;

  const panels = element.querySelectorAll(".sgmp-dice-faction-panel[data-dice-faction]");

  const onClick = (event) => {
    const tab = event.target.closest("[data-dice-faction-tab]");
    if (!tab) return;
    const faction = tab.dataset.diceFactionTab;
    if (!faction || !VALID_FACTIONS.has(faction)) return;

    // Update active tab
    for (const t of tabsContainer.querySelectorAll("[data-dice-faction-tab]")) {
      t.classList.toggle("active", t.dataset.diceFactionTab === faction);
    }

    // Show/hide panels
    for (const panel of panels) {
      panel.classList.toggle("sgmp-hidden", panel.dataset.diceFaction !== faction);
    }
  };

  tabsContainer.addEventListener("click", onClick);
  addCleanup(() => tabsContainer.removeEventListener("click", onClick));
}

/* -------------------------------------------------------------------------- */
/*  Dice field listeners (select + range)                                      */
/* -------------------------------------------------------------------------- */

function _attachDiceFieldListeners(element, addCleanup) {
  const factionPanels = element.querySelectorAll(".sgmp-dice-faction-panel[data-dice-faction]");
  if (!factionPanels.length) return;

  for (const panel of factionPanels) {
    const faction = panel.dataset.diceFaction;
    if (!faction || !VALID_FACTIONS.has(faction)) continue;

    // Select (d20OutcomeMode)
    const select = panel.querySelector("select[data-dice-field]");
    if (select instanceof HTMLSelectElement) {
      const onSelectChange = async () => {
        const state = getLuckControlState();
        if (!state[faction]) return;
        state[faction].d20OutcomeMode = select.value;
        await saveAndLog(state, "select", faction, "d20OutcomeMode", select.value);
      };
      select.addEventListener("change", onSelectChange);
      addCleanup(() => select.removeEventListener("change", onSelectChange));
    }

    // Range sliders
    const rangeInputs = panel.querySelectorAll("input[type=\"range\"][data-dice-field]");
    for (const range of rangeInputs) {
      if (!(range instanceof HTMLInputElement)) continue;
      const field = range.dataset.diceField;
      if (!field || !VALID_FIELDS.has(field)) continue;

      // Live output update
      const onInput = () => updateRangeOutput(range);
      range.addEventListener("input", onInput);
      addCleanup(() => range.removeEventListener("input", onInput));

      // Persist on change
      const onChange = async () => {
        const state = getLuckControlState();
        if (!state[faction]) return;
        const value = parseInt(range.value, 10);
        if (!Number.isFinite(value)) return;
        state[faction][field] = value;
        await saveAndLog(state, "range", faction, field, value);
      };
      range.addEventListener("change", onChange);
      addCleanup(() => range.removeEventListener("change", onChange));
    }
  }
}

/* -------------------------------------------------------------------------- */
/*  Distribution popup                                                         */
/* -------------------------------------------------------------------------- */

function _attachDistributionListeners(element, addCleanup) {
  const removeDelegate = delegateClick(element, "[data-action=\"show-dice-distribution\"]", async (event, btn) => {
    event.preventDefault();
    if (!(btn instanceof HTMLElement)) return;

    // Find the enclosing faction panel (button no longer carries data-dice-faction)
    const panel = btn.closest(".sgmp-dice-faction-panel[data-dice-faction]");
    if (!panel) return;

    const faction = panel.dataset.diceFaction;
    if (!faction || !VALID_FACTIONS.has(faction)) return;

    // Read current luck from the DOM sliders in this panel
    const attackRange = panel.querySelector("[data-dice-field=\"attackLuck\"]");
    const attackLuck = attackRange instanceof HTMLInputElement ? parseInt(attackRange.value, 10) || 0 : 0;

    const abilityRange = panel.querySelector("[data-dice-field=\"abilityLuck\"]");
    const abilityLuck = abilityRange instanceof HTMLInputElement ? parseInt(abilityRange.value, 10) || 0 : 0;

    const damageRange = panel.querySelector("[data-dice-field=\"damageLuck\"]");
    const damageLuck = damageRange instanceof HTMLInputElement ? parseInt(damageRange.value, 10) || 0 : 0;

    const factionLabel = game.i18n.localize(
      faction === "allies" ? "SIMONE_GM_PANEL.Luck.Allies" : "SIMONE_GM_PANEL.Luck.Enemies",
    );

    await showDistributionPopup(factionLabel, attackLuck, abilityLuck, damageLuck);
  });

  if (removeDelegate) addCleanup(removeDelegate);
}

/**
 * Open a DialogV2 showing the probability distribution for the current luck values.
 */
async function showDistributionPopup(factionLabel, attackLuck, abilityLuck, damageLuck) {
  const content = _buildDistributionContent(attackLuck, abilityLuck, damageLuck);

  const dialog = new foundry.applications.api.DialogV2({
    title: game.i18n.format("SIMONE_GM_PANEL.Luck.DistributionTitle", { faction: factionLabel }),
    content,
    buttons: [{
      action: "close",
      label: game.i18n.localize("Close"),
      default: true,
    }],
    modal: true,
    window: { resizable: true },
    position: { width: 420, height: "auto" },
  });

  await dialog.render({ force: true });
}

/**
 * Build the HTML content for the distribution popup.
 * @param {number} attackLuck
 * @param {number} abilityLuck
 * @param {number} damageLuck
 * @returns {string} HTML
 */
function _buildDistributionContent(attackLuck, abilityLuck, damageLuck) {
  const sections = [];

  if (attackLuck !== 0) {
    sections.push(_distributionSection("Attack (d20)", 20, attackLuck));
  }
  if (abilityLuck !== 0) {
    sections.push(_distributionSection("Ability/Save (d20)", 20, abilityLuck));
  }
  if (damageLuck !== 0) {
    sections.push(_distributionSection("Damage (d6)", 6, damageLuck));
    sections.push(_distributionSection("Damage (d8)", 8, damageLuck));
    sections.push(_distributionSection("Damage (d20)", 20, damageLuck));
    // d100 bucket: aggregate 100 faces into 10 bins
    sections.push(_distributionD100Bucket(damageLuck));
  }

  if (!sections.length) {
    return `<p class="sgmp-dice-distribution-empty">${
      game.i18n.localize("SIMONE_GM_PANEL.Luck.DistributionAllZero")
    }</p>`;
  }

  return `<div class="sgmp-dice-distribution">${sections.join("")}</div>`;
}

/**
 * Build a single distribution section for a given die size.
 * @param {string} label
 * @param {number} faces  die size (e.g. 6, 8, 20)
 * @param {number} luck
 * @returns {string} HTML
 */
function _distributionSection(label, faces, luck) {
  const probs = getFaceProbabilities(faces, luck);
  if (!probs) return "";

  const summary = summarizeDistribution(probs);
  if (!summary) return "";

  // Compact bar chart â€” skip bars when face count is high (>40)
  const showBars = faces <= 40;
  let barsHtml = "";
  if (showBars) {
    const maxP = Math.max(...probs);
    const bars = [];
    for (let i = 0; i < probs.length; i++) {
      const pct = Math.round(probs[i] * 100);
      const barWidth = maxP > 0 ? Math.round((probs[i] / maxP) * 100) : 0;
      bars.push(
        `<div class="sgmp-dist-bar-row">
          <span class="sgmp-dist-face">${i + 1}</span>
          <span class="sgmp-dist-bar" style="width:${barWidth}%"></span>
          <span class="sgmp-dist-pct">${pct}%</span>
        </div>`,
      );
    }
    barsHtml = `<div class="sgmp-dist-bars">${bars.join("")}</div>`;
  }

  const luckLabel = luck > 0 ? `+${luck}` : String(luck);

  return `<div class="sgmp-dist-section">
    <h4 class="sgmp-dist-title">${label} (luck: ${luckLabel})</h4>
    <div class="sgmp-dist-stats">
      <span>Mean: ${summary.mean.toFixed(1)}</span>
      <span>SD: ${summary.stdDev.toFixed(1)}</span>
      <span>P(1): ${Math.round(summary.pMin * 100)}%</span>
      <span>P(${faces}): ${Math.round(summary.pMax * 100)}%</span>
    </div>
    ${barsHtml}
  </div>`;
}

/**
 * Build a d100 bucket distribution (10 bins of width 10).
 * @param {number} luck
 * @returns {string} HTML
 */
function _distributionD100Bucket(luck) {
  const probs = getFaceProbabilities(100, luck);
  if (!probs) return "";

  // Aggregate into 10 buckets
  const buckets = new Array(10).fill(0);
  for (let i = 0; i < 100; i++) {
    const bucketIdx = Math.floor(i / 10);
    buckets[bucketIdx] += probs[i];
  }

  // Stats based on bucket midpoints
  let mean = 0;
  for (let b = 0; b < 10; b++) {
    mean += (b * 10 + 5.5) * buckets[b];
  }

  let variance = 0;
  for (let b = 0; b < 10; b++) {
    const diff = (b * 10 + 5.5) - mean;
    variance += diff * diff * buckets[b];
  }

  const pFirst = buckets[0];
  const pLast = buckets[9];

  const maxP = Math.max(...buckets);
  const bars = [];
  for (let b = 0; b < 10; b++) {
    const lo = b * 10 + 1;
    const hi = lo + 9;
    const pct = Math.round(buckets[b] * 100);
    const barWidth = maxP > 0 ? Math.round((buckets[b] / maxP) * 100) : 0;
    bars.push(
      `<div class="sgmp-dist-bar-row">
        <span class="sgmp-dist-face">${lo}-${hi}</span>
        <span class="sgmp-dist-bar" style="width:${barWidth}%"></span>
        <span class="sgmp-dist-pct">${pct}%</span>
      </div>`,
    );
  }

  const luckLabel = luck > 0 ? `+${luck}` : String(luck);

  return `<div class="sgmp-dist-section">
    <h4 class="sgmp-dist-title">Damage (d100) (luck: ${luckLabel})</h4>
    <div class="sgmp-dist-stats">
      <span>Mean: ${mean.toFixed(1)}</span>
      <span>SD: ${Math.sqrt(variance).toFixed(1)}</span>
      <span>P(1-10): ${Math.round(pFirst * 100)}%</span>
      <span>P(91-100): ${Math.round(pLast * 100)}%</span>
    </div>
    <div class="sgmp-dist-bars">${bars.join("")}</div>
  </div>`;
}

/* -------------------------------------------------------------------------- */
/*  Shared helpers                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Update `<output>` sibling for a range input with signed formatting.
 * @param {HTMLInputElement} range
 */
function updateRangeOutput(range) {
  const output = range.parentElement?.querySelector("output");
  if (!output) return;
  const value = parseInt(range.value, 10);
  if (Number.isFinite(value)) {
    output.textContent = value > 0 ? `+${value}` : String(value);
  }
}

/**
 * Persist luckControl and log the change.
 */
async function saveAndLog(state, type, faction, field, value) {
  try {
    await setLuckControlState(state);
    debug("Dice control changed", { type, faction, field, value });
  } catch (e) {
    warn("Failed to save dice control", e?.message);
  }
}
