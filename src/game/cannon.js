/** The player's cannon: a brass-and-steel turret on a coral-stone platform; barrels grow with the bet. */
import * as THREE from "three";
import { bakeTexture } from "../materials.js";
import { kitMaterial } from "./kit.js";

const BET_COLORS = { 1: 0x5fd3ff, 2: 0x7dff7a, 5: 0xffb33a, 10: 0xff4fd8, 20: 0xb06bff, 50: 0xffe23a };

export function betColor(bet) {
  return BET_COLORS[bet] ?? 0xffffff;
}

/**
 * Cannon finishes unlocked by level (cosmetic only): the "brass" metal and the "steel" turret
 * re-baked with each finish's palette. Bronze is the original.
 */
export const SKIN_PALETTES = {
  bronze: { brass: [0xb07a2a, 0xe0b04a, 0xffd877], steel: [0x3a4a5a, 0x5d7083, 0x8aa0b4] },
  // kept below white: the bright end of the palette blooms (a 0xf4f7fa silver read as a white blob)
  silver: { brass: [0x56606c, 0x8e98a4, 0xc2cad2], steel: [0x252e38, 0x3e4a57, 0x5f6e7e] },
  coral: { brass: [0xa8402a, 0xe8735a, 0xffb39a], steel: [0x1c4650, 0x2c6a74, 0x4a95a0] },
  abyss: { brass: [0x2e1e66, 0x5c40b0, 0x9c80ff], steel: [0x0e151d, 0x1c2834, 0x324458] },
  dragon: { brass: [0x861808, 0xd4401a, 0xffa040], steel: [0x281006, 0x48200e, 0x683418] },
};
const skinMaps = new Map();
function skinMaps_(id, part, seed) {
  const key = `${id}:${part}`;
  if (!skinMaps.has(key)) skinMaps.set(key, bakeTexture({ kind: "metal", seed, palette: SKIN_PALETTES[id][part] }));
  return skinMaps.get(key);
}

