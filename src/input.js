// Keyboard + mouse state. Edge-triggered keys via `pressed(code)` (cleared each fixed tick by `endTick`).
export class Input {
  constructor(el) {
    this.keys = new Set();
    this.edge = new Set();
    this.mouse = { x: 0, y: 0, down: false, moved: false };
    this.enabled = true;
    addEventListener("keydown", (e) => {
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      if (!this.keys.has(e.code)) this.edge.add(e.code);
      this.keys.add(e.code);
      if (e.code === "Space" || e.code === "Tab") e.preventDefault();
    });
    addEventListener("keyup", (e) => this.keys.delete(e.code));
    addEventListener("blur", () => { this.keys.clear(); this.mouse.down = false; });
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      this.mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      this.mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      this.mouse.moved = true;
    });
    el.addEventListener("pointerdown", (e) => { if (e.button === 0) this.mouse.down = true; });
    addEventListener("pointerup", (e) => { if (e.button === 0) this.mouse.down = false; });
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  }
  down(code) { return this.enabled && this.keys.has(code); }
  pressed(code) { return this.enabled && this.edge.has(code); }
  endTick() { this.edge.clear(); }
}
