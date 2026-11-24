// Animated soldiers: real skeleton animation (walk, run, attack, work, death...) for whole armies at once.
//
// How it works: CC0 KayKit characters (assets/anim/, see tools/kaykit.py) are loaded once and every frame of every
// clip is "baked" into one texture per character (a row of bone positions per frame). Each unit type is then a single
// instanced mesh, and the graphics card poses every soldier itself by reading that soldier's current row.
// So 200 animated swordsmen still cost one draw call.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const FPS = 30;
export const ANIM_DEFAULT = true; // used when the player has never touched the Settings switch
// Character files (they all share one skeleton, so the knight's clips play on every one of them).
// team: which colours of the character's palette are repainted in the team colour: [hue from, hue to, min saturation, max lightness, shade]
const MODELS = {
  knight: { file: 'char_knight.glb', team: [[.83, 1.03, .35, 1, 1], [.022, .075, .3, .62, .8]] },   // red cape/plume/badge; copper belt and straps
  rogue: { file: 'char_rogue.glb', team: [[.3, .53, .3, 1, 1]] },                                    // green tunic
  hooded: { file: 'char_hooded.glb', team: [[.3, .53, .3, 1, 1]] },                                  // green hood, cape and tunic
  // realistic characters from Mixamo (Adobe; free for use inside games): realistic proportions, motion-captured clips (mx_clips.glb)
  paladin: { file: 'mx_paladin.glb', mixamo: 1, bright: 2.1, team: [[.62, .9, .12, .5, 1], [.05, .15, .35, .9, 1]] }, // purple tabard and sash; gilt trim
  mxarcher: { file: 'mx_archer.glb', mixamo: 1, bright: 1.6, team: [[0, 1, 0, .2, .9, .2]] },                 // dark leather, dyed
  mxpeasant: { file: 'mx_peasant.glb', mixamo: 1, team: [[.03, .1, .35, .62, .85]] },              // striped trousers
  // God mode only: loaded when a God-mode game starts (lazy), so ordinary players never download them
  warrok: { file: 'mx_warrok.glb', mixamo: 1, lazy: 1, team: [] },        // troll
  demon: { file: 'mx_demon.glb', mixamo: 1, lazy: 1, team: [] },          // demon
  skeleton: { file: 'mx_skeleton.glb', mixamo: 1, lazy: 1, team: [] },    // skeleton warriors
  dragon: { file: 'creature_dragon.glb', animal: 1, lazy: 1, height: 4.0 }, // "Animated Dragon Three Motion Loops" by LasquetiSpice (CC-BY)
  brute: { file: 'mx_brute.glb', mixamo: 1, team: [[0, 1, 0, .2, .9, .17]] },                         // bare-chested, tattooed; trousers dyed
  heraklios: { file: 'mx_heraklios.glb', mixamo: 1, bright: 1.3, team: [] },                         // fur-and-iron steppe warrior
  // animals (CC0, Quaternius): their own skeleton and clips, flat colours instead of a texture
  horse: { file: 'animal_horse.glb', animal: true, height: 2.3 },
  deer: { file: 'animal_elk.glb', animal: true, height: 2.1 }, // realistic elk (WildMesh 3D, Sketchfab, CC BY) with its own texture and clips
};
const CLIP_FILES = ['char_knight.glb', 'rig_tools.glb', 'rig_ranged.glb']; // where the KayKit characters' clips come from
const MX_CLIPS = 'mx_clips.glb'; // every Mixamo character shares one skeleton, so they share these clips
// Unit types that use animated models: which character, which of its attachments show, extra gear, and which clip plays for what.
// atk = how the attack clip is played: start `from` seconds in (the blow lands the moment the game strikes), at `rate`, for `len` seconds.
const WALK = { idle: 'Idle', walk: 'Walking_A', run: 'Running_A', death: 'Death_A' };
const KINDS = {
  sword: { model: 'knight', show: ['1H_Sword', 'Badge_Shield', 'Knight_Helmet', 'Knight_Cape'], clips: { ...WALK, attack: '1H_Melee_Attack_Slice_Diagonal' } },
  spear: { model: 'knight', show: ['Round_Shield', 'Knight_Helmet'], gear: ['spear'], clips: { ...WALK, attack: '1H_Melee_Attack_Stab' }, atk: { from: .5, rate: 1.5, len: .6 } },
  hero: { model: 'knight', look: 'gold', show: ['2H_Sword', 'Knight_Helmet', 'Knight_Cape'], clips: { ...WALK, idle: '2H_Melee_Idle', attack: '2H_Melee_Attack_Slice' }, atk: { from: .3, rate: 1.3, len: .6 } },
  archer: { model: 'hooded', show: ['Rogue_Cape'], gear: ['bow', 'quiver'], ranged: 'bow', clips: { ...WALK, attack: '1H_Melee_Attack_Chop', aim: 'Ranged_Bow_Draw', shoot: 'Ranged_Bow_Release' } },
  crossbow: { model: 'hooded', show: ['2H_Crossbow'], ranged: 'xbow', clips: { ...WALK, attack: '1H_Melee_Attack_Chop', aim: '2H_Ranged_Aiming', shoot: '2H_Ranged_Shoot' } },
  peasant: { model: 'rogue', show: [], gear: ['axe'], clips: { ...WALK, attack: '1H_Melee_Attack_Chop', work: 'Chopping' }, atk: { from: .3, rate: 1.2, len: .6 } },
};
// Realistic Mixamo soldiers (replace the KayKit ones above). parts = which pieces of the character show.
const SS = { idle: 'ss_idle', walk: 'ss_walk', run: 'ss_run', death: 'ss_death' }, GS = { idle: 'gs_idle', walk: 'gs_walk', run: 'gs_run', death: 'gs_death' };
const BOW = { idle: 'bow_idle', walk: 'bow_walk', run: 'bow_run', death: 'ss_death' }, XB = { idle: 'xb_idle', walk: 'xb_walk', run: 'bow_run', death: 'ss_death', attack: 'ss_atk4', aim: 'xb_fire', shoot: 'xb_fire' };
Object.assign(KINDS, {
  sword: { model: 'paladin', parts: ['Body', 'Helmet', 'Sword', 'Shield'], show: [], clips: { ...SS, attack: 'ss_atk2' }, atk: { from: .35, rate: 1.3, len: .7 } },
  spear: { model: 'paladin', parts: ['Body', 'Helmet', 'Shield'], show: [], gear: ['spear'], clips: { ...SS, attack: 'ss_atk4' }, atk: { from: .3, rate: 1.4, len: .6 } },
  legion: { model: 'paladin', look: 'bronze', parts: ['Body', 'Helmet', 'Sword', 'Shield'], show: [], clips: { ...SS, attack: 'ss_atk3' }, atk: { from: .45, rate: 1.4, len: .7 } },
  hero: { model: 'paladin', look: 'gold', parts: ['Body', 'Helmet', 'Sword'], show: [], clips: { ...GS, attack: 'gs_slash' }, atk: { from: .3, rate: 1.25, len: .7 }, size: 1.04 },
  berserker: { model: 'brute', show: [], clips: { ...GS, attack: 'gs_attack' }, atk: { from: .3, rate: 1.4, len: .6 } },
  archer: { model: 'mxarcher', parts: ['Body', 'Helmet', 'Extra', 'Bow'], show: [], ranged: 'bow', clips: { ...BOW, attack: 'ss_atk4', aim: 'bow_draw', shoot: 'bow_draw' } },
  crossbow: { model: 'mxarcher', parts: ['Body', 'Helmet', 'Extra'], show: [], gear: ['xbow'], ranged: 'xbow', clips: XB },
  repeater: { model: 'mxarcher', look: 'lacquer', parts: ['Body', 'Helmet', 'Extra'], show: [], gear: ['xbow'], ranged: 'xbow', clips: XB },
  peasant: { model: 'brute', hide: ['Weapon'], show: [], gear: ['axe'], clips: { idle: 'xb_idle', walk: 'xb_walk', run: 'bow_run', death: 'ss_death', attack: 'gs_attack', work: 'gs_attack' }, atk: { from: .3, rate: 1.3, len: .6 } },
});
// God mode monsters
Object.assign(KINDS, {
  troll: { model: 'warrok', show: [], gear: ['bigaxe'], clips: { ...GS, attack: 'gs_slash' }, atk: { from: .3, rate: 1.1, len: .8 } },
  demon: { model: 'demon', show: [], clips: { ...GS, attack: 'gs_attack' }, atk: { from: .3, rate: 1.2, len: .7 } },
  skeleton: { model: 'skeleton', show: [], gear: ['axe'], clips: { ...SS, attack: 'ss_atk2' }, atk: { from: .35, rate: 1.3, len: .7 } },
  dragon: { model: 'dragon', show: [], clips: { idle: 'Flying', walk: 'Flying', run: 'Flying', death: 'Flying' }, noAttack: 1, pace: { walk: 2.6, run: 99, runAt: 99 } },
});
// animals: pace = ground speed each clip was made for, runAt = speed where walking turns into a gallop
const BEAST = { idle: 'Idle', walk: 'Walk', run: 'Gallop', death: 'Death' };
const HORSE = { model: 'horse', show: [], clips: BEAST, noAttack: 1, pace: { walk: 1.9, run: 6.2, runAt: 3.2 }, cloth: 1 };
Object.assign(KINDS, {
  deer: { model: 'deer', show: [], clips: { idle: 'Eat', walk: 'Walk', run: 'Run', death: 'Death' }, noAttack: 1, pace: { walk: 1.3, run: 5.5, runAt: 2 } }, // grazes when standing
  h_bay: { ...HORSE },
  h_light: { ...HORSE, coat: { Main: 0x7a4a26, Main_Dark: 0x4a2a14, Main_Light: 0xa8743e, Hair: 0x2a1a10 } },
  h_dark: { ...HORSE, coat: { Main: 0x2a1c14, Main_Dark: 0x17100c, Main_Light: 0x3c2a1e, Hair: 0x0c0a08 } },
  h_white: { ...HORSE, coat: { Main: 0xd9d4c8, Main_Dark: 0xa8a294, Main_Light: 0xf2efe6, Hair: 0xe8e2d2, Muzzle: 0x8a7f74 } },
});
// riders: seated lower body, with the fighting clips played on the upper body only ("seat+clip")
const SIT = 'sit', RIDE = { idle: SIT, walk: SIT, run: SIT, death: 'ss_death' };
Object.assign(KINDS, {
  r_knight: { model: 'paladin', parts: ['Body', 'Helmet', 'Sword', 'Shield'], show: [], clips: { ...RIDE, attack: SIT + '+ss_atk2' }, atk: { from: .35, rate: 1.3, len: .7 } },
  r_hero: { model: 'paladin', look: 'gold', parts: ['Body', 'Helmet', 'Sword', 'Shield'], show: [], clips: { ...RIDE, attack: SIT + '+ss_atk2' }, atk: { from: .35, rate: 1.3, len: .7 } },
  r_light: { model: 'heraklios', show: [], gear: ['spear'], clips: { ...RIDE, attack: SIT + '+ss_atk4' }, atk: { from: .3, rate: 1.4, len: .6 } },
  r_archer: { model: 'mxarcher', parts: ['Body', 'Helmet', 'Extra', 'Bow'], show: [], ranged: 'bow', clips: { ...RIDE, attack: SIT + '+ss_atk4', aim: SIT + '+bow_draw', shoot: SIT + '+bow_draw' } },
});
// mounted unit types: [horse, rider]
const MOUNTS = { knight: ['h_bay', 'r_knight'], crusader: ['h_white', 'r_knight'], lightcav: ['h_light', 'r_light'], horsearcher: ['h_dark', 'r_archer'], khanguard: ['h_dark', 'r_archer'], herohorse: ['h_white', 'r_hero'] };
export const ANIM = { on: false, ready: false, kinds: KINDS, mounts: MOUNTS, rigs: {}, pbr: true };

