// Phase 4: Yen, shop, codes, ranked rating, leagues.
// Everything is stored in the local profile (save.js). Codes are kept as hashes so they aren't readable in the bundle.
import { h } from "./ui.js";
import { panel, racketIcon, rarityBadge } from "./screens.js";
import { profile, update } from "./save.js";
import { RACKETS, PATCH, statTotal, RARITY } from "./rackets.js";
import { quickTab } from "./online.js";
import { sfx } from "./sfx.js";

// ---------------------------------------------------------------- prices & payouts
export const PRICES = { spin: 250, spin10: 2250, lucky: 1200 };

export function payout(r, cfg) {
  const won = !!r.won, mine = r.score ? Math.max(...r.score) : 0;
  let yen = won ? 120 : 45;                         // every match pays, win or lose
  yen += (r.myPoints ?? 0) * 4 + Math.min(10, r.stats.smashes) * 6 + Math.min(20, r.stats.longest) * 2;
  const mult = { casual: 1, online: 1.5, ranked: 2, rankedBot: 1.3, league: 1.6 }[cfg.type] || 1;
  yen = Math.round(yen * mult * (cfg.level ? 0.7 + cfg.level * 0.6 : 1));
  return yen;
}

// ---------------------------------------------------------------- ranked
export const RANKS = [
  { name: "Bronze", min: 0, color: "#c98a55" }, { name: "Silver", min: 1100, color: "#c9d2dd" },
  { name: "Gold", min: 1250, color: "#ffd23d" }, { name: "Platinum", min: 1400, color: "#5ff0d6" },
  { name: "Diamond", min: 1550, color: "#6fb6ff" }, { name: "Champion", min: 1700, color: "#ff4d8d" },
];
export const rankOf = (rating) => [...RANKS].reverse().find((r) => rating >= r.min);
export function eloDelta(my, opp, won, k = 32) {
  const exp = 1 / (1 + Math.pow(10, (opp - my) / 400));
  return Math.round(k * ((won ? 1 : 0) - exp));
}
const botRatingFor = (level) => 900 + level * 800;

// ---------------------------------------------------------------- leagues (weekly seasons, 8-player groups)
export const DIVS = [
  { name: "Bronze League", color: "#c98a55", level: 0.3 }, { name: "Silver League", color: "#c9d2dd", level: 0.45 },
  { name: "Gold League", color: "#ffd23d", level: 0.6 }, { name: "Platinum League", color: "#5ff0d6", level: 0.72 },
  { name: "Diamond League", color: "#6fb6ff", level: 0.84 }, { name: "Mythic League", color: "#ff4d8d", level: 0.95 },
];
const WEEK = 7 * 864e5, EPOCH = Date.UTC(2026, 10, 23); // launch week (a Monday): Season 1
export const seasonNow = () => Math.floor((Date.now() - EPOCH) / WEEK);
const seasonEnds = (s) => EPOCH + (s + 1) * WEEK;
const RIVALS = ["Feathertop", "Netsplitter", "LobLord", "Kiko", "Ralliana", "Spinzo", "Courtney", "Mo Smash", "Tess Clear", "Drop Daddy", "Wingnut", "Jaxx", "Pip", "Velvet Volley", "Birdcage", "Zuzu"];
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const hashStr = (str) => { let x = 2166136261; for (const c of str) x = Math.imul(x ^ c.charCodeAt(0), 16777619) >>> 0; return x; };

export function standings(season, at = Date.now()) {
  const p = profile(), L = p.league, R = rng(hashStr(p.id + ":" + season + ":" + (L.div || 0)));
  const days = Math.max(0, Math.min(7, (at - (EPOCH + season * WEEK)) / 864e5));
  const names = [...RIVALS].sort(() => R() - 0.5).slice(0, 7);
  const rows = names.map((n) => {
    const rate = 2 + R() * 7;      // league points per day for this rival
    const pts = Math.floor(rate * days + R() * 2);
    return { name: n, pts, you: false };
  });
  rows.push({ name: p.name, pts: L.season === season ? L.pts : 0, you: true });
  rows.sort((a, b) => b.pts - a.pts || (a.you ? -1 : 1));
  return rows;
}

// call on load / lobby: roll the season over, promote/relegate, hand out rewards
export function leagueRollover() {
  const p = profile(), now = seasonNow();
  if (p.league.season === now) return null;
  let result = null;
  if (p.league.season != null && p.league.season < now && (p.league.w + p.league.l) > 0) {
    const rows = standings(p.league.season, seasonEnds(p.league.season));
    const place = rows.findIndex((r) => r.you) + 1;
    const div = p.league.div || 0;
    const nd = place <= 2 ? Math.min(DIVS.length - 1, div + 1) : place >= 7 ? Math.max(0, div - 1) : div;
    const reward = { spins: Math.max(0, 6 - place) + div, lucky: place === 1 ? 1 + (div >= 3 ? 1 : 0) : 0, yen: (9 - place) * 100 * (div + 1) };
    result = { place, from: div, to: nd, reward };
    update((q) => { q.spins += reward.spins; q.lucky += reward.lucky; q.yen += reward.yen; q.league = { season: now, pts: 0, w: 0, l: 0, div: nd, last: result }; });
  } else update((q) => { q.league = { ...q.league, season: now, pts: 0, w: 0, l: 0, div: q.league.div || 0 }; });
  return result;
}

