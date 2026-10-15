/**
 * Balık Avı — fish-shooting arcade prototype.
 * Flow: boot (splash) → menu → playing ⇄ paused → results; side screens store / goal /
 * collection / settings; out-of-coins overlay with a simulated rewarded ad.
 * Economy (costs, kill rolls, payouts) lives ONLY in src/economy/service.js.
 */
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { installStudio, makeRng } from "./studio.js";
import { BETS, SPECIES, STORE_PACKS, AD_REWARD, TIERS, speciesById } from "./economy/config.js";
import { EconomyService, createProfile } from "./economy/service.js";
import { Analytics } from "./economy/analytics.js";
import { buildWorld } from "./game/world.js";
import { FishSchool } from "./game/fishes.js";
import { swimTime } from "./game/fishmodels.js";
import { buildCannon, betColor } from "./game/cannon.js";
import { Effects } from "./game/effects.js";
import { Sound } from "./game/audio.js";
import { UI } from "./game/ui.js";
import { i18n } from "./game/i18n.js";
import { makeCoverShots } from "./cover-shot.js";

// ── FACET WIRING ──
// (facet imports and initialization go here)
// ── END FACET WIRING ──

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 200);
const renderStats = { calls: 0, triangles: 0 };

const FISH_Y = 3.0;
const CAM_POS = new THREE.Vector3(0, 27, 14.5);
const CAM_LOOK = new THREE.Vector3(0, 0, 0.6);

/** Playfield on the fish plane: z from top to bottom of the screen, half-width varying with z. */
const bounds = {
  zTop: -10,
  zBottom: 9,
  wTop: 18,
  wBottom: 15,
  halfW(z) {
    const k = (z - this.zTop) / (this.zBottom - this.zTop);
    return this.wTop + (this.wBottom - this.wTop) * Math.min(1, Math.max(0, k));
  },
};

function planeHit(ndcX, ndcY, y) {
  const v = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(camera);
  const dir = v.sub(camera.position).normalize();
  const t = (y - camera.position.y) / dir.y;
  return camera.position.clone().addScaledVector(dir, t);
}

function computeBounds() {
  camera.position.copy(CAM_POS);
  camera.lookAt(CAM_LOOK);
  camera.updateMatrixWorld();
  const top = planeHit(0, 1, FISH_Y);
  const bottom = planeHit(0, -1, FISH_Y);
  bounds.zTop = top.z + 0.4;
  bounds.zBottom = bottom.z - 0.2;
  bounds.wTop = planeHit(1, 1, FISH_Y).x - 0.4;
  bounds.wBottom = planeHit(1, -1, FISH_Y).x - 0.4;
}

