// ─── 物理常量 ───────────────────────────────────────────
const GRAVITY    = 0.65;
const JUMP_V1    = -15;   // 一段跳初速度
const JUMP_V2    = -12;   // 二段跳初速度
const SPEED_INIT = 4;
const SPEED_MAX  = 11;
const GROUND_R   = 0.78;  // 地面在屏幕高度的比例

// 玩家像素尺寸 (8×8 grid, S=5)
const PS = 5;
const PW = 8 * PS;  // 40px
const PH = 8 * PS;  // 40px

// ─── 玩家像素图案 ────────────────────────────────────────
// 菱形轮廓：每行 [起始列, 结束列]
const BODY_ROWS = [
  [2, 5], // row 0
  [1, 6], // row 1
  [0, 7], // row 2
  [0, 7], // row 3
  [0, 7], // row 4
  [0, 7], // row 5
  [1, 6], // row 6
  [2, 5], // row 7
];
// 高光像素（亮橙，左上角）
const BODY_HIGHLIGHT = [[0,2],[0,3],[1,1],[1,2],[2,0],[2,1],[3,0]];
// >> 符号（深色）
const BODY_CHEVRON = [
  [2,2],[3,3],[4,2],  // 第一个 >
  [2,4],[3,5],[4,4],  // 第二个 >
];

// ─── Bug 像素图案（6列×5行，底部带脚）──────────────────
const BUG_PIXELS = [
  [0,1],[0,4],                               // 触角
  [1,1],[1,2],[1,3],[1,4],                   // 头
  [2,0],[2,1],[2,2],[2,3],[2,4],[2,5],       // 身体上
  [3,0],[3,1],[3,2],[3,3],[3,4],[3,5],       // 身体下
  [4,0],[4,2],[4,3],[4,5],                   // 腿
];
const BUG_EYES = [[1,2],[1,3]];

// ────────────────────────────────────────────────────────

