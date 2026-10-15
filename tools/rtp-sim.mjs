#!/usr/bin/env node
/**
 * RTP simulator — runs the REAL EconomyService (src/economy/service.js) with the REAL config
 * for millions of shots and reports the return to player, per strategy and per species.
 *
 *   node tools/rtp-sim.mjs                       # defaults: 2M shots per strategy
 *   node tools/rtp-sim.mjs --shots 500000 --rtp 0.97 --seed 9
 *   node tools/rtp-sim.mjs --sessions 2000       # also simulate 1000-coin sessions until bust
 *
 * Use it before changing any number in src/economy/config.js.
 */
import { EconomyService, createProfile } from "../src/economy/service.js";
import { BETS, RTP_TARGET, SPECIES, STARTING_BALANCE, meanMult, killChance } from "../src/economy/config.js";

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
const spec = (f) => SPECIES.find((s) => s.id === f.species);
const tierOf = (f) => spec(f).tier;

function runStrategy(name, pick) {
  const rng = mulberry32(SEED);
  const profile = createProfile();
  profile.balance = 1e15; // unlimited bankroll: measure pure RTP
  const svc = new EconomyService({ rng, rtp: RTP, profile });
  svc.startSession();
  let alive = [];
  const per = {};
  let spent = 0;
  let won = 0;
  for (let i = 0; i < SHOTS; i++) {
    // ~4 shots per second of simulated play
    for (const f of svc.tick(0.25, alive.length)) alive.push(f);
    if (!alive.length) continue;
    const bet = BETS[i % BETS.length];
    const shot = svc.fire(bet);
    const target = pick(alive, rng);
    const r = svc.hit(shot.shotId, target.fishId);
    spent += bet;
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
  return { name, rtp: won / spent, per };
}

function sessions() {
  const rng = mulberry32(SEED + 7);
  const lengths = [];
  const peaks = [];
  for (let s = 0; s < SESSIONS; s++) {
    const svc = new EconomyService({ rng, rtp: RTP, profile: createProfile() });
    svc.startSession();
    let alive = [];
    let shots = 0;
    let peak = STARTING_BALANCE;
    while (svc.profile.balance >= 2 && shots < 20000) {
      for (const f of svc.tick(0.25, alive.length)) alive.push(f);
      if (!alive.length) continue;
      const shot = svc.fire(2);
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
  return { median: q(0.5), p10: q(0.1), p90: q(0.9), peakMean: Math.round(peaks.reduce((a, b) => a + b, 0) / peaks.length) };
}

console.log(`\nBalık Avı RTP simulator · target RTP ${(RTP * 100).toFixed(2)} % · ${SHOTS.toLocaleString()} shots/strategy · seed ${SEED}\n`);
console.log("Species table (kill chance per hit = rtp / mean multiplier):");
for (const s of SPECIES) {
  console.log(
    `  ${s.id.padEnd(10)} ${s.tier.padEnd(7)} ×${String(s.mult[0]).padStart(3)}–${String(s.mult[1]).padEnd(4)} p(kill)=${(killChance(s, RTP) * 100).toFixed(2).padStart(6)} %`,
  );
}
console.log("");
for (const [name, pick] of Object.entries(STRATEGIES)) {
  const r = runStrategy(name, pick);
  console.log(`Strategy ${name.padEnd(11)} observed RTP ${(r.rtp * 100).toFixed(3)} %`);
  if (args.verbose) {
    for (const [id, row] of Object.entries(r.per)) {
      console.log(`    ${id.padEnd(10)} hits ${String(row.hits).padStart(8)}  kills ${String(row.kills).padStart(7)}  rtp ${((row.won / row.spent) * 100).toFixed(2)} %`);
    }
  }
}
if (SESSIONS > 0) {
  const s = sessions();
  console.log(
    `\nSessions from ${STARTING_BALANCE} coins at bet 2, random aim (${SESSIONS} runs): shots until bust median ${s.median}, p10 ${s.p10}, p90 ${s.p90} (cap 20000); mean peak balance ${s.peakMean}`,
  );
}
console.log("");
