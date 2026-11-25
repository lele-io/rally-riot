// Online play with friends: private rooms (share a 5-letter code). The room doubles as the game room:
// the host sends {k:"start", roster} and everyone builds the same Match.
import { h } from "./ui.js";
import { connect, Session, RELAY_URL } from "./net.js";
import { profile } from "./save.js";
import { randomRacket } from "./rackets.js";
import { normalizeLook, randomLook } from "./looks.js";
import { sfx } from "./sfx.js";

const BOTN = ["Netbot", "Auto-Ace", "Shuttle-9", "RoboRally", "Circuit", "Servo"];
const myId = () => profile().id + Math.random().toString(36).slice(2, 5); // unique per tab/session

// ---------------------------------------------------------------- Play with Friends panel body
export function privateTab(game) {
  const box = h("div", { class: "col", style: "align-items:flex-start;gap:12px" });
  const code = h("input", { class: "codein", maxlength: 5, placeholder: "CODE" });
  box.append(
    h("div", { class: "muted" }, "Play with friends: create a room and share its code."),
    h("div", { class: "row", style: "justify-content:flex-start" },
      h("button", { class: "btn hot", onclick: () => room(game, box, makeCode(), true) }, "Create room"),
      code, h("button", { class: "btn cool", onclick: () => code.value.trim() && room(game, box, code.value.trim().toUpperCase(), false) }, "JOIN")));
  return box;
}
const makeCode = () => Array.from({ length: 5 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 31)]).join("");

// a private room is also the game room: the creator is host and starts when ready
async function room(game, box, code, isHost) {
  sfx.ui();
  const me = myId(), p = profile();
  const conn = connect("p-" + code, me);
  const myLook = normalizeLook(p.look);
  const members = new Map([[me, { name: p.name, racket: p.equipped, look: myLook }]]);
  let hostId = isHost ? me : null, size = 1;
  box.innerHTML = "";
  const list = h("div", { class: "col", style: "gap:6px" }), info = h("div", { class: "muted" });
  const sizeSeg = h("div", { class: "seg" });
  const drawSize = () => { sizeSeg.innerHTML = ""; for (const n of [1, 2, 3]) sizeSeg.append(h("button", { class: n === size ? "on" : "", onclick: () => { size = n; drawSize(); } }, `${n}v${n}`)); };
  const start = h("button", { class: "btn hot", onclick: () => go() }, "Start");
  const leave = h("button", { class: "btn", onclick: () => { conn.close(); box.replaceWith(privateTab(game)); } }, "Leave");
  box.append(h("div", { class: "roomcode" }, "ROOM ", h("b", {}, code)), list, info,
    isHost ? h("div", { class: "row", style: "justify-content:flex-start" }, sizeSeg, start, leave) : h("div", { class: "row" }, leave));
  drawSize();
  const draw = () => {
    list.innerHTML = "";
    [...members].forEach(([id, m], i) => list.append(h("div", { class: "member" }, h("span", { class: "dot t" + (i % 2) }), m.name, id === hostId ? h("span", { class: "chip" }, "HOST") : null, id === me ? h("span", { class: "muted" }, "(you)") : null)));
    info.textContent = isHost ? `Teams alternate in join order. Empty seats are bots. Share the code: ${code}` : "Waiting for the host to start…";
    if (isHost && size * 2 < members.size) { size = Math.min(3, Math.ceil(members.size / 2)); drawSize(); }
  };
  try { await conn.ready; } catch (e) { info.textContent = "Can't reach the online server right now."; return; }
  const hi = (to) => conn.send({ k: "hi", from: me, name: p.name, racket: p.equipped, look: myLook, host: isHost }, to);
  const off = conn.on((m) => {
    if (m.k === "hello") { if (!isHost && !m.members.length) info.textContent = "No room with that code (yet)."; hi(); }
    if (m.k === "join") hi(m.id);
    if (m.k === "hi" && m.from) { members.set(m.from, { name: m.name, racket: m.racket, look: normalizeLook(m.look) }); if (m.host) hostId = m.from; draw(); }
    if (m.k === "leave") { members.delete(m.id); if (m.id === hostId) info.textContent = "The host left."; draw(); }
    if (m.k === "start") { off(); begin(m); }
  });
  draw();
  function go() {
    const humans = [...members].map(([id, m], i) => ({ id, name: m.name, racket: m.racket, look: m.look, team: i % 2 }));
    const msg = { k: "start", size, roster: roster(humans, size), host: me, points: size === 1 ? 11 : 15 };
    conn.send(msg); off(); begin(msg);
  }
  function begin(m) { startOnline(game, { conn, me, hostId: m.host, size: m.size, roster: m.roster, points: m.points }); }
}

