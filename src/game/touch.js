/**
 * Touch → the studio's one input path. studio.js only listens to mouse events (a phone sends a
 * synthetic mousemove/mousedown on a tap, never during a drag), so a finger is translated here
 * into the same events a mouse would produce on `window`. The game keeps reading
 * `ctx.pointer` / `ctx.keys.has("Mouse1")`; no second input path exists.
 * One finger aims and holds fire; a second finger is ignored.
 */
export const isTouchDevice = () =>
  typeof matchMedia === "function" && (matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0);

export function installTouch(canvas, { onGesture = null } = {}) {
  let active = null;
  let last = { clientX: 0, clientY: 0 };
  const fire = (type, touch, buttons) =>
    window.dispatchEvent(
      new MouseEvent(type, { clientX: touch.clientX, clientY: touch.clientY, button: 0, buttons, bubbles: true }),
    );
  const find = (list) => [...list].find((t) => t.identifier === active);

  canvas.addEventListener(
    "touchstart",
    (e) => {
      e.preventDefault();
      if (active !== null) return;
      const t = e.changedTouches[0];
      active = t.identifier;
      last = t;
      onGesture?.();
      fire("mousemove", t, 0);
      fire("mousedown", t, 1);
      // landscape is the design orientation; the lock only works after a gesture (and fullscreen)
      try {
        screen.orientation?.lock?.("landscape")?.catch?.(() => {});
      } catch {
        /* not supported */
      }
    },
    { passive: false },
  );
  canvas.addEventListener(
    "touchmove",
    (e) => {
      e.preventDefault();
      const t = find(e.changedTouches);
      if (t) {
        last = t;
        fire("mousemove", t, 1);
      }
    },
    { passive: false },
  );
  const end = (e) => {
    const t = find(e.changedTouches);
    if (!t) return;
    release(t);
    // iOS only lets audio start inside a real touch handler, so the gesture is reported here
    onGesture?.();
  };
  /** Let go of the held finger, however it was lost (a system gesture, a notification, a tab switch). */
  function release(t = last) {
    if (active === null) return;
    active = null;
    fire("mouseup", t, 0);
  }
  addEventListener("blur", () => release());
  document.addEventListener("visibilitychange", () => document.hidden && release());
  canvas.addEventListener("touchend", end);
  canvas.addEventListener("touchcancel", end);
}

/**
 * The studio samples held buttons and keys once per frame, so a click whose press and release land
 * between two frames (a quick trackpad tap, a fast finger tap, a synthetic click) was never
 * seen. A release that comes sooner than MIN_PRESS_MS after its press is held back and replayed
 * on the same window, so every click is visible for at least two frames. Still one input path:
 * the studio receives the same mouse events, a little later.
 */
const MIN_PRESS_MS = 40;
export function installMinPress() {
  const downAt = new Map(); // button -> time of its press
  const replayed = new WeakSet();
  addEventListener(
    "mousedown",
    (e) => {
      downAt.set(e.button, performance.now());
    },
    { capture: true },
  );
  addEventListener(
    "mouseup",
    (e) => {
      if (replayed.has(e)) return;
      const t0 = downAt.get(e.button);
      downAt.delete(e.button);
      const held = t0 == null ? Infinity : performance.now() - t0;
      if (held >= MIN_PRESS_MS) return;
      e.stopImmediatePropagation();
      const again = new MouseEvent("mouseup", { clientX: e.clientX, clientY: e.clientY, button: e.button, buttons: e.buttons, bubbles: true });
      replayed.add(again);
      setTimeout(() => dispatchEvent(again), MIN_PRESS_MS - held);
    },
    { capture: true },
  );
  // the same for keys: a key tapped and released inside one frame (F for auto-fire, M to mute,
  // a digit for the bet) would never be seen held
  const keyAt = new Map(); // event.code -> time of its press
  addEventListener(
    "keydown",
    (e) => {
      if (!e.repeat) keyAt.set(e.code, performance.now());
    },
    { capture: true },
  );
  addEventListener(
    "keyup",
    (e) => {
      if (replayed.has(e)) return;
      const t0 = keyAt.get(e.code);
      keyAt.delete(e.code);
      const held = t0 == null ? Infinity : performance.now() - t0;
      if (held >= MIN_PRESS_MS) return;
      e.stopImmediatePropagation();
      const again = new KeyboardEvent("keyup", { key: e.key, code: e.code, bubbles: true });
      replayed.add(again);
      setTimeout(() => dispatchEvent(again), MIN_PRESS_MS - held);
    },
    { capture: true },
  );
}
