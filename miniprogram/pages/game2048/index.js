// ─── 木质 2048 ───────────────────────────────────────────
// 四方向滑动合并数字。滑块平滑位移 + 合并脉冲 + 新块弹出 + 飘分。
// 美术是木质 3D 风格(utils/wood-art.js):棋盘是一块带凹槽的木板,
// 数字块是烙了字的染色木块;滑动 / 合并用木头敲击声(utils/wood-sfx.js)。
const {
  drawSlab, drawSocket, drawCube, drawCastShadow, drawBurnedText, rng,
} = require('../../utils/wood-art.js');
const { createWoodPlayer } = require('../../utils/wood-sfx.js');

const SIZE = 4;              // 4×4 棋盘
const SLIDE_MS = 110;        // 滑动位移动画时长
const POP_MS = 120;          // 合并脉冲 / 新块弹出时长
const SPAWN_4_RATE = 0.1;    // 新块出 4 的概率

// 数值 → [木色, 字是否浅色]:浅色枫木 → 橡木 → 柚木 → 樱桃木 → 桃花心木,
// 再往上换成彩色染木,2048 是金箔木块;深色木头上的字用浅色嵌字
const TILE_WOOD = {
  2:    ['#EAD3A6', false],
  4:    ['#E0BA80', false],
  8:    ['#D99A55', false],
  16:   ['#C9773F', true],
  32:   ['#BE5238', true],
  64:   ['#963828', true],
  128:  ['#D7A64A', false],
  256:  ['#78A85A', true],
  512:  ['#4C93C2', true],
  1024: ['#8B5FB0', true],
  2048: ['#F2C64A', false],
};
const TILE_SUPER = ['#3A2A20', true];  // 4096 及以上:乌木 + 金字
const BOARD_WOOD = '#94603A';

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
    // 开局前先放一个空棋盘,首帧绘制不会读到 undefined
    this._grid = Array.from({ length: SIZE }, () => new Array(SIZE).fill(0));
    this._anims = [];
    this._merged = [];
    this._spawns = [];
    this._floats = [];
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
        // 正方形棋盘：取宽高较小者，水平垂直居中(右下留出木板厚度)
        const side = Math.min(w - 36, h - 36);
        this._gap  = Math.max(6, Math.floor(side * 0.028));
        this._cell = Math.floor((side - this._gap * (SIZE + 1)) / SIZE);
        const real = this._cell * SIZE + this._gap * (SIZE + 1);
        this._bx = Math.floor((w - real) / 2);
        this._by = Math.floor((h - real) / 2);
        this._side = real;

        this._initArt();
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

  // 只有本局真打出成绩才报分数，否则一律纯邀请文案，避免误导
  _shareTitle() {
    const score = this.data.score || 0;
    const max = this.data.maxTile || 0;
    if (score > 0) {
      return max >= 2048
        ? `我拼出了 2048，拿下 ${score} 分！来挑战我～`
        : `我在 2048 拿了 ${score} 分，最大拼到 ${max}，来挑战我～`;
    }
    return '超解压的木块 2048，滑动合并数字，一起来玩！';
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

    ctx.clearRect(0, 0, W, H);
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

  // ─── 木质美术 ──────────────────────────────────────────
  // 棋盘(木板 + 16 个凹槽)画一次存进离屏 canvas;数字块按数值缓存精灵。
  // 离屏 canvas 不可用时每帧直接画(慢一点但能用)
  _initArt() {
    this._tiles = {};
    this._boardImg = null;
    try {
      this._mkCanvas = (w, h) => wx.createOffscreenCanvas({ type: '2d', width: w, height: h });
      const c = this._mkCanvas(Math.round(this._W * this._dpr), Math.round(this._H * this._dpr));
      const g = c.getContext('2d');
      g.scale(this._dpr, this._dpr);
      this._paintBoard(g, this._bx, this._by, this._side, this._cell, this._gap);
      this._boardImg = c;
    } catch (e) {
      this._mkCanvas = null;
    }
  },

  _paintBoard(g, bx, by, side, cell, gap) {
    drawSlab(g, bx, by, side, side, {
      base: BOARD_WOOD, depth: Math.max(4, Math.round(side * 0.022)), radius: gap * 1.6, seed: 2048,
    });
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        drawSocket(g, bx + gap + c * (cell + gap), by + gap + r * (cell + gap), cell, { radius: 0.14, seed: r * 7 + c + 1 });
      }
    }
  },

  _drawBoard(ctx) {
    if (this._boardImg) ctx.drawImage(this._boardImg, 0, 0, this._W, this._H);
    else this._paintBoard(ctx, this._bx, this._by, this._side, this._cell, this._gap);
  },

  // 数字木块:投影 + 有厚度的染色木块 + 烙上去的数字。
  // (x, y) 是凹槽左上角;木块抬起后顶面往左上偏半个厚度,侧面落在凹槽里
  _tileLift(s) {
    return Math.max(1, Math.round(s * 0.045));
  },

  _paintWoodTile(g, x, y, s, v) {
    const [wood, light] = TILE_WOOD[v] || TILE_SUPER;
    const o = this._tileLift(s);
    const h = o * 2;
    const rand = rng(v * 37 + Math.round(s));
    drawCastShadow(g, x - o, y - o, s, h, Math.max(1, h * 0.7));
    drawCube(g, x - o, y - o, s, h, wood, rand, { radius: 0.14 });
    const digits = String(v).length;
    const fs = s * (digits <= 2 ? 0.46 : digits === 3 ? 0.37 : 0.29);
    const tcx = x - o + s / 2;
    const tcy = y - o + s / 2 + s * 0.02;
    if (v >= 2048) {
      // 金箔块:深色烙字 + 一道斜光;乌木块:烫金字
      drawBurnedText(g, String(v), tcx, tcy, fs, v === 2048 ? { color: '#4A2A06' } : { light: true, color: '#FFD46A' });
      if (v === 2048) {
        const sh = g.createLinearGradient(x - o, y - o, x - o + s, y - o + s);
        sh.addColorStop(0, 'rgba(255, 255, 255, 0)');
        sh.addColorStop(0.45, 'rgba(255, 255, 240, 0.35)');
        sh.addColorStop(0.55, 'rgba(255, 255, 240, 0)');
        g.fillStyle = sh;
        g.fillRect(x - o, y - o, s, s);
      }
    } else {
      drawBurnedText(g, String(v), tcx, tcy, fs, { light, color: light ? '#FFF2DA' : '#3A1F0C' });
    }
  },

  _tileSprite(v, s) {
    const key = `${v}_${s}`;
    if (this._tiles[key] !== undefined) return this._tiles[key];
    let spr = null;
    if (this._mkCanvas) {
      try {
        const pad = Math.ceil(s * 0.2);
        const size = s + pad;
        const c = this._mkCanvas(Math.ceil(size * this._dpr), Math.ceil(size * this._dpr));
        const g = c.getContext('2d');
        g.scale(this._dpr, this._dpr);
        const o = this._tileLift(s);
        this._paintWoodTile(g, o, o, s, v);
        spr = { canvas: c, size, off: o };
      } catch (e) {
        spr = null;
      }
    }
    this._tiles[key] = spr;
    return spr;
  },

  _drawTile(ctx, cx, cy, v, scale) {
    if (scale <= 0) return;
    const s = this._cell;
    const spr = this._tileSprite(v, s);
    if (!spr) {
      const ss = s * scale;
      this._paintWoodTile(ctx, cx - ss / 2, cy - ss / 2, ss, v);
      return;
    }
    // 精灵里顶面占 [0, s]²,相对凹槽往左上偏 off;绕顶面中心缩放
    const k = scale;
    const dx = cx - spr.off - (s / 2) * k;
    const dy = cy - spr.off - (s / 2) * k;
    ctx.drawImage(spr.canvas, dx, dy, spr.size * k, spr.size * k);
  },

  _drawFloats(ctx) {
    this._floats = this._floats.filter(f => f.alpha > 0);
    if (!this._floats.length) return;
    const fs = Math.floor(this._cell * 0.4);
    ctx.font = `bold ${fs}px monospace`;
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(3, fs * 0.18);
    for (const f of this._floats) {
      f.y -= 1.0;
      f.alpha -= 0.03;
      if (f.alpha <= 0) continue;
      ctx.globalAlpha = Math.max(0, f.alpha);
      ctx.strokeStyle = '#2A1408';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = '#FFD46A';
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
    // 背景:深色桌面,中间亮四周暗
    const bgGrad = ctx.createRadialGradient(W * 0.4, H * 0.4, 20, W * 0.5, H * 0.5, W * 0.7);
    bgGrad.addColorStop(0, '#4A2C1B');
    bgGrad.addColorStop(1, '#1C0F07');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // 左侧：棋盘（有对局画真实棋盘，否则画演示排布）
    const grid = (this._grid && (this.data.score > 0 || this.data.gameState !== 'idle'))
      ? this._grid
      : SHARE_DEMO_GRID;
    const side = 320, bx = 36, by = 36, gap = 10;
    const cell = Math.floor((side - gap * (SIZE + 1)) / SIZE);
    this._paintBoard(ctx, bx, by, side, cell, gap);
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const x = bx + gap + c * (cell + gap);
        const y = by + gap + r * (cell + gap);
        if (grid[r][c]) this._paintWoodTile(ctx, x, y, cell, grid[r][c]);
      }
    }

    // 右侧:挂一块小木牌写标题和分数
    const rx = 432;
    drawSlab(ctx, 376, 46, 112, 300, { base: '#A86F3E', depth: 4, radius: 12, seed: 7, nails: 3 });
    const title = (text, y, size, color) => {
      ctx.save();
      ctx.font = `bold ${size}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(40, 18, 4, 0.7)';
      ctx.fillText(text, rx, y + 2);
      ctx.fillStyle = color;
      ctx.fillText(text, rx, y);
      ctx.restore();
    };
    title('2048', 96, 34, '#FFD46A');

    const score = this.data.score || 0;
    const best = this.data.bestScore || 0;
    if (score > 0) {
      title('SCORE', 160, 14, '#F6DDB0');
      title(String(score), 190, 26, '#FFF2DA');
      title('BEST', 240, 14, '#F6DDB0');
      title(String(best), 270, 26, '#FFD46A');
    } else {
      title('滑动合并', 190, 18, '#FFF2DA');
      title('数字翻倍', 220, 18, '#FFF2DA');
    }
    title('来挑战我', 320, 13, '#F6DDB0');
  },

  // ─── 音频（Web Audio 合成，不支持时静默降级）───────────

  _initAudio() {
    try {
      this._ac = wx.createWebAudioContext();
    } catch (e) {
      this._ac = null;
    }
    // 木头敲击声(utils/wood-sfx.js),播的时候按块值变调
    this._sfxPlayer = this._ac ? createWoodPlayer(this._ac, ['move', 'lock', 'rotate', 'win', 'crash']) : null;
  },

  _woodSfx(name, rate, vol) {
    if (this._sfxPlayer) this._sfxPlayer.play(name, rate, vol);
  },

  // 合并:两块木头撞在一起,块越大音越高越响
  _sfxMerge(v) {
    if (!this._ac) return;
    const level = Math.min(11, Math.round(Math.log2(v)));   // 2→1 … 2048→11
    this._woodSfx('lock', 0.85 + level * 0.05, 0.9);
    this._woodSfx('rotate', 0.9 + level * 0.06, 0.5);
  },

  // 滑动:木块在木板上推过去
  _sfxSlide() {
    if (!this._ac) return;
    this._woodSfx('move', 0.8, 0.9);
  },

  // 拼出 2048:木琴琶音
  _sfxWin() {
    this._woodSfx('win', 1, 1);
  },

  // 格子满了:木块撞碎,压低一点音量
  _sfxOver() {
    this._woodSfx('crash', 1, 0.7);
  },
});
