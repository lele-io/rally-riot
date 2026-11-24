// Character customization: options, defaults, random looks for bots.
// Parts live in public/models/avatar_parts.glb as root nodes named <kind>_<id>.
export const HAIR = [["spiky", "Spiky"], ["messy", "Messy"], ["long", "Long"], ["bob", "Bob"], ["ponytail", "Ponytail"], ["buns", "Buns"]];
export const OUTFIT = [["cloak", "Cloak"], ["vest", "Vest & Shorts"], ["gown", "Gown"], ["jacket", "Jacket"]];
export const HAT = [["none", "None"], ["straw", "Straw Hat"], ["wide", "Wide Hat"], ["hood", "Hood"], ["beanie", "Beanie"], ["crown", "Crown"], ["halo", "Halo"], ["ears", "Cat Ears"]];
export const FACE = [["none", "None"], ["scar", "Scar"], ["blush", "Blush"], ["glasses", "Glasses"]];
export const HATS_COVER_HAIR = new Set(["straw", "wide", "hood", "beanie"]); // hide spikes/buns under these

export const SKIN_TONES = ["#ffe6d2", "#ffd9bd", "#f5c39d", "#e0a47a", "#c27f55", "#9a5e3b", "#6e4129"];
export const PALETTE = ["#1f1b24", "#33263d", "#5a3a2a", "#8a5a3a", "#d9a35e", "#f4e2a1", "#f2f0ec", "#9aa3ad",
  "#d83a3f", "#ff8a7a", "#f2a33a", "#f2cf7a", "#7fcf6a", "#3f9e6e", "#5fd6c4", "#4f8ff0", "#2d4a9e", "#8a63e0", "#c9a2ff", "#ff7fbf", "#4a2a5a"];

export const DEFAULT_LOOK = {
  hair: "spiky", outfit: "cloak", hat: "none", face: "none",
  skin: "#ffd9bd", hairColor: "#33263d", eyes: "#1f1b24", c1: "#f2f0ec", c2: "#4f8ff0", hatColor: "#f2cf7a", hatBand: "#d83a3f",
};

export function normalizeLook(l) {
  const out = { ...DEFAULT_LOOK, ...(l || {}) };
  const ok = (list, v, d) => (list.some(([id]) => id === v) ? v : d);
  out.hair = ok(HAIR, out.hair, "spiky"); out.outfit = ok(OUTFIT, out.outfit, "cloak");
  out.hat = ok(HAT, out.hat, "none"); out.face = ok(FACE, out.face, "none");
  for (const k of ["skin", "hairColor", "eyes", "c1", "c2", "hatColor", "hatBand"]) if (!/^#[0-9a-f]{6}$/i.test(out[k] || "")) out[k] = DEFAULT_LOOK[k];
  return out;
}

const pick = (a) => a[Math.floor(Math.random() * a.length)];
export function randomLook() {
  return {
    hair: pick(HAIR)[0], outfit: pick(OUTFIT)[0], hat: Math.random() < 0.45 ? "none" : pick(HAT)[0], face: Math.random() < 0.6 ? "none" : pick(FACE)[0],
    skin: pick(SKIN_TONES), hairColor: pick(PALETTE), eyes: pick(["#1f1b24", "#2d4a9e", "#3f9e6e", "#5a3a2a", "#8a63e0", "#d83a3f"]),
    c1: pick(PALETTE), c2: pick(PALETTE), hatColor: pick(PALETTE), hatBand: pick(PALETTE),
  };
}
