import * as THREE from "three";

// Additive particles: colors fade to black, which reads as transparent with additive blending.
const N = 1200;
export class FX {
  constructor(scene) {
    this.scene = scene;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(N * 3); this.col = new Float32Array(N * 3);
    this.vel = new Float32Array(N * 3); this.life = new Float32Array(N); this.max = new Float32Array(N);
    this.base = new Float32Array(N * 3); this.grav = new Float32Array(N);
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({
      size: 0.22, vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, map: dotTexture(),
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.i = 0;

    // shuttle trail
    this.trailN = 40;
    const tg = new THREE.BufferGeometry();
    this.tPos = new Float32Array(this.trailN * 3); this.tCol = new Float32Array(this.trailN * 3);
    tg.setAttribute("position", new THREE.BufferAttribute(this.tPos, 3));
    tg.setAttribute("color", new THREE.BufferAttribute(this.tCol, 3));
    this.trail = new THREE.Points(tg, new THREE.PointsMaterial({
      size: 0.3, vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, map: dotTexture(),
    }));
    this.trail.frustumCulled = false;
    scene.add(this.trail);
    this.trailColor = new THREE.Color(1, 1, 1); this.trailBoost = 0; this.hist = [];

    this.rings = [];
    this.shakeAmt = 0;
  }

  emit(p, color, n = 30, speed = 6, life = 0.6, up = 0, grav = 6) {
    const c = new THREE.Color(color);
    for (let k = 0; k < n; k++) {
      const i = this.i; this.i = (this.i + 1) % N;
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u), s = speed * (0.35 + Math.random() * 0.65);
      this.vel[i * 3] = r * Math.cos(a) * s; this.vel[i * 3 + 1] = u * s + up; this.vel[i * 3 + 2] = r * Math.sin(a) * s;
      this.life[i] = this.max[i] = life * (0.6 + Math.random() * 0.6);
      this.base[i * 3] = c.r; this.base[i * 3 + 1] = c.g; this.base[i * 3 + 2] = c.b; this.grav[i] = grav;
    }
  }

  ring(p, color, size = 3, life = 0.45, flat = true) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 6, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.position.copy(p); if (flat) m.rotation.x = Math.PI / 2;
    this.scene.add(m); this.rings.push({ m, t: 0, life, size });
  }

  shake(a) { this.shakeAmt = Math.max(this.shakeAmt, a); }

  setTrail(color, boost = 0) { this.trailColor.set(color); this.trailBoost = boost; }
  clearTrail() { this.hist.length = 0; }

  update(dt, shuttlePos, flying) {
    for (let i = 0; i < N; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const f = Math.max(0, this.life[i] / this.max[i]);
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      this.vel[i * 3] *= 0.97; this.vel[i * 3 + 2] *= 0.97;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.col[i * 3] = this.base[i * 3] * f; this.col[i * 3 + 1] = this.base[i * 3 + 1] * f; this.col[i * 3 + 2] = this.base[i * 3 + 2] * f;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;

    if (flying) { this.hist.unshift(shuttlePos.clone()); if (this.hist.length > this.trailN) this.hist.pop(); }
    else if (this.hist.length) this.hist.pop();
    const len = this.trailBoost > 0 ? this.trailN : 18;
    for (let i = 0; i < this.trailN; i++) {
      const h = this.hist[i];
      const f = h && i < len ? (1 - i / len) * (0.45 + this.trailBoost) : 0;
      if (h) { this.tPos[i * 3] = h.x; this.tPos[i * 3 + 1] = h.y; this.tPos[i * 3 + 2] = h.z; }
      this.tCol[i * 3] = this.trailColor.r * f; this.tCol[i * 3 + 1] = this.trailColor.g * f; this.tCol[i * 3 + 2] = this.trailColor.b * f;
    }
    this.trail.material.size = 0.25 + this.trailBoost * 0.35;
    this.trail.geometry.attributes.position.needsUpdate = true;
    this.trail.geometry.attributes.color.needsUpdate = true;
    if (flying && this.trailBoost > 0 && Math.random() < 0.6) this.emit(shuttlePos, this.trailColor, 1, 1.2, 0.35, 0, 0);

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]; r.t += dt;
      const f = r.t / r.life;
      r.m.scale.setScalar(0.2 + f * r.size); r.m.material.opacity = 1 - f;
      if (f >= 1) { this.scene.remove(r.m); r.m.geometry.dispose(); r.m.material.dispose(); this.rings.splice(i, 1); }
    }
    this.shakeAmt *= Math.exp(-dt * 7);
  }

  dispose() {
    this.scene.remove(this.points); this.scene.remove(this.trail);
    for (const r of this.rings) this.scene.remove(r.m);
  }
}

let dotTex = null;
function dotTexture() {
  if (dotTex) return dotTex;
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const x = c.getContext("2d"), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.35, "rgba(255,255,255,0.6)"); g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return (dotTex = new THREE.CanvasTexture(c));
}
