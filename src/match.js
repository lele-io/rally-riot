import * as THREE from "three";
import { getModel } from "./assets.js";
import { Player } from "./player.js";
import { BotBrain } from "./bot.js";
import { FX } from "./fx.js";
import { sfx } from "./sfx.js";
import { COURT, PHYS, step, solveShot } from "./shuttle.js";
import { RACKET } from "./rackets.js";

const TICK = 1 / 60;
const SHUTTLE_SCALE = 3.2;
const HOMES = {
  1: [[5.2, 0]],
  2: [[6.2, -2.4], [6.2, 2.4]],
  3: [[6.8, -3], [6.8, 3], [3.2, 0]],
};

// opts: { teamSize, players:[{id,name,team,racket,kind:'local'|'bot'|'remote',level}], localId,
//         pointsToWin, net (online session or null), isHost, onEnd(result), ui }
export class Match {
  constructor(game, opts) {
    this.game = game; this.opts = opts; this.RAPIER = game.RAPIER; this.ui = opts.ui;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#0d0b18");
    this.scene.fog = new THREE.Fog("#0d0b18", 30, 70);
    this.world = new this.RAPIER.World({ x: 0, y: 0, z: 0 });
    this.net = opts.net || null;
    this.authority = !this.net || opts.isHost; // decides points
    this.pointsToWin = opts.pointsToWin || 11;
    this.score = [0, 0];
    this.state = "intro"; this.stateT = 0; this.flightT = 0; this.time = 0;
    this.acc = 0; this.slowmo = 0; this.hitSeq = 0;
    this.shuttle = { p: [0, 1.2, 0], v: [0, 0, 0], s: 0, t: 0, flying: false, lastTeam: null, lastHitter: null, hitId: 0, netted: false };
    this.prevShuttle = new THREE.Vector3();
    this.serveTeam = 0; this.serveIdx = [0, 0]; this.server = null;
    this.stats = { smashes: 0, hits: 0, longest: 0, rally: 0 };
    this.build();
  }

