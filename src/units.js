// Units: low-poly figures (styled after prototype/Bannerfall-prototype.html) and their movement.
import * as THREE from 'three';
import { heightAt, walkable } from './terrain.js';

export const TEAM_COLORS = [0x295cd1, 0xc7241c];
const C = {
  skin: 0xdba885, pants: 0x54422e, leather: 0x613f24, boot: 0x33210f, chain: 0x767a85, steel: 0x9aa1ad,
  wood: 0x75502b, gold: 0xebb842, green: 0x546638, blade: 0xd6dde8, white: 0xeeeae0,
};
export const KINDS = {
  hero:   { name: 'Commander', plural: 'Commanders', speed: 3.4, scale: 1.15 },
  sword:  { name: 'Swordsman', plural: 'Swordsmen', speed: 2.6, scale: 1 },
  spear:  { name: 'Spearman', plural: 'Spearmen', speed: 2.7, scale: 1 },
  archer: { name: 'Archer', plural: 'Archers', speed: 2.9, scale: 1 },
};

const mats = new Map();
function mat(hex) { let m = mats.get(hex); if (!m) { m = new THREE.MeshLambertMaterial({ color: hex }); mats.set(hex, m); } return m; }
function part(parent, geo, color, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat(color)); m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
  m.castShadow = true; parent.add(m); return m;
}
const G = {
  leg: new THREE.CylinderGeometry(.085, .07, .72, 7), boot: new THREE.BoxGeometry(.13, .1, .22),
  torso: new THREE.CylinderGeometry(.21, .19, .62, 10), head: new THREE.SphereGeometry(.14, 12, 10),
  arm: new THREE.CylinderGeometry(.06, .05, .6, 7), hand: new THREE.SphereGeometry(.055, 7, 6),
  cap: new THREE.SphereGeometry(.16, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
};

function buildFigure(team, kind) {
  const tc = TEAM_COLORS[team];
  const pal = {
    hero:   { legs: C.chain, torso: C.steel, sleeve: C.chain },
    sword:  { legs: C.chain, torso: C.chain, sleeve: C.chain },
    spear:  { legs: C.pants, torso: C.leather, sleeve: C.chain },
    archer: { legs: C.leather, torso: C.green, sleeve: C.green },
  }[kind];
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const rig = {};
  for (const s of [-1, 1]) {
    const g = new THREE.Group(); g.position.set(s * .11, .78, 0); body.add(g);
    part(g, G.leg, pal.legs, 0, -.36, 0); part(g, G.boot, C.boot, 0, -.71, .04);
    rig[s < 0 ? 'legL' : 'legR'] = g;
  }
  const torso = part(body, G.torso, pal.torso, 0, 1.06, 0); torso.scale.z = .75;
  part(body, new THREE.CylinderGeometry(.2, .2, .07, 10), C.leather, 0, .86, 0).scale.z = .78;
  if (kind !== 'archer') { // team tabard front and back
    const tab = new THREE.BoxGeometry(.3, .5, .02);
    part(body, tab, tc, 0, 1.02, .155); part(body, tab, tc, 0, 1.02, -.155);
  } else {
    part(body, new THREE.BoxGeometry(.08, .7, .34), tc, 0, 1.08, 0, 0, 0, .65); // sash
  }
  const head = new THREE.Group(); head.position.set(0, 1.52, 0); body.add(head);
  part(head, new THREE.CylinderGeometry(.065, .065, .12, 7), C.skin, 0, -.12, 0);
  part(head, G.head, C.skin, 0, .04, 0);
  if (kind === 'sword' || kind === 'hero') {
    part(head, G.cap, C.steel, 0, .06, 0);
    part(head, new THREE.BoxGeometry(.03, .12, .02), C.steel, 0, .03, .15); // nasal guard
    part(head, new THREE.BoxGeometry(.05, .12, .26), kind === 'hero' ? C.white : tc, 0, .26, -.03, .2, 0, 0); // plume
    if (kind === 'hero') part(head, new THREE.CylinderGeometry(.17, .17, .06, 12, 1, true), C.gold, 0, .1, 0);
  } else if (kind === 'spear') {
    part(head, new THREE.CylinderGeometry(.14, .26, .07, 12), C.steel, 0, .13, 0);
    part(head, G.cap, C.steel, 0, .1, 0).scale.set(.9, .7, .9);
  } else {
    part(head, new THREE.ConeGeometry(.18, .38, 10), tc, 0, .18, -.01);
  }
  for (const s of [-1, 1]) {
    const g = new THREE.Group(); g.position.set(s * .27, 1.34, 0); body.add(g);
    part(g, G.arm, pal.sleeve, 0, -.3, 0); part(g, G.hand, C.skin, 0, -.62, 0);
    rig[s < 0 ? 'armL' : 'armR'] = g;
  }
  const R = rig.armR, L = rig.armL;
  if (kind === 'sword' || kind === 'hero') {
    part(R, new THREE.BoxGeometry(.05, .02, .78), C.blade, 0, -.62, .45);
    part(R, new THREE.BoxGeometry(.26, .04, .05), C.gold, 0, -.62, .06);
    part(L, new THREE.BoxGeometry(.04, .56, .4), tc, -.07, -.4, .1);
    part(L, new THREE.BoxGeometry(.03, .6, .44), C.steel, -.05, -.4, .1);
  } else if (kind === 'spear') {
    part(R, new THREE.CylinderGeometry(.025, .025, 2.5, 5), C.wood, 0, -.62, .35, Math.PI / 2, 0, 0);
    part(R, new THREE.ConeGeometry(.05, .3, 4), C.steel, 0, -.62, 1.74, Math.PI / 2, 0, 0);
    part(L, new THREE.CylinderGeometry(.26, .26, .04, 14), C.wood, -.08, -.42, .05, 0, 0, Math.PI / 2);
    part(L, new THREE.CylinderGeometry(.2, .2, .045, 14), tc, -.09, -.42, .05, 0, 0, Math.PI / 2);
  } else {
    part(L, new THREE.TorusGeometry(.5, .022, 4, 14, Math.PI), C.wood, 0, -.62, .1, 0, -Math.PI / 2, -Math.PI / 2);
    part(L, new THREE.BoxGeometry(.006, 1, .006), C.white, 0, -.62, .1);
    part(body, new THREE.CylinderGeometry(.07, .07, .55, 7), C.leather, .08, 1.1, -.19, .25, 0, -.3); // quiver
  }
  if (kind === 'hero') {
    const cape = part(body, new THREE.PlaneGeometry(.5, 1.0), tc, 0, .95, -.2, .12, 0, 0);
    cape.material = new THREE.MeshLambertMaterial({ color: new THREE.Color(tc).multiplyScalar(.7), side: THREE.DoubleSide });
  }
  R.rotation.x = -.35;
  const sc = KINDS[kind].scale; body.scale.setScalar(sc);
  rig.head = head;
  return { root, rig };
}

const ringGeo = new THREE.RingGeometry(.45, .56, 28); ringGeo.rotateX(-Math.PI / 2);
const ringMat = new THREE.MeshBasicMaterial({ color: 0x8dff7a, transparent: true, opacity: .9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });

let nextId = 1;
export class Unit {
  constructor(scene, team, kind, x, z) {
    this.id = nextId++; this.team = team; this.kind = kind; this.def = KINDS[kind];
    this.x = x; this.z = z; this.yaw = team === 0 ? Math.PI * .75 : -Math.PI * .25;
    this.target = null; this.possessed = false; this.selected = false;
    this.speedNow = 0; this.phase = Math.random() * 6;
    const { root, rig } = buildFigure(team, kind);
    this.mesh = root; this.rig = rig;
    this.ring = new THREE.Mesh(ringGeo, ringMat); this.ring.visible = false; this.ring.scale.setScalar(this.def.scale);
    root.add(this.ring);
    scene.add(root);
    this.sync();
  }
  get y() { return heightAt(this.x, this.z); }
  setSelected(v) { this.selected = v; this.ring.visible = v && !this.possessed; }

  /** Try to move by (dx,dz); slides along obstacles. Returns true if it moved. */
  step(dx, dz) {
    const nx = this.x + dx, nz = this.z + dz;
    if (walkable(nx, nz)) { this.x = nx; this.z = nz; return true; }
    if (walkable(nx, this.z)) { this.x = nx; return true; }
    if (walkable(this.x, nz)) { this.z = nz; return true; }
    return false;
  }

  update(dt) {
    let moving = 0;
    if (!this.possessed && this.target) {
      const dx = this.target.x - this.x, dz = this.target.z - this.z, d = Math.hypot(dx, dz);
      if (d < .15) this.target = null;
      else {
        const sp = Math.min(this.def.speed * dt, d);
        if (this.step(dx / d * sp, dz / d * sp)) {
          moving = 1;
          this.turnTo(Math.atan2(dx, dz), dt);
          this.stuck = 0;
        } else if ((this.stuck = (this.stuck || 0) + dt) > .6) this.target = null; // give up if blocked
      }
    }
    if (!this.possessed) this.speedNow = moving ? this.def.speed : 0;
    this.animate(dt);
    this.sync();
  }
  turnTo(a, dt) {
    let d = a - this.yaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += d * Math.min(1, dt * 10);
  }
  animate(dt) {
    const k = Math.min(1, this.speedNow / 3);
    this.phase += dt * (4 + this.speedNow * 2.2);
    const s = Math.sin(this.phase) * .7 * k;
    this.rig.legL.rotation.x = s; this.rig.legR.rotation.x = -s;
    this.rig.armL.rotation.x = -s * .6; this.rig.armR.rotation.x = -.35 + s * .4;
  }
  sync() { this.mesh.position.set(this.x, this.y, this.z); this.mesh.rotation.y = this.yaw; }
}

/** Push units apart so they don't stand inside each other. */
export function separate(units) {
  for (let i = 0; i < units.length; i++) for (let j = i + 1; j < units.length; j++) {
    const a = units[i], b = units[j], dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz;
    if (d2 < .49 && d2 > 1e-6) {
      const d = Math.sqrt(d2), push = (.7 - d) * .5, ux = dx / d * push, uz = dz / d * push;
      if (!a.possessed) a.step(-ux, -uz);
      if (!b.possessed) b.step(ux, uz);
    }
  }
}

export function buildBanner(team, x, z) {
  const g = new THREE.Group();
  part(g, new THREE.CylinderGeometry(.06, .08, 4.2, 6), C.wood, 0, 2.1, 0);
  part(g, new THREE.SphereGeometry(.12, 8, 6), C.gold, 0, 4.25, 0);
  const flag = new THREE.Group(); flag.position.set(0, 3.6, 0); g.add(flag);
  const cloth = part(flag, new THREE.BoxGeometry(1.4, .9, .03), TEAM_COLORS[team], .72, 0, 0);
  cloth.material = new THREE.MeshLambertMaterial({ color: TEAM_COLORS[team], side: THREE.DoubleSide });
  part(flag, new THREE.BoxGeometry(.3, .3, .04), C.gold, .72, 0, 0, 0, 0, Math.PI / 4);
  g.position.set(x, heightAt(x, z), z);
  g.userData.flag = flag;
  return g;
}
