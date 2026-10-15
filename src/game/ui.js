/**
 * Immediate-mode UI on top of __studio.hud. Each frame the active screen declares its panels,
 * texts and buttons; items not declared this frame are removed. Layout: `cx`, `cy` are
 * centre points as fractions of the frame width/height; `w`, `h` fractions of frame HEIGHT.
 * Buttons are clicked with Mouse1 (rising edge) at ctx.pointer, or by their hotkey.
 */
import { FONT, buttonArt, panelArt, ribbonArt, glowArt, burstArt, setSkinHud } from "./skin.js?v=hud-1";

// A single 24-unit vector family; no platform-dependent emoji or font glyphs.
const ICONS = {
  music: "M10 3V16.2A4 3 0 1 1 8 13.6V5L21 2V13.2A4 3 0 1 1 19 10.6V5.5Z",
  sound: "M3 9H7L13 4V20L7 15H3ZM16 7Q22 12 16 17L15 15Q19 12 15 9ZM19 3Q28 12 19 21L18 19Q25 12 18 5Z",
  bell: "M10 3A2 2 0 0 1 14 3V4C19 5 19 9 19 15L22 18H2L5 15C5 9 5 5 10 4ZM9 20H15A3 3 0 0 1 9 20Z",
  globe: "M12 2A10 10 0 1 0 12 22A10 10 0 1 0 12 2ZM12 4C8 8 8 16 12 20C16 16 16 8 12 4M3 12H21M5 6.5C10 9 14 9 19 6.5M5 17.5C10 15 14 15 19 17.5",
  user: "M12 2A5 5 0 1 0 12 12A5 5 0 1 0 12 2ZM3 22V19C3 11 21 11 21 19V22Z",
  lock: "M6 10V7A6 6 0 0 1 18 7V10H20V22H4V10ZM9 10H15V7A3 3 0 0 0 9 7ZM11 14V18H13V14Z",
  file: "M5 2H15L21 8V22H5ZM15 3V8H20M8 12H17M8 16H17M8 19H14",
  calendar: "M3 5H21V22H3ZM7 2V8M17 2V8M3 10H21M7 14H9M11 14H13M15 14H17M7 18H9M11 18H13M15 18H17",
  gear: "M9 2H15L16 5L19 5L22 10L20 12L22 15L19 20L16 19L15 22H9L8 19L5 20L2 15L4 12L2 10L5 5L8 5ZM12 8A4 4 0 1 0 12 16A4 4 0 1 0 12 8Z",
  play: "M5 2L22 12L5 22Z",
  stop: "M4 3H20Q22 3 22 5V19Q22 21 20 21H4Q2 21 2 19V5Q2 3 4 3Z",
  fish: "M7 7C12 1 22 6 23 12C20 20 12 21 7 17L1 21L2 12L1 3ZM17 8A1.6 1.6 0 1 0 17 11.2A1.6 1.6 0 1 0 17 8Z",
  bag: "M7 2H17L15 7C24 16 23 22 12 22S0 16 9 7ZM8 6H16V8H8ZM11 11V13H9V15H13V17H9V19H11V20H13V19H15V15H11V13H15V11H13V10H11Z",
  coin: "M12 1A11 11 0 1 0 12 23A11 11 0 1 0 12 1ZM12 4A8 8 0 1 1 12 20A8 8 0 1 1 12 4ZM11 6V8H8V12H13V14H8V16H11V18H13V16H16V12H11V10H16V8H13V6Z",
  crown: "M2 5L8 10L12 2L16 10L22 5L20 19H4ZM4 21H20V23H4Z",
  clock: "M10 1H14V4H10ZM12 5A9 9 0 1 0 12 23A9 9 0 1 0 12 5ZM12 8V14L16 16M18 3L21 6",
  back: "M15 3L6 12L15 21L18 18L12 12L18 6Z",
};
const OUTLINE_ICONS = new Set(["globe", "file", "calendar", "clock"]);

export class UI {
  constructor(hud) {
    this.hud = hud;
    this.live = new Set();
    this.prev = new Set();
    this.aspect = 16 / 9;
    this.pointer = { x: 0.5, y: 0.5 };
    this.click = false;
    this.keysDown = new Set();
    this.consumed = false;
    this.onClick = null;
    this.held = false;
    this.touch = false; // a finger has no hover: only the pressed state shows
    // what each id was last handed to the HUD with: every HUD set() repaints and re-uploads the
    // whole HUD texture, so an item that did not change is not sent again
    this.sent = new Map();
    this.writes = 0; // HUD sets this frame (0 on a still screen)
    // drawing-buffer height and pixel ratio (main sets them each frame), for text that scales with panels
    this.bufH = 720;
    this.dpr = 1;
  }

  /** Send an item to the HUD only if its arguments changed or the HUD dropped it (a clear()). */
  put(kind, id, ...args) {
    const last = this.sent.get(id);
    if (last && this.hud.get(id) === last.item && sameArgs(last.args, args)) return;
    this.hud[kind](id, ...args);
    this.sent.set(id, { args, item: this.hud.get(id) });
    this.writes += 1;
  }

