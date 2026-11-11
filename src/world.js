// The map: heightfield, walkability grid, resources (trees, berries, gold), decoration, water and sky.
import * as THREE from 'three';
import { clamp, lerp, smooth, fbm, vnoise, hash2, mulberry32, segDist, TAU } from './util.js';
import { Builder, P, vcMat, vcMatFlat } from './geo.js';

export const SIZE = 128, N = SIZE, HN = SIZE + 1;
export const WL = -0.45;
export const BASES = [{ x: 24, z: 104 }, { x: 104, z: 24 }];
const LAKES = [[40, 40, 8.5], [88, 88, 8.5]];
const ROADS = [[[24, 104], [44, 76], [64, 64], [84, 52], [104, 24]], [[24, 104], [16, 64], [40, 22], [104, 24]], [[24, 104], [88, 112], [112, 64], [104, 24]]];

// ---------------- heights ----------------
function distToRoad(x, z) {
  let best = 1e9;
  for (const r of ROADS) for (let i = 0; i < r.length - 1; i++) best = Math.min(best, segDist(x, z, r[i][0], r[i][1], r[i + 1][0], r[i + 1][1]));
  return best + (vnoise(x * .15, z * .15) - .5) * 1.2;
}
function rawH(x, z) {
  let h = 1.0 + (fbm(x * .022 + 11, z * .022) - .5) * 7 + (fbm(x * .09 + 40, z * .09) - .5) * 1.4;
  const e = Math.min(x, z, SIZE - x, SIZE - z);
  if (e < 14) { const k = (14 - e) / 14; h += k * k * 20 * (.55 + .9 * fbm(x * .06 + 7, z * .06)); }
  for (const b of BASES) { const d = Math.hypot(x - b.x, z - b.z); if (d < 20) h = lerp(h, 1.0, smooth(clamp((20 - d) / 8, 0, 1))); }
  h = Math.max(h, WL + .4);
  const rd = distToRoad(x, z); if (rd < 4) h = lerp(h, h * .7 + .35, smooth((4 - rd) / 4) * .7);
  for (const [lx, lz, lr] of LAKES) {
    const d = Math.hypot(x - lx, z - lz) + (vnoise(x * .2, z * .2) - .5) * 4;
    if (d < lr + 4) h = lerp(h, WL - 2.2, smooth(clamp((lr + 4 - d) / 6, 0, 1)));
  }
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
export const isLand = (cx, cz) => cx >= 0 && cz >= 0 && cx < N && cz < N && blocked[cz * N + cx] !== 1;
for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
  const e = Math.min(x + .5, z + .5, SIZE - .5 - x, SIZE - .5 - z);
  const h = [hgt[z * HN + x], hgt[z * HN + x + 1], hgt[(z + 1) * HN + x], hgt[(z + 1) * HN + x + 1]];
  const sl = Math.max(...h) - Math.min(...h), avg = (h[0] + h[1] + h[2] + h[3]) / 4;
  if (e < 4.5 || sl > 1.15 || avg < WL - .25) blocked[z * N + x] = 1;
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
  if (distToRoad(cx + .5, cz + .5) < 3) return;
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
mirror(addMine, 52, 52, 3000);
for (const [x, z] of [[58, 92], [SIZE - 58, SIZE - 92]]) berryPatch(x, z, 6);
const groves = [[12, 72, 7], [46, 120, 6], [30, 84, 3.5], [44, 62, 6], [68, 98, 6], [18, 44, 7], [86, 118, 6], [64, 22, 5]];
for (const [gx, gz, gr] of groves) for (let k = 0; k < gr * gr * 1.7; k++) {
  const a = R() * TAU, d = Math.sqrt(R()) * gr, x = gx + Math.cos(a) * d, z = gz + Math.sin(a) * d;
  if (!nearBase(x, z, 13) && !nearBase(SIZE - x, SIZE - z, 13)) mirror(addTree, x, z);
}
for (let k = 0; k < 170; k++) { const x = rr(6, 122), z = rr(6, 122); if (z > SIZE - x) continue; if (!nearBase(x, z, 14) && !nearBase(SIZE - x, SIZE - z, 14)) mirror(addTree, x, z); }
for (const r of resources) r.y = heightAt(r.x, r.z);

// ---------------- terrain mesh ----------------
function groundColor(i, j, out) {
  const h = hgt[j * HN + i];
  const sl = Math.hypot(hgt[j * HN + Math.min(i + 1, HN - 1)] - hgt[j * HN + Math.max(i - 1, 0)], hgt[Math.min(j + 1, HN - 1) * HN + i] - hgt[Math.max(j - 1, 0) * HN + i]) / 2;
  const n = fbm(i * .07, j * .07, 3), n2 = vnoise(i * .4, j * .4);
  let r = lerp(.36, .52, n), g = lerp(.50, .60, n), b = lerp(.20, .27, n);              // meadow
  const dry = smooth(clamp((fbm(i * .03 + 50, j * .03) - .45) * 4, 0, 1));                // patches of dry grass
  r = lerp(r, .62, dry * .5); g = lerp(g, .60, dry * .35); b = lerp(b, .30, dry * .3);
  const rd = distToRoad(i, j); if (rd < 2.6) { const t = smooth(clamp((2.6 - rd) / 1.2, 0, 1)) * (.75 + .25 * n2); r = lerp(r, .60, t); g = lerp(g, .50, t); b = lerp(b, .36, t); }
  for (const bs of BASES) { const d = Math.hypot(i - bs.x, j - bs.z); if (d < 9) { const t = smooth(clamp((9 - d) / 4, 0, 1)) * .55 * (.6 + .4 * n2); r = lerp(r, .58, t); g = lerp(g, .50, t); b = lerp(b, .37, t); } }
  if (h < WL + .8) { const t = clamp((WL + .8 - h) / .7, 0, 1); r = lerp(r, .70, t); g = lerp(g, .64, t); b = lerp(b, .48, t); }
  if (sl > .5) { const t = clamp((sl - .5) / .5, 0, 1); r = lerp(r, .52, t); g = lerp(g, .49, t); b = lerp(b, .45, t); }
  if (h > 12) { const t = clamp((h - 12) / 4, 0, 1); r = lerp(r, .95, t); g = lerp(g, .96, t); b = lerp(b, .98, t); }
  out.setRGB(r, g, b, THREE.SRGBColorSpace);
  return out;
}
function detailTexture() {
  const s = 256, cv = document.createElement('canvas'); cv.width = cv.height = s;
  const ctx = cv.getContext('2d'); ctx.fillStyle = '#d6d6d6'; ctx.fillRect(0, 0, s, s);
  const r = mulberry32(5);
  for (let i = 0; i < 2600; i++) {
    const x = r() * s, y = r() * s, l = 2 + r() * 5, a = -Math.PI / 2 + (r() - .5) * .9, v = 150 + r() * 105 | 0;
    ctx.strokeStyle = `rgb(${v},${v},${v})`; ctx.lineWidth = .6 + r();
    for (const ox of [-s, 0, s]) for (const oy of [-s, 0, s]) { ctx.beginPath(); ctx.moveTo(x + ox, y + oy); ctx.lineTo(x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l); ctx.stroke(); }
  }
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4; return t;
}
export function buildTerrain() {
  const pos = new Float32Array(HN * HN * 3), col = new Float32Array(HN * HN * 3), uv = new Float32Array(HN * HN * 2), c = new THREE.Color();
  for (let j = 0; j < HN; j++) for (let i = 0; i < HN; i++) {
    const k = j * HN + i; pos[k * 3] = i; pos[k * 3 + 1] = hgt[k]; pos[k * 3 + 2] = j;
    groundColor(i, j, c); col[k * 3] = c.r * 1.12; col[k * 3 + 1] = c.g * 1.12; col[k * 3 + 2] = c.b * 1.12;
    uv[k * 2] = i / 3; uv[k * 2 + 1] = j / 3;
  }
  const idx = new Uint32Array(SIZE * SIZE * 6); let p = 0;
  for (let j = 0; j < SIZE; j++) for (let i = 0; i < SIZE; i++) {
    const a = j * HN + i, b = a + 1, cc = a + HN, d = cc + 1;
    idx[p++] = a; idx[p++] = cc; idx[p++] = d; idx[p++] = a; idx[p++] = d; idx[p++] = b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, map: detailTexture() }));
  mesh.receiveShadow = true; mesh.name = 'terrain';
  return mesh;
}
export function minimapColors() {
  const c = new THREE.Color(), out = new Uint8ClampedArray(N * N * 4);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    groundColor(i, j, c); c.convertLinearToSRGB();
    const k = (j * N + i) * 4, h = heightAt(i + .5, j + .5);
    if (h < WL) { out[k] = 60; out[k + 1] = 100; out[k + 2] = 130; }
    else { out[k] = c.r * 255; out[k + 1] = c.g * 255; out[k + 2] = c.b * 255; }
    if (blocked[j * N + i] === 2) { out[k] = 38; out[k + 1] = 70; out[k + 2] = 34; }
    out[k + 3] = 255;
  }
  return out;
}

