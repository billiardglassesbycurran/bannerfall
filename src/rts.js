// Aerial command view: camera, picking, selection, orders and building placement — mouse/keyboard and touch.
import * as THREE from 'three';
import { SIZE, N, heightAt, resCell } from './world.js';
import { bldAt } from './game.js';
import { clamp, lerp } from './util.js';

export class RTSView {
  constructor(app) {
    this.a = app;
    this.focus = new THREE.Vector3(34, 0, 94);
    this.yaw = -Math.PI / 4; this.pitch = .92; this.dist = 32; this.distT = 32;
    this.vel = { x: 0, y: 0 }; this.mouse = { x: -1, y: -1, in: false }; this.boxMode = false;
    this.ptrs = new Map(); this.lastTap = { t: 0, id: null };
    this.box = document.getElementById('box');
    this.ray = new THREE.Raycaster(); this.hover = null;
  }
  get cam() { return this.a.camera; }

  // ---------- camera ----------
  fwd() { return [-Math.sin(this.yaw), -Math.cos(this.yaw)]; }
  pan(dxPx, dyPx) {
    const k = this.dist / innerHeight * 1.15, [fx, fz] = this.fwd(), rx = -fz, rz = fx;
    this.focus.x += (-rx * dxPx + fx * dyPx) * k; this.focus.z += (-rz * dxPx + fz * dyPx) * k;
  }
  zoom(f, smoothly = false) { this.distT = clamp(this.distT * f, 9, 80); if (!smoothly) this.dist = this.distT; }
  lookAt(x, z) { this.focus.x = x; this.focus.z = z; }
  rotateBy(a) { this.yawGoal = (this.yawGoal ?? this.yaw) + a; }
  resetView() { this.yawGoal = -Math.PI / 4 + Math.round((this.yaw + Math.PI / 4) / (Math.PI * 2)) * Math.PI * 2; this.pitch = .92; this.distT = 32; }
  update(dt) {
    const keys = this.a.keys, [fx, fz] = this.fwd(), rx = -fz, rz = fx;
    let mx = 0, my = 0;
    if (keys.KeyW || keys.ArrowUp) my += 1; if (keys.KeyS || keys.ArrowDown) my -= 1;
    if (keys.KeyD || keys.ArrowRight) mx += 1; if (keys.KeyA || keys.ArrowLeft) mx -= 1;
    const sp = this.dist * 1.1 * dt * (this.a.settings?.cam || 1);
    this.focus.x += (fx * my + rx * mx) * sp; this.focus.z += (fz * my + rz * mx) * sp;
    if (keys.KeyQ) { this.yaw += dt * 1.8; this.yawGoal = null; } if (keys.KeyE) { this.yaw -= dt * 1.8; this.yawGoal = null; }
    if (keys.PageUp) this.pitch = clamp(this.pitch + dt, .5, 1.45); if (keys.PageDown) this.pitch = clamp(this.pitch - dt, .5, 1.45);
    if (this.yawGoal != null) { const d = this.yawGoal - this.yaw; this.yaw += d * Math.min(1, dt * 8); if (Math.abs(d) < .002) this.yawGoal = null; }
    if (keys.KeyR) this.zoom(1 - dt * 1.5); if (keys.KeyF) this.zoom(1 + dt * 1.5);
    // screen-edge scrolling with the mouse (PC)
    const m = this.mouse, E = 10;
    if (m.in && !this.ptrs.size && document.hasFocus()) {
      const ex = m.x < E ? -1 : m.x > innerWidth - E ? 1 : 0, ey = m.y < E ? 1 : m.y > innerHeight - E ? -1 : 0;
      if (ex || ey) { this.focus.x += (fx * ey + rx * ex) * sp; this.focus.z += (fz * ey + rz * ex) * sp; }
    }
    // glide after a swipe
    if (Math.abs(this.vel.x) + Math.abs(this.vel.y) > .02) { this.pan(this.vel.x * dt * 1000, this.vel.y * dt * 1000); const d = Math.exp(-dt * 4.5); this.vel.x *= d; this.vel.y *= d; }
    this.dist += (this.distT - this.dist) * Math.min(1, dt * 12);
    this.focus.x = clamp(this.focus.x, 6, SIZE - 6); this.focus.z = clamp(this.focus.z, 6, SIZE - 6);
    this.focus.y = lerp(this.focus.y, Math.max(heightAt(this.focus.x, this.focus.z), 0), Math.min(1, dt * 6));
    const pitch = this.pitch - (1 - (this.dist - 9) / 71) * .25; // tilt toward the horizon when zoomed in
    const cp = Math.cos(pitch) * this.dist;
    this.cam.position.set(this.focus.x + Math.sin(this.yaw) * cp, this.focus.y + Math.sin(pitch) * this.dist, this.focus.z + Math.cos(this.yaw) * cp);
    this.cam.lookAt(this.focus);
  }

