"""Turn Mixamo characters and animations (FBX downloads, kept in assets/incoming/mixamo, never published raw) into small
game files for Bannerfall, inside Blender (headless).

  Character (mesh + skeleton, no animation):
    Blender -b --factory-startup -P tools/blender/mixamo.py -- char IN.fbx OUT.glb --faces 3500 --tex 1024
  Animation clips (one skeleton, many named clips), name=file pairs:
    Blender -b --factory-startup -P tools/blender/mixamo.py -- clips OUT.glb idle=a.fbx walk=b.fbx ...

What it does
  * drops finger, eye and end bones (their skin weights go to the hand/head), so the game has ~25 bones to animate
  * reduces each mesh to its share of --faces triangles
  * pieces that ride one prop bone (sword, shield, bow, arrow) are named after it, so the game can show or hide them
  * one texture per character: if the character has several materials they are baked into one atlas (colour + bumps)
  * textures shrink to --tex pixels (JPEG); clips are sampled at 30 frames a second
"""
import os, sys, re
import bpy

argv = sys.argv[sys.argv.index('--') + 1:]
MODE = argv[0]
DROP = re.compile(r'Hand(Thumb|Index|Middle|Ring|Pinky)|HeadTop_End|Eye$|Toe_End')


def fresh():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30


def arm_of(objs):
    return next(o for o in objs if o.type == 'ARMATURE')


def keep_parent(arm, name):
    b = arm.data.bones[name]
    while b and DROP.search(b.name): b = b.parent
    return b.name if b else None


def prune_bones(arm, meshes):
    gone = [b.name for b in arm.data.bones if DROP.search(b.name)]
    for o in meshes:  # move the dropped bones' weights to the nearest kept bone above them
        for name in gone:
            vg = o.vertex_groups.get(name)
            if not vg: continue
            tgt_name = keep_parent(arm, name); tgt = o.vertex_groups.get(tgt_name) or o.vertex_groups.new(name=tgt_name)
            for v in o.data.vertices:
                for g in v.groups:
                    if g.group == vg.index and g.weight > 0: tgt.add([v.index], g.weight, 'ADD')
            o.vertex_groups.remove(vg)
    bpy.context.view_layer.objects.active = arm; bpy.ops.object.mode_set(mode='EDIT')
    for name in gone:
        eb = arm.data.edit_bones.get(name)
        if eb: arm.data.edit_bones.remove(eb)
    bpy.ops.object.mode_set(mode='OBJECT')
    return len(gone)


def images_of(mat):
    return [n for n in mat.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image] if mat and mat.use_nodes else []


def char(inp, out, faces, tex):
    fresh(); bpy.ops.import_scene.fbx(filepath=inp)
    objs = list(bpy.context.scene.objects); arm = arm_of(objs)
    for a in list(bpy.data.actions): bpy.data.actions.remove(a)
    if arm.animation_data: arm.animation_data_clear()
    for pb in arm.pose.bones: pb.location = (0, 0, 0); pb.rotation_quaternion = (1, 0, 0, 0); pb.rotation_euler = (0, 0, 0); pb.scale = (1, 1, 1)
    meshes = [o for o in objs if o.type == 'MESH']
    # drop eyes / eyelashes (tiny, often see-through): meshes weighted only to the head whose material uses transparency
    for o in list(meshes):
        alpha = any(l.to_socket.name == 'Alpha' for m in o.data.materials if m and m.use_nodes for l in m.node_tree.links)
        if alpha: meshes.remove(o); bpy.data.objects.remove(o)
    dropped = prune_bones(arm, meshes)
    # name the props after the single bone they ride (Sword_joint -> Sword, Left_arch1/2 -> Bow, arrow -> Arrow)
    total = 0
    for o in meshes:
        used = set()
        for v in o.data.vertices:
            for g in v.groups:
                if g.weight > .01: used.add(o.vertex_groups[g.group].name.replace('mixamorig:', ''))
        o['bones'] = sorted(used); total += sum(len(p.vertices) - 2 for p in o.data.polygons)
    body = max(meshes, key=lambda o: len(o['bones']))
    for o in meshes:
        b = list(o['bones'])
        if o is body: o.name = 'Body'
        elif any('Sword' in x for x in b): o.name = 'Sword'
        elif any('Shield' in x for x in b): o.name = 'Shield'
        elif any('arch' in x for x in b): o.name = 'Bow'
        elif any(x.lower() == 'arrow' for x in b): o.name = 'Arrow'
        elif b == ['Head'] or set(b) <= {'Head', 'Neck'}: o.name = 'Helmet'
        else: o.name = 'Extra'
    # fewer triangles (each piece gets its share; small pieces keep at least 120)
    after = 0
    for o in meshes:
        tris = sum(len(p.vertices) - 2 for p in o.data.polygons); want = max(120, faces * tris / total)
        if tris > want:
            bpy.context.view_layer.objects.active = o
            mod = o.modifiers.new('decimate', 'DECIMATE'); mod.ratio = want / tris; mod.use_collapse_triangulate = True
            # keep the armature modifier last, decimate first
            while o.modifiers.find('decimate') > 0: bpy.ops.object.modifier_move_up(modifier='decimate')
            bpy.ops.object.modifier_apply(modifier='decimate')
        after += sum(len(p.vertices) - 2 for p in o.data.polygons)
    mats = {m for o in meshes for m in o.data.materials if m}
    if len(mats) > 1: atlas(meshes, tex)
    else:
        for m in mats:
            for n in images_of(m):
                im = n.image
                if max(im.size) > tex: im.scale(tex, tex * im.size[1] // im.size[0])
    for m in {m for o in meshes for m in o.data.materials if m}:
        bsdf = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if bsdf:
            for k in ('Specular IOR Level', 'Roughness', 'Metallic'):
                for l in list(bsdf.inputs[k].links) if k in bsdf.inputs else []: m.node_tree.links.remove(l)
            bsdf.inputs['Roughness'].default_value = .6; bsdf.inputs['Metallic'].default_value = 0
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes + [arm]: o.select_set(True)
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_image_format='JPEG', export_jpeg_quality=82,
                              export_animations=False, export_skins=True, export_yup=True, export_apply=False)
    print(f'MIXAMO char {out}: pieces {[o.name for o in meshes]}, {total} -> {after} triangles, dropped {dropped} bones, '
          f'{len(arm.data.bones)} left, {os.path.getsize(out) // 1024} KB')