// ---------------------------------------------------------------- codes (FNV-1a hashes of upper-case codes)
// The plaintext list lives in CLAUDE.md for the developer. {hash: [reward, label]}
const CODES = {
  [hashStr("RALLYRIOT")]: [{ spins: 3 }, "3 Spins"],
  [hashStr("LAUNCHDAY")]: [{ lucky: 1, yen: 500 }, "1 Lucky Spin + ¥500"],
  [hashStr("SPINCITY")]: [{ spins: 5 }, "5 Spins"],
  [hashStr("FEATHERFALL")]: [{ lucky: 2 }, "2 Lucky Spins"],
  [hashStr("NETGAIN")]: [{ yen: 1500 }, "¥1,500"],
};
export function redeem(code) {
  const c = String(code || "").trim().toUpperCase().replace(/\s+/g, "");
  const hit = CODES[hashStr(c)];
  if (!hit) return { ok: false, msg: "That code doesn't exist (or has expired)." };
  if (profile().codes.includes(hashStr(c))) return { ok: false, msg: "You've already redeemed that code." };
  update((p) => { p.codes.push(hashStr(c)); p.spins += hit[0].spins || 0; p.lucky += hit[0].lucky || 0; p.yen += hit[0].yen || 0; });
  return { ok: true, msg: "Redeemed: " + hit[1] + "!" };
}

// ---------------------------------------------------------------- shop & codes panel
export function openShop(host, refresh) {
  const box = h("div", { class: "col", style: "gap:14px" });
  const draw = () => {
    const p = profile(), today = new Date().toISOString().slice(0, 10);
    box.innerHTML = "";
    const buy = (label, sub, cost, fn, cls) => h("button", { class: "btn shopitem " + cls, disabled: p.yen < cost, onclick: () => { update((q) => { q.yen -= cost; fn(q); }); sfx.summon(0); refresh(); draw(); } },
      h("div", {}, label), h("small", {}, sub), h("div", { class: "price" }, "¥ " + cost.toLocaleString()));
    box.append(
      h("div", { class: "lbl" }, "Summons"),
      h("div", { class: "shopgrid" },
        buy("SPIN", "1 summon", PRICES.spin, (q) => q.spins++, "cool"),
        buy("SPIN ×10", "10 summons · 10% off", PRICES.spin10, (q) => (q.spins += 10), "cool"),
        buy("LUCKY SPIN", "better odds", PRICES.lucky, (q) => q.lucky++, "gold")),
      p.daily === today
        ? h("div", { class: "muted" }, "Daily free Spin claimed — come back tomorrow.")
        : h("button", { class: "btn hot", onclick: () => { update((q) => { q.daily = today; q.spins++; }); sfx.summon(1); refresh(); draw(); } }, "CLAIM DAILY FREE SPIN"),
      h("div", { class: "muted", style: "font-size:13px" }, "Earn Yen from every match — win or lose. Duplicates refund Yen."),
      h("div", { class: "lbl", style: "margin-top:8px" }, "Codes"),
      codeBox());
  };
  const codeBox = () => {
    const inp = h("input", { class: "codein wide", placeholder: "ENTER CODE", maxlength: 24 });
    const msg = h("div", { class: "muted" });
    const go = () => { const r = redeem(inp.value); msg.textContent = r.msg; msg.style.color = r.ok ? "#7dffb0" : "#ff8aa5"; if (r.ok) { sfx.summon(2); refresh(); inp.value = ""; setTimeout(draw, 1400); } else sfx.ui(); };
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    return h("div", { class: "col", style: "gap:8px" }, h("div", { class: "row", style: "justify-content:flex-start" }, inp, h("button", { class: "btn cool", onclick: go }, "REDEEM")), msg,
      h("div", { class: "muted", style: "font-size:12px" }, "Codes are given out on updates and events. Each works once."));
  };
  draw();
  return panel(host, "Shop & Codes", null, box);
}

