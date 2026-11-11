// Bannerfall — entry point. Sets up the scene, spawns units, wires up input and the HUD.
import * as THREE from 'three';
import { SIZE, BASES, buildTerrain, buildWater, buildTrees, heightAt, walkable } from './terrain.js';
import { Unit, KINDS, separate, buildBanner } from './units.js';
import { RTSView } from './rts.js';
import { POVView } from './pov.js';

// Bump this on every change (see CLAUDE.md) so you can tell on your phone which build you're seeing.
export const VERSION = '0.1.0';

const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const $ = id => document.getElementById(id);

// ---------- renderer / scene ----------
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isTouch, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, isTouch ? 1.5 : 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const SKY = 0xbccbd6;
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 70, 190);
const camera = new THREE.PerspectiveCamera(50, 1, .1, 400);

scene.add(new THREE.HemisphereLight(0xdfe9f3, 0x5a4a30, 1.3));
const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
sun.position.set(SIZE / 2 - 50, 70, SIZE / 2 + 30);
sun.target.position.set(SIZE / 2, 0, SIZE / 2);
sun.castShadow = true;
sun.shadow.mapSize.set(isTouch ? 1024 : 2048, isTouch ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -80, right: 80, top: 80, bottom: -80, near: 10, far: 200 });
sun.shadow.bias = -0.0008; sun.shadow.normalBias = .04;
scene.add(sun, sun.target);

const terrain = buildTerrain();
scene.add(terrain, buildWater(), buildTrees(isTouch));
const banners = BASES.map((b, t) => buildBanner(t, b.x, b.z));
scene.add(...banners);

// ---------- units ----------
const units = [];
function spawn(team, kind, x, z) {
  // nudge to the nearest walkable spot
  for (let r = 0; r < 6; r += .5) for (let a = 0; a < 6.28; a += .7) {
    const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
    if (walkable(px, pz)) { const u = new Unit(scene, team, kind, px, pz); units.push(u); return u; }
  }
}
const [B0, B1] = BASES;
const hero = spawn(0, 'hero', B0.x + 4, B0.z - 4);
[['sword', 2, -2], ['sword', 3, -1], ['sword', 4, 0], ['spear', 0, -4], ['spear', 1, -5], ['spear', 2, -6], ['archer', -1, -1], ['archer', 0, 0]]
  .forEach(([k, dx, dz]) => spawn(0, k, B0.x + 6 + dx, B0.z - 6 + dz));
[['sword', 0, 0], ['sword', 1.2, .4], ['spear', -1, 1.2], ['spear', .4, 1.6], ['archer', 1.5, 2]]
  .forEach(([k, dx, dz]) => spawn(1, k, B1.x - 6 + dx, B1.z + 6 + dz));

// ---------- game object shared with the views ----------
const game = {
  canvas, camera, terrain, units, keys: {}, selected: [], mode: 'rts',
  myUnits: () => units.filter(u => u.team === 0),
  select(list, add = false) {
    const next = add ? [...new Set([...this.selected, ...list])] : list;
    for (const u of this.selected) u.setSelected(false);
    this.selected = next; for (const u of next) u.setSelected(true);
    updateHud();
  },
  moveSelected(x, z) {
    const sel = this.selected.filter(u => !u.possessed); if (!sel.length) return;
    // simple grid formation facing the direction of travel
    const cx = sel.reduce((s, u) => s + u.x, 0) / sel.length, cz = sel.reduce((s, u) => s + u.z, 0) / sel.length;
    const a = Math.atan2(x - cx, z - cz), fx = Math.sin(a), fz = Math.cos(a), rx = -fz, rz = fx;
    const cols = Math.ceil(Math.sqrt(sel.length)), sp = 1.1;
    // assign slots so units on the left go to the left (fewer crossings)
    sel.sort((p, q) => ((p.x - cx) * rx + (p.z - cz) * rz) - ((q.x - cx) * rx + (q.z - cz) * rz));
    sel.forEach((u, i) => {
      const c = i % cols - (cols - 1) / 2, r = Math.floor(i / cols);
      let tx = x + rx * c * sp - fx * r * sp, tz = z + rz * c * sp - fz * r * sp;
      if (!walkable(tx, tz)) { tx = x; tz = z; }
      u.target = { x: tx, z: tz }; u.stuck = 0;
    });
    showMarker(x, z);
  },
};
const rts = new RTSView(game), pov = new POVView(game);