/** Are animated soldiers switched on? (Settings, or ?anim=1 / ?anim=0 in the address) */
export function animWanted() {
  if (/[?&#]anim=1/.test(location.href)) return true; if (/[?&#]anim=0/.test(location.href)) return false;
  try { const v = JSON.parse(localStorage.getItem('bf.settings') || '{}').animOn; return v === undefined ? ANIM_DEFAULT : !!v; } catch { return ANIM_DEFAULT; }
}

const LAZY = {};
/** Load and bake the God-mode creatures (dragon, troll, demon, skeleton) the first time a God-mode game starts. */
export function loadLazy() {
  if (!ANIM.on || !LAZY.get) return Promise.resolve(false);
  return LAZY.p || (LAZY.p = (async () => {
    const ids = Object.keys(MODELS).filter(id => MODELS[id].lazy);
    const models = await Promise.all(ids.map(id => LAZY.get(MODELS[id].file).catch(e => { console.warn('God-mode model missing', id, e); return null; })));
    ids.forEach((id, i) => {
      if (!models[i]) return; const M = MODELS[id], names = [...new Set(Object.values(KINDS).filter(k => k.model === id).flatMap(k => Object.values(k.clips)))];
      const own = {}; if (M.animal) for (const c of models[i].animations) own[c.name] = c;
      try { ANIM.rigs[id] = bake(models[i], M.animal ? own : LAZY.mxAll, names, { ...M, clipHips: LAZY.mxHips }); ANIM.rigs[id].id = id; } catch (e) { console.warn('Could not prepare', id, e); }
    });
    return true;
  })());
}
/** Load the characters + clips and bake them. Safe to call when switched off (does nothing). */
export async function loadAnim(pbr) {
  ANIM.pbr = pbr; if (!animWanted()) return;
  try {
    const loader = new GLTFLoader(), v = window.BF_VERSION || '', base = new URL('../assets/anim/', import.meta.url).href.split('?')[0];
    const cache = {}, get = f => cache[f] || (cache[f] = fetch(`${base}${f}?v=${v}`).then(r => { if (!r.ok) throw new Error(`${f}: ${r.status}`); return r.arrayBuffer(); }).then(b => loader.parseAsync(b, base)));
    const need = [...new Set(Object.values(KINDS).map(k => k.model))].filter(id => !MODELS[id].lazy), kk = need.some(id => !MODELS[id].mixamo && !MODELS[id].animal), mx = need.some(id => MODELS[id].mixamo);
    const [clipFiles, mxClips, models] = await Promise.all([kk ? Promise.all(CLIP_FILES.map(get)) : [], mx ? get(MX_CLIPS) : null, Promise.all(need.map(id => get(MODELS[id].file)))]);
    const all = {}; for (const f of clipFiles) for (const c of f.animations) if (!all[c.name]) all[c.name] = c;
    const mxAll = {}; if (mxClips) for (const c of mxClips.animations) mxAll[c.name] = c;
    const mxHips = mxClips?.scene.getObjectByName('mixamorigHips')?.position.length() || 1; // hip height of the body the clips were made on
    Object.assign(LAZY, { get, mxAll, mxHips });
    need.forEach((id, i) => {
      const names = [...new Set(Object.values(KINDS).filter(k => k.model === id).flatMap(k => Object.values(k.clips)))], M = MODELS[id];
      const own = {}; if (M.animal) for (const c of models[i].animations) own[c.name] = c;
      ANIM.rigs[id] = bake(models[i], M.animal ? own : M.mixamo ? mxAll : all, names, { ...M, clipHips: mxHips }); ANIM.rigs[id].id = id;
    });
    ANIM.on = ANIM.ready = true;
  } catch (e) { console.warn('Animated soldiers could not load; using the built-in figures.', e); ANIM.on = false; }
}

// KayKit figures have big heads and short legs. The game's other soldiers are realistically proportioned, so the
// skeleton is re-proportioned while baking: head shrunk about the neck, legs lengthened (and the body lifted to match).
const PROP = { head: .52, leg: [1.2, 1.9, 1.2], hand: .8, arm: [1, 1.16, 1], chest: [1, 1.1, 1] };

const UPPER = /^(spine|chest|head|upperarm|lowerarm|wrist|hand)/; // bones a rider's fighting clip drives; the rest stay seated
const MX_UPPER = /Spine|Neck|Head|Shoulder|Arm|Hand|Sword|Shield|arch|arrow/;
const LOOP = /idle|walk|run|carry|^sit$/i; // clips played on the spot: their forward drift is taken out (and measured as the clip's pace)

function bake(gltf, all, names, M = {}) {
  const root = gltf.scene; root.updateMatrixWorld(true);
  const parts = []; root.traverse(o => { if (o.isSkinnedMesh) parts.push(o); });
  const skel = parts[0].skeleton, bones = skel.bones, nB = bones.length;
  const boneIdx = {}; bones.forEach((b, i) => { boneIdx[b.name] = i; });
  const bind = bones.map((b, i) => skel.boneInverses[i].clone().invert()); // where each bone sits in the bind pose
  const restWorld = bones.map(b => b.matrixWorld.clone());
  // attachments: plain meshes parented to a bone (sword in the hand slot, helmet on the head...)
  const attach = [];
  root.traverse(o => {
    if (!o.isMesh || o.isSkinnedMesh) return; let p = o.parent; while (p && !p.isBone) p = p.parent; if (!p) return;
    const bi = boneIdx[p.name]; if (bi === undefined) return;
    const m = bind[bi].clone().multiply(restWorld[bi].clone().invert()).multiply(o.matrixWorld); // into bind space, riding that bone
    attach.push({ name: o.name, bone: bi, geo: o.geometry.clone().applyMatrix4(m) });
  });
  const clipOf = n => all[n.includes('+') ? n.split('+')[1] : n], seatOf = n => (n.includes('+') ? all[n.split('+')[0]] : null);
  names = names.filter(n => clipOf(n) && (!n.includes('+') || seatOf(n)));
  const table = {}; let rows = 0;
  for (const n of names) { const c = clipOf(n), k = Math.max(2, Math.round(c.duration * FPS) + 1); table[n] = { name: n, start: rows, n: k, dur: (k - 1) / FPS }; rows += k; }
  // re-proportioning, applied on top of every animation frame
  const rest = bones.map(b => [b.position.clone(), b.quaternion.clone(), b.scale.clone()]);
  const B = n => bones[boneIdx[n]], legV = new THREE.Vector3(...PROP.leg), armV = new THREE.Vector3(...PROP.arm), chestV = new THREE.Vector3(...PROP.chest);
  const shape = () => {
    if (M.animal) return;
    B('head')?.scale.multiplyScalar(PROP.head);
    for (const n of ['upperlegl', 'upperlegr']) B(n)?.scale.multiply(legV);
    for (const n of ['handl', 'handr']) B(n)?.scale.multiplyScalar(PROP.hand);
    for (const n of ['upperarml', 'upperarmr']) B(n)?.scale.multiply(armV);
    B('spine')?.scale.multiply(chestV); B('head')?.scale.divide(chestV);
  };
  const body = bones.filter(b => !/IK|control|^root$/.test(b.name)); // real body bones (not the rig's helper handles)
  const lowest = () => { let y = 1e9; for (const b of body) y = Math.min(y, b.matrixWorld.elements[13]); return y; };
  const hipsName = M.mixamo ? 'mixamorigHips' : 'hips', hips = B(hipsName), upper = M.mixamo ? MX_UPPER : UPPER;
  const hipsK = M.mixamo && hips ? hips.position.length() / M.clipHips : 1; // the clips were made on another Mixamo body: scale the hip motion to this one
  const hw = new THREE.Vector3(), h0 = new THREE.Vector3(), drift = {};
  const W = nB * 4, data = new Float32Array(W * rows * 4), mixer = new THREE.AnimationMixer(root), m = new THREE.Matrix4();
  const toRest = () => bones.forEach((b, i) => { b.position.copy(rest[i][0]); b.quaternion.copy(rest[i][1]); b.scale.copy(rest[i][2]); });
  for (const n of names) {
    toRest();
    let seat = null; // riders: the seated pose, kept on every bone the fighting clip doesn't drive
    if (seatOf(n)) { const a = mixer.clipAction(seatOf(n)); a.play(); mixer.setTime(0); seat = bones.map(b => [b.position.clone(), b.quaternion.clone(), b.scale.clone()]); a.stop(); mixer.uncacheClip(seatOf(n)); toRest(); }
    const c = clipOf(n), t = table[n], act = mixer.clipAction(c); act.play();
    const loop = M.mixamo && LOOP.test(n);
    for (let f = 0; f < t.n; f++) {
      mixer.setTime(Math.min(f / FPS, Math.max(0, c.duration - 1e-4)));
      // the mixer only rewrites values that change, so put the animated pose back exactly after re-proportioning
      const keep = bones.map(b => [b.position.clone(), b.scale.clone(), b.quaternion.clone()]);
      if (seat) bones.forEach((b, i) => { if (!upper.test(b.name)) { b.position.copy(seat[i][0]); b.quaternion.copy(seat[i][1]); b.scale.copy(seat[i][2]); } });
      if (M.mixamo) {
        bones.forEach((b, i) => { if (b !== hips) { b.position.copy(rest[i][0]); b.scale.copy(rest[i][2]); } }); // keep this body's own bone lengths; only rotations come from the clip
        if (hips && hipsK !== 1) hips.position.multiplyScalar(hipsK);
        root.position.set(0, 0, 0); root.updateMatrixWorld(true);
        if (loop && hips) { hips.getWorldPosition(hw); if (f === 0) h0.copy(hw); root.position.set(h0.x - hw.x, 0, h0.z - hw.z); if (f === t.n - 1) drift[n] = Math.hypot(hw.x - h0.x, hw.z - h0.z); }
        root.updateMatrixWorld(true);
      } else {
        root.updateMatrixWorld(true); const y0 = lowest();
        shape(); root.updateMatrixWorld(true);
        if (B('hips')) { B('hips').position.y += y0 - lowest(); root.updateMatrixWorld(true); } // longer legs: lift the body so the lowest point stays where the animator put it
      }
      for (let b = 0; b < nB; b++) { m.multiplyMatrices(bones[b].matrixWorld, skel.boneInverses[b]); data.set(m.elements, ((t.start + f) * W + b * 4) * 4); }
      bones.forEach((b, i) => { b.position.copy(keep[i][0]); b.scale.copy(keep[i][1]); b.quaternion.copy(keep[i][2]); });
    }
    act.stop(); mixer.uncacheClip(c); root.position.set(0, 0, 0);
  }
  root.updateMatrixWorld(true);
  // normalise: measure the figure standing idle, then scale to soldier height with the feet on the ground
  const idle = table[names.find(n => /^Idle/.test(n)) || names.find(n => /idle/i.test(n) && !n.includes('+')) || names[0]], v = new THREE.Vector3(), acc = new THREE.Vector3(), bm = new THREE.Matrix4(); let lo = 1e9, hi = -1e9, back = -1e9, wide = 0;
  for (const mesh of parts) {
    const g = mesh.geometry, P = g.attributes.position, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;
    for (let i = 0; i < P.count; i += 3) { // every third vertex is plenty for a bounding height
      acc.set(0, 0, 0);
      for (let k = 0; k < 4; k++) { const w = SW.getComponent(i, k); if (!w) continue; bm.fromArray(data, (idle.start * W + SI.getComponent(i, k) * 4) * 4); acc.addScaledVector(v.fromBufferAttribute(P, i).applyMatrix4(mesh.bindMatrix).applyMatrix4(bm), w); }
      lo = Math.min(lo, acc.y); hi = Math.max(hi, acc.y);
      if (M.animal && acc.z > -.2 && acc.z < .6) { if (Math.abs(acc.x) < .3) back = Math.max(back, acc.y); wide = Math.max(wide, Math.abs(acc.x)); } // where a saddle sits
    }
  }
  const sc = (M.height || 1.74) / (hi - lo), N = new THREE.Matrix4().makeScale(sc, sc, sc).setPosition(0, -lo * sc, 0);
  for (let i = 0; i < data.length; i += 16) { m.fromArray(data, i).premultiply(N); data.set(m.elements, i); }
  const tex = new THREE.DataTexture(data, W, rows, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
  const rig = { parts, attach, table, uBones: { value: tex }, boneIdx, bind, map: parts[0].material.map || null, nmap: M.mixamo ? parts[0].material.normalMap || null : null, alphaTest: parts[0].material.alphaTest || 0, double: parts[0].material.side === THREE.DoubleSide, nscale: parts[0].material.normalScale?.clone() || new THREE.Vector2(1, 1), teamMaps: {}, nB, W, data, sc, lo, raw: { back, wide }, hips: hipsName, mixamo: !!M.mixamo };
  for (const n in drift) if (drift[n] > .05) table[n].pace = drift[n] * sc / table[n].dur; // ground speed the clip was captured at (game units / s)
  rig.seatY = (back - lo) * sc; // saddle height in game units (animals)
  /** Height of a bone's joint in a given baked row (game units). */
  rig.jointY = (bone, row) => { const b = boneIdx[bone]; if (b === undefined) return 0; const o = (row * W + b * 4) * 4, e = bind[b].elements; return data[o + 1] * e[12] + data[o + 5] * e[13] + data[o + 9] * e[14] + data[o + 13]; };
  return rig;
}

// ---------- team colours: repaint parts of the character's palette in the team colour ----------
function teamMap(rig, teamColor, look) {
  if (!rig.map?.image) return rig.map;
  const key = teamColor + (look || ''); if (rig.teamMaps[key]) return rig.teamMaps[key];
  const S = rig.map.image.width >= 1024 ? 512 : 256, cv = document.createElement('canvas'); cv.width = cv.height = S; const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(rig.map.image, 0, 0, S, S); const img = cx.getImageData(0, 0, S, S), d = img.data;
  const th = {}; new THREE.Color(teamColor).getHSL(th, THREE.SRGBColorSpace); const c = new THREE.Color(), hsl = {}, rules = MODELS[rig.id]?.team || [];
  for (let i = 0; i < d.length; i += 4) {
    c.setRGB(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, THREE.SRGBColorSpace).getHSL(hsl, THREE.SRGBColorSpace);
    let hit = false;
    for (const [h0, h1, smin, lmax, shade, minL = 0] of rules) {
      if (!((hsl.h >= h0 && hsl.h < h1) || (hsl.h + 1 >= h0 && hsl.h + 1 < h1)) || hsl.s < smin || hsl.l > lmax) continue;
      c.setHSL(th.h, Math.min(1, (shade === 1 ? hsl.s * (.55 + th.s * .6) : th.s * (minL ? .62 : .85))), Math.max(minL + hsl.l * .6, hsl.l * (.6 + th.l) * (shade === 1 ? 1 : shade)), THREE.SRGBColorSpace); hit = true; break;
    }
    if (!hit && look === 'gold' && hsl.s < .25 && hsl.l > (rig.mixamo ? .05 : .22) && hsl.l < .85) { c.setHSL(.115, .62, Math.min(.78, rig.mixamo ? hsl.l * 1.7 + .08 : hsl.l * 1.05), THREE.SRGBColorSpace); hit = true; } // the Commander's gilded armour
    if (!hit && look === 'bronze' && hsl.s < .22 && hsl.l > .12 && hsl.l < .8) { c.setHSL(.075, .5, Math.min(.62, hsl.l * 1.15 + .04), THREE.SRGBColorSpace); hit = true; } // Roman bronze
    if (!hit && look === 'lacquer' && hsl.l < .3 && hsl.s < .5) { c.setHSL(.01, .55, hsl.l * .9 + .04, THREE.SRGBColorSpace); hit = true; } // red-lacquered leather
    if (!hit && look === 'raider' && hsl.s < .25 && hsl.l > .5) { c.setHSL(.07, .35, hsl.l * .55, THREE.SRGBColorSpace); hit = true; } // weathered: no pale cloth, darker hair
    const br = MODELS[rig.id]?.bright; if (br && hsl.s < .3) { if (!hit) c.setHSL(hsl.h, hsl.s, Math.min(.9, hsl.l * br), THREE.SRGBColorSpace); else { const k = {}; c.getHSL(k, THREE.SRGBColorSpace); c.setHSL(k.h, k.s, Math.min(.9, k.l * br), THREE.SRGBColorSpace); } hit = true; } // lift very dark textures
    if (hit) { c.getRGB(hsl, THREE.SRGBColorSpace); d[i] = hsl.r * 255; d[i + 1] = hsl.g * 255; d[i + 2] = hsl.b * 255; }
  }
  cx.putImageData(img, 0, 0);
  cx.fillStyle = '#fff'; cx.fillRect(0, 0, 4, 4); // a white corner: extra gear (spear, bow...) samples it and is coloured per vertex instead
  const t = new THREE.CanvasTexture(cv); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.magFilter = t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
  return (rig.teamMaps[key] = t);
}

// ---------- geometry: the body, the character's own attachments, and extra gear made here ----------
function withAttrs(g, skinI, skinW, color) {
  const n = g.attributes.position.count, out = new THREE.BufferGeometry();
  out.setAttribute('position', g.attributes.position.clone());
  if (!g.attributes.normal) g.computeVertexNormals(); out.setAttribute('normal', g.attributes.normal.clone());
  const uv = color == null && g.attributes.uv ? g.attributes.uv.clone() : new THREE.BufferAttribute(new Float32Array(n * 2).fill(2 / 256), 2); // gear: the white corner
  out.setAttribute('uv', uv);
  const col = new Float32Array(n * 3).fill(1); if (color != null) { const c = new THREE.Color(color); for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3); }
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const I = new Float32Array(n * 4), Wt = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    if (skinI?.isBufferAttribute) { let s = 0; for (let k = 0; k < 4; k++) { I[i * 4 + k] = skinI.getComponent(i, k); Wt[i * 4 + k] = skinW.getComponent(i, k); s += Wt[i * 4 + k]; } for (let k = 0; k < 4; k++) Wt[i * 4 + k] /= s || 1; }
    else { I[i * 4] = skinI; Wt[i * 4] = 1; }
  }
  out.setAttribute('aSkinI', new THREE.BufferAttribute(I, 4)); out.setAttribute('aSkinW', new THREE.BufferAttribute(Wt, 4));
  out.setIndex(g.index ? g.index.clone() : [...Array(n).keys()]);
  return out;
}
const T = (x, y, z, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
// Extra gear the pack doesn't have, modelled in a bone's own space (hand slots: +Y is "up the weapon", +Z is away from the palm).
// Each piece: [bone, geometry, colour, placement]
const WOOD = 0x6b4a2c, STEEL = 0xc9ced4, DARK = 0x3a2c20;
const GEAR = {
  spear: () => [['handslotr', new THREE.CylinderGeometry(.028, .032, 2.5, 6), WOOD, T(0, .55, 0)], ['handslotr', new THREE.ConeGeometry(.07, .34, 6), STEEL, T(0, 1.96, 0)], ['handslotr', new THREE.CylinderGeometry(.045, .045, .08, 6), STEEL, T(0, 1.78, 0)]],
  axe: () => [['handslotr', new THREE.CylinderGeometry(.03, .035, .95, 6), WOOD, T(0, .32, 0)], ['handslotr', new THREE.BoxGeometry(.05, .26, .3), STEEL, T(0, .68, .14)], ['handslotr', new THREE.BoxGeometry(.07, .12, .1), DARK, T(0, .68, -.02)]],
  bow: () => {
    const R = .62, arc = 2.0, limb = new THREE.TorusGeometry(R, .026, 5, 14, arc); limb.rotateZ(-arc / 2); limb.rotateY(-Math.PI / 2); limb.translate(0, 0, -R);
    const zs = R * Math.cos(arc / 2) - R, len = 2 * R * Math.sin(arc / 2);
    return [['handslotl', limb, WOOD, T(0, 0, .04)], ['handslotl', new THREE.CylinderGeometry(.008, .008, len, 4), 0xe8e2d0, T(0, 0, zs + .04)], ['handslotl', new THREE.CylinderGeometry(.04, .04, .16, 6), DARK, T(0, 0, .04)]];
  },
  bigaxe: () => [['handslotr', new THREE.CylinderGeometry(.03, .036, 1.25, 6), WOOD, T(0, .35, 0)], ['handslotr', new THREE.CylinderGeometry(.24, .24, .035, 10, 1, false, 0, 2.2).rotateZ(Math.PI / 2).rotateY(Math.PI / 2), STEEL, T(0, .82, .05)], ['handslotr', new THREE.BoxGeometry(.06, .14, .1), DARK, T(0, .86, -.03)]],
  xbow: () => [['gripr', new THREE.BoxGeometry(.06, .7, .07), WOOD, T(0, .18, .05)], ['gripr', new THREE.TorusGeometry(.32, .02, 4, 10, 2.2).rotateZ(-1.1 + Math.PI / 2).rotateX(Math.PI / 2).rotateY(Math.PI / 2), DARK, T(0, .48, 0)], ['gripr', new THREE.BoxGeometry(.08, .12, .05), STEEL, T(0, .08, .08)]],
  quiver: () => [['chest', new THREE.CylinderGeometry(.09, .075, .6, 7), DARK, T(.1, .1, -.3, 0, 0, -.45)], ['chest', new THREE.CylinderGeometry(.07, .07, .12, 5), 0xd8d2c0, T(.25, .42, -.3, 0, 0, -.45)]],
};
// Mixamo hands: fingers run along the bone's +Y and the palm faces +Z. A slot maps the gear's own space (+Y up the weapon,
// +Z away from the palm, as on the KayKit hand slots) onto the bone, gripped in the palm. [bone, slot→bone matrix]
const MXR = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1)).setPosition(0, .085, .035);
const MXL = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, -1, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, -1)).setPosition(0, .085, .035);
// a gun-style grip (crossbows on the rifle clips): the stock runs along the fingers' direction
const MXG = new THREE.Matrix4().makeBasis(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1)).setPosition(0, .085, .035);
const MX_SLOT = { handslotr: ['mixamorigRightHand', MXR], handslotl: ['mixamorigLeftHand', MXL], gripr: ['mixamorigRightHand', MXG], chest: ['mixamorigSpine2', new THREE.Matrix4()] };
function unitGeo(rig, def, teamColor = 0x888888) {
  const list = [];
  for (const m of rig.parts) {
    if (def.parts && !def.parts.includes(m.name)) continue;
    if (def.hide && def.hide.some(h => m.name.startsWith(h))) continue;
    const g = m.geometry.clone(); g.applyMatrix4(m.bindMatrix);
    const flat = rig.map ? null : (def.coat?.[m.material.name] !== undefined ? new THREE.Color(def.coat[m.material.name]) : m.material.color.clone()); // animals: one flat colour per part
    list.push(withAttrs(g, g.attributes.skinIndex, g.attributes.skinWeight, flat));
  }
  if (def.cloth) { // horses: a saddle and a saddle cloth in the team colour, shaped to the horse's back (modelled in the rest pose, riding the torso bone)
    const bi = rig.boneIdx.Torso2 ?? rig.boneIdx.Torso ?? 0, top = rig.raw.back, w = rig.raw.wide;
    const piece = (sx, sy, sz, x, y, z, col) => list.push(withAttrs(new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z), bi, 1, col));
    piece(w * 2 + .1, .07, 1.5, 0, top + .03, .2, teamColor);
    for (const s of [-1, 1]) { piece(.06, 1.0, 1.5, s * (w + .03), top - .45, .2, teamColor); piece(.07, .12, 1.5, s * (w + .035), top - .95, .2, 0xd8b85a); }
    piece(w * 1.3, .16, .8, 0, top + .13, .15, 0x3a2618); piece(w * 1.3, .22, .12, 0, top + .2, -.25, 0x3a2618);
  }
  for (const a of rig.attach) if (def.show.includes(a.name)) list.push(withAttrs(a.geo, a.bone, 1));
  for (const name of def.gear || []) for (const [bone, geo, color, mat] of GEAR[name]()) {
    let bi = rig.boneIdx[bone], slot = null;
    if (rig.mixamo && MX_SLOT[bone]) { bi = rig.boneIdx[MX_SLOT[bone][0]]; slot = MX_SLOT[bone][1]; }
    if (bi === undefined) continue;
    geo.applyMatrix4(mat);
    if (slot) { const s = new THREE.Vector3().setFromMatrixScale(rig.bind[bi]).x; geo.applyMatrix4(slot).applyMatrix4(new THREE.Matrix4().makeScale(1 / s, 1 / s, 1 / s)); }
    list.push(withAttrs(geo.applyMatrix4(rig.bind[bi]), bi, 1, color));
  }
  return mergeGeometries(list, false);
}

