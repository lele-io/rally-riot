# Rally Riot — notes for Claude
Chaotic badminton × tennis browser game (1v1 / 2v2 / 3v3). Three.js + Rapier (compat build) + Vite.
Repo `lele-io/rally-riot` → GitHub Pages via `.github/workflows/pages.yml` (base path `/rally-riot/` in `vite.config.js`).
Online relay: `relay/` (Cloudflare Worker + Durable Object, same pattern as `lele-io/cupidium-relay`, but a separate worker).
Do NOT modify `lele-io/cupidium-relay` or `lele-io/one-in-a-cupidium`.

## Commands
- `npm run dev` (port 5173) · `npm run build` · `node tools/tune.mjs` (shot solver sanity check)
- Models: run `blender/build_models.py` inside Blender (MCP `execute_blender_code`):
  `exec(open(r"C:/games/racket-game/blender/build_models.py").read()); build_all()` → writes `public/models/*.glb`.
  Builds each model in a scratch scene and deletes it; never touches the user's own scene.

## Code map (src/)
- `shuttle.js` pure flight model (gravity, quadratic drag, sidespin/topspin Magnus) + `solveShot` (aims a shot at a court
  point; flattest arc that clears the net, softens speed if needed; spin is pre-compensated). Deterministic → shared by bot/net.
- `rackets.js` catalog (18 original rackets, 6 rarities), `PATCH` balance tweaks, `derive(stats)` → gameplay numbers.
- Art style (owner asked: Zelda × Wuthering Waves × Silksong, indie): toon shading (all glTF materials → MeshToonMaterial
  with a 4-band ramp in assets.js), inverted-hull ink outlines (`outlineMaterial`), runtime palette overrides (`recolor`),
  warm grade + vignette pass. UI: chunky slanted Roblox-style buttons (Lilita One) + ink/gold filigree panels.
- Controls: WASD (camera-relative), Space jump, click swing/hold charge, Shift dash, mouse aims, right-drag orbit camera,
  wheel zoom (`match.cam` yaw/pitch/dist).
- `player.js` kinematic capsule + Rapier character controller; swing state idle→charge→swing(0.17s window)→recover; dash
  (air dash ×1.55 farther); arm animation by rotating `ArmR` (racket parented to `HandR`).
- `match.js` Rapier world, serve/rally/point/over flow, rally scoring to 11 (win by 2, cap +4), hit → `computeShot` → `applyHit`.
  Team 0 plays x<0, team 1 x>0; the orbit camera starts behind the local player facing the net.
  `authority` (offline or host) decides points; `net` hooks send hit/point/serve/over.
- `lobby.js` title-screen backdrop (Lobby view): shrine island, your avatar posing on the right, summon cutscene
  (`playSummon`/`endSummon`). `screens.js` DOM panels: loadout, summon (+reveal), play vs bots.
- `env.js` shared golden-hour world: gradient sky shader, painted cloud sprites (+ sea of clouds below), backdrop.glb
  silhouettes/islets, warm sun + cool fill, motes and petals.
- `save.js` localStorage profile (`rallyriot.profile.v1`): yen, spins, lucky, inv, equipped, pity, codes, rating, league, stats.
- `main.js` Game: renderer + bloom + grade pass, views (Lobby | Match), title screen (PLAY, PLAY WITH FRIENDS, How to
  play; bottom SHOP / SUMMON / LOADOUT), `startMatch(cfg)`, end screen.
- `bot.js` predicts flight, picks reachable intercept, jumps/charges for smashes, releases at closest approach, aims away from opponents.
- `fx.js` additive particles, shuttle trail, rings, shake. `sfx.js` synthesized WebAudio. `ui.js` HUD + `h()` DOM helper.
- `net.js` `connect(room, me)` + `Session` (the Match's `net`): 15 Hz player states, ping/pong RTT to host. Relay URL from
  `VITE_RELAY_URL` (`.env.production`), defaults to `http://localhost:8787` in dev.
- `online.js` Play with Friends = private rooms (`p-<CODE>`, the room doubles as the game room). Host sends
  `{k:"start", roster}`; bots fill empty seats and run on the host. Sync model: each client owns its player;
  hits are events (`base` = flight number; clash → lower id wins) and every client re-simulates the deterministic shuttle,
  fast-forwarding by ~RTT; host alone awards points/serves/game over. Host leaving ends the match; a leaving client becomes a bot.
  (Quick match/ranked were removed at the owner's request; the relay still supports `mm-*` queues but nothing uses them.)
- `economy.js` Yen payouts (`payout`, every match pays), Shop (Spin ¥250, ×10 ¥2250, Lucky ¥1200, daily free Spin).
- Meta shifts: edit `PATCH` in rackets.js (version, notes, per-racket stat `adjust`).
- Model material names the code relies on: avatar `Team`; racket `Frame`, `Accent`, `Grip`, `Strings`; lobby `Portal`, `Crystal`.

## Gotchas
- `Element.append(null)` inserts the text "null" — only `h()` filters nulls.
- Editing files while Playwright runs triggers a Vite full reload mid-test; wait for `__game.lobby` again.

## Relay (relay/)
`cd relay && npx wrangler dev --port 8787` for local play; `npx wrangler deploy` (needs `wrangler login`). Worker
`rally-riot-relay`, DO class `Room`. `node tools/relay-test.mjs [url]` checks hello/join/leave, fan-out and matchmaking.

## Testing
Playwright MCP against `npm run dev`. `window.__game.view` is the current Match. Two-client online test: `browser_run_code_unsafe` with `page.context().newPage()`, drive each
local player with `m.localInput = () => brain.think(1/60)`. Bot-vs-bot check: swap the local player
for a `BotBrain` (see git history / CLAUDE notes) and log `applyHit`/`onPoint`. Look at screenshots before calling UI done.

## Progress
- [x] Phase 1 — offline 1v1 vs bot: movement, jump, swing, charge, dash, shuttle physics with spin, scoring, FX.
- [x] Phase 2 — racket stats system + lobby hub: 18 rackets/6 rarities, summon (spin, ×10, lucky, pity 40), loadout
  with stat compare, 1v1/2v2/3v3 vs bots (bots get random rackets by skill tier).
- [x] Phase 3 — online via Cloudflare Durable Object relay (tested locally with wrangler dev: 1v1 quick match in sync,
  2v2 private room with bots). Relay deployed and verified with tools/relay-test.mjs.
- [x] Phase 4 — Yen + shop + spins. (Ranked, leagues, codes and quick match were built, then removed on request.)
- [x] Art pass: floating-ruins court, shrine title screen, hooded avatar (Blender v2 builders), toon + outlines, sky/clouds.

## Next / ideas
- Relay deployed: https://rally-riot-relay.jacob-liulele.workers.dev (set in `.env.production`). Redeploy: `cd relay && npx wrangler deploy`.
- Profiles/ratings are local only; a server-side leaderboard would need a DO keyed by player.
