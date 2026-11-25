// Rebindable controls. A bind is a KeyboardEvent.code ("KeyW", "Space", "ShiftLeft") or a mouse button ("Mouse0" = left,
// "Mouse1" = middle, "Mouse2" = right). Saved in profile.settings.keys; Input reads them live, so changes apply at once.
import { profile, update } from "./save.js";

export const ACTIONS = [
  ["forward", "Move forward"], ["back", "Move back"], ["left", "Move left"], ["right", "Move right"],
  ["swing", "Swing (hold = power)"], ["jump", "Jump"], ["dash", "Dash"], ["cursor", "Hold to free the cursor"],
];
export const DEFAULT_BINDS = { forward: "KeyW", back: "KeyS", left: "KeyA", right: "KeyD", swing: "Mouse0", jump: "Space", dash: "ShiftLeft", cursor: "AltLeft" };

export function binds() {
  const k = profile().settings?.keys || {};
  return { ...DEFAULT_BINDS, ...k };
}

// set one action; whatever action used that key before gets this action's old key (a swap, so nothing is left unbound)
export function setBind(action, code) {
  const cur = binds();
  const old = cur[action];
  for (const a of Object.keys(cur)) if (a !== action && cur[a] === code) cur[a] = old;
  cur[action] = code;
  update((p) => { p.settings = { ...(p.settings || {}), keys: cur }; });
}
export function resetBinds() { update((p) => { p.settings = { ...(p.settings || {}), keys: { ...DEFAULT_BINDS } }; }); }

const NAMES = { Mouse0: "LEFT CLICK", Mouse1: "MIDDLE CLICK", Mouse2: "RIGHT CLICK", Mouse3: "MOUSE 4", Mouse4: "MOUSE 5", Space: "SPACE",
  ShiftLeft: "L-SHIFT", ShiftRight: "R-SHIFT", ControlLeft: "L-CTRL", ControlRight: "R-CTRL", AltLeft: "L-ALT", AltRight: "R-ALT",
  ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Tab: "TAB", CapsLock: "CAPS", Enter: "ENTER", Backquote: "`" };
export function keyName(code) {
  if (!code) return "—";
  if (NAMES[code]) return NAMES[code];
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return "NUM " + code.slice(6);
  return code.replace(/([a-z])([A-Z])/g, "$1 $2").toUpperCase();
}
