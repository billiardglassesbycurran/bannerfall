"""Prepare a 3D model (e.g. from tripo.com) for Bannerfall, inside Blender (runs headless, no window).

  Blender -b --factory-startup -P tools/blender/prepare_model.py -- IN OUT --height 6 --faces 8000 --tex 1024 --yaw 0

What it does:
  * imports .glb / .gltf / .fbx / .obj
  * applies all transforms, rotates by --yaw degrees, stands the model on the ground (origin at bottom centre)
  * scales it so it is --height metres tall (or --length metres long with --length, for ships)
  * reduces polygons to about --faces triangles (keeps phones fast)
  * shrinks every texture to at most --tex pixels and exports a compact .glb with JPEG textures
"""
import argparse, math, os, sys
import bpy, bmesh
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('inp'); ap.add_argument('out')
ap.add_argument('--height', type=float, default=0); ap.add_argument('--length', type=float, default=0)
ap.add_argument('--faces', type=int, default=8000); ap.add_argument('--tex', type=int, default=1024); ap.add_argument('--yaw', type=float, default=0)
a = ap.parse_args(argv)

bpy.ops.wm.read_factory_settings(use_empty=True)
ext = os.path.splitext(a.inp)[1].lower()
if ext in ('.glb', '.gltf'): bpy.ops.import_scene.gltf(filepath=a.inp)
elif ext == '.fbx': bpy.ops.import_scene.fbx(filepath=a.inp)
elif ext == '.obj': bpy.ops.wm.obj_import(filepath=a.inp)
else: sys.exit(f'Unsupported file type: {ext}')

meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
if not meshes: sys.exit('No meshes found in the file')
# drop armatures/animation (static models only for now) and bake every mesh's world transform into its vertices
for o in list(bpy.context.scene.objects):
    if o.type == 'MESH':
        for m in list(o.modifiers):
            if m.type == 'ARMATURE': o.modifiers.remove(m)
for o in meshes:
    mw = o.matrix_world.copy(); o.parent = None; o.matrix_world = mw
for o in list(bpy.context.scene.objects):
    if o.type != 'MESH': bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.object.select_all(action='SELECT'); bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

def bounds():
    lo = Vector((1e9, 1e9, 1e9)); hi = Vector((-1e9, -1e9, -1e9))
    for o in meshes:
        for v in o.data.vertices:
            p = o.matrix_world @ v.co; lo = Vector(map(min, lo, p)); hi = Vector(map(max, hi, p))
    return lo, hi

# yaw, then scale to size, then stand on the ground at the origin (Blender is Z-up; export converts to Y-up)
R = Matrix.Rotation(math.radians(a.yaw), 4, 'Z')
for o in meshes: o.data.transform(R)
lo, hi = bounds(); size = hi - lo
k = 1.0
if a.height > 0: k = a.height / max(size.z, 1e-6)
elif a.length > 0: k = a.length / max(size.y, 1e-6)  # glTF forward (+Z in three.js) is Blender -Y
centre = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
M = Matrix.Diagonal((k, k, k, 1)) @ Matrix.Translation(-centre)
for o in meshes: o.data.transform(M)

# reduce polygons
tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes)
if tris > a.faces:
    ratio = a.faces / tris
    for o in meshes:
        bpy.context.view_layer.objects.active = o
        mod = o.modifiers.new('decimate', 'DECIMATE'); mod.ratio = ratio; mod.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=mod.name)
after = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes)

# shrink textures
for img in bpy.data.images:
    if img.size[0] > a.tex or img.size[1] > a.tex:
        s = a.tex / max(img.size[0], img.size[1]); img.scale(max(1, int(img.size[0] * s)), max(1, int(img.size[1] * s)))

os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=a.out, export_format='GLB', export_image_format='JPEG', export_jpeg_quality=82,
                          export_apply=True, export_yup=True, export_animations=False, export_skins=False)
lo, hi = bounds()
print(f'PREPARED {a.out}: {tris} -> {after} triangles, size {hi.x - lo.x:.2f} x {hi.y - lo.y:.2f} x {hi.z - lo.z:.2f} m, {os.path.getsize(a.out) // 1024} KB')
