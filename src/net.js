// WebSocket connection to the Rally Riot relay (relay/index.js). Rooms at /ws/<room>?me=<id>.
export const RELAY_URL = (import.meta.env.VITE_RELAY_URL || "http://localhost:8787").replace(/\/$/, "");

export function connect(room, me) {
  const url = RELAY_URL.replace(/^http/, "ws") + `/ws/${encodeURIComponent(room)}?me=${encodeURIComponent(me)}`;
  const ws = new WebSocket(url);
  const handlers = new Set();
  let closed = false, keep = null;
  const conn = {
    room, me, ws,
    ready: new Promise((res, rej) => { ws.onopen = () => res(conn); ws.onerror = () => rej(new Error("Could not reach the relay")); }),
    on(fn) { handlers.add(fn); return () => handlers.delete(fn); },
    send(obj, to = "*") { if (ws.readyState === 1) ws.send(JSON.stringify({ to, ...obj })); },
    close() { closed = true; clearInterval(keep); try { ws.close(1000); } catch (e) {} },
    get open() { return ws.readyState === 1; },
  };
  // iterate a copy: a handler that registers another one (start → new Session) must not hand it the same message
  ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (_) { return; } for (const h of [...handlers]) h(m); };
  ws.onclose = (e) => { clearInterval(keep); if (!closed) for (const h of [...handlers]) h({ k: "closed", code: e.code }); };
  keep = setInterval(() => { if (ws.readyState === 1) ws.send("ping"); }, 25000); // relay auto-answers "pong"
  return conn;
}

// The `net` object a Match uses during an online game.
export class Session {
  constructor(conn, { me, hostId }) {
    this.conn = conn; this.me = me; this.hostId = hostId; this.isHost = me === hostId;
    this.rtt = 0.08; this.sendT = 0; this.pingT = 0; this.match = null;
    this.left = new Set();      // ids that left the room (they become bots in a rematch)
    this.pendingStart = null;   // a rematch "start" that arrived before our end screen was up
    this.off = conn.on((m) => this.onMessage(m));
  }
  send(msg, to) { this.conn.send(msg, to); }
  onMessage(m) {
    if (m.k === "ping" && this.isHost) { this.conn.send({ k: "pong", t: m.t }, m.from); return; }
    if (m.k === "leave") this.left.add(m.id);
    if (m.k === "start") { if (this.match?.state === "over") this.pendingStart = m; return; }
    if (m.k === "pong") { this.rtt = this.rtt * 0.7 + ((performance.now() - m.t) / 1000) * 0.3; return; }
    this.match?.onNet(m);
  }
  // called from Match.tick
  tick(dt) {
    const m = this.match; if (!m) return;
    this.sendT += dt; this.pingT += dt;
    if (this.sendT >= 1 / 15) {
      this.sendT = 0;
      const list = [];
      for (const p of m.players) if (p === m.local || (this.isHost && p.kind === "bot")) list.push(p.netState());
      if (list.length) this.conn.send({ k: "st", list });
    }
    if (!this.isHost && this.pingT > 2) { this.pingT = 0; this.conn.send({ k: "ping", t: performance.now(), from: this.me }, this.hostId); }
  }
  sendState() { this.sendT = 1; } // flush on the next tick (e.g. right after a swing)
  close() { this.off(); this.conn.close(); }
}
