// Animated soldiers: real skeleton animation (walk, run, attack, death...) for whole armies at once.
//
// How it works: the CC0 KayKit skeleton and animation clips (assets/anim/, see tools/kaykit.py) are loaded once and
// every frame of every clip is "baked" into one texture (a row of bone positions per frame). Each unit type is then a
// single instanced mesh, and the graphics card poses every soldier itself by reading that soldier's current row.
// So 200 animated swordsmen still cost one draw call.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const FPS = 30;
const PACK = { general: 'rig_general.glb', move: 'rig_move.glb', melee: 'rig_melee.glb', tools: 'rig_tools.glb', ranged: 'rig_ranged.glb' };
// Unit types that use animated models, and which clip plays for what.
// speed = ground speed (units/s) the walk/run clip was made for; from/rate/len shape the attack swing.
const KINDS = {
  sword: { packs: ['general', 'move', 'melee'], gear: 'swordShield', size: 1,
    clips: { idle: 'Idle_A', walk: 'Walking_A', run: 'Running_A', attack: 'Melee_1H_Attack_Slice_Diagonal', death: 'Death_A' } },
};
export const ANIM = { on: false, ready: false, kinds: KINDS, rig: null, pbr: true };

/** Is the animated-soldiers trial switched on? (Settings, or ?anim=1 / &anim=1 in the address) */
export function animWanted() {
  if (/[?&#]anim=1/.test(location.href)) return true; if (/[?&#]anim=0/.test(location.href)) return false;
  try { return !!JSON.parse(localStorage.getItem('bf.settings') || '{}').anim; } catch { return false; }
}

/** Load the skeleton + clips and bake them. Safe to call when switched off (does nothing). */
export async function loadAnim(pbr) {
  ANIM.pbr = pbr; if (!animWanted()) return;
  try {
    const packs = [...new Set(['general', ...Object.values(KINDS).flatMap(k => k.packs)])];
    const loader = new GLTFLoader(), v = window.BF_VERSION || '';
    const base = new URL('../assets/anim/', import.meta.url).href.split('?')[0];
    const get = async p => { const r = await fetch(`${base}${PACK[p]}?v=${v}`); if (!r.ok) throw new Error(`${PACK[p]}: ${r.status}`); return loader.parseAsync(await r.arrayBuffer(), base); };
    const files = await Promise.all(packs.map(get));
    ANIM.rig = bake(files); ANIM.on = ANIM.ready = true;
  } catch (e) { console.warn('Animated soldiers could not load; using the built-in figures.', e); ANIM.on = false; }
}

// KayKit figures have big heads and short legs. The game's other soldiers are realistically proportioned, so the
// skeleton is re-proportioned while baking: head shrunk about the neck, legs lengthened (and the hips lifted to match).
const PROP = { head: .5, leg: [1.22, 1.95, 1.22], hand: .8, arm: [1, 1.18, 1], chest: [1, 1.12, 1] };

function bake(files) {
  const root = files[0].scene; root.updateMatrixWorld(true);
  const parts = []; root.traverse(o => { if (o.isSkinnedMesh) parts.push(o); });
  const skel = parts[0].skeleton, bones = skel.bones, nB = bones.length;
  const boneIdx = {}; bones.forEach((b, i) => { boneIdx[b.name] = i; });
  const bind = bones.map((b, i) => skel.boneInverses[i].clone().invert()); // where each bone sits in the rest pose
  const all = {}; for (const f of files) for (const c of f.animations) all[c.name] = c;
  const names = [...new Set(Object.values(KINDS).flatMap(k => Object.values(k.clips)))].filter(n => all[n]);
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
  const lowest = () => { let y = 1e9; for (const b of bones) y = Math.min(y, b.matrixWorld.elements[13]); return y; };
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
  // normalise: measure the figure standing idle, then scale to 1.8 tall with the feet on the ground
  const idle = table[KINDS.sword.clips.idle] || table[names[0]], v = new THREE.Vector3(), acc = new THREE.Vector3(), bm = new THREE.Matrix4(); let lo = 1e9, hi = -1e9;
  for (const mesh of parts) {
    const g = mesh.geometry, P = g.attributes.position, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;
    for (let i = 0; i < P.count; i += 3) { // every third vertex is plenty for a bounding height
      acc.set(0, 0, 0);
      for (let k = 0; k < 4; k++) { const w = SW.getComponent(i, k); if (!w) continue; bm.fromArray(data, (idle.start * W + SI.getComponent(i, k) * 4) * 4); acc.addScaledVector(v.fromBufferAttribute(P, i).applyMatrix4(mesh.bindMatrix).applyMatrix4(bm), w); }
      lo = Math.min(lo, acc.y); hi = Math.max(hi, acc.y);
    }
  }
  const sc = 1.8 / (hi - lo), N = new THREE.Matrix4().makeScale(sc, sc, sc).setPosition(0, -lo * sc, 0);
  for (let i = 0; i < data.length; i += 16) { m.fromArray(data, i).premultiply(N); data.set(m.elements, i); }
  const tex = new THREE.DataTexture(data, W, rows, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
  return { parts, table, uBones: { value: tex }, boneIdx, bind, map: parts[0].material.map || null, nB };
}

// ---------- geometry: the body, plus gear fixed to a bone ----------
const lin = hex => new THREE.Color(hex);
function withAttrs(g, color, skinI, skinW) {
  const n = g.attributes.position.count, out = new THREE.BufferGeometry();
  out.setAttribute('position', g.attributes.position.clone());
  if (!g.attributes.normal) g.computeVertexNormals(); out.setAttribute('normal', g.attributes.normal.clone());
  out.setAttribute('uv', g.attributes.uv ? g.attributes.uv.clone() : new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  const col = new Float32Array(n * 3), c = lin(color); for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
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
/** A solid piece stuck to one bone (sword in the hand, helmet on the head...). mat = where it sits relative to the bone. */
function onBone(rig, bone, geo, color, mat) {
  const i = rig.boneIdx[bone]; if (i === undefined) return null;
  const g = geo.clone(); if (mat) g.applyMatrix4(mat); g.applyMatrix4(rig.bind[i]);
  return withAttrs(g, color, i, 1);
}
const T = (x, y, z, rx = 0, ry = 0, rz = 0, s = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(s, s, s));
const PART_COL = (name, tc, textured) => textured ? 0xffffff : /Head/.test(name) ? 0xd8a07c : /Body/.test(name) ? tc : /Arm/.test(name) ? 0x8f949c : 0x4a3d30;

function gearFor(rig, kind, tc) {
  const out = [], add = g => { if (g) out.push(g); }; // gear is modelled in the skeleton's own units
  if (kind === 'swordShield') {
    // sword in the right hand
    add(onBone(rig, 'handslotr', new THREE.BoxGeometry(.07, 1.0, .02), 0xd9dde2, T(0, .62, 0)));       // blade
    add(onBone(rig, 'handslotr', new THREE.BoxGeometry(.3, .05, .06), 0xb08a3a, T(0, .12, 0)));        // crossguard
    add(onBone(rig, 'handslotr', new THREE.CylinderGeometry(.03, .03, .22, 6), 0x4a3020, T(0, 0, 0))); // grip
    // kite shield on the left arm
    const sh = new THREE.CylinderGeometry(.42, .42, .06, 5, 1); sh.scale(.85, 1, 1.15);
    add(onBone(rig, 'handslotl', sh, tc, T(0, .02, .1, Math.PI / 2, 0, 0)));
    add(onBone(rig, 'handslotl', new THREE.CylinderGeometry(.11, .11, .1, 8), 0xc9a94e, T(0, .02, .14, Math.PI / 2, 0, 0)));
    // helmet
    add(onBone(rig, 'head', new THREE.SphereGeometry(.47, 10, 6, 0, Math.PI * 2, 0, Math.PI * .55), 0x9aa0a8, T(0, .62, 0)));
    add(onBone(rig, 'head', new THREE.BoxGeometry(.07, .34, .05), 0x9aa0a8, T(0, .5, .46)));          // nose guard
  }
  return out;
}
function unitGeo(rig, def, tc) {
  const textured = !!rig.map, list = [];
  for (const m of rig.parts) { const g = m.geometry.clone(); g.applyMatrix4(m.bindMatrix); list.push(withAttrs(g, PART_COL(m.name, tc, textured), g.attributes.skinIndex, g.attributes.skinWeight)); }
  list.push(...gearFor(rig, def.gear, tc));
  return mergeGeometries(list, false);
}

// ---------- shader: pose each instance from its row of the bone texture ----------
const HEAD = `attribute vec4 aSkinI; attribute vec4 aSkinW; attribute float aRow; uniform highp sampler2D uBones; mat4 gSkin;
mat4 boneM(float b, int r) { int x = int(b + .5) * 4; return mat4(texelFetch(uBones, ivec2(x, r), 0), texelFetch(uBones, ivec2(x + 1, r), 0), texelFetch(uBones, ivec2(x + 2, r), 0), texelFetch(uBones, ivec2(x + 3, r), 0)); }
mat4 animM() { int r = int(aRow + .5); return aSkinW.x * boneM(aSkinI.x, r) + aSkinW.y * boneM(aSkinI.y, r) + aSkinW.z * boneM(aSkinI.z, r) + aSkinW.w * boneM(aSkinI.w, r); }
`;
function patch(mat, depth) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uBones = ANIM.rig.uBones;
    let v = sh.vertexShader;
    if (!depth) v = v.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n gSkin = animM(); objectNormal = mat3(gSkin) * objectNormal;');
    v = v.replace('#include <begin_vertex>', (depth ? 'gSkin = animM();\n' : '') + '#include <begin_vertex>\n transformed = (gSkin * vec4(transformed, 1.0)).xyz;');
    sh.vertexShader = HEAD + v;
  };
  mat.customProgramCacheKey = () => 'bfanim' + (depth ? 'D' : 'C');
  return mat;
}
let depthMat = null;

const _root = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/** One instanced, animated mesh per (team, unit type). Same interface as the built-in FigureBatch in models.js. */
export class AnimBatch {
  constructor(scene, team, kind, cap, shadows, teamColor) {
    const rig = ANIM.rig, def = KINDS[kind]; this.def = def; this.cap = cap; this.used = 0; this.free = []; this.metal = []; this.parts = []; this.anim = true;
    const geo = unitGeo(rig, def, teamColor);
    this.rows = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1); this.rows.setUsage(THREE.DynamicDrawUsage); geo.setAttribute('aRow', this.rows);
    const mat = patch(ANIM.pbr ? new THREE.MeshStandardMaterial({ vertexColors: true, map: rig.map, roughness: .7, metalness: .1 }) : new THREE.MeshLambertMaterial({ vertexColors: true, map: rig.map }), false);
    const m = this.mesh = new THREE.InstancedMesh(geo, mat, cap); m.count = 0; m.frustumCulled = false; m.castShadow = shadows; m.receiveShadow = false;
    if (shadows) { depthMat = depthMat || patch(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), true); m.customDepthMaterial = depthMat; }
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); this.meshes = [m];
    const c = n => rig.table[def.clips[n]] || rig.table[def.clips.idle];
    this.C = { idle: c('idle'), walk: c('walk'), run: c('run'), attack: c('attack'), death: c('death'), work: def.clips.work ? c('work') : null };
    this.t = new Float32Array(cap); this.cur = new Int16Array(cap).fill(-1);
  }
  setTint() { /* gear colours are part of the model */ }
  alloc() { const i = this.free.length ? this.free.pop() : this.used++; if (i >= this.cap) throw new Error('too many units'); this.mesh.count = Math.max(this.mesh.count, i + 1); this.cur[i] = -1; return i; }
  release(i) { this.mesh.setMatrixAt(i, ZERO); this.mesh.instanceMatrix.needsUpdate = true; this.free.push(i); }
  /** pose: the same object the built-in figures get, plus dt, spd (ground speed), swT (time since the strike), dead, dT, work */
  set(i, o) {
    if (o.hidden) { this.mesh.setMatrixAt(i, ZERO); return; }
    _q.setFromEuler(_e.set(0, o.yaw, 0, 'YXZ'));
    _root.compose(_v.set(o.x, o.y, o.z), _q, _s.setScalar(o.scale * (this.def.size || 1))); this.mesh.setMatrixAt(i, _root);
    const C = this.C, dt = o.dt || 0, spd = o.spd || 0; let c, t;
    if (o.dead) { c = C.death; t = Math.min(c.dur, o.dT || 0); }
    else if ((o.swT ?? 9) < .62) { c = C.attack; t = Math.min(c.dur, .22 + o.swT * 1.25); } // the blow lands at the start: play from mid-swing
    else {
      c = spd > .15 ? (spd > 4.2 ? C.run : C.walk) : (o.work && C.work ? C.work : C.idle);
      if (this.cur[i] !== c.start) { this.cur[i] = c.start; this.t[i] = (i * .37) % c.dur; } // new clip: start out of step with the neighbours
      this.t[i] += dt * (spd > .15 ? spd / (c === C.run ? 4.6 : 2.4) : 1); t = this.t[i] % c.dur;
    }
    if (c === C.attack || o.dead) this.cur[i] = -2;
    this.rows.array[i] = c.start + Math.min(c.n - 1, Math.floor(t * FPS));
  }
  flush() { this.mesh.instanceMatrix.needsUpdate = true; this.rows.needsUpdate = true; }
}
