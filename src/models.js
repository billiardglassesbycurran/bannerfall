// 3D models. Units are drawn with GPU instancing: every Swordsman of a team shares one draw call per body part
// (cloth and metal separately, so steel can shine), which keeps big armies fast on phones.
// Buildings are merged into a single mesh each.
import * as THREE from 'three';
import { Builder, P, M, TEXMAT } from './geo.js';
import { UD } from './data.js';
import { planksTexture, sailTexture, foamTexture } from './textures.js';
import { GM, buildingParts } from './gltfmodels.js';

export const TEAM = [0x2c50a8, 0xa62419];
const C = {
  skin: 0xd8a07c, lip: 0xa86a56, hair: 0x3b2716, beard: 0x4a2e18, eye: 0x1c1410,
  linen: 0xcfc2a2, gamb: 0xa08c66, pants: 0x4a3c2c, hose: 0x3c3a30, leather: 0x5a3a22, dleather: 0x36220f, boot: 0x2c1d10,
  green: 0x4c5c30, dgreen: 0x34401f,
  chain: 0x74777c, steel: 0xb8bcc2, dsteel: 0x5f6268, gold: 0xd6a533, brass: 0xb08a3a,
  wood: 0x6b4a2c, dwood: 0x4a3018, white: 0xeae6dc, straw: 0xcfb064,
  horse: 0x5e3d24, dhorse: 0x2a1a0e, hoof: 0x26201a,
  stone: 0x9a958b, dstone: 0x726e66, plaster: 0xe2d8bf, timber: 0x55391f, thatch: 0xa88a4a, tile: 0x8a4632, dirt: 0x6b5236, crop: 0x8fae3c, hay: 0xd2b464,
};
// building colours that get a photo texture (see geo.js): 1 stone, 2 plaster, 3 roof tiles, 4 thatch, 5 wood
for (const [k, id] of [['stone', 1], ['dstone', 1], ['plaster', 2], ['tile', 3], ['thatch', 4], ['timber', 5], ['wood', 5], ['dwood', 5]]) TEXMAT.set(C[k], id);
const mixHex = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();

// ---------------- prism (gable roof) ----------------
function prism(w, h, d) {
  const W = w / 2, D = d / 2, L = Math.hypot(h, D), v = [], uv = [];
  const tri = (a, b, c, ta = [0, 0], tb = [0, 0], tc = [0, 0]) => { v.push(...a, ...b, ...c); uv.push(...ta, ...tb, ...tc); };
  tri([-W, 0, -D], [-W, 0, D], [-W, h, 0]); tri([W, 0, -D], [W, h, 0], [W, 0, D]);
  // slopes: u runs along the ridge, v up the slope (so roof-tile photos line up)
  const q = (a, b, c, d2) => { tri(a, b, c, [a[0], 0], [b[0], 0], [c[0], L]); tri(a, c, d2, [a[0], 0], [c[0], L], [d2[0], L]); };
  q([-W, 0, D], [W, 0, D], [W, h, 0], [-W, h, 0]); q([W, 0, -D], [-W, 0, -D], [-W, h, 0], [W, h, 0]);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals(); return g;
}
/** Gable roof with rows of tiles/thatch on both slopes. */
function roof(b, w, h, d, col, x, y, z) {
  b.add(prism(w, h, d), col, x, y, z);
  if (M.photo) { box(b, mixHex(col, 0x000000, .3), x, y + h + .02, z, w + .1, .1, .14, Math.PI / 4); return; } // photo tiles already show rows; just a ridge cap
  const D = d / 2, L = Math.hypot(h, D), a = Math.atan2(h, D), rows = Math.max(4, Math.round(L / .28));
  for (const s of [1, -1]) for (let i = 0; i < rows; i++) {
    const t = (i + .5) / rows, shade = mixHex(col, i % 2 ? 0x000000 : 0xffffff, .08 + (i % 2) * .06);
    b.add(P.box, shade, x, y + h * t + D / L * .025, z + s * (D * (1 - t) + h / L * .025), s * a, 0, 0, w + .08, .035, L / rows * 1.15);
  }
}
const box = (b, col, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) => b.add(P.box, col, x, y, z, rx, ry, rz, sx, sy, sz);
const mbox = (b, col, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) => b.m(P.box, col, x, y, z, rx, ry, rz, sx, sy, sz);

// ---------------- heraldry, shields, weapons ----------------
/** Team emblem on a surface facing +z: blue = gold cross, red = white chevron. */
function emblem(b, team, x, y, z, s = 1, metal = false) {
  const add = metal ? mbox : box;
  if (team === 0) { add(b, C.gold, x, y, z, .035 * s, .2 * s, .012); add(b, C.gold, x, y + .03 * s, z, .14 * s, .035 * s, .012); }
  else { add(b, C.white, x - .045 * s, y, z, .035 * s, .15 * s, .012, 0, 0, -.8); add(b, C.white, x + .045 * s, y, z, .035 * s, .15 * s, .012, 0, 0, .8); }
}
function kiteShape(w, h) {
  const s = new THREE.Shape();
  s.moveTo(0, h * .42); s.quadraticCurveTo(w / 2, h * .44, w / 2, h * .12); s.quadraticCurveTo(w * .44, -h * .26, 0, -h * .58);
  s.quadraticCurveTo(-w * .44, -h * .26, -w / 2, h * .12); s.quadraticCurveTo(-w / 2, h * .44, 0, h * .42);
  return s;
}
const KITE = new THREE.ExtrudeGeometry(kiteShape(.42, .66), { depth: .025, bevelEnabled: false, curveSegments: 6 });
const KITE_RIM = new THREE.ExtrudeGeometry(kiteShape(.46, .71), { depth: .02, bevelEnabled: false, curveSegments: 6 });
function kiteShield(team) {
  const b = new Builder();
  b.m(KITE_RIM, C.dsteel, 0, 0, -.012); b.add(KITE, TEAM[team], 0, 0, 0);
  emblem(b, team, 0, .04, .03, 1.15); b.m(P.ball(.035, 8, 6), C.steel, 0, .06, .03, 0, 0, 0, 1, 1, .6);
  return b.split();
}
function roundShield(team) {
  const b = new Builder();
  b.add(P.cyl(.27, .27, .035, 18), C.wood, 0, 0, 0, Math.PI / 2, 0, 0);
  b.add(P.cyl(.2, .2, .038, 18), TEAM[team], 0, 0, .002, Math.PI / 2, 0, 0);
  b.m(new THREE.TorusGeometry(.27, .014, 4, 22), C.dsteel, 0, 0, 0);
  b.m(P.ball(.06, 10, 6), C.steel, 0, 0, .02, 0, 0, 0, 1, 1, .6);
  return b.split();
}
function sword() {
  const b = new Builder();
  b.add(P.cyl(.017, .017, .15, 6), C.dleather, 0, .02, 0); b.m(P.ball(.03, 8, 6), C.gold, 0, -.07, 0);
  mbox(b, C.gold, 0, .1, 0, .2, .028, .035);
  mbox(b, C.steel, 0, .5, 0, .048, .76, .012); mbox(b, C.dsteel, 0, .46, 0, .012, .6, .014);
  b.m(P.cone(.024, .09, 4), C.steel, 0, .92, 0, 0, Math.PI / 4, 0, 1, 1, .35);
  return b.split();
}
function spear(len = 2.5) {
  const b = new Builder();
  b.add(P.cyl(.019, .022, len, 6), C.wood, 0, len * .22, 0);
  b.m(P.cyl(.024, .02, .1, 6), C.dsteel, 0, len * .72 + .02, 0);
  b.m(P.ball(.045, 6, 8), C.steel, 0, len * .72 + .2, 0, 0, 0, 0, 1, 3.6, .3);
  return b.split();
}
function lance(team) {
  const b = new Builder();
  b.add(P.cyl(.02, .05, 3.2, 8), C.wood, 0, 1.0, 0); b.m(P.cone(.11, .22, 10), C.steel, 0, .12, 0, Math.PI, 0, 0);
  b.m(P.cone(.03, .18, 6), C.steel, 0, 2.68, 0); box(b, TEAM[team], 0, 2.35, .16, .01, .16, .3);
  return b.split();
}
function axe() {
  const b = new Builder();
  b.add(P.cyl(.018, .022, .7, 6), C.wood, 0, .2, 0); mbox(b, C.steel, 0, .5, .06, .02, .14, .13); mbox(b, C.dsteel, 0, .5, .005, .03, .06, .03);
  return b.split();
}
function bow() {
  const b = new Builder(), R = .9;
  b.add(new THREE.TorusGeometry(R, .017, 5, 16, 1.3), C.dwood, 0, 0, -R + .02, 0, -Math.PI / 2, -.65);
  box(b, C.linen, 0, 0, -R + .02 + R * Math.cos(.65), .005, 2 * R * Math.sin(.65), .005);
  box(b, C.leather, 0, 0, .01, .04, .1, .04);
  return b.split();
}