/** A still copy of an animated unit standing idle (for button portraits and the Unity export). */
export function animFigure(kind, teamColor) {
  if (MOUNTS[kind]) { // horse + rider
    const [hk, rk] = MOUNTS[kind], grp = new THREE.Group(), h = animFigure(hk, teamColor), r = animFigure(rk, teamColor), hr = ANIM.rigs.horse, rr = ANIM.rigs[KINDS[rk].model];
    r.position.set(0, hr.seatY - rr.jointY(rr.hips, rr.table[KINDS[rk].clips.idle].start) + .1, .05); grp.add(h, r); grp.name = kind; return grp;
  }
  const def = KINDS[kind], rig = ANIM.rigs[def.model], g = unitGeo(rig, def, teamColor), P = g.attributes.position, Nn = g.attributes.normal, I = g.attributes.aSkinI, Wt = g.attributes.aSkinW;
  const data = rig.uBones.value.image.data, W = rig.nB * 4, row = (rig.table[def.clips.idle] || Object.values(rig.table)[0]).start;
  const m = new THREE.Matrix4(), e = m.elements, v = new THREE.Vector3(), n = new THREE.Vector3(), n3 = new THREE.Matrix3();
  for (let i = 0; i < P.count; i++) {
    e.fill(0);
    for (let k = 0; k < 4; k++) { const w = Wt.getComponent(i, k); if (!w) continue; const o = (row * W + I.getComponent(i, k) * 4) * 4; for (let j = 0; j < 16; j++) e[j] += data[o + j] * w; }
    v.fromBufferAttribute(P, i).applyMatrix4(m); P.setXYZ(i, v.x, v.y, v.z);
    n.fromBufferAttribute(Nn, i).applyMatrix3(n3.setFromMatrix4(m)).normalize(); Nn.setXYZ(i, n.x, n.y, n.z);
  }
  g.deleteAttribute('aSkinI'); g.deleteAttribute('aSkinW'); g.computeBoundingBox();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: teamMap(rig, teamColor, def.look), vertexColors: true, roughness: .62, metalness: .08 })); mesh.name = kind; return mesh;
}

