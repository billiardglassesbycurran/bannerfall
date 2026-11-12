// Campaign: four missions with their own goals, set-ups and maps (ported from the original prototype's campaign).
// Missions unlock one after another; progress is kept on this device.
import { BD } from './data.js';
import { MAP } from './world.js';

const hall = (g, t) => g.blds.find(b => b.alive && b.team === t && b.type === 'hall');
const has = (g, t, type) => g.blds.some(b => b.alive && b.team === t && b.type === type && b.built);
/** Remove a team's starting town (used by missions that set up their own enemy). */
function clearTeam(g, t) {
  for (let i = g.units.length - 1; i >= 0; i--) { const u = g.units[i]; if (u.team !== t) continue; u.batch.release(u.slot); u.alive = false; g.units.splice(i, 1); }
  for (let i = g.blds.length - 1; i >= 0; i--) { const b = g.blds[i]; if (b.team !== t) continue; g.unplace(b); g.blds.splice(i, 1); }
  g.T[t].hallLost = false; g.recount();
}
/** First free spot for a building near (x, z). */
function spotNear(g, type, x, z) {
  const s = BD[type].size;
  for (let r = 0; r < 18; r++) for (let a = 0; a < 16; a++) { const cx = Math.round(x + Math.cos(a / 16 * 6.283) * r - s / 2), cz = Math.round(z + Math.sin(a / 16 * 6.283) * r - s / 2); if (g.canPlace(type, cx, cz)) return [cx, cz]; }
  return null;
}
const put = (g, team, type, x, z) => { const p = spotNear(g, type, x, z); return p ? g.placeBuilding(team, type, p[0], p[1], true) : null; };
const ageTo = (g, t, age) => { if (age >= 1) g.applyTech(t, 'feudal'); if (age >= 2) g.applyTech(t, 'kingdom'); };

