/**
 * Procedural fish: lathe bodies with side-projected painted skins, membrane fins, textured eyes,
 * and a swim shader (lateral body bend or wing flap) driven by one shared time uniform.
 * Every model faces +X, length normalised to 2 (x ∈ [-1, 1]); the caller scales it.
 */
import * as THREE from "three";
import { makeRng } from "../materials.js";

export const swimTime = { value: 0 };

const texCache = new Map();

function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function toTexture(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Paint scale arcs over a skin. */
function scales(g, w, h, size, alpha) {
  g.save();
  g.globalAlpha = alpha;
  g.strokeStyle = "rgba(0,0,0,0.5)";
  g.lineWidth = 1;
  for (let y = 0, row = 0; y < h + size; y += size * 0.6, row++) {
    for (let x = (row % 2) * size * 0.5; x < w + size; x += size) {
      g.beginPath();
      g.arc(x, y, size * 0.55, 0.15 * Math.PI, 0.85 * Math.PI);
      g.stroke();
    }
  }
  g.restore();
}

function vertical(g, w, h, stops) {
  const grad = g.createLinearGradient(0, 0, 0, h);
  stops.forEach(([t, c]) => grad.addColorStop(t, c));
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
}

/**
 * Skin painters. Canvas x = along the body, tail (0) → head (w); y = top (0) → belly (h).
 */
const SKINS = {
  clown(g, w, h) {
    vertical(g, w, h, [[0, "#d9480f"], [0.5, "#ff7a1a"], [1, "#ffb066"]]);
    for (const cx of [0.2, 0.5, 0.78]) {
      g.fillStyle = "#111";
      g.fillRect(cx * w - 15, 0, 30, h);
      g.fillStyle = "#fbfbf7";
      g.fillRect(cx * w - 11, 0, 22, h);
    }
    g.fillStyle = "#111";
    g.fillRect(0, 0, 12, h);
  },
  tang(g, w, h) {
    vertical(g, w, h, [[0, "#0b2f8a"], [0.5, "#1d63e0"], [1, "#4b93ff"]]);
    g.fillStyle = "#06102e";
    g.beginPath();
    g.moveTo(w * 0.9, h * 0.25);
    g.bezierCurveTo(w * 0.6, h * 0.05, w * 0.35, h * 0.3, w * 0.15, h * 0.35);
    g.bezierCurveTo(w * 0.35, h * 0.55, w * 0.55, h * 0.4, w * 0.62, h * 0.62);
    g.bezierCurveTo(w * 0.7, h * 0.4, w * 0.82, h * 0.45, w * 0.9, h * 0.25);
    g.fill();
    g.fillStyle = "#ffd21a";
    g.fillRect(0, 0, w * 0.12, h);
  },
  yellow(g, w, h) {
    vertical(g, w, h, [[0, "#f2b705"], [0.5, "#ffe03a"], [1, "#fff2a6"]]);
    g.fillStyle = "rgba(255,255,255,0.6)";
    g.fillRect(w * 0.08, h * 0.45, 10, 10);
  },
  neon(g, w, h) {
    vertical(g, w, h, [[0, "#1c2a40"], [0.4, "#26e0ff"], [0.55, "#2ff4ff"], [0.6, "#e0182d"], [1, "#ff6d6d"]]);
  },
  angel(g, w, h) {
    vertical(g, w, h, [[0, "#c4cbd6"], [0.5, "#f2f4f8"], [1, "#d8dde6"]]);
    g.fillStyle = "#1a1d26";
    for (const cx of [0.28, 0.55, 0.8]) {
      g.beginPath();
      g.ellipse(cx * w, h / 2, 9, h * 0.6, 0.12, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = "rgba(255,200,60,0.35)";
    g.fillRect(0, 0, w, h * 0.12);
  },
  puffer(g, w, h, rng) {
    vertical(g, w, h, [[0, "#8a6a2a"], [0.55, "#d9b25a"], [0.62, "#f5ecd4"], [1, "#fffaf0"]]);
    g.fillStyle = "#3a2a10";
    for (let i = 0; i < 70; i++) {
      const x = rng() * w;
      const y = rng() * h * 0.55;
      g.beginPath();
      g.arc(x, y, 2 + rng() * 4, 0, Math.PI * 2);
      g.fill();
    }
  },
  parrot(g, w, h) {
    vertical(g, w, h, [[0, "#0d8a6e"], [0.5, "#20c997"], [1, "#9ff5d8"]]);
    g.strokeStyle = "#ff5fa2";
    g.lineWidth = 6;
    for (let x = w * 0.15; x < w; x += 26) {
      g.beginPath();
      g.moveTo(x, 0);
      g.quadraticCurveTo(x + 12, h / 2, x, h);
      g.stroke();
    }
    g.fillStyle = "#ffcf3f";
    g.fillRect(w * 0.88, 0, w * 0.12, h);
  },
  lion(g, w, h) {
    vertical(g, w, h, [[0, "#f4e7d6"], [1, "#fff8f0"]]);
    g.fillStyle = "#b3261e";
    for (let x = 4; x < w; x += 22) g.fillRect(x, 0, 10, h);
  },
  shark(g, w, h) {
    vertical(g, w, h, [[0, "#3c4b5a"], [0.45, "#6e8191"], [0.6, "#dfe6ea"], [1, "#f4f7f8"]]);
  },
  goldshark(g, w, h) {
    vertical(g, w, h, [[0, "#7a4a00"], [0.35, "#e0a51c"], [0.55, "#ffe27a"], [0.7, "#fff4c2"], [1, "#e8b64a"]]);
    g.fillStyle = "rgba(255,255,255,0.35)";
    for (let x = 0; x < w; x += 40) g.fillRect(x, h * 0.3, 18, 4);
  },
  turtle(g, w, h) {
    vertical(g, w, h, [[0, "#56713a"], [1, "#a8b874"]]);
  },
  shell(g, w, h) {
    vertical(g, w, h, [[0, "#3e2a12"], [1, "#6d4a20"]]);
    g.strokeStyle = "#e8c27a";
    g.lineWidth = 4;
    const cell = 46;
    for (let y = 0; y < h + cell; y += cell * 0.75) {
      for (let x = ((y / (cell * 0.75)) % 2) * cell * 0.5; x < w + cell; x += cell) {
        g.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          g.lineTo(x + Math.cos(a) * cell * 0.5, y + Math.sin(a) * cell * 0.45);
        }
        g.closePath();
        g.fillStyle = "rgba(160,110,40,0.55)";
        g.fill();
        g.stroke();
      }
    }
  },
  manta(g, w, h, rng) {
    vertical(g, w, h, [[0, "#1c2533"], [1, "#3a4a62"]]);
    g.fillStyle = "rgba(230,240,255,0.25)";
    for (let i = 0; i < 40; i++) {
      g.beginPath();
      g.arc(rng() * w, rng() * h, 2 + rng() * 6, 0, Math.PI * 2);
      g.fill();
    }
  },
  dragon(g, w, h) {
    vertical(g, w, h, [[0, "#6a0808"], [0.4, "#b8160e"], [0.62, "#e8a020"], [1, "#ffd870"]]);
  },
};

function skinTexture(id) {
  if (texCache.has(id)) return texCache.get(id);
  const w = 256;
  const h = 128;
  const c = canvas(w, h);
  const g = c.getContext("2d");
  const rng = makeRng(id.length * 97 + id.charCodeAt(0));
  (SKINS[id] ?? SKINS.shark)(g, w, h, rng);
  if (id !== "shell") scales(g, w, h, id === "dragon" || id === "goldshark" ? 16 : 10, id === "shark" || id === "manta" ? 0.08 : 0.35);
  const t = toTexture(c);
  texCache.set(id, t);
  return t;
}

/** Fin membrane: soft colour with ray striations and a transparent outer fade. */
function finTexture(color) {
  const key = `fin:${color}`;
  if (texCache.has(key)) return texCache.get(key);
  const c = canvas(128, 128);
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 128, 0);
  grad.addColorStop(0, color);
  grad.addColorStop(1, color);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = "rgba(0,0,0,0.28)";
  g.lineWidth = 2;
  for (let i = 0; i < 14; i++) {
    g.beginPath();
    g.moveTo(0, 64);
    g.lineTo(128, (i / 13) * 128);
    g.stroke();
  }
  const fade = g.createLinearGradient(0, 0, 128, 0);
  fade.addColorStop(0, "rgba(255,255,255,1)");
  fade.addColorStop(0.75, "rgba(255,255,255,0.85)");
  fade.addColorStop(1, "rgba(255,255,255,0.35)");
  g.globalCompositeOperation = "destination-in";
  g.fillStyle = fade;
  g.fillRect(0, 0, 128, 128);
  const t = toTexture(c);
  texCache.set(key, t);
  return t;
}

function eyeTexture(iris = "#d6a21e") {
  const key = `eye:${iris}`;
  if (texCache.has(key)) return texCache.get(key);
  const c = canvas(64, 64);
  const g = c.getContext("2d");
  g.fillStyle = "#f4f4ee";
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = iris;
  g.beginPath();
  g.arc(32, 32, 22, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#050505";
  g.beginPath();
  g.arc(32, 32, 13, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#fff";
  g.beginPath();
  g.arc(25, 24, 5, 0, Math.PI * 2);
  g.fill();
  const t = toTexture(c);
  texCache.set(key, t);
  return t;
}

/**
 * Inject the swim deformation. mode 0: lateral bend toward the tail; mode 1: wing flap
 * (y offset grows with |z|); mode 2: flipper paddle (rotation-ish about the root).
 */
function swimify(material, { mode = 0, amp = 0.12, freq = 9, flash }) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = swimTime;
    shader.uniforms.uAmp = { value: amp };
    shader.uniforms.uFreq = { value: freq };
    shader.uniforms.uFlash = flash;
    material.userData.shader = shader;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float uTime;\nuniform float uAmp;\nuniform float uFreq;\nuniform float uSwimRate;",
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        float ph = modelMatrix[3].x * 0.9 + modelMatrix[3].z * 1.7;
        ${
          mode === 0
            ? `float tail = smoothstep(0.55, -1.0, position.x);
               transformed.z += sin(uTime * uFreq + ph - position.x * 2.6) * uAmp * tail;
               transformed.z += sin(uTime * uFreq * 0.5 + ph) * uAmp * 0.25;`
            : mode === 1
              ? `float wing = pow(abs(position.z), 1.4);
                 transformed.y += sin(uTime * uFreq + ph - abs(position.z) * 1.2) * uAmp * wing;`
              : `float reach = length(position.xz);
                 transformed.y += sin(uTime * uFreq + ph) * uAmp * reach;`
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uFlash;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += uFlash;");
  };
  material.customProgramCacheKey = () => `swim${mode}`;
  return material;
}

/** Lathe body around X: `profile(t)` gives the radius at t ∈ [0 tail, 1 head]. */
function latheBody(profile, { height = 1, width = 1, segs = 28, rings = 24 }) {
  const pts = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    pts.push(new THREE.Vector2(Math.max(0.0005, profile(t)), t * 2 - 1));
  }
  const geo = new THREE.LatheGeometry(pts, segs);
  // Lathe revolves around Y; turn Y → X so the head points +X.
  geo.rotateZ(-Math.PI / 2);
  geo.scale(1, height, width);
  geo.computeVertexNormals();
  sideUV(geo);
  return geo;
}

/** Side-projected UVs: u along the body, v top → bottom; both flanks show the same paint. */
function sideUV(geo) {
  geo.computeBoundingBox();
  const b = geo.boundingBox;
  const pos = geo.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos.getX(i) - b.min.x) / (b.max.x - b.min.x);
    uv[i * 2 + 1] = (pos.getY(i) - b.min.y) / (b.max.y - b.min.y);
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return geo;
}

