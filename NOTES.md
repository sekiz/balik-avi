# Balık Avı

_The studio's living memory of this game. Whoever builds here keeps it current — the pitch, the
key decisions and why, and the current state (features, known issues). A newcomer should
understand the game from this file alone. It is injected into every conversation about this
game, so decisions written here survive any chat window._

## Pitch

From the user's vendor brief (Oct 15, 2026): a mobile (iOS + Android), single-player, hybrid-casual
**"balık avlama" (fish shooting / fish table)** arcade game in the style of 鱼乐达人 / 途游休闲捕鱼.
The player shoots fish with a cannon and earns in-game coins. **Coins can only be bought with real
money; they can never be converted back to money or withdrawn** (Turkish gambling law + store
policies). Target RTP 95–98 %, economy computed server-side, never in the client. Short 3–7 minute
sessions, casual 25–45 audience. V1 is TR + EN, no multiplayer.

This workspace is a **playable browser prototype (three.js)** of that brief, covering the brief's
Phase 2 prototype plus most V1 screens, so the feel and economy can be judged before a mobile build.

## Decisions

- **Economy is a separate, server-shaped module** — `src/economy/` has no three.js, no DOM, no clock.
  `EconomyService` owns balance, spawn director (what species enter), shots, kill rolls, payouts,
  daily bonus, goals, ad rewards and purchases. The client only calls `fire(bet)` → shotId and
  `hit(shotId, fishId)` and draws the answer. Moving to Node.js = put these methods behind HTTP/WS
  (V2 Colyseus room would host one service per room).
- **RTP model**: payout = multiplier × bet; on each hit kill chance p = RTP / mean(multiplier).
  Expected return per bullet = RTP exactly, for every species, every bet, every aiming strategy.
  Bullets bounce off the edges until they touch a fish; a bullet that never touches one is
  refunded (8 s lifetime). Target `RTP_TARGET = 0.965` in `src/economy/config.js`.
- **Brief's table interpretation**: the brief lists a different bullet cost per fish type; we made
  bullet cost the player's choice (1/2/5/10 = "mermi gücü") and rewards scale with it. Multipliers
  follow the brief's reward ranges: small ×2–3, medium ×5–8, large ×15–25, boss ×100–500.
- **No withdraw / transfer API exists anywhere**, by design (commented in `service.js`). IAP only
  credits a verified receipt; the prototype accepts `simulated:` receipts and the store says so.
- **RTP simulator**: `node tools/rtp-sim.mjs [--shots N] [--rtp 0.97] [--seed S] [--sessions N] [--verbose 1]`
  runs the real service + config. 4M shots/strategy: random 96.0 %, small-only 97.4 %, big-game
  97.3 %, boss-hunter 96.5 % (spread comes from boss variance; converges with more shots).
- 13 species (4 small, 4 medium, 3 large, 2 bosses: Altın Köpekbalığı, Deniz Ejderhası), all
  procedural: lathe bodies with painted side-projected skins, membrane fins, textured eyes and a
  swim vertex shader (tail bend / wing flap / flipper paddle). Dragon = head + 13 trailing segments.
- Behaviours per brief: small = fast straight (often in schools), medium = zig-zag, large = slow
  curve, boss = slow S-curve with entrance banner, roar and screen shake. Waves ramp over 4 min.
- Top-down-oblique camera over a sandy reef (caustics shader, rocks, corals, swaying kelp, light
  shafts, bubbles). Cannon at bottom centre; barrels multiply and glow colour changes with the bet.
- Audio from Genex (music loop + shot, coin, boss roar, jackpot, click) in `assets/genex/…`;
  procedural WebAudio net-hit pop. M toggles sound.
- **Visual pass 2 (user: "görselleri beğenmedim")**: post stack in `src/game/post.js` — bloom (only
  emissive: bullets, gems, coins), underwater grade (refraction wobble, red absorbed, water veil,
  deep-blue vignette). Reef rebuilt in `world.js`: framing rock clusters (triplanar stone + moss
  caps), brain corals, tube sponges, lattice sea fans, glowing-tip anemones, starfish/shells/pebbles,
  bubble vents, plankton motes, and Voronoi-texture caustics drifting over the sand. Fish get a cyan
  rim light, soft blob shadows on the sand, a 0.55 rad lean so their flank faces the overhead
  camera, and ~1.3× size. The dragon is now one continuous tapered tube re-laid each frame through
  its trail (head + spines + tail fin), swaying in an S. Cannon: gold pedestal, bet-coloured gem
  ring and barrel bands. HUD: Genex logo (`assets/ui/logo.png`) and gold coin
  (`assets/ui/coin.png`, also the flying coin sprite), cleaned from the Genex originals by
  `assets/src/clean_ui.py`; glossy buttons.
- Genex 3D model lane failed upstream (provider out of credit, refunded) — dragon/shark/turtle stay
  procedural. Local Blender is not installed. Revisit generated models when the lane is back.
- Daily calendar is a server-side `day` counter (never the device clock); Settings has a
  "next day (test)" button to exercise bonus/goal/ad rollovers.

## Current state

Playable end to end: splash → main menu (balance, daily bonus claim, Play, Store, Daily Goal,
Collection, Settings) → play (coin counter, bet −/+ and 1–4/wheel, auto-fire F/button, pause Esc,
goal mini-progress) → pause/summary → results. Out of coins → simulated rewarded ad (+200, 5/day),
store, or finish. Store: 3 IAP packs (₺19,99 / ₺49,99 / ₺99,99, simulated purchase) + rewarded ad,
one-way-currency notice. Collection book with discovered badges. Settings: music, sfx,
notifications, TR/EN, account placeholder, privacy/terms placeholders.

Controls: aim with mouse (or arrows/A-D), fire click/hold or Space.

Studio: `config.begin` → straight into play; demos `menu, play, kill, boss, goldshark, store,
collection, settings, out, results, genex-cover` (cover = dragon S-curve + volley from the cannon
+ side catch, staging `a` in `src/cover-shot.js`, camera framed from the dragon's position). Probes report balance, bet, fish by tier, session stats, observed RTP.

Known issues / next:
- Profile is not persisted (fresh 1000 coins each load) — would be the backend DB.
- Real IAP / AdMob / analytics backends not wired (stubs with the right call points).
- Privacy policy / terms are placeholders pending legal review (the brief requires one).
- Leaderboard not built (brief: "to be clarified with vendor").
- Bosses/large fish are procedural; generated models would raise quality further.
- English menu shows a text title (the logo image reads "BALIK AVI").
