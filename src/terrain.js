// Terrain, water, trees. Noise and height shaping ported from prototype/Bannerfall-prototype.html.
import * as THREE from 'three';

export const SIZE = 128;          // world is SIZE x SIZE metres, x/z from 0..SIZE
export const WL = -0.45;          // water level
export const BASES = [{ x: 24, z: 104 }, { x: 104, z: 24 }]; // [player (blue), enemy (red)]
const LAKES = [[40, 44, 8], [88, 84, 8]];
const N = SIZE + 1;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);
export function mulberry32(a) {
  return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function hash2(x, y) { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123; return h - Math.floor(h); }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, o = 4) { let s = 0, a = .5, f = 1, n = 0; for (let i = 0; i < o; i++) { s += a * vnoise(x * f + i * 17.3, y * f - i * 9.1); n += a; f *= 2; a *= .5; } return s / n; }

function rawH(x, z) {
  let h = 1.0 + (fbm(x * .022 + 11, z * .022) - .5) * 7 + (fbm(x * .09 + 40, z * .09) - .5) * 1.4;
  const e = Math.min(x, z, SIZE - x, SIZE - z);
  if (e < 14) { const k = (14 - e) / 14; h += k * k * 20 * (.55 + .9 * fbm(x * .06 + 7, z * .06)); }
  for (const b of BASES) { const d = Math.hypot(x - b.x, z - b.z); if (d < 18) h = lerp(h, 1.0, smooth(clamp((18 - d) / 8, 0, 1))); }
  h = Math.max(h, WL + .4);
  for (const [lx, lz, lr] of LAKES) {
    const d = Math.hypot(x - lx, z - lz) + (vnoise(x * .2, z * .2) - .5) * 4;
    if (d < lr + 4) h = lerp(h, WL - 2.2, smooth(clamp((lr + 4 - d) / 6, 0, 1)));
  }
  return h;
}

const H = new Float32Array(N * N);
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) H[j * N + i] = rawH(i, j);

/** Ground height at any point (matches the rendered triangles exactly). */
export function heightAt(x, z) {
  x = clamp(x, 0, SIZE - 0.001); z = clamp(z, 0, SIZE - 0.001);
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
  const h00 = H[j * N + i], h10 = H[j * N + i + 1], h01 = H[(j + 1) * N + i], h11 = H[(j + 1) * N + i + 1];
  if (fz >= fx) return h00 + (h11 - h01) * fx + (h01 - h00) * fz;
  return h00 + (h10 - h00) * fx + (h11 - h10) * fz;
}

const treeCell = new Uint8Array(SIZE * SIZE);

/** Can a unit stand here? (inside map, not deep water, not a cliff, not a tree) */
export function walkable(x, z) {
  if (x < 3 || z < 3 || x > SIZE - 3 || z > SIZE - 3) return false;
  if (heightAt(x, z) < WL - 0.35) return false;
  const gx = heightAt(x + .3, z) - heightAt(x - .3, z), gz = heightAt(x, z + .3) - heightAt(x, z - .3);
  if (Math.hypot(gx, gz) / 0.6 > 1.25) return false;
  if (treeCell[(z | 0) * SIZE + (x | 0)]) return false;
  return true;
}

