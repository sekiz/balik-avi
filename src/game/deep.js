/**
 * The deep-sea room's set (docs/PROGRESSION.md §6): almost no sunlight reaches it, so the light
 * comes from the scene itself — hydrothermal chimneys glowing orange at their mouths, clusters of
 * red-plumed tube worms around them and blue bioluminescent sea pens along the edges. All on the
 * edges of the field, static, merged per material (the glow is emissive, so the bloom picks it up).
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { makeRng, triplanar } from "../materials.js";
import { kitMaterial } from "./kit.js";
import { sandY } from "./wreck.js";

function tag(o, t) {
  o.userData.tag = t;
  return o;
}

export function buildDeep(parent, { caustics }) {
  const rng = makeRng(5150);
  const root = tag(new THREE.Group(), "deep");
  root.visible = false;
  parent.add(root);

  const basalt = caustics(triplanar(kitMaterial({ kind: "stone", seed: 81, palette: [0x2a2c34, 0x464a56, 0x6a6e7c], repeat: 1, bumpScale: 1.6 }), { scale: 0.4 }), 0.3);
  // the stone catches the glow of the throats above it (a faint warm self-light, so it shows in the dark)
  basalt.emissive = new THREE.Color(0x1a0a04);
  // the chimney mouths: molten orange that fades into the stone (an emissive map, so it blooms)
  const ember = kitMaterial({ kind: "stone", seed: 82, palette: [0x3a1206, 0xc0400a, 0xffa030], roughness: 0.6 });
  ember.emissive = new THREE.Color(0xff6a1a);
  ember.emissiveMap = ember.map;
  ember.emissiveIntensity = 1.4;
  const tubeMat = kitMaterial({ kind: "chitin", seed: 83, palette: [0xb8b0a0, 0xe0d8c8, 0xf4f0e6], roughness: 0.5 });
  const plume = kitMaterial({ kind: "chitin", seed: 84, palette: [0x8a0a1a, 0xe01a2a, 0xff6a6a], roughness: 0.4 });
  plume.emissive = new THREE.Color(0xa01020);
  plume.emissiveMap = plume.map;
  const pen = kitMaterial({ kind: "chitin", seed: 85, palette: [0x0a3a5a, 0x1a8ab0, 0x7ae8ff], roughness: 0.3 });
  pen.emissive = new THREE.Color(0x2ad0ff);
  pen.emissiveMap = pen.map;
  pen.emissiveIntensity = 1.6;
  for (const m of [ember, tubeMat, plume, pen]) m.fog = false; // the lights of the deep cut through the dark water

  const parts = new Map();
  const put = (geo, mat, m) => {
    if (!parts.has(mat)) parts.set(mat, []);
    parts.get(mat).push(geo.clone().applyMatrix4(m));
  };
  const M = (x, y, z, ry = 0, s = 1, sy = s) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(s, sy, s));

  // ── hydrothermal chimneys: lumpy stacked stone, a glowing throat at the top ──
  const chimneyProf = [[0, 0], [1.1, 0], [1.0, 0.6], [0.8, 1.2], [0.85, 1.7], [0.6, 2.4], [0.65, 2.9], [0.45, 3.4], [0.5, 3.7], [0.3, 3.75], [0.28, 3.4]].map(([r, y]) => new THREE.Vector2(r, y));
  const chimney = new THREE.LatheGeometry(chimneyProf, 14);
  const cp = chimney.attributes.position;
  for (let i = 0; i < cp.count; i++) {
    const n = 1 + Math.sin(cp.getY(i) * 5 + Math.atan2(cp.getZ(i), cp.getX(i)) * 3) * 0.08;
    cp.setX(i, cp.getX(i) * n);
    cp.setZ(i, cp.getZ(i) * n);
  }
  chimney.computeVertexNormals();
  const throat = new THREE.CylinderGeometry(0.3, 0.26, 0.4, 12).translate(0, 3.55, 0);
  const vents = [[-14.8, -7.5, 1.9], [-15.6, 4.5, 1.6], [15.0, -5.5, 1.8], [15.6, 6.5, 1.5]];
  for (const [x, z, s] of vents) {
    const at = M(x, sandY(x, z) - 0.2, z, rng() * 6, s);
    put(chimney, basalt, at);
    put(throat, ember, at);
    // a smaller side chimney leaning on it
    const side = M(x + (x < 0 ? 1.4 : -1.4), sandY(x, z) - 0.2, z + 1.1, rng() * 6, s * 0.55);
    put(chimney, basalt, side);
    put(throat, ember, side);
  }

  // ── tube worms around the chimneys: white tubes, red plumes ──
  const tube = new THREE.CylinderGeometry(0.07, 0.09, 1, 7).translate(0, 0.5, 0);
  const plumeGeo = new THREE.SphereGeometry(0.16, 8, 6).scale(1, 1.4, 1).translate(0, 1.05, 0);
  for (const [vx, vz] of vents) {
    for (let i = 0; i < 18; i++) {
      const a = rng() * Math.PI * 2;
      const d = 1.2 + rng() * 1.8;
      const x = vx + Math.cos(a) * d;
      const z = vz + Math.sin(a) * d;
      const h = 0.8 + rng() * 1.6;
      const at = M(x, sandY(x, z) - 0.05, z, 0, 1, h).multiply(new THREE.Matrix4().makeRotationX((rng() - 0.5) * 0.4));
      put(tube, tubeMat, at);
      put(plumeGeo, plume, at.clone().multiply(new THREE.Matrix4().makeScale(1, 1 / h, 1)).multiply(new THREE.Matrix4().makeTranslation(0, h - 1, 0)));
    }
  }

  // ── bioluminescent sea pens along the edges: thin glowing quills ──
  const quill = new THREE.ConeGeometry(0.12, 1.4, 6).translate(0, 0.7, 0);
  for (let i = 0; i < 46; i++) {
    const left = i % 2 === 0;
    const x = (left ? -1 : 1) * (12.5 + rng() * 5);
    const z = -11 + rng() * 21;
    const at = M(x, sandY(x, z) - 0.05, z, rng() * 6, 0.8 + rng() * 0.7, 0.7 + rng() * 1.1).multiply(new THREE.Matrix4().makeRotationZ((rng() - 0.5) * 0.5));
    put(quill, pen, at);
  }

  for (const [mat, geos] of parts) root.add(new THREE.Mesh(mergeGeometries(geos), mat));
  return { root };
}
