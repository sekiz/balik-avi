/** The aquarium: sandy seabed with moving caustics, rocks, corals, swaying kelp, light shafts, bubbles. */
import * as THREE from "three";
import { bakeTexture, makeRng, standardMaterial } from "../materials.js";
import { swimTime } from "./fishmodels.js";

function tag(o, t) {
  o.userData.tag = t;
  return o;
}

/** Add animated caustics (light network) to a lit material's diffuse. */
function caustics(material, strength = 0.55) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, r) => {
    prev?.(shader, r);
    shader.uniforms.uTime = swimTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWorldC;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvWorldC = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vWorldC;
        uniform float uTime;
        float causticLayer(vec2 p, float t) {
          vec2 i = p;
          float c = 1.0;
          float inten = 0.005;
          for (int n = 0; n < 4; n++) {
            float tt = t * (1.0 - (3.5 / float(n + 1)));
            i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
            c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
          }
          c /= 4.0;
          c = 1.17 - pow(c, 1.4);
          return pow(abs(c), 8.0);
        }`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        float cst = causticLayer(mod(vWorldC.xz * 0.35, 6.2831) , uTime * 0.35 + 23.0);
        totalEmissiveRadiance += vec3(0.55, 0.85, 1.0) * clamp(cst, 0.0, 1.2) * ${strength.toFixed(2)} * diffuseColor.rgb;`,
      );
  };
  material.customProgramCacheKey = () => `caustic${strength}`;
  return material;
}

function seaweedTexture() {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 256;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 256, 0, 0);
  grad.addColorStop(0, "#1f4d1a");
  grad.addColorStop(1, "#5fae3a");
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(26, 256);
  for (let y = 256; y >= 0; y -= 16) g.lineTo(32 + Math.sin(y * 0.08) * 6 - 12 * (y / 256), y);
  for (let y = 0; y <= 256; y += 16) g.lineTo(32 + Math.sin(y * 0.08) * 6 + 14 * (y / 256) + 6, y);
  g.fill();
  g.strokeStyle = "rgba(200,255,150,0.35)";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(32, 256);
  g.lineTo(32, 0);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function shaftTexture() {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 256;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 64, 0);
  grad.addColorStop(0, "rgba(255,255,255,0)");
  grad.addColorStop(0.5, "rgba(255,255,255,1)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 256);
  const fade = g.createLinearGradient(0, 0, 0, 256);
  fade.addColorStop(0, "rgba(255,255,255,1)");
  fade.addColorStop(1, "rgba(255,255,255,0)");
  g.globalCompositeOperation = "destination-in";
  g.fillStyle = fade;
  g.fillRect(0, 0, 64, 256);
  return new THREE.CanvasTexture(c);
}

