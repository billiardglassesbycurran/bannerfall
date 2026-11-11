// Core simulation: units, buildings, economy, combat, projectiles, win/lose.
import * as THREE from 'three';
import { UD, BD, DIFF, CIVS, TECH, AGES } from './data.js';
import { N, SIZE, WL, heightAt, groundY, blocked, resCell, cellWalk, navCell, navBlock, water, resources, takeRes, BASES } from './world.js';
import { findPath, nearestWalkable } from './path.js';
import { buildingMesh, buildingGeo, arrowGeo, boltGeo, stoneGeo, ringGeo, wakeMaterial, SHIP_LEN, scaffoldGeo } from './models.js';
import { M } from './geo.js';
import { angDiff, clamp, dist } from './util.js';

const CARRY = 10, RATE = { f: .9, w: .75, g: .65 };
const ringMats = [0x8dff7a, 0xff6a5a].map(c => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: .9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
export const bldAt = new Array(N * N).fill(null);
const wakeGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

let nextId = 1;
export class Game {
  constructor({ scene, figures, Q, mode, diff, civs = ['franks', 'franks'] }) {
    this.civKeys = civs; this.civ = civs.map(k => CIVS[k]); this.statCache = new Map();
    Object.assign(this, { scene, figures, Q, mode, diff }); this.diffD = DIFF[diff] || DIFF[1];
    this.units = []; this.blds = []; this.shots = [];
    this.T = [0, 1].map(() => ({ f: 200, w: 200, g: 100, pop: 0, cap: 0, hallLost: false, age: mode === 'battle' ? 2 : 0, techs: new Set(), carry: 10, gm: { f: 1, w: 1, g: 1 }, fish: 1, farm: 1, bldHp: 1 }));
    this.time = 0; this.over = null; this.hero = null; this.heroRespawn = 0;
    this.toast = () => {}; this.onEnd = () => {};
    this.hash = new Map();
  }

  // ---------------- civilization-adjusted stats ----------------
  /** Unit stats for a team, with that team's civilization bonuses/penalties applied. */
  stat(team, type) {
    const key = team + type; let d = this.statCache.get(key); if (d) return d;
    const base = UD[type], civ = this.civ[team], m = civ.mods[base.cls] || {};
    d = { ...base, type };
    if (m.hp) d.hp = Math.round(base.hp * m.hp); if (m.dmg) d.dmg = base.dmg * m.dmg; if (m.spd) d.spd = base.spd * m.spd;
    if (m.arm) d.arm = base.arm + m.arm; if (m.rng && base.ranged) d.rng = base.rng + m.rng;
    // researched technologies
    for (const k of this.T[team].techs) {
      const e = TECH[k].eff || {}, c = e.cls?.[base.cls], un = e.unit?.[type];
      if (c) { if (c.hpAdd) d.hp += c.hpAdd; if (c.hpMul) d.hp = Math.round(d.hp * c.hpMul); if (c.arm) d.arm += c.arm; }
      if (un) { if (un.hp) d.hp = Math.round(d.hp * un.hp); if (un.dmg) d.dmg += un.dmg; }
      const melee = base.melee && base.cls !== 'civ', ranged = base.ranged && !base.stone;
      if (e.melee && melee) d.dmg += e.melee;
      if (e.ranged && ranged) d.dmg += e.ranged; if (e.rangedRng && ranged) d.rng += e.rangedRng;
      if (e.armor && (base.cls === 'inf' || base.cls === 'cav' || base.cls === 'hero')) d.arm += e.armor;
      if (e.elite && civ.unique?.type === type) { d.hp = Math.round(d.hp * 1.25); d.dmg *= 1.25; }
    }
    const cm = (m.cost || 1) * (civ.unitCost?.[type] || 1);
    if (base.cost && cm !== 1) d.cost = Object.fromEntries(Object.entries(base.cost).map(([k, v]) => [k, Math.round(v * cm)]));
    this.statCache.set(key, d); return d;
  }
  /** What a building can train for this team (its civilization's unique unit included). */
  trainsFor(b) { const list = [...(b.d.trains || [])], u = this.civ[b.team].unique; if (u && u.at === b.type) list.push(u.type); return list; }
  ageOK(team, def) { return (def.age || 0) <= this.T[team].age; }
  queuedTech(team, key) { return this.blds.some(b => b.alive && b.team === team && b.queue.some(q => q.tech === key)); }
  /** Technologies this building offers right now (age reached, prerequisite researched, not done or queued). */
  techsFor(b) {
    const T = this.T[b.team], uq = this.civ[b.team].unique?.at;
    return Object.keys(TECH).filter(k => { const t = TECH[k]; return (t.at === b.type || (t.at === 'unique' && uq === b.type)) && !T.techs.has(k) && (!t.req || T.techs.has(t.req)) && !this.queuedTech(b.team, k) && !(t.toAge && T.age >= t.toAge); });
  }
  research(b, key) {
    const t = TECH[key]; if (!b.built || !this.techsFor(b).includes(key)) return 'no';
    if ((t.age || 0) > this.T[b.team].age) return 'age';
    if (t.toAge && this.blds.some(o => o.alive && o.team === b.team && o.queue.some(q => TECH[q.tech]?.toAge))) return 'no';
    if (b.queue.length >= 5) return 'full'; if (!this.afford(b.team, t.cost)) return 'cost';
    this.pay(b.team, t.cost); b.queue.push({ tech: key, t: 0 }); return 'ok';
  }
  /** Apply a finished technology to the team (and to every existing unit/building). */
  applyTech(team, key) {
    const t = TECH[key], e = t.eff || {}, T = this.T[team]; T.techs.add(key);
    if (t.toAge) T.age = t.toAge;
    if (e.gatherAll) for (const r of ['f', 'w', 'g']) T.gm[r] *= e.gatherAll;
    if (e.gather) for (const [r, v] of Object.entries(e.gather)) T.gm[r] *= v;
    if (e.carry) T.carry += e.carry; if (e.fish) T.fish *= e.fish;
    if (e.farm) { T.farm *= e.farm; for (const b of this.blds) if (b.alive && b.team === team && b.type === 'farm') b.food *= e.farm; }
    const scaleB = (b, k) => { b.maxHp *= k; b.hp *= k; };
    if (e.bldHp) { T.bldHp *= e.bldHp; for (const b of this.blds) if (b.alive && b.team === team) scaleB(b, e.bldHp); }
    if (e.hallUp) for (const b of this.blds) if (b.alive && b.team === team && b.type === 'hall') scaleB(b, 1.5);
    if (e.towerUp) for (const b of this.blds) if (b.alive && b.team === team && b.type === 'tower') scaleB(b, 1.6);
    this.statCache.clear();
    for (const u of this.units) if (u.alive && u.team === team) { const nd = this.stat(team, u.type); u.hp = u.hp * nd.hp / u.maxHp; u.maxHp = nd.hp; u.d = nd; }
    if (t.toAge || e.hallUp || e.towerUp) this.refreshLooks(team);
    this.onTech?.(team, key);
  }
  look(team) { const T = this.T[team]; return { age: T.age, fort: T.techs.has('fortify'), guard: T.techs.has('guardtower') }; }
  /** Buildings change style with each age / upgrade. */
  refreshLooks(team) { for (const b of this.blds) if (b.alive && b.team === team && b.built && b.mesh.isMesh) { b.mesh.geometry = buildingGeo(b.type, team, this.look(team)); } }
  /** The Commander calls his horse (or gets down). Swaps the model, keeps his health share. */
  setMount(u, on) {
    const nt = on ? 'herohorse' : 'hero'; if (!u.alive || !u.d.hero || u.type === nt) return false;
    const f = u.hp / u.maxHp; u.batch.release(u.slot);
    u.type = nt; u.d = this.stat(u.team, nt); u.batch = this.figures.get(u.team, nt); u.slot = u.batch.alloc();
    u.maxHp = u.d.hp; u.hp = f * u.maxHp; u.scale = u.d.scale || 1; this.onMount?.(u, on); return true;
  }
  /** Send the nearest available peasants (idle first) to gather a resource. Returns how many went. */
  sendPeasants(team, res, n = 1) {
    const peas = this.units.filter(u => u.alive && u.team === team && u.type === 'peasant' && !u.boarded && !u.possessed && !(u.task.type === 'gather' && u.task.res === res) && u.task.type !== 'build' && u.task.type !== 'repair');
    peas.sort((a, b) => ((a.task.type === 'idle' ? 0 : 40) + dist(a, res)) - ((b.task.type === 'idle' ? 0 : 40) + dist(b, res)));
    const go = peas.slice(0, n); for (const u of go) this.gather(u, res); return go.length;
  }
  /** Town bell: peasants near a Town Hall hide inside it (more arrows); ring again for all clear. */
  ringBell(team) {
    const halls = this.blds.filter(b => b.alive && b.built && b.team === team && b.type === 'hall'); if (!halls.length) return 0;
    if (halls.some(h => h.cargo?.length)) { for (const h of halls) this.ungarrison(h); return -1; }
    let n = 0;
    for (const u of this.units) if (u.alive && u.team === team && u.type === 'peasant' && !u.boarded) {
      let h = halls[0], bd = 1e9; for (const o of halls) { const d = dist(o, u); if (d < bd) { bd = d; h = o; } }
      if (bd < 45) { u.bellTask = u.task; this.setTask(u, { type: 'garrison', b: h }); n++; }
    }
    return n;
  }
  ungarrison(b) {
    (b.cargo || []).forEach((u, i) => {
      const a = i / Math.max(1, b.cargo.length) * Math.PI * 2, p = nearestWalkable(b.x + Math.cos(a) * (b.size / 2 + 1), b.z + Math.sin(a) * (b.size / 2 + 1), 6) || { x: b.x, z: b.z + b.size };
      u.x = p.x; u.z = p.z; u.boarded = null;
      const bt = u.bellTask; u.bellTask = null;
      if (bt && bt.type === 'gather' && bt.res.alive) this.gather(u, bt.res); else if (bt && bt.type === 'build' && bt.b.alive && !bt.b.built) this.build(u, bt.b); else this.setTask(u, { type: 'idle' });
    });
    b.cargo = [];
  }

  // ---------------- spawning ----------------
  walkFor(u) { return u.d.ship ? navCell : cellWalk; }
  spawnUnit(team, type, x, z) {
    const p = nearestWalkable(x, z, UD[type].ship ? 14 : 10, UD[type].ship ? navCell : cellWalk) || { x, z };
    const d = this.stat(team, type), batch = this.figures.get(team, type);
    const u = {
      id: nextId++, kind: 'unit', type, team, d, x: p.x, z: p.z, y: heightAt(p.x, p.z), yaw: team === 0 ? Math.PI * .75 : -Math.PI * .25,
      hp: d.hp, maxHp: d.hp, task: { type: 'idle' }, path: null, carry: null, cd: 0, swingT: 1, phase: Math.random() * 6, speedNow: 0,
      batch, slot: batch.alloc(), alive: true, cargo: d.carry ? [] : null, boarded: null, dead: false, deathT: 0, selected: false, possessed: false, scale: d.scale || 1, think: Math.random() * .5,
    };
    this.units.push(u); return u;
  }
  canPlace(type, cx, cz) {
    const s = BD[type].size; let lo = 1e9, hi = -1e9;
    if (BD[type].dock) { // docks straddle the shoreline: some water cells, some land cells
      let w = 0, l = 0;
      for (let z = cz; z < cz + s; z++) for (let x = cx; x < cx + s; x++) {
        if (x < 4 || z < 4 || x >= N - 4 || z >= N - 4) return false;
        const i = z * N + x, v = blocked[i];
        if (water[i] && v === 1 && !navBlock[i]) w++; else if (v === 0) l++; else return false;
      }
      return w >= 3 && l >= 2;
    }
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
    if (d.dock) y = WL + .02;
    const mesh = buildingMesh(type, team, this.Q.shadow > 0, this.look(team)); mesh.position.set(x, y + .05, z);
    mesh.rotation.y = team === 0 ? 0 : Math.PI; this.scene.add(mesh);
    const b = { id: nextId++, kind: 'bld', type, team, d, x, z, y, cx, cz, size: s, hp: built ? d.hp * (this.civ[team].bld || 1) * this.T[team].bldHp : 1, maxHp: d.hp * (this.civ[team].bld || 1) * this.T[team].bldHp, built, progress: built ? 1 : 0, queue: [], rally: null, mesh, alive: true, atkCd: 1, food: (d.food || 0) * (this.civ[team].farm || 1) * this.T[team].farm, farmer: null, cargo: type === 'hall' ? [] : null, selected: false };
    b.prev = [];
    for (let zz = cz; zz < cz + s; zz++) for (let xx = cx; xx < cx + s; xx++) { const i = zz * N + xx; b.prev.push([i, blocked[i]]); blocked[i] = d.walk ? 7 : 4; bldAt[i] = b; if (d.dock) navBlock[i] = 1; }
    // push units out of the footprint
    if (!d.walk) for (const u of this.units) if (u.alive && bldAt[(u.z | 0) * N + (u.x | 0)] === b) { const p = nearestWalkable(u.x, u.z, 6); if (p) { u.x = p.x; u.z = p.z; u.path = null; } }
    this.setBuildVisual(b);
    this.blds.push(b); this.recount(); return b;
  }
  setBuildVisual(b) {
    b.mesh.scale.set(1, b.built ? 1 : .12 + .88 * b.progress, 1);
    if (!b.built && !b.scaffold) { b.scaffold = new THREE.Mesh(scaffoldGeo(b.size, b.type === 'tower' ? 5 : b.size > 3 ? 3.2 : 2.2), M.vc); b.scaffold.position.copy(b.mesh.position); b.scaffold.castShadow = true; this.scene.add(b.scaffold); }
    if (b.built && b.scaffold) { b.scaffold.removeFromParent(); b.scaffold = null; }
  }

  // ---------------- queries ----------------
  enemiesOf(t) { return t === 0 ? 1 : 0; }
  rebuildHash() {
    this.hash.clear();
    for (const u of this.units) if (u.alive && !u.boarded) { const k = ((u.x / 8) | 0) + ((u.z / 8) | 0) * 32; let l = this.hash.get(k); if (!l) this.hash.set(k, l = []); l.push(u); }
  }
  unitsNear(x, z, r, fn) {
    const x0 = Math.max(0, ((x - r) / 8) | 0), x1 = Math.min(15, ((x + r) / 8) | 0), z0 = Math.max(0, ((z - r) / 8) | 0), z1 = Math.min(15, ((z + r) / 8) | 0);
    for (let gz = z0; gz <= z1; gz++) for (let gx = x0; gx <= x1; gx++) { const l = this.hash.get(gx + gz * 32); if (l) for (const u of l) fn(u); }
  }
  nearestEnemy(src, r, inclBld = true) {
    let best = null, bd = r;
    const landMelee = src.d?.melee && !src.d?.ship;
    this.unitsNear(src.x, src.z, r, u => { if (u.team !== src.team && u.alive && !(landMelee && u.d.ship)) { const d = dist(u, src); if (d < bd) { bd = d; best = u; } } });
    if (!best && inclBld) for (const b of this.blds) if (b.alive && b.team !== src.team) { const d = this.edgeDist(src, b); if (d < bd) { bd = d; best = b; } }
    return best;
  }
  edgeDist(p, b) { const h = b.size / 2, dx = Math.max(Math.abs(p.x - b.x) - h, 0), dz = Math.max(Math.abs(p.z - b.z) - h, 0); return Math.hypot(dx, dz); }
  reachDist(u, t) { return t.kind === 'bld' ? this.edgeDist(u, t) : dist(u, t) - t.d.rad - u.d.rad * .5; }
  nearestDrop(u) { let best = null, bd = 1e9; for (const b of this.blds) if (b.alive && b.built && b.team === u.team && b.d.drop && (!u.d.ship || b.d.dock)) { const d = this.edgeDist(u, b); if (d < bd) { bd = d; best = b; } } return best; }
  nearestRes(x, z, rt, r = 18, fish = false) { let best = null, bd = r; for (const s of resources) if (s.alive && s.rt === rt && !!s.fish === fish) { const d = Math.hypot(s.x - x, s.z - z); if (d < bd) { bd = d; best = s; } } return best; }
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
  gather(u, res) { if (res.fish ? !u.d.fisher : u.type !== 'peasant') return this.moveTo(u, res.x, res.z); this.setTask(u, { type: 'gather', res }); }
  /** Send a transport to the water's edge nearest the units waiting to board. */
  fetch(ship, units) {
    const cx = units.reduce((a, u) => a + u.x, 0) / units.length, cz = units.reduce((a, u) => a + u.z, 0) / units.length;
    const p = nearestWalkable(cx, cz, 30, navCell); if (p) this.moveTo(ship, p.x, p.z);
  }
  /** Land everyone on board at the shore nearest (x,z). */
  unloadAt(ship, x, z) {
    let spot = nearestWalkable(x, z, 6);
    if (!spot || Math.hypot(spot.x - ship.x, spot.z - ship.z) > 7) spot = nearestWalkable(ship.x, ship.z, 6);
    if (!spot || Math.hypot(spot.x - ship.x, spot.z - ship.z) > 7) { if (ship.team === 0) this.toast('Sail closer to the shore to land troops.', 2); return false; }
    ship.cargo.forEach((u, i) => {
      const p = nearestWalkable(spot.x + (i % 4 - 1.5) * .9, spot.z + Math.floor(i / 4) * .9, 6) || spot;
      u.x = p.x; u.z = p.z; u.boarded = null; this.setTask(u, { type: 'idle' });
    });
    ship.cargo = []; return true;
  }
  build(u, b) { if (u.type !== 'peasant') return; this.setTask(u, { type: 'build', b }); }
  farm(u, b) { if (b.farmer && b.farmer !== u && b.farmer.alive && b.farmer.task.b === b) return false; b.farmer = u; this.setTask(u, { type: 'farm', b }); return true; }
  /** Right-click / tap command for a group. tgt is a unit, building, resource or null (ground). */
  command(sel, tgt, x, z) {
    sel = sel.filter(u => u.alive && !u.possessed); if (!sel.length) return;
    if (tgt && tgt.team !== undefined && tgt.team !== sel[0].team) { for (const u of sel) this.attack(u, tgt); return 'attack'; }
    if (tgt && tgt.kind === 'unit' && tgt.d.carry && tgt.team === sel[0].team) { // board a transport ship
      const land = sel.filter(u => !u.d.ship);
      if (land.length) { for (const u of land) this.setTask(u, { type: 'board', ship: tgt }); this.fetch(tgt, land); return 'build'; }
    }
    if (tgt && tgt.kind === 'res') {
      const pick = u => tgt.fish ? u.d.fisher : u.type === 'peasant', gat = sel.filter(pick);
      for (const u of gat) this.gather(u, tgt); this.formation(sel.filter(u => !pick(u)), x, z); return gat.length ? 'gather' : 'move';
    }
    if (tgt && tgt.kind === 'bld' && tgt.team === sel[0].team) {
      const peas = sel.filter(u => u.type === 'peasant'), rest = sel.filter(u => u.type !== 'peasant');
      for (const u of peas) {
        if (!tgt.built) this.build(u, tgt);
        else if (tgt.hp < tgt.maxHp && tgt.type !== 'farm') this.setTask(u, { type: 'repair', b: tgt });
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
    const walk0 = this.walkFor(sel[0]);
    sel.sort((p, q) => ((p.x - cx) * rx + (p.z - cz) * rz) - ((q.x - cx) * rx + (q.z - cz) * rz));
    // melee in front, ranged behind
    const ordered = [...sel.filter(u => !u.d.ranged), ...sel.filter(u => u.d.ranged)];
    ordered.forEach((u, i) => {
      const c = i % cols - (cols - 1) / 2, r = Math.floor(i / cols);
      let tx = x + rx * c * sp - fx * r * sp, tz = z + rz * c * sp - fz * r * sp;
      const wk = this.walkFor(u); void walk0;
      if (!wk(tx | 0, tz | 0)) { const p = nearestWalkable(tx, tz, u.d.ship ? 12 : 4, wk) || { x, z }; tx = p.x; tz = p.z; }
      this.moveTo(u, tx, tz);
    });
  }
  train(b, type) {
    const d = this.stat(b.team, type); if (!b.built || !this.trainsFor(b).includes(type)) return 'no';
    if (!this.ageOK(b.team, d)) return 'age';
    if (b.queue.length >= 5) return 'full';
    if (!this.afford(b.team, d.cost)) return 'cost';
    this.pay(b.team, d.cost); b.queue.push({ type, t: 0 }); return 'ok';
  }
  cancelTrain(b, i) { const q = b.queue.splice(i, 1)[0]; if (q) this.pay(b.team, q.tech ? TECH[q.tech].cost : this.stat(b.team, q.type).cost, -1); }
  startBuilding(team, type, cx, cz, builders) {
    const d = BD[type]; if (!this.afford(team, d.cost) || !this.canPlace(type, cx, cz) || !this.ageOK(team, d)) return null;
    if (d.req && !this.has(team, d.req)) return null;
    this.pay(team, d.cost); const b = this.placeBuilding(team, type, cx, cz, false);
    for (const u of builders) if (u.type === 'peasant') this.build(u, b);
    return b;
  }

  // ---------------- damage ----------------
  damage(t, dmg, src) {
    if (!t.alive) return;
    let m = 1; if (src?.d?.vsHorse && t.d.horse) m = 3;
    if (t.kind === 'bld' && src?.d?.ranged) m = src.d.vsBld || .3;
    if (t.kind === 'unit' && src?.d?.vsBld) m = .7; // catapults are clumsy against single soldiers
    const arm = Math.max(0, (t.d.arm || 0) - (src?.d?.pierce || 0));
    const amt = Math.max(1, dmg * m - arm);
    t.hp -= amt; t.hitT = this.time; this.onHit?.(t, src, amt);
    if (t.team === 0 && t.kind === 'unit' && t.type !== 'peasant' && this.time - (this.lastArmyPing || 0) > 6) { this.lastArmyPing = this.time; this.onAlert?.(t.x, t.z); }
    if (t.kind === 'unit' && src && src.alive && !t.possessed) {
      const busy = t.task.type === 'attack' && t.task.t.alive && t.task.t.kind === 'unit';
      if (t.d.acq && !busy && t.task.type !== 'move' && !(t.stance === 'hold' && this.reachDist(t, src) > t.d.rng)) this.attack(t, src, t.task.type === 'attack' ? null : t.task);
      if (t.type === 'peasant' && src.kind === 'unit' && t.team === 0 && this.time - (this.lastWarn || 0) > 10) { this.lastWarn = this.time; this.toast('Your peasants are under attack!'); this.onAlert?.(t.x, t.z); }
    }
    if (t.kind === 'bld' && t.team === 0 && this.time - (this.lastBWarn || 0) > 12) { this.lastBWarn = this.time; this.toast(`Your ${t.d.name} is under attack!`); this.onAlert?.(t.x, t.z); }
    if (t.hp <= 0) this.kill(t);
  }
  kill(t) {
    t.alive = false; t.hp = 0;
    if (t.kind === 'unit') {
      if (t.cargo?.length) { for (const c of t.cargo) { c.boarded = null; c.x = t.x; c.z = t.z; this.kill(c); } t.cargo = []; }
      for (const o of this.units) if (o.onShip === t) { const p = nearestWalkable(t.x, t.z, 30); if (p) { o.x = p.x; o.z = p.z; } o.onShip = null; o.yOver = null; this.onShipLost?.(o); }
      t.dead = true; t.deathT = 0; t.selected = false; if (t.ring) { t.ring.removeFromParent(); t.ring = null; }
      if (t === this.hero) { this.heroRespawn = this.mode === 'battle' ? 0 : 30; this.toast(this.heroRespawn ? 'Your Commander has fallen! He returns in 30s.' : 'Your Commander has fallen!'); }
      this.onUnitDeath?.(t);
    } else {
      if (t.cargo?.length) this.ungarrison(t);
      this.onDestroyed?.(t);
      t.mesh.removeFromParent(); t.scaffold?.removeFromParent(); t.selected = false; if (t.ring) { t.ring.removeFromParent(); t.ring = null; }
      for (const [i, v] of t.prev) { blocked[i] = v; bldAt[i] = null; navBlock[i] = 0; }
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
    const kind = src?.d?.stone ? 'stone' : src?.d?.bolt ? 'bolt' : 'arrow'; this.onShoot?.(src, kind);
    const mesh = new THREE.Mesh(kind === 'stone' ? stoneGeo : kind === 'bolt' ? boltGeo : arrowGeo, M.vc); mesh.castShadow = kind === 'stone'; this.scene.add(mesh);
    const f = from || new THREE.Vector3(src.x, src.y + (src.d?.horse ? 2.4 : src.d?.ship ? 1.8 : 1.5) * (src.scale || 1), src.z);
    const d = Math.hypot(t.x - f.x, t.z - f.z), speed = kind === 'stone' ? 13 : kind === 'bolt' ? 30 : 22;
    this.shots.push({ mesh, f, t, kind, homing: kind !== 'stone', tx: t.x, tz: t.z, ty: (t.kind === 'bld' ? t.y + 1.5 : t.y + 1.0), k: 0, dur: Math.max(.25, d / speed), dmg, src, team: src.team, arc: d * (kind === 'stone' ? .35 : kind === 'bolt' ? .04 : .12) });
  }
  /** Catapult stone lands: hurts everything nearby (friendly fire excluded) and any building it hits. */
  splash(s) {
    const r = s.src?.d?.splash || 1.8, src = s.src && s.src.alive ? s.src : { d: UD.catapult, team: s.team, alive: false };
    this.unitsNear(s.tx, s.tz, r + 1, u => { if (u.alive && u.team !== s.team && !u.d.ship) { const d = Math.hypot(u.x - s.tx, u.z - s.tz); if (d < r) this.damage(u, s.dmg * (1 - d / r * .5), src); } });
    for (const b of this.blds) if (b.alive && b.team !== s.team && this.edgeDist({ x: s.tx, z: s.tz }, b) < .6) { this.damage(b, s.dmg, src); break; }
    this.onSplash?.(s.tx, s.tz);
  }
  updateShots(dt) {
    const p = new THREE.Vector3(), q = new THREE.Vector3();
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i]; s.k += dt / s.dur;
      if (s.t.alive && s.homing) { s.tx = s.t.x; s.tz = s.t.z; s.ty = s.t.kind === 'bld' ? s.t.y + 1.5 : s.t.y + 1.0; }
      const k = Math.min(1, s.k), arc = Math.sin(k * Math.PI) * s.arc;
      p.set(s.f.x + (s.tx - s.f.x) * k, s.f.y + (s.ty - s.f.y) * k + arc, s.f.z + (s.tz - s.f.z) * k);
      const k2 = Math.min(1, k + .02); q.set(s.f.x + (s.tx - s.f.x) * k2, s.f.y + (s.ty - s.f.y) * k2 + Math.sin(k2 * Math.PI) * s.arc, s.f.z + (s.tz - s.f.z) * k2);
      s.mesh.position.copy(p); s.mesh.lookAt(q);
      if (s.k >= 1) {
        if (s.kind === 'stone') this.splash(s); else if (s.t.alive) this.damage(s.t, s.dmg, s.src);
        s.mesh.removeFromParent(); this.shots.splice(i, 1);
      }
    }
  }

  // ---------------- movement ----------------
  goTo(u, x, z, reach, dt) {
    // returns true when arrived
    if (!u.path || u.repath <= 0 || (u.goal && Math.hypot(u.goal.x - x, u.goal.z - z) > 1.5)) {
      u.path = findPath(u.x, u.z, x, z, reach, 14000, this.walkFor(u)); u.pi = 0; u.repath = 3 + Math.random(); u.goal = { x, z };
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
    const nx = u.x + dx, nz = u.z + dz, wk = this.walkFor(u), ok = (x, z) => wk(x | 0, z | 0);
    if (ok(nx, nz)) { u.x = nx; u.z = nz; return true; }
    if (ok(nx, u.z)) { u.x = nx; return true; }
    if (ok(u.x, nz)) { u.z = nz; return true; }
    u.repath = Math.min(u.repath || 0, .2); return false;
  }
  face(u, a, dt) { u.yaw += angDiff(u.yaw, a) * Math.min(1, dt * 10); }

  // ---------------- per-unit AI ----------------
  updateUnit(u, dt) {
    u.cd -= dt; u.swingT += dt; u.speedNow = 0; u.think -= dt;
    if (u.d.regen && u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + u.d.regen * dt);
    if (u.possessed) return;
    const t = u.task;
    switch (t.type) {
      case 'idle':
        if (u.d.acq && u.think <= 0) {
          u.think = .4; const st = u.stance || 'aggressive', e = this.nearestEnemy(u, st === 'hold' ? u.d.rng + 1 : u.d.acq);
          if (e) this.setTask(u, { type: 'attack', t: e, auto: true, home: { x: u.x, z: u.z } });
        }
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
        const rng = u.d.rng;
        if (u.stance === 'hold' && this.reachDist(u, e) > rng) { this.setTask(u, { type: 'idle' }); break; } // hold ground: never chase
        if (u.stance === 'defensive' && t.auto && t.home && Math.hypot(u.x - t.home.x, u.z - t.home.z) > 9) { this.moveTo(u, t.home.x, t.home.z); break; }
        if (this.reachDist(u, e) <= rng) {
          u.path = null; this.face(u, Math.atan2(e.x - u.x, e.z - u.z), dt);
          if (u.cd <= 0) { u.cd = u.d.cd; u.swingT = 0; if (u.d.ranged) this.shoot(u, e, u.d.dmg); else this.damage(e, u.d.dmg, u); }
        } else {
          // chase; ranged units give up chasing far targets when idle-acquired
          if (e.kind === 'unit' && !t.resume && dist(u, e) > (u.d.acq || 8) * 2.2 && t.auto) { this.setTask(u, { type: 'idle' }); break; }
          const reach = e.kind === 'bld' ? e.size / 2 + rng * .8 : Math.max(rng * .8, .9);
          u.repath = Math.min(u.repath || 0, e.kind === 'unit' ? .8 : 99);
          if (this.goTo(u, e.x, e.z, reach, dt) && e.d?.ship && !u.d.ranged) this.setTask(u, { type: 'idle' }); // can't reach a boat on foot
        }
        break;
      }
      case 'patrol': {
        if (u.d.acq && u.think <= 0) { u.think = .4; const e = this.nearestEnemy(u, u.d.acq); if (e) { this.attack(u, e, t); break; } }
        const P = t.leg ? t.b : t.a; if (this.goTo(u, P.x, P.z, 1.2, dt)) { t.leg = !t.leg; u.path = null; }
        break;
      }
      case 'garrison': {
        const h = t.b; if (!h.alive || !h.cargo || h.cargo.length >= 15) { this.setTask(u, { type: 'idle' }); break; }
        if (this.edgeDist(u, h) <= 1.2) { u.boarded = h; h.cargo.push(u); u.selected = false; u.carry = null; this.setTask(u, { type: 'idle' }); break; }
        if (this.goTo(u, h.x, h.z, h.size / 2 + .8, dt) && this.edgeDist(u, h) < 3.2) { u.boarded = h; h.cargo.push(u); u.selected = false; this.setTask(u, { type: 'idle' }); }
        break;
      }
      case 'repair': {
        const b = t.b, T = this.T[u.team];
        if (!b.alive || b.hp >= b.maxHp) { this.setTask(u, { type: 'idle' }); break; }
        if (this.edgeDist(u, b) <= (b.d.dock ? 2.4 : 1.0) || (u.near === b && this.edgeDist(u, b) < 3.2)) {
          u.path = null; this.face(u, Math.atan2(b.x - u.x, b.z - u.z), dt); if (u.swingT > .6) u.swingT = 0;
          const add = Math.min(b.maxHp - b.hp, b.maxHp / (b.d.time * 3) * dt), cost = add * .08;
          if (T.w < cost) { if (u.team === 0 && this.time - (this.lastRepWarn || 0) > 8) { this.lastRepWarn = this.time; this.toast('Not enough wood to repair.', 2); } this.setTask(u, { type: 'idle' }); break; }
          T.w -= cost; b.hp += add; b.nbNow = (b.nbNow || 0) + 1;
        } else if (this.goTo(u, b.x, b.z, b.size / 2 + (b.d.dock ? 1.8 : .6), dt)) u.near = b;
        break;
      }
      case 'board': {
        const sh = t.ship;
        if (!sh.alive || sh.cargo.length >= sh.d.carry) { this.setTask(u, { type: 'idle' }); break; }
        if (dist(u, sh) <= sh.d.rad + 2.8) { u.boarded = sh; sh.cargo.push(u); u.selected = false; this.setTask(u, { type: 'idle' }); this.onBoard?.(u); break; }
        u.repath = Math.min(u.repath || 0, 1); if (this.goTo(u, sh.x, sh.z, sh.d.rad + 2.4, dt)) u.path = null;
        break;
      }
      case 'unload': {
        if (!u.cargo?.length) { this.setTask(u, { type: 'idle' }); break; }
        if (this.goTo(u, t.x, t.z, 3.5, dt) || Math.hypot(u.x - t.x, u.z - t.z) < 4.5) { this.unloadAt(u, t.x, t.z); this.setTask(u, { type: 'idle' }); }
        break;
      }
      case 'gather': {
        let r = t.res;
        if (!r.alive) { r = this.nearestRes(r.x, r.z, r.rt, r.fish ? 40 : 15, !!r.fish); if (!r) { if (u.carry) this.setTask(u, { type: 'return' }); else this.setTask(u, { type: 'idle' }); break; } t.res = r; u.path = null; }
        if (u.carry && (u.carry.rt !== r.rt || u.carry.amt >= this.T[u.team].carry)) { this.setTask(u, { type: 'return', back: t }); break; }
        if (Math.hypot(u.x - r.x, u.z - r.z) <= r.r + (u.d.ship ? 1.9 : .95)) {
          u.path = null; this.face(u, Math.atan2(r.x - u.x, r.z - u.z), dt);
          const got = takeRes(r, RATE[r.rt] * dt * this.gatherMul(u.team) * (this.civ[u.team].gather?.[r.rt] || 1) * this.T[u.team].gm[r.rt] * (r.fish ? this.T[u.team].fish : 1));
          u.carry = u.carry || { rt: r.rt, amt: 0 }; u.carry.amt += got; u.work = true;
          if (u.swingT > .7) { u.swingT = 0; this.onWork?.(u, r.rt === 'w' ? 'chop' : r.rt === 'g' ? 'stone' : null); }
        } else this.goTo(u, r.x, r.z, r.r + (u.d.ship ? 1.6 : .8), dt);
        break;
      }
      case 'farm': {
        const b = t.b; if (!b.alive) { this.setTask(u, { type: 'idle' }); break; }
        if (u.carry && (u.carry.rt !== 'f' || u.carry.amt >= this.T[u.team].carry)) { this.setTask(u, { type: 'return', back: t }); break; }
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
        if (this.edgeDist(u, drop) <= (u.d.ship || drop.d.dock ? 2.4 : 1.0) || (u.near === drop && this.edgeDist(u, drop) < 3.2)) {
          this.T[u.team][u.carry.rt] += Math.floor(u.carry.amt + .001); u.carry = null;
          this.setTask(u, t.back || { type: 'idle' });
        } else if (this.goTo(u, drop.x, drop.z, drop.size / 2 + (u.d.ship ? 1.6 : .7), dt)) u.near = drop;
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
        if (this.edgeDist(u, b) <= (b.d.dock ? 2.4 : 1.0) || (u.near === b && this.edgeDist(u, b) < 3.2)) {
          u.path = null; this.face(u, Math.atan2(b.x - u.x, b.z - u.z), dt); if (u.swingT > .6) { u.swingT = 0; this.onWork?.(u, 'knock'); }
          b.nbNow = (b.nbNow || 0) + 1; // every builder adds their share, so more builders finish faster
          const add = dt / b.d.time * (this.civ[u.team].build || 1); b.progress = Math.min(1, b.progress + add); b.hp = Math.min(b.maxHp, b.hp + add * b.maxHp);
          if (b.progress >= 1) { b.built = true; if (b.mesh.isMesh) b.mesh.geometry = buildingGeo(b.type, b.team, this.look(b.team)); this.onBuilt?.(b); this.recount(); if (b.team === 0) this.toast(`${b.d.name} complete.`); }
          this.setBuildVisual(b);
        } else if (this.goTo(u, b.x, b.z, b.size / 2 + (b.d.dock ? 1.8 : .6), dt)) u.near = b; // as close as we can get
        break;
      }
    }
  }
  gatherMul(team) { return team === 1 && this.mode === 'skirmish' ? this.diffD.gather : 1; }

  updateBuilding(b, dt) {
    if (!b.built) return;
    if (b.d.atk && (b.atkCd -= dt) <= 0) {
      const T0 = this.T[b.team], xr = (b.type === 'tower' && T0.techs.has('guardtower') ? 2 : 0) + (T0.techs.has('fletching') ? 1 : 0) + (T0.techs.has('bodkin') ? 1 : 0);
      b.atkCd = .5; const e = this.nearestEnemy({ x: b.x, z: b.z, team: b.team }, b.d.atk.rng + xr + b.size / 2, false);
      if (e) {
        const T = this.T[b.team], guard = b.type === 'tower' && T.techs.has('guardtower'), fort = b.type === 'hall' && T.techs.has('fortify');
        const bonus = (T.techs.has('fletching') ? 1 : 0) + (T.techs.has('bodkin') ? 1 : 0) + (guard ? 4 : 0) + (fort ? 3 : 0);
        const arrows = 1 + (b.cargo ? Math.floor(b.cargo.length / 3) : 0) + (fort ? 1 : 0);
        b.atkCd = b.d.atk.cd;
        for (let i = 0; i < arrows; i++) this.shoot(b, e, b.d.atk.dmg + bonus, new THREE.Vector3(b.x + (i - arrows / 2) * .4, b.y + (b.type === 'tower' ? (guard ? 5.6 : 4.6) : 3), b.z));
      }
    }
    const q = b.queue[0];
    if (q) {
      if (q.tech) { q.t += dt / TECH[q.tech].time; if (q.t >= 1) { b.queue.shift(); this.applyTech(b.team, q.tech); } return; }
      if (q.t < 1) q.t += dt / this.stat(b.team, q.type).time;
      if (q.t >= 1) {
        const T = this.T[b.team];
        if (T.pop >= T.cap) { if (b.team === 0 && this.time - (this.lastPopWarn || 0) > 8) { this.lastPopWarn = this.time; this.toast('Population limit reached — build more Houses.'); } }
        else {
          b.queue.shift();
          const side = b.team === 0 ? 1 : -1;
          const u = this.spawnUnit(b.team, q.type, b.x + side * (b.size / 2 + .8), b.z + side * (b.size / 2 + .8));
          if (u.d.fisher && !b.rally) { const r = this.nearestRes(u.x, u.z, 'f', 60, true); if (r) this.gather(u, r); }
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
    for (const b of this.blds) b.nbNow = 0;
    for (const u of this.units) if (u.alive) { if (u.boarded) { u.x = u.boarded.x; u.z = u.boarded.z; continue; } this.updateUnit(u, dt); }
    // separation
    for (const u of this.units) {
      if (!u.alive || u.boarded) continue;
      this.unitsNear(u.x, u.z, 1.5, o => {
        if (o.id <= u.id || !o.alive || !!o.d.ship !== !!u.d.ship) return;
        const dx = o.x - u.x, dz = o.z - u.z, d2 = dx * dx + dz * dz, r = (u.d.rad + o.d.rad) * .95;
        if (d2 < r * r && d2 > 1e-6) {
          const d = Math.sqrt(d2), push = (r - d) * .5, ux = dx / d * push, uz = dz / d * push;
          if (!u.possessed) this.step(u, -ux, -uz); if (!o.possessed) this.step(o, ux, uz);
        } else if (d2 <= 1e-6) { o.x += .05; }
      });
    }
    for (const b of this.blds) { b.nb = b.nbNow || 0; if (b.alive) this.updateBuilding(b, dt); }
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
      u.y = u.d.ship ? WL : groundY(u.x, u.z);
      const k = Math.min(1, u.speedNow / 3); u.phase += dt * (4 + u.speedNow * 2.2);
      const sw = u.swingT < .35 ? u.swingT / .35 : 0;
      let tilt = 0, y = u.y;
      if (u.d.ship) { tilt = Math.sin(this.time * 1.1 + u.id) * .035; y += Math.sin(this.time * 1.6 + u.id) * .04 - (u.type === 'fishboat' ? .12 : .28); if (u.dead) { tilt += u.deathT * .2; y -= u.deathT * .7; } } // rocking / sinking
      else if (u.dead) { tilt = -Math.min(1, u.deathT * 2.5) * Math.PI / 2 * .95; y -= Math.max(0, u.deathT - 1.5) * .6; }
      if (u.yOver != null) y = u.yOver; // standing on a ship's deck or a building floor
      if (u.d.ranged && !u.d.ship) { // archers raise the bow while engaging and draw in time with their shots
        const t = u.task, engaged = u.aimHold || (t.type === 'attack' && t.t.alive && this.reachDist(u, t.t) <= u.d.rng + .5);
        u.aimK = (u.aimK || 0) + ((engaged ? 1 : 0) - (u.aimK || 0)) * Math.min(1, dt * 6);
        u.drawK = clamp(1 - u.cd / u.d.cd, 0, 1);
      }
      u.batch.set(u.slot, { x: u.x, y, z: u.z, yaw: u.yaw, scale: u.scale, s: Math.sin(u.phase) * .7 * k, swing: sw, tilt, hidden: u.id === hideId || !!u.boarded, aim: u.aimK || 0, draw: u.drawK || 0 });
      if (u.d.ship) {
        if (!u.wake && u.alive) { u.wake = new THREE.Mesh(wakeGeo, wakeMaterial().clone()); this.scene.add(u.wake); }
        if (u.wake) {
          if (!u.alive) { u.wake.removeFromParent(); u.wake = null; }
          else {
            u.wakeK = (u.wakeK || 0) + ((u.speedNow > 0 ? 1 : 0) - (u.wakeK || 0)) * Math.min(1, dt * 2);
            const L = SHIP_LEN[u.type] || 4, len = 2 + 5 * u.wakeK, fx = Math.sin(u.yaw), fz = Math.cos(u.yaw);
            u.wake.position.set(u.x - fx * (len / 2 + L * .32), WL + .03, u.z - fz * (len / 2 + L * .32)); u.wake.rotation.y = u.yaw;
            u.wake.scale.set(L * .32 + .4, 1, len); u.wake.material.opacity = .15 + .6 * u.wakeK;
          }
        }
      }
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