// ---------------- more weapons & shields ----------------
function gladius() { const b = new Builder(); b.add(P.cyl(.017, .017, .12, 6), C.wood, 0, .02, 0); b.m(P.ball(.032, 8, 6), C.brass, 0, -.06, 0); mbox(b, C.brass, 0, .09, 0, .1, .03, .04); mbox(b, C.steel, 0, .34, 0, .055, .48, .012); b.m(P.cone(.028, .08, 4), C.steel, 0, .62, 0, 0, Math.PI / 4, 0, 1, 1, .35); return b.split(); }
function saber() { const b = new Builder(); b.add(P.cyl(.017, .017, .14, 6), C.dleather, 0, .02, 0); mbox(b, C.gold, 0, .1, 0, .12, .025, .04); for (let i = 0; i < 4; i++) mbox(b, C.steel, 0, .25 + i * .17, -i * i * .012, .045, .18, .012, i * .09, 0, 0); return b.split(); }
function crossbowW(repeat) {
  const b = new Builder();
  b.add(P.box, C.wood, 0, 0, .18, 0, 0, 0, .05, .06, .62);
  b.add(new THREE.TorusGeometry(.32, .016, 4, 12, Math.PI * .8), C.dwood, 0, 0, .45, Math.PI / 2, 0, Math.PI * .1);
  box(b, C.linen, 0, .005, .36, .55, .006, .006);
  if (repeat) { b.add(P.box, C.wood, 0, .09, .3, 0, 0, 0, .06, .12, .32); mbox(b, C.brass, 0, .02, .05, .02, .14, .02, -.6); }
  return b.split();
}
const SCUTUM = new THREE.CylinderGeometry(.55, .55, .9, 12, 1, true, -.55, 1.1);
function scutum(team) {
  const b = new Builder();
  b.add(SCUTUM, TEAM[team], 0, 0, -.55);
  b.m(new THREE.CylinderGeometry(.552, .552, .03, 12, 1, true, -.55, 1.1), C.brass, 0, .45, -.55); b.m(new THREE.CylinderGeometry(.552, .552, .03, 12, 1, true, -.55, 1.1), C.brass, 0, -.45, -.55);
  b.m(P.ball(.07, 10, 6), C.brass, 0, 0, .01, 0, 0, 0, 1, 1, .6);
  for (const s of [-1, 1]) mbox(b, C.gold, s * .12, s * .2, -.005, .03, .25, .01, 0, 0, s * .7);
  return b.split();
}

// ---------------- humans ----------------
const KIND = {
  peasant:     { torso: 'linen', skirt: 'linen', legs: 'pants', helm: 'straw', beard: 1, R: 'axe' },
  sword:       { torso: 'mail', skirt: 'mail', legs: 'mail', helm: 'nasal', tabard: 1, pauld: 1, R: 'sword', L: 'kite', scab: 1 },
  spear:       { torso: 'gamb', skirt: 'gamb', legs: 'pants', helm: 'kettle', beard: 1, R: 'spear', L: 'round' },
  archer:      { torso: 'green', skirt: 'green', legs: 'hose', helm: 'hood', L: 'bow', quiver: 1 },
  crossbow:    { torso: 'gamb', skirt: 'gamb', legs: 'pants', helm: 'kettle', R: 'crossbow', quiver: 1 },
  knight:      { torso: 'mail', skirt: 'mail', legs: 'mail', helm: 'great', tabard: 1, pauld: 1, R: 'lance', L: 'kite' },
  lightcav:    { torso: 'gamb', skirt: 'gamb', legs: 'pants', helm: 'nasal', R: 'saber', L: 'round' },
  horsearcher: { torso: 'green', skirt: 'green', legs: 'hose', helm: 'hood', L: 'bow', quiver: 1 },
  legion:      { torso: 'segmentata', skirt: 'tunic', legs: 'skin', helm: 'galea', R: 'gladius', L: 'scutum', scab: 1 },
  repeater:    { torso: 'lamellar', skirt: 'lamellar', legs: 'pants', helm: 'chinese', R: 'repeater', quiver: 1 },
  berserker:   { torso: 'fur', skirt: 'pants', legs: 'pants', helm: 'bare', beard: 1, R: 'axe', L: 'axe', bare: 1 },
  khanguard:   { torso: 'lamellar', skirt: 'lamellar', legs: 'pants', helm: 'mongol', L: 'bow', quiver: 1, pauld: 1 },
  crusader:    { torso: 'mail', skirt: 'mail', legs: 'mail', helm: 'great', tabard: 1, pauld: 1, R: 'lance', L: 'kite', cape: 1, capeWhite: 1 },
  hero:        { torso: 'plate', skirt: 'mail', legs: 'mail', helm: 'crown', tabard: 1, pauld: 1, R: 'sword', L: 'kite', cape: 1, scab: 1, beard: 1 },
};
// How each civilization dresses its common soldiers (anything not listed uses KIND above).
const STYLE = {
  franks: {},
  romans: {
    sword: { helm: 'galea', torso: 'segmentata', skirt: 'tunic', legs: 'skin', L: 'scutum', R: 'gladius', tabard: 0, pauld: 0 },
    spear: { helm: 'galea', L: 'scutum', torso: 'mail', skirt: 'tunic' }, crossbow: { helm: 'galea' }, archer: { helm: 'galea', torso: 'tunic', skirt: 'tunic' },
    knight: { helm: 'galea', L: 'round', tabard: 0, skirt: 'tunic' }, lightcav: { helm: 'galea' },
    hero: { helm: 'galea', crestGold: 1, torso: 'segmentata', skirt: 'tunic', legs: 'skin', tabard: 0, L: 'scutum', R: 'gladius', capeRed: 1 },
  },
  chinese: {
    sword: { helm: 'chinese', torso: 'lamellar', skirt: 'lamellar', L: 'round', R: 'saber', tabard: 0, pauld: 0 }, spear: { helm: 'chinese', torso: 'lamellar', skirt: 'lamellar' },
    archer: { helm: 'conehat', torso: 'tunic', skirt: 'tunic' }, crossbow: { helm: 'conehat', torso: 'lamellar', skirt: 'lamellar' }, peasant: { helm: 'conehat' },
    knight: { helm: 'chinese', torso: 'lamellar', skirt: 'lamellar', tabard: 0 }, lightcav: { helm: 'chinese', torso: 'lamellar', skirt: 'lamellar' }, horsearcher: { helm: 'chinese' },
    hero: { helm: 'chinese', plume: 1, torso: 'lamellar', skirt: 'lamellar', tabard: 0, R: 'saber', L: 'round' },
  },
  norse: {
    sword: { helm: 'norse', L: 'round', R: 'axe', tabard: 0, beard: 1 }, spear: { helm: 'norse' }, archer: { helm: 'norse', torso: 'gamb', skirt: 'gamb' }, crossbow: { helm: 'norse' },
    knight: { helm: 'norse', L: 'round', tabard: 0 }, lightcav: { helm: 'norse' }, horsearcher: { helm: 'norse' },
    hero: { helm: 'norse', L: 'round', R: 'axe', torso: 'mail', tabard: 0, fur: 1 },
  },
  mongols: {
    sword: { helm: 'mongol', torso: 'deel', skirt: 'deel', L: 'round', R: 'saber', tabard: 0, pauld: 0 }, spear: { helm: 'mongol', torso: 'deel', skirt: 'deel' },
    archer: { helm: 'mongol', torso: 'deel', skirt: 'deel' }, crossbow: { helm: 'mongol', torso: 'deel', skirt: 'deel' }, peasant: { helm: 'fur' },
    knight: { helm: 'mongol', torso: 'lamellar', skirt: 'lamellar', tabard: 0, R: 'spear' }, lightcav: { helm: 'mongol', torso: 'deel', skirt: 'deel' }, horsearcher: { helm: 'mongol', torso: 'deel', skirt: 'deel' },
    hero: { helm: 'mongol', plume: 1, torso: 'lamellar', skirt: 'lamellar', tabard: 0, R: 'saber', L: 'round', fur: 1 },
  },
};
const TORSO = P.lathe([[.15, .86], [.175, .98], [.19, 1.12], [.215, 1.27], [.205, 1.37], [.15, 1.46], [.07, 1.5]], 16);
const SKIRT = P.lathe([[.19, .99], [.215, .86], [.25, .62]], 16);
// mail neck guard, open at the front so the face shows
const AVENTAIL = new THREE.CylinderGeometry(.14, .17, .15, 16, 1, true, 1.1, Math.PI * 2 - 2.2);
const DOME = P.lathe([[.128, 0], [.132, .05], [.12, .11], [.085, .17], [.03, .205], [0, .21]], 16);
const CONE_HELM = P.lathe([[.13, 0], [.13, .06], [.1, .14], [.04, .24], [.012, .32], [0, .33]], 16);

