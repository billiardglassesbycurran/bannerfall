// Bannerfall — entry point: renderer, lighting, menus, game modes, input routing and the main loop.
import * as THREE from 'three';
import { SIZE, BASES, WL, CLOUDS, buildDistant, buildTerrain, buildWater, buildSky, buildResources, buildBridge, buildFish, updateFish, heightAt } from './world.js';
import { BD, DIFF, MODES, CIVS, CIV_LIST, UD, TECH, AGES } from './data.js';
import { FX } from './effects.js';
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
scene.add(new THREE.HemisphereLight(0xd6e6ff, 0x5a4a30, qLevel === 'low' ? 1.2 : .45));
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
buildBridge(scene, Q.shadow > 0);
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
  app.sel = list; for (const e of list) e.selected = true;
  hud.selT = 0; hud.cardT = 0; hud.sig = '';
};
app.order = (ent, x, z) => {
  const units = app.sel.filter(e => e.kind === 'unit' && e.team === 0 && e.alive);
  if (!units.length) return;
  const r = app.game.command(units, ent, x, z);
  showMarker(x, z, r === 'attack' ? 0xff6a4a : r === 'gather' || r === 'build' ? 0x9dff8a : 0xf3d78a);
};
app.setPending = p => {
  app.pending = p; hud.sig = ''; hud.updateCard(); $('place').classList.remove('hide'); $('pok').classList.toggle('hide', !(p.type === 'place' && isTouch));
  $('ptxt').textContent = p.type === 'place' ? (isTouch ? 'Tap the map to position, then ✓' : 'Click to place (Shift: place several)') : p.type === 'amove' ? 'Tap where to attack' : p.type === 'patrol' ? 'Tap the far end of the patrol' : p.type === 'repair' ? 'Tap a damaged building' : p.type === 'unload' ? 'Tap the shore to land your troops' : 'Tap the rally point';
};
app.cancelPending = () => { app.pending = null; if (ghost) { ghost.removeFromParent(); ghost = null; } $('place').classList.add('hide'); hud.sig = ''; hud.updateCard(); };

let ghost = null;
const ghostMats = [new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: .65, color: 0xb0ffb0, depthWrite: false }), new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: .65, color: 0xff7a6a, depthWrite: false })];
app.startPlace = type => {
  app.setPending({ type: 'place', btype: type });
  ghost = ghostObject(type, app.game.look(0), ghostMats[0]); scene.add(ghost);
  const p = rts.pickGround(innerWidth / 2, innerHeight * .42); if (p) moveGhost(p.x, p.z);
};
function moveGhost(x, z) {
  const p = app.pending; if (!p || p.type !== 'place' || !ghost) return;
  const s = BD[p.btype].size; p.cx = Math.round(x - s / 2); p.cz = Math.round(z - s / 2);
  ghost.position.set(p.cx + s / 2, BD[p.btype].dock ? WL + .02 : heightAt(p.cx + s / 2, p.cz + s / 2) + .05, p.cz + s / 2);
  p.ok = app.game.canPlace(p.btype, p.cx, p.cz); const gm = ghostMats[p.ok ? 0 : 1]; if (ghost.isMesh) ghost.material = gm; else ghost.traverse(o => { if (o.isMesh) o.material = gm; });
}
function confirmPlace(keep) {
  const p = app.pending; if (!p || p.type !== 'place') return;
  const builders = app.sel.filter(e => e.kind === 'unit' && e.type === 'peasant' && e.alive);
  const d = BD[p.btype];
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
  if (g.mode === 'battle') { const n = t => g.units.filter(u => u.alive && u.team === t).length; return `${g.civ[0].name} ${n(0)} · ${g.civ[1].name} ${n(1)}`; }
  return `${AGES[g.T[0].age]} · ${g.civ[0].name} vs ${g.civ[1].name} (${DIFF[g.diff].name})`;
};
app.hint = () => {
  const g = app.game;
  if (g.mode === 'battle') return isTouch ? 'Tap <b>Army</b>, then tap an enemy or the ground. Or <b>Lead</b> to fight as your Commander.' : 'Ctrl+A selects your army; right-click enemies to attack. H to lead as your Commander.';
  return isTouch ? 'Tap a peasant, then tap trees, bushes or gold to gather. Peasants build from the panel on the right.' : 'Select peasants to build (Z–M keys). Select a building to train units. Right-click to give orders.';
};

// ---------------- modes ----------------
function setupGame(mode, diff, civ = 'franks', enemyCiv) {
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
  rts.yaw = -Math.PI / 4;
  app.mode = 'rts'; app.select([]);
  $('title').classList.add('hide'); $('hud').classList.remove('hide');
  app.toast(MODES[mode].name + ': ' + (mode === 'skirmish' ? 'destroy the enemy Town Hall!' : mode === 'battle' ? 'defeat the enemy army!' : 'survive 10 waves!'), 5);
}
function showEnd(res) {
  if (app.mode === 'pov') exitPOV();
  $('endT').textContent = res === 'win' ? 'VICTORY' : 'DEFEAT';
  const s = app.game.time | 0;
  $('endS').textContent = (res === 'win' ? 'The day is yours, Commander.' : 'Your banner has fallen.') + ` (${s / 60 | 0}m ${s % 60}s)`;
  $('end').classList.remove('hide');
}
const reloadTo = hash => { location.hash = hash; location.reload(); };
const playHash = () => `play=${app.game.mode},${app.game.diff},${app.game.civKeys[0]},${app.game.civKeys[1]}`;

