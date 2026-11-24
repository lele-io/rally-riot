// Keyboard + mouse state. Edge-triggered keys via `pressed(code)` (cleared each fixed tick by `endTick`).
// Matches use an always-locked camera (like Wuthering Waves): the pointer is captured and mouse movement turns the
// camera (`takeLook()`); HOLD Alt to free the cursor, release to lock again. The wheel zooms.
// Mouse buttons use mousedown/mouseup (not pointer events): pointer events don't fire a second "down" while
// another button is held, which made some clicks go missing.
export class Input {
  constructor(el) {
    this.el = el;
    this.keys = new Set();
    this.edge = new Set();
    this.mouse = { x: 0, y: 0, down: false, moved: false };
    this.look = { dx: 0, dy: 0, wheel: 0 };
    this.enabled = true;
    this.wantLock = false;   // set by the Match while playing
    this.altHeld = false;
    this.onLockChange = null;
    const isAlt = (e) => e.code === "AltLeft" || e.code === "AltRight";

    addEventListener("keydown", (e) => {
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      if (isAlt(e)) { e.preventDefault(); if (!this.altHeld) { this.altHeld = true; this.unlock(); } return; }
      if (!this.keys.has(e.code)) this.edge.add(e.code);
      this.keys.add(e.code);
      if (e.code === "Space" || e.code === "Tab") e.preventDefault();
    });
    addEventListener("keyup", (e) => {
      if (isAlt(e)) { e.preventDefault(); this.altHeld = false; if (this.wantLock) this.lock(); return; }
      this.keys.delete(e.code);
    });
    addEventListener("blur", () => { this.keys.clear(); this.mouse.down = false; this.altHeld = false; });
    el.addEventListener("pointermove", (e) => {
      if (this.locked) { this.look.dx += e.movementX; this.look.dy += e.movementY; return; }
      const r = el.getBoundingClientRect();
      this.mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      this.mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      this.mouse.moved = true;
    });
    el.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      // clicking the game while the cursor is free grabs the camera again (that click doesn't swing)
      if (this.wantLock && !this.locked && !this.altHeld && !this.lockFailed) { this.lock(); return; }
      this.mouse.down = true;
    });
    addEventListener("mouseup", (e) => { if (e.button === 0) this.mouse.down = false; });
    document.addEventListener("pointerlockchange", () => this.onLockChange?.(this.locked));
    el.addEventListener("wheel", (e) => { this.look.wheel += e.deltaY; e.preventDefault(); }, { passive: false });
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  }
  get locked() { return document.pointerLockElement === this.el; }
  lock() { if (this.locked) return; try { const r = this.el.requestPointerLock?.(); r?.catch?.(() => { this.lockFailed = true; }); } catch (_) { this.lockFailed = true; } }
  unlock() { if (this.locked) document.exitPointerLock(); }
  setWantLock(on) { this.wantLock = on; if (on && !this.altHeld) this.lock(); else if (!on) this.unlock(); }
  down(code) { return this.enabled && this.keys.has(code); }
  pressed(code) { return this.enabled && this.edge.has(code); }
  endTick() { this.edge.clear(); }
  takeLook() { const l = { ...this.look }; this.look.dx = this.look.dy = this.look.wheel = 0; return l; }
}