function humanParts(team, kind, mounted, style = 'franks') {
  const k = { ...KIND[kind], ...(STYLE[style]?.[kind] || {}) }, tc = TEAM[team], y0 = mounted ? .95 : 0;
  const MAT = {
    mail: [C.chain, 1], plate: [C.steel, 1], segmentata: [C.steel, 1], gamb: [C.gamb, 0], green: [C.green, 0], linen: [C.linen, 0], pants: [C.pants, 0], hose: [C.hose, 0],
    lamellar: [0x4a3a2c, 0], fur: [0x6b5236, 0], skin: [C.skin, 0], tunic: [mixHex(tc, 0x9a3a2a, .25), 0], deel: [mixHex(tc, 0x4a3420, .3), 0],
  };
  const put = (b, key, geo, ...t) => { const [col, metal] = MAT[key]; return metal ? b.m(geo, col, ...t) : b.add(geo, col, ...t); };
  const b = new Builder(), parts = [];
  // --- body ---
  put(b, k.torso, TORSO, 0, y0, 0, 0, 0, 0, 1, 1, .72);
  if (!mounted) put(b, k.skirt, SKIRT, 0, y0, 0, 0, 0, 0, 1, 1, .8);
  else put(b, k.skirt, SKIRT, 0, y0 + .12, 0, 0, 0, 0, 1.2, .5, 1.1);
  if (k.torso === 'gamb') for (let i = 0; i < 4; i++) b.add(P.cyl(.2 + i * .006, .2 + i * .006, .012, 16, true), mixHex(C.gamb, 0x000000, .3), 0, 1.02 + i * .1 + y0, 0, 0, 0, 0, 1, 1, .74);
  if (k.torso === 'segmentata') for (let i = 0; i < 5; i++) b.m(P.cyl(.2 + (i > 2 ? .012 : 0), .2, .012, 16, true), C.brass, 0, .98 + i * .085 + y0, 0, 0, 0, 0, 1.03, 1, .76);
  if (k.torso === 'lamellar') { for (let i = 0; i < 5; i++) b.add(P.cyl(.205, .205, .01, 16, true), C.gold, 0, .95 + i * .1 + y0, 0, 0, 0, 0, 1, 1, .75); box(b, tc, 0, 1.12 + y0, .16, .16, .2, .012); }
  if (k.torso === 'deel') { box(b, mixHex(tc, 0x000000, .4), .06, 1.1 + y0, .155, .03, .5, .012, 0, 0, -.25); b.add(P.cyl(.2, .2, .04, 16, true), 0x6b5236, 0, 1.44 + y0, 0, 0, 0, 0, 1, 1, .8); }
  if (k.torso === 'fur' || k.fur) b.add(P.cyl(.24, .26, .1, 14, true), 0x6b5236, 0, 1.42 + y0, 0, 0, 0, 0, 1.05, 1, .9);
  b.add(P.cyl(.198, .198, .05, 16, true), C.leather, 0, .97 + y0, 0, 0, 0, 0, 1, 1, .76); mbox(b, C.brass, 0, .97 + y0, .152, .05, .045, .015);
  if (k.tabard) {
    for (const s of [1, -1]) box(b, tc, 0, 1.0 + y0, .18 * s, .33, .72, .014, -.06 * s);
    box(b, C.gold, 0, .655 + y0, .201, .33, .025, .016, -.06); emblem(b, team, 0, 1.17 + y0, .19, 1.0);
  }
  if (k.pauld) for (const s of [-1, 1]) b.m(new THREE.SphereGeometry(.11, 14, 8, 0, Math.PI * 2, 0, Math.PI * .5), C.steel, s * .225, 1.39 + y0, 0, 0, 0, s * .35, 1, .6, 1);
  if (k.quiver) { b.add(P.cyl(.06, .05, .58, 8), C.leather, .1, 1.18 + y0, -.17, .2, 0, -.35); for (let i = 0; i < 5; i++) box(b, i % 2 ? C.white : 0x9a9a9a, .2 + (i - 2) * .02, 1.5 + y0, -.24 + (i % 2) * .03, .015, .1, .05, .2, 0, -.35); }
  if (k.scab && !mounted) { b.add(P.cyl(.026, .02, k.R === 'gladius' ? .5 : .72, 6), C.dleather, -.22, .7, -.06, -.45, 0, .12); mbox(b, C.gold, -.21, .98, .06, .03, .17, .03, -.45, 0, .12); b.m(P.ball(.028, 6, 5), C.gold, -.205, 1.06, .1); }
  if (k.cape) {
    const dark = k.capeWhite ? 0xe8e4da : k.capeRed ? 0x8a1a14 : mixHex(tc, 0x000000, .35), cp = new THREE.PlaneGeometry(.2, 1.0, 1, 4);
    for (const [x, ry, z] of [[-.17, .45, -.17], [0, 0, -.215], [.17, -.45, -.17]]) for (const flip of [0, Math.PI]) b.add(cp, dark, x, .95 + y0, z, .1, ry + flip, 0);
    box(b, C.gold, 0, .45 + y0, -.25, .5, .03, .02, .1);
  }
  // --- head ---
  const hy = 1.66 + y0;
  b.add(P.cyl(.055, .06, .12, 8), C.skin, 0, hy - .13, 0);
  b.add(P.ball(.115, 16, 12), C.skin, 0, hy, 0, 0, 0, 0, 1, 1.1, 1.05);
  box(b, C.skin, 0, hy - .01, .118, .03, .055, .04, -.2); // nose
  for (const s of [-1, 1]) { b.add(P.ball(.016, 6, 5), C.eye, s * .04, hy + .025, .1); box(b, C.hair, s * .043, hy + .055, .105, .045, .012, .012, 0, 0, s * .1); b.add(P.ball(.03, 6, 5), C.skin, s * .112, hy, 0, 0, 0, 0, .5, 1, .8); }
  box(b, C.lip, 0, hy - .055, .108, .04, .01, .01);
  if (k.beard) b.add(P.ball(.095, 10, 8), kind === 'hero' ? 0x6a4a2a : style === 'norse' ? 0x9a6a3a : C.beard, 0, hy - .06, .045, 0, 0, 0, 1, 1.05, .75);
  switch (k.helm) {
    case 'nasal':
      b.m(DOME, C.steel, 0, hy + .005, 0); b.m(P.cyl(.134, .134, .03, 16, true), C.dsteel, 0, hy + .02, 0);
      mbox(b, C.steel, 0, hy - .02, .132, .024, .11, .012); b.m(AVENTAIL, C.chain, 0, hy - .09, -.01, .08, 0, 0); break;
    case 'kettle':
      b.add(P.cyl(.122, .13, .1, 14, true), C.gamb, 0, hy - .02, 0); b.m(DOME, C.steel, 0, hy + .03, 0, 0, 0, 0, 1.05, .8, 1.05);
      b.m(P.cyl(.25, .25, .014, 20), C.dsteel, 0, hy + .045, 0, .05, 0, 0); break;
    case 'hood': {
      const gap = 1.9, hood = new THREE.SphereGeometry(.142, 14, 10, Math.PI / 2 + gap / 2, Math.PI * 2 - gap);
      b.add(hood, tc, 0, hy + .015, -.01, 0, 0, 0, 1, 1.08, 1.1); b.add(P.cyl(.13, .27, .16, 14, true), tc, 0, hy - .17, 0, 0, 0, 0, 1, 1, .85);
      b.add(P.cone(.05, .3, 6), tc, 0, hy - .05, -.18, -2.2, 0, 0); break;
    }
    case 'great':
      b.m(P.cyl(.136, .142, .27, 16), C.steel, 0, hy + .015, 0); b.m(P.cyl(.1, .136, .04, 16), C.steel, 0, hy + .17, 0);
      box(b, 0x0c0c0c, 0, hy + .045, .137, .2, .016, .01); for (let i = -2; i <= 2; i++) box(b, 0x0c0c0c, .03 * i, hy - .05, .139, .008, .02, .01);
      mbox(b, C.gold, 0, hy, .141, .025, .25, .008); mbox(b, C.gold, 0, hy + .085, .14, .2, .022, .008);
      b.add(P.ball(.07, 8, 6), tc, 0, hy + .24, -.02, 0, 0, 0, .6, 1.2, 1.6); break;
    case 'crown':
      b.m(DOME, C.steel, 0, hy + .005, 0); mbox(b, C.steel, 0, hy - .02, .132, .024, .11, .012);
      b.m(P.cyl(.14, .14, .045, 18, true), C.gold, 0, hy + .04, 0);
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; b.m(P.cone(.018, .06, 4), C.gold, Math.sin(a) * .14, hy + .09, Math.cos(a) * .14); }
      b.add(P.ball(.07, 8, 6), C.white, 0, hy + .2, -.1, -.5, 0, 0, .55, .8, 2.2);
      b.m(AVENTAIL, C.chain, 0, hy - .09, -.01, .08, 0, 0); break;
    case 'galea': // Roman helmet: dome, cheek guards, neck guard, horsehair crest
      b.m(DOME, k.crestGold ? C.gold : C.steel, 0, hy + .005, 0);
      for (const s of [-1, 1]) b.m(P.box, C.brass, s * .11, hy - .05, .04, 0, s * .25, 0, .02, .12, .09);
      b.m(new THREE.CylinderGeometry(.14, .17, .06, 14, 1, true, Math.PI * .6, Math.PI * .8), C.steel, 0, hy - .04, 0, .3, 0, 0);
      b.add(P.ball(.07, 10, 6), k.crestGold ? 0xd8c8a0 : 0xa8241c, 0, hy + .24, -.01, 0, 0, 0, .5, .9, 2.4); break;
    case 'chinese': // tall pointed helmet with a red tassel and neck flaps
      b.m(CONE_HELM, C.steel, 0, hy - .01, 0); b.add(P.cone(.04, .1, 8), k.plume ? C.gold : 0xb01c1c, 0, hy + .36, 0, Math.PI, 0, 0);
      b.add(new THREE.CylinderGeometry(.14, .19, .16, 14, 1, true, Math.PI * .55, Math.PI * .9), 0x3a2e24, 0, hy - .08, 0); break;
    case 'conehat':
      b.add(P.ball(.12, 10, 8), C.hair, 0, hy + .03, -.02); b.add(P.cone(.33, .17, 18), C.straw, 0, hy + .13, 0); break;
    case 'norse': // round helmet with spectacle guard
      b.m(DOME, C.dsteel, 0, hy + .005, 0); b.m(P.cyl(.134, .134, .03, 16, true), C.steel, 0, hy + .02, 0);
      for (const s of [-1, 1]) b.m(new THREE.TorusGeometry(.035, .01, 5, 12), C.steel, s * .042, hy + .03, .118);
      mbox(b, C.steel, 0, hy - .01, .128, .02, .08, .01); b.m(AVENTAIL, C.chain, 0, hy - .09, -.01, .08, 0, 0); break;
    case 'mongol': // domed helmet with fur brim and spike
      b.m(DOME, C.steel, 0, hy + .02, 0, 0, 0, 0, 1, .9, 1); b.add(new THREE.TorusGeometry(.135, .035, 6, 16), 0x5a4228, 0, hy + .03, 0, Math.PI / 2, 0, 0);
      b.m(P.cone(.015, .12, 6), C.gold, 0, hy + .26, 0); if (k.plume) b.add(P.ball(.05, 8, 6), 0xb01c1c, 0, hy + .3, -.04, 0, 0, 0, .5, 1, 1.6);
      b.add(new THREE.CylinderGeometry(.14, .18, .14, 14, 1, true, Math.PI * .6, Math.PI * .8), 0x3a2e24, 0, hy - .08, 0); break;
    case 'fur':
      b.add(P.cyl(.13, .14, .12, 14), 0x5a4228, 0, hy + .08, 0); b.add(P.ball(.1, 10, 6), tc, 0, hy + .15, 0, 0, 0, 0, 1, .5, 1); break;
    case 'bare':
      b.add(P.ball(.12, 10, 8), 0x9a6a3a, 0, hy + .04, -.03); for (const s of [-1, 1]) b.add(P.cyl(.02, .015, .25, 5), 0x9a6a3a, s * .1, hy - .12, -.06); break;
    case 'straw':
      b.add(P.ball(.12, 10, 8), C.hair, 0, hy + .03, -.02); b.add(P.cyl(.28, .28, .018, 18), C.straw, 0, hy + .07, 0);
      b.add(P.cone(.14, .15, 14), C.straw, 0, hy + .15, 0); b.add(P.cyl(.142, .142, .03, 14, true), tc, 0, hy + .095, 0); break;
  }
  // --- legs ---
  const legMetal = k.legs === 'mail';
  if (!mounted) for (const s of [-1, 1]) {
    const g = new Builder();
    put(g, k.legs, P.cyl(.088, .07, .44, 10), 0, -.21, 0);
    if (legMetal) g.m(P.ball(.075, 10, 8), C.dsteel, 0, -.44, .02); else g.add(P.ball(.066, 8, 6), MAT[k.legs][0], 0, -.44, 0);
    put(g, k.legs, P.cyl(.066, .055, .3, 10), 0, -.6, 0);
    if (k.legs === 'skin') { for (let i = 0; i < 3; i++) g.add(P.cyl(.07, .07, .02, 8, true), C.leather, 0, -.68 - i * .07, 0); g.add(P.box, C.leather, 0, -.875, .045, 0, 0, 0, .1, .05, .22); }
    else { g.add(P.cyl(.068, .072, .2, 10), C.boot, 0, -.79, 0); g.add(P.box, C.boot, 0, -.875, .045, 0, 0, 0, .1, .07, .22); g.add(P.ball(.05, 8, 6), C.boot, 0, -.87, .15, 0, 0, 0, 1, .7, 1); }
    parts.push({ ...g.split(), pivot: [s * .1, .92, 0], anim: s < 0 ? 'legL' : 'legR' });
  } else for (const s of [-1, 1]) { // straddling the saddle
    put(b, k.legs, P.cyl(.088, .072, .46, 10), s * .25, .82 + y0 - .04, .12, 1.15, 0, s * .28);
    put(b, k.legs, P.cyl(.068, .056, .42, 10), s * .34, .5 + y0 - .06, .26, -.15, 0, 0);
    b.add(P.box, C.boot, s * .34, .27 + y0 - .06, .3, 0, 0, 0, .1, .08, .22); b.m(P.cyl(.04, .04, .02, 8), C.dsteel, s * .34, .22 + y0 - .06, .3);
  }
  // --- arms ---
  const metalArms = k.torso === 'mail' || k.torso === 'plate' || k.torso === 'segmentata';
  const arm = item => {
    const g = new Builder(), sleeve = k.bare ? 'skin' : k.torso === 'segmentata' ? 'tunic' : k.torso;
    if (metalArms && k.torso !== 'segmentata') g.m(P.cyl(.064, .056, .32, 10), C.chain, 0, -.16, 0); else put(g, sleeve, P.cyl(.064, .056, .32, 10), 0, -.16, 0);
    g.add(P.ball(.055, 8, 6), MAT[sleeve][0], 0, -.33, 0);
    const fa = -.3, fx = Math.sin(-fa), fsl = k.torso === 'segmentata' ? 'skin' : sleeve;
    if (metalArms && k.torso !== 'segmentata') g.m(P.cyl(.054, .046, .28, 10), C.chain, 0, -.33 - .14 * Math.cos(fa), .14 * fx, fa); else put(g, fsl, P.cyl(.054, .046, .28, 10), 0, -.33 - .14 * Math.cos(fa), .14 * fx, fa);
    if (kind === 'hero' || kind === 'knight' || kind === 'crusader' || k.torso === 'lamellar') g.m(P.cyl(.06, .052, .14, 10), k.torso === 'lamellar' ? C.brass : C.steel, 0, -.33 - .22 * Math.cos(fa), .22 * fx, fa);
    const H = [0, -.33 - .3 * Math.cos(fa), .3 * fx];
    g.add(P.box, kind === 'peasant' || k.bare ? C.skin : C.leather, H[0], H[1], H[2], fa, 0, 0, .07, .09, .075);
    item && item(g, H);
    return g.split();
  };
  const R = {
    sword: (g, H) => g.put(sword(), H[0], H[1], H[2] + .02, .9), gladius: (g, H) => g.put(gladius(), H[0], H[1], H[2] + .02, 1.2), saber: (g, H) => g.put(saber(), H[0], H[1], H[2] + .02, .9),
    spear: (g, H) => g.put(spear(), H[0], H[1], H[2], 1.25), lance: (g, H) => g.put(lance(team), H[0], H[1], H[2], 1.5), axe: (g, H) => g.put(axe(), H[0], H[1], H[2], .5),
    crossbow: (g, H) => g.put(crossbowW(false), H[0] - .1, H[1] + .15, H[2], -.3, .3, 0), repeater: (g, H) => g.put(crossbowW(true), H[0] - .1, H[1] + .15, H[2], -.3, .3, 0),
  }[k.R];
  const L = {
    kite: (g) => g.put(kiteShield(team), -.07, -.4, .16, 0, -.25, 0), round: (g) => g.put(roundShield(team), -.07, -.42, .14, 0, -.2, 0), scutum: (g) => g.put(scutum(team), -.04, -.36, .2, 0, -.15, 0),
    bow: (g, H) => g.put(bow(), H[0], H[1], H[2]), axe: (g, H) => g.put(axe(), H[0], H[1], H[2], .5),
  }[k.L];
  parts.push({ ...arm(R), pivot: [.235, 1.42 + y0, 0], anim: 'armR' });
  parts.push({ ...arm(L), pivot: [-.235, 1.42 + y0, 0], anim: 'armL' });
  parts.unshift({ ...b.split(), pivot: [0, 0, 0], anim: null });
  return parts;
}

