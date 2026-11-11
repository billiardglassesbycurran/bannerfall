// 3D models. Units are drawn with GPU instancing: every Swordsman of a team shares one draw call per body part
// (cloth and metal separately, so steel can shine), which keeps big armies fast on phones.
// Buildings are merged into a single mesh each.
import * as THREE from 'three';
import { Builder, P, M, TEXMAT } from './geo.js';

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

// ---------------- humans ----------------
const KIND = {
  peasant: { torso: 'linen', skirt: 'linen', legs: 'pants', helm: 'straw', beard: 1, R: 'axe' },
  sword:   { torso: 'mail', skirt: 'mail', legs: 'mail', helm: 'nasal', tabard: 1, pauld: 1, R: 'sword', L: 'kite', scab: 1 },
  spear:   { torso: 'gamb', skirt: 'gamb', legs: 'pants', helm: 'kettle', beard: 1, R: 'spear', L: 'round' },
  archer:  { torso: 'green', skirt: 'green', legs: 'hose', helm: 'hood', L: 'bow', quiver: 1 },
  knight:  { torso: 'mail', skirt: 'mail', legs: 'mail', helm: 'great', tabard: 1, pauld: 1, R: 'lance', L: 'kite' },
  hero:    { torso: 'plate', skirt: 'mail', legs: 'mail', helm: 'crown', tabard: 1, pauld: 1, R: 'sword', L: 'kite', cape: 1, scab: 1, beard: 1 },
};
const MAT = { mail: [C.chain, 1], plate: [C.steel, 1], gamb: [C.gamb, 0], green: [C.green, 0], linen: [C.linen, 0], pants: [C.pants, 0], hose: [C.hose, 0] };
const put = (b, key, geo, ...t) => { const [col, metal] = MAT[key]; return metal ? b.m(geo, col, ...t) : b.add(geo, col, ...t); };
const TORSO = P.lathe([[.15, .86], [.175, .98], [.19, 1.12], [.215, 1.27], [.205, 1.37], [.15, 1.46], [.07, 1.5]], 16);
const SKIRT = P.lathe([[.19, .99], [.215, .86], [.25, .62]], 16);
// mail neck guard, open at the front so the face shows
const AVENTAIL = new THREE.CylinderGeometry(.14, .17, .15, 16, 1, true, 1.1, Math.PI * 2 - 2.2);
const DOME = P.lathe([[.128, 0], [.132, .05], [.12, .11], [.085, .17], [.03, .205], [0, .21]], 16);

