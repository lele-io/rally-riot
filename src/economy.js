// Yen and the shop. Everything is stored in the local profile (save.js).
import { h } from "./ui.js";
import { panel } from "./screens.js";
import { profile, update } from "./save.js";
import { sfx } from "./sfx.js";

export const PRICES = { spin: 250, spin10: 2250, lucky: 1200 };

// every match pays, win or lose
export function payout(r, cfg) {
  let yen = r.won ? 120 : 45;
  yen += (r.myPoints ?? 0) * 4 + Math.min(10, r.stats.smashes) * 6 + Math.min(20, r.stats.longest) * 2;
  const mult = cfg.type === "online" ? 1.5 : 1;
  return Math.round(yen * mult * (cfg.level ? 0.7 + cfg.level * 0.6 : 1));
}

export function openShop(host, refresh) {
  const box = h("div", { class: "col", style: "gap:14px" });
  const draw = () => {
    const p = profile(), today = new Date().toISOString().slice(0, 10);
    box.innerHTML = "";
    const buy = (label, sub, cost, fn, cls) => h("button", { class: "btn shopitem " + cls, disabled: p.yen < cost, onclick: () => { update((q) => { q.yen -= cost; fn(q); }); sfx.summon(0); refresh(); draw(); } },
      h("div", {}, label), h("small", {}, sub), h("div", { class: "price" }, "¥ " + cost.toLocaleString()));
    box.append(
      h("div", { class: "shopgrid" },
        buy("SPIN", "1 summon", PRICES.spin, (q) => q.spins++, "cool"),
        buy("SPIN ×10", "10 summons · 10% off", PRICES.spin10, (q) => (q.spins += 10), "cool"),
        buy("LUCKY SPIN", "better odds", PRICES.lucky, (q) => q.lucky++, "gold")),
      p.daily === today
        ? h("div", { class: "muted" }, "Daily free Spin claimed — come back tomorrow.")
        : h("button", { class: "btn hot", onclick: () => { update((q) => { q.daily = today; q.spins++; }); sfx.summon(1); refresh(); draw(); } }, "CLAIM DAILY FREE SPIN"),
      h("div", { class: "muted", style: "font-size:13px" }, "Earn Yen from every match — win or lose. Duplicate summons refund Yen."));
  };
  draw();
  return panel(host, "Shop", null, box);
}

export function matchRewards(r, cfg) {
  if (r.aborted) return null;
  const yen = payout(r, cfg);
  update((p) => { p.yen += yen; });
  return h("div", { class: "chips" }, h("span", { class: "chip yen" }, `+¥${yen}`));
}
