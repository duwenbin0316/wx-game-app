// ── 像素色盘 ─────────────────────────────────────────────────
const COLORS = {
  1: '#CC6B52',  // 身体（三文鱼橙，Claude Code 色）
  2: '#1A1A2E',  // 眼睛/暗部
  3: '#E08870',  // 高光（头顶一行）
  4: '#A85642',  // 暗部（腿脚）
};

// 16列 × 10行像素精灵，带明暗层次
const SPRITE_BASE = [
  [0,0,1,1,1,1,1,1,1,1,1,1,1,1,0,0],  // 0: 头顶
  [0,0,3,3,3,3,3,3,3,3,3,3,3,3,0,0],  // 1: 额头高光
  // 行2-4：表情区（动态）
  [0,0,1,1,1,1,1,1,1,1,1,1,1,1,0,0],  // 2→体: 身体上
  [0,0,1,1,1,1,1,1,1,1,1,1,1,1,0,0],  // 3→体: 身体中
  [0,0,1,1,1,1,1,1,1,1,1,1,1,1,0,0],  // 4→体: 身体下
  [0,0,0,0,0,4,4,4,0,4,4,4,0,0,0,0],  // 5→体: 腿（暗色）
  [0,0,0,0,0,4,4,4,0,4,4,4,0,0,0,0],  // 6→体: 脚（暗色）
];

// 眼睛位置：左眼 col4-5，右眼 col10-11（各 2×2 方块）
const FACE_ROWS = {
  normal: [
    [0,0,1,1,2,2,1,1,1,1,2,2,1,1,0,0],
    [0,0,1,1,2,2,1,1,1,1,2,2,1,1,0,0],
    [0,0,1,1,1,1,1,1,1,1,1,1,1,1,0,0],
  ],
  blink: [
    [0,0,1,1,1,1,1,1,1,1,1,1,1,1,0,0],
    [0,0,1,1,2,1,1,1,1,1,2,1,1,1,0,0],
    [0,0,1,1,1,1,1,1,1,1,1,1,1,1,0,0],
  ],
  happy: [
    [0,0,1,1,2,1,1,1,1,1,2,1,1,1,0,0],  // 弯眼上角
    [0,0,1,1,1,2,1,1,1,2,1,1,1,1,0,0],  // 弯眼下角
    [0,0,1,1,1,1,1,1,1,1,1,1,1,1,0,0],
  ],
  sad: [
    [0,0,1,1,1,1,2,2,2,2,1,1,1,1,0,0],  // 皱眉（内角上挑）
    [0,0,1,1,2,2,1,1,1,1,2,2,1,1,0,0],
    [0,0,1,1,1,1,1,1,1,1,1,1,1,1,0,0],
  ],
  sleeping: [
    [0,0,1,1,1,1,1,1,1,1,1,1,1,1,0,0],  // 上眼皮闭
    [0,0,1,1,2,2,1,1,1,1,2,2,1,1,0,0],  // 下半眯睁
    [0,0,1,1,1,1,1,1,1,1,1,1,1,1,0,0],
  ],
  critical: [
    [0,0,1,1,2,1,2,1,1,2,1,2,1,1,0,0],  // ╲ 斜线眼
    [0,0,1,1,1,2,1,1,1,1,2,1,1,1,0,0],
    [0,0,1,1,1,1,1,1,1,1,1,1,1,1,0,0],
  ],
};

// 成年王冠（插在头顶上方）
const CROWN_ROW = [0,0,0,1,0,0,1,2,1,0,0,1,0,0,0,0];

function buildSprite(state, isAdult) {
  const face = FACE_ROWS[state] || FACE_ROWS.normal;
  const rows = [
    SPRITE_BASE[0], SPRITE_BASE[1],
    face[0], face[1], face[2],
    SPRITE_BASE[2], SPRITE_BASE[3], SPRITE_BASE[4],
    SPRITE_BASE[5], SPRITE_BASE[6],
  ];
  if (isAdult) rows.unshift(CROWN_ROW);
  return rows;
}

