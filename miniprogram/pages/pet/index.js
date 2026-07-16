// ── Clawd 电子宠物 ──────────────────────────────────────────
// 会满地溜达的像素宠物：随机散步、冒想法泡泡、点哪跑哪；
// 喂食会掉肉排追着吃；"抓 Bug"是 20 秒限时小游戏，点中 Bug
// 消灭它，Clawd 会冲过去。云函数接口沿用原有 pet 系列。
const { GRID_COLS, GRID_ROWS, drawClawd } = require('../../utils/clawd');

// Bug 像素图案（6列×5行，与跑酷/贪吃蛇同款）
const BUG_PIXELS = [
  [0,1],[0,4],
  [1,1],[1,2],[1,3],[1,4],
  [2,0],[2,1],[2,2],[2,3],[2,4],[2,5],
  [3,0],[3,1],[3,2],[3,3],[3,4],[3,5],
  [4,0],[4,2],[4,3],[4,5],
];
const BUG_EYES = [[1,2],[1,3]];

const GAME_MS    = 20000;   // 抓 Bug 时长
const MAX_BUGS   = 4;       // 同屏 Bug 上限
const WALK_SPEED = 45;      // 散步速度 px/s
const DASH_SPEED = 300;     // 冲刺速度 px/s

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

Page({
  data: {
    pet: null,
    petAge: 1,
    stage: '',
    stageBadge: '',
    happyFlash: false,
    showRename: false,
    renameInput: '',
    statusText: '',
    loadError: '',
    gamePlaying: false,
  },

  onLoad() {
    this._pageReady = false;
    this._raf = null;
    this._happyFlashTimer = null;
    this._particles = [];
    this._bubble = null;       // { text, until }
    this._food = null;         // { x, y, landed, expireAt }
    this._game = null;         // { endsAt, bugs, catches, nextSpawnAt }
    this._sprite = { x: 0, mode: 'idle', targetX: 0 };  // mode: idle | walk | dash
    this._nextDecisionAt = 0;
    this._nextBubbleAt = 0;
    this._blinkAt = Date.now() + 3500;
    this._tapBounceTick = 0;
    this._loadPet();
  },

  onReady() {
    this._pageReady = true;
    this._initCanvas();
  },

  onShow() {
    if (this._pageReady && this._ctx) {
      this._loadPet();
      this._startAnimation();
    }
  },

  onHide()   { this._stopAll(); },
  onUnload() { this._stopAll(); },

  _stopAll() {
    if (this._raf && this._canvasNode) {
      this._canvasNode.cancelAnimationFrame(this._raf);
      this._raf = null;
    }
    if (this._happyFlashTimer) { clearTimeout(this._happyFlashTimer); this._happyFlashTimer = null; }
    // 中途离开直接放弃本局抓 Bug（不结算）
    if (this._game) {
      this._game = null;
      this.setData({ gamePlaying: false });
    }
  },

  // ── 数据加载 ───────────────────────────────────────────────
  async _loadPet() {
    this.setData({ loadError: '' });
    try {
      const result = await wx.cloud.callFunction({
        name: 'quickstartFunctions',
        data: { type: 'getPet' },
      });
      if (result.result?.success) {
        const pet = result.result.pet;
        const age = this._computeAge(pet);
        const { stage, badge, scale } = this._computeStage(age);
        this._stageScale = scale;
        this.setData({
          pet,
          petAge: age,
          stage,
          stageBadge: badge,
          statusText: this._getStatusText(pet),
          loadError: '',
        });
        this._checkMilestone(stage);
        if (this._ctx && !this._raf) this._startAnimation();
      } else {
        const msg = result.result?.errMsg || '云函数返回失败';
        console.error('[pet] getPet failed:', msg);
        this.setData({ loadError: msg });
      }
    } catch (e) {
      console.error('[pet] callFunction error:', e);
      this.setData({ loadError: e.message || '网络错误' });
    }
  },

  onRetry() {
    this._loadPet();
  },

  _computeAge(pet) {
    if (!pet || !pet.createdAt) return 1;
    const days = Math.floor((Date.now() - new Date(pet.createdAt).getTime()) / 86400000);
    return Math.max(1, days + 1);
  },

  _computeStage(age) {
    if (age >= 30) return { stage: '成年', badge: '👑', scale: 1.15 };
    if (age >= 7)  return { stage: '少年', badge: '✨', scale: 1.0 };
    return { stage: '幼崽', badge: '🥚', scale: 0.8 };
  },

  _checkMilestone(stage) {
    if (stage === '幼崽') return;
    const key = 'pet_milestone_' + stage;
    if (!wx.getStorageSync(key)) {
      wx.setStorageSync(key, true);
      setTimeout(() => {
        const name = this.data.pet?.name || '它';
        wx.showToast({ title: `${name}长大了！${this.data.stageBadge}`, icon: 'none', duration: 2000 });
      }, 800);
    }
  },

  _getStatusText(pet) {
    if (!pet) return '';
    if (pet.isSleeping)       return '在睡觉... 💤';
    if (pet.health < 20)      return '好难受...';
    if (pet.hunger < 30)      return '好饿啊...';
    if (pet.happiness < 30)   return '有点寂寞...';
    if (pet.hunger > 80 && pet.happiness > 80) return '棒极了！✨';
    return '状态不错~';
  },

  // ── Canvas 初始化 ──────────────────────────────────────────
  _initCanvas() {
    const dpr = wx.getSystemInfoSync().pixelRatio || 2;
    wx.createSelectorQuery()
      .select('#pet-canvas')
      .fields({ node: true, size: true })
      .exec(res => {
        if (!res || !res[0] || !res[0].node) return;
        const node = res[0].node;
        const W = res[0].width;
        const H = res[0].height;
        node.width  = Math.round(W * dpr);
        node.height = Math.round(H * dpr);
        const ctx = node.getContext('2d');
        ctx.scale(dpr, dpr);
        this._canvasNode = node;
        this._ctx = ctx;
        this._W = W;
        this._H = H;
        // 32 列细网格：像素尺寸 = 画布短边 / 64（留出活动空间）
        this._pixelSize = Math.max(2, Math.floor(Math.min(W, H) / 64));
        this._sprite.x = W / 2;
        this._sprite.targetX = W / 2;
        this._initAudio();
        this._startAnimation();
      });
  },

  _PS()      { return Math.max(2, Math.round(this._pixelSize * (this._stageScale || 1))); },
  _groundY() { return Math.floor(this._H * 0.82); },

  // ── 主循环 ─────────────────────────────────────────────────
  _startAnimation() {
    this._stopAll();
    this._lastFrame = Date.now();
    const loop = () => {
      const now = Date.now();
      const dt = Math.min(0.05, (now - this._lastFrame) / 1000);
      this._lastFrame = now;
      this._update(now, dt);
      this._draw(now);
      this._raf = this._canvasNode.requestAnimationFrame(loop);
    };
    loop();
  },

  _update(now, dt) {
    const pet = this.data.pet;
    if (!pet) return;

    if (!pet.isSleeping) {
      this._updateSprite(now, dt);
      this._updateBubble(now);
    }
    this._updateFood(now, dt);
    if (this._game) this._updateGame(now, dt);
  },

  // 宠物移动与散步决策
  _updateSprite(now, dt) {
    const p = this._sprite;
    const half = (GRID_COLS * this._PS()) / 2;
    const minX = half * 0.6 + 4;
    const maxX = this._W - half * 0.6 - 4;

    if (p.mode !== 'idle') {
      const speed = p.mode === 'dash' ? DASH_SPEED : WALK_SPEED;
      const dx = p.targetX - p.x;
      const step = speed * dt;
      if (Math.abs(dx) <= step) {
        p.x = p.targetX;
        p.mode = 'idle';
        this._nextDecisionAt = now + 1500 + Math.random() * 2500;
        this._onArrive();
      } else {
        p.x += Math.sign(dx) * step;
      }
    } else if (now >= this._nextDecisionAt && !this._game && !this._food) {
      // 没事干的时候随机散步
      if (Math.random() < 0.6) {
        p.targetX = Math.max(minX, Math.min(maxX, minX + Math.random() * (maxX - minX)));
        p.mode = 'walk';
      }
      this._nextDecisionAt = now + 2000 + Math.random() * 3000;
    }
    p.x = Math.max(minX, Math.min(maxX, p.x));
  },

  _onArrive() {
    // 到达掉落的食物 → 吃掉
    if (this._food && this._food.landed && Math.abs(this._sprite.x - this._food.x) < this._PS() * 4) {
      this._spawnParticles('♥', 3, this._food.x, this._groundY() - this._PS() * 8);
      this._food = null;
      this._sfxEat();
      try { wx.vibrateShort({ type: 'light' }); } catch (e) {}
      this._triggerHappyFlash(this.data.pet, '好吃！😋');
    }
  },

  // 想法泡泡：闲着时按心情冒一个
  _updateBubble(now) {
    if (this._bubble && now > this._bubble.until) this._bubble = null;
    if (this._bubble || this._game || now < this._nextBubbleAt) return;
    const pet = this.data.pet;
    let text;
    if (pet.hunger < 30)         text = pick(['🍖 ?', '好饿…']);
    else if (pet.happiness < 30) text = pick(['🐛 ?', '陪我玩嘛']);
    else                         text = pick(['♪', '★', '嗷呜~', '❤', '(・ω・)']);
    this._bubble = { text, until: now + 2500 };
    this._nextBubbleAt = now + 7000 + Math.random() * 6000;
  },

  // 掉落的肉排
  _updateFood(now, dt) {
    const f = this._food;
    if (!f) return;
    if (!f.landed) {
      f.y += 170 * dt;
      const floorY = this._groundY() - this._PS() * 2;
      if (f.y >= floorY) {
        f.y = floorY;
        f.landed = true;
        // 落地后 Clawd 冲过去
        this._sprite.targetX = f.x;
        this._sprite.mode = 'dash';
      }
    } else if (this._sprite.mode === 'idle') {
      this._onArrive();
    }
    if (now > f.expireAt) this._food = null;   // 兜底清理
  },

  // ── 抓 Bug 小游戏 ──────────────────────────────────────────
  _updateGame(now, dt) {
    const g = this._game;

    // 生成新 Bug：从左右两侧爬进来
    const alive = g.bugs.filter(b => !b.dead).length;
    if (now >= g.nextSpawnAt && alive < MAX_BUGS) {
      const fromLeft = Math.random() < 0.5;
      g.bugs.push({
        x: fromLeft ? -20 : this._W + 20,
        vx: (fromLeft ? 1 : -1) * (45 + Math.random() * 55),
        dead: false,
        deadAt: 0,
      });
      g.nextSpawnAt = now + 600 + Math.random() * 900;
    }

    // Bug 爬行 / 清理
    for (const b of g.bugs) {
      if (!b.dead) b.x += b.vx * dt;
    }
    g.bugs = g.bugs.filter(b =>
      (b.dead ? now - b.deadAt < 350 : b.x > -40 && b.x < this._W + 40)
    );

    if (now >= g.endsAt) this._finishGame();
  },

  async _finishGame() {
    const catches = this._game.catches;
    this._game = null;
    this.setData({ gamePlaying: false });
    this._sfxGameEnd(catches > 0);
    try {
      const result = await wx.cloud.callFunction({
        name: 'quickstartFunctions',
        data: { type: 'playWithPet' },
      });
      if (result.result?.success) {
        this._spawnParticles('⭐', 4, this._sprite.x, this._groundY() - this._PS() * 12);
        this._triggerHappyFlash(
          result.result.pet,
          catches > 0 ? `抓到 ${catches} 只 Bug！🎉` : '一只没抓到，但它玩得很开心~'
        );
      }
    } catch (e) {
      wx.showToast({ title: '网络错误', icon: 'none' });
    }
  },

  // ── 触摸：点 Bug / 点宠物 / 点哪走哪 ───────────────────────
  onCanvasTouch(e) {
    const pet = this.data.pet;
    if (!pet || pet.isSleeping) return;
    const t = e.touches && e.touches[0];
    if (!t) return;
    const x = t.x !== undefined ? t.x : t.clientX;
    const y = t.y !== undefined ? t.y : t.clientY;

    // 小游戏中优先判定 Bug（命中框放宽，方便手指点）
    if (this._game) {
      const gy = this._groundY();
      for (const b of this._game.bugs) {
        if (!b.dead && Math.abs(x - b.x) < 34 && Math.abs(y - (gy - this._PS() * 3)) < 56) {
          b.dead = true;
          b.deadAt = Date.now();
          this._game.catches++;
          this._spawnParticles('💥', 2, b.x, gy - this._PS() * 5);
          this._sfxCatch(this._game.catches);
          try { wx.vibrateShort({ type: 'light' }); } catch (err) {}
          // Clawd 冲过去凑热闹
          this._sprite.targetX = Math.max(20, Math.min(this._W - 20, b.x));
          this._sprite.mode = 'dash';
          return;
        }
      }
      // 没点中 Bug：指挥 Clawd 跑位
      this._sprite.targetX = Math.max(20, Math.min(this._W - 20, x));
      this._sprite.mode = 'dash';
      return;
    }

    // 平时：点到宠物 → 摸头；点空地 → 走过去
    const half = (GRID_COLS * this._PS()) / 2;
    if (Math.abs(x - this._sprite.x) < half * 0.8) {
      try { wx.vibrateShort({ type: 'light' }); } catch (err) {}
      this._tapBounceTick = 8;
      this._spawnParticles('♥', 2, this._sprite.x, this._groundY() - this._PS() * 14);
      if (!this.data.happyFlash) {
        this.setData({ happyFlash: true });
        setTimeout(() => this.setData({ happyFlash: false }), 600);
      }
    } else {
      this._sprite.targetX = Math.max(20, Math.min(this._W - 20, x));
      this._sprite.mode = 'walk';
    }
  },

  // ── 渲染 ───────────────────────────────────────────────────
  _draw(now) {
    const ctx = this._ctx;
    if (!ctx) return;
    const W = this._W, H = this._H;
    const PS = this._PS();
    const pet = this.data.pet;
    const isSleeping = pet?.isSleeping;

    // 背景（睡觉时更深）
    ctx.fillStyle = isSleeping ? '#08091A' : '#0E1024';
    ctx.fillRect(0, 0, W, H);
    const bgPS = PS * 4;
    ctx.fillStyle = isSleeping ? '#0D0E20' : '#131530';
    for (let col = 0; col < Math.ceil(W / bgPS); col++) {
      for (let row = 0; row < Math.ceil(H / bgPS); row++) {
        if ((col + row) % 2 === 0) ctx.fillRect(col * bgPS, row * bgPS, bgPS, bgPS);
      }
    }

    if (!pet) {
      const dots = '.'.repeat((Math.floor(now / 400) % 3) + 1);
      ctx.fillStyle = '#3A4A6A';
      ctx.font = `${PS * 3}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(dots, W / 2, H / 2);
      ctx.textAlign = 'left';
      return;
    }

    const gy = this._groundY();

    // 地面线（贯穿全屏）
    ctx.fillStyle = '#2E3A5C';
    ctx.fillRect(0, gy + 2, W, 2);

    // 掉落的肉排
    if (this._food) {
      ctx.font = `${PS * 4}px serif`;
      ctx.textAlign = 'center';
      ctx.fillText('🍖', this._food.x, this._food.y);
      ctx.textAlign = 'left';
    }

    // 小游戏 Bug
    if (this._game) {
      for (const b of this._game.bugs) this._drawBug(ctx, b, gy, now);
    }

    this._drawPetSprite(ctx, now, gy, isSleeping);

    // 想法泡泡
    if (this._bubble && !isSleeping) this._drawBubble(ctx, PS, gy);

    // ZZZ（睡觉）
    const t = now / 1200;
    if (isSleeping) {
      const spriteW = GRID_COLS * PS;
      const ox = Math.floor(this._sprite.x - spriteW / 2);
      const oy = gy - GRID_ROWS * PS;
      const zSz = Math.max(10, Math.round(PS * 2.8));
      ctx.font = `bold ${zSz}px monospace`;
      ctx.globalAlpha = 0.5 + Math.abs(Math.sin(t)) * 0.5;
      ctx.fillStyle = '#9BB8FF';
      ctx.fillText('z', ox + spriteW + PS * 2, oy + PS * 6);
      ctx.globalAlpha = 0.4 + Math.abs(Math.sin(t + 1)) * 0.4;
      ctx.fillText('Z', ox + spriteW + PS * 5, oy + PS * 2);
      ctx.globalAlpha = 1;
    }

    // ★（开心）
    if (this.data.happyFlash && !isSleeping) {
      const sSz = Math.max(8, Math.round(PS * 2.8));
      ctx.font = `bold ${sSz}px monospace`;
      ctx.fillStyle = '#FFD700';
      ctx.globalAlpha = 0.5 + Math.abs(Math.sin(t)) * 0.5;
      ctx.fillText('★', this._sprite.x - PS * 14, gy - PS * 14);
      ctx.globalAlpha = 0.5 + Math.abs(Math.sin(t + 1.5)) * 0.5;
      ctx.fillText('★', this._sprite.x + PS * 11, gy - PS * 16);
      ctx.globalAlpha = 1;
    }

    // 危急红边脉动
    if (pet.health < 20) {
      const alpha = 0.1 + Math.abs(Math.sin(now / 500)) * 0.15;
      ctx.fillStyle = '#FF2222';
      ctx.globalAlpha = alpha;
      const edge = 8;
      ctx.fillRect(0, 0, edge, H);
      ctx.fillRect(W - edge, 0, edge, H);
      ctx.fillRect(0, 0, W, edge);
      ctx.fillRect(0, H - edge, W, edge);
      ctx.globalAlpha = 1;
    }

    // 小游戏 HUD：倒计时 + 抓到数
    if (this._game) {
      const left = Math.max(0, Math.ceil((this._game.endsAt - now) / 1000));
      ctx.font = `bold ${PS * 3}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = left <= 5 ? '#FF6B6B' : '#F5C842';
      ctx.fillText(`${left}s`, W / 2, PS * 5);
      ctx.fillStyle = '#E8E8FF';
      ctx.font = `bold ${PS * 2.4}px monospace`;
      ctx.fillText(`🐛 × ${this._game.catches}`, W / 2, PS * 9);
      ctx.textAlign = 'left';
    }

    // 浮动粒子
    const fSz = Math.max(10, PS * 3.2);
    ctx.font = `${fSz}px serif`;
    this._particles = this._particles.filter(p => p.alpha > 0);
    this._particles.forEach(p => {
      p.y -= p.vy;
      p.alpha -= 0.022;
      if (p.alpha <= 0) return;
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillText(p.text, p.x, p.y);
    });
    ctx.globalAlpha = 1;
  },

  _drawPetSprite(ctx, now, gy, isSleeping) {
    const PS = this._PS();
    const p = this._sprite;
    const spriteW = GRID_COLS * PS;
    const spriteH = GRID_ROWS * PS;

    // 眨眼：每 3.5~5 秒闭眼 180ms
    let closed = isSleeping;
    if (!isSleeping && now >= this._blinkAt) {
      if (now > this._blinkAt + 180) {
        this._blinkAt = now + 3500 + Math.random() * 1500;
      } else {
        closed = true;
      }
    }

    // 走路交替抬腿；站立四腿齐全
    const moving = p.mode !== 'idle' && !isSleeping;
    const legFrame = moving ? Math.floor(now / 130) % 2 : 'all';

    // 站立小幅呼吸弹跳 / 走路小碎步颠簸 / 摸头大弹跳
    let bounce = 0;
    if (!isSleeping) {
      let amp = moving ? 0.5 : (this.data.happyFlash ? 2 : 1);
      if (this._tapBounceTick > 0) { amp = 4; this._tapBounceTick--; }
      bounce = Math.round(Math.sin(now / (moving ? 120 : 400)) * amp * PS * 0.8);
    }

    // 饥饿发抖
    const pet = this.data.pet;
    const shaking = pet && pet.hunger < 30 && !isSleeping && (now % 3000) < 450;
    const shakeOx = shaking ? Math.round(Math.sin(now / 60) * PS) : 0;

    const ox = Math.floor(p.x - spriteW / 2) + shakeOx;
    const oy = gy - spriteH + bounce;
    drawClawd(ctx, ox, oy, PS, { closed, legFrame });
  },

  _drawBubble(ctx, PS, gy) {
    const fs = Math.max(11, PS * 2.6);
    ctx.font = `${fs}px monospace`;
    const tw = ctx.measureText(this._bubble.text).width;
    const pad = PS * 1.5;
    const bw = tw + pad * 2;
    const bh = fs + pad * 1.4;
    let bx = this._sprite.x - bw / 2;
    bx = Math.max(4, Math.min(this._W - bw - 4, bx));
    const by = gy - GRID_ROWS * this._PS() - bh - PS * 3;

    ctx.fillStyle = '#F5F0E8';
    ctx.fillRect(bx, by, bw, bh);
    // 底部小三角指向宠物
    ctx.beginPath();
    ctx.moveTo(this._sprite.x - PS, by + bh);
    ctx.lineTo(this._sprite.x + PS, by + bh);
    ctx.lineTo(this._sprite.x, by + bh + PS * 1.6);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#1A1A2E';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this._bubble.text, bx + bw / 2, by + bh / 2 + 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  },

  _drawBug(ctx, bug, gy, now) {
    const S = Math.max(2, Math.round(this._PS() * 0.9));
    const bx = bug.x - 3 * S;
    if (bug.dead) {
      // 被拍扁：淡出的星花
      const t = (now - bug.deadAt) / 350;
      ctx.globalAlpha = Math.max(0, 1 - t);
      ctx.font = `${S * 5}px serif`;
      ctx.textAlign = 'center';
      ctx.fillText('✦', bug.x, gy - S * 2);
      ctx.textAlign = 'left';
      ctx.globalAlpha = 1;
      return;
    }
    const wob = Math.sin(now / 200 + bug.x / 9) * S * 0.5;
    const by = gy - 5 * S + wob;
    ctx.fillStyle = '#FF6B6B';
    BUG_PIXELS.forEach(([r, c]) => ctx.fillRect(bx + c * S, by + r * S, S, S));
    ctx.fillStyle = '#FFB3B3';
    BUG_EYES.forEach(([r, c]) => ctx.fillRect(bx + c * S, by + r * S, S, S));
  },

  // ── 粒子生成 ───────────────────────────────────────────────
  _spawnParticles(text, count, x, y) {
    const cx = x !== undefined ? x : this._W / 2;
    const cy = y !== undefined ? y : this._H / 2;
    for (let i = 0; i < count; i++) {
      this._particles.push({
        text,
        x: cx + (Math.random() - 0.5) * 40,
        y: cy,
        vy: 1.0 + Math.random() * 0.6,
        alpha: 1,
      });
    }
  },

  // ── 交互操作 ───────────────────────────────────────────────
  async onFeed() {
    const { pet, gamePlaying } = this.data;
    if (!pet) return;
    if (gamePlaying) { wx.showToast({ title: '先抓完 Bug 吧', icon: 'none' }); return; }
    if (pet.isSleeping) { wx.showToast({ title: '先叫醒它再喂吧', icon: 'none' }); return; }
    try {
      wx.showLoading({ title: '' });
      const result = await wx.cloud.callFunction({
        name: 'quickstartFunctions',
        data: { type: 'feedPet' },
      });
      wx.hideLoading();
      if (result.result?.success) {
        // 数值先更新，肉排从天而降，Clawd 落地后冲过去吃
        this.setData({ pet: result.result.pet });
        const margin = 40;
        this._food = {
          x: margin + Math.random() * (this._W - margin * 2),
          y: -10,
          landed: false,
          expireAt: Date.now() + 8000,
        };
        this._sfxDrop();
      }
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '喂食失败', icon: 'none' });
    }
  },

  onPlay() {
    const { pet, gamePlaying } = this.data;
    if (!pet || gamePlaying) return;
    if (pet.isSleeping) { wx.showToast({ title: '它还在睡觉呢', icon: 'none' }); return; }
    const now = Date.now();
    this._game = {
      endsAt: now + GAME_MS,
      bugs: [],
      catches: 0,
      nextSpawnAt: now + 400,
    };
    this._bubble = null;
    this.setData({ gamePlaying: true, statusText: '🐛 Bug 来了，快点它们！' });
    this._sfxGameStart();
  },

  async onToggleSleep() {
    const { pet, gamePlaying } = this.data;
    if (!pet) return;
    if (gamePlaying) { wx.showToast({ title: '先抓完 Bug 吧', icon: 'none' }); return; }
    try {
      const result = await wx.cloud.callFunction({
        name: 'quickstartFunctions',
        data: { type: 'toggleSleepPet' },
      });
      if (result.result?.success) {
        const newPet = result.result.pet;
        this._sprite.mode = 'idle';
        this._bubble = null;
        this.setData({ pet: newPet, statusText: this._getStatusText(newPet) });
      }
    } catch (e) {
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  _triggerHappyFlash(newPet, text) {
    if (this._happyFlashTimer) clearTimeout(this._happyFlashTimer);
    this.setData({ pet: newPet, happyFlash: true, statusText: text });
    this._happyFlashTimer = setTimeout(() => {
      this.setData({ happyFlash: false, statusText: this._getStatusText(this.data.pet) });
    }, 2500);
  },

  // ── 改名 ───────────────────────────────────────────────────
  onRenameShow() {
    this.setData({ showRename: true, renameInput: this.data.pet?.name || '' });
  },

  onRenameInput(e) {
    this.setData({ renameInput: e.detail.value });
  },

  async onRenameConfirm() {
    const name = this.data.renameInput.trim();
    if (!name) { wx.showToast({ title: '名字不能为空', icon: 'none' }); return; }
    try {
      const result = await wx.cloud.callFunction({
        name: 'quickstartFunctions',
        data: { type: 'namePet', name },
      });
      if (result.result?.success) {
        this.setData({ 'pet.name': result.result.name, showRename: false });
      }
    } catch (e) {
      wx.showToast({ title: '修改失败', icon: 'none' });
    }
  },

  onRenameCancel() {
    this.setData({ showRename: false });
  },

  // ── 音频（Web Audio 合成，不支持时静默降级）────────────────
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

  // 连抓音调递增，最多爬一个八度
  _sfxCatch(combo) {
    if (!this._ac) return;
    const now = this._ac.currentTime;
    const f = 440 * Math.pow(1.06, Math.min(12, combo));
    this._note(f, now, 0.08, 0.18);
    this._note(f * 1.5, now + 0.04, 0.08, 0.12);
  },

  _sfxEat() {
    if (!this._ac) return;
    const now = this._ac.currentTime;
    [392, 523].forEach((f, i) => this._note(f, now + i * 0.08, 0.1, 0.16));
  },

  _sfxDrop() {
    if (!this._ac) return;
    this._note(660, this._ac.currentTime, 0.09, 0.12, 'triangle');
  },

  _sfxGameStart() {
    if (!this._ac) return;
    const now = this._ac.currentTime;
    [523, 659, 784].forEach((f, i) => this._note(f, now + i * 0.09, 0.12, 0.18));
  },

  _sfxGameEnd(won) {
    if (!this._ac) return;
    const now = this._ac.currentTime;
    const seq = won ? [784, 1047] : [330, 262];
    seq.forEach((f, i) => this._note(f, now + i * 0.11, 0.14, 0.18));
  },
});
