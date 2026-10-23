// ─── 苍穹之翼 SKY WING(竖版射击)──────────────────────────
// 画面:程序化地形(utils/sky-terrain)+ 预渲染精灵图集(utils/sky-art),
// 两层云的视差、空中单位的地面投影、叠加混合的爆炸 / 光晕。
// 玩法:击落敌机掉星星 → 机库里升级(主炮 / 导弹 / 装甲 / 磁铁 / 炸弹);
// 每关结尾一个多部件 Boss:先拆炮塔,核心才会打开;每关三枚勋章。
// 逻辑坐标是宽 360 的虚拟像素,渲染时按屏幕宽度缩放。
const D = require('../../utils/sky-data');
const { buildArt } = require('../../utils/sky-art');
const { Terrain } = require('../../utils/sky-terrain');
const { SkyAudio } = require('../../utils/sky-audio');

const VW = D.VW;
const SAVE_KEY = 'skywing_save';
const FIRE_GAP = 0.075;          // 主炮射击间隔
const BULLET_SPEED = 950;
const FINGER_OFFSET = 56;      // 战机在手指上方多少虚拟像素
const SLOW_SCALE = 0.1;         // 松手后战场时间流速
const MAX_FLY = 1600;          // 按下后飞向手指的最大速度(虚拟像素/秒)
const PLAYER_R = 6;              // 玩家判定半径(比机身小,方便擦弹)
const MAX_EB = 280;              // 敌弹上限
const MAX_FX = 420;

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function rnd(a, b) { return a + Math.random() * (b - a); }
function removeAt(arr, i) { arr[i] = arr[arr.length - 1]; arr.pop(); }

function defaultSave() {
  return { stars: 0, unlocked: 1, up: { cannon: 1, missile: 0, armor: 0, magnet: 0, bomb: 0 }, medals: {}, best: {} };
}

