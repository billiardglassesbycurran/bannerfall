// Enemy AI for each mode.
import { BD } from './data.js';
import { dist } from './util.js';
import { BASES, blocked, N } from './world.js';

import { UD } from './data.js';

export class AI {
  constructor(game, team = 1) {
    this.g = game; this.team = team; this.D = game.diffD; this.t = 0;
    this.nextAttack = this.D.first; this.wave = 0; this.nextWave = 75; this.reissue = 0;
  }
  my(fn) { return this.g.units.filter(u => u.alive && u.team === this.team && (!fn || fn(u))); }
  update(dt) {
    if (this.g.over) return;
    this.t += dt; if (this.t < 1) return; this.t = 0;
    if (this.g.mode === 'skirmish') this.skirmish();
    else if (this.g.mode === 'battle') this.battle();
    else this.survival();
  }

  // ---------- helpers ----------
  findSpot(type, near, rMin = 6, rMax = 24) {
    const s = BD[type].size, g = this.g;
    const ringOK = (cx, cz, n) => { for (let z = cz; z < cz + n; z++) for (let x = cx; x < cx + n; x++) { if (x > cx && x < cx + n - 1 && z > cz && z < cz + n - 1) continue; const v = blocked[z * N + x]; if (v === 4 || v === 3) return false; } return true; };
    for (let r = rMin; r <= rMax; r += 1) for (let a = 0; a < 24; a++) {
      const ang = a / 24 * Math.PI * 2 + r * .7, cx = Math.round(near.x + Math.cos(ang) * r - s / 2), cz = Math.round(near.z + Math.sin(ang) * r - s / 2);
      if (g.canPlace(type, cx, cz) && ringOK(cx - 1, cz - 1, s + 2)) return [cx, cz];
    }
    return null;
  }
  /** Nearest spot on the river bank (to our Town Hall) where a Dock fits. */
  findDockSpot(hall) {
    let best = null, bd = 1e9;
    for (let cz = 4; cz < 124; cz++) for (let cx = 4; cx < 124; cx++) {
      const d = Math.hypot(cx - hall.x, cz - hall.z); if (d >= bd || d > 70) continue;
      if (this.g.canPlace('dock', cx, cz)) { bd = d; best = [cx, cz]; }
    }
    return best;
  }
  tryBuild(type, hall) {
    const g = this.g; if (!g.afford(this.team, BD[type].cost)) return false;
    const spot = this.findSpot(type, hall); if (!spot) return false;
    const peas = this.my(u => u.type === 'peasant').sort((a, b) => dist(a, hall) - dist(b, hall)).slice(0, type === 'house' ? 1 : 2);
    return !!g.startBuilding(this.team, type, spot[0], spot[1], peas);
  }
  attackTarget(from) {
    const g = this.g; let best = null, bd = 1e9;
    for (const b of g.blds) if (b.alive && b.team !== this.team) { const d = dist(b, from); if (d < bd) { bd = d; best = b; } }
    if (!best) for (const u of g.units) if (u.alive && u.team !== this.team) { const d = dist(u, from); if (d < bd) { bd = d; best = u; } }
    return best;
  }

