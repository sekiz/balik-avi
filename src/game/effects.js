/** Bullets, capture nets, hit sparks, coin bursts flying home, floating payout numbers. */
import * as THREE from "three";
import { betColor } from "./cannon.js";

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
  g.font = "bold 28px sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("₺", 32, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.userData.tag = "fx";
    scene.add(this.root);
    this.glowTex = radial([[0, "rgba(255,255,255,1)"], [0.25, "rgba(255,255,255,0.8)"], [1, "rgba(255,255,255,0)"]]);
    this.netTex = netTexture();
    this.coinTex = coinTexture();
    this.coinMat = new THREE.SpriteMaterial({ map: this.coinTex, transparent: true, depthWrite: false });
    this.bullets = [];
    this.nets = [];
    this.coins = [];
    this.popups = [];
    this.sparks = [];
    this.bulletGeo = new THREE.CapsuleGeometry(0.16, 0.55, 4, 10);
    this.bulletGeo.rotateX(Math.PI / 2);
    this.bulletTag = new THREE.Group();
    this.bulletTag.userData.tag = "bullet";
    this.root.add(this.bulletTag);
  }

  clear() {
    for (const list of [this.bullets, this.nets, this.coins, this.popups, this.sparks]) {
      for (const o of list) o.obj.parent?.remove(o.obj);
      list.length = 0;
    }
  }

  addBullet(shotId, bet, pos, dir) {
    const col = new THREE.Color(betColor(bet));
    const g = new THREE.Group();
    const core = new THREE.Mesh(this.bulletGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: col, emissiveIntensity: 2.2, map: this.glowTex }));
    const s = 0.85 + Math.log2(bet + 1) * 0.25;
    core.scale.setScalar(s);
    g.add(core);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: col, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.scale.setScalar(1.6 * s);
    g.add(halo);
    g.position.copy(pos);
    this.bulletTag.add(g);
    const b = { shotId, bet, obj: g, pos: g.position, dir: dir.clone(), speed: 24, age: 0, bounces: 0, col };
    this.bullets.push(b);
    return b;
  }

  removeBullet(b) {
    this.bulletTag.remove(b.obj);
    const i = this.bullets.indexOf(b);
    if (i >= 0) this.bullets.splice(i, 1);
  }

  net(pos, bet) {
    const col = new THREE.Color(betColor(bet));
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: this.netTex, color: col, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.copy(pos);
    m.position.y += 0.6;
    this.root.add(m);
    this.nets.push({ obj: m, t: 0, size: 2.2 + Math.log2(bet + 1) * 0.9 });
    for (let i = 0; i < 8; i++) this.spark(pos, col, 4 + (i % 3));
  }

  spark(pos, col, speed) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: col, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.position.copy(pos);
    s.scale.setScalar(0.4);
    this.root.add(s);
    const a = this.sparks.length * 2.399;
    this.sparks.push({ obj: s, t: 0, v: new THREE.Vector3(Math.cos(a) * speed, 2 + (a % 1) * 3, Math.sin(a) * speed) });
  }

  /** Coin burst at `pos` that flies to `home`. */
  coinBurst(pos, n, home, rng) {
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(this.coinMat);
      s.scale.setScalar(0.75);
      s.position.copy(pos);
      this.root.add(s);
      const a = rng() * Math.PI * 2;
      const r = 2 + rng() * 4 + Math.sqrt(n) * 0.3;
      this.coins.push({
        obj: s,
        t: -i * 0.025,
        from: pos.clone(),
        burst: pos.clone().add(new THREE.Vector3(Math.cos(a) * r, 2 + rng() * 2.5, Math.sin(a) * r * 0.7)),
        home: home.clone(),
        spin: rng() * 6,
      });
    }
  }

  popup(pos, text, color = "#ffe066", big = false) {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 96;
    const g = c.getContext("2d");
    g.font = `900 ${big ? 72 : 60}px ui-rounded, system-ui, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 10;
    g.strokeStyle = "#3a1a00";
    g.strokeText(text, 128, 50);
    g.fillStyle = color;
    g.fillText(text, 128, 50);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
    const w = big ? 7 : 3.4;
    s.scale.set(w, w * 0.375, 1);
    s.position.copy(pos);
    s.position.y += 2;
    s.renderOrder = 10;
    s.userData.tag = "popup";
    this.root.add(s);
    this.popups.push({ obj: s, t: 0, life: big ? 2.4 : 1.2 });
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
      b.obj.rotation.y = Math.atan2(b.dir.x, b.dir.z);
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
        n.obj.material.dispose();
        n.obj.geometry.dispose();
        this.nets.splice(i, 1);
      }
    }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.t += dt;
      s.obj.position.addScaledVector(s.v, dt);
      s.v.multiplyScalar(0.9);
      s.obj.material.opacity = Math.max(0, 1 - s.t / 0.4);
      if (s.t > 0.4) {
        this.root.remove(s.obj);
        s.obj.material.dispose();
        this.sparks.splice(i, 1);
      }
    }
    let arrived = 0;
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const c = this.coins[i];
      c.t += dt;
      const t = Math.max(0, c.t);
      if (t < 0.45) {
        const k = 1 - (1 - t / 0.45) ** 3;
        c.obj.position.lerpVectors(c.from, c.burst, k);
      } else {
        const k = Math.min(1, (t - 0.45) / 0.5);
        c.obj.position.lerpVectors(c.burst, c.home, k * k);
        if (k >= 1) {
          this.root.remove(c.obj);
          this.coins.splice(i, 1);
          arrived++;
          continue;
        }
      }
      const sx = Math.abs(Math.cos(c.t * 9 + c.spin)) * 0.75 + 0.08;
      c.obj.scale.set(sx, 0.75, 1);
    }
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.t += dt;
      p.obj.position.y += dt * 1.2;
      const pop = Math.min(1, p.t * 6);
      p.obj.material.opacity = Math.min(1, (p.life - p.t) * 3);
      p.obj.material.rotation = 0;
      const base = p.obj.userData.w ?? (p.obj.userData.w = p.obj.scale.x);
      const sc = base * (0.6 + 0.4 * pop + (pop < 1 ? 0.2 * Math.sin(pop * Math.PI) : 0));
      p.obj.scale.set(sc, sc * 0.375, 1);
      if (p.t > p.life) {
        this.root.remove(p.obj);
        p.obj.material.map.dispose();
        p.obj.material.dispose();
        this.popups.splice(i, 1);
      }
    }
    return arrived;
  }
}
