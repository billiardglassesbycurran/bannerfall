// Lightweight particle effects: smoke, fire, dust, sparks, splashes. Two point clouds (normal + glowing), updated on the CPU.
import * as THREE from 'three';

const MAX = 1800;
function spriteTex() {
  const S = 64, cv = document.createElement('canvas'); cv.width = cv.height = S; const c = cv.getContext('2d');
  const g = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.4, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, S, S); return new THREE.CanvasTexture(cv);
}
class Cloud {
  constructor(scene, additive, tex) {
    this.n = 0; this.p = new Float32Array(MAX * 3); this.col = new Float32Array(MAX * 4); this.size = new Float32Array(MAX);
    this.v = new Float32Array(MAX * 3); this.life = new Float32Array(MAX); this.max = new Float32Array(MAX); this.s0 = new Float32Array(MAX); this.s1 = new Float32Array(MAX);
    this.base = new Float32Array(MAX * 4); this.grav = new Float32Array(MAX); this.drag = new Float32Array(MAX);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aCol', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tex: { value: tex }, uScale: { value: 400 }, ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog) }, transparent: true, depthWrite: false, fog: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: `attribute vec4 aCol; attribute float aSize; uniform float uScale; varying vec4 vCol;
        #include <fog_pars_vertex>
        void main(){ vCol = aCol; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_PointSize = aSize * uScale / max(0.1, -mvPosition.z); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
        }`,
      fragmentShader: `uniform sampler2D tex; varying vec4 vCol;
        #include <fog_pars_fragment>
        void main(){ vec4 t = texture2D(tex, gl_PointCoord); gl_FragColor = vec4(vCol.rgb, vCol.a * t.a); if (gl_FragColor.a < .01) discard;
        #include <fog_fragment>
        }`,
    });
    this.pts = new THREE.Points(g, this.mat); this.pts.frustumCulled = false; this.pts.renderOrder = 5; scene.add(this.pts);
  }
  add(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a, grav = 0, drag = 0) {
    if (this.n >= MAX) return; const i = this.n++;
    this.p.set([x, y, z], i * 3); this.v.set([vx, vy, vz], i * 3); this.life[i] = 0; this.max[i] = life; this.s0[i] = s0; this.s1[i] = s1;
    this.base.set([r, g, b, a], i * 4); this.grav[i] = grav; this.drag[i] = drag;
  }
  update(dt, wind) {
    for (let i = 0; i < this.n; i++) {
      this.life[i] += dt;
      if (this.life[i] >= this.max[i]) { // swap-remove
        const j = --this.n; if (i === j) break;
        for (const [arr, k] of [[this.p, 3], [this.v, 3], [this.base, 4]]) for (let c = 0; c < k; c++) arr[i * k + c] = arr[j * k + c];
        for (const arr of [this.life, this.max, this.s0, this.s1, this.grav, this.drag]) arr[i] = arr[j];
        i--; continue;
      }
      const k = this.life[i] / this.max[i], d = Math.max(0, 1 - this.drag[i] * dt);
      this.v[i * 3] = this.v[i * 3] * d + wind[0] * dt; this.v[i * 3 + 1] = this.v[i * 3 + 1] * d - this.grav[i] * dt; this.v[i * 3 + 2] = this.v[i * 3 + 2] * d + wind[1] * dt;
      this.p[i * 3] += this.v[i * 3] * dt; this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt; this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * k;
      const fade = k < .15 ? k / .15 : 1 - (k - .15) / .85;
      this.col[i * 4] = this.base[i * 4]; this.col[i * 4 + 1] = this.base[i * 4 + 1]; this.col[i * 4 + 2] = this.base[i * 4 + 2]; this.col[i * 4 + 3] = this.base[i * 4 + 3] * fade;
    }
    const g = this.pts.geometry; g.setDrawRange(0, this.n);
    for (const k of ['position', 'aCol', 'aSize']) { g.attributes[k].needsUpdate = true; g.attributes[k].clearUpdateRanges?.(); }
  }
}
const R = (a, b) => a + Math.random() * (b - a);

export class FX {
  constructor(scene) { const t = spriteTex(); this.soft = new Cloud(scene, false, t); this.glow = new Cloud(scene, true, t); this.wind = [.25, .1]; }
  setScale(px) { this.soft.mat.uniforms.uScale.value = px; this.glow.mat.uniforms.uScale.value = px; }
  smoke(x, y, z, dark = .3, big = 1) { const v = dark + R(-.05, .05); this.soft.add(x + R(-.2, .2), y, z + R(-.2, .2), R(-.1, .1), R(.6, 1.0), R(-.1, .1), R(2.5, 4), .5 * big, 2.6 * big, v, v, v * 1.02, .55, 0, .3); }
  chimney(x, y, z) { this.soft.add(x, y, z, R(-.05, .05), R(.4, .6), R(-.05, .05), R(2.5, 3.5), .25, 1.4, .75, .74, .72, .35, 0, .2); }
  fire(x, y, z, big = 1) { this.glow.add(x + R(-.3, .3) * big, y, z + R(-.3, .3) * big, R(-.1, .1), R(1.2, 2.0), R(-.1, .1), R(.4, .8), .9 * big, .2, 1.0, R(.35, .55), .08, .9, 0, 1); }
  ember(x, y, z) { this.glow.add(x, y, z, R(-.5, .5), R(1, 2.5), R(-.5, .5), R(.8, 1.4), .12, .05, 1, .6, .2, 1, .5, .5); }
  sparks(x, y, z, n = 6) { for (let i = 0; i < n; i++) this.glow.add(x, y, z, R(-2, 2), R(.5, 3), R(-2, 2), R(.15, .35), .14, .04, 1, R(.75, .95), .4, 1, 9, 2); }
  dust(x, y, z, n = 10, spread = 1.5, tint = [.55, .48, .38]) { for (let i = 0; i < n; i++) { const a = R(0, 6.28), s = R(.5, 1) * spread; this.soft.add(x + Math.cos(a) * .3, y + .2, z + Math.sin(a) * .3, Math.cos(a) * s, R(.2, .9), Math.sin(a) * s, R(1, 2), .6, 2.2, tint[0], tint[1], tint[2], .5, -.1, 1.5); } }
  splash(x, y, z, n = 10) { for (let i = 0; i < n; i++) { const a = R(0, 6.28), s = R(.3, 1.4); this.soft.add(x, y + .05, z, Math.cos(a) * s, R(1.5, 3.2), Math.sin(a) * s, R(.5, .9), .25, .6, .85, .92, .95, .8, 7, .5); } }
  update(dt) { this.soft.update(dt, this.wind); this.glow.update(dt, this.wind); }
}