  // ---------- skirmish: economy + waves ----------
  skirmish() {
    const g = this.g, T = g.T[this.team], hall = g.blds.find(b => b.alive && b.team === this.team && b.type === 'hall');
    if (!hall) { for (const u of this.my(u => u.task.type === 'idle' && u.d.acq)) { const t = this.attackTarget(u); if (t) g.amove(u, t.x, t.z); } return; }
    const peas = this.my(u => u.type === 'peasant'), mil = this.my(u => u.type !== 'peasant' && u.type !== 'hero' && u.d.dmg > 0);
    const time = g.time, wantPeas = Math.min(this.D.peas + Math.floor(time / 90), 30);
    if (peas.length < wantPeas && hall.queue.length < 2 && T.pop < T.cap) g.train(hall, 'peasant');
    // gatherer balance
    const count = { f: 0, w: 0, g: 0 };
    for (const p of peas) { const tt = p.task; if (tt.type === 'gather') count[tt.res.rt]++; else if (tt.type === 'farm') count.f++; else if (tt.type === 'return' && tt.back?.res) count[tt.back.res.rt]++; }
    const hasBarracks = g.blds.some(b => b.alive && b.team === this.team && b.type === 'barracks');
    const want = hasBarracks ? { f: .45, w: .3, g: .25 } : { f: .5, w: .45, g: .05 };
    for (const p of peas) {
      if (p.task.type !== 'idle') continue;
      const n = peas.length || 1; let rt = 'f', worst = 1e9;
      for (const k of ['f', 'w', 'g']) { const v = count[k] / n - want[k]; if (v < worst) { worst = v; rt = k; } }
      let r = g.nearestRes(hall.x, hall.z, rt, 34);
      if (rt === 'f' && !r) {
        const farm = g.blds.find(b => b.alive && b.built && b.team === this.team && b.type === 'farm' && (!b.farmer || !b.farmer.alive || b.farmer.task.b !== b));
        if (farm) { g.farm(p, farm); count.f++; continue; }
        if (T.w >= 60 && this.tryBuild('farm', hall)) { count.f++; continue; }
        rt = 'w'; r = g.nearestRes(hall.x, hall.z, 'w', 40);
      }
      if (!r) r = g.nearestRes(p.x, p.z, 'w', 60);
      if (r) { g.gather(p, r); count[r.rt]++; }
    }
    const building = t => g.blds.some(b => b.alive && b.team === this.team && b.type === t && !b.built);
    const nOf = t => g.blds.filter(b => b.alive && b.team === this.team && b.type === t).length;
    if (T.pop >= T.cap - 3 && T.cap < 100 && !building('house')) this.tryBuild('house', hall);
    if (!hasBarracks && peas.length >= 7) this.tryBuild('barracks', hall);
    if (hasBarracks && time > 200 && nOf('range') === 0) this.tryBuild('range', hall);
    if (hasBarracks && this.g.diff >= 1 && time > 300 && nOf('stable') === 0) this.tryBuild('stable', hall);
    if (nOf('range') && this.g.diff >= 1 && time > 520 && nOf('workshop') === 0) this.tryBuild('workshop', hall);
    // navy: a dock on the river, fishing boats for food, a few warships
    if (this.g.diff >= 1 && time > 330 && nOf('dock') === 0 && !this.noDock && g.afford(this.team, BD.dock.cost)) {
      const sp = this.findDockSpot(hall);
      if (!sp) this.noDock = true;
      else { const ps = this.my(u => u.type === 'peasant').sort((a, b) => dist(a, hall) - dist(b, hall)).slice(0, 2); g.startBuilding(this.team, 'dock', sp[0], sp[1], ps); }
    }
    const dock = g.blds.find(b => b.alive && b.built && b.team === this.team && b.type === 'dock');
    if (dock && dock.queue.length < 1 && T.pop < T.cap) {
      const nf = this.my(u => u.type === 'fishboat').length, nw = this.my(u => u.type === 'warship').length;
      if (nf < 2 + this.g.diff) g.train(dock, 'fishboat'); else if (nw < this.g.diff && T.g > 100) g.train(dock, 'warship');
    }
    if (hasBarracks && time > 260 && nOf('tower') < this.g.diff + 1 && T.g > 120) this.tryBuild('tower', hall);
    if (time > 480 && nOf('barracks') < 1 + this.g.diff) this.tryBuild('barracks', hall);
    // training military
    if (T.pop < T.cap) for (const b of g.blds) {
      if (!b.alive || !b.built || b.team !== this.team || !b.d.trains || b.type === 'hall' || b.queue.length >= 2) continue;
      // weight each option by the difficulty's army mix; the civilization's unique unit is favoured
      const opts = g.trainsFor(b), uniq = g.civ[this.team].unique?.type, w = t => (this.D.mix[UD[t].cls] || 0) * (t === uniq ? 2.5 : 1);
      let pick = null, r = Math.random() * opts.reduce((s2, t) => s2 + w(t), 0);
      for (const t of opts) { r -= w(t); if (r <= 0) { pick = t; break; } }
      if (pick) g.train(b, pick);
    }
    // defence: enemies near our base
    const threat = g.nearestEnemy({ x: hall.x, z: hall.z, team: this.team }, 22, false);
    if (threat) for (const u of [...mil, ...this.my(u => u.type === 'hero')]) if (u.task.type === 'idle' || u.task.type === 'move') g.amove(u, threat.x, threat.z);
    // attack waves
    if (time >= this.nextAttack && mil.length >= 4) {
      this.nextAttack = time + this.D.every; this.wave++;
      const tgt = this.attackTarget(hall);
      if (tgt) { for (const u of mil) g.amove(u, tgt.x, tgt.z); if (this.wave >= 2) { const h = this.my(u => u.type === 'hero')[0]; if (h) g.amove(h, tgt.x, tgt.z); } g.toast('The enemy army is marching on you!'); }
    }
    // keep attackers moving after they win a fight
    for (const u of mil) if (u.task.type === 'idle' && dist(u, hall) > 30) { const t = this.attackTarget(u); if (t) g.amove(u, t.x, t.z); }
  }