export const MISSIONS = [
  {
    name: 'I. The Muster', map: 'riverlands', diff: 0, aiOff: true,
    brief: 'Bandits have built a camp across the river and raid our farms. Gather food, build a Barracks and advance to the Feudal Age. Then raise an army, cross the bridge and burn their camp.',
    goals: [
      { t: 'Build a Barracks', done: g => has(g, 0, 'barracks') },
      { t: 'Advance to the Feudal Age', done: g => g.T[0].age >= 1 },
      { t: 'Train 5 soldiers', done: g => g.ms.trained >= 5 },
      { t: 'Destroy the bandit camp', done: g => g.ms.camp.every(b => !b.alive) },
    ],
    setup(g) {
      Object.assign(g.T[0], { f: 250, w: 320, g: 150 }); clearTeam(g, 1);
      g.ms = { trained: 0, camp: [] };
      const c = put(g, 1, 'barracks', 92, 40); if (c) { c.maxHp = c.hp = 600; g.ms.camp.push(c); }
      const t = put(g, 1, 'tower', 86, 46); if (t) g.ms.camp.push(t);
      for (let i = 0; i < 4; i++) g.spawnUnit(1, 'sword', 88 + i, 44);
      for (let i = 0; i < 2; i++) g.spawnUnit(1, 'archer', 89 + i, 46);
      g.onTrained2 = u => { if (u.team === 0 && u.type !== 'peasant') g.ms.trained++; };
    },
    tick(g) { // a small raid now and then keeps you on your toes
      if (!g.ms.raid && g.time > 300) { g.ms.raid = 1; const h = hall(g, 0); if (h) for (let i = 0; i < 3; i++) { const u = g.spawnUnit(1, 'sword', 96 + i, 30); g.amove(u, h.x, h.z); } g.toast('Bandits are raiding your village!', 3); }
    },
  },
  {
    name: 'II. Hold the Ford', map: 'riverlands', diff: 1, aiOff: true,
    brief: 'The Warlord\'s raiders cross the river in waves. Build walls, gates and towers, and keep your Town Hall standing until the relief army arrives in 8 minutes.',
    goals: [
      { t: 'Survive until relief arrives', done: g => g.time >= 480, timer: g => Math.max(0, 480 - g.time) },
      { t: 'Keep your Town Hall standing', done: g => !!hall(g, 0) },
    ],
    setup(g) {
      Object.assign(g.T[0], { f: 400, w: 700, g: 350 }); clearTeam(g, 1); ageTo(g, 0, 1);
      const h = hall(g, 0); put(g, 0, 'barracks', h.x + 9, h.z - 6);
      for (let i = 0; i < 3; i++) g.spawnUnit(0, 'sword', h.x + 9 + i, h.z - 10);
      g.ms = { next: 50, wave: 0 };
    },
    tick(g) {
      if (g.time >= g.ms.next && g.time < 470) {
        const h = hall(g, 0); if (!h) return;
        g.ms.wave++; g.ms.next = g.time + 60;
        const n = Math.round(2 + g.ms.wave * 1.6), spawns = [[108, 30], [96, 14], [114, 48]];
        for (let i = 0; i < n; i++) {
          const s = spawns[i % 3], r = Math.random(), ty = g.ms.wave >= 4 && r < .2 ? 'knight' : r < .5 ? 'sword' : r < .75 ? 'spear' : 'archer';
          const u = g.spawnUnit(1, ty, s[0] + (i % 2), s[1] + (i / 3 | 0)); g.amove(u, h.x + (Math.random() - .5) * 6, h.z + (Math.random() - .5) * 6);
        }
        if (g.ms.wave === 6) { const c = g.spawnUnit(1, 'hero', 108, 26); g.amove(c, h.x, h.z); }
        if (g.ms.wave >= 7) { const c = g.spawnUnit(1, 'catapult', 104, 20); g.amove(c, h.x, h.z); }
        g.recount(); g.toast(`Raiders cross the river! Wave ${g.ms.wave} (${n} soldiers)`, 3); g.onAlert?.(spawns[0][0], spawns[0][1]);
      }
      if (g.time >= 480 && !g.ms.relief) { g.ms.relief = 1; const h = hall(g, 0); if (h) for (let i = 0; i < 8; i++) g.spawnUnit(0, 'knight', h.x - 6 + i, h.z + 8); g.toast('The relief army has arrived!', 3); }
    },
  },
  {
    name: 'III. The Highland Pass', map: 'highland', diff: 1,
    brief: 'Watchtowers guard the mountain passes. Build catapults at your Siege Workshop, smash the towers from range, then march on the Warlord\'s Town Hall.',
    goals: [
      { t: 'Destroy the pass towers', done: g => g.ms.towers.every(b => !b.alive) },
      { t: 'Destroy the Warlord\'s Town Hall', done: g => !hall(g, 1) },
    ],
    setup(g, app) {
      Object.assign(g.T[0], { f: 600, w: 700, g: 550 }); ageTo(g, 0, 2); ageTo(g, 1, 2);
      const h = hall(g, 0), eh = hall(g, 1);
      for (const [ty, dx, dz] of [['barracks', 9, -5], ['smith', 1, -10], ['workshop', 10, 4]]) put(g, 0, ty, h.x + dx, h.z + dz);
      put(g, 1, 'barracks', eh.x - 8, eh.z + 3);
      g.ms = { towers: [] };
      for (const [px, pz] of (MAP.ridge?.passes || [[40, 40], [64, 64], [88, 88]])) {
        for (const [ox, oz] of [[5, -2], [2, -5]]) { const t = put(g, 1, 'tower', px + ox, pz + oz); if (t) g.ms.towers.push(t); }
        for (let i = 0; i < 3; i++) g.spawnUnit(1, i ? 'spear' : 'archer', px + 6, pz - 6);
      }
      app.ai.nextAttack = 420;
    },
  },
  {
    name: 'IV. Bannerfall', map: 'forest', diff: 2,
    brief: 'The final battle. The Warlord waits beyond the forest. Defeat him in battle and burn his Town Hall, and the valley is free.',
    goals: [
      { t: 'Defeat the Warlord (the enemy Commander)', done: g => g.ms.warlord },
      { t: 'Destroy the Warlord\'s Town Hall', done: g => !hall(g, 1) },
    ],
    setup(g) { Object.assign(g.T[0], { f: 300, w: 300, g: 150 }); g.ms = { warlord: false }; g.onDeath2 = u => { if (u.team === 1 && u.d.hero) { g.ms.warlord = true; g.toast('The Warlord has fallen!', 3); } }; },
  },
];
for (const m of MISSIONS) m.check = g => !hall(g, 0) ? 'lose' : m.goals.every(x => x.done(g)) ? 'win' : null;

export function progress() { try { return +(localStorage.getItem('bf.campaign') || 0); } catch { return 0; } }
export function saveProgress(n) { try { localStorage.setItem('bf.campaign', String(Math.max(progress(), n))); } catch { /* ignore */ } }
