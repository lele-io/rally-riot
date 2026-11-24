// Quick check of shot feel: flight times / accuracy for typical shots. node tools/tune.mjs
import { solveShot, simulate } from "../src/shuttle.js";
const cases = [
  ["clear from back", [-8, 1.3, 0], [7.5, 0], 18],
  ["clear weak", [-8, 1.3, 0], [7.5, 0], 14],
  ["drive mid", [-4, 1.3, 2], [5, -3], 22],
  ["drop", [-6, 1.5, 0], [1.5, 2], 14],
  ["smash", [-3, 3.2, 0], [5, 2], 38],
  ["smash far", [-7, 3.0, 0], [6, -3], 38],
  ["spin curve", [-6, 1.3, -3], [6, 3], 22, 3],
  ["low from front", [-1.5, 0.6, 0], [6, 0], 16],
];
for (const [n, f, t, sp, spin = 0] of cases) {
  const t0 = performance.now();
  const r = solveShot(f, t, sp, spin);
  const sim = simulate({ p: f, v: r.v, s: spin, t: 0 });
  let apex = 0; simulate({ p: f, v: r.v, s: spin, t: 0 }, 6, (st) => (apex = Math.max(apex, st.p[1])));
  const pitch = (Math.atan2(r.v[1], Math.hypot(r.v[0], r.v[2])) * 180) / Math.PI;
  console.log(n.padEnd(16), "err", r.err.toFixed(2), "time", sim.time.toFixed(2), "pitch", pitch.toFixed(0), "apex", apex.toFixed(1), "net", sim.netCross?.toFixed(2), "ms", (performance.now() - t0).toFixed(1));
}
