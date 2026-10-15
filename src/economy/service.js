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
  BULLET_LIFETIME,
  DAILY_BONUS,
  DAILY_GOALS,
  RTP_TARGET,
  SPECIES,
  STARTING_BALANCE,
  STORE_PACKS,
  TIERS,
  WAVES,
  killChance,
  speciesById,
} from "./config.js";

const lerp = (a, b, t) => a + (b - a) * t;

export function createProfile() {
  return {
    balance: STARTING_BALANCE,
    day: 1,
    loginStreak: 0,
    dailyClaimedDay: 0,
    adsToday: 0,
    goal: { index: 0, progress: 0, claimed: false },
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
  }

  track(name, data) {
    this.analytics?.track(name, data);
  }

  // ── session ──────────────────────────────────────────────────────────────

  startSession() {
    this.session = {
      t: 0,
      shots: new Map(), // shotId -> { bet, age }
      fish: new Map(), // fishId -> { species }
      spawnClock: 0,
      bossClock: WAVES.bossFirst,
      bossAlive: false,
      stats: { shots: 0, spent: 0, won: 0, kills: 0, refunds: 0, byTier: { small: 0, medium: 0, large: 0, boss: 0 }, best: 0 },
    };
    this.track("session_start", { balance: this.profile.balance });
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

  /** 0 → 1 over WAVES.rampSeconds of play. */
  ramp() {
    return this.session ? Math.min(1, this.session.t / WAVES.rampSeconds) : 0;
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
    for (const [id, shot] of s.shots) {
      shot.age += dt;
      if (shot.age > BULLET_LIFETIME) this.expire(id);
    }
    const out = [];
    const r = this.ramp();
    s.bossClock -= dt;
    if (s.bossClock <= 0 && !s.bossAlive) {
      s.bossClock = WAVES.bossEvery;
      const bosses = SPECIES.filter((x) => x.tier === "boss");
      const sp = bosses[Math.floor(this.rng() * bosses.length)];
      s.bossAlive = true;
      out.push(this.register(sp.id));
      this.track("boss_spawn", { species: sp.id });
    }
    s.spawnClock -= dt;
    const target = Math.round(lerp(WAVES.targetAlive[0], WAVES.targetAlive[1], r));
    if (s.spawnClock <= 0 && alive < target) {
      s.spawnClock = lerp(0.9, 0.45, r) * (0.6 + this.rng() * 0.8);
      const tier = this.pickTier(r);
      const sp = this.pickSpecies(tier);
      if (tier === "small" && this.rng() < 0.5) {
        const n = WAVES.school[0] + Math.floor(this.rng() * (WAVES.school[1] - WAVES.school[0] + 1));
        const school = this.nextFish;
        for (let i = 0; i < n; i++) out.push({ ...this.register(sp.id), school, schoolIndex: i });
      } else {
        out.push(this.register(sp.id));
      }
    }
    return out;
  }

  pickTier(r) {
    const a = WAVES.tierMix.start;
    const b = WAVES.tierMix.ramp;
    const w = ["small", "medium", "large"].map((t) => lerp(a[t], b[t], r));
    let roll = this.rng() * w.reduce((x, y) => x + y, 0);
    for (let i = 0; i < w.length; i++) {
      roll -= w[i];
      if (roll <= 0) return TIERS[i];
    }
    return "small";
  }

  pickSpecies(tier) {
    const pool = SPECIES.filter((x) => x.tier === tier);
    let roll = this.rng() * pool.reduce((x, y) => x + y.weight, 0);
    for (const sp of pool) {
      roll -= sp.weight;
      if (roll <= 0) return sp;
    }
    return pool[0];
  }

  register(species) {
    const fishId = this.nextFish++;
    this.session?.fish.set(fishId, { species });
    return { fishId, species };
  }

  /** The client reports a fish that swam off screen. */
  fishLeft(fishId) {
    const f = this.session?.fish.get(fishId);
    if (!f) return;
    if (speciesById(f.species)?.tier === "boss") this.session.bossAlive = false;
    this.session.fish.delete(fishId);
  }

  // ── shots ────────────────────────────────────────────────────────────────

  fire(bet) {
    const s = this.session;
    if (!s) return { ok: false, reason: "no-session" };
    if (!BETS.includes(bet)) return { ok: false, reason: "bad-bet" };
    if (this.profile.balance < bet) return { ok: false, reason: "insufficient", balance: this.profile.balance };
    this.profile.balance -= bet;
    const shotId = this.nextShot++;
    s.shots.set(shotId, { bet, age: 0 });
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
    if (!fish) return { ok: false, reason: "unknown-fish" };
    s.shots.delete(shotId);
    const sp = speciesById(fish.species);
    const killed = this.rng() < killChance(sp, this.rtp);
    if (!killed) {
      this.track("hit", { species: sp.id, bet: shot.bet });
      return { ok: true, killed: false, species: sp.id, balance: this.profile.balance };
    }
    const mult = sp.mult[0] + Math.floor(this.rng() * (sp.mult[1] - sp.mult[0] + 1));
    const payout = mult * shot.bet;
    this.profile.balance += payout;
    s.fish.delete(fishId);
    if (sp.tier === "boss") s.bossAlive = false;
    s.stats.won += payout;
    s.stats.kills += 1;
    s.stats.byTier[sp.tier] += 1;
    s.stats.best = Math.max(s.stats.best, payout);
    const p = this.profile;
    p.lifetime.won += payout;
    p.lifetime.kills += 1;
    const first = !p.collection[sp.id];
    p.collection[sp.id] = (p.collection[sp.id] ?? 0) + 1;
    this.progressGoal(sp, payout);
    this.track("kill", { species: sp.id, bet: shot.bet, mult, payout });
    return { ok: true, killed: true, species: sp.id, mult, payout, first, balance: p.balance };
  }

  /** A bullet expired without touching a fish: refund it. */
  expire(shotId) {
    const s = this.session;
    const shot = s?.shots.get(shotId);
    if (!shot) return null;
    s.shots.delete(shotId);
    this.profile.balance += shot.bet;
    s.stats.spent -= shot.bet;
    s.stats.shots -= 1;
    s.stats.refunds += 1;
    this.profile.lifetime.spent -= shot.bet;
    this.profile.lifetime.shots -= 1;
    return { balance: this.profile.balance };
  }

  // ── daily goal ───────────────────────────────────────────────────────────

  currentGoal() {
    const g = this.profile.goal;
    return { ...DAILY_GOALS[g.index % DAILY_GOALS.length], progress: g.progress, claimed: g.claimed };
  }

  progressGoal(sp, payout) {
    const g = this.profile.goal;
    if (g.claimed) return;
    const def = DAILY_GOALS[g.index % DAILY_GOALS.length];
    if (def.kind === "kills") g.progress += 1;
    else if (def.kind === "tierKills" && sp.tier === def.tier) g.progress += 1;
    else if (def.kind === "won") g.progress += payout;
    g.progress = Math.min(g.progress, def.target);
  }

  claimGoal() {
    const goal = this.currentGoal();
    if (goal.claimed || goal.progress < goal.target) return { ok: false };
    this.profile.goal.claimed = true;
    this.profile.balance += goal.reward;
    this.track("goal_claim", { id: goal.id, reward: goal.reward });
    return { ok: true, reward: goal.reward, balance: this.profile.balance };
  }

  // ── daily login bonus ────────────────────────────────────────────────────

  dailyBonusAvailable() {
    return this.profile.dailyClaimedDay < this.profile.day;
  }

  nextDailyBonus() {
    const i = Math.min(this.profile.loginStreak, DAILY_BONUS.length - 1);
    return DAILY_BONUS[i];
  }

  claimDaily() {
    if (!this.dailyBonusAvailable()) return { ok: false };
    const coins = this.nextDailyBonus();
    this.profile.loginStreak += 1;
    this.profile.dailyClaimedDay = this.profile.day;
    this.profile.balance += coins;
    this.track("daily_bonus", { coins, streak: this.profile.loginStreak });
    return { ok: true, coins, streak: this.profile.loginStreak, balance: this.profile.balance };
  }

  /** Server-side day rollover (in production: the server's calendar, never the device clock). */
  advanceDay() {
    const p = this.profile;
    p.day += 1;
    p.adsToday = 0;
    p.goal = { index: p.goal.index + 1, progress: 0, claimed: false };
  }

  // ── rewarded ad / purchases ──────────────────────────────────────────────

  adsLeft() {
    return Math.max(0, AD_REWARD.perDay - this.profile.adsToday);
  }

  /** Called after the ad network's server-side "reward granted" callback. */
  grantAdReward() {
    if (this.adsLeft() <= 0) return { ok: false, reason: "daily-limit" };
    this.profile.adsToday += 1;
    this.profile.balance += AD_REWARD.coins;
    this.track("ad_reward", { coins: AD_REWARD.coins });
    return { ok: true, coins: AD_REWARD.coins, balance: this.profile.balance };
  }

  /**
   * Credit an IAP pack after the store receipt is verified. In production `receipt` goes to
   * Apple/Google verification first; here a `simulated:` receipt is accepted for testing.
   */
  purchase(packId, receipt) {
    const pack = STORE_PACKS.find((p) => p.id === packId);
    if (!pack) return { ok: false, reason: "unknown-pack" };
    if (!String(receipt ?? "").startsWith("simulated:")) return { ok: false, reason: "receipt-unverified" };
    const coins = pack.coins + pack.bonus;
    this.profile.balance += coins;
    this.profile.lifetime.purchases += 1;
    this.track("purchase", { pack: pack.id, coins });
    return { ok: true, coins, balance: this.profile.balance };
  }
}