// ---------------------------------------------------------------- ranked & leagues panel
export function openCompete(host, game) {
  const p = profile(), rk = rankOf(p.rating), L = p.league, div = DIVS[L.div || 0];
  const ranked = h("div", { class: "col", style: "gap:12px" },
    h("div", { class: "rankcard", style: `--rc:${rk.color}` }, h("div", { class: "rk" }, rk.name), h("div", {}, h("b", {}, p.rating), " rating · ", `${p.ranked.w}W ${p.ranked.l}L`)),
    h("div", { class: "rankladder" }, ...RANKS.map((r) => h("span", { class: r === rk ? "on" : "", style: `--rc:${r.color}` }, r.name, h("small", {}, r.min || "—")))),
    quickTab(game, true),
    h("div", { class: "muted", style: "font-size:13px" }, "No one around? Play a ranked bot match (smaller rating changes)."),
    h("button", { class: "btn", onclick: () => game.startMatch({ type: "rankedBot", size: 1, level: Math.min(0.95, Math.max(0.2, (p.rating - 900) / 800)) }) }, "RANKED VS BOT"));

  const rows = standings(L.season);
  const left = Math.max(0, seasonEnds(L.season) - Date.now()), dd = Math.floor(left / 864e5), hh = Math.floor((left % 864e5) / 36e5);
  const league = h("div", { class: "col", style: "gap:10px" },
    h("div", { class: "rankcard", style: `--rc:${div.color}` }, h("div", { class: "rk" }, div.name), h("div", {}, `Season ${L.season + 1} · ends in ${dd}d ${hh}h · ${L.w}W ${L.l}L`)),
    L.last ? h("div", { class: "muted" }, `Last season: #${L.last.place} — ${L.last.to > L.last.from ? "promoted!" : L.last.to < L.last.from ? "relegated" : "stayed"} · got ${L.last.reward.spins} Spins${L.last.reward.lucky ? `, ${L.last.reward.lucky} Lucky` : ""}, ¥${L.last.reward.yen}`) : null,
    h("table", { class: "rates league" }, h("tr", {}, h("th", {}, "#"), h("th", {}, "Player"), h("th", {}, "Pts")),
      ...rows.map((r, i) => h("tr", { class: (r.you ? "you " : "") + (i < 2 ? "up" : i >= 6 ? "down" : "") }, h("td", {}, i + 1), h("td", {}, r.name), h("td", {}, r.pts)))),
    h("div", { class: "muted", style: "font-size:12px" }, "Win = 3 pts, loss = 1. Top 2 promote, bottom 2 drop. Rewards at season end."),
    h("div", { class: "row", style: "justify-content:flex-start" }, ...[1, 2, 3].map((n) => h("button", { class: "btn hot", onclick: () => game.startMatch({ type: "league", size: n, level: div.level }) }, `LEAGUE ${n}v${n}`))));

  const meta = h("div", { class: "col", style: "gap:8px" },
    h("div", { class: "muted" }, `Balance patch ${PATCH.version}:`), h("ul", { class: "notes" }, ...PATCH.notes.map((n) => h("li", {}, n))),
    h("div", { class: "lbl" }, "Strongest rackets this patch"),
    ...[...RACKETS].sort((a, b) => statTotal(b.id) - statTotal(a.id)).slice(0, 5).map((r, i) =>
      h("div", { class: "member" }, h("b", {}, `#${i + 1}`), racketIcon(r, true), r.name, rarityBadge(r.rarity), h("span", { class: "muted" }, `${statTotal(r.id)} total`))));

  const tabs = [["Ranked", ranked], ["Leagues", league], ["Meta", meta]];
  const body = h("div", {}), bar = h("div", { class: "tabs" });
  const show = (k) => { body.innerHTML = ""; body.append(tabs[k][1]); bar.querySelectorAll("button").forEach((b, j) => b.classList.toggle("on", j === k)); };
  tabs.forEach(([n], k) => bar.append(h("button", { onclick: () => { sfx.ui(); show(k); } }, n)));
  const pn = panel(host, "Ranked & Leagues", null, bar, body); show(0);
  return pn;
}

// ---------------------------------------------------------------- end-of-match rewards (returns a DOM block)
export function matchRewards(r, cfg) {
  if (r.aborted) return null;
  const won = !!r.won, lines = [];
  const yen = payout(r, cfg);
  update((p) => { p.yen += yen; });
  lines.push(h("span", { class: "chip yen" }, `+¥${yen}`));
  if (cfg.type === "ranked" || cfg.type === "rankedBot") {
    const p = profile();
    const opp = cfg.type === "ranked" ? (cfg.oppRating || p.rating) : botRatingFor(cfg.level);
    const d = eloDelta(p.rating, opp, won, cfg.type === "ranked" ? 32 : 16);
    const before = rankOf(p.rating);
    update((q) => { q.rating = Math.max(0, q.rating + d); won ? q.ranked.w++ : q.ranked.l++; });
    const after = rankOf(profile().rating);
    lines.push(h("span", { class: "chip", style: `color:${d >= 0 ? "#7dffb0" : "#ff8aa5"}` }, `${d >= 0 ? "+" : ""}${d} rating`));
    if (after !== before) lines.push(h("span", { class: "chip", style: `color:${after.color}` }, after.min > before.min ? `RANK UP: ${after.name}!` : `Down to ${after.name}`));
  }
  if (cfg.type === "league") {
    const pts = won ? 3 : 1;
    update((q) => { q.league.pts += pts; won ? q.league.w++ : q.league.l++; });
    lines.push(h("span", { class: "chip" }, `+${pts} league pts`));
  }
  return h("div", { class: "chips" }, ...lines);
}
