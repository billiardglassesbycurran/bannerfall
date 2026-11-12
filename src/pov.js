// 1st/3rd-person control of one unit (the hero or any possessed unit): move, look, strike, rally troops.
import * as THREE from 'three';
import { heightAt, groundY, blocked, N, WL, cellWalk } from './world.js';
import { nearestWalkable } from './path.js';
import { ENTERABLE, interiorGeo, SHIP_LEN } from './models.js';
import { M } from './geo.js';
import { clamp, angDiff, dist } from './util.js';

const JOY_R = 55;

export class POVView {
  constructor(app) {
    this.a = app; this.unit = null; this.first = false;
    this.yaw = 0; this.pitch = -.2; this.camDist = 5;
    this.joy = null; this.look = null; this.stick = { x: 0, y: 0 };
    this.joyEl = document.getElementById('joy'); this.knob = document.getElementById('knob');
    this.camPos = new THREE.Vector3(); this.followers = []; this.target = null; this.holding = false;
    this.mark = new THREE.Mesh(new THREE.RingGeometry(.5, .66, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff3a2a, transparent: true, opacity: .85, depthWrite: false }));
    this.mark.visible = false; app.scene.add(this.mark);
    this.joyIdle = document.getElementById('joyIdle');
  }
  get g() { return this.a.game; }
  enter(unit) {
    this.unit = unit; unit.possessed = true; this.g.setTask(unit, { type: 'idle' });
    this.yaw = unit.yaw; this.pitch = -.2; this.snap = true; this.followers = [];
    this.setFirst(this.first); this.updateFollowBtn();
  }
  leave() {
    const u = this.unit; if (!u) return;
    if (this.room) this.exitRoom();
    if (u.onShip) { if (!this.disembark(true)) { const sh = u.onShip; if (sh.cargo && sh.cargo.length < sh.d.carry) { this.getOff(sh); u.boarded = sh; sh.cargo.push(u); } else { const p = nearestWalkable(sh.x, sh.z, 30); if (p) { u.x = p.x; u.z = p.z; } this.getOff(sh); } } }
    u.aimHold = false;
    this.mark.visible = false; this.holding = false;
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

  // ---------- walk onto ships / into buildings / mount ----------
  /** What the Act button (G) would do right now: { label, run } or null. */
  action() {
    const u = this.unit, g = this.g; if (!u || !u.alive) return null;
    if (this.room) return { label: 'Leave', sub: ENTERABLE[this.room.b.type], run: () => this.exitRoom(true) };
    if (u.onShip) return { label: 'Go ashore', sub: this.landNear(u.onShip) ? 'step off' : 'sail closer', run: () => this.disembark() };
    if (u.d.ship) return null;
    let best = null, bd = 1e9;
    for (const s of g.units) if (s.alive && s.team === u.team && s.d.ship && !s.possessed) { const d = Math.hypot(s.x - u.x, s.z - u.z) - s.d.rad; if (d < 3.2 && d < bd) { bd = d; best = s; } }
    if (best) return { label: 'Board', sub: best.d.name.replace(' Ship', ''), run: () => this.board(best) };
    for (const b of g.blds) if (b.alive && b.built && b.team === u.team && ENTERABLE[b.type] && g.edgeDist(u, b) < 1.8) return { label: 'Enter', sub: ENTERABLE[b.type], run: () => this.enterRoom(b) };
    return null;
  }
  landNear(sh) { const p = nearestWalkable(sh.x, sh.z, 6); return p && Math.hypot(p.x - sh.x, p.z - sh.z) < 6.5 ? p : null; }
  board(sh) {
    const u = this.unit; u.onShip = sh; sh.possessed = true; this.g.setTask(sh, { type: 'idle' }); sh.path = null;
    this.camDist0 = this.camDist; this.camDist = Math.max(this.camDist, 6.5); this.a.toast(`Aboard the ${sh.d.name}: W/S sail, A/D steer. Act button to go ashore.`, 4); this.a.sfx?.('knock');
  }
  getOff(sh) { const u = this.unit; u.onShip = null; u.yOver = null; sh.possessed = false; sh.speedNow = 0; if (this.camDist0) this.camDist = this.camDist0; }
  disembark(quiet) {
    const u = this.unit, sh = u.onShip; if (!sh) return false;
    const p = this.landNear(sh); if (!p) { if (!quiet) this.a.toast('Sail closer to the shore to step off.', 2); return false; }
    this.getOff(sh); u.x = p.x; u.z = p.z; this.snap = true; return true;
  }
  /** Step through the door into a lit, furnished room. */
  enterRoom(b) {
    const u = this.unit, it = interiorGeo(b.type, b.team), grp = new THREE.Group();
    const m = new THREE.Mesh(it.geo, M.stone); m.receiveShadow = true; grp.add(m);
    for (const [x, y, z] of it.lights) { const l = new THREE.PointLight(0xffc890, 3.2, 8, 1.6); l.position.set(x, y, z); grp.add(l); }
    grp.position.copy(b.mesh.position); grp.rotation.y = b.mesh.rotation.y; this.a.scene.add(grp);
    b.mesh.visible = false; this.room = { b, grp, it, ry: b.mesh.rotation.y };
    this.setLocal(0, it.D / 2 - .7); u.yaw = this.room.ry + Math.PI; this.yaw = u.yaw; this.pitch = -.1; this.snap = true;
    this.a.sfx?.('knock'); this.a.toast(`Inside the ${ENTERABLE[b.type]}.`, 2);
  }
  exitRoom(walkOut) {
    const r = this.room; if (!r) return; const u = this.unit;
    r.grp.removeFromParent(); r.b.mesh.visible = true; this.room = null; u.yOver = null;
    if (u && walkOut !== false) { const s = r.b.size / 2 + .9, wx = r.b.x + Math.sin(r.ry) * s, wz = r.b.z + Math.cos(r.ry) * s, p = nearestWalkable(wx, wz, 6) || { x: wx, z: wz }; u.x = p.x; u.z = p.z; u.yaw = r.ry; this.yaw = r.ry; this.snap = true; }
  }
  local() { const r = this.room, u = this.unit, dx = u.x - r.b.x, dz = u.z - r.b.z, c = Math.cos(r.ry), s = Math.sin(r.ry); return [dx * c - dz * s, dx * s + dz * c]; }
  setLocal(lx, lz) { const r = this.room, u = this.unit, c = Math.cos(r.ry), s = Math.sin(r.ry); u.x = r.b.x + lx * c + lz * s; u.z = r.b.z - lx * s + lz * c; }
  toggleMount() {
    const u = this.unit; if (!u || !u.d.hero || u.onShip || this.room) return;
    if (this.g.setMount(u, !u.d.horse)) { this.a.fx?.dust(u.x, u.y, u.z, 10, 1.2); this.a.sfx?.('thud'); this.a.toast(u.d.horse ? 'Mounted! Faster, and you strike from the saddle.' : 'Dismounted.', 2); }
  }

  // ---------- actions ----------
  /** The enemy your next strike/shot will hit (shown with a red ring). */
  findTarget() {
    const u = this.unit, g = this.g; if (!u || !u.alive) return null;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), ranged = u.d.ranged, maxD = ranged ? u.d.rng + 4 : u.d.rng + 1.6;
    let best = null, bs = -1e9;
    for (const e of g.units) if (e.alive && e.team !== u.team) {
      const dx = e.x - u.x, dz = e.z - u.z, d = Math.hypot(dx, dz) - e.d.rad; if (d > maxD) continue;
      const dot = (dx * fx + dz * fz) / (Math.hypot(dx, dz) || 1); if (dot < (ranged ? .9 : .55)) continue;
      const sc = dot * 2 - d / maxD; if (sc > bs) { bs = sc; best = e; }
    }
    if (!best) for (const b of g.blds) if (b.alive && b.team !== u.team && g.edgeDist(u, b) < maxD) { const dx = b.x - u.x, dz = b.z - u.z; if ((dx * fx + dz * fz) / (Math.hypot(dx, dz) || 1) > .5) best = b; }
    return best;
  }
  strike() {
    const u = this.unit; if (!u || !u.alive || u.cd > 0) return;
    const g = this.g, t = this.target;
    u.cd = u.d.cd * .75; u.swingT = 0; this.faceT = .6;
    if (u.d.ranged) { if (t) g.shoot(u, t, u.d.dmg * 1.2); else this.a.toast('No target in sight — aim at an enemy.', 1.5); return; }
    if (t && t.kind === 'unit') { // lunge toward the target
      const dx = t.x - u.x, dz = t.z - u.z, d = Math.hypot(dx, dz), gap = d - t.d.rad - u.d.rng * .8;
      if (gap > 0) { const st = Math.min(gap, .9); g.step(u, dx / d * st, dz / d * st); }
      this.yaw += angDiff(this.yaw, Math.atan2(dx, dz)) * .5;
    }
    const reach = u.d.rng + .8; let hit = 0;
    if (t && t.kind === 'unit' && Math.hypot(t.x - u.x, t.z - u.z) - t.d.rad <= reach) { g.damage(t, u.d.dmg * 1.25, u); hit++; }
    if (u.d.hero) for (const e of g.units) if (e.alive && e !== t && e.team !== u.team && hit < 3) { // the Commander's sweep hits up to 3
      const dx = e.x - u.x, dz = e.z - u.z; if (Math.hypot(dx, dz) - e.d.rad <= reach && Math.abs(angDiff(this.yaw, Math.atan2(dx, dz))) < 1.1) { g.damage(e, u.d.dmg, u); hit++; }
    }
    if (!hit && t && t.kind === 'bld' && g.edgeDist(u, t) < reach) g.damage(t, u.d.dmg, u);
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
    // movement: W/S or ↑/↓ forward/back, A/D strafe; turning: ←/→ or Q/E, or drag with the mouse
    let mx = this.stick.x, my = this.stick.y;
    if (keys.KeyW || keys.ArrowUp) my += 1; if (keys.KeyS || keys.ArrowDown) my -= 1;
    if (keys.KeyD) mx += 1; if (keys.KeyA) mx -= 1;
    const turnK = dt * 2.4;
    if (keys.ArrowLeft || keys.KeyQ) this.yaw += turnK; if (keys.ArrowRight || keys.KeyE) this.yaw -= turnK;
    if (keys.KeyZ || keys.PageUp) this.pitch = clamp(this.pitch + dt * 1.2, -1.2, .9); if (keys.KeyX || keys.PageDown) this.pitch = clamp(this.pitch - dt * 1.2, -1.2, .9);
    const len = Math.hypot(mx, my); if (len > 1) { mx /= len; my /= len; }
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), rx = -fz, rz = fx;
    const sprint = keys.ShiftLeft || keys.ShiftRight || Math.hypot(this.stick.x, this.stick.y) > .95;
    const sp = u.d.spd * (sprint ? 1.45 : 1) * (u.chargeT > this.a.game.time ? 1.6 : 1) * Math.min(1, Math.hypot(mx, my));
    let moved = false, mdx = 0, mdz = 0;
    if (u.onShip && u.onShip.alive) { // steering a ship from its deck
      const sh = u.onShip, L = SHIP_LEN[sh.type] || 4, turn = -mx * dt * .9 * (my < 0 ? -1 : 1), v = sh.d.spd * (my > 0 ? my : my * .4);
      sh.yaw += turn; this.yaw += turn;
      const ok = v && this.g.step(sh, Math.sin(sh.yaw) * v * dt, Math.cos(sh.yaw) * v * dt); sh.speedNow = ok ? Math.abs(v) : 0;
      u.x = sh.x - Math.sin(sh.yaw) * L * .14; u.z = sh.z - Math.cos(sh.yaw) * L * .14;
      u.yOver = WL + (sh.type === 'transport' ? .14 : sh.type === 'warship' ? .03 : .02) + Math.sin(this.g.time * 1.6 + sh.id) * .04;
    } else if (this.room) { // walking around inside a building
      const r = this.room, [lx, lz] = this.local();
      if (sp > 0) { mdx = fx * my + rx * mx; mdz = fz * my + rz * mx; const dl = Math.hypot(mdx, mdz) || 1, c = Math.cos(r.ry), sn = Math.sin(r.ry);
        const wx = mdx / dl * sp * .7 * dt, wz = mdz / dl * sp * .7 * dt, nlx = lx + wx * c - wz * sn, nlz = lz + wx * sn + wz * c;
        if (nlz > r.it.D / 2 - .3 && Math.abs(nlx) < .55) { this.exitRoom(true); moved = true; }
        else { this.setLocal(clamp(nlx, -r.it.W / 2 + .3, r.it.W / 2 - .3), clamp(nlz, -r.it.D / 2 + .3, r.it.D / 2 - .35)); moved = true; } }
      if (this.room) u.yOver = r.b.mesh.position.y;
    } else if (sp > 0 && u.alive) {
      mdx = fx * my + rx * mx; mdz = fz * my + rz * mx; const dl = Math.hypot(mdx, mdz) || 1;
      moved = this.g.step(u, mdx / dl * sp * dt, mdz / dl * sp * dt);
    }
    if (u.onShip && !u.onShip.alive) this.getOff(u.onShip);
    u.speedNow = moved ? sp * (this.room ? .7 : 1) : 0;
    u.aimHold = !!(u.d.ranged && this.target);
    // in 3rd person the Commander turns to face where he walks (so you can turn around and run toward the camera);
    // while fighting, in 1st person, or standing still he faces where you look
    this.faceT = Math.max(0, (this.faceT || 0) - dt);
    if (u.alive) { const want = this.first || this.faceT > 0 || u.onShip ? this.yaw : moved ? Math.atan2(mdx, mdz) : u.yaw; u.yaw += angDiff(u.yaw, want) * Math.min(1, dt * 10); }
    if (u.onShip) u.speedNow = 0;
    const cam = this.a.camera, sc = u.scale * (u.d.horse ? 1.55 : 1), cp = Math.cos(this.pitch);
    const dir = new THREE.Vector3(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
    const head = new THREE.Vector3(u.x, (u.yOver ?? groundY(u.x, u.z)) + 1.62 * sc, u.z);
    let want;
    if (this.first) want = head.clone().addScaledVector(dir, .25);
    else {
      // pull the camera in if a tree is between it and you
      let dist = this.camDist * (u.d.horse ? 1.3 : 1) * (this.room ? .45 : 1);
      for (let t = .8; t < dist; t += .3) { const px = head.x - dir.x * t, pz = head.z - dir.z * t; const bv = blocked[(pz | 0) * N + (px | 0)]; if (bv === 2 || (bv === 4 && !this.room)) { dist = Math.max(1.4, t - .6); break; } } // trees and buildings
      want = head.clone().addScaledVector(dir, -dist); want.y += .9 * dist / this.camDist; want.y = Math.max(want.y, heightAt(want.x, want.z) + .4);
    }
    if (this.room) { // keep the camera inside the room
      const r = this.room, c = Math.cos(r.ry), sn = Math.sin(r.ry), dx = want.x - r.b.x, dz = want.z - r.b.z;
      const lx = clamp(dx * c - dz * sn, -r.it.W / 2 + .2, r.it.W / 2 - .2), lz = clamp(dx * sn + dz * c, -r.it.D / 2 + .2, r.it.D / 2 - .25);
      want.x = r.b.x + lx * c + lz * sn; want.z = r.b.z - lx * sn + lz * c; want.y = clamp(want.y, r.b.mesh.position.y + .5, r.b.mesh.position.y + r.it.H - .2);
    }
    if (this.snap || this.first) { this.camPos.copy(want); this.snap = false; } else this.camPos.lerp(want, Math.min(1, dt * 14));
    cam.position.copy(this.camPos);
    cam.lookAt(head.addScaledVector(dir, this.first ? 5 : 3));
    document.getElementById('pvhp').style.width = Math.max(0, u.hp / u.maxHp * 100) + '%';
    this.target = this.findTarget();
    if (this.target) { const t = this.target, r = t.kind === 'bld' ? t.size * .75 : t.d.rad * 1.6 + .2; this.mark.position.set(t.x, heightAt(t.x, t.z) + .07, t.z); this.mark.scale.setScalar(r / .6); this.mark.visible = true; }
    else this.mark.visible = false;
    if (this.holding && u.cd <= 0) this.strike();
    if (this.room && !this.room.b.alive) this.exitRoom(true);
    // context buttons
    const act = this.action(), key = act ? act.label + act.sub : '';
    if (key !== this.actKey) { this.actKey = key; const el = document.getElementById('bAct'); el.classList.toggle('hide', !act); if (act) el.innerHTML = `${act.label}<small>${act.sub}</small>`; }
    const mk = u.d.hero && !u.onShip && !this.room ? (u.d.horse ? 'Dismount' : 'Mount') : '';
    if (mk !== this.mountKey) { this.mountKey = mk; const el = document.getElementById('bMount'); el.classList.toggle('hide', !mk); if (mk) el.innerHTML = `${mk}<small>horse</small>`; }
  }
  act() { const a = this.action(); if (a) a.run(); }
  turn(dxPx, dyPx, k) {
    k *= this.a.settings?.look || 1;
    if (this.a.isTouch) k *= Math.min(1.3, Math.max(.7, 900 / innerWidth)); this.yaw -= dxPx * k; this.pitch = clamp(this.pitch - dyPx * k * .8, -1.2, .9); }

  // ---------- pointer events ----------
  // Mouse/trackpad: drag (either button) to look around, click to strike, double-click for full mouse-look (Esc to release).
  down(e) {
    if (e.pointerType === 'mouse') {
      if (document.pointerLockElement) { if (e.button === 0) { this.holding = true; this.strike(); } return; }
      this.drag = { x: e.clientX, y: e.clientY, btn: e.button, moved: 0, t: performance.now() };
      return;
    }
    if (e.clientX < innerWidth * .45 && !this.joy) {
      this.joy = { id: e.pointerId, x0: e.clientX, y0: e.clientY };
      this.joyEl.style.left = e.clientX + 'px'; this.joyEl.style.top = e.clientY + 'px';
      this.joyEl.classList.remove('hide'); this.knob.style.transform = ''; this.joyIdle.classList.add('hide');
    } else if (!this.look) this.look = { id: e.pointerId, x: e.clientX, y: e.clientY };
  }
  move(e) {
    if (e.pointerType === 'mouse') {
      if (document.pointerLockElement) this.turn(e.movementX, e.movementY, .0025);
      else if (this.drag) { const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y; this.drag.moved += Math.abs(dx) + Math.abs(dy); this.drag.x = e.clientX; this.drag.y = e.clientY; this.turn(dx, dy, .005); }
      return;
    }
    if (this.joy && e.pointerId === this.joy.id) {
      let dx = e.clientX - this.joy.x0, dy = e.clientY - this.joy.y0; const d = Math.hypot(dx, dy);
      if (d > JOY_R) { dx *= JOY_R / d; dy *= JOY_R / d; }
      this.knob.style.transform = `translate(${dx}px,${dy}px)`;
      this.stick.x = dx / JOY_R; this.stick.y = -dy / JOY_R;
    } else if (this.look && e.pointerId === this.look.id) {
      this.turn(e.clientX - this.look.x, e.clientY - this.look.y, .0055);
      this.look.x = e.clientX; this.look.y = e.clientY;
    }
  }
  up(e) {
    if (e.pointerType === 'mouse') {
      if (e.button === 0) this.holding = false;
      if (this.drag && this.drag.moved < 5 && this.drag.btn === 0) this.strike(); // a click (not a drag) strikes
      this.drag = null;
    }
    if (this.joy && e.pointerId === this.joy.id) { this.joy = null; this.stick.x = this.stick.y = 0; this.joyEl.classList.add('hide'); this.joyIdle.classList.remove('hide'); }
    if (this.look && e.pointerId === this.look.id) this.look = null;
  }
  cancel() { this.drag = null; this.joy = this.look = null; this.stick.x = this.stick.y = 0; this.joyEl.classList.add('hide'); }
  wheel(e) {
    // vertical scroll / trackpad pinch = zoom; sideways two-finger swipe = turn
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && !e.ctrlKey) { this.yaw -= e.deltaX * .004; return; }
    if (!this.first) this.camDist = clamp(this.camDist * Math.exp(e.deltaY * (e.ctrlKey ? .01 : .001)), 2.2, 9);
  }
  lockMouse() { if (!this.a.isTouch && !document.pointerLockElement) this.a.canvas.requestPointerLock?.(); }
}