// ---------------- horse ----------------
function horseParts(team, heavy, coat = C.horse) {
  const tc = TEAM[team], b = new Builder(), parts = [];
  b.add(P.ball(.5, 20, 14), coat, 0, 1.25, 0, 0, 0, 0, .76, .84, 1.7);           // barrel
  b.add(P.ball(.4, 16, 12), coat, 0, 1.3, .62, 0, 0, 0, .9, 1, .9);              // chest
  b.add(P.ball(.42, 16, 12), coat, 0, 1.33, -.62, 0, 0, 0, .95, 1, .95);         // rump
  b.add(P.cyl(.15, .25, .78, 14), coat, 0, 1.875, .83, .69, 0, 0);               // neck (leans forward)
  b.add(P.cyl(.075, .125, .52, 12), coat, 0, 2.0, 1.25, 2.21, 0, 0);             // head (angled down)
  b.add(P.ball(.085, 10, 8), coat, 0, 1.84, 1.46, 0, 0, 0, .95, .85, 1.1);         // muzzle
  b.add(P.ball(.02, 6, 4), C.eye, -.035, 1.82, 1.53); b.add(P.ball(.02, 6, 4), C.eye, .035, 1.82, 1.53);
  for (const s of [-1, 1]) { b.add(P.cone(.035, .13, 6), coat, s * .06, 2.27, 1.0, -.15, 0, s * .2); b.add(P.ball(.022, 6, 5), C.eye, s * .1, 2.08, 1.16); }
  box(b, C.dhorse, 0, 1.93, .74, .05, .78, .1, .69);                                   // mane
  b.add(P.cyl(.1, .045, .85, 8), C.dhorse, 0, 1.1, -1.2, -2.68, 0, 0);               // tail
  if (heavy) { // caparison + armour
    b.add(P.cyl(.46, .53, .58, 24, true), tc, 0, 1.08, -.02, 0, 0, 0, 1, 1, 1.9);
    b.add(P.cyl(.532, .532, .035, 24, true), C.gold, 0, .8, -.02, 0, 0, 0, 1, 1, 1.9);
    for (const s of [-1, 1]) { box(b, C.gold, s * .535, 1.12, 0, .012, .26, .055); box(b, C.gold, s * .535, 1.17, 0, .012, .055, .22); }
    b.m(P.box, C.steel, 0, 2.07, 1.3, 2.21, 0, 0, .17, .44, .03);                      // chanfron
  } else { box(b, tc, 0, 1.62, -.05, .82, .35, .7); box(b, C.gold, 0, 1.45, -.05, .84, .03, .72); } // saddle blanket
  b.add(P.box, C.leather, 0, 1.72, -.05, 0, 0, 0, .44, .1, .6); box(b, C.dleather, 0, 1.8, -.32, .38, .12, .08); box(b, C.dleather, 0, 1.78, .22, .3, .1, .06);
  for (const s of [-1, 1]) box(b, C.dleather, s * .1, 1.8, .9, .015, .02, .75, -.15);
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const g = new Builder();
    g.add(P.cyl(.1, .07, .5, 10), coat, 0, -.22, sz < 0 ? -.03 : 0); g.add(P.ball(.06, 8, 6), coat, 0, -.48, 0);
    g.add(P.cyl(.048, .044, .44, 8), coat, 0, -.7, 0); g.add(P.cyl(.058, .066, .09, 10), C.hoof, 0, -.96, .01);
    parts.push({ ...g.split(), pivot: [sx * .21, 1.0, sz * .6], anim: (sx < 0) === (sz > 0) ? 'hA' : 'hB' });
  }
  parts.unshift({ ...b.split(), pivot: [0, 0, 0], anim: null });
  return parts;
}

