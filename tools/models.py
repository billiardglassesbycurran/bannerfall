#!/usr/bin/env python3
"""Bannerfall 3D model pipeline: Tripo (AI model generator) -> Blender (clean-up) -> assets/models/ (used by the game).

Run with:  ~/.local/bannerfall-tools/bin/python tools/models.py <command> ...

  slots                         list the model slots the game understands (hall, house, warship, tree_pine, ...)
  prepare <file> <slot>         clean up a downloaded .glb/.fbx/.obj with Blender and install it for <slot>
  tripo-setup                   save your Tripo API key on this Mac (typed privately, never stored in the project)
  tripo <slot> "<description>"  generate a model with the Tripo API, then prepare + install it
  list                          show installed custom models
  remove <slot>                 go back to the built-in model for <slot>

Options for prepare/tripo:  --faces N (triangle budget)  --yaw DEG (turn it)  --height M / --length M (size)
"""
import argparse, getpass, json, os, pathlib, stat, subprocess, sys, time, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
MODELS = ROOT / 'assets' / 'models'
INCOMING = ROOT / 'assets' / 'incoming'
MANIFEST = MODELS / 'manifest.json'
BLENDER = os.environ.get('BLENDER', str(pathlib.Path.home() / 'Applications/Blender.app/Contents/MacOS/Blender'))
KEYFILE = pathlib.Path.home() / '.config' / 'bannerfall' / 'tripo_key'
TRIPO = 'https://openapi.tripo3d.ai/v3'
TRIPO_MODEL = 'v3.1-20260211'

# what the game can swap in. size = building footprint (cells) the model is fitted into.
SLOTS = {
    'hall': dict(kind='building', height=6.0, size=5, faces=10000, hint='a medieval town hall'),
    'house': dict(kind='building', height=3.0, size=2, faces=4000, hint='a small medieval cottage'),
    'store': dict(kind='building', height=3.0, size=3, faces=5000, hint='a medieval storehouse with crates'),
    'barracks': dict(kind='building', height=3.5, size=4, faces=8000, hint='a medieval stone barracks'),
    'range': dict(kind='building', height=3.0, size=4, faces=7000, hint='a medieval archery range with targets'),
    'stable': dict(kind='building', height=3.0, size=4, faces=7000, hint='a medieval wooden stable'),
    'workshop': dict(kind='building', height=3.5, size=4, faces=7000, hint='a medieval siege workshop'),
    'smith': dict(kind='building', height=3.5, size=3, faces=6000, hint='a medieval blacksmith forge'),
    'tower': dict(kind='building', height=6.5, size=2, faces=5000, hint='a medieval stone watchtower'),
    'dock': dict(kind='building', height=2.5, size=3, faces=5000, hint='a small wooden medieval dock'),
    'fishboat': dict(kind='ship', length=3.2, faces=4000, hint='a small medieval fishing boat with one sail'),
    'transport': dict(kind='ship', length=5.4, faces=6000, hint='a medieval cog transport ship with a square sail'),
    'warship': dict(kind='ship', length=7.2, faces=7000, hint='a medieval war galley with oars and a square sail'),
    'tree_pine': dict(kind='tree', height=5.0, faces=700, hint='a pine tree'),
    'tree_oak': dict(kind='tree', height=4.5, faces=700, hint='an oak tree'),
    'bush': dict(kind='tree', height=.8, faces=300, hint='a berry bush'),
}


def load_manifest():
    return json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}


def save_manifest(m):
    MODELS.mkdir(parents=True, exist_ok=True); MANIFEST.write_text(json.dumps(m, indent=2) + '\n')


