/**
 * Procedural fish: lathe bodies with side-projected painted skins, membrane fins, textured eyes,
 * and a swim shader (lateral body bend or wing flap) driven by one shared time uniform.
 * Every model faces +X, length normalised to 2 (x ∈ [-1, 1]); the caller scales it.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { makeRng } from "../materials.js";
import { buildTreasure } from "./treasure.js";
import { buildMine } from "./mine.js";

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

/**
 * Atlases: every fish skin, fin membrane and eye is painted into one of three shared canvases, and
 * each material gets a clone of the atlas texture whose offset/repeat frame its own tile. Clones
 * share the source, so the GPU holds one texture per atlas instead of one per skin/fin/eye (three
 * keys its WebGL textures by source + sampling parameters; offset and repeat are not among them).
 * Tiles carry a gutter of stretched edge pixels so mipmaps do not pull in the neighbour.
 * A full atlas falls back to a texture of its own, so nothing breaks if the cast grows.
 */
function makeAtlas(W, H, cellW, cellH, pad) {
  const c = canvas(W, H);
  return { c, g: c.getContext("2d"), tex: toTexture(c), W, H, cellW, cellH, pad, cols: Math.floor(W / (cellW + 2 * pad)), rows: Math.floor(H / (cellH + 2 * pad)), n: 0 };
}
const atlases = {
  skin: makeAtlas(2048, 1024, 256, 128, 4),
  fin: makeAtlas(1024, 1024, 128, 128, 4),
  eye: makeAtlas(512, 512, 64, 64, 2),
};
/** Texture slots used, per atlas (diagnostics). */
export const atlasUse = () => Object.fromEntries(Object.entries(atlases).map(([k, a]) => [k, `${a.n}/${a.cols * a.rows}`]));

