// Geometry helpers: bake a colour into a geometry and merge many pieces into one (fewer draw calls = faster on phones).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _c = new THREE.Color(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();

/** Return a non-indexed copy of geo with a per-vertex colour, transformed by position/rotation/scale. */
export function bake(geo, hex, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  _m.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
  g.applyMatrix4(_m);
  _c.set(hex);
  const n = g.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** Collects baked pieces; call .build() to get one merged geometry. */
export class Builder {
  constructor() { this.parts = []; }
  add(geo, hex, ...t) { this.parts.push(bake(geo, hex, ...t)); return this; }
  addBaked(g) { this.parts.push(g); return this; }
  build() { const g = this.parts.length ? mergeGeometries(this.parts) : new THREE.BufferGeometry(); for (const p of this.parts) p.dispose(); this.parts = []; return g; }
}

export const vcMat = new THREE.MeshLambertMaterial({ vertexColors: true });
export const vcMatFlat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

// shared primitive shapes
export const P = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: (rt, rb, h, s = 8, open = false) => new THREE.CylinderGeometry(rt, rb, h, s, 1, open),
  cone: (r, h, s = 8) => new THREE.ConeGeometry(r, h, s),
  ball: (r, w = 10, h = 8) => new THREE.SphereGeometry(r, w, h),
  ico: (r, d = 0) => new THREE.IcosahedronGeometry(r, d),
  dode: r => new THREE.DodecahedronGeometry(r, 0),
};
