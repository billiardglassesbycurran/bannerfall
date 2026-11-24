# Asset credits

All textures here are **CC0 (public domain)** — free for any use, no attribution required. Credited anyway with thanks.
Files were resized/recompressed for phones.

| File | Source |
|---|---|
| aerial_grass_rock, stony_dirt_path, aerial_rocks_02, coast_sand_01, bark_brown_02, castle_wall_slates, clay_plaster, clay_roof_tiles, reed_roof_04 | [Poly Haven](https://polyhaven.com) (diffuse maps, 1K) |
| LeafSet016 (oak leaves), LeafSet019 (fir sprigs) | [ambientCG](https://ambientcg.com) (colour + opacity, 1K) |
| fern_color, fern_alpha (fern fronds, from the Fern 02 model) | [Poly Haven](https://polyhaven.com/a/fern_02) (colour + opacity, 512px) |

## Voices (assets/voices)

Unit voice lines were generated offline with **Piper** (open-source text-to-speech, MIT licence, github.com/rhasspy/piper) using
the **LibriTTS-R** voice model (en_US-libritts_r-medium; its dataset, openslr.org/141, is **CC BY 4.0** — speakers from
public-domain LibriVox audiobooks). Made with `tools/voices.py`. Dragon roars and the Battle Car engine are synthesised from
scratch in the same script.

## Nature models (assets/nature)

Photo-scanned **CC0** models from [Poly Haven](https://polyhaven.com), reduced to a few hundred triangles each with
`tools/blender/nature.py` (colour + normal maps at 512px):

| File | Source |
|---|---|
| rocks.glb (six mossy rocks) | [Rock Moss Set 01](https://polyhaven.com/a/rock_moss_set_01) |
| stump.glb | [Tree Stump 01](https://polyhaven.com/a/tree_stump_01) |
| log.glb (fallen log) | [Dead Tree Trunk](https://polyhaven.com/a/dead_tree_trunk) |

## Custom 3D models (assets/models)

| File | Source | Licence |
|---|---|---|
| warship.glb (Viking longship, used for every side's warship) | ["Viking longship"](https://sketchfab.com/3d-models/viking-longship-3d649f8373514860b69ff6f874c0efb5) by massive-graphisme (Sketchfab), slimmed to ~7k triangles | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| hall.glb (Town Hall) | ["Medieval house \| Generic Textures \| Game ready"](https://sketchfab.com/3d-models/medieval-house-generic-textures-game-ready-3eb9e3b600264e2f99100fc43619497e) by by__Rx (Sketchfab) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| house.glb (House) | ["Medieval house"](https://sketchfab.com/3d-models/medieval-house-a8ad9d2723444b1b8ac054c232e61f12) by DoniTodorov (Sketchfab), slimmed to ~4.6k triangles | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| store.glb (Storehouse) | ["Medieval Tavern (2k vertices) - free game asset"](https://sketchfab.com/3d-models/medieval-tavern-2k-vertices-free-game-asset-a06dfdc919334bfc95de720ad98f4295) by Andy Woodhead (Sketchfab) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| barracks.glb (Barracks) | ["Romano-British House in Medieval London - free"](https://sketchfab.com/3d-models/romano-british-house-in-medieval-london-free-a13b6ace269945a78918518d69378eef) by Andy Woodhead (Sketchfab), slimmed to ~8k triangles | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| stable.glb (Stable) | ["Old wooden barn"](https://sketchfab.com/3d-models/old-wooden-barn-4887c7e3de244a9db3eb5b4974418b1b) by Elizabeth Watts (Sketchfab), slimmed to ~7k triangles | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| temple.glb (Temple) | ["Medieval house"](https://sketchfab.com/3d-models/medieval-house-904038d693b945d4843decee87fb0eb5) by Vanuartw (Sketchfab), slimmed to ~8k triangles | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| fishboat.glb (Fishing Boat) | ["Rowing Boat"](https://sketchfab.com/3d-models/rowing-boat-4eedc7ec7bac481f957474ecd89f5ba2) by carlcapu9 (Sketchfab) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| transport.glb (Transport Ship) | ["Gislinge Viking Boat"](https://sketchfab.com/3d-models/gislinge-viking-boat-01098ad7973647a9b558f41d2ebc5193) by Opus Poly (Sketchfab) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| fireship.glb (Fire Ship) | ["Dromon medieval ship"](https://sketchfab.com/3d-models/dromon-medieval-ship-740f6d7c5e92476f98d5507ab8422b4c) by Mitro123 (Sketchfab) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| galleon.glb (Cannon Galleon) | ["Empty Ship"](https://sketchfab.com/3d-models/empty-ship-f254f07be1324a138da32833b32486d8) by Liaval (Sketchfab), slimmed to ~10k triangles | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| cog.glb (War Cog) | ["Caravel Ship"](https://sketchfab.com/3d-models/caravel-ship-c9819a0e8a57429f888b74978219fb7a) by Ginny Sutton (Sketchfab), slimmed to ~12k triangles | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |

Models made with Tripo (tripo.com) go here too, with the account/plan they were made under.

## Animated characters

- **KayKit Character Animations 1.1** by Kay Lousberg (www.kaylousberg.com), CC0. Skeleton, mannequin body and animation clips
  in `assets/anim/` (slimmed with `tools/kaykit.py`; licence text in `assets/anim/LICENSE-KayKit.txt`).
- **KayKit Adventurers Character Pack 1.0** by Kay Lousberg (www.kaylousberg.com), CC0, from the author's GitHub
  (github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0). Knight, Rogue and Hooded Rogue in
  `assets/anim/char_*.glb` (slimmed and re-proportioned in game; licence text in `assets/anim/LICENSE-KayKit-Adventurers.txt`).
- **Mixamo** (Adobe, mixamo.com): the realistic soldiers and villagers since v0.31 — characters Paladin W/Prop J Nordstrom,
  Erika Archer With Bow/Arrow, Peasant Man, Brute (berserkers, villagers), Heraklios (light cavalry riders) and Castle Guard 01/02 (Royal Guard, Halberdier), and motion-captured clips (sword & shield, great sword, longbow, rifle, farming,
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

## Animated animals (assets/anim)

| File | Source | Licence |
|---|---|---|
| animal_elk.glb (the wild deer/elk herds) | ["Realistic Animated Elk 3D Model"](https://sketchfab.com/3d-models/realistic-animated-elk-3d-model-787834f9caa2474d9f1814b807c072d7) by WildMesh 3D (Sketchfab), 5 of its 53 clips kept | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| animal_bear.glb (bears in the wilds) | ["Realistic Animated Bear 3D Model"](https://sketchfab.com/3d-models/realistic-animated-bear-3d-model-bffc3c87d2d148ff8533e1cc8a11c9f1) by WildMesh 3D (Sketchfab), 5 of its 81 clips kept, textures packed into one | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| animal_eagle.glb (eagles circling overhead) | ["White Eagle Animation Fast Fly"](https://sketchfab.com/3d-models/white-eagle-animation-fast-fly-30203bf39e5145f19c79e83c550139d3) by GremorySaiyan (Sketchfab) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
