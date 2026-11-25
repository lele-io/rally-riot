// Lobby menus (DOM). Each `open*` builds a panel into `host` and returns nothing; `close()` removes it.
import { h } from "./ui.js";
import { RACKETS, RACKET, RARITY, RARITIES, STAT_KEYS, STAT_LABEL, racketStats, summon, PITY } from "./rackets.js";
import { profile, update } from "./save.js";
import { sfx } from "./sfx.js";
import { HAIR, OUTFIT, HAT, FACE, EYES, BROWS, MOUTH, BUILD, EYEWEAR, NECK, WRIST, SKIN_TONES, PALETTE, EYE_COLORS, DEFAULT_LOOK, normalizeLook, randomLook } from "./looks.js";

export function panel(host, title, onClose, ...body) {
  const close = () => { wrap.remove(); removeEventListener("keydown", esc); onClose && onClose(); };
  const esc = (e) => { if (e.code === "Escape") close(); };
  addEventListener("keydown", esc);
  const wrap = h("div", { class: "drawer" },
    h("div", { class: "card panel" },
      h("div", { class: "phead" }, h("h2", {}, title), h("button", { class: "x", onclick: () => { sfx.ui(); close(); } }, "✕")),
      h("div", { class: "pbody" }, ...body)));
  host.append(wrap);
  return { close, wrap, body: wrap.querySelector(".pbody") };
}

export const rarityBadge = (r) => h("span", { class: "rbadge", style: `--rc:${RARITY[r].color}` }, RARITY[r].name);

export function statBars(id, compareTo) {
  const s = racketStats(id), c = compareTo ? racketStats(compareTo) : null;
  return h("div", { class: "stats" }, ...STAT_KEYS.map((k) => {
    const d = c ? s[k] - c[k] : 0;
    return h("div", { class: "stat" },
      h("span", { class: "sl" }, STAT_LABEL[k]),
      h("div", { class: "sb" }, h("i", { style: `width:${(s[k] / 12) * 100}%` })),
      h("b", {}, s[k]),
      h("span", { class: "sd " + (d > 0 ? "up" : d < 0 ? "down" : "") }, d ? (d > 0 ? "+" : "") + d : ""));
  }));
}

let iconSeq = 0;
export function racketIcon(r, owned = true) {
  // a tiny SVG of the racket: its frame family shape, frame -> second-color gradient, accent glow details, taped grip
  const id = "rg" + (++iconSeq), A = r.accent, F = r.frame, F2 = r.frame2 || r.frame;
  const head = {
    classic: `<rect x="8" y="5" width="24" height="30" rx="10" ry="12"/>`,
    aero: `<path d="M20 4 C34 4 34 18 31 26 C29 32 24 36 20 36 C16 36 11 32 9 26 C6 18 6 4 20 4 Z"/>`,
    blade: `<polygon points="20,3 33,11 33,27 20,37 7,27 7,11"/>`,
    storm: `<ellipse cx="20" cy="20" rx="12" ry="15"/>`,
    seraph: `<ellipse cx="20" cy="20" rx="12.5" ry="15.5"/>`,
    celestial: `<circle cx="20" cy="20" r="13"/>`,
  }[r.model] || `<ellipse cx="20" cy="20" rx="12" ry="15"/>`;
  const extra = {
    blade: `<path d="M33 11 L41 2 L35 14 Z M7 11 L-1 2 L5 14 Z" fill="${A}"/>`,
    storm: `<path d="M32 16 l5 -3 l-1 4 l5 -2 M8 16 l-5 -3 l1 4 l-5 -2" stroke="${A}" stroke-width="1.6" fill="none"/>`,
    seraph: `<path d="M8 22 L-3 8 L1 16 L-4 14 L3 26 Z M32 22 L43 8 L39 16 L44 14 L37 26 Z" fill="${F2}" stroke="${A}" stroke-width=".7"/><circle cx="20" cy="20" r="18" fill="none" stroke="${A}" stroke-width=".8"/>`,
    celestial: `<path d="M6 8 A17 17 0 0 0 10 34 A14 14 0 0 1 6 8 Z" fill="${F2}"/><path d="M20 -1 l1.5 3.5 l3.5 1.5 l-3.5 1.5 l-1.5 3.5 l-1.5 -3.5 l-3.5 -1.5 l3.5 -1.5 Z" fill="${A}"/><ellipse cx="20" cy="20" rx="20" ry="6" fill="none" stroke="${A}" stroke-width=".7" transform="rotate(-25 20 20)"/>`,
  }[r.model] || "";
  const svg = `<svg viewBox="-5 -3 50 67" width="40" height="54"><defs><linearGradient id="${id}" x1="0" y1="1" x2="0.3" y2="0"><stop offset="0" stop-color="${F}"/><stop offset="1" stop-color="${F2}"/></linearGradient></defs>
    ${extra}<g fill="none" stroke="url(#${id})" stroke-width="3.6">${head}</g>
    <path d="M14 13h12M12.5 19h15M13 25h14M15 31h10M16 8v26M20 6v29M24 8v26" stroke="#fff" stroke-opacity=".45" stroke-width=".8"/>
    <rect x="18.6" y="36" width="2.8" height="9" fill="${F}"/><circle cx="20" cy="38" r="2.2" fill="${A}"/>
    <rect x="17.3" y="45" width="5.4" height="15" rx="2" fill="#222"/><path d="M17.3 48l5.4 -2M17.3 52l5.4 -2M17.3 56l5.4 -2" stroke="${A}" stroke-width="1.2"/></svg>`;
  const e = h("div", { class: "ricon" + (owned ? "" : " locked") }); e.innerHTML = svg; return e;
}

