import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { RACKET } from "./rackets.js";
import { normalizeLook, HATS_COVER_HAIR, OUTFIT_FIT } from "./looks.js";

const NAMES = ["court", "lobby", "backdrop", "avatar", "shuttle", "racket_round", "racket_blade", "racket_wing"];
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
// same screen-space hull for skinned meshes: a basic material whose vertex shader pushes the skinned vertex out along its normal
let outlineSkinned = null;
function outlineSkinnedMaterial() {
  if (outlineSkinned) return outlineSkinned;
  const base = outlineMaterial();
  outlineSkinned = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide, name: "OutlineSkinned" });
  outlineSkinned.onBeforeCompile = (sh) => {
    sh.uniforms.uWidth = base.uniforms.uWidth; sh.uniforms.uAspect = base.uniforms.uAspect;
    sh.vertexShader = "uniform float uWidth; uniform float uAspect;\n" + sh.vertexShader.replace("#include <project_vertex>", `#include <project_vertex>
      vec3 nOl = normalize(normalMatrix * objectNormal);
      vec2 offOl = normalize((projectionMatrix * vec4(nOl, 0.0)).xy + 1e-5);
      offOl.x /= uAspect;
      gl_Position.xy += offOl * uWidth * gl_Position.w * min(1.0, 14.0 / max(gl_Position.w, 1.0));`);
  };
  return outlineSkinned;
}
function addOutlines(root, skip = () => false) {
  const list = [];
  root.traverse((o) => { if (o.isMesh && !skip(o)) list.push(o); });
  for (const o of list) {
    if (o.isSkinnedMesh) {   // sibling skinned hull bound to the same skeleton (SkeletonUtils.clone re-binds it per player)
      const ol = new THREE.SkinnedMesh(o.geometry, outlineSkinnedMaterial());
      ol.name = o.name + "_ol"; ol.castShadow = false; ol.receiveShadow = false; ol.userData.outline = true; ol.frustumCulled = false;
      ol.position.copy(o.position); ol.quaternion.copy(o.quaternion); ol.scale.copy(o.scale);
      o.parent.add(ol); ol.bind(o.skeleton, o.bindMatrix);
      continue;
    }
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
  // (small face strokes and trims stay outline-free: an ink hull would turn them into blobs)
  models.avatar.traverse((o) => { if (o.isSkinnedMesh) o.frustumCulled = false; });   // skinned bounds don't follow the pose
  addOutlines(models.avatar, (o) => /Nose|EarInner|Lace|Cuff|Sock|Eye|Shine|Lash|Lid|Brow|Mouth|Teeth|Scar|Stitch|Blush|Freckle|Bandaid|EyeBlack|Halo|Jewel|Details|Button|Aglet|Zip|Buckle|ClaspGem|Glass|Pocket|Knot|Tie|Logo|Seam|Stripe|Placket|Neckline|Waistband|Hem|Band[LR]|Pendant|Chain|Shades/.test(o.name));
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

// Build a character: clone the rigged avatar (skeleton + every part variant, see blender/avatar_rig.py), keep the base pieces
// and the chosen "<slot>_<id>__*" pieces, recolor by material name. Bones: Hips Spine Chest Neck Head, Arm/Forearm/Hand,
// Leg/Shin/Foot (+L/R) — driven by anim.js.
const SLOT_KEY = { outfit: "outfit", hair: "hair", eyes: "eyeStyle", brows: "brows", mouth: "mouth", hat: "hat", face: "face", eyewear: "eyewear", neck: "neck", wrist: "wrist" };
const BUILD_K = { slim: 0.93, athletic: 1, strong: 1.07 };
export function makeAvatar(look, teamColor) {
  const L = normalizeLook(look);
  const root = cloneSkinned(models.avatar);
  const want = new Set(Object.entries(SLOT_KEY).map(([slot, key]) => `${slot}_${L[key]}`));
  const fit = OUTFIT_FIT[L.outfit] || OUTFIT_FIT.tee;
  const drop = [];
  root.traverse((o) => {
    const m = /^([a-z]+_[a-z]+)__/.exec(o.name);
    if (m && !want.has(m[1])) { drop.push(o); return; }
    if (/^base__CuffShort/.test(o.name)) { if (fit.sleeve !== "short") drop.push(o); }
    else if (/^base__Cuff/.test(o.name)) { if (!fit.cuff) drop.push(o); }
    if (HATS_COVER_HAIR.has(L.hat) && /^hair_[a-z]+__Tuft/.test(o.name)) drop.push(o);
  });
  for (const o of drop) o.removeFromParent();

  const legs = fit.legs === "skin" ? L.skin : L[fit.legs] || fit.legs;
  const colors = { Skin: L.skin, Hair: L.hairColor, Eye: L.eyes, Outfit1: L.c1, Outfit2: L.c2, HatMain: L.hatColor, HatBand: L.hatBand, Team: teamColor,
    Legs: legs, Legs2: legs, Sleeve: fit.sleeve === "none" ? L.skin : L.c1, Sleeve2: fit.sleeve === "long" ? L.c1 : L.skin, Cuff: L.c2, Undershirt: fit.sleeve === "none" ? L.skin : L.c1 };
  const cache = {};
  root.traverse((m) => {
    if (!m.isMesh || m.userData.outline) return;
    const n = m.material.name, c = colors[n];
    if (c == null) return;
    m.material = cache[n] || (cache[n] = m.material.clone());
    m.material.color.set(c);
  });
  // build: a touch wider / narrower body, head kept as is
  const k = BUILD_K[L.build] || 1;
  if (k !== 1) { root.scale.set(k, 1, k); const head = root.getObjectByName("Head"); if (head) head.scale.set(1 / k, 1, 1 / k); }
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
