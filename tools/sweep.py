#!/usr/bin/env python3
"""Bug sweep: presses every command-panel button for every unit/building type, plays as every unit type
(strike, act, mount, view, exit), and reports any error with the step that caused it.

Run:  ~/.local/bannerfall-tools/bin/python tools/sweep.py
"""
import json, sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).parent))
import test_game as T
from playwright.sync_api import sync_playwright

SWEEP = r"""async () => {
  const a = window.bannerfall, g = a.game, log = [], wait = ms => new Promise(r => setTimeout(r, ms));
  const errBox = () => document.getElementById('err').textContent;
  let lastErr = '';
  const step = async (what, fn) => {
    try { await fn(); } catch (e) { log.push({ what, err: String(e && e.stack || e).slice(0, 400) }); }
    for (let i = 0; i < 6; i++) { g.update(.05); a.ai.update(.05); g.syncVisuals(.05, -1); a.hud.update(.05); a.pov.unit && a.pov.update(.05); }
    const eb = errBox(); if (eb !== lastErr) { log.push({ what, err: eb.slice(lastErr.length, lastErr.length + 400) }); lastErr = eb; }
  };
  const cardButtons = () => [...document.querySelectorAll('#card .btn')];
  const pressAll = async (label, selFn) => {
    a.select(selFn()); a.hud.page = null; a.hud.sig = ''; a.hud.updateCard();
    const n = cardButtons().length; const names = cardButtons().map(b => b.innerText.replace(/\n/g, ' '));
    for (let i = 0; i < n; i++) {
      a.select(selFn().filter(e => e.alive !== false)); a.hud.page = a.hud.pageFor?.(label) ?? a.hud.page; a.hud.sig = ''; a.hud.updateCard();
      const b = cardButtons()[i]; if (!b) continue; const t = b.innerText.replace(/\n/g, ' ');
      if (/Demolish|Sure/.test(t)) continue;
      await step(`${label}: "${t}"`, () => { b.click(); });
      if (a.pending) await step(`${label}: cancel pending after "${t}"`, () => a.cancelPending());
      if (a.hud.page) { const sub = cardButtons().map(x => x.innerText.replace(/\n/g, ' '));
        for (let j = 0; j < sub.length; j++) { const bb = cardButtons()[j]; if (!bb) continue; const tt = bb.innerText.replace(/\n/g, ' ');
          await step(`${label} > ${a.hud.page}: "${tt}"`, () => bb.click()); if (a.pending) await step('cancel', () => a.cancelPending()); }
        a.hud.page = null; }
    }
    return names;
  };
  Object.assign(g.T[0], { f: 99999, w: 99999, g: 99999 });
  await step('advance to Castle Age', () => { g.applyTech(0, 'feudal'); g.applyTech(0, 'kingdom'); g.applyTech(0, 'castleage'); g.T[0].s = 99999; });
  const h = g.blds[0], placed = {};
  const place = t => { for (let r = 6; r < 30; r++) for (let k = 0; k < 24; k++) { const cx = Math.round(h.x + Math.cos(k / 24 * 6.28 + r) * r - 2), cz = Math.round(h.z + Math.sin(k / 24 * 6.28 + r) * r - 2); if (g.canPlace(t, cx, cz)) return g.placeBuilding(0, t, cx, cz, true); } };
  for (const t of ['house', 'farm', 'store', 'mill', 'lumber', 'mining', 'market', 'temple', 'barracks', 'range', 'stable', 'workshop', 'smith', 'tower', 'wall', 'gate', 'walltower', 'castle']) await step('place ' + t, () => { placed[t] = place(t); if (!placed[t]) throw new Error('no room for ' + t); });
  await step('place dock', () => { for (let cz = 4; cz < 124 && !placed.dock; cz++) for (let cx = 4; cx < 124 && !placed.dock; cx++) if (g.canPlace('dock', cx, cz)) placed.dock = g.placeBuilding(0, 'dock', cx, cz, true); });
  g.recount();
  const report = { buildings: {}, units: {} };
  for (const [t, b] of Object.entries({ hall: h, ...placed })) if (b) report.buildings[t] = await pressAll(t, () => [b]);
  const types = ['peasant', 'healer', 'sword', 'spear', 'archer', 'crossbow', 'knight', 'lightcav', 'horsearcher', 'catapult', g.civ[0].unique.type, 'fishboat', 'transport', 'warship'];
  const made = {};
  for (const t of types) await step('spawn ' + t, () => { made[t] = g.spawnUnit(0, t, h.x + 6, h.z - 6); if (!made[t]) throw new Error('spawn failed'); });
  for (const t of types) if (made[t]) report.units[t] = await pressAll(t, () => [made[t]]);
  report.units.hero = await pressAll('hero', () => [g.hero]);
  report.units.mixed = await pressAll('peasants+soldiers', () => [made.peasant, made.sword, made.archer]);
  const tree = g.nearestRes(h.x, h.z, 'w', 60); report.resource = await pressAll('tree', () => [tree]);
  // play as every unit type
  for (const t of [...types, 'hero']) {
    const u = t === 'hero' ? g.hero : made[t]; if (!u || !u.alive) continue;
    await step(`play as ${t}`, () => { a.select([u]); document.getElementById('bRide').click(); if (a.mode !== 'pov') throw new Error('did not enter 3rd person'); });
    await step(`${t}: strike`, () => document.getElementById('bStrike').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    await step(`${t}: walk`, () => { a.keys.KeyW = true; }); await step(`${t}: stop`, () => { a.keys.KeyW = false; });
    await step(`${t}: act`, () => a.pov.act()); await step(`${t}: act again`, () => a.pov.act());
    await step(`${t}: mount`, () => a.pov.toggleMount()); await step(`${t}: 1st person`, () => document.getElementById('bView').click());
    await step(`${t}: back to 3rd`, () => document.getElementById('bView').click());
    await step(`${t}: follow me`, () => document.getElementById('bFollow').click());
    await step(`${t}: exit`, () => { document.getElementById('bExit').click(); if (a.mode !== 'rts') throw new Error('did not return to command view'); });
  }
  for (const code of ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash', 'KeyI', 'Home', 'KeyH', 'Tab', 'Escape', 'KeyP', 'KeyP']) {
    await step('key ' + code, () => { a.select([h]); dispatchEvent(new KeyboardEvent('keydown', { code })); dispatchEvent(new KeyboardEvent('keyup', { code })); if (a.mode === 'pov') document.getElementById('bExit').click(); if (a.pending) a.cancelPending(); });
  }
  await step('fast-forward 5 minutes', () => { for (let i = 0; i < 6000 && !g.over; i++) { g.update(.05); a.ai.update(.05); if (i % 20 === 0) { g.syncVisuals(.05, -1); a.hud.update(.05); } } });
  return { problems: log, report };
}"""


def main():
    base = T.serve(); bad = 0
    with sync_playwright() as p:
        for civ in ['franks', 'romans', 'chinese', 'norse', 'mongols']:
            page, errors = T.open_game(p, base, f'play=skirmish,1,{civ},franks', viewport={'width': 1280, 'height': 720})
            r = page.evaluate(SWEEP)
            probs = r['problems'] + [{'what': 'console', 'err': e} for e in errors]
            print(f'\n== {civ}: {len(probs)} problem(s)')
            for pr in probs[:25]: print('  -', pr['what'], '::', pr['err'][:300].replace('\n', ' | '))
            if civ == 'franks': print(json.dumps(r['report'], indent=1)[:3000])
            bad += len(probs)
            page.context.browser.close()
    print('\nSWEEP CLEAN' if not bad else f'\n{bad} PROBLEM(S) FOUND'); sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
