/**
 * EconomyService — the authoritative side of the game economy.
 *
 * In this prototype it runs in-process, but it is written as if it were the Node.js server:
 * no three.js, no DOM, no clock (time arrives as `dt`), randomness only from the injected rng.
 * The client NEVER computes a payout: it asks `fire()` for a shot id, reports `hit(shotId,
 * fishId)` when a bullet touches a fish, and draws whatever the service answers.
 *
 * Moving it to a real server = put these methods behind HTTP/WebSocket handlers (the V2
 * multiplayer room, e.g. Colyseus, would host exactly this object per room).
 *
 * ONE-WAY CURRENCY: coins come in through purchases, ads, bonuses and wins. There is no
 * method — and must never be one — that turns coins into money, transfers coins between
 * players, or pays out anything outside the game.
 */
import {
  AD_REWARD,
  BETS,
  maxBetFor,
  BULLET_LIFETIME,
  DAILY_BONUS,
  RTP_TARGET,
  SPECIES,
  STARTING_BALANCE,
  STORE_PACKS,
  TIERS,
  TIDE,
  EVENTS,
  MINE,
  LIGHTNING,
  ALLOW_SIMULATED_IAP,
  COMBO_MAX,
  COMBO_STEP,
  COMBO_WINDOW,
  FEVER_MULT,
  FEVER_SECONDS,
  GOLD_CHANCE,
  GOLD_MEAN,
  GOLD_MULTS,
  JACKPOT_FIXED,
  JACKPOT_RATE,
  JACKPOT_SEED,
  killChance,
  speciesById,
  ROOMS,
  roomById,
  XP_PER_TIER,
  xpForLevel,
  CANNON_SKINS,
  levelCoins,
  FREE_COINS_PER_DAY,
  MISSIONS,
  MISSION_REWARD,
} from "./config.js";

const lerp = (a, b, t) => a + (b - a) * t;

export function createProfile() {
  return {
    balance: STARTING_BALANCE,
    day: 1,
    loginStreak: 0,
    dailyClaimedDay: 0,
    adsToday: 0,
    freeToday: 0, // free coins received today (daily bonus, ads, missions, level-ups)
    missions: null, // { day, list: [{ id, progress, claimed }] } — rolled lazily for each day
    xp: 0, // total XP ever earned
    level: 1,
    skins: ["bronze"],
    skin: "bronze",
    jackpot: JACKPOT_SEED,
    collection: {}, // speciesId -> kills
    lifetime: { spent: 0, won: 0, shots: 0, kills: 0, purchases: 0 },
  };
}

export class EconomyService {
  /**
   * @param {{ rng: () => number, rtp?: number, profile?: object, analytics?: { track(name, data): void } }} opts
   */
  constructor({ rng, rtp = RTP_TARGET, profile = createProfile(), analytics = null }) {
    this.rng = rng;
    this.rtp = rtp;
    this.profile = profile;
    this.analytics = analytics;
    this.nextShot = 1;
    this.nextFish = 1;
    this.session = null;
    this.room = ROOMS[0]; // the room of the current (or last) session
    this.usedReceipts = new Set();
  }

  track(name, data) {
    this.analytics?.track(name, data);
  }

  // ── session ──────────────────────────────────────────────────────────────

  /** Whether a room can be entered now: `{ ok, level, balance }` tells what is missing. */
  roomOpen(id) {
    const r = roomById(id);
    const level = this.profile.level >= r.unlock.level;
    const balance = this.profile.balance >= r.unlock.balance;
    return { ok: level && balance, level, balance, room: r };
  }

  /** The bets of the current room. */
  bets() {
    return this.room.bets;
  }

