import * as THREE from "three";
import { getModel } from "./assets.js";
import { Player } from "./player.js";
import { BotBrain } from "./bot.js";
import { FX } from "./fx.js";
import { buildEnv } from "./env.js";
import { sfx } from "./sfx.js";
import { COURT, PHYS, step, solveShot, simulate } from "./shuttle.js";
import { RACKET } from "./rackets.js";
import { binds, keyName } from "./keybinds.js";
const keyNameOf = (a) => keyName(binds()[a]);

const TICK = 1 / 60;
const CROSSHAIR_Y = 0.18; // NDC height of the crosshair (CSS .crosshair top = 41%)
const SHUTTLE_SCALE = 3.75; // a bit larger than life so it reads at a distance
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
    this.env = buildEnv(s, { shadowSize: 14 });

    // static colliders: floor, arena walls, and an invisible divider so nobody crosses the net
    const fixed = (hx, hy, hz, x, y, z) => w.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z));
    fixed(30, 0.5, 30, 0, -0.5, 0);
    fixed(0.5, 6, 30, COURT.arenaX + 0.3, 6, 0); fixed(0.5, 6, 30, -COURT.arenaX - 0.3, 6, 0);
    fixed(30, 6, 0.5, 0, 6, COURT.arenaZ - 0.2); fixed(30, 6, 0.5, 0, 6, -COURT.arenaZ + 0.2);
    fixed(0.12, 6, 30, 0, 6, 0);

    // shuttle + a white marker on the ground right below it (so you always know where it is)
    this.shuttleObj = getModel("shuttle"); this.shuttleObj.scale.setScalar(SHUTTLE_SCALE); s.add(this.shuttleObj);
    this.blob = new THREE.Group();
    const bm = (op) => new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: op, depthWrite: false, toneMapped: false });
    const bRing = new THREE.Mesh(new THREE.RingGeometry(0.26, 0.34, 40), bm(0.95));
    const bDot = new THREE.Mesh(new THREE.CircleGeometry(0.07, 20), bm(0.95));
    const bFill = new THREE.Mesh(new THREE.CircleGeometry(0.26, 40), bm(0.18));
    for (const o of [bFill, bRing, bDot]) { o.rotation.x = -Math.PI / 2; o.renderOrder = 5; this.blob.add(o); }
    s.add(this.blob);
    // aim reticle on the far court
    this.reticle = new THREE.Group();
    const rm = new THREE.MeshBasicMaterial({ color: "#fff6e0", transparent: true, opacity: 0.95, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.52, 32), rm); ring.rotation.x = -Math.PI / 2; this.reticle.add(ring);
    this.reticleCharge = new THREE.Mesh(new THREE.RingGeometry(0.56, 0.7, 32, 1, 0, 0.01), new THREE.MeshBasicMaterial({ color: "#ffd23d", transparent: true, depthWrite: false }));
    this.reticleCharge.rotation.x = -Math.PI / 2; this.reticle.add(this.reticleCharge);
    this.reticle.position.y = 0.08; s.add(this.reticle);
    // landing marker: where an opponent's shot will come down (red for smashes), with a disc that fills as it lands
    this.landMark = new THREE.Group();
    const lm = (c, op) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: op, depthWrite: false, toneMapped: false });
    this.landRing = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.62, 40), lm("#ffffff", 0.9));
    this.landFill = new THREE.Mesh(new THREE.CircleGeometry(0.5, 40), lm("#ffffff", 0.35));
    for (const o of [this.landRing, this.landFill]) { o.rotation.x = -Math.PI / 2; o.renderOrder = 6; this.landMark.add(o); }
    this.landMark.position.y = 0.075; this.landMark.visible = false; s.add(this.landMark);
    this.fx = new FX(s);

    this.players = this.opts.players.map((pd, i) => new Player(this, { ...pd, slot: i }));
    this.local = this.players.find((p) => p.id === this.opts.localId) || null;
    this.brains = new Map();
    // (the skill level lives on the player *description*: Player doesn't keep it, so reading p.level here made every bot Normal)
    this.players.forEach((p, i) => { if (p.kind === "bot") this.brains.set(p, new BotBrain(this, p, this.opts.players[i].level ?? 0.5)); });
    this.viewSide = this.local ? this.local.side : -1;
    this.aim = [-this.viewSide * 6, 0];

    this.camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 200);
    // orbit camera state: start behind our player looking at the net
    this.cam = { yaw: this.viewSide < 0 ? 0 : Math.PI, pitch: 0.3, dist: 9 }; this.shoulder = 0;
    this.camLook = new THREE.Vector3(this.viewSide * 5, 1.5, 0);
    this.camera.position.set(this.viewSide * 15, 6, 0); this.camera.lookAt(this.camLook);
    this.ray = new THREE.Raycaster(); this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    if (this.net) this.net.match = this;
    const inp = this.game.input;
    inp.onLockChange = (on) => this.ui?.lockState(on);
    if (this.local) inp.setWantLock(true);
    this.ui?.lockState(inp.locked);
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
      else if (p.kind === "remote") p.tickRemote(dt);
      if (inp) p.update(dt, inp);
    }
    if (this.local && input.actPressed("menu")) this.requestLeave();
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
    this.game.input.setWantLock(false); // free the cursor for the end screen
    const won = this.local ? w === this.local.team : null;
    this.opts.onEnd?.({ won, winner: w, score: [...this.score], myPoints: this.local ? this.score[this.local.team] : 0, stats: { ...this.stats } });
  }

  // menu key: press once to arm, again within 2.5 s to leave (a stray keypress mid-rally doesn't end your match)
  requestLeave() {
    // (quit after this frame: we're inside tick(), and quitting frees the physics world we're still stepping)
    if (this.leaveArmedAt != null && this.time - this.leaveArmedAt < 2.5) { this.leaveArmedAt = null; setTimeout(() => this.game.quitMatch(), 0); return; }
    this.leaveArmedAt = this.time;
    this.ui?.pop("Press " + keyNameOf("menu") + " again to leave", "#ffd23d", true);
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
    // swept test: a fast shuttle moves ~0.5 m per tick, so check the whole path since last tick, not just where it is now
    const { d, at } = serving ? { d: 0, at: sh.p } : this.closestOnPath(hc);
    const reach = this.reachFor(p);
    if (!serving && d > reach) return;
    if (at[1] < 0.15) return;
    p.swing.hit = true;
    if (!serving) sh.p = [...at];
    const aim = p === this.local ? this.aim : this.brains.get(p).aim;
    const hit = this.computeShot(p, aim, serving, Math.min(1, d / p.d.reach));
    hit.base = sh.hitId;
    this.applyHit(hit);
    this.net?.send({ k: "hit", ...hit });
  }

  // effective reach: fast incoming shots (smashes) get a generous defensive reach so they can always be blocked back
  reachFor(p) {
    const v = this.shuttle.v, sp = Math.hypot(v[0], v[1], v[2]);
    return p.d.reach * (1 + 0.6 * THREE.MathUtils.clamp((sp - 11) / 10, 0, 1));
  }

  // closest point to `c` on the shuttle's path over the last tick
  closestOnPath(c) {
    const a = this.prevShuttle, b = this.shuttle.p;
    const ab = [b[0] - a.x, b[1] - a.y, b[2] - a.z], ac = [c.x - a.x, c.y - a.y, c.z - a.z];
    const l2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
    const t = l2 > 1e-9 ? THREE.MathUtils.clamp((ab[0] * ac[0] + ab[1] * ac[1] + ab[2] * ac[2]) / l2, 0, 1) : 1;
    const at = [a.x + ab[0] * t, a.y + ab[1] * t, a.z + ab[2] * t];
    return { d: Math.hypot(at[0] - c.x, at[1] - c.y, at[2] - c.z), at };
  }

  // is the shuttle (heading to this player's side) inside their racket's reach right now? (charge auto-release assist)
  shuttleAtRacket(p) {
    const sh = this.shuttle;
    if (this.state !== "rally" || !sh.flying || sh.lastTeam === p.team) return false;
    return this.closestOnPath(p.hitCenter()).d <= this.reachFor(p) * 0.95;
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
    // overall pace is ~10% slower than before, and a full smash tops out near 30 m/s (was ~40) so it can be returned
    let speed = 0.9 * p.d.shot * (1 + 0.62 * c) * (smash ? 1.06 : 1) * (drop ? 0.72 : 1) * (serving ? 0.9 : 1);
    // Normal / Hard bots hit exactly like a player (same shot and smash speeds); Easy smashes are a bit slower
    if (smash && p.kind === "bot" && (this.brains.get(p)?.level ?? 0.5) < 0.3) speed *= 0.86;   // only Easy bots smash slower
    const lateral = tz - from[2];
    const sideSign = Math.sign(lateral * ox) || (Math.random() < 0.5 ? 1 : -1);
    const spin = serving ? 0 : -sideSign * p.d.spin * (0.35 + 0.65 * c) * Math.min(1, Math.abs(lateral) / 3 + 0.3);
    const top = smash ? 0.6 : 0;
    // a smash goes down: aim it at least 3 m past the net and never let it climb (it used to loop way up off-screen)
    if (smash && Math.abs(tx) < 3) tx = 3 * ox;
    // Easy / Normal bots smash partly at the receiver (Hard still hunts the open corner)
    if (smash && p.kind === "bot") {
      const lv = this.brains.get(p)?.level ?? 0.5;
      const pull = lv < 0.3 ? 0.65 : lv < 0.7 ? 0.4 : 0;
      let near = null, nd = 1e9;
      for (const q of this.players) if (q.team !== p.team) { const d = Math.hypot(q.pos.x - tx, q.pos.z - tz); if (d < nd) { nd = d; near = q; } }
      if (near && pull) { tx += (near.pos.x - tx) * pull; tz += (near.pos.z - tz) * pull; tx = Math.sign(tx || ox) * Math.max(3, Math.abs(tx)); }
    }
    const sol = solveShot(from, [tx, tz], speed, spin, top, smash ? { clear: 0.1, maxApex: from[1] + 0.6 } : { clear: 0.3 });
    return { by: p.id, team: p.team, p: from, v: sol.v, s: spin * Math.sqrt(sol.speedFrac || 1), t: top, kind: smash ? "smash" : drop ? "drop" : c > 0.4 ? "power" : serving ? "serve" : "hit", c, seq: ++this.hitSeq };
  }

  applyHit(h) {
    const sh = this.shuttle, p = this.players.find((q) => q.id === h.by);
    sh.p = [...h.p]; sh.v = [...h.v]; sh.s = h.s; sh.t = h.t;
    sh.flying = true; sh.lastTeam = h.team; sh.lastHitter = h.by; sh.netted = false;
    sh.hitId = (h.base ?? sh.hitId) + 1; this.lastHit = h;
    this.flightT = 0;
    // predict the landing spot (the flight model is deterministic) for the landing marker
    const sim = simulate({ p: [...h.p], v: [...h.v], s: h.s, t: h.t }, 6);
    this.landing = { x: sim.end.p[0], z: sim.end.p[2], t: sim.time, smash: h.kind === "smash", team: h.team, id: sim.hitNet ? -1 : sh.hitId };
    if (this.state === "serve") { this.state = "rally"; this.stateT = 0; this.ui?.serve(false); if (this.server) this.server.locked = false; }
    this.stats.rally++;
    if (p === this.local) { this.stats.hits++; if (h.kind === "smash") this.stats.smashes++; }
    const at = new THREE.Vector3(...h.p), col = p ? "#" + p.accent.getHexString() : "#ffffff";
    if (p) p.swing.hit = true;
    if (h.kind === "smash") {
      this.fx.emit(at, col, 90, 11, 0.8, 0, 3); this.fx.emit(at, "#ffffff", 30, 6, 0.4);
      this.fx.ring(at, col, 4, 0.5, false); this.fx.shake(0.6); if (!this.net) this.slowmo = 0.14;
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

  // ---------------------------------------------------------------- network
  onNet(m) {
    const sh = this.shuttle;
    if (m.k === "st") {
      for (const s of m.list || []) { const p = this.players.find((q) => q.id === s.id); if (p && p.kind === "remote") p.setRemote(s); }
    } else if (m.k === "hit") {
      if (this.state === "over") return;
      // two teammates can hit the same flight at once: everyone keeps the hit from the lower id
      const fresh = m.base === sh.hitId, clash = this.lastHit && m.base === this.lastHit.base && m.by < this.lastHit.by;
      if (!fresh && !clash) return;
      if (this.state === "point") return;
      this.applyHit(m);
      // catch up on the time the message spent in flight
      const ff = Math.min(0.15, this.net.rtt * 0.75);
      for (let t = 0; t < ff; t += PHYS.dt) this.stepShuttle(PHYS.dt);
      this.flightT += ff;
    } else if (m.k === "point" && !this.authority) {
      this.score = m.score; this.serveTeam = m.serveTeam; this.serveIdx = m.serveIdx;
      this.state = "rally"; this.onPoint(m.team, m.reason, m.at);
    } else if (m.k === "serve" && !this.authority) {
      this.score = m.score; this.serveTeam = m.serveTeam; this.serveIdx = m.serveIdx; this.setState("serve");
    } else if (m.k === "over" && !this.authority) {
      this.score = m.score; this.onOver(m.winner);
    } else if (m.k === "leave" || m.k === "closed") {
      const id = m.k === "closed" ? this.net.hostId : m.id;
      if (id === this.net.hostId && !this.authority) { this.game.input.setWantLock(false); this.ui?.banner("HOST LEFT", "#ff7d9b", 3); this.state = "over"; setTimeout(() => this.opts.onEnd?.({ won: null, aborted: true, score: [...this.score], stats: { ...this.stats } }), 1500); return; }
      const p = this.players.find((q) => q.id === id);
      if (p && p.kind === "remote" && this.authority) { p.kind = "bot"; p.name += " (bot)"; this.brains.set(p, new BotBrain(this, p, 0.4)); this.ui?.pop("A player left — a bot takes over", "#ffd23d", true); }
    }
  }

  // ---------------------------------------------------------------- local player controls
  localInput(input) {
    const s = this.viewSide;
    let fwd = 0, right = 0;
    if (input.act("forward")) fwd += 1; if (input.act("back")) fwd -= 1;
    if (input.act("right")) right += 1; if (input.act("left")) right -= 1;
    // camera-relative, like Roblox: W walks where the camera looks
    const fx = Math.cos(this.cam.yaw), fz = Math.sin(this.cam.yaw);
    const mx = fx * fwd - fz * right, mz = fz * fwd + fx * right;
    // aim: the crosshair (just above screen centre) projected onto the floor, clamped to the far court
    {
      this.ray.setFromCamera(new THREE.Vector2(0, CROSSHAIR_Y), this.camera);
      const hit = new THREE.Vector3();
      if (this.ray.ray.intersectPlane(this.plane, hit)) {
        const ox = -s;
        this.aim = [THREE.MathUtils.clamp(hit.x * ox, 0.9, COURT.halfL - 0.25) * ox, THREE.MathUtils.clamp(hit.z, -COURT.halfW + 0.25, COURT.halfW - 0.25)];
      }
    }
    return {
      mx, mz, jump: input.actPressed("jump"), dash: input.actPressed("dash"),
      swing: input.act("swing") || input.actPressed("swing"), tap: input.actPressed("swing"), assist: true, aim: this.aim,
      face: [fx, fz], // always face where the camera looks
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
    this.blob.position.set(sp.x, 0.07, sp.z);
    this.blob.visible = sh.flying || this.state === "serve";
    this.blob.scale.setScalar(1 + Math.min(sp.y, 8) * 0.05);
    this.fx.update(dt, sp, sh.flying);
    this.env.update(dt);

    // landing marker for shots coming at the local player's side
    {
      const Lp = this.local, ld = this.landing, show = !!(Lp && ld && sh.flying && this.state === "rally" && ld.team !== Lp.team && ld.id === sh.hitId);
      this.landMark.visible = show;
      if (show) {
        const left = Math.max(0, ld.t - this.flightT), k = 1 - left / Math.max(0.05, ld.t);
        this.landMark.position.x = ld.x; this.landMark.position.z = ld.z;
        const col = ld.smash ? "#ff4d6d" : "#fff4c8";
        this.landRing.material.color.set(col); this.landFill.material.color.set(col);
        this.landFill.scale.setScalar(Math.max(0.05, k));
        this.landMark.scale.setScalar(ld.smash ? 1.15 + Math.sin(this.time * 18) * 0.06 : 1);
      }
    }
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

    // third-person orbit camera (Roblox-style): right-drag to turn, wheel to zoom, follows your player
    const c = this.cam, look = this.game.input.takeLook();
    c.yaw += look.dx * 0.0035;
    c.pitch = THREE.MathUtils.clamp(c.pitch + look.dy * 0.0035, -0.1, 1.2);
    c.dist = THREE.MathUtils.clamp(c.dist * Math.pow(1.0012, look.wheel), 3, 30);
    const focus = L ? L.root.position : new THREE.Vector3(this.viewSide * 5, 0, 0);
    this.camLook.lerp(new THREE.Vector3(focus.x, focus.y + 1.5, focus.z), 1 - Math.exp(-dt * 12));
    const f = new THREE.Vector3(Math.cos(c.yaw), 0, Math.sin(c.yaw));
    // over-the-shoulder offset to the right (always-locked camera)
    this.shoulder += (1.2 - this.shoulder) * Math.min(1, dt * 10);
    const look2 = this.camLook.clone().add(new THREE.Vector3(-f.z, 0, f.x).multiplyScalar(this.shoulder));
    const pos = look2.clone().addScaledVector(f, -c.dist * Math.cos(c.pitch)).add(new THREE.Vector3(0, c.dist * Math.sin(c.pitch), 0));
    pos.y = Math.max(0.4, pos.y);
    const sk = this.fx.shakeAmt;
    this.camera.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * sk, (Math.random() - 0.5) * sk, (Math.random() - 0.5) * sk));
    this.camera.lookAt(look2);

    // shuttle off-screen (very high lob, or behind you): point at it from the screen edge
    if (this.ui?.offscreen) {
      this.camera.updateMatrixWorld();
      const q = sp.clone().project(this.camera), behind = q.z > 1;
      const off = sh.flying && (behind || Math.abs(q.x) > 0.95 || Math.abs(q.y) > 0.92);
      let x = q.x, y = q.y; if (behind) { x = -x; y = -Math.abs(y) - 1; }
      const k = Math.max(Math.abs(x) / 0.9, Math.abs(y) / 0.85, 1e-6);
      this.ui.offscreen(off, x / k, y / k, Math.atan2(y, x), sp.y);
    }
  }

  resize(w, h) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }

  dispose() {
    const inp = this.game.input; inp.setWantLock(false); inp.onLockChange = null;
    for (const p of this.players) p.dispose();
    this.fx.dispose(); this.env.dispose();
    this.world.free();
    this.scene.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
  }
}
