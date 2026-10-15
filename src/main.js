/**
 * Balık Avı — fish-shooting arcade prototype.
 * Flow: boot (splash) → menu → playing ⇄ paused → results; side screens store / goal /
 * collection / settings; out-of-coins overlay with a simulated rewarded ad.
 * Economy (costs, kill rolls, payouts) lives ONLY in src/economy/service.js.
 */
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { installStudio, makeRng } from "./studio.js";
import { BETS, SPECIES, STORE_PACKS, AD_REWARD, TIERS, speciesById, JACKPOT_SEED, COMBO_WINDOW, FEVER_SECONDS, FIRE_RATE, BET_MIN_SHOTS, JACKPOT_FIXED, CANNON_SKINS, FREE_COINS_PER_DAY, xpForLevel, ROOMS, roomById, MINE, LIGHTNING, FROST, SPECIAL, EVENTS } from "./economy/config.js";
import { EconomyService, createProfile } from "./economy/service.js";
import { Analytics } from "./economy/analytics.js";
import { buildWorld } from "./game/world.js";
import { FishSchool } from "./game/fishes.js";
import { swimTime, prewarmModels, atlasUse } from "./game/fishmodels.js";
import { buildCannon, betColor, SKIN_PALETTES } from "./game/cannon.js";
import { Effects } from "./game/effects.js";
import { Sound } from "./game/audio.js";
import { UI } from "./game/ui.js?v=settings-5";
import { i18n } from "./game/i18n.js";
import { makeCoverShots } from "./cover-shot.js";
import { createPost } from "./game/post.js";
import { installTouch, installMinPress, isTouchDevice } from "./game/touch.js";
import { loadFonts } from "./game/skin.js?v=settings-5";

// ── FACET WIRING ──
// (facet imports and initialization go here)
// ── END FACET WIRING ──

const TOUCH = isTouchDevice();
// MSAA lives on the post composer's target (post.js); the canvas itself is only blitted to
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, TOUCH ? 1.5 : 2));
// test tools (the next-day skip) only with ?dev in the URL: a player must never mint daily bonuses
const DEV = new URLSearchParams(location.search).has("dev");
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
document.body.appendChild(renderer.domElement);
installTouch(renderer.domElement, { onGesture: () => sound.unlock() });
installMinPress();
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 200);
const renderStats = { calls: 0, triangles: 0 };
let post = null;

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
  post?.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  computeBounds();
  if (cannon) placeCannon();
}
addEventListener("resize", resize);
// the iOS address bar and rotation can change the viewport without a plain `resize`
addEventListener("orientationchange", () => setTimeout(resize, 120));
window.visualViewport?.addEventListener("resize", resize);

// ── world ──
const world = buildWorld(scene);
post = createPost(renderer, scene, camera, { low: TOUCH });
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.3;
const school = new FishSchool(scene, bounds);
// every species and special target painted into the texture atlases before the first frame
prewarmModels([...SPECIES, ...SPECIAL].map((s) => s.id));
const fx = new Effects(scene);
fx.setView(camera.quaternion); // camera-facing effect quads follow the (shaking) camera
let cannon = null;
cannon = buildCannon(scene);
function placeCannon() {
  cannon.root.position.set(0, FISH_Y - 1.2, bounds.zBottom - 1.5);
}
resize();

// aim guide: a dotted line of small glow dots from the muzzle
// (one Points draw; the dots shrink with distance through a per-point size attribute)
const AIM_DOTS = 10;
const aimGeo = new THREE.BufferGeometry();
aimGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(AIM_DOTS * 3), 3));
const dotMat = new THREE.PointsMaterial({ map: fx.glowTex, color: 0xbff4ff, size: 0.8, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending });
const aimDots = new THREE.Points(aimGeo, dotMat);
aimDots.frustumCulled = false;
aimDots.userData.tag = "aim";
scene.add(aimDots);

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

// ── persistence ──
// Only a real player's boot loads this: every reset(seed) (the harness, the demos) starts from
// a fresh profile, so seeded runs stay deterministic. Saved on claims, purchases and session end.
const SAVE_KEY = "balikavi.save.v1";
function saveProfile() {
  try {
    localStorage.setItem(
      SAVE_KEY,
      JSON.stringify({ v: 1, profile: G.service.snapshot(), settings: { music: sound.musicOn, sfx: sound.sfxOn, notif: G.notif, lang: i18n.lang } }),
    );
  } catch {
    /* private mode / storage blocked: the game plays on without saving */
  }
}
function loadSaved() {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY) ?? "null");
    if (!raw || raw.v !== 1) return;
    const base = createProfile();
    const p = raw.profile ?? {};
    const num = (v, d) => (Number.isFinite(v) && v >= 0 ? v : d);
    Object.assign(G.service.profile, {
      balance: num(p.balance, base.balance),
      day: Math.max(1, num(p.day, 1)),
      loginStreak: num(p.loginStreak, 0),
      dailyClaimedDay: num(p.dailyClaimedDay, 0),
      adsToday: num(p.adsToday, 0),
      jackpot: num(p.jackpot, JACKPOT_SEED),
      freeToday: num(p.freeToday, 0),
      // today's missions are kept only if they are well-formed; otherwise the day rolls them again
      missions:
        Number.isInteger(p.missions?.day) && Array.isArray(p.missions?.list) && p.missions.list.length === 3
          ? { day: p.missions.day, list: p.missions.list.map((m) => ({ id: String(m?.id ?? ""), progress: num(m?.progress, 0), claimed: m?.claimed === true })) }
          : null,
      xp: num(p.xp, 0),
      level: Math.max(1, Math.floor(num(p.level, 1))),
      skins: ["bronze", ...(Array.isArray(p.skins) ? p.skins.filter((k) => SKIN_PALETTES[k] && k !== "bronze") : [])],
      skin: SKIN_PALETTES[p.skin] ? p.skin : "bronze",
      collection: Object.fromEntries(Object.entries(p.collection && typeof p.collection === "object" ? p.collection : {}).filter(([k, v]) => speciesById(k) && Number.isFinite(v) && v >= 0)),
      lifetime: Object.fromEntries(Object.entries(base.lifetime).map(([k, d]) => [k, num(p.lifetime?.[k], d)])),
    });
    G.shownBalance = G.service.profile.balance;
    // a mission list from an older pool table is rolled again rather than trusted
    try {
      G.service.missions();
    } catch {
      G.service.profile.missions = null;
    }
    if (!G.service.profile.skins.includes(G.service.profile.skin)) G.service.profile.skin = "bronze";
    cannon.setSkin(G.service.profile.skin);
    const st = raw.settings ?? {};
    sound.setMusic(st.music !== false);
    sound.setSfx(st.sfx !== false);
    G.notif = st.notif !== false;
    if (st.lang === "tr" || st.lang === "en") i18n.lang = st.lang;
  } catch {
    /* a corrupt save is ignored */
  }
}
addEventListener("pagehide", () => G?.service && saveProfile());
document.addEventListener("visibilitychange", () => document.hidden && G?.service && saveProfile());

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
  G.jpFlash = null;
  G.summary = null;
  G.storeMsg = null;
  G.shownBalance = G.service.profile.balance;
  G.bulletsInFlight.clear();
  G.camMode = "default";
  G.room = "reef";
  G.collPage = "reef";
  world.setRoom("reef");
  G.hitStop = 0;
  G.slowT = 0;
  G.fireCooldown = 0;
  G.fireArmed = false;
  G.bossHits = 0;
  G.menuSpawn = 0;
  G.menuFishId = -1;
  G.aimSource = "keys";
  G.lastPointer = { x: 0.5, y: 0.5 };
  G.prevHeld = new Set();
  swimTime.value = 0;
  schoolLeaders.clear();
  school.clear();
  fx.clear();
  cannon.setBet(1);
  cannon.setSkin("bronze");
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
  // the menu aquarium is the reef: its own fish only
  const pool = roomById("reef").species.map(speciesById).filter((s) => s.tier === tier);
  const sp = pool[Math.floor(G.rng() * pool.length)];
  const f = school.spawn({ fishId: G.menuFishId--, species: sp.id }, G.rng);
  if (scatter) {
    const adv = 4 + G.rng() * 22;
    f.base.addScaledVector(f.dir, adv);
    f.pos.copy(f.base);
    f.group.position.copy(f.pos);
  }
}