export function buildTerrain() {
  const pos = new Float32Array(N * N * 3), col = new Float32Array(N * N * 3), c = new THREE.Color();
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i, h = H[k];
    pos[k * 3] = i; pos[k * 3 + 1] = h; pos[k * 3 + 2] = j;
    const sl = Math.hypot(H[j * N + Math.min(i + 1, N - 1)] - H[j * N + Math.max(i - 1, 0)], H[Math.min(j + 1, N - 1) * N + i] - H[Math.max(j - 1, 0) * N + i]) / 2;
    const n = fbm(i * .08, j * .08, 3);
    let r = lerp(.30, .46, n), g = lerp(.43, .53, n), b = lerp(.17, .25, n);           // grass
    if (h < WL + .7) { const t = clamp((WL + .7 - h) / .6, 0, 1); r = lerp(r, .62, t); g = lerp(g, .56, t); b = lerp(b, .40, t); } // shore sand
    if (sl > .55) { const t = clamp((sl - .55) / .5, 0, 1); r = lerp(r, .47, t); g = lerp(g, .44, t); b = lerp(b, .40, t); }   // rock
    if (h > 13) { const t = clamp((h - 13) / 4, 0, 1); r = lerp(r, .92, t); g = lerp(g, .93, t); b = lerp(b, .95, t); }       // snow caps
    c.setRGB(r, g, b, THREE.SRGBColorSpace);
    col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
  }
  const idx = new Uint32Array(SIZE * SIZE * 6); let p = 0;
  for (let j = 0; j < SIZE; j++) for (let i = 0; i < SIZE; i++) {
    const a = j * N + i, b = a + 1, cc = a + N, d = cc + 1;
    idx[p++] = a; idx[p++] = cc; idx[p++] = d; idx[p++] = a; idx[p++] = d; idx[p++] = b; // diagonal a-d, matches heightAt()
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}

export function buildWater() {
  const geo = new THREE.PlaneGeometry(SIZE * 3, SIZE * 3);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ color: 0x3f6f8c, transparent: true, opacity: .78, shininess: 80, specular: 0x88aacc }));
  m.position.set(SIZE / 2, WL, SIZE / 2);
  return m;
}

export function buildTrees(lowDetail) {
  const R = mulberry32(7);
  const spots = [];
  const ok = (x, z) => {
    if (x < 4 || z < 4 || x > SIZE - 4 || z > SIZE - 4) return false;
    const h = heightAt(x, z); if (h < WL + .5 || h > 12) return false;
    for (const b of BASES) if (Math.hypot(x - b.x, z - b.z) < 13) return false;
    if (treeCell[(z | 0) * SIZE + (x | 0)]) return false;
    return true;
  };
  const groves = [[14, 70, 7], [46, 118, 6], [60, 36, 6], [70, 92, 6], [114, 58, 7], [82, 10, 6]];
  for (const [gx, gz, gr] of groves) for (let k = 0; k < gr * gr * 1.6; k++) {
    const a = R() * Math.PI * 2, d = Math.sqrt(R()) * gr, x = gx + Math.cos(a) * d, z = gz + Math.sin(a) * d;
    if (ok(x, z)) { treeCell[(z | 0) * SIZE + (x | 0)] = 1; spots.push([(x | 0) + .5, (z | 0) + .5]); }
  }
  for (let k = 0; k < 260; k++) {
    const x = 4 + R() * (SIZE - 8), z = 4 + R() * (SIZE - 8);
    // keep the straight line between the two bases mostly clear
    if (Math.abs((x + z) - SIZE) < 8 && R() < .85) continue;
    if (ok(x, z)) { treeCell[(z | 0) * SIZE + (x | 0)] = 1; spots.push([(x | 0) + .5, (z | 0) + .5]); }
  }
  const seg = lowDetail ? 5 : 7;
  const trunkGeo = new THREE.CylinderGeometry(.08, .13, 1, 5); trunkGeo.translate(0, .5, 0);
  const leafGeo = new THREE.ConeGeometry(.75, 1.9, seg); leafGeo.translate(0, 1.6, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x5a3c20 }), spots.length);
  const leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), spots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3(), c = new THREE.Color();
  spots.forEach(([x, z], i) => {
    const sc = .8 + R() * .6;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), R() * 6.28);
    v.set(x + (R() - .5) * .3, heightAt(x, z) - .05, z + (R() - .5) * .3);
    s.set(sc, sc * (.9 + R() * .3), sc);
    m.compose(v, q, s); trunks.setMatrixAt(i, m); leaves.setMatrixAt(i, m);
    c.setRGB(.16 + R() * .08, .30 + R() * .1, .14 + R() * .05, THREE.SRGBColorSpace); leaves.setColorAt(i, c);
  });
  for (const t of [trunks, leaves]) { t.castShadow = true; t.receiveShadow = !lowDetail; }
  const g = new THREE.Group(); g.add(trunks, leaves);
  return g;
}
