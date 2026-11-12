// Sound, generated in code with the Web Audio API (nothing to download): UI clicks, sword clangs, arrows, hammering,
// chopping, collapses, alarm horn, age-up fanfare, plus gentle wind-and-birds ambience. Starts on the first tap/click.
export class Sound {
  constructor() {
    this.ctx = null; this.last = {};
    try { this.on = localStorage.getItem('bf.sound') !== 'off'; } catch { this.on = true; }
  }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = this.on ? (this.vol ?? .7) : 0;
    const comp = c.createDynamicsCompressor(); this.master.connect(comp); comp.connect(c.destination);
    const len = c.sampleRate; this.noise = c.createBuffer(1, len, c.sampleRate); const d = this.noise.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.ambience(); this.startMusic();
  }
  // ---------- music: generated live, calm in peace, drums and brass in battle ----------
  setMusic(on) { this.musicOn = on; if (this.mus) this.mus.gain.value = on ? .55 : 0; }
  startMusic() {
    if (!this.ctx || this.mus) return; const c = this.ctx;
    this.mus = c.createGain(); this.mus.gain.value = this.musicOn === false ? 0 : .55; this.mus.connect(this.master);
    this.calm = c.createGain(); this.war = c.createGain(); this.calm.gain.value = 1; this.war.gain.value = 0; this.calm.connect(this.mus); this.war.connect(this.mus);
    const rev = c.createDelay(); rev.delayTime.value = .23; const fb = c.createGain(); fb.gain.value = .28; const wet = c.createGain(); wet.gain.value = .25; // a little echo for space
    this.calm.connect(rev); rev.connect(fb); fb.connect(rev); rev.connect(wet); wet.connect(this.mus);
    this.next = c.currentTime + .2; this.step = 0; this.fight = 0; this.deg = 0;
    const drone = (f, g) => { const o = c.createOscillator(), gn = c.createGain(), lp = c.createBiquadFilter(); o.type = 'sawtooth'; o.frequency.value = f; lp.type = 'lowpass'; lp.frequency.value = 260; gn.gain.value = g; o.connect(lp); lp.connect(gn); gn.connect(this.calm); o.start(); };
    drone(73.4, .05); drone(110, .03);
    setInterval(() => this.schedule(), 90);
  }
  /** 0 = peace .. 1 = battle; the music follows smoothly. */
  setIntensity(k) { this.fight = k; if (!this.mus) return; const t = this.ctx.currentTime; this.calm.gain.setTargetAtTime(1 - k * .85, t, 1.5); this.war.gain.setTargetAtTime(k, t, 1.2); }
  pluck(f, t, dur, out, vol = .14) { const c = this.ctx, o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter(); o.type = 'triangle'; o2.type = 'sawtooth'; o.frequency.value = f; o2.frequency.value = f * 1.003; lp.type = 'lowpass'; lp.frequency.setValueAtTime(f * 6, t); lp.frequency.exponentialRampToValueAtTime(f * 1.5, t + dur); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + .006); g.gain.exponentialRampToValueAtTime(.0001, t + dur); const g2 = c.createGain(); g2.gain.value = .25; o.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(out); o.start(t); o2.start(t); o.stop(t + dur + .05); o2.stop(t + dur + .05); }
  drum(t, big, out) { this.tone('sine', big ? 110 : 190, t, big ? .5 : .18, big ? .35 : .12, out, big ? 45 : 90); this.burst(t, big ? .12 : .1, big ? .12 : .07, 'bandpass', big ? 300 : 1400, .8, out); }
  schedule() {
    const c = this.ctx; if (!c || c.state !== 'running' || !this.on) { if (c) this.next = c.currentTime + .1; return; }
    const SC = [146.8, 164.8, 174.6, 196, 220, 246.9, 261.6, 293.7, 329.6, 349.2]; // D dorian, two octaves
    const war = this.fight > .5, beat = 60 / (war ? 116 : 76) / 2; // eighth notes
    while (this.next < c.currentTime + .35) {
      const t = this.next, st = this.step++, bar = st % 16;
      if (war) {
        if (bar % 4 === 0) this.drum(t, true, this.war); else if (bar % 2 === 0 || Math.random() < .3) this.drum(t, false, this.war);
        if (bar % 4 === 0) { const f = [73.4, 73.4, 65.4, 82.4][(st >> 4) % 4]; const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700; lp.connect(this.war); this.tone('sawtooth', f * 2, t, .07, beat * 3.6, lp); this.tone('sawtooth', f * 3, t, .04, beat * 3.6, lp); }
        if (bar % 2 === 0 && Math.random() < .7) { this.deg = Math.max(0, Math.min(7, this.deg + [-1, 1, 2, -2, 0][Math.random() * 5 | 0])); this.pluck(SC[this.deg] * 2, t, beat * 1.6, this.war, .09); }
      } else {
        const rest = Math.random() < (bar % 4 === 3 ? .7 : .25);
        if (!rest) { this.deg = Math.max(0, Math.min(9, this.deg + [-1, 1, -2, 2, 0, 1, -1, 3][Math.random() * 8 | 0])); if (bar === 0) this.deg = [0, 4, 3, 2][(st >> 4) % 4]; this.pluck(SC[this.deg], t, beat * 3, this.calm); }
        if (bar === 0 || bar === 8) this.pluck(SC[this.deg % 5] / 2, t, beat * 6, this.calm, .1);
      }
      this.next += beat;
    }
  }
  // ---------- unit voices (the device's built-in speech) ----------
  say(text, { pitch = 1, rate = 1.05, lang } = {}) {
    if (!this.on || this.voiceOn === false || !window.speechSynthesis) return;
    const now = performance.now(); if (now - (this.lastSay || 0) < 1100) return; this.lastSay = now;
    try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.pitch = pitch; u.rate = rate; u.volume = Math.min(1, (this.vol ?? .7) * 1.3);
      const vs = speechSynthesis.getVoices(), v = (lang && vs.find(v => v.lang?.startsWith(lang))) || vs.find(v => v.lang?.startsWith('en')); if (v) u.voice = v; speechSynthesis.speak(u); } catch { /* ignore */ }
  }
  /** Rain hiss, 0..1. */
  setRain(k) { if (!this.ctx) return; if (!this.rainG) { const s = this.ctx.createBufferSource(), hp = this.ctx.createBiquadFilter(); this.rainG = this.ctx.createGain(); s.buffer = this.noise; s.loop = true; hp.type = 'highpass'; hp.frequency.value = 1800; s.connect(hp); hp.connect(this.rainG); this.rainG.connect(this.master); this.rainG.gain.value = 0; s.start(); } this.rainG.gain.value = k * .09; }
  setVolume(v) { this.vol = v; if (this.master) this.master.gain.value = this.on ? .7 * v / .7 : 0; }
  toggle() { this.on = !this.on; try { localStorage.setItem('bf.sound', this.on ? 'on' : 'off'); } catch { /* ignore */ } if (this.master) this.master.gain.value = this.on ? (this.vol ?? .7) : 0; return this.on; }
  // ---- building blocks ----
  env(g, t, a, peak, dec) { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(.0001, t + a + dec); }
  tone(type, f, t, peak, dec, out, f2) { const c = this.ctx, o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dec); this.env(g, t, .004, peak, dec); o.connect(g); g.connect(out); o.start(t); o.stop(t + dec + .05); }
  burst(t, peak, dec, ftype, f, q, out, f2) { const c = this.ctx, s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain(); s.buffer = this.noise; s.playbackRate.value = .8 + Math.random() * .4; fl.type = ftype; fl.frequency.setValueAtTime(f, t); if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dec); fl.Q.value = q; this.env(g, t, .003, peak, dec); s.connect(fl); fl.connect(g); g.connect(out); s.start(t, Math.random() * .5); s.stop(t + dec + .05); }
  /** Play a named effect. vol 0..1 (callers scale it by distance). */
  play(name, vol = 1) {
    if (!this.ctx || !this.on || vol < .03) return;
    const now = this.ctx.currentTime, gap = { thunder: 3, clang: .05, thud: .05, arrow: .07, knock: .09, chop: .09, click: .02 }[name] || .15;
    if (now - (this.last[name] || 0) < gap) return; this.last[name] = now;
    const out = this.ctx.createGain(); out.gain.value = vol; out.connect(this.master); const t = now + .005, r = .9 + Math.random() * .2;
    switch (name) {
      case 'click': this.tone('sine', 880, t, .12, .05, out); break;
      case 'clang': for (const [f, a] of [[1150, .14], [2650, .08], [4100, .05]]) this.tone('sine', f * r, t, a, .25, out); this.burst(t, .12, .06, 'highpass', 3000, .7, out); break;
      case 'thud': this.burst(t, .25, .12, 'lowpass', 600 * r, .8, out); this.tone('sine', 110 * r, t, .15, .1, out); break;
      case 'arrow': this.burst(t, .07, .18, 'bandpass', 3500, 2, out, 900); break;
      case 'knock': this.tone('sine', 190 * r, t, .22, .09, out); this.burst(t, .08, .03, 'bandpass', 1800, 1, out); break;
      case 'chop': this.tone('triangle', 240 * r, t, .18, .07, out); this.burst(t, .12, .05, 'bandpass', 900, 1.5, out); break;
      case 'stone': this.burst(t, .35, .35, 'lowpass', 900, .7, out, 200); this.tone('sine', 70, t, .3, .3, out); break;
      case 'collapse': this.burst(t, .45, 1.6, 'lowpass', 1200, .5, out, 120); this.tone('sine', 50, t, .35, 1.2, out); break;
      case 'splash': this.burst(t, .25, .4, 'bandpass', 900, .8, out, 400); break;
      case 'chime': this.tone('sine', 880, t, .12, .5, out); this.tone('sine', 1320, t + .08, .08, .5, out); break;
      case 'horn': for (const [f, dt] of [[196, 0], [233, .35]]) { const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.connect(out); this.tone('sawtooth', f, t + dt, .12, .5, lp); } break;
      case 'thunder': this.burst(t, .6, 2.6, 'lowpass', 500, .4, out, 60); this.tone('sine', 40, t + .05, .4, 2, out); break;
      case 'fanfare': [261.6, 329.6, 392, 523.2].forEach((f, i) => { const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1600; lp.connect(out); this.tone('sawtooth', f, t + i * .16, .12, i === 3 ? .9 : .25, lp); }); break;
    }
  }
  ambience() {
    const c = this.ctx, s = c.createBufferSource(), lp = c.createBiquadFilter(), g = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
    s.buffer = this.noise; s.loop = true; lp.type = 'lowpass'; lp.frequency.value = 420; g.gain.value = .035; lfo.frequency.value = .08; lg.gain.value = .02;
    lfo.connect(lg); lg.connect(g.gain); s.connect(lp); lp.connect(g); g.connect(this.master); s.start(); lfo.start();
    const bird = () => {
      if (this.on && this.ctx.state === 'running') { const t = c.currentTime, out = c.createGain(); out.gain.value = .05; out.connect(this.master); const f = 2400 + Math.random() * 1800, n = 2 + (Math.random() * 3 | 0); for (let i = 0; i < n; i++) this.tone('sine', f, t + i * .13, .5, .09, out, f * 1.35); }
      setTimeout(bird, 3000 + Math.random() * 7000);
    };
    setTimeout(bird, 2500);
  }
}
