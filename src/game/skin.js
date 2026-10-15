/**
 * The look of the UI: a chunky arcade-nautical kit drawn once into small canvases and handed to
 * the HUD as data-URL images (the HUD's own `image` path — no DOM, no second visible canvas).
 *
 *  - buttons: thick navy outline, a coloured face with a curved gloss, a darker lip underneath
 *    that the face sinks into when pressed, brass rivets on wide ones;
 *  - panels: dark glass in a brass (or tier-coloured) frame with corner rivets.
 *
 * Every variant is cached by its parameters, so a frame costs a Map lookup. A variant is only
 * used once its image has decoded (`ready`), the caller draws a plain panel until then.
 */

export const FONT = "'Lilita One', 'Arial Rounded MT Bold', system-ui, sans-serif";

/** Loads the bundled display font (both unicode subsets, so Turkish İ Ş Ğ render in it). */
export function loadFonts() {
  if (typeof FontFace !== "function" || !document.fonts) return;
  const faces = [
    ["assets/fonts/lilita-one-latin.woff2", "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+20AC, U+2122, U+2212"],
    ["assets/fonts/lilita-one-latin-ext.woff2", "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+1E00-1E9F, U+20A0-20AB, U+20AD-20C4, U+2C60-2C7F"],
  ];
  for (const [url, range] of faces) {
    new FontFace("Lilita One", `url(${new URL("../../" + url, import.meta.url).href})`, { unicodeRange: range })
      .load()
      .then((f) => document.fonts.add(f))
      .catch((err) => console.warn(`[skin] font ${url} unavailable, using the system font`, err?.message ?? err));
  }
}

const PX = 1000; // canvas pixels per frame-height unit (a 0.115-high button is ~115 px tall)
/** Art sizes snap to 8 px, so a resized window reuses most variants instead of drawing new ones. */
const px = (v) => Math.max(8, Math.round((v * PX) / 8) * 8);
/** Most variants a session keeps; the least recently used one goes first. */
const CACHE_MAX = 160;
const cache = new Map();
let hudRef = null;
let skinFrame = 0;
/** The HUD that decodes the art (set by the UI each frame, which is also the art's clock). */
export function setSkinHud(hud) {
  hudRef = hud;
  skinFrame += 1;
  for (const e of warming) {
    if (skinFrame < e.readyAt) continue;
    e.ready = true;
    hudRef?.remove(e.warmId);
    warming.delete(e);
  }
}
/** Variants whose image the HUD is decoding off-screen; ready a few frames after it was handed over. */
const warming = new Set();
let warmSeq = 0;