function finGeometry(points, { thickness = 0 } = {}) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (p.length === 4) shape.quadraticCurveTo(p[0], p[1], p[2], p[3]);
    else shape.lineTo(p[0], p[1]);
  }
  const geo = thickness ? new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false }) : new THREE.ShapeGeometry(shape, 10);
  // UVs: u from root to tip along the fin's own x span
  sideUV(geo);
  return geo;
}

const fishProfile = (bluntHead = 0.35, tailPinch = 0.12) => (t) => {
  const body = Math.sin(Math.PI * Math.pow(t, 0.85)) ** 0.75;
  const head = t > 0.8 ? 1 - Math.pow((t - 0.8) / 0.2, 2) * (1 - bluntHead) : 1;
  return Math.max(tailPinch * (1 - t), body * head) * 0.5;
};

/** Specs for the generic bony fish. */
const BONY = {
  clown: { h: 1.15, w: 0.55, fin: "#ff7a1a", finEdge: true, tail: "round", dorsal: "low", iris: "#2a2a2a" },
  tang: { h: 1.35, w: 0.42, fin: "#1d4fc0", tail: "fork", dorsal: "long", iris: "#2a2a2a" },
  yellow: { h: 1.75, w: 0.36, fin: "#ffd21a", tail: "square", dorsal: "tall", iris: "#3a2a10" },
  neon: { h: 0.75, w: 0.45, fin: "#9fe9ff", tail: "fork", dorsal: "low", iris: "#c0c0c0" },
  angel: { h: 1.6, w: 0.3, fin: "#e9edf3", tail: "lyre", dorsal: "sail", iris: "#c21a1a" },
  puffer: { h: 1.6, w: 1.5, fin: "#e2c070", tail: "round", dorsal: "nub", iris: "#25a35a", round: true },
  parrot: { h: 1.15, w: 0.55, fin: "#20c997", tail: "lyre", dorsal: "long", iris: "#ffcf3f", beak: true },
  lion: { h: 1.1, w: 0.6, fin: "#d2554a", tail: "round", dorsal: "spines", iris: "#c21a1a", spines: true },
  shark: { h: 0.62, w: 0.6, fin: "#55697a", tail: "shark", dorsal: "shark", iris: "#111", shark: true },
  goldshark: { h: 0.62, w: 0.6, fin: "#f0c040", tail: "shark", dorsal: "shark", iris: "#ff3b1a", shark: true, gold: true },
};