Page({
  data: {
    gameState: 'idle',   // 'idle' | 'playing' | 'over'
    score: 0,
    bestScore: 0
  },

  onLoad() {
    this.bestScore = wx.getStorageSync('runner_best') || 0;
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
        const w    = res[0].width;
        const h    = res[0].height;

        node.width  = Math.round(w * this._dpr);
        node.height = Math.round(h * this._dpr);

        const ctx = node.getContext('2d');
        ctx.scale(this._dpr, this._dpr);

        this._canvas  = node;
        this._ctx     = ctx;
        this._W       = w;
        this._H       = h;
        this._groundY = Math.round(h * GROUND_R);

        this._initStars();
        this._drawBg();
      });
  },

  onUnload() {
    this._stopLoop();
  },

  onHide() {
    this._stopLoop();
  },

  onShow() {
    if (this.data.gameState === 'playing') {
      this._loop();
    }
  },

  // ─── 用户交互 ──────────────────────────────────────────

  onTap() {
    const state = this.data.gameState;
    if (state === 'idle') {
      this._startGame();
    } else if (state === 'playing') {
      this._jump();
    }
  },

  onRetry() {
    this._startGame();
  },

  // ─── 游戏控制 ──────────────────────────────────────────

  _startGame() {
    if (!this._canvas) return;
    this._stopLoop();
    this._dead = false;

    this._player = {
      x: Math.round(this._W * 0.15),
      y: this._groundY - PH,
      vy: 0,
      jumps: 0  // 0=地面, 1=一段跳, 2=二段跳已用
    };

    this._obstacles   = [];
    this._speed       = SPEED_INIT;
    this._frame       = 0;
    this._bgOffset    = 0;
    this._nextObstIn  = 90;
    this._scoreVal    = 0;

    this.setData({ gameState: 'playing', score: 0 });
    this._loop();
  },

  _stopLoop() {
    if (this._raf && this._canvas) {
      this._canvas.cancelAnimationFrame(this._raf);
      this._raf = null;
    }
  },

  _jump() {
    const p = this._player;
    if (!p || p.jumps >= 2) return;
    p.vy = p.jumps === 0 ? JUMP_V1 : JUMP_V2;
    p.jumps++;
  },

  // ─── 主循环 ────────────────────────────────────────────

  _loop() {
    this._update();
    if (this._dead) return;
    this._draw();
    this._raf = this._canvas.requestAnimationFrame(() => this._loop());
  },

  // ─── 物理与逻辑更新 ────────────────────────────────────

  _update() {
    this._frame++;
    this._speed     = Math.min(SPEED_MAX, SPEED_INIT + this._frame * 0.0028);
    this._bgOffset  = (this._bgOffset + this._speed) % 80;
    this._scoreVal  = Math.floor(this._frame / 8);

    if (this._frame % 10 === 0) {
      this.setData({ score: this._scoreVal });
    }

    // 玩家物理
    const p = this._player;
    p.vy += GRAVITY;
    p.y  += p.vy;
    if (p.y >= this._groundY - PH) {
      p.y    = this._groundY - PH;
      p.vy   = 0;
      p.jumps = 0;
    }

    // 生成障碍
    this._nextObstIn--;
    if (this._nextObstIn <= 0) {
      const tall = Math.random() < 0.3;
      const h = tall ? 46 : 26;
      const w = tall ? 30 : 36;
      this._obstacles.push({
        x: this._W + 10,
        y: this._groundY - h,
        w, h, tall
      });
      const gap = Math.max(48, 85 - this._frame * 0.016);
      this._nextObstIn = gap + Math.random() * 45;
    }

    // 移动障碍
    this._obstacles = this._obstacles.filter(ob => {
      ob.x -= this._speed;
      return ob.x + ob.w > -10;
    });

    // 碰撞检测（留有宽容边距）
    const hx = p.x + 5, hy = p.y + 4, hr = p.x + PW - 5, hb = p.y + PH - 4;
    for (const ob of this._obstacles) {
      if (hx < ob.x + ob.w - 4 &&
          hr > ob.x + 4 &&
          hy < ob.y + ob.h - 2 &&
          hb > ob.y + 2) {
        this._gameOver();
        return;
      }
    }
  },

  // ─── 渲染 ──────────────────────────────────────────────

  _draw() {
    const { _ctx: ctx, _W: W, _H: H, _groundY: gY } = this;

    // 背景
    this._drawBg();

    // 移动地面虚线
    ctx.fillStyle = '#3A3A5E';
    for (let x = -(this._bgOffset % 80); x < W + 80; x += 80) {
      ctx.fillRect(x, gY + 6, 36, 2);
    }

    // 障碍（Bug）
    for (const ob of this._obstacles) {
      this._drawObstacle(ob);
    }

    // 玩家
    this._drawPlayer();

    // 分数
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = 'bold 15px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(String(this._scoreVal).padStart(5, '0'), W - 16, 32);
  },

  _drawBg() {
    const { _ctx: ctx, _W: W, _H: H, _groundY: gY } = this;

    ctx.fillStyle = '#1A1A2E';
    ctx.fillRect(0, 0, W, H);

    // 星星
    ctx.fillStyle = '#5A5A8A';
    for (const s of (this._stars || [])) {
      ctx.fillRect(s.x, s.y, s.sz, s.sz);
    }

    // 地面
    ctx.fillStyle = '#252540';
    ctx.fillRect(0, gY, W, H - gY);

    ctx.fillStyle = '#4A6FA5';
    ctx.fillRect(0, gY, W, 2);
  },

  _drawPlayer() {
    const { _ctx: ctx, _player: p } = this;
    const { x, y } = p;

    // 主体（橙色）
    ctx.fillStyle = '#E8873A';
    BODY_ROWS.forEach(([s, e], r) => {
      ctx.fillRect(x + s * PS, y + r * PS, (e - s + 1) * PS, PS);
    });

    // 高光（亮橙）
    ctx.fillStyle = '#F5A855';
    BODY_HIGHLIGHT.forEach(([r, c]) => {
      ctx.fillRect(x + c * PS, y + r * PS, PS, PS);
    });

    // >> 符号（深色）
    ctx.fillStyle = '#1A1A2E';
    BODY_CHEVRON.forEach(([r, c]) => {
      ctx.fillRect(x + c * PS, y + r * PS, PS, PS);
    });
  },

  _drawObstacle(ob) {
    const { _ctx: ctx } = this;
    const S = 4;
    const bx = ob.x + Math.floor((ob.w - 6 * S) / 2);

    if (ob.tall) {
      // 高障碍：上面紫色Bug + 下面红色Bug
      this._drawBugSprite(ctx, bx, ob.y,          S, '#A855F7', '#D4AAFF');
      this._drawBugSprite(ctx, bx, ob.y + 5 * S,  S, '#FF6B6B', '#FFB3B3');
    } else {
      this._drawBugSprite(ctx, bx, ob.y + 2, S, '#FF6B6B', '#FFB3B3');
    }
  },

  _drawBugSprite(ctx, bx, by, S, bodyColor, eyeColor) {
    ctx.fillStyle = bodyColor;
    BUG_PIXELS.forEach(([r, c]) => {
      ctx.fillRect(bx + c * S, by + r * S, S, S);
    });
    ctx.fillStyle = eyeColor;
    BUG_EYES.forEach(([r, c]) => {
      ctx.fillRect(bx + c * S, by + r * S, S, S);
    });
  },

  // ─── 游戏结束 ──────────────────────────────────────────

  _gameOver() {
    this._dead = true;
    this._stopLoop();

    if (this._scoreVal > this.bestScore) {
      this.bestScore = this._scoreVal;
      wx.setStorageSync('runner_best', this.bestScore);
    }

    this.setData({
      gameState:  'over',
      score:      this._scoreVal,
      bestScore:  this.bestScore
    });
  },

  // ─── 工具 ──────────────────────────────────────────────

  _initStars() {
    this._stars = Array.from({ length: 40 }, () => ({
      x:  Math.random() * this._W,
      y:  Math.random() * this._groundY * 0.88,
      sz: Math.random() < 0.2 ? 2 : 1
    }));
  }
});
