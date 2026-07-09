// ─── Clawd 贪吃蛇 ────────────────────────────────────────
// 蛇头是 Clawd（眼睛朝移动方向、会眨眼），吃的是像素 Bug。
// 平滑插值移动 + 金色限时 Bug + 粒子/飘分 + 震屏 + 8-bit 音效。
const { drawClawd, GRID_COLS, GRID_ROWS } = require('../../utils/clawd');

const COLS = 17;              // 横向格数（纵向按画布高度自适应）
const TICK_START = 200;       // 初始每步毫秒
const TICK_MIN = 95;          // 最快每步毫秒
const TICK_STEP = 4;          // 每吃一个 Bug 提速毫秒
const GOLD_EVERY = 5;         // 每吃 N 个红 Bug 出一个金 Bug
const GOLD_LIFE = 6000;       // 金 Bug 存活毫秒
const START_LEN = 3;

// Bug 像素图案（6列×5行，与跑酷同款）
const BUG_PIXELS = [
  [0,1],[0,4],
  [1,1],[1,2],[1,3],[1,4],
  [2,0],[2,1],[2,2],[2,3],[2,4],[2,5],
  [3,0],[3,1],[3,2],[3,3],[3,4],[3,5],
  [4,0],[4,2],[4,3],[4,5],
];
const BUG_EYES = [[1,2],[1,3]];

const DIRS = {
  up:    { x: 0,  y: -1 },
  down:  { x: 0,  y: 1 },
  left:  { x: -1, y: 0 },
  right: { x: 1,  y: 0 },
};
const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };

// 身体颜色渐变（头 → 尾）
function lerpColor(t) {
  const a = [0xD9, 0x77, 0x57];
  const b = [0xA8, 0x56, 0x42];
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

Page({
  data: {
    gameState: 'idle',   // 'idle' | 'playing' | 'over'
    score: 0,
    bestScore: 0,
    snakeLen: START_LEN,
    overReason: '',
  },

  onLoad() {
    this.bestScore = wx.getStorageSync('snake_best') || 0;
    this.setData({ bestScore: this.bestScore });
  },

  onReady() {
    const info = wx.getSystemInfoSync();
    this._dpr = info.pixelRatio || 2;

    wx.createSelectorQuery()
      .select('#snake-canvas')
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
        // 格子尺寸与棋盘范围（水平居中，垂直方向吃满可整除的部分）
        this._cell = Math.floor(w / COLS);
        this._rows = Math.floor(h / this._cell);
        this._ox   = Math.floor((w - this._cell * COLS) / 2);
        this._oy   = Math.floor((h - this._cell * this._rows) / 2);

        this._initAudio();
        this._drawIdle();
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
    if (this.data.gameState === 'playing' && this._canvas) {
      this._lastTick = 0;   // 重置步进计时，避免后台期间的时间差导致瞬移
      this._startBGM();
      this._loop();
    }
  },

  onShareAppMessage() {
    const score = this.data.score || 0;
    const best  = this.data.bestScore || 0;
    return {
      title: `我的 Clawd 吃了 ${score} 只 Bug！最长 ${best} 分，来挑战我～`,
      path: '/pages/snake/index'
    };
  },

  // ─── 交互 ──────────────────────────────────────────────

  onStart() {
    this._startGame();
  },

  onRetry() {
    this._startGame();
  },

  onTouchStart(e) {
    const t = e.touches[0];
    this._tx = t.clientX;
    this._ty = t.clientY;
  },

  onTouchEnd(e) {
    if (this.data.gameState !== 'playing') return;
    const t = e.changedTouches[0];
    const dx = t.clientX - this._tx;
    const dy = t.clientY - this._ty;
    const MIN = 24;
    if (Math.abs(dx) < MIN && Math.abs(dy) < MIN) return;
    const dir = Math.abs(dx) >= Math.abs(dy)
      ? (dx > 0 ? 'right' : 'left')
      : (dy > 0 ? 'down' : 'up');
    this._queueDir(dir);
  },

  // 方向队列：最多缓存 2 步，禁止 180° 掉头
  _queueDir(dir) {
    const q = this._dirQueue;
    const last = q.length ? q[q.length - 1] : this._dir;
    if (dir === last || dir === OPPOSITE[last]) return;
    if (q.length >= 2) q.shift();
    q.push(dir);
  },

  // ─── 游戏控制 ──────────────────────────────────────────

  _startGame() {
    if (!this._canvas) return;
    this._stopLoop();

    const cx = Math.floor(COLS / 2);
    const cy = Math.floor(this._rows / 2);
    this._snake = [];
    for (let i = 0; i < START_LEN; i++) {
      this._snake.push({ x: cx - i, y: cy });
    }
    this._prevSnake = this._snake.map(s => ({ ...s }));
    this._dir = 'right';
    this._dirQueue = [];
    this._tick = TICK_START;
    this._lastTick = 0;
    this._lastFrame = 0;
    this._eaten = 0;
    this._scoreVal = 0;
    this._gold = null;
    this._particles = [];
    this._floats = [];
    this._shakeUntil = 0;
    this._blinkAt = Date.now() + 3000;
    this._dying = false;
    this._spawnBug();

    this.setData({ gameState: 'playing', score: 0, snakeLen: START_LEN, overReason: '' });
    this._startBGM();
    this._loop();
  },

  _stopLoop() {
    if (this._raf && this._canvas) {
      this._canvas.cancelAnimationFrame(this._raf);
      this._raf = null;
    }
  },

  _loop() {
    const now = Date.now();
    if (!this._lastTick) this._lastTick = now;

    if (!this._dying && now - this._lastTick >= this._tick) {
      this._step();
      this._lastTick = now;
    }
    this._draw(now);

    if (this.data.gameState === 'playing') {
      this._raf = this._canvas.requestAnimationFrame(() => this._loop());
    }
  },

  // ─── 每步逻辑 ──────────────────────────────────────────

  _step() {
    if (this._dirQueue.length) this._dir = this._dirQueue.shift();
    const d = DIRS[this._dir];
    const head = this._snake[0];
    const nx = head.x + d.x;
    const ny = head.y + d.y;

    // 撞墙
    if (nx < 0 || nx >= COLS || ny < 0 || ny >= this._rows) {
      this._die('撞到墙了');
      return;
    }
    // 撞自己：普通步尾巴会移走不算；吃到 Bug 的步尾巴不动，要算
    const willEat = (this._bug && nx === this._bug.x && ny === this._bug.y) ||
                    (this._gold && nx === this._gold.x && ny === this._gold.y);
    const bodyLen = willEat ? this._snake.length : this._snake.length - 1;
    for (let i = 0; i < bodyLen; i++) {
      if (this._snake[i].x === nx && this._snake[i].y === ny) {
        this._die('咬到自己了');
        return;
      }
    }

    this._prevSnake = this._snake.map(s => ({ ...s }));
    this._snake.unshift({ x: nx, y: ny });

    let grew = 0;
    if (this._bug && nx === this._bug.x && ny === this._bug.y) {
      grew = 1;
      this._eatBug(this._bug, 1, '#FF6B6B');
      this._spawnBug();
      this._eaten++;
      if (this._eaten % GOLD_EVERY === 0) this._spawnGold();
    } else if (this._gold && nx === this._gold.x && ny === this._gold.y) {
      grew = 2;
      this._eatBug(this._gold, 5, '#F5C842');
      this._gold = null;
    }

    if (grew === 0) {
      this._snake.pop();
    } else if (grew === 2) {
      // 金 Bug 额外多长一节：复制尾节
      const tail = this._snake[this._snake.length - 1];
      this._snake.push({ ...tail });
    }
    if (grew) this.setData({ snakeLen: this._snake.length });

    // 金 Bug 过期
    if (this._gold && Date.now() > this._gold.expireAt) {
      this._gold = null;
    }
  },

  _eatBug(bug, points, color) {
    this._scoreVal += points;
    this._tick = Math.max(TICK_MIN, this._tick - TICK_STEP * points);
    this.setData({ score: this._scoreVal });
    try { wx.vibrateShort({ type: 'light' }); } catch (e) {}
    this._sfxEat(points > 1);

    const px = this._ox + bug.x * this._cell + this._cell / 2;
    const py = this._oy + bug.y * this._cell + this._cell / 2;
    for (let i = 0; i < 8; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 1.2 + Math.random() * 1.8;
      this._particles.push({
        x: px, y: py,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 0.8,
        size: 2 + Math.random() * 3,
        color,
        alpha: 1,
      });
    }
    this._floats.push({ x: px, y: py - 4, text: `+${points}`, color, alpha: 1 });
  },

  _die(reason) {
    this._dying = true;
    this._shakeUntil = Date.now() + 350;
    try { wx.vibrateLong(); } catch (e) {}
    this._sfxDie();
    this._stopBGM();

    if (this._scoreVal > this.bestScore) {
      this.bestScore = this._scoreVal;
      wx.setStorageSync('snake_best', this.bestScore);
    }

    setTimeout(() => {
      this._stopLoop();
      this.setData({
        gameState: 'over',
        score: this._scoreVal,
        bestScore: this.bestScore,
        overReason: reason,
      });
    }, 420);
  },

  // ─── Bug 生成 ──────────────────────────────────────────

  _randomFreeCell() {
    for (let tries = 0; tries < 200; tries++) {
      const x = Math.floor(Math.random() * COLS);
      const y = Math.floor(Math.random() * this._rows);
      const onSnake = this._snake.some(s => s.x === x && s.y === y);
      const onBug   = this._bug  && this._bug.x === x && this._bug.y === y;
      const onGold  = this._gold && this._gold.x === x && this._gold.y === y;
      if (!onSnake && !onBug && !onGold) return { x, y };
    }
    return null;
  },

  _spawnBug() {
    const cell = this._randomFreeCell();
    this._bug = cell ? { ...cell } : null;
  },

  _spawnGold() {
    if (this._gold) return;
    const cell = this._randomFreeCell();
    if (cell) this._gold = { ...cell, expireAt: Date.now() + GOLD_LIFE };
  },

  // ─── 渲染 ──────────────────────────────────────────────

  _draw(now) {
    const ctx = this._ctx;
    const W = this._W, H = this._H;

    ctx.save();
    // 死亡震屏
    if (now < this._shakeUntil) {
      ctx.translate((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
    }

    this._drawBoard(ctx, W, H);

    // 插值进度（死亡时定格）
    const t = this._dying ? 1 : Math.min(1, (now - this._lastTick) / this._tick);

    if (this._bug)  this._drawBug(ctx, this._bug, '#FF6B6B', '#FFB3B3', now, false);
    if (this._gold) this._drawBug(ctx, this._gold, '#F5C842', '#FFF3C4', now, true);

    this._drawSnake(ctx, t, now);
    this._drawParticles(ctx);
    this._drawFloats(ctx);

    ctx.restore();
  },

  _drawBoard(ctx, W, H) {
    ctx.fillStyle = '#1A1A2E';
    ctx.fillRect(0, 0, W, H);
    // 棋盘格（2×2 格一块，弱对比）
    const c = this._cell;
    ctx.fillStyle = '#1E1E38';
    for (let x = 0; x < COLS; x += 2) {
      for (let y = 0; y < this._rows; y += 2) {
        ctx.fillRect(this._ox + x * c, this._oy + y * c, c, c);
        if (x + 1 < COLS && y + 1 < this._rows) {
          ctx.fillRect(this._ox + (x + 1) * c, this._oy + (y + 1) * c, c, c);
        }
      }
    }
    // 边界
    ctx.strokeStyle = '#2E3A5C';
    ctx.lineWidth = 2;
    ctx.strokeRect(this._ox + 1, this._oy + 1, COLS * c - 2, this._rows * c - 2);
  },

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  },

  _drawSnake(ctx, t, now) {
    const c = this._cell;
    const n = this._snake.length;
    const pad = Math.max(1, Math.floor(c * 0.08));

    // 从尾到头画，头在最上层
    for (let i = n - 1; i >= 0; i--) {
      const cur = this._snake[i];
      const prev = this._prevSnake[i] || this._prevSnake[this._prevSnake.length - 1] || cur;
      const gx = prev.x + (cur.x - prev.x) * t;
      const gy = prev.y + (cur.y - prev.y) * t;
      const px = this._ox + gx * c;
      const py = this._oy + gy * c;

      if (i === 0) {
        this._drawHead(ctx, px, py, c, now);
      } else {
        const shade = lerpColor(i / Math.max(1, n - 1));
        const shrink = pad + (i === n - 1 ? Math.floor(c * 0.08) : 0);  // 尾节略细
        ctx.fillStyle = shade;
        this._roundRect(ctx, px + shrink, py + shrink, c - shrink * 2, c - shrink * 2, Math.floor(c * 0.22));
        ctx.fill();
      }
    }
  },

  // 蛇头：Clawd 脸（朝向移动方向的双眼，定期眨眼）
  _drawHead(ctx, px, py, c, now) {
    const grow = Math.floor(c * 0.06);   // 头比身体略大
    const x = px - grow, y = py - grow;
    const s = c + grow * 2;

    ctx.fillStyle = '#D97757';
    this._roundRect(ctx, x + 1, y + 1, s - 2, s - 2, Math.floor(s * 0.24));
    ctx.fill();

    // 眨眼：每 3~4 秒闭眼 130ms
    if (now >= this._blinkAt) {
      if (now > this._blinkAt + 130) {
        this._blinkAt = now + 3000 + Math.random() * 1200;
      } else {
        return; // 闭眼帧不画眼睛
      }
    }

    // 眼睛朝移动方向偏移
    const d = DIRS[this._dir];
    const eye = Math.max(2, Math.floor(s * 0.14));
    const off = Math.floor(s * 0.13);
    const cx = x + s / 2 + d.x * off;
    const cy = y + s / 2 + d.y * off;
    // 垂直于移动方向分开两只眼
    const sep = Math.floor(s * 0.18);
    const ex = d.x === 0 ? sep : 0;
    const ey = d.y === 0 ? sep : 0;
    ctx.fillStyle = '#000000';
    ctx.fillRect(cx - ex - eye / 2, cy - ey - eye / 2, eye, eye);
    ctx.fillRect(cx + ex - eye / 2, cy + ey - eye / 2, eye, eye);
  },

  _drawBug(ctx, bug, bodyColor, eyeColor, now, isGold) {
    // 金 Bug 最后 2 秒闪烁提示即将消失
    if (isGold) {
      const left = bug.expireAt - now;
      if (left < 2000 && Math.floor(now / 150) % 2 === 0) return;
    }
    const c = this._cell;
    const S = Math.max(2, Math.floor(c / 8));
    const wob = Math.sin(now / 260 + bug.x * 1.7) * S * 0.4;  // 轻微蠕动
    const bx = this._ox + bug.x * c + Math.floor((c - 6 * S) / 2);
    const by = this._oy + bug.y * c + Math.floor((c - 5 * S) / 2) + wob;

    ctx.fillStyle = bodyColor;
    BUG_PIXELS.forEach(([r, cc]) => ctx.fillRect(bx + cc * S, by + r * S, S, S));
    ctx.fillStyle = eyeColor;
    BUG_EYES.forEach(([r, cc]) => ctx.fillRect(bx + cc * S, by + r * S, S, S));
  },

  _drawParticles(ctx) {
    this._particles = this._particles.filter(p => p.alpha > 0);
    for (const p of this._particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.12;
      p.alpha -= 0.035;
      if (p.alpha <= 0) continue;
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  },

  _drawFloats(ctx) {
    this._floats = this._floats.filter(f => f.alpha > 0);
    ctx.font = `bold ${Math.floor(this._cell * 0.7)}px monospace`;
    ctx.textAlign = 'center';
    for (const f of this._floats) {
      f.y -= 0.9;
      f.alpha -= 0.025;
      if (f.alpha <= 0) continue;
      ctx.globalAlpha = Math.max(0, f.alpha);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  },

  // 开始页：画布上摆一只大 Clawd 和一只 Bug 当封面
  _drawIdle() {
    const ctx = this._ctx;
    if (!ctx) return;
    this._drawBoard(ctx, this._W, this._H);
    const ps = Math.max(2, Math.floor(this._W / (GRID_COLS + 8)));
    const gx = Math.floor((this._W - GRID_COLS * ps) / 2);
    const gy = Math.floor(this._H * 0.30);
    drawClawd(ctx, gx, gy, ps);
    this._drawBug(ctx, { x: Math.floor(COLS * 0.72), y: Math.floor(this._rows * 0.62) }, '#FF6B6B', '#FFB3B3', Date.now(), false);
  },

  // ─── 音频（Web Audio 合成，不支持时静默降级）───────────

  _initAudio() {
    try {
      this._ac = wx.createWebAudioContext();
      this._bgmGain = null;
    } catch (e) {
      this._ac = null;
    }
    this._bgmPlaying = false;
    this._bgmTimer = null;
  },

  _note(freq, startTime, dur, vol = 0.15, type = 'square', useBgmGain = false) {
    if (!this._ac || freq === 0) return;
    const ac = this._ac;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.connect(g);
    g.connect(useBgmGain && this._bgmGain ? this._bgmGain : ac.destination);
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(vol, startTime);
    g.gain.exponentialRampToValueAtTime(0.001, startTime + dur * 0.88);
    osc.start(startTime);
    osc.stop(startTime + dur);
  },

  // BGM：8-bit 轻快小循环（16 拍）
  _scheduleBGM() {
    if (!this._ac || !this._bgmPlaying) return;
    const ac = this._ac;
    const now = ac.currentTime + 0.05;
    const S = 60 / 126 * 0.5;

    const mel = [440,523,587,523, 440,523,587,659, 587,523,440,392, 440,392,349,0];
    const bas = [220,0,220,0, 175,0,175,0, 196,0,196,0, 220,0,220,0];

    mel.forEach((f, i) => this._note(f, now + i * S, S * 0.75, 0.10, 'square', true));
    bas.forEach((f, i) => this._note(f, now + i * S, S * 0.6, 0.07, 'triangle', true));

    const loopMs = mel.length * S * 1000;
    this._bgmTimer = setTimeout(() => this._scheduleBGM(), loopMs - 80);
  },

  _startBGM() {
    if (!this._ac) return;
    this._stopBGM();
    this._bgmGain = this._ac.createGain();
    this._bgmGain.connect(this._ac.destination);
    this._bgmGain.gain.setValueAtTime(1, this._ac.currentTime);
    this._bgmPlaying = true;
    this._scheduleBGM();
  },

  _stopBGM() {
    this._bgmPlaying = false;
    if (this._bgmTimer) { clearTimeout(this._bgmTimer); this._bgmTimer = null; }
    if (this._bgmGain) {
      try { this._bgmGain.disconnect(); } catch (e) {}
      this._bgmGain = null;
    }
  },

  _sfxEat(isGold) {
    if (!this._ac) return;
    const now = this._ac.currentTime;
    if (isGold) {
      [659, 784, 1047].forEach((f, i) => this._note(f, now + i * 0.07, 0.1, 0.2));
    } else {
      const osc = this._ac.createOscillator();
      const g = this._ac.createGain();
      osc.connect(g); g.connect(this._ac.destination);
      osc.type = 'square';
      osc.frequency.setValueAtTime(420, now);
      osc.frequency.exponentialRampToValueAtTime(840, now + 0.08);
      g.gain.setValueAtTime(0.2, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      osc.start(now);
      osc.stop(now + 0.1);
    }
  },

  _sfxDie() {
    if (!this._ac) return;
    const now = this._ac.currentTime;
    [330, 262, 220, 165].forEach((f, i) => this._note(f, now + i * 0.12, 0.15, 0.22, 'sawtooth'));
  },
});
