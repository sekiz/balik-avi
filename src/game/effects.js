/**
 * Bullets, capture nets, hit sparks, coin bursts flying home, floating payout numbers, kill
 * bursts and the muzzle flash.
 *
 * Draw budget: everything that comes in numbers is one InstancedMesh — coins (a jackpot throws
 * 180+), sparks, kill shards, bullet cores and bullet halos — so auto-fire and big wins cost a
 * handful of draw calls, not one per object. Camera-facing quads take the view rotation from
 * `setView(camera.quaternion)`. Nets, rings and popups are few at a time and pooled.
 */
import * as THREE from "three";
import { betColor } from "./cannon.js";
import { FONT } from "./skin.js?v=hud-1";

function radial(stops, size = 64) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(([t, col]) => grad.addColorStop(t, col));
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function netTexture() {
  const s = 256;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d");
  g.translate(s / 2, s / 2);
  g.strokeStyle = "rgba(255,255,255,0.95)";
  g.lineWidth = 3;
  for (let r = 25; r <= 120; r += 24) {
    g.beginPath();
    for (let k = 0; k <= 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.stroke();
  }
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(Math.cos(a) * 121, Math.sin(a) * 121);
    g.stroke();
  }
  g.lineWidth = 6;
  g.beginPath();
  g.arc(0, 0, 122, 0, Math.PI * 2);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A soft ring (shockwave): bright rim, fading inward. */
function ringTexture() {
  const s = 128;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(s / 2, s / 2, s * 0.2, s / 2, s / 2, s / 2);
  grad.addColorStop(0, "rgba(255,255,255,0)");
  grad.addColorStop(0.72, "rgba(255,255,255,0.15)");
  grad.addColorStop(0.9, "rgba(255,255,255,1)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Fallback coin until the generated one decodes: gold disc with a star (no currency glyph — coins never cash out). */
function coinTexture() {
  const s = 64;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(24, 22, 4, 32, 32, 30);
  grad.addColorStop(0, "#fff6c2");
  grad.addColorStop(0.5, "#ffcc33");
  grad.addColorStop(1, "#b07800");
  g.fillStyle = grad;
  g.beginPath();
  g.arc(32, 32, 29, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "#8a5a00";
  g.lineWidth = 3;
  g.beginPath();
  g.arc(32, 32, 21, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = "#8a5a00";
  g.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const r = k % 2 ? 6 : 14;
    g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
  }
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const MAX_COINS = 256;
const MAX_SPARKS = 96;
const MAX_SHARDS = 160;
const MAX_BULLETS = 32;
const POPUP_POOL = 12;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();
const _e = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);

/** An instanced quad/mesh layer that draws `count` live instances. */
function layer(geo, mat, max, tag) {
  const m = new THREE.InstancedMesh(geo, mat, max);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.count = 0;
  m.frustumCulled = false; // instances move freely; one box for all would always be stale
  m.userData.tag = tag;
  return m;
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.userData.tag = "fx";
    scene.add(this.root);
    this.glowTex = radial([[0, "rgba(255,255,255,1)"], [0.25, "rgba(255,255,255,0.8)"], [1, "rgba(255,255,255,0)"]]);
    this.netTex = netTexture();
    this.ringTex = ringTexture();
    this.coinTex = coinTexture();
    this.view = new THREE.Quaternion(); // camera rotation for camera-facing quads (setView)
    const quad = new THREE.PlaneGeometry(1, 1);
    const additive = (map) => new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });

    // coins: the generated gold coin replaces the canvas one once it decodes
    this.coinMat = new THREE.MeshBasicMaterial({ map: this.coinTex, transparent: true, depthWrite: false, alphaTest: 0.05 });
    new THREE.TextureLoader().load("assets/ui/coin.webp", (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      this.coinMat.map = t;
      this.coinMat.needsUpdate = true;
    });
    this.coinLayer = layer(quad, this.coinMat, MAX_COINS, "coin");
    this.coinLayer.renderOrder = 5;
    // sparks and halos fade by darkening their instance colour (additive: black adds nothing)
    this.sparkLayer = layer(quad, additive(this.glowTex), MAX_SPARKS, "spark");
    this.haloLayer = layer(quad, additive(this.glowTex), MAX_BULLETS, "bullet-halo");
    this.bulletGeo = new THREE.CapsuleGeometry(0.16, 0.55, 4, 10);
    this.bulletGeo.rotateX(Math.PI / 2);
    this.coreLayer = layer(this.bulletGeo, new THREE.MeshBasicMaterial({ map: this.glowTex, toneMapped: false }), MAX_BULLETS, "bullet");
    const shardGeo = new THREE.OctahedronGeometry(0.28, 0);
    shardGeo.scale(1, 0.45, 0.7);
    this.shardLayer = layer(shardGeo, new THREE.MeshBasicMaterial({ toneMapped: false }), MAX_SHARDS, "shard");
    for (const l of [this.coinLayer, this.sparkLayer, this.haloLayer, this.coreLayer, this.shardLayer]) {
      l.setColorAt(0, _c.set(0xffffff)); // allocates instanceColor
      this.root.add(l);
    }

    // the muzzle flash: one camera-facing additive quad, restarted by every shot
    this.flash = new THREE.Mesh(quad, additive(this.glowTex));
    this.flash.userData.tag = "muzzle-flash";
    this.flash.visible = false;
    this.flashT = 1;
    this.root.add(this.flash);

    this.bullets = [];
    this.nets = [];
    this.coins = [];
    this.popups = [];
    this.sparks = [];
    this.shards = [];
    this.rings = [];
    this.bolts = []; // lightning arcs: a few at a time, each its own short-lived tube
    this.boltMat = new THREE.MeshBasicMaterial({ color: 0xf4fbff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.netGeo = quad;
    this.netMatPool = [];
    this.ringPool = [];
    this.popupPool = [];
  }

  /** Camera-facing quads use this rotation (pass the camera's quaternion once; it is read live). */
  setView(q) {
    this.view = q;
  }

  clear() {
    for (const n of this.nets) {
      this.root.remove(n.obj);
      this.netMatPool.push(n.obj.material);
    }
    for (const r of this.rings) {
      this.root.remove(r.obj);
      this.ringPool.push(r.obj);
    }
    for (const p of this.popups) {
      this.root.remove(p.obj);
      this.popupPool.push(p.slot);
    }
    for (const b of this.bolts) {
      this.root.remove(b.obj);
      b.obj.geometry.dispose();
    }
    this.bolts.length = 0;
    for (const list of [this.bullets, this.nets, this.coins, this.popups, this.sparks, this.shards, this.rings]) list.length = 0;
    this.flash.visible = false;
    this.flashT = 1;
    this.writeLayers();
  }

  addBullet(shotId, bet, pos, dir) {
    const col = new THREE.Color(betColor(bet));
    // size grows with the bet up to the reef's 10 (a 50 bullet would otherwise be a blob)
    const b = { shotId, bet, pos: pos.clone(), dir: dir.clone(), speed: 24, age: 0, bounces: 0, col, size: 0.85 + Math.min(Math.log2(bet + 1), 4) * 0.25 };
    this.bullets.push(b);
    return b;
  }

  removeBullet(b) {
    const i = this.bullets.indexOf(b);
    if (i >= 0) this.bullets.splice(i, 1);
  }

  /** A short bright flash at the muzzle in the bet colour. */
  muzzleFlash(pos, bet) {
    this.flash.position.copy(pos);
    this.flash.material.color.set(betColor(bet)).multiplyScalar(1.6);
    this.flash.visible = true;
    this.flashT = 0;
  }

  net(pos, bet) {
    const col = new THREE.Color(betColor(bet));
    const mat = this.netMatPool.pop() ?? new THREE.MeshBasicMaterial({ map: this.netTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    mat.color.copy(col);
    mat.opacity = 1;
    const m = new THREE.Mesh(this.netGeo, mat);
    m.userData.tag = "net";
    m.rotation.x = -Math.PI / 2;
    m.position.copy(pos);
    m.position.y += 0.6;
    this.root.add(m);
    this.nets.push({ obj: m, t: 0, size: 2.2 + Math.min(Math.log2(bet + 1), 4) * 0.9 });
    for (let i = 0; i < 6; i++) this.spark(pos, col, 4 + (i % 3));
  }

  spark(pos, col, speed, life = 0.4, size = 0.4) {
    if (this.sparks.length >= MAX_SPARKS) return;
    const a = this.sparks.length * 2.399;
    this.sparks.push({ pos: pos.clone(), t: 0, life, size, col: col.clone(), v: new THREE.Vector3(Math.cos(a) * speed, 2 + (a % 1) * 3, Math.sin(a) * speed) });
  }

  /**
   * A kill: a shockwave ring on the water plane, shards of the fish's colours thrown out and
   * falling back, and a spark crown. `scale` grows with the fish's tier (1 small … 3 boss).
   */
  killBurst(pos, colors, scale = 1, rng = Math.random) {
    this.ring(pos, colors[0], 2.2 * scale, 0.45 + 0.1 * scale);
    if (scale >= 2) this.ring(pos, new THREE.Color(0xffe27a), 3.4 * scale, 0.7 + 0.1 * scale, 0.12);
    const n = Math.round(8 + 6 * scale);
    for (let i = 0; i < n && this.shards.length < MAX_SHARDS; i++) {
      const a = (i / n) * Math.PI * 2 + rng() * 0.4;
      const sp = (3.5 + rng() * 3) * (0.7 + 0.3 * scale);
      this.shards.push({
        pos: pos.clone(),
        v: new THREE.Vector3(Math.cos(a) * sp, 3 + rng() * 4, Math.sin(a) * sp),
        spin: new THREE.Vector3(rng() * 12, rng() * 12, rng() * 12),
        rot: new THREE.Euler(rng() * 6, rng() * 6, 0),
        col: colors[i % colors.length].clone(),
        size: (0.8 + rng() * 0.7) * (0.8 + 0.25 * scale),
        t: 0,
        life: 0.55 + rng() * 0.25,
      });
    }
    // a few glints in the tier colour (white sparks bloomed into one blob over the shards)
    for (let i = 0; i < 3 + scale; i++) this.spark(pos, colors[0], 5 + scale * 2, 0.3, 0.35 + 0.1 * scale);
  }

  /**
   * A lightning arc from `a` to `b`: a jagged tube (bright, additive, so it blooms) that flickers
   * and fades over `life` seconds, starting after `delay` (a chain strikes one fish after another).
   */
  bolt(a, b, rng = Math.random, delay = 0, life = 0.6) {
    const pts = [];
    const n = 9;
    const side = new THREE.Vector3(-(b.z - a.z), 0, b.x - a.x).normalize();
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = a.clone().lerp(b, t);
      if (i > 0 && i < n) p.addScaledVector(side, (rng() - 0.5) * 1.4).add(new THREE.Vector3(0, (rng() - 0.5) * 0.8, 0));
      pts.push(p);
    }
    const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.1), 36, 0.15, 5);
    const m = new THREE.Mesh(geo, this.boltMat.clone());
    m.userData.tag = "lightning";
    m.visible = delay <= 0;
    this.root.add(m);
    this.bolts.push({ obj: m, t: -delay, life });
  }

  ring(pos, col, size, life, delay = 0) {
    let m = this.ringPool.pop();
    if (!m) {
      m = new THREE.Mesh(this.netGeo, new THREE.MeshBasicMaterial({ map: this.ringTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      m.rotation.x = -Math.PI / 2;
      m.userData.tag = "shockwave";
    }
    m.material.color.copy(col).multiplyScalar(2);
    m.position.copy(pos);
    m.position.y += 0.4;
    m.scale.setScalar(0.01);
    this.root.add(m);
    this.rings.push({ obj: m, t: -delay, life, size });
  }

  /** Coin burst at `pos` that flies to `home`. */
  coinBurst(pos, n, home, rng) {
    n = Math.min(n, MAX_COINS - this.coins.length);
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2;
      const r = 2 + rng() * 4 + Math.sqrt(n) * 0.3;
      this.coins.push({
        pos: pos.clone(),
        t: -i * 0.025,
        from: pos.clone(),
        burst: pos.clone().add(new THREE.Vector3(Math.cos(a) * r, 2 + rng() * 2.5, Math.sin(a) * r * 0.7)),
        home: home.clone(),
        spin: rng() * 6,
        sx: 0.75,
      });
    }
  }

  /** A floating number, drawn in the UI font onto a pooled canvas (no allocation per popup). */
  popup(pos, text, color = "#ffe066", big = false) {
    let slot = this.popupPool.pop();
    if (!slot && this.popups.length >= POPUP_POOL) {
      // the oldest popup gives up its slot
      const old = this.popups.shift();
      this.root.remove(old.obj);
      slot = old.slot;
    }
    if (!slot) {
      const c = document.createElement("canvas");
      c.width = 256;
      c.height = 96;
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
      sprite.renderOrder = 10;
      sprite.userData.tag = "popup";
      slot = { c, tex, sprite };
    }
    const g = slot.c.getContext("2d");
    g.clearRect(0, 0, 256, 96);
    g.font = `${big ? 68 : 56}px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineJoin = "round";
    g.lineWidth = 10;
    g.strokeStyle = "#3a1a00";
    g.strokeText(text, 128, 50, 244);
    g.fillStyle = color;
    g.fillText(text, 128, 50, 244);
    slot.tex.needsUpdate = true;
    const s = slot.sprite;
    s.visible = true;
    s.material.opacity = 1;
    const w = big ? 7 : 3.4;
    s.userData.w = w;
    s.scale.set(w, w * 0.375, 1);
    s.position.copy(pos);
    s.position.y += 2;
    this.root.add(s);
    this.popups.push({ obj: s, slot, t: 0, life: big ? 2.4 : 1.2 });
  }

  update(dt, bounds, onBulletMove) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.age += dt;
      b.pos.x += b.dir.x * b.speed * dt;
      b.pos.z += b.dir.z * b.speed * dt;
      const hw = bounds.halfW(b.pos.z);
      if (b.pos.x > hw && b.dir.x > 0) b.dir.x *= -1, b.bounces++;
      if (b.pos.x < -hw && b.dir.x < 0) b.dir.x *= -1, b.bounces++;
      if (b.pos.z < bounds.zTop && b.dir.z < 0) b.dir.z *= -1, b.bounces++;
      if (b.pos.z > bounds.zBottom && b.dir.z > 0) b.dir.z *= -1, b.bounces++;
      onBulletMove(b);
    }
    for (let i = this.nets.length - 1; i >= 0; i--) {
      const n = this.nets[i];
      n.t += dt;
      const k = n.t / 0.55;
      const s = n.size * (0.4 + 0.6 * Math.min(1, k * 2));
      n.obj.scale.set(s, s, s);
      n.obj.rotation.z += dt * 2;
      n.obj.material.opacity = Math.max(0, 1 - k);
      if (k >= 1) {
        this.root.remove(n.obj);
        this.netMatPool.push(n.obj.material);
        this.nets.splice(i, 1);
      }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const k = Math.max(0, r.t) / r.life;
      r.obj.visible = r.t >= 0;
      r.obj.scale.setScalar(r.size * (1 - (1 - Math.min(1, k)) ** 3));
      r.obj.material.opacity = Math.max(0, 1 - k);
      if (k >= 1) {
        this.root.remove(r.obj);
        this.ringPool.push(r.obj);
        this.rings.splice(i, 1);
      }
    }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.t += dt;
      s.pos.addScaledVector(s.v, dt);
      s.v.multiplyScalar(0.9);
      if (s.t > s.life) this.sparks.splice(i, 1);
    }
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const s = this.shards[i];
      s.t += dt;
      s.v.y -= 14 * dt;
      s.v.x *= 0.97;
      s.v.z *= 0.97;
      s.pos.addScaledVector(s.v, dt);
      s.rot.x += s.spin.x * dt;
      s.rot.y += s.spin.y * dt;
      s.rot.z += s.spin.z * dt;
      if (s.t > s.life) this.shards.splice(i, 1);
    }
    let arrived = 0;
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const c = this.coins[i];
      c.t += dt;
      const t = Math.max(0, c.t);
      if (t < 0.45) {
        const k = 1 - (1 - t / 0.45) ** 3;
        c.pos.lerpVectors(c.from, c.burst, k);
      } else {
        const k = Math.min(1, (t - 0.45) / 0.5);
        c.pos.lerpVectors(c.burst, c.home, k * k);
        if (k >= 1) {
          this.coins.splice(i, 1);
          arrived++;
          continue;
        }
      }
      c.sx = Math.abs(Math.cos(c.t * 9 + c.spin)) * 0.75 + 0.08;
    }
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.t += dt;
      p.obj.position.y += dt * 1.2;
      const pop = Math.min(1, p.t * 6);
      p.obj.material.opacity = Math.min(1, (p.life - p.t) * 3);
      const base = p.obj.userData.w;
      const sc = base * (0.6 + 0.4 * pop + (pop < 1 ? 0.2 * Math.sin(pop * Math.PI) : 0));
      p.obj.scale.set(sc, sc * 0.375, 1);
      if (p.t > p.life) {
        this.root.remove(p.obj);
        this.popupPool.push(p.slot);
        this.popups.splice(i, 1);
      }
    }
    if (this.flash.visible) {
      this.flashT += dt;
      const k = this.flashT / 0.09;
      this.flash.quaternion.copy(this.view);
      this.flash.scale.setScalar(1.2 + k * 1.6);
      this.flash.material.opacity = Math.max(0, 1 - k);
      if (k >= 1) this.flash.visible = false;
    }
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.t += dt;
      b.obj.visible = b.t >= 0;
      const k = Math.max(0, b.t) / b.life;
      // flicker: bright, dim, bright, then fade out
      b.obj.material.opacity = Math.max(0, 1 - k) * (Math.sin(b.t * 70) > -0.3 ? 1 : 0.35);
      if (k >= 1) {
        this.root.remove(b.obj);
        b.obj.geometry.dispose();
        b.obj.material.dispose();
        this.bolts.splice(i, 1);
      }
    }
    this.writeLayers();
    return arrived;
  }

  /** Copy the live coins, sparks, shards and bullets into their instanced layers. */
  writeLayers() {
    const view = this.view;
    let n = 0;
    for (const c of this.coins) {
      if (c.t < 0) continue; // not thrown yet
      this.coinLayer.setMatrixAt(n++, _m.compose(c.pos, view, _s.set(c.sx, 0.75, 1)));
    }
    this.finish(this.coinLayer, n, false);

    n = 0;
    for (const s of this.sparks) {
      const fade = Math.max(0, 1 - s.t / s.life);
      this.sparkLayer.setMatrixAt(n, _m.compose(s.pos, view, _s.setScalar(s.size)));
      this.sparkLayer.setColorAt(n++, _c.copy(s.col).multiplyScalar(fade));
    }
    this.finish(this.sparkLayer, n, true);

    n = 0;
    for (const s of this.shards) {
      const k = s.t / s.life;
      const size = s.size * (k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3);
      this.shardLayer.setMatrixAt(n, _m.compose(s.pos, _q.setFromEuler(s.rot), _s.setScalar(Math.max(0.001, size))));
      this.shardLayer.setColorAt(n++, s.col);
    }
    this.finish(this.shardLayer, n, true);

    n = 0;
    for (const b of this.bullets) {
      _q.setFromAxisAngle(UP, Math.atan2(b.dir.x, b.dir.z));
      this.coreLayer.setMatrixAt(n, _m.compose(b.pos, _q, _s.setScalar(b.size)));
      this.coreLayer.setColorAt(n, _c.copy(b.col).multiplyScalar(1.5));
      this.haloLayer.setMatrixAt(n, _m.compose(b.pos, view, _s.setScalar(1.3 * b.size)));
      this.haloLayer.setColorAt(n++, _c.copy(b.col).multiplyScalar(0.6));
    }
    this.finish(this.coreLayer, n, true);
    this.finish(this.haloLayer, n, true);
  }

  finish(l, n, colors) {
    l.count = n;
    l.visible = n > 0;
    if (!n) return;
    l.instanceMatrix.needsUpdate = true;
    if (colors) l.instanceColor.needsUpdate = true;
  }
}