function resize() {
  const width = Math.max(1, innerWidth);
  const height = Math.max(1, innerHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  computeBounds();
  if (cannon) placeCannon();
}
addEventListener("resize", resize);

// ── world ──
const world = buildWorld(scene);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.3;
const school = new FishSchool(scene, bounds);
const fx = new Effects(scene);
let cannon = null;
cannon = buildCannon(scene);
function placeCannon() {
  cannon.root.position.set(0, FISH_Y - 0.9, bounds.zBottom - 0.6);
}
resize();

// aim guide: a dotted line of small glow dots from the muzzle
const aimDots = new THREE.Group();
aimDots.userData.tag = "aim";
scene.add(aimDots);
const dotMat = new THREE.SpriteMaterial({ map: fx.glowTex, color: 0xbff4ff, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending });
for (let i = 0; i < 10; i++) {
  const s = new THREE.Sprite(dotMat);
  s.scale.setScalar(0.35);
  aimDots.add(s);
}

const sound = new Sound();
const analytics = new Analytics();

// ── game state ──
const G = {
  rng: makeRng(1),
  seed: 1,
  screen: "boot", // boot | menu | playing | paused | results | store | goal | collection | settings
  overlay: null, // null | out | ad
  returnTo: "menu",
  bootT: 0,
  time: 0,
  service: null,
  bet: 1,
  aim: 0,
  aimSource: "keys",
  auto: false,
  fireCooldown: 0,
  shake: 0,
  shownBalance: 0,
  banner: null, // { text, t, life, color }
  summary: null,
  adT: 0,
  notif: true,
  menuSpawn: 0,
  menuFishId: -1,
  storeMsg: null,
  lastPointer: { x: 0.5, y: 0.5 },
  bulletsInFlight: new Map(), // shotId -> bullet
  prevHeld: new Set(),
  legalShown: null,
};

function newService(seed) {
  analytics.reset();
  return new EconomyService({ rng: makeRng(seed * 7919 + 13), profile: createProfile(), analytics });
}

function reset(seed) {
  G.seed = seed;
  G.rng = makeRng(seed);
  G.service = newService(seed);
  G.screen = "boot";
  G.overlay = null;
  G.bootT = 0;
  G.time = 0;
  G.bet = 1;
  G.aim = 0;
  G.auto = false;
  G.shake = 0;
  G.banner = null;
  G.summary = null;
  G.storeMsg = null;
  G.shownBalance = G.service.profile.balance;
  G.bulletsInFlight.clear();
  G.camMode = "default";
  school.clear();
  fx.clear();
  cannon.setBet(1);
  placeCannon();
  cameraHome();
  // a few fish already swimming behind the splash/menu
  for (let i = 0; i < 9; i++) spawnAmbient(true);
}

function cameraHome() {
  if (camera.fov !== 42) {
    camera.fov = 42;
    camera.updateProjectionMatrix();
  }
  camera.position.copy(CAM_POS);
  camera.lookAt(CAM_LOOK);
}

// ── fish spawning ──
function spawnAmbient(scatter = false) {
  const tiers = ["small", "small", "small", "medium", "medium", "large"];
  const tier = tiers[Math.floor(G.rng() * tiers.length)];
  const pool = SPECIES.filter((s) => s.tier === tier);
  const sp = pool[Math.floor(G.rng() * pool.length)];
  const f = school.spawn({ fishId: G.menuFishId--, species: sp.id }, G.rng);
  if (scatter) {
    const adv = 4 + G.rng() * 22;
    f.base.addScaledVector(f.dir, adv);
    f.pos.copy(f.base);
    f.group.position.copy(f.pos);
  }
}

const schoolLeaders = new Map();
function spawnFromService(entries) {
  for (const e of entries) {
    const leader = e.school ? schoolLeaders.get(e.school) : null;
    const f = school.spawn(e, G.rng, leader ? { school: leader } : {});
    if (e.school && !leader) schoolLeaders.set(e.school, f);
    if (f.sp.tier === "boss") {
      G.banner = { text: i18n.t("bossIncoming"), t: 0, life: 3, color: "#ff5a3a" };
      G.shake = Math.max(G.shake, 1.2);
      sound.play("boss", { volume: 0.9 });
    }
  }
  if (schoolLeaders.size > 50) schoolLeaders.clear();
}

school.onLeave = (f) => {
  if (f.fishId > 0) G.service.fishLeft(f.fishId);
};

// ── session ──
function startPlay() {
  // clear menu ambient fish; the service decides what swims during play
  school.clear();
  fx.clear();
  G.bulletsInFlight.clear();
  G.service.startSession();
  G.screen = "playing";
  G.overlay = null;
  G.time = 0;
  G.summary = null;
  // pre-roll the wave director so the pool is not empty on the first frame
  for (let i = 0; i < 40; i++) {
    const entries = G.service.tick(0.25, school.alive());
    spawnFromService(entries);
    school.update(0.25, G.time);
  }
}

function endPlay() {
  for (const b of [...fx.bullets]) fx.removeBullet(b);
  G.bulletsInFlight.clear();
  G.summary = G.service.endSession();
  G.screen = "results";
  G.overlay = null;
}

function toMenu() {
  school.clear();
  fx.clear();
  G.screen = "menu";
  G.overlay = null;
  for (let i = 0; i < 9; i++) spawnAmbient(true);
}

// ── shooting ──
const tmpV = new THREE.Vector3();
function fire() {
  const svc = G.service;
  const r = svc.fire(G.bet);
  if (!r.ok) {
    if (r.reason === "insufficient") {
      // lower the bet automatically if a cheaper bullet is still affordable
      const cheaper = [...BETS].reverse().find((b) => b < G.bet && b <= svc.profile.balance);
      if (cheaper) setBet(cheaper);
      else if (fx.bullets.length === 0) G.overlay = "out";
    }
    return;
  }
  const dir = new THREE.Vector3(-Math.sin(G.aim), 0, -Math.cos(G.aim));
  const pos = cannon.muzzle(tmpV).clone();
  pos.y = FISH_Y;
  const b = fx.addBullet(r.shotId, G.bet, pos, dir);
  G.bulletsInFlight.set(r.shotId, b);
  cannon.fire();
  sound.shot(G.bet);
}

function setBet(b) {
  G.bet = b;
  cannon.setBet(b);
}

function bulletMoved(b) {
  if (b.age > 7.5) {
    // the service refunds unresolved shots at its own lifetime; drop the visual just before
    G.service.expire(b.shotId);
    G.bulletsInFlight.delete(b.shotId);
    fx.removeBullet(b);
    return;
  }
  for (const f of school.list) {
    if (f.dying || f.fishId < 0) continue;
    for (const c of school.circles(f)) {
      const dx = b.pos.x - c.x;
      const dz = b.pos.z - c.z;
      if (dx * dx + dz * dz < (c.r + 0.2) ** 2) {
        resolveHit(b, f);
        return;
      }
    }
  }
}

function resolveHit(b, f) {
  fx.removeBullet(b);
  G.bulletsInFlight.delete(b.shotId);
  const res = G.service.hit(b.shotId, f.fishId);
  fx.net(b.pos.clone(), b.bet);
  sound.hit();
  if (!res.ok) return;
  school.hitFlash(f);
  if (!res.killed) return;
  school.kill(f);
  const home = cannon.root.position.clone().add(new THREE.Vector3(0, 1.5, 0));
  const n = Math.min(40, 3 + Math.round(Math.sqrt(res.mult) * 2.2));
  fx.coinBurst(f.pos.clone(), n, home, G.rng);
  const big = res.mult >= 15;
  fx.popup(f.pos.clone(), `+${res.payout}`, big ? "#ffd84a" : "#fff3a0", big);
  if (f.sp.tier === "boss" || res.mult >= 50) {
    G.banner = { text: `${i18n.t("bigWin")}  +${res.payout}`, t: 0, life: 3, color: "#ffd84a" };
    G.shake = Math.max(G.shake, 1.0);
    sound.play("jackpot", { volume: 0.9 });
    // coin rain over the whole field
    for (let i = 0; i < 6; i++) {
      const p = new THREE.Vector3((G.rng() - 0.5) * 24, FISH_Y + 2, bounds.zTop + G.rng() * (bounds.zBottom - bounds.zTop - 3));
      fx.coinBurst(p, 8, home, G.rng);
    }
  } else {
    sound.play("coin", { volume: big ? 0.7 : 0.4, rate: big ? 0.9 : 1.1 });
  }
  if (res.first) {
    G.banner = G.banner && G.banner.t < 1 ? G.banner : { text: i18n.t("newFish", { n: i18n.speciesName(f.sp) }), t: 0, life: 2.2, color: "#8af0ff" };
  }
}

// ── input helpers ──
function pressedThisFrame(keys) {
  const out = new Set();
  for (const k of keys) if (!G.prevHeld.has(k)) out.add(k);
  return out;
}

const ui = new UI(null);
ui.onClick = () => sound.play("click", { volume: 0.5 });

// ── simulation ──
function update(dt, ctx) {
  const pressed = pressedThisFrame(ctx.keys);
  G.prevHeld = new Set(ctx.keys);
  if (pressed.size) sound.unlock();
  if (pressed.has("KeyM") || pressed.has("m")) {
    const on = !(sound.musicOn || sound.sfxOn);
    sound.setMusic(on);
    sound.setSfx(on);
  }
  sound.tick(dt);
  swimTime.value += dt;
  G.time += dt;
  world.update(dt, swimTime.value);

  const aspect = camera.aspect;
  ui.hud = window.__studio.hud;
  ui.frame(ctx, aspect, pressed);

  const playing = G.screen === "playing" && !G.overlay;

  // fish
  if (playing) {
    const entries = G.service.tick(dt, school.alive());
    spawnFromService(entries);
    school.speedScale = 1 + G.service.ramp() * 0.25;
  } else if (G.screen !== "paused" && !(G.screen === "playing" && G.overlay)) {
    // menu & side screens: ambient aquarium
    school.speedScale = 0.8;
    G.menuSpawn -= dt;
    if (G.menuSpawn <= 0 && school.alive() < 12) {
      spawnAmbient();
      G.menuSpawn = 1.2;
    }
  }
  const frozen = G.screen === "paused";
  if (!frozen) school.update(dt, G.time);

  // aim + fire
  if (playing) {
    const moved = Math.abs(ctx.pointer.x - G.lastPointer.x) + Math.abs(ctx.pointer.y - G.lastPointer.y) > 1e-4;
    G.lastPointer = { x: ctx.pointer.x, y: ctx.pointer.y };
    if (moved || ctx.keys.has("Mouse1")) G.aimSource = "pointer";
    const turn = (ctx.keys.has("ArrowLeft") || ctx.keys.has("KeyA") ? 1 : 0) - (ctx.keys.has("ArrowRight") || ctx.keys.has("KeyD") ? 1 : 0);
    if (turn || ctx.look.x) G.aimSource = "keys";
    if (G.aimSource === "keys") {
      G.aim += turn * dt * 1.8 - ctx.look.x * 0.004;
    } else {
      const p = planeHit(ctx.pointer.x * 2 - 1, -(ctx.pointer.y * 2 - 1), FISH_Y);
      const c = cannon.root.position;
      G.aim = Math.atan2(-(p.x - c.x), -(p.z - c.z));
    }
    G.aim = Math.max(-1.45, Math.min(1.45, G.aim));
    // bet hotkeys
    BETS.forEach((b, i) => {
      if (pressed.has(`Digit${i + 1}`)) setBet(b);
    });
    if (ctx.wheel.y) {
      const i = BETS.indexOf(G.bet);
      setBet(BETS[Math.max(0, Math.min(BETS.length - 1, i + (ctx.wheel.y > 0 ? -1 : 1)))]);
    }
    if (pressed.has("KeyF")) G.auto = !G.auto;
  }
  cannon.update(dt, G.aim, G.time);

  // HUD + screens (buttons may consume the click)
  drawScreen(dt, ctx, pressed);

  if (playing && G.screen === "playing" && !G.overlay) {
    G.fireCooldown -= dt;
    const overUi = ui.consumed || hudBlocks(ctx.pointer);
    const wantFire = G.auto || ctx.keys.has("Space") || (ctx.keys.has("Mouse1") && !overUi && G.aimSource === "pointer") || (ctx.keys.has("Mouse1") && G.aimSource === "keys");
    if (wantFire && G.fireCooldown <= 0 && fx.bullets.length < 30) {
      fire();
      G.fireCooldown = 1 / 6;
    }
    // bust check: no coins for the cheapest bullet and nothing in flight
    if (G.service.profile.balance < BETS[0] && fx.bullets.length === 0 && fx.coins.length === 0) G.overlay = "out";
  }

  // effects
  if (!frozen) {
    const arrived = fx.update(dt, bounds, bulletMoved);
    if (arrived) G.coinPing = (G.coinPing ?? 0) + arrived;
  }
  // displayed balance eases toward the true balance
  const bal = G.service.profile.balance;
  G.shownBalance += (bal - G.shownBalance) * Math.min(1, dt * 6);
  if (Math.abs(bal - G.shownBalance) < 0.5) G.shownBalance = bal;

  // aim dots
  aimDots.visible = playing;
  if (playing) {
    const m = cannon.muzzle(tmpV);
    aimDots.children.forEach((d, i) => {
      d.position.set(m.x - Math.sin(G.aim) * (i * 1.3 + 0.8), FISH_Y + 0.2, m.z - Math.cos(G.aim) * (i * 1.3 + 0.8));
      d.material.opacity = 0.45;
      d.scale.setScalar(0.32 - i * 0.02);
    });
    dotMat.color.setHex(betColor(G.bet));
  }

  // camera shake
  (cameras[G.camMode] ?? cameraHome)();
  if (G.shake > 0) {
    G.shake = Math.max(0, G.shake - dt);
    const a = G.shake * 0.35;
    camera.position.x += (G.rng() - 0.5) * a;
    camera.position.z += (G.rng() - 0.5) * a;
  }

  if (G.screen === "boot") {
    G.bootT += dt;
    if (G.bootT > 1.8) G.screen = "menu";
  }
  if (G.banner) {
    G.banner.t += dt;
    if (G.banner.t > G.banner.life) G.banner = null;
  }
  ui.end();
}

/** Rough boxes of the play HUD, so clicks on them never fire the cannon. */
function hudBlocks(p) {
  return p.y < 0.13 || (p.x > 0.86 && p.y < 0.2);
}

// ── screens ──
const fmt = (n) => Math.round(n).toLocaleString("tr-TR");
const COIN_PATH = "M50 6a44 44 0 1 0 0.1 0Z M50 20a30 30 0 1 1 -0.1 0Z";

function coinBadge(cx, cy, value) {
  ui.panel("bal:bg", cx, cy, 0.3, 0.075, { fill: "rgba(4,24,44,0.85)", stroke: "#ffd23a", radius: 0.037, width: 0.004 });
  ui.path("bal:icon", COIN_PATH, cx - 0.3 / camera.aspect / 2 + 0.035 / camera.aspect + 0.004, cy, 0.056, 0.056, { fill: "#ffc21a", stroke: "#8a5a00", width: 0.004 });
  ui.text("bal:v", fmt(value), cx + 0.02, cy, { size: 26, color: "#ffe680", weight: 800 });
}

function drawScreen(dt, ctx, pressed) {
  const t = (k, v) => i18n.t(k, v);
  const svc = G.service;
  switch (G.screen) {
    case "boot": {
      ui.panel("boot:veil", 0.5, 0.5, 4, 1.2, { fill: "rgba(2,18,34,0.55)", stroke: "rgba(0,0,0,0)", radius: 0 });
      ui.text("boot:title", t("title"), 0.5, 0.42, { size: 84, color: "#ffe066", weight: 900 });
      ui.text("boot:sub", t("subtitle"), 0.5, 0.52, { size: 24, color: "#bff4ff" });
      ui.bar("boot:bar", Math.min(1, G.bootT / 1.6), 0.5, 0.62, 0.6, 0.014, { color: "#3fd9ff" });
      ui.text("boot:load", t("loading"), 0.5, 0.66, { size: 16, color: "#9fcfe0" });
      if (pressed.has("Enter") || pressed.has("Space") || pressed.has("Mouse1")) G.screen = "menu";
      break;
    }
    case "menu": {
      coinBadge(0.13, 0.07, G.shownBalance);
      ui.text("menu:title", t("title"), 0.5, 0.2, { size: 78, color: "#ffe066", weight: 900 });
      ui.text("menu:sub", t("subtitle"), 0.5, 0.29, { size: 22, color: "#bff4ff" });
      if (ui.button("menu:play", t("play"), 0.5, 0.48, 0.42, 0.11, { color: "#f08a1c", size: 40, key: "Enter" })) startPlay();
      const row = 0.66;
      const items = [
        ["menu:store", t("store"), "store", "#1f9ed9"],
        ["menu:goal", t("goal"), "goal", "#22a86a"],
        ["menu:coll", t("collection"), "collection", "#8a5ad9"],
        ["menu:set", t("settings"), "settings", "#4a6a86"],
      ];
      items.forEach(([id, label, screen, color], i) => {
        if (ui.button(id, label, 0.5 + (i - 1.5) * 0.17, row, 0.27, 0.075, { color, size: 19 })) {
          G.returnTo = "menu";
          G.screen = screen;
        }
      });
      // daily bonus notification
      if (svc.dailyBonusAvailable()) {
        ui.panel("menu:daily", 0.5, 0.82, 0.74, 0.09, { fill: "rgba(60,30,0,0.8)", stroke: "#ffd23a", radius: 0.03 });
        ui.text("menu:dailyT", `🎁 ${t("dailyReady")}  ${t("day")} ${svc.profile.loginStreak + 1}: +${svc.nextDailyBonus()}`, 0.5 - 0.07 / camera.aspect, 0.82, { size: 17, color: "#ffe680" });
        if (ui.button("menu:dailyB", t("claim"), 0.5 + 0.29 / camera.aspect, 0.82, 0.11, 0.055, { color: "#f0b81c", size: 17 })) {
          svc.claimDaily();
          sound.play("coin", { volume: 0.6 });
        }
      } else {
        ui.text("menu:dailyDone", `✓ ${t("claimed")} · ${t("day")} ${svc.profile.day}`, 0.5, 0.82, { size: 16, color: "#9fe0c0" });
      }
      ui.text("menu:hint", t("hint"), 0.5, 0.95, { size: 13, color: "rgba(220,240,255,0.7)", weight: 500 });
      break;
    }
    case "playing":
      drawPlayHud(t);
      break;
    case "paused":
    case "results": {
      drawPlayHud(t, true);
      const s = G.screen === "paused" ? liveSummary() : G.summary;
      ui.panel("sum:bg", 0.5, 0.5, 0.7, 0.62, {});
      ui.text("sum:title", G.screen === "paused" ? t("paused") : t("summary"), 0.5, 0.25, { size: 34, color: "#ffe066", weight: 900 });
      const rows = [
        [t("fishCaught"), fmt(s.kills)],
        [t("totalWon"), fmt(s.won)],
        [t("spent"), fmt(s.spent)],
        [t("best"), fmt(s.best)],
        [t("time"), `${Math.floor(s.seconds / 60)}:${String(Math.floor(s.seconds % 60)).padStart(2, "0")}`],
      ];
      const lx = 0.5 - 0.27 / camera.aspect;
      const rx = 0.5 + 0.27 / camera.aspect;
      rows.forEach(([k, v], i) => {
        ui.text(`sum:k${i}`, k, lx, 0.33 + i * 0.058, { size: 20, align: "left", color: "#cfeeff", weight: 600 });
        ui.text(`sum:v${i}`, v, rx, 0.33 + i * 0.058, { size: 20, align: "right", color: "#ffffff", weight: 800 });
      });
      if (G.screen === "paused") {
        if (ui.button("sum:resume", t("resume"), 0.5 - 0.16 / camera.aspect, 0.71, 0.28, 0.08, { color: "#22a86a", size: 22, key: "Escape" })) G.screen = "playing";
        if (ui.button("sum:finish", t("finish"), 0.5 + 0.16 / camera.aspect, 0.71, 0.28, 0.08, { color: "#c2412a", size: 22 })) endPlay();
      } else if (ui.button("sum:menu", t("menu"), 0.5, 0.71, 0.36, 0.08, { color: "#f08a1c", size: 22, key: "Enter" })) toMenu();
      break;
    }
    case "store":
      drawStore(t);
      break;
    case "goal":
      drawGoal(t);
      break;
    case "collection":
      drawCollection(t);
      break;
    case "settings":
      drawSettings(t);
      break;
  }
  if (G.overlay === "out" && G.service.profile.balance >= BETS[0]) G.overlay = null;
  if (G.overlay === "out") drawOut(t);
  if (G.overlay === "ad") drawAd(t, dt);
  if (G.banner && G.screen === "playing" && !G.overlay) {
    const k = G.banner.t / G.banner.life;
    const pulse = 1 + Math.sin(G.banner.t * 10) * 0.04;
    ui.text("banner", G.banner.text, 0.5, 0.21, { size: Math.round(46 * pulse), color: k > 0.85 ? "rgba(255,255,255,0.4)" : G.banner.color, weight: 900 });
  }
}

function liveSummary() {
  const s = G.service.session?.stats ?? { kills: 0, won: 0, spent: 0, best: 0 };
  return { ...s, seconds: G.service.session?.t ?? 0 };
}

function drawPlayHud(t, passive = false) {
  const svc = G.service;
  coinBadge(0.13, 0.065, G.shownBalance);
  // bet selector (top centre)
  ui.panel("bet:bg", 0.5, 0.065, 0.5, 0.085, { fill: "rgba(4,24,44,0.85)", stroke: "rgba(140,220,255,0.6)", radius: 0.04 });
  ui.text("bet:label", t("bet"), 0.5 - 0.17 / camera.aspect, 0.065, { size: 15, color: "#9fd8f0" });
  const idx = BETS.indexOf(G.bet);
  const col = `#${betColor(G.bet).toString(16).padStart(6, "0")}`;
  if (!passive && ui.button("bet:minus", "−", 0.5 - 0.075 / camera.aspect, 0.065, 0.06, 0.06, { color: "#26506e", size: 28, enabled: idx > 0 })) setBet(BETS[idx - 1]);
  ui.text("bet:value", `${G.bet}`, 0.5 + 0.015 / camera.aspect, 0.065, { size: 34, color: col, weight: 900 });
  if (!passive && ui.button("bet:plus", "+", 0.5 + 0.105 / camera.aspect, 0.065, 0.06, 0.06, { color: "#26506e", size: 28, enabled: idx < BETS.length - 1 })) setBet(BETS[idx + 1]);
  ui.text("bet:unit", t("coins"), 0.5 + 0.19 / camera.aspect, 0.065, { size: 14, color: "#9fd8f0" });
  // auto + pause (top right)
  if (!passive) {
    if (ui.button("auto", `${t("auto")} ${G.auto ? "●" : "○"}`, 0.84, 0.065, 0.13, 0.065, { color: G.auto ? "#22a86a" : "#26506e", size: 17 })) G.auto = !G.auto;
    if (ui.button("pause", t("pause"), 0.94, 0.065, 0.075, 0.065, { color: "#26506e", size: 22, key: "Escape" })) G.screen = "paused";
  }
  // daily goal mini-progress (top left under coins)
  const goal = svc.currentGoal();
  ui.text("goal:mini", `${t(`goal_${goal.id}`)}  ${fmt(goal.progress)}/${fmt(goal.target)}`, 0.03, 0.125, { size: 14, align: "left", color: goal.progress >= goal.target ? "#7dff9a" : "#cfeeff", weight: 600 });
  ui.bar("goal:bar", goal.progress / goal.target, 0.03 + 0.11 / camera.aspect, 0.15, 0.22, 0.008, { color: "#3fd99a" });
}

function drawBack(t) {
  if (ui.button("back", t("back"), 0.08, 0.07, 0.17, 0.065, { color: "#26506e", size: 18, key: "Escape" })) G.screen = G.returnTo;
}

function drawStore(t) {
  const svc = G.service;
  ui.panel("store:veil", 0.5, 0.5, 4, 1.2, { fill: "rgba(2,18,34,0.55)", stroke: "rgba(0,0,0,0)", radius: 0 });
  drawBack(t);
  coinBadge(0.86, 0.07, G.shownBalance);
  ui.text("store:title", t("storeTitle"), 0.5, 0.17, { size: 40, color: "#ffe066", weight: 900 });
  STORE_PACKS.forEach((p, i) => {
    const cx = 0.5 + (i - 1) * 0.42 / camera.aspect;
    ui.panel(`pack:${i}`, cx, 0.46, 0.38, 0.4, { fill: "rgba(8,40,70,0.9)", stroke: "#ffd23a", radius: 0.03 });
    const coinStack = i + 1;
    for (let k = 0; k < coinStack + 1; k++) ui.path(`pack:${i}:c${k}`, COIN_PATH, cx + (k - coinStack / 2) * 0.03 / camera.aspect, 0.36 - k * 0.006, 0.07, 0.07, { fill: "#ffc21a", stroke: "#8a5a00", width: 0.004 });
    ui.text(`pack:${i}:n`, fmt(p.coins), cx, 0.46, { size: 34, color: "#ffe680", weight: 900 });
    ui.text(`pack:${i}:b`, p.bonus ? t("bonus", { n: fmt(p.bonus) }) : " ", cx, 0.51, { size: 16, color: "#7dff9a" });
    if (ui.button(`pack:${i}:buy`, `${p.priceTry}`, cx, 0.6, 0.26, 0.07, { color: "#f08a1c", size: 22, sub: null })) {
      // Store SDK flow would run here; the service only credits a verified receipt.
      const r = svc.purchase(p.id, `simulated:${p.id}:${svc.profile.lifetime.purchases}`);
      if (r.ok) {
        G.storeMsg = { text: `+${fmt(r.coins)} ${t("coins")}`, t: 0 };
        sound.play("jackpot", { volume: 0.6 });
      }
    }
  });
  // rewarded ad
  const left = svc.adsLeft();
  if (ui.button("store:ad", t("watchAd", { n: AD_REWARD.coins }), 0.5, 0.76, 0.42, 0.075, { color: "#22a86a", size: 20, enabled: left > 0, sub: t("adsLeft", { n: left }) })) {
    G.overlay = "ad";
    G.adT = 0;
  }
  ui.text("store:test", t("testPurchase"), 0.5, 0.86, { size: 14, color: "#ffcf8a", weight: 600 });
  ui.text("store:oneway", t("oneWay"), 0.5, 0.9, { size: 14, color: "#cfeeff", weight: 600 });
  if (G.storeMsg) {
    G.storeMsg.t += 1 / 60;
    ui.text("store:msg", G.storeMsg.text, 0.5, 0.27, { size: 28, color: "#7dff9a", weight: 900 });
    if (G.storeMsg.t > 1.6) G.storeMsg = null;
  }
}

function drawGoal(t) {
  const svc = G.service;
  ui.panel("goal:veil", 0.5, 0.5, 4, 1.2, { fill: "rgba(2,18,34,0.55)", stroke: "rgba(0,0,0,0)", radius: 0 });
  drawBack(t);
  coinBadge(0.86, 0.07, G.shownBalance);
  const g = svc.currentGoal();
  ui.panel("goal:card", 0.5, 0.5, 0.8, 0.5, {});
  ui.text("goal:title", t("goalTitle"), 0.5, 0.33, { size: 34, color: "#ffe066", weight: 900 });
  ui.text("goal:day", `${t("day")} ${svc.profile.day}`, 0.5, 0.39, { size: 16, color: "#9fd8f0" });
  ui.text("goal:desc", t(`goal_${g.id}`), 0.5, 0.46, { size: 28, color: "#ffffff" });
  ui.bar("goal:prog", g.progress / g.target, 0.5, 0.53, 0.6, 0.03, { color: "#3fd99a" });
  ui.text("goal:num", `${fmt(g.progress)} / ${fmt(g.target)}`, 0.5, 0.53, { size: 16, color: "#ffffff" });
  ui.text("goal:rew", `${t("reward")}: +${fmt(g.reward)} ${t("coins")}`, 0.5, 0.59, { size: 18, color: "#ffe680" });
  const ready = g.progress >= g.target && !g.claimed;
  if (g.claimed) ui.text("goal:done", `✓ ${t("done")}`, 0.5, 0.67, { size: 22, color: "#7dff9a" });
  else if (ui.button("goal:claim", t("claim"), 0.5, 0.67, 0.24, 0.07, { color: "#f0b81c", size: 22, enabled: ready })) {
    svc.claimGoal();
    sound.play("jackpot", { volume: 0.6 });
  }
}

function drawCollection(t) {
  const svc = G.service;
  ui.panel("coll:veil", 0.5, 0.5, 4, 1.2, { fill: "rgba(2,18,34,0.7)", stroke: "rgba(0,0,0,0)", radius: 0 });
  drawBack(t);
  const found = SPECIES.filter((s) => svc.profile.collection[s.id]).length;
  ui.text("coll:title", `${t("collTitle")}  ${found}/${SPECIES.length}`, 0.5, 0.1, { size: 32, color: "#ffe066", weight: 900 });
  const cols = 5;
  const cw = Math.min(0.32, (0.95 * camera.aspect) / cols - 0.02);
  const ch = 0.17;
  const tierCol = { small: "#3fb8ff", medium: "#3fd99a", large: "#ffb33a", boss: "#ff5fa2" };
  SPECIES.forEach((s, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const n = svc.profile.collection[s.id] ?? 0;
    const cx = 0.5 + (c - (cols - 1) / 2) * (cw + 0.02) / camera.aspect;
    const cy = 0.27 + r * (ch + 0.03);
    ui.panel(`coll:${s.id}`, cx, cy, cw, ch, { fill: n ? "rgba(10,50,80,0.92)" : "rgba(10,20,30,0.85)", stroke: n ? tierCol[s.tier] : "rgba(120,140,160,0.4)", radius: 0.02 });
    ui.text(`coll:${s.id}:n`, n ? i18n.speciesName(s) : t("unknown"), cx, cy - 0.045, { size: 16, color: n ? "#ffffff" : "#6a7a8a" });
    ui.text(`coll:${s.id}:t`, `${t(`tier_${s.tier}`)} · ×${s.mult[0]}${s.mult[1] !== s.mult[0] ? `–${s.mult[1]}` : ""}`, cx, cy, { size: 14, color: tierCol[s.tier], weight: 600 });
    ui.text(`coll:${s.id}:c`, n ? `✓ ${t("discovered")} · ${t("caught", { n })}` : " ", cx, cy + 0.045, { size: 11, color: "#7dff9a", weight: 600 });
  });
}

function drawSettings(t) {
  const svc = G.service;
  ui.panel("set:veil", 0.5, 0.5, 4, 1.2, { fill: "rgba(2,18,34,0.6)", stroke: "rgba(0,0,0,0)", radius: 0 });
  drawBack(t);
  ui.panel("set:card", 0.5, 0.53, 0.95, 0.78, {});
  ui.text("set:title", t("setTitle"), 0.5, 0.2, { size: 34, color: "#ffe066", weight: 900 });
  const lx = 0.5 - 0.4 / camera.aspect;
  const bx = 0.5 + 0.28 / camera.aspect;
  const row = (i, label, value, onClick, color = "#26506e") => {
    const y = 0.29 + i * 0.075;
    ui.text(`set:l${i}`, label, lx, y, { size: 19, align: "left", color: "#cfeeff", weight: 600 });
    if (ui.button(`set:b${i}`, value, bx, y, 0.3, 0.058, { color, size: value.length > 14 ? 12 : 16 })) onClick();
  };
  row(0, t("music"), sound.musicOn ? t("on") : t("off"), () => sound.setMusic(!sound.musicOn), sound.musicOn ? "#22a86a" : "#5a3a3a");
  row(1, t("sfx"), sound.sfxOn ? t("on") : t("off"), () => sound.setSfx(!sound.sfxOn), sound.sfxOn ? "#22a86a" : "#5a3a3a");
  row(2, t("notif"), G.notif ? t("on") : t("off"), () => (G.notif = !G.notif), G.notif ? "#22a86a" : "#5a3a3a");
  row(3, t("lang"), i18n.lang === "tr" ? "Türkçe" : "English", () => (i18n.lang = i18n.lang === "tr" ? "en" : "tr"));
  row(4, t("account"), t("guest"), () => {});
  row(5, t("privacy"), "›", () => (G.legalShown = "privacy"));
  row(6, t("terms"), "›", () => (G.legalShown = "terms"));
  row(7, t("nextDay"), `${t("day")} ${svc.profile.day} ›`, () => svc.advanceDay(), "#6a4a1a");
  if (G.legalShown) ui.text("set:legal", t("legal"), 0.5, 0.88, { size: 13, color: "#ffcf8a", weight: 600 });
}

function drawOut(t) {
  const svc = G.service;
  ui.panel("out:bg", 0.5, 0.5, 0.8, 0.5, { fill: "rgba(30,10,20,0.92)", stroke: "#ff7a5a" });
  ui.text("out:title", t("outTitle"), 0.5, 0.33, { size: 40, color: "#ffb08a", weight: 900 });
  ui.text("out:body", t("outBody"), 0.5, 0.41, { size: 18, color: "#ffe6dc" });
  const left = svc.adsLeft();
  if (ui.button("out:ad", t("watchAd", { n: AD_REWARD.coins }), 0.5, 0.51, 0.44, 0.08, { color: "#22a86a", size: 22, enabled: left > 0, sub: t("adsLeft", { n: left }) })) {
    G.overlay = "ad";
    G.adT = 0;
  }
  if (ui.button("out:store", t("store"), 0.5 - 0.12 / camera.aspect, 0.63, 0.22, 0.07, { color: "#1f9ed9", size: 19 })) {
    G.returnTo = G.screen;
    G.overlay = null;
    if (G.screen === "playing") G.screen = "paused";
    G.returnTo = G.screen;
    G.screen = "store";
  }
  if (ui.button("out:end", t("finish"), 0.5 + 0.12 / camera.aspect, 0.63, 0.22, 0.07, { color: "#c2412a", size: 19 })) endPlay();
}

function drawAd(t, dt) {
  G.adT += dt;
  ui.panel("ad:bg", 0.5, 0.5, 4, 1.2, { fill: "rgba(0,0,0,0.88)", stroke: "rgba(0,0,0,0)", radius: 0 });
  ui.text("ad:t", t("adPlaying"), 0.5, 0.45, { size: 26, color: "#ffffff" });
  ui.bar("ad:bar", Math.min(1, G.adT / 3), 0.5, 0.52, 0.6, 0.012, { color: "#22a86a" });
  ui.text("ad:n", `${Math.max(0, Math.ceil(3 - G.adT))}`, 0.5, 0.58, { size: 22, color: "#9fd8f0" });
  if (G.adT >= 3) {
    // production: wait for the ad network's server-side reward callback
    const r = G.service.grantAdReward();
    G.overlay = null;
    if (r.ok) {
      G.banner = { text: t("adDone", { n: r.coins }), t: 0, life: 2, color: "#7dff9a" };
      sound.play("coin", { volume: 0.7 });
    }
  }
}

// ── studio contract ──
const cameras = {
  default() {
    G.camMode = "default";
    cameraHome();
  },
  play() {
    G.camMode = "default";
    cameraHome();
  },
  cannon() {
    G.camMode = "cannon";
    const c = cannon.root.position;
    camera.position.set(c.x + 4, c.y + 5, c.z + 6);
    camera.lookAt(c.x, c.y + 0.5, c.z - 2);
  },
  fishCloseup() {
    G.camMode = "fishCloseup";
    const f = school.list.find((x) => !x.dying && x.sp.tier !== "small") ?? school.list[0];
    const p = f ? f.pos : new THREE.Vector3();
    camera.position.set(p.x + 3, p.y + 3.5, p.z + 5);
    camera.lookAt(p);
  },
};

function simulate(seconds, ctxExtra = {}) {
  const ctx = {
    rng: G.rng,
    frame: 0,
    keys: new Set(ctxExtra.keys ?? []),
    look: { x: 0, y: 0 },
    wheel: { x: 0, y: 0 },
    pointer: ctxExtra.pointer ?? { x: 0.5, y: 0.5, locked: false },
  };
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) update(1 / 60, ctx);
}