// fill empty seats with bots, deterministic for everyone because only the host builds it
function roster(humans, size) {
  const out = [...humans], names = [...BOTN].sort(() => Math.random() - 0.5);
  for (const t of [0, 1]) {
    let n = out.filter((p) => p.team === t).length;
    while (n < size) { out.push({ id: `bot${t}${n}`, name: names.pop(), racket: randomRacket(3), team: t, bot: true, look: randomLook() }); n++; }
  }
  return out;
}

export function startOnline(game, { conn, me, hostId, size, roster, points }) {
  const net = new Session(conn, { me, hostId });
  const isHost = me === hostId;
  const players = roster.map((p) => ({
    id: p.id, name: p.name, team: p.team, racket: p.racket, look: normalizeLook(p.look),
    kind: p.id === me ? "local" : p.bot && isHost ? "bot" : "remote", level: 0.45,
  }));
  const meP = roster.find((p) => p.id === me);
  const tn = (t) => (size === 1 ? roster.find((p) => p.team === t)?.name : t === meP.team ? "Your team" : "Rivals");
  game.startMatch({ type: "online", size, players, localId: me, names: [tn(0), tn(1)], points, net, isHost, online: { conn, me, hostId, size, roster, points } });
}

// end-screen rematch: the host restarts the same room with the same teams (anyone who left is a bot now);
// the others can ask for one, which shows up on the host's screen
export function rematchBox(game, cfg) {
  const o = cfg.online, net = cfg.net, conn = o.conn, isHost = o.me === o.hostId;
  if (!conn?.open) return null;
  const wants = h("div", { class: "wants" }), voters = new Set();
  const begin = (m) => { off(); net.off(); startOnline(game, { conn, me: o.me, hostId: m.host, size: m.size, roster: m.roster, points: m.points }); };
  const btn = h("button", { class: "btn hot", onclick: () => {
    sfx.ui();
    if (isHost) {
      const roster = o.roster.map((p) => (net.left.has(p.id) && !p.bot ? { ...p, bot: true, name: p.name + " (bot)" } : p));
      const msg = { k: "start", size: o.size, roster, host: o.me, points: o.points };
      conn.send(msg); begin(msg);
    } else { conn.send({ k: "again", name: profile().name }, o.hostId); btn.disabled = true; btn.textContent = "Waiting for the host"; }
  } }, isHost ? "Rematch" : "Ask for a rematch");
  const off = conn.on((m) => {
    if (m.k === "again" && isHost) { voters.add(m.name); wants.textContent = [...voters].join(", ") + (voters.size > 1 ? " want" : " wants") + " a rematch!"; sfx.ui(); }
    if (m.k === "start" && !isHost) begin(m);
    if (!isHost && ((m.k === "leave" && m.id === o.hostId) || m.k === "closed")) { wants.textContent = "The host left the room."; btn.disabled = true; }
  });
  if (!isHost && net.pendingStart) { const m = net.pendingStart; net.pendingStart = null; setTimeout(() => begin(m), 0); }
  return h("div", { class: "col", style: "align-items:center;gap:6px;margin-top:4px" }, btn, wants);
}

export const relayInfo = () => RELAY_URL;
