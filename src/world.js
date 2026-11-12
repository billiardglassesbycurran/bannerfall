// The map: heightfield, walkability grid, resources (trees, berries, gold), decoration, water and sky.
import * as THREE from 'three';
import { clamp, lerp, smooth, fbm, vnoise, hash2, mulberry32, segDist, TAU } from './util.js';
import { Builder, P, M, U, bake, jitter, shadeAO } from './geo.js';
import { tileFbm, cloudTexture } from './textures.js';
import { GM } from './gltfmodels.js';
export const CLOUDS = { value: null };

export const SIZE = 128, N = SIZE, HN = SIZE + 1;
export const WL = -0.45;
export const BASES = [{ x: 24, z: 104 }, { x: 104, z: 24 }];
// A river winds between the two bases (bridge in the middle, shallow fords near each end) — layout from the prototype.
export const BRIDGE = { x: 64, z: 64 };
const RIVER_ROADS = [[[24, 104], [44, 76], [64, 64], [84, 52], [104, 24]], [[24, 104], [18, 62], [37, 33], [66, 20], [104, 24]], [[24, 104], [62, 110], [91, 95], [110, 62], [104, 24]]];
const RIVER_GROVES = [[12, 72, 7], [46, 120, 6], [30, 84, 3.5], [44, 62, 6], [68, 98, 6], [18, 44, 7], [86, 118, 6], [64, 22, 5]];
// ---------------- maps ----------------
// The map is built once when the page loads; picking another map on the title screen reloads the page.
export const MAP_LIST = {
  riverlands: { name: 'Riverlands', desc: 'A winding river splits the land: one bridge and two shallow fords. Docks, fishing and warships.' },
  highland: { name: 'Highland Pass', desc: 'A mountain ridge with three narrow passes. Hold the high ground; gold in the hills, no sea.' },
  forest: { name: 'Forest Valley', desc: 'Thick forest everywhere: winding paths, clearings, two ponds. Lots of wood; easy to ambush, hard to scout.' },
  random: { name: 'Random', desc: 'A new land every game: river, ridge or forest lakes, with hills and woods in new places.' },
};
function pickMap() {
  let id = 'riverlands', seed = 1;
  try {
    const h = /map=(\w+)(?:,(\d+))?/.exec(location.hash);
    if (h) { id = h[1]; seed = +h[2] || 1; } else { id = localStorage.getItem('bf.map') || id; seed = +localStorage.getItem('bf.mapSeed') || 1; }
  } catch { /* ignore */ }
  return MAP_LIST[id] ? { id, seed } : { id: 'riverlands', seed: 1 };
}
function makeMap({ id, seed }) {
  const base = { id, seed, name: MAP_LIST[id].name, river: false, bridge: false, fords: [], roads: RIVER_ROADS, groves: RIVER_GROVES, scatter: 170, hills: 7, off: 0, ridge: null, ponds: [], clear: [] };
  if (id === 'riverlands') return { ...base, river: true, bridge: true, fords: [[37.2, 32.8], [90.8, 95.2]] };
  if (id === 'highland') return { ...base, hills: 10, off: 23, scatter: 110,
    roads: [[[24, 104], [44, 76], [64, 64], [84, 52], [104, 24]], [[24, 104], [20, 62], [39, 41], [66, 22], [104, 24]], [[24, 104], [62, 106], [89, 87], [108, 62], [104, 24]]],
    ridge: { h: 11, w: 8, passes: [[39, 41, 4.5], [64, 64, 6], [89, 87, 4.5]] }, groves: [[12, 72, 6], [46, 120, 5], [30, 84, 3], [18, 44, 6], [86, 118, 5], [70, 100, 4]], hillGold: true };
  if (id === 'forest') return { ...base, off: 51, hills: 5, scatter: 330, ponds: [[44, 44, 6.5], [84, 84, 6.5]],
    groves: [[12, 72, 9], [46, 120, 8], [44, 62, 8], [68, 98, 8], [18, 44, 9], [86, 118, 8], [64, 22, 7], [64, 106, 7], [22, 64, 7]], clear: [[46, 82, 9], [82, 46, 9], [64, 64, 7]] };
  // random: seeded, mirrored so both sides are fair
  const r = mulberry32(seed * 7919 + 13), kind = r() < .45 ? 'river' : r() < .55 ? 'ridge' : 'ponds';
  const groves = []; for (let i = 0; i < 9; i++) { const x = 8 + r() * 70, z = 30 + r() * 90; if (z > SIZE - x + 10) continue; groves.push([x, z, 4 + r() * 5]); }
  const m = { ...base, off: 100 + seed % 997, hills: 5 + r() * 6, scatter: 110 + r() * 200 | 0, groves, clear: [[46, 82, 8], [82, 46, 8], [64, 64, 6]] };
  if (kind === 'river') Object.assign(m, { river: true, bridge: true, fords: [[37.2, 32.8], [90.8, 95.2]] });
  else if (kind === 'ridge') Object.assign(m, { ridge: { h: 8 + r() * 5, w: 7 + r() * 2, passes: [[39, 41, 4.5], [64, 64, 5 + r() * 2], [89, 87, 4.5]] }, roads: [[[24, 104], [44, 76], [64, 64], [84, 52], [104, 24]], [[24, 104], [20, 62], [39, 41], [66, 22], [104, 24]], [[24, 104], [62, 106], [89, 87], [108, 62], [104, 24]]], hillGold: true });
  else { const a = 30 + r() * 20; m.ponds = [[a, a, 5 + r() * 3], [SIZE - a, SIZE - a, 5 + r() * 3]]; }
  m.name += ` (${kind === 'river' ? 'river' : kind === 'ridge' ? 'mountains' : 'lakes'} #${seed})`;
  return m;
}
export const MAP = makeMap(pickMap());
export const FORDS = MAP.fords;
const ROADS = MAP.roads;
export function riverDist(x, z) { return Math.abs((x - z) / Math.SQRT2 + Math.sin((x + z - 128) * .045) * 6); }
/** Height of the bridge deck at (x,z), or -99 if not on the bridge. */
export function bridgeAt(x, z) {
  if (!MAP.bridge) return -99;
  const u = ((x - BRIDGE.x) - (z - BRIDGE.z)) / Math.SQRT2, v = ((x - BRIDGE.x) + (z - BRIDGE.z)) / Math.SQRT2;
  return Math.abs(u) < 7 && Math.abs(v) < 1.6 ? WL + .75 + .45 * (1 - (u / 7) ** 2) : -99;
}

