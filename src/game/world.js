/** The aquarium: sandy seabed with moving caustics, rocks, corals, swaying kelp, light shafts, bubbles. */
import * as THREE from "three";
import { bakeTexture, makeRng, triplanar } from "../materials.js";
import { kitMaterial } from "./kit.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { swimTime } from "./fishmodels.js";
import { buildWreck } from "./wreck.js";
import { buildDeep } from "./deep.js";

function tag(o, t) {
  o.userData.tag = t;
  return o;
}

/**
 * Draw-call budget: a static prop group of hundreds of meshes becomes one mesh per material.
 * Safe for every material here that works in world space (caustics, triplanar stone); animated
 * kelp / anemones use `instanceGroup` instead because their shaders read per-object phase.
 */
function mergeStatic(group) {
  group.updateMatrixWorld(true);
  const buckets = new Map();
  group.traverse((o) => {
    if (!o.isMesh) return;
    const list = buckets.get(o.material) ?? [];
    list.push(o);
    buckets.set(o.material, list);
  });
  for (const child of [...group.children]) group.remove(child);
  for (const [material, meshes] of buckets) {
    const geos = meshes.map((m) => {
      let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      for (const name of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(name)) g.deleteAttribute(name);
      g.applyMatrix4(m.matrixWorld);
      return g;
    });
    const merged = new THREE.Mesh(mergeGeometries(geos, false), material);
    merged.frustumCulled = false;
    group.add(merged);
    for (const g of geos) g.dispose();
  }
}

/** Same idea for meshes whose shader needs a per-object matrix: one InstancedMesh per geometry+material. */
function instanceGroup(group) {
  group.updateMatrixWorld(true);
  const buckets = new Map();
  group.traverse((o) => {
    if (!o.isMesh) return;
    const key = `${o.geometry.uuid}|${o.material.uuid}`;
    const b = buckets.get(key) ?? { geo: o.geometry, mat: o.material, mats: [] };
    b.mats.push(o.matrixWorld.clone());
    buckets.set(key, b);
  });
  for (const child of [...group.children]) group.remove(child);
  for (const { geo, mat, mats } of buckets.values()) {
    const im = new THREE.InstancedMesh(geo, mat, mats.length);
    mats.forEach((m, i) => im.setMatrixAt(i, m));
    im.instanceMatrix.needsUpdate = true;
    im.frustumCulled = false;
    group.add(im);
  }
}

const WORLD_MATRIX = `#ifdef USE_INSTANCING
        mat4 wm = modelMatrix * instanceMatrix;
        #else
        mat4 wm = modelMatrix;
        #endif`;

/** Tileable Voronoi-edge texture: bright thin cell borders, the shape of real caustic light. */
let causticTex = null;
function causticTexture() {
  if (causticTex) return causticTex;
  const N = 256;
  const c = document.createElement("canvas");
  c.width = c.height = N;
  const g = c.getContext("2d");
  const img = g.createImageData(N, N);
  const rng = makeRng(1234);
  const pts = Array.from({ length: 22 }, () => [rng() * N, rng() * N]);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let f1 = 1e9;
      let f2 = 1e9;
      for (const [px, py] of pts) {
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const dx = x - (px + ox * N);
            const dy = y - (py + oy * N);
            const d = dx * dx + dy * dy;
            if (d < f1) {
              f2 = f1;
              f1 = d;
            } else if (d < f2) f2 = d;
          }
        }
      }
      const e = Math.sqrt(f2) - Math.sqrt(f1); // 0 on the cell edge
      const v = Math.max(0, 1 - e / 9) ** 2.2;
      const i = (y * N + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(v * 255);
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  causticTex = new THREE.CanvasTexture(c);
  causticTex.wrapS = causticTex.wrapT = THREE.RepeatWrapping;
  return causticTex;
}

/** Add animated caustics (two drifting Voronoi layers, min-combined) to a lit material. */
/** How much sunlight reaches the floor: scales every caustic (the deep room turns it nearly off). */
const causticLevel = { value: 1 };