  startSession(roomId = "reef") {
    // a session replaced while shots are in flight refunds them first (nothing silently vanishes)
    if (this.session) this.endSession();
    // a room that is not open falls back to the reef (the client only offers open rooms)
    this.room = this.roomOpen(roomId).ok ? roomById(roomId) : ROOMS[0];
    this.session = {
      t: 0,
      shots: new Map(), // shotId -> { bet, age }
      fish: new Map(), // fishId -> { species }
      spawnClock: 0,
      // the tide cycle (TIDE): phase, round (0-based), seconds until the boss while calm/rush,
      // seconds left of the reward window, and what that window is ("storm" | "tide")
      phase: "calm",
      round: 0,
      bossClock: TIDE.firstCalm + TIDE.rush.seconds,
      rewardT: 0,
      reward: null,
      bossAlive: false, // any boss on screen (bosses counts them: the boss tour brings two)
      bosses: 0,
      bossKilled: false,

      events: [], // this round's special targets: { id, at } (bossClock value at which each enters)
      combo: 0, // kills in the current chain
      comboT: 0, // seconds left to keep the chain alive
      fever: 0, // seconds of golden storm left
      stats: { shots: 0, spent: 0, won: 0, kills: 0, refunds: 0, byTier: { small: 0, medium: 0, large: 0, boss: 0 }, best: 0 },
    };
    this.planEvents(TIDE.firstCalm);
    this.track("session_start", { balance: this.profile.balance, room: this.room.id });
    return { balance: this.profile.balance };
  }

  endSession() {
    const s = this.session;
    if (!s) return null;
    // Bullets still in flight are refunded: a shot that never touched a fish costs nothing.
    for (const [id] of s.shots) this.expire(id);
    const summary = { ...s.stats, seconds: s.t, balance: this.profile.balance };
    this.track("session_end", summary);
    this.session = null;
    return summary;
  }

  /**
   * Fill the sea before the first frame of play: spawns like `tick` but the session clock, the
   * boss countdown and the onboarding timers do not move, so play time starts at zero.
   */
  preroll(dt, alive) {
    const s = this.session;
    if (!s) return [];
    const { t, bossClock } = s;
    const out = this.tick(dt, alive);
    s.t = t;
    s.bossClock = bossClock;
    return out;
  }

  /** Whether a shot is still unresolved (the service ages shots in real time, the client may not). */
  isLive(shotId) {
    return !!this.session?.shots.has(shotId);
  }

  /** The highest bet the current balance allows (see BET_MIN_SHOTS). */
  maxBet() {
    return maxBetFor(this.profile.balance, this.room.bets);
  }

  /** How hard the current round is: 0 in the first round → 1 from round `TIDE.maxStep` on. */
  ramp() {
    return this.session ? Math.min(1, this.session.round / TIDE.maxStep) : 0;
  }

  /** Swim-speed factor of the current phase (the client scales fish speed by it). */
  tideSpeed() {
    const s = this.session;
    if (!s) return 0.8;
    return TIDE[s.phase].speed * (1 + 0.06 * Math.min(s.round, TIDE.maxStep));
  }

  /** Draw this round's special targets (EVENTS) and the moment of its phase each one enters. */
  planEvents(calmSeconds) {
    const s = this.session;
    s.events = [];
    for (const e of EVENTS) {
      if (e.rooms && !e.rooms.includes(this.room.id)) continue;
      if (this.rng() >= e.perRound) continue;
      const at = e.phase === "calm" ? TIDE.rush.seconds + 4 + this.rng() * Math.max(1, calmSeconds - 10) : 4 + this.rng() * (TIDE.rush.seconds - 10);
      s.events.push({ id: e.id, at });
    }
  }

  /** A boss entered or left: keep the count and the any-boss flag together. */
  bossCount(delta) {
    const s = this.session;
    s.bosses = Math.max(0, s.bosses + delta);
    s.bossAlive = s.bosses > 0;
  }