// ---------- shader: pose each instance from its row of the bone texture ----------
const HEAD = `attribute vec4 aSkinI; attribute vec4 aSkinW; attribute float aRow; uniform highp sampler2D uBones; mat4 gSkin;
mat4 boneM(float b, int r) { int x = int(b + .5) * 4; return mat4(texelFetch(uBones, ivec2(x, r), 0), texelFetch(uBones, ivec2(x + 1, r), 0), texelFetch(uBones, ivec2(x + 2, r), 0), texelFetch(uBones, ivec2(x + 3, r), 0)); }
mat4 animM() { int r = int(aRow + .5); return aSkinW.x * boneM(aSkinI.x, r) + aSkinW.y * boneM(aSkinI.y, r) + aSkinW.z * boneM(aSkinI.z, r) + aSkinW.w * boneM(aSkinI.w, r); }
`;
function patch(mat, depth, rig) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uBones = rig.uBones;
    let v = sh.vertexShader;
    if (!depth) v = v.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n gSkin = animM(); objectNormal = mat3(gSkin) * objectNormal;');
    v = v.replace('#include <begin_vertex>', (depth ? 'gSkin = animM();\n' : '') + '#include <begin_vertex>\n transformed = (gSkin * vec4(transformed, 1.0)).xyz;');
    sh.vertexShader = HEAD + v;
  };
  mat.customProgramCacheKey = () => 'bfanim' + (depth ? 'D' : 'C') + rig.id;
  return mat;
}

