# Blender (headless): convert every .glb under <in_dir> into an .fbx under <out_dir>, keeping sub-folders.
# Run by tools/unity.py:  Blender -b --factory-startup -P glb_to_fbx.py -- <in_dir> <out_dir>
import bpy, pathlib, sys

src, dst = (pathlib.Path(a) for a in sys.argv[sys.argv.index('--') + 1:][:2])
n = 0
for f in sorted(src.rglob('*.glb')):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(f))
    out = dst / f.relative_to(src).with_suffix('.fbx'); out.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.fbx(filepath=str(out), use_selection=False, apply_unit_scale=True, apply_scale_options='FBX_SCALE_UNITS',
                             colors_type='SRGB', path_mode='COPY', embed_textures=True, add_leaf_bones=False)
    n += 1
print(f'CONVERTED {n} models to FBX in {dst}')
