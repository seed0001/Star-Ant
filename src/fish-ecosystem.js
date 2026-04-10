/**
 * Lake fish food chain: pellets, hunger, predation tuning.
 */

function finiteOr(n, fallback) {
  const v = typeof n === "number" ? n : parseFloat(String(n));
  return Number.isFinite(v) ? v : fallback;
}

function clampNum(n, a, b) {
  return Math.min(b, Math.max(a, n));
}

/**
 * @typedef {{
 *   pelletCount: number,
 *   pelletSeed: number,
 *   pelletRegenPerSec: number,
 *   hungerPerSec: number,
 *   feedPellet: number,
 *   feedLadybug: number,
 *   feedSpider: number,
 *   eatRadius: number,
 *   huntSteer: number,
 *   pelletColor: string,
 *   preyLadybugs: boolean,
 *   preySpiderZones: boolean,
 * }} FishEcosystemSettings
 */

/** @type {FishEcosystemSettings} */
export const DEFAULT_FISH_ECOSYSTEM = {
  pelletCount: 0,
  pelletSeed: 7721,
  pelletRegenPerSec: 0,
  hungerPerSec: 0.042,
  feedPellet: 0.26,
  feedLadybug: 0.52,
  feedSpider: 0.18,
  eatRadius: 0.62,
  huntSteer: 2.35,
  pelletColor: "#ff8800",
  preyLadybugs: true,
  preySpiderZones: true,
};

/**
 * @param {unknown} raw
 * @returns {FishEcosystemSettings}
 */
export function normalizeFishEcosystem(raw) {
  const o = raw && typeof raw === "object" ? /** @type {Record<string, unknown>} */ (raw) : {};
  const d = DEFAULT_FISH_ECOSYSTEM;
  const preyLadybugs = o.preyLadybugs === false ? false : true;
  const preySpiderZones = o.preySpiderZones === false ? false : true;
  const pelletColor =
    typeof o.pelletColor === "string" && o.pelletColor.length > 2 ? o.pelletColor : d.pelletColor;
  return {
    pelletCount: clampNum(Math.floor(finiteOr(/** @type {number} */ (o.pelletCount), d.pelletCount)), 0, 4000),
    pelletSeed: clampNum(Math.floor(finiteOr(/** @type {number} */ (o.pelletSeed), d.pelletSeed)), 0, 99999),
    pelletRegenPerSec: clampNum(finiteOr(/** @type {number} */ (o.pelletRegenPerSec), d.pelletRegenPerSec), 0, 40),
    hungerPerSec: clampNum(finiteOr(/** @type {number} */ (o.hungerPerSec), d.hungerPerSec), 0, 0.5),
    feedPellet: clampNum(finiteOr(/** @type {number} */ (o.feedPellet), d.feedPellet), 0, 1),
    feedLadybug: clampNum(finiteOr(/** @type {number} */ (o.feedLadybug), d.feedLadybug), 0, 1),
    feedSpider: clampNum(finiteOr(/** @type {number} */ (o.feedSpider), d.feedSpider), 0, 1),
    eatRadius: clampNum(finiteOr(/** @type {number} */ (o.eatRadius), d.eatRadius), 0.15, 2.5),
    huntSteer: clampNum(finiteOr(/** @type {number} */ (o.huntSteer), d.huntSteer), 0, 8),
    pelletColor,
    preyLadybugs,
    preySpiderZones,
  };
}

/**
 * @param {FishEcosystemSettings} e
 */
export function fishEcosystemSignature(e) {
  const n = normalizeFishEcosystem(e);
  return JSON.stringify({
    pelletCount: n.pelletCount,
    pelletSeed: n.pelletSeed,
    pelletColor: n.pelletColor,
  });
}