  /** Move the tide on by `dt`; pushes the boss / treasure entries that enter now into `out`. */
  advanceTide(dt, out) {
    const s = this.session;
    if (s.phase === "calm" || s.phase === "rush") {
      // the countdown to the boss only runs while no boss is alive
      s.bossClock -= dt;
      s.phase = s.bossClock > TIDE.rush.seconds ? "calm" : "rush";
      for (const e of s.events) {
        if (e.done || s.bossClock > e.at) continue;
        e.done = true;
        out.push(this.register(e.id, { gold: false }));
        this.track("special_spawn", { id: e.id, round: s.round });
      }
      if (s.bossClock <= 0) {
        // from the boss-tour round on, every boss of the room comes at once
        const bosses = this.room.bosses;
        const ids = s.round >= TIDE.bossTourRound && bosses.length > 1 ? bosses : [bosses[s.round % bosses.length]];
        s.phase = "boss";
        s.bossKilled = false;
        s.tour = ids.length > 1;
        for (const id of ids) {
          this.bossCount(1);
          out.push(this.register(id));
          this.track("boss_spawn", { species: id, round: s.round, tour: s.tour });
        }
      }
    } else if (s.phase === "boss") {
      if (!s.bossAlive) {
        // a boss kill already lit the golden storm; a boss that got away leaves a fish tide
        s.phase = "reward";
        s.rewardT = TIDE.reward.seconds;
        s.reward = s.bossKilled ? "storm" : "tide";
        this.track("reward_window", { kind: s.reward, round: s.round });
      }
    } else if (s.phase === "reward") {
      s.rewardT -= dt;
      if (s.rewardT <= 0) {
        s.round += 1;
        s.phase = "calm";
        s.reward = null;
        s.bossClock = TIDE.calm.seconds + TIDE.rush.seconds;
        this.planEvents(TIDE.calm.seconds);
      }
    }
  }

  // ── spawn director (server decides WHAT spawns; the client decides how it swims) ──

  /**
   * Advance the session clock and return the fish that should enter now.
   * @param {number} dt seconds
   * @param {number} alive fish currently on screen
   * @returns {{ fishId: number, species: string, school?: number }[]}
   */
  tick(dt, alive) {
    const s = this.session;
    if (!s) return [];
    s.t += dt;
    if (s.combo > 0) {
      s.comboT -= dt;
      if (s.comboT <= 0) s.combo = 0;
    }
    if (s.fever > 0) s.fever = Math.max(0, s.fever - dt);
    for (const [id, shot] of s.shots) {
      shot.age += dt;
      if (shot.age > BULLET_LIFETIME) this.expire(id);
    }
    const out = [];
    this.advanceTide(dt, out);
    // a brand-new player gets a guided first minute: a golden medium fish early, then a plain
    // medium one. Only the spawn order changes; kill odds are never touched.
    if (this.profile.lifetime.shots < 60 && !this.onboarded) {
      if (!s.guide1 && s.t > 5) {
        s.guide1 = true;
        out.push(this.register(this.pickSpecies("medium").id, { gold: true }));
      }
      if (!s.guide2 && s.t > 14) {
        s.guide2 = true;
        out.push(this.register(this.pickSpecies("medium").id, { gold: false }));
        this.onboarded = true;
      }
    }
    // regular arrivals, shaped by the phase (and, in the rush, by how many rounds have passed)
    const P = TIDE[s.phase];
    const k = this.ramp();
    const tide = s.phase === "reward" && s.reward === "tide";
    s.spawnClock -= dt;
    const target = Math.round(lerp(P.alive[0], P.alive[1], k));
    if (s.spawnClock <= 0 && alive < target) {
      s.spawnClock = lerp(P.spawn[0], P.spawn[1], k) * (0.6 + this.rng() * 0.8);
      const mix = { ...P.mix };
      if (s.phase === "rush") mix.large += TIDE.stepLarge * Math.min(s.round, TIDE.maxStep);
      const tier = this.pickTier(mix);
      const sp = this.pickSpecies(tier);
      const goldChance = tide ? TIDE.tideGold : GOLD_CHANCE;
      if (tier === "small" && (tide || this.rng() < 0.5)) {
        const size = tide ? TIDE.tideSchool : TIDE.school;
        const want = size[0] + Math.floor(this.rng() * (size[1] - size[0] + 1));
        const n = Math.max(1, Math.min(want, target - alive));
        const school = this.nextFish;
        for (let i = 0; i < n; i++) out.push({ ...this.register(sp.id, { goldChance }), school, schoolIndex: i });
      } else {
        out.push(this.register(sp.id, { goldChance }));
      }
    }
    return out;
  }

