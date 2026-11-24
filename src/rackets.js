// Racket catalog, rarities and how the seven stats turn into gameplay numbers.
// Stats run 1..12. Rarer rackets get a bigger total budget. All names/art are original to Rally Riot.
export const RARITIES = [
  { id: "common", name: "Common", color: "#b8c0cc", weight: 52, lucky: 20 },
  { id: "uncommon", name: "Uncommon", color: "#5be37d", weight: 27, lucky: 30 },
  { id: "rare", name: "Rare", color: "#4aa8ff", weight: 13, lucky: 25 },
  { id: "epic", name: "Epic", color: "#b45cff", weight: 5.5, lucky: 15 },
  { id: "legendary", name: "Legendary", color: "#ffc23d", weight: 2.1, lucky: 7.5 },
  { id: "mythical", name: "Mythical", color: "#ff3d6e", weight: 0.4, lucky: 2.5 },
];
export const RARITY = Object.fromEntries(RARITIES.map((r, i) => [r.id, { ...r, tier: i }]));
export const STAT_KEYS = ["movement", "dash", "jump", "power", "speed", "reach", "spin"];
export const STAT_LABEL = { movement: "Movement", dash: "Dash", jump: "Jump", power: "Power", speed: "Speed", reach: "Reach", spin: "Spin" };

// [id, name, rarity, model, frame color, accent/fx color, stats m d j p s r sp, blurb]
const R = (id, name, rarity, model, frame, accent, st, blurb) => ({
  id, name, rarity, model, frame, accent, blurb,
  stats: Object.fromEntries(STAT_KEYS.map((k, i) => [k, st[i]])),
});
export const RACKETS = [
  R("practice", "Practice Paddle", "common", "round", "#c9ced6", "#8fd3ff", [4, 4, 4, 4, 4, 4, 4], "Every legend starts somewhere."),
  R("birch", "Birchwood Basic", "common", "round", "#c79a62", "#ffe2a8", [5, 3, 4, 3, 5, 4, 3], "Light and honest."),
  R("rec", "Rec Center Classic", "common", "round", "#7f8aa3", "#ff9d5c", [3, 4, 3, 5, 3, 5, 4], "Smells like gym floor."),
  R("gale", "Gale Cutter", "uncommon", "round", "#7fe0c4", "#c4fff0", [7, 6, 4, 3, 6, 4, 4], "Built for chasing."),
  R("copper", "Copper Coil", "uncommon", "round", "#d07a43", "#ffb36b", [4, 4, 4, 5, 4, 5, 8], "Wound tight. Curves hard."),
  R("pebble", "Pebble Pounder", "uncommon", "round", "#8b8f99", "#e4e8f0", [4, 4, 5, 8, 3, 5, 5], "Small rock, big hit."),
  R("tide", "Tidebreaker", "rare", "blade", "#1f6fd1", "#5ff0ff", [5, 5, 5, 8, 5, 8, 4], "Rolls in like a wave."),
  R("frost", "Frostfang", "rare", "blade", "#bfe8ff", "#7fd6ff", [6, 6, 5, 5, 8, 4, 6], "Quick bite, cold finish."),
  R("thorn", "Thornwhip", "rare", "blade", "#2f8a3e", "#a6ff4d", [5, 5, 5, 5, 5, 7, 8], "Snaps sideways."),
  R("storm", "Stormcaller", "epic", "blade", "#3a3f9e", "#8a9bff", [6, 9, 6, 9, 6, 5, 5], "Dash in. Thunder down."),
  R("venom", "Venom Curl", "epic", "blade", "#3d1a52", "#b6ff3d", [6, 6, 6, 6, 7, 6, 9], "The shuttle never flies straight."),
  R("comet", "Comet Tail", "epic", "round", "#ff7a3d", "#ffd23d", [6, 6, 9, 8, 6, 6, 5], "Leave a streak in the sky."),
  R("solar", "Solar Verdict", "legendary", "wing", "#ffcf5c", "#fff1a8", [7, 7, 7, 10, 7, 8, 6], "Judgement from above."),
  R("abyss", "Abyssal Halo", "legendary", "wing", "#1b1d3a", "#6b5cff", [7, 7, 7, 7, 7, 9, 9], "Reaches what it shouldn't."),
  R("thunderhook", "Thunderhook", "legendary", "blade", "#f2e94e", "#4ef2ff", [9, 10, 7, 7, 9, 5, 5], "Blink and it's back."),
  R("starfall", "Starfall Requiem", "mythical", "wing", "#ffffff", "#ff5ce1", [8, 8, 10, 11, 8, 8, 6], "The sky falls with it."),
  R("eclipse", "Eclipse Monarch", "mythical", "wing", "#120a1f", "#ff3d3d", [8, 8, 8, 8, 9, 9, 10], "Bends light. Bends shuttles."),
  R("seraph", "Voidwing Seraph", "mythical", "wing", "#e8e2ff", "#5cfff0", [10, 10, 9, 8, 9, 8, 7], "Never touches the floor."),
];
export const RACKET = Object.fromEntries(RACKETS.map((r) => [r.id, r]));

