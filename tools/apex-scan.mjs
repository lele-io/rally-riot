// Scan many random shot setups with the in-game speed formula; report apex heights, flight times and solve cost.
// The follow camera can't show a shuttle much above ~8 m. node tools/apex-scan.mjs
import { solveShot, simulate } from "../src/shuttle.js";
const out = [];
let worstMs = 0, totMs = 0;
for (let i = 0; i < 150; i++) {
  const from = [-(0.5 + Math.random() * 8.5), 0.4 + Math.random() * 3.4, (Math.random() * 2 - 1) * 4.5];
  const c = Math.random(), smash = c >= 0.5 && from[1] >= 2.15;
  const to = [(smash ? 3 : 0.9) + Math.random() * (smash ? 5.7 : 7.8), (Math.random() * 2 - 1) * 4.7];
  const speed = 0.9 * 18 * (1 + 0.62 * c) * (smash ? 1.06 : 1); // match.js computeShot, mid-power racket
  const t0 = performance.now();
  const r = solveShot(from, to, speed, 0, smash ? 0.6 : 0, smash ? { clear: 0.1, maxApex: from[1] + 0.6 } : { clear: 0.3 });
  const ms = performance.now() - t0; worstMs = Math.max(worstMs, ms); totMs += ms;
  const sim = simulate({ p: from, v: r.v, s: 0, t: smash ? 0.6 : 0 });
  out.push({ apex: +sim.apex.toFixed(1), smash, c: c.toFixed(2), from: from.map((v) => v.toFixed(1)).join(","), to: to.map((v) => v.toFixed(1)).join(","), time: +sim.time.toFixed(2), err: r.err.toFixed(2) });
}
out.sort((a, b) => b.apex - a.apex);
console.table(out.slice(0, 8));
const sm = out.filter((o) => o.smash);
if (sm.length) console.log("smashes:", sm.length, "max apex", Math.max(...sm.map((o) => o.apex)), "fastest flight", Math.min(...sm.map((o) => o.time)), "s");
console.log("solve ms avg", (totMs / out.length).toFixed(1), "worst", worstMs.toFixed(0));
console.log("apex over 8 m:", out.filter((o) => o.apex > 8).length, "/", out.length);