// ---------------- water ----------------
function waterNormals() {
  const s = 128, cv = document.createElement('canvas'); cv.width = cv.height = s;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(s, s);
  const H = (x, y) => { const u = x / s * TAU, v = y / s * TAU; return Math.sin(u * 3 + v * 2) + .6 * Math.sin(u * 5 - v * 4 + 1) + .4 * Math.sin(-u * 7 + v * 9 + 2) + .3 * Math.sin(u * 11 + v * 13); };
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const dx = H(x + 1, y) - H(x - 1, y), dy = H(x, y + 1) - H(x, y - 1), k = (y * s + x) * 4;
    const nx = -dx * .35, ny = -dy * .35, l = Math.hypot(nx, ny, 1);
    img.data[k] = (nx / l * .5 + .5) * 255; img.data[k + 1] = (ny / l * .5 + .5) * 255; img.data[k + 2] = (1 / l * .5 + .5) * 255; img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(24, 24); return t;
}
export function buildWater() {
  const geo = new THREE.PlaneGeometry(SIZE * 3, SIZE * 3); geo.rotateX(-Math.PI / 2);
  const nm = waterNormals();
  const mat = new THREE.MeshPhongMaterial({ color: 0x2f6680, specular: 0xcfe6ff, shininess: 120, transparent: true, opacity: .82, normalMap: nm, normalScale: new THREE.Vector2(.6, .6) });
  const m = new THREE.Mesh(geo, mat); m.position.set(SIZE / 2, WL, SIZE / 2); m.receiveShadow = true;
  m.userData.update = t => { nm.offset.set(t * .006, t * .004); };
  return m;
}