function caustics(material, strength = 0.55) {
  const prev = material.onBeforeCompile;
  const tex = causticTexture();
  material.onBeforeCompile = (shader, r) => {
    prev?.(shader, r);
    shader.uniforms.uTime = swimTime;
    shader.uniforms.uCaustic = { value: tex };
    shader.uniforms.uCausticLevel = causticLevel;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWorldC;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvWorldC = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vWorldC;
        uniform float uTime;
        uniform sampler2D uCaustic;
        uniform float uCausticLevel;`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        vec2 cuv = vWorldC.xz * 0.11;
        float ca = texture2D(uCaustic, cuv + vec2(uTime * 0.021, uTime * 0.013)).r;
        float cb = texture2D(uCaustic, cuv * 1.27 + vec2(-uTime * 0.017, uTime * 0.024) + 0.37).r;
        float cst = min(ca, cb) * 1.6 + ca * cb * 0.8;
        totalEmissiveRadiance += vec3(0.75, 0.95, 1.0) * cst * ${strength.toFixed(2)} * uCausticLevel * (0.05 + diffuseColor.rgb * 0.9);`,
      );
  };
  material.customProgramCacheKey = () => `caustic${strength}${material.userData.triplanar ? "t" : ""}`;
  return material;
}

function seaweedTexture() {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 256;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 256, 0, 0);
  grad.addColorStop(0, "#1f4d1a");
  grad.addColorStop(1, "#5fae3a");
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(26, 256);
  for (let y = 256; y >= 0; y -= 16) g.lineTo(32 + Math.sin(y * 0.08) * 6 - 12 * (y / 256), y);
  for (let y = 0; y <= 256; y += 16) g.lineTo(32 + Math.sin(y * 0.08) * 6 + 14 * (y / 256) + 6, y);
  g.fill();
  g.strokeStyle = "rgba(200,255,150,0.35)";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(32, 256);
  g.lineTo(32, 0);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function shaftTexture() {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 256;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 64, 0);
  grad.addColorStop(0, "rgba(255,255,255,0)");
  grad.addColorStop(0.5, "rgba(255,255,255,1)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 256);
  const fade = g.createLinearGradient(0, 0, 0, 256);
  fade.addColorStop(0, "rgba(255,255,255,1)");
  fade.addColorStop(1, "rgba(255,255,255,0)");
  g.globalCompositeOperation = "destination-in";
  g.fillStyle = fade;
  g.fillRect(0, 0, 64, 256);
  return new THREE.CanvasTexture(c);
}

