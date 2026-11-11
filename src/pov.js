// 1st/3rd-person control of one unit (the hero or any possessed unit).
import * as THREE from 'three';
import { heightAt, clamp } from './terrain.js';

const JOY_R = 55;

export class POVView {
  constructor(game) {
    this.g = game; this.unit = null; this.first = false;
    this.yaw = 0; this.pitch = -.2; this.camDist = 5;
    this.joy = null; this.look = null; this.stick = { x: 0, y: 0 };
    this.joyEl = document.getElementById('joy'); this.knob = document.getElementById('knob');
    this.camPos = new THREE.Vector3();
  }
  enter(unit) {
    this.unit = unit; unit.possessed = true; unit.target = null; unit.ring.visible = false;
    this.yaw = unit.yaw; this.pitch = -.2; this.snap = true;
    this.setFirst(this.first);
  }
  leave() {
    const u = this.unit; if (!u) return;
    u.possessed = false; u.speedNow = 0; u.mesh.visible = true; u.ring.visible = u.selected;
    this.unit = null; this.cancel();
    if (document.pointerLockElement) document.exitPointerLock();
  }
  setFirst(v) {
    this.first = v;
    if (this.unit) this.unit.mesh.visible = !v;
    document.getElementById('xhair').classList.toggle('hide', !v);
    document.getElementById('bView').innerHTML = v ? '3rd<small>person</small>' : '1st<small>person</small>';
  }

  update(dt) {
    const u = this.unit, keys = this.g.keys; if (!u) return;
    let mx = this.stick.x, my = this.stick.y;
    if (keys.KeyW || keys.ArrowUp) my += 1; if (keys.KeyS || keys.ArrowDown) my -= 1;
    if (keys.KeyD || keys.ArrowRight) mx += 1; if (keys.KeyA || keys.ArrowLeft) mx -= 1;
    if (keys.KeyQ) this.yaw += dt * 2.2; if (keys.KeyE) this.yaw -= dt * 2.2;
    const len = Math.hypot(mx, my); if (len > 1) { mx /= len; my /= len; }
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), rx = -fz, rz = fx;
    const sprint = keys.ShiftLeft || keys.ShiftRight || Math.hypot(this.stick.x, this.stick.y) > .95;
    const sp = u.def.speed * (sprint ? 1.5 : 1) * Math.min(1, Math.hypot(mx, my));
    let moved = false;
    if (sp > 0) {
      const dx = (fx * my + rx * mx), dz = (fz * my + rz * mx), dl = Math.hypot(dx, dz) || 1;
      moved = u.step(dx / dl * sp * dt, dz / dl * sp * dt);
    }
    u.speedNow = moved ? sp : 0;
    u.turnTo(this.yaw, dt * 2);
    // camera
    const cam = this.g.camera, sc = u.def.scale, cp = Math.cos(this.pitch);
    const dir = new THREE.Vector3(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
    const head = new THREE.Vector3(u.x, u.y + 1.62 * sc, u.z);
    let want;
    if (this.first) want = head.clone().addScaledVector(dir, .12);
    else {
      want = head.clone().addScaledVector(dir, -this.camDist); want.y += .9;
      want.y = Math.max(want.y, heightAt(want.x, want.z) + .4);
    }
    if (this.snap || this.first) { this.camPos.copy(want); this.snap = false; }
    else this.camPos.lerp(want, Math.min(1, dt * 14));
    cam.position.copy(this.camPos);
    cam.lookAt(this.first ? head.addScaledVector(dir, 5) : head.addScaledVector(dir, 3));
  }
  turn(dxPx, dyPx, k) {
    this.yaw -= dxPx * k; this.pitch = clamp(this.pitch - dyPx * k * .8, -1.2, .9);
  }

  // ---------- pointer events ----------
  down(e) {
    if (e.pointerType === 'mouse') {
      if (!document.pointerLockElement) this.g.canvas.requestPointerLock?.();
      return;
    }
    if (e.clientX < innerWidth * .45 && !this.joy) { // left thumb: joystick appears where you touch
      this.joy = { id: e.pointerId, x0: e.clientX, y0: e.clientY };
      this.joyEl.style.left = e.clientX + 'px'; this.joyEl.style.top = e.clientY + 'px';
      this.joyEl.classList.remove('hide'); this.knob.style.transform = '';
    } else if (!this.look) this.look = { id: e.pointerId, x: e.clientX, y: e.clientY };
  }
  move(e) {
    if (e.pointerType === 'mouse') {
      if (document.pointerLockElement) this.turn(e.movementX, e.movementY, .0025);
      return;
    }
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
