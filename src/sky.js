// Day & night and weather. The clock and weather live in the game (game.env) so they also run in headless tests
// and are saved; this file turns them into light, sky colour, fog, rain streaks, lightning and rain sound.
import * as THREE from 'three';
import { SKY } from './world.js';

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
  }
  update(dt, env, cam, focus) {
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
    this.scene.fog.near = 110 - mist * 85 - rain * 40; this.scene.fog.far = 380 - mist * 250 - rain * 130;
    if (this.scene.environment) this.scene.environmentIntensity = s.env * (1 - cloud * .4);
    this.renderer.toneMappingExposure = s.exp;
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