  // ---------- battle: just fight ----------
  battle() {
    const g = this.g, mine = this.my(), foes = g.units.filter(u => u.alive && u.team !== this.team);
    if (!mine.length || !foes.length) return;
    const cx = mine.reduce((s, u) => s + u.x, 0) / mine.length, cz = mine.reduce((s, u) => s + u.z, 0) / mine.length;
    const close = foes.some(f => Math.hypot(f.x - cx, f.z - cz) < 30);
    if (!this.engaged && (close || g.time > 25)) { this.engaged = true; g.toast('The enemy advances!'); }
    if (!this.engaged) return;
    for (const u of mine) if (u.task.type === 'idle') { let t = null, bd = 1e9; for (const f of foes) { const d = dist(f, u); if (d < bd) { bd = d; t = f; } } if (t) g.amove(u, t.x, t.z); }
  }

  // ---------- survival: waves ----------
  survival() {
    const g = this.g;
    if (this.wave < 10 && g.time >= this.nextWave) {
      this.wave++; this.nextWave = g.time + 70 + this.wave * 4;
      const n = Math.round((3 + this.wave * 2.2) * this.D.waveMul), B = BASES[1];
      for (let i = 0; i < n; i++) {
        const r = Math.random(); let type = 'sword';
        if (this.wave >= 2 && r < .3) type = 'spear'; if (this.wave >= 3 && r > .62) type = r > .75 ? 'crossbow' : 'archer';
        if (this.wave >= 4 && r > .82) type = r > .9 ? 'lightcav' : 'horsearcher'; if (this.wave >= 6 && r > .92) type = 'knight';
        if (this.wave >= 5 && i < this.wave - 4 && i < 3) type = g.civ[this.team].unique.type;
        if (this.wave >= 7 && i === n - 1) type = 'catapult';
        const u = g.spawnUnit(this.team, type, B.x + (i % 6) * 1.1 - 3, B.z + Math.floor(i / 6) * 1.1);
        const t = this.attackTarget(u); if (t) g.amove(u, t.x, t.z);
      }
      if (this.wave === 5 || this.wave === 10) { const h = g.spawnUnit(this.team, 'hero', B.x, B.z - 2); const t = this.attackTarget(h); if (t) g.amove(h, t.x, t.z); }
      g.recount();
      g.toast(this.wave === 10 ? 'The final wave is here! Hold the line!' : `Wave ${this.wave} of 10 is attacking!`);
      if (this.wave === 10) g.wavesDone = true;
    }
    for (const u of this.my(u => u.task.type === 'idle')) { const t = this.attackTarget(u); if (t) g.amove(u, t.x, t.z); }
    if (g.wavesDone) g.checkEnd();
  }
}
