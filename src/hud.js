// HUD: resource bar, selection panel, command card, minimap, health bars, toasts.
import * as THREE from 'three';
import { UD, BD, BUILD_ECO, BUILD_MIL, TECH, AGES } from './data.js';
import { N, SIZE, resources, minimapColors, heightAt, WL } from './world.js';

const $ = id => document.getElementById(id);
const HK = ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash'];
const HKL = ['Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/'];
export const costHtml = c => !c ? '' : ['f', 'w', 'g'].filter(k => c[k]).map(k => `<span class="${k}">${c[k]}${k}</span>`).join(' ');
const TASK = { patrol: 'Patrolling', garrison: 'Running to the Town Hall', repair: 'Repairing', board: 'Boarding ship', unload: 'Sailing to land troops', idle: 'Idle', move: 'Moving', amove: 'Attacking', attack: 'Fighting', follow: 'Following', build: 'Building', farm: 'Farming', return: 'Carrying to storage' };
const RN = { f: 'food', w: 'wood', g: 'gold' };

export class HUD {
  constructor(app) {
    this.a = app; this.ov = $('ov'); this.ctx = this.ov.getContext('2d');
    this.mini = $('mini'); this.mctx = this.mini.getContext('2d');
    // minimap background: terrain colours with hill shading (light from the north-west), drawn at 2x for crisp lines
    const base = minimapColors();
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const h = heightAt(i + .5, j + .5), k = (j * N + i) * 4;
      if (h < WL) { const dpt = Math.min(1, (WL - h) / 2.5); base[k] = 70 - dpt * 40; base[k + 1] = 120 - dpt * 50; base[k + 2] = 150 - dpt * 40; continue; }
      const sh = 1 + (heightAt(i - .5, j - .5) - heightAt(i + 1.5, j + 1.5)) * .22;
      for (let c = 0; c < 3; c++) base[k + c] = Math.max(0, Math.min(255, base[k + c] * Math.max(.55, Math.min(1.45, sh))));
    }
    const small = document.createElement('canvas'); small.width = small.height = N; small.getContext('2d').putImageData(new ImageData(base, N, N), 0, 0);
    this.bg = document.createElement('canvas'); this.bg.width = this.bg.height = N * 2;
    const bctx = this.bg.getContext('2d'); bctx.imageSmoothingEnabled = true; bctx.drawImage(small, 0, 0, N * 2, N * 2);
    this.pings = [];
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
      if (!e.built) t += ` · Under construction ${Math.floor(e.progress * 100)}%` + (e.team === 0 ? ` · ${e.nb || 0} builder${e.nb === 1 ? '' : 's'}` : '');
      else if (e.cargo?.length) t += ` · ${e.cargo.length} peasants sheltering`;
      else if (e.type === 'farm') t += ` · ${Math.ceil(e.food)} food left`;
      else if (e.d.desc) t += ` · ${e.d.desc}`;
      desc.textContent = t;
      if (e.team === 0) e.queue.forEach((it, i) => {
        const d = document.createElement('div'); d.className = 'qi'; d.innerHTML = `${it.tech ? TECH[it.tech].name : UD[it.type].name}<i style="width:${Math.min(1, it.t) * 100}%"></i>`;
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
    const short = n => n.replace('Storehouse', 'Store').replace('Watchtower', 'Tower').replace('Archery Range', 'Range').replace('Siege Workshop', 'Siege').replace('Light Cavalry', 'Light Cav').replace('Crossbowman', 'Crossbow').replace('Fishing Boat', 'Fisher').replace('Transport Ship', 'Transport').replace('Blacksmith', 'Smith');
    const ageName = n => AGES[n].replace(' Age', '');
    const back = () => btns.push({ label: '&#9664;', sub: 'back', on: () => { this.page = null; } });
    // what kind of thing is selected decides the panel; pages keep it to 10 buttons
    if (a.pending) btns.push({ label: '&#10005;', sub: 'cancel', on: () => a.cancelPending() });
    else if (!mine.length && sel[0]?.kind === 'res' && !sel[0].fish && g.mode !== 'battle') {
      const r = sel[0];
      for (const n of [1, 3, 5]) btns.push({ label: `+${n}`, sub: n === 1 ? 'peasant' : 'peasants', on: () => { const k = g.sendPeasants(0, r, n); a.toast(k ? `${k} peasant${k > 1 ? 's' : ''} sent.` : 'No free peasants.', 1.5); } });
    } else if (mine.length && mine[0].kind === 'unit') {
      const peas = mine.filter(u => u.type === 'peasant'), mil = mine.filter(u => u.type !== 'peasant' && !u.d.ship), ships = mine.filter(u => u.d.ship);
      if (peas.length && g.mode !== 'battle' && (this.page === 'eco' || this.page === 'mil')) {
        for (const t of this.page === 'eco' ? BUILD_ECO : BUILD_MIL) {
          const d = BD[t], req = d.req && !g.has(0, d.req), old = !g.ageOK(0, d);
          btns.push({ label: short(d.name), sub: old ? ageName(d.age) + ' Age' : req ? 'needs ' + short(BD[d.req].name) : costHtml(d.cost), dis: old || req || !g.afford(0, d.cost), why: old ? `Requires the ${AGES[d.age]}.` : req ? `Requires a ${BD[d.req].name}.` : null, on: () => { a.startPlace(t); this.page = null; }, tip: d.desc });
        }
        back();
      } else {
        if (peas.length && g.mode !== 'battle') {
          const go = rt => () => { let k = 0; for (const u of peas) { const r = rt === 'f' ? (g.blds.find(b => b.alive && b.built && b.team === 0 && b.type === 'farm' && (!b.farmer || !b.farmer.alive || b.farmer.task.b !== b)) || g.nearestRes(u.x, u.z, 'f', 60)) : g.nearestRes(u.x, u.z, rt, 70); if (r) { if (r.kind === 'bld') g.farm(u, r); else g.gather(u, r); k++; } } if (!k) a.toast('None nearby.', 1.5); };
          btns.push({ label: 'Food', sub: 'gather', on: go('f') }, { label: 'Wood', sub: 'chop', on: go('w') }, { label: 'Gold', sub: 'mine', on: go('g') });
          btns.push({ label: 'Build', sub: 'economy &#9654;', on: () => { this.page = 'eco'; } }, { label: 'Build', sub: 'military &#9654;', on: () => { this.page = 'mil'; } });
          btns.push({ label: 'Repair', sub: 'pick building', on: () => a.setPending({ type: 'repair' }) });
          if (peas.some(u => u.carry)) btns.push({ label: 'Return', sub: 'goods', on: () => { for (const u of peas) if (u.carry) g.setTask(u, { type: 'return' }); } });
        }
        if (mil.length || ships.some(u => u.d.dmg > 0)) {
          btns.push({ label: 'Attack', sub: 'move', on: () => a.setPending({ type: 'amove' }) });
          btns.push({ label: 'Patrol', sub: 'pick point', on: () => a.setPending({ type: 'patrol' }) });
          const st = (mil[0] || ships[0]).stance || 'aggressive', next = { aggressive: 'defensive', defensive: 'hold', hold: 'aggressive' }[st];
          btns.push({ label: { aggressive: 'Aggressive', defensive: 'Defensive', hold: 'Hold' }[st], sub: 'stance &#8635;', on: () => { for (const u of [...mil, ...ships]) u.stance = next; a.toast(`Stance: ${next === 'hold' ? 'hold ground (no chasing)' : next === 'defensive' ? 'defensive (chase a little, then return)' : 'aggressive (chase enemies)'}.`, 2); } });
          if (g.hero?.alive && mil.length && !mil.includes(g.hero)) btns.push({ label: 'Follow', sub: 'commander', on: () => { mil.forEach((u, i) => { const row = Math.floor(i / 6) + 1, col = (i % 6) - 2.5; g.setTask(u, { type: 'follow', leader: g.hero, off: { a: Math.atan2(col * 1.2, row * 1.4), d: Math.hypot(col * 1.2, row * 1.4) } }); }); } });
        }
        const tr = ships.find(u => u.d.carry);
        if (tr) { btns.push({ label: 'Unload', sub: 'pick shore', on: () => a.setPending({ type: 'unload', ship: tr }) }); btns.push({ label: 'Land', sub: 'here', on: () => g.unloadAt(tr, tr.x, tr.z) }); }
        btns.push({ label: 'Stop', sub: '', on: () => { for (const u of mine) g.setTask(u, { type: 'idle' }); } });
      }
    } else if (mine.length && mine[0].kind === 'bld') {
      const b = mine[0];
      if (b.built) {
        for (const t of g.trainsFor(b)) {
          const d = g.stat(0, t), n = b.queue.filter(q => q.type === t).length, old = !g.ageOK(0, d);
          btns.push({ label: short(d.name), sub: old ? ageName(d.age) + ' Age' : costHtml(d.cost), dis: old || !g.afford(0, d.cost) || b.queue.length >= 5, why: old ? `Requires the ${AGES[d.age]}.` : null, badge: n || '', on: () => { const r = g.train(b, t); if (r === 'cost') a.toast('Not enough resources.', 2); else if (r === 'full') a.toast('Queue is full.', 2); this.updateSel(); }, tip: d.desc });
        }
        for (const k of g.techsFor(b)) {
          const t = TECH[k], old = (t.age || 0) > T.age;
          btns.push({ label: (t.toAge ? '&#9733; ' : '') + t.name.replace('Double-Bit ', '').replace(' Infantry', ''), sub: old ? ageName(t.age) + ' Age' : costHtml(t.cost), dis: old || !g.afford(0, t.cost) || b.queue.length >= 5, why: old ? `Requires the ${AGES[t.age]}.` : null, tech: 1, on: () => { const r = g.research(b, k); if (r === 'cost') a.toast('Not enough resources.', 2); else if (r === 'no') a.toast('Already advancing.', 2); this.updateSel(); }, tip: t.desc });
        }
        if (b.type === 'hall' && g.mode !== 'battle') btns.push({ label: b.cargo?.length ? 'All Clear' : '&#128276; Bell', sub: b.cargo?.length ? `${b.cargo.length} inside` : 'peasants hide', on: () => { const n = g.ringBell(0); a.toast(n < 0 ? 'All clear! Back to work.' : n ? `${n} peasants run for the Town Hall!` : 'No peasants nearby.', 2); } });
        if (b.d.trains) btns.push({ label: 'Rally', sub: 'point', on: () => a.setPending({ type: 'rally', b }) });
      }
      if (b.type !== 'hall' || g.blds.filter(o => o.alive && o.team === 0 && o.type === 'hall').length > 1) btns.push({ label: this.confirmDel === b.id ? 'Sure?' : 'Demolish', sub: this.confirmDel === b.id ? 'tap again' : '', on: () => { if (this.confirmDel === b.id) { g.kill(b); a.select([]); this.confirmDel = null; } else { this.confirmDel = b.id; setTimeout(() => { this.confirmDel = null; this.sig = ''; }, 3000); } } });
    }
    if (btns.length > 10) btns.length = 10;
    // only rebuild DOM when something changed
    const sig = (this.page || '') + btns.map(b => b.label + b.sub + b.dis + b.badge).join('|');
    this.buttons = btns;
    if (sig === this.sig) return; this.sig = sig;
    card.innerHTML = '';
    btns.forEach((b, i) => {
      const el = document.createElement('button'); el.className = 'btn' + (b.dis ? ' dis' : '') + (b.tech ? ' tech' : '');
      el.innerHTML = `${b.label}<span class="cost">${b.sub || ''}</span>${b.badge ? `<span class="q">${b.badge}</span>` : ''}${!touch && HKL[i] ? `<span class="hk">${HKL[i]}</span>` : ''}`;
      if (b.tip) el.title = b.tip;
      el.addEventListener('click', ev => { ev.stopPropagation(); this.press(b); });
      card.appendChild(el);
    });
  }
  press(b) {
    const a = this.a;
    if (b.dis) { a.toast(b.why || (b.sub && b.sub.startsWith('needs') ? `Requires a ${b.sub.slice(6)}.` : 'Not enough resources.'), 2); return; }
    a.sfx?.('click'); b.on(); this.sig = ''; this.updateCard(); if (b.tip && this.a.isTouch && b.tech) a.toast(b.tip, 2.5);
  }
  hotkey(code) { const i = HK.indexOf(code); const b = this.buttons[i]; if (!b) return false; this.press(b); return true; }

  // ---------------- minimap ----------------
  ping(x, z) { this.pings.push({ x, z, t: performance.now() }); if (this.pings.length > 6) this.pings.shift(); }
  drawMini() {
    const c = this.mctx, g = this.a.game, K = 2; c.drawImage(this.bg, 0, 0);
    for (const r of resources) if (r.alive && (r.rt === 'g' || r.fish)) { c.fillStyle = r.fish ? '#cfefff' : '#ffd84a'; c.beginPath(); c.arc(r.x * K, r.z * K, r.fish ? 2 : 3, 0, 6.3); c.fill(); }
    for (const b of g.blds) if (b.alive) { c.fillStyle = b.team ? '#d8402a' : '#3f72ff'; c.strokeStyle = 'rgba(0,0,0,.8)'; c.lineWidth = 1; c.fillRect(b.cx * K, b.cz * K, b.size * K, b.size * K); c.strokeRect(b.cx * K + .5, b.cz * K + .5, b.size * K - 1, b.size * K - 1); }
    for (const u of g.units) if (u.alive && !u.boarded) {
      c.fillStyle = u.selected ? '#ffffff' : u.team ? '#ff5a40' : '#7fa8ff'; c.strokeStyle = 'rgba(0,0,0,.85)'; c.lineWidth = 1;
      const r = u.d.ship ? 3 : 1.8; c.beginPath(); c.arc(u.x * K, u.z * K, r, 0, 6.3); c.fill(); c.stroke();
    }
    // the part of the map you're looking at: a clean white box, rotated with the camera
    const rts = this.a.rts, cam = this.a.camera, ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -rts.focus.y), hit = new THREE.Vector3();
    const at = (sx, sy) => { ray.setFromCamera(new THREE.Vector2(sx * 2 - 1, -(sy * 2 - 1)), cam); return ray.ray.intersectPlane(plane, hit) ? hit.clone() : null; };
    const L = at(0, .5), Rr = at(1, .5), T = at(.5, .02) || at(.5, .2), B = at(.5, .98);
    if (L && Rr && B) {
      const w = L.distanceTo(Rr), far = T ? T : B.clone().lerp(rts.focus, 3), d = Math.min(B.distanceTo(far), w * 1.6);
      const fx = -Math.sin(rts.yaw), fz = -Math.cos(rts.yaw), rx = -fz, rz = fx, cx = (B.x + B.x + fx * d) / 2, cz = (B.z + B.z + fz * d) / 2;
      const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, bb]) => [(cx + rx * a * w / 2 + fx * bb * d / 2) * K, (cz + rz * a * w / 2 + fz * bb * d / 2) * K]);
      c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,.45)'; c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath(); c.stroke();
      c.lineWidth = 1.5; c.strokeStyle = '#ffffff'; c.stroke();
    }
    // red pulses where you're under attack
    const now = performance.now(); this.pings = this.pings.filter(p => now - p.t < 3000);
    for (const p of this.pings) { const k = ((now - p.t) % 1000) / 1000; c.strokeStyle = `rgba(255,70,50,${1 - k})`; c.lineWidth = 2; c.beginPath(); c.arc(p.x * K, p.z * K, 4 + k * 14, 0, 6.3); c.stroke(); }
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
      const p = scr(b.x, b.y + (b.type === 'tower' ? 6.5 : b.size * .9 + 1), b.z); if (!p) continue; p[1] = Math.max(p[1], 64); // keep labels clear of the top bar
      const w = 50 * zoomK;
      if (!b.built) {
        const bw = Math.max(w, 64); bar(p[0], p[1], bw, b.progress, '#ffd56a');
        if (b.team === 0) {
          const nb = b.nb || 0, left = nb ? Math.ceil((1 - b.progress) * b.d.time / nb / (g.civ[0].build || 1)) : 0;
          const txt = `${Math.floor(b.progress * 100)}% · ` + (nb ? `${nb} builder${nb > 1 ? 's' : ''} · ${left}s` : 'no builders');
          c.font = 'bold 11px Georgia, serif'; c.textAlign = 'center'; c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,.8)'; c.strokeText(txt, p[0], p[1] - 4);
          c.fillStyle = nb ? '#ffe9a8' : '#ff9a7a'; c.fillText(txt, p[0], p[1] - 4);
        }
      }
      else bar(p[0], p[1], w, b.hp / b.maxHp, b.team ? '#e04a3a' : '#5ad24a');
      if (b.team === 0 && b.queue.length) bar(p[0], p[1] + 6, w, Math.min(1, b.queue[0].t), '#8ab4ff');
    }
  }
}
