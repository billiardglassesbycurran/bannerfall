// 3D models. Units are drawn with GPU instancing: every Swordsman of a team shares one draw call per body part,
// so big armies stay fast on phones. Buildings are merged into a single mesh each.
import * as THREE from 'three';
import { Builder, P, vcMat, vcMatFlat } from './geo.js';

export const TEAM = [0x2a5cd1, 0xc7241c];
const C = {
  skin: 0xdba885, pants: 0x54422e, leather: 0x613f24, dleather: 0x3f2814, boot: 0x33210f, chain: 0x7c818c, steel: 0xa8afba,
  dsteel: 0x5c6068, wood: 0x75502b, dwood: 0x4a3018, gold: 0xebb842, green: 0x546638, blade: 0xdfe5ee, white: 0xeeeae0,
  straw: 0xd6b768, hair: 0x4a2f1a, beard: 0x5a3a1e, horse: 0x6e4a2c, dhorse: 0x35220f, hay: 0xd8bc6a,
  stone: 0x9a958b, dstone: 0x726e66, plaster: 0xe6dcc3, timber: 0x5a3d22, thatch: 0xbd9c52, tile: 0x8c4a33, dirt: 0x6b5236, crop: 0x8fae3c,
};
const mixHex = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();

// ---------------- prism (gable roof) ----------------
function prism(w, h, d) {
  const W = w / 2, D = d / 2, v = [];
  const tri = (a, b, c) => v.push(...a, ...b, ...c);
  tri([-W, 0, -D], [-W, 0, D], [-W, h, 0]); tri([W, 0, -D], [W, h, 0], [W, 0, D]);
  const q = (a, b, c, d2) => { tri(a, b, c); tri(a, c, d2); };
  q([-W, 0, D], [W, 0, D], [W, h, 0], [-W, h, 0]); q([W, 0, -D], [-W, 0, -D], [-W, h, 0], [W, h, 0]);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.computeVertexNormals(); return g;
}
const box = (b, col, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) => b.add(P.box, col, x, y, z, rx, ry, rz, sx, sy, sz);

