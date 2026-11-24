import * as THREE from "three";
import { makeAvatar, makeRacket } from "./assets.js";
import { racketStats, derive } from "./rackets.js";

const GRAV = 24;            // player gravity (snappier than the shuttle)
const CAP_HALF = 0.5, CAP_R = 0.32, CAP_Y = CAP_HALF + CAP_R; // capsule centre height above feet
const SWING_ACTIVE = 0.17;  // s the racket can connect after release
const TAP = 0.14;           // presses shorter than this are plain (uncharged) swings

// Arm pitch angles (rad) about the shoulder's x axis. Idle = racket forward/down, charge = cocked back overhead.
const ARM_IDLE = 5.35, ARM_BACK = 2.55, ARM_FOLLOW = 6.15;

export const TEAM_COLORS = ["#3d8bff", "#ff4d6d"];

export class Player {
  constructor(match, { id, name, team, racket = "practice", kind = "local", slot = 0, look = null }) {
    this.match = match; this.id = id; this.name = name; this.team = team; this.kind = kind; this.slot = slot;
    this.side = team === 0 ? -1 : 1; // which half of the court (sign of x)
    this.setRacket(racket);
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.prevPos = new THREE.Vector3();
    this.dashVel = new THREE.Vector3(); this.dashT = 0; this.dashCd = 0; this.airDash = false;
    this.onGround = true; this.facing = new THREE.Vector3(-this.side, 0, 0);
    this.swing = { st: "idle", t: 0, charge: 0, power: 0, hit: false };
    this.prevSwing = false; this.locked = false; this.animT = Math.random() * 10; this.armA = ARM_IDLE;
    this.lastInput = { mx: 0, mz: 0 };

    // physics body: kinematic capsule driven by Rapier's character controller
    const R = match.RAPIER, w = match.world;
    this.body = w.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, CAP_Y, 0));
    this.collider = w.createCollider(R.ColliderDesc.capsule(CAP_HALF, CAP_R), this.body);
    this.cc = w.createCharacterController(0.02);
    this.cc.setUp({ x: 0, y: 1, z: 0 });
    this.cc.enableSnapToGround(0.2);
    this.cc.setApplyImpulsesToDynamicBodies(false);

    // visuals
    this.root = new THREE.Group();
    this.avatar = makeAvatar(look, TEAM_COLORS[team]);
    this.root.add(this.avatar);
    this.arm = this.avatar.getObjectByName("ArmR");
    this.armL = this.avatar.getObjectByName("ArmL");
    this.legs = [this.avatar.getObjectByName("LegL"), this.avatar.getObjectByName("LegR")];
    this.feet = [this.avatar.getObjectByName("FootL"), this.avatar.getObjectByName("FootR")];
    this.hand = this.avatar.getObjectByName("HandR");
    this.attachRacket();
    match.scene.add(this.root);
  }

  setRacket(id) {
    this.racketId = id; this.stats = racketStats(id); this.d = derive(this.stats);
    if (this.hand) this.attachRacket();
  }

  attachRacket() {
    if (this.racketObj) this.hand.remove(this.racketObj);
    this.racketObj = makeRacket(this.racketId);
    this.racketObj.rotation.x = Math.PI; // handle continues the arm
    this.racketObj.position.y = 0.06;
    this.racketObj.scale.setScalar(1.35);
    this.hand.add(this.racketObj);
    this.accent = this.racketObj.userData.accent;
  }

  place(x, z) {
    this.pos.set(x, 0, z); this.prevPos.copy(this.pos); this.vel.set(0, 0, 0); this.dashVel.set(0, 0, 0); this.dashT = 0;
    this.body.setTranslation({ x, y: CAP_Y, z }, true);
    this.body.setNextKinematicTranslation({ x, y: CAP_Y, z });
    this.swing = { st: "idle", t: 0, charge: 0, power: 0, hit: false };
  }

  // where the racket meets the shuttle
  hitCenter(out = new THREE.Vector3()) {
    const f = this.facing;
    return out.set(this.pos.x + f.x * 0.45 - f.z * 0.2, this.pos.y + 1.25, this.pos.z + f.z * 0.45 + f.x * 0.2);
  }

  // input: {mx, mz (world dir, len<=1), jump, dash, swing(bool held), aim:[x,z]}
  update(dt, input) {
    this.prevPos.copy(this.pos);
    this.lastInput = input;
    const d = this.d, sw = this.swing;
    // --- swing state machine
    const held = !!input.swing;
    if (held && sw.st === "idle") { sw.st = "charge"; sw.t = 0; sw.charge = 0; }
    if (sw.st === "charge") {
      sw.t += dt; sw.charge = Math.min(1, sw.t / d.chargeTime);
      if (!held) { sw.st = "swing"; sw.power = sw.t < TAP ? 0 : sw.charge; sw.t = 0; sw.hit = false; this.match.onSwing(this); }
    } else if (sw.st === "swing") {
      sw.t += dt;
      if (!sw.hit) this.match.tryHit(this);
      if (sw.t > SWING_ACTIVE) { sw.st = "recover"; sw.t = 0; }
    } else if (sw.st === "recover") {
      sw.t += dt; if (sw.t > d.recover) { sw.st = "idle"; sw.t = 0; }
    }
    this.prevSwing = held;

    // --- movement
    let mx = input.mx || 0, mz = input.mz || 0;
    const ml = Math.hypot(mx, mz); if (ml > 1) { mx /= ml; mz /= ml; }
    if (this.locked) { mx = 0; mz = 0; }
    const sp = d.move * (sw.st === "charge" ? 0.72 : 1);
    const acc = this.onGround ? 70 : 22;
    this.vel.x += THREE.MathUtils.clamp(mx * sp - this.vel.x, -acc * dt, acc * dt);
    this.vel.z += THREE.MathUtils.clamp(mz * sp - this.vel.z, -acc * dt, acc * dt);

    this.dashCd = Math.max(0, this.dashCd - dt);
    if (input.dash && this.dashCd <= 0 && !this.locked) {
      let dx = mx, dz = mz;
      if (Math.hypot(dx, dz) < 0.1) { dx = this.facing.x; dz = this.facing.z; }
      const l = Math.hypot(dx, dz) || 1;
      this.airDash = !this.onGround;
      const boost = this.airDash ? 1.55 : 1; // air dashes carry farther
      this.dashVel.set((dx / l) * d.dashSpeed * boost, 0, (dz / l) * d.dashSpeed * boost);
      this.dashT = this.airDash ? 0.24 : 0.17; this.dashCd = d.dashCd;
      if (this.airDash) this.vel.y = Math.max(this.vel.y, 1.5);
      this.match.onDash(this);
    }
    if (this.dashT > 0) { this.dashT -= dt; if (this.dashT <= 0) this.dashVel.set(0, 0, 0); }

    if (input.jump && this.onGround && !this.locked) { this.vel.y = d.jump; this.onGround = false; this.match.onJump(this); }
    this.vel.y -= GRAV * (this.dashT > 0 && this.airDash ? 0.3 : 1) * dt;

    const mv = { x: (this.vel.x + this.dashVel.x) * dt, y: this.vel.y * dt, z: (this.vel.z + this.dashVel.z) * dt };
    this.cc.computeColliderMovement(this.collider, mv);
    const c = this.cc.computedMovement();
    const t = this.body.translation();
    const nx = t.x + c.x, ny = Math.max(CAP_Y, t.y + c.y), nz = t.z + c.z;
    this.body.setNextKinematicTranslation({ x: nx, y: ny, z: nz });
    this.onGround = this.cc.computedGrounded() || ny <= CAP_Y + 1e-3;
    if (this.onGround && this.vel.y < 0) this.vel.y = 0;
    this.pos.set(nx, ny - CAP_Y, nz);

    // --- facing: toward the net, turned partly toward the shuttle
    const s = this.match.shuttle.p;
    let fx = -this.side * 1.6 + (s[0] - this.pos.x) * 0.3, fz = (s[2] - this.pos.z) * 0.5;
    if (sw.st === "swing" || sw.st === "charge") { const a = input.aim; if (a) { fx = a[0] - this.pos.x; fz = a[1] - this.pos.z; } }
    if (input.face) { fx = input.face[0]; fz = input.face[1]; }
    const fl = Math.hypot(fx, fz) || 1;
    this.facing.lerp(new THREE.Vector3(fx / fl, 0, fz / fl), 0.25).normalize();
  }

  // ---- network: what we send about ourselves, and how remote players follow what they send
  netState() {
    const r = (v) => Math.round(v * 100) / 100;
    return { id: this.id, p: [r(this.pos.x), r(this.pos.y), r(this.pos.z)], v: [r(this.vel.x + this.dashVel.x), r(this.vel.y), r(this.vel.z + this.dashVel.z)],
      f: [r(this.facing.x), r(this.facing.z)], sw: this.swing.st, c: r(this.swing.charge), d: this.dashT > 0 ? 1 : 0, rk: this.racketId };
  }
  setRemote(st) {
    this.remote = { ...st, age: 0 };
    if (st.rk && st.rk !== this.racketId) this.setRacket(st.rk);
    if (st.sw === "swing" && this.swing.st !== "swing") this.match.onSwing(this);
    this.swing.st = st.sw; this.swing.charge = st.c; this.dashT = st.d ? 0.1 : 0;
  }
  tickRemote(dt) {
    this.prevPos.copy(this.pos);
    const r = this.remote; if (!r) return;
    r.age += dt;
    // aim slightly ahead along their velocity, then ease toward it (hides 15 Hz updates)
    const ahead = Math.min(r.age, 0.12);
    const tx = r.p[0] + r.v[0] * ahead, ty = Math.max(0, r.p[1] + r.v[1] * ahead), tz = r.p[2] + r.v[2] * ahead;
    this.pos.x += (tx - this.pos.x) * 0.35; this.pos.y += (ty - this.pos.y) * 0.35; this.pos.z += (tz - this.pos.z) * 0.35;
    this.facing.lerp(new THREE.Vector3(r.f[0], 0, r.f[1]), 0.3).normalize();
    this.onGround = this.pos.y < 0.03;
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y + CAP_Y, z: this.pos.z });
  }

  render(dt, alpha) {
    const p = this.prevPos.clone().lerp(this.pos, alpha);
    this.root.position.copy(p);
    this.root.rotation.y = Math.atan2(this.facing.x, this.facing.z);
    const speed = Math.hypot(this.pos.x - this.prevPos.x, this.pos.z - this.prevPos.z) / (1 / 60);
    this.animT += dt * (4 + speed * 1.6);
    const run = Math.min(1, speed / 6) * (this.onGround ? 1 : 0.2);
    const sw = Math.sin(this.animT * 1.2) * 0.7 * run;
    if (this.legs[0]) { this.legs[0].rotation.x = sw; this.legs[1].rotation.x = -sw; }
    if (this.feet[0]) { this.feet[0].position.z = sw * 0.12; this.feet[1].position.z = -sw * 0.12; }
    this.avatar.position.y = this.onGround ? Math.abs(Math.sin(this.animT * 1.2)) * 0.06 * run : 0;
    this.avatar.rotation.x = this.dashT > 0 ? 0.35 : run * 0.12;
    if (this.armL) this.armL.rotation.x = -sw * 0.8 + (this.swing.st === "charge" ? -0.9 : 0);

    // racket arm
    const s = this.swing;
    let target = ARM_IDLE, k = 14;
    if (s.st === "charge") { target = ARM_IDLE + (ARM_BACK - ARM_IDLE) * Math.min(1, s.t / 0.12 + s.charge * 0.3); k = 18; }
    else if (s.st === "swing") { target = ARM_FOLLOW; k = 45; }
    else if (s.st === "recover") { target = ARM_IDLE; k = 10; }
    this.armA += (target - this.armA) * Math.min(1, k * dt);
    this.arm.rotation.x = this.armA;
    this.arm.rotation.z = s.st === "charge" ? -0.25 : 0;
    const m = this.racketObj.userData.accentMat;
    if (m) m.emissiveIntensity = 2.2 + (s.st === "charge" ? s.charge * 10 * (0.8 + 0.2 * Math.sin(this.animT * 8)) : 0);
  }

  dispose() {
    this.match.scene.remove(this.root);
    this.match.world.removeCharacterController(this.cc);
    this.match.world.removeRigidBody(this.body);
  }
}
