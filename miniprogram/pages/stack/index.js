// ─── 像素盖楼(Stack)──────────────────────────────────────
// 楼层左右滑动,点击落下;与下层错位的部分被切掉坠落,
// 楼越盖越窄、滑速越来越快。对齐误差 ≤4px 判 PERFECT:
// 金光 + 连击升调,连续 PERFECT 还能把楼层宽度长回来。
// Clawd 站在楼顶,每盖一层跳一下。
const { GRID_COLS, GRID_ROWS, drawClawd } = require('../../utils/clawd');

const BH = 26;               // 层高
const BASE_W_RATIO = 0.62;   // 底座宽度占屏宽比例
const PERFECT_TOL = 4;       // PERFECT 判定误差(px)
const MIN_OVERLAP = 2;       // 低于此重叠视为完全落空
const GROW_STEP = 6;         // 连续 PERFECT 回宽步长
const STORAGE_KEY = 'stack_best';

const CLAWD_PS = 0.8;        // 楼顶 Clawd 像素尺寸

Page({
  data: {
    gameState: 'idle',   // 'idle' | 'playing' | 'over'
    score: 0,
    best: 0,
    isNewBest: false,
  },

  onLoad() {
    this._best = wx.getStorageSync(STORAGE_KEY) || 0;
    this.setData({ best: this._best });
    this._initAudio();
  },

  onReady() {
    const info = wx.getSystemInfoSync();
    this._dpr = info.pixelRatio || 2;

    wx.createSelectorQuery()
      .select('#game-canvas')
      .fields({ node: true, size: true })
      .exec(res => {
        if (!res || !res[0] || !res[0].node) return;
        const node = res[0].node;
        const w = res[0].width;
        const h = res[0].height;
        node.width  = Math.round(w * this._dpr);
        node.height = Math.round(h * this._dpr);
        const ctx = node.getContext('2d');
        ctx.scale(this._dpr, this._dpr);

        this._canvas = node;
        this._ctx = ctx;
        this._W = w;
        this._H = h;
        this._baseY = h - 48;
        this._baseW = Math.round(w * BASE_W_RATIO);

        this._initStars();
        this._resetTower();
        this._startLoop();
      });
  },

  onShow() {
    if (this._canvas) this._startLoop();
  },

  onHide() {
    this._stopLoop();
  },

  onUnload() {
    this._stopLoop();
    if (this._wac) {
      try { this._wac.close(); } catch (e) {}
      this._wac = null;
    }
  },

  noop() {},

  onShareAppMessage() {
    const s = this.data.score || 0;
    return {
      title: s > 0
        ? `我在像素盖楼盖到了 ${s} 层!来比比谁的楼更高～`
        : '手指点一点,盖出最高像素塔!来挑战～',
      path: '/pages/stack/index',
    };
  },

  // ── 交互 ────────────────────────────────────────────────
  onTap() {
    if (this.data.gameState === 'idle') {
      this._startGame();
    } else if (this.data.gameState === 'playing' && !this._dying) {
      this._drop();
    }
  },

  onRetry() {
    this._startGame();
  },

  // ── 状态 ────────────────────────────────────────────────
  // 仅摆好底座(空闲画面与新开局共用)
  _resetTower() {
    this._stack = [{ x: (this._W - this._baseW) / 2, w: this._baseW }];
    this._cur = null;
    this._debris = [];
    this._labels = [];
    this._cam = 0;
    this._camT = 0;
    this._shake = 0;
    this._flash = 0;
    this._frame = 0;
    this._combo = 0;
    this._floors = 0;
    this._dying = false;
    this._dieFrame = 0;
    this._hop = 0;
  },

  _startGame() {
    this._resetTower();
    this.setData({ gameState: 'playing', score: 0, isNewBest: false });
    this._spawnBlock();
    this._startLoop();
  },

  _spawnBlock() {
    const top = this._stack[this._stack.length - 1];
    const dir = this._stack.length % 2 === 1 ? 1 : -1;
    this._cur = {
      w: top.w,
      x: dir > 0 ? -top.w : this._W,
      dir,
      speed: Math.min(6.5, 2.4 + this._floors * 0.055),
    };
  },

  _drop() {
    const cur = this._cur;
    const top = this._stack[this._stack.length - 1];
    if (!cur) return;

    const dx = cur.x - top.x;

    if (Math.abs(dx) <= PERFECT_TOL) {
      // PERFECT:吸附对齐,连击升调;连续两次起开始回宽
      cur.x = top.x;
      this._combo += 1;
      if (this._combo >= 2 && cur.w < this._baseW) {
        const grow = Math.min(GROW_STEP, this._baseW - cur.w);
        cur.w += grow;
        cur.x -= grow / 2;
      }
      this._addLabel(this._combo >= 2 ? `PERFECT ×${this._combo}` : 'PERFECT!', '#F5C842');
      this._flash = 0.16;
      this._sfxPerfect(this._combo);
    } else {
      const overlap = cur.w - Math.abs(dx);
      if (overlap <= MIN_OVERLAP) {
        // 完全落空:整块坠落,进入结束演出
        this._debris.push({
          x: cur.x, w: cur.w,
          y: this._levelY(this._stack.length, 0), vy: 0.5,
        });
        this._cur = null;
        this._startDying();
        return;
      }
      // 切掉悬空部分
      this._combo = 0;
      const cutW = Math.abs(dx);
      const cutX = dx > 0 ? top.x + top.w : cur.x;
      this._debris.push({
        x: cutX, w: cutW,
        y: this._levelY(this._stack.length, 0), vy: 0.5,
      });
      cur.x = Math.max(cur.x, top.x);
      cur.w = overlap;
      this._sfxSlice();
    }

    this._stack.push({ x: cur.x, w: cur.w });
    this._floors += 1;
    this._hop = 6;                 // Clawd 起跳
    this._sfxDrop();
    this.setData({ score: this._floors });

    if (this._floors % 10 === 0) {
      this._addLabel(`${this._floors}F!`, '#60C0FF');
      this._sfxMilestone();
    }

    // 相机目标:楼顶保持在屏幕 45% 高度附近
    this._camT = Math.max(0, this._stack.length * BH - this._H * 0.42);
    this._spawnBlock();
  },

  _startDying() {
    this._dying = true;
    this._dieFrame = 0;
    this._shake = 5;
    this._sfxGameOver();
  },

  _finishGame() {
    this._dying = false;
    const isNewBest = this._floors > this._best;
    if (isNewBest) {
      this._best = this._floors;
      wx.setStorageSync(STORAGE_KEY, this._best);
    }
    this.setData({
      gameState: 'over',
      score: this._floors,
      best: this._best,
      isNewBest,
    });
  },

  _addLabel(text, color) {
    this._labels.push({ text, color, f: 0 });
    if (this._labels.length > 3) this._labels.shift();
  },

  // ── 主循环 ──────────────────────────────────────────────
  _startLoop() {
    if (this._raf || !this._canvas) return;
    const step = () => {
      this._raf = this._canvas.requestAnimationFrame(step);
      this._update();
      this._draw();
    };
    this._raf = this._canvas.requestAnimationFrame(step);
  },

  _stopLoop() {
    if (this._raf && this._canvas) this._canvas.cancelAnimationFrame(this._raf);
    this._raf = null;
  },

  _update() {
    this._frame++;

    // 移动当前楼层(往返滑动,两端略微出屏)
    if (this._cur && !this._dying) {
      const c = this._cur;
      c.x += c.dir * c.speed;
      if (c.x <= -c.w / 2) { c.x = -c.w / 2; c.dir = 1; }
      if (c.x >= this._W - c.w / 2) { c.x = this._W - c.w / 2; c.dir = -1; }
    }

    // 相机缓动
    this._cam += (this._camT - this._cam) * 0.12;

    // 碎块坠落
    this._debris = this._debris.filter(d => {
      d.y += d.vy;
      d.vy += 0.5;
      return d.y + this._cam < this._H + 60;
    });

    // 浮字与 Clawd 跳跃
    this._labels = this._labels.filter(lb => ++lb.f < 50);
    if (this._hop > 0) this._hop -= 0.6;

    if (this._dying && ++this._dieFrame > 55) {
      this._finishGame();
    }
  },

  // ── 渲染 ────────────────────────────────────────────────
  // 第 level 层顶边的屏幕 y(level 0 = 底座)
  _levelY(level, cam) {
    return this._baseY - (level + 1) * BH + (cam === undefined ? this._cam : cam);
  },

  _floorColor(i, part) {
    const hue = (200 + i * 14) % 360;
    const l = part === 'light' ? 66 : part === 'dark' ? 38 : 52;
    return `hsl(${hue}, 48%, ${l}%)`;
  },

  _drawBlock(x, yTop, w, i) {
    const ctx = this._ctx;
    ctx.fillStyle = this._floorColor(i);
    ctx.fillRect(x, yTop, w, BH);
    // 像素倒角
    ctx.fillStyle = this._floorColor(i, 'light');
    ctx.fillRect(x, yTop, w, 3);
    ctx.fillRect(x, yTop, 3, BH);
    ctx.fillStyle = this._floorColor(i, 'dark');
    ctx.fillRect(x + w - 3, yTop, 3, BH);
    ctx.fillRect(x, yTop + BH - 3, w, 3);
    // 窗户
    ctx.fillStyle = 'rgba(14, 14, 34, 0.55)';
    const n = Math.max(1, Math.floor(w / 34));
    for (let k = 0; k < n; k++) {
      ctx.fillRect(Math.round(x + (w / (n + 1)) * (k + 1) - 4), yTop + 9, 8, 9);
    }
    ctx.strokeStyle = 'rgba(10, 10, 26, 0.4)';
    ctx.strokeRect(x + 0.5, yTop + 0.5, w - 1, BH - 1);
  },

  _draw() {
    const ctx = this._ctx;
    if (!ctx) return;
    const W = this._W, H = this._H;

    ctx.save();
    if (this._shake > 0.3) {
      ctx.translate((Math.random() * 2 - 1) * this._shake, (Math.random() * 2 - 1) * this._shake);
      this._shake *= 0.86;
    }

    // 天空 + 星星(随高度缓慢视差)
    ctx.fillStyle = '#1A1A2E';
    ctx.fillRect(-10, -10, W + 20, H + 20);
    ctx.fillStyle = '#5A5A8A';
    for (const s of (this._stars || [])) {
      const sy = (s.y + this._cam * 0.15) % (H + 20);
      ctx.fillRect(s.x, sy, s.sz, s.sz);
    }

    // 每 10 层的高度刻度线
    ctx.fillStyle = 'rgba(74, 111, 165, 0.28)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    for (let lv = 10; lv <= this._stack.length + 20; lv += 10) {
      const y = this._levelY(lv - 1, this._cam);
      if (y < -20 || y > H + 20) continue;
      for (let x = 0; x < W; x += 14) ctx.fillRect(x, y, 7, 1);
      ctx.fillText(`${lv}F`, 6, y - 4);
    }

    // 地面
    const gy = this._baseY + this._cam;
    if (gy < H + 20) {
      ctx.fillStyle = '#12122A';
      ctx.fillRect(-10, gy, W + 20, H - gy + 20);
      ctx.fillStyle = '#4A6FA5';
      ctx.fillRect(-10, gy, W + 20, 2);
    }

    // 楼层(只画可视范围)
    for (let i = 0; i < this._stack.length; i++) {
      const yTop = this._levelY(i);
      if (yTop > H + BH || yTop < -BH * 2) continue;
      const b = this._stack[i];
      this._drawBlock(b.x, yTop, b.w, i);
    }

    // 坠落碎块
    for (const d of this._debris) {
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = '#3A3A55';
      ctx.fillRect(d.x, d.y + this._cam, d.w, BH);
      ctx.globalAlpha = 1;
    }

    // 滑动中的楼层 + 对齐参考虚线
    if (this._cur && !this._dying) {
      const c = this._cur;
      const yTop = this._levelY(this._stack.length);
      const top = this._stack[this._stack.length - 1];
      ctx.fillStyle = 'rgba(245, 200, 66, 0.22)';
      for (let y = yTop - 40; y < yTop + BH; y += 8) {
        ctx.fillRect(top.x, y, 1, 4);
        ctx.fillRect(top.x + top.w - 1, y, 1, 4);
      }
      this._drawBlock(c.x, yTop, c.w, this._stack.length);
    }

    // 楼顶的 Clawd(落层时跳一下)
    if (!this._dying || this._dieFrame < 20) {
      const top = this._stack[this._stack.length - 1];
      const cw = GRID_COLS * CLAWD_PS;
      const chh = GRID_ROWS * CLAWD_PS;
      const hop = this._hop > 0 ? -this._hop : 0;
      drawClawd(
        ctx,
        top.x + top.w / 2 - cw / 2,
        this._levelY(this._stack.length - 1) - chh + hop,
        CLAWD_PS,
        { legFrame: this._hop > 2 ? 'all' : 0 }
      );
    }

    // PERFECT 金闪
    if (this._flash > 0.02) {
      ctx.fillStyle = `rgba(245, 200, 66, ${this._flash})`;
      ctx.fillRect(-10, -10, W + 20, H + 20);
      this._flash *= 0.85;
    }

    // 浮字
    for (let i = 0; i < this._labels.length; i++) {
      const lb = this._labels[i];
      const a = lb.f < 6 ? lb.f / 6 : 1 - Math.max(0, lb.f - 28) / 22;
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = lb.color;
      ctx.font = 'bold 20px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(lb.text, W / 2, H * 0.24 - lb.f * 0.6 + i * 24);
    }
    ctx.globalAlpha = 1;

    // HUD:层数
    if (this.data.gameState !== 'idle') {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.font = 'bold 34px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${this._floors}F`, W / 2, 54);
    }

    ctx.restore();
  },

  _initStars() {
    this._stars = Array.from({ length: 42 }, () => ({
      x: Math.random() * this._W,
      y: Math.random() * this._H,
      sz: Math.random() < 0.2 ? 2 : 1,
    }));
  },

  // ── 音频(全部 Web Audio 合成)────────────────────────────
  _initAudio() {
    try {
      this._wac = wx.createWebAudioContext();
    } catch (e) {
      this._wac = null;
    }
  },

  _note(freq, start, dur, vol, type) {
    if (!this._wac) return;
    try {
      const osc = this._wac.createOscillator();
      const g = this._wac.createGain();
      osc.type = type || 'square';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(vol, start);
      g.gain.exponentialRampToValueAtTime(0.001, start + dur);
      osc.connect(g);
      g.connect(this._wac.destination);
      osc.start(start);
      osc.stop(start + dur);
    } catch (e) {}
  },

  _sfxDrop() {
    if (!this._wac) return;
    const now = this._wac.currentTime;
    this._note(150, now, 0.07, 0.2, 'square');
    this._note(95, now + 0.02, 0.08, 0.14, 'triangle');
  },

  _sfxSlice() {
    if (!this._wac) return;
    const now = this._wac.currentTime;
    this._note(420, now, 0.05, 0.1, 'sawtooth');
  },

  _sfxPerfect(combo) {
    if (!this._wac) return;
    const now = this._wac.currentTime;
    const f = 880 * Math.pow(2, Math.min(combo - 1, 10) / 12);
    this._note(f, now, 0.08, 0.16);
    this._note(f * 1.5, now + 0.06, 0.1, 0.12);
  },

  _sfxMilestone() {
    if (!this._wac) return;
    const now = this._wac.currentTime;
    [659, 784, 1046].forEach((f, i) => this._note(f, now + i * 0.07, 0.09, 0.14));
  },

  _sfxGameOver() {
    if (!this._wac) return;
    const now = this._wac.currentTime;
    [392, 330, 262, 196].forEach((f, i) => this._note(f, now + i * 0.13, 0.15, 0.18));
  },
});
