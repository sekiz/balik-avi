/**
 * `standardMaterial` (materials.js) with the texture budget in mind. Every baked material carries
 * three 512² maps: colour, roughness and bump. Roughness and bump hold no colour — they are the
 * kind's surface (wood grain, stone pits, metal wear) — so materials of the same kind share one
 * pair, and only the colour map stays their own. 45+ baked materials then upload ~20 maps fewer
 * than 3 each would (docs/PROGRESS.md §9: the texture count was 121–170 against a budget of 60).
 */
import { standardMaterial } from "../materials.js";

const detail = new Map(); // `${kind}|${repeat}` -> { roughnessMap, bumpMap }

export function kitMaterial(opts = {}) {
  const m = standardMaterial(opts);
  const key = `${opts.kind ?? "stone"}|${opts.repeat ?? 1}`;
  const shared = detail.get(key);
  if (!shared) {
    detail.set(key, { roughnessMap: m.roughnessMap, bumpMap: m.bumpMap });
  } else {
    // this material's own pair was never uploaded: dropping it costs nothing
    m.roughnessMap.dispose();
    m.bumpMap.dispose();
    m.roughnessMap = shared.roughnessMap;
    m.bumpMap = shared.bumpMap;
  }
  return m;
}