// ---------------- sky ----------------
export function buildSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x3d78c4) }, mid: { value: new THREE.Color(0x9cc3e6) }, bot: { value: new THREE.Color(0xdfe6e3) }, sun: { value: new THREE.Vector3(-.5, .55, .35).normalize() } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }',
    fragmentShader: `uniform vec3 top, mid, bot, sun; varying vec3 vD;
      void main(){ float y = vD.y; vec3 c = y > 0.0 ? mix(mid, top, pow(clamp(y*1.6,0.0,1.0), .8)) : bot;
        c = mix(bot, c, smoothstep(-0.02, 0.18, y));
        float s = max(dot(normalize(vD), sun), 0.0); c += vec3(1.0,.9,.7) * (pow(s, 600.0) * 2.0 + pow(s, 12.0) * .25);
        gl_FragColor = vec4(c, 1.0); }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(320, 24, 12), mat);
  m.frustumCulled = false; m.renderOrder = -1;
  return m;
}

// ---------------- trees, berries, gold, decor ----------------
function pineGeo() {
  const b = new Builder();
  b.add(P.cyl(.07, .12, .9, 6), 0x5b3b1f, 0, .45, 0);
  b.add(P.cone(.95, 1.4, 8), 0x2f5a2a, 0, 1.35, 0);
  b.add(P.cone(.75, 1.2, 8), 0x356632, 0, 1.95, 0);
  b.add(P.cone(.5, 1.0, 8), 0x3c7038, 0, 2.5, 0);
  return b.build();
}
function oakGeo() {
  const b = new Builder();
  b.add(P.cyl(.09, .15, 1.2, 6), 0x5e4024, 0, .6, 0);
  b.add(P.cyl(.04, .06, .6, 5), 0x5e4024, .2, 1.2, 0, 0, 0, -.7);
  b.add(P.ico(.75, 1), 0x4a7a32, 0, 1.75, 0);
  b.add(P.ico(.55, 1), 0x568a38, .45, 1.55, .2);
  b.add(P.ico(.55, 1), 0x426e2c, -.4, 1.6, -.25);
  b.add(P.ico(.45, 1), 0x5a903c, .05, 2.25, .1);
  return b.build();
}
function bushGeo() {
  const b = new Builder();
  b.add(P.ico(.42, 1), 0x3d6a2c, 0, .3, 0, 0, 0, 0, 1, .8, 1);
  b.add(P.ico(.3, 0), 0x4a7a34, .22, .38, .1);
  const r = mulberry32(3);
  for (let i = 0; i < 9; i++) { const a = r() * TAU, y = .2 + r() * .35; b.add(P.ball(.06, 5, 4), 0xc0283a, Math.cos(a) * .36, y, Math.sin(a) * .36); }
  return b.build();
}
function mineGeo(seed) {
  const b = new Builder(), r = mulberry32(seed);
  for (let i = 0; i < 7; i++) { const a = r() * TAU, d = r() * 1.1; b.add(P.dode(.45 + r() * .4), 0x77736c, Math.cos(a) * d, .2, Math.sin(a) * d, r() * 3, r() * 3, 0, 1, .7 + r() * .4, 1); }
  for (let i = 0; i < 14; i++) { const a = r() * TAU, d = r() * 1.3; b.add(P.dode(.12 + r() * .12), 0xf2c23a, Math.cos(a) * d, .25 + r() * .5, Math.sin(a) * d, r() * 3, r() * 3, 0); }
  return b.build();
}
function tuftGeo() {
  const pos = [], col = [], c0 = new THREE.Color(0x3f6a22), c1 = new THREE.Color(0x8bb04a);
  for (let i = 0; i < 3; i++) {
    const a = i / 3 * Math.PI + .3, ca = Math.cos(a) * .12, sa = Math.sin(a) * .12, lean = (i - 1) * .06;
    const h = .3 + i * .04;
    // both windings so each blade is front-facing from either side (normals all point up = evenly lit)
    pos.push(-ca, 0, -sa, ca, 0, sa, lean, h, 0, ca, 0, sa, -ca, 0, -sa, lean, h, 0);
    col.push(c0.r, c0.g, c0.b, c0.r, c0.g, c0.b, c1.r, c1.g, c1.b, c0.r, c0.g, c0.b, c0.r, c0.g, c0.b, c1.r, c1.g, c1.b);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals(); for (let i = 0; i < g.attributes.normal.count; i++) g.attributes.normal.setXYZ(i, 0, 1, 0);
  return g;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color(), UP = new THREE.Vector3(0, 1, 0);
export function buildResources(scene, Q) {
  const trees = resources.filter(r => r.rt === 'w'), berries = resources.filter(r => r.rt === 'f');
  const pines = new THREE.InstancedMesh(pineGeo(), vcMat, trees.length), oaks = new THREE.InstancedMesh(oakGeo(), vcMatFlat, trees.length);
  let np = 0, no = 0;
  for (const t of trees) {
    const h = hash2(t.x * 3.1, t.z * 1.7), oak = t.y < 4.5 && h < .45;
    const mesh = oak ? oaks : pines, i = oak ? no++ : np++, sc = .85 + hash2(t.z, t.x) * .5;
    _q.setFromAxisAngle(UP, h * 40); _v.set(t.x, t.y - .05, t.z); _s.set(sc, sc * (.9 + h * .3), sc);
    _m.compose(_v, _q, _s); mesh.setMatrixAt(i, _m);
    _c.setHSL(.0, 0, .85 + hash2(t.x, 9) * .3); mesh.setColorAt(i, _c);
    t.inst = { mesh, i, m: _m.clone() };
  }
  pines.count = np; oaks.count = no;
  const bushes = new THREE.InstancedMesh(bushGeo(), vcMatFlat, berries.length);
  berries.forEach((b, i) => { _q.setFromAxisAngle(UP, i * 2.1); _m.compose(_v.set(b.x, b.y - .05, b.z), _q, _s.set(1, 1, 1)); bushes.setMatrixAt(i, _m); b.inst = { mesh: bushes, i, m: _m.clone() }; });
  for (const m of [pines, oaks, bushes]) { m.castShadow = Q.shadow > 0; m.receiveShadow = false; scene.add(m); }
  for (const g of resources.filter(r => r.rt === 'g')) {
    const m = new THREE.Mesh(mineGeo(g.id), vcMatFlat); m.position.set(g.x, heightAt(g.x, g.z), g.z); m.castShadow = Q.shadow > 0; m.receiveShadow = true; scene.add(m); g.mesh = m;
  }
  // decoration: rocks and grass tufts (not obstacles)
  const r = mulberry32(99), rocks = [], tufts = [];
  for (let k = 0; k < 260; k++) {
    const x = 5 + r() * 118, z = 5 + r() * 118, h = heightAt(x, z);
    if (h < WL + .3 || nearBase(x, z, 10) || distToRoad(x, z) < 2.5) continue; rocks.push([x, z, .15 + r() * r() * .6]);
  }
  const want = Q.grass;
  for (let k = 0; k < want * 3 && tufts.length < want; k++) {
    const x = 4 + r() * 120, z = 4 + r() * 120, h = heightAt(x, z), cx = x | 0, cz = z | 0;
    if (h < WL + .6 || h > 9 || blocked[cz * N + cx] === 1 || distToRoad(x, z) < 2.2 || nearBase(x, z, 7)) continue;
    tufts.push([x, z]);
  }
  const rockMesh = new THREE.InstancedMesh(new Builder().add(P.dode(1), 0x8a857c).build(), vcMatFlat, rocks.length);
  rocks.forEach(([x, z, s], i) => { _q.setFromEuler(new THREE.Euler(r() * 3, r() * 3, 0)); _m.compose(_v.set(x, heightAt(x, z), z), _q, _s.set(s, s * .6, s)); rockMesh.setMatrixAt(i, _m); });
  rockMesh.castShadow = Q.shadow > 0; rockMesh.receiveShadow = true; scene.add(rockMesh);
  if (tufts.length) {
    const tm = new THREE.InstancedMesh(tuftGeo(), new THREE.MeshLambertMaterial({ vertexColors: true }), tufts.length);
    tufts.forEach(([x, z], i) => { const s = .7 + r() * .8; _q.setFromAxisAngle(UP, r() * 6); _m.compose(_v.set(x, heightAt(x, z) - .03, z), _q, _s.set(s, s, s)); tm.setMatrixAt(i, _m); });
    scene.add(tm);
  }
}

/** Take amount from a resource; removes it from the map when empty. Returns amount taken. */
export function takeRes(res, amt) {
  const got = Math.min(amt, res.amt); res.amt -= got;
  if (res.amt <= 0 && res.alive) {
    res.alive = false;
    for (const c of res.cells) { blocked[c] = 0; resCell[c] = null; }
    if (res.inst) { _m.makeScale(0, 0, 0); res.inst.mesh.setMatrixAt(res.inst.i, _m); res.inst.mesh.instanceMatrix.needsUpdate = true; }
    if (res.mesh) res.mesh.removeFromParent();
    res.onDeplete?.();
  } else if (res.rt === 'g' && res.mesh) res.mesh.scale.setScalar(.6 + .4 * res.amt / res.max);
  return got;
}
