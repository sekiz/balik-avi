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

Audit pass (Oct 15, 2026): touch (finger → the studio's mouse path via `src/game/touch.js`), viewport meta,
portrait shows a "rotate" prompt and holds still, ≥44 px buttons (`BTN`) with safe side margin, text auto-fit
(`ui.text maxW`), localStorage profile + settings (loaded only on a real boot, never on `reset(seed)`),
draw calls 1330 → ~260 (static props merged, kelp/anemones instanced, bubbles/motes as Points), pooled
effect materials, MSAA on the composer target with a phone tier (`low`), audio voice cap + miss sound +
mute button, boss hit counter, service fixes (session replace refunds, unknown-fish refund, boss clock,
school cap, streak reset, goal auto-claim on rollover, receipt replay guard + `ALLOW_SIMULATED_IAP`).
RTP at 4M shots: 96.2–96.8 % for every strategy (target 96.5).

UI skin (Oct 15, 2026): `src/game/skin.js` draws the button/panel kit (navy outline, coloured face with
curved gloss, darker lip the face sinks into when pressed, brass rivets; dark-glass panels in a brass or
accent-coloured frame) into cached data-URL images for the HUD, and loads Lilita One (assets/fonts, OFL;
both unicode subsets so Turkish İ Ş Ğ render). `UI.button`/`UI.panel` use it, with a plain-panel fallback
until an image has decoded. The HUD is cleared when the screen changes so a new veil never covers shared items.

Store redesign (handed to the UI designer): ribbons (`ui.ribbon`), ray-lit cards (`panel rays`), coin pyramids,
bonus bursts (`ui.burst`), ad strip with per-day pips. Open: on the biggest pack the amount text overlaps the
coin pile; other screens (goal, collection, settings, pause/results, out-of-coins) only got ribbons + the new
button/panel kit, not a full game-style recomposition. Use `ui.placeholder` for any art that decodes late so
draw order is kept.

Slot layer (Oct 15, 2026), all server-side in `src/economy/` and RTP-neutral by construction: golden fish
(6 % of non-boss spawns, ×2/×3/×5), kill combo (+0.1 per kill in an 8 s chain, up to ×2), golden storm
(boss kill → ×2 for 10 s), and a progressive jackpot (1 % of every bullet, paid with the golden shark; a new
profile starts at 100, after a payout it restarts at 0). A payout multiplier M always divides the kill chance
by M, so the expected return per hit never changes; only variance does. Starting balance is now 200 (was
1000), so the out-of-coins → ad / store flow actually happens. The session summary shows the return %. Simulator
(`tools/rtp-sim.mjs`, 6M shots × 3 seeds): 95.5–97.4 % per strategy, centred on the 96.5 % target (spread is
boss variance).

Agent review round (Oct 15, 2026): jackpots are now three tiers — fixed-odds MINI ×20 / MINOR ×100 rolled on
every hit (per-hit odds in `JACKPOT_FIXED`; a golden fish carries 1/180 and 1/1500, any other fish 1/9000 and
1/20000), plus the golden shark's progressive pool as the major. Their expected value per hit is subtracted
from the kill chance, so RTP stays exact for any aim (sim 6M shots × 3 seeds: 95.9–97.9 % per strategy).
Game feel: every hit nudges the camera and knocks the fish back; hit-stop on medium kills, slow-motion + gold
flash + thump on large and boss kills; haptics on touch; combo raises the hit pitch; new players get a guided
first minute (golden medium fish at 5 s, a plain medium at 14 s — spawn order only). Mobile: touch releases on
blur / visibility loss, iOS audio unlock inside the real touchend, orientationchange + visualViewport resize,
validated save loading. Handed to the UI designer (their files): HUD repaints every frame because ui.js
re-declares ~100 items per frame (skip unchanged declarations — measured 10.6 ms/frame of HUD CPU), the HUD
canvas follows the 1.5× drawing buffer, skin.js uses a real-time 120 ms `setTimeout` for `ready` (use frames)
and its cache is unbounded; also a dedicated fire button and MINI / MINOR chips on the HUD.

Known issues / next:
- Profile persists in localStorage only (the backend DB is still the real answer).
- Portrait is a rotate prompt, not a real portrait layout.
- Touch has no dedicated fire button: touch-and-hold aims and fires at the finger.
- Real IAP / AdMob / analytics backends not wired (stubs with the right call points).
- Privacy policy / terms are placeholders pending legal review (the brief requires one).
- Leaderboard not built (brief: "to be clarified with vendor").
- Bosses/large fish are procedural; generated models would raise quality further.
- English menu shows a text title (the logo image reads "BALIK AVI").


Reference-led UI pass (Oct 15, 2026): game artist, product designer and UI designer roles
implemented reef menu backdrop (built-in ImageGen, assets/ui/reef-backdrop-v1.png; prompt
stored alongside), rope-hung wood headings, cyan/silver navy panels, glossy buttons,
5+5+3 collection cards and two-column settings with inline toggles. Live gameplay keeps
the 3D reef. UI/font asset URLs resolve from module locations so nested previews work.
Live review entry: .studio/reef-preview.html?screen=settings|collection|pause. Existing
Studio demos freeze the clock, so this preview explicitly resumes it for asynchronous art.
Syntax checks passed; settings and collection visually inspected in Safari. This was followed by the production-art pass described below.

Production art pass: all 13 collection fish now use built-in ImageGen dimensional art,
extracted into transparent 512x320 PNGs; locked species use their own alpha silhouettes.
assets/ui/fish-atlas-v1.prompt.txt records generation. Pause/results use generated
assets/ui/pause-frame-v2.png with live dark text on ivory parchment, wood/rope/kelp frame
and clownfish accent. Headings use assets/ui/wood-heading-v2.png. Both prompts are saved
alongside. UI uses 18 consistent vector icons; button lip/gloss reduced, panel rims corrected
so they stay visible, coin/bet readouts now support capsule corners. Collection/setting
proportions match 5+5+3 and two-column reference layouts. Syntax checks passed and all 28
production sprite/frame assets passed dimension/alpha checks. Settings, collection and
pause visually reviewed in Safari at desktop landscape size. Phone-specific visual QA
was not performed in this pass. Live preview defaults to Turkish, accepts lang=en.

Settings reference update: preserved existing timber title, moved to y=.17; settings now
uses assets/ui/settings-reef-v3.png (built-in ImageGen; prompt stored alongside) with
underwater ruins and refractive glass surround. Four paired rows have blue icon tiles,
translated helper descriptions, smaller inline toggles/actions and bare chevrons.
UI.text now accepts font/weight/shadow for readable helper copy; icon tiles have round
corners. All layout/text/button controls remain live HUD items. Verified demo-settings
in Safari via 127.0.0.1:5199; localhost resolved incorrectly once, IPv4 address works.
Syntax checks passed for main/ui/skin. Cache version settings-5.

## Audit fixes (Oct 15, 2026, skill-based review)

Four-skill audit (gameplay, graphics, UI, live QA) then the quick P0 pack:
- Settings "next day (test)" row only with `?dev` in the URL — it minted unlimited daily
  bonuses/ad refills for players. Demos still call `advanceDay()` directly.
- Golden-shark jackpot pays `pool × bet/maxBet` (`EconomyService.jackpotShare`), the rest stays
  in the pool; the HUD panel shows the share the current bet would win. A 1-coin bullet could
  claim a pool the 10s built (~400 % RTP on that fish). Sim unchanged: 96.2–98.0 % at 1M shots.
- `reset(seed)` now clears hitStop/slowT/fireCooldown/bossHits/menuSpawn/aim source/prevHeld,
  `swimTime` and `schoolLeaders` (rule 5: demos no longer depend on the previous run).
- Firing needs Mouse1 released once after a screen change or a HUD button press
  (`G.fireArmed`): pressing PLAY/RESUME/+/- no longer spends a bullet. Boss hit counter resets
  when a boss leaves. Auto-fire turns off when the out-of-coins overlay opens.
- Fish lean follows heading (`cos(yaw)` factor): fish swimming −x showed their back.
- Fish materials opt out of fog (`swimify` sets `fog = false`); scene fog stays 14–50. Pushing the
  fog to 22–64 instead turned the sand khaki and lost the deep-water mood (live A/B).
- Ribbon art drawn at its real 3:1 aspect (was 4.4, squashed); store title narrowed to 0.8.

HARNESS: hud-resize — `src/hud.js` `paint()` resizes the overlay canvas but never disposes or
recreates `overlay.texture`, so after any viewport change (phone rotation, iOS address bar,
window resize) WebGL logs `glCopySubTextureCHROMIUM: Offset overflows texture dimensions` every
frame and the HUD stays stale/stretched. Studio-owned file; needs `overlay.texture.dispose()`
(or a new CanvasTexture) when the size changes.

Still open from the audit (not in this pack): HUD re-declares ~25–60 items per frame (dirty every
frame → full repaint + texture upload), phone text scale, landscape-phone top bar overlap, results
"Geri dönüş" row under ANA MENÜ, single-frame clicks lost, sessions ~2 min at bet 2, ~350 draw
calls, low-tier bloom setSize no-op, no kill/muzzle VFX, missing `/vendor/` outside Genex.

## Economy / session pack (Oct 15, 2026)

- Bet cap: a bet is open only while balance ≥ 50 × bet (`BET_MIN_SHOTS`, `maxBetFor` in config;
  `fire()` rejects with `bet-cap`, the client steps down). 200 coins open 1–2, 250 opens 5, 500
  opens 10. Pressing + on a locked bet shows "250 coin ile açılır".
- `FIRE_RATE = 6` lives in config; the simulator's session runs use it. Sessions from 200 coins,
  held trigger, random aim: asks bet 1 → median 5.0 min (p10 2.1); asks bet 10 → 2.7 min (p10 1.3).
  Before the cap a bet-10 player was out in ~13 s.
- `EconomyService.preroll()` fills the sea before play without moving the session clock, boss
  countdown or onboarding timers (play time, first boss and the guided golden fish start at 0).
- Shots the service already refunded (it ages shots in real time, bullets age in hit-stop /
  slow-motion time) disappear quietly (`isLive`) instead of touching a fish with no effect.
- Pool books are exact: a refund after a payout takes its slice back even below 0 (HUD/share clamp
  at 0); `snapshot()` removes in-flight shots' pool slice since their bets are refunded on load.
- Responsible play: results show a coloured Net row (won − spent) and "%120,0" in Turkish; a
  banner every 10 min of a session; the out-of-coins overlay offers no STORE while a boss is up.
- Saved `goal`/`lifetime` are validated field by field; `begin()` also leaves the out overlay.

## HUD performance / mobile layout pack (Oct 15, 2026)

- `UI.put()` (ui.js) sends an item to the HUD only when its arguments changed or the HUD dropped
  it; every HUD `set()` repaints the whole HUD and re-uploads its texture. Measured `hudWrites`
  (new probe in `state()`): 0 per frame on still menu/play/settings/collection/results (was every
  item, every frame); ~0.8 per frame while firing; store 8 of 60 frames (coin bob stepped to 8 fps).
  Bars move in 1/500 steps.
- Text scales with the frame on buffers under 720 px (the HUD never scales text below 1:1, so on a
  phone it was ~23 % larger than its panels), floored at 11 CSS px but never past its `maxW` box.
  main.js feeds `ui.bufH` / `ui.dpr` each frame. Landscape phone 844×390: no HUD overlaps.
- Below 1.7:1 (16:10, 4:3) the bet selector tightens 15 % and auto/sound narrow: no overlaps at
  1024×768, 1280×800, 1280×720.
- Touch buttons get a ≥0.115-frame invisible hit box (toggles/arrows were ~20 px).
- Clicks shorter than 40 ms are held to 40 ms (`installMinPress` in touch.js, replayed on the same
  window): a 0 ms click on OYNA now starts play. Still the studio's one input path.
- skin.js: art readiness counted in UI frames (no `setTimeout`), sizes snap to 8 px, LRU cache
  capped at 160 variants.
- Boot bar is real: logo, coin, the four big screen PNGs and all 26 fish portraits are fetched
  during the splash; the menu opens when they are in (≥1.2 s) or after 10 s. Collection no longer
  opens on blank cards. 4 Mbit simulated link: menu at ~30 s with nothing pending.
- Collection rare row shows its catch count in place of "KEŞFEDİLDİ" (it was drawn off the card).

Still open: store "14.000" over its coin pile and the ad button over the progress dots (designer's
layout), account button label tiny on phones, `assets/ui` is 14 MB of PNG (WebP would cut most),
HARNESS hud-resize above.

## WebP UI art (Oct 15, 2026)

- The game loads `.webp` for all 32 UI images it uses (6 screen/UI art + 26 fish portraits):
  12.2 MB of PNG → 1.96 MB (backdrops 2.7 MB → 0.29 MB each). PNGs stay as the editable sources;
  re-encode with `tools/build-webp.sh` after changing one. Side-by-side crops showed no visible loss.
- Boot on a simulated 4 Mbit link: menu at 10.7 s (was 30.3 s). No PNG is requested any more.
- Unused `fish-starfish`, `fish-coin-sprite` (+ locked) and `fish-atlas-v1` PNGs were moved to
  `~/.Trash/balik-avi-unused-png/` (never tracked in git); the atlas prompt stays in assets/ui.

## Visual pack (Oct 15, 2026)

- Draw calls in the same late-wave auto-fire scene: 316 → 139–158 (fish 113 → 59 for 15 fish,
  effects 49 → 7, cannon 22 → 11, aim 10 → 1). Desktop p50 16.7 ms, worst 20.7 ms while firing.
  - `fishmodels.js` `mergeStatic`: parts that share a material and bend with the body (fins, eye
    pair, puffer spines) merge into one mesh per material, geometry cached per species. A bony fish
    is 3 draws (was 8). Wing (manta) and paddle (turtle) parts stay separate (local-space motion).
  - `effects.js` rewritten around InstancedMesh layers: coins (cap 256), sparks, kill shards,
    bullet cores and halos. Camera-facing quads use `fx.setView(camera.quaternion)`. Popups are a
    pool of 12 canvases in the UI font (no texture per popup).
  - Aim guide is one `Points`; cannon gems one InstancedMesh.
- New VFX: kill burst (shockwave ring + tier-coloured shards + glints; second gold ring for large
  and boss), muzzle flash on every shot in the bet colour.
- Golden fish: body glows gold through the hit-flash uniform (kept below white) plus a swirl of
  gold glints (one Points each); the halo is warmer and dimmer.
- Manta rebuilt: crescent wings swept back to pointed tips, concave trailing edge, body thick on
  the centre line and thinning to the wingtips (ring-woven lens mesh), tips lifted, deep-blue
  speckled skin, bigger eyes. Puffer got 54 spines (merged with its fins: no extra draw).
- Phone tier bloom now really runs at quarter resolution (UnrealBloomPass.setSize used to undo
  the constructor size): 317×147 on an 844×390 phone instead of 633×292.
- Coin fallback texture shows a star, not ₺ (coins never cash out). Dead `uSwimRate` removed.

Visual pack 2 (same day):
- Fish blob shadows are one InstancedMesh (`fishes.js`: each fish/dragon segment keeps a plain
  transform handle, `writeShadows()` once per update). Late-wave auto-fire: 132–144 draw calls,
  under the 150 mobile budget; boss scene 122.
- Turtle rebuilt toward its portrait: carapace scutes painted as Voronoi cells in the shell's own
  top-down UV space (5 vertebral, 4+4 costal, 24 marginal; orange hearts, dark seams, growth
  streaks), a low keel and rim flare; long swept-back front flippers and small rear ones (flat
  bevelled blades, top-down UVs), bigger head with a neck and big eyes, green scaled skin, cream
  plastron.
- Gameplay grade moved from deep navy toward the menu art's turquoise shallows: less red
  absorbed, 1.1× exposure, an 11 % turquoise veil (was 16 % navy), and a vignette that starts at
  0.5 and only reaches 60 % (was 0.38 / 92 %) so fish entering at the edges stay readable. A first
  try with less red absorption turned the sand sage-green; the cyan veil fixed it.

Still weak: kill shards are small next to the bloom; the "BOSS GELİYOR" banner is lower contrast
on the brighter water; lightshafts (8 draws) and seabed (23) are the biggest remaining groups.

## Boss warning (Oct 15, 2026)

- `features().bossIn` (service) = seconds until the next boss, null while one swims. The last 5 s
  count down in a red pill under the jackpot ("BOSS GELİYOR · 3"), each second a low thump, a
  faint red HUD flash and a short buzz on touch. While a boss swims its name and pay range show
  there ("Altın Köpekbalığı ×100–200"). Demo: `bossWarn`.
- Banners moved from y 0.40 to 0.33 so the middle of the field stays clear for aiming.
- A parallel session edited `post.js` (grade toward the menu art), `fishmodels.js` (turtle
  carapace) and `fishes.js` (instanced shadows) at the same time; this pass did not touch them.

## Store / account touches (Oct 15, 2026)

- Store: each coin pile now stands on its amount (it hung from the card top, so the 4-row pile ran
  into "14.000"); the tallest pile uses slightly smaller coins. Ad strip: button 0.38 wide on the
  right, pips centred in the gap (the button covered them), strip at y 0.865, footer at 0.967 size 13
  (out of the home-indicator zone). Below 1.65:1 the cards, their spacing and the title shrink with
  the width (`fit`), so 4:3 keeps the outer card, its bonus badge and the balance badge clear.
- Settings: the account button says just "Misafir"/"Guest" at the normal size (the long label had
  shrunk to 12); "linking coming soon" moved to the row's description. Language and account buttons
  are 0.15 wide, the text column ends at the button (no overlap on 4:3), the "⌄" caret is gone
  (the row toggles, it is not a dropdown).
- Checked: no HUD overlaps on store/settings at 1280×720, 1280×800, 1024×768 and 844×390 except the
  intended ones (coins inside a pile, ribbons and badges on their card).

## English pass (Oct 15, 2026)

- Toured menu, play, store, settings, collection, pause, results, out, ad, daily, bossWarn, boss,
  jackpot, fever, gold, purchase in EN (and again in TR) at 1280×720, 1024×768 and 844×390: no HUD
  overlaps left except intended ones (dialog ribbon on its panel, coins in a pile, store title rope
  touching the "most popular" tag rope on 4:3). The language comes from the save
  (`balikavi.save.v1` → settings.lang); there is no URL switch.
- Fixed: settings descriptions shortened in both languages so they fit beside toggles/buttons on
  4:3; collection title shrinks below 1.65:1; combo/storm meters hidden behind the pause/summary
  frame; the desktop controls hint sits on a dark strip (it did not read on the bright sand).
- Known: the EN menu shows a text title (the logo art is Turkish); store prices are the fixed TRY
  strings ("₺19,99") in both languages — a real build takes localized prices from the store SDK.

## MINI / MINOR indicator (Oct 15, 2026)

- Two pills flank the jackpot panel: MİNİ (blue rim) and MİNOR (orange rim) with what each pays at
  the current bet (`JACKPOT_FIXED.M` × bet: 20/100 at bet 1, 100/500 at bet 5). The one that just
  landed blinks for 1.6 s (`G.jpFlash`, decayed in update, cleared on reset). Demo: `miniJackpot`.
  No overlaps in TR/EN at 1280×720, 1024×768, 844×390 on play, kill, bossWarn, pause, fever.
- Odds are not shown (they differ per fish: 1/180 on a golden fish, 1/9000 otherwise).

## English logo (Oct 15, 2026)

- `assets/ui/logo-en.webp` (63 KB; PNG source next to it): "FISH / HUNT" in Lilita One styled after
  the Turkish logo (yellow gradient face, orange depth edge, gloss, thick blue water backing,
  bubbles) with the blue-tang and clownfish collection portraits as mascots, same 900×541 frame.
  No image-generation key was available (GEMINI_API_KEY missing), so it is composed in a canvas:
  source `assets/src/logo-en.html` (re-render notes inside). Boot and menu use `logoImg()` per
  language; the preload fetches both logos.
- A first draft that lifted the fish from the Turkish logo was dropped: they came with their opaque
  blue backing as rectangles over the letters.

## Progression phase 1: tide cycle (Oct 15, 2026)

- Design: `docs/PROGRESSION.md` (approved). `WAVES` is gone; `TIDE` drives a calm → rush → boss →
  reward cycle per round (`advanceTide`), harder each round up to `maxStep`. `ramp()` now means the
  round step (0…1), `tideSpeed()` the swim speed. `features().tide` = { phase, round, reward, left }.
- Reward window: golden storm after a boss kill, fish tide (30 % golden, big schools) after a boss
  that got away. Treasure bubble (`SPECIAL`/`TREASURE` in config, model `src/game/treasure.js`):
  pays ×10–20 like any target, never in the collection; the chest counter-rotates against heading
  so its open lid stays at the back.
- Simulator now looks species up through `speciesById` (special targets included).
- Measured: see PROGRESSION.md §12 (phases in order in a 4-minute stepped run; RTP 95.9–97.8 %;
  median session at bet 1 4.3 min).
- `__studio.step(ms)` takes milliseconds, not frames.

## Progression phase 2: XP, levels, missions, free-coin budget (Oct 15, 2026)

- Config: `XP_PER_TIER`, `xpForLevel`, `CANNON_SKINS`, `levelCoins` (25, 250 every 5th level),
  `FREE_COINS_PER_DAY` 2500, `MISSIONS` (+ `MISSION_REWARD`). Profile: `xp`, `level`, `skins`, `skin`,
  `freeToday`, `missions`; the old single `goal` is gone (old saves drop it).
- Service: `grantFree` is the only way free coins reach the balance (daily, ad, mission, level);
  `adsLeft` also respects the budget. `addXp` returns level-ups; `hit` returns `levelUps`.
  Missions are picked from the day number, progressed on kills and boss hits, auto-paid on rollover.
- Cannon finishes: `SKIN_PALETTES` in cannon.js re-bake the brass/steel metal maps (`setSkin`).
  Silver had to stay below white (it bloomed into a blob).
- Level coins were 75–300 at first: a new player's first session went from ~4 to ~15.6 min in the
  simulator. Cut to 25 (250 every fifth level): median 5.6 min at bet 1.
- `installMinPress` now also holds keys (F/M/digits) tapped inside one frame.
- Testing note: reloading the page fires `pagehide` → `saveProfile()`, which overwrites a save
  written by the test; seed saves with an init script instead.
- Demos: `missions`, `levelUp`. Probes: `level`, `missions`, `freeToday`, `skin`.

## Progression phase 3: rooms, the Shipwreck (Oct 15, 2026)

- `ROOMS` + `roomById` (config); species carry `room` (their collection page). The service holds
  `this.room` (set by `startSession(roomId)`, closed rooms fall back to the reef): `bets()`,
  `roomOpen(id)`, room-scoped `pickSpecies`, boss order, bet cap (`maxBetFor(balance, bets)`), and
  the jackpot share against the room's top bet. `TIDE.bossOrder` is gone (rooms own their bosses).
- Wreck entry 2,500 coins (1,000 gave ~1.9 min sessions at bet 10 in the simulator).
- New models in fishmodels.js: `taperedTube` helper, `buildSeahorse`, `buildOctopus` (kraken =
  boss variant), anglerfish/barracuda as BONY entries (lure, teeth). World set `src/game/wreck.js`
  (`sandY` mirrors world.js's sand field — the sand rises ~1.3 at the edges and buried the first
  hull; the open hull needs `DoubleSide`; listing must rotate about the hull's own axis, Euler YXZ).
  `world.setRoom(id)` swaps the set, coral visibility, fog, lights, sand tint.
- Portraits for new species: rendered from the procedural models (a portrait page that frames the
  model's bounding box on a transparent 512×320 canvas; silhouette = `source-in` fill #0a1620).
  Room cards `room-reef/room-wreck.webp` are HUD-less game captures (hud.enable(false), popups hidden).
- Simulator: `--room wreck`. Demos: `map`, `wreck`, `wreckOut`, `kraken`. Probes: `room`, `rooms`.
- The map's locked-card veil uses `radius: 0` (a plain fill; radius > 0 draws framed panel art).
- The hull read poorly behind the left-edge rocks and kelp: those in front of it (x < -13, z -7…6)
  are built into their own groups (`rocksHull`, `kelpHull`) that `setRoom("wreck")` hides; the hull got
  three thwarts and two sprung planks so it reads as a boat's inside from above.

## Progression phase 4: Deep Sea, boss tour, sea mine (Oct 15, 2026)

- Room `deep` (bets 50/100/200, level 15 + 12,500), species jelly/eel/squid/giantsquid (builders in
  fishmodels.js), set `src/game/deep.js`; `setRoom("deep")` also sets fog far, a shared caustic level
  uniform (`causticLevel`, world.js), rock/moss tint, mote colour, hides kelp.
- Boss tour: `TIDE.bossTourRound` (2): the boss phase spawns all of the room's bosses; the service
  counts bosses (`bossCount`, `s.bosses`) instead of a flag. Client banner/tag handle two.
- Sea mine (`SPECIAL` "mine", `MINE` config, `src/game/mine.js`): pays its own ×20–40 (RTP exact);
  client `blowMine` reports nearby non-boss fish, service `blast()` drops them unpaid (once per mine
  kill). `mine.js` imports `swimTime` from fishmodels.js (cycle is safe: read at runtime only).
- Simulator: bosses leave after 60 s (`bossesLeave`); before, never-shot bosses stayed forever and
  skewed strategies that fall back to the oldest fish. Strategies that never kill the golden shark
  sit 1 pt lower without the pool (by design).
- The eel's dorsal fin was removed: a flat fin on a sideways-bending body reads as a loose band.
- Demos: `deep`, `giantsquid` (boss tour), `mine`.

## Lightning and frost fish (Oct 15, 2026)

- `LIGHTNING`, `FROST`, `EVENTS` in config; `SPECIAL` gets "volt" and "frost" (bony models with a
  glow, frost with ice crystals). The service's `planEvents` replaces the treasure/mine planners:
  one table of special targets per phase, room and chance. `blast()` serves mines and lightning.
- Client: `chainLightning` (most numerous non-boss species on screen, nearest 8, `fx.bolt` arcs),
  `freezeSea` → `school.freeze(s)` (frozen fish hold still under an icy tint and cannot leave).
- Demos `lightning`, `frost`.

## Special targets guide (Oct 15, 2026)

- Portraits for treasure, mine, volt, frost (rendered from the models, no silhouettes: the guide is
  always open). The collection's page cycle is the rooms then "special" → `drawSpecialGuide`:
  name, portrait, payout, what it does (`guide_<id>`, up to 3 lines), rooms and phase from `EVENTS`.
- Demo: `guide`. Checked TR/EN at 1280×720, 1024×768, 844×390: no overlaps, page button cycles.
- Frost fish recoloured glacier blue (white read as a blank silhouette and bloomed); treasure chest
  scaled 1.15 → 1.4 inside its bubble; the treasure portrait shrinks the bubble and hides the glow.

## Texture budget pass (Oct 15, 2026)

- GPU textures after visiting all three rooms: 152 → 80–91 (`state().textures`).
  - `src/game/kit.js` `kitMaterial`: `standardMaterial` whose roughness/bump maps are shared per
    kind+repeat (they carry no colour). All game modules use it; cannon skins swap only `map`.
  - Fish atlases in fishmodels.js: skins 2048×1024 (28/49 used), fins 1024² (19/49), eyes 512²
    (19/49); clones of one atlas texture with offset/repeat share one GPU texture (three keys WebGL
    textures by source + sampling params). 4 px / 2 px edge-stretched gutters; a full atlas falls
    back to an own texture. The dragon body keeps an own skin (it repeats along its length).
  - `prewarmModels` builds every model at boot so the atlases upload once (no hitch per new species).
- Still above the skill's 60 starting budget: 26 coloured 512² baked maps (each palette is its own),
  ~11 bloom mip targets, HUD/popups. Estimated texture memory ~75 MB, inside the 128 MB mobile budget.

## Fixed by looking
- Ribbon aspect fix made the store title collide with the "EN POPÜLER" tag; narrowed it.
- `__studio.begin()`/`demo()` leave the clock paused; call `__studio.start()` before capturing.
- The browser kept serving cached ES modules after edits (even with CDP cache disabled): verify
  visual changes in a fresh browser context, or change values live via `__studio.inspect().scene`.