// ---------------- heights ----------------
function distToRoad(x, z) {
  let best = 1e9;
  for (const r of ROADS) for (let i = 0; i < r.length - 1; i++) best = Math.min(best, segDist(x, z, r[i][0], r[i][1], r[i + 1][0], r[i + 1][1]));
  return best + (vnoise(x * .15, z * .15) - .5) * 1.2;
}
function rawH(x, z) {
  let h = 1.0 + (fbm(x * .022 + 11 + MAP.off, z * .022 + MAP.off * .7) - .5) * MAP.hills + (fbm(x * .09 + 40 + MAP.off, z * .09) - .5) * 1.4;
  const e = Math.min(x, z, SIZE - x, SIZE - z);
  if (e < 14) { const k = (14 - e) / 14; h += k * k * 20 * (.55 + .9 * fbm(x * .06 + 7, z * .06)); }
  for (const b of BASES) { const d = Math.hypot(x - b.x, z - b.z); if (d < 20) h = lerp(h, 1.0, smooth(clamp((20 - d) / 8, 0, 1))); }
  h = Math.max(h, WL + .4);
  const rd = distToRoad(x, z); if (rd < 4) h = lerp(h, h * .7 + .35, smooth((4 - rd) / 4) * .7);
  if (MAP.ridge) { // mountain ridge along the frontier, cut by passes
    const R = MAP.ridge, d = riverDist(x, z) + (vnoise(x * .2, z * .2) - .5) * 2.5;
    let pass = 1; for (const [px, pz, pr] of R.passes) pass = Math.min(pass, smooth(clamp((Math.hypot(x - px, z - pz) - pr) / 5, 0, 1)));
    h += R.h * (.75 + .5 * fbm(x * .08 + 3, z * .08)) * smooth(clamp((R.w - d) / (R.w * .7), 0, 1)) * pass;
  }
  for (const [px, pz, pr] of MAP.ponds) { const d = Math.hypot(x - px, z - pz) + (vnoise(x * .3, z * .3) - .5) * 1.5; if (d < pr + 2.5) h = Math.min(h, lerp(h, WL - 1.6, smooth(clamp((pr + 2.5 - d) / 3, 0, 1)))); }
  if (!MAP.river) return h;
  // river: deep channel, shallow at the two fords
  const d = riverDist(x, z) + (vnoise(x * .3, z * .3) - .5) * 1.2;
  let depth = 2.4 * smooth(clamp((6 - d) / 3.5, 0, 1));
  for (const f of FORDS) { const fd = Math.hypot(x - f[0], z - f[1]); depth = lerp(depth, Math.min(depth, .6), smooth(clamp((6.5 - fd) / 3, 0, 1))); }
  if (depth > 0) h = Math.min(h, lerp(h, WL + .45 - depth, smooth(clamp((6.5 - d) / 2.5, 0, 1))));
  return h;
}
export const hgt = new Float32Array(HN * HN);
for (let j = 0; j < HN; j++) for (let i = 0; i < HN; i++) hgt[j * HN + i] = rawH(i, j);

export function heightAt(x, z) {
  x = clamp(x, 0, SIZE - .001); z = clamp(z, 0, SIZE - .001);
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
  const h00 = hgt[j * HN + i], h10 = hgt[j * HN + i + 1], h01 = hgt[(j + 1) * HN + i], h11 = hgt[(j + 1) * HN + i + 1];
  if (fz >= fx) return h00 + (h11 - h01) * fx + (h01 - h00) * fz;
  return h00 + (h10 - h00) * fx + (h11 - h10) * fz;
}

// ---------------- grid ----------------
// 0 free · 1 cliff/water/edge · 2 tree · 3 gold · 4 building · 6 berries · 7 farm (walkable)
export const blocked = new Uint8Array(N * N);
export const resCell = new Array(N * N).fill(null);
export const cidx = (x, z) => (z | 0) * N + (x | 0);
export const cellWalk = (cx, cz) => cx >= 0 && cz >= 0 && cx < N && cz < N && (blocked[cz * N + cx] === 0 || blocked[cz * N + cx] === 7);
export const walkable = (x, z) => cellWalk(x | 0, z | 0);
/** Where units stand: the ground, or the bridge deck above the river. */
export const groundY = (x, z) => Math.max(heightAt(x, z), bridgeAt(x, z));
/** Water deep enough for boats (fords are shallow but boats can still pass). */
export const water = new Uint8Array(N * N);
export const navCell = (cx, cz) => cx >= 0 && cz >= 0 && cx < N && cz < N && water[cz * N + cx] === 1 && !navBlock[cz * N + cx];
export const navBlock = new Uint8Array(N * N); // docks
export const navWalk = (x, z) => navCell(x | 0, z | 0);
export const isLand = (cx, cz) => cx >= 0 && cz >= 0 && cx < N && cz < N && blocked[cz * N + cx] !== 1;
for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
  const e = Math.min(x + .5, z + .5, SIZE - .5 - x, SIZE - .5 - z);
  const h = [hgt[z * HN + x], hgt[z * HN + x + 1], hgt[(z + 1) * HN + x], hgt[(z + 1) * HN + x + 1]];
  const sl = Math.max(...h) - Math.min(...h), avg = (h[0] + h[1] + h[2] + h[3]) / 4;
  if (e < 4.5 || sl > 1.15 || avg < WL - .25) blocked[z * N + x] = 1;
  if (bridgeAt(x + .5, z + .5) > -50 && e >= 4.5) blocked[z * N + x] = 0; // the bridge is walkable
  if (e >= 4 && Math.max(...h) < WL - .1) water[z * N + x] = 1;
}

// ---------------- resources ----------------
export const resources = [];
let nextResId = 1;
const R = mulberry32(20261110);
const rr = (a, b) => a + (b - a) * R();
function nearBase(x, z, d) { return BASES.some(b => Math.hypot(x - b.x, z - b.z) < d); }
function addRes(rt, x, z, amt, cells, r) {
  const res = { id: nextResId++, kind: 'res', rt, x, z, amt, max: amt, r, cells, alive: true };
  for (const c of cells) { blocked[c] = rt === 'w' ? 2 : rt === 'g' ? 3 : 6; resCell[c] = res; }
  resources.push(res); return res;
}
const cellFree0 = (cx, cz) => cx >= 0 && cz >= 0 && cx < N && cz < N && blocked[cz * N + cx] === 0;
function addTree(x, z) {
  const cx = x | 0, cz = z | 0; if (!cellFree0(cx, cz) || heightAt(cx + .5, cz + .5) < WL + .5 || heightAt(cx + .5, cz + .5) > 12) return;
  if (distToRoad(cx + .5, cz + .5) < 3 || MAP.clear.some(([px, pz, pr]) => Math.hypot(x - px, z - pz) < pr)) return;
  addRes('w', cx + .5 + (hash2(cx, cz) - .5) * .3, cz + .5 + (hash2(cz, cx) - .5) * .3, 100, [cz * N + cx], .45);
}
function addBerry(x, z) {
  const cx = x | 0, cz = z | 0; if (!cellFree0(cx, cz) || heightAt(cx + .5, cz + .5) < WL + .5) return false;
  addRes('f', cx + .5, cz + .5, 125, [cz * N + cx], .55); return true;
}
function addMine(x, z, amt) {
  const cx = x | 0, cz = z | 0, cells = [];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { if (!cellFree0(cx + dx, cz + dz)) return; cells.push((cz + dz) * N + cx + dx); }
  addRes('g', cx + .5, cz + .5, amt, cells, 1.5);
}
const mirror = (fn, x, z, ...a) => { fn(x, z, ...a); fn(SIZE - x, SIZE - z, ...a); };
function berryPatch(x, z, n) { let k = 0; for (let t = 0; t < 60 && k < n; t++) { const a = t * 2.4, d = .6 + t * .09; if (addBerry(x + Math.cos(a) * d, z + Math.sin(a) * d)) k++; } }
// per-base starting resources (mirrored so it's fair)
mirror(addMine, 36, 112, 2500); mirror(addMine, 14, 90, 2000);
for (const [x, z] of [[33, 96], [SIZE - 33, SIZE - 96]]) berryPatch(x, z, 7);
mirror(addMine, 66, 44, 3000);
for (const [x, z] of [[58, 92], [SIZE - 58, SIZE - 92]]) berryPatch(x, z, 6);
const groves = MAP.groves;
if (MAP.hillGold) { mirror(addMine, 50, 28, 2500); mirror(addMine, 28, 50, 2000); } // extra gold up in the hills
for (const [gx, gz, gr] of groves) for (let k = 0; k < gr * gr * 1.7; k++) {
  const a = R() * TAU, d = Math.sqrt(R()) * gr, x = gx + Math.cos(a) * d, z = gz + Math.sin(a) * d;
  if (!nearBase(x, z, 13) && !nearBase(SIZE - x, SIZE - z, 13)) mirror(addTree, x, z);
}
for (let k = 0; k < MAP.scatter; k++) { const x = rr(6, 122), z = rr(6, 122); if (z > SIZE - x) continue; if (!nearBase(x, z, 14) && !nearBase(SIZE - x, SIZE - z, 14)) mirror(addTree, x, z); }
// fish shoals along the river (only fishing boats can catch them; they don't block boats)
for (const [px, pz, pr] of MAP.ponds) for (let k = 0; k < 2; k++) resources.push({ id: nextResId++, kind: 'res', rt: 'f', fish: true, x: px + (k ? .35 : -.35) * pr, z: pz + (k ? -.3 : .3) * pr, amt: 250, max: 250, r: 1.2, cells: [], alive: true });
if (MAP.river) for (const sv of [52, 92, 108, 148, 164, 204]) {
  const dxz = -Math.SQRT2 * Math.sin((sv - 128) * .045) * 6, x = (sv + dxz) / 2, z = (sv - dxz) / 2;
  resources.push({ id: nextResId++, kind: 'res', rt: 'f', fish: true, x, z, amt: 250, max: 250, r: 1.2, cells: [], alive: true });
}
for (const r of resources) r.y = r.fish ? WL : heightAt(r.x, r.z);

