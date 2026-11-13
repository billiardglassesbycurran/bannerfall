// Online play for two: one player hosts (their device runs the real game), the other joins with a short code.
// Devices connect directly over WebRTC using PeerJS (free public matchmaking server, loaded only when needed).
// The host sends the guest a picture of the battlefield ten times a second; the guest's orders travel back
// and are carried out on the host. On the guest's screen the teams are swapped, so they always play as "team 0".
import { resources, takeRes, animals } from './world.js';

const PEERJS = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js';
const CODE_CH = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const newCode = () => Array.from({ length: 5 }, () => CODE_CH[Math.random() * CODE_CH.length | 0]).join('');
let peerLib = null;
function loadPeer() {
  if (peerLib) return peerLib;
  return (peerLib = new Promise((ok, bad) => { if (window.Peer) return ok(window.Peer); const s = document.createElement('script'); s.src = PEERJS; s.onload = () => ok(window.Peer); s.onerror = () => bad(new Error('Could not load the online-play library. Check your internet connection.')); document.head.appendChild(s); }));
}

/** A connection to the other player. Messages are small JSON objects { k: kind, ... }. */
export class Link {
  constructor() { this.h = {}; this.conn = null; this.peer = null; }
  on(k, fn) { this.h[k] = fn; return this; }
  emit(k, d) { this.h[k]?.(d); }
  send(m) { if (this.conn?.open) this.conn.send(m); }
  wire(conn) {
    this.conn = conn;
    conn.on('open', () => this.emit('open'));
    conn.on('data', m => this.emit(m.k, m));
    conn.on('close', () => this.emit('close')); conn.on('error', () => this.emit('close'));
  }
  /** Test mode (?loop in the address): two tabs of the same browser talk through a BroadcastChannel instead of WebRTC. */
  loop(code, role) {
    const ch = new BroadcastChannel('bf-' + code), me = Math.random(); let open = false;
    this.conn = { get open() { return open; }, send: m => ch.postMessage({ from: me, m }), close: () => ch.close() };
    ch.onmessage = e => { const { from, m } = e.data; if (from === me) return; if (m.k === '_hi') { if (!open) { open = true; ch.postMessage({ from: me, m: { k: '_hi' } }); this.emit(role === 'host' ? 'guest' : 'open'); } return; } this.emit(m.k, m); };
    if (role === 'guest') ch.postMessage({ from: me, m: { k: '_hi' } });
    return new Promise(ok => { if (role === 'host') ok(code); else { const t = setInterval(() => { if (open) { clearInterval(t); ok(); } }, 50); } });
  }
  async host(code) {
    if (/[?&]loop/.test(location.search)) return this.loop(code, 'host');
    const Peer = await loadPeer();
    return new Promise((ok, bad) => {
      const p = this.peer = new Peer('bannerfall-' + code);
      p.on('open', () => ok(code));
      p.on('connection', c => { if (this.conn?.open) this.conn.close(); this.wire(c); c.on('open', () => this.emit('guest')); });
      p.on('error', e => bad(new Error(e.type === 'unavailable-id' ? 'That code is busy, try again.' : 'Online play is unavailable right now (' + e.type + ').')));
    });
  }
  async join(code) {
    if (/[?&]loop/.test(location.search)) return this.loop(code.toUpperCase(), 'guest');
    const Peer = await loadPeer();
    return new Promise((ok, bad) => {
      const p = this.peer = new Peer();
      p.on('open', () => { const c = p.connect('bannerfall-' + code.toUpperCase(), { reliable: true }); this.wire(c); c.on('open', () => ok()); setTimeout(() => { if (!c.open) bad(new Error('No game found with that code. Check it and that your friend is hosting.')); }, 12000); });
      p.on('error', e => bad(new Error(e.type === 'peer-unavailable' ? 'No game found with that code.' : 'Online play is unavailable right now (' + e.type + ').')));
    });
  }
  close() { try { this.conn?.close(); this.peer?.destroy(); } catch { /* ignore */ } }
}

