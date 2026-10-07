// All sound is synthesised with WebAudio — no audio files.
export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    // shared noise buffer
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.startCrowd();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  noiseSrc() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise; s.loop = true;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    return s;
  }

  startCrowd() {
    const ctx = this.ctx;
    const src = this.noiseSrc();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.6;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
    this.crowdGain = ctx.createGain(); this.crowdGain.gain.value = 0.05;
    // slow murmur modulation
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.23;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.015;
    lfo.connect(lfoGain).connect(this.crowdGain.gain);
    src.connect(bp).connect(lp).connect(this.crowdGain).connect(this.master);
    src.start(); lfo.start();
  }

  // excitement 0..1 swells the crowd bed
  crowd(level) {
    if (!this.ctx) return;
    this.crowdGain.gain.setTargetAtTime(0.04 + level * 0.16, this.ctx.currentTime, 0.4);
  }

  cheer(strength = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const src = this.noiseSrc();
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
      bp.frequency.value = 500 + i * 650; bp.Q.value = 1.2;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.22 * strength / (i + 1), t + 0.25 + i * 0.05);
      g.gain.exponentialRampToValueAtTime(0.001, t + 3.2 + strength);
      src.connect(bp).connect(g).connect(this.master);
      src.start(t); src.stop(t + 4.5 + strength);
    }
    // a few "voices": vibrato tones buried in the cheer
    for (let i = 0; i < 6; i++) {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      const f = 220 + Math.random() * 380;
      o.frequency.setValueAtTime(f, t);
      o.frequency.linearRampToValueAtTime(f * (1.1 + Math.random() * 0.2), t + 0.4);
      o.frequency.linearRampToValueAtTime(f * 0.9, t + 1.6);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1200;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.012 * strength, t + 0.2 + Math.random() * 0.3);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 1.8 + Math.random());
      o.connect(lp).connect(g).connect(this.master);
      o.start(t); o.stop(t + 3);
    }
  }

  groan() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = this.noiseSrc();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 400; bp.Q.value = 1.5;
    bp.frequency.linearRampToValueAtTime(250, t + 1.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.18, t + 0.2); g.gain.exponentialRampToValueAtTime(0.001, t + 1.8);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t); src.stop(t + 2);
  }

  // one hoof strike; vol 0..1, pan -1..1
  hoof(vol = 1, pan = 0) {
    if (!this.ctx || vol < 0.02) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const out = ctx.createGain(); out.gain.value = vol;
    if (p) { p.pan.value = pan; out.connect(p).connect(this.master); } else out.connect(this.master);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(120 + Math.random() * 30, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.09);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    o.connect(g).connect(out); o.start(t); o.stop(t + 0.16);
    const n = this.noiseSrc();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.8;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.18, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    n.connect(bp).connect(ng).connect(out); n.start(t); n.stop(t + 0.08);
  }

  // lance shattering on armour: wood crack + metal clang + thump
  crash(power = 1, broke = true) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = ctx.createGain(); out.gain.value = 0.9 * power; out.connect(this.master);
    // thump
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(35, t + 0.3);
    const g = ctx.createGain(); g.gain.setValueAtTime(1, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    o.connect(g).connect(out); o.start(t); o.stop(t + 0.45);
    // crack (several short noise bursts)
    const bursts = broke ? 5 : 1;
    for (let i = 0; i < bursts; i++) {
      const n = this.noiseSrc();
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900 + Math.random() * 1500;
      const ng = ctx.createGain();
      const st = t + i * (0.012 + Math.random() * 0.02);
      ng.gain.setValueAtTime(0, st); ng.gain.linearRampToValueAtTime(0.9, st + 0.003);
      ng.gain.exponentialRampToValueAtTime(0.001, st + 0.09 + Math.random() * 0.1);
      n.connect(hp).connect(ng).connect(out); n.start(st); n.stop(st + 0.3);
    }
    // clang — inharmonic partials
    for (const [f, a] of [[523, 0.25], [1187, 0.18], [1833, 0.12], [2741, 0.08]]) {
      const c = ctx.createOscillator(); c.type = 'triangle'; c.frequency.value = f * (0.97 + Math.random() * 0.06);
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(a, t); cg.gain.exponentialRampToValueAtTime(0.0005, t + 0.5 + Math.random() * 0.6);
      c.connect(cg).connect(out); c.start(t); c.stop(t + 1.3);
    }
  }

  // heraldic fanfare
  horn(final = false) {
    if (!this.ctx) return;
    const ctx = this.ctx, t0 = ctx.currentTime + 0.02;
    const notes = final ? [[392, 0, 0.25], [523, 0.25, 0.25], [659, 0.5, 0.25], [784, 0.75, 1.0]] : [[392, 0, 0.18], [392, 0.2, 0.18], [523, 0.4, 0.6]];
    for (const [f, st, dur] of notes) {
      for (const det of [0, 4]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800; lp.Q.value = 2;
        const g = ctx.createGain();
        const t = t0 + st;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.06, t + 0.03);
        g.gain.setValueAtTime(0.06, t + dur - 0.05); g.gain.linearRampToValueAtTime(0, t + dur + 0.08);
        o.connect(lp).connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.1);
      }
    }
  }

  drum() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(50, t + 0.25);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.6, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.4);
  }

  whoosh() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this.noiseSrc();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2;
    bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(2200, t + 0.35);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.2, t + 0.2); g.gain.linearRampToValueAtTime(0, t + 0.45);
    n.connect(bp).connect(g).connect(this.master); n.start(t); n.stop(t + 0.5);
  }

  // short UI tick
  tick() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 880;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.1);
  }
}
