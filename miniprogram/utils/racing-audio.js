// ── Clawd 夜行赛车 · 合成音效 ─────────────────────────────────
// 全部用 WebAudio 现场合成,不占包体:
//   引擎 = 锯齿波 + 半频方波,经低通滤波,转速随档位起落(有换挡感)
//   轮胎 = 循环白噪声经带通,漂移 / 刹车 / 压草地时推高音量
// 任何节点不支持都静默降级,不影响游戏。

function setParam(param, value, ctx, tc) {
  if (!param) return;
  try {
    param.setTargetAtTime(value, ctx.currentTime, tc || 0.04);
  } catch (e) {
    try { param.value = value; } catch (e2) {}
  }
}

class RacingAudio {
  constructor() {
    this.ctx = null;
    this.engine = null;
    this._noise = null;
    try {
      this.ctx = wx.createWebAudioContext();
    } catch (e) {
      this.ctx = null;
    }
  }

  _noiseBuffer() {
    if (this._noise) return this._noise;
    const c = this.ctx;
    const len = Math.floor(c.sampleRate * 1);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    this._noise = buf;
    return buf;
  }

  _filter(type, freq, q) {
    try {
      const f = this.ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      return f;
    } catch (e) {
      return null;
    }
  }

  startEngine() {
    if (!this.ctx || this.engine) return;
    const c = this.ctx;
    try {
      const master = c.createGain();
      master.gain.value = 0;
      master.connect(c.destination);
      const lp = this._filter('lowpass', 700, 1.2);
      const out = lp || master;
      if (lp) lp.connect(master);

      const osc = c.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 50;
      const sub = c.createOscillator();
      sub.type = 'square';
      sub.frequency.value = 25;
      const subG = c.createGain();
      subG.gain.value = 0.55;
      osc.connect(out);
      sub.connect(subG);
      subG.connect(out);
      osc.start();
      sub.start();

      let skid = null;
      try {
        const src = c.createBufferSource();
        src.buffer = this._noiseBuffer();
        src.loop = true;
        const g = c.createGain();
        g.gain.value = 0;
        const bp = this._filter('bandpass', 1600, 0.9);
        if (bp) { src.connect(bp); bp.connect(g); } else { src.connect(g); }
        g.connect(c.destination);
        src.start();
        skid = { src, g };
      } catch (e) {
        skid = null;
      }

      this.engine = { osc, sub, master, lp, skid };
      setParam(master.gain, 0.05, c, 0.2);
    } catch (e) {
      this.engine = null;
    }
  }

  // rpm 0..1(档内转速)、gear 1..5、boost 是否在加速、skid 0..1 轮胎噪声
  updateEngine(rpm, gear, boost, skid) {
    const e = this.engine;
    if (!e || !this.ctx) return;
    const c = this.ctx;
    const f = 42 + rpm * 120 + gear * 10 + (boost ? 18 : 0);
    setParam(e.osc.frequency, f, c, 0.03);
    setParam(e.sub.frequency, f / 2, c, 0.03);
    setParam(e.master.gain, 0.035 + rpm * 0.035 + (boost ? 0.015 : 0), c, 0.06);
    if (e.lp) setParam(e.lp.frequency, 500 + rpm * 1400 + (boost ? 600 : 0), c, 0.05);
    if (e.skid) setParam(e.skid.g.gain, skid * 0.09, c, 0.05);
  }

  stopEngine() {
    const e = this.engine;
    if (!e) return;
    try {
      e.osc.stop();
      e.sub.stop();
      if (e.skid) e.skid.src.stop();
      e.master.disconnect();
      if (e.skid) e.skid.g.disconnect();
    } catch (err) {}
    this.engine = null;
  }

  close() {
    this.stopEngine();
    if (this.ctx) {
      try { this.ctx.close(); } catch (e) {}
      this.ctx = null;
    }
  }

  note(freq, at, dur, vol, type) {
    if (!this.ctx || !freq) return;
    try {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type || 'square';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(vol, at);
      g.gain.exponentialRampToValueAtTime(0.001, at + dur);
      osc.connect(g);
      g.connect(this.ctx.destination);
      osc.start(at);
      osc.stop(at + dur);
    } catch (e) {}
  }

  // 一段衰减噪声,可选滤波(撞车 / 擦肩呼啸)
  noise(at, dur, vol, filterType, freq) {
    if (!this.ctx) return;
    try {
      const src = this.ctx.createBufferSource();
      src.buffer = this._noiseBuffer();
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(vol, at);
      g.gain.exponentialRampToValueAtTime(0.001, at + dur);
      const f = filterType ? this._filter(filterType, freq, 1.2) : null;
      if (f) { src.connect(f); f.connect(g); } else { src.connect(g); }
      g.connect(this.ctx.destination);
      src.start(at);
      src.stop(at + dur);
    } catch (e) {}
  }

  _now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  beep(final) {
    if (!this.ctx) return;
    const t = this._now();
    if (final) {
      this.note(880, t, 0.34, 0.18);
      this.note(1320, t + 0.02, 0.3, 0.1);
    } else {
      this.note(440, t, 0.16, 0.16);
    }
  }

  crash() {
    if (!this.ctx) return;
    const t = this._now();
    this.noise(t, 0.3, 0.35, 'lowpass', 900);
    this.note(120, t, 0.24, 0.2, 'sawtooth');
  }

  scrape() {
    if (!this.ctx) return;
    this.noise(this._now(), 0.12, 0.12, 'highpass', 2500);
  }

  pickup() {
    if (!this.ctx) return;
    const t = this._now();
    this.note(880, t, 0.06, 0.12);
    this.note(1320, t + 0.055, 0.09, 0.1);
  }

  nitro() {
    if (!this.ctx) return;
    const t = this._now();
    this.noise(t, 0.6, 0.2, 'bandpass', 900);
    [392, 523, 659, 880].forEach((f, i) => this.note(f, t + i * 0.05, 0.1, 0.1, 'sawtooth'));
  }

  // 漂移结束的小加速:档位越高音越亮
  miniTurbo(level) {
    if (!this.ctx) return;
    const t = this._now();
    this.noise(t, 0.3, 0.14, 'bandpass', level > 1 ? 1400 : 1000);
    this.note(level > 1 ? 784 : 587, t, 0.12, 0.1, 'triangle');
  }

  whoosh(combo) {
    if (!this.ctx) return;
    const t = this._now();
    this.noise(t, 0.22, 0.16, 'bandpass', 1200 + Math.min(combo, 6) * 150);
    this.note(660 + Math.min(combo, 6) * 60, t + 0.02, 0.08, 0.07, 'triangle');
  }

  checkpoint() {
    if (!this.ctx) return;
    const t = this._now();
    [659, 784, 1046].forEach((f, i) => this.note(f, t + i * 0.08, 0.12, 0.14));
  }

  zone() {
    if (!this.ctx) return;
    const t = this._now();
    [523, 659].forEach((f, i) => this.note(f, t + i * 0.1, 0.18, 0.08, 'triangle'));
  }

  finish() {
    if (!this.ctx) return;
    const t = this._now();
    [523, 440, 392, 262].forEach((f, i) => this.note(f, t + i * 0.15, 0.18, 0.16));
  }
}

module.exports = { RacingAudio };
