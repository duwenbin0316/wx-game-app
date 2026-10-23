// ─── 俄罗斯方块 · 木头音效合成 ─────────────────────────────
// 全部音效用"物理建模"现算出来,保证落地、硬降、消行是同一种木头的声音:
//   impact  木块撞击:自由梁的非谐波模态(1 : 2.76 : 5.40 : 8.93…)指数衰减,
//           木头阻尼大、高频衰减更快;再叠一个几毫秒的接触噪声
//   crackle 木头断裂:成簇的微裂纹"咔哒"(短噪声 + 高频小振铃)
//   tear    纤维撕裂:带通噪声,幅度随机抖动
//   debris  木屑:很多小碎块落地并弹跳,间隔和力度逐次衰减
//   boom    爆炸:扫频低通噪声 + 往下滑的次低音
// 最后过一道 tanh 软饱和让声音更"厚",再按每个音效的目标峰值归一化。
// 纯函数,不依赖 wx:页面运行时直接合成进 WebAudio buffer;
// scripts/gen-tetris-sfx.js 用同一份代码离线导出 mp3,给不支持 WebAudio 时兜底。

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BEAM = [1, 2.756, 5.404, 8.933, 13.34];   // 自由-自由梁的模态频率比

// RBJ 带通(恒定 0dB 峰值)系数
function bandpass(sr, f, q) {
  const w = 2 * Math.PI * Math.min(f, sr * 0.45) / sr;
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  return { b0: alpha / a0, b2: -alpha / a0, a1: -2 * Math.cos(w) / a0, a2: (1 - alpha) / a0 };
}

// ── 基本元件:都往 out 里叠加 ─────────────────────────────

// 一组指数衰减正弦
function addModes(out, sr, t0, modes, gain) {
  const i0 = Math.max(0, Math.round(t0 * sr));
  modes.forEach(m => {
    const len = Math.min(out.length - i0, Math.ceil(m.tau * 6 * sr));
    const w = 2 * Math.PI * m.f / sr;
    const k = Math.exp(-1 / (m.tau * sr));
    // 递推正弦振荡器,比每个采样调 sin 快
    let s1 = Math.sin(m.ph || 0);
    let s2 = Math.sin((m.ph || 0) - w);
    const c = 2 * Math.cos(w);
    let env = m.a * gain;
    for (let i = 0; i < len; i++) {
      const s0 = c * s1 - s2;
      s2 = s1;
      s1 = s0;
      // 1.5ms 的起振,去掉"喀"的直流跳变
      const att = i < sr * 0.0015 ? i / (sr * 0.0015) : 1;
      out[i0 + i] += s2 * env * att;
      env *= k;
    }
  });
}

// 带通噪声爆发;fTo 给了就从 f 指数扫到 fTo;jitter > 0 时幅度随机抖动(撕裂感)
function addNoise(out, sr, t0, o, rand) {
  const i0 = Math.max(0, Math.round(t0 * sr));
  const len = Math.min(out.length - i0, Math.ceil(o.dur * sr));
  const att = Math.max(1, Math.round((o.attack || 0.001) * sr));
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  let coef = bandpass(sr, o.f, o.q || 1);
  let jit = 1;
  for (let i = 0; i < len; i++) {
    if (o.fTo && (i & 31) === 0) {
      coef = bandpass(sr, o.f * Math.pow(o.fTo / o.f, i / len), o.q || 1);
    }
    if (o.jitter && (i % 64) === 0) jit = 1 - o.jitter * rand();
    const x = rand() * 2 - 1;
    const y = coef.b0 * x + coef.b2 * x2 - coef.a1 * y1 - coef.a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    const t = i / len;
    const env = (i < att ? i / att : 1) * Math.pow(1 - t, o.curve || 3);
    out[i0 + i] += y * env * o.gain * jit;
  }
}

