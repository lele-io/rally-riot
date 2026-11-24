// Online play: quick match (relay matchmaking queue) and private rooms (share a code).
// Both end in a game room where the host sends {k:"start", roster} and everyone builds the same Match.
import { h } from "./ui.js";
import { connect, Session, RELAY_URL } from "./net.js";
import { profile } from "./save.js";
import { randomRacket } from "./rackets.js";
import { sfx } from "./sfx.js";

const BOTN = ["Netbot", "Auto-Ace", "Shuttle-9", "RoboRally", "Circuit", "Servo"];
const myId = () => profile().id + Math.random().toString(36).slice(2, 5); // unique per tab/session

// ---------------------------------------------------------------- tabs for the Play panel
export function onlineTabs(game) {
  return [["Quick Match", quickTab(game, false)], ["Private Room", privateTab(game)]];
}

export function quickTab(game, ranked) {
  const box = h("div", { class: "col", style: "align-items:flex-start;gap:12px" });
  const status = h("div", { class: "muted" });
  let conn = null;
  const draw = () => {
    box.innerHTML = "";
    box.append(h("div", { class: "muted" }, ranked ? "Ranked 1v1/2v2/3v3: win to climb. Missing players are filled with bots after a short wait in team modes." : "Find other players online. In 2v2/3v3, open seats fill with bots after ~12 s."));
    box.append(h("div", { class: "row", style: "justify-content:flex-start" }, ...[1, 2, 3].map((n) => h("button", { class: "btn " + (ranked ? "gold" : "cool"), onclick: () => queue(n) }, `${n}v${n}`))));
    box.append(status);
  };
  const queue = async (size) => {
    sfx.ui();
    const me = myId(), p = profile();
    conn?.close();
    conn = connect(`mm-${ranked ? "r" : ""}${size}`, me);
    status.innerHTML = ""; status.append(h("span", { class: "searching" }, `Searching for a ${size}v${size} match…`), " ", h("button", { class: "btn", onclick: () => { conn?.close(); conn = null; status.textContent = "Cancelled."; } }, "Cancel"));
    try { await conn.ready; } catch (e) { status.textContent = "Can't reach the online server right now."; return; }
    conn.send({ k: "queue", name: p.name, rating: p.rating, racket: p.equipped });
    conn.on((m) => {
      if (m.k !== "match") return;
      conn.close(); conn = null;
      status.textContent = "Match found!";
      joinGame(game, { room: m.room, me, hostId: m.host, size: m.size, ranked: !!m.ranked, humans: m.players });
    });
  };
  draw();
  return box;
}

function privateTab(game) {
  const box = h("div", { class: "col", style: "align-items:flex-start;gap:12px" });
  const code = h("input", { class: "codein", maxlength: 5, placeholder: "CODE" });
  box.append(
    h("div", { class: "muted" }, "Play with friends: create a room and share its code."),
    h("div", { class: "row", style: "justify-content:flex-start" },
      h("button", { class: "btn hot", onclick: () => room(game, box, makeCode(), true) }, "CREATE ROOM"),
      code, h("button", { class: "btn cool", onclick: () => code.value.trim() && room(game, box, code.value.trim().toUpperCase(), false) }, "JOIN")));
  return box;
}
const makeCode = () => Array.from({ length: 5 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 31)]).join("");

