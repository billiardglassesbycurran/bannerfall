// Button pictures. Buildings and units get a small portrait rendered from their real 3D model (so the picture always
// matches the game, made once and cached); actions and upgrades get small drawn symbols (inline SVG).
import * as THREE from 'three';
import { buildingMesh, figureGroup } from './models.js';
import { UD } from './data.js';

let R = null, scene = null, cam = null, rt = null;
const cache = new Map(), PX = 96;
export function initIcons(renderer) {
  R = renderer;
  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xeef4ff, 0x6a5a40, 1.6));
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.6); sun.position.set(3, 6, 5); scene.add(sun);
  cam = new THREE.PerspectiveCamera(28, 1, .1, 200);
  rt = new THREE.WebGLRenderTarget(PX, PX, { samples: 4 }); rt.texture.colorSpace = THREE.SRGBColorSpace;
}
/** A portrait of a unit ('u:sword') or building ('b:barracks') as an image URL. */
export function portrait(key, team = 0, style = 'franks', look = { age: 1 }) {
  const ck = key + '|' + style + '|' + (look.age || 0); if (cache.has(ck)) return cache.get(ck);
  if (!R) return null;
  const [kind, type] = key.split(':'); let obj;
  try { obj = kind === 'u' ? figureGroup(team, type, style) : buildingMesh(type, team, false, look); } catch { cache.set(ck, null); return null; }
  scene.add(obj);
  const box = new THREE.Box3().setFromObject(obj); let c = box.getCenter(new THREE.Vector3()); const s = box.getSize(new THREE.Vector3());
  let r = Math.max(s.x, s.y * 1.05, s.z) * .5;
  const ud = kind === 'u' && UD[type];
  if (ud && !ud.ship && type !== 'catapult') { const horse = ud.horse; c = new THREE.Vector3(0, horse ? 1.75 : 1.2, 0); r = horse ? 1.05 : .62; } // frame the body, not the spear tip
  const d = r / Math.tan(THREE.MathUtils.degToRad(14)) * (kind === 'u' ? 1.12 : 1.05);
  const dir = kind === 'u' ? new THREE.Vector3(.5, .32, 1) : new THREE.Vector3(.75, .7, 1); dir.normalize();
  cam.position.copy(c).addScaledVector(dir, d); cam.lookAt(c); cam.updateMatrixWorld();
  const prevT = R.getRenderTarget(), prevC = R.getClearColor(new THREE.Color()), prevA = R.getClearAlpha(), prevTone = R.toneMapping, prevFog = scene.fog;
  R.setRenderTarget(rt); R.setClearColor(0x000000, 0); R.clear(); R.render(scene, cam);
  const buf = new Uint8Array(PX * PX * 4); R.readRenderTargetPixels(rt, 0, 0, PX, PX, buf);
  R.setRenderTarget(prevT); R.setClearColor(prevC, prevA); R.toneMapping = prevTone; scene.fog = prevFog;
  scene.remove(obj); obj.traverse(o => { if (o.isMesh && o.geometry && kind === 'u') o.geometry.dispose(); });
  const cv = document.createElement('canvas'); cv.width = cv.height = PX; const cx = cv.getContext('2d'), img = cx.createImageData(PX, PX);
  for (let y = 0; y < PX; y++) img.data.set(buf.subarray((PX - 1 - y) * PX * 4, (PX - y) * PX * 4), y * PX * 4); // WebGL rows are upside down
  cx.putImageData(img, 0, 0);
  const url = cv.toDataURL('image/png'); cache.set(ck, url); return url;
}

