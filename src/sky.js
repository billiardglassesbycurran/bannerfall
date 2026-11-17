// Day & night and weather. The clock and weather live in the game (game.env) so they also run in headless tests
// and are saved; this file turns them into light, sky colour, fog, rain streaks, lightning and rain sound.
import * as THREE from 'three';
import { SKY } from './world.js';
import { FOW } from './fow.js';
import { U } from './geo.js';

export const DAY = 600; // seconds for a full day (dawn → day → dusk → night)
const K = (h, o) => ({ top: new THREE.Color(h[0]), mid: new THREE.Color(h[1]), bot: new THREE.Color(h[2]), fog: new THREE.Color(h[3]), sun: new THREE.Color(h[4]), glow: new THREE.Color(h[5]), ...o });
const DAWN = K(['#5a6e9c', '#e8b08a', '#dcc0a8', '#cdbfb2', '#ffbe80', '#ffb070'], { sunK: .5, hemiK: .75, env: .5, exp: .95 });
const NOON = K(['#3d78c4', '#9cc3e6', '#dfe6e3', '#d5e0e2', '#ffecd0', '#fff0d8'], { sunK: 1, hemiK: 1, env: .75, exp: .95 });
const DUSK = K(['#3a4676', '#e88f62', '#cc9e86', '#bca596', '#ffa060', '#ff9a50'], { sunK: .5, hemiK: .7, env: .45, exp: .95 });
const NIGHT = K(['#081129', '#1a2846', '#222d46', '#1b2438', '#9ab0e0', '#b8ccff'], { sunK: .32, hemiK: .55, env: .18, exp: 1.12 });
// time of day 0..1 → [key, key, mix]
const TRACK = [[0, DAWN], [.07, NOON], [.6, NOON], [.68, DUSK], [.75, NIGHT], [.95, NIGHT], [1, DAWN]];
const tmp = {}; const c1 = new THREE.Color();
function sample(p) {
  let i = 0; while (i < TRACK.length - 2 && p > TRACK[i + 1][0]) i++;
  const [p0, a] = TRACK[i], [p1, b] = TRACK[i + 1], k = p1 > p0 ? (p - p0) / (p1 - p0) : 0;
  for (const key of ['top', 'mid', 'bot', 'fog', 'sun', 'glow']) (tmp[key] || (tmp[key] = new THREE.Color())).copy(a[key]).lerp(b[key], k);
  for (const key of ['sunK', 'hemiK', 'env', 'exp']) tmp[key] = a[key] + (b[key] - a[key]) * k;
  return tmp;
}
/** Sun (by day) or moon (by night) direction for a time of day. */
export function lightDir(p, out) {
  if (p < .73) { const a = p / .73 * Math.PI, e = Math.sin(a) * .85 + .1; out.set(-Math.cos(a) * .8 - .1, e, .35 + Math.sin(a) * .1); }
  else out.set(.4, .7, -.45); // the moon
  return out.normalize();
}

export class Atmosphere {
  constructor({ scene, sun, hemi, renderer, base, low, sound }) {
    Object.assign(this, { scene, sun, hemi, renderer, base, low, sound }); this.flash = 0;
    // rain: short streaks in a box around the camera
    const n = low ? 500 : 1400; this.n = n;
    const pos = new Float32Array(n * 6); this.drops = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { this.drops[i * 3] = (Math.random() - .5) * 70; this.drops[i * 3 + 1] = Math.random() * 34; this.drops[i * 3 + 2] = (Math.random() - .5) * 70; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xb8c6d6, transparent: true, opacity: 0, depthWrite: false }));
    this.rain.frustumCulled = false; this.rain.visible = false; scene.add(this.rain);
    this.look = {};
    if (!low) this.motes = dustMotes(scene);
  }
  update(dt, env, cam, focus) {
    const L = this.look || {};
    const p = env ? (env.tod % DAY) / DAY : .3, s = sample(p), rain = env?.rain || 0, mist = env?.mist || 0, cloud = Math.max(rain, env?.cloud || 0);
    const grey = c1.setRGB(.55, .58, .62);
    SKY.top.value.copy(s.top).lerp(grey, cloud * .55 * s.sunK); SKY.mid.value.copy(s.mid).lerp(grey, cloud * .6 * s.sunK); SKY.bot.value.copy(s.bot).lerp(grey, cloud * .4 * s.sunK);
    SKY.glow && SKY.glow.value.copy(s.glow).multiplyScalar(1 - cloud * .8); if (SKY.dim) SKY.dim.value = 1 - cloud * .45 - (1 - s.sunK) * .5;
    lightDir(p, SKY.sun.value); this.dir = SKY.sun.value;
    this.flash = Math.max(0, this.flash - dt * 3);
    if (rain > .6 && Math.random() < dt * .04) { this.flash = 1; setTimeout(() => this.sound?.play('thunder', .9), 400 + Math.random() * 1600); }
    this.sun.color.copy(s.sun); this.sun.intensity = this.base.sun * s.sunK * (1 - cloud * .55) + this.flash * 2.5;
    this.hemi.intensity = this.base.hemi * s.hemiK * (1 - cloud * .15) + this.flash * .6;
    this.scene.fog.color.copy(s.fog).lerp(grey.setRGB(.6, .63, .66).multiplyScalar(s.hemiK), cloud * .6);
    const hz = L.haze ?? 1; // Look panel: distance haze
    this.scene.fog.near = (110 - mist * 85 - rain * 40) / hz; this.scene.fog.far = (380 - mist * 250 - rain * 130) / Math.sqrt(hz);
    // valley mist: thickest around dawn and in misty weather, a faint layer in the hollows otherwise
    const dawn = p < .12 ? 1 - p / .12 : p > .93 ? (p - .93) / .07 : 0;
    FOW.mist.value = this.low ? 0 : (L.mist ?? 1) * Math.min(.85, .1 + dawn * .45 + mist * .55 + rain * .12); FOW.mistTop.value = 1.2 + mist * 2 + dawn * .8;
    if (this.scene.environment) this.scene.environmentIntensity = s.env * (1 - cloud * .4);
    this.renderer.toneMappingExposure = s.exp * (L.bright ?? 1) * (L.film ? 1.15 : 1);
    if (this.motes) { const m = this.motes.material.uniforms; m.uDay.value = s.sunK * (1 - rain * .9); m.uSun.value.copy(s.sun); if (focus) m.uFocus.value.set(focus.x, focus.y ?? 0, focus.z); }
    // rain streaks
    const show = rain > .03; this.rain.visible = show; this.sound?.setRain?.(rain);
    if (show) {
      this.rain.material.opacity = .45 * rain; const a = this.rain.geometry.attributes.position.array, d = this.drops, cx = cam.position.x, cy = cam.position.y, cz = cam.position.z;
      for (let i = 0; i < this.n; i++) {
        d[i * 3 + 1] -= dt * 26; if (d[i * 3 + 1] < -12) { d[i * 3 + 1] += 34; d[i * 3] = (Math.random() - .5) * 70; d[i * 3 + 2] = (Math.random() - .5) * 70; }
        const x = cx + d[i * 3], y = cy + d[i * 3 + 1] - 8, z = cz + d[i * 3 + 2];
        a[i * 6] = x; a[i * 6 + 1] = y; a[i * 6 + 2] = z; a[i * 6 + 3] = x + .12; a[i * 6 + 4] = y - .9; a[i * 6 + 5] = z + .05;
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    }
    void focus;
  }
}