function atlasTexture(atlas, src) {
  const { cellW: w, cellH: h, pad, cols, rows, g } = atlas;
  if (atlas.n >= cols * rows) return toTexture(src);
  const i = atlas.n++;
  const x = (i % cols) * (w + 2 * pad) + pad;
  const y = Math.floor(i / cols) * (h + 2 * pad) + pad;
  g.drawImage(src, 0, 0, 1, h, x - pad, y, pad, h);
  g.drawImage(src, w - 1, 0, 1, h, x + w, y, pad, h);
  g.drawImage(src, 0, 0, w, 1, x, y - pad, w, pad);
  g.drawImage(src, 0, h - 1, w, 1, x, y + h, w, pad);
  g.drawImage(src, x, y);
  atlas.tex.needsUpdate = true;
  const t = atlas.tex.clone();
  // uv (0…1) → this tile; the canvas is uploaded flipped (flipY), so v = 1 is its top row
  t.repeat.set(w / atlas.W, h / atlas.H);
  t.offset.set(x / atlas.W, 1 - (y + h) / atlas.H);
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
  turtle(g, w, h, rng) {
    // pale yellow-green skin under rounded dark-green scales (head, flippers)
    vertical(g, w, h, [[0, "#86b84c"], [1, "#b4d670"]]);
    g.fillStyle = "#2f7a2a";
    for (let y = 4; y < h; y += 13) {
      for (let x = (y % 26) / 2; x < w; x += 13) {
        g.beginPath();
        g.ellipse(x + rng() * 3, y + rng() * 3, 4.5 + rng() * 1.5, 4 + rng() * 1.5, rng() * 3, 0, Math.PI * 2);
        g.fill();
      }
    }
  },
  plastron(g, w, h) {
    vertical(g, w, h, [[0, "#efe2b4"], [1, "#d8c48a"]]);
  },
  shell(g, w, h, rng) {
    // carapace scutes as Voronoi cells laid out in the shell's own top-down space
    // (UV: u = (x + 0.9) / 1.8, v = (z + 0.75) / 1.5): five vertebral plates down the spine,
    // four costal plates each side, a ring of small marginal plates at the rim
    const seeds = [];
    for (const x of [-0.56, -0.28, 0, 0.28, 0.56]) seeds.push([x, 0, 0]);
    for (const side of [1, -1]) for (const x of [-0.45, -0.15, 0.15, 0.45]) seeds.push([x, 0.33 * side, 1]);
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      seeds.push([Math.cos(a) * 0.86, Math.sin(a) * 0.68, 2]);
    }
    const tone = seeds.map(() => 0.85 + rng() * 0.3);
    const img = g.createImageData(w, h);
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const x = (px / w) * 1.8 - 0.9;
        const z = (py / h) * 1.5 - 0.75;
        let d1 = 9, d2 = 9, best = 0;
        for (let i = 0; i < seeds.length; i++) {
          const dx = x - seeds[i][0];
          const dz = (z - seeds[i][1]) * 1.15;
          const d = Math.sqrt(dx * dx + dz * dz);
          if (d < d1) { d2 = d1; d1 = d; best = i; } else if (d < d2) d2 = d;
        }
        const edge = d2 - d1; // 0 on a seam
        const marginal = seeds[best][2] === 2;
        // warm orange at a plate's heart, deep brown toward its seams, darker marginals
        const k = Math.min(1, d1 / 0.2) * (marginal ? 1.15 : 1);
        let r = (232 - 120 * k) * tone[best];
        let gg = (128 - 78 * k) * tone[best];
        let b = (40 - 22 * k) * tone[best];
        if (edge < 0.022) { r = 58; gg = 26; b = 8; } // seam
        else if (edge < 0.04) { r *= 0.7; gg *= 0.7; b *= 0.7; }
        const o = (py * w + px) * 4;
        img.data[o] = Math.min(255, r);
        img.data[o + 1] = Math.min(255, gg);
        img.data[o + 2] = Math.max(0, b);
        img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    // growth streaks radiating from each plate's centre
    g.strokeStyle = "rgba(255,200,110,0.22)";
    g.lineWidth = 1.5;
    for (const [sx, sz, kind] of seeds) {
      if (kind === 2) continue;
      const cx = ((sx + 0.9) / 1.8) * w;
      const cy = ((sz + 0.75) / 1.5) * h;
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2 + rng();
        g.beginPath();
        g.moveTo(cx, cy);
        g.lineTo(cx + Math.cos(a) * 16, cy + Math.sin(a) * 9);
        g.stroke();
      }
    }
  },
  manta(g, w, h, rng) {
    // deep blue back with a darker spine and white speckles (the collection portrait's look)
    vertical(g, w, h, [[0, "#22407e"], [0.5, "#16295a"], [1, "#22407e"]]);
    g.fillStyle = "rgba(240,248,255,0.55)";
    for (let i = 0; i < 70; i++) {
      g.beginPath();
      g.arc(rng() * w, rng() * h, 1 + rng() * 2.6, 0, Math.PI * 2);
      g.fill();
    }
  },
  barracuda(g, w, h) {
    // silver flank, dark back, rows of dark chevrons
    vertical(g, w, h, [[0, "#2c3a4a"], [0.35, "#7d8fa2"], [0.6, "#d6dfe8"], [1, "#f4f7fa"]]);
    g.fillStyle = "rgba(20,30,44,0.55)";
    for (let i = 0; i < 9; i++) {
      const x = w * (0.12 + i * 0.09);
      g.beginPath();
      g.moveTo(x, h * 0.18);
      g.lineTo(x + 10, h * 0.32);
      g.lineTo(x, h * 0.46);
      g.lineTo(x - 5, h * 0.46);
      g.lineTo(x + 4, h * 0.32);
      g.lineTo(x - 5, h * 0.18);
      g.fill();
    }
  },
  lantern(g, w, h, rng) {
    // deep-sea violet with pale speckles; at the head (u → 1) a wide dark mouth over a pale jaw
    vertical(g, w, h, [[0, "#2a1a36"], [0.5, "#4a3058"], [1, "#7a5a78"]]);
    g.fillStyle = "rgba(230,200,255,0.4)";
    for (let i = 0; i < 70; i++) {
      g.beginPath();
      g.arc(rng() * w * 0.85, rng() * h * 0.6, 1 + rng() * 2.2, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = "#e8d8c0"; // lower jaw
    g.beginPath();
    g.moveTo(w * 0.7, h * 0.52);
    g.quadraticCurveTo(w * 0.9, h * 0.8, w, h * 0.56);
    g.lineTo(w, h);
    g.lineTo(w * 0.7, h);
    g.fill();
    g.strokeStyle = "#0a0410"; // the mouth line
    g.lineWidth = 7;
    g.beginPath();
    g.moveTo(w * 0.68, h * 0.5);
    g.quadraticCurveTo(w * 0.88, h * 0.66, w, h * 0.5);
    g.stroke();
  },
  seahorse(g, w, h, rng) {
    // u runs along the body, v around it: ochre with dark ridge rings and pale dots
    vertical(g, w, h, [[0, "#d9781a"], [0.5, "#ffb23a"], [1, "#d9781a"]]);
    g.fillStyle = "rgba(90,40,0,0.45)";
    for (let i = 0; i < 26; i++) g.fillRect(w * (i / 26), 0, 3, h);
    g.fillStyle = "rgba(255,245,210,0.7)";
    for (let i = 0; i < 40; i++) {
      g.beginPath();
      g.arc(rng() * w, rng() * h, 1 + rng() * 1.5, 0, Math.PI * 2);
      g.fill();
    }
  },
  octopus(g, w, h, rng) {
    vertical(g, w, h, [[0, "#8a1f2a"], [0.5, "#d0453a"], [1, "#f08a6a"]]);
    g.fillStyle = "rgba(255,210,170,0.5)";
    for (let i = 0; i < 60; i++) {
      g.beginPath();
      g.arc(rng() * w, rng() * h, 1.5 + rng() * 3, 0, Math.PI * 2);
      g.fill();
    }
  },
  octoarm(g, w, h) {
    // the arms: red on the outside, pale sucker side
    vertical(g, w, h, [[0, "#9a2430"], [0.55, "#d8503e"], [0.7, "#f6c0a0"], [1, "#fde2cc"]]);
    g.fillStyle = "rgba(255,240,225,0.8)";
    for (let i = 0; i < 30; i++) {
      g.beginPath();
      g.arc(w * (i / 30), h * 0.85, 2.2, 0, Math.PI * 2);
      g.fill();
    }
  },
  kraken(g, w, h, rng) {
    // the boss: abyssal violet-red with glowing cyan spots
    vertical(g, w, h, [[0, "#1a0612"], [0.5, "#4a0f2a"], [1, "#7a1e3a"]]);
    for (let i = 0; i < 45; i++) {
      const x = rng() * w;
      const y = rng() * h;
      const grad = g.createRadialGradient(x, y, 0, x, y, 5);
      grad.addColorStop(0, "rgba(120,255,240,0.9)");
      grad.addColorStop(1, "rgba(120,255,240,0)");
      g.fillStyle = grad;
      g.fillRect(x - 5, y - 5, 10, 10);
    }
  },
  krakenarm(g, w, h, rng) {
    vertical(g, w, h, [[0, "#1a0612"], [0.55, "#5a1430"], [0.7, "#c07090"], [1, "#e8b0c0"]]);
    for (let i = 0; i < 30; i++) {
      const x = w * (i / 30);
      const grad = g.createRadialGradient(x, h * 0.4, 0, x, h * 0.4, 4);
      grad.addColorStop(0, "rgba(120,255,240,0.8)");
      grad.addColorStop(1, "rgba(120,255,240,0)");
      g.fillStyle = grad;
      g.fillRect(x - 4, h * 0.4 - 4, 8, 8);
    }
  },
  jelly(g, w, h, rng) {
    // translucent violet bell with pale radial ribs and glowing spots
    vertical(g, w, h, [[0, "#c88aff"], [0.5, "#f0c8ff"], [1, "#c88aff"]]);
    g.fillStyle = "rgba(255,255,255,0.45)";
    for (let i = 0; i < 10; i++) g.fillRect(0, h * (i / 10), w, 2);
    for (let i = 0; i < 30; i++) {
      const x = rng() * w;
      const y = rng() * h;
      const grad = g.createRadialGradient(x, y, 0, x, y, 4);
      grad.addColorStop(0, "rgba(160,255,255,0.9)");
      grad.addColorStop(1, "rgba(160,255,255,0)");
      g.fillStyle = grad;
      g.fillRect(x - 4, y - 4, 8, 8);
    }
  },
  eel(g, w, h, rng) {
    // moray: olive-green with a yellow net of spots, paler underside
    vertical(g, w, h, [[0, "#2f4a1c"], [0.6, "#4f7028"], [1, "#a8b860"]]);
    g.fillStyle = "rgba(230,220,90,0.7)";
    for (let i = 0; i < 90; i++) {
      g.beginPath();
      g.arc(rng() * w, rng() * h * 0.75, 1.5 + rng() * 2.5, 0, Math.PI * 2);
      g.fill();
    }
  },
  squid(g, w, h, rng) {
    vertical(g, w, h, [[0, "#b8402a"], [0.5, "#f08060"], [1, "#ffd0b8"]]);
    for (let i = 0; i < 80; i++) {
      g.fillStyle = `rgba(${120 + rng() * 60},30,30,${0.3 + rng() * 0.4})`;
      g.beginPath();
      g.arc(rng() * w, rng() * h, 1 + rng() * 3, 0, Math.PI * 2);
      g.fill();
    }
  },
  giantsquid(g, w, h, rng) {
    // the abyss boss: deep crimson with violet bands and glowing photophores
    vertical(g, w, h, [[0, "#2a0412"], [0.5, "#6a0e24"], [1, "#a8304a"]]);
    g.fillStyle = "rgba(90,20,120,0.4)";
    for (let i = 0; i < 12; i++) g.fillRect(w * (i / 12), 0, 6, h);
    for (let i = 0; i < 50; i++) {
      const x = rng() * w;
      const y = rng() * h;
      const grad = g.createRadialGradient(x, y, 0, x, y, 5);
      grad.addColorStop(0, "rgba(120,200,255,0.95)");
      grad.addColorStop(1, "rgba(120,200,255,0)");
      g.fillStyle = grad;
      g.fillRect(x - 5, y - 5, 10, 10);
    }
  },
  volt(g, w, h) {
    // deep electric blue with jagged yellow lightning bolts running along the flank
    vertical(g, w, h, [[0, "#0a1a5a"], [0.5, "#1a4ae0"], [1, "#4a8aff"]]);
    g.strokeStyle = "#ffe23a";
    g.lineWidth = 6;
    g.lineJoin = "miter";
    for (const y0 of [0.32, 0.62]) {
      g.beginPath();
      for (let i = 0; i <= 12; i++) g.lineTo(w * (i / 12), h * (y0 + (i % 2 ? 0.08 : -0.08)));
      g.stroke();
    }
  },
  frost(g, w, h, rng) {
    // glacier blue: a deep back fading to a pale belly, with white ice facets (a white fish read as
    // a blank silhouette on the dark cards and blew out under the bloom)
    vertical(g, w, h, [[0, "#0e4a8a"], [0.45, "#2a8ad0"], [0.8, "#8ad4f4"], [1, "#d8f4ff"]]);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(255,255,255,${0.25 + rng() * 0.4})`;
      const x = rng() * w;
      const y = rng() * h;
      g.beginPath();
      g.moveTo(x, y - 6);
      g.lineTo(x + 5, y);
      g.lineTo(x, y + 6);
      g.lineTo(x - 5, y);
      g.fill();
    }
  },
  dragon(g, w, h) {
    vertical(g, w, h, [[0, "#c8140c"], [0.35, "#ff3a1a"], [0.6, "#ffb020"], [1, "#ffe890"]]);
  },
};

function skinTexture(id, { own = false } = {}) {
  const ck = own ? `own:${id}` : id;
  if (texCache.has(ck)) return texCache.get(ck);
  const w = 256;
  const h = 128;
  const c = canvas(w, h);
  const g = c.getContext("2d");
  const rng = makeRng(id.length * 97 + id.charCodeAt(0));
  (SKINS[id] ?? SKINS.shark)(g, w, h, rng);
  if (!["shell", "turtle", "plastron", "octopus", "octoarm", "kraken", "krakenarm", "seahorse", "jelly", "eel", "squid", "giantsquid"].includes(id)) scales(g, w, h, id === "dragon" || id === "goldshark" ? 16 : 10, id === "shark" || id === "manta" ? 0.08 : 0.35);
  // `own`: a texture of its own (the dragon's body repeats its skin along its length)
  const t = own ? toTexture(c) : atlasTexture(atlases.skin, c);
  texCache.set(ck, t);
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
  const t = atlasTexture(atlases.fin, c);
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
  const t = atlasTexture(atlases.eye, c);
  texCache.set(key, t);
  return t;
}

/**
 * Inject the swim deformation. mode 0: lateral bend toward the tail; mode 1: wing flap
 * (y offset grows with |z|); mode 2: flipper paddle (rotation-ish about the root).
 */
function swimify(material, { mode = 0, amp = 0.12, freq = 9, flash }) {
  // fish are the targets: the haze frames the reef and the far water, never the fish (at 28-34
  // units out the scene fog washed them 40-56 % toward blue; pushing the fog back instead turned
  // the sand khaki and lost the deep-water mood)
  material.fog = false;
  material.userData.swimMode = mode;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = swimTime;
    shader.uniforms.uAmp = { value: amp };
    shader.uniforms.uFreq = { value: freq };
    shader.uniforms.uFlash = flash;
    material.userData.shader = shader;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float uTime;\nuniform float uAmp;\nuniform float uFreq;",
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
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += uFlash;
        float rimF = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
        totalEmissiveRadiance += vec3(0.35, 0.75, 1.0) * pow(rimF, 2.6) * 0.55;`,
      );
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
  barracuda: { h: 0.46, w: 0.4, fin: "#7d8fa2", tail: "fork", dorsal: "low", iris: "#e8e0a0", shark: true },
  lantern: { h: 1.3, w: 1.0, fin: "#9a78b0", tail: "round", dorsal: "nub", iris: "#d8ff60", lure: true },
  // special targets: they glow so they stand out from the school
  volt: { h: 1.0, w: 0.45, fin: "#ffe23a", tail: "fork", dorsal: "tall", iris: "#1a1a1a", glow: 0x3a5aff },
  frost: { h: 1.25, w: 0.5, fin: "#7ad0ff", tail: "lyre", dorsal: "sail", iris: "#0a2a50", glow: 0x1a5a90, crystals: true },
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
  const profile = s.round
    ? (t) => Math.sin(Math.PI * t) ** 0.6 * 0.5 + 0.02
    : s.lure
      ? (t) => Math.max(0.03, Math.sin(Math.PI * t ** 1.9) ** 0.55 * 0.5) // anglerfish: a huge head on a tapering body
      : fishProfile(s.shark ? 0.15 : 0.45, s.shark ? 0.06 : 0.1);
  const bodyGeo = cached(`body:${id}`, () => latheBody(profile, { height: s.h, width: s.w }));
  const body = new THREE.Mesh(bodyGeo, bodyMaterial(id, flash, opts, { metal: s.gold, glow: s.glow }));
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
  if (id === "puffer") g.add(new THREE.Mesh(cached("puffer-spines", () => pufferSpines(profile, s.h, s.w)), finMat));
  if (s.crystals) g.add(new THREE.Mesh(cached(`crystals:${id}`, () => pufferSpines(profile, s.h, s.w)), finMat)); // ice crystals
  if (s.lure) {
    // the anglerfish's lure: a stalk arching forward over the head, a glowing bulb at its tip
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0.45, s.h * 0.42, 0), new THREE.Vector3(0.85, s.h * 1.05, 0), new THREE.Vector3(1.25, s.h * 0.6, 0));
    g.add(new THREE.Mesh(cached("lure-stalk", () => new THREE.TubeGeometry(curve, 12, 0.03, 6)), finMat));
    const bulbMat = swimify(new THREE.MeshStandardMaterial({ color: 0xeaffb0, emissive: 0xc8ff60, emissiveIntensity: 2.4, roughness: 0.3 }), { ...opts, amp: 0, flash });
    const bulb = new THREE.Mesh(cached("lure-bulb", () => new THREE.SphereGeometry(0.14, 14, 10)), bulbMat);
    bulb.position.copy(curve.v2);
    g.add(bulb);
    // a row of needle teeth along the jaw
    // needle teeth jutting forward around the gaping mouth at the nose (they show from above)
    const tooth = new THREE.ConeGeometry(0.035, 0.2, 5).rotateZ(-Math.PI / 2);
    const teeth = [];
    for (let i = 0; i < 9; i++) {
      const a = (i / 8 - 0.5) * 2.4;
      teeth.push(tooth.clone().rotateY(-a * 0.5).translate(0.93 + 0.03 * Math.cos(a), -0.04 + (i % 2 ? -0.05 : 0.05), Math.sin(a) * 0.2));
    }
    const toothMat = swimify(new THREE.MeshStandardMaterial({ color: 0xf4f0e0, roughness: 0.4, map: finTexture("#f4f0e0") }), { ...opts, flash });
    g.add(new THREE.Mesh(cached("lure-teeth", () => mergeGeometries(teeth)), toothMat));
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

/**
 * The puffer's spines: short cones standing on the lathe body along its surface normal, spread
 * by the golden angle. One geometry, drawn with the fins (same material, merged with them).
 */
function pufferSpines(profile, h, w) {
  const cone = new THREE.ConeGeometry(0.04, 0.17, 5);
  cone.translate(0, 0.07, 0); // base sits slightly inside the skin
  const parts = [];
  const up = new THREE.Vector3(0, 1, 0);
  const n = new THREE.Vector3();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const COUNT = 54;
  for (let i = 0; i < COUNT; i++) {
    const t = 0.18 + 0.66 * ((i + 0.5) / COUNT);
    const a = i * 2.39996;
    const r = profile(t);
    // lathe body: x = 2t - 1, y = h·r·cos a, z = w·r·sin a (see latheBody)
    const p = new THREE.Vector3(t * 2 - 1, h * r * Math.cos(a), w * r * Math.sin(a));
    const slope = (profile(t + 0.01) - profile(t - 0.01)) / 0.04; // dr/dx
    n.set(-slope, Math.cos(a) / h, Math.sin(a) / w).normalize();
    m.compose(p, q.setFromUnitVectors(up, n), new THREE.Vector3(1, 1, 1));
    parts.push(cone.clone().applyMatrix4(m));
  }
  return mergeGeometries(parts);
}

/**
 * A tube along `curve` whose radius follows `radius(t)` (t 0 → 1 along it); uv u runs along the
 * tube, v around it. `scaleZ` flattens it sideways. Ends are left open (they taper to a point).
 */
function taperedTube(curve, radius, { tubular = 40, radial = 10, scaleZ = 1 } = {}) {
  const frames = curve.computeFrenetFrames(tubular, false);
  const pos = [];
  const uv = [];
  const index = [];
  const p = new THREE.Vector3();
  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular;
    curve.getPointAt(t, p);
    const r = radius(t);
    const N = frames.normals[i];
    const B = frames.binormals[i];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const cx = Math.cos(a);
      const cy = Math.sin(a);
      pos.push(p.x + r * (cx * N.x + cy * B.x), p.y + r * (cx * N.y + cy * B.y), p.z + r * (cx * N.z + cy * B.z) * scaleZ);
      uv.push(t, j / radial);
    }
  }
  for (let i = 0; i < tubular; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

/**
 * The seahorse, drawn in its side plane (XY) like the other fish so the lean shows its profile:
 * a curled tail, a bellied trunk, a crested head on a bent neck and a long snout pointing +X.
 */
function buildSeahorse(flash) {
  const opts = { mode: 0, amp: 0.06, freq: 5 };
  const g = new THREE.Group();
  const body = cached("seahorse-body", () => {
    // from the tail tip (curled, low and behind) up the trunk to the crown of the head
    const curve = new THREE.CatmullRomCurve3(
      [
        [-0.05, -0.55], [-0.2, -0.62], [-0.28, -0.48], [-0.18, -0.36], [-0.25, -0.15],
        [-0.22, 0.12], [-0.1, 0.36], [0.02, 0.55], [0.06, 0.72],
      ].map(([x, y]) => new THREE.Vector3(x * 1.6, y * 1.6, 0)),
    );
    // thin tail, round belly, thin neck, round head
    const r = (t) => 0.035 + 0.2 * Math.sin(Math.PI * Math.min(1, Math.max(0, (t - 0.3) / 0.55))) ** 0.8 + (t > 0.85 ? 0.12 * Math.sin(Math.PI * (t - 0.85) / 0.15) : 0);
    return taperedTube(curve, r, { tubular: 48, radial: 12, scaleZ: 0.75 });
  });
  g.add(new THREE.Mesh(body, bodyMaterial("seahorse", flash, opts)));
  const finMat = finMaterial("#ffd27a", flash, opts);
  // snout: a tube pointing forward from the head
  const snout = new THREE.Mesh(cached("seahorse-snout", () => {
    const geo = new THREE.CylinderGeometry(0.04, 0.065, 0.3, 10).rotateZ(-Math.PI / 2 - 0.35);
    return sideUV(geo.translate(0.27, 1.06, 0));
  }), bodyMaterial("seahorse", flash, opts));
  g.add(snout);
  // crest spikes on the head and a fan fin on the back
  const crest = new THREE.Mesh(cached("seahorse-crest", () => {
    const parts = [];
    for (let i = 0; i < 4; i++) parts.push(new THREE.ConeGeometry(0.035, 0.16, 5).translate(-0.02 - i * 0.05, 1.3 + (i % 2) * 0.03, 0));
    return mergeGeometries(parts);
  }), finMat);
  g.add(crest);
  const dorsal = new THREE.Mesh(cached("seahorse-dorsal", () => {
    const geo = finGeometry([[0, 0], [-0.2, 0.12, -0.32, -0.05], [-0.15, -0.2], [0, 0]]);
    return geo.translate(-0.28, 0.05, 0);
  }), finMat);
  g.add(dorsal);
  addEyes(g, 0.1, 1.12, 0.1, 0.06, eyeMaterial("#1a1a1a", flash, opts));
  return g;
}

/**
 * The octopus (and, darker and bigger, the kraken boss): a mantle in front (+X) and eight arms
 * trailing behind, spread in the horizontal plane so they read from the overhead camera; the swim
 * bend waves them. Arms share one material and merge into one mesh.
 */
function buildOctopus(flash, { boss = false } = {}) {
  const opts = { mode: 0, amp: boss ? 0.22 : 0.28, freq: boss ? 3 : 4 };
  const g = new THREE.Group();
  const skin = boss ? "kraken" : "octopus";
  const mantle = new THREE.Mesh(cached(`mantle:${skin}`, () => {
    // a rounded bag: wide at the back where the arms join, domed in front
    const geo = latheBody((t) => Math.max(0.02, Math.sin(Math.PI * Math.min(1, t * 0.95 + 0.05)) ** 0.7 * 0.5), { height: 0.95, width: 1.05 });
    return geo.scale(0.55, 1, 1).translate(0.45, 0.1, 0);
  }), bodyMaterial(skin, flash, opts, boss ? { glow: 0x2a0818 } : {}));
  g.add(mantle);
  const armMat = bodyMaterial(boss ? "krakenarm" : "octoarm", flash, opts);
  const arms = cached(`arms:${skin}`, () => {
    const parts = [];
    for (let k = 0; k < 8; k++) {
      const a = ((k + 0.5) / 8 - 0.5) * 2.6; // fan of arms behind the mantle
      const curl = (k % 2 ? 1 : -1) * 0.25;
      const pts = [];
      for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        const reach = 0.1 + t * 1.15;
        const ang = a * (0.55 + t * 0.6) + curl * t * t;
        pts.push(new THREE.Vector3(0.05 - Math.cos(ang) * reach, 0.05 - t * 0.12, Math.sin(ang) * reach * 0.95));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      parts.push(taperedTube(curve, (t) => 0.1 * (1 - t) ** 0.9 + 0.008, { tubular: 20, radial: 7 }));
    }
    return mergeGeometries(parts);
  });
  g.add(new THREE.Mesh(arms, armMat));
  const eyeR = boss ? 0.09 : 0.075;
  addEyes(g, 0.32, 0.22, 0.34, eyeR, eyeMaterial(boss ? "#ffe23a" : "#f0c040", flash, { ...opts, amp: 0 }));
  return g;
}

/**
 * The jellyfish: a glowing translucent bell in front, frilly oral arms and long thin threads
 * trailing behind, all in the swim bend (the threads wave). Seen from above like the octopus.
 */
function buildJelly(flash) {
  const opts = { mode: 0, amp: 0.2, freq: 3.5 };
  const g = new THREE.Group();
  const bell = new THREE.Mesh(cached("jelly-bell", () => {
    // a dome along x: wide rim at the back, round top in front
    const geo = latheBody((t) => Math.max(0.02, Math.sin(Math.PI * (0.5 + t * 0.5)) ** 0.35 * 0.55 * (t < 0.08 ? t / 0.08 : 1)), { height: 1.0, width: 1.0 });
    return geo.scale(0.45, 1, 1).translate(0.5, 0, 0);
  }), bodyMaterial("jelly", flash, opts, { glow: 0x6a2a90, params: { transparent: true, opacity: 0.82, depthWrite: false } }));
  bell.renderOrder = 1;
  g.add(bell);
  const threadMat = bodyMaterial("jelly", flash, opts, { glow: 0x8a3ab0, params: { transparent: true, opacity: 0.7, depthWrite: false } });
  const threads = cached("jelly-threads", () => {
    const parts = [];
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      const r0 = k % 3 === 0 ? 0.12 : 0.42; // a ring of thin threads around the rim, frilly arms in the middle
      const len = k % 3 === 0 ? 1.3 : 1.7;
      const pts = [];
      for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        pts.push(new THREE.Vector3(0.1 - t * len, Math.cos(a) * r0 * (1 - t * 0.3), Math.sin(a) * r0 * (1 - t * 0.3) + Math.sin(t * 5 + k) * 0.05));
      }
      parts.push(taperedTube(new THREE.CatmullRomCurve3(pts), (t) => (k % 3 === 0 ? 0.07 : 0.022) * (1 - t * 0.7), { tubular: 14, radial: 6 }));
    }
    return mergeGeometries(parts);
  });
  g.add(new THREE.Mesh(threads, threadMat));
  return g;
}

