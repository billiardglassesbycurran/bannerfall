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
};
const CLIP_FILES = ['char_knight.glb', 'rig_tools.glb', 'rig_ranged.glb']; // where animation clips come from
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
export const ANIM = { on: false, ready: false, kinds: KINDS, rigs: {}, pbr: true };

/** Are animated soldiers switched on? (Settings, or ?anim=1 / ?anim=0 in the address) */
export function animWanted() {
  if (/[?&#]anim=1/.test(location.href)) return true; if (/[?&#]anim=0/.test(location.href)) return false;
  try { const v = JSON.parse(localStorage.getItem('bf.settings') || '{}').animOn; return v === undefined ? ANIM_DEFAULT : !!v; } catch { return ANIM_DEFAULT; }
}

/** Load the characters + clips and bake them. Safe to call when switched off (does nothing). */
export async function loadAnim(pbr) {
  ANIM.pbr = pbr; if (!animWanted()) return;
  try {
    const loader = new GLTFLoader(), v = window.BF_VERSION || '', base = new URL('../assets/anim/', import.meta.url).href.split('?')[0];
    const cache = {}, get = f => cache[f] || (cache[f] = fetch(`${base}${f}?v=${v}`).then(r => { if (!r.ok) throw new Error(`${f}: ${r.status}`); return r.arrayBuffer(); }).then(b => loader.parseAsync(b, base)));
    const need = [...new Set(Object.values(KINDS).map(k => k.model))];
    const [clipFiles, models] = await Promise.all([Promise.all(CLIP_FILES.map(get)), Promise.all(need.map(id => get(MODELS[id].file)))]);
    const all = {}; for (const f of clipFiles) for (const c of f.animations) if (!all[c.name]) all[c.name] = c;
    need.forEach((id, i) => { const names = [...new Set(Object.values(KINDS).filter(k => k.model === id).flatMap(k => Object.values(k.clips)))]; ANIM.rigs[id] = bake(models[i], all, names); ANIM.rigs[id].id = id; });
    ANIM.on = ANIM.ready = true;
  } catch (e) { console.warn('Animated soldiers could not load; using the built-in figures.', e); ANIM.on = false; }
}

// KayKit figures have big heads and short legs. The game's other soldiers are realistically proportioned, so the
// skeleton is re-proportioned while baking: head shrunk about the neck, legs lengthened (and the body lifted to match).
const PROP = { head: .52, leg: [1.2, 1.9, 1.2], hand: .8, arm: [1, 1.16, 1], chest: [1, 1.1, 1] };

function bake(gltf, all, names) {
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
  names = names.filter(n => all[n]);
  const table = {}; let rows = 0;
  for (const n of names) { const c = all[n], k = Math.max(2, Math.round(c.duration * FPS) + 1); table[n] = { name: n, start: rows, n: k, dur: (k - 1) / FPS }; rows += k; }
  // re-proportioning, applied on top of every animation frame
  const rest = bones.map(b => [b.position.clone(), b.quaternion.clone(), b.scale.clone()]);
  const B = n => bones[boneIdx[n]], legV = new THREE.Vector3(...PROP.leg), armV = new THREE.Vector3(...PROP.arm), chestV = new THREE.Vector3(...PROP.chest);
  const shape = () => {
    B('head')?.scale.multiplyScalar(PROP.head);
    for (const n of ['upperlegl', 'upperlegr']) B(n)?.scale.multiply(legV);
    for (const n of ['handl', 'handr']) B(n)?.scale.multiplyScalar(PROP.hand);
    for (const n of ['upperarml', 'upperarmr']) B(n)?.scale.multiply(armV);
    B('spine')?.scale.multiply(chestV); B('head')?.scale.divide(chestV);
  };
  const body = bones.filter(b => !/IK|control|^root$/.test(b.name)); // real body bones (not the rig's helper handles)
  const lowest = () => { let y = 1e9; for (const b of body) y = Math.min(y, b.matrixWorld.elements[13]); return y; };
  const W = nB * 4, data = new Float32Array(W * rows * 4), mixer = new THREE.AnimationMixer(root), m = new THREE.Matrix4();
  for (const n of names) {
    bones.forEach((b, i) => { b.position.copy(rest[i][0]); b.quaternion.copy(rest[i][1]); b.scale.copy(rest[i][2]); });
    const c = all[n], t = table[n], act = mixer.clipAction(c); act.play();
    for (let f = 0; f < t.n; f++) {
      mixer.setTime(Math.min(f / FPS, Math.max(0, c.duration - 1e-4)));
      // the mixer only rewrites values that change, so put the animated pose back exactly after re-proportioning
      const keep = bones.map(b => [b.position.clone(), b.scale.clone()]);
      root.updateMatrixWorld(true); const y0 = lowest();
      shape(); root.updateMatrixWorld(true);
      if (B('hips')) { B('hips').position.y += y0 - lowest(); root.updateMatrixWorld(true); } // longer legs: lift the body so the lowest point stays where the animator put it
      for (let b = 0; b < nB; b++) { m.multiplyMatrices(bones[b].matrixWorld, skel.boneInverses[b]); data.set(m.elements, ((t.start + f) * W + b * 4) * 4); }
      bones.forEach((b, i) => { b.position.copy(keep[i][0]); b.scale.copy(keep[i][1]); });
    }
    act.stop(); mixer.uncacheClip(c);
  }
  // normalise: measure the figure standing idle, then scale to soldier height with the feet on the ground
  const idle = table[names.find(n => /^Idle/.test(n)) || names[0]], v = new THREE.Vector3(), acc = new THREE.Vector3(), bm = new THREE.Matrix4(); let lo = 1e9, hi = -1e9;
  for (const mesh of parts) {
    const g = mesh.geometry, P = g.attributes.position, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;
    for (let i = 0; i < P.count; i += 3) { // every third vertex is plenty for a bounding height
      acc.set(0, 0, 0);
      for (let k = 0; k < 4; k++) { const w = SW.getComponent(i, k); if (!w) continue; bm.fromArray(data, (idle.start * W + SI.getComponent(i, k) * 4) * 4); acc.addScaledVector(v.fromBufferAttribute(P, i).applyMatrix4(mesh.bindMatrix).applyMatrix4(bm), w); }
      lo = Math.min(lo, acc.y); hi = Math.max(hi, acc.y);
    }
  }
  const sc = 1.74 / (hi - lo), N = new THREE.Matrix4().makeScale(sc, sc, sc).setPosition(0, -lo * sc, 0);
  for (let i = 0; i < data.length; i += 16) { m.fromArray(data, i).premultiply(N); data.set(m.elements, i); }
  const tex = new THREE.DataTexture(data, W, rows, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
  return { parts, attach, table, uBones: { value: tex }, boneIdx, bind, map: parts[0].material.map || null, teamMaps: {}, nB };
}

// ---------- team colours: repaint parts of the character's palette in the team colour ----------
function teamMap(rig, teamColor, look) {
  if (!rig.map?.image) return rig.map;
  const key = teamColor + (look || ''); if (rig.teamMaps[key]) return rig.teamMaps[key];
  const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S; const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(rig.map.image, 0, 0, S, S); const img = cx.getImageData(0, 0, S, S), d = img.data;
  const th = {}; new THREE.Color(teamColor).getHSL(th, THREE.SRGBColorSpace); const c = new THREE.Color(), hsl = {}, rules = MODELS[rig.id]?.team || [];
  for (let i = 0; i < d.length; i += 4) {
    c.setRGB(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, THREE.SRGBColorSpace).getHSL(hsl, THREE.SRGBColorSpace);
    let hit = false;
    for (const [h0, h1, smin, lmax, shade] of rules) {
      if (!((hsl.h >= h0 && hsl.h < h1) || (hsl.h + 1 >= h0 && hsl.h + 1 < h1)) || hsl.s < smin || hsl.l > lmax) continue;
      c.setHSL(th.h, Math.min(1, (shade === 1 ? hsl.s * (.55 + th.s * .6) : th.s * .85)), hsl.l * (.6 + th.l) * (shade === 1 ? 1 : shade), THREE.SRGBColorSpace); hit = true; break;
    }
    if (!hit && look === 'gold' && hsl.s < .2 && hsl.l > .22 && hsl.l < .85) { c.setHSL(.115, .62, Math.min(.78, hsl.l * 1.05), THREE.SRGBColorSpace); hit = true; } // the Commander's gilded armour
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
  const uv = !color && g.attributes.uv ? g.attributes.uv.clone() : new THREE.BufferAttribute(new Float32Array(n * 2).fill(2 / 256), 2); // gear: the white corner
  out.setAttribute('uv', uv);
  const col = new Float32Array(n * 3).fill(1); if (color) { const c = new THREE.Color(color); for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3); }
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const I = new Float32Array(n * 4), Wt = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    if (skinI.isBufferAttribute) { let s = 0; for (let k = 0; k < 4; k++) { I[i * 4 + k] = skinI.getComponent(i, k); Wt[i * 4 + k] = skinW.getComponent(i, k); s += Wt[i * 4 + k]; } for (let k = 0; k < 4; k++) Wt[i * 4 + k] /= s || 1; }
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
  quiver: () => [['chest', new THREE.CylinderGeometry(.09, .075, .6, 7), DARK, T(.1, .1, -.3, 0, 0, -.45)], ['chest', new THREE.CylinderGeometry(.07, .07, .12, 5), 0xd8d2c0, T(.25, .42, -.3, 0, 0, -.45)]],
};
function unitGeo(rig, def) {
  const list = [];
  for (const m of rig.parts) { const g = m.geometry.clone(); g.applyMatrix4(m.bindMatrix); list.push(withAttrs(g, g.attributes.skinIndex, g.attributes.skinWeight)); }
  for (const a of rig.attach) if (def.show.includes(a.name)) list.push(withAttrs(a.geo, a.bone, 1));
  for (const name of def.gear || []) for (const [bone, geo, color, mat] of GEAR[name]()) {
    const bi = rig.boneIdx[bone]; if (bi === undefined) continue;
    list.push(withAttrs(geo.applyMatrix4(mat).applyMatrix4(rig.bind[bi]), bi, 1, color));
  }
  return mergeGeometries(list, false);
}

/** A still copy of an animated unit standing idle (for button portraits and the Unity export). */
export function animFigure(kind, teamColor) {
  const def = KINDS[kind], rig = ANIM.rigs[def.model], g = unitGeo(rig, def), P = g.attributes.position, Nn = g.attributes.normal, I = g.attributes.aSkinI, Wt = g.attributes.aSkinW;
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
const ATK = { from: .22, rate: 1.25, len: .62 };

/** One instanced, animated mesh per (team, unit type). Same interface as the built-in FigureBatch in models.js. */
export class AnimBatch {
  constructor(scene, team, kind, cap, shadows, teamColor) {
    const def = KINDS[kind], rig = ANIM.rigs[def.model]; this.def = def; this.cap = cap; this.used = 0; this.free = []; this.metal = []; this.parts = []; this.anim = true; this.atk = def.atk || ATK;
    const geo = unitGeo(rig, def);
    this.rows = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1); this.rows.setUsage(THREE.DynamicDrawUsage); geo.setAttribute('aRow', this.rows);
    const map = teamMap(rig, teamColor, def.look), look = def.look === 'gold' ? { roughness: .42, metalness: .45 } : { roughness: .62, metalness: .08 };
    const mat = patch(ANIM.pbr ? new THREE.MeshStandardMaterial({ map, vertexColors: true, ...look }) : new THREE.MeshLambertMaterial({ map, vertexColors: true }), false, rig);
    const m = this.mesh = new THREE.InstancedMesh(geo, mat, cap); m.count = 0; m.frustumCulled = false; m.castShadow = shadows; m.receiveShadow = false;
    if (shadows) { rig.depthMat = rig.depthMat || patch(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), true, rig); m.customDepthMaterial = rig.depthMat; }
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); this.meshes = [m];
    const c = n => (def.clips[n] && rig.table[def.clips[n]]) || null, idle = c('idle') || Object.values(rig.table)[0];
    this.C = { idle, walk: c('walk') || idle, run: c('run') || c('walk') || idle, attack: c('attack') || idle, death: c('death') || idle, work: c('work'), aim: c('aim'), shoot: c('shoot') };
    this.t = new Float32Array(cap); this.cur = new Int16Array(cap).fill(-1);
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
    else if (!C.aim && swT < A.len) { c = C.attack; t = Math.min(c.dur, A.from + swT * A.rate); held = true; }
    else {
      c = spd > .15 ? (spd > 4.2 ? C.run : C.walk) : (o.work && C.work ? C.work : C.idle);
      if (this.cur[i] !== c.start) { this.cur[i] = c.start; this.t[i] = (i * .37) % c.dur; } // new clip: start out of step with the neighbours
      this.t[i] += dt * (spd > .15 ? spd / (c === C.run ? 4.6 : 2.4) : 1); t = this.t[i] % c.dur;
    }
    if (held) this.cur[i] = -2;
    this.rows.array[i] = c.start + Math.min(c.n - 1, Math.floor(t * FPS));
  }
  flush() { this.mesh.instanceMatrix.needsUpdate = true; this.rows.needsUpdate = true; }
}