  /** A tier from relative weights `{ small, medium, large }`. */
  pickTier(mix) {
    const w = ["small", "medium", "large"].map((t) => mix[t] ?? 0);
    let roll = this.rng() * w.reduce((x, y) => x + y, 0);
    for (let i = 0; i < w.length; i++) {
      roll -= w[i];
      if (roll <= 0) return TIERS[i];
    }
    return "small";
  }

  pickSpecies(tier) {
    // the room's own list (a tier the room lacks falls back to every species of that tier)
    const inRoom = this.room.species.map(speciesById).filter((x) => x && x.tier === tier);
    const pool = inRoom.length ? inRoom : SPECIES.filter((x) => x.tier === tier);
    let roll = this.rng() * pool.reduce((x, y) => x + y.weight, 0);
    for (const sp of pool) {
      roll -= sp.weight;
      if (roll <= 0) return sp;
    }
    return pool[0];
  }

  /** A golden fish pays an extra multiplier, and is killed proportionally less often. */
  register(species, { gold, goldChance = GOLD_CHANCE } = {}) {
    const fishId = this.nextFish++;
    const sp = speciesById(species);
    const isGold = gold ?? (sp?.tier !== "boss" && !sp?.special && this.rng() < goldChance);
    this.session?.fish.set(fishId, { species, gold: isGold });
    return { fishId, species, gold: isGold };
  }

  /** Current chain multiplier (1 … COMBO_MAX). */
  comboMult() {
    return Math.min(COMBO_MAX, 1 + COMBO_STEP * (this.session?.combo ?? 0));
  }

  /** Everything the HUD shows about the slot features, in one small read. */
  features() {
    const s = this.session;
    return {
      combo: s?.combo ?? 0,
      comboMult: +this.comboMult().toFixed(2),
      comboLeft: s ? Math.max(0, s.comboT) : 0,
      fever: s ? s.fever : 0,
      feverMult: s && s.fever > 0 ? FEVER_MULT : 1,
      jackpot: Math.max(0, Math.floor(this.profile.jackpot)),
      // seconds until the next boss enters (null while one is on screen or outside a session)
      bossIn: s && (s.phase === "calm" || s.phase === "rush") ? +Math.max(0, s.bossClock).toFixed(2) : null,
      // the tide cycle for the HUD: phase, round, seconds left in it (null while a boss swims)
      bosses: s?.bosses ?? 0,
      tour: !!s?.tour && s.phase === "boss",
      tide: s
        ? {
            phase: s.phase,
            round: s.round,
            reward: s.reward,
            left: +(s.phase === "calm" ? s.bossClock - TIDE.rush.seconds : s.phase === "rush" ? s.bossClock : s.phase === "reward" ? s.rewardT : -1).toFixed(1),
          }
        : null,
    };
  }

  /** Unbiased integer rounding: the expected payout stays exactly the real-valued one. */
  roundPayout(x) {
    const f = Math.floor(x);
    return f + (this.rng() < x - f ? 1 : 0);
  }

  /** What a golden-shark kill at this bet takes from the pool: a max-bet bullet takes all of it,
   *  smaller bullets a bet-sized share, so a 1-coin shot cannot claim a pool the 10s built. */
  jackpotShare(bet) {
    // the room's top bet takes the whole pool (the wreck's 50 as much as the reef's 10)
    const bets = this.room.bets;
    return Math.max(0, Math.floor(this.profile.jackpot * Math.min(1, bet / bets[bets.length - 1])));
  }