/** The moray eel: a long tapering body, undulating as it swims. */
function buildEel(flash) {
  const opts = { mode: 0, amp: 0.32, freq: 6 };
  const g = new THREE.Group();
  const body = cached("eel-body", () => {
    const curve = new THREE.LineCurve3(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(1, 0, 0));
    // blunt head, thick neck, tapering all the way to a pointed tail
    return taperedTube(curve, (t) => 0.19 * Math.min(1, (1 - t) * 5) ** 0.6 * (0.3 + 0.7 * t ** 0.5) + 0.01, { tubular: 50, radial: 12, scaleZ: 0.85 });
  });
  g.add(new THREE.Mesh(body, bodyMaterial("eel", flash, opts)));
  // no separate dorsal fin: as the body bends sideways a flat fin twisted into a loose band above it
  addEyes(g, 0.82, 0.07, 0.09, 0.04, eyeMaterial("#e8e050", flash, opts));
  return g;
}

/**
 * The squid (and the giant squid boss): an arrow-headed mantle in front with two fins, eyes at
 * its base, eight short arms and two long club tentacles trailing behind — spread flat for the
 * overhead camera.
 */
function buildSquid(flash, { boss = false } = {}) {
  const opts = { mode: 0, amp: boss ? 0.18 : 0.24, freq: boss ? 3 : 4.5 };
  const g = new THREE.Group();
  const skin = boss ? "giantsquid" : "squid";
  const mantle = new THREE.Mesh(cached(`mantle:${skin}`, () => {
    // pointed tip in front (t → 1), full at the head end
    const geo = latheBody((t) => Math.max(0.01, 0.5 * Math.sin(Math.PI * (0.5 + t * 0.5)) ** 0.8 * (t < 0.1 ? 0.6 + t * 4 : 1)), { height: 0.42, width: 0.42 });
    return geo.scale(0.6, 1, 1).translate(0.4, 0, 0);
  }), bodyMaterial(skin, flash, opts, boss ? { glow: 0x200614 } : {}));
  g.add(mantle);
  const finMat = finMaterial(boss ? "#8a2040" : "#f09070", flash, opts);
  g.add(new THREE.Mesh(cached("squid-fins", () => {
    const parts = [];
    for (const side of [1, -1]) {
      const geo = finGeometry([[0, 0], [-0.1, 0.32], [-0.32, 0.06]]);
      geo.rotateX(side * Math.PI / 2); // flat in the horizontal plane, one fin each side
      parts.push(geo.translate(0.92, 0, 0));
    }
    return mergeGeometries(parts);
  }), finMat));
  const armMat = bodyMaterial(skin, flash, opts);
  const arms = cached(`squid-arms:${skin}`, () => {
    const parts = [];
    for (let k = 0; k < 10; k++) {
      const long = k >= 8; // the two feeding tentacles
      const a = long ? (k === 8 ? 0.22 : -0.22) : ((k + 0.5) / 8 - 0.5) * 1.5;
      const len = long ? 1.55 : 0.7;
      const pts = [];
      for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        pts.push(new THREE.Vector3(-0.15 - Math.cos(a * (0.6 + t * 0.6)) * len * t, -0.03 * t, Math.sin(a * (0.6 + t * 0.6)) * len * t));
      }
      // tentacles end in a widened club
      const r = (t) => (long ? 0.03 + (t > 0.8 ? 0.04 * Math.sin(Math.PI * (t - 0.8) / 0.2) : 0) : 0.06 * (1 - t) + 0.008);
      parts.push(taperedTube(new THREE.CatmullRomCurve3(pts), r, { tubular: 16, radial: 6 }));
    }
    return mergeGeometries(parts);
  });
  g.add(new THREE.Mesh(arms, armMat));
  addEyes(g, -0.1, 0.03, 0.14, boss ? 0.07 : 0.06, eyeMaterial(boss ? "#9fe8ff" : "#202020", flash, { ...opts, amp: 0 }));
  return g;
}

