// 1st/3rd-person control of one unit (the hero or any possessed unit): move, look, strike, rally troops.
import * as THREE from 'three';
import { heightAt } from './world.js';
import { clamp, angDiff, dist } from './util.js';

const JOY_R = 55;

export class POVView {
  constructor(app) {
    this.a = app; this.unit = null; this.first = false;
    this.yaw = 0; this.pitch = -.2; this.camDist = 5;
    this.joy = null; this.look = null; this.stick = { x: 0, y: 0 };
    this.joyEl = document.getElementById('joy'); this.knob = document.getElementById('knob');
    this.camPos = new THREE.Vector3(); this.followers = [];
  }
  get g() { return this.a.game; }
  enter(unit) {
    this.unit = unit; unit.possessed = true; this.g.setTask(unit, { type: 'idle' });
    this.yaw = unit.yaw; this.pitch = -.2; this.snap = true; this.followers = [];
    this.setFirst(this.first); this.updateFollowBtn();
  }
  leave() {
    const u = this.unit; if (!u) return;
    u.possessed = false; u.speedNow = 0;
    for (const f of this.followers) if (f.alive && f.task.type === 'follow') this.g.setTask(f, { type: 'idle' });
    this.followers = []; this.unit = null; this.cancel();
    if (document.pointerLockElement) document.exitPointerLock();
  }
  setFirst(v) {
    this.first = v;
    document.getElementById('xhair').classList.toggle('hide', !v);
    document.getElementById('bView').innerHTML = v ? '3rd<small>person</small>' : '1st<small>person</small>';
  }

  // ---------- actions ----------
  strike() {
    const u = this.unit; if (!u || !u.alive || u.cd > 0) return;
    const g = this.g, fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    u.cd = u.d.cd * .75; u.swingT = 0;
    if (u.d.ranged) {
      let best = null, bs = -1;
      for (const e of g.units) if (e.alive && e.team !== u.team) {
        const dx = e.x - u.x, dz = e.z - u.z, d = Math.hypot(dx, dz); if (d > u.d.rng + 4 || d < .1) continue;
        const dot = (dx * fx + dz * fz) / d; if (dot > .93 && dot - d * .002 > bs) { bs = dot - d * .002; best = e; }
      }
      if (!best) for (const b of g.blds) if (b.alive && b.team !== u.team && g.edgeDist(u, b) < u.d.rng + 2) { const dx = b.x - u.x, dz = b.z - u.z, d = Math.hypot(dx, dz) || 1; if ((dx * fx + dz * fz) / d > .8) best = b; }
      if (best) g.shoot(u, best, u.d.dmg * 1.2); else this.a.toast('No target in sight — aim at an enemy.', 2);
      return;
    }
    const reach = u.d.rng + .7;
    let hit = 0;
    for (const e of g.units) if (e.alive && e.team !== u.team) {
      const dx = e.x - u.x, dz = e.z - u.z, d = Math.hypot(dx, dz) - e.d.rad; if (d > reach) continue;
      if (Math.abs(angDiff(this.yaw, Math.atan2(dx, dz))) < 1.1) { g.damage(e, u.d.dmg * 1.25, u); if (++hit >= (u.d.hero ? 3 : 1)) break; }
    }
    if (!hit) for (const b of g.blds) if (b.alive && b.team !== u.team && g.edgeDist(u, b) < reach) { g.damage(b, u.d.dmg, u); break; }
  }
  toggleFollow() {
    const u = this.unit; if (!u) return;
    const g = this.g;
    if (this.followers.some(f => f.alive && f.task.type === 'follow' && f.task.leader === u)) {
      for (const f of this.followers) if (f.alive && f.task.type === 'follow') g.setTask(f, { type: 'idle' });
      this.followers = []; this.a.toast('Your troops hold their ground.', 2);
    } else {
      const sel = this.a.sel.filter(e => e.kind === 'unit' && e.alive && e !== u && e.type !== 'peasant' && e.team === u.team);
      const near = sel.length ? sel : g.units.filter(e => e.alive && e.team === u.team && e !== u && e.type !== 'peasant' && dist(e, u) < 30);
      near.sort((a, b) => dist(a, u) - dist(b, u));
      this.followers = near.slice(0, 40);
      this.followers.forEach((f, i) => {
        const row = Math.floor(i / 6) + 1, col = (i % 6) - 2.5;
        g.setTask(f, { type: 'follow', leader: u, off: { a: Math.atan2(col * 1.2, row * 1.4), d: Math.hypot(col * 1.2, row * 1.4) } });
      });
      this.a.toast(this.followers.length ? `${this.followers.length} soldiers rally to you!` : 'No soldiers nearby to follow you.', 2);
    }
    this.updateFollowBtn();
  }
  updateFollowBtn() { document.getElementById('bFollow').classList.toggle('on', this.followers.length > 0); }