// ---------- references to game objects travel as ids ----------
const ref = x => {
  if (x == null || typeof x !== 'object') return x;
  if (Array.isArray(x)) return x.map(ref);
  if (x.kind === 'unit') return { $u: x.id };
  if (x.kind === 'bld') return x.pending ? { $c: x.pending } : { $b: x.id };
  if (x.kind === 'res') return { $r: x.id };
  if (x.isVector3) return { x: x.x, y: x.y, z: x.z };
  const o = {}; for (const k in x) o[k] = ref(x[k]); return o;
};
function deref(g, x) {
  if (x == null || typeof x !== 'object') return x;
  if (Array.isArray(x)) return x.map(v => deref(g, v));
  if ('$u' in x) return g.units.find(u => u.id === x.$u) || null;
  if ('$b' in x) return g.blds.find(b => b.id === x.$b) || null;
  if ('$c' in x) return g.blds.find(b => b.alive && b.cx === x.$c[0] && b.cz === x.$c[1]) || null;
  if ('$r' in x) return resources.find(r => r.id === x.$r) || null;
  const o = {}; for (const k in x) o[k] = deref(g, x[k]); return o;
}
// methods the guest's buttons and orders call; they run on the host instead (team-number arguments get swapped)
const RPC = ['setTask', 'gather', 'damage', 'shoot', 'useAbility', 'setMount', 'sendPeasants', 'startBuilding', 'unloadAt', 'train', 'research', 'ringBell',
  'formation', 'farm', 'command', 'cancelTrain', 'build', 'amove', 'moveTo', 'attack', 'ungarrison'];
const TEAM_ARG = { sendPeasants: 0, startBuilding: 0, ringBell: 0 };
// which argument is "the thing doing it" (must belong to the guest)
const SUBJ = { damage: 2, shoot: 0 };

// ---------- host ----------
export class HostSync {
  constructor(app, link) {
    this.a = app; this.l = link; this.t = 0; this.fx = []; this.resSent = new Map();
    const g = app.game, oh = g.onHit, os = g.onShoot;
    g.onHit = (t, src, amt) => { oh?.(t, src, amt); if (t.kind === 'unit') this.fx.push(['h', +t.x.toFixed(1), +t.z.toFixed(1), (t.d.arm || 0) >= 2 ? 1 : 0]); };
    g.onShoot = (src, kind) => { os?.(src, kind); };
    const shoot = g.shoot.bind(g); g.shoot = (src, t, dmg, from) => { shoot(src, t, dmg, from); if (src && t) this.fx.push(['s', src.id, t.kind === 'unit' ? t.id : -t.id]); };
    link.on('rpc', m => this.rpc(m)).on('pov', m => this.pov(m));
  }
  rpc({ fn, args }) {
    const g = this.a.game; if (!RPC.includes(fn) || g.over) return;
    args = deref(g, args); if (fn in TEAM_ARG) args[TEAM_ARG[fn]] = 1;
    const s = args[SUBJ[fn] ?? 0], own = v => !v || (Array.isArray(v) ? v.every(own) : v.team === 1 || v.kind === 'res');
    if (!(fn in TEAM_ARG) && !own(s)) return; // only the guest's own troops and buildings
    if (fn === 'command' || fn === 'formation') args[0] = (args[0] || []).filter(Boolean);
    try { g[fn](...args); } catch (e) { console.warn('rpc', fn, e); }
  }
  pov({ id, on, x, z, yaw }) {
    const u = this.a.game.units.find(u => u.id === id && u.team === 1); if (!u) return;
    u.possessed = !!on; if (on) { u.x = x; u.z = z; u.yaw = yaw; u.speedNow = Math.min(u.d.spd, Math.hypot(x - (u.lx ?? x), z - (u.lz ?? z)) * 10); u.lx = x; u.lz = z; this.a.game.setTask(u, { type: 'idle' }); }
  }
  update(dt) {
    if ((this.t += dt) < .1) return; this.t = 0;
    const g = this.a.game, sw = t => 1 - t;
    const T = [g.T[1], g.T[0]].map(T => ({ ...T, techs: [...T.techs] }));
    const u = g.units.map(u => [u.id, u.type, sw(u.team), +u.x.toFixed(2), +u.z.toFixed(2), +u.yaw.toFixed(2), Math.round(u.hp), Math.round(u.maxHp), +u.speedNow.toFixed(1), +Math.min(u.swingT, 9).toFixed(2),
      (u.dead ? 1 : 0) | (u.routed ? 2 : 0) | (u.boarded ? 4 : 0) | (u.inspired ? 8 : 0), +(u.aimK || 0).toFixed(2), +(u.drawK || 0).toFixed(2), Math.round(u.morale ?? 100), u.vet || 0, u.kills || 0,
      u.task.type, u.task.res?.id ?? (u.task.b?.id ?? 0), u.carry ? [u.carry.rt, Math.round(u.carry.amt)] : 0, u.cargo?.length || 0]);
    const b = g.blds.filter(b => b.alive).map(b => [b.id, b.type, sw(b.team), b.cx, b.cz, b.built ? 1 : 0, +b.progress.toFixed(3), Math.round(b.hp), Math.round(b.maxHp), b.queue.map(q => [q.type || '', q.tech || '', +q.t.toFixed(2)]), b.cargo?.length || 0]);
    const r = []; for (const x of resources) { const a = x.alive ? Math.round(x.amt) : 0; if (this.resSent.get(x.id) !== a) { this.resSent.set(x.id, a); r.push([x.id, a]); } }
    const an = animals.filter(a => a.alive).map(a => [a.id, +a.x.toFixed(2), +a.z.toFixed(2), +a.yaw.toFixed(2), a.hp, a.moving ? 1 : 0]);
    this.l.send({ k: 'snap', t: +g.time.toFixed(2), env: g.env, T, u, b, r, an, fx: this.fx.splice(0), over: g.over ? (g.over === 'win' ? 'lose' : 'win') : null });
  }
}

