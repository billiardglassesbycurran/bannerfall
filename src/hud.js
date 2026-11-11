// HUD: resource bar, selection panel, command card, minimap, health bars, toasts.
import * as THREE from 'three';
import { UD, BD, BUILD_LIST } from './data.js';
import { N, SIZE, resources, minimapColors } from './world.js';

const $ = id => document.getElementById(id);
const HK = ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash'];
const HKL = ['Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/'];
export const costHtml = c => !c ? '' : ['f', 'w', 'g'].filter(k => c[k]).map(k => `<span class="${k}">${c[k]}${k}</span>`).join(' ');
const TASK = { board: 'Boarding ship', unload: 'Sailing to land troops', idle: 'Idle', move: 'Moving', amove: 'Attacking', attack: 'Fighting', follow: 'Following', build: 'Building', farm: 'Farming', return: 'Carrying to storage' };
const RN = { f: 'food', w: 'wood', g: 'gold' };

export class HUD {
  constructor(app) {
    this.a = app; this.ov = $('ov'); this.ctx = this.ov.getContext('2d');
    this.mini = $('mini'); this.mctx = this.mini.getContext('2d');
    this.bg = document.createElement('canvas'); this.bg.width = this.bg.height = N;
    this.bg.getContext('2d').putImageData(new ImageData(minimapColors(), N, N), 0, 0);
    this.cardT = 0; this.miniT = 0; this.selT = 0; this.buttons = [];
    this.v = new THREE.Vector3();
    $('card').addEventListener('pointerdown', e => e.stopPropagation());
    const mm = e => { const r = this.mini.getBoundingClientRect(); this.a.rts.lookAt((e.clientX - r.left) / r.width * SIZE, (e.clientY - r.top) / r.height * SIZE); };
    this.mini.addEventListener('pointerdown', e => { this.miniDrag = true; mm(e); });
    addEventListener('pointermove', e => { if (this.miniDrag) mm(e); });
    addEventListener('pointerup', () => { this.miniDrag = false; });
    this.resize();
  }
  resize() { this.ov.width = innerWidth; this.ov.height = innerHeight; }
  toast(msg, secs = 3.5) {
    const box = $('toasts'); const d = document.createElement('div'); d.className = 'toast'; d.textContent = msg; box.appendChild(d);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => { d.style.opacity = 0; setTimeout(() => d.remove(), 500); }, secs * 1000);
  }

  // ---------------- per frame ----------------
  update(dt) {
    const g = this.a.game; if (!g) return;
    const T = g.T[0];
    $('rf').textContent = T.f | 0; $('rw').textContent = T.w | 0; $('rg').textContent = T.g | 0;
    $('rp').textContent = g.mode === 'battle' ? `${T.pop}` : `${T.pop}/${T.cap}`; $('rp').style.color = T.pop >= T.cap && g.mode !== 'battle' ? '#ff8a6a' : '';
    const s = g.time | 0; $('clock').textContent = `${s / 60 | 0}:${String(s % 60).padStart(2, '0')}`;
    $('info').textContent = this.a.infoText();
    if ((this.selT -= dt) <= 0) { this.selT = .25; this.updateSel(); }
    if ((this.cardT -= dt) <= 0) { this.cardT = .5; this.updateCard(); }
    if ((this.miniT -= dt) <= 0) { this.miniT = .25; this.drawMini(); }
    this.drawBars();
  }

  // ---------------- selection panel ----------------
  updateSel() {
    const sel = this.a.sel, name = $('selname'), desc = $('seldesc'), q = $('selq');
    q.innerHTML = '';
    if (!sel.length) { name.textContent = this.a.game.mode === 'battle' ? 'Select your soldiers' : 'Nothing selected'; desc.innerHTML = this.a.hint(); return; }
    const e = sel[0];
    if (e.kind === 'res') { name.textContent = e.fish ? 'Fish' : { f: 'Berry bush', w: 'Tree', g: 'Gold mine' }[e.rt]; desc.textContent = `${Math.ceil(e.amt)} ${RN[e.rt]} left. ` + (e.fish ? 'Fishing boats (from a Dock) can catch it.' : 'Send peasants to gather it.'); return; }
    if (e.kind === 'bld') {
      name.textContent = (e.team ? 'Enemy ' : '') + e.d.name;
      let t = `HP ${Math.ceil(e.hp)}/${e.maxHp}`;
      if (!e.built) t += ` · Under construction ${Math.floor(e.progress * 100)}%`;
      else if (e.type === 'farm') t += ` · ${Math.ceil(e.food)} food left`;
      else if (e.d.desc) t += ` · ${e.d.desc}`;
      desc.textContent = t;
      if (e.team === 0) e.queue.forEach((it, i) => {
        const d = document.createElement('div'); d.className = 'qi'; d.innerHTML = `${UD[it.type].name}<i style="width:${Math.min(1, it.t) * 100}%"></i>`;
        d.title = 'Tap to cancel'; d.onpointerdown = ev => { ev.stopPropagation(); this.a.game.cancelTrain(e, i); this.updateSel(); this.updateCard(); }; q.appendChild(d);
      });
      return;
    }
    if (sel.length === 1) {
      name.textContent = (e.team ? 'Enemy ' : '') + e.d.name;
      let t = `HP ${Math.ceil(e.hp)}/${e.maxHp}`;
      if (e.team === 0) { let task = TASK[e.task.type] || ''; if (e.task.type === 'gather') task = e.task.res.fish ? 'Fishing' : `Gathering ${RN[e.task.res.rt]}`; if (e.cargo) task += ` · carrying ${e.cargo.length}/${e.d.carry} troops`; t += ` · ${task}`; if (e.carry) t += ` (carrying ${e.carry.amt | 0} ${RN[e.carry.rt]})`; }
      desc.textContent = t; return;
    }
    const counts = {}; for (const u of sel) counts[u.type] = (counts[u.type] || 0) + 1;
    name.textContent = `${sel.length} units`;
    desc.textContent = Object.entries(counts).map(([k, c]) => `${c} ${c > 1 ? UD[k].plural : UD[k].name}`).join(', ');
  }

  // ---------------- command card ----------------
  updateCard() {
    const a = this.a, g = a.game, sel = a.sel, card = $('card'), btns = [];
    const T = g.T[0], touch = a.isTouch;
    const mine = sel.filter(e => e.alive !== false && e.team === 0);
    if (a.pending) btns.push({ label: '&#10005;', sub: 'cancel', on: () => a.cancelPending() });
    else if (mine.length && mine[0].kind === 'unit') {
      if (mine.some(u => u.type === 'peasant') && g.mode !== 'battle') for (const t of BUILD_LIST) {
        const d = BD[t], req = d.req && !g.has(0, d.req);
        btns.push({ label: d.name.replace('Storehouse', 'Store').replace('Watchtower', 'Tower').replace('Archery Range', 'Range').replace('Siege Workshop', 'Siege'), sub: req ? 'needs ' + BD[d.req].name.replace('Archery ', '') : costHtml(d.cost), dis: req || !g.afford(0, d.cost), on: () => a.startPlace(t), tip: d.desc });
      }
      if (mine.some(u => u.type !== 'peasant' && u.d.dmg > 0)) btns.push({ label: 'Attack', sub: 'move', on: () => a.setPending({ type: 'amove' }) });
      const tr = mine.find(u => u.d.carry);
      if (tr) { btns.push({ label: 'Unload', sub: 'pick shore', on: () => a.setPending({ type: 'unload', ship: tr }) }); btns.push({ label: 'Land', sub: 'here', on: () => g.unloadAt(tr, tr.x, tr.z) }); }
      btns.push({ label: 'Stop', sub: '', on: () => { for (const u of mine) g.setTask(u, { type: 'idle' }); } });
    } else if (mine.length && mine[0].kind === 'bld' && mine[0].built) {
      const b = mine[0];
      for (const t of g.trainsFor(b)) {
        const d = g.stat(0, t), n = b.queue.filter(q => q.type === t).length;
        btns.push({ label: d.name.replace('Light Cavalry', 'Light Cav').replace('Horse Archer', 'Horse Archer').replace('Crossbowman', 'Crossbow').replace('Fishing Boat', 'Fisher').replace('Transport Ship', 'Transport').replace("Khan's Guard", "Khan's Guard"), sub: costHtml(d.cost), dis: !g.afford(0, d.cost) || b.queue.length >= 5, badge: n || '', on: () => { const r = g.train(b, t); if (r === 'cost') a.toast('Not enough resources.', 2); else if (r === 'full') a.toast('Queue is full.', 2); this.updateSel(); this.updateCard(); }, tip: d.desc });
      }
      if (b.d.trains) btns.push({ label: 'Rally', sub: 'point', on: () => a.setPending({ type: 'rally', b }) });
    }
    // only rebuild DOM when something changed
    const sig = btns.map(b => b.label + b.sub + b.dis + b.badge).join('|');
    this.buttons = btns;
    if (sig === this.sig) return; this.sig = sig;
    card.innerHTML = '';
    btns.forEach((b, i) => {
      const el = document.createElement('button'); el.className = 'btn' + (b.dis ? ' dis' : '');
      el.innerHTML = `${b.label}<span class="cost">${b.sub || ''}</span>${b.badge ? `<span class="q">${b.badge}</span>` : ''}${!touch && HKL[i] ? `<span class="hk">${HKL[i]}</span>` : ''}`;
      if (b.tip) el.title = b.tip;
      el.addEventListener('click', ev => { ev.stopPropagation(); if (b.dis) { a.toast(b.sub && b.sub.startsWith('needs') ? `Requires a ${b.sub.slice(6)}.` : 'Not enough resources.', 2); return; } b.on(); this.sig = ''; this.updateCard(); });
      card.appendChild(el);
    });
  }
  hotkey(code) { const i = HK.indexOf(code); const b = this.buttons[i]; if (!b) return false; if (!b.dis) b.on(); this.sig = ''; this.updateCard(); return true; }

  // ---------------- minimap ----------------
  drawMini() {
    const c = this.mctx, g = this.a.game; c.drawImage(this.bg, 0, 0);
    for (const r of resources) if (r.alive && r.rt === 'g') { c.fillStyle = '#ffd84a'; c.fillRect(r.x - 1.5, r.z - 1.5, 3, 3); }
    for (const b of g.blds) if (b.alive) { c.fillStyle = b.team ? '#e0402a' : '#4a7cff'; c.fillRect(b.cx, b.cz, b.size, b.size); }
    for (const u of g.units) if (u.alive) { c.fillStyle = u.team ? '#ff5a40' : (u.selected ? '#bfffb0' : '#8fb4ff'); c.fillRect(u.x - 1, u.z - 1, 2, 2); }
    // camera view
    const rts = this.a.rts, pts = [];
    for (const [sx, sy] of [[0, 0], [innerWidth, 0], [innerWidth, innerHeight], [0, innerHeight]]) {
      const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(sx / innerWidth * 2 - 1, -(sy / innerHeight) * 2 + 1), this.a.camera);
      const t = (1 - ray.ray.origin.y) / (ray.ray.direction.y || -1e-3); const d = Math.min(t > 0 ? t : 300, 300);
      pts.push([ray.ray.origin.x + ray.ray.direction.x * d, ray.ray.origin.z + ray.ray.direction.z * d]);
    }
    c.strokeStyle = '#fff'; c.lineWidth = 1; c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath(); c.stroke();
    void rts;
  }

  // ---------------- health bars ----------------
  drawBars() {
    const c = this.ctx, g = this.a.game, cam = this.a.camera, v = this.v;
    c.clearRect(0, 0, this.ov.width, this.ov.height);
    if (this.a.mode !== 'rts' || !g) return;
    const bar = (x, y, w, f, col, bg = 'rgba(0,0,0,.6)') => { c.fillStyle = bg; c.fillRect(x - w / 2 - 1, y - 1, w + 2, 5); c.fillStyle = col; c.fillRect(x - w / 2, y, w * Math.max(0, f), 3); };
    const scr = (x, y, z) => { v.set(x, y, z).project(cam); return v.z < 1 && v.x > -1.1 && v.x < 1.1 && v.y > -1.1 && v.y < 1.1 ? [(v.x * .5 + .5) * innerWidth, (-v.y * .5 + .5) * innerHeight] : null; };
    const zoomK = Math.max(.6, Math.min(1.2, 30 / this.a.rts.dist));
    for (const u of g.units) {
      if (!u.alive || (!u.selected && u.hp >= u.maxHp)) continue;
      const p = scr(u.x, u.y + (u.d.horse ? 3.0 : 2.1) * u.scale, u.z); if (!p) continue;
      const f = u.hp / u.maxHp; bar(p[0], p[1], 24 * zoomK * (u.d.hero ? 1.5 : 1), f, u.team ? '#e04a3a' : f > .5 ? '#5ad24a' : f > .25 ? '#e8c43a' : '#e0503a');
    }
    for (const b of g.blds) {
      if (!b.alive) continue;
      if (!b.selected && b.hp >= b.maxHp && b.built && !(b.team === 0 && b.queue.length)) continue;
      const p = scr(b.x, b.y + (b.type === 'tower' ? 6.5 : b.size * .9 + 1), b.z); if (!p) continue;
      const w = 50 * zoomK;
      if (!b.built) bar(p[0], p[1], w, b.progress, '#ffd56a');
      else bar(p[0], p[1], w, b.hp / b.maxHp, b.team ? '#e04a3a' : '#5ad24a');
      if (b.team === 0 && b.queue.length) bar(p[0], p[1] + 6, w, Math.min(1, b.queue[0].t), '#8ab4ff');
    }
  }
}