  frame(ctx, aspect, pressed) {
    setSkinHud(this.hud);
    this.aspect = aspect;
    this.pointer = ctx.pointer;
    this.click = pressed.has("Mouse1");
    this.held = ctx.keys.has("Mouse1");
    this.keysDown = pressed;
    this.consumed = false;
    this.writes = 0;
    this.prev = this.live;
    this.live = new Set();
  }

  end() {
    for (const id of this.prev) {
      if (this.live.has(id)) continue;
      this.hud.remove(id);
      this.sent.delete(id);
    }
  }

  mark(id) {
    this.live.add(id);
  }

  /** Is the pointer inside a box (cx, cy centre; w, h in frame heights)? */
  inside(cx, cy, w, h) {
    const hw = w / this.aspect / 2;
    return Math.abs(this.pointer.x - cx) <= hw && Math.abs(this.pointer.y - cy) <= h / 2;
  }

  /**
   * A framed glass panel (art from skin.js). Full-screen veils (`radius: 0` or wider than 3
   * frame heights) stay plain translucent fills. The frame takes `stroke` when it is a #hex
   * accent colour, otherwise a pale cyan metal rim.
   */
  panel(id, cx, cy, w, h, { fill = "rgba(10,48,84,0.92)", stroke = null, radius = 0.02, width = 0.003, rivets = true, rays = null } = {}) {
    this.mark(id);
    const x = cx - w / this.aspect / 2;
    const y = cy - h / 2;
    if (radius > 0 && w < 3) {
      const art = panelArt(w, h, { fill, frame: stroke && stroke.startsWith("#") ? stroke : "#79cbe7", rivets, rays, capsule: radius >= h * 0.4 });
      if (art.ready) {
        this.put("image", id, art.src, { x, y, w, h, anchor: "top-left" });
        return;
      }
    }
    this.put("panel", id, { x, y, w, h, radius, fill, stroke: stroke ?? "rgba(140,220,255,0.55)", width, anchor: "top-left" });
  }

  /** A title ribbon; the label sits on its band. `h` is the whole art height. */
  ribbon(id, label, cx, cy, w, h, { color = "#e8552a", size = 34, text = "#fff6d8" } = {}) {
    const aspect = 2172 / 724; // the art's own proportions: drawn wider, the plank and ropes squash
    const height = w / aspect;
    this.image(`${id}:rb`, new URL("../../assets/ui/wood-heading-v2.webp", import.meta.url).href, cx, cy, height, aspect);
    this.text(`${id}:rt`, label, cx, cy + height * 0.015, { size, color: text, maxW: w * 0.76 });
  }

  /**
   * Holds an item's place in the HUD's draw order while its art decodes, so the image that
   * replaces it later still sits under the text drawn after it (a Map keeps first-insert order).
   */
  placeholder(id) {
    this.mark(id);
    this.put("panel", id, { x: -1, y: -1, w: 0.001, h: 0.001, fill: "rgba(0,0,0,0)", stroke: "rgba(0,0,0,0)", radius: 0, anchor: "top-left" });
  }

  /** A soft glow image centred at (cx, cy), `s` frame heights wide. */
  glow(id, cx, cy, s, color) {
    const art = glowArt(s, color);
    if (art.ready) this.image(id, art.src, cx, cy, s, 1);
    else this.placeholder(id);
  }

  /** A starburst badge with a label, optionally tilted by drawing is not possible: it stays upright. */
  burst(id, label, cx, cy, s, { color = "#ff4f5e", size = 18, text = "#ffffff", sub = null } = {}) {
    const art = burstArt(s, color);
    if (art.ready) this.image(`${id}:bu`, art.src, cx, cy, s, 1);
    else this.placeholder(`${id}:bu`);
    this.text(`${id}:bt`, label, cx, sub ? cy - s * 0.1 : cy, { size, color: text, maxW: s * 0.7 });
    if (sub) this.text(`${id}:bs`, sub, cx, cy + s * 0.2, { size: size * 0.6, color: text, maxW: s * 0.7 });
  }

  /**
   * Text centred on (cx, cy). `maxW` (frame heights) shrinks the size until the string fits —
   * Turkish compounds run longer than English, and a fixed size overflows its button or card.
   */
  text(id, str, cx, cy, { size = 22, color = "#eaf8ff", align = "center", maxW = null, font = FONT, weight = 400, shadow = true } = {}) {
    this.mark(id);
    if (maxW) {
      const width = (String(str).length * size * 0.58) / 720; // ≈ glyph width in frame heights
      if (width > maxW) size = Math.max(10, Math.floor((size * maxW) / width));
    }
    // size is in 720p design pixels. The HUD never scales text below 1:1, so on a buffer shorter
    // than 720 px it came out larger than the panels around it (23 % on a 390 px phone) and spilled
    // out of buttons; here it shrinks with the frame, but never under 11 CSS px, nor above before
    const short = Math.min(1, this.bufH / 720);
    if (short < 1) {
      size = Math.min(size, Math.max(size * short, 11 * this.dpr));
      // fitting its box wins over the floor: a label never spills out of its button
      if (maxW) size = Math.max(8, Math.min(size, (maxW * this.bufH) / (String(str).length * 0.58)));
    }
    // y is the text's vertical centre, as a fraction of the frame
    const hFrac = (size * Math.max(1, this.bufH / 720)) / this.bufH;
    this.put("text", id, String(str), { x: cx, y: cy - hFrac / 2, size, color, align, weight, font, shadow, anchor: "top-left" });
  }

