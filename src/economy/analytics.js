/**
 * Analytics sink. In production this batches events to the analytics backend (Firebase /
 * GameAnalytics / own endpoint). Here it keeps counters and a short ring of recent events so
 * the RTP and hit rates can be read live (`__studio.state().analytics`).
 */
export class Analytics {
  constructor() {
    this.reset();
  }

  reset() {
    this.counts = {};
    this.recent = [];
    this.bySpecies = {};
  }

  track(name, data = {}) {
    this.counts[name] = (this.counts[name] ?? 0) + 1;
    if (data.species && (name === "hit" || name === "kill")) {
      const row = (this.bySpecies[data.species] ??= { hits: 0, kills: 0, spent: 0, won: 0 });
      row.hits += 1;
      row.spent += data.bet ?? 0;
      if (name === "kill") {
        row.kills += 1;
        row.won += data.payout ?? 0;
      }
    }
    this.recent.push({ name, ...data });
    if (this.recent.length > 20) this.recent.shift();
  }

  summary() {
    let spent = 0;
    let won = 0;
    for (const r of Object.values(this.bySpecies)) {
      spent += r.spent;
      won += r.won;
    }
    return { counts: this.counts, observedRtp: spent ? +(won / spent).toFixed(3) : null, recent: this.recent.slice(-5) };
  }
}
