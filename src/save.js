// Local profile (localStorage). Everything that persists between sessions lives here.
const KEY = "rallyriot.profile.v1";
const fresh = () => ({
  id: Math.random().toString(36).slice(2, 12),
  name: "Player" + Math.floor(1000 + Math.random() * 9000),
  yen: 0, spins: 3, lucky: 1,      // starter summons
  inv: { practice: 1 }, equipped: "practice",
  pity: 0,                         // summons since the last Legendary+
  codes: [],                       // redeemed codes
  rating: 1000, ranked: { w: 0, l: 0 },
  league: { season: 0, pts: 0, w: 0, l: 0 },
  stats: { matches: 0, wins: 0, smashes: 0 },
  settings: { bot: 0.5 },
});

let data = null;
export function profile() {
  if (data) return data;
  try { data = { ...fresh(), ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch (e) { data = fresh(); }
  return data;
}
export function save() { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {} }
export function update(fn) { fn(profile()); save(); return data; }