function forceSpawn(species, x, z) {
  const entry = G.service.register(species);
  if (speciesById(species).tier === "boss") G.service.session.bossAlive = true;
  const f = school.spawn(entry, G.rng);
  f.base.set(x, f.base.y, z);
  f.pos.copy(f.base);
  f.entered = true;
  f.group.position.copy(f.pos);
  if (f.trail) f.trail = f.trail.map((p, i) => new THREE.Vector3(x - f.dir.x * i * 0.12, p.y, z - f.dir.z * i * 0.12));
  return f;
}

const demos = {
    menu() {
      reset(G.seed);
      simulate(2.4);
      return { screen: G.screen };
    },
    play() {
      reset(G.seed);
      startPlay();
      simulate(3, { keys: ["Space"] });
      studio.pause?.();
      return { fish: school.alive(), bullets: fx.bullets.length };
    },
    kill() {
      reset(G.seed);
      startPlay();
      const before = G.service.profile.balance;
      setBet(5);
      G.auto = true;
      simulate(14);
      G.auto = false;
      return { kills: G.service.session.stats.kills, before, after: G.service.profile.balance };
    },
    boss() {
      reset(G.seed);
      startPlay();
      forceSpawn("dragon", -2, -2);
      G.banner = { text: i18n.t("bossIncoming"), t: 0, life: 3, color: "#ff5a3a" };
      simulate(1.2);
      return { boss: school.list.some((f) => f.sp.id === "dragon") };
    },
    goldshark() {
      reset(G.seed);
      startPlay();
      forceSpawn("goldshark", -3, -1);
      simulate(1.0);
      return {};
    },
    store() {
      reset(G.seed);
      G.screen = "store";
      simulate(0.5);
      return {};
    },
    collection() {
      reset(G.seed);
      for (const s of SPECIES.slice(0, 8)) G.service.profile.collection[s.id] = 3;
      G.screen = "collection";
      simulate(0.5);
      return {};
    },
    settings() {
      reset(G.seed);
      G.screen = "settings";
      simulate(0.5);
      return {};
    },
    out() {
      reset(G.seed);
      startPlay();
      G.service.profile.balance = 0;
      simulate(0.5);
      return { overlay: G.overlay };
    },
    results() {
      reset(G.seed);
      startPlay();
      G.auto = true;
      simulate(8);
      endPlay();
      simulate(0.3);
      return G.summary;
    },
};