  // ---------- picking ----------
  toScreen(x, y, z, out) {
    out.set(x, y, z).project(this.cam);
    return out.z < 1 ? [(out.x * .5 + .5) * innerWidth, (-out.y * .5 + .5) * innerHeight] : null;
  }
  pickUnit(sx, sy, rad, team) {
    const v = new THREE.Vector3(); let best = null, bd = rad * rad;
    for (const u of this.a.game.units) {
      if (!u.alive || u.possessed || u.boarded || (team !== undefined && u.team !== team)) continue;
      const p = this.toScreen(u.x, u.y + .9 * u.scale * (u.d.horse ? 1.6 : 1), u.z, v); if (!p) continue;
      const d = (p[0] - sx) ** 2 + (p[1] - sy) ** 2 - (u.team === 0 ? 60 : 0); if (d < bd) { bd = d; best = u; }
    }
    return best;
  }
  pickGround(sx, sy) {
    this.ray.setFromCamera(new THREE.Vector2(sx / innerWidth * 2 - 1, -(sy / innerHeight) * 2 + 1), this.cam);
    const hit = this.ray.intersectObject(this.a.terrain, false)[0];
    return hit ? hit.point : null;
  }
  pickBuilding(sx, sy) {
    this.ray.setFromCamera(new THREE.Vector2(sx / innerWidth * 2 - 1, -(sy / innerHeight) * 2 + 1), this.cam);
    const meshes = this.a.game.blds.filter(b => b.alive).map(b => b.mesh);
    const hit = this.ray.intersectObjects(meshes, true)[0]; // custom models are groups of meshes
    return hit ? this.a.game.blds.find(b => b.mesh === hit.object || b.mesh === hit.object.parent) : null;
  }
  /** What is under the screen point? Returns {ent, p} where ent is a unit, building, resource or null. */
  pick(sx, sy, touch) {
    const p = this.pickGround(sx, sy);
    const u = this.pickUnit(sx, sy, touch ? 40 : 24); if (u) return { ent: u, p: p || new THREE.Vector3(u.x, u.y, u.z) };
    const b = this.pickBuilding(sx, sy); if (b) return { ent: b, p: p || new THREE.Vector3(b.x, b.y, b.z) };
    if (!p) return { ent: null, p: null };
    const cx = p.x | 0, cz = p.z | 0, r = touch ? 1 : 0;
    let best = null, bd = 9;
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx, z = cz + dz; if (x < 0 || z < 0 || x >= N || z >= N) continue;
      const e = bldAt[z * N + x] || resCell[z * N + x]; if (!e) continue;
      const d = dx * dx + dz * dz; if (d < bd) { bd = d; best = e; }
    }
    return { ent: best, p };
  }
  boxSelect(x0, y0, x1, y1, add) {
    const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)], [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)], v = new THREE.Vector3();
    const hits = this.a.game.units.filter(u => { if (!u.alive || u.team !== 0 || u.possessed || u.boarded) return false; const p = this.toScreen(u.x, u.y + .9, u.z, v); return p && p[0] >= ax && p[0] <= bx && p[1] >= ay && p[1] <= by; });
    // prefer soldiers over peasants when both are boxed
    const mil = hits.filter(u => u.type !== 'peasant');
    this.a.select(mil.length && mil.length < hits.length && !add ? mil : hits, add);
  }
  showBox(x0, y0, x1, y1) {
    const s = this.box.style; this.box.classList.remove('hide');
    s.left = Math.min(x0, x1) + 'px'; s.top = Math.min(y0, y1) + 'px'; s.width = Math.abs(x1 - x0) + 'px'; s.height = Math.abs(y1 - y0) + 'px';
  }

  // ---------- clicks / taps ----------
  selectClick(sx, sy, touch, shift, ctrl) {
    const { ent } = this.pick(sx, sy, touch), now = performance.now();
    if (ent && ent.kind === 'unit') {
      const dbl = ent.id === this.lastTap.id && now - this.lastTap.t < 380;
      if ((dbl || ctrl) && ent.team === 0) {
        const v = new THREE.Vector3();
        this.a.select(this.a.game.units.filter(o => o.alive && o.team === 0 && o.type === ent.type && !o.possessed && this.toScreen(o.x, o.y, o.z, v)));
      } else this.a.select([ent], shift && ent.team === 0);
      this.lastTap = { t: now, id: ent.id };
      return true;
    }
    if (ent && ent.kind === 'bld') { this.a.select([ent]); return true; }
    if (ent && ent.kind === 'res') { this.a.select([ent]); this.a.resClick?.(ent); return true; } // clicking a resource sends a peasant
    return false;
  }
  orderAt(sx, sy, touch) {
    const { ent, p } = this.pick(sx, sy, touch);
    if (!p && !ent) return;
    this.a.order(ent, p ? p.x : ent.x, p ? p.z : ent.z);
  }
  tap(sx, sy, touch, btn, shift, ctrl) {
    const a = this.a;
    if (a.pending) { const p = this.pickGround(sx, sy); if (p) a.pendingAt(p.x, p.z, this.pick(sx, sy, touch).ent, shift); return; }
    if (!touch) {
      if (btn === 0) { if (!this.selectClick(sx, sy, false, shift, ctrl) && !shift) a.select([]); }
      else if (btn === 2) this.orderAt(sx, sy, false);
      return;
    }
    // touch: one tap does the "smart" thing
    const mine = a.sel.filter(e => e.kind === 'unit' && e.team === 0 && e.alive);
    const { ent } = this.pick(sx, sy, true);
    if (!mine.length) { if (!this.selectClick(sx, sy, true)) a.select([]); return; }
    if (ent && ent.kind === 'unit' && ent.team === 0 && ent.d.carry && mine.some(u => !u.d.ship)) { this.orderAt(sx, sy, true); return; } // board the transport
    if (ent && ent.kind === 'unit' && ent.team === 0) { this.selectClick(sx, sy, true); return; }
    if (ent && ent.kind === 'bld' && ent.team === 0) {
      const peas = mine.some(u => u.type === 'peasant');
      if (peas && (!ent.built || ent.type === 'farm' || ent.d.drop)) { this.orderAt(sx, sy, true); return; }
      this.selectClick(sx, sy, true); return;
    }
    this.orderAt(sx, sy, true);
  }

  // ---------- pointer events ----------
  down(e) {
    this.vel.x = this.vel.y = 0;
    const p = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t: performance.now(), btn: e.button, type: e.pointerType, mode: null, alt: e.altKey };
    this.ptrs.set(e.pointerId, p);
    if (p.type === 'touch' && this.ptrs.size === 2) { for (const q of this.ptrs.values()) q.mode = 'multi'; this.box.classList.add('hide'); this.pinch = null; }
  }
  move(e) {
    const p = this.ptrs.get(e.pointerId);
    if (e.pointerType === 'mouse') { this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.in = true; }
    if (!p) { if (e.pointerType === 'mouse') this.a.hoverAt(e.clientX, e.clientY); return; }
    const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
    const moved = Math.hypot(p.x - p.x0, p.y - p.y0);
    if (p.mode === 'multi') return this.multi();
    if (p.type === 'touch') {
      if (!p.mode && moved > 10) p.mode = (this.boxMode || performance.now() - p.t > 420) && !this.a.pending ? 'box' : 'pan';
      if (p.mode === 'pan') {
        this.pan(dx, dy);
        const now = performance.now(), dtm = Math.max(1, now - (p.lt || now - 16)); p.lt = now;
        p.vx = (p.vx || 0) * .6 + dx / dtm * .4; p.vy = (p.vy || 0) * .6 + dy / dtm * .4;
      }
    } else {
      if (!p.mode && moved > 6) p.mode = (p.alt || p.btn === 1 || p.btn === 2) ? 'rotate' : !this.a.pending ? 'box' : 'none'; // Option/Alt-drag, middle- or right-drag = rotate & tilt
      if (p.mode === 'rotate') { this.yawGoal = null; this.yaw -= dx * .006; this.pitch = clamp(this.pitch + dy * .004, .5, 1.45); }
      this.a.hoverAt(e.clientX, e.clientY);
    }
    if (p.mode === 'box') this.showBox(p.x0, p.y0, p.x, p.y);
  }
  multi() {
    const [a, b] = [...this.ptrs.values()]; if (!a || !b) return;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, d = Math.hypot(b.x - a.x, b.y - a.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
    if (this.pinch) {
      this.pan(mx - this.pinch.mx, my - this.pinch.my);
      if (d > 20) this.zoom(this.pinch.d / d);
      let da = ang - this.pinch.ang; if (da > Math.PI) da -= Math.PI * 2; if (da < -Math.PI) da += Math.PI * 2;
      this.yaw += da;
    }
    this.pinch = { mx, my, d, ang };
  }
  up(e) {
    const p = this.ptrs.get(e.pointerId); if (!p) return;
    this.ptrs.delete(e.pointerId);
    const touch = p.type === 'touch';
    if (p.mode === 'pan' && touch && this.ptrs.size === 0 && performance.now() - (p.lt || 0) < 80) { this.vel.x = p.vx || 0; this.vel.y = p.vy || 0; }
    if (p.mode === 'box') { this.boxSelect(p.x0, p.y0, p.x, p.y, e.shiftKey); this.box.classList.add('hide'); }
    else if (!p.mode) this.tap(p.x, p.y, touch, p.btn, e.shiftKey, e.ctrlKey || e.metaKey);
    if (this.ptrs.size < 2) this.pinch = null;
    if (p.mode === 'multi') for (const q of this.ptrs.values()) q.mode = 'done';
  }
  cancel() { this.ptrs.clear(); this.pinch = null; this.box.classList.add('hide'); this.vel.x = this.vel.y = 0; }
  wheel(e) {
    // trackpad: two-finger sideways swipe rotates, pinch (ctrl+wheel) zooms; mouse wheel zooms
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && !e.ctrlKey) { this.yawGoal = null; this.yaw -= e.deltaX * .004; return; }
    if (e.shiftKey && !e.ctrlKey) { this.yawGoal = null; this.yaw -= e.deltaY * .004; return; }
    this.zoom(Math.exp(e.deltaY * (e.ctrlKey ? .01 : .0015)), true);
  }
}
