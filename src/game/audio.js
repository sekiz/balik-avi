/**
 * Sound: Genex-generated music + sfx (assets/genex/…), procedural WebAudio for the rest
 * (net hit pop, bubbles) and as a fallback while files decode. The AudioContext is created on
 * the first user input (browser autoplay rules); everything routes through one analyser.
 */
const FILES = {
  music: "assets/genex/746e955b-688a-401c-8fd6-119c484408e1/relaxed-cheerful-underwater-arcade-game-cmv9ecj9.mp3",
  shot: "assets/genex/6a7c8a36-610a-46b9-b07c-3a41da962b05/short-punchy-cartoon-underwater-cannon-s-cmv9eck9.mp3",
  coin: "assets/genex/260ad22a-dbe4-476d-9ebb-eef25e48667f/bright-arcade-coin-win-jingle-several-go-cmv9ecl3.mp3",
  boss: "assets/genex/2cde8893-6282-4449-ab78-f33aca2fd8d8/epic-sea-dragon-boss-entrance-deep-roar-cmv9ecly.mp3",
  jackpot: "assets/genex/083e3ddf-aaf6-44e2-86d6-51e1d43979fd/big-jackpot-win-fanfare-cascade-of-coins-cmv9ecmr.mp3",
  click: "assets/genex/8cc1c308-cc21-4e4a-a3d0-a8ea1309c640/soft-bubbly-ui-button-click-very-short-w-cmv9ecnk.mp3",
};

export class Sound {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.buffers = {};
    this.sfxOn = true;
    this.musicOn = true;
    this.music = null;
    this.lastShot = -1;
    this.clock = 0;
  }

  /** Call from an input handler (first key/click). Safe to call repeatedly. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = this.musicOn ? 0.32 : 0;
    this.musicGain.connect(this.master);
    for (const [name, url] of Object.entries(FILES)) {
      fetch(url)
        .then((r) => r.arrayBuffer())
        .then((b) => this.ctx.decodeAudioData(b))
        .then((buf) => {
          this.buffers[name] = buf;
          if (name === "music") this.startMusic();
        })
        .catch(() => {});
    }
  }

  startMusic() {
    if (!this.ctx || !this.buffers.music || this.music) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers.music;
    src.loop = true;
    src.connect(this.musicGain);
    src.start();
    this.music = src;
  }

  setMusic(on) {
    this.musicOn = on;
    if (this.musicGain) this.musicGain.gain.setTargetAtTime(on ? 0.32 : 0, this.ctx.currentTime, 0.1);
  }

  setSfx(on) {
    this.sfxOn = on;
  }

  tick(dt) {
    this.clock += dt;
  }

  play(name, { volume = 1, rate = 1 } = {}) {
    if (!this.ctx || !this.sfxOn) return;
    const buf = this.buffers[name];
    if (!buf) return this.synth(name, volume);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = volume;
    src.connect(g).connect(this.master);
    src.start();
  }

  shot(bet) {
    // throttle: auto-fire would otherwise stack dozens of samples
    if (this.clock - this.lastShot < 0.07) return;
    this.lastShot = this.clock;
    this.play("shot", { volume: 0.45, rate: 1.15 - Math.min(0.35, bet * 0.03) });
  }

  /** Procedural net pop (and fallback for any missing file). */
  synth(name, volume = 1) {
    if (!this.ctx || !this.sfxOn) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const f = { hit: 520, coin: 1200, click: 800, shot: 180, boss: 70, jackpot: 900 }[name] ?? 440;
    o.type = name === "boss" ? "sawtooth" : "sine";
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(name === "hit" ? f * 0.45 : f * 1.5, t + 0.12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25 * volume, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (name === "boss" ? 1.2 : 0.18));
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 1.3);
  }

  hit() {
    this.synth("hit", 0.5);
  }
}
