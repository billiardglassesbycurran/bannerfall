# Asset credits

All textures here are **CC0 (public domain)** — free for any use, no attribution required. Credited anyway with thanks.
Files were resized/recompressed for phones.

| File | Source |
|---|---|
| aerial_grass_rock, stony_dirt_path, aerial_rocks_02, coast_sand_01, bark_brown_02, castle_wall_slates, clay_plaster, clay_roof_tiles, reed_roof_04 | [Poly Haven](https://polyhaven.com) (diffuse maps, 1K) |
| LeafSet016 (oak leaves), LeafSet019 (fir sprigs) | [ambientCG](https://ambientcg.com) (colour + opacity, 1K) |
| fern_color, fern_alpha (fern fronds, from the Fern 02 model) | [Poly Haven](https://polyhaven.com/a/fern_02) (colour + opacity, 512px) |

## Nature models (assets/nature)

Photo-scanned **CC0** models from [Poly Haven](https://polyhaven.com), reduced to a few hundred triangles each with
`tools/blender/nature.py` (colour + normal maps at 512px):

| File | Source |
|---|---|
| rocks.glb (six mossy rocks) | [Rock Moss Set 01](https://polyhaven.com/a/rock_moss_set_01) |
| stump.glb | [Tree Stump 01](https://polyhaven.com/a/tree_stump_01) |
| log.glb (fallen log) | [Dead Tree Trunk](https://polyhaven.com/a/dead_tree_trunk) |

## Custom 3D models (assets/models)

None yet. Models made with Tripo (tripo.com) go here with the account/plan they were made under.

## Animated characters

- **KayKit Character Animations 1.1** by Kay Lousberg (www.kaylousberg.com), CC0. Skeleton, mannequin body and animation clips
  in `assets/anim/` (slimmed with `tools/kaykit.py`; licence text in `assets/anim/LICENSE-KayKit.txt`).
- **KayKit Adventurers Character Pack 1.0** by Kay Lousberg (www.kaylousberg.com), CC0, from the author's GitHub
  (github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0). Knight, Rogue and Hooded Rogue in
  `assets/anim/char_*.glb` (slimmed and re-proportioned in game; licence text in `assets/anim/LICENSE-KayKit-Adventurers.txt`).
- **Mixamo** (Adobe, mixamo.com): the realistic soldiers and villagers since v0.31 — characters Paladin W/Prop J Nordstrom,
  Erika Archer With Bow/Arrow, Peasant Man, Brute (berserkers, villagers) and Heraklios (light cavalry riders), and motion-captured clips (sword & shield, great sword, longbow, rifle, farming,
  sitting). Converted with `tools/blender/mixamo.py` into `assets/anim/mx_*.glb`. **Not CC0**: Mixamo's terms let them be used
  royalty-free inside a game, but not redistributed as standalone assets — please don't reuse these files outside Bannerfall.
- **God mode creatures:** Mixamo characters Warrok W Kurniawan (Troll), Demon T Wiezzorek (Demon) and Skeletonzombie
  T Avelange (Skeleton) — same Mixamo terms as above (`assets/anim/mx_warrok|mx_demon|mx_skeleton.glb`).
- **Dragon:** "Animated Dragon Three Motion Loops" by **LasquetiSpice** (https://sketchfab.com/LasquetiSpice), from
  https://sketchfab.com/3d-models/animated-dragon-three-motion-loops-eca98cf6cd084c1596cecf716e110c29 — licensed under
  **Creative Commons Attribution 4.0** (http://creativecommons.org/licenses/by/4.0/). Reduced to ~6,500 triangles with
  `tools/blender/mixamo.py creature` → `assets/anim/creature_dragon.glb`.
- **Ultimate Animated Animal Pack** by Quaternius (quaternius.com), CC0. Horse and Deer with their walk/gallop/idle/death
  clips in `assets/anim/animal_*.glb` (slimmed with `tools/kaykit.py --animals`; licence text in `assets/anim/LICENSE-Quaternius.txt`).
