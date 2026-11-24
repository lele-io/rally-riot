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
- `player.js` kinematic capsule + Rapier character controller; swing state idle→charge→swing(0.17s window)→recover; dash
  (air dash ×1.55 farther); arm animation by rotating `ArmR` (racket parented to `HandR`).
- `match.js` Rapier world, serve/rally/point/over flow, rally scoring to 11 (win by 2, cap +4), hit → `computeShot` → `applyHit`.
  Team 0 plays x<0, team 1 x>0; camera sits behind the local player's half (controls mirrored for team 1).
  `authority` (offline or host) decides points; `net` hooks send hit/point/serve/over.
- `lobby.js` walkable hub (Lobby view): hotspots (altar=summon, rack=loadout, kiosk=shop, gate=play), summon cutscene
  (`playSummon`/`endSummon`), menu close-up camera. `screens.js` DOM panels: loadout, summon (+reveal), play tabs.
- `save.js` localStorage profile (`rallyriot.profile.v1`): yen, spins, lucky, inv, equipped, pity, codes, rating, league, stats.
- `main.js` Game: renderer + bloom composer, views (Lobby | Match), `startMatch(cfg)`, end screen. Phase hooks:
  `extraPlayTabs()`, `extraMenus[id]()`, `onMatchEnd(result,cfg)`.
- `bot.js` predicts flight, picks reachable intercept, jumps/charges for smashes, releases at closest approach, aims away from opponents.
- `fx.js` additive particles, shuttle trail, rings, shake. `sfx.js` synthesized WebAudio. `ui.js` HUD + `h()` DOM helper.
- `net.js` `connect(room, me)` + `Session` (the Match's `net`): 15 Hz player states, ping/pong RTT to host. Relay URL from
  `VITE_RELAY_URL` (`.env.production`), defaults to `http://localhost:8787` in dev.
- `online.js` Quick Match (queue room `mm-<n>` / ranked `mm-r<n>`) and Private Rooms (`p-<CODE>`, the room doubles as the game
  room). Host sends `{k:"start", roster}`; bots fill empty seats and run on the host. Sync model: each client owns its player;
  hits are events (`base` = flight number; clash → lower id wins) and every client re-simulates the deterministic shuttle,
  fast-forwarding by ~RTT; host alone awards points/serves/game over. Host leaving ends the match; a leaving client becomes a bot.
- `economy.js` Yen payouts (`payout`, every match pays), shop (Spin ¥250, ×10 ¥2250, Lucky ¥1200, daily free Spin), codes
  (FNV-1a hashes in `CODES`), ranked Elo (K 32 online / 16 vs bot) + tiers `RANKS`, Leagues: weekly seasons from
  2026-11-23, 8-player group = you + 7 simulated rivals seeded by profile id/season (no server), top 2 promote / bottom 2
  drop across `DIVS`, rewards on rollover (`leagueRollover()` runs on entering the lobby). `matchRewards` = end-screen chips.
- Meta shifts: edit `PATCH` in rackets.js (version, notes, per-racket stat `adjust`); the Meta tab ranks rackets by total.
- Model material names the code relies on: avatar `Team`; racket `Frame`, `Accent`, `Grip`, `Strings`; court `Lamp`.

## Gotchas
- `Element.append(null)` inserts the text "null" — only `h()` filters nulls.
- Editing files while Playwright runs triggers a Vite full reload mid-test; wait for `__game.lobby` again.

## Redeem codes (plaintext; the bundle only has hashes)
RALLYRIOT (3 Spins) · LAUNCHDAY (1 Lucky + ¥500) · SPINCITY (5 Spins) · FEATHERFALL (2 Lucky) · NETGAIN (¥1,500).
Add one: put `[hashStr("CODE")]: [{spins, lucky, yen}, "label"]` in `CODES`.

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
- [x] Phase 4 — Yen, shop, spins/lucky spins, codes, ranked (online queue + vs-bot fallback), leagues, balance patch 1.1.

## Next / ideas
- Relay deployed: https://rally-riot-relay.jacob-liulele.workers.dev (set in `.env.production`). Redeploy: `cd relay && npx wrangler deploy`.
- Profiles/ratings are local only; a server-side leaderboard would need a DO keyed by player.
