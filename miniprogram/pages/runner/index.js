// ─── 物理常量 ───────────────────────────────────────────
const GRAVITY    = 0.65;
const JUMP_V1    = -15;   // 一段跳初速度
const JUMP_V2    = -12;   // 二段跳初速度
const SPEED_INIT = 5;
const SPEED_MAX  = 16;
const GROUND_R   = 0.68;  // 地面在屏幕高度的比例

// 玩家碰撞框尺寸
const PW = 32;
const PH = 32;

// ─── 玩家造型：共享 Clawd 精灵（全小程序统一，见 utils/clawd.js）──
const { GRID_COLS, GRID_ROWS, drawClawd } = require('../../utils/clawd');
const PLAYER_PS = 1.3;  // 单格边长：视觉约 31×26px，居中于 32×32 碰撞框


// ─── Bug 像素图案（6列×5行，底部带脚）──────────────────
const BUG_PIXELS = [
  [0,1],[0,4],                               // 触角
  [1,1],[1,2],[1,3],[1,4],                   // 头
  [2,0],[2,1],[2,2],[2,3],[2,4],[2,5],       // 身体上
  [3,0],[3,1],[3,2],[3,3],[3,4],[3,5],       // 身体下
  [4,0],[4,2],[4,3],[4,5],                   // 腿
];
const BUG_EYES = [[1,2],[1,3]];