def atlas(meshes, tex):
    """Bake every material's colour and bumps into one shared texture on a fresh UV layout."""
    scn = bpy.context.scene; scn.render.engine = 'CYCLES'; scn.cycles.samples = 1; scn.cycles.device = 'CPU'
    col = bpy.data.images.new('atlas_col', tex, tex); nrm = bpy.data.images.new('atlas_nrm', tex, tex); nrm.colorspace_settings.name = 'Non-Color'
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        uv0 = o.data.uv_layers[0]; uv0.active_render = True
        new = o.data.uv_layers.new(name='atlas'); o.data.uv_layers.active = new; o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=.004); bpy.ops.object.mode_set(mode='OBJECT')
    for m in {m for o in meshes for m in o.data.materials if m}:
        n = m.node_tree.nodes.new('ShaderNodeTexImage'); n.name = 'bake_target'
        for nn in m.node_tree.nodes: nn.select = False
        n.select = True; m.node_tree.nodes.active = n
    def target(img):
        for m in {m for o in meshes for m in o.data.materials if m}: m.node_tree.nodes['bake_target'].image = img
    target(col); bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, margin=4, use_clear=True)
    target(nrm); bpy.ops.object.bake(type='NORMAL', margin=4, use_clear=True)
    # one plain material using the atlas
    mat = bpy.data.materials.new('Atlas'); mat.use_nodes = True; nt = mat.node_tree; bsdf = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexImage'); tc.image = col; nt.links.new(tc.outputs['Color'], bsdf.inputs['Base Color'])
    tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = nrm; nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(tn.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    for o in meshes:
        o.data.materials.clear(); o.data.materials.append(mat)
        o.data.uv_layers.remove(o.data.uv_layers[0]); o.data.uv_layers['atlas'].name = 'map1'
    col.pack(); nrm.pack()


def clips(out, pairs):
    fresh(); base = None
    for name, path in pairs:
        before = set(bpy.data.objects); acts_before = set(bpy.data.actions)
        bpy.ops.import_scene.fbx(filepath=path)
        new = [o for o in bpy.data.objects if o not in before]; arm = arm_of(new)
        act = next(iter(set(bpy.data.actions) - acts_before)); act.name = name; act.use_fake_user = True
        if base is None:
            base = arm; base.name = 'Armature'
            for o in new:
                if o is not base: bpy.data.objects.remove(o)
        else:
            for o in new: bpy.data.objects.remove(o)
        print(f'  clip {name}: {int(act.frame_range[1] - act.frame_range[0]) + 1} frames')
    prune_bones(base, [])
    for a in bpy.data.actions:  # drop the channels of bones that were removed
        for fc in list(a.fcurves):
            m = re.match(r'pose\.bones\["([^"]+)"\]', fc.data_path)
            if m and m.group(1) not in base.data.bones: a.fcurves.remove(fc)
    base.animation_data_create(); base.animation_data.action = bpy.data.actions[pairs[0][0]]
    bpy.ops.object.select_all(action='DESELECT'); base.select_set(True)
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_animations=True, export_animation_mode='ACTIONS',
                              export_force_sampling=True, export_optimize_animation_size=True, export_skins=True, export_yup=True)
    print(f'MIXAMO clips {out}: {len(pairs)} clips, {os.path.getsize(out) // 1024} KB')


if MODE == 'char':
    import argparse
    ap = argparse.ArgumentParser(); ap.add_argument('inp'); ap.add_argument('out'); ap.add_argument('--faces', type=int, default=3500); ap.add_argument('--tex', type=int, default=1024)
    a = ap.parse_args(argv[1:]); char(a.inp, a.out, a.faces, a.tex)
elif MODE == 'clips':
    clips(argv[1], [tuple(p.split('=', 1)) for p in argv[2:]])
else:
    sys.exit(__doc__)