// destination marker
const marker = new THREE.Mesh(new THREE.RingGeometry(.3, .45, 24).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xf3d78a, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
marker.visible = false; scene.add(marker);
let markerT = 0;
function showMarker(x, z) { marker.position.set(x, heightAt(x, z) + .05, z); marker.visible = true; markerT = 0; }

// ---------- modes ----------
function enterPOV(unit) {
  if (!unit) return;
  rts.cancel(); game.mode = 'pov'; pov.enter(unit);
  $('hud').classList.add('hide'); $('pov').classList.remove('hide');
  $('pvname').textContent = (unit.kind === 'hero' ? '⚑ ' : '') + KINDS[unit.kind].name;
  $('povhelp').textContent = isTouch ? 'Left thumb: move · Right thumb: look' : 'Click to aim with mouse · WASD move · Shift sprint · V view · Tab back to command';
}
function exitPOV() {
  const u = pov.unit; pov.leave(); game.mode = 'rts';
  if (u) rts.lookAt(u.x, u.z);
  $('pov').classList.add('hide'); $('hud').classList.remove('hide');
  updateHud();
}
const rideTarget = () => game.selected[0] || hero;

// ---------- HUD ----------
function updateHud() {
  const n = game.selected.length;
  if (!n) $('sel').textContent = 'No units selected';
  else {
    const counts = {}; for (const u of game.selected) counts[u.kind] = (counts[u.kind] || 0) + 1;
    $('sel').textContent = Object.entries(counts).map(([k, c]) => `${c} ${c > 1 ? KINDS[k].plural : KINDS[k].name}`).join(', ');
  }
  $('bClear').classList.toggle('hide', !n);
  $('bRide').innerHTML = `&#9876; Ride<small>${n ? KINDS[game.selected[0].kind].name : 'Commander'}</small>`;
}
$('ver').textContent = 'v' + VERSION;
$('help').innerHTML = isTouch
  ? 'Drag: pan · Pinch: zoom · Twist: rotate<br>Tap unit: select · Double-tap: all of type<br>Hold, then drag: box select · Tap ground: move'
  : 'WASD/arrows: pan · Q/E or right-drag: rotate · Wheel: zoom<br>Click: select · Drag: box · Shift: add · Right-click: move<br>Ctrl+A: army · Tab: ride selected · H: lead as hero';

const onBtn = (id, fn) => $(id).addEventListener('click', e => { e.stopPropagation(); fn(); });
onBtn('bAll', () => game.select(game.myUnits()));
onBtn('bClear', () => game.select([]));
onBtn('bRide', () => enterPOV(rideTarget()));
onBtn('bLead', () => enterPOV(hero));
onBtn('bExit', exitPOV);
onBtn('bView', () => pov.setFirst(!pov.first));
onBtn('bFs', () => {
  const d = document;
  if (d.fullscreenElement) d.exitFullscreen?.();
  else d.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
});

// ---------- input ----------
const view = () => (game.mode === 'pov' ? pov : rts);
canvas.addEventListener('pointerdown', e => view().down(e));
addEventListener('pointermove', e => view().move(e));
addEventListener('pointerup', e => view().up(e));
addEventListener('pointercancel', e => view().up(e));
canvas.addEventListener('wheel', e => { e.preventDefault(); view().wheel(e); }, { passive: false });
canvas.addEventListener('contextmenu', e => e.preventDefault());
addEventListener('blur', () => { game.keys = {}; rts.cancel(); pov.cancel(); });
addEventListener('keydown', e => {
  game.keys[e.code] = true;
  if (e.code === 'Tab') { e.preventDefault(); game.mode === 'pov' ? exitPOV() : enterPOV(rideTarget()); }
  if (game.mode === 'rts') {
    if (e.code === 'KeyH') enterPOV(hero);
    if ((e.code === 'KeyA' && (e.ctrlKey || e.metaKey)) || e.code === 'F2') { e.preventDefault(); game.select(game.myUnits()); }
    if (e.code === 'Escape') game.select([]);
  } else if (e.code === 'KeyV') pov.setFirst(!pov.first);
});
addEventListener('keyup', e => { game.keys[e.code] = false; });

// ---------- resize ----------
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

// ---------- loop ----------
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 1 / 20), t = clock.elapsedTime;
  for (const u of units) u.update(dt);
  separate(units);
  if (game.mode === 'pov') pov.update(dt); else rts.update(dt);
  banners.forEach((b, i) => { b.userData.flag.rotation.y = Math.sin(t * 1.3 + i) * .25; });
  if (marker.visible) { markerT += dt; marker.scale.setScalar(1 + markerT * 1.5); marker.material.opacity = 1 - markerT / .7; if (markerT > .7) marker.visible = false; }
  renderer.render(scene, camera);
});

$('loading').remove();
$('hud').classList.remove('hide');
updateHud();
game.rts = rts; game.pov = pov;
window.bannerfall = game; // handy for debugging in the browser console
