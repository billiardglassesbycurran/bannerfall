// Battle mode battlefield: three banners to capture. Every banner you hold brings reinforcements from your reserves;
// hold all three long enough and the enemy army breaks. So it's not just "whoever has more wins": positioning matters.
import * as THREE from 'three';
import { groundY, cellWalk, MAP } from './world.js';
import { nearestWalkable } from './path.js';
import { TEAM } from './models.js';

const R = 5.5, CAPTURE = 9, WAVE = 25, BREAK = 45;
const NAMES = ['Left Hill', MAP.bridge ? 'Bridge' : 'Centre', 'Right Hill'];
const POOL = [['sword', 4], ['spear', 4], ['archer', 3], ['crossbow', 2], ['lightcav', 2], ['knight', 1], ['horsearcher', 1], ['unique', 2]];

export class Field {
  constructor(g, scene, reserves = [24, 24]) {
    this.g = g; this.scene = scene; this.reserves = reserves; this.t = 0; this.waveT = WAVE; this.hold = [0, 0]; this.broken = -1;
    this.spawn = [nearestWalkable(38, 90, 12, cellWalk) || { x: 38, z: 90 }, nearestWalkable(90, 38, 12, cellWalk) || { x: 90, z: 38 }];
    // banners sit across the middle of the field, on the line between the two armies' flanks
    this.flags = [[-17, 'L'], [0, 'C'], [17, 'R']].map(([o], i) => {
      const p = nearestWalkable(64 + o * .707, 64 - o * .707, 10, cellWalk) || { x: 64, z: 64 };
      return { i, name: NAMES[i], x: p.x, z: p.z, own: -1, prog: 0, mesh: this.flagMesh(p.x, p.z) };
    });
  }
  flagMesh(x, z) {
    const grp = new THREE.Group(), y = groundY(x, z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(.07, .09, 4.2, 6), new THREE.MeshLambertMaterial({ color: 0x5a4026 })); pole.position.y = 2.1; grp.add(pole);
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1), new THREE.MeshLambertMaterial({ color: 0xdedad0, side: THREE.DoubleSide })); cloth.position.set(.82, 3.55, 0); grp.add(cloth);
    const ring = new THREE.Mesh(new THREE.RingGeometry(R - .25, R, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .35, depthWrite: false }));
    ring.position.y = .25; grp.add(ring);
    const fill = new THREE.Mesh(new THREE.CircleGeometry(R - .3, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .0, depthWrite: false }));
    fill.position.y = .22; grp.add(fill);
    grp.position.set(x, y, z); grp.userData = { cloth, ring, fill }; this.scene.add(grp); return grp;
  }
  held(team) { return this.flags.filter(f => f.own === team).length; }
  update(dt) {
    const g = this.g; if (g.over) return;
    this.t += dt;
    for (const f of this.flags) {
      const n = [0, 0];
      g.unitsNear(f.x, f.z, R, u => { if (u.alive && u.d.acq && !u.routed && !u.d.ship && Math.hypot(u.x - f.x, u.z - f.z) < R) n[u.team]++; });
      const side = n[0] && !n[1] ? 0 : n[1] && !n[0] ? 1 : -1; // contested banners don't move
      if (side >= 0 && f.own !== side) {
        const before = f.prog; f.prog = Math.max(-1, Math.min(1, f.prog + (side === 0 ? 1 : -1) * Math.min(3, n[side]) / CAPTURE * dt));
        if (f.own >= 0 && (Math.sign(f.prog) !== Math.sign(before) || f.prog === 0)) { g.toast(f.own === 0 ? `You lost the ${f.name} banner!` : `The enemy's ${f.name} banner is down!`, 2.5); f.own = -1; this.paint(f); }
        if (f.own === -1 && Math.abs(f.prog) >= 1) this.capture(f, side);
      }
      f.prog = Math.max(-1, Math.min(1, f.prog));
      const u = f.mesh.userData; u.fill.material.color.setHex(f.prog > 0 ? TEAM[0] : TEAM[1]); u.fill.material.opacity = Math.abs(f.prog) * .22;
      u.cloth.rotation.y = Math.sin(this.t * 2 + f.i) * .25;
    }
    // reinforcements
    if ((this.waveT -= dt) <= 0) { this.waveT = WAVE; for (const t of [0, 1]) this.reinforce(t, 1 + this.held(t) * 2); }
    // holding every banner breaks the other army
    for (const t of [0, 1]) {
      if (this.held(t) === 3) { this.hold[t] += dt; if (Math.round(this.hold[t]) === BREAK - 15 && Math.round(this.hold[t] - dt) !== BREAK - 15) g.toast(t === 0 ? 'Hold all three banners 15 more seconds and the enemy breaks!' : 'The enemy holds every banner! Retake one or your army breaks in 15 s!', 4); }
      else this.hold[t] = 0;
      if (this.hold[t] >= BREAK) { this.broken = 1 - t; g.toast(t === 0 ? 'The enemy army breaks and flees!' : 'Your army breaks!', 4); g.checkEnd(); }
    }
  }
  capture(f, side) {
    f.own = side; f.prog = side === 0 ? 1 : -1; this.paint(f);
    this.g.toast(side === 0 ? `You captured the ${f.name} banner! +2 reinforcements every ${WAVE}s.` : `The enemy captured the ${f.name} banner!`, 3);
    this.g.onAlert?.(f.x, f.z); this.g.onCapture?.(f, side);
  }
  paint(f) { const u = f.mesh.userData; u.cloth.material.color.setHex(f.own < 0 ? 0xdedad0 : TEAM[f.own]); u.ring.material.color.setHex(f.own < 0 ? 0xffffff : TEAM[f.own]); }
  reinforce(team, n) {
    n = Math.min(n, this.reserves[team]); if (n <= 0) return;
    const g = this.g, bag = POOL.flatMap(([t, w]) => Array(w).fill(t === 'unique' ? g.civ[team].unique.type : t)), sp = this.spawn[team], made = [];
    for (let i = 0; i < n; i++) made.push(g.spawnUnit(team, bag[Math.random() * bag.length | 0], sp.x + (i % 4) - 1.5, sp.z + (i / 4 | 0)));
    this.reserves[team] -= n; g.recount();
    if (team === 0) { g.toast(`${n} reinforcement${n > 1 ? 's' : ''} arrived (${this.reserves[0]} left in reserve).`, 3); g.onAlert?.(sp.x, sp.z); }
    g.onReinforce?.(team, made);
  }
  lastStand(team) {
    const n = Math.min(12, this.reserves[team]); this.g.toast(team === 0 ? `Your last ${n} reserves rush onto the field!` : `The enemy throws in its last ${n} reserves!`, 3);
    this.reinforce(team, n);
  }
  hudText() {
    const dot = f => `<b style="color:${f.own < 0 ? '#ddd' : f.own === 0 ? '#7da2ff' : '#ff7a6a'}">⚑</b>`;
    const brk = this.hold[0] > 0 ? ` · enemy breaks in ${Math.ceil(BREAK - this.hold[0])}s` : this.hold[1] > 0 ? ` · <span style="color:#ff8a7a">you break in ${Math.ceil(BREAK - this.hold[1])}s</span>` : '';
    return `${this.flags.map(dot).join(' ')} · Reserves ${this.reserves[0]} vs ${this.reserves[1]} · next in ${Math.ceil(this.waveT)}s${brk}`;
  }
  save() { return { reserves: this.reserves, waveT: this.waveT, hold: this.hold, flags: this.flags.map(f => [f.own, f.prog]) }; }
  load(d) { Object.assign(this, { reserves: d.reserves, waveT: d.waveT, hold: d.hold }); d.flags.forEach(([o, p], i) => { this.flags[i].own = o; this.flags[i].prog = p; this.paint(this.flags[i]); }); }
}
