import * as THREE from "three";
import { getModel, makeAvatar, makeRacket } from "./assets.js";
import { FX } from "./fx.js";
import { buildEnv } from "./env.js";
import { RARITY } from "./rackets.js";
import { TEAM_COLORS } from "./player.js";

// Title-screen backdrop: the shrine island at golden hour with your character posing on the right
// (holding the equipped racket). The summon cutscene plays at the shrine. Menus are DOM (main.js / screens.js).
const IDLE_PORTAL = new THREE.Color("#8fe8ff");

export class Lobby {
  constructor(game) {
    this.game = game;
    this.scene = new THREE.Scene();
    this.env = buildEnv(this.scene, { shadowSize: 16, sunDir: new THREE.Vector3(0.6, 0.45, 0.65) });
    const lobby = getModel("lobby"); this.scene.add(lobby);
    this.crystal = lobby.getObjectByName("Crystal");
    lobby.traverse((o) => { if (o.isMesh && o.material.name === "Portal") { o.material = o.material.clone(); this.portalMat = o.material; } });
    // a soft glowing pane inside the shrine ring
    this.pane = new THREE.Mesh(new THREE.CircleGeometry(1.5, 40), new THREE.MeshBasicMaterial({ color: IDLE_PORTAL, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.pane.position.set(0, 3.2, -7); this.scene.add(this.pane);
    this.glow = new THREE.PointLight(IDLE_PORTAL, 10, 12, 1.6); this.glow.position.set(0, 3.2, -6.2); this.scene.add(this.glow);
    this.fx = new FX(this.scene);

    this.setLook(game.look());

    this.camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 1000);
    this.camPos = new THREE.Vector3(); this.camLook = new THREE.Vector3();
    this.menuOpen = false; this.summonSeq = null; this.time = 0; this.flourish = 3;
    this.frame(true);
  }

  setLook(look) {
    const old = this.avatar;
    if (old) { this.scene.remove(old); if (this.racket) this.hand.remove(this.racket); }
    this.avatar = makeAvatar(look, TEAM_COLORS[0]); this.scene.add(this.avatar);
    this.avatar.position.set(1.6, 0, 3.2); this.avatar.rotation.y = old ? old.rotation.y : -0.35;
    this.armR = this.avatar.getObjectByName("ArmR"); this.armL = this.avatar.getObjectByName("ArmL");
    this.hand = this.avatar.getObjectByName("HandR");
    this.racket = null; this.setRacket(this.racketId || this.game.equipped());
  }

  setRacket(id) {
    this.racketId = id;
    if (this.racket) this.hand.remove(this.racket);
    this.racket = makeRacket(id); this.racket.rotation.x = Math.PI; this.racket.position.y = 0.06; this.racket.scale.setScalar(1.35);
    this.hand.add(this.racket);
  }

  // where the camera wants to be: wide shot with the character on the right; shrine close-up while summoning
  frame(snap) {
    const wide = innerWidth / innerHeight > 1.1;
    let want, look;
    if (this.summonSeq) { const w = wide ? 2.2 : 0; want = new THREE.Vector3(w, 3.3, 2.4); look = new THREE.Vector3(w * 0.55, 3.0, -7); }
    else if (this.closeup) { const w = wide ? -1.1 : 0; want = new THREE.Vector3(1.6 + w, 1.55, 6.6); look = new THREE.Vector3(1.6 + w, 1.05, 3.2); }
    else if (wide) { want = new THREE.Vector3(-0.4, 2.1, 9.4); look = new THREE.Vector3(-0.9, 1.9, 0); }
    else { want = new THREE.Vector3(1.6, 1.8, 8.6); look = new THREE.Vector3(1.6, 1.4, 0); }
    if (snap) { this.camPos.copy(want); this.camLook.copy(look); }
    return [want, look];
  }

  update(dt) {
    this.time += dt;
    this.game.input.endTick();
    // idle: breathe, sway the racket, and every few seconds show off with a swing
    const a = this.avatar, t = this.time;
    a.position.y = Math.abs(Math.sin(t * 1.6)) * 0.02;
    this.flourish -= dt;
    let armT = 3.9 + Math.sin(t * 1.3) * 0.08;
    if (this.flourish < 0.6 && this.flourish > 0) armT = this.flourish > 0.35 ? 2.6 : 6.1;
    if (this.flourish < 0) { this.flourish = 5 + Math.random() * 3; }
    if (this.flourish > 0.2 && this.flourish < 0.35) a.position.y += 0.15;
    this.armR.rotation.x += (armT - this.armR.rotation.x) * Math.min(1, dt * (this.flourish < 0.6 ? 18 : 6));
    this.armL.rotation.x = Math.sin(t * 1.3) * 0.1;
    a.rotation.y = -0.35 + Math.sin(t * 0.5) * 0.08;

    this.crystal.rotation.y += dt * (this.summonSeq ? 8 : 0.8);
    this.crystal.position.y = Math.sin(t * 1.6) * 0.12;
    if (this.summonSeq) this.updateSummon(dt);
    else {
      this.portalMat.emissive.lerp(IDLE_PORTAL, dt * 2); this.glow.color.copy(this.portalMat.emissive);
      this.pane.material.color.copy(this.portalMat.emissive); this.pane.material.opacity = 0.2 + Math.sin(t * 2) * 0.05;
    }
    this.fx.update(dt, new THREE.Vector3(), false);
    this.env.update(dt);

    const [want, look] = this.frame(false);
    const k = 1 - Math.exp(-dt * (this.summonSeq ? 3 : 4));
    this.camPos.lerp(want, k); this.camLook.lerp(look, k);
    const sk = this.fx.shakeAmt;
    this.camera.position.copy(this.camPos).add(new THREE.Vector3((Math.random() - 0.5) * sk, (Math.random() - 0.5) * sk, 0));
    this.camera.position.x += Math.sin(t * 0.25) * 0.15; // slow drift keeps the scene alive
    this.camera.lookAt(this.camLook);
  }

  // ---- summon cutscene: charge the shrine (color hints rarity late), burst, racket rises out
  playSummon(racket, onReveal) {
    const col = new THREE.Color(RARITY[racket.rarity].color);
    if (this.shown) { this.scene.remove(this.shown); this.shown = null; }
    this.summonSeq = { t: 0, racket, col, onReveal, revealed: false, tier: RARITY[racket.rarity].tier };
  }
  updateSummon(dt) {
    const s = this.summonSeq; s.t += dt;
    const center = new THREE.Vector3(0, 3.2, -7);
    if (!s.revealed) {
      const f = Math.min(1, s.t / 1.7);
      const tease = s.tier >= 4 && f > 0.4 && f < 0.75 ? new THREE.Color("#ffd23d") : s.col;
      this.portalMat.emissive.copy(IDLE_PORTAL.clone().lerp(tease, Math.max(0, f * 2 - 0.6)));
      this.portalMat.emissiveIntensity = 4 + f * 4;
      this.glow.color.copy(this.portalMat.emissive); this.glow.intensity = 8 + f * 10;
      this.pane.material.color.copy(this.portalMat.emissive); this.pane.material.opacity = 0.25 + f * 0.45;
      if (Math.random() < 0.5 + f) this.fx.emit(center.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3.4, (Math.random() - 0.5) * 3.4, 0)), this.portalMat.emissive, 1, 0.8, 0.5, 0, 0);
      this.fx.shake(f * 0.06);
      if (s.t >= 1.7) {
        s.revealed = true; s.t = 0;
        this.fx.emit(center, s.col, 120 + s.tier * 60, 7 + s.tier * 2, 1.2, 0, 2); this.fx.emit(center, "#ffffff", 40, 4, 0.5);
        this.fx.ring(center, s.col, 5 + s.tier, 0.7, false); this.fx.shake(0.15 + s.tier * 0.08);
        this.shown = makeRacket(s.racket.id); this.shown.scale.setScalar(4.2);
        this.shown.position.set(0, 0.3, -7); this.scene.add(this.shown);
        s.onReveal && s.onReveal();
      }
    } else {
      this.portalMat.emissiveIntensity += (4 - this.portalMat.emissiveIntensity) * dt * 3;
      this.pane.material.opacity += (0.3 - this.pane.material.opacity) * dt * 3;
      if (this.shown) {
        this.shown.position.y += (0.85 - this.shown.position.y) * dt * 4;
        this.shown.rotation.y += dt * 1.6;
        if (Math.random() < 0.3) this.fx.emit(center, s.col, 1, 1.5, 0.8, 0.5, 0);
      }
    }
  }
  endSummon() {
    this.summonSeq = null; if (this.shown) { this.scene.remove(this.shown); this.shown = null; }
    this.portalMat.emissiveIntensity = 4;
  }

  resize(w, h) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  dispose() { this.fx.dispose(); this.env.dispose(); }
}
