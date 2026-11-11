#!/usr/bin/env python3
"""Bannerfall <-> Unity bridge.

Run with:  ~/.local/bannerfall-tools/bin/python tools/unity.py <command> ...

  export                     export every Bannerfall unit, horse, ship and building (all 3 ages) as Unity-ready models
                             into exports/unity/ (FBX for Unity's standard importer, GLB for the glTFast package)
  unpack <file.unitypackage> open a Unity Asset Store package and copy out its 3D models + textures into
                             assets/incoming/unity/<package>/ so `models.py prepare <model> <slot>` can put them in the game

Unity Asset Store licence note: only use a package in Bannerfall if its Asset Store page allows use outside Unity, and
remember the game's files are public on GitHub, so never commit the original package or its raw files (assets/incoming/
is git-ignored). Record every model you put in the game in assets/CREDITS.md.
"""
import base64, json, pathlib, subprocess, sys, tarfile

sys.path.insert(0, str(pathlib.Path(__file__).parent))
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'exports' / 'unity'
INCOMING = ROOT / 'assets' / 'incoming' / 'unity'
BLENDER = str(pathlib.Path.home() / 'Applications/Blender.app/Contents/MacOS/Blender')
KEEP = {'.fbx', '.obj', '.glb', '.gltf', '.bin', '.blend', '.dae', '.png', '.jpg', '.jpeg', '.tga', '.tif', '.tiff', '.psd', '.exr', '.bmp'}

EXPORT_JS = r"""async () => {
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
  const THREE = await import('three');
  const Mo = await import(new URL('src/models.js', location.href).href), { UD, BD } = await import(new URL('src/data.js', location.href).href);
  const plain = obj => { // custom game shaders -> standard PBR materials Unity understands
    obj.traverse(o => { if (!o.isMesh) return; const s = o.material, src = Array.isArray(s) ? s[0] : s;
      const map = src.map || src.uniforms?.map?.value || src.uniforms?.tex?.value || null;
      o.material = new THREE.MeshStandardMaterial({ vertexColors: !!o.geometry.attributes.color, color: src.color ? src.color.clone() : 0xffffff,
        map, roughness: src.roughness ?? .85, metalness: src.metalness ?? 0, transparent: !!src.transparent, alphaTest: src.alphaTest || 0, side: src.side ?? THREE.FrontSide, name: src.name || o.name }); });
    return obj; };
  const ex = new GLTFExporter(), out = {};
  const save = async (name, obj) => { const buf = await ex.parseAsync(plain(obj), { binary: true }); let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode(...b.subarray(i, i + 32768)); out[name] = btoa(s); };
  for (const k of Object.keys(UD)) { try { await save('units/' + k, Mo.figureGroup(0, k, 'franks')); } catch (e) { out['ERR units/' + k] = String(e); } }
  for (const k of Object.keys(BD)) for (const age of [0, 1, 2]) { try { const m = Mo.buildingMesh(k, 0, false, { age }); m.name = k; await save(`buildings/${k}_age${age}`, m); } catch (e) { out[`ERR buildings/${k}`] = String(e); } }
  return out;
}"""

README = """Bannerfall models for Unity
===========================
fbx/   - drag these into your Unity project's Assets folder (works with Unity's built-in importer).
glb/   - the same models as glTF. In Unity: Window > Package Manager > + > "Add package by name" > com.unity.cloud.gltfast,
         then drag the .glb files into Assets. glTF keeps the painted colours exactly.
Colours are painted per vertex. If an FBX looks grey in Unity, use a material/shader that shows vertex colours
(or use the GLB version with glTFast).
Units: each moving part (legL, legR, armL, armR, ...) is its own child object pivoted at the joint, ready to animate.
Scale: 1 unit = 1 metre; a soldier is about 1.8 m tall. Team colour is blue (team 0).
"""


def export():
    import test_game as T
    from playwright.sync_api import sync_playwright
    glb, fbx = OUT / 'glb', OUT / 'fbx'
    for d in (glb, fbx): d.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        page, errors = T.open_game(p, T.serve(), 'play=skirmish,1', viewport={'width': 960, 'height': 540})
        res = page.evaluate(EXPORT_JS); page.context.browser.close()
    for name, data in res.items():
        if name.startswith('ERR'): print('  skipped', name[4:], '-', data[:120]); continue
        f = glb / (name + '.glb'); f.parent.mkdir(parents=True, exist_ok=True); f.write_bytes(base64.b64decode(data))
    print(f'Exported {sum(1 for n in res if not n.startswith("ERR"))} models as GLB.')
    if pathlib.Path(BLENDER).exists():
        r = subprocess.run([BLENDER, '-b', '--factory-startup', '-P', str(ROOT / 'tools/blender/glb_to_fbx.py'), '--', str(glb), str(fbx)], capture_output=True, text=True)
        line = next((l for l in r.stdout.splitlines() if l.startswith('CONVERTED')), None)
        print(line or 'Blender FBX conversion failed:\n' + r.stdout[-1500:] + r.stderr[-1500:])
    else: print('Blender not found: only GLB files were made.')
    (OUT / 'README.txt').write_text(README); print('Done:', OUT)


def unpack(pkg):
    pkg = pathlib.Path(pkg).expanduser()
    if not pkg.exists(): sys.exit(f'File not found: {pkg}')
    dest = INCOMING / pkg.stem.replace(' ', '_'); n = 0; models = []
    with tarfile.open(pkg, 'r:*') as t:
        members = {m.name.lstrip('./'): m for m in t.getmembers() if m.isfile()}
        for name, m in members.items():
            if not name.endswith('/pathname'): continue
            guid = name[:-len('/pathname')]; asset = members.get(guid + '/asset')
            if not asset: continue
            path = t.extractfile(m).read().decode('utf-8', 'replace').splitlines()[0].strip()
            rel = pathlib.PurePosixPath(path)
            if rel.is_absolute() or '..' in rel.parts or rel.suffix.lower() not in KEEP: continue  # never write outside dest
            f = dest.joinpath(*rel.parts); f.parent.mkdir(parents=True, exist_ok=True)
            f.write_bytes(t.extractfile(asset).read()); n += 1
            if rel.suffix.lower() in {'.fbx', '.obj', '.glb', '.gltf'}: models.append(f)
    print(f'Copied {n} files into {dest}')
    for f in models: print('  model:', f.relative_to(ROOT))
    if models: print('\nPut one in the game, e.g.:\n  ~/.local/bannerfall-tools/bin/python tools/models.py prepare "' + str(models[0].relative_to(ROOT)) + '" house')
    else: print('No 3D models found in this package (it may only contain scripts, or models inside .prefab/.asset files, which only Unity can open).')


if __name__ == '__main__':
    if len(sys.argv) >= 2 and sys.argv[1] == 'export': export()
    elif len(sys.argv) == 3 and sys.argv[1] == 'unpack': unpack(sys.argv[2])
    else: print(__doc__); sys.exit(1)