Page({
  data: {
    screen: 'loading',      // loading | hangar | play | pause | result
    loadingText: '机库整备中…',
    bank: 0,
    stages: [],
    sel: 1,
    upgrades: [],
    bombs: 0,
    muted: false,
    result: null,
  },

  // ── 生命周期 ──────────────────────────────────────────
  onLoad() {
    // iPhone 静音开关打开时默认会静音,射击游戏的音效让它照常播放
    try { wx.setInnerAudioOption({ obeyMuteSwitch: false, mixWithOther: true }); } catch (e) {}
    this._save = this.loadSave();
    this._audio = new SkyAudio();
    this._audio.setMuted(!!this._save.muted);
    this.setData({ muted: !!this._save.muted, sel: Math.min(this._save.unlocked, 3) });
  },

  onReady() {
    const info = wx.getSystemInfoSync();
    this._dpr = info.pixelRatio || 2;
    wx.createSelectorQuery().select('#sky').fields({ node: true, size: true }).exec(res => {
      const r = res && res[0];
      if (!r || !r.node) return;
      const canvas = r.node;
      canvas.width = Math.round(r.width * this._dpr);
      canvas.height = Math.round(r.height * this._dpr);
      this._canvas = canvas;
      this._ctx = canvas.getContext('2d');
      this._W = r.width;
      this._H = r.height;
      this._k = r.width / VW;          // 虚拟像素 → CSS 像素
      this._VH = r.height / this._k;   // 虚拟画面高度
      this._q = 2;
      this._dtAcc = 0;
      this._dtN = 0;
      setTimeout(() => this.initArt(), 30);   // 先让"整备中"显示出来
    });
  },

  onShow() {
    if (this._canvas && this._rects) this.startLoop();
  },

  onHide() {
    if (this.data.screen === 'play') this.onPause();
    this.stopLoop();
    if (this._audio) this._audio.stopMusic();
  },

  onUnload() {
    this.stopLoop();
    if (this._audio) {
      this._audio.close();
      this._audio = null;
    }
  },

  onShareAppMessage() {
    const r = this.data.result;
    return {
      title: r && r.win ? `我在苍穹之翼通关了「${r.stageName}」,${r.score} 分!` : '苍穹之翼:升级战机、击落巨舰,来一局!',
      path: '/pages/skywing/index',
    };
  },

  noop() {},

  // ── 资源 ─────────────────────────────────────────────
  createCanvas(w, h) {
    return wx.createOffscreenCanvas({ type: '2d', width: w, height: h });
  },

  // 离屏画布 → 可以 drawImage 的图片(失败时回调 null,调用方退回直接画画布)
  toImage(canvas, cb) {
    wx.canvasToTempFilePath({
      canvas,
      fileType: 'png',
      success: r => {
        const img = this._canvas.createImage();
        img.onload = () => cb(img);
        img.onerror = () => cb(null);
        img.src = r.tempFilePath;
      },
      fail: () => cb(null),
    });
  },

  initArt() {
    let art;
    try {
      art = buildArt((w, h) => this.createCanvas(w, h));
    } catch (e) {
      this.setData({ loadingText: '图形初始化失败,请升级微信后重试' });
      return;
    }
    this._rects = art.rects;
    this._img = null;
    this.toImage(art.canvas, img => {
      this._img = img || art.canvas;
      this.enterHangar();
      this.startLoop();
    });
  },

  // ── 存档 ─────────────────────────────────────────────
  loadSave() {
    let s = null;
    try { s = wx.getStorageSync(SAVE_KEY); } catch (e) {}
    const d = defaultSave();
    if (!s || typeof s !== 'object') return d;
    return Object.assign(d, s, { up: Object.assign(d.up, s.up || {}) });
  },

  writeSave() {
    try { wx.setStorageSync(SAVE_KEY, this._save); } catch (e) {}
  },

  // ── 机库 ─────────────────────────────────────────────
  enterHangar() {
    this._g = null;
    this._audio.stopMusic();
    this._audio.setMusicLevel(1);
    this.buildAttract(this.data.sel);
    this.refreshHangar();
    this.setData({ screen: 'hangar', result: null });
  },

  refreshHangar() {
    const s = this._save;
    const stages = D.STAGES.map(st => {
      const m = s.medals[st.id] || [false, false, false];
      return { id: st.id, name: st.name, en: st.en, locked: st.id > s.unlocked, medals: m, best: s.best[st.id] || 0 };
    });
    const upgrades = D.UPGRADES.map(u => {
      const lv = s.up[u.id];
      const maxed = lv >= u.max;
      const cost = maxed ? 0 : u.cost[lv];
      const pips = [];
      for (let i = 1; i <= u.max; i++) pips.push(i <= lv);
      return { id: u.id, name: u.name, lv, max: u.max, desc: u.desc(lv), cost, maxed, canBuy: !maxed && s.stars >= cost, pips };
    });
    this.setData({ bank: s.stars, stages, upgrades });
  },

  onSelectStage(e) {
    this._audio.unlock();
    const id = +e.currentTarget.dataset.id;
    if (id > this._save.unlocked) {
      wx.showToast({ title: '通关上一关后解锁', icon: 'none' });
      return;
    }
    if (id === this.data.sel) return;
    this._audio.click();
    this.setData({ sel: id });
    this.buildAttract(id);
  },

  onBuy(e) {
    this._audio.unlock();
    const id = e.currentTarget.dataset.id;
    const u = D.UPGRADES.find(x => x.id === id);
    const s = this._save;
    const lv = s.up[id];
    if (!u || lv >= u.max) return;
    const cost = u.cost[lv];
    if (s.stars < cost) {
      wx.showToast({ title: `还差 ${cost - s.stars} 颗星星`, icon: 'none' });
      return;
    }
    s.stars -= cost;
    s.up[id] = lv + 1;
    this.writeSave();
    this.refreshHangar();
    this._audio.buy();
    if (this._attract) this._attract.flash = 1;
  },

  onToggleMute() {
    this._audio.unlock();
    const m = !this.data.muted;
    this._save.muted = m;
    this.writeSave();
    this._audio.setMuted(m);
    this._audio.click();
    this.setData({ muted: m });
  },

  // 机库背景:选中关卡的地形缓缓卷动,战机悬停
  buildAttract(stageId) {
    const st = D.STAGES[stageId - 1];
    // 地形分帧生成,不在这里同步算(慢设备上会卡住界面好几秒)
    const t = new Terrain(st.biome, st.seed, VW, (w, h) => this.createCanvas(w, h), (c, cb) => this.toImage(c, cb));
    // 新地图生成好之前继续显示旧地图,好了再淡入,切换关卡不闪
    const old = this._attract;
    let prev = null;
    if (old) {
      if (old.terrain.ready(old.scroll, this._VH, true)) prev = { terrain: old.terrain, scroll: old.scroll };
      else if (old.prev) prev = old.prev;
    }
    this._attract = { terrain: t, stageId, scroll: 0, t: old ? old.t : 0, clouds: old ? old.clouds : [], flash: 0, prev, fade: 0 };
    if (!old) for (let i = 0; i < 3; i++) this.spawnCloud(this._attract.clouds, rnd(0, this._VH));
  },

  // ── 开局 ─────────────────────────────────────────────
  onStart() {
    if (this.data.screen !== 'hangar') return;
    const st = D.STAGES[(this.data.sel || 1) - 1] || D.STAGES[0];
    this._audio.unlock();
    try { wx.vibrateShort({ type: 'light' }); } catch (e) {}
    this._audio.launch();
    try {
      // 机库背景就是这一关的地形:直接接着用,出击无需等待
      const a = this._attract;
      const reuse = a && a.stageId === st.id ? { terrain: a.terrain, scroll: a.scroll } : null;
      this.startStage(st, reuse);
    } catch (e) {
      console.error('skywing start failed', e);
      wx.showToast({ title: `启动失败:${(e && e.message) || e}`, icon: 'none', duration: 3000 });
    }
  },

  // reuse: { terrain, scroll } 复用已经生成好的地形
  startStage(st, reuse) {
    const up = this._save.up;
    const VH = this._VH;
    const terrain = reuse ? reuse.terrain : new Terrain(st.biome, st.seed, VW, (w, h) => this.createCanvas(w, h), (c, cb) => this.toImage(c, cb));
    const scroll0 = reuse ? reuse.scroll : 0;
    this._attract = null;
    this._drag = null;
    this._audio.setMusicLevel(1);
    const maxHp = 100 + up.armor * 30;
    this._g = {
      stage: st,
      sc: D.stageScale(st.id),
      script: D.buildScript(st),
      ev: 0,
      terrain,
      scroll: scroll0,      // 地形卷动位置(地面单位用它定位)
      dist: 0,              // 本关飞行距离(出怪脚本 / 进度条用它)
      loading: !terrain.ready(scroll0, VH, true),
      loadT: 0,
      speed: st.speed,
      t: 0,
      player: { x: VW / 2, y: VH + 60, tx: VW / 2, ty: VH * 0.78, hp: maxHp, maxHp, inv: 0, bank: 0, fireT: 0, misT: 0.5, alive: true, dieT: 0, vx: 0 },
      pb: [], pm: [], eb: [], enemies: [], fx: [], pickups: [], decals: [], clouds: [],
      boss: null,
      stats: { spawned: 0, killed: 0, damaged: false, stars: 0, score: 0, starChain: 0, maxCombo: 0 },
      shake: 0, flash: 0, flashColor: '255,255,255',
      ts: 1, slowA: 0, rt: 0, hitStop: 0, combo: 0, comboT: 0, comboPop: 0,
      intro: 3, warnT: 0, overT: 0, clearT: 0,
      bombs: 1 + up.bomb, bombCd: 0,
      powT: 0, lowHp: 0,
      cloudT: 0,
    };
    for (let i = 0; i < 3; i++) this.spawnCloud(this._g.clouds, rnd(0, VH));
    this.setData({ screen: 'play', bombs: this._g.bombs, result: null });
    if (!this._g.loading) this._audio.playMusic('battle');
  },

  onPause() {
    if (this.data.screen !== 'play') return;
    this._drag = null;
    this._audio.stopMusic();
    this.setData({ screen: 'pause' });
  },

  onResume() {
    if (this.data.screen !== 'pause') return;
    this._audio.unlock();
    this._lastTs = 0;
    this.setData({ screen: 'play' });
    this._audio.playMusic(this._g && this._g.boss ? 'boss' : 'battle');
  },

  onQuit() {
    if (this.data.screen !== 'pause') return;
    // 中途退出:已拾取的星星照样入账
    if (this._g) {
      this._save.stars += this._g.stats.stars;
      this.writeSave();
    }
    this.enterHangar();
  },

  onRetry() {
    if (this.data.screen !== 'result') return;
    this._audio.unlock();
    const st = this._g ? this._g.stage : D.STAGES[this.data.sel - 1];
    this.startStage(st);
  },

  onNext() {
    if (this.data.screen !== 'result') return;
    this._audio.unlock();
    const next = Math.min(3, (this._g ? this._g.stage.id : this.data.sel) + 1);
    this.setData({ sel: next });
    this.startStage(D.STAGES[next - 1]);
  },

  onBackHangar() {
    if (this.data.screen !== 'result') return;
    this.enterHangar();
  },

  // ── 输入:跟手(按下时战机飞到手指上方,之后跟着手指走)──
  // 战机停在手指上方一点,免得被手指挡住
  touchTarget(t) {
    const p = this._g.player;
    p.tx = clamp(t.clientX / this._k, 14, VW - 14);
    p.ty = clamp(t.clientY / this._k - FINGER_OFFSET, 60, this._VH - 30);
  },

  // 只跟踪按下的那根手指(另一根手指去按炸弹时不会抢走战机)
  findTouch(list, id) {
    if (!list) return null;
    for (let i = 0; i < list.length; i++) if (list[i].identifier === id) return list[i];
    return null;
  },

  onTouchStart(e) {
    if (this.data.screen !== 'play' || !this._g) return;
    this._audio.unlock();
    const t = (e.changedTouches && e.changedTouches[0]) || e.touches[0];
    if (!t) return;
    this._drag = { id: t.identifier };
    this.touchTarget(t);
  },

  onTouchMove(e) {
    if (!this._drag || !this._g) return;
    const t = this.findTouch(e.touches, this._drag.id) || (e.touches && e.touches.length === 1 ? e.touches[0] : null);
    if (t) this.touchTarget(t);
  },

  onTouchEnd(e) {
    if (!this._drag) return;
    const left = e && e.touches;
    if (left && left.length && this.findTouch(left, this._drag.id)) return;   // 抬起的是别的手指
    this._drag = null;
  },

  onBomb() {
    const g = this._g;
    if (!g || this.data.screen !== 'play' || !g.player.alive || g.bombs <= 0 || g.bombCd > 0) return;
    g.bombs--;
    g.bombCd = 1.2;
    g.player.inv = Math.max(g.player.inv, 1.2);
    this.setData({ bombs: g.bombs });
    this._audio.bomb();
    try { wx.vibrateShort({ type: 'heavy' }); } catch (e) {}
    // 敌弹全部化为火花
    g.eb.forEach(b => this.addFx({ spr: 'g_y', x: b.x, y: b.y, vx: 0, vy: 0, life: 0.3, size: 14, size1: 0, add: true }));
    g.eb.length = 0;
    g.flash = 0.8;
    g.flashColor = '255,250,230';
    g.shake = 14;
    const p = g.player;
    this.addFx({ spr: 'ring', x: p.x, y: p.y, life: 0.9, size: 40, size1: 900, add: true, alpha: 1 });
    this.addFx({ spr: 'g_w', x: p.x, y: p.y, life: 0.6, size: 200, size1: 700, add: true, alpha: 0.9 });
    g.enemies.forEach(en => {
      if (this.onScreen(en.x, en.y, 20)) this.damageEnemy(en, 60, en.x, en.y);
    });
    if (g.boss && g.boss.state === 'fight') {
      g.boss.parts.forEach(pt => { if (pt.alive) this.damagePart(pt, 40); });
      if (g.boss.core.open) this.damageCore(60);
    }
  },

  // ── 主循环 ───────────────────────────────────────────
  startLoop() {
    if (this._raf || !this._canvas) return;
    this._lastTs = 0;
    const step = ts => {
      this._raf = this._canvas.requestAnimationFrame(step);
      const raw = this._lastTs ? (ts - this._lastTs) / 1000 : 0.016;
      this._lastTs = ts;
      const dt = Math.min(0.05, raw);
      this.watchFps(raw);
      try {
        this.update(dt);
        this.render();
      } catch (e) {
        console.error('skywing frame error', e);
      }
    };
    this._raf = this._canvas.requestAnimationFrame(step);
  },

  stopLoop() {
    if (this._raf && this._canvas) this._canvas.cancelAnimationFrame(this._raf);
    this._raf = null;
  },

  // 帧率持续偏低就降画质(只降不升)
  watchFps(raw) {
    if (this._q <= 0 || raw > 0.25 || this.data.screen !== 'play') return;
    this._dtAcc += raw;
    this._dtN++;
    if (this._dtAcc < 2.5) return;
    if (this._dtAcc / this._dtN > 0.026) this._q--;
    this._dtAcc = 0;
    this._dtN = 0;
  },

  update(dt) {
    const screen = this.data.screen;
    if (screen === 'hangar' || screen === 'loading') {
      this.updateAttract(dt);
      return;
    }
    if (screen === 'pause' || !this._g) return;
    if (screen === 'result') {
      // 结算时背景继续动(特效收尾)
      this.updateFx(dt);
      this.updateClouds(this._g.clouds, dt, this._g.speed);
      return;
    }
    this.updateGame(dt);
  },

  updateAttract(dt) {
    const a = this._attract;
    if (!a) return;
    a.t += dt;
    a.scroll += 30 * dt;
    const VH = this._VH;
    const ready = a.terrain.ready(a.scroll, VH, true);
    a.terrain.update(a.scroll, VH, ready ? 4 : 14);
    if (ready) a.fade = Math.min(1, a.fade + dt * 2.5);
    if (a.prev) {
      a.prev.scroll += 30 * dt;
      a.prev.terrain.update(a.prev.scroll, VH, 2);
      if (a.fade >= 1) a.prev = null;
    }
    this.updateClouds(a.clouds, dt, 30);
    if (a.flash > 0) a.flash = Math.max(0, a.flash - dt * 2);
  },

  updateGame(dt) {
    const g = this._g;
    const VH = this._VH;
    // 加载阶段:地形在后台加大预算生成,可见区域就绪后再开打
    if (g.loading) {
      g.loadT += dt;
      g.terrain.update(g.scroll, VH, 22);
      if (g.terrain.ready(g.scroll, VH, true) || (g.loadT > 6 && g.terrain.ready(g.scroll, VH, false))) {
        g.loading = false;
        this._audio.playMusic('battle');
      }
      return;
    }
    // 松手子弹时间:没有手指按着时整个战场缓缓减速到几乎静止,按下立刻恢复
    const rdt = dt;
    const p0 = g.player;
    const slow = !this._drag && p0.alive && g.intro < 2 && !(g.boss && g.boss.state === 'dead');
    g.ts += ((slow ? SLOW_SCALE : 1) - g.ts) * Math.min(1, rdt * (slow ? 3.5 : 14));
    if (!slow && g.ts > 0.995) g.ts = 1;
    g.slowA = (1 - g.ts) / (1 - SLOW_SCALE);
    this._audio.setMusicLevel(1 - g.slowA * 0.65);
    if (g.intro > 0) g.intro -= rdt;
    dt = rdt * g.ts;
    if (g.hitStop > 0) {
      g.hitStop -= rdt;
      dt *= 0.12;
    }
    if (g.comboT > 0) g.comboT -= dt;
    if (g.comboPop > 0) g.comboPop = Math.max(0, g.comboPop - rdt * 6);
    g.t += dt;
    g.rt += rdt;
    if (g.bombCd > 0) g.bombCd -= dt;
    if (g.powT > 0) g.powT -= dt;
    if (g.warnT > 0) g.warnT -= dt;

    // 卷动:Boss 战时放慢
    const target = g.boss ? g.stage.speed * 0.3 : g.stage.speed;
    g.speed += (target - g.speed) * Math.min(1, dt * 1.5);
    g.scroll += g.speed * dt;
    g.dist += g.speed * dt;
    // 屏幕上有块还没生成好时临时加大预算
    g.terrain.update(g.scroll, VH, g.terrain.ready(g.scroll, VH) ? 3 : 12);

    // 出怪脚本
    while (g.ev < g.script.length && g.script[g.ev].at <= g.dist) {
      this.runEvent(g.script[g.ev]);
      g.ev++;
    }

    this.updatePlayer(dt, rdt);
    this.updatePlayerShots(dt);
    this.updateEnemies(dt);
    if (g.boss) this.updateBoss(dt);
    this.updateEnemyBullets(dt);
    this.updatePickups(dt);
    this.updateFx(dt);
    this.updateClouds(g.clouds, dt, g.speed);
    g.decals.forEach(dc => { dc.life -= dt; });
    g.decals = g.decals.filter(dc => dc.life > 0 && this.groundY(dc.wy) < VH + 40);

    if (g.shake > 0) g.shake = Math.max(0, g.shake - dt * 30);
    if (g.flash > 0) g.flash = Math.max(0, g.flash - dt * 2.2);

    // 结束判定
    if (!g.player.alive) {
      g.overT += dt;
      if (g.overT > 2) this.finish(false);
    } else if (g.boss && g.boss.state === 'dead') {
      g.clearT += dt;
      // 让玩家把星星吸完
      g.pickups.forEach(pk => { pk.magnet = true; });
      if (g.clearT > 2.6) this.finish(true);
    }
  },

  // ── 玩家 ─────────────────────────────────────────────
  // dt:战场时间(子弹时间里会变慢);rdt:真实时间(战机跟手永远不减速)
  updatePlayer(dt, rdt) {
    const g = this._g;
    const p = g.player;
    if (!p.alive) return;
    const mdt = rdt || dt;
    // 开场从屏幕下方飞入
    if (g.intro > 2.2) {
      p.y += (p.ty - p.y) * Math.min(1, mdt * 3);
    } else {
      const dt = mdt;
      // 跟手:近处快速贴合,远处(刚按下)限速飞过去,不会瞬移
      const k = Math.min(1, dt * 22);
      let dx = (p.tx - p.x) * k;
      let dy = (p.ty - p.y) * k;
      const d = Math.hypot(dx, dy);
      const cap = MAX_FLY * dt;
      if (d > cap) { dx *= cap / d; dy *= cap / d; }
      p.vx = dx / Math.max(dt, 0.001);
      p.x += dx;
      p.y += dy;
    }
    p.bank += (clamp(p.vx / 260, -2, 2) - p.bank) * Math.min(1, mdt * 10);
    if (p.mz > 0) p.mz -= dt * 16;
    if (p.inv > 0) p.inv -= dt;

    if (g.intro > 2) return;
    const up = this._save.up;
    // 主炮(拾取"P"后临时 +1 级)
    p.fireT -= dt;
    if (p.fireT <= 0) {
      p.fireT += FIRE_GAP;
      const lv = Math.min(6, up.cannon + (g.powT > 0 ? 1 : 0));
      p.mz = 1;
      D.CANNON[lv].forEach(c => {
        g.pb.push({ x: p.x + c.dx, y: p.y - 22, vx: Math.sin(c.a) * BULLET_SPEED, vy: -Math.cos(c.a) * BULLET_SPEED, a: c.a, dmg: 1 });
      });
      this._audio.shot();
    }
    // 追踪导弹
    if (up.missile > 0) {
      p.misT -= dt;
      if (p.misT <= 0) {
        p.misT = 0.95 - up.missile * 0.11;
        [-1, 1].forEach(s => g.pm.push({ x: p.x + s * 16, y: p.y - 2, a: s * 0.9, v: 180, target: null, life: 3, trail: 0 }));
        this._audio.missile();
      }
    }
  },

  hurtPlayer(dmg) {
    const g = this._g;
    const p = g.player;
    if (!p.alive || p.inv > 0 || g.intro > 2) return;
    p.hp -= dmg;
    p.inv = 0.6;
    g.stats.damaged = true;
    g.shake = Math.max(g.shake, 7);
    g.flash = 0.45;
    g.flashColor = '255,40,40';
    this._audio.hurt();
    try { wx.vibrateShort({ type: 'medium' }); } catch (e) {}
    this.sparks(p.x, p.y, 8, '#FFD27A');
    if (p.hp <= 0) {
      p.hp = 0;
      p.alive = false;
      this.explode(p.x, p.y, 3, true);
      this.explode(p.x + 10, p.y - 8, 2, true);
      this._audio.stopMusic();
    }
  },

  updatePlayerShots(dt) {
    const g = this._g;
    const VH = this._VH;
    for (let i = g.pb.length - 1; i >= 0; i--) {
      const b = g.pb[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.y < -30 || b.x < -20 || b.x > VW + 20) { removeAt(g.pb, i); continue; }
      if (this.bulletHits(b)) removeAt(g.pb, i);
    }
    for (let i = g.pm.length - 1; i >= 0; i--) {
      const m = g.pm[i];
      m.life -= dt;
      if (!m.target || !m.target.alive) m.target = this.nearestTarget(m.x, m.y);
      if (m.target) {
        const want = Math.atan2(m.target.x - m.x, -(m.target.y - m.y));
        let d = want - m.a;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        m.a += clamp(d, -6 * dt, 6 * dt);
      } else {
        m.a *= 1 - dt * 2;
      }
      m.v = Math.min(560, m.v + 900 * dt);
      m.x += Math.sin(m.a) * m.v * dt;
      m.y -= Math.cos(m.a) * m.v * dt;
      m.trail -= dt;
      if (m.trail <= 0 && this._q > 0) {
        m.trail = 0.03;
        this.addFx({ spr: 'smoke1', x: m.x - Math.sin(m.a) * 8, y: m.y + Math.cos(m.a) * 8, life: 0.45, size: 6, size1: 16, alpha: 0.35 });
      }
      if (m.life <= 0 || m.y < -40 || m.y > VH + 40 || m.x < -40 || m.x > VW + 40) { removeAt(g.pm, i); continue; }
      if (this.bulletHits({ x: m.x, y: m.y, dmg: 4, missile: true })) {
        this.explode(m.x, m.y, 0.6);
        removeAt(g.pm, i);
      }
    }
  },

  nearestTarget(x, y) {
    const g = this._g;
    let best = null;
    let bd = 1e9;
    g.enemies.forEach(en => {
      if (!en.alive || !this.onScreen(en.x, en.y, -10)) return;
      const d = (en.x - x) * (en.x - x) + (en.y - y) * (en.y - y);
      if (d < bd) { bd = d; best = en; }
    });
    const b = g.boss;
    if (b && b.state === 'fight') {
      b.parts.forEach(pt => {
        if (!pt.alive) return;
        const d = (pt.x - x) * (pt.x - x) + (pt.y - y) * (pt.y - y);
        if (d < bd) { bd = d; best = pt; }
      });
      if (b.core.open) {
        const d = (b.core.x - x) * (b.core.x - x) + (b.core.y - y) * (b.core.y - y);
        if (d < bd) { bd = d; best = b.core; }
      }
    }
    return best;
  },

  // 子弹命中检测:命中返回 true
  bulletHits(b) {
    const g = this._g;
    for (let j = 0; j < g.enemies.length; j++) {
      const en = g.enemies[j];
      if (!en.alive || en.y < -10) continue;
      const r = en.def.r + 4;
      if (Math.abs(en.x - b.x) < r && Math.abs(en.y - b.y) < r) {
        this.impact(b.x, b.y);
        this.damageEnemy(en, b.dmg, b.x, b.y);
        return true;
      }
    }
    const boss = g.boss;
    if (boss && boss.state === 'fight') {
      for (const pt of boss.parts) {
        if (!pt.alive) continue;
        if (Math.abs(pt.x - b.x) < 17 && Math.abs(pt.y - b.y) < 17) {
          this.impact(b.x, b.y);
          this.damagePart(pt, b.dmg);
          if (Math.random() < 0.5) this.sparks(b.x, b.y, 1, '#FFE6A0');
          return true;
        }
      }
      // 核心只有打开后才吃子弹;关着的时候子弹飞过去,不会挡住后面的部件
      const c = boss.core;
      if (c.open && Math.abs(c.x - b.x) < 19 && Math.abs(c.y - b.y) < 19) {
        this.damageCore(b.dmg);
        this.sparks(b.x, b.y, 2, '#FF9AE0');
        return true;
      }
      // 船体本身不吃伤害:子弹从船体上方飞过,只有炮塔 / 核心能打
    }
    return false;
  },

  // ── 敌人 ─────────────────────────────────────────────
  runEvent(ev) {
    const g = this._g;
    if (ev.boss) {
      this.spawnBoss(ev.boss);
      return;
    }
    const def = D.ENEMIES[ev.kind];
    if (!def) return;
    const en = {
      kind: ev.kind, def, alive: true, t: 0, flash: 0, hp: def.hp * g.sc.hp, maxHp: def.hp * g.sc.hp,
      x: 0, y: -40, rot: 0, head: 0, fireT: def.fire.delay + Math.random() * 0.6, burst: 0, burstT: 0,
      spin: Math.random() * 6, smokeT: 0, shoots: def.fire.chance === undefined || Math.random() < def.fire.chance,
    };
    if (def.ground) {
      // 地面单位:找一块合适的陆地 / 水面,从屏幕上方卷进来
      const wy = g.scroll + this._VH + 30;
      const pos = this.findGroundSpot(wy, !!def.water);
      if (!pos) return;
      en.wx = pos;
      en.wy = wy;
      en.vx = def.moves ? (Math.random() < 0.5 ? -1 : 1) * rnd(14, 24) : 0;
      en.x = en.wx;
      en.y = this.groundY(en.wy);
    } else {
      en.path = D.PATHS[ev.path] || D.PATHS.dive;
      en.p = ev.p || { x: VW / 2, speed: 120 };
      const pos = en.path(0, en.p);
      en.x = pos.x;
      en.y = pos.y;
    }
    g.stats.spawned++;
    g.enemies.push(en);
  },

  findGroundSpot(wy, water) {
    const t = this._g.terrain;
    const xs = [];
    for (let i = 0; i < 14; i++) xs.push(30 + Math.random() * (VW - 60));
    for (const x of xs) {
      if (water ? t.isWater(x, wy) : t.isLand(x, wy)) {
        // 避免和已有地面单位挤在一起
        const crowded = this._g.enemies.some(en => en.def.ground && Math.abs(en.wx - x) < 34 && Math.abs(en.wy - wy) < 34);
        if (!crowded) return x;
      }
    }
    return null;
  },

  groundY(wy) {
    return this._VH - (wy - this._g.scroll);
  },

  onScreen(x, y, m) {
    return x > -m && x < VW + m && y > -m && y < this._VH + m;
  },

  updateEnemies(dt) {
    const g = this._g;
    const VH = this._VH;
    const p = g.player;
    for (let i = g.enemies.length - 1; i >= 0; i--) {
      const en = g.enemies[i];
      if (!en.alive) { removeAt(g.enemies, i); continue; }
      en.t += dt;
      if (en.flash > 0) en.flash -= dt;
      const ox = en.x;
      const oy = en.y;
      if (en.def.ground) {
        if (en.vx) {
          const nx = en.wx + en.vx * dt;
          const ok = en.def.water ? g.terrain.isWater(nx, en.wy) : g.terrain.isLand(nx, en.wy);
          if (ok && nx > 16 && nx < VW - 16) en.wx = nx;
          else en.vx = -en.vx;
        }
        en.x = en.wx;
        en.y = this.groundY(en.wy);
        en.rot = en.vx ? (en.vx > 0 ? -Math.PI / 2 : Math.PI / 2) : 0;
        if (en.def.water && en.vx && Math.random() < dt * 12) {
          this.addFx({ spr: 'smoke2', x: en.x - Math.sign(en.vx) * 10, y: en.y, vx: 0, vy: g.speed, life: 0.9, size: 6, size1: 18, alpha: 0.35, white: true });
        }
        if (en.y > VH + 40) { removeAt(g.enemies, i); continue; }
      } else {
        const pos = en.path(en.t, en.p);
        en.x = pos.x;
        en.y = pos.y;
        const vx = en.x - ox;
        const vy = en.y - oy;
        if (vx * vx + vy * vy > 0.0004) {
          const want = Math.atan2(-vx, vy);
          let d = want - en.rot;
          while (d > Math.PI) d -= Math.PI * 2;
          while (d < -Math.PI) d += Math.PI * 2;
          en.rot += d * Math.min(1, dt * 8);
        }
        // 离场
        if (en.t > 1 && !this.onScreen(en.x, en.y, 60)) { removeAt(g.enemies, i); continue; }
        // 和玩家相撞
        if (p.alive && Math.abs(en.x - p.x) < en.def.r + 8 && Math.abs(en.y - p.y) < en.def.r + 8) {
          this.hurtPlayer(20 * g.sc.damage);
          this.damageEnemy(en, 10, en.x, en.y);
        }
      }
      // 受损冒烟
      if (en.hp < en.maxHp * 0.4 && this._q > 0) {
        en.smokeT -= dt;
        if (en.smokeT <= 0) {
          en.smokeT = 0.08;
          this.addFx({ spr: 'smoke1', x: en.x + rnd(-4, 4), y: en.y + rnd(-4, 4), vx: 0, vy: g.speed * 0.5, life: 0.8, size: 8, size1: 22, alpha: 0.45 });
        }
      }
      // 炮塔头对准玩家
      if (en.def.head) en.head = Math.atan2(-(p.x - en.x), p.y - en.y);
      // 开火:只在屏幕上半部分到中部开火,太靠下就不打了(给玩家留反应时间)
      if (en.shoots && p.alive && en.y > 10 && en.y < VH * 0.72) this.enemyFire(en, en.def.fire, dt);
    }
  },

  // 通用开火逻辑(普通敌人、Boss 部件共用)
  enemyFire(src, f, dt) {
    const g = this._g;
    const rate = f.rate / g.sc.fire;
    if (src.burst > 0) {
      src.burstT -= dt;
      if (src.burstT <= 0) {
        src.burst--;
        src.burstT = 0.11;
        this.shoot(src, f, 0);
      }
      return;
    }
    src.fireT -= dt;
    if (src.fireT > 0) return;
    src.fireT += rate;
    if (f.pattern === 'burst') {
      src.burst = f.count;
      src.burstT = 0;
    } else {
      this.shoot(src, f, 0);
    }
  },

  shoot(src, f, _) {
    const g = this._g;
    const p = g.player;
    const sp = f.speed * g.sc.bulletSpeed;
    const muzzle = src.muzzle || 0;
    const aim = Math.atan2(p.x - src.x, p.y - src.y);   // 0 = 正下方
    const ox = src.x + Math.sin(aim) * muzzle;
    const oy = src.y + Math.cos(aim) * muzzle;
    const fire = (a, s, spr) => {
      if (g.eb.length >= MAX_EB) return;
      g.eb.push({ x: ox, y: oy, vx: Math.sin(a) * s, vy: Math.cos(a) * s, spr, r: spr === 'eb' ? 5 : 4, a });
    };
    switch (f.pattern) {
      case 'aimed':
      case 'burst':
        fire(aim, sp, 'eb2');
        break;
      case 'aimed2':
        fire(aim - 0.07, sp, 'eb2');
        fire(aim + 0.07, sp, 'eb2');
        break;
      case 'fan':
        for (let i = 0; i < f.count; i++) fire(aim + (i / (f.count - 1) - 0.5) * f.spread, sp, 'eb');
        break;
      case 'ring': {
        const off = Math.random() * Math.PI;
        for (let i = 0; i < f.count; i++) fire(off + (i / f.count) * Math.PI * 2, sp, 'eb');
        break;
      }
      case 'spiral':
        src.spin = (src.spin || 0) + 0.32;
        for (let i = 0; i < f.count; i++) fire(src.spin + (i / f.count) * Math.PI * 2, sp, 'eb');
        break;
      case 'flower':
        src.spin = (src.spin || 0) + 0.21;
        for (let i = 0; i < f.count; i++) {
          fire(src.spin + (i / f.count) * Math.PI * 2, sp, 'eb');
          fire(-src.spin + (i / f.count) * Math.PI * 2, sp * 0.8, 'eb2');
        }
        break;
      case 'stream':
        for (let i = 0; i < f.count; i++) fire(aim, sp * (1 + i * 0.09), 'eb3');
        break;
      default:
        fire(aim, sp, 'eb2');
    }
    // 枪口火光
    this.addFx({ spr: 'g_o', x: ox, y: oy, life: 0.08, size: 16, size1: 10, add: true });
  },

  damageEnemy(en, dmg, hx, hy) {
    if (!en.alive) return;
    en.hp -= dmg;
    en.flash = 0.06;
    if (en.hp > 0) {
      if (Math.random() < 0.3) this.sparks(hx, hy, 1, '#FFE6A0');
      return;
    }
    en.alive = false;
    const g = this._g;
    g.stats.killed++;
    // 连击:1.5 秒内接连击落,分数按连击数加成
    g.combo = g.comboT > 0 ? g.combo + 1 : 1;
    g.comboT = 1.5;
    g.comboPop = 1;
    if (g.combo > g.stats.maxCombo) g.stats.maxCombo = g.combo;
    g.stats.score += Math.round(en.def.score * (1 + Math.min(g.combo, 50) * 0.02));
    if (g.combo === 20 || g.combo === 50 || g.combo === 100) {
      this.addText(`${g.combo} 连击!`, '#FFD860');
      this._audio.combo(g.combo);
    }
    const size = en.def.elite ? 3 : en.def.r > 20 ? 2 : 1;
    this.explode(en.x, en.y, size, !en.def.ground);
    if (en.def.ground) {
      g.decals.push({ wx: en.x, wy: en.wy, life: 60, rot: Math.random() * 6 });
    }
    if (!en.def.starChance || Math.random() < en.def.starChance) this.dropStars(en.x, en.y, en.def.stars, en.def.elite);
    // 大家伙有机会掉补给
    if (en.def.r >= 18 || en.def.elite) {
      const r = Math.random();
      if (r < 0.28) this.addPickup('pu_hp', en.x, en.y);
      else if (r < 0.5) this.addPickup('pu_pow', en.x, en.y);
    }
  },

  // ── Boss ─────────────────────────────────────────────
  spawnBoss(id) {
    const g = this._g;
    const def = D.BOSSES[id];
    const hpK = g.sc.hp;
    const boss = {
      def, x: VW / 2, y: -def.h, t: 0, state: 'enter', dieT: 0, boomT: 0,
      parts: def.parts.map(pt => ({
        ...pt, x0: pt.x, y0: pt.y, alive: true, hp: pt.hp * hpK, maxHp: pt.hp * hpK, x: 0, y: 0, rot: 0, flash: 0,
        fireT: 1 + Math.random(), burst: 0, burstT: 0, spin: 0, smokeT: 0,
        muzzle: pt.kind === 'cannon' ? 24 : pt.kind === 'turret' ? 14 : 4,
      })),
      core: { x: 0, y: 0, hp: def.core.hp * hpK, maxHp: def.core.hp * hpK, open: false, flash: 0, fireT: 1, fire2T: 2, burst: 0, burstT: 0, spin: 0, alive: true, muzzle: 0 },
    };
    boss.totalHp = boss.parts.reduce((s, pt) => s + pt.maxHp, 0) + boss.core.maxHp;
    g.boss = boss;
    g.warnT = 3;
    g.stats.spawned++;
    this._audio.warning();
    this._audio.playMusic('boss');
  },

  updateBoss(dt) {
    const g = this._g;
    const b = g.boss;
    const def = b.def;
    b.t += dt;
    if (b.state === 'enter') {
      b.y += (def.holdY - b.y) * Math.min(1, dt * 0.9);
      if (Math.abs(b.y - def.holdY) < 4 && g.warnT <= 0) b.state = 'fight';
    } else if (b.state === 'fight') {
      b.x = VW / 2 + Math.sin(b.t * 0.45) * def.sway;
      b.y = def.holdY + Math.sin(b.t * 0.8) * 10;
    }
    // 部件位置
    b.parts.forEach(pt => {
      pt.x = b.x + pt.x0;
      pt.y = b.y + pt.y0;
    });
    b.core.x = b.x + def.core.x;
    b.core.y = b.y + def.core.y;
    if (b.state === 'dying') {
      b.dieT += dt;
      b.y += dt * 12;
      b.boomT -= dt;
      if (b.boomT <= 0) {
        b.boomT = 0.12;
        this.explode(b.x + rnd(-def.w * 0.4, def.w * 0.4), b.y + rnd(-def.h * 0.35, def.h * 0.35), 2, true);
      }
      if (b.dieT > 2.6) {
        this.explode(b.x, b.y, 5, true);
        g.flash = 1;
        g.flashColor = '255,250,230';
        g.shake = 18;
        this.dropStars(b.x, b.y, def.stars, true, 60);
        g.stats.killed++;
        g.stats.score += def.score;
        b.state = 'dead';
        this._audio.stopMusic();
        this._audio.fanfare();
      }
      return;
    }
    if (b.state !== 'fight') return;
    const p = g.player;
    b.parts.forEach(pt => {
      if (pt.flash > 0) pt.flash -= dt;
      if (!pt.alive) {
        pt.smokeT -= dt;
        if (pt.smokeT <= 0 && this._q > 0) {
          pt.smokeT = 0.12;
          this.addFx({ spr: 'smoke1', x: pt.x + rnd(-4, 4), y: pt.y, vx: 0, vy: 30, life: 1, size: 10, size1: 30, alpha: 0.5 });
        }
        return;
      }
      pt.rot = Math.atan2(-(p.x - pt.x), p.y - pt.y);
      if (p.alive) this.enemyFire(pt, pt.fire, dt);
    });
    const c = b.core;
    if (c.flash > 0) c.flash -= dt;
    if (!c.open && b.parts.every(pt => !pt.alive)) {
      c.open = true;
      g.flash = 0.5;
      g.flashColor = '255,120,220';
      this._audio.warning();
    }
    if (c.open && p.alive) {
      this.enemyFire(c, def.core.fire, dt);
      c.fire2T -= dt;
      if (c.fire2T <= 0) {
        c.fire2T += def.core.fire2.rate / g.sc.fire;
        this.shoot(c, def.core.fire2);
      }
    }
  },

  damagePart(pt, dmg) {
    if (!pt.alive) return;
    pt.hp -= dmg;
    pt.flash = 0.06;
    if (pt.hp <= 0) {
      pt.alive = false;
      this.explode(pt.x, pt.y, 2, true);
      this.dropStars(pt.x, pt.y, 5, false);
      this._g.stats.score += 1500;
    }
  },

  damageCore(dmg) {
    const b = this._g.boss;
    const c = b.core;
    if (!c.open || b.state !== 'fight') return;
    c.hp -= dmg;
    c.flash = 0.06;
    if (c.hp <= 0) {
      c.hp = 0;
      b.state = 'dying';
      this._g.eb.length = 0;
      this._audio.boom(2);
    }
  },

  bossHpPct() {
    const b = this._g.boss;
    const left = b.parts.reduce((s, pt) => s + Math.max(0, pt.hp), 0) + Math.max(0, b.core.hp);
    return left / b.totalHp;
  },

  // ── 敌弹 ─────────────────────────────────────────────
  updateEnemyBullets(dt) {
    const g = this._g;
    const p = g.player;
    const VH = this._VH;
    for (let i = g.eb.length - 1; i >= 0; i--) {
      const b = g.eb[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.y < -30 || b.y > VH + 30 || b.x < -30 || b.x > VW + 30) { removeAt(g.eb, i); continue; }
      if (p.alive && p.inv <= 0) {
        const dx = b.x - p.x;
        const dy = b.y - p.y;
        const rr = b.r + PLAYER_R;
        if (dx * dx + dy * dy < rr * rr) {
          this.hurtPlayer(12 * g.sc.damage);
          removeAt(g.eb, i);
        }
      }
    }
  },

  // ── 星星 / 补给 ───────────────────────────────────────
  dropStars(x, y, n, big, spread) {
    const g = this._g;
    const bigN = big ? Math.floor(n / 5) : 0;
    const small = n - bigN * 5;
    const s = spread || 30;
    for (let i = 0; i < small + bigN; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = rnd(40, 110) * (s / 30);
      g.pickups.push({ kind: 'star', spr: i < bigN ? 'star_big' : 'star', val: i < bigN ? 5 : 1, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30, t: 0, rot: Math.random() * 6, magnet: false });
    }
  },

  addPickup(spr, x, y) {
    this._g.pickups.push({ kind: spr, spr, val: 0, x, y, vx: rnd(-20, 20), vy: -40, t: 0, rot: 0, magnet: false });
  },

  updatePickups(dt) {
    const g = this._g;
    const p = g.player;
    const magnetR = 50 + this._save.up.magnet * 30;
    for (let i = g.pickups.length - 1; i >= 0; i--) {
      const pk = g.pickups[i];
      pk.t += dt;
      pk.rot += dt * 2.5;
      const dx = p.x - pk.x;
      const dy = p.y - pk.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      if (p.alive && (pk.magnet || d < magnetR) && pk.t > 0.25) {
        pk.magnet = true;
        const sp = 260 + pk.t * 120;
        pk.vx += (dx / d * sp - pk.vx) * Math.min(1, dt * 8);
        pk.vy += (dy / d * sp - pk.vy) * Math.min(1, dt * 8);
      } else {
        // 先四散,再随地面慢慢下落
        pk.vx *= 1 - dt * 2.5;
        pk.vy += ((g.speed + 25) - pk.vy) * Math.min(1, dt * 2);
      }
      pk.x += pk.vx * dt;
      pk.y += pk.vy * dt;
      if (p.alive && d < 20) {
        this.collect(pk);
        removeAt(g.pickups, i);
        continue;
      }
      if (pk.y > this._VH + 30) removeAt(g.pickups, i);
    }
  },

  collect(pk) {
    const g = this._g;
    if (pk.kind === 'star') {
      g.stats.stars += pk.val;
      g.stats.score += 10 * pk.val;
      this._audio.star(g.stats.starChain++);
      this.addFx({ spr: 'g_y', x: pk.x, y: pk.y, life: 0.2, size: 14, size1: 26, add: true, alpha: 0.8 });
    } else if (pk.kind === 'pu_hp') {
      const p = g.player;
      p.hp = Math.min(p.maxHp, p.hp + 30);
      this.addText('装甲修复 +30', '#4CD08A');
      this._audio.power();
    } else if (pk.kind === 'pu_pow') {
      g.powT = 8;
      this.addText('火力超载!', '#FF9A3C');
      this._audio.power();
    }
  },

  // ── 特效 ─────────────────────────────────────────────
  addFx(f) {
    const fx = this._g ? this._g.fx : null;
    if (!fx || fx.length >= MAX_FX) return;
    f.t = 0;
    f.vx = f.vx || 0;
    f.vy = f.vy || 0;
    f.rot = f.rot === undefined ? Math.random() * 6 : f.rot;
    fx.push(f);
  },

  addText(text, color) {
    this.addFx({ text, color, x: this._g.player.x, y: this._g.player.y - 40, vy: -30, life: 1.2, size: 1, size1: 1 });
  },

  // 子弹打中的小闪光
  impact(x, y) {
    this._audio.hit();
    if (this._q <= 0) return;
    this.addFx({ spr: 'g_y', x, y: y - 3, life: 0.07, size: 7, size1: 15, add: true, alpha: 0.85 });
  },

  sparks(x, y, n, color) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = rnd(80, 240);
      this.addFx({ spark: true, color, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(0.15, 0.35), size: rnd(1.2, 2.4), size1: 0.4 });
    }
  },

  // 爆炸:火球 + 烟 + 火花 + 碎片 + 冲击波,size 1(小飞机)~5(Boss)
  explode(x, y, size, air) {
    const g = this._g;
    const q = this._q;
    const n = Math.ceil(size * (q > 0 ? 3 : 2));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * 7 * size;
      this.addFx({ spr: Math.random() < 0.5 ? 'fire1' : 'fire2', x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, vx: Math.cos(a) * 20 * size, vy: Math.sin(a) * 20 * size + (air ? 0 : g.speed), life: rnd(0.35, 0.65) + size * 0.05, delay: i * 0.03, size: 12 * size, size1: 34 * size, add: true });
    }
    if (q > 0) {
      for (let i = 0; i < size * 2; i++) {
        this.addFx({ spr: Math.random() < 0.5 ? 'smoke1' : 'smoke2', x: x + rnd(-6, 6) * size, y: y + rnd(-6, 6) * size, vx: rnd(-15, 15), vy: rnd(-10, 10) + g.speed * 0.6, life: rnd(0.9, 1.6), delay: 0.12, size: 10 * size, size1: 40 * size, alpha: 0.55 });
      }
      for (let i = 0; i < size * 2; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = rnd(60, 160) * Math.sqrt(size);
        this.addFx({ debris: true, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(0.5, 1), size: rnd(1.5, 3.5) * Math.sqrt(size), size1: 1, spin: rnd(-12, 12) });
      }
    }
    this.sparks(x, y, Math.ceil(5 * size), '#FFD27A');
    if (size >= 2) this.addFx({ spr: 'ring', x, y, life: 0.5, size: 10, size1: 40 * size, add: true, alpha: 0.9 });
    this.addFx({ spr: 'g_w', x, y, life: 0.15, size: 30 * size, size1: 50 * size, add: true, alpha: 0.9 });
    g.shake = Math.max(g.shake, size * 2.5);
    // 大家伙炸掉时顿一下帧,打击感更足
    if (size >= 2) g.hitStop = Math.max(g.hitStop || 0, size >= 3 ? 0.1 : 0.045);
    this._audio.boom(size >= 3 ? 3 : size >= 2 ? 2 : 1);
    if (size >= 3) {
      try { wx.vibrateShort({ type: 'heavy' }); } catch (e) {}
    }
  },

  updateFx(dt) {
    const fx = this._g.fx;
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i];
      if (f.delay > 0) { f.delay -= dt; continue; }
      f.t += dt;
      if (f.t >= f.life) { removeAt(fx, i); continue; }
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      if (f.debris) {
        f.vx *= 1 - dt * 2;
        f.vy *= 1 - dt * 2;
        f.rot += f.spin * dt;
        if (Math.random() < dt * 30 && this._q > 1) this.addFx({ spr: 'fire1', x: f.x, y: f.y, life: 0.25, size: 5, size1: 2, add: true });
      }
    }
  },

  // ── 云 ───────────────────────────────────────────────
  spawnCloud(list, y) {
    list.push({ spr: `cloud${1 + Math.floor(Math.random() * 3)}`, x: rnd(-40, VW + 40), y: y === undefined ? -90 : y, k: rnd(0.8, 1.5), a: rnd(0.35, 0.6), sp: rnd(1.3, 1.9), flip: Math.random() < 0.5 });
  },

  updateClouds(list, dt, speed) {
    for (let i = list.length - 1; i >= 0; i--) {
      const c = list[i];
      c.y += (speed * c.sp + 12) * dt;
      if (c.y > this._VH + 120) removeAt(list, i);
    }
    if (list.length < 4 && Math.random() < dt * 0.35) this.spawnCloud(list);
  },

  // ── 结算 ─────────────────────────────────────────────
  finish(win) {
    const g = this._g;
    if (this.data.screen === 'result') return;
    const s = this._save;
    const st = g.stage;
    const pct = g.stats.spawned ? Math.round((g.stats.killed / g.stats.spawned) * 100) : 0;
    const got = win ? [pct >= 70, pct >= 100, !g.stats.damaged] : [false, false, false];
    const prev = s.medals[st.id] || [false, false, false];
    let bonus = 0;
    const medals = D.MEDALS.map((m, i) => {
      const isNew = got[i] && !prev[i];
      if (isNew) bonus += m.bonus * st.id;
      return { name: m.name, got: got[i] || prev[i], fresh: isNew, bonus: m.bonus * st.id };
    });
    s.medals[st.id] = prev.map((v, i) => v || got[i]);
    s.stars += g.stats.stars + bonus;
    const best = Math.max(s.best[st.id] || 0, g.stats.score);
    const newBest = g.stats.score > (s.best[st.id] || 0);
    s.best[st.id] = best;
    let unlockedNext = false;
    if (win && st.id >= s.unlocked && st.id < 3) {
      s.unlocked = st.id + 1;
      unlockedNext = true;
    }
    this.writeSave();
    this._audio.stopMusic();
    this.setData({
      screen: 'result',
      result: {
        win, stageName: st.name, score: g.stats.score, best, newBest, stars: g.stats.stars, bonus,
        pct, killed: g.stats.killed, spawned: g.stats.spawned, maxCombo: g.stats.maxCombo, medals, hasNext: win && st.id < 3, unlockedNext,
      },
    });
  },

  // ── 渲染 ─────────────────────────────────────────────
  spr(name, x, y, rot, scale, alpha) {
    const r = this._rects[name];
    if (!r) return;
    const s = scale || 1;
    const w = r.vw * s;
    const h = r.vh * s;
    const ctx = this._ctx;
    if (alpha !== undefined) ctx.globalAlpha = alpha;
    if (rot) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.drawImage(this._img, r.x, r.y, r.w, r.h, -w / 2, -h / 2, w, h);
      ctx.restore();
    } else {
      ctx.drawImage(this._img, r.x, r.y, r.w, r.h, x - w / 2, y - h / 2, w, h);
    }
    if (alpha !== undefined) ctx.globalAlpha = 1;
  },

  glow(name, x, y, w, h, alpha) {
    const r = this._rects[name];
    const ctx = this._ctx;
    ctx.globalAlpha = alpha;
    ctx.drawImage(this._img, r.x, r.y, r.w, r.h, x - w / 2, y - h / 2, w, h);
    ctx.globalAlpha = 1;
  },

  render() {
    const ctx = this._ctx;
    if (!ctx) return;
    const s = this._dpr * this._k;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    if (!this._img) {
      ctx.fillStyle = '#0B1A30';
      ctx.fillRect(0, 0, VW, this._VH);
      return;
    }
    if (this.data.screen === 'hangar' || this.data.screen === 'loading') {
      this.renderAttract();
      return;
    }
    if (this._g) this.renderGame();
  },

  renderAttract() {
    const a = this._attract;
    const ctx = this._ctx;
    const VH = this._VH;
    if (!a) return;
    if (a.fade < 1) {
      if (a.prev) a.prev.terrain.draw(ctx, a.prev.scroll, VH);
      else {
        ctx.fillStyle = '#060A18';
        ctx.fillRect(0, 0, VW, VH);
      }
    }
    if (a.fade > 0) {
      ctx.globalAlpha = a.fade;
      a.terrain.draw(ctx, a.scroll, VH);
      ctx.globalAlpha = 1;
    }
    this.drawClouds(a.clouds, true);
    // 战机在下方悬停
    const x = VW / 2 + Math.sin(a.t * 0.7) * 18;
    const y = VH * 0.72 + Math.sin(a.t * 1.3) * 6;
    const bank = Math.round(Math.cos(a.t * 0.7) * 1.4);
    this.spr('player0_s', x + 26, y + 34, 0, 0.9, 0.3);
    this.drawPlayerShip(x, y, bank, a.t);
    if (a.flash > 0) {
      ctx.globalCompositeOperation = 'lighter';
      this.glow('g_y', x, y, 160, 160, a.flash * 0.8);
      ctx.globalCompositeOperation = 'source-over';
    }
    this.drawClouds(a.clouds, false);
    // 暗角,让上面的 UI 更清楚
    const grd = ctx.createLinearGradient(0, 0, 0, VH);
    grd.addColorStop(0, 'rgba(6,10,24,0.7)');
    grd.addColorStop(0.45, 'rgba(6,10,24,0.15)');
    grd.addColorStop(1, 'rgba(6,10,24,0.55)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, VW, VH);
  },

  drawPlayerShip(x, y, bank, t) {
    const ctx = this._ctx;
    const b = clamp(Math.round(bank), -2, 2);
    // 尾焰
    ctx.globalCompositeOperation = 'lighter';
    const fl = 0.8 + Math.sin(t * 40) * 0.2;
    [-2.3, 2.3].forEach(dx => {
      const fx = x + dx * (1 - Math.abs(b) * 0.12);
      this.glow('g_o', fx, y + 31, 10, 22 * fl, 0.9);
      this.glow('g_b', fx, y + 28, 7, 10, 0.9);
    });
    ctx.globalCompositeOperation = 'source-over';
    this.spr(`player${b}`, x, y);
  },

  drawClouds(list, shadow) {
    const ctx = this._ctx;
    list.forEach(c => {
      if (shadow) {
        this.spr(`${c.spr}_s`, c.x + 50, c.y + 70, 0, c.k, 0.13);
      } else {
        this.spr(c.spr, c.x, c.y, 0, c.k, c.a);
      }
    });
    ctx.globalAlpha = 1;
  },

  renderGame() {
    const g = this._g;
    const ctx = this._ctx;
    const VH = this._VH;
    const q = this._q;
    ctx.save();
    if (g.shake > 0.3) ctx.translate(rnd(-1, 1) * g.shake, rnd(-1, 1) * g.shake);

    // 1. 地面
    g.terrain.draw(ctx, g.scroll, VH);
    // 2. 弹坑
    g.decals.forEach(dc => this.spr('crater', dc.wx, this.groundY(dc.wy), dc.rot, 1, Math.min(1, dc.life / 5) * 0.9));
    // 3. 地面单位
    g.enemies.forEach(en => { if (en.def.ground) this.drawGroundUnit(en); });
    // 4. 云影 + 空中单位投影
    this.drawClouds(g.clouds, true);
    g.enemies.forEach(en => { if (en.def.air) this.spr(`${en.def.sprite}_s`, en.x + 22, en.y + 32, en.rot, 0.85, 0.28); });
    if (g.boss && g.boss.state !== 'dead' && this._rects[`${g.boss.def.hull}_s`]) {
      this.spr(`${g.boss.def.hull}_s`, g.boss.x + 40, g.boss.y + 60, 0, 0.9, 0.25);
    }
    if (g.player.alive) this.spr('player0_s', g.player.x + 24, g.player.y + 34, 0, 0.85, 0.3);
    // 5. 低空云
    this.drawClouds(g.clouds, false);
    // 6. 星星 / 补给
    g.pickups.forEach(pk => {
      if (pk.kind === 'star') this.drawStarPickup(pk);
      else this.spr(pk.spr, pk.x, pk.y, 0, 1.1 + Math.sin(pk.t * 6) * 0.06);
    });
    // 7. Boss
    if (g.boss && g.boss.state !== 'dead') this.drawBoss(g.boss);
    // 8. 空中敌人
    g.enemies.forEach(en => { if (en.def.air) this.drawAirUnit(en, g.t); });
    // 9. 玩家子弹(叠加发光)
    ctx.globalCompositeOperation = 'lighter';
    const pbr = this._rects.pb;
    g.pb.forEach(b => {
      if (b.a) this.spr('pb', b.x, b.y, b.a);
      else ctx.drawImage(this._img, pbr.x, pbr.y, pbr.w, pbr.h, b.x - pbr.vw / 2, b.y - pbr.vh / 2, pbr.vw, pbr.vh);
    });
    ctx.globalCompositeOperation = 'source-over';
    g.pm.forEach(m => {
      this.spr('pm', m.x, m.y, m.a);
      ctx.globalCompositeOperation = 'lighter';
      this.glow('g_o', m.x - Math.sin(m.a) * 9, m.y + Math.cos(m.a) * 9, 9, 9, 0.9);
      ctx.globalCompositeOperation = 'source-over';
    });
    // 10. 玩家
    const p = g.player;
    if (p.alive && !(p.inv > 0 && Math.floor(g.t * 20) % 2)) {
      this.drawPlayerShip(p.x, p.y, p.bank, g.t);
      if (p.mz > 0) {
        // 枪口火光
        ctx.globalCompositeOperation = 'lighter';
        const k = 1 - Math.abs(clamp(Math.round(p.bank), -2, 2)) * 0.12;
        const a = clamp(p.mz, 0, 1);
        [-5, 5].forEach(dx => this.glow('g_y', p.x + dx * k, p.y - 25, 13 * a + 4, 16 * a + 4, 0.9 * a));
        this.glow('g_w', p.x, p.y - 27, 9 * a, 9 * a, 0.7 * a);
        ctx.globalCompositeOperation = 'source-over';
      }
      if (g.powT > 0) {
        ctx.globalCompositeOperation = 'lighter';
        this.glow('g_o', p.x, p.y, 70, 70, 0.25 + Math.sin(g.t * 12) * 0.1);
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    // 11. 特效
    this.drawFx(g.fx);
    // 12. 敌弹最后画,永远看得清
    g.eb.forEach(b => {
      if (b.spr === 'eb3') this.spr('eb3', b.x, b.y, -b.a);
      else {
        const r = this._rects[b.spr];
        ctx.drawImage(this._img, r.x, r.y, r.w, r.h, b.x - r.vw / 2, b.y - r.vh / 2, r.vw, r.vh);
      }
    });
    ctx.restore();

    // 闪屏
    if (g.flash > 0) {
      ctx.fillStyle = `rgba(${g.flashColor},${g.flash * 0.45})`;
      ctx.fillRect(0, 0, VW, VH);
    }
    // 子弹时间:压暗 + 冷色暗角
    if (g.slowA > 0.01) this.drawSlowVeil(g);
    // 低血量红色暗角
    if (p.alive && p.hp < p.maxHp * 0.3 && q > 0) {
      const a = 0.25 + Math.sin(g.t * 6) * 0.12;
      const grd = ctx.createRadialGradient(VW / 2, VH / 2, VH * 0.3, VW / 2, VH / 2, VH * 0.75);
      grd.addColorStop(0, 'rgba(200,0,0,0)');
      grd.addColorStop(1, `rgba(200,0,0,${a})`);
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, VW, VH);
    }
    this.drawHud(g);
  },

  drawSlowVeil(g) {
    const ctx = this._ctx;
    const VH = this._VH;
    const a = clamp(g.slowA, 0, 1);
    ctx.fillStyle = `rgba(8,16,40,${0.28 * a})`;
    ctx.fillRect(0, 0, VW, VH);
    const grd = ctx.createRadialGradient(VW / 2, VH * 0.55, VH * 0.22, VW / 2, VH * 0.55, VH * 0.72);
    grd.addColorStop(0, 'rgba(6,12,32,0)');
    grd.addColorStop(1, `rgba(6,12,32,${0.55 * a})`);
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, VW, VH);
    if (a < 0.45) return;
    // 提示:按住继续(在战机下方,呼吸闪烁)
    const p = g.player;
    const k = (a - 0.45) / 0.55;
    const pulse = 0.65 + Math.sin(g.rt * 4) * 0.35;
    const y = clamp(p.y + 64, 120, VH - 40);
    ctx.globalAlpha = k;
    ctx.strokeStyle = `rgba(150,220,255,${0.5 * pulse})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 30 + (1 - pulse) * 10, 0, Math.PI * 2);
    ctx.stroke();
    this.text('按住屏幕继续战斗', VW / 2, y, 'bold 15px sans-serif', `rgba(220,240,255,${0.55 + pulse * 0.45})`, 'center');
    ctx.globalAlpha = 1;
  },

  // 星星:金色光晕 + 像硬币一样翻转 + 定时闪一下十字星光
  drawStarPickup(pk) {
    const ctx = this._ctx;
    const r = this._rects[pk.spr];
    const big = pk.val > 1;
    ctx.globalCompositeOperation = 'lighter';
    this.glow('g_y', pk.x, pk.y, big ? 34 : 24, big ? 34 : 24, 0.32);
    ctx.globalCompositeOperation = 'source-over';
    const sx = Math.max(0.22, Math.abs(Math.cos(pk.t * 4.2 + pk.rot)));
    ctx.save();
    ctx.translate(pk.x, pk.y);
    ctx.scale(sx, 1);
    ctx.drawImage(this._img, r.x, r.y, r.w, r.h, -r.vw / 2, -r.vh / 2, r.vw, r.vh);
    ctx.restore();
    const ph = (pk.t * 0.7 + pk.rot) % 1.6;
    if (ph < 0.28) {
      const k = Math.sin((ph / 0.28) * Math.PI);
      const gs = (big ? 26 : 19) * k;
      ctx.globalCompositeOperation = 'lighter';
      this.glow('glint', pk.x - r.vw * 0.18, pk.y - r.vh * 0.22, gs, gs, 0.95);
      ctx.globalCompositeOperation = 'source-over';
    }
  },

  drawGroundUnit(en) {
    const def = en.def;
    const fl = en.flash > 0;
    if (def.water && en.vx) {
      // 船尾浪花
      const nx = -Math.sin(en.rot);
      const ny = Math.cos(en.rot);
      this.spr('b_wake', en.x - nx * 16, en.y - ny * 16, en.rot + Math.PI, 1, 0.5 + Math.sin(this._g.t * 5) * 0.1);
    }
    this.spr(fl ? `${def.sprite}_w` : def.sprite, en.x, en.y, en.rot);
    if (def.head) this.spr(fl ? `${def.head}_w` : def.head, en.x, en.y, en.head, def.water ? 0.8 : 1);
  },

  drawAirUnit(en, t) {
    const def = en.def;
    this.spr(en.flash > 0 ? `${def.sprite}_w` : def.sprite, en.x, en.y, en.rot);
    const ctx = this._ctx;
    if (def.rotor) {
      // 主旋翼:半透明圆盘 + 两片旋转桨叶
      ctx.save();
      ctx.translate(en.x, en.y);
      ctx.fillStyle = 'rgba(30,36,30,0.18)';
      ctx.beginPath();
      ctx.arc(0, 0, 21, 0, Math.PI * 2);
      ctx.fill();
      ctx.rotate(t * 30);
      ctx.fillStyle = 'rgba(20,24,20,0.6)';
      ctx.fillRect(-21, -1.2, 42, 2.4);
      ctx.fillRect(-1.2, -21, 2.4, 42);
      ctx.restore();
    }
    // 引擎尾焰
    if (def.sprite !== 'e_gunship') {
      ctx.globalCompositeOperation = 'lighter';
      const back = def.r * 0.9;
      this.glow('g_o', en.x + Math.sin(en.rot) * back, en.y - Math.cos(en.rot) * back, def.r * 0.8, def.r * 0.8, 0.6);
      ctx.globalCompositeOperation = 'source-over';
    }
  },

  drawBoss(b) {
    const ctx = this._ctx;
    const def = b.def;
    this.spr(def.hull, b.x, b.y);
    // 引擎光
    ctx.globalCompositeOperation = 'lighter';
    const pulse = 0.7 + Math.sin(b.t * 6) * 0.2;
    if (def.hull === 'boss1') [-50, 50].forEach(dx => this.glow('g_c', b.x + dx, b.y - 45, 30, 40, pulse));
    if (def.hull === 'boss3') [-88, 88].forEach(dx => this.glow('g_c', b.x + dx, b.y - 60, 28, 34, pulse));
    ctx.globalCompositeOperation = 'source-over';
    b.parts.forEach(pt => {
      if (!pt.alive) {
        this.spr('p_wreck', pt.x, pt.y, 0, 0.9);
        return;
      }
      const fl = pt.flash > 0 ? '_w' : '';
      if (pt.kind === 'turret') this.spr(`t_head${fl}`, pt.x, pt.y, pt.rot, 1.35);
      else if (pt.kind === 'cannon') this.spr(`p_cannon${fl}`, pt.x, pt.y, pt.rot, 1);
      else this.spr(`p_pod${fl}`, pt.x, pt.y, 0, 1);
    });
    const c = b.core;
    this.spr(c.open ? (c.flash > 0 ? 'p_core_open_w' : 'p_core_open') : 'p_core', c.x, c.y, c.open ? 0 : b.t * 0.5);
    if (c.open) {
      ctx.globalCompositeOperation = 'lighter';
      this.glow('g_p', c.x, c.y, 70, 70, 0.6 + Math.sin(b.t * 8) * 0.25);
      ctx.globalCompositeOperation = 'source-over';
    }
  },

  drawFx(fx) {
    const ctx = this._ctx;
    for (let i = 0; i < fx.length; i++) {
      const f = fx[i];
      if (f.delay > 0) continue;
      const k = f.t / f.life;
      const size = f.size + (f.size1 - f.size) * (1 - (1 - k) * (1 - k));
      const a = (f.alpha === undefined ? 1 : f.alpha) * (1 - k);
      if (f.text) {
        ctx.globalAlpha = 1 - k * k;
        ctx.font = 'bold 15px sans-serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.strokeText(f.text, f.x, f.y);
        ctx.fillStyle = f.color;
        ctx.fillText(f.text, f.x, f.y);
        ctx.globalAlpha = 1;
        continue;
      }
      if (f.spark) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = f.color;
        ctx.lineWidth = size;
        ctx.beginPath();
        ctx.moveTo(f.x, f.y);
        ctx.lineTo(f.x - f.vx * 0.03, f.y - f.vy * 0.03);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        continue;
      }
      if (f.debris) {
        ctx.save();
        ctx.translate(f.x, f.y);
        ctx.rotate(f.rot);
        ctx.globalAlpha = 1 - k;
        ctx.fillStyle = '#2A2622';
        ctx.fillRect(-f.size, -f.size * 0.6, f.size * 2, f.size * 1.2);
        ctx.restore();
        ctx.globalAlpha = 1;
        continue;
      }
      if (f.add) ctx.globalCompositeOperation = 'lighter';
      const r = this._rects[f.spr];
      ctx.globalAlpha = Math.max(0, a);
      if (f.add || !f.rot) {
        ctx.drawImage(this._img, r.x, r.y, r.w, r.h, f.x - size / 2, f.y - size / 2, size, size);
      } else {
        ctx.save();
        ctx.translate(f.x, f.y);
        ctx.rotate(f.rot + k);
        ctx.drawImage(this._img, r.x, r.y, r.w, r.h, -size / 2, -size / 2, size, size);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      if (f.add) ctx.globalCompositeOperation = 'source-over';
    }
  },

  // ── HUD(画布内)──────────────────────────────────────
  text(str, x, y, font, color, align) {
    const ctx = this._ctx;
    ctx.font = font;
    ctx.textAlign = align || 'left';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(4,8,20,0.75)';
    ctx.strokeText(str, x, y);
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  },

  drawHud(g) {
    const ctx = this._ctx;
    const VH = this._VH;
    const p = g.player;
    if (g.loading) {
      ctx.fillStyle = 'rgba(6,10,24,0.55)';
      ctx.fillRect(0, 0, VW, VH);
      const dots = '...'.slice(0, 1 + (Math.floor(g.loadT * 3) % 3));
      this.text(`准备出击${dots}`, VW / 2, VH * 0.45, 'bold 22px sans-serif', '#CDE8FF', 'center');
      this.text(g.stage.name, VW / 2, VH * 0.45 + 28, '13px sans-serif', '#6FC8FF', 'center');
      return;
    }
    // 分数
    this.text(String(g.stats.score), 14, 30, 'bold 20px sans-serif', '#FFFFFF');
    // 星星
    this.spr('star', 20, 46, 0, 0.9);
    this.text(String(g.stats.stars), 32, 51, 'bold 14px sans-serif', '#FFD860');
    // 耐久条
    const bw = 120;
    const bx = 14;
    const by = 60;
    const pct = p.hp / p.maxHp;
    ctx.fillStyle = 'rgba(4,8,20,0.6)';
    ctx.fillRect(bx - 1, by - 1, bw + 2, 8);
    ctx.fillStyle = pct > 0.5 ? '#4CD08A' : pct > 0.25 ? '#F5C842' : '#FF4A4A';
    ctx.fillRect(bx, by, bw * pct, 6);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(bx, by, bw * pct, 2);
    // 连击计数(右上,新增一击时弹一下)
    if (g.combo >= 3 && g.comboT > 0) {
      const a = clamp(g.comboT / 0.4, 0, 1);
      const c = g.combo;
      const col = c < 10 ? '#FFFFFF' : c < 25 ? '#FFD860' : c < 50 ? '#FF9A3C' : '#FF6AD0';
      const fs = Math.round(24 + g.comboPop * 8 + Math.min(c, 60) * 0.12);
      ctx.globalAlpha = a;
      this.text(String(c), VW - 14, 84, `bold italic ${fs}px sans-serif`, col, 'right');
      this.text('连击', VW - 14, 100, 'bold 11px sans-serif', 'rgba(230,240,255,0.9)', 'right');
      ctx.fillStyle = 'rgba(4,8,20,0.55)';
      ctx.fillRect(VW - 54, 105, 40, 3);
      ctx.fillStyle = col;
      ctx.fillRect(VW - 54, 105, 40 * clamp(g.comboT / 1.5, 0, 1), 3);
      ctx.globalAlpha = 1;
    }
    // 关卡进度(右侧细条)
    if (!g.boss) {
      const prog = clamp(g.dist / g.stage.length, 0, 1);
      const h = VH * 0.36;
      const y0 = VH * 0.3;
      ctx.fillStyle = 'rgba(4,8,20,0.45)';
      ctx.fillRect(VW - 8, y0, 3, h);
      ctx.fillStyle = '#6FC8FF';
      ctx.fillRect(VW - 8, y0 + h * (1 - prog), 3, h * prog);
      ctx.fillStyle = '#FF4A6A';
      ctx.fillRect(VW - 10, y0 - 3, 7, 3);
    }
    // Boss 血条
    if (g.boss && g.boss.state === 'fight') {
      const w = VW - 120;
      const x = 60;
      const y = 82;
      const hp = this.bossHpPct();
      ctx.fillStyle = 'rgba(4,8,20,0.7)';
      ctx.fillRect(x - 2, y - 2, w + 4, 10);
      const grd = ctx.createLinearGradient(x, 0, x + w, 0);
      grd.addColorStop(0, '#FF3A6A');
      grd.addColorStop(1, '#FF9A3C');
      ctx.fillStyle = grd;
      ctx.fillRect(x, y, w * hp, 6);
      this.text(g.boss.def.name + (g.boss.core.open ? ' · 核心暴露' : ''), VW / 2, y - 6, 'bold 12px sans-serif', g.boss.core.open ? '#FF9AE0' : '#FFFFFF', 'center');
    }
    // 关卡开场字幕
    if (g.intro > 0) {
      const a = Math.min(1, g.intro, 3 - g.intro + 0.2);
      ctx.globalAlpha = clamp(a, 0, 1);
      this.text(`STAGE ${g.stage.id}`, VW / 2, VH * 0.36, 'bold 16px sans-serif', '#6FC8FF', 'center');
      this.text(g.stage.name, VW / 2, VH * 0.36 + 34, 'bold 30px sans-serif', '#FFFFFF', 'center');
      this.text(g.stage.en, VW / 2, VH * 0.36 + 56, '11px sans-serif', 'rgba(220,230,255,0.8)', 'center');
      ctx.globalAlpha = 1;
    }
    // Boss 警告
    if (g.warnT > 0) {
      const on = Math.floor(g.warnT * 3) % 2 === 0;
      const y = VH * 0.42;
      ctx.fillStyle = 'rgba(160,0,20,0.45)';
      ctx.fillRect(0, y - 30, VW, 52);
      ctx.fillStyle = on ? '#FF3A4A' : '#FFD0D0';
      for (let x = -40 + ((g.t * 60) % 40); x < VW; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, y - 30); ctx.lineTo(x + 14, y - 30); ctx.lineTo(x + 4, y - 22); ctx.lineTo(x - 10, y - 22);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x, y + 14); ctx.lineTo(x + 14, y + 14); ctx.lineTo(x + 4, y + 22); ctx.lineTo(x - 10, y + 22);
        ctx.fill();
      }
      this.text('WARNING', VW / 2, y + 2, 'bold 26px sans-serif', on ? '#FFFFFF' : '#FF6A6A', 'center');
      this.text(g.boss.def.name + ' 接近中', VW / 2, y + 40, 'bold 13px sans-serif', '#FFD0D0', 'center');
    }
  },
});
