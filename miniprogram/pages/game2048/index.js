// ─── 像素 2048 ───────────────────────────────────────────
// 四方向滑动合并数字。滑块平滑位移 + 合并脉冲 + 新块弹出 +
// 飘分 + 8-bit 合成音效，配色沿用大厅的暗色像素风。
const SIZE = 4;              // 4×4 棋盘
const SLIDE_MS = 110;        // 滑动位移动画时长
const POP_MS = 120;          // 合并脉冲 / 新块弹出时长
const SPAWN_4_RATE = 0.1;    // 新块出 4 的概率

// 数值 → [底色, 字色]，从冷蓝渐入品牌橙再到金色
const TILE_COLORS = {
  2:    ['#3D5A80', '#DCE6F5'],
  4:    ['#4A6FA5', '#E8EFF9'],
  8:    ['#B36546', '#FFF0E8'],
  16:   ['#C97050', '#FFF0E8'],
  32:   ['#D97757', '#FFF4EC'],
  64:   ['#E8895A', '#FFF8F0'],
  128:  ['#F5A03C', '#1A1A2E'],
  256:  ['#F5B83C', '#1A1A2E'],
  512:  ['#F5C842', '#1A1A2E'],
  1024: ['#FFDD66', '#1A1A2E'],
  2048: ['#FFEB8A', '#1A1A2E'],
};
const TILE_SUPER = ['#FFF6C9', '#1A1A2E'];  // 4096 及以上

// 还没玩过时分享卡上的演示排布（展示色阶递进）
const SHARE_DEMO_GRID = [
  [2, 4, 8, 16],
  [256, 128, 64, 32],
  [512, 1024, 2048, 0],
  [0, 0, 0, 0],
];

// 各方向的读取顺序与落位规则
const DIRS = {
  left:  { read: t => t,     line: 'row' },
  right: { read: t => 3 - t, line: 'row' },
  up:    { read: t => t,     line: 'col' },
  down:  { read: t => 3 - t, line: 'col' },
};

