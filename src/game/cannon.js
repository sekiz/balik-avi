/** The player's cannon: a brass-and-steel turret on a coral-stone platform; barrels grow with the bet. */
import * as THREE from "three";
import { standardMaterial } from "../materials.js";

const BET_COLORS = { 1: 0x5fd3ff, 2: 0x7dff7a, 5: 0xffb33a, 10: 0xff4fd8 };

export function betColor(bet) {
  return BET_COLORS[bet] ?? 0xffffff;
}

export function buildCannon(scene) {
  const root = new THREE.Group();
  root.userData.tag = "cannon";
  scene.add(root);

  const brass = standardMaterial({ kind: "metal", seed: 31, palette: [0xb07a2a, 0xe0b04a, 0xffd877], repeat: 1, metalness: 0.85, roughness: 0.35 });
  const steel = standardMaterial({ kind: "metal", seed: 32, palette: [0x3a4a5a, 0x5d7083, 0x8aa0b4], repeat: 1, metalness: 0.8, roughness: 0.4 });
  const stone = standardMaterial({ kind: "stone", seed: 33, palette: [0x2c4a5c, 0x41687c, 0x5a8296], repeat: 2 });

  // platform: a half-buried round dais
  const dais = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.8, 0.7, 40), stone);
  dais.position.y = -0.35;
  root.add(dais);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.14, 10, 48), brass);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.02;
  root.add(ring);

  const turret = new THREE.Group();
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

  let current = 0;
  function setBet(bet) {
    if (bet === current) return;
    current = bet;
    barrels.clear();
    const count = bet >= 10 ? 4 : bet >= 5 ? 3 : bet >= 2 ? 2 : 1;
    const spread = 0.5;
    for (let i = 0; i < count; i++) {
      const b = new THREE.Mesh(barrelGeo, i % 2 ? steel : brass);
      b.position.x = (i - (count - 1) / 2) * spread;
      const s = count === 1 ? 1.15 : 1;
      b.scale.set(s * (count > 2 ? 0.8 : 1), s * (count > 2 ? 0.8 : 1), s);
      barrels.add(b);
    }
    glowMat.emissive.setHex(betColor(bet));
  }
  setBet(1);

  let recoil = 0;
  return {
    root,
    turret,
    setBet,
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