function buildManta(flash) {
  const opts = { mode: 1, amp: 0.22, freq: 3.2 };
  const g = new THREE.Group();
  const geo = cached("manta", () => {
    // plan view (x forward, wings along z): blunt head, leading edges sweeping back to pointed
    // crescent tips, concave trailing edges back to a narrow rear body
    const shape = new THREE.Shape();
    shape.moveTo(0.82, 0);
    for (const side of [1, -1]) {
      // one wing, nose → tip → rear body; the second pass mirrors it back to the nose
      const z = (v) => v * side;
      if (side > 0) {
        shape.lineTo(0.8, z(0.16));
        shape.quadraticCurveTo(0.62, z(0.95), -0.18, z(1.38));
        shape.quadraticCurveTo(-0.22, z(0.72), -0.55, z(0.26));
        shape.lineTo(-0.64, z(0.1));
      } else {
        shape.lineTo(-0.64, z(0.1));
        shape.lineTo(-0.55, z(0.26));
        shape.quadraticCurveTo(-0.22, z(0.72), -0.18, z(1.38));
        shape.quadraticCurveTo(0.62, z(0.95), 0.8, z(0.16));
        shape.lineTo(0.82, 0);
      }
    }
    // the surface is woven in rings from the centre out to the outline (the plan is star-shaped
    // around the centre), so the inside has vertices to carry the body's bulge; back and belly
    // meet at the rim in a closed lens
    const outline = shape.getPoints(24);
    outline.pop(); // the closing point repeats the first
    const N = outline.length;
    const R = 12;
    const cx = 0.05;
    const position = [];
    const uvs = [];
    const index = [];
    for (const top of [true, false]) {
      const base = position.length / 3;
      for (let r = 0; r <= R; r++) {
        const k = r / R;
        for (const p of outline) {
          const x = cx + (p.x - cx) * k;
          const z = -p.y * k; // shape y → world -z (rotateX(-90°))
          const body = Math.max(0, 1 - Math.abs(z) / 0.55) ** 1.3 * Math.max(0, 1 - Math.max(0, -x - 0.2) * 1.4);
          const t = (0.02 + 0.24 * body) * (1 - k ** 6); // zero at the rim
          const lift = 0.2 * (Math.abs(z) / 1.38) ** 2.2; // crescent: the wing tips lift
          position.push(x, (top ? t : -t * 0.55) + lift, z);
          uvs.push((x + 1) / 2, (z + 1.4) / 2.8);
        }
      }
      for (let r = 0; r < R; r++) {
        for (let i = 0; i < N; i++) {
          const a = base + r * N + i;
          const b = base + r * N + ((i + 1) % N);
          const c = a + N;
          const d = b + N;
          if (top) index.push(a, c, b, b, c, d);
          else index.push(a, b, c, b, d, c);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(index);
    geo.computeVertexNormals();
    // the outline's direction decides the winding: make the back face up
    if (geo.attributes.normal.getY((R >> 1) * N) < 0) {
      for (let i = 0; i < index.length; i += 3) [index[i + 1], index[i + 2]] = [index[i + 2], index[i + 1]];
      geo.setIndex(index);
      geo.computeVertexNormals();
    }
    return geo;
  });
  g.add(new THREE.Mesh(geo, bodyMaterial("manta", flash, opts)));
  // cephalic lobes and tail whip
  const lobeMat = bodyMaterial("manta", flash, { ...opts, amp: 0 });
  for (const side of [1, -1]) {
    const lobe = new THREE.Mesh(cached("lobe", () => sideUV(new THREE.CapsuleGeometry(0.05, 0.2, 4, 8).rotateZ(Math.PI / 2))), lobeMat);
    lobe.position.set(0.86, 0.04, 0.13 * side);
    lobe.rotation.y = -0.25 * side;
    g.add(lobe);
  }
  const tail = new THREE.Mesh(cached("mantatail", () => sideUV(new THREE.CylinderGeometry(0.012, 0.035, 1.1, 6).rotateZ(Math.PI / 2).translate(-1.15, 0, 0))), lobeMat);
  g.add(tail);
  addEyes(g, 0.72, 0.12, 0.2, 0.065, eyeMaterial("#111", flash, { ...opts, amp: 0 }));
  return g;
}

function buildTurtle(flash) {
  const still = { mode: 0, amp: 0.0, freq: 1 };
  const paddle = { mode: 2, amp: 0.5, freq: 2.6 };
  const g = new THREE.Group();
  const shellGeo = cached("shell", () => {
    const geo = new THREE.SphereGeometry(0.75, 40, 18, 0, Math.PI * 2, 0, Math.PI / 2);
    geo.scale(1.15, 0.5, 0.95);
    const pos = geo.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      // a low keel down the spine and a slight flare at the rim give the dome a carapace profile
      const keel = 0.035 * Math.max(0, 1 - Math.abs(z) / 0.18);
      const rim = Math.hypot(x / 0.86, z / 0.71);
      pos.setY(i, pos.getY(i) + keel * (1 - rim) - 0.03 * Math.max(0, rim - 0.85) / 0.15);
      uv[i * 2] = (x + 0.9) / 1.8;
      uv[i * 2 + 1] = (z + 0.75) / 1.5;
    }
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    return geo;
  });
  g.add(new THREE.Mesh(shellGeo, bodyMaterial("shell", flash, still)));
  const plastron = new THREE.Mesh(cached("plastron", () => sideUV(new THREE.CylinderGeometry(0.82, 0.78, 0.08, 28).scale(1.05, 1, 0.9))), bodyMaterial("plastron", flash, still));
  plastron.position.y = -0.02;
  g.add(plastron);
  const skin = bodyMaterial("turtle", flash, still);
  const head = new THREE.Mesh(cached("thead", () => sideUV(new THREE.SphereGeometry(0.25, 18, 12).scale(1.3, 0.82, 1))), skin);
  head.position.set(1.02, 0.07, 0);
  g.add(head);
  const neck = new THREE.Mesh(cached("tneck", () => sideUV(new THREE.CylinderGeometry(0.15, 0.19, 0.3, 12).rotateZ(Math.PI / 2))), skin);
  neck.position.set(0.8, 0.03, 0);
  g.add(neck);
  addEyes(g, 1.14, 0.13, 0.17, 0.065, eyeMaterial("#2a1a08", flash, still));
  // flippers: flat tapered blades, the front pair long and swept back like a sea turtle's
  const flipMat = bodyMaterial("turtle", flash, paddle);
  const flipGeo = cached("flipper", () => {
    const shape = new THREE.Shape();
    shape.moveTo(0.14, 0);
    shape.quadraticCurveTo(0.3, 0.55, -0.28, 1.0); // leading edge out to the tip
    shape.quadraticCurveTo(-0.22, 0.45, -0.14, 0); // trailing edge back to the root
    shape.lineTo(0.14, 0);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.025, bevelSegments: 2, curveSegments: 14 });
    geo.translate(0, 0, -0.015);
    geo.rotateX(Math.PI / 2); // shape y (outward) → +z
    const pos = geo.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      // ~2.5 scale rows across a front flipper: the pattern reads at gameplay distance
      uv[i * 2] = (pos.getX(i) + 0.5) * 0.4;
      uv[i * 2 + 1] = pos.getZ(i) * 0.4;
    }
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    return geo;
  });
  for (const [x, side, s, yaw] of [[0.42, 1, 1, 0.1], [0.42, -1, 1, 0.1], [-0.62, 1, 0.45, 0.9], [-0.62, -1, 0.45, 0.9]]) {
    const f = new THREE.Mesh(flipGeo, flipMat);
    f.position.set(x, -0.02, 0.5 * side);
    f.scale.set(s, 1, s * side);
    f.rotation.y = side * -yaw;
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
    const geo = finGeometry([[0.45, 0], [0.1, 0.35], [-0.2, 0.75], [-0.45, 0]]);
    geo.translate(0, 0.42, 0);
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

/**
 * The dragon's continuous body: a tube re-laid every frame through the head and the trailing
 * segment anchors, tapering to the tail, with red back / gold belly scales.
 */
export function buildDragonBody(flash) {
  const RINGS = 72;
  const SIDES = 14;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(RINGS * SIDES * 3);
  const uv = new Float32Array(RINGS * SIDES * 2);
  const idx = [];
  for (let r = 0; r < RINGS; r++) {
    for (let k = 0; k < SIDES; k++) {
      const a = (k / (SIDES - 1)) * Math.PI * 2;
      uv[(r * SIDES + k) * 2] = (r / (RINGS - 1)) * 9;
      uv[(r * SIDES + k) * 2 + 1] = 1 - Math.abs(a / Math.PI - 1);
      if (r < RINGS - 1 && k < SIDES - 1) {
        const i0 = r * SIDES + k;
        idx.push(i0, i0 + SIDES, i0 + 1, i0 + 1, i0 + SIDES, i0 + SIDES + 1);
      }
    }
  }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  const map = skinTexture("dragon", { own: true }).clone();
  map.wrapS = THREE.RepeatWrapping;
  map.needsUpdate = true;
  const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.4, metalness: 0.15, emissive: new THREE.Color(0x401000), emissiveMap: map });
  swimify(mat, { mode: 0, amp: 0, freq: 1, flash });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]);
  const P = new THREE.Vector3();
  const T = new THREE.Vector3();
  const N = new THREE.Vector3();
  const B = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  return {
    mesh,
    /** points: world positions head → tail; radius0: radius at the neck. */
    update(points, radius0) {
      curve.points = points;
      for (let r = 0; r < RINGS; r++) {
        const t = r / (RINGS - 1);
        curve.getPointAt(t, P);
        curve.getTangentAt(t, T);
        B.crossVectors(T, UP).normalize();
        N.crossVectors(B, T).normalize();
        // thick behind the head, swelling a little, tapering hard to the tail
        const rad = radius0 * (0.85 + 0.25 * Math.sin(Math.min(1, t * 2.2) * Math.PI * 0.5)) * (1 - t * t * 0.82);
        for (let k = 0; k < SIDES; k++) {
          const a = (k / (SIDES - 1)) * Math.PI * 2;
          const c = Math.cos(a) * rad;
          const sn = Math.sin(a) * rad * 1.05;
          const i = (r * SIDES + k) * 3;
          pos[i] = P.x + N.x * c + B.x * sn;
          pos[i + 1] = P.y + N.y * c + B.y * sn;
          pos[i + 2] = P.z + N.z * c + B.z * sn;
        }
      }
      geo.attributes.position.needsUpdate = true;
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
    },
  };
}