function rgb(hex) {
  const n = parseInt(String(hex).replace("#", "").slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const css = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const lighten = (hex, t) => mix(rgb(hex), [255, 255, 255], t);
const shade = (hex, t) => mix(rgb(hex), [4, 14, 30], t);

function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function rivet(g, x, y, r) {
  const grad = g.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
  grad.addColorStop(0, "#fff6d0");
  grad.addColorStop(0.5, "#d9a63a");
  grad.addColorStop(1, "#5a3a08");
  g.fillStyle = grad;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "rgba(10,20,40,0.8)";
  g.lineWidth = Math.max(1, r * 0.22);
  g.stroke();
}

function entry(key, draw, W, H) {
  let e = cache.get(key);
  if (e) {
    // a hit moves to the back: the Map's first key is always the least recently used
    cache.delete(key);
    cache.set(key, e);
    return e;
  }
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  draw(c.getContext("2d"), W, H);
  e = { src: c.toDataURL("image/png"), ready: false };
  // `ready` waits for the HUD's own decode of this image: it is started off-screen right away,
  // so the first frame that uses the art never shows a hole where it should be.
  // counted in UI frames, not wall-clock time, so a stepped harness sees the same order every run
  e.warmId = `warm:${warmSeq++}`;
  const img = new Image();
  img.onload = () => {
    hudRef?.image(e.warmId, e.src, { x: -1, y: -1, w: 0.001, h: 0.001, anchor: "top-left" });
    e.readyAt = skinFrame + 4;
    warming.add(e);
  };
  img.src = e.src;
  cache.set(key, e);
  return e;
}

const NAVY = "#06182a";

/**
 * A button face. `w`, `h` in frame heights; `state`: "up" | "hover" | "down" | "off".
 * @returns {{src: string, ready: boolean}}
 */
export function buttonArt(w, h, color, state = "up") {
  const W = Math.min(900, Math.max(40, px(w)));
  const H = Math.min(260, Math.max(40, px(h)));
  const key = `b|${W}|${H}|${color}|${state}`;
  return entry(key, (g, W, H) => {
    const base = state === "off" ? "#41566b" : color;
    const compact = W / H < 2.6 && H < 75;
    const inset = Math.max(3, H * .045);
    const down = state === "down" ? H * .035 : 0;
    const fh = H - inset * 2 - H * .055;
    const r = compact ? fh / 2 : Math.min(fh * .28, 24);
    // Dark contact shadow, enamel body, and two narrow bevels.
    g.shadowColor = "rgba(0,8,20,.72)"; g.shadowBlur = H * .055; g.shadowOffsetY = H * .035;
    g.fillStyle = "#032338";
    rr(g, inset - 2, inset + down, W - inset * 2 + 4, fh + H * .055, r + 2); g.fill();
    g.shadowBlur = 0; g.shadowOffsetY = 0;
    const face = g.createLinearGradient(0, inset, 0, inset + fh);
    face.addColorStop(0, css(lighten(base, state === "hover" ? .35 : .22)));
    face.addColorStop(.25, css(lighten(base, .08)));
    face.addColorStop(.65, base);
    face.addColorStop(1, css(shade(base, .36)));
    g.fillStyle = face;
    rr(g, inset, inset + down, W - inset * 2, fh, r); g.fill();
    g.strokeStyle = css(lighten(base, .65)); g.lineWidth = Math.max(1.5,H * .018); g.stroke();
    g.strokeStyle = "rgba(255,255,255,.5)"; g.lineWidth = 1;
    rr(g, inset + 2.5, inset + down + 2.5, W - inset * 2 - 5, fh - 5, Math.max(2,r - 2.5)); g.stroke();
    // Specular highlight hugs the upper edge instead of bleaching half the face.
    g.save(); rr(g, inset + 3, inset + down + 3, W-inset*2-6, fh-6, Math.max(2,r-3)); g.clip();
    const sheen = g.createLinearGradient(0,inset,0,inset+fh*.32);
    sheen.addColorStop(0,"rgba(255,255,255,.30)"); sheen.addColorStop(1,"rgba(255,255,255,0)");
    g.fillStyle=sheen; g.fillRect(inset,inset+down,W-inset*2,fh*.32);
    g.restore();
  }, W, H);
}

/**
 * A panel: dark glass in a metal frame. `frame` is the accent colour of the frame
 * (brass by default; collection tiles pass their tier colour, the out-of-coins card red).
 */
export function panelArt(w, h, { fill = "rgba(10,48,84,0.92)", frame = "#79cbe7", rivets = true, rays = null, capsule = false } = {}) {
  const W = Math.min(1100, Math.max(24, px(w)));
  const H = Math.min(900, Math.max(24, px(h)));
  const key = `p|${W}|${H}|${fill}|${frame}|${rivets}|${rays}|${capsule}`;
  return entry(key, (g, W, H) => {
    const o = Math.max(1.4, Math.min(H, W) * 0.0035);
    const r = capsule ? H * 0.48 : Math.min(H * 0.20, W * .20, 30);
    const fr = H > 300 ? 5 : Math.max(1.8, o * 0.8); // frame thickness
    // outer shadow edge
    g.fillStyle = NAVY;
    rr(g, 0, 0, W, H, r + 2);
    g.fill();
    // frame (metal gradient)
    const mg = g.createLinearGradient(0, 0, 0, H);
    mg.addColorStop(0, css(lighten(frame, 0.55)));
    mg.addColorStop(0.45, frame);
    mg.addColorStop(1, css(shade(frame, 0.5)));
    g.fillStyle = mg;
    rr(g, o * 0.6, o * 0.6, W - o * 1.2, H - o * 1.2, r);
    g.fill();
    // glass
    const ix = o * 0.6 + fr;
    g.fillStyle = NAVY;
    rr(g, ix - 0.35, ix - 0.35, W - ix * 2 + 0.7, H - ix * 2 + 0.7, Math.max(3, r - fr + 1));
    g.fill();
    g.fillStyle = fill;
    rr(g, ix, ix, W - ix * 2, H - ix * 2, Math.max(3, r - fr));
    g.fill();
    // soft top light on the glass
    g.save();
    rr(g, ix, ix, W - ix * 2, H - ix * 2, Math.max(3, r - fr));
    g.clip();
    const sh = g.createLinearGradient(0, ix, 0, ix + (H - ix * 2) * 0.5);
    sh.addColorStop(0, "rgba(160,225,255,0.16)");
    sh.addColorStop(1, "rgba(160,225,255,0)");
    g.fillStyle = sh;
    g.fillRect(ix, ix, W - ix * 2, H - ix * 2);
    if (rays) {
      // a lit stage: light rays fanning from behind the contents, and a warm core
      const cx = W / 2;
      const cy = H * 0.42;
      const [rr0, gg0, bb0] = rgb(rays);
      g.fillStyle = `rgba(${rr0},${gg0},${bb0},0.10)`;
      for (let k = 0; k < 14; k += 2) {
        const a0 = (k / 14) * Math.PI * 2;
        const a1 = ((k + 1) / 14) * Math.PI * 2;
        g.beginPath();
        g.moveTo(cx, cy);
        g.lineTo(cx + Math.cos(a0) * H * 2, cy + Math.sin(a0) * H * 2);
        g.lineTo(cx + Math.cos(a1) * H * 2, cy + Math.sin(a1) * H * 2);
        g.closePath();
        g.fill();
      }
      const core = g.createRadialGradient(cx, cy, 0, cx, cy, H * 0.55);
      core.addColorStop(0, `rgba(${rr0},${gg0},${bb0},0.55)`);
      core.addColorStop(1, `rgba(${rr0},${gg0},${bb0},0)`);
      g.fillStyle = core;
      g.fillRect(ix, ix, W - ix * 2, H - ix * 2);
    }
    // Gentle caustic variation remains quiet behind labels.
    for (let k = 0; k < 6; k++) {
      g.strokeStyle = "rgba(100,205,246,.018)"; g.lineWidth = 1;
      g.beginPath();
      g.moveTo(ix, H * (.18 + k * .15));
      g.bezierCurveTo(W * .25, H * (.12 + k * .15), W * .66, H * (.24 + k * .15), W - ix, H * (.16 + k * .15));
      g.stroke();
    }
    g.restore();
    g.lineWidth = .9; g.strokeStyle = "rgba(125,210,244,.20)";
    rr(g, ix + 2, ix + 2, W - ix * 2 - 4, H - ix * 2 - 4, Math.max(3, r - fr)); g.stroke();
    if (rivets && W > 140 && H > 70) {
      const rad = Math.max(3, fr * 0.55);
      const m = o * 0.6 + fr / 2 + r * 0.32;
      for (const [rx, ry] of [[m, m], [W - m, m], [m, H - m], [W - m, H - m]]) rivet(g, rx, ry, rad);
    }
  }, W, H);
}

/** Rope-hung timber title plaque. The legacy ribbon API keeps every screen compatible. */
export function ribbonArt(w, h, color = "#a6652b") {
  const W = Math.min(1000, Math.max(60, px(w)));
  const H = Math.min(260, Math.max(40, px(h)));
  return entry(`wood|${W}|${H}|${color}`, (g, W, H) => {
    const x = W * 0.035, y = H * 0.19, bw = W * 0.93, bh = H * 0.69;
    const plank = () => {
      g.beginPath(); g.moveTo(x + H * .10, y + H * .015);
      g.bezierCurveTo(W * .30, y - H * .035, W * .64, y + H * .035, W - x - H * .10, y);
      g.quadraticCurveTo(W - x, y - H * .005, W - x + H * .015, y + H * .15);
      g.lineTo(W - x - H * .015, y + bh * .49); g.lineTo(W - x + H * .005, y + bh * .56);
      g.quadraticCurveTo(W - x + H * .02, y + bh, W - x - H * .13, y + bh);
      g.bezierCurveTo(W * .67, y + bh + H * .035, W * .34, y + bh - H * .025, x + H * .10, y + bh);
      g.quadraticCurveTo(x - H * .025, y + bh, x, y + bh * .70);
      g.lineTo(x + H * .015, y + bh * .47); g.lineTo(x - H * .012, y + bh * .39);
      g.quadraticCurveTo(x - H * .01, y + H * .025, x + H * .10, y + H * .015); g.closePath();
    };
    // The hanging ropes are part of the plaque silhouette, never a separate HUD surface.
    for (const rx of [W * 0.11, W * 0.89]) {
      g.lineCap = "round";
      g.strokeStyle = "#38200f"; g.lineWidth = H * 0.064;
      g.beginPath(); g.moveTo(rx, 0); g.lineTo(rx, H * 0.37); g.stroke();
      g.strokeStyle = "#c9914c"; g.lineWidth = H * 0.039; g.stroke();
      for (let n = 0; n < 7; n++) {
        const ry = n * H * 0.045;
        g.strokeStyle = n % 2 ? "#f3ce89" : "#7b4a22";
        g.lineWidth = H * 0.012;
        g.beginPath(); g.moveTo(rx - H * 0.018, ry); g.lineTo(rx + H * 0.018, ry + H * 0.023); g.stroke();
      }
    }
    g.shadowColor = "rgba(0,8,18,.8)"; g.shadowBlur = H * .04; g.shadowOffsetY = H * .04;
    const wood = g.createLinearGradient(0, y, 0, y + bh);
    wood.addColorStop(0, "#ddaa60"); wood.addColorStop(.12, "#a9672e");
    wood.addColorStop(.52, "#9c5b29"); wood.addColorStop(.70, "#8b4b21"); wood.addColorStop(1, "#663715");
    g.fillStyle = wood; plank(); g.fill();
    g.shadowBlur = 0; g.shadowOffsetY = 0;
    g.lineWidth = Math.max(2, H * .035); g.strokeStyle = "#382215"; g.stroke();
    g.save(); plank(); g.clip();
    // Curved grain and plank seams use fixed phases so the cached art is deterministic.
    for (let k = 0; k < 9; k++) {
      const gy = y + bh * (.055 + k * .112);
      g.beginPath(); g.moveTo(x, gy);
      g.bezierCurveTo(W * .28, gy + Math.sin(k * 2.3) * H * .07, W * .65, gy - Math.cos(k * 1.7) * H * .05, W - x, gy + Math.sin(k) * H * .025);
      g.strokeStyle = k === 4 ? "rgba(46,21,8,.56)" : "rgba(255,206,133,.13)";
      g.lineWidth = k === 4 ? H * .018 : H * .006; g.stroke();
    }
    g.restore();
    g.strokeStyle = "rgba(255,218,152,.65)"; g.lineWidth = Math.max(1, H * .014);
    plank(); g.stroke();
    for (const rx of [W * .11, W * .89]) {
      g.fillStyle = "#281b13"; g.beginPath(); g.ellipse(rx, y + bh * .19, H * .055, H * .065, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = "#c8a36d"; g.lineWidth = H * .013; g.stroke();
      rivet(g, rx, y + bh * .77, H * .026);
    }
  }, W, H);
}

/** A soft round glow (the light behind a coin pile / a lit card). */
export function glowArt(size, color = "#ffd24a") {
  const S = Math.min(512, Math.max(32, Math.round(size * PX * 0.5)));
  return entry(`g|${S}|${color}`, (g, S) => {
    const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grad.addColorStop(0, css(lighten(color, 0.55)).replace("rgb", "rgba").replace(")", ",0.9)"));
    grad.addColorStop(0.35, css(rgb(color)).replace("rgb", "rgba").replace(")", ",0.4)"));
    grad.addColorStop(1, css(rgb(color)).replace("rgb", "rgba").replace(")", ",0)"));
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
  }, S, S);
}

/** A starburst badge ("+500 bonus", "NEW"). Square art; text goes on top. */
export function burstArt(size, color = "#ff4f5e", points = 14) {
  const S = Math.min(300, Math.max(40, px(size)));
  return entry(`s|${S}|${color}|${points}`, (g, S) => {
    const c = S / 2;
    const o = Math.max(3, S * 0.035);
    const outer = c - o;
    const inner = outer * 0.8;
    const path = () => {
      g.beginPath();
      for (let k = 0; k < points * 2; k++) {
        const a = (k / (points * 2)) * Math.PI * 2 - Math.PI / 2;
        const r = k % 2 ? inner : outer;
        g.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
      }
      g.closePath();
    };
    const grad = g.createRadialGradient(c * 0.8, c * 0.7, S * 0.05, c, c, outer);
    grad.addColorStop(0, css(lighten(color, 0.5)));
    grad.addColorStop(0.55, color);
    grad.addColorStop(1, css(shade(color, 0.3)));
    g.fillStyle = grad;
    path();
    g.fill();
    g.lineWidth = o;
    g.lineJoin = "round";
    g.strokeStyle = NAVY;
    path();
    g.stroke();
    g.lineWidth = Math.max(1.5, S * 0.015);
    g.strokeStyle = "rgba(255,255,255,0.45)";
    g.beginPath();
    g.arc(c, c, inner * 0.86, 0, Math.PI * 2);
    g.stroke();
  }, S, S);
}
