// The map: heightfield, walkability grid, resources (trees, berries, gold), decoration, water and sky.
import * as THREE from 'three';
import { clamp, lerp, smooth, fbm, vnoise, hash2, mulberry32, segDist, TAU } from './util.js';
import { Builder, P, M, bake, jitter, shadeAO } from './geo.js';

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
    Object.assign(sh.uniforms, { tG: { value: tex.grass }, tD: { value: tex.dirt }, tR: { value: tex.rock }, tS: { value: tex.sand } });
    sh.vertexShader = 'attribute vec4 splat; varying vec4 vSplat; varying vec2 vXZ;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vSplat = splat; vXZ = position.xz;');
    sh.fragmentShader = 'uniform sampler2D tG, tD, tR, tS; varying vec4 vSplat; varying vec2 vXZ;\n' + sh.fragmentShader.replace('#include <map_fragment>', `
      vec2 u1 = vXZ * 0.3, u2 = vec2(vXZ.y, -vXZ.x) * 0.083 + 0.37;
      vec3 cg = mix(texture2D(tG, u1).rgb, texture2D(tG, u2).rgb, 0.4);
      vec3 cd = mix(texture2D(tD, u1 * 0.9).rgb, texture2D(tD, u2).rgb, 0.35);
      vec3 cr = mix(texture2D(tR, u1 * 0.5).rgb, texture2D(tR, u2).rgb, 0.4);
      vec3 cs = texture2D(tS, u1).rgb;
      float macro = 0.6 + 0.4 * texture2D(tG, vXZ * 0.013).g / 0.13;
      vec3 ground = cg * vSplat.x + cd * vSplat.y + cr * vSplat.z + cs * vSplat.w;
      diffuseColor.rgb *= ground * clamp(macro, 0.75, 1.25) * 1.9;`);
  };
  mat.customProgramCacheKey = () => 'terrain';
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
  const mat = M.pbr
    ? new THREE.MeshStandardMaterial({ color: 0x1d4656, roughness: .06, metalness: .1, transparent: true, opacity: .86, normalMap: nm, normalScale: new THREE.Vector2(.35, .35) })
    : new THREE.MeshPhongMaterial({ color: 0x2f6680, specular: 0xcfe6ff, shininess: 120, transparent: true, opacity: .82, normalMap: nm, normalScale: new THREE.Vector2(.6, .6) });
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
    c0.setHSL(.24 + r() * .04, .45, .13); c1.setHSL(.2 + r() * .07, .45 + r() * .15, .3 + r() * .15);
    const tri = [ox - ca, 0, oz - sa, ox + ca, 0, oz + sa, tx, h, tz], rev = [ox + ca, 0, oz + sa, ox - ca, 0, oz - sa, tx, h, tz];
    pos.push(...tri, ...rev); for (let k = 0; k < 2; k++) col.push(c0.r, c0.g, c0.b, c0.r, c0.g, c0.b, c1.r, c1.g, c1.b);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const nrm = new Float32Array(pos.length); for (let i = 0; i < nrm.length; i += 3) nrm[i + 1] = 1; g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return g;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color(), UP = new THREE.Vector3(0, 1, 0);
export function buildResources(scene, Q) {
  const shadows = Q.shadow > 0;
  const trees = resources.filter(r => r.rt === 'w'), berries = resources.filter(r => r.rt === 'f');
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
    tm.receiveShadow = shadows; scene.add(tm);
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
