// Bannerfall — entry point: renderer, lighting, menus, game modes, input routing and the main loop.
import * as THREE from 'three';
import { FOW, FogOfWar } from './fow.js'; // must load before any material is made
import { MAP, MAP_LIST, SIZE, BASES, WL, CLOUDS, buildDistant, buildTerrain, buildWater, buildSky, buildResources, buildBridge, buildFish, updateFish, heightAt } from './world.js';
import { BD, DIFF, MODES, CIVS, CIV_LIST, UD, TECH, AGES } from './data.js';
import { FX } from './effects.js';
import { Tutorial } from './tutorial.js';
import { Field } from './battle.js';
import { Atmosphere, isNight } from './sky.js';
import { Link, HostSync, GuestSync, newCode } from './net.js';
import { MISSIONS, progress, saveProgress } from './campaign.js';
import { saveGame, loadSave, applySave, saveInfo, clearSave } from './save.js';
import { Sound } from './audio.js';
import { Figures, ghostObject } from './models.js';
import { Game } from './game.js';
import { AI } from './ai.js';
import { RTSView } from './rts.js';
import { POVView } from './pov.js';
import { HUD } from './hud.js';
import { initMaterials, U } from './geo.js';
import { groundTextures } from './textures.js';
import { loadAssets } from './assets.js';
import { loadModels } from './gltfmodels.js';
import { cloudTexture } from './textures.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';

// The version lives in index.html (window.BF_VERSION) — bump it there on every change you publish.
export const VERSION = window.BF_VERSION || 'dev';

const $ = id => document.getElementById(id);
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

// ---------------- quality ----------------
const QUALITY = {
  low:  { dpr: 1,   shadow: 0,    grass: 0,    aa: false },
  med:  { dpr: 1.5, shadow: 1024, grass: 2500, aa: false },
  high: { dpr: 2,   shadow: 2048, grass: 6500, aa: true, reflect: true },
};
let qLevel = 'med'; try { qLevel = localStorage.getItem('bf.quality') || (isTouch ? 'med' : 'high'); } catch { /* storage blocked */ }
if (!QUALITY[qLevel]) qLevel = 'med';
const Q = QUALITY[qLevel];

// ---------------- renderer / scene ----------------
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: Q.aa, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, Q.dpr));
renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = .95;
const A = await loadAssets(renderer.capabilities.getMaxAnisotropy()); // photo textures (falls back to painted ones)
initMaterials(qLevel !== 'low', A);
await loadModels(qLevel !== 'low'); // custom Tripo/Blender models from assets/models (if any)
renderer.shadowMap.enabled = Q.shadow > 0; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xd5e0e2, 110, 380);
CLOUDS.value = cloudTexture();
const camera = new THREE.PerspectiveCamera(48, 1, .2, 900); camera.layers.enable(1); // layer 1 = grass (skipped in reflections)
// sky reflections: render the sky once into an environment map that lights and reflects off every surface
if (qLevel !== 'low') {
  const pmrem = new THREE.PMREMGenerator(renderer), envScene = new THREE.Scene(); envScene.add(buildSky());
  scene.environment = pmrem.fromScene(envScene, .04, .1, 1000).texture; scene.environmentIntensity = .75; pmrem.dispose();
}
const hemi = new THREE.HemisphereLight(0xd6e6ff, 0x5a4a30, qLevel === 'low' ? 1.2 : .45); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffecd0, qLevel === 'low' ? 2.8 : 3.3);
const SUN_DIR = new THREE.Vector3(-.5, .62, .35).normalize();
sun.castShadow = Q.shadow > 0;
if (Q.shadow) { sun.shadow.mapSize.set(Q.shadow, Q.shadow); Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 5, far: 220 }); sun.shadow.bias = -.0006; sun.shadow.normalBias = .05; }
scene.add(sun, sun.target);

const painted = groundTextures(qLevel === 'low' ? 256 : 512, renderer.capabilities.getMaxAnisotropy());
U.detail.value = painted.rock;
const terrain = buildTerrain(Q, A.ok ? { grass: A.grass, dirt: A.dirt, rock: A.rock, sand: A.sand, photo: true } : painted);
const water = buildWater(Q);
scene.add(buildSky(), terrain, water);
buildResources(scene, Q);
if (MAP.bridge) buildBridge(scene, Q.shadow > 0);
buildDistant(scene);
buildFish(scene);
const figures = new Figures(scene, Q.shadow > 0);

