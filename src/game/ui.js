/**
 * Immediate-mode UI on top of __studio.hud. Each frame the active screen declares its panels,
 * texts and buttons; items not declared this frame are removed. Layout: `cx`, `cy` are
 * centre points as fractions of the frame width/height; `w`, `h` fractions of frame HEIGHT.
 * Buttons are clicked with Mouse1 (rising edge) at ctx.pointer, or by their hotkey.
 */
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
  }

  frame(ctx, aspect, pressed) {
    this.aspect = aspect;
    this.pointer = ctx.pointer;
    this.click = pressed.has("Mouse1");
    this.keysDown = pressed;
    this.consumed = false;
    this.prev = this.live;
    this.live = new Set();
  }

  end() {
    for (const id of this.prev) if (!this.live.has(id)) this.hud.remove(id);
  }

  mark(id) {
    this.live.add(id);
  }

  /** Is the pointer inside a box (cx, cy centre; w, h in frame heights)? */
  inside(cx, cy, w, h) {
    const hw = w / this.aspect / 2;
    return Math.abs(this.pointer.x - cx) <= hw && Math.abs(this.pointer.y - cy) <= h / 2;
  }

  panel(id, cx, cy, w, h, { fill = "rgba(6,30,52,0.82)", stroke = "rgba(140,220,255,0.55)", radius = 0.02, width = 0.003 } = {}) {
    this.mark(id);
    this.hud.panel(id, { x: cx - w / this.aspect / 2, y: cy - h / 2, w, h, radius, fill, stroke, width, anchor: "top-left" });
  }

  text(id, str, cx, cy, { size = 22, color = "#eaf8ff", align = "center", weight = 700 } = {}) {
    this.mark(id);
    // y is the text's vertical centre; size is in 720p design pixels
    const hFrac = size / 720;
    this.hud.text(id, String(str), { x: cx, y: cy - hFrac / 2, size, color, align, weight, anchor: "top-left" });
  }

  bar(id, frac, cx, cy, w, h, { color = "#ffd23a", back = "rgba(0,0,0,0.5)" } = {}) {
    this.mark(id);
    const wf = w / this.aspect;
    this.hud.bar(id, frac, { x: cx - wf / 2, y: cy - h / 2, w: wf, h, color, back, anchor: "top-left" });
  }

  path(id, d, cx, cy, w, h, opts = {}) {
    this.mark(id);
    this.hud.path(id, d, { x: cx - w / this.aspect / 2, y: cy - h / 2, w, h, anchor: "top-left", ...opts });
  }

  /** @returns {boolean} true on the frame the button is pressed */
  button(id, label, cx, cy, w, h, { color = "#1fa3d9", text = "#ffffff", size = 24, key = null, enabled = true, sub = null } = {}) {
    const hover = enabled && this.inside(cx, cy, w, h);
    const base = enabled ? color : "#3a4a58";
    this.panel(`${id}:bg`, cx, cy + 0.006, w, h, { fill: "rgba(0,0,0,0.35)", stroke: "rgba(0,0,0,0)", radius: h * 0.32 });
    this.panel(`${id}:fg`, cx, cy, w, h, {
      fill: hover ? lighten(base) : base,
      stroke: hover ? "#ffffff" : "rgba(255,255,255,0.45)",
      radius: h * 0.32,
      width: 0.004,
    });
    this.text(`${id}:t`, label, cx, sub ? cy - h * 0.14 : cy, { size, color: enabled ? text : "#9aa8b4", weight: 800 });
    if (sub) this.text(`${id}:s`, sub, cx, cy + h * 0.24, { size: size * 0.55, color: "rgba(255,255,255,0.85)", weight: 600 });
    let hit = false;
    if (enabled && !this.consumed) {
      if (this.click && hover) hit = true;
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

function lighten(hex) {
  if (!hex.startsWith("#") || hex.length !== 7) return hex;
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.min(255, Math.round(v + (255 - v) * 0.22));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => c(v).toString(16).padStart(2, "0")).join("")}`;
}