export function bubbleTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 10, 32, 32, 30);
  grad.addColorStop(0, "rgba(255,255,255,0.05)");
  grad.addColorStop(0.8, "rgba(200,240,255,0.35)");
  grad.addColorStop(1, "rgba(255,255,255,0.9)");
  g.fillStyle = grad;
  g.beginPath();
  g.arc(32, 32, 30, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "rgba(255,255,255,0.9)";
  g.beginPath();
  g.arc(22, 22, 6, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Kelp sway: bend increasing with height. */
function sway(material) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = swimTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        float hgt = clamp(position.y / 4.0, 0.0, 1.0);
        ${WORLD_MATRIX}
        float ph = wm[3].x * 0.7 + wm[3].z * 0.4;
        transformed.x += sin(uTime * 1.3 + ph + position.y * 0.9) * 0.45 * hgt * hgt;
        transformed.z += cos(uTime * 1.1 + ph) * 0.25 * hgt * hgt;`,
      );
  };
  material.customProgramCacheKey = () => "kelp";
  return material;
}


/** Canvas texture helper. */
function canvasTex(w, h, paint, { repeat = 1, srgb = true } = {}) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  paint(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  return t;
}

/** Bumpy brain-coral texture: meandering grooves. */
function brainTexture(base, groove) {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = groove;
    g.lineWidth = 5;
    const r = makeRng(77);
    for (let i = 0; i < 40; i++) {
      g.beginPath();
      let x = r() * w;
      let y = r() * h;
      g.moveTo(x, y);
      for (let k = 0; k < 14; k++) {
        x += (r() - 0.5) * 40;
        y += (r() - 0.5) * 40;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  });
}

/** Sea-fan lattice with alpha. */
function fanTexture(col) {
  return canvasTex(256, 256, (g, w, h) => {
    g.strokeStyle = col;
    g.lineCap = "round";
    const r = makeRng(5);
    function br(x, y, a, len, wdt, d) {
      const x2 = x + Math.cos(a) * len;
      const y2 = y - Math.sin(a) * len;
      g.lineWidth = wdt;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x2, y2);
      g.stroke();
      if (d > 0) {
        br(x2, y2, a + 0.35 + r() * 0.2, len * 0.78, wdt * 0.72, d - 1);
        br(x2, y2, a - 0.35 - r() * 0.2, len * 0.78, wdt * 0.72, d - 1);
      }
    }
    br(w / 2, h, Math.PI / 2, 60, 9, 6);
    g.lineWidth = 1.5;
    g.globalAlpha = 0.55;
    for (let y = 20; y < h; y += 9) {
      g.beginPath();
      g.moveTo(20, y);
      g.lineTo(w - 20, y + 4);
      g.stroke();
    }
    g.globalCompositeOperation = "destination-in";
    g.globalAlpha = 1;
    const grad = g.createRadialGradient(w / 2, h, 10, w / 2, h, w * 0.62);
    grad.addColorStop(0, "#fff");
    grad.addColorStop(0.9, "#fff");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  }, { repeat: 1 });
}

function starfishTexture(col) {
  return canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = col;
    g.fillRect(0, 0, w, h);
    g.fillStyle = "rgba(255,255,255,0.55)";
    const r = makeRng(9);
    for (let i = 0; i < 120; i++) {
      g.beginPath();
      g.arc(r() * w, r() * h, 1 + r() * 2.2, 0, Math.PI * 2);
      g.fill();
    }
  });
}

function sandTexture() {
  // warm sand with ripples and grain; tiling
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = "#b9a57c";
    g.fillRect(0, 0, w, h);
    const r = makeRng(31);
    for (let i = 0; i < 9000; i++) {
      const v = 120 + r() * 90;
      g.fillStyle = `rgba(${v},${v * 0.9},${v * 0.68},${0.25 + r() * 0.3})`;
      g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
    }
    g.strokeStyle = "rgba(90,70,40,0.18)";
    g.lineWidth = 6;
    for (let y = -20; y < h + 20; y += 26) {
      g.beginPath();
      for (let x = 0; x <= w; x += 8) g.lineTo(x, y + Math.sin((x / w) * Math.PI * 4 + y * 0.05) * 7);
      g.stroke();
    }
    g.strokeStyle = "rgba(255,245,220,0.16)";
    g.lineWidth = 3;
    for (let y = -14; y < h + 20; y += 26) {
      g.beginPath();
      for (let x = 0; x <= w; x += 8) g.lineTo(x, y + Math.sin((x / w) * Math.PI * 4 + y * 0.05) * 7);
      g.stroke();
    }
  }, { repeat: 7 });
}

function shellTexture() {
  return canvasTex(128, 128, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, "#f7d9c4");
    grad.addColorStop(1, "#e89a7a");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "rgba(150,70,50,0.6)";
    g.lineWidth = 3;
    for (let x = 6; x < w; x += 12) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, h);
      g.stroke();
    }
  });
}

/** Anemone tentacle sway + glowing tips (emissive by height). */
function anemoneMat(color, tip) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, map: canvasTex(64, 64, (g, w, h) => {
    const grad = g.createLinearGradient(0, h, 0, 0);
    grad.addColorStop(0, color);
    grad.addColorStop(1, tip);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  }), roughness: 0.5, emissive: new THREE.Color(tip), emissiveIntensity: 0.0 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = swimTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;\nvarying float vH;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        float hgt = clamp(position.y / 0.9, 0.0, 1.0);
        vH = hgt;
        ${WORLD_MATRIX}
        float ph = wm[3].x * 1.7 + wm[3].z * 1.3;
        transformed.x += sin(uTime * 1.8 + ph) * 0.18 * hgt * hgt;
        transformed.z += cos(uTime * 1.5 + ph) * 0.14 * hgt * hgt;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vH;")
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * smoothstep(0.75, 1.0, vH) * 1.4;`);
  };
  m.customProgramCacheKey = () => "anemone";
  return m;
}

