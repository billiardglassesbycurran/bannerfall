// Geometry + material helpers.
// - bake(): copy a primitive with a per-vertex colour and a transform, so many pieces can be merged into one mesh
//   (fewer draw calls = faster on phones). Colours registered in TEXMAT also tag the vertices with a photo texture
//   (stone, plaster, roof tiles, thatch, wood) that the building shader uses.
// - Builder: collects pieces in two buckets — cloth/wood/skin and shiny metal — and merges them.
// - M: shared materials (physically based on Medium/High quality, cheaper on Low). Call initMaterials() first.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { detailTexture } from './textures.js';

const _c = new THREE.Color(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();

/** hex colour -> photo texture id (1 stone, 2 plaster, 3 roof tiles, 4 thatch, 5 wood). 0 = plain colour. */
export const TEXMAT = new Map();

/** Return a non-indexed copy of geo with a per-vertex colour, transformed by position/rotation/scale. */
export function bake(geo, hex, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
  g.clearGroups();
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.position.count;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  _m.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
  g.applyMatrix4(_m);
  _c.set(hex);
  const col = new Float32Array(n * 3), tm = new Float32Array(n).fill(TEXMAT.get(hex) || 0);
  for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('tm', new THREE.BufferAttribute(tm, 1));
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
export const U = {
  time: { value: 0 }, detail: { value: null },
  tWall: { value: null }, tPlaster: { value: null }, tTiles: { value: null }, tThatch: { value: null }, tWood: { value: null },
};
export const M = {};
const WIND = (start, amp) => `#include <begin_vertex>
  #ifdef USE_INSTANCING
    vec3 wp = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
  #else
    vec3 wp = vec3(0.0);
  #endif
  float sw = max(position.y - ${start.toFixed(2)}, 0.0) * ${amp.toFixed(3)};
  float gust = 0.6 + 0.4 * sin(uTime * 0.37 + wp.x * 0.05);
  transformed.x += sin(uTime * 1.7 + wp.x * 0.35 + wp.z * 0.21 + position.y * 0.4) * sw * gust;
  transformed.z += cos(uTime * 1.3 + wp.x * 0.19 + wp.z * 0.33 + position.x * 0.5) * sw * 0.7 * gust;`;
/** Adds gentle wind sway to an (instanced) material. start = height where bending begins, amp = strength. */
function windify(mat, start, amp, key, twoSidedLight = false) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uTime = U.time;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', WIND(start, amp));
    // leaf cards: light both sides the same (don't flip the normal on the back face)
    if (twoSidedLight) sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace(/\*= faceDirection;/g, '*= 1.0;'));
  };
  mat.customProgramCacheKey = () => 'wind' + key;
  return mat;
}
/** Buildings, rocks and mines: photo textures projected from 3 sides (no UVs needed), chosen per vertex. */
function building(mat) {
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, { tDetail: U.detail, tWall: U.tWall, tPlaster: U.tPlaster, tTiles: U.tTiles, tThatch: U.tThatch, tWood: U.tWood });
    sh.vertexShader = 'attribute float tm; varying float vTm; varying vec3 vWP; varying vec3 vWN; varying vec2 vUV;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        mat4 wm = modelMatrix * instanceMatrix;
      #else
        mat4 wm = modelMatrix;
      #endif
      vWP = (wm * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(wm) * objectNormal); vTm = tm; vUV = uv;`);
    const photo = !!U.tWall.value;
    sh.fragmentShader = 'uniform sampler2D tDetail, tWall, tPlaster, tTiles, tThatch, tWood; varying float vTm; varying vec3 vWP; varying vec3 vWN; varying vec2 vUV;\n' +
      `vec3 tri(sampler2D t, float s) { vec3 bw = pow(abs(vWN), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
        return texture2D(t, vWP.zy * s).rgb * bw.x + texture2D(t, vWP.xz * s).rgb * bw.y + texture2D(t, vWP.xy * s).rgb * bw.z; }\n` +
      sh.fragmentShader.replace('#include <map_fragment>', photo ? `
      if (vTm < 0.5) { vec3 dt = tri(tDetail, 0.45); diffuseColor.rgb *= mix(1.0, dot(dt, vec3(0.333)) / 0.19, 0.5); }
      else if (vTm < 1.5) diffuseColor.rgb = tri(tWall, 0.55) * 1.6 * (diffuseColor.r / 0.32);
      else if (vTm < 2.5) diffuseColor.rgb = mix(vec3(0.62, 0.58, 0.5), tri(tPlaster, 0.4) * 2.0, 0.55);
      else if (vTm < 3.5) diffuseColor.rgb = texture2D(tTiles, vUV * 0.7).rgb * 1.1;
      else if (vTm < 4.5) diffuseColor.rgb = texture2D(tThatch, vUV * 0.6).rgb * 1.15;
      else diffuseColor.rgb = tri(tWood, 0.9) * 0.9;` : `
      { vec3 dt = tri(tDetail, 0.45); diffuseColor.rgb *= mix(1.0, dot(dt, vec3(0.333)) / 0.19, 0.5); }`);
  };
  mat.customProgramCacheKey = () => 'building' + !!U.tWall.value;
  return mat;
}
/** Fine surface detail for soldiers' gear (cloth weave, metal scratches), mapped in the part's own space so it moves with them. */
function detailed(mat, tex, scale, amt, rough, key) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.tFine = { value: tex };
    sh.vertexShader = 'varying vec3 vLP; varying vec3 vLN;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vLP = position; vLN = normal;');
    sh.fragmentShader = 'uniform sampler2D tFine; varying vec3 vLP; varying vec3 vLN;\n' + sh.fragmentShader
      .replace('#include <map_fragment>', `vec3 fw = pow(abs(normalize(vLN)), vec3(3.0)); fw /= (fw.x + fw.y + fw.z);
        float fine = texture2D(tFine, vLP.zy * ${scale.toFixed(1)}).r * fw.x + texture2D(tFine, vLP.xz * ${scale.toFixed(1)}).r * fw.y + texture2D(tFine, vLP.xy * ${scale.toFixed(1)}).r * fw.z;
        diffuseColor.rgb *= 1.0 + (fine - 0.5) * ${amt.toFixed(2)};`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n roughnessFactor = clamp(roughnessFactor * (1.0 + (fine - 0.5) * ${rough.toFixed(2)}), 0.05, 1.0);`);
  };
  mat.customProgramCacheKey = () => 'fine' + key;
  return mat;
}
export function initMaterials(pbr, A) {
  const S = o => pbr ? new THREE.MeshStandardMaterial({ metalness: 0, ...o }) : new THREE.MeshLambertMaterial({ vertexColors: o.vertexColors, flatShading: o.flatShading, side: o.side, map: o.map, alphaTest: o.alphaTest });
  M.photo = !!(A && A.ok);
  if (M.photo) { U.tWall.value = A.wall; U.tPlaster.value = A.plaster; U.tTiles.value = A.tiles; U.tThatch.value = A.thatch; U.tWood.value = A.bark; }
  M.vc = S({ vertexColors: true, roughness: .85 });
  M.vcFlat = S({ vertexColors: true, roughness: .9, flatShading: true });
  M.cloth = S({ vertexColors: true, roughness: .78 });
  M.metal = pbr ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .42, metalness: .8, envMapIntensity: .7 }) : new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 70, specular: 0x777777 });
  if (pbr) { detailed(M.cloth, detailTexture('cloth'), 9, .5, .3, 'c'); detailed(M.metal, detailTexture('metal'), 4, .35, 1.1, 'm'); }
  M.stone = building(S({ vertexColors: true, roughness: .95, flatShading: true }));
  M.foliage = windify(S({ vertexColors: true, roughness: .9 }), 1.2, .022, 'f');
  M.grass = windify(S({ vertexColors: true, roughness: 1, envMapIntensity: .25 }), 0, .35, 'g');
  if (M.photo) {
    M.bark = S({ vertexColors: true, roughness: .95, map: A.bark });
    M.leaves = windify(S({ vertexColors: true, roughness: .8, envMapIntensity: .5, map: A.oakCard, alphaTest: .45, side: THREE.DoubleSide }), 1.0, .028, 'lo', true);
    M.needles = windify(S({ vertexColors: true, roughness: .85, envMapIntensity: .5, map: A.firCard, alphaTest: .4, side: THREE.DoubleSide }), 1.0, .022, 'ln', true);
  }
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