  bar(id, frac, cx, cy, w, h, { color = "#ffd23a", back = "rgba(0,0,0,0.5)" } = {}) {
    this.mark(id);
    const wf = w / this.aspect;
    // a bar moves in 1/500 steps: a draining timer repaints a few times a second, not every frame
    this.put("bar", id, Math.round(frac * 500) / 500, { x: cx - wf / 2, y: cy - h / 2, w: wf, h, color, back, anchor: "top-left" });
  }

  path(id, d, cx, cy, w, h, opts = {}) {
    this.mark(id);
    this.put("path", id, d, { x: cx - w / this.aspect / 2, y: cy - h / 2, w, h, anchor: "top-left", ...opts });
  }

  /** Consistent game UI pictograms, rendered as native HUD vectors. */
  icon(id, name, cx, cy, size = 0.045, { color = "#eff8ff" } = {}) {
    const d = ICONS[name];
    if (!d) return;
    const outline = OUTLINE_ICONS.has(name);
    this.path(id, d, cx, cy, size, size, {
      viewBox: [0, 0, 24, 24], fill: outline ? null : color,
      stroke: outline ? color : null, width: size * .075,
    });
  }

  /** An image centred at (cx, cy); h in frame heights, w from the image's own aspect unless given. */
  image(id, src, cx, cy, h, aspect = 1) {
    this.mark(id);
    const w = h * aspect;
    this.put("image", id, src, { x: cx - w / this.aspect / 2, y: cy - h / 2, w, h, anchor: "top-left" });
  }

  /** @returns {boolean} true on the frame the button is pressed */
  button(id, label, cx, cy, w, h, { color = "#1fa3d9", text = "#ffffff", size = 24, key = null, enabled = true, sub = null, bare = false } = {}) {
    // a finger needs a target of ~44 px whatever the art's size: small toggles and arrows get a
    // bigger invisible hit box on touch (the art stays as drawn)
    const reach = this.touch ? 0.115 : 0;
    const over = enabled && this.inside(cx, cy, Math.max(w, reach), Math.max(h, reach));
    const state = !enabled ? "off" : over && this.held ? "down" : over && !this.touch ? "hover" : "up";
    const art = buttonArt(w, h, color, state);
    // the face sits above the lip; a pressed button sinks into it
    const faceY = cy + h * (state === "down" ? 0.012 : -0.025);
    if (bare) {
      this.placeholder(`${id}:fg`);
    } else if (art.ready) {
      this.image(`${id}:fg`, art.src, cx, cy, h, w / h);
    } else {
      this.panel(`${id}:fg`, cx, cy, w, h, { fill: color, stroke: "rgba(255,255,255,0.45)", radius: h * 0.3, width: 0.004 });
    }
    this.text(`${id}:t`, label, cx, sub ? faceY - h * 0.12 : faceY, { size, color: enabled ? text : "#9aa8b4", maxW: w * 0.86 });
    if (sub) this.text(`${id}:s`, sub, cx, faceY + h * 0.24, { size: size * 0.55, color: "rgba(255,255,255,0.85)", maxW: w * 0.86 });
    let hit = false;
    if (enabled && !this.consumed) {
      if (this.click && over) hit = true;
      if (key && this.keysDown.has(key)) hit = true;
    }
    if (hit) {
      this.consumed = true;
      this.onClick?.(id);
    }
    return hit;
  }

  /** Did a click land on any UI declared so far this frame? (main uses it to not fire through buttons) */
  pointerOver(boxes) {
    return boxes.some(([cx, cy, w, h]) => this.inside(cx, cy, w, h));
  }
}

/** Shallow equality of HUD call arguments: primitives by value, option objects key by key. */
function sameArgs(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === y) continue;
    if (!x || !y || typeof x !== "object" || typeof y !== "object") return false;
    const kx = Object.keys(x);
    if (kx.length !== Object.keys(y).length) return false;
    for (const k of kx) {
      const vx = x[k];
      const vy = y[k];
      if (vx === vy) continue;
      // nested arrays (a path's viewBox) compare element by element
      if (!Array.isArray(vx) || !Array.isArray(vy) || vx.length !== vy.length || vx.some((v, j) => v !== vy[j])) return false;
    }
  }
  return true;
}
