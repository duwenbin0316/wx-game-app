// ── 苍穹之翼 · 合成音效 + 配乐 ────────────────────────────────
// 全部 WebAudio 现场合成,不占包体。配乐是一个简单的步进音序器:
// 低音 + 和弦琶音 + 主旋律,提前 0.2 秒排程,Boss 战切换成更快更紧张的段落。
// 任何节点不支持都静默降级。

const N = (semi) => 440 * Math.pow(2, (semi - 9) / 12);   // 以 C4=0 计的半音 → 频率

// 音乐数据:每小节 16 步;数值是相对 C4 的半音,null 表示休止
const SONGS = {
  battle: {
    bpm: 132,
    // A 小调:Am - F - C - G
    bass: [[-15, -15, -3, -15], [-19, -19, -7, -19], [-24, -24, -12, -24], [-17, -17, -5, -17]],
    chords: [[0, 4, 9], [-3, 0, 5], [-5, 0, 4], [-1, 2, 7]].map(c => c.map(x => x + 12)),
    lead: [
      [9, null, 12, null, 16, null, 14, 12, 9, null, null, 7, 9, null, 12, null],
      [5, null, 9, null, 12, null, 10, 9, 5, null, null, 4, 5, null, 7, null],
      [4, null, 7, null, 12, null, 11, 12, 16, null, 14, null, 12, null, 11, null],
      [7, null, 11, null, 14, null, 12, 11, 7, null, 9, null, 11, null, 14, null],
    ],
  },
  boss: {
    bpm: 150,
    bass: [[-15, -3, -15, -3], [-16, -4, -16, -4], [-19, -7, -19, -7], [-17, -5, -17, -5]],
    chords: [[0, 3, 9], [-1, 3, 8], [-3, 0, 5], [-1, 2, 7]].map(c => c.map(x => x + 12)),
    lead: [
      [21, 20, 21, null, 16, null, 21, null, 24, 23, 21, null, 16, null, 12, null],
      [20, 19, 20, null, 15, null, 20, null, 23, 22, 20, null, 15, null, 11, null],
      [17, 16, 17, null, 12, null, 17, null, 21, 20, 17, null, 12, null, 9, null],
      [19, 18, 19, null, 14, null, 19, null, 23, 21, 19, null, 14, null, 11, null],
    ],
  },
};

class SkyAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this._noise = null;
    this._last = {};
    try {
      this.ctx = wx.createWebAudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 0.32;
      this.musicBus.connect(this.master);
    } catch (e) {
      this.ctx = null;
    }
    this.song = null;
    this.timer = null;
  }

  // iOS 等平台上音频上下文可能处于挂起状态,要在用户点击时恢复
  unlock() {
    const c = this.ctx;
    if (!c) return;
    try {
      if (c.state === 'suspended' && c.resume) c.resume();
    } catch (e) {}
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) {
      try { this.master.gain.value = m ? 0 : 0.9; } catch (e) {}
    }
  }

  // 配乐音量系数(子弹时间里压低)
  setMusicLevel(v) {
    if (!this.musicBus) return;
    const target = 0.32 * v;
    if (this._ml !== undefined && Math.abs(target - this._ml) < 0.004) return;
    this._ml = target;
    try { this.musicBus.gain.value = target; } catch (e) {}
  }

  _noiseBuf() {
    if (this._noise) return this._noise;
    const c = this.ctx;
    const len = c.sampleRate;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._noise = buf;
    return buf;
  }

  _filter(type, f, q) {
    try {
      const n = this.ctx.createBiquadFilter();
      n.type = type;
      n.frequency.value = f;
      n.Q.value = q || 1;
      return n;
    } catch (e) {
      return null;
    }
  }

  tone(freq, at, dur, vol, type, dest, slide) {
    if (!this.ctx) return;
    try {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(freq, at);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, at + dur);
      g.gain.setValueAtTime(0.0001, at);
      g.gain.linearRampToValueAtTime(vol, at + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      o.connect(g);
      g.connect(dest || this.master);
      o.start(at);
      o.stop(at + dur + 0.02);
    } catch (e) {}
  }

  noise(at, dur, vol, type, f, q) {
    if (!this.ctx) return;
    try {
      const s = this.ctx.createBufferSource();
      s.buffer = this._noiseBuf();
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(vol, at);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      const flt = type ? this._filter(type, f, q) : null;
      if (flt) { s.connect(flt); flt.connect(g); } else s.connect(g);
      g.connect(this.master);
      s.start(at, Math.random() * 0.5);
      s.stop(at + dur + 0.02);
    } catch (e) {}
  }

  // 同一种音效限频,避免密集射击时糊成一片
  _gate(key, gap) {
    if (!this.ctx) return false;
    const t = this.ctx.currentTime;
    if (this._last[key] && t - this._last[key] < gap) return false;
    this._last[key] = t;
    return true;
  }

  shot() {
    if (!this._gate('shot', 0.07)) return;
    const t = this.ctx.currentTime;
    this.noise(t, 0.05, 0.05, 'highpass', 3000);
    this.tone(1400, t, 0.04, 0.025, 'square', null, 700);
  }

  missile() {
    if (!this._gate('missile', 0.2)) return;
    this.noise(this.ctx.currentTime, 0.25, 0.06, 'bandpass', 900, 0.8);
  }

  hit() {
    if (!this._gate('hit', 0.05)) return;
    this.tone(220, this.ctx.currentTime, 0.05, 0.04, 'square', null, 140);
  }

  boom(size) {
    if (!this._gate(`boom${size}`, size > 1 ? 0.1 : 0.06)) return;
    const t = this.ctx.currentTime;
    const big = size > 1;
    this.noise(t, big ? 0.9 : 0.4, big ? 0.5 : 0.28, 'lowpass', big ? 700 : 1400);
    this.tone(big ? 90 : 140, t, big ? 0.6 : 0.25, big ? 0.3 : 0.16, 'sine', null, 35);
  }

  hurt() {
    if (!this._gate('hurt', 0.15)) return;
    const t = this.ctx.currentTime;
    this.noise(t, 0.25, 0.3, 'bandpass', 600, 0.7);
    this.tone(160, t, 0.25, 0.18, 'sawtooth', null, 60);
  }

  star(pitch) {
    if (!this._gate('star', 0.03)) return;
    const t = this.ctx.currentTime;
    this.tone(N(24 + (pitch % 12)), t, 0.09, 0.06, 'triangle');
  }

  power() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [0, 4, 7, 12].forEach((s, i) => this.tone(N(12 + s), t + i * 0.06, 0.14, 0.09, 'square'));
  }

  bomb() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.noise(t, 1.6, 0.6, 'lowpass', 500);
    this.tone(70, t, 1.4, 0.4, 'sine', null, 25);
    this.tone(600, t, 0.5, 0.08, 'sawtooth', null, 80);
  }

  warning() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      this.tone(880, t + i * 0.5, 0.22, 0.12, 'square', null, 440);
    }
  }

  fanfare() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [[12, 0], [16, 0.12], [19, 0.24], [24, 0.36], [19, 0.6], [24, 0.72]].forEach(([s, d]) => this.tone(N(s), t + d, 0.3, 0.12, 'square'));
  }

  // ── 配乐 ──
  playMusic(name) {
    if (!this.ctx || (this.song && this.song.name === name)) return;
    this.stopMusic();
    const song = SONGS[name];
    if (!song) return;
    this.song = { name, data: song, step: 0, next: this.ctx.currentTime + 0.1 };
    this.timer = setInterval(() => this._schedule(), 60);
  }

  stopMusic() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.song = null;
  }

  _schedule() {
    const s = this.song;
    if (!s || !this.ctx) return;
    const stepDur = 60 / s.data.bpm / 4;
    while (s.next < this.ctx.currentTime + 0.2) {
      const bar = Math.floor(s.step / 16) % 4;
      const st = s.step % 16;
      const t = s.next;
      const bus = this.musicBus;
      if (st % 4 === 0) {
        const b = s.data.bass[bar][st / 4];
        this.tone(N(b), t, stepDur * 3.6, 0.22, 'triangle', bus);
      }
      if (st % 2 === 0) {
        const ch = s.data.chords[bar];
        this.tone(N(ch[(st / 2) % 3]), t, stepDur * 1.6, 0.05, 'square', bus);
      }
      const ld = s.data.lead[bar][st];
      if (ld !== null && ld !== undefined) this.tone(N(ld), t, stepDur * 1.8, 0.07, 'square', bus);
      // 军鼓 / 底鼓
      if (st % 8 === 4) this.noise(t, 0.12, 0.08, 'highpass', 1800);
      if (st % 8 === 0) this.tone(120, t, 0.12, 0.18, 'sine', bus, 45);
      s.step++;
      s.next += stepDur;
    }
  }

  close() {
    this.stopMusic();
    if (this.ctx) {
      try { this.ctx.close(); } catch (e) {}
      this.ctx = null;
    }
  }
}

module.exports = { SkyAudio };