// ---------------- siege & ships ----------------
function catapultParts(team) {
  const b = new Builder(), tc = TEAM[team], arm = new Builder();
  for (const s of [-1, 1]) { box(b, C.wood, s * .45, .4, 0, .14, .14, 2.0); box(b, C.wood, s * .45, .95, -.15, .12, 1.1, .12, -.35); box(b, C.wood, s * .45, .95, .35, .12, 1.0, .12, .3); }
  for (const z of [-.8, .2, .85]) box(b, C.wood, 0, .42, z, 1.0, .12, .12);
  box(b, C.wood, 0, 1.42, .1, 1.05, .14, .14);
  for (const [x, z] of [[-.58, -.65], [.58, -.65], [-.58, .65], [.58, .65]]) { b.add(P.cyl(.3, .3, .08, 14), C.dwood, x, .3, z, 0, 0, Math.PI / 2); b.m(P.cyl(.07, .07, .1, 8), C.dsteel, x, .3, z, 0, 0, Math.PI / 2); }
  b.add(P.cyl(.025, .025, 1.6, 5), C.wood, .55, 1.6, -.7); box(b, tc, .78, 2.15, -.7, .45, .3, .02);
  b.add(P.ball(.25, 10, 8), C.linen, 0, .6, -.2, 0, 0, 0, 1.6, .6, 1); // rope bundle / counter
  box(arm, C.wood, 0, 0, -.8, .12, .12, 1.7); arm.add(P.cyl(.2, .15, .14, 10), C.dwood, 0, .05, -1.6); arm.add(P.ball(.15, 8, 6), 0x7a766e, 0, .15, -1.6);
  return [{ ...b.split(), pivot: [0, 0, 0], anim: null }, { ...arm.split(), pivot: [0, .9, .2], anim: 'cat' }];
}
// ---------------- ships ----------------
/** A real boat hull: pointed bow and stern, rounded bilge, sheer line rising at both ends. UVs follow the planks. */
function hullGeo(L, W, D, sheer, yOff) {
  const NS = 24, NP = 12, pos = [], uv = [], idx = [];
  for (let i = 0; i <= NS; i++) {
    const t = i / NS * 2 - 1, at = Math.abs(t), z = t * L / 2;
    const w = W / 2 * Math.pow(Math.max(0, 1 - Math.pow(at, 2.4)), .5) + .015, top = yOff + sheer * at * at, d = D * (1 - .4 * at * at * at);
    let arc = 0, px = null, py = null;
    for (let j = 0; j <= NP; j++) {
      const a = -Math.PI / 2 + Math.PI * j / NP, x = w * Math.sin(a) * (1 + .1 * Math.cos(a)), y = top - d * Math.pow(Math.cos(a), 1.25);
      if (px !== null) arc += Math.hypot(x - px, y - py); px = x; py = y;
      pos.push(x, y, z); uv.push(z / 1.7, arc / .8);
    }
  }
  for (let i = 0; i < NS; i++) for (let j = 0; j < NP; j++) { const a = i * (NP + 1) + j, b = a + 1, c = a + NP + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
const hullWidth = (L, W, z) => W / 2 * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(z / (L / 2)), 2.4)), .5);
function deckGeo(L, W, y) {
  const pts = []; for (let i = 0; i <= 20; i++) { const z = -L / 2 + L * i / 20; pts.push(new THREE.Vector2(hullWidth(L, W, z) * .97, -z)); }
  for (let i = 20; i >= 0; i--) { const z = -L / 2 + L * i / 20; pts.push(new THREE.Vector2(-hullWidth(L, W, z) * .97, -z)); }
  const g = new THREE.ShapeGeometry(new THREE.Shape(pts)); g.rotateX(-Math.PI / 2); g.translate(0, y, 0);
  const p = g.attributes.position, uv = g.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getZ(i) / 1.7, p.getX(i) / 1.7);
  return g;
}
/** Rope between two points (thin cylinder). */
function rope(b, a, c, r = .012) {
  const v = new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]), len = v.length(), q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.normalize()), e = new THREE.Euler().setFromQuaternion(q);
  b.add(P.cyl(r, r, len, 4), 0x2a2016, (a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2, e.x, e.y, e.z);
}
/** A small sailor / marine figure for decks. */
function crew(b, tc, x, y, z, kind = 'sailor', ry = 0) {
  const top = kind === 'archer' ? tc : 0xcfc2a2;
  b.add(P.cyl(.07, .06, .5, 7), C.pants, x, y + .25, z); b.add(P.cyl(.14, .12, .45, 9), top, x, y + .72, z, 0, 0, 0, 1, 1, .75);
  b.add(P.ball(.1, 10, 8), C.skin, x, y + 1.06, z);
  if (kind === 'archer') { b.m(DOME, C.steel, x, y + 1.06, z, 0, 0, 0, .85, .85, .85); b.add(new THREE.TorusGeometry(.4, .015, 4, 10, Math.PI), C.dwood, x + .18, y + .8, z + .1, 0, ry - Math.PI / 2, -Math.PI / 2); }
  else b.add(P.cyl(.13, .12, .06, 9), 0x8a2a1a, x, y + 1.14, z);
  for (const s of [-1, 1]) b.add(P.cyl(.045, .04, .42, 6), top, x + s * .17, y + .72, z + .05, .3, 0, s * .2);
}
const sailMats = new Map();
function sailMat(team, style) {
  const k = team + style; let m = sailMats.get(k);
  if (!m) {
    m = M.pbr ? new THREE.MeshStandardMaterial({ map: sailTexture(TEAM[team], team, style), side: THREE.DoubleSide, roughness: .85, vertexColors: true }) : new THREE.MeshLambertMaterial({ map: sailTexture(TEAM[team], team, style), side: THREE.DoubleSide, vertexColors: true });
    m.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace(/\*= faceDirection;/g, '*= 1.0;')); };
    m.customProgramCacheKey = () => 'sail'; sailMats.set(k, m);
  }
  return m;
}
let planksMat = null;
function hullMat() { if (!planksMat) { const t = planksTexture(256); planksMat = M.pbr ? new THREE.MeshStandardMaterial({ map: t, vertexColors: true, roughness: .8, side: THREE.DoubleSide }) : new THREE.MeshLambertMaterial({ map: t, vertexColors: true, side: THREE.DoubleSide }); } return planksMat; }
/** Square sail with UVs, bellied by the wind. */
function squareSail(w, h, billow) {
  const g = new THREE.PlaneGeometry(w, h, 8, 6), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i) / (w / 2), y = p.getY(i) / (h / 2); p.setZ(i, billow * (1 - x * x * .85) * (1 - .3 * y * y)); }
  g.computeVertexNormals(); return g;
}
function lateenSail() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -1.2, 0, 2.3, .35, 0, .15, 1.05], 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, .5, 1, 1, 0], 2));
  g.computeVertexNormals(); return g;
}
function shipParts(team, kind) {
  if (GM[kind]) { // custom ship model: sink it to a waterline about a third of its height, add a team pennant
    const m = GM[kind], h = m.box.max.y - m.box.min.y, drop = -(h * .3) + (kind === 'fishboat' ? .12 : .28);
    const fb = new Builder(); box(fb, TEAM[team], .3, h * .95 + drop, 0, .6, .3, .02); fb.add(P.cyl(.015, .015, .8, 4), C.wood, 0, h * .85 + drop, 0);
    return [{ ...fb.split(), extra: m.parts.map(p => ({ geo: p.geo.clone().translate(0, drop, 0), mat: p.mat })), pivot: [0, 0, 0], anim: null }];
  }
  const b = new Builder(), hull = new Builder(), sails = new Builder(), tc = TEAM[team];
  const addHull = (L, W, D, sheer, yOff, deckY) => { hull.add(hullGeo(L, W, D, sheer, yOff), 0xd8c8b0); hull.add(deckGeo(L, W, deckY), 0xc0a888);
    for (let i = 0; i < 24; i++) for (const s of [-1, 1]) { // gunwale rail
      const z0 = -L / 2 + L * i / 24, z1 = z0 + L / 24, y0 = yOff + sheer * (2 * z0 / L) ** 2, y1 = yOff + sheer * (2 * z1 / L) ** 2;
      const x0 = s * hullWidth(L, W, z0) * 1.02, x1 = s * hullWidth(L, W, z1) * 1.02, len = Math.hypot(z1 - z0, x1 - x0, y1 - y0);
      b.add(P.box, C.dwood, (x0 + x1) / 2, (y0 + y1) / 2 + .03, (z0 + z1) / 2, Math.atan2(y0 - y1, z1 - z0), Math.atan2(x1 - x0, z1 - z0), 0, .07, .07, len * 1.05);
    } };
  if (kind === 'fishboat') {
    addHull(3.2, 1.25, .55, .28, .3, .12);
    b.add(P.cyl(.035, .045, 2.3, 7), C.wood, 0, 1.25, .45); b.add(P.cyl(.025, .025, 2.9, 6), C.wood, 0, 1.4, .3, .95, 0, 0); // mast + lateen yard
    sails.add(lateenSail(), 0xffffff, .02, .25, .4); sails.add(lateenSail().scale(-1, 1, 1), 0xffffff, -.02, .25, .4);
    rope(b, [0, 2.4, .45], [0, .35, 1.5]); rope(b, [0, 2.4, .45], [0, .35, -1.4]);
    crew(b, tc, .2, .12, -.7); b.add(P.ball(.28, 10, 6), 0x55553a, -.2, .2, -.95, 0, 0, 0, 1.2, .5, 1); b.add(P.cyl(.18, .14, .25, 10), C.straw, .3, .25, .9);
    for (const s of [-1, 1]) b.add(P.cyl(.02, .02, 1.8, 5), C.wood, s * .45, .4, -.1, Math.PI / 2 - .05, 0, s * .12);
  } else if (kind === 'transport') {
    const L = 5.4, W = 2.3; addHull(L, W, 1.15, .55, .6, .42);
    for (const [z, len, h] of [[-2.0, 1.3, .8], [2.05, 1.0, .65]]) { // fore and aft castles
      b.add(P.box, C.wood, 0, .42 + h / 2, z, 0, 0, 0, hullWidth(L, W, z) * 1.8, h, len);
      for (let i = -2; i <= 2; i++) box(b, tc, i * .35, .45 + h + .1, z + len / 2 - .03, .2, .2, .06); b.add(P.box, C.dwood, 0, .45 + h, z, 0, 0, 0, hullWidth(L, W, z) * 1.85, .06, len + .05);
    }
    b.add(P.cyl(.06, .09, 4.8, 9), C.wood, 0, 2.8, .1); b.add(P.cyl(.035, .035, 2.8, 6), C.wood, 0, 4.3, .2, 0, 0, Math.PI / 2); b.add(P.cyl(.1, .1, .25, 8), C.dwood, 0, 4.8, .1);
    sails.add(squareSail(2.6, 2.4, .45), 0xffffff, 0, 3.0, .25);
    for (const s of [-1, 1]) { rope(b, [0, 4.9, .1], [s * 1.05, .7, -.6]); rope(b, [0, 4.9, .1], [s * 1.05, .7, .8]); rope(b, [s * 1.35, 4.3, .2], [s * .9, .7, 1.6]); }
    rope(b, [0, 4.9, .1], [0, 1.2, 2.6]); rope(b, [0, 4.9, .1], [0, 1.4, -2.6]);
    b.add(P.box, C.dwood, 0, .1, -2.75, 0, 0, 0, .06, .9, .5); // rudder
    for (const [x, z] of [[-.5, .9], [.4, -.6], [.5, .6]]) b.add(P.cyl(.2, .22, .45, 10), C.wood, x, .65, z);
    crew(b, tc, -.5, .42, -.3); crew(b, tc, .3, .45 + .8, -2.0); b.add(P.cyl(.012, .012, .9, 4), C.wood, 0, 5.3, .1); box(b, tc, .3, 5.6, .1, .55, .25, .015);
  } else { // warship (galley)
    const L = 7.2, W = 1.75; addHull(L, W, .85, .65, .45, .3);
    b.add(P.cyl(.06, .03, 1.3, 8), C.dwood, 0, .85, 3.65, -.5, 0, 0); b.add(P.ball(.14, 10, 8), tc, 0, 1.45, 3.9, 0, 0, 0, .8, 1, 1.4); // curved prow + figurehead
    b.m(P.cone(.13, .75, 10), C.brass, 0, -.15, 3.75, Math.PI / 2, 0, 0); // bronze ram
    b.add(P.cyl(.05, .03, 1.1, 8), C.dwood, 0, .9, -3.6, .6, 0, 0);
    for (const s of [-1, 1]) for (let i = 0; i < 9; i++) { const z = -2.6 + i * .62; b.add(P.cyl(.022, .018, 2.4, 5), C.wood, s * (hullWidth(L, W, z) + .75), .05, z, 0, 0, s * (Math.PI / 2 + .55)); b.add(P.box, C.wood, s * (hullWidth(L, W, z) + 1.65), -.42, z, 0, 0, s * .55, .05, .28, .14);
      b.add(P.cyl(.17, .17, .035, 14), i % 2 ? tc : C.gold, s * (hullWidth(L, W, z) + .02), .62, z, 0, 0, Math.PI / 2); b.m(P.ball(.04, 6, 4), C.dsteel, s * (hullWidth(L, W, z) + .05), .62, z); }
    box(b, C.dwood, 0, .7, -2.5, 1.2, .55, 1.0); b.add(P.box, tc, 0, 1.0, -2.5, 0, 0, 0, 1.25, .06, 1.05);
    b.add(P.cyl(.05, .07, 4.0, 9), C.wood, 0, 2.3, .5); b.add(P.cyl(.03, .03, 2.4, 6), C.wood, 0, 3.75, .55, 0, 0, Math.PI / 2);
    sails.add(squareSail(2.2, 2.0, .35), 0xffffff, 0, 2.7, .6);
    for (const s of [-1, 1]) { rope(b, [0, 4.25, .5], [s * .8, .55, -.4]); rope(b, [0, 4.25, .5], [s * .8, .55, 1.4]); }
    rope(b, [0, 4.25, .5], [0, 1.2, 3.7]); rope(b, [0, 4.25, .5], [0, 1.3, -3.4]);
    for (const z of [-1.2, -.3, 1.3, 2.2]) crew(b, tc, (z * 7 % 2 > 1 ? .3 : -.3), .3, z, 'archer');
    b.add(P.cyl(.012, .012, 1.0, 4), C.wood, 0, 4.7, .5); box(b, tc, .32, 5.0, .5, .6, .3, .015);
  }
  const s = b.split(), style = kind === 'warship' ? 'stripes' : kind === 'transport' ? 'emblem' : 'plain';
  return [{ c: s.c, m: s.m, extra: [{ geo: hull.build(), mat: hullMat() }, { geo: sails.build(), mat: sailMat(team, style) }], pivot: [0, 0, 0], anim: null }];
}
let wakeMatCache = null;
export function wakeMaterial() { if (!wakeMatCache) wakeMatCache = new THREE.MeshBasicMaterial({ map: foamTexture(), transparent: true, depthWrite: false, opacity: .8, color: 0xe8f0f0 }); return wakeMatCache; }
/** Wooden scaffolding poles and planks around a building under construction. */
const scaffoldCache = new Map();
export function scaffoldGeo(size, h) {
  const k = size + ':' + h; let g = scaffoldCache.get(k); if (g) return g;
  const b = new Builder(), r = size / 2 + .25;
  for (let i = 0; i <= 2; i++) for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) if (i === 0) b.add(P.cyl(.04, .05, h, 5), 0x8a6a42, sx * r, h / 2, sz * r);
  for (let lv = 1; lv <= 3; lv++) { const y = h * lv / 3.2; for (const s of [-1, 1]) { b.add(P.box, 0x9a7a4a, 0, y, s * r, 0, 0, 0, size + .6, .05, .22); b.add(P.box, 0x9a7a4a, s * r, y, 0, 0, 0, 0, .22, .05, size + .6); } }
  for (const s of [-1, 1]) { b.add(P.box, 0x7a5a32, 0, h / 2, s * r, 0, 0, Math.atan2(h, size) * s, Math.hypot(h, size) * .95, .04, .04); }
  g = b.build(); scaffoldCache.set(k, g); return g;
}
export const SHIP_LEN = { fishboat: 3.2, transport: 5.4, warship: 7.2 };