// ---------------- film look: bloom, ambient-occlusion (PC), colour grading ----------------
const GRADE = {
  uniforms: { tDiffuse: { value: null }, uVig: { value: .32 }, uSat: { value: 1.08 }, uTime: U.time },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uVig, uSat, uTime; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv); float l = dot(c.rgb, vec3(.2126,.7152,.0722));
      c.rgb = mix(vec3(l), c.rgb, uSat);                                   // a touch more colour
      c.rgb *= mix(vec3(.96,.98,1.04), vec3(1.05,1.0,.94), smoothstep(.05,.8,l)); // cool shadows, warm highlights
      vec2 d = vUv - .5; c.rgb *= 1.0 - uVig * dot(d, d) * 1.6;             // soft vignette
      float gr = fract(sin(dot(vUv * 913.0 + uTime, vec2(12.9898,78.233))) * 43758.5453); c.rgb += (gr - .5) * .012; // fine film grain
      gl_FragColor = c; }`,
};
let composer = null;
if (qLevel !== 'low') {
  const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: Q.aa ? 4 : 0 });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  if (qLevel === 'high' && !isTouch) try { const ao = new GTAOPass(scene, camera, 4, 4); ao.blendIntensity = .8; ao.updateGtaoMaterial?.({ radius: .5, distanceExponent: 1.5, thickness: 1, scale: 1 }); composer.addPass(ao); } catch (e) { console.warn('AO unavailable', e); }
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), .18, .5, .92));
  composer.addPass(new ShaderPass(GRADE));
  composer.addPass(new OutputPass());
}

// ---------------- app state ----------------
const app = {
  isTouch, canvas, camera, terrain, keys: {}, sel: [], pending: null, mode: 'menu', game: null, ai: null, paused: false,
  cfg: { mode: 'skirmish', diff: 1, civ: 'franks' },
};
app.scene = scene; app.renderer = renderer;
const fx = new FX(scene), sound = new Sound();
const atmo = new Atmosphere({ scene, sun, hemi, renderer, base: { sun: sun.intensity, hemi: hemi.intensity }, low: qLevel === 'low', sound });
// ---------------- player settings (saved on this device) ----------------
const SET_DEFAULT = { look: 1, cam: 1, vol: .7, music: true, voice: true, big: false, auto: true, fog: true, mapBot: false, mapOff: false, cycle: true };
app.settings = { ...SET_DEFAULT }; try { Object.assign(app.settings, JSON.parse(localStorage.getItem('bf.settings') || '{}')); } catch { /* ignore */ }
function applySettings() {
  sound.setMusic?.(app.settings.music !== false); sound.voiceOn = app.settings.voice !== false;
  document.body.classList.toggle('bigui', !!app.settings.big); sound.setVolume?.(app.settings.vol);
  const mw = document.getElementById('miniw'); mw.classList.toggle('bottom', !!app.settings.mapBot); mw.classList.toggle('off', !!app.settings.mapOff); document.getElementById('bMap').classList.toggle('on', !app.settings.mapOff);
  try { localStorage.setItem('bf.settings', JSON.stringify(app.settings)); } catch { /* ignore */ }
}
app.fx = fx; app.sound = sound;
// sound volume falls off with distance from what you're looking at
const earDist = (x, z) => { const f = app.mode === 'pov' && pov.unit ? pov.unit : rts.focus; return Math.hypot(x - f.x, z - f.z); };
app.sfx = (name, x, z, vol = 1) => sound.play(name, x === undefined ? vol : vol * Math.max(0, 1 - earDist(x, z) / (app.mode === 'pov' ? 45 : 30 + rts.dist)));
addEventListener('pointerdown', () => sound.init(), { capture: true });
addEventListener('keydown', () => sound.init(), { capture: true });
const rts = new RTSView(app), pov = new POVView(app), hud = new HUD(app);
Object.assign(app, { rts, pov, hud });
app.toast = (m, s) => hud.toast(m, s);

// destination marker
const marker = new THREE.Mesh(new THREE.RingGeometry(.3, .45, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xf3d78a, transparent: true, depthWrite: false }));
marker.visible = false; scene.add(marker); let markerT = 0;
function showMarker(x, z, col = 0xf3d78a) { marker.material.color.set(col); marker.position.set(x, heightAt(x, z) + .08, z); marker.visible = true; markerT = 0; }

// ---------------- selection & orders ----------------
app.select = (list, add = false) => {
  list = list.filter(Boolean);
  if (add) { const base = app.sel.filter(e => e.kind === 'unit' && e.team === 0 && e.alive); list = [...new Set([...base, ...list.filter(e => e.kind === 'unit' && e.team === 0)])]; }
  for (const e of app.sel) e.selected = false;
  const fresh = list.find(e => e.kind === 'unit' && e.team === 0 && !e.selected);
  app.sel = list; for (const e of list) e.selected = true;
  if (fresh && app.mode === 'rts') speak(fresh, 'select');
  hud.selT = 0; hud.cardT = 0; hud.sig = '';
};
// unit voices: short replies when you select or command them (uses the device's speech voices)
const LINES = {
  civ: { select: ['Yes?', 'Ready to work.', 'What is it?'], move: ['Right away.', 'On my way.'], gather: ['Back to work.', 'Aye.'], build: ['I will build it.', 'Hammer and nails!'], attack: ['If I must!', 'Must I?'] },
  mil: { select: ['Yes, my lord?', 'Orders?', 'Ready.', 'Sir?'], move: ['At once!', 'Moving out.', 'As you command.'], attack: ['Attack!', 'For glory!', 'Charge them!', 'To arms!'], gather: ['Yes, my lord.'], build: ['Yes, my lord.'] },
  hero: { select: ['I am ready.', 'The banner stands.'], move: ['Onward.', 'Ride on.'], attack: ['Follow me!', 'With me!'], gather: ['Onward.'], build: ['Onward.'] },
};
const ACCENT = { franks: 'fr', romans: 'it', norse: 'nb' };
function speak(u, kind) {
  if (!u || !app.settings.voice) return;
  const set = u.d.hero ? LINES.hero : u.type === 'peasant' || u.d.ship ? LINES.civ : LINES.mil, list = set[kind] || set.select;
  sound.say(list[Math.random() * list.length | 0], { pitch: u.d.hero ? .7 : u.type === 'peasant' ? 1.15 : .85, lang: ACCENT[app.game?.civKeys[0]] });
}
app.speak = speak;
app.order = (ent, x, z) => {
  const units = app.sel.filter(e => e.kind === 'unit' && e.team === 0 && e.alive);
  if (!units.length) return;
  const r = app.game.command(units, ent, x, z);
  speak(units.find(u => u.d.hero) || units[0], r === 'attack' ? 'attack' : r === 'gather' ? 'gather' : r === 'build' ? 'build' : 'move');
  showMarker(x, z, r === 'attack' ? 0xff6a4a : r === 'gather' || r === 'build' ? 0x9dff8a : 0xf3d78a);
};
app.setPending = p => {
  app.pending = p; hud.sig = ''; hud.updateCard(); $('place').classList.remove('hide'); $('pok').classList.toggle('hide', !(p.type === 'place' && isTouch));
  $('ptxt').textContent = p.type === 'place' && p.btype === 'wall' ? (isTouch ? 'Tap where the wall starts, then ✓' : 'Click where the wall starts') : p.type === 'place' && p.btype === 'gate' ? (isTouch ? 'Tap a piece of your wall (or open ground), then ✓' : 'Click a piece of your wall (or open ground)') : p.type === 'place' ? (isTouch ? 'Tap the map to position, then ✓' : 'Click to place (Shift: place several)') : p.type === 'amove' ? 'Tap where to attack' : p.type === 'patrol' ? 'Tap the far end of the patrol' : p.type === 'repair' ? 'Tap a damaged building' : p.type === 'unload' ? 'Tap the shore to land your troops' : 'Tap the rally point';
};
app.cancelPending = () => { clearLineGhosts(); app.pending = null; if (ghost) { ghost.removeFromParent(); ghost = null; } $('place').classList.add('hide'); hud.sig = ''; hud.updateCard(); };

let ghost = null;
const ghostMats = [new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: .65, color: 0xb0ffb0, depthWrite: false }), new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: .65, color: 0xff7a6a, depthWrite: false })];
app.startPlace = type => {
  app.setPending({ type: 'place', btype: type });
  ghost = ghostObject(type, app.game.look(0), ghostMats[0]); scene.add(ghost);
  const p = rts.pickGround(innerWidth / 2, innerHeight * .42); if (p) moveGhost(p.x, p.z);
};
/** Cells of a wall line from a to b, stepping only sideways or forwards so there are no diagonal gaps. */
function wallCells(a, b) {
  const out = [[a.cx, a.cz]], ldx = b.cx - a.cx, ldz = b.cz - a.cz, L = Math.hypot(ldx, ldz) || 1, n = Math.abs(ldx) + Math.abs(ldz);
  const off = ([cx, cz]) => Math.abs((cx - a.cx) * ldz - (cz - a.cz) * ldx) / L; // distance from the straight line
  let x = a.cx, z = a.cz;
  for (let i = 0; i < n && out.length < 48; i++) {
    const c = []; if (x !== b.cx) c.push([x + Math.sign(ldx), z]); if (z !== b.cz) c.push([x, z + Math.sign(ldz)]);
    [x, z] = c.length > 1 && off(c[1]) < off(c[0]) ? c[1] : c[0]; out.push([x, z]);
  }
  return out;
}
let lineGhosts = [];
function clearLineGhosts() { for (const m of lineGhosts) m.removeFromParent(); lineGhosts = []; }
function showWallLine(p) {
  clearLineGhosts(); if (!p.a) return;
  const cells = wallCells(p.a, { cx: p.cx, cz: p.cz }); p.cells = cells;
  let w = app.game.T[0].w; const cost = BD.wall.cost.w;
  for (const [cx, cz] of cells) {
    const ok = app.game.canPlace('wall', cx, cz) && w >= cost; if (ok) w -= cost;
    const m = ghostObject('wall', { ...app.game.look(0), conn: 5 }, ghostMats[ok ? 0 : 1]); m.position.set(cx + .5, heightAt(cx + .5, cz + .5) + .05, cz + .5); scene.add(m); lineGhosts.push(m);
  }
  $('ptxt').textContent = `${cells.length} wall pieces · ${cells.length * cost} wood` + (isTouch ? ' · tap to move the end, then ✓' : ' · click to build');
}
function moveGhost(x, z) {
  const p = app.pending; if (!p || p.type !== 'place' || !ghost) return;
  const s = BD[p.btype].size; p.cx = Math.round(x - s / 2); p.cz = Math.round(z - s / 2);
  ghost.position.set(p.cx + s / 2, BD[p.btype].dock ? WL + .02 : heightAt(p.cx + s / 2, p.cz + s / 2) + .05, p.cz + s / 2);
  p.ok = app.game.canPlace(p.btype, p.cx, p.cz) || (p.btype === 'gate' && !!app.game.gateSpot(0, p.cx, p.cz));
  if (p.btype === 'wall') { ghost.visible = !p.a; if (p.a) showWallLine(p); } const gm = ghostMats[p.ok ? 0 : 1]; if (ghost.isMesh) ghost.material = gm; else ghost.traverse(o => { if (o.isMesh) o.material = gm; });
}
function confirmPlace(keep) {
  const p = app.pending; if (!p || p.type !== 'place') return;
  const builders = app.sel.filter(e => e.kind === 'unit' && e.type === 'peasant' && e.alive);
  const d = BD[p.btype];
  if (p.btype === 'wall') { // first tap = start of the line, second = build the whole line
    if (!p.a) { p.a = { cx: p.cx, cz: p.cz }; showWallLine(p); return; }
    const cells = p.cells || [[p.cx, p.cz]], made = [];
    for (const [cx, cz] of cells) { const b = app.game.startBuilding(0, 'wall', cx, cz, []); if (b) made.push(b); }
    if (!made.length) { app.toast(app.game.afford(0, d.cost) ? "Can't build a wall there." : 'Not enough wood.', 2); return; }
    builders.forEach((u, i) => app.game.build(u, made[Math.min(made.length - 1, Math.floor(i * made.length / Math.max(1, builders.length)))]));
    app.toast(`${made.length} wall piece${made.length > 1 ? 's' : ''} placed${made.length < cells.length ? ` (${cells.length - made.length} skipped: blocked or not enough wood)` : ''}.`, 3);
    clearLineGhosts(); p.a = null; p.cells = null; if (!keep) app.cancelPending(); else ghost.visible = true;
    return;
  }
  if (!app.game.afford(0, d.cost)) { app.toast('Not enough resources.', 2); app.cancelPending(); return; }
  const b = app.game.startBuilding(0, p.btype, p.cx, p.cz, builders);
  if (!b) { app.toast("Can't build there.", 2); return; }
  if (!keep) app.cancelPending();
}
app.pendingAt = (x, z, ent, shift) => {
  const p = app.pending, g = app.game;
  if (p.type === 'place') { moveGhost(x, z); if (!isTouch) confirmPlace(shift); return; }
  if (p.type === 'amove') {
    const units = app.sel.filter(e => e.kind === 'unit' && e.team === 0 && e.alive && e.type !== 'peasant');
    g.formation(units, x, z); for (const u of units) u.task.type = 'amove';
    showMarker(x, z, 0xff6a4a);
  } else if (p.type === 'patrol') {
    const units = app.sel.filter(e => e.kind === 'unit' && e.team === 0 && e.alive && e.type !== 'peasant');
    for (const u of units) g.setTask(u, { type: 'patrol', a: { x: u.x, z: u.z }, b: { x, z }, leg: true }); showMarker(x, z, 0xffb04a);
  } else if (p.type === 'repair') {
    const peas = app.sel.filter(e => e.kind === 'unit' && e.type === 'peasant' && e.alive);
    if (ent && ent.kind === 'bld' && ent.team === 0 && ent.built && ent.hp < ent.maxHp) { for (const u of peas) g.setTask(u, { type: 'repair', b: ent }); showMarker(x, z, 0x9dff8a); }
    else app.toast('Pick one of your damaged buildings.', 2);
  } else if (p.type === 'unload') { g.setTask(p.ship, { type: 'unload', x, z }); showMarker(x, z, 0x8ab4ff);
  } else if (p.type === 'rally') { p.b.rally = ent && ent.kind === 'res' ? { x, z, res: ent } : { x, z }; app.toast('Rally point set.', 2); showMarker(x, z, 0x8ab4ff); }
  app.cancelPending();
};
app.hoverAt = (sx, sy) => { if (app.pending?.type === 'place') { const p = rts.pickGround(sx, sy); if (p) moveGhost(p.x, p.z); } };
$('pok').addEventListener('click', e => { e.stopPropagation(); confirmPlace(false); });
$('pno').addEventListener('click', e => { e.stopPropagation(); app.cancelPending(); });

app.resClick = res => {
  const g = app.game; if (!g || g.mode === 'battle' || res.fish) return;
  if (app.sel.some(e => e.kind === 'unit' && e.type === 'peasant' && e.alive)) return;
  const n = g.sendPeasants(0, res, 1);
  app.toast(n ? `A peasant is on the way to ${{ f: 'gather berries', w: 'chop wood', g: 'mine gold' }[res.rt]}.` : 'No free peasants — train more at the Town Hall.', 2);
  if (n) showMarker(res.x, res.z, 0x9dff8a);
};
app.infoText = () => {
  const g = app.game; if (!g) return '';
  if (g.mode === 'survival') { const ai = app.ai; return ai.wave >= 10 ? 'Final wave!' : `Wave ${ai.wave}/10 · next in ${Math.max(0, Math.ceil(ai.nextWave - g.time))}s`; }
  if (g.mode === 'battle') { const n = t => g.units.filter(u => u.alive && u.team === t).length; return `${g.civ[0].name} ${n(0)} · ${g.civ[1].name} ${n(1)}` + envIcon(g); }
  return `${AGES[g.T[0].age]} · ${g.civ[0].name} vs ${g.civ[1].name} (${DIFF[g.diff].name})` + envIcon(g);
};
const envIcon = g => !g.cycle ? '' : ' · ' + (isNight(g.env) ? '🌙 Night' : '☀ Day') + ({ rain: ' · 🌧 Rain', mist: ' · 🌫 Mist', cloudy: ' · ☁' }[g.env.weather] || '');
app.hint = () => {
  const g = app.game;
  if (g.mode === 'battle') return isTouch ? 'Tap <b>Army</b>, then tap an enemy or the ground. Or <b>Lead</b> to fight as your Commander.' : 'Ctrl+A selects your army; right-click enemies to attack. H to lead as your Commander.';
  return isTouch ? 'Tap a peasant, then tap trees, bushes or gold to gather. Peasants build from the panel on the right.' : 'Select peasants to build (Z–M keys). Select a building to train units. Right-click to give orders.';
};

// ---------------- modes ----------------
function setupGame(mode, diff, civ = 'franks', enemyCiv) {
  const tut = mode === 'tutorial'; if (tut) { mode = 'skirmish'; diff = 0; }
  const mis = mode === 'campaign' ? MISSIONS[app.missionId || 0] : null; if (mis) { mode = 'skirmish'; diff = mis.diff; }
  app.campaign = null;
  app.game?.fow?.dispose();
  if (app.game?.field) for (const f of app.game.field.flags) f.mesh.removeFromParent();
  app.tut = null; document.getElementById('tutor').classList.add('hide');
  if (!CIVS[civ]) civ = 'franks';
  if (!CIVS[enemyCiv]) { const others = CIV_LIST.filter(c => c !== civ); enemyCiv = others[Math.floor(Math.random() * others.length)]; }
  figures.styles = [CIVS[civ].style, CIVS[enemyCiv].style];
  const g = new Game({ scene, figures, Q, mode, diff, civs: [civ, enemyCiv] });
  app.game = g; g.toast = (m, s) => hud.toast(m, s);
  g.onEnd = res => setTimeout(() => showEnd(res), 1600);
  g.onUnitDeath = u => {
    if (app.sel.includes(u)) app.select(app.sel.filter(e => e !== u));
    if (pov.unit === u) { app.toast('You have fallen!', 3); setTimeout(() => { if (pov.unit === u) exitPOV(); }, 1500); }
  };
  g.onAlert = (x, z) => { hud.ping(x, z); if (performance.now() - (app.lastHorn || 0) > 15000) { app.lastHorn = performance.now(); app.sfx('horn'); } };
  g.onHit = (t, src, amt) => {
    if (t.kind === 'unit' && src?.kind === 'unit' && (t.team === 0 || src.team === 0)) app.lastFight = g.time;
    const melee = src?.d?.melee, y = t.kind === 'bld' ? t.y + 1.2 : t.y + 1.1;
    if (melee) { const metal = (t.d.arm || 0) >= 2; if (metal && Math.random() < .6) fx.sparks(t.x, y, t.z, 5); app.sfx(metal ? 'clang' : 'thud', t.x, t.z, .7); }
    else if (t.kind === 'bld') fx.dust(t.x, t.y + .5, t.z, 3, .8);
  };
  g.onShoot = (src, kind) => { if (kind === 'stone') app.sfx('thud', src.x, src.z, .6); else if (Math.random() < .5) app.sfx('arrow', src.x, src.z, .5); };
  g.onSplash = (x, z) => { const h = heightAt(x, z); if (h < WL) { fx.splash(x, WL, z, 16); app.sfx('splash', x, z); } else { fx.dust(x, h, z, 14, 2.2); app.sfx('stone', x, z); } };
  g.onDestroyed = b => { fx.dust(b.x, b.y, b.z, 30, b.size * .9, [.42, .38, .34]); for (let i = 0; i < 8; i++) fx.smoke(b.x, b.y + 1, b.z, .25, 1.5); app.sfx('collapse', b.x, b.z); };
  g.onBuilt = b => { fx.dust(b.x, b.y, b.z, 16, b.size * .6); if (b.team === 0) app.sfx('chime'); };
  g.onWork = (u, kind) => { if (kind) app.sfx(kind, u.x, u.z, .45); };
  g.onTrained = (u, b) => { if (u.team === 0 && app.sel.includes(b)) app.sfx('chime', b.x, b.z, .5); };
  g.onTech = (team, key) => {
    const t = TECH[key];
    if (team === 0) { if (t.toAge) { app.toast(`Your people enter the ${AGES[t.toAge]}! New buildings, units and upgrades unlocked.`, 5); app.sfx('fanfare'); for (const b of g.blds) if (b.alive && b.team === 0) fx.dust(b.x, b.y, b.z, 6, b.size * .5); } else { app.toast(`${t.name} researched.`, 2.5); app.sfx('chime'); } }
    else if (t.toAge) app.toast(`The enemy has reached the ${AGES[t.toAge]}.`, 3);
  };
  g.onAbility = (u, k) => {
    fx.dust(u.x, u.y, u.z, k === 'charge' ? 10 : 18, k === 'charge' ? 1.5 : 4); app.sfx(k === 'cry' ? 'horn' : k === 'rally' ? 'fanfare' : 'thud', u.x, u.z, 1);
    if (u.team === 0 && k === 'cry' && app.settings.voice) sound.say(`For the ${g.civ[0].name}!`, { pitch: .65, rate: 1.1 });
    if (u.team === 0) app.toast({ cry: 'War Cry! Your soldiers fight harder.', charge: 'Charge!', rally: 'Rally! Fleeing soldiers return to the fight.' }[k], 2);
  };
  g.onPromote = u => { if (u.team === 0) app.sfx('chime', u.x, u.z, .7); };
  g.onCharge = (u, e) => { fx.dust(e.x, e.y, e.z, 8, .8); app.sfx('thud', e.x, e.z, 1); };
  g.onCapture = (f, side) => app.sfx(side === 0 ? 'fanfare' : 'horn');
  g.onHero = h => { if (app.mode === 'rts') rts.lookAt(h.x, h.z); };
  const [B0] = BASES;
  if (mode === 'battle') {
    const army = (team, cx, cz, mul) => {
      const s = team === 0 ? 1 : -1, uq = g.civ[team].unique.type;
      const rows = [['knight', 3], ['lightcav', 3], [uq, 5], ['sword', 8], ['spear', 7], ['archer', 6], ['crossbow', 4], ['horsearcher', 2], ['catapult', 1]];
      // ranks run along the line x+z = const, facing the enemy
      rows.forEach(([type, n0], r) => {
        const n = Math.round(n0 * mul);
        for (let i = 0; i < n; i++) { const along = (i - (n - 1) / 2) * 1.15, back = r * 1.4; g.spawnUnit(team, type, cx + (along - back * s) * .707, cz + (along + back * s) * .707); }
      });
    };
    army(0, 46, 82, 1); army(1, 82, 46, [.75, 1, 1.3][diff]);
    g.hero = g.spawnUnit(0, 'hero', 40, 88); g.spawnUnit(1, 'hero', 88, 40);
    for (const u of g.units) u.yaw = u.team === 0 ? Math.PI * .75 : -Math.PI * .25;
    g.field = new Field(g, scene, [30, [20, 28, 36][diff]]);
    rts.lookAt(52, 78); rts.dist = rts.distT = 34;
  } else {
    const hall = g.placeBuilding(0, 'hall', B0.x - 2, B0.z - 2, true);
    for (let i = 0; i < 4; i++) g.spawnUnit(0, 'peasant', hall.x + 4 + i * .8, hall.z - 3.5);
    g.hero = g.spawnUnit(0, 'hero', hall.x + 4.5, hall.z - 1);
    const peas = g.units.filter(u => u.type === 'peasant');
    const berry = g.nearestRes(hall.x, hall.z, 'f', 20), tree = g.nearestRes(hall.x, hall.z, 'w', 25);
    peas.forEach((p, i) => { const r = i < 2 ? berry : tree; if (r) g.gather(p, r); });
    if (mode === 'skirmish') {
      const eh = g.placeBuilding(1, 'hall', SIZE - B0.x - 3, SIZE - B0.z - 3, true);
      for (let i = 0; i < 4; i++) g.spawnUnit(1, 'peasant', eh.x - 4 - i * .8, eh.z + 3.5);
      g.spawnUnit(1, 'hero', eh.x - 4.5, eh.z + 1);
    } else {
      Object.assign(g.T[0], { f: 300, w: 350, g: 150, age: 1 }); g.refreshLooks(0);
      for (let i = 0; i < 3; i++) g.spawnUnit(0, 'sword', hall.x + 6 + i, hall.z - 6);
      for (let i = 0; i < 2; i++) g.spawnUnit(0, 'archer', hall.x + 5 + i, hall.z - 7.5);
    }
    rts.lookAt(hall.x + 6, hall.z - 6); rts.dist = rts.distT = 30;
  }
  g.recount();
  app.ai = new AI(g, 1);
  g.cycle = app.settings.cycle !== false && !tut; // the tutorial stays sunny
  g.fow = new FogOfWar(g, mode !== 'battle' && app.settings.fog !== false);
  if (tut) { g.tutorial = true; app.ai.nextAttack = 1e9; app.tut = new Tutorial(app); }
  if (mis) { app.campaign = { id: app.missionId || 0, noSave: true }; g.mission = mis; mis.setup(g, app); g.recount(); setTimeout(() => app.toast(`${mis.name}: ${mis.goals[0].t}`, 5), 600); }
  rts.yaw = -Math.PI / 4;
  app.mode = 'rts'; app.select([]);
  $('title').classList.add('hide'); $('home').classList.add('hide'); $('hud').classList.remove('hide');
  if (!tut && !mis) app.toast(MODES[mode].name + ': ' + (mode === 'skirmish' ? 'destroy the enemy Town Hall!' : mode === 'battle' ? 'defeat the enemy army!' : 'survive 10 waves!'), 5);
}
function showEnd(res) {
  clearSave();
  if (app.mode === 'pov') exitPOV();
  const cm = app.campaign; if (cm && res === 'win') saveProgress(cm.id + 1);
  $('bNext').classList.toggle('hide', !(cm && res === 'win' && cm.id < MISSIONS.length - 1));
  $('endT').textContent = res === 'win' ? (cm ? 'MISSION COMPLETE' : 'VICTORY') : 'DEFEAT';
  if (cm && res === 'win' && cm.id === MISSIONS.length - 1) { $('endS').textContent = 'The Warlord is beaten and the valley is free. Campaign complete!'; $('end').classList.remove('hide'); return; }
  const s = app.game.time | 0;
  $('endS').textContent = (res === 'win' ? 'The day is yours, Commander.' : 'Your banner has fallen.') + ` (${s / 60 | 0}m ${s % 60}s)`;
  $('end').classList.remove('hide');
}
const reloadTo = hash => { location.hash = hash; location.reload(); };
const playHash = () => app.campaign ? `mission=${app.campaign.id},${app.game.civKeys[0]}` : `play=${app.game.mode},${app.game.diff},${app.game.civKeys[0]},${app.game.civKeys[1]}`;
function startMission(i, civ) {
  const m = MISSIONS[i]; if (!m) return;
  if (m.map !== MAP.id) { try { localStorage.setItem('bf.map', m.map); } catch { /* ignore */ } reloadTo(`mission=${i},${civ}`); return; }
  app.missionId = i; setupGame('campaign', m.diff, civ);
}

// ---------------- 1st/3rd person ----------------
function enterPOV(unit) {
  if (!unit || !unit.alive) return;
  rts.cancel(); if (app.pending) app.cancelPending();
  app.mode = 'pov'; pov.enter(unit);
  $('hud').classList.add('hide'); $('pov').classList.remove('hide'); $('joyIdle').classList.toggle('hide', !isTouch);
  $('pvn').textContent = (unit.d.hero ? '⚑ ' : '') + unit.d.name;
  app.toast(`You are now playing as ${unit.d.hero ? 'your Commander' : 'a ' + unit.d.name}.`, 2.5);
  $('povhelp').textContent = isTouch ? 'Left thumb: move · Right thumb: look' : 'Drag mouse to look around · W/S/↑/↓ move · A/D sidestep · ←/→ or Q/E turn · Click or Space strike · Shift sprint · F follow · V 1st/3rd · Tab back · Double-click: mouse-look';
  $('povhelp').classList.remove('hide'); clearTimeout(enterPOV.t); enterPOV.t = setTimeout(() => $('povhelp').classList.add('hide'), 6000);
}
function exitPOV() {
  const u = pov.unit; pov.leave(); app.mode = 'rts';
  if (u) rts.lookAt(u.x, u.z);
  $('pov').classList.add('hide'); $('hud').classList.remove('hide');
}
const rideTarget = () => app.sel.find(e => e.kind === 'unit' && e.team === 0 && e.alive) || (app.game.hero?.alive ? app.game.hero : null);

// ---------------- buttons ----------------
const onBtn = (id, fn) => $(id).addEventListener('click', e => { e.stopPropagation(); fn(); });
for (const el of document.querySelectorAll('#hud .btn, #pov .btn, #bottom, #top')) el.addEventListener('pointerdown', e => e.stopPropagation());
onBtn('bAll', () => app.select(app.game.units.filter(u => u.alive && u.team === 0 && u.type !== 'peasant' && !u.possessed)));
let idleIx = 0;
function selectIdle() {
  const idle = app.game.units.filter(u => u.alive && u.team === 0 && u.type === 'peasant' && u.task.type === 'idle');
  if (!idle.length) { app.toast('No idle peasants.', 2); return; }
  const u = idle[idleIx++ % idle.length]; app.select([u]); rts.lookAt(u.x, u.z);
}
onBtn('bIdle', selectIdle);
onBtn('bRotL', () => rts.rotateBy(Math.PI / 4));
onBtn('bRotR', () => rts.rotateBy(-Math.PI / 4));
onBtn('bNorth', () => rts.resetView());
for (const id of ['bRotL', 'bRotR', 'bNorth']) $(id).addEventListener('pointerdown', e => e.stopPropagation());
canvas.addEventListener('dblclick', () => { if (app.mode === 'pov') pov.lockMouse(); });
onBtn('bBox', () => { rts.boxMode = !rts.boxMode; $('bBox').classList.toggle('on', rts.boxMode); app.toast(rts.boxMode ? 'Box select: drag a box around units. Tap Box again to pan.' : 'Drag to move the camera.', 2.5); });
if (!isTouch) $('bBox').classList.add('hide');
onBtn('bRide', () => { const u = rideTarget(); if (u) enterPOV(u); else app.toast('Select one of your units first.', 2); });
onBtn('bLead', () => { if (app.game.hero?.alive) enterPOV(app.game.hero); else app.toast('Your Commander will return soon.', 2); });
onBtn('bExit', exitPOV);
onBtn('bView', () => pov.setFirst(!pov.first));
$('bStrike').addEventListener('pointerdown', e => { e.stopPropagation(); pov.holding = true; pov.strike(); });
for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) $('bStrike').addEventListener(ev, () => { pov.holding = false; });
onBtn('bFollow', () => pov.toggleFollow());
for (const [id, k] of [['bCry', 'cry'], ['bCharge', 'charge'], ['bRally', 'rally']]) onBtn(id, () => { if (pov.unit && !app.game.useAbility(pov.unit, k)) app.toast(`Recharging: ${Math.ceil(app.game.abilityLeft(pov.unit, k))}s`, 1.2); });
setInterval(() => { // ability buttons in 3rd person: only for the Commander, greyed out while recharging
  const u = app.mode === 'pov' && pov.unit?.d.hero ? pov.unit : null; $('povabil').classList.toggle('hide', !u); if (!u) return;
  for (const [id, k, key] of [['bCry', 'cry', 'R'], ['bCharge', 'charge', 'C'], ['bRally', 'rally', 'T']]) { const left = Math.ceil(app.game.abilityLeft(u, k)), b = $(id); b.classList.toggle('cool', left > 0); b.querySelector('small').textContent = left ? left + 's' : (isTouch ? 'ready' : key); }
}, 250);
onBtn('bAct', () => pov.act());
onBtn('bMount', () => pov.toggleMount());
onBtn('bPause', () => setPause(true));
onBtn('bMap', () => { app.settings.mapOff = !app.settings.mapOff; applySettings(); });
$('miniw').addEventListener('pointerdown', e => e.stopPropagation());
onBtn('bResume', () => setPause(false));
onBtn('bRestart', () => reloadTo(playHash()));
onBtn('bQuit', () => reloadTo(''));
onBtn('bAgain', () => reloadTo(playHash()));
onBtn('bNext', () => reloadTo(`mission=${app.campaign.id + 1},${app.game.civKeys[0]}`));
setInterval(() => { // campaign goals, top-right
  const g = app.game, m = g?.mission, el = $('goals'); el.classList.toggle('hide', !m || app.mode !== 'rts'); if (!m) return;
  const fmt = s => `${s / 60 | 0}:${String(s % 60 | 0).padStart(2, '0')}`;
  el.innerHTML = `<b>${m.name}</b>` + m.goals.map(x => `<div class="${x.done(g) ? 'ok' : ''}">${x.t}${x.timer ? ' (' + fmt(x.timer(g)) + ')' : ''}</div>`).join('');
}, 500);
onBtn('bMenu', () => reloadTo(''));
onBtn('bLook', () => $('end').classList.add('hide'));
onBtn('bFs', goFullscreen);
onBtn('bSound', () => { $('bSound').textContent = sound.toggle() ? 'Sound: on' : 'Sound: off'; });
$('bSound').textContent = sound.on ? 'Sound: on' : 'Sound: off';
function setPause(v) { if (v && app.multi) { app.toast('Online games can\'t be paused.', 2); return; } app.paused = v; $('pause').classList.toggle('hide', !v); if (v) saveGame(app); }
function goFullscreen() {
  const d = document;
  if (d.fullscreenElement) { d.exitFullscreen?.(); return; }
  d.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
}

// title menu
const modesEl = $('modes');
for (const [k, m] of Object.entries(MODES)) { const b = document.createElement('button'); b.className = 'btn'; b.dataset.mode = k; b.textContent = m.name; modesEl.appendChild(b); }
const civsEl = $('civs');
for (const k of CIV_LIST) { const b = document.createElement('button'); b.className = 'btn'; b.dataset.civ = k; b.textContent = CIVS[k].name; civsEl.appendChild(b); b.addEventListener('click', () => { app.cfg.civ = k; refreshMenu(); }); }
function refreshMenu() {
  if (!CIVS[app.cfg.civ]) app.cfg.civ = 'franks';
  for (const b of document.querySelectorAll('[data-civ]')) b.classList.toggle('on', b.dataset.civ === app.cfg.civ);
  const c = CIVS[app.cfg.civ];
  $('civInfo').innerHTML = `<b>${c.name}</b> — ${c.motto} Unique unit: <b>${UD[c.unique.type].name}</b><br>` + c.pros.map(p => `<span class="pro">+ ${p}</span>`).join(' · ') + ' · ' + c.cons.map(p => `<span class="con">− ${p}</span>`).join(' · ');
  for (const b of document.querySelectorAll('[data-mode]')) b.classList.toggle('on', b.dataset.mode === app.cfg.mode);
  for (const b of document.querySelectorAll('[data-d]')) b.classList.toggle('on', +b.dataset.d === app.cfg.diff);
  for (const b of document.querySelectorAll('[data-q]')) b.classList.toggle('on', b.dataset.q === qLevel);
  $('modeDesc').textContent = MODES[app.cfg.mode].desc;
  for (const b of document.querySelectorAll('[data-map]')) b.classList.toggle('on', b.dataset.map === (app.cfg.map || 'riverlands'));
  $('mapDesc').textContent = MAP_LIST[app.cfg.map || 'riverlands'].desc;
  const onl = app.cfg.mode === 'online'; $('online').classList.toggle('hide', !onl); $('onlineMsg').classList.toggle('hide', !onl); $('bStart').classList.toggle('hide', onl);
  const camp = app.cfg.mode === 'campaign'; $('missions').classList.toggle('hide', !camp); $('maps').classList.toggle('hide', camp); $('mapDesc').classList.toggle('hide', camp);
  if (camp) { const pr = progress(); app.cfg.mission = Math.min(app.cfg.mission ?? pr, pr, MISSIONS.length - 1); for (const b of document.querySelectorAll('[data-mis]')) { b.classList.toggle('on', +b.dataset.mis === app.cfg.mission); b.classList.toggle('locked', +b.dataset.mis > pr); } const m = MISSIONS[app.cfg.mission]; $('modeDesc').textContent = m.brief + ' Goals: ' + m.goals.map(x => x.t).join(' · ') + '.'; }
}
try { const s = JSON.parse(localStorage.getItem('bf.cfg') || 'null'); if (s && MODES[s.mode]) app.cfg = s; } catch { /* ignore */ }
MISSIONS.forEach((m, i) => { const b = document.createElement('button'); b.className = 'btn'; b.dataset.mis = i; b.textContent = m.name.split('. ')[0]; b.title = m.name; $('missions').appendChild(b); b.addEventListener('click', () => { if (i > progress()) { app.toast?.('Finish the previous mission first.', 2); return; } app.cfg.mission = i; refreshMenu(); }); });
for (const [k, m] of Object.entries(MAP_LIST)) { const b = document.createElement('button'); b.className = 'btn'; b.dataset.map = k; b.textContent = m.name; $('maps').appendChild(b); b.addEventListener('click', () => { app.cfg.map = k; refreshMenu(); }); }
for (const b of document.querySelectorAll('[data-mode]')) b.addEventListener('click', () => { app.cfg.mode = b.dataset.mode; refreshMenu(); });
for (const b of document.querySelectorAll('[data-d]')) b.addEventListener('click', () => { app.cfg.diff = +b.dataset.d; refreshMenu(); });
for (const b of document.querySelectorAll('[data-q]')) b.addEventListener('click', () => {
  if (b.dataset.q === qLevel) return;
  try { localStorage.setItem('bf.quality', b.dataset.q); localStorage.setItem('bf.cfg', JSON.stringify(app.cfg)); } catch { /* ignore */ }
  reloadTo('');
});
onBtn('bTutSkip', () => app.tut?.skip());
onBtn('bHelp', () => { $('help').classList.remove('hide'); });
// ---------------- main menu → setup ----------------
const showHome = () => { $('title').classList.add('hide'); $('home').classList.remove('hide'); };
function showSetup(mode) {
  if (mode) app.cfg.mode = mode;
  $('setupT').textContent = { campaign: 'Campaign', online: 'Online' }[app.cfg.mode] || 'New game';
  $('modes').classList.toggle('hide', ['campaign', 'online', 'tutorial'].includes(app.cfg.mode));
  for (const b of document.querySelectorAll('[data-mode]')) b.classList.toggle('hide', !['skirmish', 'battle', 'survival'].includes(b.dataset.mode));
  refreshMenu(); $('home').classList.add('hide'); $('title').classList.remove('hide');
}
onBtn('hPlay', () => showSetup(['skirmish', 'battle', 'survival'].includes(app.cfg.mode) ? app.cfg.mode : 'skirmish'));
onBtn('hCamp', () => showSetup('campaign'));
onBtn('hOnline', () => showSetup('online'));
onBtn('hTut', () => { app.cfg.mode = 'tutorial'; try { localStorage.setItem('bf.tutSeen', '1'); } catch { /* ignore */ } if (isTouch) goFullscreen(); setupGame('tutorial', 0, app.cfg.civ); });
onBtn('bBack', showHome);
const openSettings = () => {
  const S = app.settings; $('sLook').value = S.look; $('sCam').value = S.cam; $('sVol').value = S.vol; $('sMusic').checked = S.music; $('sVoice').checked = S.voice; $('sBig').checked = S.big; $('sAuto').checked = S.auto; $('sFog').checked = S.fog; $('sMapBot').checked = S.mapBot; $('sCycle').checked = S.cycle;
  $('settings').classList.remove('hide');
};
onBtn('bSettings', openSettings); onBtn('bSettings2', openSettings);
onBtn('bSetBack', () => { $('settings').classList.add('hide'); });
for (const [id, key, num] of [['sLook', 'look', 1], ['sCam', 'cam', 1], ['sVol', 'vol', 1], ['sMusic', 'music'], ['sVoice', 'voice'], ['sBig', 'big'], ['sAuto', 'auto'], ['sFog', 'fog'], ['sMapBot', 'mapBot'], ['sCycle', 'cycle']])
  $(id).addEventListener('input', e => { app.settings[key] = num ? +e.target.value : e.target.checked; applySettings(); });
applySettings();
// auto-pause when the app goes to the background (phone call, switching apps)
document.addEventListener('visibilitychange', () => { if (document.hidden) saveGame(app); if (document.hidden && app.settings.auto && app.game && !app.game.over && !app.multi) setPause(true); });
// "Install app" (Android Chrome offers this; on iPhone use Share → Add to Home Screen)
let installEvt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('bInstall').classList.remove('hide'); });
onBtn('bInstall', async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice.catch(() => {}); installEvt = null; $('bInstall').classList.add('hide'); });
onBtn('bHelpBack', () => { $('help').classList.add('hide'); });
onBtn('bStart', () => {
  try { localStorage.setItem('bf.cfg', JSON.stringify(app.cfg)); } catch { /* ignore */ }
  if (isTouch) goFullscreen();
  if (app.cfg.mode === 'campaign') { startMission(app.cfg.mission || 0, app.cfg.civ); return; }
  const want = MAP_LIST[app.cfg.map] ? app.cfg.map : 'riverlands';
  if (want === 'random' || want !== MAP.id) { // maps are built when the page loads: reload into the chosen one
    try { localStorage.setItem('bf.map', want); if (want === 'random') localStorage.setItem('bf.mapSeed', String(1 + Math.random() * 99998 | 0)); } catch { /* ignore */ }
    reloadTo(`play=${app.cfg.mode},${app.cfg.diff},${app.cfg.civ}`); return;
  }
  setupGame(app.cfg.mode, app.cfg.diff, app.cfg.civ);
});
refreshMenu();

// ---------------- online play (see net.js) ----------------
const onlineMsg = html => { $('onlineMsg').innerHTML = html; $('onlineMsg').classList.remove('hide'); };
function startOnline(role, link, civs) {
  app.multi = { role, link };
  setupGame('skirmish', 1, civs[0], civs[1]);
  app.multi.sync = role === 'host' ? new HostSync(app, link) : new GuestSync(app, link);
  app.toast(role === 'host' ? 'Your friend has joined. Destroy their Town Hall!' : 'Connected! Destroy your friend\'s Town Hall!', 4);
  link.on('close', () => {
    if (!app.multi || app.game?.over) return;
    if (role === 'host') { app.toast('Your friend left. The computer takes over their side.', 5); app.multi = null; }
    else { app.toast('Lost the connection to the host.', 5); app.game.over = 'lose'; showEnd('lose'); $('endS').textContent = 'The connection to the host was lost.'; }
  });
}
onBtn('bHost', async () => {
  const want = MAP_LIST[app.cfg.map] ? app.cfg.map : 'riverlands';
  if (want !== MAP.id) { // maps are built at page load: switch to the chosen one first, then host
    try { localStorage.setItem('bf.map', want); if (want === 'random') localStorage.setItem('bf.mapSeed', String(1 + Math.random() * 99998 | 0)); localStorage.setItem('bf.cfg', JSON.stringify(app.cfg)); } catch { /* ignore */ }
    reloadTo('host'); return;
  }
  const link = new Link(), code = newCode(); onlineMsg('Setting up…');
  try { await link.host(code); } catch (e) { onlineMsg(e.message); return; }
  onlineMsg(`Your code: <b>${code}</b><br>Tell your friend to pick Online, type this code and press Join. Waiting…`);
  link.on('hello', m => {
    if (m.ver !== window.BF_VERSION) { link.send({ k: 'bad', msg: `Versions differ (host ${window.BF_VERSION}, you ${m.ver}). Both reload the game page.` }); return; }
    link.guestCiv = CIVS[m.civ] ? m.civ : 'romans'; link.send({ k: 'map', map: MAP.id, seed: MAP.seed });
  });
  link.on('ready', () => { link.send({ k: 'start', civs: [link.guestCiv, app.cfg.civ] }); if (isTouch) goFullscreen(); startOnline('host', link, [app.cfg.civ, link.guestCiv]); });
});
async function joinGame(code) {
  code = (code || '').trim().toUpperCase(); if (code.length < 5) { onlineMsg('Type the 5-letter code your friend sees.'); return; }
  const link = new Link(); onlineMsg('Connecting…');
  try { await link.join(code); } catch (e) { onlineMsg(e.message); return; }
  link.on('bad', m => onlineMsg(m.msg));
  link.on('map', m => {
    if (m.map !== MAP.id || (m.map === 'random' && m.seed !== MAP.seed)) { try { localStorage.setItem('bf.map', m.map); localStorage.setItem('bf.mapSeed', String(m.seed)); } catch { /* ignore */ } link.close(); reloadTo('join=' + code); return; }
    link.send({ k: 'ready' }); onlineMsg('Starting…');
  });
  link.on('start', m => { if (isTouch) goFullscreen(); startOnline('guest', link, m.civs); });
  link.send({ k: 'hello', ver: window.BF_VERSION, civ: app.cfg.civ });
}
onBtn('bJoin', () => joinGame($('joinCode').value));
$('joinCode').addEventListener('keydown', e => { if (e.key === 'Enter') joinGame(e.target.value); });

// ---------------- input ----------------
const view = () => (app.mode === 'pov' ? pov : app.mode === 'rts' ? rts : null);
canvas.addEventListener('pointerdown', e => view()?.down(e));
addEventListener('pointermove', e => view()?.move(e));
addEventListener('pointerup', e => view()?.up(e));
addEventListener('pointercancel', e => view()?.up(e));
canvas.addEventListener('wheel', e => { e.preventDefault(); view()?.wheel(e); }, { passive: false });
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('blur', () => { app.keys = {}; rts.cancel(); pov.cancel(); });
addEventListener('keydown', e => {
  app.keys[e.code] = true;
  if (app.mode === 'menu' || e.repeat) return;
  if (e.code === 'Tab') { e.preventDefault(); app.mode === 'pov' ? exitPOV() : enterPOV(rideTarget()); return; }
  if (e.code === 'KeyP') { setPause(!app.paused); return; }
  if (app.mode === 'rts') {
    if (e.code === 'Escape') { if (app.pending) app.cancelPending(); else app.select([]); return; }
    if ((e.code === 'KeyA' && (e.ctrlKey || e.metaKey)) || e.code === 'F2') { e.preventDefault(); $('bAll').click(); return; }
    if (e.code === 'KeyH') { $('bLead').click(); return; }
    if (e.code === 'KeyI') { selectIdle(); return; }
    if (e.code === 'Home') { rts.resetView(); return; }
    const dig = /^Digit([1-9])$/.exec(e.code);
    if (dig) { // control groups: Ctrl+number saves the selection, number recalls it (twice = jump to it)
      const n = +dig[1];
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); groups[n] = app.sel.filter(u => u.kind === 'unit' && u.team === 0); app.toast(`Group ${n} set (${groups[n].length} units).`, 1.5); }
      else if (groups[n]) {
        const list = groups[n].filter(u => u.alive); app.select(list);
        const now = performance.now();
        if (list.length && lastGroup.n === n && now - lastGroup.t < 400) rts.lookAt(list.reduce((s2, u) => s2 + u.x, 0) / list.length, list.reduce((s2, u) => s2 + u.z, 0) / list.length);
        lastGroup.n = n; lastGroup.t = now;
      }
      return;
    }
    if (hud.hotkey(e.code)) e.preventDefault();
  } else {
    if (e.code === 'KeyV') pov.setFirst(!pov.first);
    if (e.code === 'KeyF') pov.toggleFollow();
    if (e.code === 'KeyG') pov.act();
    if (e.code === 'KeyM') pov.toggleMount();
    if (pov.unit?.d.hero) { const k = { KeyR: 'cry', KeyC: 'charge', KeyT: 'rally' }[e.code]; if (k) $({ cry: 'bCry', charge: 'bCharge', rally: 'bRally' }[k]).click(); }
    if (e.code === 'Space') { e.preventDefault(); pov.holding = true; pov.strike(); }
  }
});
addEventListener('keyup', e => { app.keys[e.code] = false; if (e.code === 'Space') pov.holding = false; });
const groups = {}, lastGroup = { n: 0, t: 0 };
document.addEventListener('mouseleave', () => { rts.mouse.in = false; });
addEventListener('blur', () => { rts.mouse.in = false; });

function resize() { renderer.setSize(innerWidth, innerHeight, false); fx.setScale(innerHeight * renderer.getPixelRatio() / (2 * Math.tan(camera.fov * Math.PI / 360))); if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(innerWidth, innerHeight); } camera.aspect = innerWidth / innerHeight; viewOff = -1; updateViewOffset(); hud.resize(); }
// In command view, centre the picture in the space between the top bar and the bottom panel.
let viewOff = -1;
function updateViewOffset() {
  const off = app.mode === 'rts' ? Math.round(((document.getElementById('bottom').offsetHeight || 0) - (document.getElementById('top').offsetHeight || 0)) / 2) : 0;
  if (off === viewOff) return; viewOff = off;
  if (off > 0) camera.setViewOffset(innerWidth, innerHeight + off * 2, 0, off * 2, innerWidth, innerHeight); else camera.clearViewOffset();
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

// ---------------- loop ----------------
const clock = new THREE.Clock();
let menuYaw = 0;
renderer.setAnimationLoop(() => {
  const real = Math.min(clock.getDelta(), 1 / 20), dt = app.paused ? 0 : real, t = clock.elapsedTime;
  const g = app.game;
  if (g) { g.update(dt); app.multi?.sync?.update(dt); if (app.multi) { /* the other side is a person */ } else if (!app.tut || app.tut.done) app.ai.update(dt); else if ((app.tutAi = (app.tutAi || 0) + dt) > 1) { app.tutAi = 0; app.ai.update(1.01); app.ai.nextAttack = 1e9; } app.tut?.update(); }
  updateViewOffset();
  if (app.mode === 'pov') pov.update(dt);
  else if (app.mode === 'rts') rts.update(real);
  else { menuYaw += real * .05; rts.yaw = menuYaw; rts.dist = rts.distT = 75; rts.lookAt(64, 64); rts.update(real); }
  if (g) g.syncVisuals(dt, pov.first && pov.unit ? pov.unit.id : -1);
  water.userData.update(t); U.time.value = t; updateFish(t);
  if (g) emitEffects(dt);
  fx.update(dt);
  const f = app.mode === 'pov' && pov.unit ? pov.unit : rts.focus; // keep the sharp-shadow area centred on the action
  { const k = g && g.time - (app.lastFight ?? -99) < 9 ? 1 : 0; if (k !== app.musicK) { app.musicK = k; sound.setIntensity?.(k); } }
  atmo.update(dt, g?.cycle ? g.env : null, camera); SUN_DIR.copy(atmo.dir);
  sun.target.position.set(f.x, 0, f.z); sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 110);
  if (marker.visible) { markerT += real; marker.scale.setScalar(1 + markerT * 1.5); marker.material.opacity = 1 - markerT / .7; if (markerT > .7) marker.visible = false; }
  hud.update(real);
  water.userData.reflect?.(renderer, scene, camera); // mirror image for the water (High quality)
  renderer.shadowMap.needsUpdate = true;
  camera.updateMatrixWorld(); FOW.cam.value.copy(camera.matrixWorld);
  if (composer) composer.render(real); else renderer.render(scene, camera);
});

// ---------------- ambient effects: smoke & fire from damaged buildings, chimneys, forges, ship spray ----------------
let emitT = 0;
function emitEffects(dt) {
  if (!dt || (emitT += dt) < .1) return; emitT = 0;
  const g = app.game;
  for (const b of g.blds) {
    if (!b.alive || !b.built) continue;
    const f = b.hp / b.maxHp, top = b.y + (b.type === 'tower' ? 4.5 : b.size * .7 + .8);
    if (f < .6 && Math.random() < .7) fx.smoke(b.x + (Math.random() - .5) * b.size * .6, top, b.z + (Math.random() - .5) * b.size * .6, .18, 1 + b.size * .15);
    if (f < .35) { fx.fire(b.x + (Math.random() - .5) * b.size * .7, top - .6, b.z + (Math.random() - .5) * b.size * .7, .8 + b.size * .1); if (Math.random() < .3) fx.ember(b.x, top, b.z); }
    if ((b.type === 'house' || b.type === 'hall') && Math.random() < .12) fx.chimney(b.x + (b.type === 'house' ? .5 : -1), b.y + (b.type === 'house' ? 3.0 : 4.5), b.z - .3);
    if (b.type === 'smith') { if (Math.random() < .35) fx.chimney(b.x + .8, b.y + 3.9, b.z - .8); if (Math.random() < .25) fx.ember(b.x - .3, b.y + .8, b.z - .15); }
  }
  if (pov.room) { const r = pov.room, c = Math.cos(r.ry), sn = Math.sin(r.ry); for (const [x, y, z] of r.it.fires) fx.fire(r.b.x + x * c + z * sn, r.b.mesh.position.y + y, r.b.z - x * sn + z * c, .45); }
  for (const u of g.units) if (u.alive && u.d.ship && u.speedNow > 0 && Math.random() < .5) { const fxx = Math.sin(u.yaw), fz = Math.cos(u.yaw), L = u.type === 'warship' ? 3.6 : u.type === 'transport' ? 2.7 : 1.6; fx.splash(u.x + fxx * L, WL, u.z + fz * L, 2); }
}

// ---------------- boot ----------------
$('ver').textContent = 'v' + VERSION;
$('loading').remove();
setInterval(() => { if (app.game && !app.paused) saveGame(app); }, 30000); // autosave
{ try { if (!localStorage.getItem('bf.tutSeen') && !saveInfo()) $('hTut').classList.add('first'); } catch { /* ignore */ } const pr = progress(); $('campInfo').textContent = pr >= MISSIONS.length ? 'all 4 missions won!' : `mission ${pr + 1} of ${MISSIONS.length}`; }
{ const info = saveInfo(); if (info) { $('bContinue').classList.remove('hide'); const s = info.time | 0; $('contInfo').textContent = `${MODES[info.mode]?.name || ''} · ${CIVS[info.civs?.[0]]?.name || ''} · ${s / 60 | 0}:${String(s % 60).padStart(2, '0')}`; } }
onBtn('bContinue', () => { const i = saveInfo(); try { if (i?.map) { localStorage.setItem('bf.map', i.map); localStorage.setItem('bf.mapSeed', String(i.seed || 1)); } } catch { /* ignore */ } reloadTo('resume'); });
if (location.hash.startsWith('#play=')) app.cfg.map = MAP.id;
if (location.hash === '#host' || location.hash.startsWith('#join=')) { // came back after loading the right map
  const jc = location.hash.startsWith('#join=') ? location.hash.slice(6) : null; history.replaceState(null, '', location.pathname + location.search);
  app.bootSetup = true; showSetup('online'); if (jc) { $('joinCode').value = jc; joinGame(jc); } else $('bHost').click();
}
const mh = /mission=(\d)(?:,(\w+))?/.exec(location.hash);
if (mh && MISSIONS[+mh[1]]) { app.cfg = { ...app.cfg, mode: 'campaign', mission: +mh[1], civ: mh[2] || app.cfg.civ || 'franks' }; history.replaceState(null, '', location.pathname + location.search); startMission(+mh[1], app.cfg.civ); }
const m = /play=(\w+),(\d)(?:,(\w+))?(?:,(\w+))?/.exec(location.hash);
if (location.hash === '#resume' && loadSave()) { const d = loadSave(); app.cfg = { mode: d.mode, diff: d.diff, civ: d.civs[0], map: MAP.id }; setupGame(d.mode, d.diff, d.civs[0], d.civs[1]); applySave(app, d); app.toast('Welcome back! Your game has been restored.', 3); history.replaceState(null, '', location.pathname + location.search); }
else if (m && MODES[m[1]]) { app.cfg = { mode: m[1], diff: +m[2], civ: m[3] || 'franks' }; setupGame(m[1], +m[2], m[3], m[4]); }
else if (!app.bootSetup) showHome();
window.bannerfall = app; // handy for debugging in the browser console