const TAILS = {
  round: [[0, 0], [-0.5, 0.42, -0.5, 0], [-0.5, -0.42, 0, 0]],
  fork: [[0, 0], [-0.55, 0.5], [-0.38, 0], [-0.55, -0.5], [0, 0]],
  square: [[0, 0], [-0.25, 0.4], [-0.45, 0.4], [-0.45, -0.4], [-0.25, -0.4], [0, 0]],
  lyre: [[0, 0], [-0.4, 0.3, -0.75, 0.6], [-0.5, 0, -0.75, -0.6], [-0.4, -0.3, 0, 0]],
  shark: [[0.05, 0], [-0.25, 0.25, -0.5, 0.75], [-0.38, 0.1], [-0.4, -0.4], [-0.2, -0.15], [0.05, 0]],
};

const DORSALS = {
  low: [[0.45, 0], [0.1, 0.22, -0.4, 0.12], [-0.45, 0]],
  long: [[0.5, 0], [0.2, 0.18], [-0.5, 0.14], [-0.6, 0]],
  tall: [[0.35, 0], [0, 0.5, -0.55, 0.3], [-0.6, 0]],
  sail: [[0.3, 0], [-0.2, 0.9], [-0.45, 0.85], [-0.3, 0.2], [-0.4, 0]],
  nub: [[0.05, 0], [-0.08, 0.12], [-0.22, 0]],
  shark: [[0.25, 0], [-0.05, 0.55], [-0.15, 0.5], [-0.25, 0]],
  spines: [[0.5, 0], [0.4, 0.75], [0.3, 0.05], [0.15, 0.8], [0.05, 0.05], [-0.1, 0.75], [-0.2, 0.05], [-0.35, 0.65], [-0.5, 0]],
};

