// Save & resume: the running game is stored on this device (localStorage) and can be continued after a reload.
import { resources, takeRes, MAP } from './world.js';

const KEY = 'bf.save';
const round = v => Math.round(v * 100) / 100;

export function hasSave() { try { return !!localStorage.getItem(KEY); } catch { return false; } }
export function saveInfo() { try { const d = JSON.parse(localStorage.getItem(KEY)); return d && { mode: d.mode, civs: d.civs, time: d.time, map: d.map, seed: d.seed, when: d.when }; } catch { return null; } }
export function clearSave() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }

export function saveGame(app) {
  const g = app.game; if (!g || g.over || app.multi || app.campaign?.noSave || (app.tut && !app.tut.done)) return false;
  const bi = new Map(g.blds.filter(b => b.alive).map((b, i) => [b, i])), ui = new Map(g.units.filter(u => u.alive).map((u, i) => [u, i]));
  const task = u => {
    const t = u.task;
    if (t.type === 'gather' && t.res?.alive) return { type: 'gather', res: t.res.id };
    if ((t.type === 'build' || t.type === 'repair' || t.type === 'farm') && bi.has(t.b)) return { type: t.type, b: bi.get(t.b) };
    if (t.type === 'move' || t.type === 'amove') return { type: t.type, x: round(t.x), z: round(t.z) };
    return { type: 'idle' };
  };
  const data = {
    v: 1, when: Date.now(), mode: g.mode, diff: g.diff, civs: g.civKeys, map: MAP.id, seed: MAP.seed, time: round(g.time), campaign: app.campaign?.id ?? null,
    T: g.T.map(T => ({ f: T.f | 0, w: T.w | 0, g: T.g | 0, age: T.age, techs: [...T.techs], carry: T.carry, gm: T.gm, fish: T.fish, farm: T.farm, bldHp: T.bldHp, hallLost: T.hallLost })),
    res: resources.map(r => [r.id, Math.round(r.alive ? r.amt : 0)]),
    blds: g.blds.filter(b => b.alive).map(b => ({ type: b.type, team: b.team, cx: b.cx, cz: b.cz, built: b.built, progress: round(b.progress), hp: Math.round(b.hp), food: Math.round(b.food || 0), queue: b.queue.map(q => ({ ...q, t: round(q.t) })), rally: b.rally ? { x: round(b.rally.x), z: round(b.rally.z) } : null })),
    units: g.units.filter(u => u.alive).map(u => ({ type: u.type, team: u.team, x: round(u.boarded ? u.boarded.x : u.x), z: round(u.boarded ? u.boarded.z : u.z), yaw: round(u.yaw), hp: Math.round(u.hp), stance: u.stance || null, carry: u.carry, task: task(u), hero: u === g.hero, vet: u.vet || 0, kills: u.kills || 0 })),
    ai: app.ai ? { nextAttack: app.ai.nextAttack, wave: app.ai.wave, nextWave: app.ai.nextWave, noDock: app.ai.noDock || false, engaged: app.ai.engaged || false } : null,
    heroRespawn: g.heroRespawn || 0, field: g.field ? g.field.save() : null, fow: g.fow?.save() ?? null, cam: { x: round(app.rts.focus.x), z: round(app.rts.focus.z), yaw: round(app.rts.yaw), dist: round(app.rts.dist) },
  };
  try { localStorage.setItem(KEY, JSON.stringify(data)); return true; } catch { return false; }
}

export function loadSave() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } }

/** Rebuild a saved game into a freshly created Game (same map, same civs). */
export function applySave(app, d) {
  const g = app.game;
  // world resources
  const amt = new Map(d.res); for (const r of resources) { const a = amt.get(r.id); if (a === undefined) continue; if (a <= 0) { if (r.alive) takeRes(r, r.amt + 1); } else r.amt = a; }
  // remove the starting setup the mode created, then rebuild everything from the save
  for (const u of [...g.units]) { u.batch.release(u.slot); } g.units.length = 0;
  for (const b of [...g.blds]) g.unplace(b); g.blds.length = 0;
  d.T.forEach((T, i) => Object.assign(g.T[i], { ...T, techs: new Set(T.techs) }));
  g.statCache.clear(); g.time = d.time;
  const blds = d.blds.map(s => { const b = g.placeBuilding(s.team, s.type, s.cx, s.cz, s.built); Object.assign(b, { progress: s.progress, hp: s.hp, food: s.food, queue: s.queue, rally: s.rally }); g.setBuildVisual(b); return b; });
  const byId = new Map(resources.map(r => [r.id, r]));
  for (const s of d.units) {
    const u = g.spawnUnit(s.team, s.type, s.x, s.z); Object.assign(u, { yaw: s.yaw, hp: Math.min(s.hp, u.maxHp), stance: s.stance, carry: s.carry, vet: s.vet, kills: s.kills });
    if (s.hero) g.hero = u;
    const t = s.task;
    if (t.type === 'gather' && byId.get(t.res)?.alive) g.gather(u, byId.get(t.res));
    else if (t.type === 'build' && blds[t.b]) g.build(u, blds[t.b]);
    else if (t.type === 'repair' && blds[t.b]) g.setTask(u, { type: 'repair', b: blds[t.b] });
    else if (t.type === 'farm' && blds[t.b]) g.farm(u, blds[t.b]);
    else if (t.type === 'move' || t.type === 'amove') g.setTask(u, { type: t.type, x: t.x, z: t.z });
  }
  if (d.field && g.field) g.field.load(d.field);
  if (d.fow && g.fow) g.fow.load(d.fow);
  g.heroRespawn = d.heroRespawn; if (!g.hero) g.hero = { alive: false };
  for (const t of [0, 1]) g.refreshLooks(t);
  if (d.ai && app.ai) Object.assign(app.ai, d.ai);
  g.recount();
  if (d.cam) { app.rts.lookAt(d.cam.x, d.cam.z); app.rts.yaw = d.cam.yaw; app.rts.dist = app.rts.distT = d.cam.dist; }
}