// ---------------------------------------------------------------- loadout
export function openLoadout(host, lobby, onChange) {
  const p = profile();
  let sel = p.equipped;
  const detail = h("div", { class: "detail" });
  const grid = h("div", { class: "rgrid" });
  const drawGrid = () => {
    grid.innerHTML = "";
    for (const r of RACKETS) {
      const n = p.inv[r.id] || 0;
      const c = h("button", {
        class: "rcard" + (n ? "" : " locked") + (r.id === sel ? " sel" : "") + (r.id === p.equipped ? " eq" : ""), style: `--rc:${RARITY[r.rarity].color}`,
        onclick: () => { if (!n) return; sel = r.id; sfx.ui(); lobby.setRacket(sel); drawGrid(); drawDetail(); },
      }, racketIcon(r, !!n), h("div", { class: "rn" }, n ? r.name : "???"), n > 1 ? h("div", { class: "cnt" }, "×" + n) : null);
      grid.append(c);
    }
  };
  const drawDetail = () => {
    const r = RACKET[sel];
    detail.innerHTML = "";
    detail.append(
      h("div", { class: "dhead" }, h("div", {}, h("div", { class: "dname", style: `color:${RARITY[r.rarity].color}` }, r.name), rarityBadge(r.rarity)),
        sel === p.equipped ? h("span", { class: "chip" }, "EQUIPPED") : h("button", { class: "btn hot", onclick: () => { update((q) => (q.equipped = sel)); sfx.ui(); onChange && onChange(); drawGrid(); drawDetail(); } }, "EQUIP")),
      h("div", { class: "muted", style: "margin:4px 0 10px;font-style:italic" }, r.blurb),
      statBars(sel, sel === p.equipped ? null : p.equipped));
    if (sel !== p.equipped) detail.append(h("div", { class: "muted", style: "font-size:12px;margin-top:6px" }, "Green/red numbers compare with your equipped racket."));
  };
  const owned = RACKETS.filter((r) => p.inv[r.id]).length;
  drawGrid(); drawDetail();
  return panel(host, `Loadout · ${owned}/${RACKETS.length} collected`, () => lobby.setRacket(profile().equipped), h("div", { class: "loadout" }, detail, grid));
}

