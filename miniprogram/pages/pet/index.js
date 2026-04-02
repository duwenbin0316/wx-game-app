// ── 像素色盘 ─────────────────────────────────────────────────
const COLORS = {
  1: '#F4A030',  // 身体（橙色）
  2: '#7A3A00',  // 深棕（轮廓/暗部）
  3: '#1A1A2E',  // 深蓝（眼珠）
  4: '#FF7096',  // 粉红（鼻子）
  5: '#FFB8C8',  // 腮红
  7: '#7AB8FF',  // 蓝色（眼泪/zzz）
  8: '#D08020',  // 深橙（内耳）
};

// 12列 × 13行像素精灵，行0-3为头部，4-6为表情，7-12为身体
const SPRITE_BASE = [
  [0,0,1,1,0,0,0,0,1,1,0,0],  // 0: 耳尖
  [0,1,1,8,0,0,0,0,8,1,1,0],  // 1: 耳根（内耳色）
  [0,1,1,1,1,1,1,1,1,1,1,0],  // 2: 额头
  [0,1,1,1,1,1,1,1,1,1,1,0],  // 3: 脸上方
  // 行4-6：表情区（动态）
  [0,0,1,1,1,1,1,1,1,1,0,0],  // 4→体row7: 下巴
  [0,0,0,1,1,1,1,1,1,0,0,0],  // 5→体row8: 脖子
  [0,0,1,1,1,1,1,1,1,1,0,0],  // 6→体row9: 身体上
  [0,0,1,1,1,1,1,1,1,1,0,0],  // 7→体row10: 身体下
  [0,0,0,1,1,0,0,1,1,0,0,0],  // 8→体row11: 腿
  [0,0,0,1,1,0,0,1,1,0,0,0],  // 9→体row12: 脚
];

const FACE_ROWS = {
  normal: [
    [0,1,3,1,1,1,1,1,1,3,1,0],  // 眼睛（圆点）
    [0,1,1,1,5,1,4,1,5,1,1,0],  // 腮红 + 鼻子
    [0,1,1,1,1,2,2,1,1,1,1,0],  // 小微笑
  ],
  blink: [
    [0,1,2,2,1,1,1,1,2,2,1,0],  // 眨眼（横线）
    [0,1,1,1,5,1,4,1,5,1,1,0],
    [0,1,1,1,1,2,2,1,1,1,1,0],
  ],
  happy: [
    [0,1,2,2,1,1,1,1,2,2,1,0],  // 弯弯眼
    [0,5,5,1,5,1,4,1,5,1,5,0],  // 大腮红 + 鼻子
    [0,1,2,1,1,2,2,1,1,2,1,0],  // U形大笑
  ],
  sad: [
    [0,1,3,1,1,1,1,1,1,3,1,0],  // 普通眼
    [0,1,7,1,5,1,4,1,5,7,1,0],  // 眼泪 + 腮红
    [0,1,1,2,2,2,2,2,2,2,1,0],  // 皱眉
  ],
  sleeping: [
    [0,1,2,2,1,1,1,1,2,2,1,0],  // 闭眼
    [0,1,1,1,1,1,4,1,1,1,1,0],  // 只剩鼻子
    [0,1,1,1,1,1,1,1,1,1,1,0],  // 嘴巴平
  ],
  critical: [
    [0,1,2,3,2,1,1,2,3,2,1,0],  // X形眼
    [0,1,1,1,5,1,4,1,5,1,1,0],
    [0,1,2,1,2,1,2,1,2,1,2,0],  // 锯齿嘴
  ],
};

function buildSprite(state) {
  const face = FACE_ROWS[state] || FACE_ROWS.normal;
  return [
    SPRITE_BASE[0], SPRITE_BASE[1], SPRITE_BASE[2], SPRITE_BASE[3],
    face[0], face[1], face[2],
    SPRITE_BASE[4], SPRITE_BASE[5], SPRITE_BASE[6],
    SPRITE_BASE[7], SPRITE_BASE[8], SPRITE_BASE[9],
  ];
}

