// ─── 物理常量 ───────────────────────────────────────────
const GRAVITY    = 0.65;
const JUMP_V1    = -15;   // 一段跳初速度
const JUMP_V2    = -12;   // 二段跳初速度
const SPEED_INIT = 5;
const SPEED_MAX  = 16;
const GROUND_R   = 0.68;  // 地面在屏幕高度的比例

// 玩家碰撞框尺寸
const PW = 40;
const PH = 40;

// ─── 玩家像素图案（像素机器人小人，精确还原参考图）──
// 5列 × 7行，PS=6px，绘制偏移 (POX=5) 居中于 40px 宽度
// 外形：耳朵 → 平顶头（含眼睛）→ 身体 → 四条腿（两对）
const PS  = 6;
const POX = 5;
const POY = 10;  // 视觉高度30px < PH=40，下移10px使脚贴地

const PL_BODY = [
  [0,0],[0,1],[0,2],[0,3],[0,4],             // 头顶（全宽，不收窄）
  [1,0],[1,1],[1,2],[1,3],[1,4],             // 头部（含眼睛位置）
  [2,0],[2,1],[2,2],[2,3],[2,4],             // 上身
  [3,0],[3,1],[3,2],[3,3],[3,4],             // 下身
];
// 眼睛（深色小方块嵌入头部 row 1）
const PL_EYES = [[1,1],[1,3]];
// 高光（左上区域）
const PL_HL = [[0,0],[0,1],[1,0]];
// 四条腿（两对）：左对 cols 0-1，右对 cols 3-4，中间 col 2 留空
// 动画：左脚 ↔ 右脚交替（简洁跑步感）
const PL_LEGS_A = [[4,0],[4,1]];   // 左脚
const PL_LEGS_B = [[4,3],[4,4]];   // 右脚

// ─── 月亮像素（C 形，右上角装饰）──────────────────────
const MB = 15;  // 月亮像素块大小（更大更醒目）
const MOON_C = [
  [0,1],[0,2],[0,3],[0,4],
  [1,0],[1,1],[1,2],[1,3],[1,4],[1,5],
  [2,0],[2,1],
  [3,0],[3,1],
  [4,0],[4,1],[4,2],[4,3],[4,4],[4,5],
  [5,1],[5,2],[5,3],[5,4],
];
const MOON_HL = [[0,1],[0,2],[1,0],[1,1],[2,0]];

