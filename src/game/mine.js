/**
 * The sea mine (docs/PROGRESSION.md §4, config MINE): a rusty iron sphere with contact horns, a
 * broken chain stub below and a red light that blinks with the swim clock. About 2 units across
 * like the fish models (the caller scales it); the hit flash lights it through `flash.value`.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { kitMaterial } from "./kit.js";
import { swimTime } from "./fishmodels.js";

let base = null;
function shared() {
  if (base) return base;
  const horn = new THREE.CylinderGeometry(0.07, 0.1, 0.32, 8).translate(0, 0.86, 0);
  const cap = new THREE.SphereGeometry(0.09, 8, 6).translate(0, 1.03, 0);
  const horns = [];
  // horns spread over the sphere by the golden angle
  for (let i = 0; i < 16; i++) {
    const y = 1 - ((i + 0.5) / 16) * 2;
    const r = Math.sqrt(1 - y * y);
    const a = i * 2.39996;
    const dir = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    for (const g of [horn, cap]) horns.push(g.clone().applyQuaternion(q));
  }
  const links = [];
  for (let i = 0; i < 4; i++) {
    const link = new THREE.TorusGeometry(0.11, 0.035, 6, 12);
    if (i % 2) link.rotateY(Math.PI / 2);
    links.push(link.translate(0, -0.95 - i * 0.17, 0));
  }
  base = {
    iron: kitMaterial({ kind: "metal", seed: 71, palette: [0x2a1a12, 0x4a3020, 0x6e4a30], metalness: 0.6, roughness: 0.7 }),
    brass: kitMaterial({ kind: "metal", seed: 72, palette: [0x6a4a1a, 0xa8782a, 0xd8a848], metalness: 0.85, roughness: 0.4 }),
    sphere: new THREE.SphereGeometry(0.8, 28, 18),
    band: new THREE.TorusGeometry(0.81, 0.05, 8, 40).rotateX(Math.PI / 2),
    horns: mergeGeometries(horns),
    chain: mergeGeometries(links),
    light: new THREE.SphereGeometry(0.12, 12, 8).translate(0, 0.62, 0.48),
  };
  base.iron.fog = false;
  base.brass.fog = false;
  // the warning light blinks twice a second on the shared swim clock (no per-frame JS)
  base.lightMat = new THREE.MeshBasicMaterial({ color: 0xff2a1a, toneMapped: false, fog: false });
  base.lightMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = swimTime;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;")
      .replace("#include <dithering_fragment>", "#include <dithering_fragment>\ngl_FragColor.rgb *= 0.25 + 2.5 * step(0.5, fract(uTime * 2.0));");
  };
  return base;
}

export function buildMine(flash) {
  const b = shared();
  // per-mine copies so the hit flash lights only this one
  const iron = b.iron.clone();
  const brass = b.brass.clone();
  iron.emissive = flash.value;
  brass.emissive = flash.value;
  const g = new THREE.Group();
  g.add(new THREE.Mesh(b.sphere, iron));
  g.add(new THREE.Mesh(b.band, brass));
  g.add(new THREE.Mesh(b.horns, brass));
  g.add(new THREE.Mesh(b.chain, iron));
  g.add(new THREE.Mesh(b.light, b.lightMat));
  g.userData.flash = flash;
  return g;
}