// ---------------- 1st/3rd person ----------------
function enterPOV(unit) {
  if (!unit || !unit.alive) return;
  rts.cancel(); if (app.pending) app.cancelPending();
  app.mode = 'pov'; pov.enter(unit);
  $('hud').classList.add('hide'); $('pov').classList.remove('hide'); $('joyIdle').classList.toggle('hide', !isTouch);
  $('pvn').textContent = (unit.d.hero ? '⚑ ' : '') + unit.d.name;
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
onBtn('bRide', () => { const u = rideTarget(); if (u) enterPOV(u); else app.toast('Select a unit to ride.', 2); });
onBtn('bLead', () => { if (app.game.hero?.alive) enterPOV(app.game.hero); else app.toast('Your Commander will return soon.', 2); });
onBtn('bExit', exitPOV);
onBtn('bView', () => pov.setFirst(!pov.first));
$('bStrike').addEventListener('pointerdown', e => { e.stopPropagation(); pov.holding = true; pov.strike(); });
for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) $('bStrike').addEventListener(ev, () => { pov.holding = false; });
onBtn('bFollow', () => pov.toggleFollow());
onBtn('bAct', () => pov.act());
onBtn('bMount', () => pov.toggleMount());
onBtn('bPause', () => setPause(true));
onBtn('bResume', () => setPause(false));
onBtn('bRestart', () => reloadTo(playHash()));
onBtn('bQuit', () => reloadTo(''));
onBtn('bAgain', () => reloadTo(playHash()));
onBtn('bMenu', () => reloadTo(''));
onBtn('bLook', () => $('end').classList.add('hide'));
onBtn('bFs', goFullscreen);
onBtn('bSound', () => { $('bSound').textContent = sound.toggle() ? 'Sound: on' : 'Sound: off'; });
$('bSound').textContent = sound.on ? 'Sound: on' : 'Sound: off';
function setPause(v) { app.paused = v; $('pause').classList.toggle('hide', !v); }
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
}
try { const s = JSON.parse(localStorage.getItem('bf.cfg') || 'null'); if (s && MODES[s.mode]) app.cfg = s; } catch { /* ignore */ }
for (const b of document.querySelectorAll('[data-mode]')) b.addEventListener('click', () => { app.cfg.mode = b.dataset.mode; refreshMenu(); });
for (const b of document.querySelectorAll('[data-d]')) b.addEventListener('click', () => { app.cfg.diff = +b.dataset.d; refreshMenu(); });
for (const b of document.querySelectorAll('[data-q]')) b.addEventListener('click', () => {
  if (b.dataset.q === qLevel) return;
  try { localStorage.setItem('bf.quality', b.dataset.q); localStorage.setItem('bf.cfg', JSON.stringify(app.cfg)); } catch { /* ignore */ }
  reloadTo('');
});
onBtn('bHelp', () => { $('help').classList.remove('hide'); });
onBtn('bHelpBack', () => { $('help').classList.add('hide'); });
onBtn('bStart', () => {
  try { localStorage.setItem('bf.cfg', JSON.stringify(app.cfg)); } catch { /* ignore */ }
  if (isTouch) goFullscreen();
  setupGame(app.cfg.mode, app.cfg.diff, app.cfg.civ);
});
refreshMenu();

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
  if (g) { g.update(dt); app.ai.update(dt); }
  updateViewOffset();
  if (app.mode === 'pov') pov.update(dt);
  else if (app.mode === 'rts') rts.update(real);
  else { menuYaw += real * .05; rts.yaw = menuYaw; rts.dist = rts.distT = 75; rts.lookAt(64, 64); rts.update(real); }
  if (g) g.syncVisuals(dt, pov.first && pov.unit ? pov.unit.id : -1);
  water.userData.update(t); U.time.value = t; updateFish(t);
  if (g) emitEffects(dt);
  fx.update(dt);
  const f = app.mode === 'pov' && pov.unit ? pov.unit : rts.focus; // keep the sharp-shadow area centred on the action
  sun.target.position.set(f.x, 0, f.z); sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 110);
  if (marker.visible) { markerT += real; marker.scale.setScalar(1 + markerT * 1.5); marker.material.opacity = 1 - markerT / .7; if (markerT > .7) marker.visible = false; }
  hud.update(real);
  water.userData.reflect?.(renderer, scene, camera); // mirror image for the water (High quality)
  renderer.shadowMap.needsUpdate = true;
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
const m = /play=(\w+),(\d)(?:,(\w+))?(?:,(\w+))?/.exec(location.hash);
if (m && MODES[m[1]]) { app.cfg = { mode: m[1], diff: +m[2], civ: m[3] || 'franks' }; setupGame(m[1], +m[2], m[3], m[4]); }
else $('title').classList.remove('hide');
window.bannerfall = app; // handy for debugging in the browser console