/** Materials for one fish instance; `flash` is that fish's hit-flash colour uniform. */
function bodyMaterial(skin, flash, opts, extra = {}) {
  const map = skinTexture(skin);
  const m = new THREE.MeshStandardMaterial({ map, roughness: extra.metal ? 0.3 : 0.55, metalness: extra.metal ? 0.65 : 0.05, ...extra.params });
  if (extra.metal || extra.glow) {
    m.emissive = new THREE.Color(extra.glow ?? 0x553300);
    m.emissiveMap = map;
  }
  return swimify(m, { ...opts, flash });
}

function finMaterial(color, flash, opts) {
  const m = new THREE.MeshStandardMaterial({
    map: finTexture(color),
    transparent: true,
    alphaTest: 0.05,
    side: THREE.DoubleSide,
    roughness: 0.6,
    depthWrite: true,
  });
  return swimify(m, { ...opts, flash });
}

function eyeMaterial(iris, flash, opts) {
  const m = new THREE.MeshStandardMaterial({ map: eyeTexture(iris), roughness: 0.2 });
  return swimify(m, { ...opts, flash });
}

const geoCache = new Map();
function cached(key, make) {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
}

function addEyes(group, x, y, z, r, mat) {
  const geo = cached(`eye:${r}`, () => {
    const g = new THREE.SphereGeometry(r, 14, 10);
    g.rotateY(-Math.PI / 2); // texture centre faces outward (+z after mirror)
    return g;
  });
  for (const side of [1, -1]) {
    const e = new THREE.Mesh(geo, mat);
    e.position.set(x, y, z * side);
    e.rotation.y = side > 0 ? 0 : Math.PI;
    group.add(e);
  }
}