// Balance patch: the meta shifts between updates. Applied on top of base stats (see CLAUDE.md).
// To shift the meta in an update: bump `version`, write player-facing notes, and nudge stats in `adjust`.
export const PATCH = {
  version: "1.1",
  notes: [
    "Gale Cutter: Movement +1 — chasers rejoice.",
    "Thunderhook: Dash −1 — still fast, slightly less everywhere at once.",
    "Venom Curl: Spin +1, Reach +1 — curve shots back on top.",
    "Starfall Requiem: Power −1 — smashes were ending rallies too fast.",
  ],
  adjust: { gale: { movement: 1 }, thunderhook: { dash: -1 }, venom: { spin: 1, reach: 1 }, starfall: { power: -1 } },
};

export function racketStats(id) {
  const r = RACKET[id] || RACKET.practice;
  const adj = PATCH.adjust[r.id] || {};
  const s = {};
  for (const k of STAT_KEYS) s[k] = Math.max(1, Math.min(12, r.stats[k] + (adj[k] || 0)));
  return s;
}

// ---- summoning. Lucky spins use the `lucky` table (no Commons-heavy pool). Pity: 40 summons without a
// Legendary or better guarantees one.
export const PITY = 40;
export function rollRarity(lucky, pity) {
  if (pity >= PITY - 1) return Math.random() < 0.85 ? "legendary" : "mythical";
  const key = lucky ? "lucky" : "weight";
  const total = RARITIES.reduce((a, r) => a + r[key], 0);
  let x = Math.random() * total;
  for (const r of RARITIES) { x -= r[key]; if (x <= 0) return r.id; }
  return "common";
}
export function summon(lucky, pity) {
  const rarity = rollRarity(lucky, pity);
  const pool = RACKETS.filter((r) => r.rarity === rarity);
  return pool[Math.floor(Math.random() * pool.length)];
}
export const statTotal = (id) => Object.values(racketStats(id)).reduce((a, b) => a + b, 0);
export function randomRacket(maxTier) {
  const pool = RACKETS.filter((r) => RARITY[r.rarity].tier <= maxTier);
  return pool[Math.floor(Math.random() * pool.length)].id;
}

// stats -> physics numbers used by Player / Match
export function derive(stats) {
  return {
    move: 5.0 + 0.33 * stats.movement,            // m/s
    dashSpeed: 12 + 1.1 * stats.dash,             // m/s during a dash
    dashCd: 1.7 - 0.08 * stats.dash,              // s
    jump: 6.4 + 0.36 * stats.jump,                // m/s take-off
    shot: 16.5 + 0.75 * stats.power,              // m/s base shot speed
    chargeTime: 0.95 - 0.045 * stats.speed,       // s to full charge
    recover: 0.42 - 0.022 * stats.speed,          // s after a swing
    reach: 1.2 + 0.09 * stats.reach,              // m from the hit centre
    spin: 0.32 * stats.spin,                      // sidespin at full charge
  };
}