function figureParts(team, kind, style) {
  const d = UD[kind];
  if (d.ship) return shipParts(team, kind);
  if (kind === 'catapult') return catapultParts(team);
  if (d.horse) {
    const heavy = kind === 'knight' || kind === 'crusader' || kind === 'khanguard';
    const coat = kind === 'crusader' ? 0xd8d0c0 : kind === 'lightcav' || kind === 'horsearcher' ? 0x7a5634 : C.horse;
    return [...horseParts(team, heavy, coat), ...humanParts(team, kind, true, style)];
  }
  return humanParts(team, kind, false, style);
}

const _root = new THREE.Matrix4(), _pm = new THREE.Matrix4(), _rx = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler(), ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/** One batch of instanced meshes per (team, kind). */
class FigureBatch {
  constructor(scene, team, kind, cap, shadows, style) {
    this.mounted = !!UD[kind].horse;
    this.meshes = [];
    this.parts = figureParts(team, kind, style).map(p => {
      const ms = [];
      for (const [geo, mat] of [[p.c, M.cloth], [p.m, M.metal], ...(p.extra || []).map(e => [e.geo, e.mat])]) {
        if (!geo) continue;
        const m = new THREE.InstancedMesh(geo, mat, cap); m.count = 0; m.frustumCulled = false; m.castShadow = shadows;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); ms.push(m); this.meshes.push(m);
      }
      return { ...p, ms };
    });
    this.cap = cap; this.used = 0; this.free = [];
  }
  alloc() { const i = this.free.length ? this.free.pop() : this.used++; if (i >= this.cap) throw new Error('too many units'); for (const m of this.meshes) m.count = Math.max(m.count, i + 1); return i; }
  release(i) { for (const m of this.meshes) { m.setMatrixAt(i, ZERO); m.instanceMatrix.needsUpdate = true; } this.free.push(i); }
  /** pose: {x,y,z,yaw,scale,hidden,tilt, s (walk swing -0.7..0.7), swing (attack 0..1)} */
  set(i, o) {
    if (o.hidden) { for (const m of this.meshes) m.setMatrixAt(i, ZERO); return; }
    const s = o.s, sw = o.swing, bob = Math.abs(s) * (this.mounted ? .09 : .05);
    _q.setFromEuler(_e.set(o.tilt || 0, o.yaw, 0, 'YXZ'));
    _root.compose(_v.set(o.x, o.y + bob, o.z), _q, _s.setScalar(o.scale));
    const strike = Math.sin(sw * Math.PI);
    for (const p of this.parts) {
      let a = 0;
      switch (p.anim) {
        case 'legL': a = s; break; case 'legR': a = -s; break;
        case 'armL': a = -s * .5 - strike * .45; break;
        case 'armR': a = -.3 + s * .35 - strike * 1.7 + (sw > .5 ? .3 * strike : 0); break;
        case 'hA': a = s * 1.2; break; case 'hB': a = -s * 1.2; break;
        case 'cat': a = .25 + strike * 1.65; break;
      }
      let mtx = _root;
      if (p.anim) { _pm.makeTranslation(p.pivot[0], p.pivot[1], p.pivot[2]).multiply(_rx.makeRotationX(a)); _pm.premultiply(_root); mtx = _pm; }
      for (const m of p.ms) m.setMatrixAt(i, mtx);
    }
  }
  flush() { for (const m of this.meshes) m.instanceMatrix.needsUpdate = true; }
}
export class Figures {
  constructor(scene, shadows) { this.scene = scene; this.shadows = shadows; this.batches = new Map(); this.styles = ['franks', 'franks']; }
  get(team, kind) {
    const k = team + kind; let b = this.batches.get(k);
    if (!b) { b = new FigureBatch(this.scene, team, kind, kind === 'hero' ? 4 : UD[kind].ship || kind === 'catapult' ? 40 : 200, this.shadows, this.styles[team]); this.batches.set(k, b); }
    return b;
  }
  flush() { for (const b of this.batches.values()) b.flush(); }
}