/**
 * Parts that share a material and bend with the body (swim mode 0: fins, the eye pair) become one
 * mesh: a bony fish draws in 3 calls instead of 8. Their transforms are baked into the geometry, so
 * the bend now reads fish-space x for every part (eyes no longer wobble off the head). Wing (manta)
 * and paddle (turtle flipper) parts move in their own local space and stay separate meshes.
 * The merged geometry is cached per species; each fish keeps its own materials (its hit flash).
 */
function mergeStatic(g, key) {
  const groups = new Map();
  for (const c of g.children) {
    if (!c.isMesh || c.material.userData.swimMode !== 0) continue;
    if (!groups.has(c.material)) groups.set(c.material, []);
    groups.get(c.material).push(c);
  }
  let i = 0;
  for (const [mat, meshes] of groups) {
    const k = `merged:${key}:${i++}`;
    if (meshes.length < 2) continue;
    const geo = cached(k, () =>
      mergeGeometries(
        meshes.map((m) => {
          m.updateMatrix();
          return m.geometry.clone().applyMatrix4(m.matrix);
        }),
      ),
    );
    if (!geo) continue; // attribute sets differ: leave the parts as they are
    for (const m of meshes) g.remove(m);
    g.add(new THREE.Mesh(geo, mat));
  }
  return g;
}