// 木块撞击。size:大约的基频(Hz,越大的木块越低);hard:0~1 越硬越亮
function impact(out, sr, t0, o, rand) {
  const f0 = o.f * (1 + (rand() - 0.5) * 0.06);
  const eta = o.eta || 0.022;                    // 木头的损耗因子
  const modes = BEAM.map((r, i) => {
    const f = f0 * r * (1 + (rand() - 0.5) * 0.04);
    return {
      f,
      a: Math.pow(o.hard, i) * (i === 0 ? 1 : 0.8),
      tau: Math.min(o.maxTau || 0.12, 1 / (Math.PI * f * eta)),
      ph: rand() * Math.PI,
    };
  }).filter(m => m.f < sr * 0.45);
  // 横向模态:让木块听起来是"块"而不是"棒"
  modes.push({ f: f0 * 1.62, a: 0.45 * o.hard, tau: 1 / (Math.PI * f0 * 1.62 * eta * 1.3), ph: rand() });
  addModes(out, sr, t0, modes, o.gain);
  // 接触瞬间的"嗒":2~4ms 的高频噪声
  addNoise(out, sr, t0, { dur: 0.002 + 0.002 * o.hard, f: 2500 + 3000 * o.hard, q: 0.7, gain: o.gain * (0.4 + o.hard), curve: 2 }, rand);
}

// 木板 / 桌面共鸣的低频"咚"
function thump(out, sr, t0, o) {
  addModes(out, sr, t0, [
    { f: o.f, a: 1, tau: o.tau },
    { f: o.f * 2.3, a: 0.35, tau: o.tau * 0.4 },
  ], o.gain);
}

// 一簇微裂纹:密度(个/秒)× 时长,包络先密后疏
function crackle(out, sr, t0, o, rand) {
  const n = Math.max(1, Math.round(o.density * o.dur));
  for (let i = 0; i < n; i++) {
    const u = Math.pow(rand(), 1.6);              // 前面更密
    const t = t0 + u * o.dur;
    const g = o.gain * (0.35 + 0.65 * rand()) * (1 - u * 0.6);
    addNoise(out, sr, t, { dur: 0.0015 + rand() * 0.004, f: 1400 + rand() * 4200, q: 1.2, gain: g, curve: 2 }, rand);
    if (rand() < 0.5) {
      addModes(out, sr, t, [{ f: 1800 + rand() * 2600, a: 1, tau: 0.004 + rand() * 0.006, ph: rand() * 3 }], g * 0.5);
    }
  }
}

// 纤维撕裂
function tear(out, sr, t0, o, rand) {
  addNoise(out, sr, t0, { dur: o.dur, f: o.f || 1100, fTo: o.fTo || 2600, q: 1.4, gain: o.gain, attack: 0.004, curve: 1.6, jitter: 0.85 }, rand);
}

// 木屑:每块碎片落地后弹几下,越弹越轻越快
function debris(out, sr, t0, o, rand) {
  for (let i = 0; i < o.count; i++) {
    let t = t0 + 0.03 + rand() * o.spread;
    let g = o.gain * (0.4 + 0.6 * rand());
    let gap = 0.05 + rand() * 0.07;
    const f = o.fLo + rand() * (o.fHi - o.fLo);
    const bounces = 1 + Math.floor(rand() * 3);
    for (let b = 0; b < bounces && t < out.length / sr - 0.02; b++) {
      impact(out, sr, t, { f: f * (1 + (rand() - 0.5) * 0.1), hard: 0.6 + rand() * 0.3, gain: g, eta: 0.07, maxTau: 0.018 }, rand);
      t += gap;
      gap *= 0.55;
      g *= 0.45;
    }
  }
}

// 爆炸:低通噪声(截止频率从高往低扫)+ 往下滑的次低音
function boom(out, sr, t0, o, rand) {
  const i0 = Math.round(t0 * sr);
  const len = Math.min(out.length - i0, Math.ceil(o.dur * sr));
  let lp = 0, lp2 = 0, ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / len;
    const fc = o.fHi * Math.pow(o.fLo / o.fHi, Math.pow(t, 0.5));
    const k = 1 - Math.exp(-2 * Math.PI * fc / sr);
    const x = rand() * 2 - 1;
    lp += k * (x - lp);
    lp2 += k * (lp - lp2);
    const env = (i < sr * 0.004 ? i / (sr * 0.004) : 1) * Math.pow(1 - t, 2.2);
    const fs = o.sub * Math.pow(0.55, t * 2);    // 次低音往下滑
    ph += 2 * Math.PI * fs / sr;
    out[i0 + i] += (lp2 * 2.2 * o.gain + Math.sin(ph) * o.gain * 0.9) * env;
  }
}