function humanParts(team, kind, mounted) {
  const k = KIND[kind], tc = TEAM[team], y0 = mounted ? .95 : 0;
  const b = new Builder(), parts = [];
  // --- body ---
  put(b, k.torso, TORSO, 0, y0, 0, 0, 0, 0, 1, 1, .72);
  if (!mounted) put(b, k.skirt, SKIRT, 0, y0, 0, 0, 0, 0, 1, 1, .8);
  else put(b, k.skirt, SKIRT, 0, y0 + .12, 0, 0, 0, 0, 1.2, .5, 1.1);
  if (k.torso === 'gamb') for (let i = 0; i < 4; i++) b.add(P.cyl(.2 + i * .006, .2 + i * .006, .012, 16, true), mixHex(C.gamb, 0x000000, .3), 0, 1.02 + i * .1 + y0, 0, 0, 0, 0, 1, 1, .74);
  b.add(P.cyl(.198, .198, .05, 16, true), C.leather, 0, .97 + y0, 0, 0, 0, 0, 1, 1, .76); mbox(b, C.brass, 0, .97 + y0, .152, .05, .045, .015);
  if (k.tabard) {
    for (const s of [1, -1]) box(b, tc, 0, 1.0 + y0, .18 * s, .33, .72, .014, -.06 * s);
    box(b, C.gold, 0, .655 + y0, .201, .33, .025, .016, -.06); emblem(b, team, 0, 1.17 + y0, .19, 1.0);
  }
  if (k.pauld) for (const s of [-1, 1]) b.m(new THREE.SphereGeometry(.11, 14, 8, 0, Math.PI * 2, 0, Math.PI * .5), C.steel, s * .225, 1.39 + y0, 0, 0, 0, s * .35, 1, .6, 1);
  if (k.quiver) { b.add(P.cyl(.06, .05, .58, 8), C.leather, .1, 1.18 + y0, -.17, .2, 0, -.35); for (let i = 0; i < 5; i++) box(b, i % 2 ? C.white : 0x9a9a9a, .2 + (i - 2) * .02, 1.5 + y0, -.24 + (i % 2) * .03, .015, .1, .05, .2, 0, -.35); }
  if (k.scab && !mounted) { b.add(P.cyl(.026, .02, .72, 6), C.dleather, -.22, .66, -.06, -.45, 0, .12); mbox(b, C.gold, -.21, .98, .06, .03, .17, .03, -.45, 0, .12); b.m(P.ball(.028, 6, 5), C.gold, -.205, 1.06, .1); }
  if (k.cape) {
    const dark = mixHex(tc, 0x000000, .35), cp = new THREE.PlaneGeometry(.2, 1.0, 1, 4);
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
  if (k.beard) b.add(P.ball(.095, 10, 8), kind === 'hero' ? 0x6a4a2a : C.beard, 0, hy - .06, .045, 0, 0, 0, 1, 1.05, .75);
  switch (k.helm) {
    case 'nasal':
      b.m(DOME, C.steel, 0, hy + .005, 0); b.m(P.cyl(.134, .134, .03, 16, true), C.dsteel, 0, hy + .02, 0);
      mbox(b, C.steel, 0, hy - .02, .132, .024, .11, .012); b.m(AVENTAIL, C.chain, 0, hy - .09, -.01, .08, 0, 0);
      break;
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
    g.add(P.cyl(.068, .072, .2, 10), C.boot, 0, -.79, 0); g.add(P.box, C.boot, 0, -.875, .045, 0, 0, 0, .1, .07, .22); g.add(P.ball(.05, 8, 6), C.boot, 0, -.87, .15, 0, 0, 0, 1, .7, 1);
    parts.push({ ...g.split(), pivot: [s * .1, .92, 0], anim: s < 0 ? 'legL' : 'legR' });
  } else for (const s of [-1, 1]) { // straddling the saddle
    put(b, k.legs, P.cyl(.088, .072, .46, 10), s * .25, .82 + y0 - .04, .12, 1.15, 0, s * .28);
    put(b, k.legs, P.cyl(.068, .056, .42, 10), s * .34, .5 + y0 - .06, .26, -.15, 0, 0);
    b.add(P.box, C.boot, s * .34, .27 + y0 - .06, .3, 0, 0, 0, .1, .08, .22); b.m(P.cyl(.04, .04, .02, 8), C.dsteel, s * .34, .22 + y0 - .06, .3);
  }
  // --- arms ---
  const arm = (side, item) => {
    const g = new Builder();
    if (k.torso === 'mail' || k.torso === 'plate') g.m(P.cyl(.064, .056, .32, 10), C.chain, 0, -.16, 0); else put(g, k.torso, P.cyl(.064, .056, .32, 10), 0, -.16, 0);
    g.add(P.ball(.055, 8, 6), MAT[k.torso][0], 0, -.33, 0);
    const fa = -.3, fx = Math.sin(-fa);
    if (k.torso === 'mail' || k.torso === 'plate') g.m(P.cyl(.054, .046, .28, 10), C.chain, 0, -.33 - .14 * Math.cos(fa), .14 * fx, fa); else put(g, k.torso, P.cyl(.054, .046, .28, 10), 0, -.33 - .14 * Math.cos(fa), .14 * fx, fa);
    if (kind === 'hero' || kind === 'knight') g.m(P.cyl(.06, .052, .14, 10), C.steel, 0, -.33 - .22 * Math.cos(fa), .22 * fx, fa);
    const H = [0, -.33 - .3 * Math.cos(fa), .3 * fx];
    g.add(P.box, kind === 'peasant' ? C.skin : C.leather, H[0], H[1], H[2], fa, 0, 0, .07, .09, .075);
    item && item(g, H);
    return g.split();
  };
  const R = { sword: (g, H) => g.put(sword(), H[0], H[1], H[2] + .02, .9), spear: (g, H) => g.put(spear(), H[0], H[1], H[2], 1.25), lance: (g, H) => g.put(lance(team), H[0], H[1], H[2], 1.5), axe: (g, H) => g.put(axe(), H[0], H[1], H[2], .5) }[k.R];
  const L = { kite: (g, H) => g.put(kiteShield(team), -.07, -.4, .16, 0, -.25, 0), round: (g, H) => g.put(roundShield(team), -.07, -.42, .14, 0, -.2, 0), bow: (g, H) => g.put(bow(), H[0], H[1], H[2]) }[k.L];
  parts.push({ ...arm(1, R), pivot: [.235, 1.42 + y0, 0], anim: 'armR' });
  parts.push({ ...arm(-1, L), pivot: [-.235, 1.42 + y0, 0], anim: 'armL' });
  parts.unshift({ ...b.split(), pivot: [0, 0, 0], anim: null });
  return parts;
}

// ---------------- horse ----------------
function horseParts(team) {
  const tc = TEAM[team], b = new Builder(), parts = [];
  b.add(P.ball(.5, 20, 14), C.horse, 0, 1.25, 0, 0, 0, 0, .76, .84, 1.7);           // barrel
  b.add(P.ball(.4, 16, 12), C.horse, 0, 1.3, .62, 0, 0, 0, .9, 1, .9);              // chest
  b.add(P.ball(.42, 16, 12), C.horse, 0, 1.33, -.62, 0, 0, 0, .95, 1, .95);         // rump
  b.add(P.cyl(.15, .25, .78, 14), C.horse, 0, 1.875, .83, .69, 0, 0);               // neck (leans forward)
  b.add(P.cyl(.075, .125, .52, 12), C.horse, 0, 2.0, 1.25, 2.21, 0, 0);             // head (angled down)
  b.add(P.ball(.085, 10, 8), C.horse, 0, 1.84, 1.46, 0, 0, 0, .95, .85, 1.1);         // muzzle
  b.add(P.ball(.02, 6, 4), C.eye, -.035, 1.82, 1.53); b.add(P.ball(.02, 6, 4), C.eye, .035, 1.82, 1.53);
  for (const s of [-1, 1]) { b.add(P.cone(.035, .13, 6), C.horse, s * .06, 2.27, 1.0, -.15, 0, s * .2); b.add(P.ball(.022, 6, 5), C.eye, s * .1, 2.08, 1.16); }
  box(b, C.dhorse, 0, 1.93, .74, .05, .78, .1, .69);                                   // mane
  b.add(P.cyl(.1, .045, .85, 8), C.dhorse, 0, 1.1, -1.2, -2.68, 0, 0);               // tail
  // caparison + tack
  b.add(P.cyl(.46, .53, .58, 24, true), tc, 0, 1.08, -.02, 0, 0, 0, 1, 1, 1.9);
  b.add(P.cyl(.532, .532, .035, 24, true), C.gold, 0, .8, -.02, 0, 0, 0, 1, 1, 1.9);
  for (const s of [-1, 1]) { box(b, C.gold, s * .535, 1.12, 0, .012, .26, .055); box(b, C.gold, s * .535, 1.17, 0, .012, .055, .22); }
  b.add(P.box, C.leather, 0, 1.72, -.05, 0, 0, 0, .44, .1, .6); box(b, C.dleather, 0, 1.8, -.32, .38, .12, .08); box(b, C.dleather, 0, 1.78, .22, .3, .1, .06);
  b.m(P.box, C.steel, 0, 2.07, 1.3, 2.21, 0, 0, .17, .44, .03);                      // chanfron
  for (const s of [-1, 1]) box(b, C.dleather, s * .1, 1.8, .9, .015, .02, .75, -.15);
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const g = new Builder();
    g.add(P.cyl(.1, .07, .5, 10), C.horse, 0, -.22, sz < 0 ? -.03 : 0); g.add(P.ball(.06, 8, 6), C.horse, 0, -.48, 0);
    g.add(P.cyl(.048, .044, .44, 8), C.horse, 0, -.7, 0); g.add(P.cyl(.058, .066, .09, 10), C.hoof, 0, -.96, .01);
    parts.push({ ...g.split(), pivot: [sx * .21, 1.0, sz * .6], anim: (sx < 0) === (sz > 0) ? 'hA' : 'hB' });
  }
  parts.unshift({ ...b.split(), pivot: [0, 0, 0], anim: null });
  return parts;
}
function figureParts(team, kind) {
  if (kind === 'knight') return [...horseParts(team), ...humanParts(team, 'knight', true)];
  return humanParts(team, kind, false);
}

