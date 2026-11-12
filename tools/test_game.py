#!/usr/bin/env python3
"""Automated browser tests for Bannerfall (Playwright).

Run:  ~/.local/bannerfall-tools/bin/python tools/test_game.py           (tests the local files)
      ~/.local/bannerfall-tools/bin/python tools/test_game.py --live    (tests the published GitHub Pages site)

It opens the game in a real (headless) Chrome, checks for errors, plays every mode for a few fast-forwarded minutes,
tests a phone-sized touch screen, rides the Commander, and saves screenshots to tools/test-output/.
Exits with code 1 if anything fails.
"""
import re, functools, http.server, json, pathlib, sys, threading, time
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'tools' / 'test-output'
LIVE = 'https://billiardglassesbycurran.github.io/bannerfall/'
fails = []


def check(ok, what):
    print(('  PASS  ' if ok else '  FAIL  ') + what)
    if not ok:
        fails.append(what)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()


def serve():
    httpd = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(ROOT)))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return f'http://127.0.0.1:{httpd.server_address[1]}/'


ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']


def open_game(pw, base, hash_='', **ctx):
    browser = pw.chromium.launch(args=ARGS)  # a fresh browser per test keeps the software renderer from bogging down
    context = browser.new_context(**ctx)
    context.add_init_script("try { localStorage.setItem('bf.quality', 'med') } catch (e) {}")  # what phones use
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'favicon' not in m.text and 'Failed to load resource' not in m.text else None)
    page.on('requestfailed', lambda r: errors.append(f'request failed: {r.url} ({r.failure})') if 'favicon' not in r.url else None)
    for attempt in range(2):  # the software renderer occasionally stalls a first load: reload once before failing
        page.goto(base + ('#' + hash_ if hash_ else '')) if attempt == 0 else page.reload()
        for _ in range(90):  # poll ourselves: the software renderer can starve Playwright's own waiting
            if page.evaluate('!!window.bannerfall && !document.getElementById("loading")'): break
            time.sleep(1.5)
        else: continue
        break
    else: raise TimeoutError('game did not finish loading')
    return page, errors


def err_box(page):
    return page.evaluate('document.getElementById("err").textContent')


SIM = """(secs) => { const a = window.bannerfall, g = a.game; let err = null;
  try { for (let i = 0; i < secs * 20 && !g.over; i++) { g.update(.05); a.ai.update(.05); if (i % 10 === 0) { g.syncVisuals(.05, -1); a.hud.update(.05); } } } catch (e) { err = String(e.stack || e); }
  const n = t => g.units.filter(u => u.alive && u.team === t).length;
  return { err, t: Math.round(g.time), over: g.over, mine: n(0), enemy: n(1), age: [g.T[0].age, g.T[1].age] }; }"""