const _root = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const ATK = { from: .22, rate: 1.25, len: .62 }, PACE = { walk: 2.4, run: 4.6, runAt: 4.2 };

/** One instanced, animated mesh per (team, unit type). Same interface as the built-in FigureBatch in models.js. */
export class AnimBatch {
  constructor(scene, team, kind, cap, shadows, teamColor) {
    const def = KINDS[kind], rig = ANIM.rigs[def.model]; this.def = def; this.cap = cap; this.used = 0; this.free = []; this.metal = []; this.parts = []; this.anim = true; this.atk = def.atk || ATK;
    const geo = unitGeo(rig, def, teamColor);
    this.rows = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1); this.rows.setUsage(THREE.DynamicDrawUsage); geo.setAttribute('aRow', this.rows);
    const map = teamMap(rig, teamColor, def.look), look = def.look === 'gold' ? { roughness: .42, metalness: .45 } : { roughness: .62, metalness: .08 };
    if (def.look === 'bronze') Object.assign(look, { roughness: .5, metalness: .35 });
    const mat = patch(ANIM.pbr ? new THREE.MeshStandardMaterial({ map, vertexColors: true, ...look, ...(rig.alphaTest ? { alphaTest: rig.alphaTest, side: rig.double ? THREE.DoubleSide : THREE.FrontSide } : {}), ...(rig.nmap ? { normalMap: rig.nmap, normalScale: rig.nscale.clone().multiplyScalar(.9) } : {}) }) : new THREE.MeshLambertMaterial({ map, vertexColors: true }), false, rig);
    const m = this.mesh = new THREE.InstancedMesh(geo, mat, cap); m.count = 0; m.frustumCulled = false; m.castShadow = shadows; m.receiveShadow = false;
    if (shadows) { rig.depthMat = rig.depthMat || patch(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), true, rig); m.customDepthMaterial = rig.depthMat; }
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); this.meshes = [m];
    const c = n => (def.clips[n] && rig.table[def.clips[n]]) || null, idle = c('idle') || Object.values(rig.table)[0];
    this.C = { idle, walk: c('walk') || idle, run: c('run') || c('walk') || idle, attack: c('attack') || idle, death: c('death') || idle, work: c('work'), aim: c('aim'), shoot: c('shoot') };
    this.t = new Float32Array(cap); this.cur = new Int16Array(cap).fill(-1);
    const pw = this.C.walk.pace, pr = this.C.run.pace; // Mixamo clips: the speed they were captured at
    this.P = pw ? { walk: pw, run: pr || pw * 2.2, runAt: Math.max(pw * 1.6, Math.min(4.2, (pw + (pr || pw * 2.2)) / 2)) } : PACE;
  }
  setTint() { /* gear colours are part of the model */ }
  alloc() { const i = this.free.length ? this.free.pop() : this.used++; if (i >= this.cap) throw new Error('too many units'); this.mesh.count = Math.max(this.mesh.count, i + 1); this.cur[i] = -1; return i; }
  release(i) { this.mesh.setMatrixAt(i, ZERO); this.mesh.instanceMatrix.needsUpdate = true; this.free.push(i); }
  /** pose: the same object the built-in figures get, plus dt, spd (ground speed), swT (time since the strike/shot), dead, dT, work */
  set(i, o) {
    if (o.hidden) { this.mesh.setMatrixAt(i, ZERO); return; }
    _q.setFromEuler(_e.set(0, o.yaw, 0, 'YXZ'));
    _root.compose(_v.set(o.x, o.y, o.z), _q, _s.setScalar(o.scale * (this.def.size || 1))); this.mesh.setMatrixAt(i, _root);
    const C = this.C, A = this.atk, dt = o.dt || 0, spd = o.spd || 0, swT = o.swT ?? 9, bow = this.def.ranged === 'bow'; let c, t, held = false;
    if (o.dead) { c = C.death; t = Math.min(c.dur, o.dT || 0); held = true; }
    else if (C.aim && (o.aim || 0) > .35 && spd < .15) { // archers: draw in time with the reload, loose when the game shoots
      if (C.shoot && swT < .32) { c = C.shoot; t = Math.min(c.dur, (bow ? .08 : .12) + swT * 1.2); }
      else { c = C.aim; t = bow ? Math.min(c.dur, .15 + (o.draw || 0) * (c.dur - .2)) : (this.t[i] += dt) % c.dur; }
      held = true;
    }
    else if (!C.aim && !this.def.noAttack && swT < A.len) { c = C.attack; t = Math.min(c.dur, A.from + swT * A.rate); held = true; }
    else {
      const P = this.def.pace || this.P;
      c = spd > .15 ? (spd > P.runAt ? C.run : C.walk) : (o.work && C.work ? C.work : C.idle);
      if (this.cur[i] !== c.start) { this.cur[i] = c.start; this.t[i] = (i * .37) % c.dur; } // new clip: start out of step with the neighbours
      this.t[i] += dt * (spd > .15 ? spd / (c === C.run ? P.run : P.walk) : 1); t = this.t[i] % c.dur;
    }
    if (held) this.cur[i] = -2;
    this.rows.array[i] = c.start + Math.min(c.n - 1, Math.floor(t * FPS));
  }
  flush() { this.mesh.instanceMatrix.needsUpdate = true; this.rows.needsUpdate = true; }
}

