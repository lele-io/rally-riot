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
import { MatchHUD, h } from "./ui.js";
import { audioUnlock, sfx } from "./sfx.js";

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
    this.view = null; // current Match (or lobby later)
    this.last = performance.now();
    window.__game = this; // handy for testing in the console
    this.menu();
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

  // ---- phase 1: straight into a 1v1 against a bot
  menu() {
    this.clearUI();
    let level = 0.5;
    const seg = h("div", { class: "seg" }, ...[["Easy", 0.2], ["Normal", 0.5], ["Hard", 0.85]].map(([n, v]) =>
      h("button", { class: v === level ? "on" : "", onclick: (e) => { level = v; seg.querySelectorAll("button").forEach((b) => b.classList.remove("on")); e.target.classList.add("on"); sfx.ui(); } }, n)));
    this.ui.append(h("div", { class: "screen dim" },
      h("div", { class: "card col", style: "align-items:center;gap:16px;min-width:320px" },
        h("div", { class: "logo", style: "font-size:64px" }, "RALLY", h("span", {}, "RIOT")),
        seg,
        h("button", { class: "btn hot", style: "font-size:20px;padding:14px 34px", onclick: () => this.playBot(level) }, "PLAY 1v1 VS BOT"),
        h("div", { class: "muted", style: "font-size:13px;text-align:center" }, "WASD move · Space jump · Click swing (hold for power) · Q dash"))));
  }

  playBot(level = 0.5) {
    this.clearUI();
    const hud = new MatchHUD(this.ui, ["YOU", "BOT"]);
    const m = new Match(this, {
      teamSize: 1, localId: "me", pointsToWin: 11, ui: hud,
      players: [
        { id: "me", name: "You", team: 0, racket: "practice", kind: "local" },
        { id: "bot1", name: "Bot", team: 1, racket: "practice", kind: "bot", level },
      ],
      onEnd: (r) => setTimeout(() => this.endScreen(r, () => this.playBot(level)), 1200),
    });
    m.dispose = ((d) => () => { hud.dispose(); d.call(m); })(m.dispose);
    this.setView(m);
  }

  endScreen(r, again) {
    const won = r.won;
    this.ui.append(h("div", { class: "screen dim end" },
      h("div", { class: "card col", style: "min-width:340px" },
        h("div", { class: "big", style: `color:${won ? "#7dffb0" : "#ff7d9b"}` }, won ? "VICTORY" : "DEFEAT"),
        h("div", { class: "final" }, `${r.score[0]} — ${r.score[1]}`),
        h("div", { class: "chips" }, h("span", { class: "chip" }, `Hits ${r.stats.hits}`), h("span", { class: "chip" }, `Smashes ${r.stats.smashes}`), h("span", { class: "chip" }, `Longest rally ${r.stats.longest}`)),
        h("div", { class: "row" }, h("button", { class: "btn hot", onclick: again }, "REMATCH"), h("button", { class: "btn", onclick: () => { this.view?.dispose(); this.view = null; this.menu(); } }, "MENU")))));
  }
}

new Game().start();