def prepare(src, slot, faces=None, yaw=0, height=None, length=None):
    if slot not in SLOTS: sys.exit(f'Unknown slot "{slot}". Run: models.py slots')
    if not pathlib.Path(BLENDER).exists(): sys.exit(f'Blender not found at {BLENDER}')
    s = SLOTS[slot]; out = MODELS / f'{slot}.glb'
    size = ['--length', str(length or s['length'])] if s['kind'] == 'ship' else ['--height', str(height or s['height'])]
    cmd = [BLENDER, '-b', '--factory-startup', '-P', str(ROOT / 'tools/blender/prepare_model.py'), '--', str(src), str(out),
           *size, '--faces', str(faces or s['faces']), '--tex', '1024' if s['kind'] != 'tree' else '512', '--yaw', str(yaw)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    line = next((l for l in r.stdout.splitlines() if l.startswith('PREPARED')), None)
    if r.returncode or not line: sys.exit('Blender failed:\n' + (r.stdout[-2000:] + r.stderr[-2000:]))
    print(line)
    m = load_manifest(); m[slot] = {'file': f'{slot}.glb', **{k: v for k, v in s.items() if k != 'hint'}, 'yaw': yaw}; save_manifest(m)
    print(f'Installed for "{slot}". Bump BF_VERSION in index.html, test, commit and push to see it live.')


def tripo_key():
    k = os.environ.get('TRIPO_API_KEY') or (KEYFILE.read_text().strip() if KEYFILE.exists() else '')
    if not k: sys.exit('No Tripo API key yet. Run: models.py tripo-setup')
    return k


def api(method, path, body=None):
    req = urllib.request.Request(TRIPO + path, method=method, data=json.dumps(body).encode() if body else None,
                                 headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tripo_key()})
    with urllib.request.urlopen(req, timeout=60) as r: return json.loads(r.read())


def tripo(slot, prompt, faces=None, yaw=0):
    s = SLOTS.get(slot) or sys.exit(f'Unknown slot "{slot}"')
    full = f'{prompt}, game asset, single object, stylised realistic, clean geometry, no ground plane'
    print(f'Asking Tripo for: {full}')
    t = api('POST', '/generation/text-to-model', {'prompt': full, 'model': TRIPO_MODEL, 'texture': True, 'pbr': True, 'face_limit': max(faces or s['faces'], 2000)})
    tid = t['data']['task_id']; print('Task', tid)
    for _ in range(300):
        d = api('GET', f'/tasks/{tid}')['data']
        if d['status'] == 'success': url = d['output']['model_url']; break
        if d['status'] in ('failed', 'cancelled', 'banned', 'expired'): sys.exit(f'Tripo task {d["status"]}')
        print(f'  {d.get("status")} {d.get("progress", 0)}%', end='\r'); time.sleep(3)
    else: sys.exit('Tripo took too long')
    INCOMING.mkdir(parents=True, exist_ok=True); dst = INCOMING / f'{slot}-{int(time.time())}.glb'
    urllib.request.urlretrieve(url, dst); print(f'\nDownloaded {dst.name} ({dst.stat().st_size // 1024} KB)')
    prepare(dst, slot, faces, yaw)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('cmd'); p.add_argument('args', nargs='*')
    p.add_argument('--faces', type=int); p.add_argument('--yaw', type=float, default=0); p.add_argument('--height', type=float); p.add_argument('--length', type=float)
    a = p.parse_args()
    if a.cmd == 'slots':
        for k, v in SLOTS.items(): print(f'  {k:10s} {v["kind"]:8s} e.g. "{v["hint"]}"')
    elif a.cmd == 'prepare' and len(a.args) == 2: prepare(pathlib.Path(a.args[0]).expanduser(), a.args[1], a.faces, a.yaw, a.height, a.length)
    elif a.cmd == 'tripo-setup':
        k = getpass.getpass('Paste your Tripo API key (it will not be shown) and press Enter: ').strip()
        if not k: sys.exit('Nothing entered.')
        KEYFILE.parent.mkdir(parents=True, exist_ok=True); KEYFILE.write_text(k); os.chmod(KEYFILE, stat.S_IRUSR | stat.S_IWUSR)
        print(f'Saved privately to {KEYFILE} (only your user account can read it).')
    elif a.cmd == 'tripo' and len(a.args) == 2: tripo(a.args[0], a.args[1], a.faces, a.yaw)
    elif a.cmd == 'list': print(json.dumps(load_manifest(), indent=2))
    elif a.cmd == 'remove' and len(a.args) == 1:
        m = load_manifest(); m.pop(a.args[0], None); save_manifest(m); (MODELS / f'{a.args[0]}.glb').unlink(missing_ok=True); print('Removed', a.args[0])
    else: p.print_help(); sys.exit(1)


if __name__ == '__main__':
    main()
