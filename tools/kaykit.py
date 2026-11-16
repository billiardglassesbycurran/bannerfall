#!/usr/bin/env python3
"""Slim KayKit (CC0, www.kaylousberg.com) character/animation .glb files down to what Bannerfall uses.

Run with:  python3 -I tools/kaykit.py <folder of the unzipped "KayKit Character Animations" pack>
           python3 -I tools/kaykit.py --char <Character.glb> <name>     (a character from the Adventurers pack)

Writes small files into assets/anim/: the mannequin body + only the chosen animation clips, per pack.
The game (src/anim.js) loads them and plays them for whole armies at once.
"""
import json, pathlib, struct, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'assets' / 'anim'
# pack file -> (output name, keep the body mesh?, clips to keep)
PACKS = {
    'Rig_Medium_General.glb': ('rig_general.glb', True, ['Idle_A', 'Idle_B', 'Death_A', 'Death_B', 'Hit_A']),
    'Rig_Medium_MovementBasic.glb': ('rig_move.glb', False, ['Walking_A', 'Running_A']),
    'Rig_Medium_CombatMelee.glb': ('rig_melee.glb', False, ['Melee_1H_Attack_Chop', 'Melee_1H_Attack_Slice_Diagonal', 'Melee_1H_Attack_Stab', 'Melee_2H_Attack_Chop', 'Melee_2H_Attack_Stab', 'Melee_Blocking', 'Melee_2H_Idle']),
    'Rig_Medium_Tools.glb': ('rig_tools.glb', False, ['Chopping', 'Hammering', 'Pickaxing', 'Working_A', 'Digging']),
    'Rig_Medium_CombatRanged.glb': ('rig_ranged.glb', False, ['Ranged_Bow_Idle', 'Ranged_Bow_Draw', 'Ranged_Bow_Release', 'Ranged_2H_Aiming', 'Ranged_2H_Shoot', 'Ranged_2H_Reload']),
}
CSIZE = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT2': 4, 'MAT3': 9, 'MAT4': 16}


def read_glb(path):
    b = pathlib.Path(path).read_bytes()
    if b[:4] != b'glTF': sys.exit(f'{path}: not a .glb file')
    n = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + n]); off = 20 + n
    m = struct.unpack('<I', b[off:off + 4])[0]
    return j, b[off + 8:off + 8 + m]


def prune(src, dst, keep_mesh, clips):
    j, binb = read_glb(src)
    have = {a['name'] for a in j.get('animations', [])}
    missing = [c for c in clips if c not in have]
    if missing: print(f'  note: {src.name} has no clip(s) {missing}')
    j['animations'] = [a for a in j.get('animations', []) if a['name'] in clips]
    if not keep_mesh:
        for n in j['nodes']: n.pop('mesh', None); n.pop('skin', None)
        for k in ('meshes', 'skins', 'materials', 'textures', 'images', 'samplers'): j.pop(k, None)
    out = bytearray(); views = []; amap = {}

    def add_bytes(data, target=None):
        while len(out) % 4: out.append(0)
        v = {'buffer': 0, 'byteOffset': len(out), 'byteLength': len(data)}
        if target: v['target'] = target
        out.extend(data); views.append(v); return len(views) - 1

    def acc(i):
        if i in amap: return amap[i]
        a = dict(j['accessors'][i]); assert 'sparse' not in a, 'sparse accessors are not supported'
        bv = j['bufferViews'][a['bufferView']]; size = CSIZE[a['componentType']] * NCOMP[a['type']]
        assert bv.get('byteStride', size) == size, 'interleaved buffers are not supported'
        start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        a['bufferView'] = add_bytes(binb[start:start + size * a['count']], bv.get('target')); a.pop('byteOffset', None)
        new.append(a); amap[i] = len(new) - 1; return amap[i]

    new = []
    for a in j['animations']:
        for s in a['samplers']: s['input'] = acc(s['input']); s['output'] = acc(s['output'])
    for m in j.get('meshes', []):
        for p in m['primitives']:
            p['attributes'] = {k: acc(v) for k, v in p['attributes'].items()}
            if 'indices' in p: p['indices'] = acc(p['indices'])
            p.pop('targets', None)
    for s in j.get('skins', []):
        if 'inverseBindMatrices' in s: s['inverseBindMatrices'] = acc(s['inverseBindMatrices'])
    for im in j.get('images', []):
        if 'bufferView' in im:
            bv = j['bufferViews'][im['bufferView']]; o = bv.get('byteOffset', 0)
            im['bufferView'] = add_bytes(binb[o:o + bv['byteLength']])
    j['accessors'] = new; j['bufferViews'] = views
    while len(out) % 4: out.append(0)
    j['buffers'] = [{'byteLength': len(out)}]
    js = json.dumps(j, separators=(',', ':')).encode()
    while len(js) % 4: js += b' '
    total = 12 + 8 + len(js) + 8 + len(out)
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_bytes(b'glTF' + struct.pack('<II', 2, total) + struct.pack('<I', len(js)) + b'JSON' + js + struct.pack('<I', len(out)) + b'BIN\0' + bytes(out))
    print(f'  {dst.relative_to(ROOT)}: {len(j["animations"])} clips, {dst.stat().st_size // 1024} KB (was {pathlib.Path(src).stat().st_size // 1024} KB)')


def main():
    a = sys.argv[1:]
    if len(a) == 3 and a[0] == '--char':  # a textured character (e.g. Knight.glb): keep the mesh, drop its animations
        prune(pathlib.Path(a[1]).expanduser(), OUT / f'char_{a[2]}.glb', True, []); return
    if len(a) != 1: print(__doc__); sys.exit(1)
    pack = pathlib.Path(a[0]).expanduser(); src = pack / 'Animations' / 'gltf' / 'Rig_Medium'
    if not src.is_dir(): sys.exit(f'Could not find Animations/gltf/Rig_Medium inside {pack}')
    for name, (out, keep, clips) in PACKS.items(): prune(src / name, OUT / out, keep, clips)
    lic = pack / 'License.txt'
    if lic.exists(): (OUT / 'LICENSE-KayKit.txt').write_bytes(lic.read_bytes())
    print('Done.')


if __name__ == '__main__':
    main()
