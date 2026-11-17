"""Turn photo-scanned Poly Haven nature models (CC0) into small game pieces for Bannerfall, inside Blender (headless).

  Blender -b --factory-startup -P tools/blender/nature.py -- IN.gltf OUT.glb --faces 300 --tex 512 [--unit] [--length 2.6]

  * every mesh in the file becomes its own piece (a rock set gives one piece per rock), centred on the origin and
    standing on the ground (Blender Z-up; the export turns it Y-up for three.js)
  * --unit scales each piece so its largest side is 1 m (the game sizes them); --length L scales the whole file to L metres long
  * each piece is reduced to about --faces triangles; textures shrink to --tex pixels; only colour + normal maps are kept
"""
import argparse, os, sys
import bpy
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('inp'); ap.add_argument('out')
ap.add_argument('--faces', type=int, default=300); ap.add_argument('--tex', type=int, default=512)
ap.add_argument('--unit', action='store_true'); ap.add_argument('--length', type=float, default=0)
a = ap.parse_args(argv)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=a.inp)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
for o in meshes:
    mw = o.matrix_world.copy(); o.parent = None; o.matrix_world = mw
for o in list(bpy.context.scene.objects):
    if o.type != 'MESH': bpy.data.objects.remove(o, do_unlink=True)
for o in meshes:
    o.data.transform(o.matrix_world); o.matrix_world = Matrix.Identity(4)

def box(objs):
    lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
    for o in objs:
        for v in o.data.vertices: lo = Vector(map(min, lo, v.co)); hi = Vector(map(max, hi, v.co))
    return lo, hi

if a.length:
    lo, hi = box(meshes); k = a.length / max(hi.x - lo.x, hi.y - lo.y)
    for o in meshes: o.data.transform(Matrix.Diagonal((k, k, k, 1)))
total0 = total1 = 0
for o in meshes:
    lo, hi = box([o]); size = hi - lo
    k = 1 / max(size) if a.unit else 1
    o.data.transform(Matrix.Diagonal((k, k, k, 1)) @ Matrix.Translation(-Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))))
    tris = sum(len(p.vertices) - 2 for p in o.data.polygons); total0 += tris
    if tris > a.faces:
        bpy.context.view_layer.objects.active = o
        mod = o.modifiers.new('decimate', 'DECIMATE'); mod.ratio = a.faces / tris; mod.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=mod.name)
    total1 += sum(len(p.vertices) - 2 for p in o.data.polygons)

# keep colour + normal maps only (roughness/metal maps were not downloaded); a fixed, fairly rough surface
for m in bpy.data.materials:
    if not m.use_nodes: continue
    nt = m.node_tree; bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    for n in list(nt.nodes):
        if n.type == 'TEX_IMAGE' and (n.image is None or not (n.image.packed_file or os.path.exists(bpy.path.abspath(n.image.filepath)))): nt.nodes.remove(n)
    for n in list(nt.nodes):
        if n.type == 'SEPARATE_COLOR': nt.nodes.remove(n)
    if bsdf:
        bsdf.inputs['Roughness'].default_value = .92; bsdf.inputs['Metallic'].default_value = 0
for img in bpy.data.images:
    if img.users and max(img.size) > a.tex:
        s = a.tex / max(img.size); img.scale(max(1, int(img.size[0] * s)), max(1, int(img.size[1] * s)))

os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=a.out, export_format='GLB', export_image_format='JPEG', export_jpeg_quality=80,
                          export_apply=True, export_yup=True, export_animations=False, export_skins=False)
print(f'NATURE {a.out}: {len(meshes)} piece(s), {total0} -> {total1} triangles, {os.path.getsize(a.out) // 1024} KB')
