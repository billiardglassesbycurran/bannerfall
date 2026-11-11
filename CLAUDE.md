# Bannerfall — project rules for Claude

Bannerfall is a medieval RTS built with **Three.js**. The player commands from an **aerial view**, and can drop into
**1st/3rd-person** as the **hero commander** or **possess any unit**.

## The owner is non-technical
- Explain what you're doing in plain language. Avoid jargon, or explain it in one short phrase.
- Whenever the owner must click, approve, install or sign in to something, give exact step-by-step instructions
  (which website, which button, what it looks like). Never assume they know where a setting lives.
- After each change, tell them how to see it: the live URL and that they may need to wait ~1–2 minutes for
  GitHub Pages to update, then reload (or bump `?v=` on the URL to skip the phone's cache).

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
- `src/main.js` — renderer, lighting, quality levels, title menu, game-mode setup, 1st/3rd-person switching, input routing, main loop.
- `src/data.js` — unit/building stats, difficulty levels, game modes (balance ported from the prototype).
- `src/world.js` — heightmap, walkability grid, roads, terrain splat shader, resources (trees/berries/gold), grass/rocks,
  water, sky, minimap colours. Tree/grass detail scales with the quality level — keep Medium near ~1M triangles.
- `src/models.js` — unit figures (GPU-instanced per team+type: keeps big armies fast), knight + horse, building models, arrows.
- `src/geo.js` — helpers to bake colours into geometry and merge parts (cloth vs metal buckets); shared materials `M`
  (PBR on Medium/High, Lambert on Low), wind sway, weathered-stone triplanar shader; `U` holds shared shader uniforms.
- `src/textures.js` — procedurally painted tiling ground textures; used as the fallback if photo textures fail to load.
- `src/assets.js` + `assets/tex/` — CC0 photo textures (Poly Haven, ambientCG; see `assets/CREDITS.md`), loaded before the
  world is built; leaf photos are composed into branch "cards" for trees at startup. Keep each texture ≤1K and the folder
  small (~3.5 MB now); only use CC0/permissively licensed assets and record them in CREDITS.md. Never use images from Google.
- `src/game.js` — simulation: spawning, orders, gathering, building, training, combat, projectiles, win/lose.
- `src/path.js` — A* pathfinding on the grid. `src/ai.js` — enemy AI for Skirmish, Battle, Survival.
- `src/rts.js` — aerial camera, picking, selection, touch/mouse orders. `src/pov.js` — 1st/3rd person, strike, Follow me.
- `src/hud.js` — resource bar, selection panel, command card, minimap, health bars, toasts.
- `window.bannerfall` exposes app state for debugging; `#play=skirmish,1` in the URL skips the menu (mode, difficulty 0-2).

## Testing before you push
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
2c. ✅ v0.4 Photo textures (ground, buildings, bark), photo-leaf trees, realistic water (waves, shoreline foam, depth
   colour; mirror reflections on High).
2b. ✅ v0.3 Realistic look (PBR + sky reflections, textured terrain, new trees, wind), remodelled soldiers/horses,
   camera glide, Box select, control groups, edge scroll, 3rd-person target ring / lunge / hold-to-strike.
3. Ages & upgrades (Feudal/Kingdom, blacksmith, from the prototype), walls, catapults.
4. Fog of war, control groups, formations UI, sound and music.
5. Campaign missions and more maps (the prototype has Riverlands / Highland Pass / Forest Valley and 4 missions).
6. 3rd-person polish: blocking, charge ability, mounted hero, camera avoiding trees.
