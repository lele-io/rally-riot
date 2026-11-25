import { binds, keyName } from "./keybinds.js";

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
      h("div", { class: "servehint" }), h("div", { class: "crosshair" }), h("div", { class: "lockbadge" }, "Click to grab the camera"),
      h("div", { class: "meters" },
        h("div", { class: "meter charge" }, h("i"), h("span", {}, "POWER")),
        h("div", { class: "meter dash" }, h("i"), h("span", {}, "DASH  " + keyName(binds().dash)))),
      h("div", { class: "offarrow" }, h("span", { class: "tip" }), h("b", {})),
      h("div", { class: "keys" }, keyHint()));
    // leave-match button (click twice); the Game wires it up with onMenu()
    this.menuBtn = h("button", { class: "menubtn", title: "Back to the menu" }, "☰ MENU");
    this.root.append(this.menuBtn);
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
  // arrow at the screen edge pointing at an off-screen shuttle (x, y in NDC; angle in rad), with its height
  offscreen(show, x, y, ang, height) {
    const a = this.arrow || (this.arrow = $(".offarrow", this.root));
    a.classList.toggle("show", show);
    if (!show) return;
    a.style.left = (x * 0.5 + 0.5) * 100 + "%"; a.style.top = (-y * 0.5 + 0.5) * 100 + "%";
    a.firstChild.style.transform = `rotate(${-ang}rad)`;
    a.lastChild.textContent = height > 0.5 ? height.toFixed(0) + "m" : "";
  }
  onMenu(fn) {
    let armed = 0;
    const label = () => "☰ MENU  " + keyName(binds().menu);
    this.menuBtn.textContent = label();
    this.menuBtn.onclick = (e) => {
      e.stopPropagation();
      if (armed) { clearTimeout(armed); fn(); return; }
      this.menuBtn.textContent = "LEAVE MATCH? CLICK AGAIN"; this.menuBtn.classList.add("armed");
      armed = setTimeout(() => { armed = 0; this.menuBtn.textContent = label(); this.menuBtn.classList.remove("armed"); }, 2500);
    };
  }
  lockState(on) { this.root.classList.toggle("unlocked", !on); }
  dispose() { this.root.remove(); }
}

function keyHint() {
  const b = binds(), mv = [b.forward, b.left, b.back, b.right].map(keyName);
  const wasd = mv.every((k) => k.length === 1) ? mv.join("") : mv.join(" ");
  return `${wasd} move · Mouse look + aim · ${keyName(b.swing)} swing (hold = power) · ${keyName(b.jump)} jump · ${keyName(b.dash)} dash · Wheel zoom · Hold ${keyName(b.cursor)} for cursor · ${keyName(b.menu)} menu`;
}
