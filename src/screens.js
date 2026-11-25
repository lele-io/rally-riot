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

export function racketIcon(r, owned = true) {
  // a tiny SVG of the racket head shape in its colors
  const shape = r.model === "blade"
    ? `<polygon points="20,4 33,12 33,28 20,36 7,28 7,12" fill="none" stroke="${r.frame}" stroke-width="3.5"/>`
    : `<ellipse cx="20" cy="20" rx="12" ry="15" fill="none" stroke="${r.frame}" stroke-width="3.5"/>`;
  const wing = r.model === "wing" ? `<path d="M6 22 L-2 12 L4 26 Z M34 22 L42 12 L36 26 Z" fill="${r.accent}"/><ellipse cx="20" cy="20" rx="17" ry="17" fill="none" stroke="${r.accent}" stroke-width="1"/>` : "";
  const svg = `<svg viewBox="-4 0 48 64" width="40" height="54">${wing}${shape}<path d="M14 14h12M13 20h14M14 26h12M17 8v24M20 6v28M23 8v24" stroke="#fff" stroke-opacity=".5" stroke-width=".8"/><rect x="18.5" y="35" width="3" height="10" fill="${r.frame}"/><circle cx="20" cy="37" r="2.5" fill="${r.accent}"/><rect x="17.5" y="45" width="5" height="15" rx="2" fill="#222"/></svg>`;
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
