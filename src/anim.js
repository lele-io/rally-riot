import * as THREE from "three";

// Procedural animation for the rigged avatar (blender/avatar_rig.py).
// rig.set(bone, x, y, z) rotates a bone about the MODEL's axes at rest (x = pitch: negative swings a limb forward,
// y = twist, z = roll sideways), relative to its parent — so the numbers mean the same thing whatever the bone's own axes are.
export const BONES = ["Hips", "Spine", "Chest", "Neck", "Head", "ArmL", "ForearmL", "HandL", "ArmR", "ForearmR", "HandR",
  "LegL", "ShinL", "FootL", "LegR", "ShinR", "FootR"];

const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _m = new THREE.Quaternion();

export class Rig {
  constructor(root) {
    this.root = root; this.b = {};
    root.updateMatrixWorld(true);
    const rootInv = new THREE.Quaternion(); root.getWorldQuaternion(rootInv).invert();
    for (const n of BONES) {
      const bone = root.getObjectByName(n);
      if (!bone || !bone.isBone) continue;
      const restWorld = new THREE.Quaternion(); bone.getWorldQuaternion(restWorld); restWorld.premultiply(rootInv);
      this.b[n] = { bone, rest: bone.quaternion.clone(), rw: restWorld, rwInv: restWorld.clone().invert() };
    }
    this.hipsY = this.b.Hips ? this.b.Hips.bone.position.y : 0;
  }
  get ok() { return !!this.b.ArmR; }
  set(n, x = 0, y = 0, z = 0) {
    const r = this.b[n]; if (!r) return;
    _q.setFromEuler(_e.set(x, y, z, "YXZ"));
    // model-axis rotation -> bone-local: rest * (rw^-1 * q * rw)
    _m.copy(r.rwInv).multiply(_q).multiply(r.rw);
    r.bone.quaternion.copy(r.rest).multiply(_m);
  }
  reset() { for (const n in this.b) this.b[n].bone.quaternion.copy(this.b[n].rest); }
  bob(dy) { if (this.b.Hips) this.b.Hips.bone.position.y = this.hipsY + dy; }
}

// A full-body pose from gameplay state. s: {run 0..1, phase, air, dash, swing:'idle'|'charge'|'swing'|'recover', charge 0..1, swingT, armA}
export function poseAthlete(rig, s) {
  const run = s.run, ph = s.phase, sw = Math.sin(ph), cw = Math.cos(ph);
  // legs: thigh swing, knee bends on the back-swing / when airborne, feet stay roughly level
  const air = s.air ? 1 : 0;
  for (const [side, sg] of [["L", 1], ["R", -1]]) {
    const t = sw * sg;
    let thigh = -t * 0.75 * run, knee = (Math.max(0, -Math.cos(ph + (sg > 0 ? 0 : Math.PI))) * 1.1 + 0.15) * run;
    if (air) { thigh = -0.55 - (sg > 0 ? 0.25 : 0); knee = 0.9 + (sg > 0 ? 0.3 : 0); }
    if (s.dash) { thigh = sg > 0 ? -0.7 : 0.45; knee = sg > 0 ? 0.6 : 0.5; }
    rig.set("Leg" + side, thigh + 0.03, 0, sg * 0.04);
    rig.set("Shin" + side, knee + 0.05);
    rig.set("Foot" + side, -(thigh + knee) * 0.35);
  }
  // torso: lean into the run, twist with the stride and into a charge
  const charge = s.swing === "charge" ? Math.min(1, 0.4 + s.charge * 0.6) : 0;
  const swingK = s.swing === "swing" ? 1 : 0;
  rig.set("Spine", 0.12 * run + (s.dash ? 0.3 : 0), sw * 0.12 * run - charge * 0.45 + swingK * 0.35, 0);
  rig.set("Chest", 0.04 * run, sw * 0.08 * run - charge * 0.25 + swingK * 0.25, 0);
  rig.set("Neck", -0.06 * run, charge * 0.3 - swingK * 0.2, 0);
  rig.bob(Math.abs(cw) * 0.035 * run - air * 0.0 - (s.dash ? 0.05 : 0));
  // free arm: counter-swing while running, reach forward to aim while charging
  rig.set("ArmL", sw * 0.7 * run - charge * 1.1 - (s.dash ? 0.5 : 0), 0, 0.12 + charge * 0.25);
  rig.set("ForearmL", -0.45 - 0.5 * run - charge * 0.3);
  rig.set("HandL", 0);
  // racket arm: shoulder angle comes from the gameplay swing state (same convention the old single-piece arm used)
  const a = s.armA, cocked = s.swing === "charge" ? 1 : 0;
  rig.set("ArmR", a, 0, -0.15 - cocked * 0.25);
  rig.set("ForearmR", -0.35 - cocked * 1.2 + swingK * 0.25);   // elbow folds to cock the racket, snaps straight on the hit
  rig.set("HandR", -0.2 - cocked * 0.5 + swingK * 0.4);
}