// ── 页面 ──────────────────────────────────────────────────────
Page({
  data: {
    pet: null,
    petAge: 1,
    stage: '',
    stageBadge: '',
    happyFlash: false,
    blinking: false,
    showRename: false,
    renameInput: '',
    statusText: '',
    loadError: '',
  },

  _canvasCtx: null,
  _canvasW: 0,
  _canvasH: 0,
  _pixelSize: 8,
  _stageScale: 1,
  _animTimer: null,
  _blinkTimerId: null,
  _happyFlashTimer: null,
  _shakeTimer: null,
  _shakeActive: false,
  _tapBounceTick: 0,
  _particles: [],
  _pageReady: false,

  onLoad() {
    this._loadPet();
  },

  onReady() {
    this._pageReady = true;
    this._initCanvas();
  },

  onShow() {
    if (this._pageReady && this._canvasCtx) {
      this._loadPet();
      this._startAnimation();
    }
  },

  onHide() {
    this._clearTimers();
  },

  onUnload() {
    this._clearTimers();
  },

  // ── 定时器管理 ─────────────────────────────────────────────
  _clearTimers() {
    if (this._animTimer)       { clearInterval(this._animTimer); this._animTimer = null; }
    if (this._blinkTimerId)    { clearTimeout(this._blinkTimerId); this._blinkTimerId = null; }
    if (this._happyFlashTimer) { clearTimeout(this._happyFlashTimer); this._happyFlashTimer = null; }
    if (this._shakeTimer)      { clearTimeout(this._shakeTimer); this._shakeTimer = null; }
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
        if (this._canvasCtx && !this._animTimer) {
          this._startAnimation();
        }
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
        this._canvasCtx = ctx;
        this._canvasW   = W;
        this._canvasH   = H;
        // 更细腻的像素尺寸（/ 28 而非 / 14）
        this._pixelSize = Math.max(4, Math.floor(Math.min(W, H) / 28));
        this._startAnimation();
      });
  },

  // ── 动画循环 ───────────────────────────────────────────────
  _startAnimation() {
    this._clearTimers();
    this._particles = [];
    this._drawPet();
    this._animTimer = setInterval(() => this._drawPet(), 100);

    const scheduleBlink = () => {
      this._blinkTimerId = setTimeout(() => {
        if (this.data.pet && !this.data.pet.isSleeping) {
          this.setData({ blinking: true });
          setTimeout(() => { this.setData({ blinking: false }); scheduleBlink(); }, 180);
        } else {
          scheduleBlink();
        }
      }, 3500 + Math.random() * 1500);
    };
    scheduleBlink();

    const scheduleShake = () => {
      this._shakeTimer = setTimeout(() => {
        const { pet } = this.data;
        if (pet && pet.hunger < 30 && !pet.isSleeping) {
          this._shakeActive = true;
          setTimeout(() => { this._shakeActive = false; scheduleShake(); }, 500);
        } else {
          scheduleShake();
        }
      }, 2000);
    };
    scheduleShake();
  },

  // ── 像素绘制 ───────────────────────────────────────────────
  _getPetState() {
    const { pet, happyFlash, blinking } = this.data;
    if (!pet)                                  return 'normal';
    if (pet.isSleeping)                        return 'sleeping';
    if (pet.health < 20)                       return 'critical';
    if (happyFlash)                            return 'happy';
    if (blinking)                              return 'blink';
    if (pet.hunger < 30 || pet.happiness < 30) return 'sad';
    return 'normal';
  },

  _drawPet() {
    const ctx = this._canvasCtx;
    if (!ctx) return;
    const W  = this._canvasW;
    const H  = this._canvasH;
    const PS = Math.max(4, Math.round(this._pixelSize * (this._stageScale || 1)));

    const { pet } = this.data;
    const isSleeping = pet?.isSleeping;
    const isAdult    = this.data.stage === '成年';

    // 背景（睡觉时更深）
    ctx.fillStyle = isSleeping ? '#08091A' : '#0E1024';
    ctx.fillRect(0, 0, W, H);

    // 棋盘背景（用 2×PS 格，不会太密）
    const bgPS = PS * 2;
    ctx.fillStyle = isSleeping ? '#0D0E20' : '#131530';
    for (let col = 0; col < Math.ceil(W / bgPS); col++) {
      for (let row = 0; row < Math.ceil(H / bgPS); row++) {
        if ((col + row) % 2 === 0) ctx.fillRect(col * bgPS, row * bgPS, bgPS, bgPS);
      }
    }

    if (!pet) {
      const dots = '.'.repeat((Math.floor(Date.now() / 400) % 3) + 1);
      ctx.fillStyle = '#3A4A6A';
      ctx.font = `${PS * 1.5}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(dots, W / 2, H / 2);
      ctx.textAlign = 'left';
      return;
    }

    const state   = this._getPetState();
    const sprite  = buildSprite(state, isAdult);
    const cols    = 16;
    const spriteW = cols * PS;
    const spriteH = sprite.length * PS;

    // 弹跳
    let bounceAmp = isSleeping ? 0 : (this.data.happyFlash ? 2 : 1);
    if (this._tapBounceTick > 0) { bounceAmp = 4; this._tapBounceTick--; }
    const bounce = Math.round(Math.sin(Date.now() / 400) * bounceAmp * PS * 0.4);

    // 饥饿摇晃
    const shakeOx = this._shakeActive ? Math.round(Math.sin(Date.now() / 80) * PS * 0.5) : 0;

    const ox = Math.floor((W - spriteW) / 2) + shakeOx;
    const oy = Math.floor((H - spriteH) / 2) + bounce;

    // 精灵绘制：内嵌式（每个像素格先填暗色，再内缩 1px 填主色）
    sprite.forEach((row, r) => {
      row.forEach((ci, c) => {
        if (!ci) return;
        ctx.fillStyle = '#0A0A1A';
        ctx.fillRect(ox + c * PS, oy + r * PS, PS, PS);
        ctx.fillStyle = COLORS[ci];
        ctx.fillRect(ox + c * PS + 1, oy + r * PS + 1, PS - 2, PS - 2);
      });
    });

    // 地面线
    ctx.fillStyle = '#2E3A5C';
    ctx.fillRect(ox - PS, oy + spriteH + 2, spriteW + PS * 2, 2);

    const t = Date.now() / 1200;

    // ZZZ（睡觉）
    if (state === 'sleeping') {
      const zSz = Math.max(10, Math.round(PS * 1.4));
      ctx.font = `bold ${zSz}px monospace`;
      ctx.globalAlpha = 0.5 + Math.abs(Math.sin(t)) * 0.5;
      ctx.fillStyle = '#9BB8FF';
      ctx.fillText('z', ox + spriteW + PS,       oy + PS * 3);
      ctx.globalAlpha = 0.4 + Math.abs(Math.sin(t + 1)) * 0.4;
      ctx.fillText('Z', ox + spriteW + PS * 2.5, oy + PS);
      ctx.globalAlpha = 1;
    }

    // ★（开心）
    if (state === 'happy') {
      const sSz = Math.max(8, Math.round(PS * 1.4));
      ctx.font = `bold ${sSz}px monospace`;
      ctx.fillStyle = '#FFD700';
      ctx.globalAlpha = 0.5 + Math.abs(Math.sin(t)) * 0.5;
      ctx.fillText('★', ox - PS * 3,             oy + PS * 3);
      ctx.globalAlpha = 0.5 + Math.abs(Math.sin(t + 1.5)) * 0.5;
      ctx.fillText('★', ox + spriteW + PS * 1.5, oy + PS * 2);
      ctx.globalAlpha = 1;
    }

    // 危急红边脉动
    if (pet.health < 20) {
      const alpha = 0.1 + Math.abs(Math.sin(Date.now() / 500)) * 0.15;
      ctx.fillStyle = '#FF2222';
      ctx.globalAlpha = alpha;
      const edge = 8;
      ctx.fillRect(0, 0, edge, H);
      ctx.fillRect(W - edge, 0, edge, H);
      ctx.fillRect(0, 0, W, edge);
      ctx.fillRect(0, H - edge, W, edge);
      ctx.globalAlpha = 1;
    }

    // 浮动粒子
    const fSz = Math.max(10, PS * 1.6);
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

  // ── 粒子生成 ───────────────────────────────────────────────
  _spawnParticles(text, count) {
    const W  = this._canvasW;
    const H  = this._canvasH;
    const PS = Math.max(4, Math.round(this._pixelSize * (this._stageScale || 1)));
    const spriteW = 16 * PS;
    const cx = W / 2;
    const cy = H / 2 - PS;
    for (let i = 0; i < count; i++) {
      this._particles.push({
        text,
        x: cx + (Math.random() - 0.5) * spriteW * 0.6,
        y: cy,
        vy: 1.0 + Math.random() * 0.6,
        alpha: 1,
      });
    }
  },

  // ── 点击宠物 ───────────────────────────────────────────────
  onTapPet() {
    if (!this.data.pet) return;
    wx.vibrateShort({ type: 'light' });
    this._tapBounceTick = 8;
    this._spawnParticles('♥', 2);
    if (!this.data.happyFlash) {
      this.setData({ happyFlash: true });
      setTimeout(() => this.setData({ happyFlash: false }), 600);
    }
  },

  // ── 交互操作 ───────────────────────────────────────────────
  async onFeed() {
    const { pet } = this.data;
    if (!pet) return;
    if (pet.isSleeping) { wx.showToast({ title: '先叫醒它再喂吧', icon: 'none' }); return; }
    try {
      wx.showLoading({ title: '' });
      const result = await wx.cloud.callFunction({
        name: 'quickstartFunctions',
        data: { type: 'feedPet' },
      });
      wx.hideLoading();
      if (result.result?.success) {
        this._spawnParticles('🍖', 3);
        this._triggerHappyFlash(result.result.pet, '好吃！😋');
      }
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '喂食失败', icon: 'none' });
    }
  },

  async onPlay() {
    const { pet } = this.data;
    if (!pet) return;
    if (pet.isSleeping) { wx.showToast({ title: '它还在睡觉呢', icon: 'none' }); return; }
    try {
      wx.showLoading({ title: '' });
      const result = await wx.cloud.callFunction({
        name: 'quickstartFunctions',
        data: { type: 'playWithPet' },
      });
      wx.hideLoading();
      if (result.result?.success) {
        this._spawnParticles('⭐', 3);
        this._triggerHappyFlash(result.result.pet, '超开心！🎉');
      }
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '玩耍失败', icon: 'none' });
    }
  },

  async onToggleSleep() {
    const { pet } = this.data;
    if (!pet) return;
    try {
      const result = await wx.cloud.callFunction({
        name: 'quickstartFunctions',
        data: { type: 'toggleSleepPet' },
      });
      if (result.result?.success) {
        const newPet = result.result.pet;
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
});