/** A rider on a horse: two animated meshes moved together. The rider sits at the saddle and rises and falls with the horse's back. */
export class MountBatch {
  constructor(scene, team, kind, cap, shadows, teamColor) {
    const [hk, rk] = MOUNTS[kind]; this.h = new AnimBatch(scene, team, hk, cap, shadows, teamColor); this.r = new AnimBatch(scene, team, rk, cap, shadows, teamColor);
    this.meshes = [...this.h.meshes, ...this.r.meshes]; this.cap = cap; this.metal = []; this.parts = []; this.anim = true;
    const hr = ANIM.rigs.horse, rr = ANIM.rigs[KINDS[rk].model];
    this.hr = hr; this.back0 = hr.jointY('Torso2', hr.table.Idle.start);
    this.seat = hr.seatY - rr.jointY(rr.hips, rr.table[KINDS[rk].clips.idle].start) + .1; // lift the rider so the hips rest on the saddle
  }
  get used() { return this.h.used; } get free() { return this.h.free; }
  setTint() {}
  alloc() { this.r.alloc(); return this.h.alloc(); }
  release(i) { this.h.release(i); this.r.release(i); }
  set(i, o) {
    this.h.set(i, o); if (o.hidden) { this.r.set(i, o); return; }
    const r = { ...o }, s = o.scale;
    if (o.dead) { r.x = o.x + Math.cos(o.yaw) * .9 * s; r.z = o.z - Math.sin(o.yaw) * .9 * s; } // thrown clear as the horse falls
    else { r.y = o.y + (this.seat + this.hr.jointY('Torso2', this.h.rows.array[i]) - this.back0) * s; r.x = o.x + Math.sin(o.yaw) * .05 * s; r.z = o.z + Math.cos(o.yaw) * .05 * s; r.spd = 0; }
    this.r.set(i, r);
  }
  flush() { this.h.flush(); this.r.flush(); }
}
