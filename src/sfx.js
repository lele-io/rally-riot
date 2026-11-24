// Tiny synthesized sound effects (no audio files).
let ctx = null, master = null;
export function audioUnlock() {
  if (ctx) { if (ctx.state === "suspended") ctx.resume(); return; }
  try { ctx = new AudioContext(); master = ctx.createGain(); master.gain.value = 0.35; master.connect(ctx.destination); } catch (e) {}
}
function noise(dur, freq, q, gain, type = "bandpass") {
  if (!ctx) return;
  const len = Math.floor(ctx.sampleRate * dur), b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  const s = ctx.createBufferSource(); s.buffer = b;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); g.gain.value = gain;
  s.connect(f); f.connect(g); g.connect(master); s.start();
}
function tone(f0, f1, dur, gain, type = "sine") {
  if (!ctx) return;
  const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master); o.start(); o.stop(t + dur);
}
export const sfx = {
  hit(power = 0) { noise(0.08, 2400 - power * 900, 1.2, 0.9 + power); tone(900 - power * 300, 300, 0.09, 0.25, "triangle"); },
  smash() { noise(0.25, 900, 0.7, 1.6); tone(220, 50, 0.35, 0.6, "sawtooth"); },
  swing() { noise(0.12, 1200, 0.6, 0.15, "highpass"); },
  dash() { noise(0.18, 600, 0.5, 0.35, "lowpass"); },
  jump() { tone(300, 600, 0.12, 0.12, "square"); },
  land() { noise(0.1, 300, 1, 0.5, "lowpass"); },
  point(good) { if (good) { tone(660, 990, 0.18, 0.25, "triangle"); setTimeout(() => tone(990, 1320, 0.25, 0.25, "triangle"), 120); } else tone(400, 200, 0.35, 0.25, "triangle"); },
  ui() { tone(800, 1000, 0.06, 0.12, "square"); },
  summon(tier) { for (let i = 0; i <= tier; i++) setTimeout(() => tone(400 + i * 180, 800 + i * 240, 0.3, 0.2, "triangle"), i * 140); },
};
