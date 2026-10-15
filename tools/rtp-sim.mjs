#!/usr/bin/env node
/**
 * RTP simulator — runs the REAL EconomyService (src/economy/service.js) with the REAL config
 * for millions of shots and reports the return to player, per strategy and per species.
 *
 *   node tools/rtp-sim.mjs                       # defaults: 2M shots per strategy
 *   node tools/rtp-sim.mjs --shots 500000 --rtp 0.97 --seed 9
 *   node tools/rtp-sim.mjs --sessions 2000       # also simulate fresh-profile sessions until bust
 *   node tools/rtp-sim.mjs --room wreck          # a room other than the reef (its bets, fish and bosses)
 *
 * Use it before changing any number in src/economy/config.js.
 */
import { EconomyService, createProfile } from "../src/economy/service.js";
import { BETS, FIRE_RATE, JACKPOT_RATE, JACKPOT_SEED, RTP_TARGET, SPECIES, STARTING_BALANCE, maxBetFor, meanMult, killChance, speciesById, roomById } from "../src/economy/config.js";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "1"]);
    return acc;
  }, []),
);
const SHOTS = Number(args.shots ?? 2_000_000);
const RTP = Number(args.rtp ?? RTP_TARGET);
const SEED = Number(args.seed ?? 1);
const SESSIONS = Number(args.sessions ?? 1000);
const ROOM = roomById(args.room ?? "reef");