  pickGoldMult() {
    const total = GOLD_MULTS.reduce((a, [, w]) => a + w, 0);
    let roll = this.rng() * total;
    for (const [m, w] of GOLD_MULTS) {
      roll -= w;
      if (roll <= 0) return m;
    }
    return GOLD_MULTS[0][0];
  }

  /** The client reports a fish that swam off screen. */
  fishLeft(fishId) {
    const f = this.session?.fish.get(fishId);
    if (!f) return;
    if (speciesById(f.species)?.tier === "boss") this.bossCount(-1);
    this.session.fish.delete(fishId);
  }

  // ── shots ────────────────────────────────────────────────────────────────

  fire(bet) {
    const s = this.session;
    if (!s) return { ok: false, reason: "no-session" };
    if (!this.room.bets.includes(bet)) return { ok: false, reason: "bad-bet" };
    if (this.profile.balance < bet) return { ok: false, reason: "insufficient", balance: this.profile.balance };
    const cap = maxBetFor(this.profile.balance, this.room.bets);
    if (bet > cap) return { ok: false, reason: "bet-cap", maxBet: cap, balance: this.profile.balance };
    this.profile.balance -= bet;
    const shotId = this.nextShot++;
    const jack = bet * JACKPOT_RATE;
    this.profile.jackpot += jack;
    s.shots.set(shotId, { bet, age: 0, jack });
    s.stats.shots += 1;
    s.stats.spent += bet;
    this.profile.lifetime.shots += 1;
    this.profile.lifetime.spent += bet;
    return { ok: true, shotId, balance: this.profile.balance };
  }