let coverCam = null;
cameras.cover = () => {
  G.camMode = "cover";
  if (!coverCam) return cameraHome();
  camera.position.set(...coverCam.pos);
  camera.lookAt(...coverCam.look);
};
const coverShots = makeCoverShots({
  reset: () => reset(G.seed),
  startPlay,
  clearFish: () => school.clear(),
  forceSpawn,
  setBet,
  simulate,
  fire,
  aimAt(p) {
    const c = cannon.root.position;
    G.aimSource = "keys";
    G.aim = Math.atan2(-(p.x - c.x), -(p.z - c.z));
  },
  catchEffect(x, z) {
    const p = new THREE.Vector3(x, FISH_Y, z);
    fx.net(p, 10);
    fx.coinBurst(p, 22, cannon.root.position.clone().add(new THREE.Vector3(0, 1.5, 0)), G.rng);
  },
  hideOverlays() {
    window.__studio.hud.clear();
    aimDots.visible = false;
    for (const pp of fx.popups) pp.obj.visible = false;
    G.banner = null;
  },
  camera(cam) {
    coverCam = cam;
    camera.fov = cam.fov;
    camera.updateProjectionMatrix();
    cameras.cover();
  },
});
demos["genex-cover"] = coverShots.b;

const studio = installStudio({
  canvas: renderer.domElement,
  scene,
  renderer,
  camera,
  input: { pointerLock: false },
  reset,
  update,
  render() {
    renderer.render(scene, camera);
    renderStats.calls = renderer.info.render.calls;
    renderStats.triangles = renderer.info.render.triangles;
  },
  flow() {
    if (G.screen === "boot") return "boot";
    if (G.screen === "playing") return G.overlay ? "paused" : "playing";
    if (G.screen === "paused") return "paused";
    if (G.screen === "results") return "results";
    return "menu";
  },
  begin() {
    if (G.screen !== "playing") startPlay();
  },
  player() {
    const c = cannon.root.position;
    return { x: c.x, y: c.y, z: c.z, yaw: G.aim };
  },
  audio: () => sound.analyser,
  probes() {
    const svc = G.service;
    const s = svc.session?.stats;
    return {
      phase: "fish-shooting",
      screen: G.screen,
      overlay: G.overlay,
      balance: svc.profile.balance,
      bet: G.bet,
      aim: +G.aim.toFixed(3),
      auto: G.auto,
      fishAlive: school.alive(),
      fishByTier: Object.fromEntries(TIERS.map((tr) => [tr, school.list.filter((f) => !f.dying && f.sp.tier === tr).length])),
      bossAlive: school.list.some((f) => !f.dying && f.sp.tier === "boss"),
      bullets: fx.bullets.length,
      coinsFlying: fx.coins.length,
      session: s ? { shots: s.shots, spent: s.spent, won: s.won, kills: s.kills, refunds: s.refunds, seconds: +svc.session.t.toFixed(1), ramp: +svc.ramp().toFixed(2) } : null,
      rtpTarget: svc.rtp,
      analytics: analytics.summary(),
      collection: Object.keys(svc.profile.collection).length,
      goal: svc.currentGoal(),
      lang: i18n.lang,
      drawCalls: renderStats.calls,
      triangles: renderStats.triangles,
    };
  },
  cameras,
  demos,
});
