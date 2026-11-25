// One line-icon set for the whole UI: 24px grid, 1.75 stroke, currentColor (takes the text color it sits in).
import { h } from "./ui.js";

const S = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
export const ICONS = {
  play: `<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>`,
  friends: S(`<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19c.4-3.4 2.7-5.3 5.5-5.3s5.1 1.9 5.5 5.3"/><circle cx="16.8" cy="9.5" r="2.5"/><path d="M15.6 14.1c2.6.1 4.4 1.8 4.9 4.9"/>`),
  shop: S(`<path d="M5.5 8.5h13l-1 11h-11z"/><path d="M9 8.5V7a3 3 0 0 1 6 0v1.5"/>`),
  summon: S(`<circle cx="12" cy="11" r="6.5"/><circle cx="12" cy="11" r="2.6"/><path d="M6.5 20.5h11"/><path d="M9 20.5l1-3M15 20.5l-1-3"/>`),          // the shrine portal
  loadout: S(`<ellipse cx="9.5" cy="8.5" rx="5" ry="6" transform="rotate(-35 9.5 8.5)"/><path d="M6.8 5.7l5.4 5.4M5.3 8.6l4.4 4.4M9.4 4.3l4.4 4.4"/><path d="M13.6 13.4l6 6"/>`),   // racket
  custom: S(`<path d="M8.5 4.5l-4.5 2.5 1.6 4 2.4-1v10h8V10l2.4 1 1.6-4-4.5-2.5c-.4 1.6-1.8 2.6-3.5 2.6s-3.1-1-3.5-2.6z"/>`),   // shirt
  help: S(`<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1.1.9-1.1 1.7v.4"/><circle cx="12" cy="16.8" r=".6" fill="currentColor"/>`),
  keyboard: S(`<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6 9.5h.01M9.3 9.5h.01M12.6 9.5h.01M15.9 9.5h.01M18 9.5h.01M6 12.5h.01M18 12.5h.01M8.5 15h7"/><path d="M9.3 12.5h5.3"/>`),
  shuttle: S(`<circle cx="12" cy="18" r="2.6"/><path d="M9.6 16.8L6 5.5h12l-3.6 11.3"/><path d="M10 5.5l1 11M14 5.5l-1 11"/>`),
  shuttles: S(`<circle cx="9" cy="18" r="2.2"/><path d="M7 17L4 7.5h10L11 17"/><path d="M15.5 16.5l3-9.5"/><circle cx="17.2" cy="18" r="1.8"/><path d="M14 7.5h6.5"/>`),
  clover: S(`<path d="M12 12c-2.8-.2-4.6-1.7-4.6-3.6A2.4 2.4 0 0 1 12 7.1a2.4 2.4 0 0 1 4.6 1.3c0 1.9-1.8 3.4-4.6 3.6z"/><path d="M12 12c-2.8.2-4.6 1.7-4.6 3.6A2.4 2.4 0 0 0 12 16.9a2.4 2.4 0 0 0 4.6-1.3c0-1.9-1.8-3.4-4.6-3.6z"/><path d="M12 12l2.5 8.5"/>`),
};
export const iconEl = (k, cls = "") => { const s = h("span", { class: "ico " + cls }); s.innerHTML = ICONS[k] || ""; return s; };
