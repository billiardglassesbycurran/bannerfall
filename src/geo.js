// Geometry + material helpers.
// - bake(): copy a primitive with a per-vertex colour and a transform, so many pieces can be merged into one mesh
//   (fewer draw calls = faster on phones).
// - Builder: collects pieces in two buckets — cloth/wood/skin and shiny metal — and merges them.
// - M: shared materials (physically based on Medium/High quality, cheaper on Low). Call initMaterials() first.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _c = new THREE.Color(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();

/** Return a non-indexed copy of geo with a per-vertex colour, transformed by position/rotation/scale. */
export function bake(geo, hex, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  _m.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
  g.applyMatrix4(_m);
  _c.set(hex);
  const n = g.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
const merge = list => { if (!list.length) return null; const g = mergeGeometries(list); for (const p of list) p.dispose(); return g; };

export class Builder {
  constructor() { this.parts = []; this.mparts = []; }
  /** cloth / wood / skin / stone */
  add(geo, hex, ...t) { this.parts.push(bake(geo, hex, ...t)); return this; }
  /** shiny metal (steel, gold) */
  m(geo, hex, ...t) { this.mparts.push(bake(geo, hex, ...t)); return this; }
  addBaked(g) { this.parts.push(g); return this; }
  /** Place a pre-built {c, m} sub-assembly (keeps its colours) with a transform. */
  put(sub, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1) {
    _m.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(s, s, s));
    if (sub.c) this.parts.push(sub.c.clone().applyMatrix4(_m));
    if (sub.m) this.mparts.push(sub.m.clone().applyMatrix4(_m));
    return this;
  }
  /** everything in one geometry */
  build() { const g = merge([...this.parts, ...this.mparts]) || new THREE.BufferGeometry(); this.parts = []; this.mparts = []; return g; }
  /** {c, m}: cloth and metal geometries (either may be null) */
  split() { const r = { c: merge(this.parts), m: merge(this.mparts) }; this.parts = []; this.mparts = []; return r; }
}

/** Darken vertices toward the bottom/inside of a shape — cheap baked "ambient occlusion". */
export function shadeAO(g, y0, y1, min = .55, cx = 0, cz = 0, rad = 0) {
  const p = g.attributes.position, c = g.attributes.color;
  for (let i = 0; i < p.count; i++) {
    let k = Math.min(1, Math.max(0, (p.getY(i) - y0) / (y1 - y0)));
    if (rad) k *= .6 + .4 * Math.min(1, Math.hypot(p.getX(i) - cx, p.getZ(i) - cz) / rad);
    const f = min + (1 - min) * k;
    c.setXYZ(i, c.getX(i) * f, c.getY(i) * f, c.getZ(i) * f);
  }
  return g;
}
/** Deterministically wobble vertices (makes shapes look less machine-made). */
export function jitter(g, amt, seed = 1) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const h = s => { const v = Math.sin((x * 12.9898 + y * 78.233 + z * 37.719 + s * 3.1) * (seed + 1)) * 43758.5453; return v - Math.floor(v) - .5; };
    p.setXYZ(i, x + h(1) * amt, y + h(2) * amt, z + h(3) * amt);
  }
  return g;
}

// ---------------- materials ----------------
export const U = { time: { value: 0 }, detail: { value: null } };
export const M = {};
/** Adds gentle wind sway to an (instanced) material. start = height where bending begins, amp = strength. */
function windify(mat, start, amp, key) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uTime = U.time;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 wp = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
      #else
        vec3 wp = vec3(0.0);
      #endif
      float sw = max(position.y - ${start.toFixed(2)}, 0.0) * ${amp.toFixed(3)};
      float gust = 0.6 + 0.4 * sin(uTime * 0.37 + wp.x * 0.05);
      transformed.x += sin(uTime * 1.7 + wp.x * 0.35 + wp.z * 0.21) * sw * gust;
      transformed.z += cos(uTime * 1.3 + wp.x * 0.19 + wp.z * 0.33) * sw * 0.7 * gust;`);
  };
  mat.customProgramCacheKey = () => 'wind' + key;
  return mat;
}
/** Grime/stone detail projected from 3 sides (no UVs needed) — makes plain walls and rocks look weathered. */
function weathered(mat) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.tDetail = U.detail;
    sh.vertexShader = 'varying vec3 vWP; varying vec3 vWN;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        mat4 wm = modelMatrix * instanceMatrix;
      #else
        mat4 wm = modelMatrix;
      #endif
      vWP = (wm * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(wm) * objectNormal);`);
    sh.fragmentShader = 'uniform sampler2D tDetail; varying vec3 vWP; varying vec3 vWN;\n' + sh.fragmentShader.replace('#include <map_fragment>', `
      vec3 bw = pow(abs(vWN), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
      vec3 dt = texture2D(tDetail, vWP.zy * 0.45).rgb * bw.x + texture2D(tDetail, vWP.xz * 0.45).rgb * bw.y + texture2D(tDetail, vWP.xy * 0.45).rgb * bw.z;
      diffuseColor.rgb *= mix(1.0, dot(dt, vec3(0.333)) / 0.19, 0.5);`);
  };
  mat.customProgramCacheKey = () => 'weathered';
  return mat;
}
export function initMaterials(pbr) {
  const S = o => pbr ? new THREE.MeshStandardMaterial({ metalness: 0, ...o }) : new THREE.MeshLambertMaterial({ vertexColors: o.vertexColors, flatShading: o.flatShading, side: o.side });
  M.vc = S({ vertexColors: true, roughness: .85 });
  M.vcFlat = S({ vertexColors: true, roughness: .9, flatShading: true });
  M.cloth = S({ vertexColors: true, roughness: .78 });
  M.metal = pbr ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .42, metalness: .8, envMapIntensity: .7 }) : new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 70, specular: 0x777777 });
  M.stone = weathered(S({ vertexColors: true, roughness: .95, flatShading: true }));
  M.foliage = windify(S({ vertexColors: true, roughness: .9 }), 1.2, .022, 'f');
  M.grass = windify(S({ vertexColors: true, roughness: 1 }), 0, .35, 'g');
  M.pbr = pbr;
}

// shared primitive shapes
export const P = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: (rt, rb, h, s = 8, open = false) => new THREE.CylinderGeometry(rt, rb, h, s, 1, open),
  cone: (r, h, s = 8, hs = 1, open = false) => new THREE.ConeGeometry(r, h, s, hs, open),
  ball: (r, w = 10, h = 8) => new THREE.SphereGeometry(r, w, h),
  ico: (r, d = 0) => new THREE.IcosahedronGeometry(r, d),
  dode: r => new THREE.DodecahedronGeometry(r, 0),
  lathe: (pts, s = 12) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), s),
};