// ---------- drawn symbols (24×24, drawn in the button's text colour) ----------
const P = {
  sword: '<path d="M18 3l3 3-10 10-3-3z"/><path d="M6 14l4 4M5 19l3-3M4 20l1 1"/>',
  attack: '<path d="M14 3l7 0 0 7-9 9-3-3zM10 3H3v7l9 9 3-3z" fill="none"/><path d="M5 17l2 2M17 17l2 2"/>',
  shield: '<path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z"/>',
  bow: '<path d="M6 3c8 3 8 15 0 18M6 3v18"/><path d="M4 12h15M16 9l3 3-3 3"/>',
  horse: '<path d="M7 21v-6l-3-3 4-6 4-3 3 1 4 4-2 2-3-1-1 3 2 9"/>',
  hammer: '<path d="M5 9l6-6 4 4-2 2 7 7-2 2-7-7-2 2z"/>',
  house: '<path d="M3 11l9-7 9 7M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>',
  tower: '<path d="M7 21V8h10v13M6 8V4h2v2h2V4h4v2h2V4h2v4"/><path d="M11 21v-4h2v4"/>',
  wall: '<path d="M3 20V9h3V7h3v2h3V7h3v2h3V7h3v13z"/><path d="M3 14h18M9 9v5M15 9v5M6 14v6M12 14v6M18 14v6"/>',
  coin: '<circle cx="12" cy="12" r="8"/><path d="M12 8v8M10 10h3a1.5 1.5 0 010 3h-2a1.5 1.5 0 000 3h3"/>',
  wheat: '<path d="M12 21V8M12 8c-3-1-3-4 0-5 3 1 3 4 0 5zM12 12c-3-1-4-3-3-5M12 12c3-1 4-3 3-5M12 16c-3-1-4-3-3-5M12 16c3-1 4-3 3-5"/>',
  wood: '<path d="M4 15l12-8 4 3-12 8z"/><circle cx="6" cy="16.5" r="2.5"/><path d="M16 7l2-4 2 2-1 4"/>',
  pick: '<path d="M4 8c5-5 11-5 16 0M12 5l-7 16"/>',
  stone: '<path d="M3 19l3-7 5-1 3 3 7 1-2 4z"/><path d="M8 11l2-5 5 1 1 4"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
  flag: '<path d="M6 21V3M6 4h11l-3 4 3 4H6"/>',
  bell: '<path d="M6 17V11a6 6 0 0112 0v6l2 2H4z"/><path d="M10 21h4"/>',
  star: '<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/>',
  patrol: '<path d="M4 9h13l-3-3M20 15H7l3 3"/>',
  cancel: '<path d="M6 6l12 12M18 6L6 18"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  horn: '<path d="M4 14c4 0 11-5 13-9l3 2c-2 4-6 11-12 12-2 0-4-2-4-5z"/>',
  heart: '<path d="M12 20s-8-5-8-11a4 4 0 018-1 4 4 0 018 1c0 6-8 11-8 11z"/>',
  up: '<path d="M12 20V5M6 11l6-6 6 6"/>',
  scales: '<path d="M12 4v16M7 20h10M4 7h16M6 7l-3 7h6zM18 7l-3 7h6z"/>',
  fish: '<path d="M3 12c4-5 11-5 14 0-3 5-10 5-14 0zM17 12l4-3v6z"/><circle cx="8" cy="11" r=".9"/>',
  anchor: '<circle cx="12" cy="5" r="2"/><path d="M12 7v14M7 11h10M5 15c1 4 4 6 7 6s6-2 7-6"/>',
  demolish: '<path d="M4 20h16M7 20l2-8 4 3 3-6 2 11"/><path d="M14 4l2 2M18 3v3M10 3l1 2"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  crown: '<path d="M4 18h16l1-10-5 4-4-7-4 7-5-4z"/>',
  box: '<rect x="4" y="4" width="16" height="16" rx="1" stroke-dasharray="3 2.5"/>',
  zzz: '<path d="M5 6h6l-6 6h6M13 12h5l-5 5h5"/>',
  helmet: '<path d="M5 15a7 7 0 0114 0v3H5zM12 8v10M9 15h-4M19 15h-4"/>',
  people: '<circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><path d="M3 20c0-4 2-6 5-6s5 2 5 6M11 20c0-4 2-6 5-6s5 2 5 6"/>',
  ship: '<path d="M3 15h18l-3 5H6zM12 15V3l7 9h-7"/>',
  unload: '<path d="M12 4v11M7 10l5 5 5-5M4 20h16"/>',
  stance: '<path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
};
const svg = k => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${P[k] || P.star}</svg>`;
/** Symbol for an upgrade, by what it does. */
export function techSymbol(key, t) {
  if (t.toAge) return 'star'; const e = t.eff || {};
  if (e.melee || key === 'forging' || key === 'veterans' || key === 'pikemen' || key === 'champions') return 'sword';
  if (e.armor) return 'shield'; if (e.ranged || key === 'marksmen' || key === 'royalbows') return 'bow';
  if (key === 'chivalry' || key === 'paladins') return 'horse'; if (e.gather?.w) return 'wood'; if (e.gather?.g) return 'pick';
  if (e.farm) return 'wheat'; if (e.fish) return 'fish'; if (e.wallUp || e.wallUp2) return 'wall'; if (e.towerUp || e.towerUp2 || e.hallUp) return 'tower';
  if (e.gatherAll || e.carry) return 'up'; if (e.bldHp) return 'house'; if (e.elite) return 'crown'; if (e.cls?.ship) return 'anchor';
  return 'up';
}
/** Symbol for an action button, by its label. */
export function actionSymbol(label, sub = '') {
  const L = label.replace(/<[^>]*>|&#\d+;/g, '').trim(), S = sub.replace(/<[^>]*>/g, '');
  const m = [[/^Attack/, 'attack'], [/^Patrol/, 'patrol'], [/^Stop/, 'stop'], [/^(Aggressive|Defensive|Hold)/, 'stance'], [/^Food/, 'wheat'], [/^Wood/, 'wood'], [/^Gold/, 'coin'], [/^Stone/, 'stone'],
    [/^Build/, /econ/.test(S) ? 'house' : /milit/.test(S) ? 'sword' : 'wall'], [/^Repair/, 'hammer'], [/^Return/, 'unload'], [/^(Mount|Dismount)/, 'horse'], [/^War Cry/, 'horn'], [/^Charge/, 'horse'],
    [/^Rally$/, /point/.test(S) ? 'flag' : 'heart'], [/^Rally/, 'flag'], [/^Follow/, 'flag'], [/Bell|All Clear/, 'bell'], [/^(Demolish|Sure)/, 'demolish'], [/^Buy/, 'coin'], [/^Sell/, 'scales'], [/^Fish/, 'fish'],
    [/^Unload/, 'unload'], [/^Board/, 'ship'], [/^\+\d/, 'people'], [/^Peasant ×/, 'people']];
  for (const [re, k] of m) if (re.test(L)) return k;
  if (/back/.test(S) || /^◀/.test(L)) return 'back'; if (/cancel/.test(S)) return 'cancel';
  return null;
}
/** HTML for a button picture: a portrait <img> or a drawn symbol. */
export function iconHtml(ic) {
  if (!ic) return '';
  if (ic.url) return `<img class="bi" src="${ic.url}" alt="">`;
  if (ic.sym) return `<span class="bi sym">${svg(ic.sym)}</span>`;
  return '';
}
export const symbolHtml = k => `<span class="bi sym">${svg(k)}</span>`;
