// Guided first game: one instruction at a time, the button to press glows, and the step completes when you do it.
// The enemy stays peaceful until the tutorial is finished.

const btnByText = re => [...document.querySelectorAll('#card .btn, #quick .btn, #povact .btn, #povbar .btn')].find(b => re.test(b.innerText));

export const STEPS = [
  { say: a => a.isTouch ? 'Welcome, Commander! Drag with one finger to look around your village, and pinch to zoom.' : 'Welcome, Commander! Move the camera with WASD or the arrow keys (or the screen edges), and zoom with the mouse wheel.',
    done: (g, a, s) => Math.hypot(a.rts.focus.x - s.fx, a.rts.focus.z - s.fz) > 4 || Math.abs(a.rts.dist - s.dist) > 4, start: (g, a, s) => { s.fx = a.rts.focus.x; s.fz = a.rts.focus.z; s.dist = a.rts.dist; } },
  { say: a => `${a.isTouch ? 'Tap' : 'Click'} one of your peasants (the villagers in straw hats) to select them.`, done: (g, a) => a.sel.some(u => u.type === 'peasant') },
  { say: a => `Now ${a.isTouch ? 'tap' : 'right-click'} a tree. Your peasant walks over and chops wood. (You can also just tap any tree or bush to send the nearest free peasant.)`,
    start: (g, a, s) => { s.was = new Map(g.units.map(u => [u, u.task.res])); },
    done: (g, a, s) => g.units.some(u => u.team === 0 && u.type === 'peasant' && u.task.type === 'gather' && u.task.res?.rt === 'w' && s.was.get(u) !== u.task.res) },
  { say: () => 'Wood, food and gold are shown at the top. Select your Town Hall (the big building) and press Peasant to train another worker.',
    glow: () => btnByText(/^Peasant/), done: (g, a, s) => g.blds.some(b => b.team === 0 && b.type === 'hall' && b.queue.some(q => q.type === 'peasant')) || g.units.filter(u => u.team === 0 && u.type === 'peasant').length > s.peas, start: (g, a, s) => { s.peas = g.units.filter(u => u.team === 0 && u.type === 'peasant').length; } },
  { say: a => `Houses let you have more people. Select a peasant, press "Build economy", then House, then ${a.isTouch ? 'tap the ground and press ✓' : 'click the ground'} to place it.`,
    glow: () => btnByText(/^House/) || btnByText(/Build\s*economy/), done: g => g.blds.some(b => b.team === 0 && b.type === 'house') },
  { say: () => 'Your peasant is building it: watch the progress bar. Send more peasants to help (select them and tap the building) and it finishes faster!', done: g => g.blds.some(b => b.team === 0 && b.type === 'house' && b.built) },
  { say: () => 'Time for soldiers. I\'ve given you extra wood. Select a peasant, press "Build military", then Barracks, and place it.',
    start: g => { g.T[0].w += 200; g.T[0].f += 150; g.T[0].g += 60; }, glow: () => btnByText(/^Barracks/) || btnByText(/Build\s*military/), done: g => g.blds.some(b => b.team === 0 && b.type === 'barracks' && b.built) },
  { say: () => 'Select the Barracks and train 3 Swordsmen.', glow: () => btnByText(/^Swordsman/), done: g => g.units.filter(u => u.team === 0 && u.alive && u.type === 'sword').length >= 3 },
  { say: a => `Raiders! Press Army to select your soldiers, then ${a.isTouch ? 'tap' : 'right-click'} an enemy to attack. (Attack in the panel makes them fight anything on the way.)`,
    start: (g, a, s) => { const h = g.blds.find(b => b.team === 0 && b.type === 'hall'); s.raiders = [0, 1, 2].map(i => { const u = g.spawnUnit(1, 'sword', h.x + 15 + i, h.z - 14); u.hp = u.maxHp = 25; g.amove(u, h.x + 3, h.z - 3); return u; }); g.recount(); a.rts.lookAt(h.x + 8, h.z - 8); },
    glow: () => btnByText(/^Army/), done: (g, a, s) => s.raiders.every(u => !u.alive) },
  { say: () => 'Well fought! Now lead from the front: press "Play as Commander" to ride into battle in 3rd person.', glow: () => document.getElementById('bLead'), done: (g, a) => a.mode === 'pov' && a.pov.unit?.d.hero },
  { say: a => a.isTouch ? 'Left thumb moves, right thumb looks, Strike attacks. Walk through your Town Hall door to go inside (walk back out the same way), or press Command to go back up.' : 'W/S walk, drag the mouse to look, click to strike. Walk through the Town Hall door to go inside (walk back out the same way), or press Command (Tab) to go back up.',
    done: (g, a, s) => (s.t = (s.t || 0) + 1) > 25 && (a.mode === 'rts' || a.pov.room) },
  { say: () => 'You\'re ready! Advance through the ages at the Town Hall, build an army, and burn down the enemy Town Hall in the north-east. Good luck, Commander!', done: (g, a, s) => (s.t = (s.t || 0) + 1) > 12, last: true },
];

export class Tutorial {
  constructor(app) { this.a = app; this.i = -1; this.s = {}; this.box = document.getElementById('tutor'); this.done = false; this.next(); }
  next() {
    if (this.glowEl) this.glowEl.classList.remove('glow');
    this.i++; this.s = {};
    if (this.i >= STEPS.length) { this.done = true; this.box.classList.add('hide'); this.a.toast('Tutorial complete — the enemy is on the move!', 4); this.a.ai.nextAttack = this.a.game.time + 240; return; }
    const st = STEPS[this.i]; st.start?.(this.a.game, this.a, this.s);
    this.box.classList.remove('hide');
    this.box.querySelector('.tt').textContent = st.say(this.a);
    this.box.querySelector('.tn').textContent = `Step ${this.i + 1} of ${STEPS.length}`;
    this.a.sfx?.('chime');
  }
  skip() { this.i = STEPS.length - 1; this.next(); }
  update() {
    if (this.done) return;
    const st = STEPS[this.i], g = this.a.game;
    const el = st.glow?.(); if (el !== this.glowEl) { this.glowEl?.classList.remove('glow'); this.glowEl = el; el?.classList.add('glow'); }
    if (st.done(g, this.a, this.s)) this.next();
  }
}