/** Build a fish group for a species (not the dragon — see fishes.js). */
export function buildFish(id) {
  const flash = { value: new THREE.Color(0, 0, 0) };
  let g;
  if (id === "treasure") return buildTreasure(flash); // the treasure bubble (not a fish; no swim shader)
  if (id === "mine") return buildMine(flash); // the sea mine (not a fish either)
  if (id === "manta") g = buildManta(flash);
  else if (id === "seahorse") g = buildSeahorse(flash);
  else if (id === "jelly") g = buildJelly(flash);
  else if (id === "eel") g = buildEel(flash);
  else if (id === "squid") g = buildSquid(flash);
  else if (id === "giantsquid") g = buildSquid(flash, { boss: true });
  else if (id === "octopus") g = buildOctopus(flash);
  else if (id === "kraken") g = buildOctopus(flash, { boss: true });
  else if (id === "turtle") g = buildTurtle(flash);
  else g = buildBony(id, flash);
  mergeStatic(g, id);
  g.userData.flash = flash;
  return g;
}

/**
 * Build every model once at boot and throw it away: the atlases fill up front, so they upload once
 * instead of again (a whole 2048×1024 upload, a hitch) the first time each new species swims in.
 * The geometry caches warm as a bonus.
 */
export function prewarmModels(ids) {
  for (const id of ids) {
    if (id === "dragon") {
      buildDragonHead(newFlash());
      buildDragonSegment(newFlash(), false);
      buildDragonSegment(newFlash(), true);
    } else buildFish(id);
  }
}

export function newFlash() {
  return { value: new THREE.Color(0, 0, 0) };
}