// ─── 云朵像素（3行×5列，像素块风格）────────────────────
const CLOUD_PIXELS = [
  [0,1],[0,2],[0,3],
  [1,0],[1,1],[1,2],[1,3],[1,4],
  [2,0],[2,1],[2,2],[2,3],[2,4],
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
        this._initClouds();
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

  onShareAppMessage() {
    const score = this.data.score || 0;
    const best  = this.data.bestScore || 0;
    const result = {
      title: `我在 Claude 快跑中得了 ${score} 分！最高 ${best} 分，来挑战我～`,
      path: '/pages/runner/index'
    };
    if (this._shareImagePath) result.imageUrl = this._shareImagePath;
    return result;
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
    this._speed     = Math.min(SPEED_MAX, SPEED_INIT + this._frame * 0.005);
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
      const r = Math.random();
      if (r < 0.22) {
        // 飞行 Bug：悬浮在空中，玩家需要选择跳过或低头躲
        const h = 22, w = 28;
        this._obstacles.push({
          x: this._W + 10,
          y: this._groundY - PH - 36,
          w, h, tall: false, flying: true
        });
      } else {
        const tall = r < 0.55;
        const h = tall ? 50 : 26;
        const w = tall ? 28 : 36;
        this._obstacles.push({
          x: this._W + 10,
          y: this._groundY - h,
          w, h, tall, flying: false
        });
      }
      const gap = Math.max(38, 80 - this._frame * 0.018);
      this._nextObstIn = gap + Math.random() * 40;
    }

    // 移动云朵（速度比地面慢，营造视差效果）
    for (const cl of (this._clouds || [])) {
      cl.x -= this._speed * 0.15;
      if (cl.x + cl.sz * 5 < 0) {
        cl.x = this._W + Math.random() * 60;
        cl.y = this._groundY * (0.1 + Math.random() * 0.35);
      }
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

    // 分数（左侧，避免与右上角月亮重叠）
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = 'bold 15px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(String(this._scoreVal).padStart(5, '0'), 16, 32);
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

    // 月亮（C 形，右上角）
    this._drawMoon();

    // 云朵
    this._drawClouds();

    // 地面
    ctx.fillStyle = '#252540';
    ctx.fillRect(0, gY, W, H - gY);

    ctx.fillStyle = '#4A6FA5';
    ctx.fillRect(0, gY, W, 2);
  },

  _drawPlayer() {
    const { _ctx: ctx, _player: p } = this;
    const bx = p.x + POX;
    const by = p.y + POY;
    const legSet = Math.floor(this._frame / 8) % 2 === 0 ? PL_LEGS_A : PL_LEGS_B;

    // 主体（橙色）
    ctx.fillStyle = '#E8873A';
    PL_BODY.forEach(([r, c]) => ctx.fillRect(bx + c*PS, by + r*PS, PS, PS));

    // 侧耳：头部中间左右各凸出 1 格（row 1，不在顶部）
    ctx.fillRect(bx - PS,     by + PS, PS, PS);   // 左耳
    ctx.fillRect(bx + 5 * PS, by + PS, PS, PS);   // 右耳

    // 高光（左上角亮橙）
    ctx.fillStyle = '#F5A855';
    PL_HL.forEach(([r, c]) => ctx.fillRect(bx + c*PS, by + r*PS, PS, PS));

    // 眼睛（深色小方块）
    ctx.fillStyle = '#1A1A2E';
    PL_EYES.forEach(([r, c]) => ctx.fillRect(bx + c*PS + 1, by + r*PS + 1, PS - 2, PS - 2));

    // 跑步腿动画（深橙色）
    ctx.fillStyle = '#C86820';
    legSet.forEach(([r, c]) => ctx.fillRect(bx + c*PS, by + r*PS, PS, PS));
  },

  _drawMoon() {
    const { _ctx: ctx, _W: W } = this;
    // 月亮右侧稍微出屏，保留 4 列可见（col 0-3），col 4-5 裁切掉
    const mx = W - 4 * MB;
    const my = 14;

    ctx.fillStyle = '#C8A96E';
    MOON_C.forEach(([r, c]) => ctx.fillRect(mx + c*MB, my + r*MB, MB, MB));

    ctx.fillStyle = '#E8D5A0';
    MOON_HL.forEach(([r, c]) => ctx.fillRect(mx + c*MB, my + r*MB, MB, MB));
  },

  _drawClouds() {
    const { _ctx: ctx } = this;
    ctx.fillStyle = '#2C2C50';
    for (const cl of (this._clouds || [])) {
      CLOUD_PIXELS.forEach(([r, c]) => {
        ctx.fillRect(cl.x + c * cl.sz, cl.y + r * cl.sz, cl.sz, cl.sz);
      });
    }
  },

  _drawObstacle(ob) {
    const { _ctx: ctx } = this;
    const S = 4;
    const bx = ob.x + Math.floor((ob.w - 6 * S) / 2);

    if (ob.flying) {
      // 飞行 Bug：蓝色，带小翅膀（在Bug上方画两个像素翅膀）
      const by = ob.y;
      // 翅膀
      ctx.fillStyle = '#60C0FF';
      ctx.fillRect(bx,           by,     S * 2, S);
      ctx.fillRect(bx + S * 4,   by,     S * 2, S);
      this._drawBugSprite(ctx, bx, by + S, S, '#4A9EFF', '#B3D9FF');
    } else if (ob.tall) {
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

    // 用离屏 canvas 画分享卡截图，不污染主游戏画面
    this._captureShareImage();

    this.setData({
      gameState:  'over',
      score:      this._scoreVal,
      bestScore:  this.bestScore
    });
  },

  _captureShareImage() {
    const dpr   = this._dpr;
    const W     = this._W;
    const score = this._scoreVal;
    const best  = this.bestScore;

    // 离屏 canvas：只画分享卡，不碰主游戏 canvas
    const cw = Math.round(W * 0.86);
    const ch = 190;
    const offscreen = wx.createOffscreenCanvas({
      type: '2d',
      width:  Math.round(cw * dpr),
      height: Math.round(ch * dpr)
    });
    const ctx = offscreen.getContext('2d');
    ctx.scale(dpr, dpr);

    // 卡片背景 + 边框
    ctx.fillStyle = 'rgba(28,28,58,0.96)';
    ctx.fillRect(0, 0, cw, ch);
    ctx.strokeStyle = '#FF6B6B';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, cw - 2, ch - 2);

    ctx.textAlign = 'center';

    // GAME OVER
    ctx.fillStyle = '#FF6B6B';
    ctx.font = 'bold 26px monospace';
    ctx.fillText('GAME  OVER', cw / 2, 44);

    // SCORE
    ctx.fillStyle = '#6A6A9A';
    ctx.font = '11px monospace';
    ctx.fillText('S C O R E', cw / 2, 70);
    ctx.fillStyle = '#E8873A';
    ctx.font = 'bold 46px monospace';
    ctx.fillText(String(score), cw / 2, 116);

    // BEST
    ctx.fillStyle = '#6A6A9A';
    ctx.font = '11px monospace';
    ctx.fillText('B E S T', cw / 2, 142);
    ctx.fillStyle = '#F5C842';
    ctx.font = 'bold 28px monospace';
    ctx.fillText(String(best), cw / 2, 174);

    wx.canvasToTempFilePath({
      canvas: offscreen,
      success: res => { this._shareImagePath = res.tempFilePath; }
    });
  },

  // ─── 工具 ──────────────────────────────────────────────

  _initStars() {
    this._stars = Array.from({ length: 40 }, () => ({
      x:  Math.random() * this._W,
      y:  Math.random() * this._groundY * 0.88,
      sz: Math.random() < 0.2 ? 2 : 1
    }));
  },

  _initClouds() {
    const gY = this._groundY;
    this._clouds = [
      { x: this._W * 0.15, y: gY * 0.20, sz: 8 },
      { x: this._W * 0.55, y: gY * 0.12, sz: 7 },
      { x: this._W * 0.85, y: gY * 0.32, sz: 8 },
    ];
  }
});
