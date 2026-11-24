"""Slim an animated animal (e.g. from Sketchfab) for Bannerfall, inside Blender (headless).

  Blender -b --factory-startup -P tools/blender/animal.py -- IN.gltf OUT.glb --keep Walk,Run,Death --tex 1024 [--rename Walk=walk,...]

Keeps the skeleton and only the animations listed in --keep (each can be renamed with --rename old=new), shrinks every
texture to at most --tex pixels and writes one compact .glb. The game (src/anim.js) bakes those clips for instancing.
The game draws an animal with ONE colour texture, so --atlas packs every material's colour picture into one grid
(each mesh's UVs are moved into its own tile).
"""
import argparse, sys
import bpy

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('inp'); ap.add_argument('out')
ap.add_argument('--keep', required=True); ap.add_argument('--rename', default=''); ap.add_argument('--tex', type=int, default=1024)
ap.add_argument('--atlas', action='store_true')
a = ap.parse_args(argv)
keep = [k.strip() for k in a.keep.split(',') if k.strip()]
rename = dict(p.split('=', 1) for p in a.rename.split(',') if '=' in p)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=a.inp)

# drop every animation we don't use (they are most of the file size)
for act in list(bpy.data.actions):
    base = act.name.split('|')[-1] if '|' in act.name else act.name
    hit = next((k for k in keep if base.split('.')[0] == k), None)  # Blender may add ".001" to duplicate names
    if not hit: bpy.data.actions.remove(act); continue
    act.name = rename.get(hit, hit); act.use_fake_user = True
for o in bpy.data.objects:
    if o.animation_data:
        o.animation_data.action = None
        for t in list(o.animation_data.nla_tracks): o.animation_data.nla_tracks.remove(t)
# push each kept action onto the armature as its own NLA track so the exporter writes them all
arm = next((o for o in bpy.data.objects if o.type == 'ARMATURE'), None)
if arm:
    arm.animation_data_create()
    for act in bpy.data.actions:
        tr = arm.animation_data.nla_tracks.new(); tr.name = act.name; tr.strips.new(act.name, int(act.frame_range[0]), act)

def base_image(mat):
    if not mat or not mat.use_nodes: return None
    bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if not bsdf or not bsdf.inputs['Base Color'].is_linked: return None
    n = bsdf.inputs['Base Color'].links[0].from_node
    return n.image if n.type == 'TEX_IMAGE' else None

if a.atlas:
    import math, numpy as np
    mats = []
    for o in bpy.data.objects:
        if o.type == 'MESH':
            for m in o.data.materials:
                if m and m not in mats: mats.append(m)
    g = max(1, math.ceil(math.sqrt(len(mats)))); T = a.tex // g
    atlas = np.zeros((a.tex, a.tex, 4), dtype=np.float32); atlas[..., 3] = 1
    for k, m in enumerate(mats):
        tx, ty = k % g, k // g; img = base_image(m)
        if img:
            im = img.copy(); im.scale(T, T); px = np.array(im.pixels[:], dtype=np.float32).reshape(T, T, 4); bpy.data.images.remove(im)
        else:
            c = m.diffuse_color; px = np.ones((T, T, 4), dtype=np.float32) * np.array(c[:4], dtype=np.float32)
        atlas[ty * T:(ty + 1) * T, tx * T:(tx + 1) * T] = px
    out = bpy.data.images.new('atlas', a.tex, a.tex); out.pixels[:] = atlas.ravel(); out.file_format = 'JPEG'
    new = bpy.data.materials.new('Atlas'); new.use_nodes = True
    bsdf = next(n for n in new.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'); bsdf.inputs['Roughness'].default_value = .8
    tn = new.node_tree.nodes.new('ShaderNodeTexImage'); tn.image = out; new.node_tree.links.new(tn.outputs['Color'], bsdf.inputs['Base Color'])
    for o in bpy.data.objects:
        if o.type != 'MESH': continue
        me = o.data; uv = me.uv_layers.active
        for poly in me.polygons:
            k = mats.index(me.materials[poly.material_index]) if me.materials and me.materials[poly.material_index] in mats else 0
            tx, ty = k % g, k // g
            for li in poly.loop_indices:
                u, v = uv.data[li].uv; u = min(max(u, 0), 1); v = min(max(v, 0), 1)  # tiles can't repeat: keep inside 0..1
                uv.data[li].uv = ((tx + u * .996 + .002) / g, (ty + v * .996 + .002) / g)
        me.materials.clear(); me.materials.append(new)
    print('ATLAS', len(mats), 'materials ->', g, 'x', g, 'tiles of', T, 'px')

# shrink textures
for img in bpy.data.images:
    if img.size[0] > a.tex or img.size[1] > a.tex:
        k = a.tex / max(img.size); img.scale(max(1, int(img.size[0] * k)), max(1, int(img.size[1] * k)))

bpy.ops.export_scene.gltf(filepath=a.out, export_format='GLB', export_animations=True, export_animation_mode='NLA_TRACKS',
                          export_image_format='JPEG', export_jpeg_quality=85, export_apply=False)
tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')
print('ANIMAL', a.out, 'clips:', [x.name for x in bpy.data.actions], 'triangles:', tris)
