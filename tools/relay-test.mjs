// node tools/relay-test.mjs [base]  — checks hello/join, matchmaking and fan-out against a relay
const base = (process.argv[2] || "http://localhost:8787").replace(/^http/, "ws");
const open = (room, me) => new Promise((res) => {
  const ws = new WebSocket(`${base}/ws/${room}?me=${me}`); ws.msgs = [];
  ws.onmessage = (e) => { ws.msgs.push(JSON.parse(e.data)); ws.onmsg && ws.onmsg(JSON.parse(e.data)); };
  ws.onopen = () => res(ws);
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const a = await open("mm-1", "alice"), b = await open("mm-1", "bob");
a.send(JSON.stringify({ k: "queue", name: "Alice" })); b.send(JSON.stringify({ k: "queue", name: "Bob" }));
await wait(500);
const ma = a.msgs.find((m) => m.k === "match"), mb = b.msgs.find((m) => m.k === "match");
console.log("match:", !!ma && ma.room === mb?.room, ma?.room, "host", ma?.host, ma?.players.map((p) => p.name + "/t" + p.team).join(" "));
const g1 = await open(ma.room, "alice"), g2 = await open(ma.room, "bob");
await wait(200);
console.log("hello g2:", JSON.stringify(g2.msgs[0]), "| join seen by g1:", JSON.stringify(g1.msgs.find((m) => m.k === "join")));
g1.send(JSON.stringify({ to: "*", k: "st", x: 1 })); g2.send(JSON.stringify({ to: "alice", k: "hit", y: 2 }));
await wait(300);
console.log("g2 got st:", !!g2.msgs.find((m) => m.k === "st"), "| g1 got hit:", !!g1.msgs.find((m) => m.k === "hit"), "| g1 got own st:", !!g1.msgs.find((m) => m.k === "st"));
// team queue fills after the wait
const c = await open("mm-2", "carol"), d = await open("mm-2", "dave");
c.send(JSON.stringify({ k: "queue", name: "Carol" })); d.send(JSON.stringify({ k: "queue", name: "Dave" }));
const t0 = Date.now(); while (!c.msgs.find((m) => m.k === "match") && Date.now() - t0 < 20000) await wait(250);
const mc = c.msgs.find((m) => m.k === "match");
console.log("2v2 partial match after", ((Date.now() - t0) / 1000).toFixed(1) + "s:", mc?.players.map((p) => p.name + "/t" + p.team).join(" "));
g2.close(); await wait(200);
console.log("leave seen:", JSON.stringify(g1.msgs.find((m) => m.k === "leave")));
process.exit(0);