def main():
    live = '--live' in sys.argv
    base = LIVE if live else serve()
    OUT.mkdir(parents=True, exist_ok=True)
    print(f'Testing {base}')
    with sync_playwright() as p:
        desk = dict(viewport={'width': 1280, 'height': 720})

        print('Title menu')
        page, errors = open_game(p, base, **desk)
        check(page.is_visible('#home'), 'main menu is shown')
        page.screenshot(path=str(OUT / 'menu.png'))
        page.click('#hPlay'); page.wait_for_timeout(300)
        check(page.is_visible('#title') and not page.is_visible('#home'), 'Play opens the game setup')
        check(page.locator('#civs .btn').count() >= 5, 'five civilizations to pick from')
        page.click('#bBack'); page.wait_for_timeout(200)
        check(page.is_visible('#home'), 'Back returns to the main menu')
        page.click('#hPlay'); page.wait_for_timeout(200)
        check(not err_box(page) and not errors, 'no errors on load ' + (err_box(page) + ' '.join(errors))[:300])
        page.screenshot(path=str(OUT / 'title.png'))
        page.context.browser.close()

        for mode in ['skirmish', 'battle', 'survival']:
            print(f'Mode: {mode}')
            page, errors = open_game(p, base, f'play={mode},1,romans,norse', **desk)
            check(page.is_visible('#top') and page.is_visible('#bottom'), f'{mode}: game HUD visible')
            r = page.evaluate(SIM, 150)
            check(r['err'] is None, f'{mode}: 150 s of simulated play without errors {r}')
            time.sleep(.5); page.screenshot(path=str(OUT / f'{mode}.png'))
            check(not err_box(page) and not errors, f'{mode}: no errors ' + (err_box(page) + ' '.join(errors))[:300])
            page.context.browser.close()

        print('Commander (3rd person)')
        page, errors = open_game(p, base, 'play=battle,1,franks,mongols', **desk)
        page.click('#bLead'); page.wait_for_timeout(500)
        check(page.evaluate('window.bannerfall.mode') == 'pov', 'Lead puts you in 3rd person')
        page.keyboard.down('KeyW'); page.wait_for_timeout(800); page.keyboard.up('KeyW')
        page.screenshot(path=str(OUT / 'commander.png'))
        page.click('#bExit'); page.wait_for_timeout(300)
        check(page.evaluate('window.bannerfall.mode') == 'rts', 'Command button returns to the view from above')
        page.context.browser.close()

        print('Walk into a building, mount up, board a ship, archers aim')
        page, errors = open_game(p, base, 'play=skirmish,1,franks,norse', **desk)
        page.click('#bLead'); page.wait_for_timeout(300)
        page.evaluate("""() => { const a = window.bannerfall, g = a.game, h = g.hero, hall = g.blds[0], pov = a.pov;
          h.x = hall.x; h.z = hall.z + hall.size / 2 + 1.6; pov.yaw = Math.PI; pov.snap = true; }""")  # at the door, facing it
        page.keyboard.down('KeyW'); page.wait_for_timeout(1500); page.keyboard.up('KeyW')
        check(page.evaluate('!!window.bannerfall.pov.room'), 'walking through the door takes the Commander inside (no button)')
        page.screenshot(path=str(OUT / 'inside-hall.png'))
        page.evaluate("() => { const pov = window.bannerfall.pov; pov.yaw = pov.room.ry; }")  # turn back to the door
        page.keyboard.down('KeyW'); page.wait_for_timeout(4000); page.keyboard.up('KeyW')
        check(page.evaluate('!window.bannerfall.pov.room'), 'walking back out of the door leaves the building')
        page.evaluate("""() => { const a = window.bannerfall, g = a.game, h = g.hero, hall = g.blds[0], pov = a.pov;
          h.x = hall.x + hall.size / 2 + 1.2; h.z = hall.z; pov.yaw = -Math.PI / 2; pov.snap = true; }""")  # against a side wall
        page.keyboard.down('KeyW')
        for _ in range(30):  # the software renderer is slow: wait for it rather than a fixed time
            page.wait_for_timeout(300)
            if page.evaluate('!!window.bannerfall.pov.room'): break
        page.keyboard.up('KeyW')
        check(page.evaluate('!!window.bannerfall.pov.room'), 'walking into a wall also goes inside')
        page.evaluate("() => window.bannerfall.pov.exitRoom(true)")
        page.click('#bMount'); page.wait_for_timeout(600)
        check(page.evaluate("window.bannerfall.pov.unit.type") == 'herohorse', 'Commander mounts his horse')
        page.screenshot(path=str(OUT / 'mounted.png'))
        r = page.evaluate("""() => { const a = window.bannerfall, g = a.game, pov = a.pov, h = pov.unit;
          let best = null; for (let z = 20; z < 108; z++) for (let x = 20; x < 108; x++) { const w = g.walkFor({ d: { ship: 1 } }); if (w(x, z) && !w(x + 3, z) && g.walkFor(h)(x + 3, z)) { best = [x, z]; break; } if (best) break; }
          const sh = g.spawnUnit(0, 'warship', best[0] + .5, best[1] + .5); h.x = best[0] + 3.5; h.z = best[1] + .5; pov.update(.05); const act = pov.action();
          return { act: act && act.label, ship: sh.id }; }""")
        check(r['act'] == 'Board', f'Act button offers to board a nearby ship {r}')
        page.click('#bAct'); page.wait_for_timeout(300)
        page.keyboard.down('KeyW'); page.wait_for_timeout(1500); page.keyboard.up('KeyW')
        r = page.evaluate("() => { const u = window.bannerfall.pov.unit; return { on: !!u.onShip, speed: u.onShip && u.onShip.speedNow }; }")
        check(r['on'], f'Commander is aboard and can sail {r}')
        page.screenshot(path=str(OUT / 'sailing.png'))
        page.click('#bExit'); page.wait_for_timeout(300)
        check(page.evaluate('!window.bannerfall.pov.unit && !window.bannerfall.game.hero.onShip'), 'leaving the view steps him off the ship')
        r = page.evaluate("""() => { const a = window.bannerfall, g = a.game; const ar = g.spawnUnit(0, 'archer', 60, 80), e = g.spawnUnit(1, 'sword', 60, 86);
          g.attack(ar, e); for (let i = 0; i < 30; i++) { g.update(.05); g.syncVisuals(.05, -1); } return { aim: ar.aimK }; }""")
        check(r['aim'] > .8, f'archers raise their bows to aim when engaging {r}')
        check(not err_box(page) and not errors, 'features: no errors ' + (err_box(page) + ' '.join(errors))[:300])
        page.context.browser.close()

        print('Online play (two tabs, same-computer test link)')
        H, herr = open_game(p, base + 'index.html?loop=1', '', viewport={'width': 1000, 'height': 600})
        G = H.context.new_page(); gerr = []; G.on('pageerror', lambda e: gerr.append(str(e))); G.goto(base + 'index.html?loop=1')
        for _ in range(90):
            if G.evaluate('!!window.bannerfall && !document.getElementById("loading")'): break
            time.sleep(1.5)
        H.click('#hOnline'); G.click('#hOnline')
        H.click('#bHost'); code = None
        for _ in range(40):
            time.sleep(.5); mm = re.search(r'Your code: ([A-Z0-9]{5})', H.inner_text('#onlineMsg'))
            if mm: code = mm.group(1); break
        check(bool(code), f'host gets a join code {code}')
        G.fill('#joinCode', code or ''); G.click('#bJoin')
        for _ in range(60):
            time.sleep(.5)
            if G.evaluate('() => !!bannerfall.game && bannerfall.game.units.length > 0'): break
        r = G.evaluate("() => { const g = bannerfall.game; return { mine: g.units.filter(u => u.team === 0).length, blds: g.blds.length } }")
        check(r['mine'] >= 5 and r['blds'] >= 2, f'guest sees the battlefield {r}')
        G.evaluate("() => { const a = bannerfall, g = a.game, p = g.units.find(u => u.team === 0 && u.type === 'peasant'); window._p = p.id; a.select([p]); const t = g.nearestRes(p.x, p.z, 'w', 40); a.order(t, t.x, t.z); }")
        time.sleep(3); pid = G.evaluate('window._p')
        check(H.evaluate(f"() => bannerfall.game.units.find(u => u.id === {pid})?.task.type") == 'gather', "guest's orders are carried out on the host")
        check(not herr and not gerr, f'online: no errors {herr[:2]} {gerr[:2]}')
        H.context.browser.close()

        print('Phone (touch, 740x360 landscape)')
        page, errors = open_game(p, base, 'play=skirmish,1,chinese,franks', viewport={'width': 740, 'height': 360}, has_touch=True, is_mobile=True, device_scale_factor=2)
        page.evaluate("() => { const a = window.bannerfall; a.select(a.game.units.filter(u => u.team === 0 && u.type === 'peasant')); a.hud.sig = ''; a.hud.updateCard(); }")
        page.wait_for_timeout(300)
        boxes = page.evaluate("[...document.querySelectorAll('#bottom .btn, #bottom .cbtn, #top .btn')].map(b => { const r = b.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom), Math.round(r.width), Math.round(r.height), b.id || b.textContent.slice(0, 12)]; })")
        check(all(b[0] >= -1 and b[1] >= -1 and b[2] <= 741 and b[3] <= 361 for b in boxes), 'all buttons fit on a phone screen')
        small = [b for b in boxes if b[4] < 44 and b[5] < 44]
        check(not small, 'buttons are big enough to tap' + (f' (too small: {small})' if small else ''))
        page.screenshot(path=str(OUT / 'phone.png'))
        check(not err_box(page) and not errors, 'phone: no errors ' + (err_box(page) + ' '.join(errors))[:300])
        page.context.browser.close()

    print(f'\n{"ALL TESTS PASSED" if not fails else str(len(fails)) + " TEST(S) FAILED"} — screenshots in {OUT}')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
