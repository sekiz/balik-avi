/**
 * Economy config — the ONE place balance numbers live. Pure data, no three.js, no DOM:
 * the same file is read by the in-game service, by `tools/rtp-sim.mjs`, and later by the
 * Node.js backend. Change a number here and re-run the simulator before shipping it.
 *
 * Model (classic fish-table, provably fair to the RTP target):
 *   - The player picks a bet (bullet cost). Every bullet costs `bet` coins.
 *   - Bullets bounce until they touch a fish, so every bullet is resolved against one fish.
 *     (A bullet that times out without touching anything is refunded.)
 *   - A fish has a payout multiplier range [min, max]. Payout = multiplier × bet.
 *   - On each hit the server kills the fish with p = rtp / mean(multiplier), then rolls the
 *     multiplier uniformly. Expected return per bullet = p × mean × bet = rtp × bet. Exact,
 *     for every species and every bet — so the long-run RTP equals `rtpTarget` regardless of
 *     what the player aims at. Big fish "have lots of HP" simply because p is small.
 */

export const ECONOMY_VERSION = 1;

/** Long-run return to player. Brief: 95–98 %. */
export const RTP_TARGET = 0.965;

/** Bullet cost options (coin per shot), the "mermi gücü" selector. */
export const BETS = [1, 2, 5, 10];

/** Coins a brand-new profile starts with. */
export const STARTING_BALANCE = 200;

/** Bullets per second while the trigger is held (the client's cadence; the simulator uses it too). */
export const FIRE_RATE = 6;

/**
 * A bet is open only while the balance covers this many bullets of it; the cheapest bet always
 * is. 200 coins open 1 and 2, 250 open 5, 500 open 10. A fresh balance cannot be gone in seconds
 * at the top bet, and a falling balance steps the cannon down instead of busting at full power.
 */
export const BET_MIN_SHOTS = 50;

/** The highest bet the balance currently allows. */
export function maxBetFor(balance, bets = BETS) {
  let best = bets[0];
  for (const b of bets) if (balance >= b * BET_MIN_SHOTS) best = b;
  return best;
}

// ── slot-style features ────────────────────────────────────────────────────────────────────
// Every feature below is RTP-neutral by construction, so the long-run return stays at
// RTP_TARGET whatever the player does. Two tricks keep it exact:
//   1. a feature that multiplies a payout by M divides the kill chance by M ("x2 pays, half as
//      often"), so the expected return per hit is unchanged and only the variance grows;
//   2. the jackpot pool is funded by a slice of every bullet (JACKPOT_RATE) that the base RTP
//      gives up, and the whole pool is paid back out.

/** Share of every bullet's cost that goes into the jackpot pool (taken out of the base RTP). */
export const JACKPOT_RATE = 0.01;
/** What a brand-new profile's pool starts with (a one-time gift; after a payout the pool restarts at 0). */
export const JACKPOT_SEED = 100;
/**
 * Fixed-odds jackpots, rolled on EVERY hit (kill or not) and paid as a bet multiple outside the
 * combo / golden-storm multipliers. `M` are the multiples (mini, minor); `pGold` / `pOther` the
 * per-hit odds on a golden fish / any other fish. Their expected value per hit is subtracted from
 * the kill chance, so the long-run RTP stays exact for any aim. (The golden shark's pool is the
 * third, progressive, "major".) Tuned by simulation: a mini about every 2 sessions at bet 1.
 */
export const JACKPOT_FIXED = {
  names: ["mini", "minor"],
  M: [20, 100],
  pGold: [1 / 180, 1 / 1500],
  pOther: [1 / 9000, 1 / 20000],
};
/** Chance a non-boss fish enters as a golden fish. */
export const GOLD_CHANCE = 0.06;
/** Golden-fish payout multipliers and their relative weights. */
export const GOLD_MULTS = [
  [2, 60],
  [3, 30],
  [5, 10],
];
export const GOLD_MEAN = GOLD_MULTS.reduce((a, [m, w]) => a + m * w, 0) / GOLD_MULTS.reduce((a, [, w]) => a + w, 0);
/** Combo: each kill within COMBO_WINDOW seconds of the last adds COMBO_STEP to the payout multiplier, up to COMBO_MAX. */
export const COMBO_STEP = 0.1;
export const COMBO_MAX = 2;
export const COMBO_WINDOW = 8;
/** Killing a boss starts a golden storm: every payout ×FEVER_MULT for FEVER_SECONDS. */
export const FEVER_SECONDS = 10;
export const FEVER_MULT = 2;