function buildBony(id, flash) {
  const s = BONY[id];
  const opts = { mode: 0, amp: s.shark ? 0.1 : 0.14, freq: s.shark ? 6 : 10 };
  const g = new THREE.Group();
  const profile = s.round ? (t) => Math.sin(Math.PI * t) ** 0.6 * 0.5 + 0.02 : fishProfile(s.shark ? 0.15 : 0.45, s.shark ? 0.06 : 0.1);
  const bodyGeo = cached(`body:${id}`, () => latheBody(profile, { height: s.h, width: s.w }));
  const body = new THREE.Mesh(bodyGeo, bodyMaterial(id, flash, opts, { metal: s.gold }));
  g.add(body);
  const finMat = finMaterial(s.fin, flash, opts);
  // tail
  const tail = new THREE.Mesh(cached(`tail:${s.tail}:${s.h}`, () => {
    const geo = finGeometry(TAILS[s.tail]);
    geo.scale(1.1, s.h * 0.9, 1);
    geo.translate(-0.88, 0, 0);
    return geo;
  }), finMat);
  g.add(tail);
  // dorsal
  const dorsal = new THREE.Mesh(cached(`dorsal:${s.dorsal}:${s.h}`, () => {
    const geo = finGeometry(DORSALS[s.dorsal]);
    geo.scale(1, s.h * 0.75, 1);
    geo.translate(0, s.h * 0.42, 0);
    return geo;
  }), finMat);
  g.add(dorsal);
  // anal / belly fin (mirror of a smaller dorsal)
  if (!s.round) {
    const anal = new THREE.Mesh(cached(`anal:${s.dorsal}:${s.h}`, () => {
      const geo = finGeometry(s.dorsal === "sail" ? DORSALS.sail : DORSALS.low);
      geo.scale(0.7, -s.h * (s.dorsal === "sail" ? 0.7 : 0.45), 1);
      geo.translate(-0.25, -s.h * 0.4, 0);
      return geo;
    }), finMat);
    g.add(anal);
  }
  // pectorals
  const pecGeo = cached(`pec:${id}`, () => {
    const geo = finGeometry(s.shark ? [[0, 0], [-0.55, -0.5], [-0.25, -0.05]] : [[0, 0], [-0.3, 0.12, -0.38, -0.05], [-0.2, -0.15, 0, 0]]);
    geo.scale(s.spines ? 2.2 : 1, s.spines ? 2.2 : 1, 1);
    return geo;
  });
  for (const side of [1, -1]) {
    const p = new THREE.Mesh(pecGeo, finMat);
    p.position.set(0.35, -s.h * 0.12, s.w * 0.42 * side);
    p.rotation.x = side * (s.shark ? 1.1 : 0.6);
    g.add(p);
  }
  const eyeR = s.shark ? 0.045 : s.round ? 0.11 : 0.085;
  addEyes(g, s.shark ? 0.72 : 0.68, s.h * (s.round ? 0.14 : 0.1), s.w * (s.round ? 0.36 : 0.3), eyeR, eyeMaterial(s.iris, flash, opts));
  if (s.beak) {
    const beak = new THREE.Mesh(cached("beak", () => {
      const geo = new THREE.ConeGeometry(0.12, 0.2, 10);
      geo.rotateZ(-Math.PI / 2);
      geo.translate(1.0, -0.02, 0);
      return sideUV(geo);
    }), bodyMaterial("puffer", flash, opts));
    g.add(beak);
  }
  return g;
}

