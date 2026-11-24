"""Slim an animated animal (e.g. from Sketchfab) for Bannerfall, inside Blender (headless).

  Blender -b --factory-startup -P tools/blender/animal.py -- IN.gltf OUT.glb --keep Walk,Run,Death --tex 1024 [--rename Walk=walk,...]

Keeps the skeleton and only the animations listed in --keep (each can be renamed with --rename old=new), shrinks every
texture to at most --tex pixels and writes one compact .glb. The game (src/anim.js) bakes those clips for instancing.
"""
import argparse, sys
import bpy

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('inp'); ap.add_argument('out')
ap.add_argument('--keep', required=True); ap.add_argument('--rename', default=''); ap.add_argument('--tex', type=int, default=1024)
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

# shrink textures
for img in bpy.data.images:
    if img.size[0] > a.tex or img.size[1] > a.tex:
        k = a.tex / max(img.size); img.scale(max(1, int(img.size[0] * k)), max(1, int(img.size[1] * k)))

bpy.ops.export_scene.gltf(filepath=a.out, export_format='GLB', export_animations=True, export_animation_mode='NLA_TRACKS',
                          export_image_format='JPEG', export_jpeg_quality=85, export_apply=False)
tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')
print('ANIMAL', a.out, 'clips:', [x.name for x in bpy.data.actions], 'triangles:', tris)