/** Dust, pollen and the odd leaf drifting in the air round the view, catching the sun. All the motion is in the shader. */
function dustMotes(scene) {
  const n = 420, pos = new Float32Array(n * 3), seed = new Float32Array(n);
  for (let i = 0; i < n; i++) { pos[i * 3] = Math.random() * 56; pos[i * 3 + 1] = Math.random() * 7; pos[i * 3 + 2] = Math.random() * 56; seed[i] = Math.random(); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: U.time, uFocus: { value: new THREE.Vector3() }, uDay: { value: 1 }, uSun: { value: new THREE.Color(1, .93, .8) } },
    vertexShader: `attribute float seed; uniform float uTime; uniform vec3 uFocus; varying float vA; varying float vLeaf;
      void main() {
        vLeaf = step(0.93, seed);                                  // 7% are leaves: bigger, slower, tumbling
        vec3 drift = vec3(0.55 + seed * 0.4, -0.05 - vLeaf * 0.35 + sin(uTime * 0.7 + seed * 40.0) * 0.12, 0.25) * uTime;
        vec3 p = mod(position + drift - uFocus + vec3(28.0, 0.0, 28.0), vec3(56.0, 7.0, 56.0)) + uFocus - vec3(28.0, 0.0, 28.0);
        p.x += sin(uTime * (0.9 + seed) + seed * 17.0) * 0.4; p.z += cos(uTime * (0.7 + seed) + seed * 9.0) * 0.4;
        vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
        float d = -mv.z; vA = smoothstep(90.0, 30.0, d) * (0.55 + 0.45 * sin(uTime * 2.0 + seed * 60.0));
        gl_PointSize = clamp((vLeaf > 0.5 ? 140.0 : 45.0) / d, 1.2, vLeaf > 0.5 ? 9.0 : 3.5);
      }`,
    fragmentShader: `uniform float uDay; uniform vec3 uSun; varying float vA; varying float vLeaf;
      void main() {
        vec2 q = gl_PointCoord - 0.5; float r = vLeaf > 0.5 ? max(abs(q.x * 1.6 + q.y), abs(q.y * 2.2)) : length(q) * 2.0;
        if (r > 1.0) discard;
        vec3 c = vLeaf > 0.5 ? vec3(0.42, 0.36, 0.12) * (0.4 + 0.6 * uDay) : uSun * 1.25;
        gl_FragColor = vec4(c, (vLeaf > 0.5 ? 0.85 : (1.0 - r) * 0.55 * uDay) * vA);
      }`,
    transparent: true, depthWrite: false,
  });
  const pts = new THREE.Points(g, mat); pts.frustumCulled = false; pts.renderOrder = 5; scene.add(pts);
  return pts;
}

/** Advance the game's clock and weather (called from Game.update). */
export function stepEnv(env, dt, rnd = Math.random) {
  env.tod += dt;
  if ((env.wT -= dt) <= 0) { // pick the next weather: mostly fair, sometimes rain or mist
    const r = rnd(); env.weather = r < .45 ? 'clear' : r < .7 ? 'cloudy' : r < .9 ? 'rain' : 'mist';
    env.wT = 90 + rnd() * 150;
  }
  const want = { clear: [0, 0, 0], cloudy: [.6, 0, 0], rain: [.7, 1, 0], mist: [.3, 0, 1] }[env.weather] || [0, 0, 0];
  const k = Math.min(1, dt * .08);
  env.cloud += (want[0] - env.cloud) * k; env.rain += (want[1] - env.rain) * k; env.mist += (want[2] - env.mist) * k;
}
export const isNight = env => !!env && (env.tod % DAY) / DAY > .73 && (env.tod % DAY) / DAY < .97;
