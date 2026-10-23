// ── 苍穹之翼 · 合成音效 + 配乐 ────────────────────────────────
// 全部 WebAudio 现场合成,不占包体。
// 信号链:音效 / 配乐 → 主音量 → 压缩器 → 输出;另有一路回声混响(大爆炸、拾取、旋律送一点进去)。
// 配乐是步进音序器(16 分音符,提前 0.25 秒排程):底鼓 / 军鼓 / 踩镲 + 拨弦低音 + 铺底和弦 + 主旋律 + 琶音。
// 子弹时间里配乐会被压低并闷掉(低通)。任何节点不支持都静默降级。

const N = (semi) => 440 * Math.pow(2, (semi - 9) / 12);   // 以 C4=0 计的半音 → 频率
const PENTA = [0, 2, 4, 7, 9];

// ── 配乐数据 ──
// chords:每小节一个和弦(根音半音,相对 C4;三个和弦音);lead:每小节 16 步,null 休止
const SONGS = {
  battle: {
    bpm: 132,
    swing: 0,
    chords: [
      [-3, [0, 3, 7]], [-7, [0, 4, 7]], [0, [0, 4, 7]], [-5, [0, 4, 7]],
      [-3, [0, 3, 7]], [-7, [0, 4, 7]], [-5, [0, 4, 7]], [-8, [0, 4, 7]],
    ],
    bass: [0, null, 0, 12, null, 0, 7, null, 0, null, 0, 12, null, 7, 10, 12],
    lead: [
      [9, null, 12, null, 16, null, 14, 12, 9, null, null, 7, 9, null, 12, null],
      [5, null, 9, null, 12, null, 10, 9, 5, null, null, 4, 5, null, 7, null],
      [4, null, 7, null, 12, null, 11, 12, 16, null, 14, null, 12, null, 11, null],
      [7, null, 11, null, 14, null, 12, 11, 7, null, 9, null, 11, null, 14, null],
      [16, null, 14, 12, 14, null, 12, 9, 12, null, null, 9, 7, null, 9, null],
      [17, null, 16, 14, 12, null, 14, 16, 17, null, 19, null, 17, null, 16, null],
      [14, null, 12, 11, 12, null, 14, null, 19, null, 17, null, 16, null, 14, null],
      [16, null, null, 14, 16, null, 20, null, 23, null, 21, null, 20, null, 16, null],
    ],
    arp: true,
  },
  boss: {
    bpm: 150,
    chords: [
      [-3, [0, 3, 7]], [-4, [0, 4, 7]], [-7, [0, 4, 7]], [-5, [0, 4, 7]],
      [-3, [0, 3, 7]], [-1, [0, 3, 6]], [-4, [0, 4, 7]], [-8, [0, 4, 7]],
    ],
    bass: [0, 0, 12, 0, 0, 12, 0, 10, 0, 0, 12, 0, 7, 0, 10, 12],
    lead: [
      [21, 20, 21, null, 16, null, 21, null, 24, 23, 21, null, 16, null, 12, null],
      [20, 19, 20, null, 15, null, 20, null, 23, 22, 20, null, 15, null, 11, null],
      [17, 16, 17, null, 12, null, 17, null, 21, 20, 17, null, 12, null, 9, null],
      [19, 18, 19, null, 14, null, 19, null, 23, 21, 19, null, 14, null, 11, null],
      [21, null, 24, null, 28, null, 26, 24, 21, null, 24, null, 26, null, 28, null],
      [26, null, 24, null, 23, null, 21, null, 18, null, 21, null, 23, null, 26, null],
      [24, null, 23, null, 20, null, 23, null, 28, null, 27, null, 24, null, 23, null],
      [20, null, 23, null, 26, null, 23, null, 32, null, 31, null, 28, null, 26, null],
    ],
    arp: false,
    toms: true,
  },
};

class SkyAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this._noise = null;
    this._last = {};
    this.song = null;
    this.timer = null;
    try {
      const c = wx.createWebAudioContext();
      this.ctx = c;
      this.master = c.createGain();
      this.master.gain.value = 0.9;
      // 压缩器:爆炸叠在一起也不会爆音
      let out = c.destination;
      try {
        const comp = c.createDynamicsCompressor();
        comp.threshold.value = -16;
        comp.knee.value = 12;
        comp.ratio.value = 4;
        comp.attack.value = 0.003;
        comp.release.value = 0.22;
        comp.connect(c.destination);
        out = comp;
      } catch (e) {}
      this.master.connect(out);
      this.sfx = c.createGain();
      this.sfx.gain.value = 1;
      this.sfx.connect(this.master);
      // 配乐:音量 → 低通(子弹时间里闷掉)→ 主音量
      this.musicBus = c.createGain();
      this.musicBus.gain.value = 0.32;
      this.musicLP = this._filter('lowpass', 18000, 0.7);
      if (this.musicLP) {
        this.musicBus.connect(this.musicLP);
        this.musicLP.connect(this.master);
      } else {
        this.musicBus.connect(this.master);
      }
      this._buildVerb();
    } catch (e) {
      this.ctx = null;
    }
  }

  // 简易混响:两条带衰减反馈的延迟线,高频逐次衰减
  _buildVerb() {
    const c = this.ctx;
    this.verb = null;
    try {
      const inp = c.createGain();
      inp.gain.value = 1;
      const out = c.createGain();
      out.gain.value = 0.32;
      [[0.087, 0.42], [0.131, 0.38], [0.193, 0.3]].forEach(([t, fb]) => {
        const d = c.createDelay(1);
        d.delayTime.value = t;
        const lp = this._filter('lowpass', 2600, 0.5);
        const g = c.createGain();
        g.gain.value = fb;
        inp.connect(d);
        d.connect(lp || g);
        if (lp) lp.connect(g);
        g.connect(d);
        g.connect(out);
      });
      out.connect(this.master);
      this.verb = inp;
      // 旋律回声:八分音符延迟
      const echo = c.createDelay(1);
      echo.delayTime.value = 0.34;
      const efb = c.createGain();
      efb.gain.value = 0.32;
      const elp = this._filter('lowpass', 2200, 0.5);
      echo.connect(elp || efb);
      if (elp) elp.connect(efb);
      efb.connect(echo);
      efb.connect(this.musicBus);
      this.echo = echo;
    } catch (e) {
      this.verb = null;
      this.echo = null;
    }
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

  // 配乐音量系数(子弹时间里压低,同时低通闷掉)
  setMusicLevel(v) {
    if (!this.musicBus) return;
    if (this._ml !== undefined && Math.abs(v - this._ml) < 0.01) return;
    this._ml = v;
    try { this.musicBus.gain.value = 0.32 * v; } catch (e) {}
    if (this.musicLP) {
      try { this.musicLP.frequency.value = 500 + 17500 * v * v * v; } catch (e) {}
    }
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

  // 单个振荡器音:可选滑音、滤波、送混响
  tone(freq, at, dur, vol, type, dest, slide, o) {
    if (!this.ctx) return;
    o = o || {};
    try {
      const c = this.ctx;
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = type || 'square';
      osc.frequency.setValueAtTime(freq, at);
      if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slide), at + (o.slideT || dur));
      if (o.detune) osc.detune.value = o.detune;
      const atk = o.atk || 0.005;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.linearRampToValueAtTime(vol, at + atk);
      if (o.hold) g.gain.setValueAtTime(vol, at + atk + o.hold);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      let head = osc;
      if (o.lp || o.hp || o.bp) {
        const f = o.lp ? this._filter('lowpass', o.lp, o.q) : o.hp ? this._filter('highpass', o.hp, o.q) : this._filter('bandpass', o.bp, o.q);
        if (f) {
          if (o.lp2) {
            f.frequency.setValueAtTime(o.lp, at);
            f.frequency.exponentialRampToValueAtTime(o.lp2, at + (o.lpT || dur));
          }
          osc.connect(f);
          head = f;
        }
      }
      head.connect(g);
      g.connect(dest || this.sfx);
      if (o.verb && this.verb) {
        const s = c.createGain();
        s.gain.value = o.verb;
        g.connect(s);
        s.connect(this.verb);
      }
      osc.start(at);
      osc.stop(at + dur + 0.03);
    } catch (e) {}
  }

  // 噪声:可选滤波扫频、送混响
  noise(at, dur, vol, type, f, q, o) {
    if (!this.ctx) return;
    o = o || {};
    try {
      const c = this.ctx;
      const s = c.createBufferSource();
      s.buffer = this._noiseBuf();
      const g = c.createGain();
      const atk = o.atk || 0.002;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.linearRampToValueAtTime(vol, at + atk);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      const flt = type ? this._filter(type, f, q) : null;
      if (flt) {
        if (o.f2) {
          flt.frequency.setValueAtTime(f, at);
          flt.frequency.exponentialRampToValueAtTime(o.f2, at + (o.fT || dur));
        }
        s.connect(flt);
        flt.connect(g);
      } else {
        s.connect(g);
      }
      g.connect(o.dest || this.sfx);
      if (o.verb && this.verb) {
        const sg = c.createGain();
        sg.gain.value = o.verb;
        g.connect(sg);
        sg.connect(this.verb);
      }
      s.start(at, Math.random() * 0.5);
      s.stop(at + dur + 0.03);
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

  // ── 音效 ──
  // 主炮:清脆的"啾"——方波快速下滑 + 高频噪声尖头
  shot() {
    if (!this._gate('shot', 0.066)) return;
    const t = this.ctx.currentTime;
    const p = 1 + (Math.random() - 0.5) * 0.06;
    this.tone(1700 * p, t, 0.05, 0.045, 'square', null, 560 * p, { lp: 5200, q: 0.7 });
    this.tone(880 * p, t, 0.06, 0.04, 'triangle', null, 260 * p);
    this.noise(t, 0.025, 0.05, 'highpass', 5000, 0.7);
  }

  // 导弹出膛:带通噪声上扫的"嗖"
  missile() {
    if (!this._gate('missile', 0.2)) return;
    const t = this.ctx.currentTime;
    this.noise(t, 0.34, 0.12, 'bandpass', 500, 1.2, { f2: 3200, atk: 0.03 });
    this.tone(260, t, 0.22, 0.05, 'sawtooth', null, 820, { lp: 1600 });
  }

  // 打中敌人:短促的金属"嗒"
  hit() {
    if (!this._gate('hit', 0.045)) return;
    const t = this.ctx.currentTime;
    this.tone(1300 + Math.random() * 300, t, 0.03, 0.06, 'square', null, 760, { bp: 1800, q: 2 });
    this.noise(t, 0.02, 0.04, 'highpass', 3000);
  }

  // 爆炸:次低频冲击 + 低通扫频噪声 + 噼啪碎响;越大越长越沉,并送进混响
  boom(size) {
    const s = size || 1;
    if (!this._gate(`boom${s}`, s >= 3 ? 0.2 : s === 2 ? 0.09 : 0.05)) return;
    const t = this.ctx.currentTime;
    const pv = 1 + (Math.random() - 0.5) * 0.2;
    if (s === 1) {
      this.tone(160 * pv, t, 0.26, 0.26, 'sine', null, 44, { slideT: 0.2 });
      this.noise(t, 0.36, 0.26, 'lowpass', 3600 * pv, 0.8, { f2: 380 });
      for (let i = 0; i < 3; i++) this.noise(t + 0.04 + Math.random() * 0.16, 0.025, 0.05, 'highpass', 2400);
    } else if (s === 2) {
      this.tone(120 * pv, t, 0.6, 0.38, 'sine', null, 32, { slideT: 0.45 });
      this.noise(t, 0.8, 0.4, 'lowpass', 2600 * pv, 0.8, { f2: 220, verb: 0.3 });
      this.noise(t, 0.12, 0.2, 'bandpass', 1200, 0.8);
      for (let i = 0; i < 7; i++) this.noise(t + 0.05 + Math.random() * 0.4, 0.03, 0.06, 'highpass', 2000 + Math.random() * 2000);
    } else {
      this.tone(95, t, 1.3, 0.5, 'sine', null, 24, { slideT: 1 });
      this.tone(60, t + 0.12, 1.1, 0.3, 'sine', null, 22);
      this.noise(t, 1.6, 0.5, 'lowpass', 2000, 0.7, { f2: 140, verb: 0.5 });
      this.noise(t + 0.15, 0.9, 0.3, 'lowpass', 1400, 0.7, { f2: 160 });
      this.noise(t, 2.4, 0.16, 'lowpass', 260, 0.6, { atk: 0.2 });
      for (let i = 0; i < 14; i++) this.noise(t + 0.05 + Math.random() * 0.9, 0.035, 0.07, 'highpass', 1800 + Math.random() * 2500);
    }
  }

  // 中弹:失真的低频锯齿 + 噪声
  hurt() {
    if (!this._gate('hurt', 0.15)) return;
    const t = this.ctx.currentTime;
    this.noise(t, 0.28, 0.3, 'bandpass', 700, 0.7, { f2: 250 });
    this.tone(240, t, 0.3, 0.16, 'sawtooth', null, 60, { lp: 1400 });
    this.tone(180, t, 0.22, 0.12, 'square', null, 50, { lp: 900 });
  }

  // 星星:铃声(基音 + 八度 + 非整数泛音),连续拾取沿五声音阶往上走
  star(chain) {
    if (!this._gate('star', 0.035)) return;
    const t = this.ctx.currentTime;
    const k = chain % 15;
    const semi = 24 + Math.floor(k / 5) * 12 + PENTA[k % 5];
    const f = N(semi);
    this.tone(f, t, 0.32, 0.12, 'sine', null, 0, { verb: 0.25 });
    this.tone(f * 2, t, 0.16, 0.05, 'sine');
    this.tone(f * 2.76, t, 0.08, 0.03, 'triangle');
  }

  // 补给:上行琶音(两个微失谐的方波叠加)+ 亮闪
  power() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [0, 4, 7, 12, 16].forEach((s, i) => {
      this.tone(N(12 + s), t + i * 0.05, 0.18, 0.05, 'square', null, 0, { detune: -7, lp: 4000, verb: 0.2 });
      this.tone(N(12 + s), t + i * 0.05, 0.18, 0.04, 'square', null, 0, { detune: 7, lp: 4000 });
    });
    this.noise(t + 0.2, 0.3, 0.04, 'highpass', 6000, 0.7, { verb: 0.3 });
  }

  // 炸弹:先吸气上扫,再一记超重爆炸 + 长长的余震
  bomb() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.noise(t, 0.22, 0.2, 'bandpass', 300, 1.4, { f2: 3500, atk: 0.18 });
    this.tone(200, t, 0.22, 0.08, 'sawtooth', null, 1200, { lp: 3000, atk: 0.15 });
    const b = t + 0.2;
    this.tone(80, b, 1.8, 0.55, 'sine', null, 20, { slideT: 1.4 });
    this.noise(b, 2.2, 0.55, 'lowpass', 3000, 0.7, { f2: 120, verb: 0.6 });
    this.noise(b, 3, 0.2, 'lowpass', 220, 0.6, { atk: 0.3 });
    this.tone(900, b, 0.7, 0.06, 'sawtooth', null, 60, { lp: 2000 });
  }

  // Boss 警报:双音警笛
  warning() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 6; i++) {
      const f = i % 2 ? 620 : 860;
      this.tone(f, t + i * 0.26, 0.25, 0.08, 'sawtooth', null, f * 0.97, { lp: 2200, atk: 0.02, hold: 0.18, verb: 0.2 });
    }
    this.tone(55, t, 1.6, 0.18, 'sine', null, 50, { atk: 0.3 });
  }

  // 胜利号角:和弦重音 + 琶音 + 长和弦
  fanfare() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const chord = (at, root, dur, vol) => [0, 4, 7, 12].forEach(s => {
      this.tone(N(root + s), at, dur, vol, 'square', null, 0, { lp: 3200, verb: 0.3, hold: dur * 0.4 });
      this.tone(N(root + s), at, dur, vol * 0.7, 'triangle', null, 0, { detune: 8 });
    });
    chord(t, 0, 0.18, 0.04);
    chord(t + 0.2, 0, 0.18, 0.04);
    [0, 4, 7, 12, 16, 19].forEach((s, i) => this.tone(N(12 + s), t + 0.42 + i * 0.06, 0.22, 0.05, 'square', null, 0, { lp: 4000, verb: 0.3 }));
    chord(t + 0.85, 5, 0.35, 0.035);
    chord(t + 1.2, 7, 1.4, 0.04);
    this.tone(N(-24 + 7), t + 1.2, 1.4, 0.18, 'triangle');
  }

  // 连击里程碑
  combo(n) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const base = n >= 100 ? 19 : n >= 50 ? 16 : 12;
    [0, 4, 7, 12].forEach((s, i) => this.tone(N(base + s), t + i * 0.04, 0.16, 0.045, 'square', null, 0, { lp: 5000, verb: 0.25 }));
  }

  // 界面点击 / 购买
  click() {
    if (!this._gate('click', 0.05)) return;
    const t = this.ctx.currentTime;
    this.tone(1200, t, 0.05, 0.1, 'triangle', null, 900);
    this.noise(t, 0.015, 0.05, 'highpass', 4000);
  }

  buy() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(N(23), t, 0.08, 0.05, 'square', null, 0, { lp: 5000 });
    this.tone(N(28), t + 0.07, 0.3, 0.05, 'square', null, 0, { lp: 5000, verb: 0.3 });
    this.tone(N(40), t + 0.07, 0.25, 0.015, 'sine');
  }

  // 出击:喷气引擎点火的呼啸
  launch() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.noise(t, 1.1, 0.16, 'bandpass', 400, 0.9, { f2: 2400, atk: 0.25, verb: 0.2 });
    this.tone(90, t, 1, 0.1, 'sawtooth', null, 260, { lp: 900, atk: 0.2 });
  }

  // ── 配乐 ──
  playMusic(name) {
    if (!this.ctx || (this.song && this.song.name === name)) return;
    this.stopMusic();
    const song = SONGS[name];
    if (!song) return;
    this.song = { name, data: song, step: 0, next: this.ctx.currentTime + 0.12 };
    this.timer = setInterval(() => this._schedule(), 50);
  }

  stopMusic() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.song = null;
  }

  _kick(t, v) {
    const bus = this.musicBus;
    this.tone(150, t, 0.16, 0.5 * v, 'sine', bus, 46, { slideT: 0.1, atk: 0.002 });
    this.noise(t, 0.012, 0.12 * v, 'highpass', 2500, 0.7, { dest: bus });
  }

  _snare(t, v) {
    const bus = this.musicBus;
    this.noise(t, 0.17, 0.2 * v, 'bandpass', 1900, 0.8, { dest: bus });
    this.tone(200, t, 0.09, 0.14 * v, 'triangle', bus, 150);
  }

  _hat(t, open) {
    this.noise(t, open ? 0.14 : 0.035, open ? 0.05 : 0.04, 'highpass', 7500, 0.8, { dest: this.musicBus });
  }

  _schedule() {
    const s = this.song;
    if (!s || !this.ctx) return;
    const D = s.data;
    const stepDur = 60 / D.bpm / 4;
    const bus = this.musicBus;
    while (s.next < this.ctx.currentTime + 0.25) {
      const bar = Math.floor(s.step / 16) % D.chords.length;
      const st = s.step % 16;
      const t = s.next;
      const [root, tri] = D.chords[bar];
      // 鼓
      if (st % 4 === 0 || (D.toms && st === 10)) this._kick(t, st === 0 ? 1 : 0.85);
      if (st === 4 || st === 12) this._snare(t, 1);
      if (st === 15 && bar % 4 === 3) this._snare(t, 0.6);
      if (st % 2 === 0) this._hat(t, st === 14);
      else if (D.toms) this._hat(t, false);
      if (D.toms && bar % 4 === 3 && st >= 12) this.tone(220 - (st - 12) * 30, t, 0.14, 0.12, 'sine', bus, 90);
      // 拨弦低音:锯齿波 + 快速关闭的低通
      const bn = D.bass[st];
      if (bn !== null && bn !== undefined) {
        this.tone(N(root - 24 + bn), t, stepDur * 1.6, 0.13, 'sawtooth', bus, 0, { lp: 1500, lp2: 260, lpT: stepDur * 1.2, q: 3 });
      }
      // 铺底和弦:每小节一次,三个微失谐锯齿波,慢起慢收
      if (st === 0) {
        const barDur = stepDur * 16;
        tri.forEach((iv, i) => this.tone(N(root + iv), t, barDur, 0.018, 'sawtooth', bus, 0, { lp: 1100, q: 0.6, atk: 0.25, hold: barDur * 0.6, detune: (i - 1) * 9 }));
      }
      // 琶音
      if (D.arp && st % 2 === 1) {
        const iv = tri[((st - 1) / 2) % 3];
        this.tone(N(root + 24 + iv), t, stepDur * 1.2, 0.02, 'triangle', bus);
      }
      // 主旋律(送八分音符回声)
      const ld = D.lead[bar][st];
      if (ld !== null && ld !== undefined) {
        this.tone(N(ld), t, stepDur * 1.9, 0.045, 'square', bus, 0, { lp: 3400, q: 0.7, hold: stepDur * 0.6 });
        if (this.echo) this.tone(N(ld), t, stepDur * 1.6, 0.022, 'square', this.echo, 0, { lp: 2400 });
      }
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
