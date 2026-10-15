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
export const STARTING_BALANCE = 1000;

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
  { id: "dragon", tier: "boss", mult: [200, 500], weight: 1, speed: 1.3, nameTr: "Deniz Ejderhası", nameEn: "Sea Dragon" },
];

export const TIERS = ["small", "medium", "large", "boss"];

/** Wave pacing. Difficulty ramps with session time (seconds). */
export const WAVES = {
  /** fish alive on screen at the start / at full ramp */
  targetAlive: [14, 26],
  /** seconds of play to reach full ramp */
  rampSeconds: 240,
  /** tier mix at start and at full ramp (relative weights) */
  tierMix: {
    start: { small: 10, medium: 4, large: 1 },
    ramp: { small: 8, medium: 5, large: 2 },
  },
  /** speed multiplier at start / full ramp */
  speedScale: [1.0, 1.25],
  /** a boss every N seconds of play (first one after `bossFirst`) */
  bossFirst: 60,
  bossEvery: 90,
  /** small fish arrive in schools of this size */
  school: [3, 6],
};

/** Shots that never touch a fish are refunded after this long (seconds). */
export const BULLET_LIFETIME = 8;

/** Rewarded ad: coins per view, views per day. */
export const AD_REWARD = { coins: 200, perDay: 5 };

/** Daily login bonus ladder (day 1..7, then repeats the last). */
export const DAILY_BONUS = [100, 150, 200, 300, 400, 600, 1000];

/** Daily goals: one is active per day; `reward` in coins. */
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

export function speciesById(id) {
  return SPECIES.find((s) => s.id === id) ?? null;
}

export const meanMult = (s) => (s.mult[0] + s.mult[1]) / 2;

/** Kill probability per hit for a species at a given RTP — the heart of the model. */
export function killChance(species, rtp = RTP_TARGET) {
  return Math.min(1, rtp / meanMult(species));
}
