import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import "./style.css";
import { loadAssets } from "./assets.js";
import { Input } from "./input.js";
import { Match } from "./match.js";
import { Lobby } from "./lobby.js";
import { MatchHUD, h } from "./ui.js";
import { openLoadout, openSummon, openPlay, panel, racketIcon, rarityBadge } from "./screens.js";
import { RACKET, randomRacket } from "./rackets.js";
import { profile, update } from "./save.js";
import { audioUnlock, sfx } from "./sfx.js";
import { privateTab } from "./online.js";
import { openShop, matchRewards } from "./economy.js";

const BOT_NAMES = ["Shuttlebug", "Netrunner", "Lobzilla", "Dropkick", "Feathers", "Smashley", "Rallycat", "Birdie Sanders", "Topspinner", "Clearwater", "Backhand Bo", "Kit Kourt"];

// warm painterly grade: slight vignette, lifted shadows toward violet, gentle saturation
const GradeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(vec3(l), c.rgb, 1.22);
      c.rgb = (c.rgb - 0.5) * 1.08 + 0.5;
      c.rgb += vec3(0.035, 0.015, 0.06) * (1.0 - l);
      vec2 d = vUv - 0.5; c.rgb *= 1.0 - dot(d, d) * 0.55;
      gl_FragColor = c;
    }`,
};

const ICON = {
  play: `<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/></svg>`,
  friends: `<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.6" fill="currentColor"/><circle cx="17" cy="9" r="2.8" fill="currentColor"/><path d="M2.5 20c0-4 3-6.5 6.5-6.5s6.5 2.5 6.5 6.5zM15.5 20c0-2.4-.8-4.3-2.2-5.6 1-.6 2.2-.9 3.4-.9 3 0 5 2.2 5 6.5z" fill="currentColor"/></svg>`,
  shop: `<svg viewBox="0 0 24 24"><path d="M3 4h3l2.2 10.5h10.3L21 7H7.2" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/><circle cx="9.5" cy="19" r="1.8" fill="currentColor"/><circle cx="17" cy="19" r="1.8" fill="currentColor"/></svg>`,
  summon: `<svg viewBox="0 0 24 24"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4z" fill="currentColor"/></svg>`,
  loadout: `<svg viewBox="0 0 24 24"><ellipse cx="10" cy="9" rx="5.5" ry="6.5" transform="rotate(-35 10 9)" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M14 14l6.5 6.5" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`,
  help: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9.3 9.2a2.8 2.8 0 1 1 3.9 2.6c-.8.4-1.2 1-1.2 1.9v.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="17.3" r="1.2" fill="currentColor"/></svg>`,
};
const icon = (k) => { const s = h("span", { class: "ico" }); s.innerHTML = ICON[k]; return s; };

class Game {
  async start() {
    const canvas = document.getElementById("c");
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;
    this.ui = document.getElementById("ui");
    this.input = new Input(canvas);
    addEventListener("pointerdown", audioUnlock);
    addEventListener("keydown", audioUnlock);

    const bar = document.querySelector("#loading .bar i");
    await RAPIER.init();
    this.RAPIER = RAPIER;
    await loadAssets((f) => (bar.style.width = f * 100 + "%"));
    document.getElementById("loading").classList.add("done");

    addEventListener("resize", () => this.resize());
    this.view = null;
    this.last = performance.now();
    window.__game = this; // handy for testing in the console
    this.goTitle();
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  equipped() { return profile().equipped; }

  setView(view) {
    if (this.view) this.view.dispose();
    this.view = view;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(view.scene, view.camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.4, 0.45, 1.15));
    this.composer.addPass(new ShaderPass(GradeShader));
    this.composer.addPass(new OutputPass());
    this.resize();
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer?.setSize(innerWidth, innerHeight);
    this.view?.resize(innerWidth, innerHeight);
  }

  frame(t) {
    const dt = Math.min(0.1, (t - this.last) / 1000); this.last = t;
    if (this.view) { this.view.update(dt); this.composer.render(); }
  }

  clearUI() { this.ui.innerHTML = ""; this.ui.classList.remove("cine", "panel-open"); }

  toast(text) {
    const t = h("div", { class: "toast" }, text); document.body.append(t);
    setTimeout(() => t.classList.add("out"), 4500); setTimeout(() => t.remove(), 5000);
  }

  // ---------------------------------------------------------------- title screen
  goTitle() {
    this.clearUI(); this.menu = null;
    const lobby = new Lobby(this);
    this.lobby = lobby;
    this.setView(lobby);
    this.topbar = h("div", { class: "topbar" });
    const big = (cls, ic, label, id) => h("button", { class: "tbtn " + cls, onclick: () => { sfx.ui(); this.openMenu(id); } }, h("span", { class: "tin" }, icon(ic), label));
    const small = (cls, ic, label, id) => h("button", { class: "sbtn " + cls, onclick: () => { sfx.ui(); this.openMenu(id); } }, h("span", { class: "tin" }, icon(ic), label));
    this.ui.append(
      this.topbar,
      h("div", { class: "title" },
        h("div", { class: "logo big" }, h("span", { class: "l1" }, "RALLY"), h("span", { class: "l2" }, "RIOT")),
        h("div", { class: "tbtns" },
          big("go", "play", "PLAY", "play"),
          big("friends", "friends", "PLAY WITH FRIENDS", "friends"),
          h("button", { class: "howto", onclick: () => { sfx.ui(); this.openMenu("howto"); } }, icon("help"), h("u", {}, "How to play")))),
      h("div", { class: "bottombar" },
        small("shop", "shop", "SHOP", "shop"),
        small("summon", "summon", "SUMMON", "summon"),
        small("loadout", "loadout", "LOADOUT", "loadout")));
    this.drawTopbar();
  }

  drawTopbar() {
    if (!this.topbar) return;
    const p = profile(), r = RACKET[p.equipped];
    const name = h("input", { class: "name", value: p.name, maxlength: 16, title: "Your name — click to change",
      onchange: (e) => update((q) => (q.name = e.target.value.trim().slice(0, 16) || q.name)) });
    this.topbar.innerHTML = "";
    this.topbar.append(
      h("div", { class: "wallet" },
        h("span", { class: "cur yen", title: "Yen" }, "¥ ", h("b", {}, p.yen.toLocaleString())),
        h("span", { class: "cur spin", title: "Spins" }, "✦ ", h("b", {}, p.spins)),
        h("span", { class: "cur lucky", title: "Lucky Spins" }, "❖ ", h("b", {}, p.lucky))),
      h("div", { class: "me" }, racketIcon(r), h("div", {}, name, h("div", { class: "eqr" }, r.name, " ", rarityBadge(r.rarity)))));
  }

  openMenu(id) {
    if (this.menu) this.menu.close();
    const L = this.lobby; if (!L) return;
    L.menuOpen = true; this.ui.classList.add("panel-open");
    let pn;
    if (id === "loadout") pn = openLoadout(this.ui, L, () => this.drawTopbar());
    else if (id === "summon") pn = openSummon(this.ui, L, () => this.drawTopbar());
    else if (id === "play") pn = openPlay(this.ui, (cfg) => { pn.close(); this.startMatch(cfg); });
    else if (id === "friends") pn = panel(this.ui, "Play with Friends", null, privateTab(this));
    else if (id === "shop") pn = openShop(this.ui, () => this.drawTopbar());
    else if (id === "howto") pn = panel(this.ui, "How to play", null, howTo());
    pn.wrap.classList.add("panel-" + id);
    const c = pn.close;
    pn.close = () => { c(); L.menuOpen = false; this.ui.classList.remove("panel-open"); if (this.menu === pn) this.menu = null; };
    pn.wrap.querySelector(".x").onclick = () => { sfx.ui(); pn.close(); };
    this.menu = pn;
  }

  // ---------------------------------------------------------------- matches
  botPlayers(size, level, myTeamBots) {
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    const tier = level < 0.3 ? 1 : level < 0.7 ? 3 : 5;
    const out = [];
    for (let i = 0; i < myTeamBots; i++) out.push({ id: "bt" + i, name: names.pop(), team: 0, racket: randomRacket(tier), kind: "bot", level });
    for (let i = 0; i < size; i++) out.push({ id: "bo" + i, name: names.pop(), team: 1, racket: randomRacket(tier), kind: "bot", level });
    return out;
  }

  startMatch(cfg) {
    const p = profile();
    this.clearUI(); this.lobby = null; this.menu = null; this.topbar = null;
    const players = cfg.players || [{ id: "me", name: p.name, team: 0, racket: p.equipped, kind: "local" }, ...this.botPlayers(cfg.size, cfg.level, cfg.size - 1)];
    const names = cfg.names || (cfg.size === 1 ? [p.name, players[1].name] : ["YOUR TEAM", "RIVALS"]);
    const localTeam = players.find((q) => q.id === (cfg.localId || "me"))?.team || 0;
    const hud = new MatchHUD(this.ui, names, localTeam === 1);
    const m = new Match(this, {
      teamSize: cfg.size, localId: cfg.localId || "me", pointsToWin: cfg.points || (cfg.size === 1 ? 11 : 15), ui: hud, players,
      net: cfg.net, isHost: cfg.isHost,
      onEnd: (r) => setTimeout(() => this.endScreen(r, cfg), 1200),
    });
    const d = m.dispose.bind(m); m.dispose = () => { hud.dispose(); d(); };
    this.setView(m);
    return m;
  }

  endScreen(r, cfg) {
    const won = r.won;
    if (!r.aborted) update((q) => { q.stats.matches++; if (won) q.stats.wins++; q.stats.smashes += r.stats.smashes; });
    const reward = matchRewards(r, cfg);
    this.ui.append(h("div", { class: "screen dim end" },
      h("div", { class: "card col", style: "min-width:340px;align-items:center" },
        h("div", { class: "big " + (r.aborted ? "" : won ? "win" : "lose") }, r.aborted ? "MATCH ENDED" : won ? "VICTORY" : "DEFEAT"),
        h("div", { class: "final" }, `${r.score[0]} — ${r.score[1]}`),
        h("div", { class: "chips" }, h("span", { class: "chip" }, `Hits ${r.stats.hits}`), h("span", { class: "chip" }, `Smashes ${r.stats.smashes}`), h("span", { class: "chip" }, `Longest rally ${r.stats.longest}`)),
        reward,
        h("div", { class: "row" },
          cfg.type === "casual" ? h("button", { class: "btn hot", onclick: () => this.startMatch(cfg) }, "PLAY AGAIN") : null,
          h("button", { class: "btn", onclick: () => { cfg.net?.close?.(); this.goTitle(); } }, "MENU")))));
  }
}

function howTo() {
  const k = (keys, text) => h("div", { class: "howrow" }, h("span", { class: "keycap" }, keys), h("span", {}, text));
  return h("div", { class: "col", style: "gap:10px" },
    h("div", { class: "lbl" }, "Controls"),
    k("W A S D", "Move (relative to the camera)"), k("SPACE", "Jump"), k("CLICK", "Swing — hold to charge a power swing, release to hit"),
    k("SHIFT", "Dash — goes even farther in mid-air"), k("MOUSE", "Aim: the ring on the far court is where your shot lands"),
    k("RIGHT-DRAG", "Turn the camera"), k("WHEEL", "Zoom in / out"),
    h("div", { class: "lbl", style: "margin-top:8px" }, "Tips"),
    h("ul", { class: "notes" },
      h("li", {}, "Stand near the middle of your half so you can reach anything."),
      h("li", {}, "Dash to get to the shuttle in time — jump + dash covers huge distances."),
      h("li", {}, "Jump and charge a power swing on high shuttles for a SMASH."),
      h("li", {}, "Tap-swing short to the net for a soft drop shot."),
      h("li", {}, "In 2v2 / 3v3, spread out with your team to cover the whole court."),
      h("li", {}, "Rarer rackets have better stats; Spin bends the shuttle in mid-air.")));
}

new Game().start();