  /**
   * A bullet touched a fish. Resolves the shot exactly once.
   * @returns {{ ok: boolean, killed?: boolean, mult?: number, payout?: number, balance?: number, species?: string, reason?: string }}
   */
  hit(shotId, fishId) {
    const s = this.session;
    if (!s) return { ok: false, reason: "no-session" };
    const shot = s.shots.get(shotId);
    if (!shot) return { ok: false, reason: "unknown-shot" };
    const fish = s.fish.get(fishId);
    if (!fish) {
      // the fish left between the touch and the report: the shot is refunded, not stranded
      this.expire(shotId);
      return { ok: false, reason: "unknown-fish", refunded: true };
    }
    s.shots.delete(shotId);
    const sp = speciesById(fish.species);
    // payout multipliers that are known before the roll; each one divides the kill chance
    const combo = this.comboMult();
    const fever = s.fever > 0 ? FEVER_MULT : 1;
    const goldMean = fish.gold ? GOLD_MEAN : 1;
    // fixed-odds jackpots: their expected value per hit comes out of the kill chance
    const pJ = fish.gold ? JACKPOT_FIXED.pGold : JACKPOT_FIXED.pOther;
    const jackEv = pJ.reduce((a, p, i) => a + p * JACKPOT_FIXED.M[i], 0);
    const chance = Math.min(1, killChance(sp, this.rtp - JACKPOT_RATE - jackEv) / (combo * fever * goldMean));
    let fixedTier = null;
    let fixedPay = 0;
    const u = this.rng();
    let acc = 0;
    for (let i = pJ.length - 1; i >= 0; i--) {
      acc += pJ[i];
      if (u < acc) {
        fixedTier = JACKPOT_FIXED.names[i];
        fixedPay = JACKPOT_FIXED.M[i] * shot.bet;
        break;
      }
    }
    if (fixedPay) {
      this.profile.balance += fixedPay;
      s.stats.won += fixedPay;
      this.profile.lifetime.won += fixedPay;
      s.stats.best = Math.max(s.stats.best, fixedPay);
      this.track("jackpot_fixed", { tier: fixedTier, pay: fixedPay });
    }
    const killed = this.rng() < chance;
    if (sp.tier === "boss") this.progressMissions({ bossHit: true });
    if (!killed) {
      this.track("hit", { species: sp.id, bet: shot.bet });
      return { ok: true, killed: false, species: sp.id, fixedTier, fixedPay, balance: this.profile.balance };
    }
    const mult = sp.mult[0] + Math.floor(this.rng() * (sp.mult[1] - sp.mult[0] + 1));
    const goldMult = fish.gold ? this.pickGoldMult() : 1;
    let payout = this.roundPayout(mult * shot.bet * combo * fever * goldMult);
    // the golden shark carries the jackpot pool
    let jackpot = 0;
    if (sp.id === "goldshark") {
      jackpot = this.jackpotShare(shot.bet);
      payout += jackpot;
      this.profile.jackpot -= jackpot; // a progressive pool: what this bet did not claim stays in it
    }
    this.profile.balance += payout;
    s.fish.delete(fishId);
    // a mine or lightning kill: the client may now report what its blast / chain took
    s.blastReady = sp.id === "mine" || sp.id === "volt";
    if (sp.tier === "boss") {
      this.bossCount(-1);
      s.bossKilled = true;
      s.fever = FEVER_SECONDS;
    }
    s.combo += 1;
    s.comboT = COMBO_WINDOW;
    s.stats.won += payout;
    s.stats.kills += 1;
    s.stats.byTier[sp.tier] += 1;
    s.stats.best = Math.max(s.stats.best, payout);
    const p = this.profile;
    p.lifetime.won += payout;
    p.lifetime.kills += 1;
    // special targets (the treasure bubble) are not species of the collection
    const first = !sp.special && !p.collection[sp.id];
    if (!sp.special) p.collection[sp.id] = (p.collection[sp.id] ?? 0) + 1;
    this.progressMissions({ kill: sp, gold: fish.gold });
    const levelUps = this.addXp(XP_PER_TIER[sp.tier] ?? 0);
    this.track("kill", { species: sp.id, bet: shot.bet, mult, payout });
    return { ok: true, killed: true, species: sp.id, mult, payout, first, gold: goldMult > 1 ? goldMult : 0, combo: +combo.toFixed(2), fever: fever > 1, jackpot, fixedTier, fixedPay, levelUps, balance: p.balance };
  }

  /**
   * A sea mine that was just killed blew up: the client reports the fish its blast reached. They
   * leave the sea without paying (the mine's own payout was the prize); bosses and special targets
   * are never taken, nor more than the maxTaken of mines/lightning. Only right after such a kill (`s.blastReady`).
   */
  blast(fishIds) {
    const s = this.session;
    if (!s || !s.blastReady) return { ok: false, taken: [] };
    s.blastReady = false;
    const taken = [];
    for (const id of fishIds) {
      if (taken.length >= Math.max(MINE.maxTaken, LIGHTNING.maxTaken)) break;
      const f = s.fish.get(id);
      const sp = f && speciesById(f.species);
      if (!sp || sp.tier === "boss" || sp.special) continue;
      s.fish.delete(id);
      taken.push(id);
    }
    this.track("mine_blast", { taken: taken.length });
    return { ok: true, taken };
  }

  /** A bullet expired without touching a fish: refund it. */
  expire(shotId) {
    const s = this.session;
    const shot = s?.shots.get(shotId);
    if (!shot) return null;
    s.shots.delete(shotId);
    this.profile.balance += shot.bet;
    // exact books: a shot refunded after the pool paid out takes its slice back, even below 0
    this.profile.jackpot -= shot.jack ?? 0;
    s.stats.spent -= shot.bet;
    s.stats.shots -= 1;
    s.stats.refunds += 1;
    this.profile.lifetime.spent -= shot.bet;
    this.profile.lifetime.shots -= 1;
    return { balance: this.profile.balance };
  }

  // ── free coins, XP and levels ────────────────────────────────────────────