  update(dt) {
    const u = this.unit, keys = this.a.keys; if (!u) return;
    let mx = this.stick.x, my = this.stick.y;
    if (keys.KeyW || keys.ArrowUp) my += 1; if (keys.KeyS || keys.ArrowDown) my -= 1;
    if (keys.KeyD || keys.ArrowRight) mx += 1; if (keys.KeyA || keys.ArrowLeft) mx -= 1;
    if (keys.KeyQ) this.yaw += dt * 2.2; if (keys.KeyE) this.yaw -= dt * 2.2;
    const len = Math.hypot(mx, my); if (len > 1) { mx /= len; my /= len; }
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), rx = -fz, rz = fx;
    const sprint = keys.ShiftLeft || keys.ShiftRight || Math.hypot(this.stick.x, this.stick.y) > .95;
    const sp = u.d.spd * (sprint ? 1.45 : 1) * Math.min(1, Math.hypot(mx, my));
    let moved = false;
    if (sp > 0 && u.alive) {
      const dx = (fx * my + rx * mx), dz = (fz * my + rz * mx), dl = Math.hypot(dx, dz) || 1;
      moved = this.g.step(u, dx / dl * sp * dt, dz / dl * sp * dt);
    }
    u.speedNow = moved ? sp : 0;
    if (u.alive) u.yaw += angDiff(u.yaw, this.yaw) * Math.min(1, dt * 12);
    const cam = this.a.camera, sc = u.scale * (u.d.horse ? 1.55 : 1), cp = Math.cos(this.pitch);
    const dir = new THREE.Vector3(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
    const head = new THREE.Vector3(u.x, heightAt(u.x, u.z) + 1.62 * sc, u.z);
    let want;
    if (this.first) want = head.clone().addScaledVector(dir, .25);
    else { want = head.clone().addScaledVector(dir, -this.camDist * (u.d.horse ? 1.3 : 1)); want.y += .9; want.y = Math.max(want.y, heightAt(want.x, want.z) + .4); }
    if (this.snap || this.first) { this.camPos.copy(want); this.snap = false; } else this.camPos.lerp(want, Math.min(1, dt * 14));
    cam.position.copy(this.camPos);
    cam.lookAt(head.addScaledVector(dir, this.first ? 5 : 3));
    document.getElementById('pvhp').style.width = Math.max(0, u.hp / u.maxHp * 100) + '%';
  }
  turn(dxPx, dyPx, k) { this.yaw -= dxPx * k; this.pitch = clamp(this.pitch - dyPx * k * .8, -1.2, .9); }

  // ---------- pointer events ----------
  down(e) {
    if (e.pointerType === 'mouse') {
      if (!document.pointerLockElement) this.a.canvas.requestPointerLock?.();
      else if (e.button === 0) this.strike();
      return;
    }
    if (e.clientX < innerWidth * .45 && !this.joy) {
      this.joy = { id: e.pointerId, x0: e.clientX, y0: e.clientY };
      this.joyEl.style.left = e.clientX + 'px'; this.joyEl.style.top = e.clientY + 'px';
      this.joyEl.classList.remove('hide'); this.knob.style.transform = '';
    } else if (!this.look) this.look = { id: e.pointerId, x: e.clientX, y: e.clientY };
  }
  move(e) {
    if (e.pointerType === 'mouse') { if (document.pointerLockElement) this.turn(e.movementX, e.movementY, .0025); return; }
    if (this.joy && e.pointerId === this.joy.id) {
      let dx = e.clientX - this.joy.x0, dy = e.clientY - this.joy.y0; const d = Math.hypot(dx, dy);
      if (d > JOY_R) { dx *= JOY_R / d; dy *= JOY_R / d; }
      this.knob.style.transform = `translate(${dx}px,${dy}px)`;
      this.stick.x = dx / JOY_R; this.stick.y = -dy / JOY_R;
    } else if (this.look && e.pointerId === this.look.id) {
      this.turn(e.clientX - this.look.x, e.clientY - this.look.y, .006);
      this.look.x = e.clientX; this.look.y = e.clientY;
    }
  }
  up(e) {
    if (this.joy && e.pointerId === this.joy.id) { this.joy = null; this.stick.x = this.stick.y = 0; this.joyEl.classList.add('hide'); }
    if (this.look && e.pointerId === this.look.id) this.look = null;
  }
  cancel() { this.joy = this.look = null; this.stick.x = this.stick.y = 0; this.joyEl.classList.add('hide'); }
  wheel(e) { if (!this.first) this.camDist = clamp(this.camDist * Math.exp(e.deltaY * .001), 2.2, 9); }
}
