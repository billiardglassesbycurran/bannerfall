// Photo-scanned nature pieces from Poly Haven (CC0): six mossy rocks, a tree stump and a fallen log. They were made small for
// phones by tools/blender/nature.py (a few hundred triangles each, 512px colour + bump maps) and live in assets/nature.
// world.js scatters them as instanced meshes; if they fail to load, the game keeps its simple built-in rocks.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const NAT = { ok: false, rocks: [], stump: null, log: null };
export async function loadNature(pbr) {
  try {
    const loader = new GLTFLoader(), v = window.BF_VERSION || '', base = new URL('../assets/nature/', import.meta.url).href.split('?')[0];
    const get = f => fetch(`${base}${f}?v=${v}`).then(r => { if (!r.ok) throw new Error(`${f}: ${r.status}`); return r.arrayBuffer(); }).then(b => loader.parseAsync(b, base));
    const [rocks, stump, log] = await Promise.all(['rocks.glb', 'stump.glb', 'log.glb'].map(get));
    const mats = new Map();
    const mat = m => {
      if (!mats.has(m)) mats.set(m, pbr
        ? new THREE.MeshStandardMaterial({ map: m.map, normalMap: m.normalMap, roughness: .92, metalness: 0, envMapIntensity: .45 })
        : new THREE.MeshLambertMaterial({ map: m.map }));
      return mats.get(m);
    };
    const pieces = g => {
      const out = []; g.scene.updateMatrixWorld(true);
      g.scene.traverse(o => { if (o.isMesh) out.push({ geo: o.geometry.clone().applyMatrix4(o.matrixWorld), mat: mat(o.material) }); });
      return out;
    };
    NAT.rocks = pieces(rocks); NAT.stump = pieces(stump)[0]; NAT.log = pieces(log)[0];
    NAT.ok = NAT.rocks.length > 0 && !!NAT.stump && !!NAT.log;
  } catch (e) { console.warn('Nature models unavailable, using simple rocks.', e); }
  return NAT;
}