// ---------------- terrain mesh ----------------
// Each vertex gets blend weights for 4 ground textures (grass, dirt, rock, sand) plus a colour tint.
function groundMix(i, j) {
  const h = hgt[j * HN + i];
  const sl = Math.hypot(hgt[j * HN + Math.min(i + 1, HN - 1)] - hgt[j * HN + Math.max(i - 1, 0)], hgt[Math.min(j + 1, HN - 1) * HN + i] - hgt[Math.max(j - 1, 0) * HN + i]) / 2;
  const n = fbm(i * .07, j * .07, 3), n2 = vnoise(i * .4, j * .4);
  let g = 1, d = 0, r = 0, s = 0;
  const dry = smooth(clamp((fbm(i * .03 + 50, j * .03) - .5) * 3, 0, 1)) * .35;
  d = Math.max(d, dry * (.5 + .5 * n2));
  const rd = distToRoad(i, j); if (rd < 2.8) d = Math.max(d, smooth(clamp((2.8 - rd) / 1.4, 0, 1)) * (.8 + .2 * n2));
  for (const bs of BASES) { const dd = Math.hypot(i - bs.x, j - bs.z); if (dd < 9) d = Math.max(d, smooth(clamp((9 - dd) / 4, 0, 1)) * .6 * (.6 + .4 * n2)); }
  if (h < WL + .9) s = clamp((WL + .9 - h) / .7, 0, 1);
  if (sl > .45) r = clamp((sl - .45) / .45, 0, 1);
  if (h > 9) r = Math.max(r, clamp((h - 9) / 3, 0, 1));
  g = Math.max(0, 1 - d - r - s); const tot = g + d + r + s || 1;
  const tint = .86 + .24 * n, snow = h > 12.5 ? clamp((h - 12.5) / 3, 0, 1) : 0;
  return { w: [g / tot, d / tot, r / tot, s / tot], tint: [tint * (1 + snow * 1.3), tint * (1 + snow * 1.35), tint * (1 + snow * 1.5)] };
}
const AVG = [[86, 100, 46], [118, 94, 66], [120, 116, 110], [186, 170, 132]];
export function buildTerrain(Q, tex) {
  const pos = new Float32Array(HN * HN * 3), col = new Float32Array(HN * HN * 3), spl = new Float32Array(HN * HN * 4);
  for (let j = 0; j < HN; j++) for (let i = 0; i < HN; i++) {
    const k = j * HN + i; pos[k * 3] = i; pos[k * 3 + 1] = hgt[k]; pos[k * 3 + 2] = j;
    const { w, tint } = groundMix(i, j);
    col[k * 3] = tint[0]; col[k * 3 + 1] = tint[1]; col[k * 3 + 2] = tint[2];
    spl.set(w, k * 4);
  }
  const idx = new Uint32Array(SIZE * SIZE * 6); let p = 0;
  for (let j = 0; j < SIZE; j++) for (let i = 0; i < SIZE; i++) {
    const a = j * HN + i, b = a + 1, cc = a + HN, d = cc + 1;
    idx[p++] = a; idx[p++] = cc; idx[p++] = d; idx[p++] = a; idx[p++] = d; idx[p++] = b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('splat', new THREE.BufferAttribute(spl, 4));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const mat = M.pbr ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .96, metalness: 0 }) : new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, { tG: { value: tex.grass }, tD: { value: tex.dirt }, tR: { value: tex.rock }, tS: { value: tex.sand }, tCloud: CLOUDS, uTime: U.time });
    sh.vertexShader = 'attribute vec4 splat; varying vec4 vSplat; varying vec2 vXZ;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vSplat = splat; vXZ = position.xz;');
    sh.fragmentShader = 'uniform sampler2D tG, tD, tR, tS, tCloud; uniform float uTime; varying vec4 vSplat; varying vec2 vXZ;\n' + sh.fragmentShader.replace('#include <map_fragment>', `
      ${tex.photo ? `
      vec2 r2 = vec2(vXZ.y, -vXZ.x);
      vec3 cg = mix(texture2D(tG, vXZ * 0.13).rgb, texture2D(tG, r2 * 0.047 + 0.37).rgb, 0.45) * vec3(0.78, 1.12, 0.48);
      vec3 cd = mix(texture2D(tD, vXZ * 0.32).rgb, texture2D(tD, r2 * 0.11 + 0.2).rgb, 0.35);
      vec3 cr = mix(texture2D(tR, vXZ * 0.085).rgb, texture2D(tR, r2 * 0.031 + 0.5).rgb, 0.4) * vec3(0.78, 0.78, 0.84);
      vec3 cs = mix(texture2D(tS, vXZ * 0.25).rgb, texture2D(tS, r2 * 0.09).rgb, 0.3);
      vec3 ground = cg * vSplat.x + cd * vSplat.y + cr * vSplat.z + cs * vSplat.w;
      diffuseColor.rgb *= ground * 1.4;
      float cloudSh = texture2D(tCloud, vXZ * 0.0075 + vec2(uTime * 0.0035, uTime * 0.0018) * 0.9).r; diffuseColor.rgb *= 1.0 - 0.3 * smoothstep(0.5, 0.75, cloudSh); // cloud shadows` : `
      vec2 u1 = vXZ * 0.3, u2 = vec2(vXZ.y, -vXZ.x) * 0.083 + 0.37;
      vec3 cg = mix(texture2D(tG, u1).rgb, texture2D(tG, u2).rgb, 0.4);
      vec3 cd = mix(texture2D(tD, u1 * 0.9).rgb, texture2D(tD, u2).rgb, 0.35);
      vec3 cr = mix(texture2D(tR, u1 * 0.5).rgb, texture2D(tR, u2).rgb, 0.4);
      vec3 cs = texture2D(tS, u1).rgb;
      float macro = 0.6 + 0.4 * texture2D(tG, vXZ * 0.013).g / 0.13;
      vec3 ground = cg * vSplat.x + cd * vSplat.y + cr * vSplat.z + cs * vSplat.w;
      diffuseColor.rgb *= ground * clamp(macro, 0.75, 1.25) * 1.9;`}`);
  };
  mat.customProgramCacheKey = () => 'terrain' + !!tex.photo;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true; mesh.name = 'terrain';
  return mesh;
}
export function minimapColors() {
  const out = new Uint8ClampedArray(N * N * 4);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = (j * N + i) * 4, h = heightAt(i + .5, j + .5);
    if (h < WL) { out[k] = 52; out[k + 1] = 92; out[k + 2] = 118; }
    else { const { w, tint } = groundMix(i, j); for (let c = 0; c < 3; c++) out[k + c] = (AVG[0][c] * w[0] + AVG[1][c] * w[1] + AVG[2][c] * w[2] + AVG[3][c] * w[3]) * Math.min(tint[c], 1.8); }
    if (blocked[j * N + i] === 2) { out[k] = 34; out[k + 1] = 58; out[k + 2] = 30; }
    out[k + 3] = 255;
  }
  return out;
}