// ---------------------------------------------------------------- summon
export function openSummon(host, lobby, hud) {
  const ui = { };
  const counts = h("div", { class: "row" });
  const redraw = () => {
    const p = profile();
    counts.innerHTML = "";
    counts.append(
      h("button", { class: "btn cool", disabled: p.spins < 1, onclick: () => go(false, 1) }, h("div", {}, "SPIN"), h("small", {}, `uses 1 · you have ${p.spins}`)),
      h("button", { class: "btn cool", disabled: p.spins < 10, onclick: () => go(false, 10) }, h("div", {}, "SPIN ×10"), h("small", {}, "uses 10")),
      h("button", { class: "btn gold", disabled: p.lucky < 1, onclick: () => go(true, 1) }, h("div", {}, "LUCKY SPIN"), h("small", {}, `uses 1 · you have ${p.lucky}`)));
  };
  const rates = h("table", { class: "rates" }, h("tr", {}, h("th", {}, "Rarity"), h("th", {}, "Spin"), h("th", {}, "Lucky")),
    ...RARITIES.map((r) => {
      const t = (k) => RARITIES.reduce((a, x) => a + x[k], 0);
      return h("tr", {}, h("td", { style: `color:${r.color}` }, r.name), h("td", {}, (r.weight / t("weight") * 100).toFixed(1) + "%"), h("td", {}, (r.lucky / t("lucky") * 100).toFixed(1) + "%"));
    }));
  const pityLine = h("div", { class: "muted", style: "font-size:13px" });
  const redrawPity = () => (pityLine.textContent = `Legendary or better guaranteed within ${PITY - profile().pity} summons.`);
  const pn = panel(host, "Summon Altar", null,
    h("div", { class: "muted", style: "margin-bottom:12px" }, "Spend Spins to summon rackets. Lucky Spins skip most of the Commons."),
    counts, h("div", { style: "height:14px" }), pityLine, h("details", {}, h("summary", {}, "Drop rates"), rates));
  redraw(); redrawPity();

  function go(lucky, n) {
    const results = [];
    update((p) => {
      if (lucky) p.lucky -= n; else p.spins -= n;
      for (let i = 0; i < n; i++) {
        const r = summon(lucky, p.pity);
        p.pity = RARITY[r.rarity].tier >= 4 ? 0 : p.pity + 1;
        const isNew = !p.inv[r.id];
        p.inv[r.id] = (p.inv[r.id] || 0) + 1;
        // duplicates refund some Yen (phase 4 economy)
        const refund = isNew ? 0 : [20, 40, 80, 160, 400, 1000][RARITY[r.rarity].tier];
        p.yen += refund;
        results.push({ r, isNew, refund });
      }
    });
    hud && hud();
    pn.wrap.style.display = "none";
    reveal(host, lobby, results, () => { pn.wrap.style.display = ""; lobby.endSummon(); redraw(); redrawPity(); hud && hud(); });
  }
  return pn;
}

function reveal(host, lobby, results, done) {
  let i = 0;
  const box = h("div", { class: "reveal" }); host.append(box); host.classList.add("cine");
  const finish = () => { box.remove(); host.classList.remove("cine"); done(); };
  const summary = () => {
    box.innerHTML = "";
    box.append(h("div", { class: "card", style: "max-width:640px" }, h("h2", {}, "Summon results"),
      h("div", { class: "rgrid" }, ...results.map(({ r, isNew }) => h("div", { class: "rcard", style: `--rc:${RARITY[r.rarity].color}` }, racketIcon(r), h("div", { class: "rn" }, r.name), isNew ? h("div", { class: "new" }, "NEW") : null))),
      h("div", { class: "row", style: "margin-top:12px" }, h("button", { class: "btn hot", onclick: finish }, "DONE"))));
  };
  const next = () => {
    if (i >= results.length) return results.length > 1 ? summary() : finish();
    const { r, isNew, refund } = results[i++];
    box.innerHTML = "";
    const skip = results.length > 1 ? h("button", { class: "btn", onclick: () => { lobby.endSummon(); summary(); } }, "SKIP") : null;
    box.append(h("div", { class: "row", style: "position:absolute;bottom:24px;left:0;right:0" }, skip));
    lobby.playSummon(r, () => {
      sfx.summon(RARITY[r.rarity].tier);
      box.innerHTML = "";
      box.append(h("div", { class: "revealcard", style: `--rc:${RARITY[r.rarity].color}` },
        rarityBadge(r.rarity),
        h("div", { class: "dname" }, r.name), isNew ? h("div", { class: "new big" }, "NEW!") : h("div", { class: "muted" }, `Duplicate · +${refund} Yen`),
        statBars(r.id),
        h("div", { class: "row", style: "margin-top:12px" },
          h("button", { class: "btn hot", onclick: next }, i < results.length ? `NEXT (${i}/${results.length})` : "CONTINUE"),
          skip && i < results.length ? h("button", { class: "btn", onclick: () => { lobby.endSummon(); summary(); } }, "SKIP") : null)));
    });
  };
  next();
}

