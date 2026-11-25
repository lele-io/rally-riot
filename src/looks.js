// Character customization: options, defaults, random looks for bots.
// Parts live in public/models/avatar_parts.glb as root nodes named <slot>_<id> (built by blender/avatar.py).
export const HAIR = [["spiky", "Spiky"], ["messy", "Messy"], ["middle", "Middle Part"], ["crew", "Crew Cut"], ["long", "Long"], ["bob", "Bob"], ["ponytail", "Ponytail"], ["buns", "Buns"]];
export const OUTFIT = [["tee", "T-Shirt & Shorts"], ["polo", "Polo & Shorts"], ["tank", "Tank Top"], ["hoodie", "Hoodie & Joggers"], ["dress", "Tennis Dress"],
  ["jacket", "Track Jacket"], ["cloak", "Wanderer Cloak"], ["gown", "Gown"]];
export const EYES = [["sharp", "Sharp"], ["round", "Round"], ["narrow", "Calm"], ["fierce", "Fierce"]];
export const BROWS = [["thick", "Thick"], ["soft", "Soft"], ["angry", "Angry"], ["raised", "Raised"]];
export const MOUTH = [["smile", "Smile"], ["grin", "Grin"], ["neutral", "Neutral"], ["smirk", "Smirk"]];
export const FACE = [["none", "None"], ["scar", "Scar"], ["blush", "Blush"], ["freckles", "Freckles"], ["bandaid", "Band-Aid"], ["eyeblack", "Eye Black"]];
export const BUILD = [["slim", "Slim"], ["athletic", "Athletic"], ["strong", "Strong"]];
// accessory slots (Roblox-style: one item per slot, all slots combine)
export const HAT = [["none", "None"], ["cap", "Cap"], ["backcap", "Backwards Cap"], ["visor", "Visor"], ["headband", "Headband"], ["beanie", "Beanie"],
  ["bandana", "Bandana"], ["hood", "Hood"], ["ears", "Cat Ears"], ["halo", "Halo"], ["crown", "Crown"]];
export const EYEWEAR = [["none", "None"], ["glasses", "Glasses"], ["shades", "Sport Shades"]];
export const NECK = [["none", "None"], ["scarf", "Team Scarf"], ["towel", "Towel"], ["chain", "Chain"]];
export const WRIST = [["none", "None"], ["bands", "Wristbands"], ["band", "Racket-hand Band"]];
export const HATS_COVER_HAIR = new Set(["cap", "backcap", "beanie", "hood", "bandana"]); // hide spikes/buns under these

// per outfit: sleeve length, legs, which cuffs show, and what color the legs are (k = look key, or "skin")
export const OUTFIT_FIT = {
  tee: { sleeve: "short", legs: "skin" }, polo: { sleeve: "short", legs: "skin" }, tank: { sleeve: "none", legs: "skin" },
  hoodie: { sleeve: "long", legs: "c2", cuff: true }, dress: { sleeve: "none", legs: "skin" }, jacket: { sleeve: "long", legs: "c2", cuff: true },
  cloak: { sleeve: "long", legs: "#2b2033", cuff: true }, gown: { sleeve: "long", legs: "c1", cuff: true },
};

export const SKIN_TONES = ["#ffe6d2", "#ffd9bd", "#f5c39d", "#e0a47a", "#c27f55", "#9a5e3b", "#6e4129"];
export const PALETTE = ["#1f1b24", "#33263d", "#5a3a2a", "#8a5a3a", "#d9a35e", "#f4e2a1", "#f2f0ec", "#9aa3ad",
  "#d83a3f", "#ff8a7a", "#f2a33a", "#f2cf7a", "#7fcf6a", "#3f9e6e", "#5fd6c4", "#4f8ff0", "#2d4a9e", "#8a63e0", "#c9a2ff", "#ff7fbf", "#4a2a5a"];
export const EYE_COLORS = ["#1f1b24", "#5a3a2a", "#2d4a9e", "#3f9e6e", "#8a63e0", "#d83a3f", "#f2a33a", "#5fd6c4"];

export const DEFAULT_LOOK = {
  hair: "spiky", outfit: "tee", hat: "none", face: "none", eyeStyle: "sharp", brows: "thick", mouth: "smile",
  eyewear: "none", neck: "scarf", wrist: "none", build: "athletic",
  skin: "#ffd9bd", hairColor: "#33263d", eyes: "#1f1b24", c1: "#4f8ff0", c2: "#f2f0ec", hatColor: "#1f1b24", hatBand: "#d83a3f",
};

const LISTS = { hair: HAIR, outfit: OUTFIT, hat: HAT, face: FACE, eyeStyle: EYES, brows: BROWS, mouth: MOUTH, eyewear: EYEWEAR, neck: NECK, wrist: WRIST, build: BUILD };
export function normalizeLook(l) {
  const out = { ...DEFAULT_LOOK, ...(l || {}) };
  for (const [k, list] of Object.entries(LISTS)) if (!list.some(([id]) => id === out[k])) out[k] = DEFAULT_LOOK[k];
  for (const k of ["skin", "hairColor", "eyes", "c1", "c2", "hatColor", "hatBand"]) if (!/^#[0-9a-f]{6}$/i.test(out[k] || "")) out[k] = DEFAULT_LOOK[k];
  return out;
}

const pick = (a) => a[Math.floor(Math.random() * a.length)];
export function randomLook() {
  const maybe = (list, p) => (Math.random() < p ? pick(list.slice(1))[0] : "none");
  return {
    hair: pick(HAIR)[0], outfit: pick(OUTFIT.slice(0, 6))[0], eyeStyle: pick(EYES)[0], brows: pick(BROWS)[0], mouth: pick(MOUTH)[0], build: pick(BUILD)[0],
    hat: maybe(HAT, 0.45), face: maybe(FACE, 0.35), eyewear: maybe(EYEWEAR, 0.2), neck: Math.random() < 0.5 ? "scarf" : maybe(NECK, 0.3), wrist: maybe(WRIST, 0.4),
    skin: pick(SKIN_TONES), hairColor: pick(PALETTE), eyes: pick(EYE_COLORS), c1: pick(PALETTE), c2: pick(PALETTE), hatColor: pick(PALETTE), hatBand: pick(PALETTE),
  };
}
