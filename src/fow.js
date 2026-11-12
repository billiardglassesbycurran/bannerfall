// Fog of war: land you've never seen is dark, land you've seen but can't see right now is dimmed, and enemy troops
// only show where your units or buildings can see. Works by darkening every lit/fogged material by world position
// (patched into three.js's fog shader code), so terrain, trees, buildings and soldiers all match.
import * as THREE from 'three';

const S = 128;
const data = new Uint8Array(S * S).fill(255);
const tex = new THREE.DataTexture(data, S, S, THREE.RedFormat, THREE.UnsignedByteType);
tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
export const FOW = { map: { value: tex }, on: { value: 0 }, cam: { value: new THREE.Matrix4() } };

// --- shader patch: every material that uses scene fog also gets fog of war ---
const C = THREE.ShaderChunk;
C.fog_pars_vertex += '\n#ifdef USE_FOG\n varying vec2 vFowW; uniform mat4 fowCam;\n#endif\n';
C.fog_vertex += '\n#ifdef USE_FOG\n vFowW = (fowCam * vec4(mvPosition.xyz, 1.0)).xz;\n#endif\n';
C.fog_pars_fragment += '\n#ifdef USE_FOG\n varying vec2 vFowW; uniform sampler2D fowMap; uniform float fowOn;\n#endif\n';
C.fog_fragment += `
#ifdef USE_FOG
  if (fowOn > 0.5 && vFowW.x > 0.0 && vFowW.y > 0.0 && vFowW.x < ${S}.0 && vFowW.y < ${S}.0) gl_FragColor.rgb *= mix(0.05, 1.0, texture2D(fowMap, vFowW / ${S}.0).r);
#endif
`;

// hand the fog-of-war uniforms to every material, including ones with their own onBeforeCompile
const P = THREE.Material.prototype;
Object.defineProperty(P, 'onBeforeCompile', {
  configurable: true,
  get() { return this._fowObc || (this._fowObc = (sh, r) => { sh.uniforms.fowMap = FOW.map; sh.uniforms.fowOn = FOW.on; sh.uniforms.fowCam = FOW.cam; this._userObc?.(sh, r); }); },
  set(fn) { this._userObc = fn; },
});
P.customProgramCacheKey = function () { return this._userObc ? this._userObc.toString() : ''; };

/** Sight range (cells) by unit/building. */
export function sightOf(e) {
  if (e.kind === 'bld') return e.type === 'tower' ? 14 : e.size / 2 + (e.type === 'hall' ? 9 : 5);
  const d = e.d; if (d.hero) return 13; if (e.type === 'lightcav') return 16; if (e.type === 'peasant') return 7;
  return (d.acq || 6) + (d.horse ? 4 : 2);
}

export class FogOfWar {
  constructor(game, on = true) {
    this.g = game; this.on = on; this.vis = new Uint8Array(S * S); this.seen = new Uint8Array(S * S); this.t = 0;
    FOW.on.value = on ? 1 : 0; if (on) this.refresh();
  }
  see(x, z) { if (!this.on) return true; const cx = x | 0, cz = z | 0; return cx >= 0 && cz >= 0 && cx < S && cz < S && this.vis[cz * S + cx] === 1; }
  explored(x, z) { if (!this.on) return true; const cx = x | 0, cz = z | 0; return cx >= 0 && cz >= 0 && cx < S && cz < S && this.seen[cz * S + cx] === 1; }
  stamp(x, z, r) {
    const r2 = r * r, x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(S - 1, Math.ceil(x + r)), z0 = Math.max(0, Math.floor(z - r)), z1 = Math.min(S - 1, Math.ceil(z + r));
    for (let cz = z0; cz <= z1; cz++) { const dz = cz + .5 - z; for (let cx = x0; cx <= x1; cx++) { const dx = cx + .5 - x; if (dx * dx + dz * dz <= r2) { const i = cz * S + cx; this.vis[i] = 1; this.seen[i] = 1; } } }
  }
  refresh() {
    const g = this.g; this.vis.fill(0);
    const k = g.sightMul?.() ?? 1;
    for (const u of g.units) if (u.alive && u.team === 0) this.stamp(u.x, u.z, sightOf(u) * k);
    for (const b of g.blds) if (b.alive && b.team === 0) this.stamp(b.x, b.z, sightOf(b) * Math.max(.85, k));
    const raw = this.raw || (this.raw = new Float32Array(S * S)), tmp = this.tmp || (this.tmp = new Float32Array(S * S));
    for (let i = 0; i < S * S; i++) raw[i] = this.vis[i] ? 255 : this.seen[i] ? 115 : 0;
    // soften the edges (3x3 blur) so sight circles look round rather than blocky
    for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) { const i = z * S + x; tmp[i] = (raw[i] * 2 + raw[x > 0 ? i - 1 : i] + raw[x < S - 1 ? i + 1 : i]) / 4; }
    for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) { const i = z * S + x; data[i] = (tmp[i] * 2 + tmp[z > 0 ? i - S : i] + tmp[z < S - 1 ? i + S : i]) / 4; }
    tex.needsUpdate = true;
    for (const b of g.blds) if (b.alive && b.team !== 0) { const v = this.explored(b.x, b.z); b.mesh.visible = v; if (b.scaffold) b.scaffold.visible = v; b.fowHidden = !v; }
  }
  update(dt) { if (this.on && (this.t -= dt) <= 0) { this.t = .2; this.refresh(); } }
  revealAll() { this.seen.fill(1); }
  save() { if (!this.on) return null; let s = ''; for (let i = 0; i < S * S; i += 8) { let b = 0; for (let k = 0; k < 8; k++) b |= this.seen[i + k] << k; s += String.fromCharCode(b); } return btoa(s); }
  load(str) { if (!str || !this.on) return; const s = atob(str); for (let i = 0; i < s.length; i++) { const b = s.charCodeAt(i); for (let k = 0; k < 8; k++) this.seen[i * 8 + k] = (b >> k) & 1; } this.refresh(); }
  dispose() { FOW.on.value = 0; for (const b of this.g.blds) if (b.mesh) b.mesh.visible = true; }
}