/**
 * Species table. `tier` is the brief's category; `mult` the payout multiplier range;
 * `weight` the relative spawn frequency inside its tier; `speed` world units / second.
 */
export const SPECIES = [
  // ── küçük / small: fast, straight lines, easy kills ──
  { id: "clown", tier: "small", mult: [2, 3], weight: 3, speed: 4.2, nameTr: "Palyaço Balığı", nameEn: "Clownfish" },
  { id: "tang", tier: "small", mult: [2, 3], weight: 3, speed: 4.6, nameTr: "Mavi Cerrah", nameEn: "Blue Tang" },
  { id: "yellow", tier: "small", mult: [2, 3], weight: 2, speed: 4.4, nameTr: "Sarı Tang", nameEn: "Yellow Tang" },
  { id: "neon", tier: "small", mult: [3, 3], weight: 2, speed: 5.0, nameTr: "Neon Balığı", nameEn: "Neon Fish" },
  // ── orta / medium: zig-zag ──
  { id: "angel", tier: "medium", mult: [5, 6], weight: 3, speed: 3.0, nameTr: "Melek Balığı", nameEn: "Angelfish" },
  { id: "puffer", tier: "medium", mult: [5, 7], weight: 2, speed: 2.6, nameTr: "Balon Balığı", nameEn: "Pufferfish" },
  { id: "parrot", tier: "medium", mult: [6, 8], weight: 2, speed: 3.2, nameTr: "Papağan Balığı", nameEn: "Parrotfish" },
  { id: "lion", tier: "medium", mult: [7, 8], weight: 1, speed: 2.8, nameTr: "Aslan Balığı", nameEn: "Lionfish" },
  // ── büyük / large: slow and tough ──
  { id: "turtle", tier: "large", mult: [15, 18], weight: 3, speed: 1.6, nameTr: "Deniz Kaplumbağası", nameEn: "Sea Turtle" },
  { id: "manta", tier: "large", mult: [18, 22], weight: 2, speed: 1.9, nameTr: "Vatoz", nameEn: "Manta Ray" },
  { id: "shark", tier: "large", mult: [20, 25], weight: 2, speed: 2.2, nameTr: "Köpekbalığı", nameEn: "Shark" },
  // ── boss: rare, entrance + shake ──
  { id: "goldshark", tier: "boss", mult: [100, 200], weight: 1, speed: 1.5, nameTr: "Altın Köpekbalığı", nameEn: "Golden Shark" },
  { id: "dragon", tier: "boss", mult: [200, 500], weight: 1, speed: 2.1, nameTr: "Deniz Ejderhası", nameEn: "Sea Dragon" },
  // ── Batık Gemi / Shipwreck (room 2; `room` = the collection page they belong to) ──
  { id: "seahorse", tier: "small", mult: [2, 3], weight: 3, speed: 3.6, room: "wreck", nameTr: "Deniz Atı", nameEn: "Seahorse" },
  { id: "barracuda", tier: "medium", mult: [6, 8], weight: 3, speed: 3.6, room: "wreck", nameTr: "Barakuda", nameEn: "Barracuda" },
  { id: "lantern", tier: "medium", mult: [7, 9], weight: 2, speed: 2.4, room: "wreck", nameTr: "Fener Balığı", nameEn: "Anglerfish" },
  { id: "octopus", tier: "large", mult: [18, 24], weight: 3, speed: 1.7, room: "wreck", nameTr: "Ahtapot", nameEn: "Octopus" },
  { id: "kraken", tier: "boss", mult: [150, 300], weight: 1, speed: 1.4, room: "wreck", nameTr: "Dev Ahtapot", nameEn: "Giant Octopus" },
  // ── Derin Deniz / Deep Sea (room 3) ──
  { id: "jelly", tier: "small", mult: [2, 3], weight: 3, speed: 2.2, room: "deep", nameTr: "Denizanası", nameEn: "Jellyfish" },
  { id: "eel", tier: "medium", mult: [6, 9], weight: 3, speed: 3.0, room: "deep", nameTr: "Yılan Balığı", nameEn: "Eel" },
  { id: "squid", tier: "large", mult: [18, 25], weight: 3, speed: 2.4, room: "deep", nameTr: "Kalamar", nameEn: "Squid" },
  { id: "giantsquid", tier: "boss", mult: [200, 400], weight: 1, speed: 1.6, room: "deep", nameTr: "Dev Kalamar", nameEn: "Giant Squid" },
];