const _root = new THREE.Matrix4(), _pm = new THREE.Matrix4(), _rx = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler(), ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/** One batch of instanced meshes per (team, kind). */
class FigureBatch {
  constructor(scene, team, kind, cap, shadows) {
    this.mounted = kind === 'knight';
    this.meshes = [];
    this.parts = figureParts(team, kind).map(p => {
      const ms = [];
      for (const [geo, mat] of [[p.c, M.cloth], [p.m, M.metal]]) {
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
      }
      let mtx = _root;
      if (p.anim) { _pm.makeTranslation(p.pivot[0], p.pivot[1], p.pivot[2]).multiply(_rx.makeRotationX(a)); _pm.premultiply(_root); mtx = _pm; }
      for (const m of p.ms) m.setMatrixAt(i, mtx);
    }
  }
  flush() { for (const m of this.meshes) m.instanceMatrix.needsUpdate = true; }
}
export class Figures {
  constructor(scene, shadows) { this.scene = scene; this.shadows = shadows; this.batches = new Map(); }
  get(team, kind) {
    const k = team + kind; let b = this.batches.get(k);
    if (!b) { b = new FigureBatch(this.scene, team, kind, kind === 'hero' ? 4 : 200, this.shadows); this.batches.set(k, b); }
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
export function buildingGeo(kind, team) {
  const tc = TEAM[team], b = new Builder();
  const base = (s, h = .35, col = C.dstone) => box(b, col, 0, h / 2 - .5, 0, s, h + 1, s);
  if (kind === 'hall') {
    base(4.8, .4);
    box(b, C.stone, 0, .4 + .7, 0, 4.2, 1.4, 3.4);
    timberWalls(b, 4.0, 1.3, 3.2, 1.8);
    roof(b, 4.4, 1.6, 3.8, C.tile, 0, 3.1, 0);
    box(b, C.stone, 1.2, 2.6, -.8, 1.5, 5.2, 1.5); b.add(P.cone(1.25, 1.6, 4), C.tile, 1.2, 6.0, -.8, 0, Math.PI / 4, 0);
    for (let i = 0; i < 4; i++) box(b, C.stone, 1.2 + (i % 2 ? .6 : -.6), 5.25, -.8 + (i < 2 ? .6 : -.6), .3, .3, .3);
    box(b, C.dwood, 0, .95, 1.72, .9, 1.3, .08); box(b, C.stone, 0, 1.65, 1.72, 1.1, .2, .12);
    for (const x of [-1.4, 1.4]) box(b, 0x2a2018, x, 2.4, 1.62, .35, .45, .05);
    box(b, tc, -1.0, 1.1, 1.72, .5, 1.0, .03); box(b, tc, 1.0, 1.1, 1.72, .5, 1.0, .03);
    flag(b, tc, 1.2, 6.5, -.8, 1.6); flag(b, tc, -2.2, .4, 2.2, 2.6);
    box(b, C.wood, -1.8, .7, 2.3, .5, .6, .5); b.add(P.cyl(.25, .3, .6, 8), C.wood, 1.9, .7, 2.2);
  } else if (kind === 'house') {
    base(1.9, .3);
    timberWalls(b, 1.6, 1.1, 1.4, .3); roof(b, 1.9, .9, 1.8, C.thatch, 0, 1.4, 0);
    box(b, C.stone, .5, 2.0, -.3, .25, .8, .25);
    box(b, C.dwood, 0, .7, .72, .4, .8, .05); box(b, 0x2a2018, -.5, .95, .72, .25, .25, .04);
    box(b, tc, .45, 1.0, .72, .3, .3, .03);
  } else if (kind === 'farm') {
    box(b, C.dirt, 0, .02, 0, 2.9, .1, 2.9);
    for (let i = 0; i < 5; i++) { box(b, 0x5a4229, -1.1 + i * .55, .08, 0, .25, .06, 2.6); box(b, C.crop, -1.1 + i * .55, .22, 0, .18, .25, 2.4); }
    for (let i = 0; i < 6; i++) for (const s of [-1, 1]) { box(b, C.wood, -1.45 + i * .58, .3, s * 1.45, .07, .5, .07); box(b, C.wood, s * 1.45, .3, -1.45 + i * .58, .07, .5, .07); }
    flag(b, tc, 1.45, 0, 1.45, 1.2);
  } else if (kind === 'store') {
    base(2.8, .25);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(b, C.timber, sx * 1.1, 1.0, sz * 1.0, .16, 1.8, .16);
    box(b, C.plaster, 0, .9, -1.0, 2.2, 1.5, .1);
    roof(b, 2.7, .9, 2.6, C.thatch, 0, 1.9, 0);
    box(b, C.wood, -.6, .5, .2, .55, .55, .55); box(b, C.wood, .1, .45, .5, .45, .45, .45);
    b.add(P.cyl(.25, .27, .65, 8), C.wood, .7, .55, -.1); b.add(P.cyl(.25, .27, .65, 8), C.wood, .7, .55, .55);
    b.add(P.cyl(.18, .18, .9, 8), C.hay, -.6, .45, -.5, 0, 0, Math.PI / 2);
    flag(b, tc, -1.25, .25, 1.2, 2);
  } else if (kind === 'barracks') {
    base(3.9, .35);
    box(b, C.stone, 0, 1.15, -.2, 3.6, 1.6, 2.6);
    box(b, C.dstone, 0, .65, -.2, 3.7, .5, 2.7);
    roof(b, 3.9, 1.1, 3.0, C.tile, 0, 1.95, -.2);
    box(b, C.dwood, 0, .9, 1.12, .8, 1.1, .06);
    box(b, tc, -1.1, 1.3, 1.13, .55, .9, .03); box(b, tc, 1.1, 1.3, 1.13, .55, .9, .03);
    box(b, C.wood, -1.3, .8, 1.7, 1.0, .08, .08); for (let i = 0; i < 4; i++) box(b, C.steel, -1.7 + i * .25, .9, 1.68, .03, .9, .03, .2);
    b.add(P.cyl(.06, .06, 1.1, 5), C.wood, 1.4, .55, 1.6); b.add(P.cyl(.18, .15, .5, 8), C.straw, 1.4, 1.1, 1.6);
    flag(b, tc, 1.6, .35, -1.6, 2.8);
  } else if (kind === 'stable') {
    base(3.9, .3);
    box(b, C.wood, 0, 1.0, -.3, 3.6, 1.5, 2.4);
    for (let i = -3; i <= 3; i++) box(b, C.dwood, i * .55, 1.0, .91, .06, 1.5, .03);
    roof(b, 3.9, 1.0, 2.9, C.thatch, 0, 1.75, -.3);
    box(b, C.dwood, 0, .8, .92, 1.2, 1.1, .05);
    for (const x of [-1.4, -.9]) b.add(P.cyl(.3, .3, .7, 10), C.hay, x, .45, 1.5, 0, 0, Math.PI / 2);
    for (let i = 0; i < 5; i++) box(b, C.wood, -1.6 + i * .8, .45, 1.9, .07, .7, .07); box(b, C.wood, 0, .6, 1.9, 3.3, .06, .05);
    flag(b, tc, 1.7, .3, 1.7, 2.4);
  } else if (kind === 'tower') {
    base(1.9, .3);
    box(b, C.stone, 0, 2.2, 0, 1.4, 4.0, 1.4);
    box(b, C.dstone, 0, 4.3, 0, 1.7, .3, 1.7);
    for (let i = 0; i < 4; i++) for (let k = -1; k <= 1; k += 2) { box(b, C.stone, k * .65, 4.65, (i - 1.5) * .45, .25, .4, .25); box(b, C.stone, (i - 1.5) * .45, 4.65, k * .65, .25, .4, .25); }
    b.add(P.cone(1.15, 1.3, 4), tc, 0, 5.5, 0, 0, Math.PI / 4, 0);
    box(b, 0x2a2018, 0, 2.8, .71, .15, .5, .03); box(b, C.dwood, 0, .8, .71, .5, .9, .04);
    flag(b, tc, 0, 6.1, 0, 1.2);
  }
  return b.build();
}
export function buildingMesh(kind, team, shadows) {
  const m = new THREE.Mesh(buildingGeo(kind, team), M.stone); m.castShadow = shadows; m.receiveShadow = true; return m;
}

// ---------------- arrows ----------------
export const arrowGeo = new Builder().add(P.box, 0x8a6a3a, 0, 0, 0, 0, 0, 0, .025, .025, .7).add(P.cone(.04, .12, 4), C.steel, 0, 0, .4, Math.PI / 2, 0, 0).add(P.box, 0xeeeeee, 0, 0, -.3, 0, 0, 0, .1, .01, .12).build();
export const ringGeo = new THREE.RingGeometry(.45, .56, 28).rotateX(-Math.PI / 2);
