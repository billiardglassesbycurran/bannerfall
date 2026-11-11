// Core simulation: units, buildings, economy, combat, projectiles, win/lose.
import * as THREE from 'three';
import { UD, BD, DIFF } from './data.js';
import { N, SIZE, heightAt, blocked, resCell, cellWalk, resources, takeRes, BASES } from './world.js';
import { findPath, nearestWalkable } from './path.js';
import { buildingMesh, arrowGeo, ringGeo } from './models.js';
import { vcMat } from './geo.js';
import { angDiff, clamp, dist } from './util.js';

const CARRY = 10, RATE = { f: .9, w: .75, g: .65 };
const ringMats = [0x8dff7a, 0xff6a5a].map(c => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: .9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
export const bldAt = new Array(N * N).fill(null);

let nextId = 1;
export class Game {
  constructor({ scene, figures, Q, mode, diff }) {
    Object.assign(this, { scene, figures, Q, mode, diff }); this.diffD = DIFF[diff] || DIFF[1];
    this.units = []; this.blds = []; this.shots = [];
    this.T = [0, 1].map(() => ({ f: 200, w: 200, g: 100, pop: 0, cap: 0, hallLost: false }));
    this.time = 0; this.over = null; this.hero = null; this.heroRespawn = 0;
    this.toast = () => {}; this.onEnd = () => {};
    this.hash = new Map();
  }

  // ---------------- spawning ----------------
  spawnUnit(team, type, x, z) {
    const p = nearestWalkable(x, z, 10) || { x, z };
    const d = UD[type], batch = this.figures.get(team, type);
    const u = {
      id: nextId++, kind: 'unit', type, team, d, x: p.x, z: p.z, y: heightAt(p.x, p.z), yaw: team === 0 ? Math.PI * .75 : -Math.PI * .25,
      hp: d.hp, maxHp: d.hp, task: { type: 'idle' }, path: null, carry: null, cd: 0, swingT: 1, phase: Math.random() * 6, speedNow: 0,
      batch, slot: batch.alloc(), alive: true, dead: false, deathT: 0, selected: false, possessed: false, scale: d.scale || 1, think: Math.random() * .5,
    };
    this.units.push(u); return u;
  }
  canPlace(type, cx, cz) {
    const s = BD[type].size; let lo = 1e9, hi = -1e9;
    for (let z = cz; z < cz + s; z++) for (let x = cx; x < cx + s; x++) {
      if (x < 4 || z < 4 || x >= N - 4 || z >= N - 4 || blocked[z * N + x] !== 0) return false;
      const h = heightAt(x + .5, z + .5); lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
    if (hi - lo > 1.3) return false;
    for (const u of this.units) if (u.alive && !BD[type].walk && u.x > cx - .3 && u.x < cx + s + .3 && u.z > cz - .3 && u.z < cz + s + .3 && u.team !== 0) return false;
    return true;
  }
  placeBuilding(team, type, cx, cz, built = false) {
    const d = BD[type], s = d.size, x = cx + s / 2, z = cz + s / 2;
    let y = 1e9; for (let k = 0; k <= s; k++) y = Math.min(y, heightAt(cx + k, cz), heightAt(cx + k, cz + s), heightAt(cx, cz + k), heightAt(cx + s, cz + k));
    const mesh = buildingMesh(type, team, this.Q.shadow > 0); mesh.position.set(x, y + .05, z);
    mesh.rotation.y = team === 0 ? 0 : Math.PI; this.scene.add(mesh);
    const b = { id: nextId++, kind: 'bld', type, team, d, x, z, y, cx, cz, size: s, hp: built ? d.hp : 1, maxHp: d.hp, built, progress: built ? 1 : 0, queue: [], rally: null, mesh, alive: true, atkCd: 1, food: d.food || 0, farmer: null, selected: false };
    for (let zz = cz; zz < cz + s; zz++) for (let xx = cx; xx < cx + s; xx++) { blocked[zz * N + xx] = d.walk ? 7 : 4; bldAt[zz * N + xx] = b; }
    // push units out of the footprint
    if (!d.walk) for (const u of this.units) if (u.alive && bldAt[(u.z | 0) * N + (u.x | 0)] === b) { const p = nearestWalkable(u.x, u.z, 6); if (p) { u.x = p.x; u.z = p.z; u.path = null; } }
    this.setBuildVisual(b);
    this.blds.push(b); this.recount(); return b;
  }
  setBuildVisual(b) { b.mesh.scale.set(1, b.built ? 1 : .12 + .88 * b.progress, 1); }

  // ---------------- queries ----------------
  enemiesOf(t) { return t === 0 ? 1 : 0; }
  rebuildHash() {
    this.hash.clear();
    for (const u of this.units) if (u.alive) { const k = ((u.x / 8) | 0) + ((u.z / 8) | 0) * 32; let l = this.hash.get(k); if (!l) this.hash.set(k, l = []); l.push(u); }
  }
  unitsNear(x, z, r, fn) {
    const x0 = Math.max(0, ((x - r) / 8) | 0), x1 = Math.min(15, ((x + r) / 8) | 0), z0 = Math.max(0, ((z - r) / 8) | 0), z1 = Math.min(15, ((z + r) / 8) | 0);
    for (let gz = z0; gz <= z1; gz++) for (let gx = x0; gx <= x1; gx++) { const l = this.hash.get(gx + gz * 32); if (l) for (const u of l) fn(u); }
  }
  nearestEnemy(src, r, inclBld = true) {
    let best = null, bd = r;
    this.unitsNear(src.x, src.z, r, u => { if (u.team !== src.team && u.alive) { const d = dist(u, src); if (d < bd) { bd = d; best = u; } } });
    if (!best && inclBld) for (const b of this.blds) if (b.alive && b.team !== src.team) { const d = this.edgeDist(src, b); if (d < bd) { bd = d; best = b; } }
    return best;
  }
  edgeDist(p, b) { const h = b.size / 2, dx = Math.max(Math.abs(p.x - b.x) - h, 0), dz = Math.max(Math.abs(p.z - b.z) - h, 0); return Math.hypot(dx, dz); }
  reachDist(u, t) { return t.kind === 'bld' ? this.edgeDist(u, t) : dist(u, t) - t.d.rad - u.d.rad * .5; }
  nearestDrop(u) { let best = null, bd = 1e9; for (const b of this.blds) if (b.alive && b.built && b.team === u.team && b.d.drop) { const d = this.edgeDist(u, b); if (d < bd) { bd = d; best = b; } } return best; }
  nearestRes(x, z, rt, r = 18) { let best = null, bd = r; for (const s of resources) if (s.alive && s.rt === rt) { const d = Math.hypot(s.x - x, s.z - z); if (d < bd) { bd = d; best = s; } } return best; }
  recount() {
    for (const t of this.T) { t.pop = 0; t.cap = 0; }
    for (const u of this.units) if (u.alive) this.T[u.team].pop++;
    for (const b of this.blds) if (b.alive && b.built && b.d.pop) this.T[b.team].cap += b.d.pop;
    for (const t of this.T) t.cap = Math.min(t.cap, 100);
  }
  afford(team, cost) { const t = this.T[team]; return (t.f >= (cost.f || 0)) && (t.w >= (cost.w || 0)) && (t.g >= (cost.g || 0)); }
  pay(team, cost, sign = 1) { const t = this.T[team]; t.f -= sign * (cost.f || 0); t.w -= sign * (cost.w || 0); t.g -= sign * (cost.g || 0); }
  has(team, type) { return this.blds.some(b => b.alive && b.built && b.team === team && b.type === type); }

  // ---------------- orders ----------------
  setTask(u, task) { u.task = task; u.path = null; u.repath = 0; }
  moveTo(u, x, z) { this.setTask(u, { type: 'move', x, z }); }
  attack(u, t, resume) { this.setTask(u, { type: 'attack', t, resume }); }
  amove(u, x, z) { this.setTask(u, { type: 'amove', x, z }); }
  gather(u, res) { if (u.type !== 'peasant') return this.moveTo(u, res.x, res.z); this.setTask(u, { type: 'gather', res }); }
  build(u, b) { if (u.type !== 'peasant') return; this.setTask(u, { type: 'build', b }); }
  farm(u, b) { if (b.farmer && b.farmer !== u && b.farmer.alive && b.farmer.task.b === b) return false; b.farmer = u; this.setTask(u, { type: 'farm', b }); return true; }
  /** Right-click / tap command for a group. tgt is a unit, building, resource or null (ground). */
  command(sel, tgt, x, z) {
    sel = sel.filter(u => u.alive && !u.possessed); if (!sel.length) return;
    if (tgt && tgt.team !== undefined && tgt.team !== sel[0].team) { for (const u of sel) this.attack(u, tgt); return 'attack'; }
    if (tgt && tgt.kind === 'res') { const peas = sel.filter(u => u.type === 'peasant'); for (const u of peas) this.gather(u, tgt); this.formation(sel.filter(u => u.type !== 'peasant'), x, z); return 'gather'; }
    if (tgt && tgt.kind === 'bld' && tgt.team === sel[0].team) {
      const peas = sel.filter(u => u.type === 'peasant'), rest = sel.filter(u => u.type !== 'peasant');
      for (const u of peas) {
        if (!tgt.built) this.build(u, tgt);
        else if (tgt.type === 'farm') { if (!this.farm(u, tgt)) this.moveTo(u, x, z); }
        else if (tgt.d.drop && u.carry) this.setTask(u, { type: 'return', drop: tgt });
        else this.moveTo(u, x, z);
      }
      this.formation(rest, x, z); return peas.length ? 'build' : 'move';
    }
    this.formation(sel, x, z); return 'move';
  }
  formation(sel, x, z) {
    if (!sel.length) return;
    const cx = sel.reduce((s, u) => s + u.x, 0) / sel.length, cz = sel.reduce((s, u) => s + u.z, 0) / sel.length;
    const a = Math.atan2(x - cx, z - cz), fx = Math.sin(a), fz = Math.cos(a), rx = -fz, rz = fx;
    const cols = Math.ceil(Math.sqrt(sel.length * 1.6)), sp = 1.15;
    sel.sort((p, q) => ((p.x - cx) * rx + (p.z - cz) * rz) - ((q.x - cx) * rx + (q.z - cz) * rz));
    // melee in front, ranged behind
    const ordered = [...sel.filter(u => !u.d.ranged), ...sel.filter(u => u.d.ranged)];
    ordered.forEach((u, i) => {
      const c = i % cols - (cols - 1) / 2, r = Math.floor(i / cols);
      let tx = x + rx * c * sp - fx * r * sp, tz = z + rz * c * sp - fz * r * sp;
      if (!cellWalk(tx | 0, tz | 0)) { const p = nearestWalkable(tx, tz, 4) || { x, z }; tx = p.x; tz = p.z; }
      this.moveTo(u, tx, tz);
    });
  }
  train(b, type) {
    const d = UD[type]; if (!b.built || !b.d.trains?.includes(type)) return 'no';
    if (b.queue.length >= 5) return 'full';
    if (!this.afford(b.team, d.cost)) return 'cost';
    this.pay(b.team, d.cost); b.queue.push({ type, t: 0 }); return 'ok';
  }
  cancelTrain(b, i) { const q = b.queue.splice(i, 1)[0]; if (q) this.pay(b.team, UD[q.type].cost, -1); }
  startBuilding(team, type, cx, cz, builders) {
    const d = BD[type]; if (!this.afford(team, d.cost) || !this.canPlace(type, cx, cz)) return null;
    if (d.req && !this.has(team, d.req)) return null;
    this.pay(team, d.cost); const b = this.placeBuilding(team, type, cx, cz, false);
    for (const u of builders) if (u.type === 'peasant') this.build(u, b);
    return b;
  }

  // ---------------- damage ----------------
  damage(t, dmg, src) {
    if (!t.alive) return;
    let m = 1; if (src?.d?.vsHorse && t.d.horse) m = 3; if (t.kind === 'bld' && src?.d?.ranged) m = .3;
    const amt = Math.max(1, dmg * m - (t.d.arm || 0));
    t.hp -= amt; t.hitT = this.time;
    if (t.kind === 'unit' && src && src.alive && !t.possessed) {
      const busy = t.task.type === 'attack' && t.task.t.alive && t.task.t.kind === 'unit';
      if (t.d.acq && !busy && t.task.type !== 'move') this.attack(t, src, t.task.type === 'attack' ? null : t.task);
      if (t.type === 'peasant' && src.kind === 'unit' && t.team === 0 && this.time - (this.lastWarn || 0) > 10) { this.lastWarn = this.time; this.toast('Your peasants are under attack!'); }
    }
    if (t.kind === 'bld' && t.team === 0 && this.time - (this.lastBWarn || 0) > 12) { this.lastBWarn = this.time; this.toast(`Your ${t.d.name} is under attack!`); }
    if (t.hp <= 0) this.kill(t);
  }
  kill(t) {
    t.alive = false; t.hp = 0;
    if (t.kind === 'unit') {
      t.dead = true; t.deathT = 0; t.selected = false; if (t.ring) { t.ring.removeFromParent(); t.ring = null; }
      if (t === this.hero) { this.heroRespawn = this.mode === 'battle' ? 0 : 30; this.toast(this.heroRespawn ? 'Your Commander has fallen! He returns in 30s.' : 'Your Commander has fallen!'); }
      this.onUnitDeath?.(t);
    } else {
      t.mesh.removeFromParent(); t.selected = false; if (t.ring) { t.ring.removeFromParent(); t.ring = null; }
      for (let z = t.cz; z < t.cz + t.size; z++) for (let x = t.cx; x < t.cx + t.size; x++) { blocked[z * N + x] = 0; bldAt[z * N + x] = null; }
      this.rubble(t);
      if (t.type === 'hall') { this.T[t.team].hallLost = true; this.toast(t.team === 0 ? 'Your Town Hall has fallen!' : 'The enemy Town Hall burns!'); }
    }
    this.recount(); this.checkEnd();
  }
  rubble(b) {
    const g = new THREE.Group();
    for (let i = 0; i < 8; i++) { const m = new THREE.Mesh(new THREE.DodecahedronGeometry(.2 + Math.random() * .3, 0), new THREE.MeshLambertMaterial({ color: 0x4a4540 })); m.position.set(b.x + (Math.random() - .5) * b.size, b.y + .1, b.z + (Math.random() - .5) * b.size); g.add(m); }
    this.scene.add(g); setTimeout(() => g.removeFromParent(), 30000);
  }
  checkEnd() {
    if (this.over) return;
    const alive = t => this.units.some(u => u.alive && u.team === t);
    let res = null;
    if (this.mode === 'battle') { if (!alive(1)) res = 'win'; else if (!alive(0)) res = 'lose'; }
    else {
      if (this.T[0].hallLost) res = 'lose';
      else if (this.mode === 'skirmish' && this.T[1].hallLost) res = 'win';
      else if (this.mode === 'survival' && this.wavesDone && !alive(1)) res = 'win';
    }
    if (res) { this.over = res; this.onEnd(res); }
  }

  // ---------------- projectiles ----------------
  shoot(src, t, dmg, from) {
    const mesh = new THREE.Mesh(arrowGeo, vcMat); this.scene.add(mesh);
    const f = from || new THREE.Vector3(src.x, src.y + 1.5 * (src.scale || 1), src.z);
    const d = Math.hypot(t.x - f.x, t.z - f.z);
    this.shots.push({ mesh, f, t, tx: t.x, tz: t.z, ty: (t.kind === 'bld' ? t.y + 1.5 : t.y + 1.0), k: 0, dur: Math.max(.25, d / 22), dmg, src, arc: d * .12 });
  }
  updateShots(dt) {
    const p = new THREE.Vector3(), q = new THREE.Vector3();
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i]; s.k += dt / s.dur;
      if (s.t.alive) { s.tx = s.t.x; s.tz = s.t.z; s.ty = s.t.kind === 'bld' ? s.t.y + 1.5 : s.t.y + 1.0; }
      const k = Math.min(1, s.k), arc = Math.sin(k * Math.PI) * s.arc;
      p.set(s.f.x + (s.tx - s.f.x) * k, s.f.y + (s.ty - s.f.y) * k + arc, s.f.z + (s.tz - s.f.z) * k);
      const k2 = Math.min(1, k + .02); q.set(s.f.x + (s.tx - s.f.x) * k2, s.f.y + (s.ty - s.f.y) * k2 + Math.sin(k2 * Math.PI) * s.arc, s.f.z + (s.tz - s.f.z) * k2);
      s.mesh.position.copy(p); s.mesh.lookAt(q);
      if (s.k >= 1) { if (s.t.alive) this.damage(s.t, s.dmg, s.src); s.mesh.removeFromParent(); this.shots.splice(i, 1); }
    }
  }

  // ---------------- movement ----------------
  goTo(u, x, z, reach, dt) {
    // returns true when arrived
    if (!u.path || u.repath <= 0 || (u.goal && Math.hypot(u.goal.x - x, u.goal.z - z) > 1.5)) {
      u.path = findPath(u.x, u.z, x, z, reach); u.pi = 0; u.repath = 3 + Math.random(); u.goal = { x, z };
      if (!u.path.length) { u.path = null; return true; }
    }
    u.repath -= dt;
    const wp = u.path[u.pi]; if (!wp) { u.path = null; return true; }
    const dx = wp.x - u.x, dz = wp.z - u.z, d = Math.hypot(dx, dz), sp = u.d.spd * dt;
    if (d <= sp + .05) { u.x = wp.x; u.z = wp.z; u.pi++; if (u.pi >= u.path.length) { u.path = null; return true; } }
    else this.step(u, dx / d * sp, dz / d * sp);
    u.speedNow = u.d.spd; this.face(u, Math.atan2(dx, dz), dt);
    return false;
  }
  step(u, dx, dz) {
    const nx = u.x + dx, nz = u.z + dz, ok = (x, z) => cellWalk(x | 0, z | 0);
    if (ok(nx, nz)) { u.x = nx; u.z = nz; return true; }
    if (ok(nx, u.z)) { u.x = nx; return true; }
    if (ok(u.x, nz)) { u.z = nz; return true; }
    u.repath = Math.min(u.repath || 0, .2); return false;
  }
  face(u, a, dt) { u.yaw += angDiff(u.yaw, a) * Math.min(1, dt * 10); }

  // ---------------- per-unit AI ----------------
  updateUnit(u, dt) {
    u.cd -= dt; u.swingT += dt; u.speedNow = 0; u.think -= dt;
    if (u.possessed) return;
    const t = u.task;
    switch (t.type) {
      case 'idle':
        if (u.d.acq && u.think <= 0) { u.think = .4; const e = this.nearestEnemy(u, u.d.acq); if (e) this.setTask(u, { type: 'attack', t: e, auto: true }); }
        break;
      case 'move': if (this.goTo(u, t.x, t.z, 0, dt)) this.setTask(u, { type: 'idle' }); break;
      case 'amove': case 'follow': {
        if (u.d.acq && u.think <= 0) { u.think = .4; const e = this.nearestEnemy(u, u.d.acq, t.type === 'amove'); if (e) { this.attack(u, e, t); break; } }
        if (t.type === 'follow') {
          const L = t.leader; if (!L.alive) { this.setTask(u, { type: 'idle' }); break; }
          const ox = Math.sin(L.yaw + Math.PI + t.off.a) * t.off.d, oz = Math.cos(L.yaw + Math.PI + t.off.a) * t.off.d;
          const tx = L.x + ox, tz = L.z + oz;
          if (Math.hypot(tx - u.x, tz - u.z) > 1.2) { u.repath = Math.min(u.repath || 0, .5); this.goTo(u, tx, tz, .6, dt); } else u.path = null;
        } else if (this.goTo(u, t.x, t.z, 1.5, dt)) this.setTask(u, { type: 'idle' });
        break;
      }
      case 'attack': {
        const e = t.t;
        if (!e.alive) { if (t.resume) this.setTask(u, t.resume); else this.setTask(u, { type: 'idle' }); u.think = 0; break; }
        const rng = u.d.rng + (u.d.ranged && this.T[u.team].fletch ? 1 : 0);
        if (this.reachDist(u, e) <= rng) {
          u.path = null; this.face(u, Math.atan2(e.x - u.x, e.z - u.z), dt);
          if (u.cd <= 0) { u.cd = u.d.cd; u.swingT = 0; if (u.d.ranged) this.shoot(u, e, u.d.dmg); else this.damage(e, u.d.dmg, u); }
        } else {
          // chase; ranged units give up chasing far targets when idle-acquired
          if (e.kind === 'unit' && !t.resume && dist(u, e) > (u.d.acq || 8) * 2.2 && t.auto) { this.setTask(u, { type: 'idle' }); break; }
          const reach = e.kind === 'bld' ? e.size / 2 + rng * .8 : Math.max(rng * .8, .9);
          u.repath = Math.min(u.repath || 0, e.kind === 'unit' ? .8 : 99);
          this.goTo(u, e.x, e.z, reach, dt);
        }
        break;
      }
      case 'gather': {
        let r = t.res;
        if (!r.alive) { r = this.nearestRes(r.x, r.z, r.rt, 15); if (!r) { if (u.carry) this.setTask(u, { type: 'return' }); else this.setTask(u, { type: 'idle' }); break; } t.res = r; u.path = null; }
        if (u.carry && (u.carry.rt !== r.rt || u.carry.amt >= CARRY)) { this.setTask(u, { type: 'return', back: t }); break; }
        if (Math.hypot(u.x - r.x, u.z - r.z) <= r.r + .95) {
          u.path = null; this.face(u, Math.atan2(r.x - u.x, r.z - u.z), dt);
          const got = takeRes(r, RATE[r.rt] * dt * this.gatherMul(u.team));
          u.carry = u.carry || { rt: r.rt, amt: 0 }; u.carry.amt += got; u.work = true;
          if (u.swingT > .7) u.swingT = 0;
        } else this.goTo(u, r.x, r.z, r.r + .8, dt);
        break;
      }
      case 'farm': {
        const b = t.b; if (!b.alive) { this.setTask(u, { type: 'idle' }); break; }
        if (u.carry && (u.carry.rt !== 'f' || u.carry.amt >= CARRY)) { this.setTask(u, { type: 'return', back: t }); break; }
        if (Math.hypot(u.x - b.x, u.z - b.z) < 1.3) {
          const got = Math.min(b.food, RATE.f * .85 * dt * this.gatherMul(u.team)); b.food -= got;
          u.carry = u.carry || { rt: 'f', amt: 0 }; u.carry.amt += got; if (u.swingT > .9) u.swingT = 0;
          if (b.food <= 0) { this.kill(b); if (u.team === 0) this.toast('A farm is exhausted. Build a new one.'); }
        } else this.goTo(u, b.x + .3, b.z + .3, .4, dt);
        break;
      }
      case 'return': {
        const drop = (t.drop && t.drop.alive) ? t.drop : this.nearestDrop(u);
        if (!drop || !u.carry) { this.setTask(u, t.back || { type: 'idle' }); break; }
        t.drop = drop;
        if (this.edgeDist(u, drop) <= 1.0) {
          this.T[u.team][u.carry.rt] += Math.floor(u.carry.amt + .001); u.carry = null;
          this.setTask(u, t.back || { type: 'idle' });
        } else this.goTo(u, drop.x, drop.z, drop.size / 2 + .7, dt);
        break;
      }
      case 'build': {
        const b = t.b; if (!b.alive) { this.setTask(u, { type: 'idle' }); break; }
        if (b.built) {
          if (b.type === 'farm' && this.farm(u, b)) break;
          const next = this.blds.find(o => o.alive && !o.built && o.team === u.team && dist(o, u) < 16);
          if (next) this.build(u, next);
          else if (b.d.drop) { const r = this.nearestRes(u.x, u.z, 'w', 12) || this.nearestRes(u.x, u.z, 'f', 12); if (r) this.gather(u, r); else this.setTask(u, { type: 'idle' }); }
          else this.setTask(u, { type: 'idle' });
          break;
        }
        if (this.edgeDist(u, b) <= 1.0) {
          u.path = null; this.face(u, Math.atan2(b.x - u.x, b.z - u.z), dt); if (u.swingT > .6) u.swingT = 0;
          const add = dt / b.d.time; b.progress = Math.min(1, b.progress + add); b.hp = Math.min(b.maxHp, b.hp + add * b.maxHp);
          if (b.progress >= 1) { b.built = true; this.recount(); if (b.team === 0) this.toast(`${b.d.name} complete.`); }
          this.setBuildVisual(b);
        } else this.goTo(u, b.x, b.z, b.size / 2 + .6, dt);
        break;
      }
    }
  }
  gatherMul(team) { return team === 1 && this.mode === 'skirmish' ? this.diffD.gather : 1; }

  updateBuilding(b, dt) {
    if (!b.built) return;
    if (b.d.atk && (b.atkCd -= dt) <= 0) {
      b.atkCd = .5; const e = this.nearestEnemy({ x: b.x, z: b.z, team: b.team }, b.d.atk.rng + b.size / 2, false);
      if (e) { b.atkCd = b.d.atk.cd; this.shoot(b, e, b.d.atk.dmg, new THREE.Vector3(b.x, b.y + (b.type === 'tower' ? 4.6 : 3), b.z)); }
    }
    const q = b.queue[0];
    if (q) {
      if (q.t < 1) q.t += dt / UD[q.type].time;
      if (q.t >= 1) {
        const T = this.T[b.team];
        if (T.pop >= T.cap) { if (b.team === 0 && this.time - (this.lastPopWarn || 0) > 8) { this.lastPopWarn = this.time; this.toast('Population limit reached — build more Houses.'); } }
        else {
          b.queue.shift();
          const side = b.team === 0 ? 1 : -1;
          const u = this.spawnUnit(b.team, q.type, b.x + side * (b.size / 2 + .8), b.z + side * (b.size / 2 + .8));
          this.recount();
          if (b.rally) {
            if (b.rally.res && u.type === 'peasant' && b.rally.res.alive) this.gather(u, b.rally.res);
            else this.moveTo(u, b.rally.x, b.rally.z);
          } else if (u.type === 'peasant' && b.team === 0) { const r = this.nearestRes(u.x, u.z, 'f', 14) || this.nearestRes(u.x, u.z, 'w', 20); if (r) this.gather(u, r); }
          this.onTrained?.(u, b);
        }
      }
    }
  }

  update(dt) {
    if (this.over && this.over !== 'continue') { /* keep animating */ }
    this.time += dt;
    this.rebuildHash();
    for (const u of this.units) if (u.alive) this.updateUnit(u, dt);
    // separation
    for (const u of this.units) {
      if (!u.alive) continue;
      this.unitsNear(u.x, u.z, 1.5, o => {
        if (o.id <= u.id || !o.alive) return;
        const dx = o.x - u.x, dz = o.z - u.z, d2 = dx * dx + dz * dz, r = (u.d.rad + o.d.rad) * .95;
        if (d2 < r * r && d2 > 1e-6) {
          const d = Math.sqrt(d2), push = (r - d) * .5, ux = dx / d * push, uz = dz / d * push;
          if (!u.possessed) this.step(u, -ux, -uz); if (!o.possessed) this.step(o, ux, uz);
        } else if (d2 <= 1e-6) { o.x += .05; }
      });
    }
    for (const b of this.blds) if (b.alive) this.updateBuilding(b, dt);
    this.updateShots(dt);
    if (this.hero && !this.hero.alive && this.heroRespawn > 0 && !this.over) {
      this.heroRespawn -= dt;
      if (this.heroRespawn <= 0) { const hall = this.blds.find(b => b.alive && b.team === 0 && b.type === 'hall'); if (hall) { this.hero = this.spawnUnit(0, 'hero', hall.x + 3.5, hall.z + 3.5); this.recount(); this.toast('Your Commander has returned.'); this.onHero?.(this.hero); } }
    }
    // dead unit cleanup
    for (let i = this.units.length - 1; i >= 0; i--) { const u = this.units[i]; if (u.dead && (u.deathT += dt) > 3) { u.batch.release(u.slot); this.units.splice(i, 1); } }
    this.blds = this.blds.filter(b => b.alive);
  }

  /** Write every unit's pose into the instanced meshes. */
  syncVisuals(dt, hideId) {
    for (const u of this.units) {
      u.y = heightAt(u.x, u.z);
      const k = Math.min(1, u.speedNow / 3); u.phase += dt * (4 + u.speedNow * 2.2);
      const sw = u.swingT < .35 ? u.swingT / .35 : 0;
      let tilt = 0, y = u.y; if (u.dead) { tilt = -Math.min(1, u.deathT * 2.5) * Math.PI / 2 * .95; y -= Math.max(0, u.deathT - 1.5) * .6; }
      u.batch.set(u.slot, { x: u.x, y, z: u.z, yaw: u.yaw, scale: u.scale, s: Math.sin(u.phase) * .7 * k, swing: sw, tilt, hidden: u.id === hideId });
      if (u.selected && u.alive && !u.possessed) {
        if (!u.ring) { u.ring = new THREE.Mesh(ringGeo, ringMats[u.team]); this.scene.add(u.ring); }
        u.ring.position.set(u.x, u.y + .06, u.z); u.ring.scale.setScalar(u.d.rad / .45 * 1.1);
      } else if (u.ring) { u.ring.removeFromParent(); u.ring = null; }
    }
    for (const b of this.blds) {
      if (b.selected) {
        if (!b.ring) { b.ring = new THREE.Mesh(ringGeo, ringMats[b.team]); this.scene.add(b.ring); b.ring.scale.setScalar(b.size * .95); b.ring.position.set(b.x, b.y + .12, b.z); }
      } else if (b.ring) { b.ring.removeFromParent(); b.ring = null; }
    }
    this.figures.flush();
  }
}
export { BASES, SIZE };
