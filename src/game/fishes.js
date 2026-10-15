/** Fish runtime: entering, swimming (straight / zig-zag / slow curve / boss S), dying, leaving. */
import * as THREE from "three";
import { speciesById } from "../economy/config.js";
import { buildDragonHead, buildDragonSegment, buildFish, newFlash } from "./fishmodels.js";

/** Body length in world units per species. */
export const LENGTH = {
  clown: 1.7, tang: 1.8, yellow: 1.7, neon: 1.5,
  angel: 2.6, puffer: 2.3, parrot: 2.9, lion: 2.8,
  turtle: 4.6, manta: 5.8, shark: 6.6,
  goldshark: 9.0, dragon: 2.4,
};

const DEPTH = { small: 3.4, medium: 3.1, large: 2.6, boss: 2.1 };
const DRAGON_SEGMENTS = 13;
const DRAGON_SPACING = 1.2;

export class FishSchool {
  constructor(scene, bounds) {
    this.scene = scene;
    this.bounds = bounds;
    this.root = new THREE.Group();
    this.root.userData.tag = "fish";
    scene.add(this.root);
    this.list = [];
    this.speedScale = 1;
    this.onLeave = null;
  }

  clear() {
    for (let i = this.list.length - 1; i >= 0; i--) this.remove(i);
  }

  alive() {
    return this.list.filter((f) => !f.dying).length;
  }

  /** @param {{fishId:number, species:string, school?:number, schoolIndex?:number}} entry */
  spawn(entry, rng, opts = {}) {
    const sp = speciesById(entry.species);
    const L = LENGTH[sp.id];
    let group;
    let segments = null;
    let flash;
    if (sp.id === "dragon") {
      flash = newFlash();
      group = new THREE.Group();
      const head = buildDragonHead(flash);
      head.scale.setScalar(L / 2 * 1.7);
      group.add(head);
      segments = [];
      for (let i = 0; i < DRAGON_SEGMENTS; i++) {
        const seg = buildDragonSegment(flash, i === DRAGON_SEGMENTS - 1);
        const taper = 1 - (i / DRAGON_SEGMENTS) * 0.55;
        seg.scale.setScalar(1.6 * taper);
        seg.userData.r = 0.65 * taper;
        this.root.add(seg);
        segments.push(seg);
      }
    } else {
      group = buildFish(sp.id);
      flash = group.userData.flash;
      group.scale.setScalar(L / 2);
    }
    group.userData.tag = sp.tier === "boss" ? "boss" : "fish";
    group.userData.species = sp.id;
    this.root.add(group);

    // path
    const b = this.bounds;
    const y = DEPTH[sp.tier] + (rng() - 0.5) * 0.3;
    const fromLeft = rng() < 0.5;
    let pos;
    let target;
    const margin = L * 0.8 + 1.5;
    if (sp.tier === "boss") {
      const z = b.zTop + (b.zBottom - b.zTop) * (0.3 + rng() * 0.25);
      pos = new THREE.Vector3(fromLeft ? -b.halfW(z) - margin - 2 : b.halfW(z) + margin + 2, y, z);
      target = new THREE.Vector3(-pos.x, y, z + (rng() - 0.5) * 3);
    } else if (rng() < 0.78) {
      const z = b.zTop + (b.zBottom - b.zTop) * (0.08 + rng() * 0.72);
      pos = new THREE.Vector3(fromLeft ? -b.halfW(z) - margin : b.halfW(z) + margin, y, z);
      const tz = b.zTop + (b.zBottom - b.zTop) * (0.08 + rng() * 0.72);
      target = new THREE.Vector3(fromLeft ? b.halfW(tz) + margin : -b.halfW(tz) - margin, y, tz);
    } else {
      // from the far (top) edge, diagonally down-across
      const x = (rng() - 0.5) * 2 * b.halfW(b.zTop) * 0.8;
      pos = new THREE.Vector3(x, y, b.zTop - margin);
      target = new THREE.Vector3(-x * 0.8 + (rng() - 0.5) * 6, y, b.zBottom + margin);
    }
    if (opts.school) {
      const leader = opts.school;
      pos.copy(leader.base).addScaledVector(leader.side, ((entry.schoolIndex % 3) - 1) * 0.9);
      pos.addScaledVector(leader.dir, -Math.floor(entry.schoolIndex / 3) * 1.3 - rng() * 0.4);
      target = pos.clone().addScaledVector(leader.dir, 100);
    }
    const dir = target.clone().sub(pos).setY(0).normalize();
    const behavior = sp.tier === "small" ? "straight" : sp.tier === "medium" ? "zigzag" : sp.tier === "large" ? "curve" : "boss";
    const fish = {
      fishId: entry.fishId,
      sp,
      group,
      segments,
      trail: segments ? [] : null,
      flash,
      base: pos.clone(),
      pos: pos.clone(),
      prev: pos.clone(),
      dir,
      side: new THREE.Vector3(-dir.z, 0, dir.x),
      speed: sp.speed * (0.9 + rng() * 0.2),
      behavior,
      t: 0,
      phase: rng() * 6.28,
      turn: (rng() - 0.5) * 0.12,
      entered: false,
      dying: 0,
      hitGlow: 0,
      L,
      school: entry.school ?? null,
    };
    group.position.copy(pos);
    group.rotation.y = Math.atan2(-dir.z, dir.x);
    if (segments) {
      for (let i = 0; i < 260; i++) fish.trail.push(pos.clone().addScaledVector(dir, -i * 0.12));
      this.placeSegments(fish);
    }
    this.list.push(fish);
    return fish;
  }

