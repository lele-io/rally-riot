// Shuttle flight model + shot solver. Pure math (no three.js) so the bot, the network code and
// tools/tune.mjs can all run the exact same simulation. Units: metres, seconds. y is up,
// x runs along the court (net at x = 0), z across it.
export const COURT = { halfL: 9, halfW: 5, netH: 1.55, arenaX: 21.6, arenaZ: 14.6, ceiling: 10 };
export const PHYS = {
  g: 13,          // a bit more than real gravity: snappier rallies
  drag: 0.05,     // quadratic drag k in a = -k|v|v  (terminal speed ~16 m/s)
  magnus: 0.08,   // sideways push per unit spin per m/s
  spinDecay: 0.6, // spin halves roughly every second
  dt: 1 / 120,
};

// state: {p:[x,y,z], v:[x,y,z], s: sidespin (+ curves to the left of travel), t: topspin (+ dips)}
export function step(st, dt = PHYS.dt) {
  const [vx, vy, vz] = st.v;
  const sp = Math.hypot(vx, vy, vz);
  const k = PHYS.drag * sp;
  let ax = -k * vx, ay = -PHYS.g - k * vy, az = -k * vz;
  const h = Math.hypot(vx, vz);
  if (h > 0.5) {
    // sidespin: perpendicular to horizontal travel; topspin: pushes down along travel's normal
    const m = PHYS.magnus * sp;
    ax += (vz / h) * st.s * m; az += (-vx / h) * st.s * m; // left of travel = (vz, 0, -vx)/h
    ay -= st.t * m;
  }
  st.v[0] += ax * dt; st.v[1] += ay * dt; st.v[2] += az * dt;
  st.p[0] += st.v[0] * dt; st.p[1] += st.v[1] * dt; st.p[2] += st.v[2] * dt;
  const d = Math.exp(-PHYS.spinDecay * dt);
  st.s *= d; st.t *= d;
}

export const clone = (st) => ({ p: [...st.p], v: [...st.v], s: st.s, t: st.t });

// Fly a shuttle until it lands / leaves the arena. Returns {land:[x,z], time, netCross:y at x=0 or null, hitNet}
export function simulate(st0, maxT = 6, sample = null) {
  const st = clone(st0);
  let t = 0, netY = null, hitNet = false;
  const side0 = Math.sign(st.p[0]);
  while (t < maxT) {
    const px = st.p[0];
    step(st); t += PHYS.dt;
    if (sample) sample(st, t);
    if (netY == null && Math.sign(st.p[0]) !== Math.sign(px) && px !== 0) {
      const f = px / (px - st.p[0]);
      netY = st.p[1] - st.v[1] * PHYS.dt * (1 - f);
      if (netY < COURT.netH && Math.abs(st.p[2]) < COURT.halfW + 0.4) { hitNet = true; break; }
    }
    if (st.p[1] <= 0) break;
    if (Math.abs(st.p[0]) > COURT.arenaX || Math.abs(st.p[2]) > COURT.arenaZ || st.p[1] > COURT.ceiling) break;
  }
  return { land: [st.p[0], st.p[2]], time: t, netCross: netY, hitNet, side0, end: st };
}

// Find a launch velocity that lands the shuttle at `target` [x,z] from `from` [x,y,z] at `speed`.
// Prefers the flattest arc that clears the net (`clear` m above the tape). Spin is included, so
// curving shots are aimed off-line and bend back on target. Returns {v, err, time}.
export function solveShot(from, target, speed, spin = 0, topspin = 0, opts = {}) {
  // a real player softens a drive that would sail long: try a few speeds, keep the first flat-ish answer
  let best = null;
  for (const f of opts.fixedSpeed ? [1] : [1, 0.86, 0.74, 0.63, 0.55]) {
    const r = solveAt(from, target, speed * f, spin * Math.sqrt(f), topspin, opts);
    r.speedFrac = f;
    if (!best || (r.err < 0.5 && (best.err >= 0.5 || r.pitch < best.pitch - 1e-9)) || (best.err >= 0.5 && r.err < best.err)) best = r;
    if (r.err < 0.5 && r.pitch < 0.6) break;
  }
  return best;
}

function solveAt(from, target, speed, spin, topspin, { clear = 0.25, preferHigh = false } = {}) {
  let aim = [target[0], target[1]];
  let best = null;
  for (let it = 0; it < 4; it++) {
    const dx = aim[0] - from[0], dz = aim[1] - from[2];
    const yaw = Math.atan2(dz, dx), dist = Math.hypot(dx, dz);
    const ux = Math.cos(yaw), uz = Math.sin(yaw);
    const shoot = (pitch) => {
      const v = [Math.cos(pitch) * ux * speed, Math.sin(pitch) * speed, Math.cos(pitch) * uz * speed];
      const r = simulate({ p: [...from], v, s: spin, t: topspin });
      const along = (r.land[0] - from[0]) * ux + (r.land[1] - from[2]) * uz;
      const ok = r.end.p[1] < COURT.ceiling - 0.2 && !r.hitNet && !(r.netCross != null && r.netCross < COURT.netH + clear) && Math.sign(r.land[0]) !== Math.sign(from[0]);
      return { v, r, f: along - dist, ok, pitch };
    };
    // scan pitch, bisect every sign change of (range - wanted range)
    const roots = [], grid = [];
    for (let deg = -60; deg <= 75; deg += 3) grid.push(shoot((deg * Math.PI) / 180));
    for (let i = 1; i < grid.length; i++) {
      let a = grid[i - 1], b = grid[i];
      if (Math.sign(a.f) === Math.sign(b.f)) continue;
      for (let k = 0; k < 9; k++) { const m = shoot((a.pitch + b.pitch) / 2); if (Math.sign(m.f) === Math.sign(a.f)) a = m; else b = m; }
      const m = Math.abs(a.f) < Math.abs(b.f) ? a : b;
      if (m.ok) roots.push(m);
    }
    let pick = roots.length ? roots[preferHigh ? roots.length - 1 : 0] : null;
    if (!pick) { // out of range: the clearing shot that gets closest
      for (const g of grid) if (g.ok && (!pick || Math.abs(g.f) < Math.abs(pick.f))) pick = g;
    }
    if (!pick) break;
    const land = pick.r.land;
    best = { v: pick.v, pitch: pick.pitch, err: Math.hypot(land[0] - target[0], land[1] - target[1]), time: pick.r.time, land };
    if (best.err < 0.15 || !roots.length) break;
    aim = [aim[0] + (target[0] - land[0]), aim[1] + (target[1] - land[1])];
  }
  if (!best) {
    // nothing clears the net: lob it straight up-court
    const dir = Math.sign(target[0] - from[0]) || 1;
    best = { v: [dir * speed * 0.6, speed * 0.8, 0], pitch: 1, err: 99, time: 2 };
  }
  return best;
}
