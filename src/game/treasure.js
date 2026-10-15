/**
 * The treasure bubble (docs/PROGRESSION.md §4): a wooden chest with gold bands and spilling coins,
 * inside a thin iridescent bubble. Faces +X, about 2 units across like the fish models (the caller
 * scales it). The chest takes the fish hit flash through its emissive colour (`flash.value`).
 */
import * as THREE from "three";
import { kitMaterial } from "./kit.js";

let base = null;

/** A soft round glow. */
function glowTexture() {
  const s = 64;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.3, "rgba(255,255,255,0.6)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** An iridescent film: a soft rainbow sheen that is strongest toward the rim of the texture. */
function sheenTexture() {
  const s = 256;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d");
  const lin = g.createLinearGradient(0, 0, s, s);
  ["#bff7ff", "#e6c8ff", "#fff1b8", "#b8ffd9", "#bfe0ff"].forEach((col, i, a) => lin.addColorStop(i / (a.length - 1), col));
  g.fillStyle = lin;
  g.fillRect(0, 0, s, s);
  const rad = g.createRadialGradient(s * 0.5, s * 0.5, s * 0.1, s * 0.5, s * 0.5, s * 0.7);
  rad.addColorStop(0, "rgba(255,255,255,0.35)");
  rad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = rad;
  g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function shared() {
  if (base) return base;
  base = {
    wood: kitMaterial({ kind: "wood", seed: 41, palette: [0x2e1a0c, 0x5a3418, 0x7e4e26], roughness: 0.75 }),
    gold: kitMaterial({ kind: "metal", seed: 7, palette: [0x8a5a00, 0xd9a520, 0xffe08a], metalness: 0.85, roughness: 0.3, envMapIntensity: 1.2 }),
    bubble: new THREE.MeshStandardMaterial({ map: sheenTexture(), color: 0xdff8ff, emissive: 0x0e3448, transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0.2, envMapIntensity: 1.8, depthWrite: false }),
    // warm light from the open chest (additive, so it blooms): what makes the bubble read as treasure
    glow: new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffc23a, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
    body: new THREE.BoxGeometry(0.9, 0.42, 0.6),
    // a half-cylinder lid whose back edge sits on the hinge (the pivot's origin)
    lid: new THREE.CylinderGeometry(0.3, 0.3, 0.92, 16, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).translate(0, 0, 0.3),
    mound: new THREE.SphereGeometry(0.4, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.05, 0.35, 0.68),
    band: new THREE.BoxGeometry(0.08, 0.46, 0.64),
    coin: new THREE.CylinderGeometry(0.09, 0.09, 0.025, 14),
    sphere: new THREE.SphereGeometry(1.2, 32, 20),
  };
  for (const m of [base.wood, base.gold, base.bubble]) m.fog = false; // targets stay clear of the haze
  return base;
}

export function buildTreasure(flash) {
  const b = shared();
  // per-instance copies so the hit flash lights only this chest
  const wood = b.wood.clone();
  const gold = b.gold.clone();
  wood.emissive = flash.value;
  gold.emissive = flash.value;
  const g = new THREE.Group();
  const chest = new THREE.Group();
  chest.add(new THREE.Mesh(b.body, wood));
  // the lid stands open at the back (the camera looks down from the front), so the gold shows
  const hinge = new THREE.Group();
  hinge.position.set(0, 0.21, -0.3);
  hinge.rotation.x = -1.75;
  hinge.add(new THREE.Mesh(b.lid, wood));
  chest.add(hinge);
  for (const x of [-0.32, 0, 0.32]) {
    const band = new THREE.Mesh(b.band, gold);
    band.position.x = x;
    chest.add(band);
  }
  // a heap of gold filling the open chest: a mound and coins lying on it
  const mound = new THREE.Mesh(b.mound, gold);
  mound.position.y = 0.2;
  chest.add(mound);
  const N = 16;
  const coins = new THREE.InstancedMesh(b.coin, gold, N);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (let i = 0; i < N; i++) {
    const a = i * 2.39996;
    const r = 0.36 * Math.sqrt((i + 0.5) / N);
    const x = Math.cos(a) * r * 1.05;
    const z = Math.sin(a) * r * 0.68;
    const y = 0.2 + 0.14 * (1 - (r / 0.36) ** 2) + 0.012;
    q.setFromEuler(new THREE.Euler(0.35 * Math.sin(a * 3), 0, 0.35 * Math.cos(a * 2)));
    coins.setMatrixAt(i, m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1)));
  }
  chest.add(coins);
  // the bubble turns with its heading like a fish; the chest undoes that turn, so its open lid
  // always stands at the back, away from the overhead camera
  chest.updateMatrix = function () {
    this.rotation.y = -(this.parent?.rotation.y ?? 0);
    THREE.Object3D.prototype.updateMatrix.call(this);
  };
  chest.position.y = -0.18;
  chest.scale.setScalar(1.4); // fills more of the bubble: from above the chest is what has to read
  g.add(chest);
  const glow = new THREE.Sprite(b.glow);
  glow.scale.setScalar(1.7);
  glow.position.y = 0.15;
  g.add(glow);
  const bubble = new THREE.Mesh(b.sphere, b.bubble);
  bubble.renderOrder = 2; // after the chest, so the film draws over it
  g.add(bubble);
  g.userData.flash = flash;
  return g;
}