  build() {
    const s = this.scene, R = this.RAPIER, w = this.world;
    s.add(getModel("court"));
    s.add(new THREE.HemisphereLight("#bcd4ff", "#2a1f3d", 0.55));
    const sun = new THREE.DirectionalLight("#fff4e0", 1.5);
    sun.position.set(-6, 16, 8); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 10, bottom: -10, near: 1, far: 40 });
    sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.03;
    s.add(sun);
    for (const x of [-8, 0, 8]) { const l = new THREE.PointLight("#ffe9c8", 14, 20, 1.8); l.position.set(x, 8.5, 0); s.add(l); }

    // static colliders: floor, arena walls, and an invisible divider so nobody crosses the net
    const fixed = (hx, hy, hz, x, y, z) => w.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z));
    fixed(30, 0.5, 30, 0, -0.5, 0);
    fixed(0.5, 6, 30, COURT.arenaX + 0.3, 6, 0); fixed(0.5, 6, 30, -COURT.arenaX - 0.3, 6, 0);
    fixed(30, 6, 0.5, 0, 6, COURT.arenaZ - 0.2); fixed(30, 6, 0.5, 0, 6, -COURT.arenaZ + 0.2);
    fixed(0.12, 6, 30, 0, 6, 0);

    // shuttle + its shadow blob
    this.shuttleObj = getModel("shuttle"); this.shuttleObj.scale.setScalar(SHUTTLE_SCALE); s.add(this.shuttleObj);
    this.blob = new THREE.Mesh(new THREE.CircleGeometry(0.22, 20), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.45, depthWrite: false }));
    this.blob.rotation.x = -Math.PI / 2; s.add(this.blob);
    // aim reticle on the far court
    this.reticle = new THREE.Group();
    const rm = new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.85, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.52, 32), rm); ring.rotation.x = -Math.PI / 2; this.reticle.add(ring);
    this.reticleCharge = new THREE.Mesh(new THREE.RingGeometry(0.56, 0.7, 32, 1, 0, 0.01), new THREE.MeshBasicMaterial({ color: "#ffd23d", transparent: true, depthWrite: false }));
    this.reticleCharge.rotation.x = -Math.PI / 2; this.reticle.add(this.reticleCharge);
    this.reticle.position.y = 0.04; s.add(this.reticle);
    this.fx = new FX(s);

    this.players = this.opts.players.map((pd, i) => new Player(this, { ...pd, slot: i }));
    this.local = this.players.find((p) => p.id === this.opts.localId) || null;
    this.brains = new Map();
    for (const p of this.players) if (p.kind === "bot") this.brains.set(p, new BotBrain(this, p, p.level ?? 0.5));
    this.viewSide = this.local ? this.local.side : -1;
    this.aim = [-this.viewSide * 6, 0];

    this.camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 200);
    this.camPos = new THREE.Vector3(this.viewSide * 17, 8.5, 0); this.camLook = new THREE.Vector3(-this.viewSide * 1, 0.8, 0);
    this.camera.position.copy(this.camPos); this.camera.lookAt(this.camLook);
    this.ray = new THREE.Raycaster(); this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    this.resetPositions();
    this.setState("intro");
  }

  // ---------------------------------------------------------------- flow
  homeFor(p) {
    const team = this.players.filter((q) => q.team === p.team);
    const size = Math.min(3, Math.max(1, team.length));
    const h = HOMES[size][team.indexOf(p) % HOMES[size].length];
    return [p.side * h[0], h[1] * (p.side < 0 ? 1 : -1)];
  }

  resetPositions() {
    const team = this.players.filter((q) => q.team === this.serveTeam);
    this.server = team[this.serveIdx[this.serveTeam] % team.length] || null;
    for (const p of this.players) {
      const h = this.homeFor(p);
      if (p === this.server) p.place(p.side * 6.5, this.serveZ());
      else if (p.team === this.serveTeam && Math.hypot(h[0] - p.side * 6.5, h[1] - this.serveZ()) < 2) p.place(p.side * 3.6, -Math.sign(this.serveZ()) * 2.6);
      else p.place(h[0], h[1]);
      p.locked = false;
    }
    const sh = this.shuttle;
    sh.flying = false; sh.lastTeam = null; sh.lastHitter = null; sh.netted = false; sh.s = 0; sh.t = 0;
    this.fx.clearTrail();
    this.stats.rally = 0;
  }

  serveZ() { return (this.score[this.serveTeam] % 2 ? -1.8 : 1.8) * (this.serveTeam === 0 ? 1 : -1); }

  setState(st, data) {
    this.state = st; this.stateT = 0;
    if (st === "serve") { this.resetPositions(); if (this.server) this.server.locked = true; this.ui?.serve(this.server === this.local, this.server?.name); }
    if (st === "intro") this.ui?.banner("FIRST TO " + this.pointsToWin, "#fff", 1.4);
    this.ui?.score(this.score, this.serveTeam);
  }

  // ---------------------------------------------------------------- per-tick
  update(dt) {
    this.slowmo = Math.max(0, this.slowmo - dt);
    const scale = this.slowmo > 0 ? 0.35 : 1;
    this.acc += Math.min(dt, 0.1) * scale;
    while (this.acc >= TICK) { this.tick(TICK); this.acc -= TICK; }
    this.render(dt, this.acc / TICK);
  }

  tick(dt) {
    this.time += dt; this.stateT += dt;
    const input = this.game.input;
    if (this.state === "intro" && this.stateT > 1.6) this.setState("serve");
    if (this.state === "point" && this.stateT > 1.8 && this.authority) {
      if (this.winner() != null) this.finish(); else { this.setState("serve"); this.net?.send({ k: "serve", serveTeam: this.serveTeam, serveIdx: this.serveIdx, score: this.score }); }
    }

    // inputs
    for (const p of this.players) {
      let inp = null;
      if (p === this.local) inp = this.localInput(input);
      else if (p.kind === "bot") inp = this.brains.get(p).think(dt);
      if (inp) p.update(dt, inp);
    }
    input.endTick();
    this.world.step();

    // shuttle: hovering in the server's hand, or flying
    const sh = this.shuttle;
    this.prevShuttle.set(...sh.p);
    if (!sh.flying) {
      const sv = this.server || this.players[0], hc = sv.hitCenter();
      sh.p = [hc.x + sv.facing.x * 0.2, 1.15, hc.z + sv.facing.z * 0.2]; sh.v = [0, 0, 0];
    } else {
      this.flightT += dt;
      for (let i = 0; i < 2; i++) this.stepShuttle(PHYS.dt);
    }
    this.net?.tick?.(dt);
  }

  stepShuttle(dt) {
    const sh = this.shuttle, px = sh.p[0];
    step(sh, dt);
    // net: tape catches anything crossing low
    if (!sh.netted && Math.sign(sh.p[0]) !== Math.sign(px) && sh.p[1] < COURT.netH && Math.abs(sh.p[2]) < COURT.halfW + 0.4) {
      sh.netted = true; sh.p[0] = px > 0 ? 0.08 : -0.08;
      sh.v = [-sh.v[0] * 0.15, Math.min(0, sh.v[1]) * 0.2, sh.v[2] * 0.2]; sh.s = 0; sh.t = 0;
      this.fx.emit(new THREE.Vector3(...sh.p), "#ffffff", 16, 2.5, 0.4);
      this.ui?.banner("NET!", "#ffffff", 0.9);
    }
    if (this.state !== "rally" || !this.authority) { if (sh.p[1] <= 0) { sh.p[1] = 0; sh.v = [0, 0, 0]; sh.flying = false; } return; }
    const out = Math.abs(sh.p[0]) > COURT.arenaX || Math.abs(sh.p[2]) > COURT.arenaZ || sh.p[1] > COURT.ceiling;
    if (sh.p[1] <= 0 || out) {
      sh.p[1] = Math.max(0, sh.p[1]);
      const [x, , z] = sh.p;
      const inside = !out && Math.abs(x) <= COURT.halfL + 0.05 && Math.abs(z) <= COURT.halfW + 0.05;
      let winner, reason;
      if (inside) { winner = x < 0 ? 1 : 0; reason = "in"; }
      else { winner = sh.lastTeam === 0 ? 1 : 0; reason = "out"; }
      if (sh.lastTeam == null) { winner = this.serveTeam === 0 ? 1 : 0; reason = "fault"; }
      sh.flying = false; sh.v = [0, 0, 0];
      this.awardPoint(winner, reason, [x, z]);
    }
  }

  awardPoint(team, reason, at) {
    if (this.state !== "rally") return;
    this.score[team]++;
    if (team !== this.serveTeam) { this.serveTeam = team; } else this.serveIdx[team]++;
    this.stats.longest = Math.max(this.stats.longest, this.stats.rally);
    this.net?.send({ k: "point", team, reason, at, score: this.score, serveTeam: this.serveTeam, serveIdx: this.serveIdx });
    this.onPoint(team, reason, at);
  }

  onPoint(team, reason, at) {
    this.state = "point"; this.stateT = 0;
    this.shuttle.flying = false;
    const mine = this.local ? team === this.local.team : team === 0;
    const where = at ? new THREE.Vector3(at[0], 0.05, at[1]) : new THREE.Vector3(...this.shuttle.p);
    this.fx.emit(where, reason === "in" ? "#ffe36b" : "#ff5c5c", 40, 5, 0.8, 3);
    this.fx.ring(where, reason === "in" ? "#ffe36b" : "#ff5c5c", 2.5);
    const label = reason === "in" ? "IN!" : reason === "out" ? "OUT!" : "FAULT!";
    this.ui?.banner(label, mine ? "#7dffb0" : "#ff7d9b", 1.4, mine ? "Point to you" : "Point to them");
    this.ui?.score(this.score, this.serveTeam);
    sfx.point(mine);
  }

  winner() {
    const [a, b] = this.score, cap = this.pointsToWin + 4;
    if ((a >= this.pointsToWin && a - b >= 2) || a >= cap) return 0;
    if ((b >= this.pointsToWin && b - a >= 2) || b >= cap) return 1;
    return null;
  }

  finish() {
    this.state = "over"; this.stateT = 0;
    const w = this.winner();
    this.net?.send({ k: "over", winner: w, score: this.score });
    this.onOver(w);
  }

  onOver(w) {
    this.state = "over";
    const won = this.local ? w === this.local.team : null;
    this.opts.onEnd?.({ won, winner: w, score: [...this.score], stats: { ...this.stats } });
  }

  // ---------------------------------------------------------------- hits
  onSwing(p) { sfx.swing(); this.net && p === this.local && this.net.sendState?.(true); }
  onDash(p) { sfx.dash(); this.fx.emit(p.pos.clone().setY(0.3), p.airDash ? "#9fe8ff" : "#ffffff", p.airDash ? 26 : 14, 3, 0.4, 0.5, 0); }
  onJump() { sfx.jump(); }

  tryHit(p) {
    const sh = this.shuttle;
    if (p !== this.local && p.kind !== "bot") return; // remote players report their own hits
    if (p.kind === "bot" && this.net && !this.opts.isHost) return; // host runs the bots
    const serving = this.state === "serve" && this.server === p && !sh.flying;
    if (!serving && (this.state !== "rally" || !sh.flying || sh.lastTeam === p.team)) return;
    const hc = p.hitCenter();
    const d = Math.hypot(sh.p[0] - hc.x, sh.p[1] - hc.y, sh.p[2] - hc.z);
    if (!serving && d > p.d.reach) return;
    if (sh.p[1] < 0.15) return;
    p.swing.hit = true;
    const aim = p === this.local ? this.aim : this.brains.get(p).aim;
    const hit = this.computeShot(p, aim, serving, d / p.d.reach);
    this.applyHit(hit);
    this.net?.send({ k: "hit", ...hit });
  }

  computeShot(p, aim, serving, closeness) {
    const sh = this.shuttle, from = [...sh.p];
    const c = serving ? 0 : p.swing.power;
    const smash = !serving && c >= 0.5 && from[1] >= 2.15;
    const ox = -p.side;
    // tidy the aim: keep it on the far court, then add a little error for edge-of-reach and dash hits
    let tx = THREE.MathUtils.clamp(aim[0] * ox, 0.9, COURT.halfL - 0.25) * ox;
    let tz = THREE.MathUtils.clamp(aim[1], -COURT.halfW + 0.25, COURT.halfW - 0.25);
    const err = 0.15 + 1.1 * closeness * closeness + (p.dashT > 0 ? 0.5 : 0) + (smash ? 0.3 : 0);
    const a = Math.random() * Math.PI * 2, r = Math.random() * err;
    tx += Math.cos(a) * r; tz += Math.sin(a) * r;
    const drop = c === 0 && Math.abs(tx) < 3.2;
    let speed = p.d.shot * (1 + 0.85 * c) * (smash ? 1.18 : 1) * (drop ? 0.72 : 1) * (serving ? 0.9 : 1);
    const lateral = tz - from[2];
    const sideSign = Math.sign(lateral * ox) || (Math.random() < 0.5 ? 1 : -1);
    const spin = serving ? 0 : -sideSign * p.d.spin * (0.35 + 0.65 * c) * Math.min(1, Math.abs(lateral) / 3 + 0.3);
    const top = smash ? 0.6 : 0;
    const sol = solveShot(from, [tx, tz], speed, spin, top, { clear: smash ? 0.1 : 0.3 });
    return { by: p.id, team: p.team, p: from, v: sol.v, s: spin * Math.sqrt(sol.speedFrac || 1), t: top, kind: smash ? "smash" : drop ? "drop" : c > 0.4 ? "power" : serving ? "serve" : "hit", c, seq: ++this.hitSeq };
  }

  applyHit(h) {
    const sh = this.shuttle, p = this.players.find((q) => q.id === h.by);
    sh.p = [...h.p]; sh.v = [...h.v]; sh.s = h.s; sh.t = h.t;
    sh.flying = true; sh.lastTeam = h.team; sh.lastHitter = h.by; sh.hitId++; sh.netted = false;
    this.flightT = 0;
    if (this.state === "serve") { this.state = "rally"; this.stateT = 0; this.ui?.serve(false); if (this.server) this.server.locked = false; }
    this.stats.rally++;
    if (p === this.local) { this.stats.hits++; if (h.kind === "smash") this.stats.smashes++; }
    const at = new THREE.Vector3(...h.p), col = p ? "#" + p.accent.getHexString() : "#ffffff";
    if (p) p.swing.hit = true;
    if (h.kind === "smash") {
      this.fx.emit(at, col, 90, 11, 0.8, 0, 3); this.fx.emit(at, "#ffffff", 30, 6, 0.4);
      this.fx.ring(at, col, 4, 0.5, false); this.fx.shake(0.6); this.slowmo = 0.14;
      this.fx.setTrail(col, 1.2); sfx.smash();
      this.ui?.pop("SMASH!", col);
    } else {
      const pw = h.kind === "power" ? 1 : 0;
      this.fx.emit(at, col, 22 + pw * 30, 4 + pw * 4, 0.45);
      if (pw) { this.fx.ring(at, col, 2.2, 0.35, false); this.fx.shake(0.2); }
      this.fx.setTrail(col, pw * 0.6); sfx.hit(pw);
      if (h.kind === "drop") this.ui?.pop("DROP", col, true);
    }
  }

  // ---------------------------------------------------------------- local player controls
  localInput(input) {
    const s = this.viewSide; // camera sits behind our half; W = toward the net
    let fwd = 0, right = 0;
    if (input.down("KeyW")) fwd += 1; if (input.down("KeyS")) fwd -= 1;
    if (input.down("KeyD")) right += 1; if (input.down("KeyA")) right -= 1;
    // forward = -s on x; right of that (camera view) = s on z... derived from left=(vz,0,-vx)
    const mx = -s * fwd, mz = -s * right;
    // aim: mouse ray onto the floor, clamped to the far court
    if (input.mouse.moved) {
      this.ray.setFromCamera(new THREE.Vector2(input.mouse.x, input.mouse.y), this.camera);
      const hit = new THREE.Vector3();
      if (this.ray.ray.intersectPlane(this.plane, hit)) {
        const ox = -s;
        this.aim = [THREE.MathUtils.clamp(hit.x * ox, 0.9, COURT.halfL - 0.25) * ox, THREE.MathUtils.clamp(hit.z, -COURT.halfW + 0.25, COURT.halfW - 0.25)];
      }
    }
    return {
      mx, mz, jump: input.pressed("Space"), dash: input.pressed("KeyQ"),
      swing: input.mouse.down && input.enabled, aim: this.aim,
    };
  }

  // ---------------------------------------------------------------- render
  render(dt, alpha) {
    for (const p of this.players) p.render(dt, alpha);
    const sh = this.shuttle;
    const sp = this.prevShuttle.clone().lerp(new THREE.Vector3(...sh.p), alpha);
    this.shuttleObj.position.copy(sp);
    const v = new THREE.Vector3(...sh.v);
    if (v.lengthSq() > 0.5) this.shuttleObj.quaternion.slerp(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.normalize().negate()), 0.5);
    else this.shuttleObj.quaternion.slerp(new THREE.Quaternion(), 0.2);
    this.blob.position.set(sp.x, 0.03, sp.z);
    this.blob.scale.setScalar(1 + sp.y * 0.08); this.blob.material.opacity = Math.max(0.15, 0.5 - sp.y * 0.04);
    this.fx.update(dt, sp, sh.flying);

    // reticle
    const L = this.local;
    this.reticle.visible = !!L && (this.state === "rally" || this.state === "serve");
    this.reticle.position.x = this.aim[0]; this.reticle.position.z = this.aim[1];
    if (L) {
      const ch = L.swing.st === "charge" ? L.swing.charge : 0;
      this.reticleCharge.geometry.dispose();
      this.reticleCharge.geometry = new THREE.RingGeometry(0.56, 0.7, 32, 1, Math.PI / 2, Math.max(0.01, ch * Math.PI * 2));
      this.reticleCharge.material.color.set(ch >= 1 ? "#ff5c8a" : "#ffd23d");
      this.reticle.scale.setScalar(1 + Math.sin(this.time * 6) * 0.04);
      this.ui?.hud(L, this);
    }

    // camera: behind our baseline, follows the local player a bit
    const s = this.viewSide, fz = L ? L.pos.z : 0, fxp = L ? L.pos.x : s * 5;
    const want = new THREE.Vector3(s * 15 + (fxp - s * 5) * 0.3, 7.4, fz * 0.4);
    const look = new THREE.Vector3(-s * 2 + (fxp - s * 5) * 0.2, 0.9, fz * 0.3);
    this.camPos.lerp(want, 1 - Math.exp(-dt * 4)); this.camLook.lerp(look, 1 - Math.exp(-dt * 4));
    const sk = this.fx.shakeAmt;
    this.camera.position.copy(this.camPos).add(new THREE.Vector3((Math.random() - 0.5) * sk, (Math.random() - 0.5) * sk, (Math.random() - 0.5) * sk));
    this.camera.lookAt(this.camLook);
  }

  resize(w, h) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }

  dispose() {
    for (const p of this.players) p.dispose();
    this.fx.dispose();
    this.world.free();
    this.scene.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
  }
}
