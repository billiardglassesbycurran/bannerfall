// Aerial command view: camera + selection + move orders, for mouse/keyboard and touch.
import * as THREE from 'three';
import { SIZE, heightAt, clamp, lerp } from './terrain.js';

export class RTSView {
  constructor(game) {
    this.g = game;
    this.focus = new THREE.Vector3(34, 0, 94);
    this.yaw = -Math.PI / 4;       // camera sits south-west of focus, looking toward the enemy
    this.pitch = 0.95;
    this.dist = 30;
    this.ptrs = new Map();          // active pointers on the canvas
    this.lastTap = { t: 0, id: null };
    this.box = document.getElementById('box');
    this.ray = new THREE.Raycaster();
  }

  // ---------- camera ----------
  fwd() { return [-Math.sin(this.yaw), -Math.cos(this.yaw)]; }
  pan(dxPx, dyPx) {
    const k = this.dist / innerHeight * 1.15, [fx, fz] = this.fwd(), rx = -fz, rz = fx;
    this.focus.x += (-rx * dxPx + fx * dyPx) * k;
    this.focus.z += (-rz * dxPx + fz * dyPx) * k;
  }
  zoom(f) { this.dist = clamp(this.dist * f, 9, 85); }
  update(dt) {
    const keys = this.g.keys, [fx, fz] = this.fwd(), rx = -fz, rz = fx;
    let mx = 0, my = 0;
    if (keys.KeyW || keys.ArrowUp) my += 1; if (keys.KeyS || keys.ArrowDown) my -= 1;
    if (keys.KeyD || keys.ArrowRight) mx += 1; if (keys.KeyA || keys.ArrowLeft) mx -= 1;
    const sp = this.dist * 1.1 * dt;
    this.focus.x += (fx * my + rx * mx) * sp; this.focus.z += (fz * my + rz * mx) * sp;
    if (keys.KeyQ) this.yaw += dt * 1.8; if (keys.KeyE) this.yaw -= dt * 1.8;
    if (keys.KeyR) this.zoom(1 - dt * 1.5); if (keys.KeyF) this.zoom(1 + dt * 1.5);
    this.focus.x = clamp(this.focus.x, 8, SIZE - 8); this.focus.z = clamp(this.focus.z, 8, SIZE - 8);
    this.focus.y = lerp(this.focus.y, Math.max(heightAt(this.focus.x, this.focus.z), 0), Math.min(1, dt * 6));
    const cam = this.g.camera, cp = Math.cos(this.pitch) * this.dist;
    cam.position.set(this.focus.x + Math.sin(this.yaw) * cp, this.focus.y + Math.sin(this.pitch) * this.dist, this.focus.z + Math.cos(this.yaw) * cp);
    cam.lookAt(this.focus);
  }
  lookAt(x, z) { this.focus.x = x; this.focus.z = z; }

  // ---------- picking ----------
  toScreen(u, out) {
    out.set(u.x, u.y + .9, u.z).project(this.g.camera);
    return out.z < 1 ? [(out.x * .5 + .5) * innerWidth, (-out.y * .5 + .5) * innerHeight] : null;
  }
  pickUnit(sx, sy, rad) {
    const v = new THREE.Vector3(); let best = null, bd = rad * rad;
    for (const u of this.g.myUnits()) {
      const p = this.toScreen(u, v); if (!p) continue;
      const d = (p[0] - sx) ** 2 + (p[1] - sy) ** 2; if (d < bd) { bd = d; best = u; }
    }
    return best;
  }
  pickGround(sx, sy) {
    this.ray.setFromCamera(new THREE.Vector2(sx / innerWidth * 2 - 1, -(sy / innerHeight) * 2 + 1), this.g.camera);
    const hit = this.ray.intersectObject(this.g.terrain, false)[0];
    return hit ? hit.point : null;
  }
  boxSelect(x0, y0, x1, y1, add) {
    const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)], [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)], v = new THREE.Vector3();
    const hits = this.g.myUnits().filter(u => { const p = this.toScreen(u, v); return p && p[0] >= ax && p[0] <= bx && p[1] >= ay && p[1] <= by; });
    this.g.select(hits, add);
  }
  showBox(x0, y0, x1, y1) {
    const s = this.box.style; this.box.classList.remove('hide');
    s.left = Math.min(x0, x1) + 'px'; s.top = Math.min(y0, y1) + 'px'; s.width = Math.abs(x1 - x0) + 'px'; s.height = Math.abs(y1 - y0) + 'px';
  }
  order(sx, sy) {
    const p = this.pickGround(sx, sy); if (p && this.g.selected.length) this.g.moveSelected(p.x, p.z);
  }

  // ---------- tap / click on a unit or the ground ----------
  tap(sx, sy, touch, shift) {
    const u = this.pickUnit(sx, sy, touch ? 42 : 26), now = performance.now();
    if (u) {
      if (u.id === this.lastTap.id && now - this.lastTap.t < 350) this.g.select(this.g.myUnits().filter(o => o.kind === u.kind)); // double-tap: all of that type
      else this.g.select([u], shift);
      this.lastTap = { t: now, id: u.id };
    } else if (touch && this.g.selected.length) this.order(sx, sy); // phone: tap ground = move
    else if (!touch && !shift) this.g.select([]);
  }

  // ---------- pointer events (called from main.js while in command view) ----------
  down(e) {
    const p = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t: performance.now(), btn: e.button, type: e.pointerType, mode: null };
    this.ptrs.set(e.pointerId, p);
    if (p.type === 'touch' && this.ptrs.size === 2) { for (const q of this.ptrs.values()) q.mode = 'multi'; this.box.classList.add('hide'); this.pinch = null; }
  }
  move(e) {
    const p = this.ptrs.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
    const moved = Math.hypot(p.x - p.x0, p.y - p.y0);
    if (p.mode === 'multi') return this.multi();
    if (p.type === 'touch') {
      if (!p.mode && moved > 10) p.mode = performance.now() - p.t > 450 ? 'box' : 'pan'; // long-press then drag = box select
      if (p.mode === 'pan') this.pan(dx, dy);
    } else {
      if (!p.mode && moved > 6) p.mode = p.btn === 0 ? 'box' : 'rotate';
      if (p.mode === 'rotate') { this.yaw -= dx * .006; this.pitch = clamp(this.pitch + dy * .004, .45, 1.45); }
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
    if (p.mode === 'box') { this.boxSelect(p.x0, p.y0, p.x, p.y, e.shiftKey); this.box.classList.add('hide'); }
    else if (!p.mode) {
      if (touch) this.tap(p.x, p.y, true, false);
      else if (p.btn === 0) this.tap(p.x, p.y, false, e.shiftKey);
      else if (p.btn === 2) this.order(p.x, p.y);
    }
    if (this.ptrs.size < 2) this.pinch = null;
    if (p.mode === 'multi') for (const q of this.ptrs.values()) q.mode = 'done'; // remaining finger shouldn't tap
  }
  cancel() { this.ptrs.clear(); this.pinch = null; this.box.classList.add('hide'); }
  wheel(e) { this.zoom(Math.exp(e.deltaY * .0012)); }
}