  /** Free coins still allowed today (FREE_COINS_PER_DAY across every free source). */
  freeLeft() {
    return Math.max(0, FREE_COINS_PER_DAY - (this.profile.freeToday ?? 0));
  }

  /** Credit free coins within today's budget; returns what was actually granted. */
  grantFree(amount, source) {
    const granted = Math.max(0, Math.min(amount, this.freeLeft()));
    this.profile.freeToday = (this.profile.freeToday ?? 0) + granted;
    this.profile.balance += granted;
    this.track("free_coins", { source, asked: amount, granted });
    return granted;
  }

  /** Level, XP inside the level and XP the level needs. */
  levelInfo() {
    const p = this.profile;
    let spent = 0;
    for (let n = 1; n < p.level; n++) spent += xpForLevel(n);
    return { level: p.level, xp: p.xp - spent, need: xpForLevel(p.level), total: p.xp };
  }

  /** Add XP; returns the level-ups it caused: [{ level, coins, skin }] (empty most of the time). */
  addXp(n) {
    const p = this.profile;
    p.xp += n;
    const ups = [];
    let info = this.levelInfo();
    while (info.xp >= info.need) {
      p.level += 1;
      const skin = CANNON_SKINS.find((k) => k.level === p.level)?.id ?? null;
      if (skin && !p.skins.includes(skin)) p.skins.push(skin);
      const coins = this.grantFree(levelCoins(p.level), "level");
      ups.push({ level: p.level, coins, skin });
      this.track("level_up", { level: p.level, coins, skin });
      info = this.levelInfo();
    }
    return ups;
  }

  /** Pick an unlocked cannon finish. */
  setSkin(id) {
    if (!this.profile.skins.includes(id)) return { ok: false };
    this.profile.skin = id;
    return { ok: true };
  }

  // ── daily missions ───────────────────────────────────────────────────────

  /** Today's three missions (easy, tier, event), rolled from the day number on first use. */
  missions() {
    const p = this.profile;
    if (!p.missions || p.missions.day !== p.day) {
      const pools = ["easy", "tier", "event"];
      p.missions = { day: p.day, list: pools.map((pool, k) => ({ id: MISSIONS[pool][(p.day * 7 + k * 3) % MISSIONS[pool].length].id, progress: 0, claimed: false })) };
    }
    return p.missions.list.map((m, k) => {
      const pool = ["easy", "tier", "event"][k];
      const def = MISSIONS[pool].find((d) => d.id === m.id);
      return { ...def, pool, ...MISSION_REWARD[pool], progress: m.progress, claimed: m.claimed, done: m.progress >= def.target };
    });
  }

  /** Count an event toward today's missions: `{ kill: species, gold }` or `{ bossHit: true }`. */
  progressMissions({ kill = null, gold = false, bossHit = false }) {
    const defs = this.missions();
    defs.forEach((d, k) => {
      const m = this.profile.missions.list[k];
      if (m.claimed || m.progress >= d.target) return;
      let add = 0;
      if (kill) {
        if (d.kind === "kills" && !kill.special) add = 1;
        else if (d.kind === "tierKills" && !kill.special && kill.tier === d.tier) add = 1;
        else if (d.kind === "goldKills" && gold) add = 1;
        else if (d.kind === "treasure" && kill.id === "treasure") add = 1;
      } else if (bossHit && d.kind === "bossHits") add = 1;
      m.progress = Math.min(d.target, m.progress + add);
    });
  }

  claimMission(k) {
    const d = this.missions()[k];
    if (!d || d.claimed || !d.done) return { ok: false };
    this.profile.missions.list[k].claimed = true;
    const coins = this.grantFree(d.coins, "mission");
    const levelUps = this.addXp(d.xp);
    this.track("mission_claim", { id: d.id, coins, xp: d.xp });
    return { ok: true, coins, asked: d.coins, xp: d.xp, levelUps, balance: this.profile.balance };
  }