// ---------------------------------------------------------------- play
export function openPlay(host, start, extraTabs = []) {
  const p = profile();
  let size = 1, level = p.settings.bot ?? 0.5;
  const seg = (opts, get, set) => {
    const s = h("div", { class: "seg" });
    const draw = () => { s.innerHTML = ""; for (const [n, v] of opts) s.append(h("button", { class: get() === v ? "on" : "", onclick: () => { set(v); sfx.ui(); draw(); } }, n)); };
    draw(); return s;
  };
  const casual = h("div", { class: "col", style: "align-items:flex-start;gap:12px" },
    h("div", { class: "lbl" }, "Mode"), seg([["1v1", 1], ["2v2", 2], ["3v3", 3]], () => size, (v) => (size = v)),
    h("div", { class: "lbl" }, "Bot skill"), seg([["Easy", 0.2], ["Normal", 0.5], ["Hard", 0.85]], () => level, (v) => { level = v; update((q) => (q.settings.bot = v)); }),
    h("button", { class: "btn hot", style: "margin-top:6px;font-size:20px;padding:14px 34px", onclick: () => start({ type: "casual", size, level }) }, "START"));
  const tabs = [["Casual", casual], ...extraTabs];
  const body = h("div", {});
  const bar = h("div", { class: "tabs" });
  const show = (k) => { body.innerHTML = ""; body.append(tabs[k][1]); bar.querySelectorAll("button").forEach((b, j) => b.classList.toggle("on", j === k)); };
  tabs.forEach(([n], k) => bar.append(h("button", { onclick: () => { sfx.ui(); show(k); } }, n)));
  const pn = tabs.length > 1 ? panel(host, "Play", null, bar, body) : panel(host, "Play vs Bots", null, body);
  show(0);
  return pn;
}

// ---------------------------------------------------------------- customize (character look)

export function openCustomize(host, lobby, onChange) {
  let look = normalizeLook(profile().look);
  const body = h("div", { class: "col", style: "gap:14px" });
  const commit = () => { update((p) => (p.look = { ...look })); lobby.setLook(look); onChange && onChange(); };
  const chips = (list, key) => h("div", { class: "chipsel" }, ...list.map(([id, label]) =>
    h("button", { class: "opt" + (look[key] === id ? " on" : ""), onclick: () => { look[key] = id; sfx.ui(); commit(); draw(); } }, label)));
  const swatches = (key, colors) => {
    const custom = h("input", { type: "color", value: look[key], title: "Any color", oninput: (e) => { look[key] = e.target.value; commit(); } });
    custom.addEventListener("change", draw);
    return h("div", { class: "swatches" }, ...colors.map((c) =>
      h("button", { class: "sw" + (look[key].toLowerCase() === c ? " on" : ""), style: `background:${c}`, title: c, onclick: () => { look[key] = c; sfx.ui(); commit(); draw(); } })), h("label", { class: "sw custom", title: "Pick any color" }, custom));
  };
  const row = (label, ...kids) => h("div", { class: "col", style: "gap:6px" }, h("div", { class: "lbl" }, label), ...kids);
  // categories like a character creator: body, face, hair, clothes, then Roblox-style accessory slots that all stack
  const tabs = {
    Body: () => [row("Skin tone", swatches("skin", SKIN_TONES)), row("Build", chips(BUILD, "build"))],
    Face: () => [row("Eyes", chips(EYES, "eyeStyle")), row("Eye color", swatches("eyes", EYE_COLORS)), row("Brows", chips(BROWS, "brows")),
      row("Mouth", chips(MOUTH, "mouth")), row("Face detail", chips(FACE, "face"))],
    Hair: () => [row("Style", chips(HAIR, "hair")), row("Hair color", swatches("hairColor", PALETTE))],
    Outfit: () => [row("Outfit", chips(OUTFIT, "outfit")), row("Main color", swatches("c1", PALETTE)), row("Trim / shorts color", swatches("c2", PALETTE))],
    Accessories: () => [row("Head", chips(HAT, "hat")), row("Eyewear", chips(EYEWEAR, "eyewear")), row("Neck", chips(NECK, "neck")), row("Wrists", chips(WRIST, "wrist")),
      row("Accessory color", swatches("hatColor", PALETTE)), row("Accent color", swatches("hatBand", PALETTE))],
  };
  let tab = "Body";
  const bar = h("div", { class: "tabs" });
  function draw() {
    bar.innerHTML = "";
    for (const t of Object.keys(tabs)) bar.append(h("button", { class: t === tab ? "on" : "", onclick: () => { tab = t; sfx.ui(); draw(); } }, t));
    body.innerHTML = "";
    body.append(...tabs[tab]());
  }
  draw();
  const tools = h("div", { class: "row", style: "justify-content:flex-start;margin-top:14px" },
    h("button", { class: "btn cool", onclick: () => { look = normalizeLook(randomLook()); sfx.summon(1); commit(); draw(); } }, "RANDOMIZE"),
    h("button", { class: "btn", onclick: () => { look = { ...DEFAULT_LOOK }; sfx.ui(); commit(); draw(); } }, "RESET"));
  lobby.closeup = true;
  const pn = panel(host, "Customize", () => { lobby.closeup = false; }, bar, body, tools,
    h("div", { class: "muted", style: "font-size:12px;margin-top:10px" }, "Your look is saved automatically and shows up in online matches too. The Team Scarf and the ring under your feet show your team color."));
  return pn;
}
