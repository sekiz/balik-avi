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
      c = mix(vec3(l), c, 1.3);                        // saturation
      c *= vec3(0.84, 0.95, 1.04);                     // red absorbed by the water column
      c = mix(c, vec3(0.02, 0.16, 0.30), 0.16);        // the water itself between eye and sand
      c += vec3(0.0, 0.01, 0.03) * (1.0 - smoothstep(0.0, 0.4, l));
      // vignette toward deep blue
      vec2 d = (vUv - 0.5) * vec2(uAspect, 1.0);
      float v = smoothstep(0.38, 1.05, length(d));
      c = mix(c, c * vec3(0.08, 0.2, 0.42), v * 0.92);
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export function createPost(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.45, 0.92);
  composer.addPass(bloom);
  const grade = new ShaderPass(GradeShader);
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
