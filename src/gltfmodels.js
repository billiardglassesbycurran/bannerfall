// Custom 3D models (made with Tripo / cleaned by Blender, see tools/models.py) listed in assets/models/manifest.json.
// Each model is flattened into one merged geometry per material so it can be instanced (trees) or placed cheaply.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const V = window.BF_VERSION || 'dev';
/** slot -> { info (manifest entry), parts: [{ geo, mat }], box: Box3 } */
export const GM = {};

function flatten(root, pbr) {
  root.updateMatrixWorld(true);
  const byMat = new Map();
  root.traverse(o => {
    if (!o.isMesh) return;
    for (const [gi, mat] of (Array.isArray(o.material) ? o.material : [o.material]).entries()) {
      let g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld);
      if (Array.isArray(o.material)) { const grp = o.geometry.groups[gi]; if (!grp) continue; g = g.index ? g.toNonIndexed() : g; } // rare multi-material meshes
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      if (!g.attributes.normal) g.computeVertexNormals();
      if (g.index) g = g.toNonIndexed();
      const key = mat.uuid; if (!byMat.has(key)) byMat.set(key, { mat, geos: [] }); byMat.get(key).geos.push(g);
    }
  });
  const parts = [];
  for (const { mat, geos } of byMat.values()) {
    let m = mat;
    if (!pbr) m = new THREE.MeshLambertMaterial({ map: mat.map || null, color: mat.color || 0xffffff, transparent: mat.transparent, alphaTest: mat.alphaTest || 0, side: mat.side });
    if (m.map) m.map.anisotropy = 4;
    parts.push({ geo: mergeGeometries(geos), mat: m });
  }
  return parts;
}

export async function loadModels(pbr) {
  let manifest = {};
  try { const r = await fetch(`assets/models/manifest.json?v=${V}`); if (r.ok) manifest = await r.json(); } catch { /* no custom models */ }
  const loader = new GLTFLoader();
  await Promise.all(Object.entries(manifest).map(async ([slot, info]) => {
    try {
      const gltf = await loader.loadAsync(`assets/models/${info.file}?v=${V}`);
      const parts = flatten(gltf.scene, pbr), box = new THREE.Box3();
      for (const p of parts) { p.geo.computeBoundingBox(); box.union(p.geo.boundingBox); }
      GM[slot] = { info, parts, box };
    } catch (e) { console.warn('Could not load custom model', slot, e); }
  }));
  return GM;
}

/** Parts for a building, scaled so the model sits inside its footprint. */
export function buildingParts(kind, size) {
  const m = GM[kind]; if (!m) return null;
  const w = Math.max(m.box.max.x - m.box.min.x, m.box.max.z - m.box.min.z), k = Math.min(1, (size * .96) / Math.max(w, .01));
  return m.parts.map(p => ({ geo: k === 1 ? p.geo : p.geo.clone().scale(k, k, k), mat: p.mat }));
}
