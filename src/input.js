// Keyboard + mouse state. Edge-triggered keys via `pressed(code)` (cleared each fixed tick by `endTick`).
// Right mouse drag + wheel feed the orbit camera (`takeLook()` returns and clears the accumulated deltas).
export class Input {
  constructor(el) {
    this.el = el;
    this.keys = new Set();
    this.edge = new Set();
    this.mouse = { x: 0, y: 0, down: false, right: false, moved: false };
    this.look = { dx: 0, dy: 0, wheel: 0 };
    this.enabled = true;
    addEventListener("keydown", (e) => {
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      if (!this.keys.has(e.code)) this.edge.add(e.code);
      this.keys.add(e.code);
      if (e.code === "Space" || e.code === "Tab") e.preventDefault();
    });
    addEventListener("keyup", (e) => this.keys.delete(e.code));
    addEventListener("blur", () => { this.keys.clear(); this.mouse.down = false; this.mouse.right = false; });
    el.addEventListener("pointermove", (e) => {
      if (this.mouse.right) { this.look.dx += e.movementX; this.look.dy += e.movementY; return; } // cursor stays put while orbiting
      const r = el.getBoundingClientRect();
      this.mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      this.mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      this.mouse.moved = true;
    });
    el.addEventListener("pointerdown", (e) => {
      if (e.button === 0) this.mouse.down = true;
      if (e.button === 2) { this.mouse.right = true; try { const r = el.requestPointerLock?.(); r?.catch?.(() => {}); } catch (_) {} }
    });
    addEventListener("pointerup", (e) => {
      if (e.button === 0) this.mouse.down = false;
      if (e.button === 2) { this.mouse.right = false; if (document.pointerLockElement === el) document.exitPointerLock(); }
    });
    document.addEventListener("mouseup", (e) => { if (e.button === 2 && this.mouse.right) { this.mouse.right = false; if (document.pointerLockElement === el) document.exitPointerLock(); } });
    el.addEventListener("wheel", (e) => { this.look.wheel += e.deltaY; e.preventDefault(); }, { passive: false });
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  }
  down(code) { return this.enabled && this.keys.has(code); }
  pressed(code) { return this.enabled && this.edge.has(code); }
  endTick() { this.edge.clear(); }
  takeLook() { const l = { ...this.look }; this.look.dx = this.look.dy = this.look.wheel = 0; return l; }
}