export function bubbleTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 10, 32, 32, 30);
  grad.addColorStop(0, "rgba(255,255,255,0.05)");
  grad.addColorStop(0.8, "rgba(200,240,255,0.35)");
  grad.addColorStop(1, "rgba(255,255,255,0.9)");
  g.fillStyle = grad;
  g.beginPath();
  g.arc(32, 32, 30, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "rgba(255,255,255,0.9)";
  g.beginPath();
  g.arc(22, 22, 6, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Kelp sway: bend increasing with height. */
function sway(material) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = swimTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        float hgt = clamp(position.y / 4.0, 0.0, 1.0);
        float ph = modelMatrix[3].x * 0.7 + modelMatrix[3].z * 0.4;
        transformed.x += sin(uTime * 1.3 + ph + position.y * 0.9) * 0.45 * hgt * hgt;
        transformed.z += cos(uTime * 1.1 + ph) * 0.25 * hgt * hgt;`,
      );
  };
  material.customProgramCacheKey = () => "kelp";
  return material;
}

export function buildWorld(scene) {
  const rng = makeRng(4242);
  scene.background = new THREE.Color(0x0a3a5a);
  scene.fog = new THREE.Fog(0x0b5878, 16, 46);

  const hemi = new THREE.HemisphereLight(0x9fe6ff, 0x0d2a3a, 1.0);
  hemi.userData.tag = "light-fill";
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2d6, 1.7);
  sun.position.set(6, 30, 8);
  sun.userData.tag = "light-key";
  scene.add(sun);

  const root = tag(new THREE.Group(), "seabed");
  scene.add(root);

  // sand
  const sandMat = caustics(
    standardMaterial({ kind: "dirt", seed: 11, palette: [0x9a9270, 0xb5a983, 0x7d7a60], repeat: 6, bumpScale: 0.8 }),
    0.7,
  );
  const sandGeo = new THREE.PlaneGeometry(80, 60, 80, 60);
  sandGeo.rotateX(-Math.PI / 2);
  const sp = sandGeo.attributes.position;
  for (let i = 0; i < sp.count; i++) {
    const x = sp.getX(i);
    const z = sp.getZ(i);
    sp.setY(i, Math.sin(x * 0.35) * 0.18 + Math.cos(z * 0.5 + x * 0.1) * 0.22 + Math.max(0, Math.abs(x) - 14) * 0.25);
  }
  sandGeo.computeVertexNormals();
  const sand = tag(new THREE.Mesh(sandGeo, sandMat), "ground");
  root.add(sand);

  // rocks
  const rockMat = caustics(standardMaterial({ kind: "stone", seed: 5, palette: [0x4d5a5e, 0x6f7c78, 0x8a9488], repeat: 2 }), 0.5);
  const mossMat = caustics(standardMaterial({ kind: "moss", seed: 8, palette: [0x2f5a3a, 0x4d7a45, 0x6a9a50], repeat: 2 }), 0.5);
  const rocks = tag(new THREE.Group(), "rock");
  root.add(rocks);
  const rockSpots = [
    [-15, -8, 2.2], [-12.5, -9.5, 1.4], [14.5, -7.5, 2.6], [16.5, -4, 1.6], [-16.5, 1, 1.8], [16, 4, 2.0],
    [-14, 7.5, 1.6], [13, 8.5, 1.3], [-5, -10.5, 1.5], [6.5, -10.8, 1.9], [0.5, -11.5, 1.2],
  ];
  for (const [x, z, s] of rockSpots) {
    const geo = new THREE.SphereGeometry(1, 20, 14);
    const p = geo.attributes.position;
    const k1 = rng() * 10;
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, i);
      const n = 0.8 + 0.18 * Math.sin(v.x * 2.3 + k1) * Math.cos(v.z * 2.1 - k1) + 0.1 * Math.sin(v.y * 4.1 + v.x * 3.3);
      v.multiplyScalar(n);
      v.y *= 0.6;
      p.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    const rock = new THREE.Mesh(geo, rng() < 0.4 ? mossMat : rockMat);
    rock.position.set(x, s * 0.25, z);
    rock.scale.setScalar(s);
    rock.rotation.y = rng() * 6;
    rocks.add(rock);
  }

  // corals: branching tubes and fan discs, around the edges
  const coralCols = [
    [0xff6f91, 0xff9eb5, 0xd9476e],
    [0xff9a3c, 0xffc07a, 0xd9711a],
    [0xb486ff, 0xd2b5ff, 0x8a5ad9],
    [0x3fd9c4, 0x8af0e0, 0x1fa894],
  ];
  const coralMats = coralCols.map((pal, i) => caustics(standardMaterial({ kind: "chitin", seed: 20 + i, palette: pal, repeat: 1 }), 0.35));
  const corals = tag(new THREE.Group(), "coral");
  root.add(corals);
  function branch(parent, start, dir, len, rad, depth, mat) {
    const end = start.clone().addScaledVector(dir, len);
    const mid = start.clone().lerp(end, 0.5).add(new THREE.Vector3((rng() - 0.5) * 0.3, 0, (rng() - 0.5) * 0.3));
    const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
    parent.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 6, rad, 7), mat));
    const tip = new THREE.Mesh(new THREE.SphereGeometry(rad * 1.15, 8, 6), mat);
    tip.position.copy(end);
    parent.add(tip);
    if (depth <= 0) return;
    const n = 2 + Math.floor(rng() * 2);
    for (let i = 0; i < n; i++) {
      const d = dir.clone().add(new THREE.Vector3((rng() - 0.5) * 1.3, 0.35, (rng() - 0.5) * 1.3)).normalize();
      branch(parent, end, d, len * 0.72, rad * 0.7, depth - 1, mat);
    }
  }
  const coralSpots = [
    [-13.5, -6, 0], [-16, -2.5, 1], [-11.5, -10, 2], [12.5, -9.5, 3], [15, -1, 0], [17, 6.5, 2],
    [-17, 5, 3], [-11.5, 9.5, 1], [10.5, 10.5, 0], [-2.5, -11, 1], [3.5, -11.5, 2], [-8, -11, 3],
  ];
  for (const [x, z, m] of coralSpots) {
    const g = new THREE.Group();
    branch(g, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0), 1.0 + rng() * 0.6, 0.14, 2, coralMats[m]);
    g.position.set(x, 0.1, z);
    g.scale.setScalar(1 + rng() * 0.6);
    corals.add(g);
  }
  // fan corals
  for (const [x, z, m] of [[-15, -10, 0], [14, -11, 2], [17.5, 1.5, 1], [-17.5, -6.5, 2]]) {
    const geo = new THREE.CircleGeometry(1.6, 24, 0, Math.PI);
    const fan = new THREE.Mesh(geo, coralMats[m].clone());
    fan.material.side = THREE.DoubleSide;
    fan.position.set(x, 0.1, z);
    fan.rotation.y = rng() * 3;
    corals.add(fan);
  }

  // kelp
  const kelpMat = sway(
    new THREE.MeshStandardMaterial({ map: seaweedTexture(), transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.8 }),
  );
  const kelp = tag(new THREE.Group(), "kelp");
  root.add(kelp);
  const kelpGeo = new THREE.PlaneGeometry(0.9, 5, 1, 10);
  kelpGeo.translate(0, 2.5, 0);
  for (let i = 0; i < 34; i++) {
    const side = i % 2 ? 1 : -1;
    const x = side * (13 + rng() * 6);
    const z = -11 + rng() * 22;
    for (let k = 0; k < 2; k++) {
      const blade = new THREE.Mesh(kelpGeo, kelpMat);
      blade.position.set(x + (rng() - 0.5) * 0.6, 0, z + (rng() - 0.5) * 0.6);
      blade.rotation.y = rng() * Math.PI;
      blade.scale.y = 0.6 + rng() * 0.7;
      kelp.add(blade);
    }
  }
  for (let i = 0; i < 10; i++) {
    const blade = new THREE.Mesh(kelpGeo, kelpMat);
    blade.position.set(-12 + rng() * 24, 0, -12 - rng() * 2);
    blade.rotation.y = rng() * Math.PI;
    blade.scale.y = 0.7 + rng() * 0.6;
    kelp.add(blade);
  }

  // light shafts
  const shaftMat = new THREE.MeshBasicMaterial({
    map: shaftTexture(),
    transparent: true,
    opacity: 0.09,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    color: 0xc8f0ff,
  });
  const shafts = tag(new THREE.Group(), "lightshaft");
  scene.add(shafts);
  for (let i = 0; i < 7; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.5 + rng() * 2.5, 26), shaftMat);
    m.position.set(-14 + i * 4.6 + rng(), 10, -6 + rng() * 6);
    m.rotation.set(-0.6, 0, 0.35);
    m.userData.phase = rng() * 6;
    shafts.add(m);
  }

  // ambient bubbles
  const bubbleMat = new THREE.SpriteMaterial({ map: bubbleTexture(), transparent: true, depthWrite: false, opacity: 0.8 });
  const bubbles = tag(new THREE.Group(), "bubble");
  scene.add(bubbles);
  for (let i = 0; i < 36; i++) {
    const b = new THREE.Sprite(bubbleMat);
    const s = 0.1 + rng() * 0.22;
    b.scale.set(s, s, s);
    b.position.set(-18 + rng() * 36, rng() * 10, -11 + rng() * 22);
    b.userData.speed = 0.6 + rng() * 1.1;
    b.userData.phase = rng() * 6;
    bubbles.add(b);
  }

  return {
    update(dt, t) {
      for (const s of shafts.children) {
        s.material.opacity = 0.09;
        s.position.x += Math.sin(t * 0.2 + s.userData.phase) * dt * 0.15;
      }
      for (const b of bubbles.children) {
        b.position.y += b.userData.speed * dt;
        b.position.x += Math.sin(t * 2 + b.userData.phase) * dt * 0.2;
        if (b.position.y > 12) b.position.y = 0;
      }
    },
  };
}