function lump(rng, detailW = 22, detailH = 16, rough = 0.18) {
  const geo = new THREE.SphereGeometry(1, detailW, detailH);
  const p = geo.attributes.position;
  const k1 = rng() * 10;
  const k2 = rng() * 10;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n =
      0.82 +
      rough * Math.sin(v.x * 2.3 + k1) * Math.cos(v.z * 2.1 - k2) +
      rough * 0.6 * Math.sin(v.y * 4.1 + v.x * 3.3 + k2) +
      rough * 0.3 * Math.sin(v.z * 7.7 + k1);
    v.multiplyScalar(n);
    if (v.y < 0) v.y *= 0.3;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

export function buildWorld(scene) {
  const rng = makeRng(4242);
  scene.background = new THREE.Color(0x05304f);
  // fish materials opt out of fog (fishmodels.js swimify): the haze stays on the reef and sand
  scene.fog = new THREE.Fog(0x0a5a86, 14, 50);

  const hemi = new THREE.HemisphereLight(0x8fd8ff, 0x0a2238, 0.85);
  hemi.userData.tag = "light-fill";
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d0, 2.4);
  sun.position.set(-10, 30, -6);
  sun.userData.tag = "light-key";
  scene.add(sun);
  const bounce = new THREE.DirectionalLight(0x3fb8ff, 0.6);
  bounce.position.set(8, 6, 14);
  bounce.userData.tag = "light-rim";
  scene.add(bounce);

  const root = tag(new THREE.Group(), "seabed");
  scene.add(root);

  // ── sand ──
  const sandMap = sandTexture();
  const sandBump = bakeTexture({ kind: "dirt", seed: 11, repeat: 7 }).bumpMap;
  const sandMat = caustics(new THREE.MeshStandardMaterial({ map: sandMap, bumpMap: sandBump, bumpScale: 1.2, roughness: 0.95, color: 0x9fb4b4 }), 1.0);
  const sandGeo = new THREE.PlaneGeometry(90, 64, 120, 90);
  sandGeo.rotateX(-Math.PI / 2);
  const sp = sandGeo.attributes.position;
  for (let i = 0; i < sp.count; i++) {
    const x = sp.getX(i);
    const z = sp.getZ(i);
    const edge = Math.max(0, Math.abs(x) - 13) * 0.35 + Math.max(0, -z - 9) * 0.3;
    sp.setY(i, Math.sin(x * 0.35) * 0.2 + Math.cos(z * 0.5 + x * 0.1) * 0.25 + edge);
  }
  sandGeo.computeVertexNormals();
  root.add(tag(new THREE.Mesh(sandGeo, sandMat), "ground"));

  // ── reef rock formations framing the field ──
  const rockMat = caustics(
    triplanar(kitMaterial({ kind: "stone", seed: 5, palette: [0x5a4a3e, 0x7d6c5a, 0x9a8a74], repeat: 1, bumpScale: 1.5 }), { scale: 0.35 }),
    0.6,
  );
  const mossMat = caustics(
    triplanar(kitMaterial({ kind: "moss", seed: 8, palette: [0x2d5a36, 0x3f7a44, 0x7aa858], repeat: 1 }), { scale: 0.45 }),
    0.6,
  );
  const rocks = tag(new THREE.Group(), "rock");
  root.add(rocks);
  // the rocks (and kelp) in front of where the wreck's hull lies: their own group, so the wreck
  // room can clear them away and the hull reads (left edge, z -7 … 6)
  const hullSide = (x, z) => x < -13 && z > -7 && z < 6;
  const rocksHull = tag(new THREE.Group(), "rock");
  root.add(rocksHull);
  const rockGeos = Array.from({ length: 6 }, () => lump(rng));
  // clusters: [x, z, scale, count]
  const clusters = [
    [-17.5, -9, 3.2, 5], [-18.5, -1, 2.6, 4], [-17, 7, 2.8, 4], [17.5, -8.5, 3.3, 5], [18.5, 0.5, 2.6, 4], [17, 7.5, 2.7, 4],
    [-9, -12.5, 2.4, 3], [0, -13, 2.2, 3], [9, -12.5, 2.5, 3], [-11, 10.5, 1.8, 2], [11, 10.5, 1.8, 2],
  ];
  for (const [cx, cz, s, n] of clusters) {
    const into = hullSide(cx, cz) ? rocksHull : rocks;
    for (let i = 0; i < n; i++) {
      const rock = new THREE.Mesh(rockGeos[Math.floor(rng() * rockGeos.length)], rockMat);
      const sc = s * (0.45 + rng() * 0.6);
      rock.position.set(cx + (rng() - 0.5) * s * 1.6, sc * 0.2, cz + (rng() - 0.5) * s * 1.4);
      rock.scale.set(sc * (1 + rng() * 0.5), sc * (0.55 + rng() * 0.5), sc);
      rock.rotation.y = rng() * 6;
      into.add(rock);
      if (rng() < 0.55) {
        const cap = new THREE.Mesh(rock.geometry, mossMat);
        cap.position.copy(rock.position).add(new THREE.Vector3(0, rock.scale.y * 0.35, 0));
        cap.scale.set(rock.scale.x * 0.8, rock.scale.y * 0.45, rock.scale.z * 0.8);
        cap.rotation.copy(rock.rotation);
        into.add(cap);
      }
    }
  }

  // ── corals ──
  const coralCols = [
    [0xff4f7a, 0xff8fae, 0xc22a55],
    [0xff8a1c, 0xffb45a, 0xd25e0a],
    [0xa66bff, 0xcaa2ff, 0x7a3ce0],
    [0x22d6c0, 0x7af2e0, 0x0fa08c],
    [0xffd23a, 0xfff08a, 0xd9a20a],
  ];
  const coralMats = coralCols.map((pal, i) => {
    const m = caustics(kitMaterial({ kind: "chitin", seed: 20 + i, palette: pal, repeat: 1, roughness: 0.55 }), 0.4);
    m.emissive = new THREE.Color(pal[0]).multiplyScalar(0.12);
    return m;
  });
  const corals = tag(new THREE.Group(), "coral");
  root.add(corals);
  function branch(parent, start, dir, len, rad, depth, mat) {
    const end = start.clone().addScaledVector(dir, len);
    const mid = start.clone().lerp(end, 0.5).add(new THREE.Vector3((rng() - 0.5) * 0.3, 0, (rng() - 0.5) * 0.3));
    const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
    parent.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 6, rad, 7), mat));
    const tip = new THREE.Mesh(new THREE.SphereGeometry(rad * 1.2, 8, 6), mat);
    tip.position.copy(end);
    parent.add(tip);
    if (depth <= 0) return;
    const n = 2 + Math.floor(rng() * 2);
    for (let i = 0; i < n; i++) {
      const d = dir.clone().add(new THREE.Vector3((rng() - 0.5) * 1.3, 0.35, (rng() - 0.5) * 1.3)).normalize();
      branch(parent, end, d, len * 0.72, rad * 0.7, depth - 1, mat);
    }
  }
  const brainMats = [
    caustics(new THREE.MeshStandardMaterial({ map: brainTexture("#d98a5a", "#7a3a20"), roughness: 0.7, bumpMap: brainTexture("#ffffff", "#000000"), bumpScale: 2 }), 0.5),
    caustics(new THREE.MeshStandardMaterial({ map: brainTexture("#8ac25a", "#2f5a20"), roughness: 0.7, bumpMap: brainTexture("#ffffff", "#000000"), bumpScale: 2 }), 0.5),
  ];
  const brainGeo = lump(rng, 28, 20, 0.08);
  const tubeMat = caustics(kitMaterial({ kind: "chitin", seed: 44, palette: [0x7a3ce0, 0xb486ff, 0x4a1a9a], repeat: 1 }), 0.4);
  const tubeGeo = new THREE.CylinderGeometry(0.22, 0.3, 1, 14, 1, true);
  tubeGeo.translate(0, 0.5, 0);
  tubeMat.side = THREE.DoubleSide;
  const fanMats = ["#ff5f8a", "#ffb33a", "#b486ff"].map(
    (c) => new THREE.MeshStandardMaterial({ map: fanTexture(c), transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.6 }),
  );
  const fanGeo = new THREE.PlaneGeometry(3, 3);
  fanGeo.translate(0, 1.5, 0);
  const anemones = [anemoneMat("#ff6fa8", "#fff0a0"), anemoneMat("#3fd9ff", "#e0fff8"), anemoneMat("#a66bff", "#ffd0ff")];
  const tentacle = new THREE.CylinderGeometry(0.025, 0.06, 0.9, 6, 4);
  tentacle.translate(0, 0.45, 0);

  // place coral gardens along the reef edges (never in the open middle)
  const edgeSpot = () => {
    const side = rng();
    if (side < 0.38) return [-14 - rng() * 5, -11 + rng() * 21];
    if (side < 0.76) return [14 + rng() * 5, -11 + rng() * 21];
    if (side < 0.92) return [-13 + rng() * 26, -11 - rng() * 2.5];
    return [(rng() < 0.5 ? -1 : 1) * (7 + rng() * 6), 9 + rng() * 2.5];
  };
  for (let i = 0; i < 16; i++) {
    const [x, z] = edgeSpot();
    const g = new THREE.Group();
    branch(g, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0), 1.0 + rng() * 0.6, 0.15, 2, coralMats[i % coralMats.length]);
    g.position.set(x, 0.15, z);
    g.scale.setScalar(1.1 + rng() * 0.7);
    corals.add(g);
  }
  for (let i = 0; i < 12; i++) {
    const [x, z] = edgeSpot();
    const b = new THREE.Mesh(brainGeo, brainMats[i % 2]);
    const s = 0.8 + rng() * 0.9;
    b.position.set(x, s * 0.25, z);
    b.scale.set(s, s * 0.7, s);
    corals.add(b);
  }
  for (let i = 0; i < 8; i++) {
    const [x, z] = edgeSpot();
    const g = new THREE.Group();
    const n = 3 + Math.floor(rng() * 4);
    for (let k = 0; k < n; k++) {
      const t = new THREE.Mesh(tubeGeo, tubeMat);
      t.position.set((rng() - 0.5) * 0.9, 0, (rng() - 0.5) * 0.9);
      t.scale.set(1, 0.8 + rng() * 1.8, 1);
      t.rotation.set((rng() - 0.5) * 0.3, 0, (rng() - 0.5) * 0.3);
      g.add(t);
    }
    g.position.set(x, 0.1, z);
    corals.add(g);
  }
  for (let i = 0; i < 9; i++) {
    const [x, z] = edgeSpot();
    const f = new THREE.Mesh(fanGeo, fanMats[i % fanMats.length]);
    f.position.set(x, 0.1, z);
    f.rotation.set(-0.15, rng() * Math.PI, 0);
    f.scale.setScalar(0.8 + rng() * 0.7);
    corals.add(f);
  }
  const anemoneRoot = tag(new THREE.Group(), "anemone");
  root.add(anemoneRoot);
  for (let i = 0; i < 12; i++) {
    const [x, z] = edgeSpot();
    const g = new THREE.Group();
    const mat = anemones[i % anemones.length];
    for (let k = 0; k < 26; k++) {
      const t = new THREE.Mesh(tentacle, mat);
      const a = k * 2.399;
      const r = 0.12 + (k / 26) * 0.38;
      t.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      t.rotation.set(Math.sin(a) * r * 1.2, 0, -Math.cos(a) * r * 1.2);
      g.add(t);
    }
    g.position.set(x, 0.2, z);
    g.scale.setScalar(1 + rng() * 0.8);
    anemoneRoot.add(g);
  }

  // ── small details on the open sand: starfish, shells, pebbles ──
  const details = tag(new THREE.Group(), "prop");
  root.add(details);
  const starShape = new THREE.Shape();
  for (let k = 0; k <= 10; k++) {
    const a = (k / 10) * Math.PI * 2 + Math.PI / 2;
    const r = k % 2 ? 0.22 : 0.6;
    if (k === 0) starShape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else starShape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const starGeo = new THREE.ExtrudeGeometry(starShape, { depth: 0.08, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 2 });
  starGeo.rotateX(-Math.PI / 2);
  const starMats = ["#ff6a3a", "#ff3f7a", "#ffb02a"].map((c) => new THREE.MeshStandardMaterial({ map: starfishTexture(c), roughness: 0.7 }));
  for (let i = 0; i < 7; i++) {
    const s = new THREE.Mesh(starGeo, starMats[i % 3]);
    s.position.set(-15 + rng() * 30, 0.35, -10 + rng() * 19);
    s.rotation.y = rng() * 6;
    s.scale.setScalar(0.45 + rng() * 0.35);
    details.add(s);
  }
  const shellGeo = new THREE.SphereGeometry(0.35, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  shellGeo.scale(1, 0.45, 1.2);
  const shellMat = new THREE.MeshStandardMaterial({ map: shellTexture(), roughness: 0.4 });
  for (let i = 0; i < 10; i++) {
    const s = new THREE.Mesh(shellGeo, shellMat);
    s.position.set(-16 + rng() * 32, 0.25, -10 + rng() * 20);
    s.rotation.y = rng() * 6;
    details.add(s);
  }
  const pebbleMat = caustics(kitMaterial({ kind: "stone", seed: 66, palette: [0x6a6258, 0x8c8272, 0xa69a86], repeat: 1 }), 0.6);
  const pebbleGeo = lump(rng, 10, 8, 0.15);
  for (let i = 0; i < 60; i++) {
    const s = new THREE.Mesh(pebbleGeo, pebbleMat);
    s.position.set(-17 + rng() * 34, 0.2, -11 + rng() * 22);
    s.scale.set(0.15 + rng() * 0.25, 0.1 + rng() * 0.12, 0.15 + rng() * 0.25);
    details.add(s);
  }

  mergeStatic(rocks);
  mergeStatic(rocksHull);
  mergeStatic(corals);
  mergeStatic(details);
  instanceGroup(anemoneRoot);

  // ── the shipwreck room's set (hidden in the reef) ──
  const wreck = buildWreck(root, { caustics });
  // ── the deep sea room's set (hidden elsewhere) ──
  const deep = buildDeep(root, { caustics });

  // ── kelp ──
  const kelpMat = sway(
    new THREE.MeshStandardMaterial({ map: seaweedTexture(), transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.8 }),
  );
  const kelp = tag(new THREE.Group(), "kelp");
  const kelpHull = tag(new THREE.Group(), "kelp");
  root.add(kelp);
  const kelpGeo = new THREE.PlaneGeometry(0.9, 5, 1, 10);
  kelpGeo.translate(0, 2.5, 0);
  for (let i = 0; i < 40; i++) {
    const side = i % 2 ? 1 : -1;
    const x = side * (15 + rng() * 5);
    const z = -12 + rng() * 23;
    for (let k = 0; k < 3; k++) {
      const blade = new THREE.Mesh(kelpGeo, kelpMat);
      blade.position.set(x + (rng() - 0.5) * 0.8, 0.5, z + (rng() - 0.5) * 0.8);
      blade.rotation.y = rng() * Math.PI;
      blade.scale.set(1, 0.7 + rng() * 0.8, 1);
      (hullSide(x, z) ? kelpHull : kelp).add(blade);
    }
  }
  for (let i = 0; i < 14; i++) {
    const blade = new THREE.Mesh(kelpGeo, kelpMat);
    blade.position.set(-13 + rng() * 26, 0.5, -12.5 - rng() * 2);
    blade.rotation.y = rng() * Math.PI;
    blade.scale.y = 0.8 + rng() * 0.6;
    kelp.add(blade);
  }

  instanceGroup(kelp);
  instanceGroup(kelpHull);
  root.add(kelpHull);

  // ── light shafts ──
  const shaftMat = new THREE.MeshBasicMaterial({
    map: shaftTexture(),
    transparent: true,
    opacity: 0.07,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    color: 0xc8f0ff,
    fog: false,
  });
  const shafts = tag(new THREE.Group(), "lightshaft");
  scene.add(shafts);
  for (let i = 0; i < 8; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2 + rng() * 3, 30), shaftMat);
    m.position.set(-16 + i * 4.4 + rng(), 10, -5 + rng() * 6);
    m.rotation.set(-0.55, 0, 0.32);
    m.userData.phase = rng() * 6;
    shafts.add(m);
  }

  // ── bubbles + drifting plankton motes ──
  // Points, not Sprites: one draw per size class instead of one per bubble. Point size is in
  // world units × 2.6 to match the apparent size a sprite of that scale had at this fov.
  const POINT_K = 2.6;
  const bubbleTex = bubbleTexture();
  const bubbles = tag(new THREE.Group(), "bubble");
  scene.add(bubbles);
  // bubble columns rising from vents in the reef
  const vents = [[-15.5, -5], [16, -2], [-14.5, 6], [15, 8]];
  const bubbleClasses = [0.16, 0.26, 0.37].map((size) => {
    const pts = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({ map: bubbleTex, size: size * POINT_K, sizeAttenuation: true, transparent: true, depthWrite: false, opacity: 0.75 }),
    );
    pts.frustumCulled = false;
    pts.userData.items = [];
    bubbles.add(pts);
    return pts;
  });
  for (let i = 0; i < 48; i++) {
    const v = vents[i % vents.length];
    bubbleClasses[i % 3].userData.items.push({
      x: v[0] + (rng() - 0.5) * 0.6,
      y: rng() * 14,
      z: v[1] + (rng() - 0.5) * 0.6,
      speed: 1.2 + rng() * 1.4,
      phase: rng() * 6,
      vx: v[0],
    });
  }
  for (const pts of bubbleClasses) {
    pts.geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pts.userData.items.length * 3), 3));
  }
  const moteTex = canvasTex(32, 32, (g, w, h) => {
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, "rgba(220,255,255,1)");
    grad.addColorStop(1, "rgba(220,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });
  const moteItems = Array.from({ length: 70 }, () => ({
    x: -18 + rng() * 36,
    y: 1 + rng() * 9,
    z: -11 + rng() * 22,
    phase: rng() * 6,
  }));
  const motes = new THREE.Points(
    new THREE.BufferGeometry(),
    new THREE.PointsMaterial({ map: moteTex, size: 0.14 * POINT_K, sizeAttenuation: true, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  motes.geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(moteItems.length * 3), 3));
  motes.frustumCulled = false;
  motes.userData.tag = "plankton";
  scene.add(motes);

  /**
   * Room looks: the reef is the scene as built above; the wreck hides the bright coral gardens,
   * shows the wreck set and turns the water darker and greener (deeper, older water).
   */
  const LOOKS = {
    reef: { bg: 0x05304f, fog: 0x0a5a86, fogFar: 50, sky: 0x8fd8ff, ground: 0x0a2238, hemi: 0.85, sun: 0xfff0d0, sunI: 2.4, sand: 0x9fb4b4, shafts: 0.07, caustic: 1, rock: 0xffffff, motes: 0xdcffff, moteOp: 0.35 },
    wreck: { bg: 0x03222a, fog: 0x0b4048, fogFar: 50, sky: 0x7fc8c0, ground: 0x061a1c, hemi: 0.75, sun: 0xd8f0e0, sunI: 1.8, sand: 0x7f948a, shafts: 0.05, caustic: 0.8, rock: 0xffffff, motes: 0xdcffff, moteOp: 0.35 },
    // the abyss: a faint blue top light, short haze, the floor lit by its own chimneys and glowing life
    deep: { bg: 0x010812, fog: 0x031428, fogFar: 40, sky: 0x3a6a9a, ground: 0x02060c, hemi: 0.55, sun: 0x8ab0e0, sunI: 0.7, sand: 0x4a5866, shafts: 0, caustic: 0.12, rock: 0x6a7480, motes: 0x7af0ff, moteOp: 0.85 },
  };
  function setRoom(id) {
    const L = LOOKS[id] ?? LOOKS.reef;
    scene.background.set(L.bg);
    scene.fog.color.set(L.fog);
    hemi.color.set(L.sky);
    hemi.groundColor.set(L.ground);
    hemi.intensity = L.hemi;
    sun.color.set(L.sun);
    sun.intensity = L.sunI;
    sandMat.color.set(L.sand);
    shaftMat.opacity = L.shafts;
    scene.fog.far = L.fogFar;
    causticLevel.value = L.caustic;
    rockMat.color.set(L.rock);
    mossMat.color.set(L.rock);
    motes.material.color.set(L.motes);
    motes.material.opacity = L.moteOp;
    const deepRoom = id === "deep";
    deep.root.visible = deepRoom;
    kelp.visible = !deepRoom;
    const wreckRoom = id === "wreck";
    corals.visible = !wreckRoom && !deepRoom;
    rocksHull.visible = !wreckRoom;
    kelpHull.visible = !wreckRoom && !deepRoom;
    anemoneRoot.visible = !wreckRoom && !deepRoom;
    wreck.root.visible = wreckRoom;
  }

  return {
    setRoom,
    update(dt, t) {
      for (const s of shafts.children) s.position.x += Math.sin(t * 0.2 + s.userData.phase) * dt * 0.15;
      for (const pts of bubbleClasses) {
        const pos = pts.geometry.attributes.position;
        pts.userData.items.forEach((u, i) => {
          u.y += u.speed * dt;
          if (u.y > 15) u.y = 0.3;
          u.x = u.vx + Math.sin(t * 2 + u.phase) * 0.25 * (u.y / 6);
          pos.setXYZ(i, u.x, u.y, u.z);
        });
        pos.needsUpdate = true;
      }
      const mp = motes.geometry.attributes.position;
      moteItems.forEach((m, i) => {
        m.x += Math.sin(t * 0.3 + m.phase) * dt * 0.12;
        m.y += Math.cos(t * 0.25 + m.phase) * dt * 0.08;
        mp.setXYZ(i, m.x, m.y, m.z);
      });
      mp.needsUpdate = true;
    },
  };
}