// ---------------- water ----------------
function waterNormals() {
  // ripples from tiling fractal noise (no visible stripes or repeats)
  const s = 256, h = tileFbm(s, 6, 5, 77), cv = document.createElement('canvas'); cv.width = cv.height = s;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(s, s), H = (x, y) => h[((y + s) % s) * s + ((x + s) % s)];
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const dx = H(x + 1, y) - H(x - 1, y), dy = H(x, y + 1) - H(x, y - 1), k = (y * s + x) * 4;
    const nx = -dx * 9, ny = -dy * 9, l = Math.hypot(nx, ny, 1);
    img.data[k] = (nx / l * .5 + .5) * 255; img.data[k + 1] = (ny / l * .5 + .5) * 255; img.data[k + 2] = (1 / l * .5 + .5) * 255; img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
export function buildWater(Q) {
  const geo = new THREE.PlaneGeometry(SIZE * 4, SIZE * 4); geo.rotateX(-Math.PI / 2);
  const nm = waterNormals(); nm.repeat.set(1, 1);
  // how deep the water is at each cell (for shallow/deep colour and shoreline foam)
  const dd = new Uint8Array(N * N);
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) dd[z * N + x] = clamp((WL - heightAt(x + .5, z + .5)) / 3, 0, 1) * 255;
  const depthTex = new THREE.DataTexture(dd, N, N, THREE.RedFormat, THREE.UnsignedByteType);
  depthTex.magFilter = depthTex.minFilter = THREE.LinearFilter; depthTex.needsUpdate = true;
  const uniforms = {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    uTime: U.time, tNormal: { value: nm }, tDepth: { value: depthTex }, tReflect: { value: null }, uReflect: { value: 0 }, uTexMat: { value: new THREE.Matrix4() },
    top: SKY.top, mid: SKY.mid, bot: SKY.bot, sunDir: SKY.sun, sunCol: { value: new THREE.Color(0xfff0d0) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, fog: true, depthWrite: false,
    vertexShader: `uniform mat4 uTexMat; varying vec3 vWP; varying vec4 vRefl;
      #include <fog_pars_vertex>
      void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vWP = wp.xyz; vRefl = uTexMat * wp;
        vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `uniform float uTime, uReflect; uniform sampler2D tNormal, tDepth, tReflect; uniform vec3 top, mid, bot, sunDir, sunCol;
      varying vec3 vWP; varying vec4 vRefl;
      #include <common>
      #include <fog_pars_fragment>
      vec3 sky(vec3 d) { float y = d.y; vec3 c = mix(mid, top, pow(clamp(y * 1.6, 0.0, 1.0), .8)); return mix(bot, c, smoothstep(-0.02, 0.18, y)); }
      void main() {
        vec2 p = vWP.xz;
        vec2 n1 = texture2D(tNormal, p * 0.045 + vec2(uTime * 0.010, uTime * 0.007)).xy * 2.0 - 1.0;
        vec2 n2 = texture2D(tNormal, p * 0.13 + vec2(-uTime * 0.016, uTime * 0.012)).xy * 2.0 - 1.0;
        vec2 n3 = texture2D(tNormal, p * 0.41 + vec2(uTime * 0.03, -uTime * 0.022)).xy * 2.0 - 1.0;
        vec2 nxy = n1 * 0.5 + n2 * 0.35 + n3 * 0.22;
        vec3 N = normalize(vec3(nxy.x * 0.55, 1.0, nxy.y * 0.55));
        vec3 V = normalize(cameraPosition - vWP);
        float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
        vec3 R = reflect(-V, N); R.y = abs(R.y);
        vec3 refl = sky(R);
        if (uReflect > 0.5) { vec4 rp = vRefl; rp.xy += nxy * 0.03 * rp.w; refl = texture2DProj(tReflect, rp).rgb; }
        float sd = max(dot(R, sunDir), 0.0);
        vec3 glint = sunCol * (pow(sd, 700.0) * 8.0 + pow(sd, 80.0) * 0.3);
        vec2 duv = vWP.xz / ${SIZE.toFixed(1)};
        float depth = (duv.x < 0.0 || duv.y < 0.0 || duv.x > 1.0 || duv.y > 1.0) ? 1.0 : texture2D(tDepth, duv).r;
        vec3 shallow = vec3(0.09, 0.2, 0.17), deep = vec3(0.01, 0.035, 0.05);
        vec3 body = mix(shallow, deep, smoothstep(0.0, 0.45, depth));
        vec3 col = mix(body, refl, fres) + glint;
        // foam that laps at the shore
        float wave = sin(uTime * 1.3 - depth * 90.0 + nxy.x * 4.0) * 0.5 + 0.5;
        float foam = smoothstep(0.07, 0.0, depth) * smoothstep(0.35, 0.95, wave * (0.6 + 0.5 * n3.y + 0.4));
        col = mix(col, vec3(0.78, 0.8, 0.78), clamp(foam, 0.0, 1.0) * 0.75);
        float alpha = mix(0.45, 0.97, smoothstep(0.0, 0.3, depth));
        alpha = max(alpha, fres * 0.95); alpha = max(alpha, foam * 0.8);
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const m = new THREE.Mesh(geo, mat); m.position.set(SIZE / 2, WL, SIZE / 2); m.renderOrder = 1;
  // High quality: real mirror reflections of the trees, hills and units (rendered at half resolution)
  if (Q.reflect) {
    const rt = new THREE.WebGLRenderTarget(256, 256, { type: THREE.HalfFloatType }), cam = new THREE.PerspectiveCamera();
    const clip = new THREE.Plane(new THREE.Vector3(0, 1, 0), -WL + .02), bias = new THREE.Matrix4().set(.5, 0, 0, .5, 0, .5, 0, .5, 0, 0, .5, .5, 0, 0, 0, 1);
    uniforms.tReflect.value = rt.texture; uniforms.uReflect.value = 1;
    m.userData.reflect = (renderer, scene, camera) => {
      const w = Math.max(1, renderer.domElement.width >> 1), h = Math.max(1, renderer.domElement.height >> 1);
      if (rt.width !== w || rt.height !== h) rt.setSize(w, h);
      camera.updateMatrixWorld();
      const cp = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
      if (cp.y < WL + .05) return;
      const dir = new THREE.Vector3(0, 0, -1).transformDirection(camera.matrixWorld), up = new THREE.Vector3(0, 1, 0).transformDirection(camera.matrixWorld);
      cam.position.set(cp.x, 2 * WL - cp.y, cp.z); cam.up.set(up.x, -up.y, up.z);
      cam.lookAt(cam.position.x + dir.x, cam.position.y - dir.y, cam.position.z + dir.z);
      cam.projectionMatrix.copy(camera.projectionMatrix); cam.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
      cam.layers.set(0); cam.updateMatrixWorld();
      uniforms.uTexMat.value.copy(bias).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
      const prevT = renderer.getRenderTarget(), prevC = renderer.clippingPlanes;
      m.visible = false; renderer.clippingPlanes = [clip]; renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene, cam);
      renderer.setRenderTarget(prevT); renderer.clippingPlanes = prevC; m.visible = true;
    };
  }
  m.userData.update = () => {};
  return m;
}

// ---------------- sky ----------------
export const SKY = { top: { value: new THREE.Color(0x3d78c4) }, mid: { value: new THREE.Color(0x9cc3e6) }, bot: { value: new THREE.Color(0xdfe6e3) }, sun: { value: new THREE.Vector3(-.5, .62, .35).normalize() }, glow: { value: new THREE.Color(1, .9, .7) }, dim: { value: 1 }, tCloud: CLOUDS, uTime: U.time };
export function buildSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: SKY,
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }',
    fragmentShader: `uniform vec3 top, mid, bot, sun, glow; uniform float dim; uniform sampler2D tCloud; uniform float uTime; varying vec3 vD;
      void main(){ vec3 d = normalize(vD); float y = d.y; vec3 c = y > 0.0 ? mix(mid, top, pow(clamp(y*1.6,0.0,1.0), .8)) : bot;
        c = mix(bot, c, smoothstep(-0.02, 0.18, y));
        float s = max(dot(d, sun), 0.0); c += glow * (pow(s, 600.0) * 2.0 + pow(s, 12.0) * .25);
        // drifting clouds projected on a high dome, lit from the sun side
        if (y > 0.0) {
          vec2 uv = d.xz / (y + 0.12) * 0.32 + vec2(uTime * 0.0035, uTime * 0.0018);
          float n = texture2D(tCloud, uv).r * 0.65 + texture2D(tCloud, uv * 2.7 + 0.3).r * 0.35;
          float cl = smoothstep(0.48, 0.78, n) * smoothstep(0.0, 0.25, y);
          vec3 cc = mix(vec3(0.62, 0.66, 0.72), vec3(1.05, 1.02, 0.98), smoothstep(0.5, 0.95, n) * 0.6 + pow(s, 4.0) * 0.4);
          c = mix(c, cc * dim, cl * 0.9);
        }
        gl_FragColor = vec4(c, 1.0); }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(320, 24, 12), mat);
  m.frustumCulled = false; m.renderOrder = -1;
  return m;
}

// ---------------- distant mountains (so the world doesn't end at the map edge) ----------------
export function buildDistant(scene) {
  const g = new THREE.Group(), r = mulberry32(31);
  for (const [R, H, hue, seg] of [[175, 26, .58, 120], [225, 44, .6, 140], [290, 70, .62, 160]]) {
    const geo = new THREE.CylinderGeometry(R, R, 1, seg, 4, true), p = geo.attributes.position, col = new Float32Array(p.count * 3), c = new THREE.Color();
    const ph = r() * 10;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), a = Math.atan2(z, x), t = p.getY(i) + .5; // 0 bottom .. 1 top
      const ridge = .35 + .65 * Math.abs(Math.sin(a * 5 + ph) * .5 + Math.sin(a * 13 + ph * 2) * .3 + Math.sin(a * 31) * .2);
      const y = -8 + t * H * ridge; p.setY(i, y);
      const snow = t > .75 && ridge > .7 ? (t - .75) * 4 : 0;
      c.setHSL(hue, .18, .28 + t * .2).lerp(new THREE.Color(0xe8eef4), Math.min(1, snow)); col.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.BackSide })); m.position.set(SIZE / 2, 0, SIZE / 2); g.add(m);
  }
  scene.add(g); return g;
}

// ---------------- bridge & fish ----------------
export function buildBridge(scene, shadows) {
  const b = new Builder(), ry = Math.PI / 4, ux = Math.SQRT1_2, uz = -Math.SQRT1_2;
  for (let i = 0; i < 14; i++) {
    const u0 = -7 + i, u1 = u0 + 1, h0 = bridgeAt(BRIDGE.x + ux * u0 + .001, BRIDGE.z + uz * u0) , h1 = bridgeAt(BRIDGE.x + ux * Math.min(u1, 6.99), BRIDGE.z + uz * Math.min(u1, 6.99));
    const um = (u0 + u1) / 2, x = BRIDGE.x + ux * um, z = BRIDGE.z + uz * um, y = (h0 + h1) / 2, slope = Math.atan2(h1 - h0, 1);
    b.add(P.box, 0x9a958b, x, y - .14, z, 0, ry, slope, 1.04, .28, 3.3);
    for (const sd of [-1, 1]) b.add(P.box, 0x8a857b, x + Math.SQRT1_2 * sd * 1.55, y + .25, z + Math.SQRT1_2 * sd * 1.55, 0, ry, slope, 1.04, .5, .22);
  }
  for (const u of [-4.5, 0, 4.5]) { const x = BRIDGE.x + ux * u, z = BRIDGE.z + uz * u, top = bridgeAt(x, z) - .3; b.add(P.box, 0x8a857b, x, (top + WL - 2.6) / 2, z, 0, ry, 0, 1.1, top - WL + 2.6, 3.0); }
  const m = new THREE.Mesh(b.build(), M.stone); m.castShadow = shadows; m.receiveShadow = true; scene.add(m);
}
const fishGeo = new THREE.SphereGeometry(.12, 8, 6).scale(.7, .5, 2.2);
export function buildFish(scene) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x3a4a4a, roughness: .4, metalness: .3 });
  for (const r of resources.filter(r => r.fish)) {
    const g = new THREE.Group(); g.position.set(r.x, WL - .18, r.z);
    for (let i = 0; i < 5; i++) { const f = new THREE.Mesh(fishGeo, mat); f.userData.a = i * 1.26; f.userData.rad = .4 + i * .15; g.add(f); }
    scene.add(g); r.mesh = g;
  }
}
export function updateFish(t) {
  for (const r of resources) if (r.fish && r.mesh) for (const f of r.mesh.children) {
    const a = f.userData.a + t * (.6 + f.userData.rad * .3), rr = f.userData.rad * (r.amt / r.max * .5 + .5);
    f.position.set(Math.cos(a) * rr, Math.sin(t * 2 + f.userData.a) * .04, Math.sin(a) * rr); f.rotation.y = -a;
  }
}

// ---------------- trees, berries, gold, decor ----------------
function pineGeo(seed, hi) {
  const b = new Builder(), r = mulberry32(seed);
  b.add(P.cyl(.045, .17, 4.6, 8), 0x4a3424, 0, 2.3, 0);
  const tiers = 9;
  for (let t = 0; t < tiers; t++) {
    const k = t / (tiers - 1), y = 1.1 + k * 3.5, rad = 1.35 * (1 - k * .8) + .1, h = .85 - k * .25;
    const g = P.cone(rad, h, hi ? 14 : 9, hi ? 2 : 1, true);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) { // ragged, drooping branch tips
      const x = pos.getX(i), yy = pos.getY(i), z = pos.getZ(i), a = Math.atan2(z, x), rim = (yy + h / 2) / h;
      const spike = 1 + .22 * Math.sin(a * 7 + t * 1.7) * (1 - rim) + (r() - .5) * .1;
      pos.setXYZ(i, x * spike, yy - (1 - rim) * (1 - rim) * .25 * spike, z * spike);
    }
    g.computeVertexNormals();
    const col = new THREE.Color().setHSL(.29 + r() * .03, .42 + r() * .1, .1 + k * .06 + r() * .02).getHex();
    b.addBaked(shadeAO(bake(g, col, 0, y, 0, 0, r() * 3, 0), -h / 2 + y - .25, h / 2 + y, .4));
  }
  return b.build();
}
/** Point every vertex normal away from a centre: makes a pile of leaf clumps shade like one soft canopy. */
function canopyNormals(g, cx, cy, cz, sy = 1) {
  const p = g.attributes.position, n = g.attributes.normal, v = new THREE.Vector3(), o = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i) - cx, (p.getY(i) - cy) / sy, p.getZ(i) - cz).normalize();
    o.set(n.getX(i), n.getY(i), n.getZ(i)); v.lerp(o, .25).normalize(); n.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
}
function leafClumps(b, seed, cx, cy, cz, rx, ry, rz, n, size, hue = .23, det = 1) {
  const r = mulberry32(seed), g = new Builder();
  for (let i = 0; i < n; i++) {
    const u = r() * 2 - 1, a = r() * TAU, rr = Math.sqrt(1 - u * u), d = .55 + r() * .45;
    const x = cx + Math.cos(a) * rr * rx * d, y = cy + u * ry * d, z = cz + Math.sin(a) * rr * rz * d, s = size * (.7 + r() * .6);
    const col = new THREE.Color().setHSL(hue + r() * .05, .4 + r() * .15, .17 + r() * .07 + (u + 1) * .025).getHex();
    g.addBaked(shadeAO(bake(jitter(P.ico(s, det), s * .25, seed * 31 + i), col, x, y, z, r() * 3, r() * 3, 0), cy - ry, cy + ry * .9, .42, cx, cz, Math.max(rx, rz)));
  }
  b.addBaked(canopyNormals(g.build(), cx, cy, cz, ry / Math.max(rx, rz)));
}
function oakGeo(seed, hi) {
  const b = new Builder(), r = mulberry32(seed);
  b.add(P.cyl(.11, .21, 2.1, 8), 0x524030, 0, 1.05, 0);
  for (let i = 0; i < 5; i++) { const a = i / 5 * 6.28 + r(); b.add(P.cyl(.035, .075, 1.2, 6), 0x524030, Math.cos(a) * .35, 2.1, Math.sin(a) * .35, Math.sin(a) * .75, 0, -Math.cos(a) * .75); }
  leafClumps(b, seed, 0, 2.85, 0, 1.35, .95, 1.35, hi ? 26 : 20, hi ? .48 : .52, .23, hi ? 1 : 0);
  return b.build();
}
function bushGeo() {
  const b = new Builder(), r = mulberry32(3);
  leafClumps(b, 8, 0, .38, 0, .5, .32, .45, 12, .2, .26);
  for (let i = 0; i < 18; i++) { const a = r() * TAU, y = .2 + r() * .4; b.add(P.ball(.045, 6, 4), r() < .7 ? 0xb01e30 : 0x5a1a50, Math.cos(a) * .48, y, Math.sin(a) * .44); }
  return b.build();
}
function mineGeo(seed) {
  const b = new Builder(), r = mulberry32(seed);
  for (let i = 0; i < 8; i++) { const a = r() * TAU, d = r() * 1.1, s = .45 + r() * .45; b.addBaked(shadeAO(bake(jitter(P.ico(s, 1), s * .2, seed + i), 0x777169, Math.cos(a) * d, .15, Math.sin(a) * d, r() * 3, r() * 3, 0, 1, .7 + r() * .4, 1), -.3, 1, .55)); }
  for (let i = 0; i < 18; i++) { const a = r() * TAU, d = r() * 1.25; b.m(P.dode(.08 + r() * .12), 0xf0c040, Math.cos(a) * d, .25 + r() * .55, Math.sin(a) * d, r() * 3, r() * 3, 0); }
  return b.split();
}
function tuftGeo(blades, seed) {
  const pos = [], col = [], r = mulberry32(seed), c0 = new THREE.Color(), c1 = new THREE.Color();
  for (let i = 0; i < blades; i++) {
    const a = r() * Math.PI, w = .025 + r() * .02, h = .22 + r() * .32, ox = (r() - .5) * .3, oz = (r() - .5) * .3, lean = (r() - .5) * .25;
    const ca = Math.cos(a) * w, sa = Math.sin(a) * w, tx = ox + Math.cos(a + 1.57) * lean, tz = oz + Math.sin(a + 1.57) * lean;
    c0.setHSL(.22 + r() * .04, .5, .12); c1.setHSL(.17 + r() * .06, .5 + r() * .15, .3 + r() * .12);
    const tri = [ox - ca, 0, oz - sa, ox + ca, 0, oz + sa, tx, h, tz], rev = [ox + ca, 0, oz + sa, ox - ca, 0, oz - sa, tx, h, tz];
    pos.push(...tri, ...rev); for (let k = 0; k < 2; k++) col.push(c0.r, c0.g, c0.b, c0.r, c0.g, c0.b, c1.r, c1.g, c1.b);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const nrm = new Float32Array(pos.length); for (let i = 0; i < nrm.length; i += 3) nrm[i + 1] = 1; g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return g;
}

// ---- photo-leaf trees: bark trunk + "cards" (flat quads textured with leafy branches) ----
const _mm = new THREE.Matrix4(), _qq = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _vv = new THREE.Vector3(), _ss = new THREE.Vector3();
function uvScale(g, su, sv) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv); return g; }
const bakeM = (geo, hex, m) => bake(geo, hex).applyMatrix4(m);
/** Light every card as part of one soft, rounded crown. */
function crownNormals(g, cx, cy, cz, up = .35) {
  const p = g.attributes.position, n = g.attributes.normal, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.set(p.getX(i) - cx, p.getY(i) - cy, p.getZ(i) - cz).normalize(); v.y += up; v.normalize(); n.setXYZ(i, v.x, v.y, v.z); }
  return g;
}
function barkGeo(parts) { const b = new Builder(); for (const [geo, x, y, z, rx, ry, rz] of parts) b.add(geo, 0xb0a090, x, y, z, rx, ry, rz); return b.build(); }
function cardPine(seed) {
  const r = mulberry32(seed), leaves = new Builder();
  const bark = barkGeo([[uvScale(P.cyl(.04, .19, 4.4, 8), 2, 4.4), 0, 2.2, 0, 0, 0, 0]]);
  const tiers = 11;
  for (let t = 0; t < tiers; t++) {
    const k = t / (tiers - 1), y = .95 + k * 3.95, len = 1.75 * (1 - k * .82) + .3, n = Math.round(8 - k * 4);
    for (let i = 0; i < n; i++) {
      const a = (i + r() * .6) / n * TAU + t * .9, droop = .32 + .25 * (1 - k) + (r() - .5) * .15;
      const g = new THREE.PlaneGeometry(len, len * .5); g.translate(len / 2, 0, 0);
      // lay the branch nearly flat, droop the tip, then swing it round the trunk
      _qq.setFromEuler(new THREE.Euler(Math.PI / 2 - .35 + (r() - .5) * .5, 0, -droop, 'YZX'));
      _q2.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a); _q2.multiply(_qq);
      _mm.compose(_vv.set(Math.cos(a) * .08, y, Math.sin(a) * .08), _q2, _ss.set(1, 1, 1));
      const col = new THREE.Color().setHSL(.3 + r() * .03, .25 + r() * .1, .42 + k * .12 + r() * .08).getHex();
      leaves.addBaked(bakeM(g, col, _mm));
    }
  }
  for (let i = 0; i < 3; i++) { // spire
    const g = new THREE.PlaneGeometry(.7, .45); g.translate(.35, 0, 0);
    _mm.compose(_vv.set(0, 4.6, 0), _qq.setFromEuler(new THREE.Euler(0, i * 2.1, Math.PI / 2)), _ss.set(1, 1, 1));
    leaves.addBaked(bakeM(g, 0x93a884, _mm));
  }
  const lg = leaves.build(); shadeAO(lg, .8, 4.6, .5, 0, 0, 1.6);
  return { bark, leaves: crownNormals(lg, 0, 2.2, 0, .25) };
}
function cardOak(seed) {
  const r = mulberry32(seed), leaves = new Builder(), barkParts = [[uvScale(P.cyl(.12, .22, 2.3, 9), 2, 2.5), 0, 1.15, 0, 0, 0, 0]];
  for (let i = 0; i < 5; i++) { const a = i / 5 * TAU + r(); barkParts.push([uvScale(P.cyl(.035, .08, 1.4, 6), 1, 1.5), Math.cos(a) * .42, 2.3, Math.sin(a) * .42, Math.sin(a) * .8, 0, -Math.cos(a) * .8]); }
  const cx = 0, cy = 3.05, R = [1.65, 1.2, 1.65];
  for (let i = 0; i < 64; i++) {
    const u = r() * 2 - 1, a = r() * TAU, rr = Math.sqrt(1 - u * u), d = .35 + r() * .55;
    const off = new THREE.Vector3(Math.cos(a) * rr * R[0] * d, u * R[1] * d, Math.sin(a) * rr * R[2] * d);
    const out = off.clone().normalize(); out.y += .35; out.normalize();
    const sz = 1.25 + r() * .7, g = new THREE.PlaneGeometry(sz, sz); g.translate(0, sz / 2 - .15, 0);
    _qq.setFromUnitVectors(new THREE.Vector3(0, 1, 0), out); _q2.setFromAxisAngle(out, r() * TAU); _q2.multiply(_qq);
    _mm.compose(_vv.set(cx + off.x * .7, cy + off.y * .7 - .2, cz0 + off.z * .7), _q2, _ss.set(1, 1, 1));
    const col = new THREE.Color().setHSL(.25 + r() * .04, .35 + r() * .1, .32 + (u + 1) * .07 + r() * .06).getHex();
    leaves.addBaked(bakeM(g, col, _mm));
  }
  const lg = leaves.build(); shadeAO(lg, 1.9, 4.3, .45, 0, 0, 1.7);
  return { bark: barkGeo(barkParts), leaves: crownNormals(lg, cx, cy, 0, .4) };
}
const cz0 = 0;
function cardBush() {
  const r = mulberry32(5), leaves = new Builder();
  for (let i = 0; i < 16; i++) {
    const a = r() * TAU, out = new THREE.Vector3(Math.cos(a), .5 + r() * .8, Math.sin(a)).normalize(), sz = .55 + r() * .3;
    const g = new THREE.PlaneGeometry(sz, sz); g.translate(0, sz / 2 - .05, 0);
    _qq.setFromUnitVectors(new THREE.Vector3(0, 1, 0), out); _q2.setFromAxisAngle(out, r() * TAU); _q2.multiply(_qq);
    _mm.compose(_vv.set(Math.cos(a) * .12, .05, Math.sin(a) * .12), _q2, _ss.set(1, 1, 1));
    leaves.addBaked(bakeM(g, new THREE.Color().setHSL(.26, .4, .34 + r() * .1).getHex(), _mm));
  }
  const lg = crownNormals(shadeAO(leaves.build(), 0, .7, .5), 0, .2, 0, .5);
  const berries = new Builder();
  for (let i = 0; i < 22; i++) { const a = r() * TAU, y = .15 + r() * .45, d = .25 + r() * .25; berries.add(P.ball(.045, 6, 4), r() < .7 ? 0xb01e30 : 0x5a1a50, Math.cos(a) * d, y, Math.sin(a) * d); }
  return { bark: berries.build(), leaves: lg };
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color(), UP = new THREE.Vector3(0, 1, 0);
export function buildResources(scene, Q) {
  const shadows = Q.shadow > 0;
  const trees = resources.filter(r => r.rt === 'w'), berries = resources.filter(r => r.rt === 'f' && !r.fish);
  if (M.photo) {
    // photo-leaf trees: each species is a pair of instanced meshes (bark + leaves) that share placements
    const mk = (src, cap) => { const pair = [new THREE.InstancedMesh(src.bark, src.barkMat || M.bark, cap), new THREE.InstancedMesh(src.leaves, src.leafMat, cap)]; for (const m of pair) { m.count = 0; m.castShadow = shadows; m.receiveShadow = shadows; scene.add(m); } return pair; };
    // a custom model (tools/models.py) replaces the built-in tree: one instanced mesh per material
    const mkGM = (slot, cap) => GM[slot].parts.map(p => { const m = new THREE.InstancedMesh(p.geo, p.mat, cap); m.count = 0; m.castShadow = shadows; m.receiveShadow = shadows; scene.add(m); return m; });
    const pineA = GM.tree_pine ? mkGM('tree_pine', trees.length) : null, oakA = GM.tree_oak ? mkGM('tree_oak', trees.length) : null;
    const kinds = [pineA || mk({ ...cardPine(1), leafMat: M.needles }, trees.length), pineA || mk({ ...cardPine(2), leafMat: M.needles }, trees.length),
      oakA || mk({ ...cardOak(3), leafMat: M.leaves }, trees.length), oakA || mk({ ...cardOak(4), leafMat: M.leaves }, trees.length)];
    for (const t of trees) {
      const h = hash2(t.x * 3.1, t.z * 1.7), oak = t.y < 4.5 && h < .45, pair = kinds[(oak ? 2 : 0) + (hash2(t.z, t.x * 2) < .5 ? 0 : 1)];
      const i = pair[0].count; for (const m of pair) m.count = i + 1;
      const sc = .7 + hash2(t.z, t.x) * .45;
      _q.setFromAxisAngle(UP, h * 40); _m.compose(_v.set(t.x, t.y - .1, t.z), _q, _s.set(sc, sc * (.85 + h * .35), sc));
      _c.setHSL(.06 * (hash2(t.x, 5) - .5), .2 * hash2(t.z, 7), .85 + hash2(t.x, 9) * .3);
      for (const m of pair) { m.setMatrixAt(i, _m); m.setColorAt(i, _c); }
      t.inst = { meshes: pair, i };
    }
    const bpair = GM.bush ? mkGM('bush', berries.length) : mk({ ...cardBush(), barkMat: M.vc, leafMat: M.leaves }, berries.length);
    berries.forEach((b, i) => { _q.setFromAxisAngle(UP, i * 2.1); _m.compose(_v.set(b.x, b.y - .05, b.z), _q, _s.set(1, 1, 1)); for (const m of bpair) { m.setMatrixAt(i, _m); m.count = berries.length; } b.inst = { meshes: bpair, i }; });
  } else {
  // two shapes of each species so forests don't look copy-pasted
    const hi = Q.grass > 5000, kinds = [pineGeo(1, hi), pineGeo(2, hi), oakGeo(3, hi), oakGeo(4, hi)].map(g => { const m = new THREE.InstancedMesh(g, M.foliage, trees.length); m.count = 0; return m; });
    for (const t of trees) {
      const h = hash2(t.x * 3.1, t.z * 1.7), oak = t.y < 4.5 && h < .45, mesh = kinds[(oak ? 2 : 0) + (hash2(t.z, t.x * 2) < .5 ? 0 : 1)];
      const i = mesh.count++, sc = .7 + hash2(t.z, t.x) * .45;
      _q.setFromAxisAngle(UP, h * 40); _v.set(t.x, t.y - .1, t.z); _s.set(sc, sc * (.85 + h * .35), sc);
      _m.compose(_v, _q, _s); mesh.setMatrixAt(i, _m);
      _c.setHSL(.1 * (hash2(t.x, 5) - .5), .15 * hash2(t.z, 7), .82 + hash2(t.x, 9) * .3); mesh.setColorAt(i, _c);
      t.inst = { mesh, i };
    }
    const bushes = new THREE.InstancedMesh(bushGeo(), M.foliage, berries.length);
    berries.forEach((b, i) => { _q.setFromAxisAngle(UP, i * 2.1); _m.compose(_v.set(b.x, b.y - .05, b.z), _q, _s.set(1, 1, 1)); bushes.setMatrixAt(i, _m); b.inst = { mesh: bushes, i }; });
    for (const m of [...kinds, bushes]) { m.castShadow = shadows; m.receiveShadow = shadows; scene.add(m); }
  }
  for (const g of resources.filter(r => r.rt === 'g')) {
    const { c, m } = mineGeo(g.id), grp = new THREE.Group();
    grp.add(new THREE.Mesh(c, M.stone), new THREE.Mesh(m, M.metal));
    grp.children.forEach(o => { o.castShadow = shadows; o.receiveShadow = true; });
    grp.position.set(g.x, heightAt(g.x, g.z), g.z); scene.add(grp); g.mesh = grp;
  }
  // decoration: rocks and grass (not obstacles)
  const r = mulberry32(99), rocks = [], tufts = [];
  for (let k = 0; k < 320; k++) {
    const x = 5 + r() * 118, z = 5 + r() * 118, h = heightAt(x, z);
    if (h < WL + .3 || nearBase(x, z, 10) || distToRoad(x, z) < 2.5) continue; rocks.push([x, z, .12 + r() * r() * .7]);
  }
  const want = Q.grass;
  for (let k = 0; k < want * 3 && tufts.length < want; k++) {
    const x = 4 + r() * 120, z = 4 + r() * 120, h = heightAt(x, z), cx = x | 0, cz = z | 0;
    if (h < WL + .6 || h > 9 || blocked[cz * N + cx] === 1 || distToRoad(x, z) < 2.2 || nearBase(x, z, 6)) continue;
    tufts.push([x, z]);
  }
  const rockGeo = shadeAO(bake(jitter(P.ico(1, 1), .18, 5), 0x8a857c), -.6, .8, .6);
  const rockMesh = new THREE.InstancedMesh(rockGeo, M.stone, rocks.length);
  rocks.forEach(([x, z, s], i) => { _q.setFromEuler(new THREE.Euler(r() * 3, r() * 3, 0)); _m.compose(_v.set(x, heightAt(x, z) - s * .15, z), _q, _s.set(s, s * .55, s * (.8 + r() * .4))); rockMesh.setMatrixAt(i, _m); _c.setHSL(.08, .05 + r() * .08, .75 + r() * .35); rockMesh.setColorAt(i, _c); });
  rockMesh.castShadow = shadows; rockMesh.receiveShadow = true; scene.add(rockMesh);
  if (tufts.length) {
    const tm = new THREE.InstancedMesh(tuftGeo(Q.grass > 5000 ? 9 : 6, 7), M.grass, tufts.length);
    tufts.forEach(([x, z], i) => { const s = .6 + r() * .9; _q.setFromAxisAngle(UP, r() * 6); _m.compose(_v.set(x, heightAt(x, z) - .03, z), _q, _s.set(s, s * (.7 + r() * .6), s)); tm.setMatrixAt(i, _m); });
    tm.receiveShadow = shadows; tm.layers.set(1); scene.add(tm);
  }
}

/** Take amount from a resource; removes it from the map when empty. Returns amount taken. */
export function takeRes(res, amt) {
  const got = Math.min(amt, res.amt); res.amt -= got;
  if (res.amt <= 0 && res.alive) {
    res.alive = false;
    for (const c of res.cells) { blocked[c] = 0; resCell[c] = null; }
    if (res.inst) { _m.makeScale(0, 0, 0); for (const m of res.inst.meshes || [res.inst.mesh]) { m.setMatrixAt(res.inst.i, _m); m.instanceMatrix.needsUpdate = true; } }
    if (res.mesh) res.mesh.removeFromParent();
    res.onDeplete?.();
  } else if (res.rt === 'g' && res.mesh) res.mesh.scale.setScalar(.6 + .4 * res.amt / res.max);
  return got;
}
