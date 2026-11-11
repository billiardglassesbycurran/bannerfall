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
- **Bump `VERSION` in `src/main.js` on every change you push** — it's shown top-right in the game so the owner
  can confirm their phone has the newest build.

## Code map
- `index.html` — page shell, HUD buttons, import map, on-screen error box (shows JS errors on phones).
- `src/main.js` — renderer, scene, lighting, spawning units, mode switching (command ⇄ 1st/3rd person), HUD, input routing, game loop.
- `src/terrain.js` — heightmap (noise ported from the prototype), `heightAt()`, `walkable()`, water, trees.
- `src/units.js` — unit figures built from primitives, team colours, movement/animation, separation, banners.
- `src/rts.js` — aerial camera, selection (click/tap/box/double-tap), move orders, touch pan/pinch/twist.
- `src/pov.js` — 1st/3rd-person camera and control (WASD + pointer-lock mouse; touch joystick + look drag).
- `window.bannerfall` exposes game state for debugging in the browser console.

## Testing before you push
- Run the local preview (`.claude/launch.json`) and check: no errors in the console or the red error box,
  select + move from above, Ride/Lead into 3rd person, toggle 1st person, return to command view.
- Check a phone-sized landscape viewport (e.g. 740×360) with touch emulation as well as desktop.
- Note: macOS blocks the preview server from reading the Desktop folder, so the preview serves a copy —
  sync it first: `rsync -a --delete --exclude .git --exclude .claude ./ <DocumentRoot from .claude/launch.json>/`.

## Roadmap (smallest playable first)
1. ✅ Terrain, a few units, select & move from above, drop into a unit's 3rd-person view.
2. Pathfinding around trees/water (A* on the grid, like the prototype).
3. Combat in both views (strike/block in 3rd person, auto-attack in command view), health, death.
4. Enemy AI, then economy (peasants, food/wood/gold), buildings, training units.
5. Minimap, graphics quality setting, sound, menus, maps & campaign from the prototype.
