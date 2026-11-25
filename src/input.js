// Keyboard + mouse state, read through rebindable actions (keybinds.js). Mouse buttons are tracked like keys ("Mouse0" = left).
// Edge-triggered presses via `pressed()` (cleared each fixed tick by `endTick`), so a click that goes down and up between
// two ticks still counts once.
// Matches use an always-locked camera (like Wuthering Waves): the pointer is captured and mouse movement turns the
// camera (`takeLook()`); HOLD the "free cursor" key (Alt) to free the cursor, release to lock again. The wheel zooms.
// Mouse buttons use mousedown/mouseup (not pointer events): pointer events don't fire a second "down" while
// another button is held, which made some clicks go missing.
import { binds } from "./keybinds.js";

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
    this.capture = null;     // set while the controls screen waits for a key: (code) => void
    const isCursorKey = (code) => { const b = binds().cursor; return code === b || (/^Alt/.test(b) && /^Alt/.test(code)); };
    const press = (code) => { if (!this.keys.has(code)) this.edge.add(code); this.keys.add(code); };

    addEventListener("keydown", (e) => {
      if (this.capture) { e.preventDefault(); e.stopImmediatePropagation(); this.capture(e.code); return; }
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      if (/^Alt/.test(e.code)) e.preventDefault(); // stop Alt from focusing the browser menu
      if (isCursorKey(e.code)) { e.preventDefault(); if (!this.altHeld) { this.altHeld = true; this.unlock(); } return; }
      press(e.code);
      if (e.code === "Space" || e.code === "Tab") e.preventDefault();
    });
    addEventListener("keyup", (e) => {
      if (isCursorKey(e.code)) { e.preventDefault(); this.altHeld = false; if (this.wantLock) this.lock(); return; }
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
    addEventListener("mousedown", (e) => {
      if (this.capture) { e.preventDefault(); this.swallowClick = true; this.capture("Mouse" + e.button); return; }
      this.swallowClick = false; // a leftover flag (e.g. a right-click bind makes no "click") must not eat a later click
      if (e.target !== el) return;
      // clicking the game while the cursor is free grabs the camera again (that click doesn't swing)
      if (e.button === 0 && this.wantLock && !this.locked && !this.altHeld && !this.lockFailed) { this.lock(); return; }
      if (e.button === 0) this.mouse.down = true;
      press("Mouse" + e.button);
    });
    // the click that finishes a rebind must not also press the button under the cursor
    addEventListener("click", (e) => { if (this.swallowClick) { this.swallowClick = false; e.stopPropagation(); e.preventDefault(); } }, true);
    addEventListener("auxclick", (e) => { if (this.swallowClick) { this.swallowClick = false; e.stopPropagation(); } }, true);
    addEventListener("mouseup", (e) => { if (e.button === 0) this.mouse.down = false; this.keys.delete("Mouse" + e.button); });
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
  // by action name (see keybinds.js)
  act(a) { return this.down(binds()[a]); }
  actPressed(a) { return this.pressed(binds()[a]); }
  endTick() { this.edge.clear(); }
  takeLook() { const l = { ...this.look }; this.look.dx = this.look.dy = this.look.wheel = 0; return l; }
}