Page({
  data: {
    gameState: 'idle',   // 'idle' | 'playing' | 'win' | 'over'
    score: 0,
    bestScore: 0,
    maxTile: 0,
  },

  onLoad() {
    this.bestScore = wx.getStorageSync('game2048_best') || 0;
    this.setData({ bestScore: this.bestScore });
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
        this._ctx    = ctx;
        this._W      = w;
        this._H      = h;
        // 正方形棋盘：取宽高较小者，水平垂直居中
        const side = Math.min(w - 24, h - 24);
        this._gap  = Math.max(6, Math.floor(side * 0.028));
        this._cell = Math.floor((side - this._gap * (SIZE + 1)) / SIZE);
        const real = this._cell * SIZE + this._gap * (SIZE + 1);
        this._bx = Math.floor((w - real) / 2);
        this._by = Math.floor((h - real) / 2);
        this._side = real;

        this._initAudio();
        this._drawStatic(Date.now());
      });
  },

  onUnload() { this._stopLoop(); },
  onHide()   { this._stopLoop(); },

  onShow() {
    if (this.data.gameState === 'playing' && this._canvas) this._loop();
  },

  // 分享：文案按当前状态挑不尴尬的说法，配图用离屏画布现画的
  // 分享卡（干净的棋盘 + 分数，不受结算弹层遮挡影响）
  onShareAppMessage() {
    const base = { title: this._shareTitle(), path: '/pages/game2048/index' };
    return {
      ...base,
      promise: this._buildShareImage()
        .then(img => (img ? { ...base, imageUrl: img } : base))
        .catch(() => base),
    };
  },

  _shareTitle() {
    const score = this.data.score || 0;
    const max = this.data.maxTile || 0;
    const best = this.data.bestScore || 0;
    if (score > 0) {
      return max >= 2048
        ? `我拼出了 2048，拿下 ${score} 分！来挑战我～`
        : `我在 2048 拿了 ${score} 分，最大拼到 ${max}，来挑战我～`;
    }
    if (best > 0) return `我的 2048 最高分 ${best}，敢来超越吗？`;
    return '超解压的像素 2048，滑动合并数字，一起来玩！';
  },

  // ─── 交互 ──────────────────────────────────────────────

  onStart() { this._startGame(); },
  onRetry() { this._startGame(); },

  // 达成 2048 后选择继续冲更高
  onContinue() {
    this.setData({ gameState: 'playing' });
    this._loop();
  },

  onRestartTap() {
    if (this.data.gameState !== 'playing') return;
    wx.showModal({
      title: '重新开始',
      content: '当前进度将丢失，确定重新开始吗？',
      confirmText: '重开',
      cancelText: '再想想',
      success: res => { if (res.confirm) this._startGame(); }
    });
  },

  onTouchStart(e) {
    const t = e.touches[0];
    this._tx = t.clientX;
    this._ty = t.clientY;
    this._swiped = false;
  },

  onTouchMove(e) {
    if (this.data.gameState !== 'playing' || this._swiped) return;
    const t = e.touches[0];
    const dx = t.clientX - this._tx;
    const dy = t.clientY - this._ty;
    const MIN = 26;
    if (Math.abs(dx) < MIN && Math.abs(dy) < MIN) return;
    this._swiped = true;   // 一次手势只走一步
    this._move(Math.abs(dx) >= Math.abs(dy)
      ? (dx > 0 ? 'right' : 'left')
      : (dy > 0 ? 'down' : 'up'));
  },

  // 快速轻扫可能没触发 touchmove 阈值，抬手时兜底
  onTouchEnd(e) {
    if (this.data.gameState !== 'playing' || this._swiped) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - this._tx;
    const dy = t.clientY - this._ty;
    const MIN = 14;
    if (Math.abs(dx) < MIN && Math.abs(dy) < MIN) return;
    this._move(Math.abs(dx) >= Math.abs(dy)
      ? (dx > 0 ? 'right' : 'left')
      : (dy > 0 ? 'down' : 'up'));
  },

  // ─── 游戏控制 ──────────────────────────────────────────

  _startGame() {
    if (!this._canvas) return;
    this._stopLoop();

    this._grid = Array.from({ length: SIZE }, () => new Array(SIZE).fill(0));
    this._scoreVal = 0;
    this._won = false;
    this._anims = [];
    this._merged = [];
    this._spawns = [];
    this._floats = [];
    this._moveAt = 0;
    this._spawnTile(Date.now());
    this._spawnTile(Date.now());

    this.setData({ gameState: 'playing', score: 0, maxTile: this._maxTile() });
    this._loop();
  },

  _stopLoop() {
    if (this._raf && this._canvas) {
      this._canvas.cancelAnimationFrame(this._raf);
      this._raf = null;
    }
  },

  _loop() {
    this._stopLoop();
    const frame = () => {
      this._drawStatic(Date.now());
      if (this.data.gameState === 'playing') {
        this._raf = this._canvas.requestAnimationFrame(frame);
      }
    };
    frame();
  },

  // ─── 每步逻辑 ──────────────────────────────────────────

  _move(dir) {
    const { read, line } = DIRS[dir];
    const g = this._grid;
    const next = Array.from({ length: SIZE }, () => new Array(SIZE).fill(0));
    const anims = [];
    const merged = [];
    let gain = 0;
    let movedAny = false;

    const cellAt = (l, t) => line === 'row'
      ? { r: l, c: read(t) }
      : { r: read(t), c: l };

    for (let l = 0; l < SIZE; l++) {
      // 沿移动方向依次收集本行/列的非空块
      const cells = [];
      for (let t = 0; t < SIZE; t++) {
        const { r, c } = cellAt(l, t);
        if (g[r][c]) cells.push({ r, c, v: g[r][c] });
      }
      // 依次落位：相邻同值合并，每块每步最多合并一次
      let t = 0;
      for (let i = 0; i < cells.length; i++, t++) {
        const dest = cellAt(l, t);
        const cur = cells[i];
        if (i + 1 < cells.length && cells[i + 1].v === cur.v) {
          const pair = cells[i + 1];
          const nv = cur.v * 2;
          next[dest.r][dest.c] = nv;
          anims.push({ fr: cur.r,  fc: cur.c,  tr: dest.r, tc: dest.c, v: cur.v });
          anims.push({ fr: pair.r, fc: pair.c, tr: dest.r, tc: dest.c, v: pair.v });
          merged.push({ r: dest.r, c: dest.c, v: nv });
          gain += nv;
          movedAny = true;
          i++;
        } else {
          next[dest.r][dest.c] = cur.v;
          anims.push({ fr: cur.r, fc: cur.c, tr: dest.r, tc: dest.c, v: cur.v });
          if (cur.r !== dest.r || cur.c !== dest.c) movedAny = true;
        }
      }
    }

    if (!movedAny) return;   // 该方向推不动，忽略这次滑动

    const now = Date.now();
    this._grid = next;
    this._anims = anims;
    this._merged = merged;
    this._moveAt = now;
    this._spawns = [];
    this._spawnTile(now + SLIDE_MS);   // 新块等滑动结束再弹出

    if (gain > 0) {
      this._scoreVal += gain;
      if (this._scoreVal > this.bestScore) {
        this.bestScore = this._scoreVal;
        wx.setStorageSync('game2048_best', this.bestScore);
      }
      // 在最大的一次合并处飘分
      const top = merged.reduce((a, b) => (b.v > a.v ? b : a), merged[0]);
      this._floats.push({
        x: this._cx(top.c), y: this._cy(top.r) - this._cell * 0.2,
        text: `+${gain}`, alpha: 1,
      });
      try { wx.vibrateShort({ type: 'light' }); } catch (e) {}
      this._sfxMerge(top.v);
    } else {
      this._sfxSlide();
    }

    this.setData({ score: this._scoreVal, bestScore: this.bestScore, maxTile: this._maxTile() });

    if (!this._won && merged.some(m => m.v >= 2048)) {
      this._won = true;
      this._sfxWin();
      setTimeout(() => {
        this._stopLoop();
        this._drawStatic(Date.now() + SLIDE_MS + POP_MS);  // 定格最终画面
        this.setData({ gameState: 'win' });
      }, SLIDE_MS + POP_MS + 150);
      return;
    }

    if (!this._canMove()) {
      this._sfxOver();
      setTimeout(() => {
        this._stopLoop();
        this._drawStatic(Date.now() + SLIDE_MS + POP_MS);
        this.setData({ gameState: 'over' });
      }, SLIDE_MS + POP_MS + 250);
    }
  },

  _spawnTile(showAt) {
    const empty = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (!this._grid[r][c]) empty.push({ r, c });
      }
    }
    if (!empty.length) return;
    const { r, c } = empty[Math.floor(Math.random() * empty.length)];
    const v = Math.random() < SPAWN_4_RATE ? 4 : 2;
    this._grid[r][c] = v;
    this._spawns.push({ r, c, at: showAt });
  },

  _maxTile() {
    let m = 0;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) m = Math.max(m, this._grid[r][c]);
    }
    return m;
  },

  _canMove() {
    const g = this._grid;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (!g[r][c]) return true;
        if (r + 1 < SIZE && g[r][c] === g[r + 1][c]) return true;
        if (c + 1 < SIZE && g[r][c] === g[r][c + 1]) return true;
      }
    }
    return false;
  },

  // ─── 渲染 ──────────────────────────────────────────────

  _cx(c) { return this._bx + this._gap + c * (this._cell + this._gap) + this._cell / 2; },
  _cy(r) { return this._by + this._gap + r * (this._cell + this._gap) + this._cell / 2; },

  _drawStatic(now) {
    const ctx = this._ctx;
    if (!ctx) return;
    const W = this._W, H = this._H;

    ctx.fillStyle = '#1A1A2E';
    ctx.fillRect(0, 0, W, H);
    this._drawBoard(ctx);

    const slideT = this._moveAt ? Math.min(1, (now - this._moveAt) / SLIDE_MS) : 1;

    if (slideT < 1) {
      // 滑动阶段：按旧值插值绘制每一块
      const e = 1 - Math.pow(1 - slideT, 3);   // ease-out
      for (const a of this._anims) {
        const x = this._cx(a.fc) + (this._cx(a.tc) - this._cx(a.fc)) * e;
        const y = this._cy(a.fr) + (this._cy(a.tr) - this._cy(a.fr)) * e;
        this._drawTile(ctx, x, y, a.v, 1);
      }
    } else {
      // 静止阶段：按新棋盘绘制，合并块脉冲、新块弹出
      const popStart = this._moveAt + SLIDE_MS;
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          const v = this._grid[r][c];
          if (!v) continue;
          let scale = 1;
          const sp = this._spawns.find(s => s.r === r && s.c === c);
          if (sp) {
            if (now < sp.at) continue;   // 新块还没到出场时间
            scale = Math.min(1, (now - sp.at) / POP_MS);
          } else if (this._moveAt && this._merged.some(m => m.r === r && m.c === c)) {
            const pt = Math.min(1, (now - popStart) / POP_MS);
            scale = 1 + Math.sin(pt * Math.PI) * 0.16;   // 1 → 1.16 → 1
          }
          this._drawTile(ctx, this._cx(c), this._cy(r), v, scale);
        }
      }
    }

    this._drawFloats(ctx);
  },

  _drawBoard(ctx) {
    // 棋盘底板 + 像素风硬阴影
    ctx.fillStyle = '#0E0E22';
    ctx.fillRect(this._bx + 5, this._by + 5, this._side, this._side);
    ctx.fillStyle = '#252547';
    ctx.fillRect(this._bx, this._by, this._side, this._side);
    // 空格
    ctx.fillStyle = '#1E1E38';
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        ctx.fillRect(
          this._cx(c) - this._cell / 2, this._cy(r) - this._cell / 2,
          this._cell, this._cell
        );
      }
    }
  },

  _drawTile(ctx, cx, cy, v, scale) {
    if (scale <= 0) return;
    this._paintTile(ctx, cx, cy, this._cell * scale, v);
  },

  _paintTile(ctx, cx, cy, s, v) {
    const [bg, fg] = TILE_COLORS[v] || TILE_SUPER;
    const x = cx - s / 2, y = cy - s / 2;

    ctx.fillStyle = bg;
    ctx.fillRect(x, y, s, s);
    // 顶部高光压条，增强像素浮雕感
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(x, y, s, Math.max(2, s * 0.08));

    const digits = String(v).length;
    const fs = Math.floor(s * (digits <= 2 ? 0.44 : digits === 3 ? 0.36 : 0.28));
    ctx.fillStyle = fg;
    ctx.font = `bold ${fs}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(v), cx, cy + s * 0.03);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  },

  _drawFloats(ctx) {
    this._floats = this._floats.filter(f => f.alpha > 0);
    if (!this._floats.length) return;
    ctx.font = `bold ${Math.floor(this._cell * 0.4)}px monospace`;
    ctx.textAlign = 'center';
    for (const f of this._floats) {
      f.y -= 1.0;
      f.alpha -= 0.03;
      if (f.alpha <= 0) continue;
      ctx.globalAlpha = Math.max(0, f.alpha);
      ctx.fillStyle = '#F5C842';
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  },

  // ─── 分享卡（500×400，微信分享图 5:4）──────────────────

  // 生成失败或超时则返回 null，分享降级为默认页面截图
  _buildShareImage() {
    return new Promise(resolve => {
      let settled = false;
      const done = v => { if (!settled) { settled = true; resolve(v); } };
      setTimeout(() => done(null), 1500);
      try {
        const W = 500, H = 400, SCALE = 2;
        const canvas = wx.createOffscreenCanvas({ type: '2d', width: W * SCALE, height: H * SCALE });
        const ctx = canvas.getContext('2d');
        ctx.scale(SCALE, SCALE);
        this._drawShareCard(ctx, W, H);
        wx.canvasToTempFilePath({
          canvas,
          fileType: 'png',
          success: res => done(res.tempFilePath),
          fail: () => done(null),
        });
      } catch (e) {
        done(null);
      }
    });
  },

  _drawShareCard(ctx, W, H) {
    // 背景 + 弱棋盘格
    ctx.fillStyle = '#1A1A2E';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#1E1E38';
    const bg = 40;
    for (let col = 0; col < Math.ceil(W / bg); col++) {
      for (let row = 0; row < Math.ceil(H / bg); row++) {
        if ((col + row) % 2 === 0) ctx.fillRect(col * bg, row * bg, bg, bg);
      }
    }

    // 左侧：棋盘（有对局画真实棋盘，否则画演示排布）
    const grid = (this._grid && (this.data.score > 0 || this.data.gameState !== 'idle'))
      ? this._grid
      : SHARE_DEMO_GRID;
    const side = 320, bx = 40, by = 40, gap = 10;
    const cell = (side - gap * (SIZE + 1)) / SIZE;
    ctx.fillStyle = '#0E0E22';
    ctx.fillRect(bx + 5, by + 5, side, side);
    ctx.fillStyle = '#252547';
    ctx.fillRect(bx, by, side, side);
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const x = bx + gap + c * (cell + gap);
        const y = by + gap + r * (cell + gap);
        ctx.fillStyle = '#1E1E38';
        ctx.fillRect(x, y, cell, cell);
        if (grid[r][c]) this._paintTile(ctx, x + cell / 2, y + cell / 2, cell, grid[r][c]);
      }
    }

    // 右侧：标题 + 分数
    const rx = 430;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#F5C842';
    ctx.font = 'bold 42px monospace';
    ctx.fillText('2048', rx, 100);

    const score = this.data.score || 0;
    const best = this.data.bestScore || 0;
    const label = (text, y) => {
      ctx.fillStyle = '#5A5A8A';
      ctx.font = 'bold 15px monospace';
      ctx.fillText(text, rx, y);
    };
    const value = (text, y, color) => {
      ctx.fillStyle = color;
      ctx.font = 'bold 30px monospace';
      ctx.fillText(text, rx, y);
    };
    if (score > 0) {
      label('SCORE', 175);
      value(String(score), 208, '#D97757');
      label('BEST', 265);
      value(String(best), 298, '#F5C842');
    } else if (best > 0) {
      label('BEST', 195);
      value(String(best), 230, '#F5C842');
    } else {
      ctx.fillStyle = '#4A6FA5';
      ctx.font = 'bold 20px monospace';
      ctx.fillText('滑动合并', rx, 190);
      ctx.fillText('数字翻倍', rx, 220);
    }
    ctx.fillStyle = '#6A6A9A';
    ctx.font = '14px monospace';
    ctx.fillText('来挑战我', rx, 356);
    ctx.textAlign = 'left';
  },

  // ─── 音频（Web Audio 合成，不支持时静默降级）───────────

  _initAudio() {
    try {
      this._ac = wx.createWebAudioContext();
    } catch (e) {
      this._ac = null;
    }
  },

  _note(freq, startTime, dur, vol = 0.15, type = 'square') {
    if (!this._ac || freq === 0) return;
    const ac = this._ac;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.connect(g);
    g.connect(ac.destination);
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(vol, startTime);
    g.gain.exponentialRampToValueAtTime(0.001, startTime + dur * 0.88);
    osc.start(startTime);
    osc.stop(startTime + dur);
  },

  // 合并音调随块值升高，越大越亮
  _sfxMerge(v) {
    if (!this._ac) return;
    const now = this._ac.currentTime;
    const level = Math.min(11, Math.round(Math.log2(v)));   // 2→1 … 2048→11
    const base = 220 * Math.pow(1.12, level);
    this._note(base, now, 0.09, 0.18);
    this._note(base * 1.5, now + 0.05, 0.1, 0.14);
  },

  _sfxSlide() {
    if (!this._ac) return;
    this._note(180, this._ac.currentTime, 0.05, 0.08, 'triangle');
  },

  _sfxWin() {
    if (!this._ac) return;
    const now = this._ac.currentTime;
    [523, 659, 784, 1047, 1319].forEach((f, i) => this._note(f, now + i * 0.09, 0.14, 0.2));
  },

  _sfxOver() {
    if (!this._ac) return;
    const now = this._ac.currentTime;
    [330, 262, 220, 165].forEach((f, i) => this._note(f, now + i * 0.12, 0.15, 0.22, 'sawtooth'));
  },
});