/**
 * Rooms (docs/PROGRESSION.md §6). The RTP is the same in every room; a room changes the bets, the
 * fish that swim, the bosses and the scene. `species` = what may spawn there (shared reef fish
 * included); `bosses` take turns (the golden shark, when present, carries the jackpot pool).
 * `unlock`: level and balance needed to enter (balance is checked when a session starts).
 */
export const ROOMS = [
  {
    id: "reef",
    bets: [1, 2, 5, 10],
    unlock: { level: 1, balance: 0 },
    species: ["clown", "tang", "yellow", "neon", "angel", "puffer", "parrot", "lion", "turtle", "manta", "shark"],
    bosses: ["goldshark", "dragon"],
  },
  {
    id: "wreck",
    bets: [10, 20, 50],
    // 2500 = 250 bullets of 10 (the reef starts a player with 200 bullets of 1) and opens the 50 bet;
    // with 1000 a player entering at bet 10 was out in ~1.9 min (simulator)
    unlock: { level: 5, balance: 2500 },
    species: ["seahorse", "tang", "neon", "barracuda", "lantern", "lion", "puffer", "octopus", "shark", "manta"],
    bosses: ["kraken", "goldshark"],
    mines: true,
  },
  {
    id: "deep",
    bets: [50, 100, 200],
    // 12500 = 250 bullets of 50 like the wreck's entry (10000 gave ~3.9 min sessions) and opens the 200 bet
    unlock: { level: 15, balance: 12500 },
    species: ["jelly", "neon", "lantern", "eel", "barracuda", "squid", "octopus", "shark"],
    bosses: ["giantsquid", "goldshark"],
    mines: true,
  },
];
export const roomById = (id) => ROOMS.find((r) => r.id === id) ?? ROOMS[0];

export const TIERS = ["small", "medium", "large", "boss"];

/** Wave pacing. Difficulty ramps with session time (seconds). */
/**
 * The tide cycle (docs/PROGRESSION.md §3). A session runs calm → rush → boss → reward, then round
 * again one step harder (up to `maxStep`). Only WHAT enters and WHEN changes; every fish's kill
 * chance follows the same RTP rule, so the cycle is RTP-neutral by construction.
 *  - calm / rush: `alive` fish on screen and `spawn` seconds between arrivals go from [step 0,
 *    max step]; `mix` are tier weights; `speed` scales swimming.
 *  - boss: enters when calm + rush run out (a 5 s countdown shows first); the phase lasts until
 *    the boss dies or swims away.
 *  - reward: `seconds` long. After a boss kill it is the golden storm (FEVER); after a boss that
 *    got away it is a fish tide: `tideGold` of the arrivals are golden, in big schools.
 */
export const TIDE = {
  calm: { seconds: 40, alive: [12, 15], spawn: [0.9, 0.7], mix: { small: 10, medium: 3, large: 0.6 }, speed: 1.0 },
  rush: { seconds: 35, alive: [20, 26], spawn: [0.55, 0.42], mix: { small: 6, medium: 5, large: 2 }, speed: 1.2 },
  boss: { alive: [8, 10], spawn: [1.1, 1.0], mix: { small: 8, medium: 2, large: 0 }, speed: 1.0 },
  reward: { seconds: 15, alive: [20, 24], spawn: [0.5, 0.45], mix: { small: 8, medium: 4, large: 0.5 }, speed: 1.1 },
  /** from this round (0-based) on, the boss phase brings two bosses at once: the boss tour */
  bossTourRound: 2,
  /** the first round's calm is shorter, so the first boss still comes about a minute in */
  firstCalm: 25,
  /** rounds harden up to this many steps; each step adds this much large-fish weight to the rush */
  maxStep: 2,
  stepLarge: 0.6,
  /** fish tide */
  tideGold: 0.3,
  tideSchool: [5, 8],
  /** small fish arrive in schools of this size (half of the small arrivals) */
  school: [3, 6],
};