  placeSegments(f) {
    // walk back along the trail by DRAGON_SPACING per segment
    let idx = 0;
    let acc = 0;
    const tr = f.trail;
    let last = tr[0];
    for (let s = 0; s < f.segments.length; s++) {
      const want = (s + 1) * DRAGON_SPACING + 0.6;
      while (idx < tr.length - 1 && acc < want) {
        acc += tr[idx].distanceTo(tr[idx + 1]);
        idx++;
      }
      const seg = f.segments[s];
      const p = tr[Math.min(idx, tr.length - 1)];
      seg.position.copy(p);
      seg.position.y = p.y + Math.sin(f.t * 3 - s * 0.6) * 0.15;
      const look = s === 0 ? f.pos : f.segments[s - 1].position;
      seg.rotation.y = Math.atan2(-(look.z - p.z), look.x - p.x);
      last = p;
    }
    return last;
  }

  /** Hit circles in world space: [{x, z, r}] */
  circles(f) {
    const out = [];
    const c = Math.cos(-f.group.rotation.y);
    const s = Math.sin(-f.group.rotation.y);
    const at = (along, r) => out.push({ x: f.pos.x + c * along, z: f.pos.z + s * along, r });
    switch (f.sp.id) {
      case "manta":
        at(0.1 * f.L, f.L * 0.42);
        break;
      case "turtle":
        at(0, f.L * 0.38);
        break;
      case "dragon":
        at(0.5, 1.4);
        for (const seg of f.segments) out.push({ x: seg.position.x, z: seg.position.z, r: seg.userData.r * 1.6 });
        break;
      case "puffer":
        at(0, f.L * 0.42);
        break;
      default:
        at(f.L * 0.22, f.L * 0.24);
        at(-f.L * 0.18, f.L * 0.2);
    }
    return out;
  }

  hitFlash(f) {
    f.hitGlow = 1;
  }

  kill(f) {
    f.dying = 0.0001;
  }

  update(dt, time) {
    const b = this.bounds;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i];
      f.t += dt;
      if (f.hitGlow > 0) f.hitGlow = Math.max(0, f.hitGlow - dt * 5);
      if (f.dying) {
        f.dying += dt;
        const k = f.dying / (f.sp.tier === "boss" ? 1.8 : 1.0);
        f.group.rotation.x = Math.sin(f.dying * 18) * 0.5;
        f.group.rotation.z = f.dying * 6;
        const s = (f.L / 2) * (f.sp.id === "dragon" ? 1.7 : 1) * Math.max(0, 1 - k * k);
        f.group.scale.setScalar(Math.max(0.0001, s));
        f.flash.value.setRGB(1.2 * (1 - k), 0.9 * (1 - k), 0.2);
        if (f.segments) {
          f.segments.forEach((seg, si) => {
            seg.scale.setScalar(Math.max(0.0001, 1.6 * (1 - (si / DRAGON_SEGMENTS) * 0.55) * Math.max(0, 1 - k * 1.2 + si * 0.02)));
            seg.rotation.z = f.dying * 5;
          });
        }
        if (k >= 1) this.remove(i);
        continue;
      }
      f.flash.value.setRGB(f.hitGlow * 0.9, f.hitGlow * 0.15, f.hitGlow * 0.1);
      const v = f.speed * this.speedScale;
      if (f.behavior === "curve") f.dir.applyAxisAngle(THREE.Object3D.DEFAULT_UP, f.turn * dt);
      if (f.behavior === "boss") f.dir.applyAxisAngle(THREE.Object3D.DEFAULT_UP, Math.sin(f.t * 0.35 + f.phase) * 0.12 * dt);
      f.side.set(-f.dir.z, 0, f.dir.x);
      f.base.addScaledVector(f.dir, v * dt);
      f.prev.copy(f.pos);
      f.pos.copy(f.base);
      if (f.behavior === "zigzag") f.pos.addScaledVector(f.side, Math.sin(f.t * 1.6 + f.phase) * 1.4);
      if (f.behavior === "boss") {
        f.pos.y = f.base.y + Math.sin(f.t * 0.8) * 0.3;
        if (f.segments) f.pos.addScaledVector(f.side, Math.sin(f.t * 1.1 + f.phase) * 2.2);
      }
      f.group.position.copy(f.pos);
      const dx = f.pos.x - f.prev.x;
      const dz = f.pos.z - f.prev.z;
      if (dx * dx + dz * dz > 1e-8) {
        const want = Math.atan2(-dz, dx);
        let d = want - f.group.rotation.y;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        f.group.rotation.y += d * Math.min(1, dt * 8);
      }
      if (f.puffT !== undefined || f.sp.id === "puffer") {
        const puff = 1 + Math.max(0, Math.sin(f.t * 0.9 + f.phase)) * 0.18;
        f.group.scale.set((f.L / 2) * puff, (f.L / 2) * puff, (f.L / 2) * puff);
      }
      if (f.trail) {
        f.trail.unshift(f.pos.clone());
        if (f.trail.length > 300) f.trail.pop();
        this.placeSegments(f);
      }
      const inside = Math.abs(f.pos.x) < b.halfW(f.pos.z) && f.pos.z > b.zTop && f.pos.z < b.zBottom;
      if (inside) f.entered = true;
      const far = f.segments ? 22 : f.L + 3;
      const out = Math.abs(f.pos.x) > b.halfW(f.pos.z) + far || f.pos.z < b.zTop - far || f.pos.z > b.zBottom + far;
      if ((f.entered && out) || f.t > 120) {
        this.onLeave?.(f);
        this.remove(i);
      }
    }
  }

  remove(i) {
    const f = this.list[i];
    this.root.remove(f.group);
    if (f.segments) for (const s of f.segments) this.root.remove(s);
    this.list.splice(i, 1);
  }
}
