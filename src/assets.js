import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RACKET } from "./rackets.js";
import { normalizeLook, HATS_COVER_HAIR } from "./looks.js";

const NAMES = ["court", "lobby", "backdrop", "avatar", "avatar_parts", "shuttle", "racket_round", "racket_blade", "racket_wing"];
const models = {};

// ---- art style: cel shading (3-band toon ramp) + inverted-hull ink outlines
let ramp = null;
export function toonRamp() {
  if (ramp) return ramp;
  const d = new Uint8Array([70, 150, 215, 255]);
  ramp = new THREE.DataTexture(d, d.length, 1, THREE.RedFormat);
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter; ramp.needsUpdate = true;
  return ramp;
}
export const INK = new THREE.Color("#2b2033");

function toToon(m) {
  const t = new THREE.MeshToonMaterial({
    name: m.name, color: m.color.clone(), gradientMap: toonRamp(),
    emissive: m.emissive ? m.emissive.clone() : new THREE.Color(0), emissiveIntensity: m.emissiveIntensity ?? 1,
    transparent: m.transparent, opacity: m.opacity, side: m.side,
  });
  return t;
}

// screen-space constant-width outline drawn from back faces
let outlineMat = null;
export function outlineMaterial() {
  if (outlineMat) return outlineMat;
  outlineMat = new THREE.ShaderMaterial({
    name: "Outline", side: THREE.BackSide,
    uniforms: { uWidth: { value: 0.006 }, uColor: { value: INK }, uAspect: { value: innerWidth / innerHeight } },
    vertexShader: `uniform float uWidth; uniform float uAspect;
      void main() {
        vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        vec3 n = normalize(normalMatrix * normal);
        vec2 off = normalize((projectionMatrix * vec4(n, 0.0)).xy + 1e-5);
        off.x /= uAspect;
        clip.xy += off * uWidth * clip.w * min(1.0, 14.0 / max(clip.w, 1.0)) * 6.0 / 6.0;
        gl_Position = clip;
      }`,
    fragmentShader: `uniform vec3 uColor; void main() { gl_FragColor = vec4(uColor, 1.0); }`,
  });
  addEventListener("resize", () => (outlineMat.uniforms.uAspect.value = innerWidth / innerHeight));
  return outlineMat;
}
function addOutlines(root, skip = () => false) {
  const list = [];
  root.traverse((o) => { if (o.isMesh && !skip(o)) list.push(o); });
  for (const o of list) {
    const ol = new THREE.Mesh(o.geometry, outlineMaterial());
    ol.name = o.name + "_ol"; ol.castShadow = false; ol.receiveShadow = false; ol.userData.outline = true;
    o.add(ol);
  }
}

export async function loadAssets(onProgress) {
  const loader = new GLTFLoader();
  const base = import.meta.env.BASE_URL + "models/";
  let done = 0;
  await Promise.all(NAMES.map(async (n) => {
    const g = await loader.loadAsync(base + n + ".glb");
    g.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true;
      o.material = n === "backdrop" && /^Far/.test(o.material.name)
        ? new THREE.MeshBasicMaterial({ name: o.material.name, color: o.material.color, fog: true })
        : toToon(o.material);
    });
    models[n] = g.scene;
    onProgress && onProgress(++done / NAMES.length);
  }));
  // richer, less washed-out palette for the big surfaces
  const recolor = { Stone: "#cdb79c", Grass: "#7fb257", GrassDark: "#4f8a4a", CourtA: "#d98a5f", CourtB: "#5f9ea3", Rock: "#8e7d93", Cream: "#efe0c2" };
  for (const n of ["court", "lobby", "backdrop"]) models[n].traverse((o) => { if (o.isMesh && recolor[o.material.name]) o.material.color.set(recolor[o.material.name]); });
  // tame very bright emissives for the daylight scene
  for (const n of ["court", "lobby"]) models[n].traverse((o) => { if (o.isMesh && /Rune|Line|Lantern/.test(o.material.name)) o.material.emissiveIntensity = o.material.name === "Lantern" ? 1.2 : 0.35; });
  // flat ground pieces don't cast shadows or get outlines
  const flat = /IslandTop|IslandRim|Underside|Plaza|Tiles|Side[AB]|Lines|Tufts|Net|Rune|Torus/;
  for (const n of ["court", "lobby"]) models[n].traverse((o) => { if (o.isMesh && flat.test(o.name)) o.castShadow = false; });
  models.backdrop.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  // ink lines on characters, gear and the bigger props
  addOutlines(models.avatar, (o) => /Eye|Shine/.test(o.name));
  addOutlines(models.avatar_parts, (o) => /Scar|Stitch|Blush|Halo|Ear|Jewel|Flower|Bridge|Torus/.test(o.name) || o.parent?.name === "face_glasses");
  addOutlines(models.shuttle);
  for (const r of ["racket_round", "racket_blade", "racket_wing"]) addOutlines(models[r], (o) => /Strings/.test(o.name));
  for (const n of ["court", "lobby"]) addOutlines(models[n], (o) => flat.test(o.name) || /tile|tuft|Banner/i.test(o.name) || o.material.emissiveIntensity > 1.5);
}

// deep clone with private copies of the materials we recolor
function cloneWith(name, tint = {}) {
  const o = models[name].clone(true);
  o.traverse((m) => {
    if (!m.isMesh || m.userData.outline) return;
    const t = tint[m.material.name];
    if (t) {
      m.material = m.material.clone();
      m.material.color.set(t.color);
      if (t.emissive != null) { m.material.emissive.set(t.color); m.material.emissiveIntensity = t.emissive; }
    }
  });
  return o;
}

export const getModel = (name) => cloneWith(name);

// Build a character: base body + the chosen hair / outfit / hat / face parts, recolored from the look.
export function makeAvatar(look, teamColor) {
  const L = normalizeLook(look);
  const root = models.avatar.clone(true);
  const add = (name) => { const src = models.avatar_parts.getObjectByName(name); if (src) root.add(src.clone(true)); return src; };
  add("outfit_" + L.outfit); add("hair_" + L.hair);
  if (L.hat !== "none") add("hat_" + L.hat);
  if (L.face !== "none") add("face_" + L.face);
  if (HATS_COVER_HAIR.has(L.hat)) root.traverse((o) => { if (/^Tuft/.test(o.name)) o.visible = false; });
  const bare = L.outfit === "vest";
  const legs = { cloak: "#2b2033", vest: L.skin, gown: L.c1, jacket: L.c2 }[L.outfit];
  const colors = { Skin: L.skin, Hair: L.hairColor, Eye: L.eyes, Outfit1: L.c1, Outfit2: L.c2, HatMain: L.hatColor, HatBand: L.hatBand,
    Team: teamColor, Legs: legs, Sleeve: bare ? L.skin : L.c1 };
  const cache = {};
  root.traverse((m) => {
    if (!m.isMesh || m.userData.outline) return;
    const n = m.material.name, c = colors[n];
    if (c == null) return;
    m.material = cache[n] || (cache[n] = Object.assign(m.material.clone(), {}));
    m.material.color.set(c);
  });
  root.userData.look = L;
  return root;
}

export function makeRacket(id) {
  const r = RACKET[id] || RACKET.practice;
  const o = cloneWith("racket_" + r.model, {
    Frame: { color: r.frame },
    Accent: { color: r.accent, emissive: 1.6 },
  });
  o.userData.accent = new THREE.Color(r.accent);
  o.traverse((m) => { if (m.isMesh && m.material.name === "Accent") o.userData.accentMat = m.material; });
  return o;
}
