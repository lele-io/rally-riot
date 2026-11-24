import * as THREE from "three";
import { getModel } from "./assets.js";

// Golden-hour sky world shared by the match and the title screen:
// gradient sky dome + sun glow, painted cloud sprites (a sea of clouds below the island),
// layered silhouette backdrop, drifting light motes and falling petals, warm key + cool fill light.
export const PALETTE = { top: "#3f78c4", mid: "#8fb8e2", horizon: "#ffcfa3", below: "#b49cc8", sun: "#fff1d0", fog: "#efc9ad" };

export function buildEnv(scene, { shadowSize = 16, sunDir = new THREE.Vector3(-0.55, 0.42, 0.72) } = {}) {
  scene.background = new THREE.Color(PALETTE.horizon);
  scene.fog = new THREE.Fog(PALETTE.fog, 70, 460);
  const objs = [];
  const add = (o) => { scene.add(o); objs.push(o); return o; };

  // sky dome
  const sky = add(new THREE.Mesh(new THREE.SphereGeometry(480, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color(PALETTE.top) }, mid: { value: new THREE.Color(PALETTE.mid) },
      hor: { value: new THREE.Color(PALETTE.horizon) }, below: { value: new THREE.Color(PALETTE.below) },
      sun: { value: new THREE.Color(PALETTE.sun) }, sunDir: { value: sunDir.clone().normalize() },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top, mid, hor, below, sun, sunDir; varying vec3 vDir;
      void main(){
        float y = vDir.y;
        vec3 c = y > 0.0 ? mix(hor, mid, smoothstep(0.0, 0.22, y)) : mix(hor, below, smoothstep(0.0, 0.25, -y));
        c = y > 0.22 ? mix(mid, top, smoothstep(0.22, 0.75, y)) : c;
        float s = max(dot(vDir, sunDir), 0.0);
        c += sun * (pow(s, 900.0) * 1.0 + pow(s, 40.0) * 0.25);
        // soft painterly banding
        c = floor(c * 24.0 + 0.5) / 24.0;
        gl_FragColor = vec4(c, 1.0);
      }`,
  })));
  sky.renderOrder = -10;

  add(getModel("backdrop"));

  // clouds: billboard sprites with a hand-painted look
  const tex = cloudTexture();
  const rnd = mulberry(7);
  for (let i = 0; i < 26; i++) { // around the horizon
    const a = rnd() * Math.PI * 2, r = 230 + rnd() * 120, sc = 34 + rnd() * 40;
    const s = add(new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, opacity: 0.85, color: "#f4d9d2" })));
    s.position.set(Math.cos(a) * r, 4 + rnd() * 30, Math.sin(a) * r); s.scale.set(sc * 1.9, sc, 1);
  }
  for (let i = 0; i < 34; i++) { // the sea of clouds the island floats over
    const a = rnd() * Math.PI * 2, r = 20 + rnd() * 150, sc = 26 + rnd() * 30;
    const s = add(new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: true, color: "#eed6e2", opacity: 0.9 })));
    s.position.set(Math.cos(a) * r, -26 - rnd() * 16, Math.sin(a) * r); s.scale.set(sc * 2, sc, 1);
  }

  // lights: warm low sun + cool sky fill
  add(new THREE.HemisphereLight("#bcd6ff", "#7d5f78", 0.55));
  const sunL = add(new THREE.DirectionalLight("#ffd7a6", 1.9));
  sunL.position.copy(sunDir).multiplyScalar(40); sunL.castShadow = true;
  sunL.shadow.mapSize.set(2048, 2048);
  Object.assign(sunL.shadow.camera, { left: -shadowSize, right: shadowSize, top: shadowSize, bottom: -shadowSize, near: 1, far: 100 });
  sunL.shadow.bias = -0.0008; sunL.shadow.normalBias = 0.04;
  const rim = add(new THREE.DirectionalLight("#8fc8ff", 0.45)); rim.position.set(30, 12, -30);

  // drifting motes (gold, additive) + petals (pink)
  const N = 160, pos = new Float32Array(N * 3), seed = new Float32Array(N);
  for (let i = 0; i < N; i++) { pos[i * 3] = (rnd() - 0.5) * 50; pos[i * 3 + 1] = rnd() * 12; pos[i * 3 + 2] = (rnd() - 0.5) * 34; seed[i] = rnd() * 100; }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const motes = add(new THREE.Points(g, new THREE.PointsMaterial({ size: 0.16, color: "#ffe2a0", map: dot(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
  const NP = 60, ppos = new Float32Array(NP * 3);
  for (let i = 0; i < NP; i++) { ppos[i * 3] = (rnd() - 0.5) * 50; ppos[i * 3 + 1] = rnd() * 14; ppos[i * 3 + 2] = (rnd() - 0.5) * 34; }
  const pg = new THREE.BufferGeometry(); pg.setAttribute("position", new THREE.BufferAttribute(ppos, 3));
  const petals = add(new THREE.Points(pg, new THREE.PointsMaterial({ size: 0.2, color: "#ffb7c9", map: petal(), transparent: true, depthWrite: false, alphaTest: 0.2 })));

  let t = 0;
  return {
    sun: sunL,
    update(dt) {
      t += dt;
      const p = motes.geometry.attributes.position.array;
      for (let i = 0; i < N; i++) {
        p[i * 3] += Math.sin(t * 0.4 + seed[i]) * dt * 0.3; p[i * 3 + 1] += dt * (0.15 + (seed[i] % 1) * 0.2); p[i * 3 + 2] += Math.cos(t * 0.3 + seed[i]) * dt * 0.3;
        if (p[i * 3 + 1] > 12) p[i * 3 + 1] = 0;
      }
      motes.geometry.attributes.position.needsUpdate = true;
      motes.material.opacity = 0.6 + Math.sin(t * 2) * 0.25;
      const q = petals.geometry.attributes.position.array;
      for (let i = 0; i < NP; i++) {
        q[i * 3] += (0.9 + Math.sin(t + i) * 0.4) * dt; q[i * 3 + 1] -= (0.5 + (i % 5) * 0.08) * dt; q[i * 3 + 2] += Math.sin(t * 0.7 + i * 3) * dt * 0.5;
        if (q[i * 3 + 1] < 0) { q[i * 3 + 1] = 14; q[i * 3] = -25 + (i * 7.3) % 20; }
      }
      petals.geometry.attributes.position.needsUpdate = true;
    },
    dispose() { for (const o of objs) scene.remove(o); },
  };
}

function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

let cloudTex = null;
function cloudTexture() {
  if (cloudTex) return cloudTex;
  const c = document.createElement("canvas"); c.width = 512; c.height = 256;
  const x = c.getContext("2d"), r = mulberry(3);
  const puffs = [];
  for (let i = 0; i < 14; i++) puffs.push([90 + r() * 330, 150 - Math.sin((i / 13) * Math.PI) * 60 + r() * 20, 40 + r() * 50]);
  // lavender shadow layer, then cream body, then warm highlight: reads as painted
  for (const [cx, cy, rr] of puffs) { x.fillStyle = "#c8b4d8"; x.beginPath(); x.arc(cx, cy + 10, rr, 0, Math.PI * 2); x.fill(); }
  for (const [cx, cy, rr] of puffs) { x.fillStyle = "#fbf1ea"; x.beginPath(); x.arc(cx - 4, cy - 2, rr * 0.92, 0, Math.PI * 2); x.fill(); }
  for (const [cx, cy, rr] of puffs) { x.fillStyle = "#fff3da"; x.beginPath(); x.arc(cx - 12, cy - 14, rr * 0.55, 0, Math.PI * 2); x.fill(); }
  x.globalCompositeOperation = "destination-in";
  const g = x.createLinearGradient(0, 0, 0, 256); g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(0.85, "rgba(0,0,0,1)"); g.addColorStop(1, "rgba(0,0,0,0)");
  x.fillStyle = g; x.fillRect(0, 0, 512, 256);
  cloudTex = new THREE.CanvasTexture(c); cloudTex.colorSpace = THREE.SRGBColorSpace;
  return cloudTex;
}
let dotTex = null;
function dot() {
  if (dotTex) return dotTex;
  const c = document.createElement("canvas"); c.width = c.height = 32;
  const x = c.getContext("2d"), g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, "#fff"); g.addColorStop(0.4, "rgba(255,255,255,.5)"); g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g; x.fillRect(0, 0, 32, 32);
  return (dotTex = new THREE.CanvasTexture(c));
}
let petalTex = null;
function petal() {
  if (petalTex) return petalTex;
  const c = document.createElement("canvas"); c.width = c.height = 32;
  const x = c.getContext("2d"); x.fillStyle = "#fff";
  x.beginPath(); x.ellipse(16, 16, 12, 7, 0.6, 0, Math.PI * 2); x.fill();
  return (petalTex = new THREE.CanvasTexture(c));
}