/**
 * The treasure bubble: a slow drifting bubble with a chest inside, at most one per round, in the
 * calm (chance `perRound`). It pays like any fish (kill chance = RTP / mean multiplier), so it is
 * RTP-neutral; it is not a species of the collection.
 */
export const TREASURE = { perRound: 0.5, mult: [10, 20] };

/**
 * The sea mine (rooms with `mines`): drifts in during the rush (chance `perRound`). Shot dead it
 * blows up and takes the non-boss fish within `radius` with it. It pays its own ×20–40 whatever
 * the blast takes — the payout is known before the roll, so the kill chance is the usual RTP /
 * mean multiplier and the RTP stays exact. The fish it takes pay nothing more (they are the show).
 */
export const MINE = { perRound: 0.6, mult: [20, 40], radius: 7, maxTaken: 8 };

/**
 * The lightning fish: shot dead it chains lightning to up to `maxTaken` fish of the most numerous
 * (non-boss) species on screen. Like the mine it pays its own ×15–30 whatever the chain takes, so
 * the RTP stays exact; the fish it takes pay nothing more.
 */
export const LIGHTNING = { perRound: 0.4, mult: [15, 30], maxTaken: 8 };

/**
 * The frost fish: shot dead it freezes every fish on screen for `seconds` (easier aiming). Its own
 * ×8–12 is its prize; nobody's kill chance changes, so the freeze does not touch the RTP.
 */
export const FROST = { perRound: 0.4, mult: [8, 12], seconds: 5 };

/**
 * Special targets entering during the tide: which phase, how likely per round, which rooms (all if
 * omitted). The one drawn for a round enters at a random moment of its phase.
 */
export const EVENTS = [
  { id: "treasure", phase: "calm", perRound: TREASURE.perRound },
  { id: "frost", phase: "calm", perRound: FROST.perRound },
  { id: "mine", phase: "rush", perRound: MINE.perRound, rooms: ["wreck", "deep"] },
  { id: "volt", phase: "rush", perRound: LIGHTNING.perRound },
];

/** Shots that never touch a fish are refunded after this long (seconds). */
export const BULLET_LIFETIME = 8;

/** Rewarded ad: coins per view, views per day. */
export const AD_REWARD = { coins: 200, perDay: 5 };

/** Daily login bonus ladder (day 1..7, then repeats the last). */
export const DAILY_BONUS = [100, 150, 200, 300, 400, 600, 1000];

// ── progression (docs/PROGRESSION.md §5, §7, §8) ───────────────────────────────────────────
// None of this touches a shot's odds: XP and missions come from catches, never from spending.

/** XP per catch by tier, whatever the bet (so a 1-coin player levels as fast as a 10-coin one). */
export const XP_PER_TIER = { small: 1, medium: 3, large: 10, boss: 50 };

/** XP needed to go from level `n` to `n + 1`. */
export const xpForLevel = (n) => Math.round(60 * n ** 1.4);

/** Cannon finishes, unlocked by level (cosmetic only). */
export const CANNON_SKINS = [
  { id: "bronze", level: 1 },
  { id: "silver", level: 3 },
  { id: "coral", level: 6 },
  { id: "abyss", level: 10 },
  { id: "dragon", level: 15 },
];

/**
 * Coins a level-up gives (subject to the daily free-coin budget): a token 25, and 250 every fifth
 * level. Kept small on purpose: with 75–300 per level a new player's first session (who levels up
 * 2–3 times in it) ran ~15 min instead of ~4 — levels are mostly cosmetic (PROGRESSION.md §5, §8).
 */