export function buildCannon(scene) {
  const root = new THREE.Group();
  root.userData.tag = "cannon";
  scene.add(root);

  const brass = kitMaterial({ kind: "metal", seed: 31, palette: [0xb07a2a, 0xe0b04a, 0xffd877], repeat: 1, metalness: 0.85, roughness: 0.35 });
  const steel = kitMaterial({ kind: "metal", seed: 32, palette: [0x3a4a5a, 0x5d7083, 0x8aa0b4], repeat: 1, metalness: 0.8, roughness: 0.4 });
  const stone = kitMaterial({ kind: "stone", seed: 33, palette: [0x2c4a5c, 0x41687c, 0x5a8296], repeat: 2 });

  // platform: a half-buried round dais
  const dais = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.8, 0.7, 40), stone);
  dais.position.y = -0.35;
  root.add(dais);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.14, 10, 48), brass);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.02;
  root.add(ring);

  // gem ring around the dais — glows in the bet colour
  const gemMat = new THREE.MeshStandardMaterial({ color: 0x0a1a2a, emissive: 0x5fd3ff, emissiveIntensity: 2.2, roughness: 0.15, metalness: 0.2, map: brass.map });
  const gemGeo = new THREE.OctahedronGeometry(0.2, 0);
  // twelve gems, one draw
  const gems = new THREE.InstancedMesh(gemGeo, gemMat, 12);
  const gemM = new THREE.Matrix4();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    gems.setMatrixAt(i, gemM.compose(new THREE.Vector3(Math.cos(a) * 2.45, 0.05, Math.sin(a) * 2.45), new THREE.Quaternion(), new THREE.Vector3(1, 0.6, 1)));
  }
  root.add(gems);
  const outer = new THREE.Mesh(new THREE.TorusGeometry(2.75, 0.1, 8, 64), brass);
  outer.rotation.x = Math.PI / 2;
  outer.position.y = -0.05;
  root.add(outer);
  // fluted golden pedestal under the turret
  const ped = new THREE.Mesh(
    new THREE.LatheGeometry([[0, 0], [1.6, 0], [1.6, 0.12], [1.35, 0.2], [1.3, 0.38], [1.45, 0.46], [0, 0.46]].map(([r, y]) => new THREE.Vector2(r, y)), 36),
    brass,
  );
  ped.position.y = -0.1;
  root.add(ped);

  const turret = new THREE.Group();
  turret.position.y = 0.3;
  root.add(turret);
  const base = new THREE.Mesh(new THREE.SphereGeometry(1.15, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), steel);
  base.scale.y = 0.75;
  turret.add(base);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(1.12, 0.1, 8, 40), brass);
  collar.rotation.x = Math.PI / 2;
  turret.add(collar);

  // barrel profile (lathe) — flared muzzle, reinforcing rings
  const prof = [
    [0.0, 0], [0.42, 0], [0.42, 0.1], [0.34, 0.2], [0.3, 1.2], [0.36, 1.3], [0.36, 1.42], [0.29, 1.5],
    [0.27, 2.1], [0.38, 2.2], [0.42, 2.45], [0.32, 2.5], [0.2, 2.45], [0.18, 2.0],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const barrelGeo = new THREE.LatheGeometry(prof, 28);
  barrelGeo.rotateX(-Math.PI / 2); // point along -Z (up the screen)
  const barrels = new THREE.Group();
  barrels.position.y = 0.55;
  turret.add(barrels);
  const glowMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x5fd3ff, emissiveIntensity: 1.5, map: steel.map });
  const gem = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 1), glowMat);
  gem.position.set(0, 0.95, 0.2);
  turret.add(gem);

  const bandGeo = new THREE.TorusGeometry(0.33, 0.06, 8, 24);
  let current = 0;
  /** `count`: barrels to show (the bet's rank in its room); without it, from the reef's bets. */
  function setBet(bet, count = bet >= 10 ? 4 : bet >= 5 ? 3 : bet >= 2 ? 2 : 1) {
    count = Math.max(1, Math.min(4, count));
    if (bet === current && count === barrels.children.length) return;
    current = bet;
    barrels.clear();
    const spread = 0.5;
    for (let i = 0; i < count; i++) {
      const b = new THREE.Mesh(barrelGeo, brass);
      const band = new THREE.Mesh(bandGeo, glowMat);
      band.position.z = -1.36;
      b.add(band);
      const band2 = band.clone();
      band2.position.z = -2.2;
      b.add(band2);
      b.position.x = (i - (count - 1) / 2) * spread;
      const s = count === 1 ? 1.15 : 1;
      b.scale.set(s * (count > 2 ? 0.8 : 1), s * (count > 2 ? 0.8 : 1), s);
      barrels.add(b);
    }
    glowMat.emissive.setHex(betColor(bet));
    gemMat.emissive.setHex(betColor(bet));
  }
  setBet(1);

  function setSkin(id) {
    if (!SKIN_PALETTES[id]) id = "bronze";
    // only the colour changes: the metal's roughness and bump are the kit's shared pair (kit.js)
    for (const [mat, part, seed] of [[brass, "brass", 31], [steel, "steel", 32]]) mat.map = skinMaps_(id, part, seed).map;
  }

  let recoil = 0;
  return {
    root,
    turret,
    setBet,
    setSkin,
    fire() {
      recoil = 1;
    },
    /** Muzzle point in world space. */
    muzzle(out = new THREE.Vector3()) {
      out.set(0, 0.55, -2.4);
      return turret.localToWorld(out);
    },
    update(dt, aim, t) {
      turret.rotation.y = aim;
      recoil = Math.max(0, recoil - dt * 7);
      barrels.position.z = recoil * 0.35;
      gem.rotation.y = t * 1.5;
      glowMat.emissiveIntensity = 1.2 + Math.sin(t * 4) * 0.4;
    },
  };
}