// ---------------- buildings ----------------
function windowsAndDoor(b, w, d, y, doorZ) {
  box(b, C.dwood, 0, y + .45, doorZ, .5, .9, .06);
  box(b, 0x2a2018, -w * .3, y + 1.0, doorZ, .3, .3, .05); box(b, 0x2a2018, w * .3, y + 1.0, doorZ, .3, .3, .05);
}
function timberWalls(b, w, h, d, y) {
  box(b, C.plaster, 0, y + h / 2, 0, w, h, d);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(b, C.timber, sx * (w / 2 - .02), y + h / 2, sz * (d / 2 - .02), .12, h, .12);
  for (const sz of [-1, 1]) { box(b, C.timber, 0, y + h - .05, sz * d / 2, w, .1, .06); box(b, C.timber, 0, y + .05, sz * d / 2, w, .1, .06); box(b, C.timber, -w / 4, y + h / 2, sz * d / 2, .08, h, .05, 0, 0, .6); box(b, C.timber, w / 4, y + h / 2, sz * d / 2, .08, h, .05, 0, 0, -.6); }
}
function flag(b, tc, x, y, z, h = 2) {
  b.add(P.cyl(.04, .05, h, 5), C.wood, x, y + h / 2, z); b.add(P.ball(.07, 6, 4), C.gold, x, y + h + .03, z);
  box(b, tc, x + .4, y + h - .3, z, .75, .5, .02);
}
/** Crenellations (castle teeth) along a square wall top. */
function crenel(b, cx, y, cz, w, d, col = C.stone) {
  const n = Math.max(2, Math.round(w / .5)), m = Math.max(2, Math.round(d / .5));
  for (let i = 0; i < n; i++) for (const s of [-1, 1]) box(b, col, cx - w / 2 + (i + .5) * w / n, y, cz + s * d / 2, w / n * .55, .32, .22);
  for (let i = 0; i < m; i++) for (const s of [-1, 1]) box(b, col, cx + s * w / 2, y, cz - d / 2 + (i + .5) * d / m, .22, .32, d / m * .55);
}
/**
 * Building models. look = { age: 0|1|2, fort, guard }: buildings grow from timber-and-thatch (Hamlet Age) to stone and
 * tile (Feudal) to grander, bannered halls (Kingdom); Fortified Hall and Guard Towers are visible upgrades.
 */
