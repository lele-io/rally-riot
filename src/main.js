import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
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

const BOT_NAMES = ["Shuttlebug", "Netrunner", "Lobzilla", "Dropkick", "Feathers", "Smashley", "Rallycat", "Birdie Sanders", "Topspinner", "Clearwater", "Backhand Bo", "Kit Kourt"];

class Game {
  async start() {
    const canvas = document.getElementById("c");
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
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
    this.goLobby();
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  setView(view) {
    if (this.view) this.view.dispose();
    this.view = view;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(view.scene, view.camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.45, 0.45, 0.92));
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

  clearUI() { this.ui.innerHTML = ""; }

  // ---------------------------------------------------------------- lobby
  goLobby() {
    this.clearUI();
    const prompt = h("div", { class: "spotprompt" });
    const hub = {
      equipped: () => profile().equipped,
      spot: (s) => { prompt.textContent = s ? `Press E — ${s.label}` : ""; prompt.classList.toggle("show", !!s); },
      open: (id) => this.openMenu(id),
    };
    const lobby = new Lobby(this, hub);
    this.lobby = lobby;
    this.setView(lobby);
    this.topbar = h("div", { class: "topbar" });
    const nav = h("div", { class: "nav" },
      ...[["play", "PLAY", "hot"], ["summon", "SUMMON", "cool"], ["loadout", "LOADOUT", ""], ["shop", "SHOP & CODES", ""], ["ranked", "RANKED & LEAGUES", ""]].map(([id, label, cls]) =>
        h("button", { class: "btn " + cls, onclick: () => { sfx.ui(); this.openMenu(id); } }, label)));
    this.ui.append(this.topbar, nav, prompt, h("div", { class: "keys lobbykeys" }, "WASD walk · E interact"));
    this.drawTopbar();
  }

  drawTopbar() {
    if (!this.topbar) return;
    const p = profile(), r = RACKET[p.equipped];
    const name = h("input", { class: "name", value: p.name, maxlength: 16, title: "Your name",
      onchange: (e) => update((q) => (q.name = e.target.value.trim().slice(0, 16) || q.name)) });
    this.topbar.innerHTML = "";
    this.topbar.append(
      h("div", { class: "me" }, racketIcon(r), h("div", {}, name, h("div", { class: "eqr" }, r.name, " ", rarityBadge(r.rarity)))),
      h("div", { class: "wallet" },
        h("span", { class: "cur yen", title: "Yen" }, "¥ ", h("b", {}, p.yen.toLocaleString())),
        h("span", { class: "cur spin", title: "Spins" }, "◎ ", h("b", {}, p.spins)),
        h("span", { class: "cur lucky", title: "Lucky Spins" }, "✦ ", h("b", {}, p.lucky))));
  }

  openMenu(id) {
    if (this.menu) this.menu.close();
    const L = this.lobby; if (!L) return;
    L.menuOpen = true;
    let pn;
    if (id === "loadout") pn = openLoadout(this.ui, L, () => this.drawTopbar());
    else if (id === "summon") pn = openSummon(this.ui, L, () => this.drawTopbar());
    else if (id === "play") pn = openPlay(this.ui, (cfg) => { pn.close(); this.startMatch(cfg); }, this.extraPlayTabs ? this.extraPlayTabs() : []);
    else if (this.extraMenus && this.extraMenus[id]) pn = this.extraMenus[id]();
    else pn = panel(this.ui, id === "shop" ? "Shop & Codes" : "Ranked & Leagues", null, h("div", { class: "muted" }, "Opening soon."));
    const c = pn.close;
    pn.close = () => { c(); L.menuOpen = false; if (this.menu === pn) this.menu = null; };
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
    const hud = new MatchHUD(this.ui, names);
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
    update((q) => { q.stats.matches++; if (won) q.stats.wins++; q.stats.smashes += r.stats.smashes; });
    const reward = this.onMatchEnd ? this.onMatchEnd(r, cfg) : null; // phase 4 hooks in rewards
    this.ui.append(h("div", { class: "screen dim end" },
      h("div", { class: "card col", style: "min-width:340px;align-items:center" },
        h("div", { class: "big", style: `color:${won ? "#7dffb0" : "#ff7d9b"}` }, won ? "VICTORY" : "DEFEAT"),
        h("div", { class: "final" }, `${r.score[0]} — ${r.score[1]}`),
        h("div", { class: "chips" }, h("span", { class: "chip" }, `Hits ${r.stats.hits}`), h("span", { class: "chip" }, `Smashes ${r.stats.smashes}`), h("span", { class: "chip" }, `Longest rally ${r.stats.longest}`)),
        reward,
        h("div", { class: "row" },
          cfg.type === "casual" ? h("button", { class: "btn hot", onclick: () => this.startMatch(cfg) }, "PLAY AGAIN") : null,
          h("button", { class: "btn", onclick: () => { cfg.net?.close?.(); this.goLobby(); } }, "LOBBY")))));
  }
}

new Game().start();
