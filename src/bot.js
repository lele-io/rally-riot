import { simulate, COURT } from "./shuttle.js";

// level 0 (easy) .. 1 (hard)
export class BotBrain {
  constructor(match, player, level = 0.5) {
    this.m = match; this.p = player; this.level = level;
    this.plan = null; this.replanT = 0; this.serveT = 0; this.held = 0; this.wantSmash = false;
    this.aim = [0, 0]; this.lastHitSeen = -1;
    // difficulty knobs. Easy (0.2) reacts late, moves at ~80% speed, rarely dashes or jumps, and almost never smashes.
    this.react = level < 0.7 ? 0.42 - 0.2 * level : 0.42 - 0.32 * level;   // Easy 0.38 s, Normal 0.36 s, Hard 0.15 s
    this.speedMul = Math.min(1, 0.72 + 0.4 * level);
    this.smashChance = level < 0.3 ? 0.05 : level < 0.7 ? 0.2 : Math.min(0.92, level * 1.05);   // Easy 5%, Normal 20%, Hard ~90%
    this.dashes = level >= 0.3;
  }

  think(dt) {
    const m = this.m, p = this.p, sh = m.shuttle;
    const inp = { mx: 0, mz: 0, jump: false, dash: false, swing: false, aim: this.aim };
    const home = m.homeFor(p);
    let goal = { x: home[0], z: home[1] }, urgent = false;

    if (m.state === "serve") {
      if (m.server === p) {
        this.serveT += dt;
        if (this.serveT > 0.9 + Math.random() * 0.05) { this.pickAim(true); inp.swing = this.serveT < 0.97; if (this.serveT > 1.0) this.serveT = 0; }
        return inp;
      }
    } else this.serveT = 0;

    if (m.state === "rally" && sh.flying && sh.lastTeam !== p.team) {
      if (sh.hitId !== this.lastHitSeen) {
        this.lastHitSeen = sh.hitId; this.plan = null; this.replanT = this.react; this.pickAim(false);
        this.smashRoll = Math.random() < this.smashChance; // decided once per incoming shot (was re-rolled every tick)
        this.power = this.level < 0.3 ? Math.random() * 0.35 : 0.3 + 0.7 * Math.random() * this.level; // non-smash charge
      }
      this.replanT -= dt;
      if (this.replanT <= 0) { this.plan = this.intercept(); this.replanT = 0.12; }
      if (this.plan && this.amChaser()) {
        const pl = this.plan, f = p.facing;
        goal = { x: pl.x - f.x * 0.45 + f.z * 0.2, z: pl.z - f.z * 0.45 - f.x * 0.2 };
        const dist = Math.hypot(goal.x - p.pos.x, goal.z - p.pos.z), tLeft = pl.t - m.flightT;
        urgent = dist > p.d.move * Math.max(0.05, tLeft - 0.1);
        if (urgent && dist > 2.2 && p.dashCd <= 0 && (this.dashes || Math.random() < 0.01)) inp.dash = true;
        // jump for high balls: take off so the apex lines up with contact
        const tUp = p.d.jump / 24;
        if (pl.y > 2.35 && p.onGround && tLeft < tUp + 0.05 && tLeft > tUp - 0.12 && dist < 1.6 && (this.smashRoll || this.level > 0.6)) inp.jump = true;
        // power swing: smash high balls (how often depends on skill), charge in advance
        this.wantSmash = pl.y > 2.1 && this.smashRoll;
        inp.maxPower = this.wantSmash ? 1 : this.power; // a bot that didn't plan a smash can't stumble into one by over-charging
        if (p.swing.st === "idle" || p.swing.st === "charge") {
          const chargeLead = this.wantSmash ? p.d.chargeTime * (0.6 + 0.4 * this.level) : 0.12 + p.d.chargeTime * (this.power || 0);
          if (tLeft < chargeLead + 0.1) inp.swing = true;
          // release just before the shuttle's closest pass to the racket (the hit window lasts ~0.17 s)
          if (p.swing.st === "charge") {
            const ca = this.closest();
            if (ca.d < p.d.reach * 0.95 && ca.t < 0.07) inp.swing = false;
            if (ca.t > 0.5 && tLeft < -0.2) inp.swing = false;
          }
        }
      }
    } else { this.plan = null; this.wantSmash = false; }

    // drift a little toward the shuttle's side when idle, like a real player covering
    if (!this.plan || !this.amChaser()) { goal.z += (sh.p[2] - goal.z) * 0.25; }
    const dx = goal.x - p.pos.x, dz = goal.z - p.pos.z, dl = Math.hypot(dx, dz);
    if (dl > 0.15) { const s = Math.min(1, dl / 0.6); inp.mx = (dx / dl) * s; inp.mz = (dz / dl) * s; }
    if (!urgent && !this.plan) { inp.mx *= 0.7; inp.mz *= 0.7; }
    inp.mx *= this.speedMul; inp.mz *= this.speedMul;
    return inp;
  }