export function buildingGeo(kind, team, look = { age: 1 }) {
  const tc = TEAM[team], b = new Builder(), age = look.age || 0, roofC = age >= 1 ? C.tile : C.thatch;
  const base = (s, h = .35, col = C.dstone) => box(b, col, 0, h / 2 - .5, 0, s, h + 1, s);
  if (kind === 'hall') {
    base(4.8, .4 + age * .1);
    if (look.fort) { // stone keep with corner turrets
      box(b, C.stone, 0, 1.6, 0, 4.2, 2.6, 3.4); crenel(b, 0, 3.05, 0, 4.2, 3.4);
      for (const [x, z] of [[-2, -1.6], [2, -1.6], [-2, 1.6], [2, 1.6]]) { b.add(P.cyl(.5, .55, 3.6, 10), C.stone, x, 1.8, z); b.add(P.cone(.62, 1.0, 10), roofC, x, 4.1, z); }
      roof(b, 3.6, 1.3, 2.8, C.tile, 0, 2.9, 0);
    } else {
      box(b, age ? C.stone : C.dstone, 0, .4 + .7, 0, 4.2, 1.4, 3.4);
      timberWalls(b, 4.0, 1.3, 3.2, 1.8);
      roof(b, 4.4, 1.6, 3.8, roofC, 0, 3.1, 0);
    }
    if (age >= 1) {
      const th = age >= 2 ? 6.4 : 5.2;
      box(b, C.stone, 1.2, th / 2, -.8, 1.5, th, 1.5); b.add(P.cone(1.25, 1.6, 4), C.tile, 1.2, th + .8, -.8, 0, Math.PI / 4, 0);
      for (let i = 0; i < 4; i++) box(b, C.stone, 1.2 + (i % 2 ? .6 : -.6), th + .05, -.8 + (i < 2 ? .6 : -.6), .3, .3, .3);
      flag(b, tc, 1.2, th + 1.3, -.8, 1.6);
      if (age >= 2) { b.m(P.ball(.12, 8, 6), C.gold, 1.2, th + 1.65, -.8); box(b, C.stone, -1.4, 2.4, -1.1, 1.0, 4.8, 1.0); b.add(P.cone(.85, 1.2, 4), C.tile, -1.4, 5.4, -1.1, 0, Math.PI / 4, 0); flag(b, tc, -1.4, 6.0, -1.1, 1.2); }
    } else { b.add(P.cyl(.08, .1, 3.2, 6), C.wood, 1.6, 1.6, -1.3); box(b, C.wood, 1.6, 3.2, -1.3, .9, .12, .9); flag(b, tc, 1.6, 3.3, -1.3, 1.3); }
    box(b, C.dwood, 0, .95, 1.72, .9, 1.3, .08); box(b, C.stone, 0, 1.65, 1.72, 1.1, .2, .12);
    for (const x of [-1.4, 1.4]) box(b, 0x2a2018, x, 2.4, 1.62, .35, .45, .05);
    box(b, tc, -1.0, 1.1, 1.72, .5, 1.0, .03); box(b, tc, 1.0, 1.1, 1.72, .5, 1.0, .03);
    flag(b, tc, -2.2, .4, 2.2, 2.6);
    box(b, C.wood, -1.8, .7, 2.3, .5, .6, .5); b.add(P.cyl(.25, .3, .6, 8), C.wood, 1.9, .7, 2.2);
  } else if (kind === 'house') {
    base(1.9, .3);
    if (age >= 1) box(b, C.stone, 0, .55, 0, 1.65, .5, 1.45);
    const wy = age >= 1 ? .8 : .3, wh = age >= 2 ? 1.6 : 1.1;
    timberWalls(b, 1.6, wh, 1.4, wy); roof(b, 1.9, .9, 1.8, roofC, 0, wy + wh, 0);
    box(b, C.stone, .5, wy + wh + .6, -.3, .25, .8, .25);
    box(b, C.dwood, 0, .7, .72, .4, .8, .05); box(b, 0x2a2018, -.5, wy + .65, .72, .25, .25, .04);
    box(b, tc, .45, wy + .7, .72, .3, .3, .03);
  } else if (kind === 'farm') {
    box(b, C.dirt, 0, .02, 0, 2.9, .1, 2.9);
    for (let i = 0; i < 5; i++) { box(b, 0x5a4229, -1.1 + i * .55, .08, 0, .25, .06, 2.6); box(b, C.crop, -1.1 + i * .55, .22, 0, .18, .25, 2.4); }
    for (let i = 0; i < 6; i++) for (const s of [-1, 1]) { box(b, C.wood, -1.45 + i * .58, .3, s * 1.45, .07, .5, .07); box(b, C.wood, s * 1.45, .3, -1.45 + i * .58, .07, .5, .07); }
    flag(b, tc, 1.45, 0, 1.45, 1.2);
  } else if (kind === 'store') {
    base(2.8, .25);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(b, C.timber, sx * 1.1, 1.0, sz * 1.0, .16, 1.8, .16);
    box(b, age >= 1 ? C.stone : C.plaster, 0, .9, -1.0, 2.2, 1.5, .1);
    roof(b, 2.7, .9, 2.6, roofC, 0, 1.9, 0);
    box(b, C.wood, -.6, .5, .2, .55, .55, .55); box(b, C.wood, .1, .45, .5, .45, .45, .45);
    b.add(P.cyl(.25, .27, .65, 8), C.wood, .7, .55, -.1); b.add(P.cyl(.25, .27, .65, 8), C.wood, .7, .55, .55);
    b.add(P.cyl(.18, .18, .9, 8), C.hay, -.6, .45, -.5, 0, 0, Math.PI / 2);
    flag(b, tc, -1.25, .25, 1.2, 2);
  } else if (kind === 'barracks') {
    base(3.9, .35);
    if (age >= 1) { box(b, C.stone, 0, 1.15, -.2, 3.6, 1.6, 2.6); box(b, C.dstone, 0, .65, -.2, 3.7, .5, 2.7); }
    else timberWalls(b, 3.6, 1.5, 2.6, .35);
    roof(b, 3.9, 1.1, 3.0, roofC, 0, 1.95, -.2);
    if (age >= 2) { crenel(b, 0, 1.95, -.2, 3.7, 2.7); flag(b, tc, -1.6, .35, -1.6, 3.2); }
    box(b, C.dwood, 0, .9, 1.12, .8, 1.1, .06);
    box(b, tc, -1.1, 1.3, 1.13, .55, .9, .03); box(b, tc, 1.1, 1.3, 1.13, .55, .9, .03);
    box(b, C.wood, -1.3, .8, 1.7, 1.0, .08, .08); for (let i = 0; i < 4; i++) box(b, C.steel, -1.7 + i * .25, .9, 1.68, .03, .9, .03, .2);
    b.add(P.cyl(.06, .06, 1.1, 5), C.wood, 1.4, .55, 1.6); b.add(P.cyl(.18, .15, .5, 8), C.straw, 1.4, 1.1, 1.6);
    flag(b, tc, 1.6, .35, -1.6, 2.8);
  } else if (kind === 'stable') {
    base(3.9, .3);
    box(b, C.wood, 0, 1.0, -.3, 3.6, 1.5, 2.4);
    for (let i = -3; i <= 3; i++) box(b, C.dwood, i * .55, 1.0, .91, .06, 1.5, .03);
    roof(b, 3.9, 1.0, 2.9, age >= 2 ? C.tile : C.thatch, 0, 1.75, -.3);
    box(b, C.dwood, 0, .8, .92, 1.2, 1.1, .05);
    for (const x of [-1.4, -.9]) b.add(P.cyl(.3, .3, .7, 10), C.hay, x, .45, 1.5, 0, 0, Math.PI / 2);
    for (let i = 0; i < 5; i++) box(b, C.wood, -1.6 + i * .8, .45, 1.9, .07, .7, .07); box(b, C.wood, 0, .6, 1.9, 3.3, .06, .05);
    flag(b, tc, 1.7, .3, 1.7, 2.4);
  } else if (kind === 'range') {
    base(3.9, .3);
    for (const x of [-1.6, -.55, .55, 1.6]) for (const z of [-1.2, .3]) box(b, C.timber, x, 1.05, z, .16, 1.6, .16);
    box(b, age >= 2 ? C.stone : C.plaster, 0, 1.0, -1.25, 3.4, 1.5, .1); roof(b, 3.8, .9, 2.2, age >= 2 ? C.tile : C.thatch, 0, 1.8, -.45);
    for (const x of [-1.2, 0, 1.2]) { b.add(P.cyl(.32, .32, .08, 18), C.straw, x, .75, 1.55, Math.PI / 2, 0, 0); b.add(P.cyl(.2, .2, .085, 18), C.white, x, .75, 1.555, Math.PI / 2, 0, 0); b.add(P.cyl(.09, .09, .09, 14), 0xb01c1c, x, .75, 1.56, Math.PI / 2, 0, 0); box(b, C.wood, x, .4, 1.5, .06, .8, .06); }
    for (let i = 0; i < 5; i++) box(b, C.dwood, -1.5 + i * .12, .9, -.9, .02, 1.2, .02, 0, 0, .1);
    flag(b, tc, 1.75, .3, -1.6, 2.4);
  } else if (kind === 'workshop') {
    base(3.9, .3);
    box(b, C.wood, 0, 1.15, -.4, 3.5, 1.7, 2.6); for (let i = -3; i <= 3; i++) box(b, C.dwood, i * .55, 1.15, .91, .06, 1.7, .03);
    roof(b, 3.8, 1.2, 3.0, C.tile, 0, 2.0, -.4); box(b, C.dwood, 0, .9, .92, 1.4, 1.4, .05);
    for (const x of [-1.3, 1.25]) { b.add(P.cyl(.32, .32, .08, 14), C.dwood, x, .35, 1.5, 0, 0, Math.PI / 2 + .3); }
    box(b, C.wood, 1.5, 1.6, 1.4, .14, 3.0, .14); box(b, C.wood, 1.1, 3.0, 1.4, 1.0, .12, .12); b.add(P.cyl(.01, .01, .9, 4), C.linen, .7, 2.5, 1.4);
    b.add(P.dode(.25), 0x7a766e, -.4, .35, 1.6); b.add(P.dode(.2), 0x7a766e, -.1, .3, 1.75);
    flag(b, tc, -1.7, .3, -1.6, 2.6);
  } else if (kind === 'smith') { // forge with a big chimney, open front, anvil and water trough
    base(2.9, .3);
    box(b, C.stone, 0, 1.0, -.6, 2.6, 1.6, 1.4); for (const x of [-1.2, 1.2]) box(b, C.timber, x, 1.0, .55, .16, 1.7, .16);
    roof(b, 2.9, 1.0, 2.6, roofC, 0, 1.8, 0);
    box(b, C.stone, .8, 2.3, -.8, .6, 2.8, .6); box(b, 0x2a2018, .8, 3.72, -.8, .45, .05, .45);
    box(b, 0xff7a20, -.3, .55, -.15, .8, .25, .4); box(b, C.dstone, -.3, .35, -.15, 1.0, .3, .6); // glowing hearth
    b.m(P.box, C.dsteel, .55, .55, .7, 0, 0, 0, .45, .14, .18); b.add(P.cyl(.12, .16, .4, 8), C.dwood, .55, .25, .7);
    box(b, C.wood, -.9, .35, .95, .9, .35, .4); box(b, 0x2c4a5a, -.9, .5, .95, .8, .05, .3);
    for (let i = 0; i < 3; i++) b.m(P.box, C.steel, -1.2 + i * .15, 1.1, -1.27, 0, 0, .2, .03, .7, .03);
    flag(b, tc, 1.3, .3, 1.2, 2.2);
  } else if (kind === 'dock') {
    box(b, C.wood, 0, .35, 0, 3.0, .12, 3.0); for (let i = 0; i < 9; i++) box(b, i % 2 ? C.dwood : C.wood, -1.33 + i * .333, .42, 0, .3, .02, 3.0);
    for (const x of [-1.4, 0, 1.4]) for (const z of [-1.4, 0, 1.4]) b.add(P.cyl(.09, .1, 2.2, 7), C.dwood, x, -.7, z);
    box(b, age >= 1 ? C.stone : C.plaster, -.8, .95, -.8, 1.2, 1.0, 1.2); roof(b, 1.4, .6, 1.4, roofC, -.8, 1.45, -.8);
    box(b, C.wood, .9, 1.4, .9, .12, 2.0, .12); box(b, C.wood, .6, 2.35, .9, .8, .1, .1); b.add(P.cyl(.01, .01, .7, 4), C.linen, .25, 2.0, .9);
    b.add(P.cyl(.22, .25, .5, 10), C.wood, .9, .65, -1.0); b.add(P.cyl(.22, .25, .5, 10), C.wood, 1.25, .65, -.6);
    flag(b, tc, -1.4, .4, 1.4, 2.2);
  } else if (kind === 'tower') {
    base(1.9, .3);
    const g = look.guard, H = g ? 5.2 : 4.0, W = g ? 1.6 : 1.4;
    box(b, C.stone, 0, .2 + H / 2, 0, W, H, W); if (g) box(b, C.dstone, 0, .6, 0, W + .25, 1.0, W + .25);
    box(b, C.dstone, 0, H + .3, 0, W + .3, .3, W + .3);
    for (let i = 0; i < 4; i++) for (let k = -1; k <= 1; k += 2) { box(b, C.stone, k * (W / 2 - .05), H + .65, (i - 1.5) * W / 3.1, .25, .4, .25); box(b, C.stone, (i - 1.5) * W / 3.1, H + .65, k * (W / 2 - .05), .25, .4, .25); }
    b.add(P.cone(W * .82, 1.3 + (g ? .4 : 0), g ? 8 : 4), g ? C.tile : tc, 0, H + 1.5 + (g ? .2 : 0), 0, 0, Math.PI / 4, 0);
    box(b, 0x2a2018, 0, H * .7, W / 2 + .01, .15, .5, .03); box(b, C.dwood, 0, .8, W / 2 + .01, .5, .9, .04);
    flag(b, tc, 0, H + 2.1 + (g ? .6 : 0), 0, 1.2);
  }
  return b.build();
}
const BD_SIZE = { hall: 5, house: 2, farm: 3, store: 3, barracks: 4, range: 4, stable: 4, workshop: 4, smith: 3, tower: 2, dock: 3 };
/** See-through placement preview (green/red) for a building. */
export function ghostObject(kind, look, mat) {
  const custom = buildingParts(kind, BD_SIZE[kind] || 3);
  if (!custom) return new THREE.Mesh(buildingGeo(kind, 0, look), mat);
  const g = new THREE.Group(); for (const p of custom) g.add(new THREE.Mesh(p.geo, mat)); g.userData.ghost = true; return g;
}
export function buildingMesh(kind, team, shadows, look) {
  const custom = buildingParts(kind, BD_SIZE[kind] || 3);
  if (custom) { // a prepared Tripo/Blender model, plus a team banner so you can tell whose it is
    const g = new THREE.Group(); g.userData.glb = true;
    for (const p of custom) { const m = new THREE.Mesh(p.geo, p.mat); m.castShadow = shadows; m.receiveShadow = true; g.add(m); }
    const fb = new Builder(), s = (BD_SIZE[kind] || 3) / 2; flag(fb, TEAM[team], s - .2, 0, s - .2, 2.2 + s * .3);
    const f = new THREE.Mesh(fb.build(), M.stone); f.castShadow = shadows; g.add(f);
    return g;
  }
  const m = new THREE.Mesh(buildingGeo(kind, team, look), M.stone); m.castShadow = shadows; m.receiveShadow = true; return m;

}

// ---------------- arrows ----------------
export const boltGeo = new Builder().add(P.box, 0x5a4026, 0, 0, 0, 0, 0, 0, .035, .035, .42).add(P.cone(.05, .1, 4), C.dsteel, 0, 0, .25, Math.PI / 2, 0, 0).build();
export const stoneGeo = new Builder().add(P.dode(.22), 0x7a766e).build();
export const arrowGeo = new Builder().add(P.box, 0x8a6a3a, 0, 0, 0, 0, 0, 0, .025, .025, .7).add(P.cone(.04, .12, 4), C.steel, 0, 0, .4, Math.PI / 2, 0, 0).add(P.box, 0xeeeeee, 0, 0, -.3, 0, 0, 0, .1, .01, .12).build();
export const ringGeo = new THREE.RingGeometry(.45, .56, 28).rotateX(-Math.PI / 2);