function mulberry32(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Aim strategies: which on-screen fish a bullet ends up hitting. */
const STRATEGIES = {
  random: (alive, rng) => alive[Math.floor(rng() * alive.length)],
  smallOnly: (alive) => alive.find((f) => tierOf(f) === "small") ?? alive[0],
  bigGame: (alive) => [...alive].sort((a, b) => meanMult(spec(b)) - meanMult(spec(a)))[0],
  bossHunter: (alive, rng) => alive.find((f) => tierOf(f) === "boss") ?? alive[Math.floor(rng() * alive.length)],
};
const spec = (f) => speciesById(f.species); // SPECIES plus the special targets (treasure bubble)

/**
 * In the game a boss crosses the screen in ~30–60 s and leaves. Without that, a strategy that never
 * shoots bosses kept them on screen forever and ended up firing a third of its bullets at them
 * whenever no small fish was in sight (huge variance, misleading results). `t` = simulated seconds.
 */
const BOSS_STAY = 60;
function bossesLeave(svc, alive, t) {
  return alive.filter((f) => {
    if (spec(f).tier !== "boss") return true;
    f.since ??= t;
    if (t - f.since < BOSS_STAY) return true;
    svc.fishLeft(f.fishId);
    return false;
  });
}
const tierOf = (f) => spec(f).tier;

function runStrategy(name, pick) {
  const rng = mulberry32(SEED);
  const profile = createProfile();
  profile.balance = 1e15; // unlimited bankroll: measure pure RTP
  profile.level = 99; // every room open
  const svc = new EconomyService({ rng, rtp: RTP, profile });
  svc.startSession(ROOM.id);
  const BETS = ROOM.bets;
  let alive = [];
  const per = {};
  let spent = 0;
  let won = 0;
  for (let i = 0; i < SHOTS; i++) {
    // ~4 shots per second of simulated play
    for (const f of svc.tick(0.25, alive.length)) alive.push(f);
    alive = bossesLeave(svc, alive, i * 0.25);
    if (!alive.length) continue;
    const bet = BETS[i % BETS.length];
    const shot = svc.fire(bet);
    const target = pick(alive, rng);
    const r = svc.hit(shot.shotId, target.fishId);
    spent += bet;
    // fixed-odds MINI / MINOR jackpots pay on any hit, kill or not
    if (r.fixedPay) {
      won += r.fixedPay;
      (per[r.species] ??= { hits: 0, kills: 0, spent: 0, won: 0 }).won += r.fixedPay;
    }
    const row = (per[r.species] ??= { hits: 0, kills: 0, spent: 0, won: 0 });
    row.hits += 1;
    row.spent += bet;
    if (r.killed) {
      won += r.payout;
      row.kills += 1;
      row.won += r.payout;
      alive = alive.filter((f) => f.fishId !== target.fishId);
    }
    // fish drift off screen over time
    if (alive.length > 30) {
      const gone = alive.shift();
      svc.fishLeft(gone.fishId);
    }
  }
  // the pool still waiting for a golden-shark kill belongs to the player too
  const pool = Math.max(0, profile.jackpot);
  return { name, rtp: won / spent, rtpWithPool: (won + pool) / spent, per };
}

/** Sessions from a fresh profile until bust, at the game's fire rate; `want` is the bet the player
 *  asks for, the service's bet cap steps it down as the balance falls. */
function sessions(want) {
  const rng = mulberry32(SEED + 7);
  const lengths = [];
  const peaks = [];
  for (let s = 0; s < SESSIONS; s++) {
    // a fresh profile in the reef; in another room a player who just opened it (its level, its balance)
    const profile = createProfile();
    if (ROOM.id !== "reef") Object.assign(profile, { level: ROOM.unlock.level, balance: ROOM.unlock.balance });
    const svc = new EconomyService({ rng, rtp: RTP, profile });
    svc.startSession(ROOM.id);
    let alive = [];
    let shots = 0;
    let peak = STARTING_BALANCE;
    while (svc.profile.balance >= ROOM.bets[0] && shots < 20000) {
      for (const f of svc.tick(1 / FIRE_RATE, alive.length)) alive.push(f);
      alive = bossesLeave(svc, alive, shots / FIRE_RATE);
      if (!alive.length) continue;
      const shot = svc.fire(Math.min(want, maxBetFor(svc.profile.balance, ROOM.bets)));
      const t = alive[Math.floor(rng() * alive.length)];
      const r = svc.hit(shot.shotId, t.fishId);
      if (r.killed) alive = alive.filter((f) => f.fishId !== t.fishId);
      if (alive.length > 30) svc.fishLeft(alive.shift().fishId);
      shots += 1;
      peak = Math.max(peak, svc.profile.balance);
    }
    lengths.push(shots);
    peaks.push(peak);
  }
  lengths.sort((a, b) => a - b);
  const q = (p) => lengths[Math.floor(p * (lengths.length - 1))];
  const min = (n) => (n / FIRE_RATE / 60).toFixed(1);
  return { median: q(0.5), p10: q(0.1), p90: q(0.9), minutes: { median: min(q(0.5)), p10: min(q(0.1)), p90: min(q(0.9)) }, peakMean: Math.round(peaks.reduce((a, b) => a + b, 0) / peaks.length) };
}

console.log(`\nBalık Avı RTP simulator · target RTP ${(RTP * 100).toFixed(2)} % · ${SHOTS.toLocaleString()} shots/strategy · seed ${SEED}\n`);
console.log("Species table (base kill chance per hit = (rtp - jackpot slice) / mean multiplier; golden fish, combo and fever divide it further):");
for (const s of SPECIES) {
  console.log(
    `  ${s.id.padEnd(10)} ${s.tier.padEnd(7)} ×${String(s.mult[0]).padStart(3)}–${String(s.mult[1]).padEnd(4)} p(kill)=${(killChance(s, RTP - JACKPOT_RATE) * 100).toFixed(2).padStart(6)} %`,
  );
}
console.log("");
for (const [name, pick] of Object.entries(STRATEGIES)) {
  const r = runStrategy(name, pick);
  console.log(`Strategy ${name.padEnd(11)} observed RTP ${(r.rtp * 100).toFixed(3)} %   (+ unpaid jackpot pool: ${(r.rtpWithPool * 100).toFixed(3)} %)`);
  if (args.verbose) {
    for (const [id, row] of Object.entries(r.per)) {
      console.log(`    ${id.padEnd(10)} hits ${String(row.hits).padStart(8)}  kills ${String(row.kills).padStart(7)}  rtp ${((row.won / row.spent) * 100).toFixed(2)} %`);
    }
  }
}
if (SESSIONS > 0) {
  const start = ROOM.id === "reef" ? STARTING_BALANCE : ROOM.unlock.balance;
  console.log(`\nRoom ${ROOM.id}. Sessions from ${start} coins, random aim, ${FIRE_RATE} shots/s held trigger (${SESSIONS} runs, cap 20000 shots):`);
  for (const want of [ROOM.bets[0], ROOM.bets[ROOM.bets.length - 1]]) {
    const s = sessions(want);
    console.log(
      `  asks bet ${String(want).padStart(2)}: shots until bust median ${s.median} (${s.minutes.median} min), p10 ${s.p10} (${s.minutes.p10} min), p90 ${s.p90} (${s.minutes.p90} min); mean peak balance ${s.peakMean}`,
    );
  }
}
console.log("");