// ─── 收集物与反馈 ────────────────────────────────────────
const COIN_SCORE    = 5;     // 单个金币加分
const COMBO_WINDOW  = 90;    // 连击维持帧数
const MILESTONE     = 250;   // 里程碑分数间隔
const INVULN_FRAMES = 60;    // 护盾破碎后的无敌帧

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
        this._initBuildings();
        this._initGroundDeco();
        this._initUnderground();
        this._initFlora();
        this._initAudio();
        this._drawBg();
      });
  },

  onUnload() {
    this._stopLoop();
    this._stopBGM();
  },

  onHide() {
    this._stopLoop();
    this._stopBGM();
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
    } else if (state === 'playing' && !this._dying) {
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

    // 收集物 / 反馈系统
    this._coins      = [];
    this._items      = [];
    this._parts      = [];
    this._labels     = [];
    this._bonus      = 0;
    this._combo      = 0;
    this._comboTimer = 0;
    this._shield     = false;
    this._invuln     = 0;
    this._milestone  = MILESTONE;
    this._nextCoinIn = 130;
    this._nextItemIn = 650;
    this._dying      = false;
    this._dieFrame   = 0;
    this._shake      = 0;
    this._flash      = 0;
    this._bgmBar     = 0;

    this.setData({ gameState: 'playing', score: 0 });
    this._startBGM();
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
    const isDouble = p.jumps === 1;
    p.vy = isDouble ? JUMP_V2 : JUMP_V1;
    p.jumps++;
    this._sfxJump(isDouble);
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
    if (this._dying) {
      this._updateDying();
      return;
    }

    this._frame++;
    this._speed     = Math.min(SPEED_MAX, SPEED_INIT + this._frame * 0.005);
    this._bgOffset  = (this._bgOffset + this._speed) % 80;
    this._scoreVal  = Math.floor(this._frame / 8) + this._bonus;

    if (this._frame % 10 === 0) {
      this.setData({ score: this._scoreVal });
    }

    // 里程碑激励
    if (this._scoreVal >= this._milestone) {
      this._addLabel(`${this._milestone} 分!`, '#F5C842', true);
      this._sfxMilestone();
      this._milestone += MILESTONE;
    }

    // 玩家物理
    const p = this._player;
    p.vy += GRAVITY;
    p.y  += p.vy;
    if (p.y >= this._groundY - PH) {
      // 从空中落地扬起尘土
      if (p.jumps > 0 && p.vy > 3) {
        this._burst(p.x + PW / 2, this._groundY - 2, '#5A5A7A', 6, 3);
      }
      p.y    = this._groundY - PH;
      p.vy   = 0;
      p.jumps = 0;
    }
    // 奔跑时脚下偶尔带起小尘点
    if (p.jumps === 0 && this._frame % 9 === 0) {
      this._burst(p.x + 4, this._groundY - 2, '#44445F', 1, 1.2);
    }

    // 生成障碍(带组合模式)
    this._nextObstIn--;
    if (this._nextObstIn <= 0) {
      this._spawnObstacles();
      const gap = Math.max(45, 90 - this._frame * 0.018);
      this._nextObstIn = gap + Math.random() * 40;
    }

    // 生成金币与咖啡
    if (--this._nextCoinIn <= 0) {
      this._spawnCoins();
      this._nextCoinIn = 150 + Math.random() * 160;
    }
    if (--this._nextItemIn <= 0) {
      this._items.push({ x: this._W + 20, y: this._groundY - 64 });
      this._nextItemIn = 900 + Math.random() * 700;
    }

    // 移动云朵（速度比地面慢，营造视差效果）
    for (const cl of (this._clouds || [])) {
      cl.x -= this._speed * 0.15;
      if (cl.x + cl.r * 3 < 0) {
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

    // 金币:移动 + 拾取
    const pcx = p.x + PW / 2, pcy = p.y + PH / 2;
    this._coins = this._coins.filter(c => {
      c.x -= this._speed;
      if (c.x < -20) return false;
      if (Math.abs(c.x - pcx) < 18 && Math.abs(c.y - pcy) < 24) {
        this._collectCoin(c);
        return false;
      }
      return true;
    });

    // 咖啡:移动 + 拾取
    this._items = this._items.filter(it => {
      it.x -= this._speed;
      if (it.x < -24) return false;
      if (Math.abs(it.x - pcx) < 22 && Math.abs(it.y - pcy) < 26) {
        this._collectItem(it);
        return false;
      }
      return true;
    });

    // 连击窗口倒计时
    if (this._comboTimer > 0 && --this._comboTimer === 0) {
      this._combo = 0;
    }
    if (this._invuln > 0) this._invuln--;

    this._updateParticles();
    this._updateLabels();

    // 碰撞检测(留有宽容边距;护盾破碎后短暂无敌)
    if (this._invuln <= 0) {
      const hx = p.x + 5, hy = p.y + 4, hr = p.x + PW - 5, hb = p.y + PH - 4;
      for (const ob of this._obstacles) {
        if (hx < ob.x + ob.w - 4 &&
            hr > ob.x + 4 &&
            hy < ob.y + ob.h - 2 &&
            hb > ob.y + 2) {
          if (this._shield) {
            this._shield = false;
            this._invuln = INVULN_FRAMES;
            this._shake  = 4;
            this._burst(pcx, pcy, '#60C0FF', 12, 4);
            this._addLabel('护盾抵挡!', '#60C0FF', true);
            this._sfxShieldBreak();
          } else {
            this._startDying();
            return;
          }
          break;
        }
      }
    }
  },

  // ─── 障碍与收集物生成 ─────────────────────────────────

  _spawnObstacles() {
    const gY = this._groundY;
    const baseX = this._W + 10;
    const push = (x, y, w, h, tall, flying) =>
      this._obstacles.push({ x, y, w, h, tall, flying });
    const r = Math.random();

    if (r < 0.18) {
      // 飞行 Bug:悬空,起跳时才有威胁
      push(baseX, gY - PH - 28, 22, 16, false, true);
    } else if (r < 0.48) {
      push(baseX, gY - 38, 22, 38, true, false);     // 高 Bug
    } else if (r < 0.74) {
      push(baseX, gY - 20, 28, 20, false, false);    // 矮 Bug
    } else if (r < 0.9 && this._frame > 700) {
      // 双矮 Bug:间距允许落地再跳,也可二段跳一口气跨过
      push(baseX,       gY - 20, 28, 20, false, false);
      push(baseX + 116, gY - 20, 28, 20, false, false);
    } else {
      // 高 Bug + 后随飞行 Bug:跳早了会撞上后面那只
      push(baseX, gY - 38, 22, 38, true, false);
      if (this._frame > 500) push(baseX + 150, gY - PH - 28, 22, 16, false, true);
    }
  },

  _spawnCoins() {
    const gY = this._groundY;
    const baseX = this._W + 20;
    const kind = Math.random();
    if (kind < 0.4) {
      // 贴地一排,顺路就能吃
      for (let i = 0; i < 5; i++) this._coins.push({ x: baseX + i * 26, y: gY - 22 });
    } else if (kind < 0.75) {
      // 单跳弧线
      for (let i = 0; i < 5; i++) {
        this._coins.push({ x: baseX + i * 26, y: gY - 30 - Math.sin((i / 4) * Math.PI) * 55 });
      }
    } else {
      // 高空一排,要二段跳才够得着
      for (let i = 0; i < 4; i++) this._coins.push({ x: baseX + i * 26, y: gY - 100 });
    }
  },

  _collectCoin(c) {
    this._combo = this._comboTimer > 0 ? this._combo + 1 : 1;
    this._comboTimer = COMBO_WINDOW;
    this._bonus += COIN_SCORE;
    this._burst(c.x, c.y, '#F5C842', 5, 2.5);
    this._addLabel(`+${COIN_SCORE}`, '#F5C842', false, c.x, c.y - 12);
    this._sfxCoin(this._combo);
  },

  _collectItem(it) {
    this._burst(it.x, it.y, '#60C0FF', 10, 3);
    if (this._shield) {
      this._bonus += 50;
      this._addLabel('+50', '#60C0FF', false, it.x, it.y - 14);
    } else {
      this._shield = true;
      this._addLabel('咖啡护盾!', '#60C0FF', true);
    }
    this._sfxShield();
  },

  // ─── 粒子 / 浮字 ──────────────────────────────────────

  _burst(x, y, color, n, spread) {
    for (let i = 0; i < n; i++) {
      this._parts.push({
        x, y,
        vx: (Math.random() - 0.5) * spread * 2,
        vy: -Math.random() * 2.5 - 0.5,
        life: 18 + Math.random() * 14,
        color,
        sz: 2 + Math.floor(Math.random() * 2),
      });
    }
  },

  _updateParticles() {
    this._parts = this._parts.filter(pt => {
      pt.x += pt.vx - this._speed * 0.4;
      pt.y += pt.vy;
      pt.vy += 0.12;
      return --pt.life > 0;
    });
  },

  _addLabel(text, color, big, x, y) {
    this._labels.push({
      text, color, big,
      x: x === undefined ? this._W / 2 : x,
      y: y === undefined ? this._H * 0.28 : y,
      f: 0,
    });
    if (this._labels.length > 5) this._labels.shift();
  },

  _updateLabels() {
    this._labels = this._labels.filter(lb => {
      lb.f++;
      lb.y -= 0.7;
      return lb.f < 55;
    });
  },

  // ─── 死亡演出 ─────────────────────────────────────────

  _startDying() {
    this._dying = true;
    this._dieFrame = 0;
    this._player.vy = -9;
    this._player.jumps = 2;
    this._shake = 6;
    this._flash = 0.45;
    this._combo = 0;
    this._comboTimer = 0;
    this._burst(this._player.x + PW / 2, this._player.y + PH / 2, '#FF6B6B', 10, 4);
    this._stopBGM();
    this._sfxGameOver();
  },

  _updateDying() {
    this._dieFrame++;
    const p = this._player;
    p.vy += GRAVITY;
    p.y  += p.vy;
    this._updateParticles();
    this._updateLabels();
    if (this._dieFrame > 60 || p.y > this._H + 40) {
      this._gameOver();
    }
  },

  // ─── 渲染 ──────────────────────────────────────────────

  _draw() {
    const { _ctx: ctx, _W: W, _H: H, _groundY: gY } = this;

    ctx.save();
    // 震屏(死亡/护盾破碎)
    if (this._shake > 0.3) {
      ctx.translate((Math.random() * 2 - 1) * this._shake, (Math.random() * 2 - 1) * this._shake);
      this._shake *= 0.86;
    } else {
      this._shake = 0;
    }

    // 背景
    this._drawBg();

    // 移动地面虚线
    ctx.fillStyle = '#3A3A5E';
    for (let x = -(this._bgOffset % 80); x < W + 80; x += 80) {
      ctx.fillRect(x, gY + 6, 36, 2);
    }

    // 金币与咖啡
    for (const c of this._coins) this._drawCoin(c);
    for (const it of this._items) this._drawCup(it.x, it.y);

    // 障碍（Bug）
    for (const ob of this._obstacles) {
      this._drawObstacle(ob);
    }

    // 玩家(无敌帧闪烁;护盾光环)
    const blink = this._invuln > 0 && Math.floor(this._frame / 4) % 2 === 0;
    if (!blink) this._drawPlayer();
    if (this._shield && !this._dying) {
      const p = this._player;
      const pulse = 0.35 + 0.2 * Math.sin(this._frame / 8);
      ctx.strokeStyle = `rgba(96, 192, 255, ${pulse})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x + PW / 2, p.y + PH / 2, 26, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 粒子
    for (const pt of this._parts) {
      ctx.fillStyle = pt.color;
      ctx.globalAlpha = Math.min(1, pt.life / 12);
      ctx.fillRect(Math.round(pt.x), Math.round(pt.y), pt.sz, pt.sz);
    }
    ctx.globalAlpha = 1;

    // 浮字
    for (const lb of this._labels) {
      const a = lb.f < 8 ? lb.f / 8 : 1 - Math.max(0, lb.f - 30) / 25;
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = lb.color;
      ctx.font = lb.big ? 'bold 22px monospace' : 'bold 13px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(lb.text, lb.x, lb.y);
    }
    ctx.globalAlpha = 1;

    // HUD:分数 + 护盾 + 连击
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = 'bold 15px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(String(this._scoreVal).padStart(5, '0'), 16, 32);
    if (this._shield) {
      ctx.fillText('☕', 88, 32);
    }
    if (this._combo >= 2) {
      ctx.fillStyle = 'rgba(245, 200, 66, 0.85)';
      ctx.font = 'bold 12px monospace';
      ctx.fillText(`COMBO ×${this._combo}`, 16, 52);
    }

    // 死亡红闪
    if (this._flash > 0.02) {
      ctx.fillStyle = `rgba(255, 80, 80, ${this._flash})`;
      ctx.fillRect(-10, -10, W + 20, H + 20);
      this._flash *= 0.88;
    }

    ctx.restore();
  },

  // 金币:旋转的金色菱形晶体
  _drawCoin(c) {
    const ctx = this._ctx;
    // 相位按 x 错开,一排金币像波浪一样转
    const ph = Math.abs(Math.sin(this._frame / 7 + c.x * 0.03));
    const hw = 7 * (0.25 + 0.75 * ph);
    ctx.fillStyle = '#F5C842';
    ctx.beginPath();
    ctx.moveTo(c.x, c.y - 9);
    ctx.lineTo(c.x + hw, c.y);
    ctx.lineTo(c.x, c.y + 9);
    ctx.lineTo(c.x - hw, c.y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#FFEB8A';
    ctx.beginPath();
    ctx.moveTo(c.x, c.y - 4);
    ctx.lineTo(c.x + hw * 0.4, c.y);
    ctx.lineTo(c.x, c.y + 4);
    ctx.lineTo(c.x - hw * 0.4, c.y);
    ctx.closePath();
    ctx.fill();
  },

  // 咖啡杯:杯体 + 把手 + 碟子 + 飘动热气
  _drawCup(x, y) {
    const ctx = this._ctx;
    const s = 2;
    const px = x - 7 * s / 2;
    const py = y - 8;
    ctx.fillStyle = '#F0F0F5';
    ctx.fillRect(px, py + 3 * s, 6 * s, 4 * s);            // 杯体
    ctx.fillRect(px + 6 * s, py + 3 * s, s, s);            // 把手上
    ctx.fillRect(px + 7 * s, py + 4 * s, s, s);            // 把手外
    ctx.fillRect(px + 6 * s, py + 5 * s, s, s);            // 把手下
    ctx.fillStyle = '#8A5A3A';
    ctx.fillRect(px + s, py + 3 * s, 4 * s, s);            // 咖啡面
    ctx.fillStyle = '#C8C8D8';
    ctx.fillRect(px - s, py + 7 * s, 8 * s, s);            // 碟子
    // 热气(两缕,左右摆)
    const sway = Math.floor(this._frame / 12) % 2 === 0 ? 0 : s;
    ctx.fillStyle = 'rgba(192, 200, 232, 0.6)';
    ctx.fillRect(px + s + sway, py, s, s);
    ctx.fillRect(px + 3 * s + (s - sway), py + s, s, s);
  },

  // 编排背景各层绘制顺序（从远到近）
  _drawBg() {
    this._drawSky();
    this._drawBuildings();
    this._drawUnderground();
    this._drawFlora();
    this._drawGroundLine();
  },

  // 天空层：背景色 + 星星 + 月亮 + 云朵
  _drawSky() {
    const { _ctx: ctx, _W: W, _H: H } = this;
    ctx.fillStyle = '#1A1A2E';
    ctx.fillRect(-10, -10, W + 20, H + 20);
    ctx.fillStyle = '#5A5A8A';
    for (const s of (this._stars || [])) {
      ctx.fillRect(s.x, s.y, s.sz, s.sz);
    }
    this._drawMoon();
    this._drawClouds();
  },

  // 远景建筑剪影（极暗色，视差滚动）
  _drawBuildings() {
    const { _ctx: ctx, _groundY: gY } = this;
    ctx.fillStyle = '#1F1F38';
    for (const b of (this._buildings || [])) {
      ctx.fillRect(b.x, gY - b.h, b.w, b.h);
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
  },

  // 地下层：土层渐变 + 岩块 + 矿簇
  _drawUnderground() {
    const { _ctx: ctx, _W: W, _H: H, _groundY: gY } = this;
    ctx.fillStyle = '#1D1D34';
    ctx.fillRect(0, gY, W, 18);
    ctx.fillStyle = '#1B1B2E';
    ctx.fillRect(0, gY + 18, W, 22);
    ctx.fillStyle = '#191828';
    ctx.fillRect(0, gY + 40, W, H - gY - 40);

    ctx.fillStyle = '#252438';
    for (const r of (this._oreRocks || [])) ctx.fillRect(r.x, r.y, r.w, r.h);

    ctx.fillStyle = 'rgba(74,111,165,0.50)';
    for (const o of (this._oreBlue || [])) ctx.fillRect(o.x, o.y, o.w, o.h);

    ctx.fillStyle = 'rgba(130,80,200,0.40)';
    for (const o of (this._orePurple || [])) ctx.fillRect(o.x, o.y, o.w, o.h);

    ctx.fillStyle = 'rgba(200,120,50,0.38)';
    for (const o of (this._oreWarm || [])) ctx.fillRect(o.x, o.y, o.w, o.h);
  },

  // 地面线 + 高亮细条 + 地表碎石
  _drawGroundLine() {
    const { _ctx: ctx, _W: W, _groundY: gY } = this;
    ctx.fillStyle = '#4A6FA5';
    ctx.fillRect(0, gY, W, 2);
    ctx.fillStyle = '#2A2A4A';
    ctx.fillRect(0, gY + 2, W, 3);
    ctx.fillStyle = '#2E2E52';
    for (const d of (this._groundDeco || [])) ctx.fillRect(d.x, d.y, d.w, d.h);
  },

  _drawPlayer() {
    const { _ctx: ctx, _player: p } = this;
    const airborne = p.jumps > 0;                          // 腾空：四腿伸展，不做跑步动画
    const step = Math.floor(this._frame / 6) % 2;          // 0/1 交替抬腿
    const bob  = (!airborne && step === 1) ? -1 : 0;       // 换步瞬间身体微微上提
    const gx = p.x + (PW - GRID_COLS * PLAYER_PS) / 2;     // 水平居中于碰撞框
    const gy = p.y + PH - GRID_ROWS * PLAYER_PS + bob;     // 脚底贴碰撞框底部
    drawClawd(ctx, gx, gy, PLAYER_PS, { legFrame: airborne ? 'all' : step });
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
    for (const cl of (this._clouds || [])) {
      this._drawCloud(cl.x, cl.y, cl.r);
    }
  },

  // 真实感云朵：8个重叠圆弧，垂直压扁 0.55 倍，蓬松可爱
  _drawCloud(cx, cy, r) {
    const ctx = this._ctx;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, 0.55);   // 压扁，让云朵更横向
    ctx.fillStyle = 'rgba(58, 62, 95, 0.85)';
    [
      [  0,       0,      r      ],  // 中心主体
      [ -r*0.50,  r*0.22, r*0.68 ],  // 左中
      [  r*0.50,  r*0.22, r*0.68 ],  // 右中
      [ -r*0.88,  r*0.42, r*0.50 ],  // 左边
      [  r*0.88,  r*0.42, r*0.50 ],  // 右边
      [  0,       r*0.38, r*0.56 ],  // 中底
      [ -r*0.26, -r*0.22, r*0.46 ],  // 新：左顶小包
      [  r*0.26, -r*0.22, r*0.46 ],  // 新：右顶小包
    ].forEach(([dx, dy, rad]) => {
      ctx.beginPath();
      ctx.arc(dx, dy, rad, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  },

  _drawObstacle(ob) {
    const { _ctx: ctx } = this;
    const S    = 3;
    const sprH = 5 * S;  // 精灵高度 15px
    const bx   = ob.x + Math.floor((ob.w - 6 * S) / 2);

    if (ob.flying) {
      const by = ob.y;
      ctx.fillStyle = '#60C0FF';
      ctx.fillRect(bx,         by,     S * 2, S);
      ctx.fillRect(bx + S * 4, by,     S * 2, S);
      this._drawBugSprite(ctx, bx, by + S, S, '#4A9EFF', '#B3D9FF');
    } else if (ob.tall) {
      // 两只叠放，脚底对齐 ob.y + ob.h（即地面）
      const by2 = ob.y + ob.h - sprH;
      const by1 = by2 - sprH;
      this._drawBugSprite(ctx, bx, by1, S, '#A855F7', '#D4AAFF');
      this._drawBugSprite(ctx, bx, by2, S, '#FF6B6B', '#FFB3B3');
    } else {
      // 脚底对齐地面
      this._drawBugSprite(ctx, bx, ob.y + ob.h - sprH, S, '#FF6B6B', '#FFB3B3');
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
    this._dying = false;
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
    ctx.fillStyle = '#D97757';
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
      { x: this._W * 0.15, y: gY * 0.22, r: 18 },
      { x: this._W * 0.55, y: gY * 0.13, r: 14 },
      { x: this._W * 0.82, y: gY * 0.30, r: 16 },
    ];
  },

  // 地面碎石（地表滚动装饰）
  _initGroundDeco() {
    const gY = this._groundY;
    this._groundDeco = Array.from({ length: 28 }, () => ({
      x: Math.random() * this._W * 1.5,
      y: gY + 4 + Math.random() * 10,
      w: 1 + Math.floor(Math.random() * 3),
      h: 1 + Math.floor(Math.random() * 2)
    }));
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
  },

  // 地下岩块与矿簇（静态，仅初始化一次）
  _initUnderground() {
    const W  = this._W;
    const gY = this._groundY;
    const ug = this._H - gY;

    this._oreRocks = Array.from({ length: 6 }, () => ({
      x: Math.random() * W,
      y: gY + 10 + Math.random() * (ug - 16),
      w: 8 + Math.floor(Math.random() * 14),
      h: 4 + Math.floor(Math.random() * 6)
    }));
    this._oreBlue   = this._makeOreClusters(3, W, gY, ug);
    this._orePurple = this._makeOreClusters(2, W, gY, ug);
    this._oreWarm   = Array.from({ length: 2 }, () => ({
      x: Math.random() * W,
      y: gY + 12 + Math.random() * (ug - 18),
      w: 3, h: 3
    }));
  },

  // 远景像素建筑轮廓（视差层，极慢滚动）
  _initBuildings() {
    this._buildings = [];
    let bx = 0;
    while (bx < this._W * 1.8) {
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

  // ─── 音频系统 ──────────────────────────────────────────

  _initAudio() {
    try {
      this._ac = wx.createWebAudioContext();
      // BGM 主增益：设为 0 即可静音所有已调度音符
      this._bgmGain = this._ac.createGain();
      this._bgmGain.connect(this._ac.destination);
    } catch(e) {
      this._ac = null;
    }
    this._bgmPlaying = false;
    this._bgmTimer   = null;
  },

  // 调度单个音符（SFX 直连 destination，BGM 走 _bgmGain）
  _note(freq, startTime, dur, vol = 0.18, type = 'square', useBgmGain = false) {
    if (!this._ac || freq === 0) return;
    const ac  = this._ac;
    const osc = ac.createOscillator();
    const g   = ac.createGain();
    osc.connect(g);
    g.connect(useBgmGain ? this._bgmGain : ac.destination);
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(vol, startTime);
    g.gain.exponentialRampToValueAtTime(0.001, startTime + dur * 0.88);
    osc.start(startTime);
    osc.stop(startTime + dur);
  },

  // BGM：8-bit 风格循环(两段 16 拍乐句交替,C大调五声音阶)
  _scheduleBGM() {
    if (!this._ac || !this._bgmPlaying) return;
    const ac  = this._ac;
    const now = ac.currentTime + 0.05;
    const S   = 60 / 138 * 0.5;

    const phraseB = (this._bgmBar = (this._bgmBar || 0) + 1) % 2 === 0;
    const mel = phraseB
      ? [659,784,880,1046, 880,784,659,523, 587,659,784,880, 784,659,587,0]
      : [523,659,784,659, 523,659,784,880, 784,659,523,440, 523,587,659,0];
    const bas = phraseB
      ? [349,0,349,0, 330,0,330,0, 294,0,294,0, 262,0,330,0]
      : [262,0,262,0, 294,0,294,0, 262,0,262,0, 330,0,330,0];
    const drm = [1,0,0,0, 1,0,1,0, 1,0,0,0, 1,0,1,0];

    mel.forEach((f, i) => this._note(f, now + i*S, S*0.78, 0.14, 'square',   true));
    bas.forEach((f, i) => this._note(f, now + i*S, S*0.65, 0.09, 'sawtooth', true));
    drm.forEach((v, i) => {
      if (v) this._note(220, now + i*S, 0.03, 0.06, 'sawtooth', true);
    });

    const loopMs = mel.length * S * 1000;
    this._bgmTimer = setTimeout(() => this._scheduleBGM(), loopMs - 80);
  },

  _startBGM() {
    if (!this._ac) return;
    this._stopBGM();
    // 每次开始创建新节点，旧音符连着已断开的旧节点，不会复活
    this._bgmGain = this._ac.createGain();
    this._bgmGain.connect(this._ac.destination);
    this._bgmGain.gain.setValueAtTime(1, this._ac.currentTime);
    this._bgmPlaying = true;
    this._scheduleBGM();
  },

  _stopBGM() {
    this._bgmPlaying = false;
    if (this._bgmTimer) { clearTimeout(this._bgmTimer); this._bgmTimer = null; }
    // 断开旧增益节点，隔断所有已调度音符
    if (this._bgmGain) {
      try { this._bgmGain.disconnect(); } catch(e) {}
      this._bgmGain = null;
    }
  },

  // 跳跃音效：仿超级马里奥，方波频率指数上扫
  _sfxJump(isDouble) {
    if (!this._ac) return;
    const ac  = this._ac;
    const osc = ac.createOscillator();
    const g   = ac.createGain();
    osc.connect(g); g.connect(ac.destination);
    osc.type = 'square';
    const now = ac.currentTime;
    // 一段跳：160→640Hz（两个八度），约 0.1s；二段跳起始稍高
    const f0 = isDouble ? 240 : 160;
    const f1 = isDouble ? 960 : 640;
    osc.frequency.setValueAtTime(f0, now);
    osc.frequency.exponentialRampToValueAtTime(f1, now + 0.1);
    g.gain.setValueAtTime(0.28, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc.start(now);
    osc.stop(now + 0.12);
  },

  // 死亡音效：下降四音
  _sfxGameOver() {
    if (!this._ac) return;
    const now = this._ac.currentTime;
    [392, 330, 294, 220].forEach((f, i) => {
      this._note(f, now + i * 0.14, 0.16, 0.22);
    });
  },

  // 金币:随连击升调的双音
  _sfxCoin(combo) {
    if (!this._ac) return;
    const now = this._ac.currentTime;
    const f = 660 * Math.pow(2, Math.min(combo - 1, 12) / 12);
    this._note(f, now, 0.06, 0.14);
    this._note(f * 1.5, now + 0.05, 0.06, 0.10);
  },

  // 咖啡入手:上行琶音
  _sfxShield() {
    if (!this._ac) return;
    const now = this._ac.currentTime;
    [523, 784, 1046].forEach((f, i) => this._note(f, now + i * 0.06, 0.08, 0.16));
  },

  // 护盾破碎:低频下扫
  _sfxShieldBreak() {
    if (!this._ac) return;
    const ac = this._ac;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.connect(g); g.connect(ac.destination);
    osc.type = 'square';
    const now = ac.currentTime;
    osc.frequency.setValueAtTime(360, now);
    osc.frequency.exponentialRampToValueAtTime(90, now + 0.18);
    g.gain.setValueAtTime(0.22, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.start(now);
    osc.stop(now + 0.2);
  },

  // 里程碑:小号三连音
  _sfxMilestone() {
    if (!this._ac) return;
    const now = this._ac.currentTime;
    [784, 988, 1175].forEach((f, i) => this._note(f, now + i * 0.07, 0.09, 0.15));
  }
});
