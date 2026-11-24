import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RACKET } from "./rackets.js";

const NAMES = ["court", "lobby", "avatar", "shuttle", "racket_round", "racket_blade", "racket_wing"];
const models = {};

export async function loadAssets(onProgress) {
  const loader = new GLTFLoader();
  const base = import.meta.env.BASE_URL + "models/";
  let done = 0;
  await Promise.all(NAMES.map(async (n) => {
    const g = await loader.loadAsync(base + n + ".glb");
    g.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    models[n] = g.scene;
    onProgress && onProgress(++done / NAMES.length);
  }));
  models.court.traverse((o) => { if (o.isMesh && o.material.name === "Lamp") o.material.emissiveIntensity = 0.35; });
  // big flat pieces don't need to cast shadows
  models.court.traverse((o) => { if (o.isMesh && /Floor|Side|Lines|Wall|Stand|Lamp|Neon/.test(o.name)) o.castShadow = false; });
  models.lobby.traverse((o) => { if (o.isMesh && /Plaza|Inner/.test(o.name)) o.castShadow = false; });
}

// deep clone with private copies of the materials we recolor
function cloneWith(name, tint = {}) {
  const o = models[name].clone(true);
  o.traverse((m) => {
    if (!m.isMesh) return;
    const mn = m.material.name;
    if (tint[mn]) {
      m.material = m.material.clone();
      const t = tint[mn];
      m.material.color.set(t.color);
      if (t.emissive != null) { m.material.emissive.set(t.color); m.material.emissiveIntensity = t.emissive; }
    }
  });
  return o;
}

export const getModel = (name) => cloneWith(name);

export function makeAvatar(teamColor) {
  return cloneWith("avatar", { Team: { color: teamColor } });
}

export function makeRacket(id) {
  const r = RACKET[id] || RACKET.practice;
  const o = cloneWith("racket_" + r.model, {
    Frame: { color: r.frame },
    Accent: { color: r.accent, emissive: 2.2 },
  });
  o.userData.accent = new THREE.Color(r.accent);
  o.traverse((m) => { if (m.isMesh && m.material.name === "Accent") o.userData.accentMat = m.material; });
  return o;
}