function buildManta(flash) {
  const opts = { mode: 1, amp: 0.35, freq: 3.2 };
  const g = new THREE.Group();
  const geo = cached("manta", () => {
    // diamond wing plan in XZ, thickened in Y toward the centre line
    const shape = new THREE.Shape();
    shape.moveTo(0.95, 0);
    shape.quadraticCurveTo(0.6, 0.35, 0.05, 1.25);
    shape.quadraticCurveTo(-0.2, 0.6, -0.55, 0.12);
    shape.lineTo(-0.55, -0.12);
    shape.quadraticCurveTo(-0.2, -0.6, 0.05, -1.25);
    shape.quadraticCurveTo(0.6, -0.35, 0.95, 0);
    const ext = new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.05, bevelSegments: 3, curveSegments: 16 });
    ext.rotateX(-Math.PI / 2);
    const pos = ext.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);
      pos.setY(i, pos.getY(i) * (1 + 1.5 * Math.max(0, 1 - Math.abs(z) / 0.6)));
    }
    ext.computeVertexNormals();
    // top-down UVs for the manta
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uv[i * 2] = (pos.getX(i) + 1) / 2;
      uv[i * 2 + 1] = (pos.getZ(i) + 1.3) / 2.6;
    }
    ext.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    return ext;
  });
  g.add(new THREE.Mesh(geo, bodyMaterial("manta", flash, opts)));
  // cephalic lobes and tail whip
  const lobeMat = bodyMaterial("manta", flash, { ...opts, amp: 0 });
  for (const side of [1, -1]) {
    const lobe = new THREE.Mesh(cached("lobe", () => sideUV(new THREE.CapsuleGeometry(0.04, 0.22, 4, 8).rotateZ(Math.PI / 2))), lobeMat);
    lobe.position.set(0.98, 0.02, 0.14 * side);
    g.add(lobe);
  }
  const tail = new THREE.Mesh(cached("mantatail", () => sideUV(new THREE.CylinderGeometry(0.012, 0.03, 1.1, 6).rotateZ(Math.PI / 2).translate(-1.05, 0, 0))), lobeMat);
  g.add(tail);
  addEyes(g, 0.85, 0.08, 0.2, 0.04, eyeMaterial("#111", flash, { ...opts, amp: 0 }));
  return g;
}

function buildTurtle(flash) {
  const still = { mode: 0, amp: 0.0, freq: 1 };
  const paddle = { mode: 2, amp: 0.5, freq: 2.6 };
  const g = new THREE.Group();
  const shellGeo = cached("shell", () => {
    const geo = new THREE.SphereGeometry(0.75, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    geo.scale(1.15, 0.5, 0.95);
    const pos = geo.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uv[i * 2] = (pos.getX(i) + 0.9) / 1.8;
      uv[i * 2 + 1] = (pos.getZ(i) + 0.75) / 1.5;
    }
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    return geo;
  });
  g.add(new THREE.Mesh(shellGeo, bodyMaterial("shell", flash, still)));
  const plastron = new THREE.Mesh(cached("plastron", () => sideUV(new THREE.CylinderGeometry(0.82, 0.78, 0.08, 28).scale(1.05, 1, 0.9))), bodyMaterial("turtle", flash, still));
  plastron.position.y = -0.02;
  g.add(plastron);
  const skin = bodyMaterial("turtle", flash, still);
  const head = new THREE.Mesh(cached("thead", () => sideUV(new THREE.SphereGeometry(0.2, 16, 12).scale(1.4, 0.8, 1))), skin);
  head.position.set(1.0, 0.05, 0);
  g.add(head);
  addEyes(g, 1.15, 0.1, 0.12, 0.035, eyeMaterial("#2a1a08", flash, still));
  const flipMat = bodyMaterial("turtle", flash, paddle);
  const flipGeo = cached("flipper", () => {
    const geo = new THREE.SphereGeometry(0.5, 14, 8);
    geo.scale(0.5, 0.06, 1);
    geo.translate(-0.1, 0, 0.5);
    return sideUV(geo);
  });
  for (const [x, side, s] of [[0.45, 1, 1], [0.45, -1, 1], [-0.6, 1, 0.55], [-0.6, -1, 0.55]]) {
    const f = new THREE.Mesh(flipGeo, flipMat);
    f.position.set(x, 0, 0.55 * side);
    f.scale.set(s, 1, s * side);
    f.rotation.y = side * -0.5;
    g.add(f);
  }
  return g;
}