// ---------------- unit figures ----------------
function humanParts(team, kind, mounted) {
  const tc = TEAM[team], tl = mixHex(tc, 0xd8cdb4, .45);
  const pal = {
    peasant: { legs: C.pants, torso: tl, sleeve: tl },
    hero: { legs: C.chain, torso: C.steel, sleeve: C.chain },
    sword: { legs: C.chain, torso: C.chain, sleeve: C.chain },
    knight: { legs: C.chain, torso: C.steel, sleeve: C.chain },
    spear: { legs: C.pants, torso: C.leather, sleeve: C.chain },
    archer: { legs: C.dleather, torso: C.green, sleeve: C.green },
  }[kind];
  const y0 = mounted ? .95 : 0;
  const body = new Builder(), parts = [];
  // torso
  body.add(P.cyl(.21, .19, .62, 10), pal.torso, 0, 1.06 + y0, 0, 0, 0, 0, 1, 1, .75);
  body.add(P.cyl(.2, .2, .07, 10), C.leather, 0, .86 + y0, 0, 0, 0, 0, 1, 1, .78);
  body.add(P.box, C.gold, 0, .86 + y0, .16, 0, 0, 0, .06, .05, .02);
  if (kind === 'peasant') body.add(P.cyl(.23, .2, .3, 10), mixHex(tl, C.pants, .4), 0, .7 + y0, 0, 0, 0, 0, 1, 1, .8);
  else if (kind !== 'archer') { box(body, tc, 0, 1.02 + y0, .155, .3, .5, .02); box(body, tc, 0, 1.02 + y0, -.155, .3, .5, .02); box(body, C.gold, 0, 1.12 + y0, .167, .1, .1, .01, 0, 0, Math.PI / 4); }
  else { box(body, tc, 0, 1.08 + y0, 0, .08, .7, .34, 0, 0, .65); body.add(P.cyl(.07, .07, .55, 7), C.leather, .08, 1.1 + y0, -.19, .25, 0, -.3); }
  if (kind === 'hero' || kind === 'sword' || kind === 'knight') { body.add(P.ball(.11, 8, 6), C.steel, -.23, 1.3 + y0, 0); body.add(P.ball(.11, 8, 6), C.steel, .23, 1.3 + y0, 0); }
  if (kind === 'hero') { const cp = new THREE.PlaneGeometry(.52, 1.05); body.add(cp, mixHex(tc, 0x000000, .3), 0, .95 + y0, -.21, .12, Math.PI, 0); body.add(cp, mixHex(tc, 0x000000, .3), 0, .95 + y0, -.2, .12, 0, 0); }
  // head
  const hy = 1.56 + y0;
  body.add(P.cyl(.065, .065, .12, 7), C.skin, 0, hy - .12, 0);
  body.add(P.ball(.14, 12, 10), C.skin, 0, hy + .04, 0);
  box(body, 0x1a1410, -.045, hy + .06, .125, .025, .02, .01); box(body, 0x1a1410, .045, hy + .06, .125, .025, .02, .01);
  const cap = new THREE.SphereGeometry(.16, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  if (kind === 'sword' || kind === 'hero' || kind === 'knight') {
    body.add(cap, C.steel, 0, hy + .06, 0); box(body, C.steel, 0, hy + .03, .15, .03, .12, .02);
    box(body, kind === 'hero' ? C.white : tc, 0, hy + .26, -.03, .05, .12, .26, .2);
    if (kind === 'hero') body.add(P.cyl(.17, .17, .06, 12, true), C.gold, 0, hy + .1, 0);
  } else if (kind === 'spear') { body.add(P.cyl(.14, .26, .07, 12), C.steel, 0, hy + .13, 0); body.add(cap, C.steel, 0, hy + .1, 0, 0, 0, 0, .9, .7, .9); body.add(P.ball(.1, 7, 5), C.beard, 0, hy - .03, .07, 0, 0, 0, 1, 1.1, .7); }
  else if (kind === 'archer') body.add(P.cone(.18, .38, 10), tc, 0, hy + .18, -.01);
  else { body.add(P.ball(.13, 8, 6), C.hair, 0, hy + .08, -.03); body.add(P.cyl(.3, .3, .03, 12), C.straw, 0, hy + .11, 0); body.add(P.cone(.17, .16, 10), C.straw, 0, hy + .2, 0); body.add(P.cyl(.175, .175, .05, 10), tc, 0, hy + .14, 0); body.add(P.ball(.1, 7, 5), C.beard, 0, hy - .03, .07, 0, 0, 0, 1, 1.1, .7); }
  // legs
  if (!mounted) for (const s of [-1, 1]) {
    const g = new Builder(); g.add(P.cyl(.085, .07, .72, 7), pal.legs, 0, -.36, 0); g.add(P.box, C.boot, 0, -.71, .04, 0, 0, 0, .13, .1, .22);
    parts.push({ geo: g.build(), pivot: [s * .11, .78, 0], anim: s < 0 ? 'legL' : 'legR' });
  } else for (const s of [-1, 1]) { // straddling
    body.add(P.cyl(.085, .075, .5, 7), pal.legs, s * .26, .78 + y0 - .05, .12, 1.1, 0, s * .25);
    body.add(P.cyl(.075, .07, .5, 7), pal.legs, s * .33, .45 + y0 - .05, .2, -.1, 0, 0);
    body.add(P.box, C.boot, s * .33, .2 + y0 - .05, .25, 0, 0, 0, .12, .1, .22);
  }
  // arms + gear
  const armR = new Builder(), armL = new Builder();
  for (const a of [armR, armL]) { a.add(P.cyl(.06, .05, .6, 7), pal.sleeve, 0, -.3, 0); a.add(P.ball(.055, 7, 6), kind === 'peasant' ? C.skin : C.leather, 0, -.62, 0); }
  if (kind === 'sword' || kind === 'hero') {
    box(armR, C.blade, 0, -.62, .45, .05, .02, .78); box(armR, C.gold, 0, -.62, .06, .26, .04, .05);
    box(armL, tc, -.07, -.4, .1, .04, .56, .4); box(armL, C.dsteel, -.05, -.4, .1, .03, .6, .44); box(armL, C.gold, -.095, -.36, .1, .01, .12, .12, Math.PI / 4);
  } else if (kind === 'knight') {
    armR.add(P.cyl(.035, .05, 2.6, 6), C.wood, 0, -.62, .7, Math.PI / 2, 0, 0); armR.add(P.cone(.06, .3, 6), C.steel, 0, -.62, 2.1, Math.PI / 2, 0, 0);
    box(armR, tc, 0, -.5, 1.65, .01, .2, .3);
    box(armL, tc, -.07, -.4, .1, .04, .56, .4); box(armL, C.dsteel, -.05, -.4, .1, .03, .6, .44);
  } else if (kind === 'spear') {
    armR.add(P.cyl(.025, .025, 2.5, 5), C.wood, 0, -.62, .35, Math.PI / 2, 0, 0); armR.add(P.cone(.05, .3, 4), C.steel, 0, -.62, 1.74, Math.PI / 2, 0, 0);
    armL.add(P.cyl(.26, .26, .04, 14), C.wood, -.08, -.42, .05, 0, 0, Math.PI / 2); armL.add(P.cyl(.2, .2, .045, 14), tc, -.09, -.42, .05, 0, 0, Math.PI / 2);
  } else if (kind === 'archer') {
    armL.add(new THREE.TorusGeometry(.5, .022, 4, 14, Math.PI), C.wood, 0, -.62, .1, 0, -Math.PI / 2, -Math.PI / 2);
    box(armL, C.white, 0, -.62, .1, .006, 1, .006);
  } else { // peasant: hand axe
    box(armR, C.wood, 0, -.62, .22, .04, .04, .6); box(armR, C.steel, 0, -.62, .48, .03, .2, .13);
  }
  parts.push({ geo: armR.build(), pivot: [.27, 1.34 + y0, 0], anim: 'armR' });
  parts.push({ geo: armL.build(), pivot: [-.27, 1.34 + y0, 0], anim: 'armL' });
  parts.unshift({ geo: body.build(), pivot: [0, 0, 0], anim: null });
  return parts;
}
function horseParts(team) {
  const tc = TEAM[team], b = new Builder(), parts = [];
  b.add(P.ball(.5, 12, 8), C.horse, 0, 1.25, 0, 0, 0, 0, .75, .8, 1.5);
  b.add(P.cyl(.18, .26, .8, 8), C.horse, 0, 1.65, .72, -.75, 0, 0);
  b.add(P.box, C.horse, 0, 1.98, 1.0, -.35, 0, 0, .22, .25, .55);
  b.add(P.box, C.dhorse, 0, 1.88, .9, -.75, 0, 0, .06, .5, .12);
  b.add(P.cone(.06, .15, 4), C.horse, -.08, 2.17, .86); b.add(P.cone(.06, .15, 4), C.horse, .08, 2.17, .86);
  b.add(P.cyl(.05, .1, .7, 6), C.dhorse, 0, 1.15, -.78, .5, 0, 0);
  // caparison (team cloth) + saddle
  b.add(P.cyl(.6, .66, .55, 12, true), tc, 0, 1.08, -.05, 0, 0, 0, .9, 1, 1.25);
  box(b, C.leather, 0, 1.62, -.05, .5, .1, .55);
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const g = new Builder(); g.add(P.cyl(.07, .06, 1.0, 6), C.horse, 0, -.5, 0); g.add(P.cyl(.08, .08, .1, 6), C.dhorse, 0, -.98, 0);
    parts.push({ geo: g.build(), pivot: [sx * .2, 1.0, sz * .5], anim: (sx < 0) === (sz > 0) ? 'hA' : 'hB' });
  }
  parts.unshift({ geo: b.build(), pivot: [0, 0, 0], anim: null });
  return parts;
}
function figureParts(team, kind) {
  if (kind === 'knight') { const h = horseParts(team), r = humanParts(team, 'knight', true); return [...h, ...r]; }
  return humanParts(team, kind, false);
}