// ---------- guest ----------
export class GuestSync {
  constructor(app, link) {
    this.a = app; this.l = link; this.povT = 0;
    const g = app.game; g.puppet = true; g.checkEnd = () => {}; g._shoot = g.shoot.bind(g);
    // start from an empty field: everything arrives from the host
    for (const u of g.units) u.batch.release(u.slot); g.units.length = 0; for (const b of g.blds) g.unplace(b); g.blds.length = 0; g.hero = { alive: false };
    for (const fn of RPC) g[fn] = (...args) => this.call(fn, args);
    link.on('snap', m => this.apply(m));
  }
  call(fn, args) {
    const g = this.a.game;
    if (fn === 'startBuilding') { // check locally so the buttons can say "can't build there"
      const [, type, cx, cz] = args; if (!g.canPlace(type, cx, cz) && !(type === 'gate' && g.gateSpot(0, cx, cz))) return null;
      this.l.send({ k: 'rpc', fn, args: ref(args) }); return { kind: 'bld', pending: [cx, cz], type };
    }
    this.l.send({ k: 'rpc', fn, args: ref(args) });
    return fn === 'train' || fn === 'research' ? 'ok' : true;
  }
  /** Tell the host where the unit I'm playing as is (3rd person). */
  update(dt) {
    const pov = this.a.pov, u = this.a.mode === 'pov' ? pov.unit : null;
    if ((this.povT += dt) >= .1) { this.povT = 0; if (u) this.l.send({ k: 'pov', id: u.id, on: 1, x: +u.x.toFixed(2), z: +u.z.toFixed(2), yaw: +u.yaw.toFixed(2) }); else if (this.lastPov) this.l.send({ k: 'pov', id: this.lastPov, on: 0 }); this.lastPov = u?.id || 0; }
    const g = this.a.game, k = Math.min(1, dt * 9); // glide between pictures from the host
    for (const v of g.units) if (v.nx !== undefined && !v.possessed) { v.x += (v.nx - v.x) * k; v.z += (v.nz - v.z) * k; v.yaw += ((((v.nyaw - v.yaw) % 6.283) + 9.425) % 6.283 - 3.1416) * k; }
  }
  apply(m) {
    const g = this.a.game; if (!g) return;
    g.time = m.t; Object.assign(g.env, m.env);
    m.T.forEach((T, i) => Object.assign(g.T[i], { ...T, techs: new Set(T.techs) }));
    if (m.T[0].age !== this.age0) { this.age0 = m.T[0].age; g.refreshLooks(0); g.figures.setAge(0, m.T[0].age); } if (m.T[1].age !== this.age1) { this.age1 = m.T[1].age; g.refreshLooks(1); g.figures.setAge(1, m.T[1].age); }
    // resources
    for (const [id, x, z, yaw, hp, mv] of m.an || []) { const a = animals.find(a => a.id === id); if (a) Object.assign(a, { x, z, yaw, hp, moving: !!mv, y: undefined }); }
    for (const [id, a] of m.r) { const r = resources.find(r => r.id === id); if (!r) continue; if (a <= 0 && r.alive) takeRes(r, r.amt + 1); else r.amt = a; }
    // buildings
    const seenB = new Set();
    for (const [id, type, team, cx, cz, built, progress, hp, maxHp, queue, cargo] of m.b) {
      seenB.add(id); let b = g.blds.find(x => x.id === id);
      if (!b) { b = g.placeBuilding(team, type, cx, cz, !!built); b.id = id; }
      const wasBuilt = b.built; Object.assign(b, { built: !!built, progress, hp, maxHp, queue: queue.map(([type, tech, t]) => (tech ? { tech, t } : { type, t })) });
      b.cargo = b.cargo ? Array(cargo).fill(null) : b.cargo;
      if (!wasBuilt && b.built) { b.mesh.isMesh && g.refreshLooks(b.team); g.onBuilt?.(b); } g.setBuildVisual(b);
    }
    for (const b of [...g.blds]) if (b.alive && !seenB.has(b.id)) g.kill(b);
    // units
    const seenU = new Set();
    for (const row of m.u) {
      const [id, type, team, x, z, yaw, hp, maxHp, spd, swingT, fl, aim, draw, morale, vet, kills, tt, tid, carry, cargo] = row; seenU.add(id);
      let u = g.units.find(v => v.id === id);
      if (!u) { u = g.spawnUnit(team, type, x, z); u.id = id; u.x = x; u.z = z; u.yaw = yaw; if (team === 0 && u.d.hero) g.hero = u; }
      if (u.type !== type) { u.batch.release(u.slot); u.type = type; u.d = g.stat(team, type); u.batch = g.figures.get(team, type); u.slot = u.batch.alloc(); if (team === 0 && u.d.hero) g.hero = u; }
      if (!u.possessed) { u.nx = x; u.nz = z; u.nyaw = yaw; }
      const lost = team === 0 && hp < u.hp - 2; if (lost && performance.now() - (this.alertT || 0) > 6000) { this.alertT = performance.now(); g.onAlert?.(x, z); }
      Object.assign(u, { hp, maxHp, speedNow: spd, morale, vet, kills, routed: fl & 2 ? 1 : 0, inspired: !!(fl & 8), aimK: aim, drawK: draw, boarded: fl & 4 ? u.boarded || {} : null });
      if (swingT < u.swingT) u.swingT = swingT; else if (swingT > u.swingT + .3) u.swingT = swingT;
      u.carry = carry ? { rt: carry[0], amt: carry[1] } : null; if (u.cargo) u.cargo = Array(cargo).fill(null);
      const res = tt === 'gather' ? resources.find(r => r.id === tid) : null, bt = tid ? g.blds.find(b => b.id === tid) : null;
      if (u.task.type !== tt || (res && u.task.res !== res)) u.task = { type: tt, res, b: bt, t: bt };
      if (fl & 1 && u.alive) { u.alive = false; u.dead = true; u.deathT = 0; u.selected = false; g.onUnitDeath?.(u); }
    }
    for (let i = g.units.length - 1; i >= 0; i--) { const u = g.units[i]; if (!seenU.has(u.id)) { u.batch.release(u.slot); g.units.splice(i, 1); } }
    // arrows and hits for show
    for (const f of m.fx) {
      if (f[0] === 's') { const s = g.units.find(u => u.id === f[1]), t = f[2] > 0 ? g.units.find(u => u.id === f[2]) : g.blds.find(b => b.id === -f[2]); if (s && t) g.shootVisual(s, t); }
      else g.onHit?.({ kind: 'unit', x: f[1], z: f[2], y: g.units[0]?.y ?? 0, d: { arm: f[3] ? 3 : 0 } }, { d: { melee: 1 } }, 0);
    }
    if (m.over && !g.over) { g.over = m.over; g.onEnd?.(m.over); }
    if (!this.framed) { const h = g.blds.find(b => b.team === 0 && b.type === 'hall'); if (h) { this.framed = true; this.a.rts.yaw = Math.PI * .75; this.a.rts.lookAt(h.x - 6, h.z + 6); } } // look at my own village first
  }
}