// ── 页面 ──────────────────────────────────────────────────────
Page({
  data: {
    pet: null,
    petAge: 1,
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
  _pixelSize: 10,
  _animTimer: null,
  _blinkTimerId: null,
  _happyFlashTimer: null,
  _pageReady: false,

  onLoad() {
    this._loadPet();
  },

  onReady() {
    this._pageReady = true;
    this._initCanvas();
  },

  onShow() {
    // 重新出现时刷新宠物状态，并重启动画
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
    if (this._animTimer)    { clearInterval(this._animTimer); this._animTimer = null; }
    if (this._blinkTimerId) { clearTimeout(this._blinkTimerId); this._blinkTimerId = null; }
    if (this._happyFlashTimer) { clearTimeout(this._happyFlashTimer); this._happyFlashTimer = null; }
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
        this.setData({
          pet,
          petAge: this._computeAge(pet),
          statusText: this._getStatusText(pet),
          loadError: '',
        });
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
        this._pixelSize = Math.max(6, Math.floor(Math.min(W, H) / 14));
        this._startAnimation();
      });
  },

  // ── 动画循环 ───────────────────────────────────────────────
  _startAnimation() {
    this._clearTimers();
    this._drawPet();
    this._animTimer = setInterval(() => this._drawPet(), 100);

    const scheduleBlink = () => {
      this._blinkTimerId = setTimeout(() => {
        if (this.data.pet && !this.data.pet.isSleeping) {
          this.setData({ blinking: true });
          setTimeout(() => {
            this.setData({ blinking: false });
            scheduleBlink();
          }, 180);
        } else {
          scheduleBlink();
        }
      }, 3500 + Math.random() * 1500);
    };
    scheduleBlink();
  },

  // ── 像素绘制 ───────────────────────────────────────────────
  _getPetState() {
    const { pet, happyFlash, blinking } = this.data;
    if (!pet)                                       return 'normal';
    if (pet.isSleeping)                             return 'sleeping';
    if (pet.health < 20)                            return 'critical';
    if (happyFlash)                                 return 'happy';
    if (blinking)                                   return 'blink';
    if (pet.hunger < 30 || pet.happiness < 30)      return 'sad';
    return 'normal';
  },

  _drawPet() {
    const ctx = this._canvasCtx;
    if (!ctx) return;
    const W  = this._canvasW;
    const H  = this._canvasH;
    const PS = this._pixelSize;

    // 背景
    ctx.fillStyle = '#0E1024';
    ctx.fillRect(0, 0, W, H);

    // 像素点网格背景
    ctx.fillStyle = '#131530';
    for (let col = 0; col < Math.ceil(W / PS); col++) {
      for (let row = 0; row < Math.ceil(H / PS); row++) {
        if ((col + row) % 2 === 0) ctx.fillRect(col * PS, row * PS, PS, PS);
      }
    }

    if (!this.data.pet) {
      // 加载中
      const dots = '.'.repeat((Math.floor(Date.now() / 400) % 3) + 1);
      ctx.fillStyle = '#3A4A6A';
      ctx.font = `${PS * 1.2}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(dots, W / 2, H / 2);
      ctx.textAlign = 'left';
      return;
    }

    const state    = this._getPetState();
    const sprite   = buildSprite(state);
    const spriteW  = 12 * PS;
    const spriteH  = 13 * PS;

    // 弹跳动画
    const bounceAmp = state === 'sleeping' ? 0 : (this.data.happyFlash ? 2 : 1);
    const bounce    = Math.round(Math.sin(Date.now() / 400) * bounceAmp * PS * 0.4);
    const ox = Math.floor((W - spriteW) / 2);
    const oy = Math.floor((H - spriteH) / 2) + bounce;

    sprite.forEach((row, r) => {
      row.forEach((ci, c) => {
        if (!ci) return;
        ctx.fillStyle = COLORS[ci];
        ctx.fillRect(ox + c * PS, oy + r * PS, PS, PS);
      });
    });

    const t = Date.now() / 1200;

    // 睡觉时的 ZZZ
    if (state === 'sleeping') {
      const zSz = Math.max(10, Math.round(PS * 1.2));
      ctx.font = `bold ${zSz}px monospace`;
      ctx.globalAlpha = 0.5 + Math.abs(Math.sin(t)) * 0.5;
      ctx.fillStyle = '#9BB8FF';
      ctx.fillText('z', ox + spriteW + PS,        oy + PS * 3);
      ctx.globalAlpha = 0.4 + Math.abs(Math.sin(t + 1)) * 0.4;
      ctx.fillText('Z', ox + spriteW + PS * 2.5,  oy + PS);
      ctx.globalAlpha = 1;
    }

    // 开心时的星星
    if (state === 'happy') {
      const sSz = Math.max(8, Math.round(PS * 1.2));
      ctx.font = `bold ${sSz}px monospace`;
      ctx.fillStyle = '#FFD700';
      ctx.globalAlpha = 0.5 + Math.abs(Math.sin(t)) * 0.5;
      ctx.fillText('★', ox - PS * 3,             oy + PS * 3);
      ctx.globalAlpha = 0.5 + Math.abs(Math.sin(t + 1.5)) * 0.5;
      ctx.fillText('★', ox + spriteW + PS * 1.5, oy + PS * 2);
      ctx.globalAlpha = 1;
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
