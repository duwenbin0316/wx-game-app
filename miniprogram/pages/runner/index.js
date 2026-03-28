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

// 月亮改用弧线绘制，不再用像素块常量

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
        this._initGroundDeco();
        this._initFlora();
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

    // 移动地面碎石
    for (const d of (this._groundDeco || [])) {
      d.x -= this._speed * 0.7;
      if (d.x < -4) {
        d.x = this._W + Math.random() * 80;
        d.y = this._groundY + 4 + Math.random() * 10;
        d.w = 1 + Math.floor(Math.random() * 3);
        d.h = 1 + Math.floor(Math.random() * 2);
      }
    }

    // 移动花草
    for (const f of (this._flora || [])) {
      f.x -= this._speed * 0.85;
      if (f.x < -12) {
        f.x = this._W + 10 + Math.random() * 60;
        f.type = Math.random() < 0.5 ? 'grass' : 'flower';
        f.color = f.type === 'flower'
          ? (Math.random() < 0.5 ? '#E87090' : '#E8D060')
          : '#3A7A4A';
      }
    }

    // 移动远景建筑轮廓（极慢视差）
    for (const b of (this._buildings || [])) {
      b.x -= this._speed * 0.08;
      if (b.x + b.w < 0) b.x = this._W + Math.random() * 40;
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

    // 远景建筑轮廓（地面线上方，极暗色，视差层）
    ctx.fillStyle = '#1F1F38';
    for (const b of (this._buildings || [])) {
      ctx.fillRect(b.x, gY - b.h, b.w, b.h);
      // 楼顶小窗格
      if (b.h > 20) {
        ctx.fillStyle = '#252548';
        for (let wy = gY - b.h + 4; wy < gY - 4; wy += 8) {
          for (let wx = b.x + 3; wx < b.x + b.w - 3; wx += 7) {
            ctx.fillRect(wx, wy, 3, 4);
          }
        }
        ctx.fillStyle = '#1F1F38';
      }
    }

    // ── 地下区域 ──────────────────────────────────────
    // 土层：从地面往下分三段，略有色差
    ctx.fillStyle = '#1D1D34';
    ctx.fillRect(0, gY, W, 18);
    ctx.fillStyle = '#1B1B2E';
    ctx.fillRect(0, gY + 18, W, 22);
    ctx.fillStyle = '#191828';
    ctx.fillRect(0, gY + 40, W, H - gY - 40);

    // 岩块
    ctx.fillStyle = '#252438';
    for (const r of (this._oreRocks || [])) {
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }
    // 蓝矿簇
    ctx.fillStyle = 'rgba(74,111,165,0.50)';
    for (const o of (this._oreBlue || [])) {
      ctx.fillRect(o.x, o.y, o.w, o.h);
    }
    // 紫矿簇
    ctx.fillStyle = 'rgba(130,80,200,0.40)';
    for (const o of (this._orePurple || [])) {
      ctx.fillRect(o.x, o.y, o.w, o.h);
    }
    // 暖橙矿点
    ctx.fillStyle = 'rgba(200,120,50,0.38)';
    for (const o of (this._oreWarm || [])) {
      ctx.fillRect(o.x, o.y, o.w, o.h);
    }

    // 花草（地面线上方）
    this._drawFlora();

    // 地面线
    ctx.fillStyle = '#4A6FA5';
    ctx.fillRect(0, gY, W, 2);

    // 地面线下方高亮细条（增加厚重感）
    ctx.fillStyle = '#2A2A4A';
    ctx.fillRect(0, gY + 2, W, 3);

    // 地面碎石（地表）
    ctx.fillStyle = '#2E2E52';
    for (const d of (this._groundDeco || [])) {
      ctx.fillRect(d.x, d.y, d.w, d.h);
    }
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
    const cx = W - 48;
    const cy = 58;
    const R  = 32;

    // 外层光晕（冷蓝调，极淡）
    ctx.fillStyle = 'rgba(160, 190, 240, 0.05)';
    ctx.beginPath(); ctx.arc(cx, cy, R + 20, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(160, 190, 240, 0.08)';
    ctx.beginPath(); ctx.arc(cx, cy, R + 10, 0, Math.PI * 2); ctx.fill();

    // 月牙：冷银蓝白，与背景蓝系协调
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#B8CCE8';
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1A1A2E';
    ctx.beginPath(); ctx.arc(cx + R * 0.52, cy - R * 0.08, R * 0.80, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // 月牙左上高光小圆（冷白）
    ctx.fillStyle = 'rgba(220, 235, 255, 0.50)';
    ctx.beginPath(); ctx.arc(cx - R * 0.28, cy - R * 0.32, R * 0.16, 0, Math.PI * 2); ctx.fill();
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

    // 离屏 canvas：正方形，避免微信缩略图裁切
    const cw = 240;
    const ch = 240;
    const offscreen = wx.createOffscreenCanvas({
      type: '2d',
      width:  Math.round(cw * dpr),
      height: Math.round(ch * dpr)
    });
    const ctx = offscreen.getContext('2d');
    ctx.scale(dpr, dpr);

    // 卡片背景 + 边框
    ctx.fillStyle = '#1A1A2E';
    ctx.fillRect(0, 0, cw, ch);
    ctx.strokeStyle = '#FF6B6B';
    ctx.lineWidth = 3;
    ctx.strokeRect(2, 2, cw - 4, ch - 4);

    ctx.textAlign = 'center';

    // GAME OVER
    ctx.fillStyle = '#FF6B6B';
    ctx.font = 'bold 26px monospace';
    ctx.fillText('GAME  OVER', cw / 2, 42);

    // SCORE
    ctx.fillStyle = '#6A6A9A';
    ctx.font = '12px monospace';
    ctx.fillText('S C O R E', cw / 2, 66);
    ctx.fillStyle = '#E8873A';
    ctx.font = 'bold 46px monospace';
    ctx.fillText(String(score), cw / 2, 116);

    // BEST
    ctx.fillStyle = '#6A6A9A';
    ctx.font = '12px monospace';
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
  },

  _initGroundDeco() {
    const W  = this._W;
    const gY = this._groundY;
    const H  = this._H;
    const ug = H - gY;  // 地下区域高度

    // 地面碎石：随机分布在地面上
    this._groundDeco = Array.from({ length: 28 }, () => ({
      x: Math.random() * W * 1.5,
      y: gY + 4 + Math.random() * 10,
      w: 1 + Math.floor(Math.random() * 3),
      h: 1 + Math.floor(Math.random() * 2)
    }));

    // 地下岩块：少量大块，营造层次而不凌乱
    this._oreRocks = Array.from({ length: 6 }, () => ({
      x: Math.random() * W,
      y: gY + 10 + Math.random() * (ug - 16),
      w: 8 + Math.floor(Math.random() * 14),
      h: 4 + Math.floor(Math.random() * 6)
    }));
    // 蓝矿簇：3个小簇，每簇2-3个相邻像素
    this._oreBlue = this._makeOreClusters(3, W, gY, ug);
    // 紫矿簇：2个小簇
    this._orePurple = this._makeOreClusters(2, W, gY, ug);
    // 暖橙：仅2个点
    this._oreWarm = Array.from({ length: 2 }, () => ({
      x: Math.random() * W,
      y: gY + 12 + Math.random() * (ug - 18),
      w: 3, h: 3
    }));
    // 远景建筑像素轮廓（地面线上方的低矮剪影）
    this._buildings = [];
    let bx = 0;
    while (bx < W * 1.8) {
      const bw = 18 + Math.floor(Math.random() * 30);
      const bh = 12 + Math.floor(Math.random() * 28);
      this._buildings.push({ x: bx, w: bw, h: bh });
      bx += bw + 4 + Math.floor(Math.random() * 12);
    }
  },

  _initFlora() {
    const W = this._W;
    const gY = this._groundY;
    this._flora = Array.from({ length: 14 }, (_, i) => {
      const type = Math.random() < 0.5 ? 'grass' : 'flower';
      return {
        x: (W / 14) * i + Math.random() * 30,
        type,
        color: type === 'flower'
          ? (Math.random() < 0.5 ? '#E87090' : '#E8D060')
          : '#3A7A4A',
        gY
      };
    });
  },

  _drawFlora() {
    const ctx = this._ctx;
    for (const f of (this._flora || [])) {
      const bx = Math.round(f.x);
      const by = f.gY;  // 地面线 y
      if (f.type === 'grass') {
        // 草丛：3根草茎，高度2-4px，深绿
        ctx.fillStyle = '#3A7A4A';
        ctx.fillRect(bx,     by - 6, 2, 6);
        ctx.fillRect(bx + 3, by - 4, 2, 4);
        ctx.fillRect(bx + 6, by - 7, 2, 7);
        // 草尖亮一点
        ctx.fillStyle = '#5AAA6A';
        ctx.fillRect(bx,     by - 7, 2, 2);
        ctx.fillRect(bx + 3, by - 5, 2, 2);
        ctx.fillRect(bx + 6, by - 8, 2, 2);
      } else {
        // 小花：茎 + 花头
        ctx.fillStyle = '#3A7A4A';
        ctx.fillRect(bx + 2, by - 6, 2, 6);  // 茎
        ctx.fillStyle = f.color;
        ctx.fillRect(bx,     by - 8, 2, 2);  // 左瓣
        ctx.fillRect(bx + 4, by - 8, 2, 2);  // 右瓣
        ctx.fillRect(bx + 2, by - 10, 2, 2); // 上瓣
        ctx.fillRect(bx + 2, by - 7,  2, 2); // 下瓣
        ctx.fillStyle = '#FFF8D0';            // 花心
        ctx.fillRect(bx + 2, by - 8,  2, 2);
      }
    }
  },

  // 生成 n 个紧凑矿簇，每簇由 2-4 个相邻小块组成
  _makeOreClusters(n, W, gY, ug) {
    const result = [];
    for (let i = 0; i < n; i++) {
      const cx = Math.random() * W;
      const cy = gY + 12 + Math.random() * (ug - 20);
      const count = 2 + Math.floor(Math.random() * 3);
      for (let j = 0; j < count; j++) {
        result.push({
          x: cx + (Math.random() - 0.5) * 10,
          y: cy + (Math.random() - 0.5) * 8,
          w: 2 + Math.floor(Math.random() * 3),
          h: 2 + Math.floor(Math.random() * 3)
        });
      }
    }
    return result;
  }
});
