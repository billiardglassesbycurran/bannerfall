# Bannerfall — project rules for Claude

Bannerfall is a medieval RTS built with **Three.js**. The player commands from an **aerial view**, and can drop into
**1st/3rd-person** as the **hero commander** or **possess any unit**.

## The owner is non-technical
- Explain what you're doing in plain language. Avoid jargon, or explain it in one short phrase.
- Whenever the owner must click, approve, install or sign in to something, give exact step-by-step instructions
  (which website, which button, what it looks like). Never assume they know where a setting lives.
- After each change, tell them how to see it: the live URL and that they may need to wait ~1–2 minutes for
  GitHub Pages to update, then reload (or bump `?v=` on the URL to skip the phone's cache).

- **Accounts & APIs:** free services (GitHub etc.) — just use them, no need to ask. Anything that **costs money or
  credits** (e.g. Tripo API generations) — ask the owner first, saying what it's for and roughly what it costs.
  If the owner must sign in, create a key or approve something themselves, walk them through it click by click.

## Platforms (both are first-class)
- The owner tests on a **Samsung Galaxy S25 Ultra** (high-end); still keep Medium quality smooth on mid-range phones.
- **Android Chrome first**, then desktop browsers (Chrome/Edge/Firefox/Safari). iPhone Safari should not break.
- Every feature must work with **touch** *and* **keyboard/mouse**. No hover-only or right-click-only features;
  give touch an equivalent (tap, long-press, on-screen button).
- On-screen buttons: at least 44×44 px, respect `env(safe-area-inset-*)`, readable in landscape on a phone.
- Performance budget: smooth (target 60 fps, never below 30) on a mid-range Android phone. Prefer
  `MeshLambertMaterial`, instancing for repeated objects, low poly counts, cap pixel ratio on touch devices
  (see `isTouch` in `src/main.js`). Don't add post-processing without a quality setting that turns it off.

## Tech setup (keep it simple)
- **No build step.** Plain ES modules in `src/`, Three.js loaded from the jsDelivr CDN via the import map in
  `index.html`, pinned to an exact version (currently `three@0.170.0`). Upgrade deliberately, never `@latest`.
- No npm/node required to run or deploy. If a build tool ever becomes necessary, discuss it with the owner first.
- Hosting: **GitHub Pages**, deployed automatically by `.github/workflows/pages.yml` on every push to `main`.
  Live URL: https://billiardglassesbycurran.github.io/bannerfall/
- `prototype/Bannerfall-prototype.html` is the original single-file raw-WebGL prototype. It is the reference for
  look, feel, controls, unit designs, map shapes and future features (economy, buildings, ages, AI, combat).
  Port ideas from it into the Three.js code; don't edit it. It's also playable at `/prototype/Bannerfall-prototype.html`.

## Git — use it for every change
- Commit every meaningful change with a clear message describing what changed for the player.
- Work in small steps; each commit should leave the game playable.
- Push to `main` on GitHub so the owner can test on their phone (pushing = publishing to the live site).
- Never force-push or rewrite history on `main`. Never commit secrets or tokens.
- **Bump `window.BF_VERSION` in `index.html` on every change you push** — it's shown top-right in the game so the owner
  can confirm their phone has the newest build, and it cache-busts every game file (`file.js?v=VERSION`) so phones never
  mix old and new files. New `src/*.js` modules must be added to the `mods` list in `index.html`.
  can confirm their phone has the newest build.

## Code map
- `index.html` — page shell, all HUD/menu markup, version + import map (cache-busting), on-screen error box.
- `src/main.js` — renderer, lighting, quality levels, post-processing composer (Medium/High; none on Low), title menu, game-mode setup, 1st/3rd-person switching, input routing, main loop.
- `src/data.js` — unit/building stats, civilizations (`CIVS`: per-class stat mods, unique unit, look), difficulty, modes.
  Civ bonuses are applied in `Game.stat(team, type)`; always read unit stats through it, never straight from `UD`.
  Civilizations are historically inspired, but bonuses/unique units are original — don't copy another game's.
- `src/world.js` — maps (`MAP_LIST`/`MAP`: Riverlands, Highland Pass, Forest Valley, Inland Sea, Random with seed; chosen via
  localStorage `bf.map`/`bf.mapSeed` or `#play=...&map=highland`, built at page load so switching maps reloads), heightmap, walkability grid, roads, terrain splat shader, resources (trees/berries/gold), grass/rocks,
  water, sky, minimap colours. Tree/grass detail scales with the quality level — keep Medium near ~1M triangles.
  **Map size (v0.36): `SIZE` 256** (was 128). Layouts are written on a 128 "design" grid and stretched by `K` (`sc()`);
  things that belong to a town use `home(x, z)` (same offset from the town as before) so starting resources stay close.
  Gold/stone/berries/deer are also scattered everywhere (mirrored `spots` block). Inland Sea (`MAP.sea`, `seaIn()`): sea
  along the frontier, a bay toward each town, 3 islands with gold/stone, land only round the far corners; Battle mode uses
  `FIELD` (a corner on the sea map). Big instanced sets (trees, rocks, ferns, grass, logs) are split into 64 m tiles
  (`splitTiles`/`retile`) so the camera culls what's off screen — keep that for anything instanced map-wide.
  fow.js `S` must equal `SIZE` (not imported on purpose); save key `bf.save2`; long paths use a 40000-node A* budget.
- `src/models.js` — unit figures (GPU-instanced per team+type: keeps big armies fast), knight + horse, building models, arrows.
- `src/geo.js` — helpers to bake colours into geometry and merge parts (cloth vs metal buckets); shared materials `M`
  (PBR on Medium/High, Lambert on Low), wind sway, weathered-stone triplanar shader; `U` holds shared shader uniforms.
- `src/textures.js` — procedurally painted tiling ground textures; used as the fallback if photo textures fail to load.
- `src/assets.js` + `assets/tex/` — CC0 photo textures (Poly Haven, ambientCG; see `assets/CREDITS.md`), loaded before the
  world is built; leaf photos are composed into branch "cards" for trees at startup. Keep each texture ≤1K and the folder
  small (~3.5 MB now); only use CC0/permissively licensed assets and record them in CREDITS.md. Never use images from Google.
- `src/nature.js` + `assets/nature/` — photo-scanned CC0 Poly Haven rocks (6), stump and fallen log, slimmed by
  `tools/blender/nature.py` (raw downloads in `assets/incoming/polyhaven/`). world.js scatters them (instanced): mossy rocks,
  logs by the woods, a stump where every tree is felled (`addStump`), boulder heaps for mines/quarries; falls back to the
  old shapes if loading fails. Ferns are photo-frond cards (`fernGeo`, `FROND` rects in `fern_color.jpg`); the forest floor
  under trees is darker and earthy (`FOREST` density in `groundMix`); every 8th grass tuft flowers.
- `src/game.js` — simulation: spawning, orders, gathering, building, training, combat, projectiles, win/lose.
  Combat tactics live here too: `PACE` (global fight length), `counterMul` (unit counters), flanking, high ground,
  cavalry charge (`u.run`), braced spears, morale/rout (`shake`, `moraleTick`; Commander nearby inspires and rallies).
- `src/fow.js` — fog of war: 128² vis/seen grid → DataTexture; darkening is patched into three's fog shader chunks and
  the uniforms are injected via a `Material.prototype.onBeforeCompile` accessor (so it must be imported first in main.js).
  Enemy units/buildings out of sight get `fowHidden`. Off in Battle mode; Settings toggle.
- `src/sky.js` — day/night (10-min day) and weather (clear/cloudy/rain/mist). Clock lives in `game.env` (`stepEnv`), visuals
  in `Atmosphere`; night/mist shrink sight (`game.sightMul`), rain weakens ranged. Settings toggle; tutorial stays sunny.
- `src/campaign.js` — 4 missions (`MISSIONS`: setup/tick/goals/check), progress in localStorage `bf.campaign`, `#mission=N,civ`.
- `src/net.js` — online 1v1 over WebRTC (PeerJS 1.5.4 from jsDelivr, loaded on demand). Host runs the game (`HostSync`:
  10 Hz snapshots, team-swapped); guest is a puppet (`GuestSync`: `game.puppet`, game methods in `RPC` forwarded to the host).
  `?loop` in the URL = two-tab test link (BroadcastChannel) used by test_game.py; the sandbox here blocks real WebRTC.
  ICE: several STUN servers plus optional relay (TURN) servers from `assets/turn.json` (`[{urls, username, credential}]`
  or `{iceServers: [...]}`; absent = STUN only). The free public relays (PeerJS's, openrelay, freestun) were all dead in
  Nov 2026. Since v0.38.1 `assets/turn.json` holds the owner's free Metered "Open Relay" credential (app `bannerfall`,
  free no-card plan: 500 MB/month, dashboard.metered.ca; the 20 GB free plan needs a card). `?relay` in the URL forces
  relay-only connections to test it. `watchIce` shows a clear message if two devices still can't connect.
  Real two-tab PeerJS tests work in the built-in browser pane (localhost preview or the live site).
- Ages: `AGES` = Stone, Bronze, Iron, Castle (tech keys `feudal`, `kingdom`, `castleage`); soldiers' metal gear is tinted per
  age (`AGE_TINT`, `Figures.setAge`). Castle (BD.castle, Castle Age, one per side). Castle mode (`mode 'castle'`): skirmish rules,
  Bronze start, win by holding a built Castle `CASTLE_HOLD` (300 s) or eliminating the enemy; AI saves for ages/castle (`goal`).
- Buildings: drop-offs can be typed (`BD.x.drop` = 1 for all, or a string like 'w' / 'gs'); Mill, Lumber/Mining Camp, Market
  (`game.trade`), Temple (healers: `d.heal`), one Town Hall per side (`one`), population cap `MAX_POP` 200. Walls have three looks:
  wood → Stone Walls → Castle Walls (`fortresswalls`); `walltower` is a wall piece that shoots; towers: Guard Tower → Keep.
  Build menu pages: eco / mil / def (`BUILD_ECO/MIL/DEF`). Costs show with resource icons; disabled buttons say what's missing.
- `src/icons.js` — button pictures: `portrait('u:sword' | 'b:barracks')` renders the real model to a 96px image once (cached);
  `techSymbol` / `actionSymbol` pick a drawn SVG symbol for upgrades and actions. hud.js `pic(b)` uses `b.ic` or the label.
- `src/anim.js` + `assets/anim/` — animated soldiers (on by default; Settings switch `animOn`, or `?anim=0/1`). A KayKit CC0
  character (`char_knight.glb`, slimmed by `tools/kaykit.py --char`) with its own clips; every clip frame is baked into a bone
  texture and each unit type is one instanced mesh posed in the vertex shader (`AnimBatch`, same interface as `FigureBatch`;
  `Figures.get` picks it for kinds in `KINDS`). `PROP` re-proportions the chibi rig (small head, long legs); `teamMap` repaints
  the red accents and copper trim in the team colour; attachments (sword, shield, helmet, cape) ride one bone each (`show`).
  `animFigure` = still copy for portraits/export. Animated kinds (`KINDS`): sword, spear, hero (gold `look`), archer (bow),
  crossbow, peasant (work clip). Characters share one skeleton: clips come from `CLIP_FILES` (knight + `rig_tools`/`rig_ranged`).
  `GEAR` = extra pieces the pack lacks (spear, bow, quiver, axe), coloured per vertex. Horses and deer are Quaternius CC0
  animals (`animal_*.glb`, own rig, flat material colours; coats `h_*`, team saddle cloth `cloth`). Cavalry = `MountBatch`
  (`MOUNTS`: horse batch + seated rider batch whose upper body plays the attack, rider follows the horse's back bone).
  Siege, ships and civ unique units are still the built-in figures. Viewer: `tools/animview.html`. The `rig_*.glb`
  files (mannequin + extra clips from KayKit Character Animations 1.1) are not loaded yet; they are for future unit types.
- **Realistic soldiers (v0.31+): Mixamo** (Adobe, free inside games, *not* CC0 — don't publish the raw FBX). Raw downloads in
  `assets/incoming/mixamo/` (git-ignored); `tools/blender/mixamo.py char|clips` makes `assets/anim/mx_paladin|mx_archer|mx_peasant.glb`
  (finger bones dropped, ~3.5k tris, one texture + normal map; props named Sword/Shield/Bow/Helmet/Extra) and `mx_clips.glb`
  (30 clips: ss_* sword&shield, gs_* great sword, bow_*, xb_* rifle-held crossbow, f_* farming, sit). In anim.js `MODELS.*.mixamo`:
  no re-proportioning, clips keep only rotations + hip motion (scaled to each body), loop clips are taken in place and their
  speed measured (`table[n].pace`), `parts` picks the pieces, `MX_SLOT` maps gear onto Mixamo hands (`gripr` for crossbows),
  `bright` lifts dark textures, looks: gold (Commander), bronze (legion), lacquer (repeater), raider (berserker/light cav).
  Models: paladin (sword/spear/legion/hero/knight riders), mxarcher (archers, crossbows, repeaters, horse archers), brute
  (berserkers with his own battle axe; villagers with `hide: ['Weapon']` + gear axe), heraklios (light cavalry riders); mxpeasant unused.
  Several-material characters are baked into one atlas (source textures read 'map1' via UV Map nodes, bake into 'atlas').
  Team rings: `TeamRings` in models.js (instanced ring per team under every land unit, `RINGS.on` = Settings `rings`).
  Downloads: the owner signs in to mixamo.com in the browser pane; the pane can't save files, so read the export job's
  `/monitor` response (network log) for the one-time S3 link and curl it. KayKit `char_*`/`rig_*` files are now unused.
- **God mode** (v0.34): setup tick box (`app.cfg.god`, `#god` in the URL); online only if both players ticked it (hello/start carry
  `god`). `game.god = { on, T: [{res, build, pop, hero}, …] }`; `cheat/cheatAge/cheatSpawn` (also in net.js `RPC`, team-swapped);
  reveal is local (fog off). ⚡ button → `#godp` panel (phones on their side: cheats and summons side by side, `.gbody`); summoning = pending `spawn`. God-only units in `UD` (`god: 1`): dragon (`fly`:
  straight-line flight 5 m up, `fire` breath = splash shot + `fx.breath`), troll, demon, skeleton (Mixamo), warwagon, battlecar
  (procedural parts in models.js; `dragonParts` is the stand-in if the model can't load). Their models are `lazy` in anim.js:
  `loadLazy()` runs only when a God-mode game starts. Dragon = Sketchfab CC-BY (credit in CREDITS.md); `mixamo.py creature` mode.
- **Voices** (v0.35): recorded lines in `assets/voices/<role>_<kind>_<n>.m4a` + `voices.json`, made by `tools/voices.py` (Piper TTS,
  LibriTTS-R speakers chosen by pitch per role; roars/engine synthesised). `Sound.voice(role, kind)` plays them (falls back to the
  device's speech); `voiceRole(u)` in main.js picks commander / soldier / knight / archer / villager / troll / demon / undead / dragon / car.
- Any troop can hunt animals (`command` → attack task on an animal res, `hurtAnimal`); God units (`d.god`) also attack their own side
  when targeted (rts.js tap, `command`, shots `any` → friendly splash).
- `src/battle.js` — Battle mode field: 3 capturable banners, reserves + reinforcement waves, army breaks if all banners held.
- Ships (v0.37): fishboat, transport (10), warship (archer galley), fireship (`d.fire`, `vsShip`), cog (big transport, 20),
  galleon (`d.cannon`: broadside from the side facing the target, `fx.muzzle`, 'cannon' sound, splash hits ships). Models in
  models.js `shipParts`; `SHIP_LEN` per type. AI (`navy()`) builds a mixed fleet and raids the water nearest the enemy town.
- `src/path.js` — A* pathfinding on the grid (pass a walk function: `cellWalk` for land, `navCell` for ships). `src/ai.js` — enemy AI for Skirmish, Battle, Survival.
  Skirmish AI (Knight/Warlord): counters the player's army (`counterW`), gathers at a rally point and attacks only when
  strong enough (`power`), targets the weakest spot (`weakSpot`), retreats when losing, cavalry raids on peasants (`raid`),
  scouting, towers by its gold, storehouses by wood/gold, rebalances workers; Warlord rings the bell. Squire stays simple.
- `src/rts.js` — aerial camera, picking, selection, touch/mouse orders. Touch: drag pans; hold a finger still ~0.4 s (buzz)
  then drag = box select; the Box button arms one box and switches itself off. Minimap canvas is 2 px per cell (`N * 2`). `src/pov.js` — 1st/3rd person: strike, Follow me,
  Act button (G: board/steer/leave ships, enter/leave buildings — rooms from `interiorGeo` in models.js), Mount (M).
- `src/hud.js` — resource bar, selection panel (portrait + HP bar, `head()`), command card, minimap, health bars, toasts.
  Command card buttons carry `grp` ('Gather', 'Build', 'Orders', 'Train', 'Research', 'Actions', 'Trade', 'Commander'...) and are
  drawn as captioned sections, two buttons high; `SHORT` keeps names short. The army shortcuts (`#quick`) float at the right edge.
- Team colours follow the people: `CIV_COLOR` (Franks blue, Romans red, Chinese yellow, Norse green, Mongols orange; a mirror match
  makes the enemy purple). `setTeamColors(mine, theirs)` in models.js edits `TEAM`, `RING_COL`, `TEAM_CSS` in place; `figures.reset()`
  rebuilds unit batches when colours change. The owner wants colours tied to the people, not "Blue team" style names or a picker.
- Line building: `LINE` in main.js (wall, fence) — press-and-drag (`app.lineDrag`, rts.js pointer mode 'line') or tap start + end.
  New buildings v0.33: Fence (`BD.fence`, wall-like, split rails), Outpost (sight 21, fow.js), Well (`d.mend`: nearby buildings self-repair).
- Main menu: crest SVG + gold title + glassy buttons (`.mbtn`, `.primary`), CSS embers, golden-hour cinematic camera (`MENU_ENV`).
- `window.bannerfall` exposes app state for debugging; `#play=skirmish,1` in the URL skips the menu (mode, difficulty 0-2).

## Tools on this Mac (art pipeline + tests)
- **Blender 4.5 LTS** at `~/Applications/Blender.app`; **Playwright** (Python) + Chromium in `~/.local/bannerfall-tools`
  (run scripts with `~/.local/bannerfall-tools/bin/python`). GitHub CLI at `~/.local/bin/gh`.
- **Custom models**: `tools/models.py` (Tripo API → `tools/blender/prepare_model.py` → `assets/models/<slot>.glb` +
  `manifest.json`); the game loads them via `src/gltfmodels.js` for buildings, ships, trees and bushes. Owner-facing guide:
  `docs/MODELS.md`. Raw downloads go in `assets/incoming/` (git-ignored). Budget: buildings ≤10k triangles, ships ≤7k,
  trees ≤700 (they're instanced hundreds of times). `models.py prepare <file> <slot> [--yaw 90] [--tex 512] [--source "credit"]`
  (default textures 512 px for buildings; `prepare_model.py` drops shape keys before slimming). Manifest extras: `sink` = metres
  of hull under water for ships (`shipParts`), `source` = credit line. Small buildings (size ≤2) may overhang their footprint
  (`buildingParts`). **v0.39 art (all CC BY, Sketchfab, credited in CREDITS.md):** warship = Viking longship, hall/house/store/
  barracks/stable/temple = realistic medieval houses, fishboat/transport/fireship/cog = rowing boat/Gislinge boat/Dromon/caravel;
  galleon is still procedural. Sketchfab downloads: open the model page in the browser pane, Download → pick glTF (or GLB with
  1K textures), then read the `/i/archives/latest?archiveType=…` response in the network log for the one-time S3 link and curl it
  (never call Sketchfab's API with the page's token). Search with the public Sketchfab API and judge picture contact sheets (Pillow is installed in the tools env).
  Animated animals: `tools/blender/animal.py IN OUT --keep A,B --rename A=Idle --tex 1024` keeps only the clips we use; the elk
  (WildMesh 3D, 53 clips) replaces the deer (`MODELS.deer` → `animal_elk.glb`, clips Eat/Walk/Run/Death). WildMesh's bear (81 clips)
  and the eagle were added in v0.40 (below).
- **v0.40 wildlife + elite troops:** Bears (`addBear` in world.js, `a.bear`, 70 hp, 320 meat) roam the wilds far from towns;
  they charge anyone within 4.5 m or whoever hurts them (`a.angry`), give up 22 m from home (`calmT`); bites are in
  `Game.bears()` (`onBear` warns the player); `nearestRes` never auto-picks a living bear. Drawn by `bearBatch` in main.js
  (`animal_bear.glb`, `KINDS.bear` with an Attack clip, `swT` from `a.biteAt`). Eagles: scenery only (`EAGLES` in main.js,
  `animal_eagle.glb`), circling 11-16 m up. `animal.py --atlas` packs a multi-material animal into one texture (the game
  uses one map per animated model). Castle trains elite **Royal Guard** (`guard`: paladin, look 'steel', great-sword clips,
  team plume) and **Halberdier** (`halberd`: look 'black', GEAR `halberd` + `plume`; gear colour 'team' = team colour,
  `head` slot); Siege Workshop builds the **Bombard** (`bombard`, Castle Age, `cannon` shot from the muzzle, `bombardParts`).
  Galleon = "Empty Ship" by Liaval (yaw 180, sink .55).
- **Unity bridge** (`tools/unity.py`): `export` writes every unit/building as FBX+GLB to `exports/unity/` (git-ignored; built
  from `figureGroup`/`buildingMesh` in models.js); `unpack <x.unitypackage>` safely copies models/textures to `assets/incoming/unity/`.
  The game itself stays Three.js on the web. Asset Store models: check the licence allows non-Unity use before publishing.
- **Tripo API key** lives only in `~/.config/bannerfall/tripo_key` (owner sets it with `models.py tripo-setup`); never read
  it into chat, print it, or commit it. API generations cost the owner money: get their OK first.
- Check the owner's Tripo plan licence before publishing a Tripo model; record custom models in `assets/CREDITS.md`.

## Testing before you push
- Run `~/.local/bannerfall-tools/bin/python tools/sweep.py` (presses every button for every unit/building, plays as
  every unit type, all 5 civs — must report SWEEP CLEAN) and `~/.local/bannerfall-tools/bin/python tools/test_game.py` (Playwright: title, all modes fast-forwarded, Commander,
  phone touch layout with 44px button check). Screenshots go to `tools/test-output/`. Add `--live` to test GitHub Pages.
- Run the local preview (`.claude/launch.json`) and check: no errors in the console or the red error box,
  select + move from above, Ride/Lead into 3rd person, toggle 1st person, return to command view.
- Check a phone-sized landscape viewport (e.g. 740×360) with touch emulation as well as desktop.
- The simulation can be fast-forwarded headlessly from the console to test AI/economy, e.g.
  `for (let i=0;i<6000;i++){bannerfall.game.update(.05);bannerfall.ai.update(.05)}`.
- When the preview pane is hidden the browser pauses animation frames, so drive tests with screenshots or the loop above.
- Note: macOS blocks the preview server from reading the Desktop folder, so the preview serves a copy —
  sync it first: `rsync -a --delete --exclude .git --exclude .claude ./ <DocumentRoot from .claude/launch.json>/`.

## Roadmap
1. ✅ v0.1 Terrain, units, select & move from above, 3rd-person view.
2. ✅ v0.2 Graphics pass; economy, buildings, training, combat, pathfinding, enemy AI; Skirmish / Battle / Survival modes.
2h. ✅ v0.10 Walk onto ships and steer them, walk into furnished building interiors, Commander mounts a horse,
   archers/crossbows aim and draw in time with their shots.
2f. ✅ v0.7 AAA polish pass: planked ship hulls, cloth sails, rigging, crew, wakes; post-processing (bloom, grade,
   vignette; GTAO on desktop High); sky clouds + cloud shadows; distant mountains; gear detail; minimap redesign
   (hill shading, white view box, attack pings); construction scaffolding + progress/builders/ETA label.
2e. ✅ v0.6 River map (bridge + 2 fords), Dock, fish, fishing boats, transport ships (board/unload), warships; naval AI.
2d. ✅ v0.5 Civilizations (Franks, Romans, Chinese, Norse, Mongols) with bonuses, penalties, unique units and their own
   look; crossbowmen, light cavalry, horse archers, catapults; Archery Range + Siege Workshop; PC/Mac camera controls.
2c. ✅ v0.4 Photo textures (ground, buildings, bark), photo-leaf trees, realistic water (waves, shoreline foam, depth
   colour; mirror reflections on High).
2b. ✅ v0.3 Realistic look (PBR + sky reflections, textured terrain, new trees, wind), remodelled soldiers/horses,
   camera glide, Box select, control groups, edge scroll, 3rd-person target ring / lunge / hold-to-strike.
3. ✅ Ages & upgrades, catapults; ✅ v0.15 walls (drag a line) and gates (own team passes: blocked=8 + `game.walkFor`),
   Stone Walls tech; enemies `breach` walls that block their path.
4. ✅ v0.13 Fog of war; ✅ v0.12 formations, morale, flanking, banners; ✅ v0.18 generated music (calm/battle, `Sound.schedule`)
   and unit voices (speechSynthesis, `speak()` in main.js).
5. ✅ v0.14 Highland Pass, Forest Valley, Random maps; ✅ v0.36 maps 4× bigger + Inland Sea; ✅ v0.37 galleons, fire ships, cogs.
6. 3rd-person polish: blocking, charge ability, mounted hero, camera avoiding trees.