  // closest approach of the shuttle to my racket over the next half second (assuming I keep moving as now)
  closest() {
    const sh = this.m.shuttle, p = this.p, hc = p.hitCenter();
    const vx = p.pos.x - p.prevPos.x, vz = p.pos.z - p.prevPos.z; // per tick
    let best = { d: 1e9, t: 0 }, n = 0;
    simulate({ p: [...sh.p], v: [...sh.v], s: sh.s, t: sh.t }, 0.5, (st, t) => {
      const k = t * 60;
      const d = Math.hypot(st.p[0] - (hc.x + vx * k), st.p[1] - hc.y, st.p[2] - (hc.z + vz * k));
      if (d < best.d) best = { d, t };
    });
    const d0 = Math.hypot(sh.p[0] - hc.x, sh.p[1] - hc.y, sh.p[2] - hc.z);
    if (d0 <= best.d) best = { d: d0, t: 0 };
    return best;
  }

  amChaser() {
    // of my team, chase only if I'm the closest to the planned contact point
    const pl = this.plan; if (!pl) return false;
    const me = Math.hypot(pl.x - this.p.pos.x, pl.z - this.p.pos.z);
    for (const q of this.m.players) if (q !== this.p && q.team === this.p.team) {
      const d = Math.hypot(pl.x - q.pos.x, pl.z - q.pos.z);
      if (d < me - 0.4) return false;
    }
    return true;
  }

  // earliest point on the predicted flight we can get to in time
  intercept() {
    const m = this.m, p = this.p, sh = m.shuttle;
    const maxH = 1.25 + p.d.reach * 0.85 + (p.d.jump * p.d.jump) / 48 * 0.9;
    let best = null, last = null, n = 0;
    simulate({ p: [...sh.p], v: [...sh.v], s: sh.s, t: sh.t }, 4, (st, t) => {
      if (best || n++ % 3) return;
      const [x, y, z] = st.p;
      if (Math.sign(x) !== p.side || Math.abs(x) < 0.4) return;
      if (y < 0.35) return;
      last = { x, y, z, t: m.flightT + t };
      if (y > maxH) return;
      const travel = Math.max(0, Math.hypot(x - p.pos.x, z - p.pos.z) - p.d.reach * 0.6);
      const need = travel / (p.d.move + (p.dashCd <= 0 ? 3 : 0)) + 0.05;
      if (need <= t) best = { x, y, z, t: m.flightT + t };
    });
    let pl = best || last;
    if (!pl) return null;
    // weaker bots misjudge a bit
    const err = (1 - this.level) * (this.level < 0.3 ? 1.1 : this.level < 0.7 ? 0.8 : 0.5);
    return { ...pl, x: pl.x + (Math.random() - 0.5) * err, z: pl.z + (Math.random() - 0.5) * err };
  }

  pickAim(serve) {
    const opp = this.m.players.filter((q) => q.team !== this.p.team);
    const ox = -this.p.side, L = COURT.halfL, W = COURT.halfW;
    let best = null;
    for (let i = 0; i < 14; i++) {
      const depth = serve ? 5 + Math.random() * 3.2 : 1.6 + Math.random() * (L - 2.1);
      const x = ox * depth, z = (Math.random() * 2 - 1) * (W - 0.6);
      let dmin = 99; for (const q of opp) dmin = Math.min(dmin, Math.hypot(q.pos.x - x, q.pos.z - z));
      const score = dmin * (this.level < 0.3 ? 0.1 : this.level < 0.7 ? 0.25 : 0.4 + this.level) + Math.random() * 2.5; // Easy / Normal barely hunt open space
      if (!best || score > best.s) best = { x, z, s: score };
    }
    const e = (1 - this.level) * 1.4; // sloppy bots sometimes hit long or wide
    this.aim = [best.x + ox * (Math.random() - 0.3) * e, best.z + (Math.random() - 0.5) * e];
  }
}
