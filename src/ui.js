// DOM overlay: match HUD (score, banners, charge/dash meters) and the simple screens.
const $ = (sel, el = document) => el.querySelector(sel);
export const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "style") e.style.cssText = v;
    else if (v != null && v !== false) e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
};

export class MatchHUD {
  constructor(root, names, flip = false) {
    this.flip = flip; if (flip) names = [names[1], names[0]];
    this.root = h("div", { class: "hud" },
      h("div", { class: "scorebar" },
        h("div", { class: "team t0" }, h("span", { class: "tname" }, names[0]), h("b", { class: "s0" }, "0")),
        h("div", { class: "vs" }, "VS"),
        h("div", { class: "team t1" }, h("b", { class: "s1" }, "0"), h("span", { class: "tname" }, names[1]))),
      h("div", { class: "banner" }), h("div", { class: "pops" }),
      h("div", { class: "servehint" }),
      h("div", { class: "meters" },
        h("div", { class: "meter charge" }, h("i"), h("span", {}, "POWER")),
        h("div", { class: "meter dash" }, h("i"), h("span", {}, "DASH  Q"))),
      h("div", { class: "keys" }, "WASD move · Space jump · Click swing (hold = power) · Q dash · Mouse aims"));
    if (flip) this.root.classList.add("flip");
    root.append(this.root);
    this.bannerT = null;
  }
  score(s, serveTeam) {
    if (this.flip) { s = [s[1], s[0]]; serveTeam = serveTeam == null ? null : 1 - serveTeam; }
    $(".s0", this.root).textContent = s[0]; $(".s1", this.root).textContent = s[1];
    $(".t0", this.root).classList.toggle("serving", serveTeam === 0);
    $(".t1", this.root).classList.toggle("serving", serveTeam === 1);
  }
  banner(text, color, dur = 1.2, sub = "") {
    const b = $(".banner", this.root);
    b.innerHTML = ""; b.append(h("div", { class: "big", style: `color:${color}` }, text)); if (sub) b.append(h("div", { class: "sub" }, sub));
    b.classList.remove("show"); void b.offsetWidth; b.classList.add("show");
    clearTimeout(this.bannerT); this.bannerT = setTimeout(() => b.classList.remove("show"), dur * 1000);
  }
  pop(text, color, small) {
    const p = h("div", { class: "pop" + (small ? " small" : ""), style: `color:${color};text-shadow:0 0 18px ${color}` }, text);
    $(".pops", this.root).append(p); setTimeout(() => p.remove(), 1100);
  }
  serve(mine, name) {
    const s = $(".servehint", this.root);
    s.textContent = mine ? "YOUR SERVE — aim with the mouse, click to serve" : mine === false && name ? `${name} to serve…` : "";
    s.style.opacity = mine || name ? 1 : 0;
  }
  hud(p) {
    const ch = p.swing.st === "charge" ? p.swing.charge : 0;
    const c = $(".charge i", this.root); c.style.width = ch * 100 + "%"; c.classList.toggle("full", ch >= 1);
    const d = $(".dash i", this.root); d.style.width = (1 - p.dashCd / p.d.dashCd) * 100 + "%"; d.classList.toggle("full", p.dashCd <= 0);
  }
  dispose() { this.root.remove(); }
}
