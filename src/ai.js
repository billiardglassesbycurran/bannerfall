// Enemy AI for each mode.
import { BD, TECH } from './data.js';
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
    this.heroTactics();
    if (this.g.mission?.aiOff) { // campaign missions that script the enemy: troops only defend themselves and charge what they see
      for (const u of this.my(u => u.task.type === 'idle' && u.d.acq && !u.routed)) { let t = null, bd = 22; for (const f of this.g.units) if (f.alive && f.team !== this.team) { const d = dist(f, u); if (d < bd) { bd = d; t = f; } } if (t) this.g.amove(u, t.x, t.z); }
      return;
    }
    if (this.g.mode === 'skirmish') this.skirmish();
    else if (this.g.mode === 'battle') this.battle();
    else this.survival();
  }

  // ---------- the enemy Commander uses War Cry, Charge and Rally too ----------
  heroTactics() {
    const g = this.g; if (g.diff === 0) return; // Easy: no abilities
    for (const h of this.my(u => u.d.hero)) {
      let foes = 0, near = 1e9, routed = 0;
      g.unitsNear(h.x, h.z, 16, o => { if (!o.alive) return; const d = dist(o, h); if (o.team !== this.team && o.d.acq) { if (d < 12) foes++; near = Math.min(near, d); } else if (o.team === this.team && o.routed) routed++; });
      if (routed >= 3) g.useAbility(h, 'rally');
      if (foes >= 4) g.useAbility(h, 'cry');
      if (near > 6 && near < 14 && h.task.type === 'attack') g.useAbility(h, 'charge');
    }
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
    const spot = this.findSpot(type, hall) || this.findSpot(type, hall, 18, 38); if (!spot) return false; // crowded town: build further out
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
    // when it's time to advance an age, save up for it: fewer new peasants/soldiers, more food gathering
    const ageKey = T.age === 0 ? 'feudal' : T.age === 1 ? 'kingdom' : null, ageCost = ageKey && TECH[ageKey].cost;
    const saving = !!ageKey && time > (T.age === 0 ? this.D.a1 : this.D.a2) && !g.queuedTech(this.team, ageKey);
    const short = saving && (T.f < (ageCost.f || 0) || T.g < (ageCost.g || 0));
    if (peas.length < (short ? Math.min(wantPeas, T.age === 0 ? 12 : 18) : wantPeas) && hall.queue.length < 2 && T.pop < T.cap) g.train(hall, 'peasant');
    // gatherer balance
    const count = { f: 0, w: 0, g: 0, s: 0 };
    for (const p of peas) { const tt = p.task; if (tt.type === 'gather') count[tt.res.rt]++; else if (tt.type === 'farm') count.f++; else if (tt.type === 'return' && tt.back?.res) count[tt.back.res.rt]++; }
    const building = t => g.blds.some(b => b.alive && b.team === this.team && b.type === t && !b.built);
    const nOf = t => g.blds.filter(b => b.alive && b.team === this.team && b.type === t).length;
    const hasBarracks = g.blds.some(b => b.alive && b.team === this.team && b.type === 'barracks');
    const want0 = short ? (ageCost.g && T.g < ageCost.g ? { f: .5, w: .15, g: .35 } : { f: .6, w: .35, g: .05 }) : hasBarracks ? (T.age ? { f: .34, w: .38, g: .2, s: .08 } : { f: .4, w: .46, g: .1, s: .04 }) : { f: .5, w: .45, g: .05 };
    const want = { s: 0, ...want0 }; // stone: for towers and stone upgrades
    // react to what's piling up and what's running out: shift workers from a rich resource to a scarce one
    if (!short) { const st = { f: T.f, w: T.w, g: T.g, s: T.s || 0 }; for (const k of ['f', 'w', 'g', 's']) { if (st[k] > 450) want[k] *= .4; if (st[k] < 80 && want[k]) want[k] *= 1.6; } const tot = want.f + want.w + want.g + want.s; for (const k of ['f', 'w', 'g', 's']) want[k] /= tot; }
    if (!short && (this.shiftT = (this.shiftT || 0) + 1) % 20 === 0) {
      const rich = ['f', 'w', 'g', 's'].find(k => T[k] > 450), poor = ['w', 'f', 'g'].find(k => T[k] < 100 && k !== rich);
      if (rich && poor) for (const u of peas.filter(u => (u.task.type === 'gather' && u.task.res.rt === rich) || (rich === 'f' && u.task.type === 'farm')).slice(0, 3)) { if (u.task.type === 'farm' && u.task.b) u.task.b.farmer = null; g.setTask(u, { type: 'idle' }); }
    }
    if (short && (this.rebalT = (this.rebalT || 0) + 1) % 15 === 0) { const wood = peas.filter(u => u.task.type === 'gather' && u.task.res.rt === 'w'); for (const u of wood.slice(0, Math.ceil(wood.length / 3))) g.setTask(u, { type: 'idle' }); } // move some woodcutters to food
    for (const p of peas) {
      if (p.task.type !== 'idle') continue;
      const n = peas.length || 1; let rt = 'f', worst = 1e9;
      for (const k of ['f', 'w', 'g', 's']) { if (!want[k]) continue; const v = count[k] / n - want[k]; if (v < worst) { worst = v; rt = k; } }
      let r = g.nearestRes(hall.x, hall.z, rt, 34);
      if (rt === 'f' && !r) {
        const farm = g.blds.find(b => b.alive && b.built && b.team === this.team && b.type === 'farm' && (!b.farmer || !b.farmer.alive || b.farmer.task.b !== b));
        if (farm) { g.farm(p, farm); count.f++; continue; }
        const farms = nOf('farm');
        if (T.w >= 110 && farms < Math.max(3, peas.length * .4) && this.tryBuild('farm', hall)) { count.f++; continue; } // keep wood for other things
        rt = 'w'; r = g.nearestRes(hall.x, hall.z, 'w', 40);
      }
      if (!r) r = g.nearestRes(p.x, p.z, 'w', 60);
      if (r) { g.gather(p, r); count[r.rt]++; }
    }
    if (T.pop >= T.cap - 3 && T.cap < 100 && !building('house')) this.tryBuild('house', hall);
    if (!hasBarracks && peas.length >= 7) this.tryBuild('barracks', hall);
    // storehouses next to the woods (and later the gold) so workers don't walk back to the Town Hall every trip
    const stores = g.blds.filter(b => b.alive && b.team === this.team && (b.type === 'store' || b.type === 'hall'));
    for (const rt of ['w', 'g', 's']) {
      if (rt !== 'w' && time < 360) continue;
      const r = g.nearestRes(hall.x, hall.z, rt, 70); if (!r || building('store')) continue;
      const near = stores.some(b => Math.hypot(b.x - r.x, b.z - r.z) < 11);
      if (!near && g.afford(this.team, BD.store.cost) && nOf('store') < 3) { const sp = this.findSpot('store', r, 2, 9); if (sp) { const ps = peas.filter(u => u.task.type === 'gather' && u.task.res.rt === rt).sort((a, b) => dist(a, r) - dist(b, r)).slice(0, 2); g.startBuilding(this.team, 'store', sp[0], sp[1], ps.length ? ps : peas.slice(0, 1)); } break; }
    }
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
    if (hasBarracks && time > 260 && nOf('tower') < this.g.diff + 1 && T.g > 120 && g.afford(this.team, BD.tower.cost)) { // towers guard the gold mines and the road in
      const mine = g.nearestRes(hall.x, hall.z, 'g', 30), at = nOf('tower') % 2 === 0 && mine ? mine : this.rally(hall), sp = this.findSpot('tower', at, 3, 12);
      if (sp) { const ps = this.my(u => u.type === 'peasant').sort((a, b) => dist(a, at) - dist(b, at)).slice(0, 2); g.startBuilding(this.team, 'tower', sp[0], sp[1], ps); }
    }
    if ((time > 480 || (T.f > 600 && T.w > 200)) && nOf('barracks') < 1 + this.g.diff) this.tryBuild('barracks', hall);
    // training military
    const threatNear = g.nearestEnemy({ x: hall.x, z: hall.z, team: this.team }, 26, false);
    if (T.pop < T.cap && (!short || threatNear)) for (const b of g.blds) {
      if (!b.alive || !b.built || b.team !== this.team || !b.d.trains || b.type === 'hall' || b.queue.length >= (T.f > 500 && T.g > 200 ? 4 : 2)) continue;
      // weight each option by the difficulty's army mix; the civilization's unique unit is favoured
      const opts = g.trainsFor(b).filter(t => g.ageOK(this.team, UD[t])), uniq = g.civ[this.team].unique?.type, w = t => (this.D.mix[UD[t].cls] || 0) * (t === uniq ? 2.5 : 1) * (g.diff >= 1 ? this.counterW(t) : 1) * (t === 'lightcav' && this.wantRaiders ? 2 : 1);
      // pick by weight (with some chance); if the best choice is too expensive right now, try the next one
      const ranked = opts.map(t => [t, w(t) * (.6 + Math.random() * .8)]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
      if (b.type === 'stable' && this.wantRaiders && g.diff >= 1 && this.my(u => u.type === 'lightcav' || u.type === 'horsearcher').length < 3 && opts.includes('lightcav') && g.train(b, 'lightcav') === 'ok') continue; // keep a few raiders
      for (const [t] of ranked) if (g.train(b, t) === 'ok') break;
    }
    // advance through the ages, then research upgrades while keeping a reserve
    if (saving && peas.length >= (T.age === 0 ? 7 : 12)) g.research(hall, ageKey);
    if (!short && !g.queuedTech(this.team, 'feudal') && !g.queuedTech(this.team, 'kingdom') && (this.techT = (this.techT || 0) + 1) % 6 === 0) {
      const pri = ['watch', 'wheelbarrow', 'axe', 'forging', 'fletching', 'chainmail', 'goldmining', 'plough', 'veterans', 'masonry', 'handcart', 'ironcast', 'bodkin', 'plate', 'pikemen', 'marksmen', 'chivalry', 'elite', 'guardtower', 'fortify', 'gillnets', 'careening'];
      outer: for (const k of pri) for (const b of g.blds) if (b.alive && b.built && b.team === this.team && b.queue.length === 0 && g.techsFor(b).includes(k)) {
        const c = TECH[k].cost; if (T.f >= (c.f || 0) + 150 && T.w >= (c.w || 0) + 80 && T.g >= (c.g || 0) + 60 && g.research(b, k) === 'ok') break outer;
      }
    }
    if (time > 280 && nOf('smith') === 0 && T.age >= 1) this.tryBuild('smith', hall);
    this.defend(hall, mil);
    this.army(hall, mil);
    if (g.diff >= 1) { this.raid(hall); this.scout(hall); }
  }

  // ---------- smarter skirmish helpers ----------
  /** Rough fighting strength of a group of units. */
  power(list) { let p = 0; for (const u of list) if (u.alive && u.d.dmg > 0 && u.type !== 'peasant') p += (u.hp / 100) * (u.d.dmg / u.d.cd) * (u.d.ranged ? 1.1 : 1) + (u.d.hero ? 4 : 0); return p; }
  foeMil() { return this.g.units.filter(u => u.alive && u.team !== this.team && u.d.acq && u.type !== 'peasant' && !u.d.ship); }
  /** Favour units that beat what the player is fielding (spears vs riders, light cavalry vs archers, ...). */
  counterW(t) {
    if (!this.mixT || this.g.time - this.mixT > 10) { // what the player's army is made of, refreshed every 10 s
      const f = this.foeMil(), n = f.length || 1, c = { cav: 0, arch: 0, sword: 0, spear: 0, siege: 0 };
      for (const u of f) { if (u.d.stone) c.siege++; else if (u.d.horse && !u.d.hero) c.cav++; else if (u.d.ranged) c.arch++; else if (u.d.vsHorse) c.spear++; else c.sword++; }
      for (const k in c) c[k] /= n; this.foeMix = c; this.mixT = this.g.time;
    }
    const c = this.foeMix, d = UD[t]; let m = 1;
    if (d.vsHorse) m += c.cav * 3;                                     // spears stop cavalry
    if (d.horse && !d.ranged) m += c.arch * 2.2 + c.siege * 2;         // riders run down archers and catapults
    if (d.ranged && !d.horse) m += c.sword * 1.4 + c.spear * 1.6;       // arrows thin out slow infantry
    if (!d.ranged && !d.horse && !d.vsHorse) m += c.spear * 1.6;        // swordsmen beat spearmen
    if (d.ranged && !d.horse) m -= c.cav * .5;                          // archers fear cavalry
    return Math.max(.25, m);
  }
  rally(hall) { // a gathering point in front of our town, toward the enemy
    const e = this.g.blds.find(b => b.alive && b.team !== this.team && b.type === 'hall') || { x: 64, z: 64 };
    return { x: hall.x + (e.x - hall.x) * .28, z: hall.z + (e.z - hall.z) * .28 };
  }
  /** Enemies at the gates: everyone fights; on Warlord the peasants shelter if it's bad. */
  defend(hall, mil) {
    const g = this.g, threats = g.units.filter(u => u.alive && u.team !== this.team && u.d.acq && Math.hypot(u.x - hall.x, u.z - hall.z) < 24);
    if (threats.length) {
      this.calmT = 0; const t = threats[0];
      for (const u of [...mil, ...this.my(u => u.type === 'hero')]) if (!u.raider && (u.task.type === 'idle' || u.task.type === 'move' || dist(u, hall) < 35) && u.task.type !== 'attack') g.amove(u, t.x, t.z);
      if (g.diff >= 2 && !this.belled && this.power(threats) > this.power(mil) * 1.3 + 2) { this.belled = true; g.ringBell(this.team); }
    } else if (this.belled && (this.calmT = (this.calmT || 0) + 1) > 10) { this.belled = false; for (const b of g.blds) if (b.alive && b.team === this.team && b.cargo?.length) g.ungarrison(b); }
  }
  /** The main army: gather, attack when strong enough (the weakest spot), fall back when losing. */
  army(hall, mil) {
    const g = this.g, time = g.time, R = this.rally(hall);
    const fast = g.diff >= 1 && this.wantRaiders ? mil.filter(u => u.type === 'lightcav' || u.type === 'horsearcher').slice(0, 4) : [];
    const army = mil.filter(u => !u.raider && !u.scout && !u.d.ship && !fast.includes(u)); // a few riders stay back for raids
    if (!this.attacking) {
      for (const u of army) if (u.task.type === 'idle' && Math.hypot(u.x - R.x, u.z - R.z) > 7) g.amove(u, R.x + (Math.random() - .5) * 6, R.z + (Math.random() - .5) * 6);
      if (time < this.nextAttack || army.length < 4) return;
      const mine = this.power(army), theirs = this.power(this.foeMil());
      if (!this.waitFrom) this.waitFrom = time;
      if (g.diff >= 1 && mine < theirs * (g.diff >= 2 ? 1.0 : 1.15) && time - this.waitFrom < 150) { this.nextAttack = time + 25; return; } // not strong enough yet: wait (at most 2½ min) and build up
      this.waitFrom = 0;
      this.attacking = true; this.wave++; this.nextAttack = time + this.D.every;
      this.target = g.diff >= 1 ? this.weakSpot(hall) : this.attackTarget(hall);
      if (this.wave >= 2) for (const h of this.my(u => u.type === 'hero')) h.inArmy = true;
      g.toast('The enemy army is marching on you!');
    }
    const force = [...army, ...this.my(u => u.type === 'hero' && u.inArmy)];
    if (!force.length) { this.attacking = false; return; }
    if (!this.target?.alive) this.target = g.diff >= 1 ? this.weakSpot(hall) : this.attackTarget(hall);
    if (!this.target) { this.attacking = false; return; }
    // losing badly near the fight? fall back to regroup (not on Squire)
    const C = { x: force.reduce((a, u) => a + u.x, 0) / force.length, z: force.reduce((a, u) => a + u.z, 0) / force.length };
    const near = this.foeMil().filter(u => Math.hypot(u.x - C.x, u.z - C.z) < 16);
    if (g.diff >= 1 && near.length >= 3 && this.power(force) < this.power(near) * .45) {
      this.attacking = false; this.nextAttack = time + 45;
      for (const u of force) { u.inArmy = false; if (!u.routed) g.moveTo(u, R.x + (Math.random() - .5) * 6, R.z + (Math.random() - .5) * 6); }
      if (this.team === 1) g.toast('The enemy falls back to regroup!', 2.5); return;
    }
    if ((this.armyT = (this.armyT || 0) + 1) % 4 === 0) this.lineTo(force, this.target);
    for (const u of force) if (u.task.type === 'idle' && !u.routed) g.amove(u, this.target.x, this.target.z);
  }
  /** The player's most exposed building: far from their soldiers and towers, near our army's path. */
  weakSpot(hall) {
    const g = this.g, foes = this.foeMil(); let best = null, bs = 1e9;
    for (const b of g.blds) if (b.alive && b.team !== this.team && !b.d.wall) {
      let def = 0; for (const f of foes) if (Math.hypot(f.x - b.x, f.z - b.z) < 14) def += f.hp / 100;
      for (const o of g.blds) if (o.alive && o.team === b.team && (o.d.atk) && Math.hypot(o.x - b.x, o.z - b.z) < 12) def += o.type === 'hall' ? 3 : 4;
      const sc = def * 3 + Math.hypot(b.x - hall.x, b.z - hall.z) / 12 - (b.type === 'hall' ? 2 : 0);
      if (sc < bs) { bs = sc; best = b; }
    }
    return best;
  }
  /** March in a battle line: infantry front, archers behind, siege at the back, riders on the wings. */
  lineTo(force, obj) {
    const g = this.g, busy = u => u.routed || (u.task.type === 'attack' && u.task.t.alive && dist(u, u.task.t) < 14);
    const melee = force.filter(u => !u.d.ranged && !u.d.horse), M = melee.length ? melee : force;
    const Mx = M.reduce((a, u) => a + u.x, 0) / M.length, Mz = M.reduce((a, u) => a + u.z, 0) / M.length;
    let dx = obj.x - Mx, dz = obj.z - Mz; const L = Math.hypot(dx, dz) || 1; if (L < 10) { for (const u of force) if (!busy(u)) g.amove(u, obj.x, obj.z); return; }
    dx /= L; dz /= L; const px = -dz, pz = dx, step = Math.min(12, L), fx = Mx + dx * step, fz = Mz + dz * step;
    const place = (list, back, wide) => { const free = list.filter(u => !busy(u)); free.forEach((u, i) => { const c = wide ? (i % 2 ? -1 : 1) * (5 + (i >> 1) * 1.3) : i % 10 - (Math.min(10, free.length) - 1) / 2, r = wide ? 0 : i / 10 | 0; g.amove(u, fx + px * c * 1.25 - dx * (back + r * 1.4), fz + pz * c * 1.25 - dz * (back + r * 1.4)); }); };
    place(melee.filter(u => !u.d.hero), 0); place(force.filter(u => u.d.ranged && !u.d.horse && !u.d.stone), 4.5); place(force.filter(u => u.d.stone), 9);
    place(force.filter(u => u.d.horse && !u.d.hero), 0, true); for (const h of force.filter(u => u.d.hero)) if (!busy(h)) g.amove(h, fx - dx * 2.5, fz - dz * 2.5);
  }
  /** Fast riders hit the player's woodcutters and miners, then run before soldiers arrive. */
  raid(hall) {
    const g = this.g, time = g.time;
    this.wantRaiders = time > 280;
    const raiders = this.my(u => u.raider);
    if (raiders.length) {
      for (const u of raiders) {
        const def = g.units.some(f => f.alive && f.team !== this.team && f.d.acq && f.type !== 'peasant' && Math.hypot(f.x - u.x, f.z - u.z) < 9);
        if (u.hp < u.maxHp * .45 || def || time > this.raidEnd) { u.raider = false; g.moveTo(u, hall.x + 4, hall.z - 4); continue; } // run home
        if (u.task.type === 'idle' || (u.task.type === 'attack' && !u.task.t.alive)) { const p = this.softPeasant(u); if (p) g.attack(u, p); else { u.raider = false; } }
      }
      return;
    }
    if (time < (this.nextRaid ?? 300)) return;
    const fast = this.my(u => (u.type === 'lightcav' || u.type === 'horsearcher') && !u.scout && u.task.type !== 'attack' && u.hp > u.maxHp * .7);
    if (fast.length < 3) { this.nextRaid = time + 20; return; }
    const group = fast.slice(0, Math.min(5, 2 + g.diff)), first = this.softPeasant(group[0]);
    if (!first) { this.nextRaid = time + 40; return; }
    for (const u of group) { u.raider = true; g.attack(u, first); }
    this.raidEnd = time + 45; this.nextRaid = time + 130 - g.diff * 20;
  }
  /** A player peasant working far from any soldier or tower. */
  softPeasant(from) {
    const g = this.g; let best = null, bs = 1e9;
    for (const p of g.units) if (p.alive && p.team !== this.team && p.type === 'peasant' && !p.boarded) {
      let guard = 0; for (const f of g.units) if (f.alive && f.team === p.team && f.d.acq && f.type !== 'peasant' && Math.hypot(f.x - p.x, f.z - p.z) < 12) guard++;
      for (const b of g.blds) if (b.alive && b.team === p.team && b.d.atk && Math.hypot(b.x - p.x, b.z - p.z) < 11) guard += 3;
      const sc = guard * 25 + dist(p, from) * .3; if (sc < bs) { bs = sc; best = p; }
    }
    return best;
  }
  /** Send one rider round the player's town early on, to see what they're building. */
  scout(hall) {
    const g = this.g, s = this.my(u => u.scout)[0];
    if (s) { if (s.task.type === 'idle') { const wp = this.scoutPath?.shift(); if (wp) g.moveTo(s, wp.x, wp.z); else { s.scout = false; g.moveTo(s, hall.x, hall.z); } } return; }
    if (this.scouted) return;
    const r = this.my(u => u.d.horse && !u.d.hero && !u.d.ranged)[0]; if (!r) return;
    const e = g.blds.find(b => b.alive && b.team !== this.team && b.type === 'hall'); if (!e) return;
    this.scouted = true; r.scout = true;
    this.scoutPath = [0, 1, 2, 3, 4].map(i => { const a = Math.atan2(hall.z - e.z, hall.x - e.x) + (i - 2) * .9; return { x: Math.max(8, Math.min(120, e.x + Math.cos(a) * 24)), z: Math.max(8, Math.min(120, e.z + Math.sin(a) * 24)) }; });
  }

  // ---------- battle: real tactics ----------
  // Infantry hold a line and advance on the banners, archers stay behind the line, cavalry ride around the flank to
  // hit the enemy's archers, siege stays at the back, the Commander rides just behind the line to inspire it.
  battle() {
    const g = this.g, F = g.field, mine = this.my(u => u.d.acq && !u.d.ship), foes = g.units.filter(u => u.alive && u.team !== this.team && u.d.acq && !u.d.ship);
    if (!mine.length || !foes.length) return;
    const ctr = l => ({ x: l.reduce((s, u) => s + u.x, 0) / l.length, z: l.reduce((s, u) => s + u.z, 0) / l.length });
    const C = ctr(mine), near = (p, l) => { let b = null, bd = 1e9; for (const u of l) { const d = dist(u, p); if (d < bd) { bd = d; b = u; } } return b; };
    if (!this.engaged && (foes.some(f => dist(f, C) < 26) || g.time > 40)) { this.engaged = true; g.toast('The enemy advances!'); }
    const busy = u => u.routed || (u.task.type === 'attack' && u.task.t.alive && dist(u, u.task.t) < 14);
    if (!this.engaged) return;
    if ((this.tick = (this.tick || 0) + 1) % 4) { for (const u of mine) if (u.task.type === 'idle' && !u.routed) { const f = near(u, foes); if (f && dist(f, u) < 25) g.amove(u, f.x, f.z); } return; }
    const role = u => u.d.hero ? 'hero' : u.d.stone ? 'siege' : u.d.horse ? 'cav' : u.d.ranged ? 'ranged' : 'melee';
    const R = { melee: [], ranged: [], cav: [], siege: [], hero: [] }; for (const u of mine) R[role(u)].push(u);
    const M = R.melee.length ? ctr(R.melee) : C;
    let obj = ctr(foes);
    if (F) { const want = F.flags.filter(f => f.own !== this.team).sort((a, b) => dist(a, M) - dist(b, M))[0]; if (want) obj = want; }
    const nf = near(M, foes); if (nf && dist(nf, M) < 20) obj = nf; // the enemy is close: fight them, not the flag
    let dx = obj.x - M.x, dz = obj.z - M.z; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L; const px = -dz, pz = dx;
    const step = Math.min(10, L), fx = M.x + dx * step, fz = M.z + dz * step;
    const line = (list, back) => {
      const free = list.filter(u => !busy(u)).sort((a, b) => ((a.x - M.x) * px + (a.z - M.z) * pz) - ((b.x - M.x) * px + (b.z - M.z) * pz));
      const per = Math.max(8, Math.ceil(free.length / 2));
      free.forEach((u, i) => { const c = i % per - (Math.min(per, free.length) - 1) / 2, r = i / per | 0; g.amove(u, fx + px * c * 1.25 - dx * (back + r * 1.4), fz + pz * c * 1.25 - dz * (back + r * 1.4)); });
    };
    line(R.melee, 0); line(R.ranged, 4.5); line(R.siege, 10);
    for (const h of R.hero) if (!busy(h)) g.amove(h, fx - dx * 2.5, fz - dz * 2.5);
    // cavalry: go around the side and hunt archers (on Easy they just charge in)
    const archers = foes.filter(f => f.d.ranged && !f.d.horse);
    const side = this.flankSide || (this.flankSide = Math.random() < .5 ? 1 : -1);
    for (const u of R.cav) {
      if (busy(u)) continue;
      if (!archers.length || g.diff === 0) { const f = near(u, foes); g.amove(u, f.x, f.z); continue; }
      const A = ctr(archers), wx = A.x + px * side * 13 - dx * 4, wz = A.z + pz * side * 13 - dz * 4;
      if (dist(u, A) > 11 && Math.hypot(u.x - wx, u.z - wz) > 5) g.moveTo(u, wx, wz); else g.attack(u, near(u, archers));
    }
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
