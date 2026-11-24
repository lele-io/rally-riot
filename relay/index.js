// Rally Riot relay — Cloudflare Worker + Durable Object, same pattern as cupidium-relay:
//   GET /ws/<room>?me=<id>   WebSocket room (hibernates when idle). Messages are JSON {to:"*"|id, ...};
//                            "*" (or no `to`) goes to everyone else in the room, an id goes to that member.
// Extras for the game:
//   - On connect the newcomer gets {k:"hello", members:[ids]} and the others get {k:"join", id}; on close {k:"leave", id}.
//   - Rooms named mm-<mode> are matchmaking queues: clients send {k:"queue", name, rating, racket};
//     the room answers {k:"match", room, host, size, players:[{id,name,racket,team}]} once a match is formed
//     (full lobby, or after a wait in team modes with bots filling the gaps).
//   GET /health -> ok
import { DurableObject } from "cloudflare:workers";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "*" };
const ROOM_RE = /^[A-Za-z0-9_-]{1,64}$/, ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const MAX_MEMBERS = 24, MAX_MSG = 16384;
const json = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { ...CORS, "content-type": "application/json" } });

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(req.url), parts = url.pathname.split("/").filter(Boolean);
    if (!parts.length || parts[0] === "health") return new Response("rally riot relay ok", { headers: CORS });
    if (parts[0] === "ws") {
      const room = parts[1] || "", me = url.searchParams.get("me") || "";
      if (!ROOM_RE.test(room) || !ID_RE.test(me)) return json({ error: "bad room" }, 400);
      if ((req.headers.get("Upgrade") || "").toLowerCase() !== "websocket") return json({ error: "expected websocket" }, 426);
      return env.ROOM.get(env.ROOM.idFromName(room)).fetch(req);
    }
    return json({ error: "not found" }, 404);
  },
};

// matchmaking: mm-<size> (casual) or mm-r<size> (ranked). Team modes start after QUEUE_WAIT with whoever is there.
const QUEUE_WAIT = 12000;

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    try { ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong")); } catch (e) {}
  }

  async fetch(req) {
    const url = new URL(req.url), me = url.searchParams.get("me") || "x";
    const room = url.pathname.split("/").filter(Boolean)[1] || "";
    if (this.ctx.getWebSockets().length >= MAX_MEMBERS) return new Response("room full", { status: 429 });
    // a reconnect with the same id replaces the old socket
    for (const old of this.ctx.getWebSockets(me)) { try { old.close(4000, "replaced"); } catch (e) {} }
    const pair = new WebSocketPair(), [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [me]);
    server.serializeAttachment({ me, room, at: Date.now() });
    const members = this.ctx.getWebSockets().map((s) => s.deserializeAttachment()?.me).filter((id) => id && id !== me);
    server.send(JSON.stringify({ k: "hello", me, members }));
    this.broadcast({ k: "join", id: me }, server);
    return new Response(null, { status: 101, webSocket: client });
  }

  broadcast(obj, except) {
    const s = JSON.stringify(obj);
    for (const ws of this.ctx.getWebSockets()) if (ws !== except) { try { ws.send(s); } catch (e) {} }
  }

  async webSocketMessage(ws, msg) {
    if (typeof msg !== "string" || msg.length > MAX_MSG) return;
    let m; try { m = JSON.parse(msg); } catch (e) { return; }
    const att = ws.deserializeAttachment() || {};
    if (att.room && att.room.startsWith("mm-") && m.k === "queue") {
      att.q = { name: String(m.name || "Player").slice(0, 16), rating: +m.rating || 1000, racket: String(m.racket || "practice").slice(0, 24), t: Date.now() };
      ws.serializeAttachment(att);
      await this.tryMatch(att.room);
      return;
    }
    if (att.room && att.room.startsWith("mm-")) return; // queues don't relay chatter
    const to = m.to;
    const targets = to === "*" || to == null ? this.ctx.getWebSockets() : this.ctx.getWebSockets(String(to));
    for (const s of targets) if (s !== ws) { try { s.send(msg); } catch (e) {} }
  }

  async tryMatch(room) {
    const ranked = room.startsWith("mm-r"), size = Math.max(1, Math.min(3, parseInt(room.replace(/\D/g, "")) || 1));
    const need = size * 2, now = Date.now();
    let waiting = this.ctx.getWebSockets().map((ws) => ({ ws, a: ws.deserializeAttachment() })).filter((x) => x.a && x.a.q);
    waiting.sort((x, y) => x.a.q.t - y.a.q.t);
    while (waiting.length >= 2) {
      let group;
      if (waiting.length >= need) group = waiting.slice(0, need);
      else if (size > 1 && now - waiting[0].a.q.t >= QUEUE_WAIT) group = waiting.slice(0, need);
      else break;
      if (ranked) group.sort((x, y) => y.a.q.rating - x.a.q.rating);
      // snake draft by rating so teams are even; casual just alternates
      const players = group.map((x, i) => ({ id: x.a.me, name: x.a.q.name, racket: x.a.q.racket, rating: x.a.q.rating, team: [0, 1, 1, 0, 0, 1][i] }));
      const game = "g-" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
      const msg = JSON.stringify({ k: "match", room: game, host: players[0].id, size, ranked, players });
      for (const x of group) { try { x.ws.send(msg); x.a.q = null; x.ws.serializeAttachment(x.a); x.ws.close(1000, "matched"); } catch (e) {} }
      waiting = waiting.slice(group.length);
    }
    if (waiting.length) await this.ctx.storage.setAlarm(Date.now() + 2000);
  }

  async alarm() {
    const rooms = new Set(this.ctx.getWebSockets().map((ws) => ws.deserializeAttachment()?.room).filter(Boolean));
    for (const r of rooms) if (r.startsWith("mm-")) await this.tryMatch(r);
  }

  async webSocketClose(ws, code) {
    const att = ws.deserializeAttachment() || {};
    this.broadcast({ k: "leave", id: att.me }, ws);
    try { ws.close(code === 1005 ? 1000 : code, "bye"); } catch (e) {}
  }
  async webSocketError(ws) { try { ws.close(1011, "error"); } catch (e) {} }
}
