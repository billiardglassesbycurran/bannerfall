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
    this.master = c.createGain(); this.master.gain.value = this.on ? .7 : 0;
    const comp = c.createDynamicsCompressor(); this.master.connect(comp); comp.connect(c.destination);
    const len = c.sampleRate; this.noise = c.createBuffer(1, len, c.sampleRate); const d = this.noise.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.ambience();
  }
  toggle() { this.on = !this.on; try { localStorage.setItem('bf.sound', this.on ? 'on' : 'off'); } catch { /* ignore */ } if (this.master) this.master.gain.value = this.on ? .7 : 0; return this.on; }
  // ---- building blocks ----
  env(g, t, a, peak, dec) { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(.0001, t + a + dec); }
  tone(type, f, t, peak, dec, out, f2) { const c = this.ctx, o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dec); this.env(g, t, .004, peak, dec); o.connect(g); g.connect(out); o.start(t); o.stop(t + dec + .05); }
  burst(t, peak, dec, ftype, f, q, out, f2) { const c = this.ctx, s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain(); s.buffer = this.noise; s.playbackRate.value = .8 + Math.random() * .4; fl.type = ftype; fl.frequency.setValueAtTime(f, t); if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dec); fl.Q.value = q; this.env(g, t, .003, peak, dec); s.connect(fl); fl.connect(g); g.connect(out); s.start(t, Math.random() * .5); s.stop(t + dec + .05); }
  /** Play a named effect. vol 0..1 (callers scale it by distance). */
  play(name, vol = 1) {
    if (!this.ctx || !this.on || vol < .03) return;
    const now = this.ctx.currentTime, gap = { clang: .05, thud: .05, arrow: .07, knock: .09, chop: .09, click: .02 }[name] || .15;
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
