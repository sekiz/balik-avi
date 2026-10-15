/**
 * The shipwreck room's set (docs/PROGRESSION.md §6): a hull half sunk in the sand on the left, its
 * broken stern showing bare ribs, a fallen mast with a torn sail across the top, an anchor and its
 * chain on the right, barrels, a ship's cannon and spilled gold. Everything stands on the edges of
 * the field (the open middle stays for the fish), static, merged per material.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { makeRng, triplanar, weather } from "../materials.js";
import { kitMaterial } from "./kit.js";

/** The sand's height at (x, z): the same field world.js lays the seabed with (it rises at the edges). */
export function sandY(x, z) {
  const edge = Math.max(0, Math.abs(x) - 13) * 0.35 + Math.max(0, -z - 9) * 0.3;
  return Math.sin(x * 0.35) * 0.2 + Math.cos(z * 0.5 + x * 0.1) * 0.25 + edge;
}

function tag(o, t) {
  o.userData.tag = t;
  return o;
}

/** A torn sail: weathered canvas with holes and a ragged lower edge (alpha). */
function sailTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  const rng = makeRng(77);
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#c9b896");
  grad.addColorStop(1, "#8a7a5a");
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = "rgba(60,45,25,0.35)";
  g.lineWidth = 2;
  for (let x = 16; x < 256; x += 32) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x + (rng() - 0.5) * 6, 256);
    g.stroke();
  }
  // grime blotches
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(40,55,35,${0.1 + rng() * 0.2})`;
    g.beginPath();
    g.arc(rng() * 256, rng() * 256, 6 + rng() * 22, 0, Math.PI * 2);
    g.fill();
  }
  // holes and a ragged hem
  g.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 9; i++) {
    g.beginPath();
    g.ellipse(rng() * 256, 40 + rng() * 180, 6 + rng() * 18, 4 + rng() * 12, rng() * 3, 0, Math.PI * 2);
    g.fill();
  }
  g.beginPath();
  g.moveTo(0, 256);
  for (let x = 0; x <= 256; x += 16) g.lineTo(x, 200 + rng() * 56);
  g.lineTo(256, 256);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A barrel: bulged staves (lathe) with two iron hoops, about 1.2 units tall, standing on y = 0. */
function barrelGeos() {
  const prof = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    prof.push(new THREE.Vector2(0.42 + 0.1 * Math.sin(Math.PI * t), t * 1.2));
  }
  prof.unshift(new THREE.Vector2(0, 0));
  prof.push(new THREE.Vector2(0, 1.2));
  const staves = new THREE.LatheGeometry(prof, 18);
  const hoops = mergeGeometries(
    [0.22, 0.98].map((y) => new THREE.TorusGeometry(0.47 + 0.08 * Math.sin(Math.PI * (y / 1.2)), 0.035, 6, 24).rotateX(Math.PI / 2).translate(0, y, 0)),
  );
  return { staves, hoops };
}

/**
 * Builds the set into `parent` (hidden until the wreck room opens) and returns its materials, so
 * the world can add caustics to them like to the reef.
 */
export function buildWreck(parent, { caustics }) {
  const rng = makeRng(9090);
  const root = tag(new THREE.Group(), "wreck");
  root.visible = false;
  parent.add(root);

  const wood = caustics(
    weather(triplanar(kitMaterial({ kind: "wood", seed: 61, palette: [0x4a3220, 0x6e4c30, 0x94704a], repeat: 1, bumpScale: 1.2 }), { scale: 0.5 }), { dirt: 0.3, moss: 0.5, edgeWear: 0.3, seed: 6 }),
    0.5,
  );
  // the hull is an open shell seen from above: its inner face must draw too
  wood.side = THREE.DoubleSide;
  const darkWood = caustics(triplanar(kitMaterial({ kind: "wood", seed: 62, palette: [0x2e1e12, 0x4a3222, 0x664630], repeat: 1 }), { scale: 0.6 }), 0.4);
  const rust = caustics(kitMaterial({ kind: "metal", seed: 63, palette: [0x3a1e10, 0x6a3a1c, 0x8a5a32], metalness: 0.6, roughness: 0.75 }), 0.4);
  const iron = caustics(kitMaterial({ kind: "metal", seed: 64, palette: [0x15181c, 0x262b31, 0x3a4048], metalness: 0.7, roughness: 0.5 }), 0.4);
  const gold = kitMaterial({ kind: "metal", seed: 65, palette: [0x8a5a00, 0xd9a520, 0xffe08a], metalness: 0.9, roughness: 0.28, envMapIntensity: 1.3 });
  gold.emissive = new THREE.Color(0x3a2400);
  const sail = new THREE.MeshStandardMaterial({ map: sailTexture(), transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.9 });

  const parts = new Map(); // material -> geometries (world space), merged at the end
  const put = (geo, mat, m) => {
    if (!parts.has(mat)) parts.set(mat, []);
    parts.get(mat).push(geo.clone().applyMatrix4(m));
  };
  const M = (x, y, z, rx = 0, ry = 0, rz = 0, s = 1) =>
    new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(s, s, s));

  // ── the hull: an open half-shell along x, tapered to a bow, listing and half buried ──
  const hullLen = 12;
  // theta π…2π is the half with x ≤ 0, which rotateZ(90°) turns into the lower half: open to the sky
  const hull = new THREE.CylinderGeometry(2.7, 2.7, hullLen, 26, 18, true, Math.PI, Math.PI);
  hull.rotateZ(Math.PI / 2); // axis along x
  const hp = hull.attributes.position;
  for (let i = 0; i < hp.count; i++) {
    const x = hp.getX(i);
    const k = x / (hullLen / 2); // -1 stern … 1 bow
    const taper = k > 0 ? 1 - k ** 2.2 : 1 - 0.25 * k * k; // pointed bow, broad stern
    hp.setY(i, hp.getY(i) * taper);
    hp.setZ(i, hp.getZ(i) * taper * 0.85);
    // plank seams as small ridges
    hp.setZ(i, hp.getZ(i) + Math.sin(hp.getY(i) * 9) * 0.03);
  }
  hull.computeVertexNormals();
  // along the left edge, bow toward the top of the screen, listing toward the field
  // list about its own long axis first, then turn it (Euler YXZ): the whole length sits level
  const hullAt = new THREE.Matrix4().compose(
    new THREE.Vector3(-15.2, sandY(-15.2, -1) + 2.5, -1), // keel just in the sand, the open shell above it
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0.45, 1.35, 0, "YXZ")),
    new THREE.Vector3(1, 1, 1),
  );
  put(hull, wood, hullAt);
  // keel and gunwale rails
  put(new THREE.BoxGeometry(hullLen * 0.95, 0.3, 0.35).translate(0, -2.6, 0), darkWood, hullAt);
  for (const side of [1, -1]) put(new THREE.BoxGeometry(hullLen * 0.8, 0.26, 0.32).translate(-0.6, 0.05, side * 2.3), darkWood, hullAt);
  // thwarts across the open hull: from above they make it read as a boat's inside, not a trough
  for (const [x, w] of [[-3.6, 4.6], [-0.4, 4.7], [2.6, 3.9]]) put(new THREE.BoxGeometry(0.42, 0.18, w).translate(x, -0.55, 0), darkWood, hullAt);
  // a few planks sprung loose from the side, lying across the rail
  for (const [x, a] of [[-1.9, 0.5], [1.1, -0.35]]) put(new THREE.BoxGeometry(2.6, 0.08, 0.36).rotateY(a).translate(x, 0.02, 1.9), wood, hullAt);
  // the broken stern: bare ribs standing past the end of the planking
  for (let i = 0; i < 4; i++) {
    const rib = new THREE.TorusGeometry(2.55 - i * 0.05, 0.13, 6, 16, Math.PI * (0.75 - i * 0.12)).rotateY(Math.PI / 2).rotateX(Math.PI / 2 + Math.PI * (0.125 + i * 0.06));
    put(rib, darkWood, hullAt.clone().multiply(M(-hullLen / 2 - 0.7 - i * 0.9, -0.1, 0)));
  }
  // a stump of the mainmast inside the hull
  put(new THREE.CylinderGeometry(0.28, 0.34, 3.2, 12).translate(0, 1.2, 0), darkWood, hullAt.clone().multiply(M(1.5, -0.6, 0, 0, 0, -0.3)));

  // ── the fallen mast and yard across the top edge, the torn sail draped between ──
  const mastAt = M(4, sandY(4, -11.6) + 0.35, -11.6, 0, 0.18, Math.PI / 2 - 0.06);
  put(new THREE.CylinderGeometry(0.4, 0.5, 17, 14), darkWood, mastAt);
  put(new THREE.CylinderGeometry(0.22, 0.22, 7.5, 10).rotateX(Math.PI / 2), darkWood, mastAt.clone().multiply(M(0, 3.5, 0)));
  const sailGeo = new THREE.PlaneGeometry(7, 5, 8, 6);
  const sp = sailGeo.attributes.position;
  for (let i = 0; i < sp.count; i++) sp.setZ(i, Math.sin(sp.getX(i) * 0.9) * 0.4 + Math.cos(sp.getY(i) * 1.3) * 0.3);
  sailGeo.computeVertexNormals();
  put(sailGeo, sail, M(5.5, sandY(5.5, -10.2) + 0.45, -10.2, -Math.PI / 2 + 0.12, 0, 0.25));

  // ── the anchor and chain, bottom right ──
  const anchorAt = M(13.8, sandY(13.8, 9.2) + 0.25, 9.2, Math.PI / 2 - 0.1, 0, 0.9, 1.35);
  const anchor = [
    new THREE.CylinderGeometry(0.13, 0.13, 3, 10),
    new THREE.TorusGeometry(0.32, 0.08, 8, 18).translate(0, 1.75, 0),
    new THREE.CylinderGeometry(0.09, 0.09, 1.6, 8).rotateZ(Math.PI / 2).translate(0, 1.15, 0), // stock
    new THREE.TorusGeometry(1.05, 0.12, 8, 24, Math.PI).rotateZ(Math.PI).translate(0, -0.45, 0), // arms
  ];
  for (const side of [1, -1]) anchor.push(new THREE.ConeGeometry(0.28, 0.6, 4).rotateZ(side * 0.6).translate(side * 1.05, -0.2, 0)); // flukes
  for (const g of anchor) put(g, rust, anchorAt);
  // chain: links along a sagging line from the anchor ring off to the right edge
  const link = new THREE.TorusGeometry(0.2, 0.06, 6, 12);
  const ringWorld = new THREE.Vector3(0, 1.75, 0).applyMatrix4(anchorAt);
  const chainEnd = new THREE.Vector3(21, 0.3, 4);
  const chainCurve = new THREE.QuadraticBezierCurve3(ringWorld, new THREE.Vector3((ringWorld.x + chainEnd.x) / 2, 0.2, (ringWorld.z + chainEnd.z) / 2 + 1.2), chainEnd);
  const links = 22;
  for (let i = 0; i < links; i++) {
    const t = i / (links - 1);
    const p = chainCurve.getPointAt(t);
    const d = chainCurve.getTangentAt(t);
    const yaw = Math.atan2(-d.z, d.x);
    put(link, iron, M(p.x, Math.max(sandY(p.x, p.z) + 0.1, p.y), p.z, i % 2 ? Math.PI / 2 : 0, yaw, 0).multiply(new THREE.Matrix4().makeScale(1.3, 1, 1)));
  }

  // ── barrels (some standing, some on their side), a ship's cannon, spilled gold ──
  const { staves, hoops } = barrelGeos();
  const barrels = [
    [-11.5, -10.6, 0, 0], [-10.2, -11.4, 0, 1.2], [14.2, -3.2, Math.PI / 2, 0.4], [-13.6, 8.4, Math.PI / 2, 2.1], [10.8, 10.2, 0, 0.3],
  ];
  for (const [x, z, tip, ry] of barrels) {
    const at = M(x, sandY(x, z) + (tip ? 0.45 : -0.05), z, 0, ry, tip);
    put(staves, wood, at);
    put(hoops, rust, at);
  }
  const cannonProf = [[0, 0], [0.34, 0], [0.34, 0.15], [0.27, 0.3], [0.22, 1.9], [0.27, 2.0], [0.2, 2.05], [0.12, 1.95], [0, 1.95]].map(([r, y]) => new THREE.Vector2(r, y));
  const cannonAt = M(-12.8, sandY(-12.8, 9.6) + 0.4, 9.6, 0, -0.7, Math.PI / 2 - 0.15);
  put(new THREE.LatheGeometry(cannonProf, 16), iron, cannonAt);
  for (const side of [1, -1]) put(new THREE.CylinderGeometry(0.42, 0.42, 0.12, 14).rotateX(Math.PI / 2).translate(0.25, 0.2, side * 0.42), darkWood, cannonAt);
  const coin = new THREE.CylinderGeometry(0.16, 0.16, 0.04, 12);
  for (let i = 0; i < 46; i++) {
    // two spills: out of the hull's breach, and around the cannon
    const [cx, cz, r] = i < 30 ? [-11.4, 4.2, 2.0] : [-11.6, 8.8, 1.4];
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * r;
    const x = cx + Math.cos(a) * d;
    const z = cz + Math.sin(a) * d * 0.7;
    put(coin, gold, M(x, sandY(x, z) + 0.06 + rng() * 0.1, z, (rng() - 0.5) * 0.4, rng() * 3, (rng() - 0.5) * 0.4));
  }

  for (const [mat, geos] of parts) root.add(new THREE.Mesh(mergeGeometries(geos), mat));
  return { root, materials: [wood, darkWood, rust, iron, gold, sail] };
}