// golden fish carry a pulsing halo (shared material: the pulse is one number per frame)
const goldAuraMat = new THREE.SpriteMaterial({ map: fx.glowTex, color: 0xffb81a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.6 });
// and a swirl of gold glints spiralling around the body (one Points draw per golden fish)
const goldGlintGeo = (() => {
  const g = new THREE.BufferGeometry();
  const p = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const r = 0.95 + (i % 3) * 0.2;
    p.push(((i * 0.37) % 1.6) - 0.8, Math.cos(a) * r * 0.75, Math.sin(a) * r);
  }
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  return g;
})();
const goldGlintMat = new THREE.PointsMaterial({ map: fx.glowTex, color: 0xffd04a, size: 0.9, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
function addGoldAura(f) {
  const halo = new THREE.Sprite(goldAuraMat);
  halo.userData.tag = "gold-aura";
  halo.scale.setScalar(3.4);
  f.group.add(halo);
  const glints = new THREE.Points(goldGlintGeo, goldGlintMat);
  glints.userData.tag = "gold-glint";
  f.group.add(glints);
  f.goldGlints = glints;
  f.gold = true;
}

/** Haptics on touch devices (a short pulse per hit, a pattern for big wins). */
function buzz(pattern) {
  if (TOUCH && G.notif !== false) navigator.vibrate?.(pattern);
}

const schoolLeaders = new Map();
function spawnFromService(entries) {
  for (const e of entries) {
    const leader = e.school ? schoolLeaders.get(e.school) : null;
    const f = school.spawn(e, G.rng, leader ? { school: leader } : {});
    if (e.school && !leader) schoolLeaders.set(e.school, f);
    if (e.species === "treasure" && G.screen === "playing") {
      G.banner = { text: i18n.t("treasureIn"), t: 0, life: 2.4, color: "#ffe27a", size: 34 };
      sound.play("chime", { volume: 0.6, rate: 1.2 });
    }
    if (e.species === "mine" && G.screen === "playing") {
      G.banner = { text: i18n.t("mineIn"), t: 0, life: 2.4, color: "#ff8a5a", size: 34 };
      sound.play("thump", { volume: 0.5, rate: 1.3 });
    }
    if ((e.species === "volt" || e.species === "frost") && G.screen === "playing") {
      G.banner = { text: i18n.t(e.species === "volt" ? "voltIn" : "frostIn"), t: 0, life: 2.4, color: e.species === "volt" ? "#ffe23a" : "#bff4ff", size: 34 };
      sound.play("chime", { volume: 0.5, rate: e.species === "volt" ? 1.4 : 0.8 });
    }
    if (e.gold) addGoldAura(f);
    if (f.sp.tier === "boss") {
      // two bosses in one batch: the boss tour
      const tour = entries.filter((x) => speciesById(x.species)?.tier === "boss").length > 1;
      G.banner = { text: i18n.t(tour ? "bossTour" : "bossIncoming"), t: 0, life: 3, color: "#ff5a3a" };
      G.shake = Math.max(G.shake, 1.2);
      sound.play("boss", { volume: 0.9 });
    }
  }
  if (schoolLeaders.size > 50) schoolLeaders.clear();
}

school.onLeave = (f) => {
  if (f.sp.tier === "boss") G.bossHits = 0;
  if (f.fishId > 0) G.service.fishLeft(f.fishId);
};

// ── session ──
function startPlay(roomId = "reef") {
  // clear menu ambient fish; the service decides what swims during play
  school.clear();
  fx.clear();
  G.bulletsInFlight.clear();
  G.service.startSession(roomId); // refunds the shots of a session it replaces
  // the room the service actually opened (a closed room falls back to the reef)
  G.room = G.service.room.id;
  world.setRoom(G.room);
  setBet(G.service.bets()[0]);
  G.bossHits = 0;
  G.tidePhase = "calm";
  G.nextReminder = 600;
  G.screen = "playing";
  G.overlay = null;
  G.time = 0;
  G.summary = null;
  // pre-roll the wave director so the pool is not empty on the first frame
  for (let i = 0; i < 40; i++) {
    const entries = G.service.preroll(0.25, school.alive());
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
  saveProfile();
}

function toMenu() {
  school.clear();
  fx.clear();
  G.room = "reef";
  world.setRoom("reef");
  G.screen = "menu";
  G.overlay = null;
  for (let i = 0; i < 9; i++) spawnAmbient(true);
}

// kill-burst colours per tier: cool for small fry, warm for the big catches
const TIER_FX = { small: 0x8af0ff, medium: 0x7dff9a, large: 0xffb02a, boss: 0xff5a3a };

// ── shooting ──
const tmpV = new THREE.Vector3();
function fire() {
  const svc = G.service;
  const r = svc.fire(G.bet);
  if (!r.ok) {
    if (r.reason === "insufficient") {
      // lower the bet automatically if a cheaper bullet is still affordable
      const cheaper = [...svc.bets()].reverse().find((b) => b < G.bet && b <= svc.profile.balance);
      if (cheaper) setBet(cheaper);
      else if (fx.bullets.length === 0) {
        G.overlay = "out";
        G.auto = false; // a rewarded ad's coins must not be auto-fired away
      }
    } else if (r.reason === "bet-cap") setBet(r.maxBet);
    return;
  }
  const dir = new THREE.Vector3(-Math.sin(G.aim), 0, -Math.cos(G.aim));
  const pos = cannon.muzzle(tmpV).clone();
  pos.y = FISH_Y;
  const b = fx.addBullet(r.shotId, G.bet, pos, dir);
  G.bulletsInFlight.set(r.shotId, b);
  cannon.fire();
  fx.muzzleFlash(cannon.muzzle(tmpV), G.bet);
  sound.shot(G.bet);
}

function setBet(b) {
  const cap = G.service.maxBet();
  if (b > cap) {
    // a locked bet says what opens it instead of silently refusing
    G.banner = { text: i18n.t("betLocked", { n: fmt(b * BET_MIN_SHOTS) }), t: 0, life: 1.6, color: "#8af0ff", size: 24 };
    b = cap;
  }
  G.bet = b;
  // barrels count by the bet's rank in the room (4 bets: 1–4 barrels; 3 bets: 2–4)
  const bets = G.service.bets();
  cannon.setBet(b, bets.indexOf(b) + 1 + (4 - bets.length));
}

function bulletMoved(b) {
  if (!G.service.isLive(b.shotId)) {
    // the service ages shots in real time, these bullets in hit-stop/slow-motion time: once it
    // has refunded one, the visual goes too instead of touching a fish with no effect
    G.bulletsInFlight.delete(b.shotId);
    fx.removeBullet(b);
    return;
  }
  if (b.age > 7.5) {
    // the service refunds unresolved shots at its own lifetime; drop the visual just before
    G.service.expire(b.shotId);
    G.bulletsInFlight.delete(b.shotId);
    fx.removeBullet(b);
    sound.miss();
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
  if (!res.ok) {
    // the service already refunded a shot at a fish it no longer knows: no phantom hit
    if (res.refunded) sound.miss();
    return;
  }
  fx.net(b.pos.clone(), b.bet);
  sound.hit(b.bet, G.service.features().combo);
  if (res.fixedPay) {
    // a fixed-odds MINI / MINOR jackpot can land on any hit, kill or not
    const minor = res.fixedTier === "minor";
    G.banner = { text: `${i18n.t(minor ? "minorWin" : "miniWin")}  +${fmt(res.fixedPay)}`, t: 0, life: 3.2, color: minor ? "#ff9a3a" : "#7dd3ff", size: 40 };
    G.jpFlash = { tier: minor ? 1 : 0, t: 0 }; // its pill beside the jackpot lights up
    G.shake = Math.max(G.shake, minor ? 1.1 : 0.7);
    sound.play("jackpot", { volume: minor ? 0.9 : 0.6 });
    window.__studio.hud.flash(minor ? "#ff9a3a" : "#7dd3ff", 0.22);
    fx.coinBurst(f.pos.clone(), minor ? 30 : 16, cannon.root.position.clone().add(new THREE.Vector3(0, 1.5, 0)), G.rng);
    buzz(minor ? [40, 30, 80, 30, 120] : [30, 20, 50]);
  }
  school.hitFlash(f);
  if (!res.killed) {
    // every hit is felt: a tiny camera nudge and the fish flinches away from the bullet
    G.shake = Math.max(G.shake, 0.07 + Math.min(0.1, b.bet * 0.01));
    f.base.x += b.dir.x * 0.18;
    f.base.z += b.dir.z * 0.18;
    buzz(8);
    if (f.sp.tier === "boss") {
      // a boss almost never dies to one bullet: show the damage so the fight reads as progress
      G.bossHits = (G.bossHits ?? 0) + 1;
      fx.popup(b.pos.clone(), `${G.bossHits}`, "#ff9a7a", false);
    }
    return;
  }
  if (f.sp.tier === "boss") G.bossHits = 0;
  school.kill(f);
  if (f.sp.id === "mine") blowMine(f, b.bet);
  if (f.sp.id === "volt") chainLightning(f);
  if (f.sp.id === "frost") freezeSea();
  // the kill reads as an impact: shockwave + shards in the tier's colour (gold for golden fish)
  const burstCols = (res.gold ? [0xffd24a, 0xfff2b0, 0xffa31a] : [TIER_FX[f.sp.tier], 0xffffff, betColor(b.bet)]).map((c) => new THREE.Color(c));
  fx.killBurst(f.pos.clone(), burstCols, { small: 1, medium: 1.5, large: 2.2, boss: 3 }[f.sp.tier], G.rng);
  const home = cannon.root.position.clone().add(new THREE.Vector3(0, 1.5, 0));
  const n = Math.min(40, 3 + Math.round(Math.sqrt(res.mult * (res.gold || 1)) * 2.2));
  fx.coinBurst(f.pos.clone(), n, home, G.rng);
  const big = res.mult >= 15 || res.gold >= 3;
  const tag = [res.gold ? `×${res.gold}` : "", res.combo > 1 ? `${i18n.t("combo")} ×${res.combo}` : "", res.fever ? "×2" : ""].filter(Boolean).join("  ");
  fx.popup(f.pos.clone(), `+${res.payout - res.jackpot}`, res.gold ? "#ffd84a" : big ? "#ffd84a" : "#fff3a0", big);
  if (tag) {
    const at = f.pos.clone();
    at.z += 1.6;
    fx.popup(at, tag, res.gold ? "#ffb02a" : "#8af0ff", false);
  }
  // the payoff ladder: the heavier the fish, the heavier the beat
  const tier = f.sp.tier;
  if (tier === "medium") {
    G.hitStop = 0.05;
    buzz(18);
  } else if (tier === "large") {
    G.hitStop = 0.07;
    G.slowT = 0.35;
    G.shake = Math.max(G.shake, 0.5);
    window.__studio.hud.flash("#ffd24a", 0.18);
    sound.play("thump", { volume: 0.8 });
    buzz([30, 20, 50]);
  } else if (tier === "boss") {
    G.hitStop = 0.12;
    G.slowT = 0.6;
    window.__studio.hud.flash("#ffd24a", 0.3);
    sound.play("thump", { volume: 1 });
    buzz([40, 30, 80, 30, 120]);
  } else {
    buzz(10);
  }
  if (res.gold) sound.play("chime", { volume: 0.6, rate: 0.9 + res.gold * 0.1 });
  if (res.jackpot > 0) {
    G.banner = { text: `${i18n.t("jackpotWin")}  +${fmt(res.jackpot)}`, t: 0, life: 4.5, color: "#ffd84a", size: 40 };
    G.shake = Math.max(G.shake, 1.6);
    sound.play("jackpot", { volume: 1 });
    for (let i = 0; i < 14; i++) {
      const p = new THREE.Vector3((G.rng() - 0.5) * 26, FISH_Y + 2, bounds.zTop + G.rng() * (bounds.zBottom - bounds.zTop - 3));
      fx.coinBurst(p, 10, home, G.rng);
    }
  } else if (f.sp.tier === "boss" || res.mult >= 50) {
    G.banner = { text: `${i18n.t("bigWin")}  +${res.payout}`, t: 0, life: 3, color: "#ffd84a" };
    G.shake = Math.max(G.shake, 1.0);
    sound.play("jackpot", { volume: 0.9 });
    for (let i = 0; i < 6; i++) {
      const p = new THREE.Vector3((G.rng() - 0.5) * 24, FISH_Y + 2, bounds.zTop + G.rng() * (bounds.zBottom - bounds.zTop - 3));
      fx.coinBurst(p, 8, home, G.rng);
    }
  } else {
    sound.play("coin", { volume: big ? 0.7 : 0.4, rate: big ? 0.9 : 1.1 });
  }
  if (f.sp.tier === "boss" && res.jackpot === 0) {
    // a boss kill opens the golden storm
    G.banner = { text: i18n.t("feverStart"), t: 0, life: 3, color: "#ffb02a", size: 44 };
  }
  if (res.first) {
    G.banner = G.banner && G.banner.t < 1 ? G.banner : { text: i18n.t("newFish", { n: i18n.speciesName(f.sp) }), t: 0, life: 2.2, color: "#8af0ff", size: 28 };
  }
  if (res.levelUps?.length) celebrateLevel(res.levelUps);
}

/**
 * A sea mine went off: the fish its blast reaches (no bosses) are reported to the service, which
 * takes them off the sea; they burst here as a show. The mine's own payout already landed.
 */
function blowMine(mine, bet) {
  const near = school.list.filter((o) => o !== mine && !o.dying && o.fishId > 0 && o.sp.tier !== "boss" && !o.sp.special && o.pos.distanceTo(mine.pos) <= MINE.radius);
  near.sort((a, c) => a.pos.distanceTo(mine.pos) - c.pos.distanceTo(mine.pos));
  const { taken } = G.service.blast(near.map((o) => o.fishId));
  const home = cannon.root.position.clone().add(new THREE.Vector3(0, 1.5, 0));
  for (const id of taken) {
    const o = near.find((x) => x.fishId === id);
    school.kill(o);
    fx.killBurst(o.pos.clone(), [new THREE.Color(0xff8a3a), new THREE.Color(0xffe27a), new THREE.Color(0xffffff)], 1.2, G.rng);
    fx.coinBurst(o.pos.clone(), 4, home, G.rng);
  }
  fx.killBurst(mine.pos.clone(), [new THREE.Color(0xff6a1a), new THREE.Color(0xffd04a), new THREE.Color(0xffffff)], 3.2, G.rng);
  G.banner = { text: i18n.t("mineBoom", { n: taken.length }), t: 0, life: 2.6, color: "#ffb04a", size: 40 };
  G.shake = Math.max(G.shake, 1.4);
  G.hitStop = Math.max(G.hitStop ?? 0, 0.08);
  window.__studio.hud.flash("#ffb04a", 0.25);
  sound.play("thump", { volume: 1 });
  buzz([40, 30, 90]);
}

/**
 * A lightning fish went down: lightning jumps from it to the fish of the most numerous species on
 * screen (no bosses), nearest first. The service takes them off unpaid (the lightning fish's own
 * payout was the prize); here each one is struck in turn.
 */
function chainLightning(src) {
  const pool = school.list.filter((o) => o !== src && !o.dying && o.fishId > 0 && o.sp.tier !== "boss" && !o.sp.special);
  const count = new Map();
  for (const o of pool) count.set(o.sp.id, (count.get(o.sp.id) ?? 0) + 1);
  const species = [...count.entries()].sort((a, c) => c[1] - a[1])[0]?.[0];
  const prey = pool.filter((o) => o.sp.id === species).sort((a, c) => a.pos.distanceTo(src.pos) - c.pos.distanceTo(src.pos)).slice(0, LIGHTNING.maxTaken);
  const { taken } = G.service.blast(prey.map((o) => o.fishId));
  const home = cannon.root.position.clone().add(new THREE.Vector3(0, 1.5, 0));
  let from = src.pos.clone();
  taken.forEach((id, k) => {
    const o = prey.find((x) => x.fishId === id);
    fx.bolt(from, o.pos.clone(), G.rng, k * 0.025);
    from = o.pos.clone();
    school.kill(o);
    fx.killBurst(o.pos.clone(), [new THREE.Color(0xbfe8ff), new THREE.Color(0xffe23a), new THREE.Color(0xffffff)], 1, G.rng);
    fx.coinBurst(o.pos.clone(), 3, home, G.rng);
  });
  const name = species ? i18n.speciesName(speciesById(species)) : "";
  G.banner = { text: i18n.t("voltBoom", { n: taken.length, s: name }), t: 0, life: 2.6, color: "#ffe23a", size: 36 };
  G.shake = Math.max(G.shake, 0.9);
  window.__studio.hud.flash("#cfe8ff", 0.22);
  sound.play("thump", { volume: 0.8, rate: 1.4 });
  buzz([20, 20, 20, 20, 60]);
}

/** A frost fish went down: every fish on screen freezes for a few seconds. */
function freezeSea() {
  school.freeze(FROST.seconds);
  G.banner = { text: i18n.t("frostBoom", { n: FROST.seconds }), t: 0, life: 2.6, color: "#bff4ff", size: 38 };
  window.__studio.hud.flash("#bff4ff", 0.3);
  sound.play("chime", { volume: 0.8, rate: 0.6 });
  buzz(60);
}

/** A level-up: banner, chime, gold flash; a new cannon finish is put on right away. */
function celebrateLevel(ups) {
  const last = ups[ups.length - 1];
  const skin = ups.map((u) => u.skin).filter(Boolean).pop();
  const coins = ups.reduce((a, u) => a + u.coins, 0);
  const extra = skin ? `  ·  ${i18n.t("newSkin", { n: i18n.t(`skin_${skin}`) })}` : coins ? `  +${fmt(coins)}` : "";
  G.banner = { text: `${i18n.t("levelUp", { n: last.level })}${extra}`, t: 0, life: 3, color: "#ffe27a", size: 34 };
  sound.play("jackpot", { volume: 0.55, rate: 1.15 });
  window.__studio.hud.flash("#ffe27a", 0.15);
  if (skin) {
    G.service.setSkin(skin);
    cannon.setSkin(skin);
  }
  saveProfile();
}

// ── input helpers ──
function pressedThisFrame(keys) {
  const out = new Set();
  for (const k of keys) if (!G.prevHeld.has(k)) out.add(k);
  return out;
}

loadFonts();
const ui = new UI(null);
ui.touch = TOUCH;
ui.onClick = () => sound.play("click", { volume: 0.5 });

const hudBuf = new THREE.Vector2();

// ── simulation ──
function update(dt, ctx) {
  const pressed = pressedThisFrame(ctx.keys);
  G.prevHeld = new Set(ctx.keys);
  if (pressed.size || ctx.keys.has("Mouse1")) sound.unlock();
  if (pressed.has("KeyM") || pressed.has("m")) {
    sound.setMuted(!sound.muted);
    saveProfile();
  }
  sound.tick(dt);
  swimTime.value += dt;
  G.time += dt;
  world.update(dt, swimTime.value);

  const aspect = camera.aspect;
  ui.hud = window.__studio.hud;
  ui.frame(ctx, aspect, pressed);
  renderer.getDrawingBufferSize(hudBuf);
  ui.bufH = Math.min(hudBuf.x, hudBuf.y);
  ui.dpr = renderer.getPixelRatio();
  // a new screen starts with a clean HUD, so its veil is drawn after (never over) what it shares
  const hudSig = `${G.screen}|${G.overlay}`;
  if (hudSig !== G.hudSig) {
    G.hudSig = hudSig;
    G.fireArmed = false;
    ui.hud.clear();
    ui.prev = new Set();
  }

  // portrait phone: the field is built for landscape, so the game holds still behind a prompt
  if (aspect < 0.85) {
    ui.panel("rot:bg", 0.5, 0.5, 4, 1.2, { fill: "rgba(2,18,34,0.88)", stroke: "rgba(0,0,0,0)", radius: 0 });
    ui.text("rot:t", i18n.t("rotate"), 0.5, 0.46, { size: 40, color: "#ffe066", weight: 900, maxW: 0.9 * aspect });
    ui.text("rot:s", i18n.t("rotateSub"), 0.5, 0.54, { size: 22, color: "#bff4ff", maxW: 0.9 * aspect });
    ui.end();
    return;
  }

  const playing = G.screen === "playing" && !G.overlay;

  // fish
  if (playing) {
    const entries = G.service.tick(dt, school.alive());
    spawnFromService(entries);
    school.speedScale = G.service.tideSpeed();
    // tide phase changes are announced (the boss has its own countdown)
    const tide = G.service.features().tide;
    if (tide && tide.phase !== G.tidePhase) {
      if (tide.phase === "rush") {
        G.banner = { text: i18n.t("tideRushStart"), t: 0, life: 2.2, color: "#8af0ff", size: 34 };
        sound.play("thump", { volume: 0.4, rate: 0.9 });
      } else if (tide.phase === "reward" && tide.reward === "tide") {
        G.banner = { text: i18n.t("tideTideStart"), t: 0, life: 2.8, color: "#ffd84a", size: 36 };
        sound.play("chime", { volume: 0.7 });
      }
      G.tidePhase = tide.phase;
    }
    // responsible play: every 10 minutes of a session the game says how long it has been
    const played = G.service.session.t;
    if (played >= G.nextReminder) {
      G.nextReminder += 600;
      G.banner = { text: i18n.t("playReminder", { n: Math.floor(played / 60) }), t: 0, life: 4.5, color: "#bff4ff", size: 26 };
    }
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
  // hit-stop and the slow-motion beat after a big kill scale the fish and effects, not the clock
  let sdt = dt;
  if (G.hitStop > 0) {
    G.hitStop = Math.max(0, G.hitStop - dt);
    sdt = 0;
  } else if (G.slowT > 0) {
    G.slowT = Math.max(0, G.slowT - dt);
    sdt = dt * 0.35;
  }
  if (!frozen) school.update(sdt, G.time);
  goldAuraMat.opacity = 0.35 + 0.15 * Math.sin(G.time * 5);
  goldGlintMat.opacity = 0.65 + 0.35 * Math.sin(G.time * 9);
  if (!frozen) for (const f of school.list) if (f.goldGlints) f.goldGlints.rotation.x += sdt * 2.6;

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
    const BETS = G.service.bets();
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
    if (ui.consumed) G.fireArmed = false;
    else if (!ctx.keys.has("Mouse1")) G.fireArmed = true;
    const wantFire = G.auto || ctx.keys.has("Space") || (ctx.keys.has("Mouse1") && G.fireArmed && !overUi);
    if (wantFire && G.fireCooldown <= 0 && fx.bullets.length < 30) {
      fire();
      G.fireCooldown = 1 / FIRE_RATE;
    }
    // bust check: no coins for the cheapest bullet and nothing in flight
    if (G.service.profile.balance < G.service.bets()[0] && fx.bullets.length === 0 && fx.coins.length === 0) {
      G.overlay = "out";
      G.auto = false;
    }
  }

  // effects
  if (!frozen) {
    const arrived = fx.update(sdt, bounds, bulletMoved);
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
    const at = aimGeo.attributes.position;
    for (let i = 0; i < AIM_DOTS; i++) {
      // later dots sit closer together so the line reads as tapering away
      const d = i * 1.3 + 0.8 - i * i * 0.025;
      at.setXYZ(i, m.x - Math.sin(G.aim) * d, FISH_Y + 0.2, m.z - Math.cos(G.aim) * d);
    }
    at.needsUpdate = true;
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
    // the menu opens once the art is in (after a short splash), or after 10 s whatever arrived
    const loaded = preload.total === 0 || preload.done >= preload.total;
    if ((loaded && G.bootT > 1.2) || G.bootT > 10) G.screen = "menu";
  }
  if (G.banner) {
    G.banner.t += dt;
    if (G.banner.t > G.banner.life) G.banner = null;
  }
  if (G.jpFlash && (G.jpFlash.t += dt) > 1.6) G.jpFlash = null;
  ui.end();
}

/** Rough boxes of the play HUD, so clicks on them never fire the cannon. */
function hudBlocks(p) {
  return p.y < 0.15 || (Math.abs(p.x - 0.5) < 0.17 && p.y < 0.23);
}

// ── screens ──
const fmt = (n) => Math.round(n).toLocaleString(i18n.lang === "tr" ? "tr-TR" : "en-US");
/** Side margin that keeps edge controls off a notch / rounded corner. */
const SAFE = TOUCH ? 0.05 : 0.03;
/** Touch-target height in frame heights: ≈44 px on a 390 px-high landscape phone. */
const BTN = 0.115;
const leftX = (w) => SAFE + w / camera.aspect / 2;
const rightX = (w) => 1 - SAFE - w / camera.aspect / 2;
const COIN_IMG = new URL("../assets/ui/coin.webp", import.meta.url).href;
// The boot bar measures this: the large screen art (2-3 MB each) and the fish portraits are
// fetched while the splash shows, so no later screen opens on half-loaded art.
const preload = (() => {
  const files = ["logo", "logo-en", "coin", "reef-backdrop-v1", "settings-reef-v3", "pause-frame-v2", "wood-heading-v2", "room-reef", "room-wreck", "room-deep"];
  for (const sp of SPECIES) files.push(`fish-${sp.id}`, `fish-${sp.id}-locked`);
  for (const sp of SPECIAL) files.push(`fish-${sp.id}`);
  const state = { total: files.length, done: 0 };
  if (typeof Image !== "function") return { total: 0, done: 0 };
  for (const f of files) {
    const img = new Image();
    img.onload = img.onerror = () => (state.done += 1); // a missing file must not hold the menu back
    img.src = new URL(`../assets/ui/${f}.webp`, import.meta.url).href;
  }
  return state;
})();
const LOGO_IMG = new URL("../assets/ui/logo.webp", import.meta.url).href;
// the English title art: same backing, letters and mascots style, composed from the game's font
// and collection portraits (assets/src/logo-en.html), same 900×541 frame
const LOGO_EN_IMG = new URL("../assets/ui/logo-en.webp", import.meta.url).href;
const logoImg = () => (i18n.lang === "tr" ? LOGO_IMG : LOGO_EN_IMG);
const LOGO_ASPECT = 900 / 541;
const COIN_PATH = "M50 6a44 44 0 1 0 0.1 0Z M50 20a30 30 0 1 1 -0.1 0Z";

function coinBadge(cx, cy, value) {
  ui.panel("bal:bg", cx, cy, 0.3, 0.09, { radius: 0.045, rivets: false, stroke: "#7dd9f3" });
  ui.image("bal:icon", COIN_IMG, cx - 0.3 / camera.aspect / 2 + 0.03 / camera.aspect, cy, 0.072, 192 / 198);
  ui.text("bal:v", fmt(value), cx + 0.02, cy, { size: 26, color: "#ffe680", weight: 800 });
}

function drawScreen(dt, ctx, pressed) {
  const t = (k, v) => i18n.t(k, v);
  const svc = G.service;
  // Illustrated reef frames the menus; the live 3D aquarium remains the playfield.
  if (G.screen !== "playing") {
    const reefAspect = 1672 / 941;
    const reefHeight = Math.max(1, camera.aspect / reefAspect);
    const isSettings = G.screen === "settings";
    ui.image("screen:reef", new URL(isSettings ? "../assets/ui/settings-reef-v3.webp" : "../assets/ui/reef-backdrop-v1.webp", import.meta.url).href, 0.5, isSettings ? 0.57 : 0.5, reefHeight * (isSettings ? 1.14 : 1), reefAspect);
  }
  switch (G.screen) {
    case "boot": {
      ui.panel("boot:veil", 0.5, 0.5, 4, 1.2, { fill: "rgba(2,18,34,0.55)", stroke: "rgba(0,0,0,0)", radius: 0 });
      ui.image("boot:logo", logoImg(), 0.5, 0.36, 0.42, LOGO_ASPECT);
      ui.text("boot:sub", t("subtitle"), 0.5, 0.6 - 0.04, { size: 24, color: "#bff4ff" });
      ui.bar("boot:bar", preload.total ? preload.done / preload.total : 1, 0.5, 0.62, 0.6, 0.014, { color: "#3fd9ff" });
      ui.text("boot:load", t("loading"), 0.5, 0.66, { size: 16, color: "#9fcfe0" });
      if (pressed.has("Enter") || pressed.has("Space") || pressed.has("Mouse1")) G.screen = "menu";
      break;
    }
    case "menu": {
      coinBadge(leftX(0.3), 0.075, G.shownBalance);
      ui.image("menu:logo", logoImg(), 0.5, 0.2, 0.3, LOGO_ASPECT);
      ui.text("menu:sub", t("subtitle"), 0.5, 0.375, { size: 20, color: "#bff4ff", maxW: 1.6 });
      // PLAY opens the sea map: the room is chosen there (a new player sees what the next one asks)
      if (ui.button("menu:play", t("play"), 0.5, 0.505, 0.46, 0.13, { color: "#f08a1c", size: 44, key: "Enter" })) {
        G.returnTo = "menu";
        G.screen = "map";
      }
      const row = 0.69;
      const items = [
        ["menu:store", t("store"), "store", "#1f9ed9"],
        ["menu:goal", t("goal"), "goal", "#22a86a"],
        ["menu:coll", t("collection"), "collection", "#8a5ad9"],
        ["menu:set", t("settings"), "settings", "#4a6a86"],
      ];
      items.forEach(([id, label, screen, color], i) => {
        if (ui.button(id, label, 0.5 + (i - 1.5) * 0.178, row, 0.28, BTN, { color, size: 19 })) {
          G.returnTo = "menu";
          G.screen = screen;
        }
      });
      // missions ready to claim: a red count on the corner of their button
      const ready = svc.missions().filter((m) => m.done && !m.claimed).length;
      if (ready) {
        const bx = 0.5 + (-0.5 * 0.178) + 0.12 / camera.aspect;
        ui.panel("menu:goalN:bg", bx, row - 0.05, 0.05, 0.05, { fill: "#e2354a", stroke: "#ffffff", radius: 0.025, rivets: false });
        ui.text("menu:goalN", `${ready}`, bx, row - 0.05, { size: 16, color: "#ffffff" });
      }
      // daily bonus notification
      if (svc.dailyBonusAvailable()) {
        ui.panel("menu:daily", 0.5, 0.855, 0.9, 0.12, { fill: "rgba(60,30,0,0.8)", stroke: "#ffd23a", radius: 0.04 });
        ui.text("menu:dailyT", `${t("dailyReady")}  ${t("day")} ${svc.streak() + 1}: +${svc.nextDailyBonus()}`, 0.5 - 0.1 / camera.aspect, 0.855, { size: 17, color: "#ffe680", maxW: 0.52 });
        if (ui.button("menu:dailyB", t("claim"), 0.5 + 0.33 / camera.aspect, 0.855, 0.2, 0.1, { color: "#f0b81c", size: 19 })) {
          svc.claimDaily();
          sound.play("coin", { volume: 0.6 });
          saveProfile();
        }
      } else {
        ui.text("menu:dailyDone", `${t("claimed")} · ${t("day")} ${svc.profile.day}`, 0.5, 0.855, { size: 17, color: "#9fe0c0", maxW: 1.2 });
      }
      if (!TOUCH) {
        // a dark strip under the controls hint: on the bright sand the pale text did not read
        ui.panel("menu:hintbg", 0.5, 0.952, 1.5, 0.042, { fill: "rgba(2,22,40,0.6)", stroke: "rgba(0,0,0,0)", radius: 0.021, rivets: false });
        ui.text("menu:hint", t("hint"), 0.5, 0.952, { size: 15, color: "#e8f6ff", weight: 500, maxW: 1.45 });
      }
      break;
    }
    case "playing":
      drawPlayHud(t);
      break;
    case "paused":
    case "results": {
      drawPlayHud(t, true);
      const s = G.screen === "paused" ? liveSummary() : G.summary;
      ui.image("sum:bg", new URL("../assets/ui/pause-frame-v2.webp", import.meta.url).href, 0.5, 0.52, 0.82, 1);
      ui.image("sum:mascot", new URL("../assets/ui/fish-clown.webp", import.meta.url).href, 0.5 + 0.29 / camera.aspect, 0.17, 0.13, 1.6);
      ui.text("sum:title", G.screen === "paused" ? t("paused") : t("summary"), 0.5, 0.252, { size: 38, color: "#fff2cd", maxW: 0.63 });
      // the net line comes right after won/spent: the player sees what the session really cost
      const net = s.won - s.spent;
      const pct = s.spent > 0 ? ((s.won / s.spent) * 100).toLocaleString(i18n.lang === "tr" ? "tr-TR" : "en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : null;
      const rows = [
        [t("fishCaught"), fmt(s.kills), "fish", "#087da4"],
        [t("totalWon"), fmt(s.won), "coin", "#cb9213"],
        [t("spent"), fmt(s.spent), "bag", "#3e922d"],
        [t("net"), `${net > 0 ? "+" : net < 0 ? "−" : ""}${fmt(Math.abs(net))}`, "coin", net >= 0 ? "#1f8a3a" : "#b8322a"],
        [t("best"), fmt(s.best), "crown", "#cd9313"],
        [t("time"), `${Math.floor(s.seconds / 60)}:${String(Math.floor(s.seconds % 60)).padStart(2, "0")}`, "clock", "#8d6c27"],
        [t("rtpRow"), pct === null ? "—" : i18n.lang === "tr" ? `%${pct}` : `${pct} %`, null, null],
      ];
      const lx = 0.5 - 0.155 / camera.aspect;
      const rx = 0.5 + 0.235 / camera.aspect;
      // seven rows end above the buttons at 0.735 (they start at 0.675)
      rows.forEach(([k, v, icon, color], i) => {
        const y = 0.36 + i * 0.047;
        if (icon) ui.icon(`sum:icon${i}`, icon, 0.5 - 0.21 / camera.aspect, y, 0.038, { color });
        ui.text(`sum:k${i}`, k, lx, y, { size: 19, align: "left", color: "#352716", weight: 600 });
        ui.text(`sum:v${i}`, v, rx, y, { size: 19, align: "right", color: i === 3 ? color : "#352716", weight: 800 });
      });
      if (G.screen === "paused") {
        if (ui.button("sum:resume", t("resume"), 0.5 - 0.205 / camera.aspect, 0.735, 0.38, 0.12, { color: "#06bf76", size: 25, key: "Escape" })) G.screen = "playing";
        if (ui.button("sum:finish", t("finish"), 0.5 + 0.205 / camera.aspect, 0.735, 0.38, 0.12, { color: "#ef304b", size: 25 })) endPlay();
        ui.icon("sum:play", "play", 0.5 - 0.337 / camera.aspect, 0.725, 0.044);
        ui.icon("sum:stop", "stop", 0.5 + 0.078 / camera.aspect, 0.725, 0.044);
      } else if (ui.button("sum:menu", t("menu"), 0.5, 0.735, 0.4, 0.105, { color: "#f08a1c", size: 22, key: "Enter" })) toMenu();
      break;
    }
    case "store":
      drawStore(t, dt);
      break;
    case "goal":
      drawGoal(t, dt);
      break;
    case "collection":
      drawCollection(t);
      break;
    case "map":
      drawMap(t);
      break;
    case "settings":
      drawSettings(t);
      break;
  }
  if (G.overlay === "out" && G.service.profile.balance >= G.service.bets()[0]) G.overlay = null;
  if (G.overlay === "out") drawOut(t);
  if (G.overlay === "ad") drawAd(t, dt);
  if (G.banner && G.screen === "playing" && !G.overlay) {
    const k = G.banner.t / G.banner.life;
    const pulse = 1 + Math.sin(G.banner.t * 10) * 0.04;
    // above the middle of the field: the centre stays clear for aiming
    ui.text("banner", G.banner.text, 0.5, 0.33, { size: Math.round((G.banner.size ?? 46) * pulse), color: k > 0.85 ? "rgba(255,255,255,0.4)" : G.banner.color, weight: 900 });
  }
}

function liveSummary() {
  const s = G.service.session?.stats ?? { kills: 0, won: 0, spent: 0, best: 0 };
  return { ...s, seconds: G.service.session?.t ?? 0 };
}

function drawPlayHud(t, passive = false) {
  const svc = G.service;
  const asp = camera.aspect;
  coinBadge(leftX(0.3), 0.075, G.shownBalance);
  // below 1.7:1 (16:10, 4:3) the three top groups do not fit side by side at full width: the bet
  // selector tightens by 15 % and the auto / sound buttons narrow
  const k = asp < 1.7 ? 0.85 : 1;
  const sideW = asp < 1.7 ? 0.13 : 0.2;
  // bet selector (top centre)
  ui.panel("bet:bg", 0.5, 0.075, 0.56 * k, passive ? 0.09 : 0.125, { radius: 0.06, rivets: false, stroke: "#7dd9f3" });
  ui.text("bet:label", t("bet"), 0.5 - (0.215 * k) / asp, 0.075, { size: 15, color: "#9fd8f0", maxW: 0.12 * k });
  const BETS = svc.bets();
  const idx = BETS.indexOf(G.bet);
  const col = `#${betColor(G.bet).toString(16).padStart(6, "0")}`;
  if (!passive && ui.button("bet:minus", "−", 0.5 - (0.1 * k) / asp, 0.075, BTN, BTN, { color: "#2b78ad", size: 32, enabled: idx > 0 })) setBet(BETS[idx - 1]);
  ui.text("bet:value", `${G.bet}`, 0.5 + (0.005 * k) / asp, 0.075, { size: 38, color: col, weight: 900 });
  if (!passive && ui.button("bet:plus", "+", 0.5 + (0.11 * k) / asp, 0.075, BTN, BTN, { color: idx < BETS.length - 1 && BETS[idx + 1] <= svc.maxBet() ? "#2b78ad" : "#4a5f70", size: 32, enabled: idx < BETS.length - 1 })) setBet(BETS[idx + 1]);
  ui.text("bet:unit", t("coins"), 0.5 + (0.215 * k) / asp, 0.075, { size: 14, color: "#9fd8f0", maxW: 0.1 * k });
  // mute + auto + pause (top right)
  if (!passive) {
    if (ui.button("pause", t("pause"), rightX(BTN), 0.075, BTN, BTN, { color: "#2b78ad", size: 24, key: "Escape" })) {
      G.screen = "paused";
      saveProfile();
    }
    const gap = 0.012;
    const autoX = rightX(BTN) - (BTN / 2 + gap + sideW / 2) / asp;
    const muteX = autoX - (sideW + gap) / asp;
    if (ui.button("auto", `${t("auto")} ${G.auto ? t("on") : t("off")}`, autoX, 0.075, sideW, BTN, { color: G.auto ? "#22a86a" : "#2b78ad", size: 18 })) G.auto = !G.auto;
    if (ui.button("mute", sound.muted ? t("sndOff") : t("snd"), muteX, 0.075, sideW, BTN, { color: sound.muted ? "#7a3a3a" : "#2b78ad", size: 16 })) {
      sound.setMuted(!sound.muted);
      saveProfile();
    }
  }
  // daily goal mini-progress (top left under coins)
  // level and XP under the coins, then the first open mission
  const lv = svc.levelInfo();
  // (live play only: on 4:3 the pause/summary frame reaches over this corner)
  if (!passive) ui.text("lvl:t", `${t("lvl")} ${lv.level}`, leftX(0.001), 0.155, { size: 15, align: "left", color: "#ffe27a", weight: 600, maxW: 0.12 });
  if (!passive) ui.bar("lvl:bar", lv.xp / lv.need, leftX(0.22) + 0.07 / asp, 0.155, 0.15, 0.01, { color: "#ffd23a" });
  const ms = svc.missions();
  const open = ms.find((m) => !m.claimed && !m.done) ?? ms.find((m) => !m.claimed);
  if (open) ui.text("goal:mini", `${t(`ms_${open.id}`)}  ${fmt(open.progress)}/${fmt(open.target)}`, leftX(0.001), 0.192, { size: 14, align: "left", color: open.done ? "#7dff9a" : "#cfeeff", weight: 600, maxW: 0.7 });
  // slot features: progressive jackpot (top centre), combo chain (right), golden storm (centre)
  const ft = svc.features();
  ui.panel("jp:bg", 0.5, 0.185, 0.3, 0.07, { fill: "rgba(70,40,0,0.9)", stroke: "#ffc23a", radius: 0.035, rivets: false });
  ui.text("jp:l", t("jackpot"), 0.5 - 0.09 / asp, 0.185, { size: 14, color: "#ffc23a", maxW: 0.13 });
  ui.text("jp:v", fmt(svc.jackpotShare(G.bet)), 0.5 + 0.045 / asp, 0.185, { size: 26, color: "#fff2a8", maxW: 0.16 });
  // the two fixed jackpots flank it: what a MINI / MINOR pays at the current bet (they can land on
  // any hit, kill or not); the one that just landed glows for a moment
  JACKPOT_FIXED.M.forEach((m, k) => {
    const x = 0.5 + (k ? 1 : -1) * (0.15 + 0.014 + 0.08) / asp;
    const col = k ? "#ff9a3a" : "#7dd3ff";
    const hot = G.jpFlash?.tier === k && Math.floor(G.jpFlash.t * 6) % 2 === 0;
    ui.panel(`jp:f${k}`, x, 0.185, 0.16, 0.058, { fill: hot ? "rgba(140,70,0,0.95)" : "rgba(4,30,52,0.9)", stroke: col, radius: 0.029, rivets: false });
    ui.text(`jp:f${k}:l`, t(k ? "minor" : "mini"), x - 0.036 / asp, 0.185, { size: 12, color: col, maxW: 0.062 });
    ui.text(`jp:f${k}:v`, fmt(m * G.bet), x + 0.034 / asp, 0.185, { size: 18, color: "#eaf8ff", maxW: 0.07 });
  });
  // boss warning: the last five seconds before a boss count down under the jackpot, each second
  // with a low thump and a faint red pulse; while a boss swims, its name and pay range show there
  if (!passive && ft.bossIn !== null && ft.bossIn <= 5) {
    const n = Math.max(1, Math.ceil(ft.bossIn));
    if (n !== G.bossTick) {
      G.bossTick = n;
      sound.play("thump", { volume: 0.45, rate: 1.25 });
      window.__studio.hud.flash("#ff3a2a", 0.1);
      buzz(15);
    }
    ui.panel("boss:warn:bg", 0.5, 0.268, 0.46, 0.072, { fill: "rgba(96,10,8,0.9)", stroke: "#ff5a3a", radius: 0.036, rivets: false });
    ui.text("boss:warn", t("bossIn", { n }), 0.5, 0.268, { size: 24, color: "#ffd6c8", maxW: 0.42 });
  } else {
    G.bossTick = 0;
    const bosses = passive ? [] : school.list.filter((f) => f.sp.tier === "boss" && !f.dying && f.fishId > 0);
    if (bosses.length) {
      const tag = bosses.map((b) => `${i18n.speciesName(b.sp)} ×${b.sp.mult[0]}–${b.sp.mult[1]}`).join("   ·   ");
      ui.text("boss:tag", bosses.length > 1 ? `${t("bossTourShort")}: ${tag}` : tag, 0.5, 0.262, { size: 20, color: "#ffb08f", maxW: 0.9 });
    } else if (!passive && ft.tide && ft.fever <= 0 && ft.tide.left >= 0) {
      // the tide phase and what is left of it (the golden storm shows its own meter instead)
      const n = Math.ceil(ft.tide.left);
      const ph = ft.tide.phase;
      const label = ph === "calm" ? t("tideCalm") : ph === "rush" ? t("tideRush") : ft.tide.reward === "tide" ? t("tideTide") : null;
      if (label) {
        const col = ph === "calm" ? "#9fd8f0" : ph === "rush" ? "#ffd27a" : "#ffd84a";
        ui.text("tide:t", `${label} · ${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`, 0.5, 0.258, { size: ph === "reward" ? 20 : 16, color: col, maxW: 0.5 });
      }
    }
  }
  // combo and storm meters belong to live play, not to the pause/summary frame drawn over it
  if (ft.combo > 0 && !passive) {
    ui.text("combo:t", `${t("combo")} ×${ft.comboMult.toFixed(1)}`, rightX(0.3), 0.18, { size: 22, color: ft.comboMult >= 2 ? "#ffb02a" : "#8af0ff", maxW: 0.3 });
    ui.bar("combo:bar", ft.comboLeft / COMBO_WINDOW, rightX(0.3), 0.215, 0.26, 0.012, { color: "#8af0ff" });
  }
  if (ft.fever > 0 && !passive) {
    ui.text("fever:t", `${t("fever")}  ×${ft.feverMult}`, 0.5, 0.255, { size: 24, color: "#ffb02a", maxW: 0.6 });
    ui.bar("fever:bar", ft.fever / FEVER_SECONDS, 0.5, 0.285, 0.5, 0.014, { color: "#ffb02a" });
  }
}

function drawBack(t) {
  if (ui.button("back", t("back"), leftX(0.2), 0.075, 0.2, BTN, { color: "#2b78ad", size: 20, key: "Escape" })) G.screen = G.returnTo;
}

function drawStore(t, dt) {
  const svc = G.service;
  const asp = camera.aspect;
  ui.panel("store:veil", 0.5, 0.5, 4, 1.2, { fill: "rgba(2,18,34,0.62)", stroke: "rgba(0,0,0,0)", radius: 0 });
  drawBack(t);
  coinBadge(rightX(0.3), 0.075, G.shownBalance);
  // narrower than 1.65:1 (16:10, 4:3) the cards and the title shrink with the width, so the
  // outer cards and their badges stay on screen and the title clears the balance badge
  const fit = Math.min(1, asp / 1.65);
  ui.ribbon("store:title", t("storeTitle"), 0.5, 0.085, 0.8 * fit ** 2, 0.17, { color: "#e0482a", size: 40 });
  // three treasure cards; the middle one is the pitch (slightly larger, lit brighter)
  const piles = [3, 6, 10];
  const accents = ["#4fc3f7", "#ffc23a", "#c58bff"];
  STORE_PACKS.forEach((p, i) => {
    const mid = i === 1;
    const cw = (mid ? 0.45 : 0.41) * fit;
    const chh = mid ? 0.56 : 0.5;
    const cx = 0.5 + (i - 1) * 0.455 * fit / asp;
    const cy = mid ? 0.475 : 0.49;
    ui.panel(`pack:${i}`, cx, cy, cw, chh, { fill: "rgba(8,36,70,0.95)", stroke: accents[i], radius: 0.05, rays: accents[i] });
    ui.text(`pack:${i}:name`, t(`pack${i}`), cx, cy - chh / 2 + 0.05, { size: 17, color: accents[i], maxW: cw * 0.9 });
    // coin pile: a pyramid of the generated coin, bobbing gently
    const rows = piles[i] === 3 ? [1, 2] : piles[i] === 6 ? [1, 2, 3] : [1, 2, 3, 4];
    const cs = rows.length === 4 ? 0.066 : 0.075; // coin height (the tallest pile a little smaller)
    const stepY = cs * 0.5;
    // the pile stands on the amount (it used to hang from the card top and the 4-row pile ran
    // into "14.000")
    const numY = cy + chh * 0.5 - 0.215;
    const baseY = numY - 0.045 - cs / 2;
    ui.glow(`pack:${i}:glow`, cx, baseY - rows.length * stepY * 0.4, 0.32 + i * 0.02, accents[i] === "#ffc23a" ? "#ffd24a" : accents[i]);
    let k = 0;
    rows.forEach((count, r) => {
      for (let c = 0; c < count; c++) {
        // stepped at 8 fps: the HUD repaints whole, so a smooth bob would repaint every frame
        const bob = Math.sin(Math.floor(G.time * 8) / 8 * 2.2 + k * 0.9) * 0.004;
        const x = cx + (c - (count - 1) / 2) * cs * 0.92 / asp;
        const y = baseY - (rows.length - 1 - r) * stepY + bob;
        ui.image(`pack:${i}:c${k++}`, COIN_IMG, x, y, cs, 192 / 198);
      }
    });
    ui.text(`pack:${i}:n`, fmt(p.coins + p.bonus), cx, numY, { size: mid ? 40 : 36, color: "#fff2a8", maxW: cw * 0.86 });
    if (ui.button(`pack:${i}:buy`, p.priceTry, cx, cy + chh / 2 - 0.085, cw * 0.78, BTN, { color: "#f08a1c", size: 26 })) {
      // Store SDK flow would run here; the service only credits a verified receipt.
      const r = svc.purchase(p.id, `simulated:${p.id}:${svc.profile.lifetime.purchases}`);
      if (r.ok) {
        G.storeMsg = { text: `+${fmt(r.coins)} ${t("coins")}`, t: 0 };
        sound.play("jackpot", { volume: 0.6 });
        saveProfile();
      }
    }
    if (p.bonus) ui.burst(`pack:${i}:bonus`, `+${fmt(p.bonus)}`, cx + cw * 0.5 / asp * 0.82, cy - chh / 2 + 0.17, 0.17, { color: "#e2354a", size: 17, sub: "BONUS" });
    if (mid) ui.ribbon("pack:1:tag", t("popular"), cx, cy - chh / 2 - 0.005, 0.34, 0.1, { color: "#2fae5f", size: 17 });
    if (i === 2) ui.ribbon("pack:2:tag", t("bestValue"), cx, cy - chh / 2 + 0.005, 0.3, 0.095, { color: "#8a5ad9", size: 15 });
  });
  // rewarded ad: a strip with a play badge and one pip per ad left today
  const left = svc.adsLeft();
  const adY = 0.865;
  ui.panel("store:adbg", 0.5, adY, 0.95, 0.16, { fill: "rgba(8,60,50,0.92)", stroke: "#3fd99a", radius: 0.05, rivets: false });
  ui.path("store:adicon", "M20 12 L84 50 L20 88 Z", 0.5 - 0.29 / asp, adY, 0.085, 0.085, { viewBox: "0 0 100 100", fill: "#7dff9a", stroke: "#06182a", width: 0.005 });
  ui.text("store:adt", t("free").toUpperCase(), 0.5 - 0.17 / asp, adY - 0.025, { size: 15, color: "#7dff9a", maxW: 0.2 });
  ui.text("store:adn", `+${AD_REWARD.coins}`, 0.5 - 0.17 / asp, adY + 0.02, { size: 30, color: "#fff2a8", maxW: 0.2 });
  for (let k = 0; k < AD_REWARD.perDay; k++) {
    ui.panel(`store:pip${k}`, 0.5 + (-0.015 + (k - 2) * 0.03) / asp, adY, 0.024, 0.024, { fill: k < left ? "#7dff9a" : "rgba(255,255,255,0.15)", stroke: "#06182a", radius: 0.012, rivets: false });
  }
  if (ui.button("store:ad", t("watchAd", { n: AD_REWARD.coins }), 0.5 + 0.28 / asp, adY, 0.38, BTN, { color: "#22a86a", size: 21, enabled: left > 0 })) {
    G.overlay = "ad";
    G.adT = 0;
  }
  ui.text("store:foot", `${t("testPurchase")} · ${t("oneWay")}`, 0.5, 0.967, { size: 13, color: "#cfeeff", maxW: 1.7 });
  if (G.storeMsg) {
    G.storeMsg.t += dt;
    ui.text("store:msg", G.storeMsg.text, 0.5, 0.25, { size: 36, color: "#7dff9a" });
    if (G.storeMsg.t > 1.6) G.storeMsg = null;
  }
}

/** Missions: the level card (left), today's three missions (right), cannon finishes (bottom). */
function drawGoal(t, dt) {
  const svc = G.service;
  const asp = camera.aspect;
  ui.panel("goal:veil", 0.5, 0.5, 4, 1.2, { fill: "rgba(2,18,34,0.55)", stroke: "rgba(0,0,0,0)", radius: 0 });
  drawBack(t);
  coinBadge(rightX(0.3), 0.075, G.shownBalance);
  const fit = Math.min(1, asp / 1.65);
  ui.ribbon("goal:title", t("goalTitle"), 0.5, 0.085, 0.72 * fit ** 2, 0.15, { color: "#22a86a", size: 36 });

  // level card
  const lv = svc.levelInfo();
  const lx = 0.5 - (0.45 * fit) / asp;
  const lw = 0.56 * fit;
  ui.panel("goal:lvl", lx, 0.47, lw, 0.5, { fill: "rgba(8,36,70,0.95)", stroke: "#ffd23a", radius: 0.04 });
  ui.text("goal:lvlN", `${t("lvlLong")} ${lv.level}`, lx, 0.3, { size: 34, color: "#ffe27a", maxW: lw * 0.9 });
  ui.bar("goal:xp", lv.xp / lv.need, lx, 0.375, lw * 0.8, 0.022, { color: "#ffd23a" });
  ui.text("goal:xpN", t("xpOf", { a: fmt(lv.xp), b: fmt(lv.need) }), lx, 0.415, { size: 15, color: "#fff2c8", maxW: lw * 0.85 });
  const next = CANNON_SKINS.find((k) => k.level > lv.level);
  ui.text("goal:next", next ? t("nextSkin", { n: t(`skin_${next.id}`), l: next.level }) : t("allSkins"), lx, 0.49, { size: 15, color: "#cfeeff", maxW: lw * 0.9 });
  ui.text("goal:free", t("freeBudget", { a: fmt(svc.profile.freeToday ?? 0), b: fmt(FREE_COINS_PER_DAY) }), lx, 0.56, { size: 13, color: "#9fc3d8", maxW: lw * 0.9 });
  ui.text("goal:day", `${t("day")} ${svc.profile.day}`, lx, 0.63, { size: 14, color: "#9fd8f0" });

  // the three missions
  const rx = 0.5 + (0.27 * fit) / asp;
  const rw = 0.86 * fit;
  svc.missions().forEach((m, k) => {
    const y = 0.3 + k * 0.165;
    const left = rx - rw / 2 / asp;
    const accent = ["#4fc3f7", "#7dff9a", "#ffc23a"][k];
    ui.panel(`ms:${k}`, rx, y, rw, 0.14, { fill: m.claimed ? "rgba(6,40,30,0.92)" : "rgba(8,36,70,0.95)", stroke: accent, radius: 0.03, rivets: false });
    const textW = rw - 0.26;
    ui.text(`ms:${k}:l`, t(`ms_${m.id}`), left + (0.03 + textW / 2) / asp, y - 0.03, { size: 18, color: "#ffffff", maxW: textW });
    ui.bar(`ms:${k}:b`, m.progress / m.target, left + (0.03 + textW * 0.4) / asp, y + 0.015, textW * 0.8, 0.014, { color: accent });
    ui.text(`ms:${k}:n`, `${fmt(m.progress)}/${fmt(m.target)}`, left + (0.03 + textW * 0.9) / asp, y + 0.015, { size: 13, color: "#cfeeff", maxW: textW * 0.2 });
    ui.text(`ms:${k}:r`, `+${fmt(m.coins)} · ${m.xp} XP`, left + (0.03 + textW / 2) / asp, y + 0.045, { size: 13, color: "#ffe680", maxW: textW });
    const bx = rx + (rw / 2 - 0.11) / asp;
    if (m.claimed) ui.text(`ms:${k}:ok`, t("done"), bx, y, { size: 18, color: "#7dff9a", maxW: 0.18 });
    else if (ui.button(`ms:${k}:c`, t("claim"), bx, y, 0.17, 0.09, { color: "#f0b81c", size: 20, enabled: m.done })) {
      const r = svc.claimMission(k);
      if (r.ok) {
        sound.play("jackpot", { volume: 0.6 });
        G.storeMsg = { text: r.coins < r.asked ? `+${fmt(r.coins)} · ${t("budgetFull")}` : `+${fmt(r.coins)} ${t("coins")}`, t: 0 };
        if (r.levelUps.length) celebrateLevel(r.levelUps);
        saveProfile();
      }
    }
  });

  // cannon finishes
  ui.text("skin:t", t("cannonSkins"), 0.5, 0.79, { size: 15, color: "#9fd8f0" });
  const bw = 0.2 * fit;
  CANNON_SKINS.forEach((k, i) => {
    const x = 0.5 + ((i - 2) * (bw + 0.02 * fit)) / asp;
    const owned = svc.profile.skins.includes(k.id);
    const on = svc.profile.skin === k.id;
    const col = `#${SKIN_PALETTES[k.id].brass[1].toString(16).padStart(6, "0")}`;
    // owned finishes wear their own colour; the one on the cannon is ticked; locked ones are grey
    const label = owned ? `${on ? "✓ " : ""}${t(`skin_${k.id}`)}` : `${t("lvl")} ${k.level}`;
    if (ui.button(`skin:${k.id}`, label, x, 0.865, bw, 0.09, { color: col, size: 15, enabled: owned }) && !on) {
      svc.setSkin(k.id);
      cannon.setSkin(k.id);
      saveProfile();
    }
    if (on) ui.panel(`skin:${k.id}:on`, x, 0.925, bw * 0.5, 0.008, { fill: "#ffe27a", stroke: "rgba(0,0,0,0)", radius: 0.004, rivets: false });
  });
  if (G.storeMsg) {
    G.storeMsg.t += dt;
    ui.text("goal:msg", G.storeMsg.text, 0.5, 0.2, { size: 28, color: "#7dff9a", maxW: 1.2 });
    if (G.storeMsg.t > 1.6) G.storeMsg = null;
  }
}

function drawCollection(t) {
  const svc = G.service;
  const asp = camera.aspect;
  drawBack(t);
  // one page per room: its own species (the wreck's shared reef fish stay on the reef page)
  const page = G.collPage ?? "reef";
  if (page === "special") return drawSpecialGuide(t);
  const list = SPECIES.filter((s) => (s.room ?? "reef") === page);
  const found = list.filter((s) => svc.profile.collection[s.id]).length;
  // narrower than 1.65:1 the plank shrinks with the width so it clears the first row's names
  const titleFit = Math.min(1, asp / 1.65);
  ui.ribbon("coll:title", `${t(`room_${page}`)}  ${found}/${list.length}`, 0.5, 0.075, 0.66 * titleFit ** 2, 0.13, { color: "#895022", size: 30 });
  // the button names the next page; the pages go round the rooms in order, then the guide
  const ids = [...ROOMS.map((r) => r.id), "special"];
  const other = ids[(ids.indexOf(page) + 1) % ids.length];
  if (ui.button("coll:page", `${t(`room_${other}`)} ›`, rightX(0.29), 0.078, 0.29, 0.09, { color: "#1f9ed9", size: 16 })) G.collPage = other;
  const cols = 5;
  const width = Math.min(1.67, 0.94 * asp);
  const gap = 0.014;
  const cw = (width - gap * 4) / 5;
  const ch = 0.265;
  const tierCol = { small: "#42d8ff", medium: "#45efbe", large: "#ffcd55", boss: "#ff65b8" };
  list.forEach((s, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const n = svc.profile.collection[s.id] ?? 0;
    // Last row stretches its three rare specimens across the same collection width.
    const rowCols = r === 2 ? list.length - 10 : Math.min(5, list.length - r * 5);
    const cardW = rowCols === 3 ? (width - gap * 2) / 3 : cw;
    const cx = 0.5 + (c - (rowCols - 1) / 2) * (cardW + gap) / asp;
    const cardH = r === 2 ? 0.19 : ch;
    const top = 0.19 + r * (ch + 0.018);
    const cy = top + cardH / 2;
    ui.panel(`coll:${s.id}`, cx, cy, cardW, cardH, { fill: n ? "rgba(2,30,51,0.92)" : "rgba(3,17,25,0.88)", stroke: n ? "#43cbe7" : "#618b9c", radius: 0.025, rivets: false });
    if (n) ui.text(`coll:${s.id}:n`, i18n.speciesName(s), cx, top + 0.035, { size: 19, maxW: cardW * 0.93 });
    drawFishPortrait(`coll:${s.id}:fish`, s.id, cx, top + (r === 2 ? 0.061 : 0.112), n ? 0.126 : 0.105, !n);
    ui.text(`coll:${s.id}:t`, `${t(`tier_${s.tier}`)} · ×${s.mult[0]}${s.mult[1] !== s.mult[0] ? `–${s.mult[1]}` : ""}`, cx, top + (r === 2 ? 0.126 : 0.189), { size: 15, color: tierCol[s.tier], maxW: cardW * 0.95 });
    // the short rare cards have no room for a fourth line: their catch count replaces "discovered"
    const status = n ? (r === 2 ? t("caught", { n }) : t("discovered").toUpperCase()) : t("unknown");
    ui.text(`coll:${s.id}:c`, status, cx, top + (r === 2 ? 0.163 : 0.219), { size: 15, color: n ? "#a4ff91" : "#edf8ff", maxW: cardW * 0.95 });
    if (n && r !== 2) ui.text(`coll:${s.id}:count`, t("caught", { n }), cx, top + 0.245, { size: 13, color: "#b5f9a9", maxW: cardW * 0.95 });
  });
}

/**
 * The last collection page: a guide to the special targets, always open (nothing to discover):
 * each one's look, payout, what it does when shot down, and in which rooms it turns up.
 */
function drawSpecialGuide(t) {
  const asp = camera.aspect;
  const titleFit = Math.min(1, asp / 1.65);
  ui.ribbon("coll:title", t("room_special"), 0.5, 0.075, 0.66 * titleFit ** 2, 0.13, { color: "#895022", size: 30 });
  if (ui.button("coll:page", `${t("room_reef")} ›`, rightX(0.29), 0.078, 0.29, 0.09, { color: "#1f9ed9", size: 16 })) G.collPage = "reef";
  const width = Math.min(1.67, 0.94 * asp);
  const gap = 0.02;
  const cw = (width - gap * 3) / 4;
  const top = 0.17;
  const chh = 0.62;
  const accent = { treasure: "#ffd23a", mine: "#ff8a5a", volt: "#ffe23a", frost: "#bff4ff" };
  SPECIAL.forEach((s, i) => {
    const cx = 0.5 + ((i - 1.5) * (cw + gap)) / asp;
    ui.panel(`sp:${s.id}`, cx, top + chh / 2, cw, chh, { fill: "rgba(2,30,51,0.92)", stroke: accent[s.id], radius: 0.025, rivets: false });
    ui.text(`sp:${s.id}:n`, i18n.speciesName(s), cx, top + 0.04, { size: 19, color: accent[s.id], maxW: cw * 0.92 });
    drawFishPortrait(`sp:${s.id}:img`, s.id, cx, top + 0.15, Math.min(0.16, (cw * 0.9) / 1.6), false);
    ui.text(`sp:${s.id}:m`, `×${s.mult[0]}–${s.mult[1]}`, cx, top + 0.255, { size: 24, color: "#fff2a8", maxW: cw * 0.9 });
    // what it does, over up to three short lines
    const lines = t(`guide_${s.id}`).split("\n");
    lines.forEach((line, k) => ui.text(`sp:${s.id}:d${k}`, line, cx, top + 0.33 + k * 0.045, { size: 14, color: "#d8eefa", maxW: cw * 0.92 }));
    const ev = EVENTS.find((e) => e.id === s.id);
    const rooms = (ev?.rooms ?? ROOMS.map((r) => r.id)).map((r) => t(`room_${r}`)).join(" · ");
    ui.text(`sp:${s.id}:r`, rooms, cx, top + chh - 0.07, { size: 12, color: "#9fc3d8", maxW: cw * 0.92 });
    ui.text(`sp:${s.id}:p`, t(ev?.phase === "calm" ? "guideCalm" : "guideRush"), cx, top + chh - 0.035, { size: 12, color: "#9fc3d8", maxW: cw * 0.92 });
  });
}

// Small species illustrations stay in the same canvas HUD and remain legible at phone sizes.
function drawFishPortrait(id, species, cx, cy, h, locked = false) {
  const filename = `../assets/ui/fish-${species}${locked ? "-locked" : ""}.webp`;
  ui.image(id, new URL(filename, import.meta.url).href, cx, cy, h, 1.6);
}

function drawSettings(t) {
  const svc = G.service;
  const asp = camera.aspect;
  const tr = i18n.lang === "tr";
  // Reference composition: title above a framed glass surface, four paired rows.
  if (ui.button("back", tr ? "GERİ" : "BACK", leftX(0.205), 0.078, 0.205, 0.09, { color: "#007bb7", size: 22, key: "Escape" })) G.screen = G.returnTo;
  ui.icon("set:back", "back", leftX(0.205) - 0.065 / asp, 0.073, 0.035);
  const width = Math.min(1.46, 0.81 * asp);

  ui.ribbon("set:title", t("setTitle"), 0.5, 0.17, 0.73, 0.12, { color: "#895022", size: 39 });
  ui.icon("set:gear", "gear", 0.5 - 0.17 / asp, 0.174, 0.048);
  const gap = 0.044;
  const cellW = (width - 0.12 - gap) / 2;
  const icons = ["music", "sound", "bell", "globe", "user", "lock", "file", "calendar"];
  const descriptions = tr ? ["Arka plan müziği", "Atış ve ödül sesleri", "Ödüller ve etkinlikler", "Oyun dilini seçin", "Hesap bağlama yakında", "Veri kullanım bilgisi", "Oyun kuralları ve hizmet koşulları", "Sadece test için günü değiştirin"] : ["Background music", "Shots and rewards", "Rewards and events", "Game language", "Linking soon", "How your data is used", "Game rules and terms of service", "Change the day for testing only"];
  const row = (i, label, value, onClick, state = null) => {
    const cx = 0.5 + (i % 2 ? 1 : -1) * (cellW + gap) / 2 / asp;
    const y = 0.347 + Math.floor(i / 2) * 0.14;
    const left = cx - cellW / 2 / asp;
    const arrow = i === 5 || i === 6;
    const actionW = state !== null ? 0.102 : arrow ? 0.045 : 0.15;
    const bx = cx + (cellW / 2 - 0.025 - actionW / 2) / asp;
    const lx = left + 0.135 / asp;
    // the text column ends where the action button starts (a wider floor pushed it under the button on 4:3)
    const textW = state !== null || arrow ? cellW - 0.27 : Math.max(0.1, cellW - actionW - 0.17);
    ui.panel(`set:row${i}`, cx, y, cellW, 0.116, { fill: "rgba(2,30,49,0.88)", stroke: "#1686aa", rivets: false });
    ui.panel(`set:iconbox${i}`, left + 0.067 / asp, y, 0.078, 0.078, { fill: "#07578a", stroke: "#46c7f2", rivets: false });
    ui.icon(`set:icon${i}`, icons[i], left + 0.067 / asp, y, 0.047, { color: "#edf8ff" });
    ui.text(`set:l${i}`, label, lx, y - 0.017, { size: 18, align: "left", maxW: textW });
    ui.text(`set:desc${i}`, descriptions[i], lx, y + 0.022, { size: 13.5, color: "#9bc3d8", align: "left", maxW: textW, font: "Arial, sans-serif", weight: 600, shadow: false });
    if (state !== null) {
      if (ui.button(`set:b${i}`, "", bx, y, actionW, 0.052, { color: state ? "#06c18b" : "#38586b" })) onClick();
      ui.path(`set:knob${i}`, "M50 3a47 47 0 1 0 .01 0Z", bx + (state ? 0.028 : -0.028) / asp, y - 0.002, 0.039, 0.039, { fill: "#f5fff8", stroke: "#c0f3e7", width: 0.002 });
    } else if (ui.button(`set:b${i}`, value, bx, y, actionW, i === 7 ? 0.078 : 0.068, { color: i === 7 ? "#b06b20" : "#0085c1", text: arrow ? "#8ee7ff" : "#ffffff", size: arrow ? 32 : 18, bare: arrow })) onClick();
  };
  const toggle = (fn) => () => { fn(); saveProfile(); };
  row(0, t("music"), "", toggle(() => sound.setMusic(!sound.musicOn)), sound.musicOn);
  row(1, t("sfx"), "", toggle(() => sound.setSfx(!sound.sfxOn)), sound.sfxOn);
  row(2, t("notif"), "", toggle(() => (G.notif = !G.notif)), G.notif);
  row(3, t("lang"), tr ? "Türkçe" : "English", toggle(() => (i18n.lang = tr ? "en" : "tr")));
  row(4, t("account"), t("guest"), () => {});
  row(5, t("privacy"), "›", () => (G.legalShown = "privacy"));
  row(6, t("terms"), "›", () => (G.legalShown = "terms"));
  if (DEV) row(7, t("nextDay"), `${t("day")} ${svc.profile.day} ›`, () => {
    const r = svc.advanceDay();
    if (r.autoClaimed) G.storeMsg = { text: `+${fmt(r.autoClaimed)} ${t("coins")}`, t: 0 };
    saveProfile();
  });
  if (G.legalShown) ui.text("set:legal", t("legal"), 0.5, 0.92, { size: 14, color: "#ffcf8a", maxW: 1.7 });
}

function drawOut(t) {
  const svc = G.service;
  ui.panel("out:bg", 0.5, 0.52, 0.85, 0.58, { fill: "rgba(30,10,20,0.92)", stroke: "#ff7a5a" });
  ui.ribbon("out:title", t("outTitle"), 0.5, 0.27, 0.7, 0.17, { color: "#c2412a", size: 38 });
  ui.text("out:body", t("outBody"), 0.5, 0.41, { size: 18, color: "#ffe6dc", maxW: 1.4 });
  const left = svc.adsLeft();
  if (ui.button("out:ad", t("watchAd", { n: AD_REWARD.coins }), 0.5, 0.52, 0.5, BTN, { color: "#22a86a", size: 22, enabled: left > 0, sub: t("adsLeft", { n: left }) })) {
    G.overlay = "ad";
    G.adT = 0;
  }
  const bossUp = !!svc.session?.bossAlive;
  if (!bossUp && ui.button("out:store", t("store"), 0.5 - 0.14 / camera.aspect, 0.66, 0.25, BTN, { color: "#1f9ed9", size: 19 })) {
    G.returnTo = G.screen;
    G.overlay = null;
    if (G.screen === "playing") G.screen = "paused";
    G.returnTo = G.screen;
    G.screen = "store";
  }
  if (ui.button("out:end", t("finish"), bossUp ? 0.5 : 0.5 + 0.14 / camera.aspect, 0.66, 0.25, BTN, { color: "#c2412a", size: 19 })) endPlay();
  // out of coins for this room's smallest bet but not broke: the reef's 1-coin bullets still work
  if (G.room !== "reef" && svc.profile.balance >= 1 && ui.button("out:reef", t("toReef"), 0.5, 0.765, 0.42, 0.085, { color: "#2fae5f", size: 18 })) {
    G.service.endSession();
    startPlay("reef");
  }
}

/** The sea map: one card per room, its look, bets, and what it takes to open it. */
function drawMap(t) {
  const svc = G.service;
  const asp = camera.aspect;
  ui.panel("map:veil", 0.5, 0.5, 4, 1.2, { fill: "rgba(2,18,34,0.55)", stroke: "rgba(0,0,0,0)", radius: 0 });
  drawBack(t);
  coinBadge(rightX(0.3), 0.075, G.shownBalance);
  const fit = Math.min(1, asp / 1.65);
  ui.ribbon("map:title", t("mapTitle"), 0.5, 0.085, 0.72 * fit ** 2, 0.15, { color: "#22a86a", size: 36 });
  ROOMS.forEach((room, i) => {
    // cards share the width: two rooms 0.6 wide, three ~0.5 (fit narrows them on 4:3)
    const w = Math.min(0.6, 1.62 / ROOMS.length - 0.04) * fit;
    const cx = 0.5 + ((i - (ROOMS.length - 1) / 2) * (w + 0.05)) / asp;
    const open = svc.roomOpen(room.id);
    ui.panel(`map:${room.id}`, cx, 0.52, w, 0.64, { fill: open.ok ? "rgba(8,36,70,0.95)" : "rgba(10,18,28,0.95)", stroke: open.ok ? "#ffd23a" : "#5a6e80", radius: 0.04 });
    const ih = Math.min(0.28, (w * 0.9) / (16 / 9));
    ui.image(`map:${room.id}:img`, new URL(`../assets/ui/room-${room.id}.webp`, import.meta.url).href, cx, 0.37, ih, 16 / 9);
    if (!open.ok) ui.panel(`map:${room.id}:dim`, cx, 0.37, ih * (16 / 9), ih, { fill: "rgba(4,10,18,0.55)", stroke: "rgba(0,0,0,0)", radius: 0 }); // radius 0: a plain veil, not framed art
    ui.text(`map:${room.id}:n`, t(`room_${room.id}`), cx, 0.565, { size: 28, color: open.ok ? "#ffe27a" : "#9fb4c4", maxW: w * 0.9 });
    const b = room.bets;
    ui.text(`map:${room.id}:b`, t("betRange", { a: b[0], b: b[b.length - 1] }), cx, 0.615, { size: 16, color: "#cfeeff", maxW: w * 0.9 });
    if (open.ok) {
      if (ui.button(`map:${room.id}:go`, t("play"), cx, 0.735, w * 0.6, BTN, { color: "#f08a1c", size: 30, key: i === 0 ? "Enter" : null })) startPlay(room.id);
    } else {
      ui.text(`map:${room.id}:lv`, t("needLevel", { l: room.unlock.level }), cx, 0.705, { size: 17, color: open.level ? "#7dff9a" : "#ff8a7a", maxW: w * 0.9 });
      ui.text(`map:${room.id}:co`, t("needCoins", { n: fmt(room.unlock.balance) }), cx, 0.755, { size: 17, color: open.balance ? "#7dff9a" : "#ff8a7a", maxW: w * 0.9 });
    }
  });
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
      saveProfile();
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

function forceSpawn(species, x, z, opts = {}) {
  const entry = G.service.register(species, opts);
  if (speciesById(species).tier === "boss") G.service.bossCount(1);
  const f = school.spawn(entry, G.rng);
  if (entry.gold) addGoldAura(f);
  f.base.set(x, f.base.y, z);
  // head toward the middle of the field so a staged fish stays in view
  if (Math.abs(x) > 0.5) {
    f.dir.set(-Math.sign(x), 0, 0.12).normalize();
    f.side.set(-f.dir.z, 0, f.dir.x);
    f.group.rotation.y = Math.atan2(-f.dir.z, f.dir.x);
  }
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
      G.service.profile.balance = 1000; // bet 5 opens at 250
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
      G.banner = { text: i18n.t("bossIncoming"), t: 0, life: 6, color: "#ff5a3a" };
      simulate(3.5);
      return { boss: school.list.some((f) => f.sp.id === "dragon") };
    },
    map() {
      // the sea map for a player who has reached level 5 but not yet the wreck's coins
      reset(G.seed);
      G.service.addXp(xpForLevel(1) + xpForLevel(2) + xpForLevel(3) + xpForLevel(4));
      G.screen = "map";
      G.returnTo = "menu";
      simulate(0.6);
      return { rooms: ROOMS.map((r) => [r.id, G.service.roomOpen(r.id).ok]) };
    },
    wreck() {
      // a session in the shipwreck: level 5, 3000 coins, bet 10
      reset(G.seed);
      const svc = G.service;
      svc.addXp(xpForLevel(1) + xpForLevel(2) + xpForLevel(3) + xpForLevel(4));
      svc.profile.balance = 3000;
      startPlay("wreck");
      simulate(4);
      return { room: G.room, bets: svc.bets(), fish: school.list.map((f) => f.sp.id) };
    },
    guide() {
      // the collection's last page: the special targets guide
      reset(G.seed);
      G.screen = "collection";
      G.returnTo = "menu";
      G.collPage = "special";
      simulate(0.6);
      return { page: G.collPage };
    },
    lightning() {
      // a lightning fish in a reef school, shot until it goes down and the chain jumps
      reset(G.seed);
      const svc = G.service;
      startPlay("reef");
      const v = forceSpawn("volt", 0, -4);
      for (let i = 0; i < 600 && !v.dying; i++) {
        const shot = svc.fire(1);
        if (!shot.ok) break;
        const bullet = fx.addBullet(shot.shotId, 1, v.pos.clone(), new THREE.Vector3(0, 0, -1));
        G.bulletsInFlight.set(shot.shotId, bullet);
        resolveHit(bullet, v);
      }
      simulate(0.15);
      return { down: !!v.dying };
    },
    frost() {
      // a frost fish shot down: the sea freezes
      reset(G.seed);
      const svc = G.service;
      startPlay("reef");
      const f = forceSpawn("frost", 0, -4);
      for (let i = 0; i < 600 && !f.dying; i++) {
        const shot = svc.fire(1);
        if (!shot.ok) break;
        const bullet = fx.addBullet(shot.shotId, 1, f.pos.clone(), new THREE.Vector3(0, 0, -1));
        G.bulletsInFlight.set(shot.shotId, bullet);
        resolveHit(bullet, f);
      }
      simulate(1.2);
      return { frozen: school.list.filter((o) => o.frozen > 0).length };
    },
    deep() {
      // a session in the deep: level 15, 15000 coins, bet 50
      reset(G.seed);
      const svc = G.service;
      let need = 0;
      for (let n = 1; n < 15; n++) need += xpForLevel(n);
      svc.addXp(need);
      svc.profile.balance = 15000;
      startPlay("deep");
      simulate(4);
      return { room: G.room, bets: svc.bets(), fish: school.list.map((f) => f.sp.id) };
    },
    giantsquid() {
      // the deep's boss and the golden shark together: the boss tour
      reset(G.seed);
      const svc = G.service;
      let need = 0;
      for (let n = 1; n < 15; n++) need += xpForLevel(n);
      svc.addXp(need);
      svc.profile.balance = 15000;
      startPlay("deep");
      forceSpawn("giantsquid", -3, -2);
      forceSpawn("goldshark", 4, -6);
      G.banner = { text: i18n.t("bossTour"), t: 0, life: 6, color: "#ff5a3a" };
      simulate(3.5);
      return { bosses: school.list.filter((f) => f.sp.tier === "boss").map((f) => f.sp.id) };
    },
    mine() {
      // a sea mine among a school in the wreck, shot until it blows
      reset(G.seed);
      const svc = G.service;
      svc.addXp(xpForLevel(1) + xpForLevel(2) + xpForLevel(3) + xpForLevel(4));
      svc.profile.balance = 3000;
      startPlay("wreck");
      const m = forceSpawn("mine", 0, -4);
      for (let i = 0; i < 400 && !m.dying; i++) {
        const shot = svc.fire(svc.bets()[0]);
        if (!shot.ok) break;
        const bullet = fx.addBullet(shot.shotId, svc.bets()[0], m.pos.clone(), new THREE.Vector3(0, 0, -1));
        G.bulletsInFlight.set(shot.shotId, bullet);
        resolveHit(bullet, m);
      }
      simulate(0.35);
      return { blown: m.dying };
    },
    wreckOut() {
      // out of coins for the wreck's 10-coin bullet with 6 left: the reef is offered
      reset(G.seed);
      const svc = G.service;
      svc.addXp(xpForLevel(1) + xpForLevel(2) + xpForLevel(3) + xpForLevel(4));
      svc.profile.balance = 3000;
      startPlay("wreck");
      svc.profile.balance = 6;
      G.shownBalance = 6;
      simulate(0.5);
      return { overlay: G.overlay, room: G.room };
    },
    kraken() {
      // the wreck's boss rising: the giant octopus
      reset(G.seed);
      const svc = G.service;
      svc.addXp(xpForLevel(1) + xpForLevel(2) + xpForLevel(3) + xpForLevel(4));
      svc.profile.balance = 3000;
      startPlay("wreck");
      forceSpawn("kraken", -2, -2);
      G.banner = { text: i18n.t("bossIncoming"), t: 0, life: 6, color: "#ff5a3a" };
      simulate(3.5);
      return { boss: school.list.some((f) => f.sp.id === "kraken") };
    },
    missions() {
      // the mission board mid-day: one done, one half way, level 4 with the silver finish on
      reset(G.seed);
      const svc = G.service;
      svc.missions();
      svc.addXp(520);
      const list = svc.profile.missions.list;
      list[0].progress = svc.missions()[0].target;
      list[1].progress = Math.floor(svc.missions()[1].target / 2);
      svc.setSkin("silver");
      cannon.setSkin("silver");
      G.screen = "goal";
      G.returnTo = "menu";
      simulate(0.6);
      return { level: svc.levelInfo(), missions: svc.missions().map((m) => [m.id, m.progress, m.target]) };
    },
    levelUp() {
      // the moment a catch tips the XP bar over: banner, flash, the new finish on the cannon
      reset(G.seed);
      startPlay();
      const ups = G.service.addXp(xpForLevel(1) + xpForLevel(2)); // exactly to level 3: the silver finish
      celebrateLevel(ups);
      simulate(0.5);
      return { ups };
    },
    fishTide() {
      // a boss got away: the 15 s fish tide, golden fish in big schools
      reset(G.seed);
      startPlay();
      const s = G.service.session;
      s.phase = "reward";
      s.reward = "tide";
      s.rewardT = 14;
      simulate(3);
      return { tide: G.service.features().tide, gold: school.list.filter((f) => f.gold).length };
    },
    treasure() {
      // the treasure bubble drifting across the calm
      reset(G.seed);
      startPlay();
      forceSpawn("treasure", -2, -2);
      simulate(1.5);
      return { treasure: school.list.some((f) => f.sp.id === "treasure") };
    },
    bossWarn() {
      // the countdown under the jackpot, three seconds before a boss enters
      reset(G.seed);
      startPlay();
      G.service.session.bossClock = 4.2;
      simulate(1.0);
      return { bossIn: G.service.features().bossIn };
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
    pause() {
      reset(G.seed);
      startPlay();
      simulate(1.5, { keys: ["Space"] });
      G.screen = "paused";
      simulate(0.3);
      return { screen: G.screen };
    },
    ad() {
      reset(G.seed);
      startPlay();
      G.overlay = "ad";
      G.adT = 0;
      simulate(1.2);
      return { overlay: G.overlay };
    },
    daily() {
      reset(G.seed);
      simulate(2.4);
      G.service.advanceDay();
      simulate(0.4);
      return { available: G.service.dailyBonusAvailable() };
    },
    purchase() {
      reset(G.seed);
      G.screen = "store";
      const r = G.service.purchase("coins_small", "simulated:demo:1");
      G.storeMsg = { text: `+${fmt(r.coins ?? 0)} ${i18n.t("coins")}`, t: 0 };
      simulate(0.6);
      return r;
    },
    gold() {
      reset(G.seed);
      startPlay();
      school.clear();
      forceSpawn("angel", -3, -3, { gold: true });
      forceSpawn("tang", 3, -1, { gold: true });
      simulate(1.5);
      return { gold: school.list.filter((f) => f.gold).length };
    },
    fever() {
      reset(G.seed);
      startPlay();
      const ss = G.service.session;
      ss.fever = 8;
      ss.combo = 7;
      ss.comboT = 6;
      G.service.profile.jackpot = 4280;
      G.banner = { text: i18n.t("feverStart"), t: 0, life: 6, color: "#ffb02a", size: 44 };
      simulate(1);
      return G.service.features();
    },
    miniJackpot() {
      // a MINI landing: its banner and its pill glowing beside the jackpot
      reset(G.seed);
      startPlay();
      simulate(0.5);
      G.banner = { text: `${i18n.t("miniWin")}  +${fmt(JACKPOT_FIXED.M[0] * G.bet)}`, t: 0, life: 3.2, color: "#7dd3ff", size: 40 };
      G.jpFlash = { tier: 0, t: 0 };
      return { flash: true };
    },
    jackpot() {
      reset(G.seed);
      startPlay();
      G.service.profile.jackpot = 12850;
      G.banner = { text: `${i18n.t("jackpotWin")}  +${fmt(12850)}`, t: 0, life: 6, color: "#ffd84a", size: 40 };
      fx.coinBurst(new THREE.Vector3(0, FISH_Y, -3), 30, cannon.root.position.clone().add(new THREE.Vector3(0, 1.5, 0)), G.rng);
      simulate(0.8);
      return G.service.features();
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
  cannonPos: () => cannon.root.position.clone(),
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
demos["genex-cover"] = coverShots.a;

const studio = installStudio({
  canvas: renderer.domElement,
  scene,
  renderer,
  camera,
  input: { pointerLock: false },
  reset,
  update,
  render() {
    post.render(swimTime.value);
    renderStats.calls = post.stats.calls;
    renderStats.triangles = post.stats.triangles;
  },
  flow() {
    if (G.screen === "boot") return "boot";
    if (G.screen === "playing") return G.overlay ? "paused" : "playing";
    if (G.screen === "paused") return "paused";
    if (G.screen === "results") return "results";
    return "menu";
  },
  begin() {
    if (G.screen !== "playing" || G.overlay) startPlay();
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
      hudWrites: ui.writes, // HUD items re-sent this frame: 0 on a still screen (each one repaints the HUD)
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
      level: svc.levelInfo(),
      missions: svc.missions().map((m) => `${m.id} ${m.progress}/${m.target}${m.claimed ? " ✓" : ""}`),
      freeToday: svc.profile.freeToday,
      skin: svc.profile.skin,
      slot: svc.features(),
      goldFish: school.list.filter((f) => f.gold && !f.dying).length,
      lang: i18n.lang,
      room: G.room,
      textures: renderer.info.memory.textures,
      atlases: atlasUse(),
      rooms: ROOMS.map((r) => `${r.id}${G.service.roomOpen(r.id).ok ? "" : " (locked)"}`),
      drawCalls: renderStats.calls,
      triangles: renderStats.triangles,
    };
  },
  cameras,
  demos,
});

// a real player's boot restores the saved profile; seeded resets (harness, demos) stay fresh
loadSaved();