const _root = new THREE.Matrix4(), _pm = new THREE.Matrix4(), _rx = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler(), ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/** One batch of instanced meshes per (team, kind). */
class FigureBatch {
  constructor(scene, team, kind, cap, shadows) {
    this.parts = figureParts(team, kind).map(p => {
      const m = new THREE.InstancedMesh(p.geo, vcMat, cap); m.count = 0; m.frustumCulled = false; m.castShadow = shadows;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); return { ...p, mesh: m };
    });
    this.cap = cap; this.used = 0; this.free = [];
  }
  alloc() { const i = this.free.length ? this.free.pop() : this.used++; if (i >= this.cap) throw new Error('too many units'); for (const p of this.parts) p.mesh.count = Math.max(p.mesh.count, i + 1); return i; }
  release(i) { for (const p of this.parts) { p.mesh.setMatrixAt(i, ZERO); p.mesh.instanceMatrix.needsUpdate = true; } this.free.push(i); }
  /** pose: {x,y,z,yaw,scale,hidden,tilt, s (walk swing), swing (attack 0..1)} */
  set(i, o) {
    if (o.hidden) { for (const p of this.parts) p.mesh.setMatrixAt(i, ZERO); return; }
    _q.setFromEuler(_e.set(o.tilt || 0, o.yaw, 0, 'YXZ'));
    _root.compose(_v.set(o.x, o.y, o.z), _q, _s.setScalar(o.scale));
    const s = o.s, sw = o.swing;
    for (const p of this.parts) {
      let a = 0;
      switch (p.anim) {
        case 'legL': a = s; break; case 'legR': a = -s; break;
        case 'armL': a = -s * .6; break;
        case 'armR': a = -.35 + s * .4 - Math.sin(sw * Math.PI) * 1.5; break;
        case 'hA': a = s * 1.1; break; case 'hB': a = -s * 1.1; break;
      }
      if (p.anim) { _pm.makeTranslation(p.pivot[0], p.pivot[1], p.pivot[2]).multiply(_rx.makeRotationX(a)); _pm.premultiply(_root); p.mesh.setMatrixAt(i, _pm); }
      else p.mesh.setMatrixAt(i, _root);
    }
  }
  flush() { for (const p of this.parts) p.mesh.instanceMatrix.needsUpdate = true; }
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
    b.add(prism(4.4, 1.6, 3.8), C.tile, 0, 3.1, 0);
    box(b, C.stone, 1.2, 2.6, -.8, 1.5, 5.2, 1.5); b.add(P.cone(1.25, 1.6, 4), C.tile, 1.2, 6.0, -.8, 0, Math.PI / 4, 0);
    for (let i = 0; i < 4; i++) box(b, C.stone, 1.2 + (i % 2 ? .6 : -.6), 5.25, -.8 + (i < 2 ? .6 : -.6), .3, .3, .3);
    box(b, C.dwood, 0, .95, 1.72, .9, 1.3, .08); box(b, C.stone, 0, 1.65, 1.72, 1.1, .2, .12);
    for (const x of [-1.4, 1.4]) box(b, 0x2a2018, x, 2.4, 1.62, .35, .45, .05);
    box(b, tc, -1.0, 1.1, 1.72, .5, 1.0, .03); box(b, tc, 1.0, 1.1, 1.72, .5, 1.0, .03);
    flag(b, tc, 1.2, 6.5, -.8, 1.6); flag(b, tc, -2.2, .4, 2.2, 2.6);
    box(b, C.wood, -1.8, .7, 2.3, .5, .6, .5); b.add(P.cyl(.25, .3, .6, 8), C.wood, 1.9, .7, 2.2);
  } else if (kind === 'house') {
    base(1.9, .3);
    timberWalls(b, 1.6, 1.1, 1.4, .3); b.add(prism(1.9, .9, 1.8), C.thatch, 0, 1.4, 0);
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
    b.add(prism(2.7, .9, 2.6), C.thatch, 0, 1.9, 0);
    box(b, C.wood, -.6, .5, .2, .55, .55, .55); box(b, C.wood, .1, .45, .5, .45, .45, .45);
    b.add(P.cyl(.25, .27, .65, 8), C.wood, .7, .55, -.1); b.add(P.cyl(.25, .27, .65, 8), C.wood, .7, .55, .55);
    b.add(P.cyl(.18, .18, .9, 8), C.hay, -.6, .45, -.5, 0, 0, Math.PI / 2);
    flag(b, tc, -1.25, .25, 1.2, 2);
  } else if (kind === 'barracks') {
    base(3.9, .35);
    box(b, C.stone, 0, 1.15, -.2, 3.6, 1.6, 2.6);
    box(b, C.dstone, 0, .65, -.2, 3.7, .5, 2.7);
    b.add(prism(3.9, 1.1, 3.0), C.tile, 0, 1.95, -.2);
    box(b, C.dwood, 0, .9, 1.12, .8, 1.1, .06);
    box(b, tc, -1.1, 1.3, 1.13, .55, .9, .03); box(b, tc, 1.1, 1.3, 1.13, .55, .9, .03);
    box(b, C.wood, -1.3, .8, 1.7, 1.0, .08, .08); for (let i = 0; i < 4; i++) box(b, C.steel, -1.7 + i * .25, .9, 1.68, .03, .9, .03, .2);
    b.add(P.cyl(.06, .06, 1.1, 5), C.wood, 1.4, .55, 1.6); b.add(P.cyl(.18, .15, .5, 8), C.straw, 1.4, 1.1, 1.6);
    flag(b, tc, 1.6, .35, -1.6, 2.8);
  } else if (kind === 'stable') {
    base(3.9, .3);
    box(b, C.wood, 0, 1.0, -.3, 3.6, 1.5, 2.4);
    for (let i = -3; i <= 3; i++) box(b, C.dwood, i * .55, 1.0, .91, .06, 1.5, .03);
    b.add(prism(3.9, 1.0, 2.9), C.thatch, 0, 1.75, -.3);
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
  const m = new THREE.Mesh(buildingGeo(kind, team), vcMatFlat); m.castShadow = shadows; m.receiveShadow = true; return m;
}

// ---------------- arrows ----------------
export const arrowGeo = new Builder().add(P.box, 0x8a6a3a, 0, 0, 0, 0, 0, 0, .025, .025, .7).add(P.cone(.04, .12, 4), C.steel, 0, 0, .4, Math.PI / 2, 0, 0).add(P.box, 0xeeeeee, 0, 0, -.3, 0, 0, 0, .1, .01, .12).build();
export const ringGeo = new THREE.RingGeometry(.45, .56, 28).rotateX(-Math.PI / 2);