export const levelCoins = (level) => (level % 5 === 0 ? 250 : 25);

/**
 * Most free coins a player can receive per day, from every free source together: daily bonus,
 * rewarded ads, missions, level-ups. Purchases are not free coins and are never capped here.
 */
export const FREE_COINS_PER_DAY = 2500;

/**
 * The daily mission board: one mission from each pool, chosen by the day (no randomness). Kinds:
 * kills, tierKills (`tier`), goldKills, treasure, bossHits. No mission ever asks to spend or bet.
 */
export const MISSIONS = {
  easy: [
    { id: "kills40", kind: "kills", target: 40 },
    { id: "small30", kind: "tierKills", tier: "small", target: 30 },
    { id: "kills60", kind: "kills", target: 60 },
  ],
  tier: [
    { id: "medium15", kind: "tierKills", tier: "medium", target: 15 },
    { id: "large4", kind: "tierKills", tier: "large", target: 4 },
    { id: "medium20", kind: "tierKills", tier: "medium", target: 20 },
  ],
  event: [
    { id: "gold5", kind: "goldKills", target: 5 },
    { id: "treasure1", kind: "treasure", target: 1 },
    { id: "bossHits40", kind: "bossHits", target: 40 },
  ],
};
export const MISSION_REWARD = { easy: { coins: 150, xp: 20 }, tier: { coins: 250, xp: 40 }, event: { coins: 400, xp: 60 } };

/** Daily goals: one is active per day; `reward` in coins. (Superseded by MISSIONS; kept for old saves.) */
export const DAILY_GOALS = [
  { id: "kill50", kind: "kills", target: 50, reward: 300 },
  { id: "kill_medium20", kind: "tierKills", tier: "medium", target: 20, reward: 350 },
  { id: "kill_large5", kind: "tierKills", tier: "large", target: 5, reward: 400 },
  { id: "win2000", kind: "won", target: 2000, reward: 300 },
];

/**
 * IAP coin packs. Price strings are display only — the real price and the receipt come from
 * App Store / Google Play. ONE-WAY: real money → coins. There is no coins → money path anywhere.
 */
export const STORE_PACKS = [
  { id: "coins_small", coins: 2000, bonus: 0, priceTry: "₺19,99" },
  { id: "coins_medium", coins: 5500, bonus: 500, priceTry: "₺49,99" },
  { id: "coins_large", coins: 12000, bonus: 2000, priceTry: "₺99,99" },
];

/** Targets that are not species of the collection (never in SPECIES, never picked by tier). */
export const SPECIAL = [
  { id: "treasure", tier: "large", mult: TREASURE.mult, weight: 0, speed: 1.3, special: true, nameTr: "Hazine Baloncuğu", nameEn: "Treasure Bubble" },
  { id: "mine", tier: "large", mult: MINE.mult, weight: 0, speed: 1.1, special: true, nameTr: "Deniz Mayını", nameEn: "Sea Mine" },
  { id: "volt", tier: "large", mult: LIGHTNING.mult, weight: 0, speed: 3.4, special: true, nameTr: "Şimşek Balığı", nameEn: "Lightning Fish" },
  { id: "frost", tier: "medium", mult: FROST.mult, weight: 0, speed: 2.8, special: true, nameTr: "Buz Balığı", nameEn: "Frost Fish" },
];

export function speciesById(id) {
  return SPECIES.find((s) => s.id === id) ?? SPECIAL.find((s) => s.id === id) ?? null;
}

export const meanMult = (s) => (s.mult[0] + s.mult[1]) / 2;

/**
 * Kill probability per hit for a species at a given RTP — the heart of the model. The service
 * calls it with `rtp - JACKPOT_RATE` (the slice the jackpot pool keeps) and then divides by any
 * active payout multiplier.
 */
export function killChance(species, rtp = RTP_TARGET) {
  return Math.min(1, rtp / meanMult(species));
}

/** Prototype switch: accept `simulated:` receipts. Production must set this false (real receipts only). */
export const ALLOW_SIMULATED_IAP = true;