/** Dragon parts: one head and a reusable body segment (the caller chains segments). */
export function buildDragonHead(flash) {
  const opts = { mode: 0, amp: 0.0, freq: 1 };
  const g = new THREE.Group();
  const skull = new THREE.Mesh(cached("dskull", () => latheBody((t) => (0.18 + 0.3 * Math.sin(Math.PI * Math.min(1, t * 1.2)) ** 0.8) * (t > 0.85 ? 1 - (t - 0.85) * 3 : 1), { height: 0.8, width: 0.9 })), bodyMaterial("dragon", flash, opts, { glow: 0x2a0600 }));
  g.add(skull);
  const gold = bodyMaterial("goldshark", flash, opts, { metal: true });
  // horns
  for (const side of [1, -1]) {
    const horn = new THREE.Mesh(cached("horn", () => sideUV(new THREE.ConeGeometry(0.07, 0.9, 10).translate(0, 0.45, 0))), gold);
    horn.position.set(-0.2, 0.25, 0.18 * side);
    horn.rotation.set(side * 0.35, 0, 1.1);
    g.add(horn);
    // whiskers
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.85, -0.05, 0.12 * side),
      new THREE.Vector3(0.7, 0.0, 0.6 * side),
      new THREE.Vector3(0.2, 0.05, 0.95 * side),
      new THREE.Vector3(-0.4, 0.0, 1.05 * side),
    ]);
    const whisker = new THREE.Mesh(sideUV(new THREE.TubeGeometry(curve, 20, 0.022, 6)), gold);
    g.add(whisker);
  }
  // mane (fin frills)
  const mane = new THREE.Mesh(cached("mane", () => {
    const geo = finGeometry(DORSALS.spines);
    geo.scale(1.2, 0.8, 1);
    geo.translate(-0.4, 0.3, 0);
    return geo;
  }), finMaterial("#ffb21a", flash, opts));
  g.add(mane);
  addEyes(g, 0.45, 0.2, 0.26, 0.08, eyeMaterial("#ffde00", flash, opts));
  return g;
}

export function buildDragonSegment(flash, tailEnd = false) {
  const opts = { mode: 0, amp: 0, freq: 1 };
  const g = new THREE.Group();
  const seg = new THREE.Mesh(cached("dseg", () => latheBody((t) => 0.3 + 0.22 * Math.sin(Math.PI * t), { height: 1, width: 1, rings: 10 }).scale(0.55, 1, 1)), bodyMaterial("dragon", flash, opts, { glow: 0x2a0600 }));
  g.add(seg);
  const fin = new THREE.Mesh(cached("dsegfin", () => {
    const geo = finGeometry([[0.4, 0], [0.0, 0.42], [-0.4, 0]]);
    geo.translate(0, 0.25, 0);
    return geo;
  }), finMaterial("#ffb21a", flash, opts));
  g.add(fin);
  if (tailEnd) {
    const tail = new THREE.Mesh(cached("dtail", () => {
      const geo = finGeometry(TAILS.lyre);
      geo.scale(1.6, 1.4, 1);
      geo.translate(-0.8, 0, 0);
      return geo;
    }), finMaterial("#ffb21a", flash, opts));
    g.add(tail);
  }
  return g;
}

/** Build a fish group for a species (not the dragon — see fishes.js). */
export function buildFish(id) {
  const flash = { value: new THREE.Color(0, 0, 0) };
  let g;
  if (id === "manta") g = buildManta(flash);
  else if (id === "turtle") g = buildTurtle(flash);
  else g = buildBony(id, flash);
  g.userData.flash = flash;
  return g;
}

export function newFlash() {
  return { value: new THREE.Color(0, 0, 0) };
}