  // ── daily login bonus ────────────────────────────────────────────────────

  dailyBonusAvailable() {
    return this.profile.dailyClaimedDay < this.profile.day;
  }

  /** Consecutive-day streak as of today: missing a whole day resets it. */
  streak() {
    const p = this.profile;
    return p.dailyClaimedDay > 0 && p.day - p.dailyClaimedDay > 1 ? 0 : p.loginStreak;
  }

  nextDailyBonus() {
    const i = Math.min(this.streak(), DAILY_BONUS.length - 1);
    return DAILY_BONUS[i];
  }

  claimDaily() {
    if (!this.dailyBonusAvailable()) return { ok: false };
    const coins = this.grantFree(this.nextDailyBonus(), "daily");
    this.profile.loginStreak = this.streak() + 1;
    this.profile.dailyClaimedDay = this.profile.day;
    this.track("daily_bonus", { coins, streak: this.profile.loginStreak });
    return { ok: true, coins, streak: this.profile.loginStreak, balance: this.profile.balance };
  }

  /** Server-side day rollover (in production: the server's calendar, never the device clock). */
  advanceDay() {
    const p = this.profile;
    // missions finished but never claimed pay out on rollover (within that day's budget)
    let autoClaimed = 0;
    this.missions().forEach((d, k) => {
      if (d.done && !d.claimed) autoClaimed += this.claimMission(k).coins ?? 0;
    });
    p.day += 1;
    p.adsToday = 0;
    p.freeToday = 0;
    return { autoClaimed };
  }

  /** The profile as it should be stored: bullets in flight are counted back in, never lost. */
  snapshot() {
    // bullets in flight are refunded on load, so their pool slice is taken back out too
    const shots = this.session ? [...this.session.shots.values()] : [];
    const inFlight = shots.reduce((a, x) => a + x.bet, 0);
    const jack = shots.reduce((a, x) => a + (x.jack ?? 0), 0);
    return { ...this.profile, balance: this.profile.balance + inFlight, jackpot: Math.max(0, this.profile.jackpot - jack) };
  }

  // ── rewarded ad / purchases ──────────────────────────────────────────────

  /** Ads left today: the per-day count, and only while the free-coin budget can still pay one. */
  adsLeft() {
    return Math.max(0, Math.min(AD_REWARD.perDay - this.profile.adsToday, Math.floor(this.freeLeft() / AD_REWARD.coins)));
  }

  /** Called after the ad network's server-side "reward granted" callback. */
  grantAdReward() {
    if (this.adsLeft() <= 0) return { ok: false, reason: "daily-limit" };
    this.profile.adsToday += 1;
    const coins = this.grantFree(AD_REWARD.coins, "ad");
    this.track("ad_reward", { coins });
    return { ok: true, coins, balance: this.profile.balance };
  }

  /**
   * Credit an IAP pack after the store receipt is verified. In production `receipt` goes to
   * Apple/Google verification first; here a `simulated:` receipt is accepted for testing.
   */
  purchase(packId, receipt) {
    const pack = STORE_PACKS.find((p) => p.id === packId);
    if (!pack) return { ok: false, reason: "unknown-pack" };
    if (!String(receipt ?? "").startsWith("simulated:")) return { ok: false, reason: "receipt-unverified" };
    // prototype-only path: a real build verifies with Apple/Google and flips this flag off
    if (!ALLOW_SIMULATED_IAP) return { ok: false, reason: "simulated-disabled" };
    if (this.usedReceipts.has(receipt)) return { ok: false, reason: "receipt-replayed" };
    this.usedReceipts.add(receipt);
    const coins = pack.coins + pack.bonus;
    this.profile.balance += coins;
    this.profile.lifetime.purchases += 1;
    this.track("purchase", { pack: pack.id, coins });
    return { ok: true, coins, balance: this.profile.balance };
  }
}