// ── 音效配方 ──────────────────────────────────────────────
// 每个配方:时长、目标峰值、饱和驱动、内容
const RECIPES = {
  // 左右移动:小木珠轻碰
  move: { dur: 0.07, peak: 0.22, drive: 1, make(out, sr, r) {
    impact(out, sr, 0, { f: 1700, hard: 0.35, gain: 1 }, r);
  } },
  // 旋转:木质棘轮"嗒哒"
  rotate: { dur: 0.1, peak: 0.28, drive: 1, make(out, sr, r) {
    impact(out, sr, 0, { f: 1050, hard: 0.5, gain: 1 }, r);
    impact(out, sr, 0.018, { f: 1500, hard: 0.4, gain: 0.45 }, r);
  } },
  // 暂存:两声木片
  hold: { dur: 0.14, peak: 0.3, drive: 1, make(out, sr, r) {
    impact(out, sr, 0, { f: 820, hard: 0.45, gain: 1 }, r);
    impact(out, sr, 0.05, { f: 1240, hard: 0.45, gain: 0.8 }, r);
  } },
  // 软降一格:很轻的木头擦碰
  soft: { dur: 0.05, peak: 0.12, drive: 1, make(out, sr, r) {
    impact(out, sr, 0, { f: 1300, hard: 0.25, gain: 1 }, r);
  } },
  // 普通落定:木块放到木板上
  lock: { dur: 0.3, peak: 0.55, drive: 1.3, make(out, sr, r) {
    impact(out, sr, 0, { f: 430, hard: 0.55, gain: 1 }, r);
    thump(out, sr, 0, { f: 140, tau: 0.05, gain: 0.7 });
    debris(out, sr, 0.01, { count: 1, spread: 0.05, fLo: 1600, fHi: 2400, gain: 0.12 }, r);
  } },
  // 硬降:实心木块从高处砸下,带桌面闷响和一点震颤
  harddrop: { dur: 0.55, peak: 0.72, drive: 1.8, make(out, sr, r) {
    impact(out, sr, 0, { f: 270, hard: 0.8, gain: 1.1, maxTau: 0.16 }, r);
    thump(out, sr, 0, { f: 92, tau: 0.09, gain: 1.2 });
    boom(out, sr, 0, { dur: 0.16, fHi: 1400, fLo: 120, sub: 70, gain: 0.5 }, r);
    crackle(out, sr, 0.003, { dur: 0.03, density: 300, gain: 0.25 }, r);
    debris(out, sr, 0.02, { count: 3, spread: 0.12, fLo: 1200, fHi: 2600, gain: 0.16 }, r);
  } },
  // 1 行:一根木条"咔"地折断,掉几片木屑
  clear1: { dur: 0.7, peak: 0.8, drive: 2.8, make(out, sr, r) {
    impact(out, sr, 0, { f: 760, hard: 0.95, gain: 0.9 }, r);
    crackle(out, sr, 0, { dur: 0.07, density: 420, gain: 0.55 }, r);
    tear(out, sr, 0.006, { dur: 0.09, gain: 0.35 }, r);
    thump(out, sr, 0, { f: 120, tau: 0.06, gain: 0.6 });
    debris(out, sr, 0.04, { count: 5, spread: 0.25, fLo: 1300, fHi: 3000, gain: 0.22 }, r);
  } },
  // 2 行:两声连着的断裂,碎得更多
  clear2: { dur: 0.85, peak: 0.86, drive: 3, make(out, sr, r) {
    impact(out, sr, 0, { f: 650, hard: 0.95, gain: 1 }, r);
    impact(out, sr, 0.075, { f: 820, hard: 0.95, gain: 0.85 }, r);
    crackle(out, sr, 0, { dur: 0.16, density: 480, gain: 0.6 }, r);
    tear(out, sr, 0.01, { dur: 0.14, gain: 0.45 }, r);
    thump(out, sr, 0, { f: 105, tau: 0.08, gain: 0.9 });
    boom(out, sr, 0, { dur: 0.18, fHi: 1600, fLo: 150, sub: 75, gain: 0.35 }, r);
    debris(out, sr, 0.05, { count: 10, spread: 0.35, fLo: 1100, fHi: 3200, gain: 0.24 }, r);
  } },
  // 3 行:木箱被砸碎——一串断裂 + 闷响 + 哗啦啦的碎木
  clear3: { dur: 1.1, peak: 0.92, drive: 3.3, make(out, sr, r) {
    impact(out, sr, 0, { f: 230, hard: 0.85, gain: 1.1, maxTau: 0.14 }, r);
    [0, 0.045, 0.1].forEach((t, i) => impact(out, sr, t, { f: 560 + i * 180, hard: 0.95, gain: 0.8 }, r));
    crackle(out, sr, 0, { dur: 0.26, density: 520, gain: 0.7 }, r);
    tear(out, sr, 0.01, { dur: 0.22, f: 900, fTo: 2200, gain: 0.5 }, r);
    boom(out, sr, 0, { dur: 0.35, fHi: 2000, fLo: 110, sub: 62, gain: 0.7 }, r);
    debris(out, sr, 0.06, { count: 18, spread: 0.55, fLo: 900, fHi: 3200, gain: 0.26 }, r);
  } },
  // 4 行:木头爆炸——大爆破 + 次低音下潜 + 长长的木屑雨
  clear4: { dur: 1.45, peak: 0.97, drive: 3.6, make(out, sr, r) {
    boom(out, sr, 0, { dur: 0.75, fHi: 2600, fLo: 70, sub: 58, gain: 1.2 }, r);
    impact(out, sr, 0, { f: 180, hard: 0.9, gain: 1.2, maxTau: 0.18 }, r);
    [0, 0.03, 0.07, 0.12, 0.18].forEach((t, i) => impact(out, sr, t, { f: 480 + i * 140, hard: 1, gain: 0.75 }, r));
    crackle(out, sr, 0, { dur: 0.4, density: 600, gain: 0.75 }, r);
    tear(out, sr, 0.005, { dur: 0.32, f: 800, fTo: 2400, gain: 0.55 }, r);
    debris(out, sr, 0.08, { count: 34, spread: 1.0, fLo: 800, fHi: 3400, gain: 0.28 }, r);
  } },
  // T-Spin:木棍挥过的"呼"
  whoosh: { dur: 0.3, peak: 0.4, drive: 1, make(out, sr, r) {
    addNoise(out, sr, 0, { dur: 0.28, f: 350, fTo: 2600, q: 1.6, gain: 1, attack: 0.12, curve: 1.2 }, r);
  } },
};

const SFX_NAMES = Object.keys(RECIPES);

// 渲染一个音效,返回 Float32Array(单声道)
function renderSfx(name, sr, seed) {
  const rc = RECIPES[name];
  const out = new Float32Array(Math.ceil(rc.dur * sr));
  rc.make(out, sr, rng(seed === undefined ? name.length * 7919 + 13 : seed));
  // 软饱和 + 尾部 15ms 淡出 + 归一化到目标峰值
  const d = rc.drive;
  const norm = d > 1 ? Math.tanh(d) : 1;
  let peak = 0;
  for (let i = 0; i < out.length; i++) {
    const v = d > 1 ? Math.tanh(out[i] * d) / norm : out[i];
    out[i] = v;
    peak = Math.max(peak, Math.abs(v));
  }
  const fade = Math.round(sr * 0.015);
  for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= i / fade;
  const k = peak > 0 ? rc.peak / peak : 1;
  for (let i = 0; i < out.length; i++) out[i] *= k;
  return out;
}

module.exports = { SFX_NAMES, renderSfx };