// a private room is also the game room: the creator is host and starts when ready
async function room(game, box, code, isHost) {
  sfx.ui();
  const me = myId(), p = profile();
  const conn = connect("p-" + code, me);
  const members = new Map([[me, { name: p.name, racket: p.equipped }]]);
  let hostId = isHost ? me : null, size = 1;
  box.innerHTML = "";
  const list = h("div", { class: "col", style: "gap:6px" }), info = h("div", { class: "muted" });
  const sizeSeg = h("div", { class: "seg" });
  const drawSize = () => { sizeSeg.innerHTML = ""; for (const n of [1, 2, 3]) sizeSeg.append(h("button", { class: n === size ? "on" : "", onclick: () => { size = n; drawSize(); } }, `${n}v${n}`)); };
  const start = h("button", { class: "btn hot", onclick: () => go() }, "START");
  const leave = h("button", { class: "btn", onclick: () => { conn.close(); box.replaceWith(privateTab(game)); } }, "LEAVE");
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
  const hi = (to) => conn.send({ k: "hi", from: me, name: p.name, racket: p.equipped, host: isHost }, to);
  const off = conn.on((m) => {
    if (m.k === "hello") { if (!isHost && !m.members.length) info.textContent = "No room with that code (yet)."; hi(); }
    if (m.k === "join") hi(m.id);
    if (m.k === "hi" && m.from) { members.set(m.from, { name: m.name, racket: m.racket }); if (m.host) hostId = m.from; draw(); }
    if (m.k === "leave") { members.delete(m.id); if (m.id === hostId) info.textContent = "The host left."; draw(); }
    if (m.k === "start") { off(); begin(m); }
  });
  draw();
  function go() {
    const humans = [...members].map(([id, m], i) => ({ id, name: m.name, racket: m.racket, team: i % 2 }));
    const msg = { k: "start", size, roster: roster(humans, size), host: me, points: size === 1 ? 11 : 15 };
    conn.send(msg); off(); begin(msg);
  }
  function begin(m) { startOnline(game, { conn, me, hostId: m.host, size: m.size, roster: m.roster, points: m.points, ranked: false }); }
}

// fill empty seats with bots, deterministic for everyone because only the host builds it
function roster(humans, size) {
  const out = [...humans], names = [...BOTN].sort(() => Math.random() - 0.5);
  for (const t of [0, 1]) {
    let n = out.filter((p) => p.team === t).length;
    while (n < size) { out.push({ id: `bot${t}${n}`, name: names.pop(), racket: randomRacket(3), team: t, bot: true }); n++; }
  }
  return out;
}

// quick match: everyone joins the game room; the host waits for the others (max 6 s) then starts
async function joinGame(game, { room, me, hostId, size, ranked, humans }) {
  const conn = connect(room, me);
  const overlay = h("div", { class: "screen dim" }, h("div", { class: "card" }, h("h2", {}, "Match found"), h("div", { class: "muted" }, "Connecting players…")));
  game.ui.append(overlay);
  try { await conn.ready; } catch (e) { overlay.remove(); return; }
  const here = new Set([me]);
  let started = false;
  const fire = () => {
    if (started) return; started = true;
    const present = humans.filter((p) => here.has(p.id));
    const msg = { k: "start", size, roster: roster(present, size), host: me, points: size === 1 ? 11 : 15, ranked };
    conn.send(msg); begin(msg);
  };
  const begin = (m) => { started = true; off(); overlay.remove(); startOnline(game, { conn, me, hostId, size: m.size, roster: m.roster, points: m.points, ranked: m.ranked }); };
  const off = conn.on((m) => {
    if (m.k === "hello") m.members.forEach((id) => here.add(id));
    if (m.k === "join") here.add(m.id);
    if (me === hostId && humans.every((p) => here.has(p.id))) fire();
    if (m.k === "start" && me !== hostId) begin(m);
  });
  if (me === hostId) setTimeout(fire, 6000);
  else setTimeout(() => { if (!started) { off(); conn.close(); overlay.remove(); game.toast?.("Match fell through — try again."); } }, 12000);
}

export function startOnline(game, { conn, me, hostId, size, roster, points, ranked }) {
  const net = new Session(conn, { me, hostId });
  const isHost = me === hostId;
  const players = roster.map((p) => ({
    id: p.id, name: p.name, team: p.team, racket: p.racket,
    kind: p.id === me ? "local" : p.bot && isHost ? "bot" : "remote", level: 0.55,
  }));
  const meP = roster.find((p) => p.id === me);
  const tn = (t) => (size === 1 ? roster.find((p) => p.team === t)?.name : t === meP.team ? "YOUR TEAM" : "RIVALS");
  game.startMatch({ type: ranked ? "ranked" : "online", size, players, localId: me, names: [tn(0), tn(1)], points, net, isHost });
}

export const relayInfo = () => RELAY_URL;
