import * as THREE from "three";
import { getModel, makeAvatar, makeRacket } from "./assets.js";
import { FX } from "./fx.js";
import { RARITY } from "./rackets.js";
import { TEAM_COLORS } from "./player.js";

// The hub: walk around a plaza; the altar summons rackets, the rack is the loadout, the kiosk is the
// shop, the gate starts a match. Menus are DOM overlays driven by main.js (`hub` callbacks).
export const SPOTS = [
  { id: "summon", label: "Summon Altar", x: 0, z: -5.2, r: 3.4 },
  { id: "shop", label: "Shop & Codes", x: 7.2, z: 2, r: 2.8 },
  { id: "loadout", label: "Racket Rack", x: -7, z: 2, r: 2.8 },
  { id: "play", label: "Arena Gate", x: 0, z: 9, r: 3 },
];

export class Lobby {
  constructor(game, hub) {
    this.game = game; this.hub = hub;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#120d24");
    this.scene.fog = new THREE.Fog("#120d24", 22, 55);
    const lobby = getModel("lobby"); this.scene.add(lobby);
    this.crystal = lobby.getObjectByName("Crystal");
    lobby.traverse((o) => { if (o.isMesh && o.material.name === "Portal") { o.material = o.material.clone(); o.material.emissiveIntensity = 4; this.portalMat = o.material; } });
    this.scene.add(new THREE.HemisphereLight("#c9b8ff", "#1a1030", 0.8));
    const sun = new THREE.DirectionalLight("#ffe6f2", 1.4); sun.position.set(6, 14, 8); sun.castShadow = true; sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.03;
    sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14 });
    this.scene.add(sun);
    const glow = new THREE.PointLight("#b06bff", 20, 14, 1.5); glow.position.set(0, 3.2, -6); this.scene.add(glow); this.glow = glow;
    this.stars();

    this.fx = new FX(this.scene);
    this.pos = new THREE.Vector3(0, 0, 3); this.vel = new THREE.Vector3(); this.yaw = Math.PI; this.animT = 0;
    this.avatar = makeAvatar(TEAM_COLORS[0]); this.scene.add(this.avatar);
    this.armR = this.avatar.getObjectByName("ArmR"); this.hand = this.avatar.getObjectByName("HandR");
    this.legs = [this.avatar.getObjectByName("LegL"), this.avatar.getObjectByName("LegR")];
    this.setRacket(hub.equipped());

    this.camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 200);
    this.camPos = new THREE.Vector3(0, 6, 13); this.camLook = new THREE.Vector3(0, 1.5, -2);
    this.spot = null; this.menuOpen = false; this.summonSeq = null; this.time = 0;
  }

  stars() {
    const g = new THREE.BufferGeometry(), n = 500, p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 0.9 + 0.05, r = 60;
      p[i * 3] = Math.cos(a) * Math.cos(e) * r; p[i * 3 + 1] = Math.sin(e) * r; p[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r;
    }
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    this.scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: "#ffffff", size: 0.25, fog: false })));
  }

  setRacket(id) {
    if (this.racket) this.hand.remove(this.racket);
    this.racket = makeRacket(id); this.racket.rotation.x = Math.PI; this.racket.position.y = 0.06; this.racket.scale.setScalar(1.35);
    this.hand.add(this.racket);
  }

  update(dt) {
    this.time += dt;
    const inp = this.game.input;
    // walk (camera looks toward -z, so W = -z)
    let mx = 0, mz = 0;
    if (!this.menuOpen && !this.summonSeq) {
      if (inp.down("KeyW")) mz -= 1; if (inp.down("KeyS")) mz += 1;
      if (inp.down("KeyA")) mx -= 1; if (inp.down("KeyD")) mx += 1;
      if (inp.pressed("KeyE") && this.spot) this.hub.open(this.spot.id);
    }
    const l = Math.hypot(mx, mz) || 1, sp = 6;
    this.vel.x += ((mx / l) * sp - this.vel.x) * Math.min(1, dt * 12);
    this.vel.z += ((mz / l) * sp - this.vel.z) * Math.min(1, dt * 12);
    this.pos.addScaledVector(this.vel, dt);
    const r = Math.hypot(this.pos.x, this.pos.z); if (r > 11.5) this.pos.multiplyScalar(11.5 / r);
    if (Math.hypot(this.pos.x, this.pos.z + 7) < 3.3) { const a = Math.atan2(this.pos.z + 7, this.pos.x); this.pos.x = Math.cos(a) * 3.3; this.pos.z = -7 + Math.sin(a) * 3.3; }
    inp.endTick();
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (speed > 0.3) this.yaw = Math.atan2(this.vel.x, this.vel.z);
    if (this.menuOpen && !this.summonSeq) this.yaw = 0.35; // face the camera to show off the racket
    this.avatar.position.copy(this.pos);
    let dy = this.yaw - this.avatar.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.avatar.rotation.y += dy * Math.min(1, dt * 10);
    this.animT += dt * (3 + speed * 1.8);
    const sw = Math.sin(this.animT) * 0.7 * Math.min(1, speed / 5);
    this.legs[0].rotation.x = sw; this.legs[1].rotation.x = -sw;
    const armT = this.menuOpen && !this.summonSeq ? 3.75 : 5.6 + Math.sin(this.time * 2) * 0.05 - sw * 0.3;
    this.armR.rotation.x += (armT - this.armR.rotation.x) * Math.min(1, dt * 8);
    this.avatar.position.y = Math.abs(Math.sin(this.animT)) * 0.05 * Math.min(1, speed / 5);

    // nearest hotspot
    let near = null;
    for (const s of SPOTS) if (Math.hypot(this.pos.x - s.x, this.pos.z - s.z) < s.r) near = s;
    if (near !== this.spot) { this.spot = near; this.hub.spot(near); }

    // altar idle animation
    this.crystal.rotation.y += dt * (this.summonSeq ? 8 : 0.8);
    this.crystal.position.y = Math.sin(this.time * 1.6) * 0.12;
    if (this.summonSeq) this.updateSummon(dt);
    else { this.portalMat.emissive.lerp(new THREE.Color("#b25cff"), dt * 2); this.glow.color.copy(this.portalMat.emissive); }
    this.fx.update(dt, new THREE.Vector3(), false);

    // camera
    let want, look;
    if (this.summonSeq) { const w = innerWidth > 800 ? 2.2 : 0; want = new THREE.Vector3(w, 3.3, 2.4); look = new THREE.Vector3(w * 0.55, 3.0, -7); }
    else if (this.menuOpen) {
      // close-up from the front; on wide screens push the avatar left of the drawer
      const off = innerWidth > 800 ? 1.25 : 0;
      want = new THREE.Vector3(this.pos.x + 1.0 + off * 1.05, 2.3, this.pos.z + 5.4); look = new THREE.Vector3(this.pos.x + off * 1.05, 1.45, this.pos.z);
    }
    else { want = new THREE.Vector3(this.pos.x * 0.6, 5.2, this.pos.z + 9.5); look = new THREE.Vector3(this.pos.x * 0.8, 1.4, this.pos.z - 3); }
    const k = 1 - Math.exp(-dt * (this.summonSeq ? 3 : 5));
    this.camPos.lerp(want, k); this.camLook.lerp(look, k);
    const sk = this.fx.shakeAmt;
    this.camera.position.copy(this.camPos).add(new THREE.Vector3((Math.random() - 0.5) * sk, (Math.random() - 0.5) * sk, 0));
    this.camera.lookAt(this.camLook);
  }

  // ---- summon cutscene: charge the portal (color hints rarity late), burst, racket rises out
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
      // early it's always purple; in the last half it shifts to the rarity color (higher tiers flicker gold first)
      const tease = s.tier >= 4 && f > 0.4 && f < 0.75 ? new THREE.Color("#ffd23d") : s.col;
      this.portalMat.emissive.copy(new THREE.Color("#b25cff").lerp(tease, Math.max(0, f * 2 - 0.6)));
      this.portalMat.emissiveIntensity = 4 + f * 5;
      this.glow.color.copy(this.portalMat.emissive); this.glow.intensity = 14 + f * 18;
      if (Math.random() < 0.5 + f) this.fx.emit(center.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3.6, (Math.random() - 0.5) * 3.6, 0)), this.portalMat.emissive, 1, 0.8, 0.5, 0, 0);
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
      this.glow.intensity += (16 - this.glow.intensity) * dt * 3;
      if (this.shown) {
        this.shown.position.y += (0.85 - this.shown.position.y) * dt * 4;
        this.shown.rotation.y += dt * 1.6;
        if (Math.random() < 0.3) this.fx.emit(new THREE.Vector3(0, 3.2, -7), s.col, 1, 1.5, 0.8, 0.5, 0);
      }
    }
  }
  endSummon() {
    this.summonSeq = null; if (this.shown) { this.scene.remove(this.shown); this.shown = null; }
    this.portalMat.emissiveIntensity = 4; this.glow.intensity = 14;
  }

  resize(w, h) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  dispose() { this.fx.dispose(); }
}
