/**
 * Post stack: world → bloom (only bright/emissive: bullets, coins, gems, caustic highlights)
 * → underwater grade (gentle refraction wobble, deep-blue shadows, saturation, vignette) → output.
 */
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAspect: { value: 16 / 9 },
    uWobble: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uAspect;
    uniform float uWobble;
    varying vec2 vUv;
    void main() {
      vec2 uv = vUv;
      // underwater refraction: two slow crossing waves, a fraction of a pixel to a couple of pixels
      uv.x += sin(uv.y * 18.0 + uTime * 1.3) * 0.0012 * uWobble;
      uv.y += cos(uv.x * 14.0 + uTime * 1.1) * 0.0012 * uWobble;
      vec3 c = texture2D(tDiffuse, uv).rgb;
      // grade (linear HDR space, before tone mapping): cool shadows, warm highlights kept
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      // toward the menu art's bright turquoise shallows (the earlier deep-navy grade made play
      // look like a different game from its own menus)
      c = mix(vec3(l), c, 1.3);                        // saturation
      c *= vec3(0.86, 1.02, 1.08) * 1.1;               // red absorbed, but shallow and bright
      c = mix(c, vec3(0.03, 0.40, 0.52), 0.11);        // a turquoise veil of water (not navy)
      c += vec3(0.0, 0.01, 0.03) * (1.0 - smoothstep(0.0, 0.4, l));
      // a soft vignette that starts late: fish enter from the edges, so the edges stay readable
      vec2 d = (vUv - 0.5) * vec2(uAspect, 1.0);
      float v = smoothstep(0.5, 1.15, length(d));
      c = mix(c, c * vec3(0.25, 0.45, 0.7), v * 0.6);
      gl_FragColor = vec4(c, 1.0);
    }`,
};

/**
 * `low` is the phone tier: a 2× MSAA target instead of 4×, half-size bloom, no refraction wobble.
 * If the composer cannot be built (no float render targets) the scene is drawn straight.
 */
export function createPost(renderer, scene, camera, { low = false } = {}) {
  try {
    return buildPost(renderer, scene, camera, low);
  } catch (err) {
    console.warn("[post] composer unavailable, rendering without post-processing", err);
    const stats = { calls: 0, triangles: 0 };
    return {
      composer: null,
      stats,
      bloom: null,
      grade: null,
      setSize() {},
      render() {
        renderer.render(scene, camera);
        stats.calls = renderer.info.render.calls;
        stats.triangles = renderer.info.render.triangles;
      },
    };
  }
}

function buildPost(renderer, scene, camera, low) {
  // the composer's own target carries the MSAA — the canvas's antialias flag does not reach it
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: low ? 2 : 4 });
  const composer = new EffectComposer(renderer, target);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  const bloom = new UnrealBloomPass(new THREE.Vector2(low ? 128 : 256, low ? 128 : 256), 0.5, 0.45, 0.92);
  if (low) {
    // the pass sizes itself from the composer (half of it) on every resize, which overrode the
    // constructor's small resolution: on phones bloom ran at full half-res. Quarter-res here.
    const sizeBloom = bloom.setSize.bind(bloom);
    bloom.setSize = (w, h) => sizeBloom(Math.max(2, Math.round(w / 2)), Math.max(2, Math.round(h / 2)));
  }
  composer.addPass(bloom);
  const grade = new ShaderPass(GradeShader);
  if (low) grade.uniforms.uWobble.value = 0;
  composer.addPass(grade);
  composer.addPass(new OutputPass());
  // capture the world draw's counters before the post passes reset them
  const stats = { calls: 0, triangles: 0 };
  const origRender = renderPass.render.bind(renderPass);
  renderPass.render = (...args) => {
    origRender(...args);
    stats.calls = renderer.info.render.calls;
    stats.triangles = renderer.info.render.triangles;
  };
  return {
    composer,
    stats,
    bloom,
    grade,
    setSize(w, h) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(w, h);
      grade.uniforms.uAspect.value = w / h;
    },
    render(time) {
      grade.uniforms.uTime.value = time;
      composer.render();
    },
  };
}
