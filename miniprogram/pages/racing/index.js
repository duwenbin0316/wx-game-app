// ─── Clawd 夜行赛车(伪 3D 弯道赛车)──────────────────────
// 经典伪 3D 路面:赛道切成等长路段,每段带曲率与坡度,按
// 透视投影从远到近绘制多边形,曲率逐段累加形成弯道;
// 精灵(对手车/路灯/树)随距离缩放。玩法为街机计时赛:
// 撞车与压草地会掉速,吃氮气冲刺,过检查点续命。
const { GRID_COLS, GRID_ROWS, drawClawd } = require('../../utils/clawd');

// ── 赛道 / 相机参数 ──
const SEG_LEN   = 200;        // 单个路段长度(世界单位)
const RUMBLE_LEN = 3;         // 每 N 段翻转一次路肩明暗
const ROAD_W    = 2000;       // 路面半宽
const LANES     = 3;
const FOV       = 100;
const CAM_H     = 1000;
const DRAW_DIST = 120;        // 可视路段数
const FOG_DENSITY = 5;
const CAM_DEPTH = 1 / Math.tan((FOV / 2) * Math.PI / 180);
const PLAYER_Z  = CAM_H * CAM_DEPTH;

// ── 车辆动力学 ──
const MAX_SPEED  = SEG_LEN * 60;      // 世界单位/秒
const ACCEL      = MAX_SPEED / 4.5;
const BRAKING    = -MAX_SPEED / 1.6;
const DECEL      = -MAX_SPEED / 6;
const OFF_DECEL  = -MAX_SPEED / 1.8;  // 压草地掉速
const OFF_LIMIT  = MAX_SPEED / 3.6;   // 草地上的限速
const CENTRIFUGAL = 0.32;             // 弯道离心力
const NITRO_MULT = 1.38;
const NITRO_TIME = 2.6;
const CRASH_KEEP = 0.28;              // 撞车后保留的速度比例

// ── 街机规则 ──
const START_TIME = 62;
const CP_METERS  = 1100;      // 每这么多米一个检查点
const CP_BONUS   = 14;        // 检查点奖励秒数
const M_PER_UNIT = 1 / 200;   // 世界单位 → 米
const KMH_PER_UNIT = 3.6 * M_PER_UNIT;
const TRAFFIC_N  = 28;
const MAX_NITRO  = 3;
const STORAGE_KEY = 'racing_best';

// ── 调色板(夜景)──
const SKY_RGB = [26, 26, 46];
const PAL = {
  roadL:   [60, 60, 84],
  roadD:   [52, 52, 74],
  grassL:  [30, 34, 58],
  grassD:  [25, 28, 50],
  rumbleL: [217, 119, 87],
  rumbleD: [245, 200, 66],
  lane:    [200, 206, 236],
  startL:  [235, 235, 245],
  startD:  [40, 40, 60],
};
const FOG_STEPS = 12;

// 预生成"颜色 × 雾浓度"查表,避免每帧拼字符串
const COLOR_LUT = (() => {
  const lut = {};
  Object.keys(PAL).forEach(k => {
    const c = PAL[k];
    lut[k] = [];
    for (let i = 0; i < FOG_STEPS; i++) {
      const f = (i + 0.5) / FOG_STEPS;   // f=1 清晰,f→0 融入天空
      lut[k].push(`rgb(${Math.round(c[0] * f + SKY_RGB[0] * (1 - f))},${
        Math.round(c[1] * f + SKY_RGB[1] * (1 - f))},${
        Math.round(c[2] * f + SKY_RGB[2] * (1 - f))})`);
    }
  });
  return lut;
})();

const CAR_COLORS = [
  ['#4A6FA5', '#6B92C8'],
  ['#A855F7', '#C589FF'],
  ['#4CAF50', '#6FD173'],
  ['#FF6B6B', '#FF9C9C'],
  ['#F5C842', '#FFE07A'],
];

// ── 赛道构建用的量级 ──
const LEN   = { short: 25, medium: 50, long: 100 };
const CURVE = { easy: 2, medium: 4, hard: 6 };
const HILL  = { low: 20, medium: 40, high: 60 };

function easeIn(a, b, p)    { return a + (b - a) * Math.pow(p, 2); }
function easeInOut(a, b, p) { return a + (b - a) * (-Math.cos(p * Math.PI) / 2 + 0.5); }
function lerp(a, b, p)      { return a + (b - a) * p; }

Page({
  data: {
    gameState: 'idle',   // 'idle' | 'playing' | 'over'
    best: 0,
    isNewBest: false,
    dist: 0,
    topSpeed: 0,
  },

  onLoad() {
    this._best = wx.getStorageSync(STORAGE_KEY) || 0;
    this.setData({ best: this._best });
    this._initAudio();
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
        this._ctx = ctx;
        this._W = w;
        this._H = h;
        this._horizon = Math.round(h * 0.42);

        this._buildTrack();
        this._initStars();
        this._resetRun();
        this._startLoop();
      });
  },

  onShow() {
    if (this._canvas) this._startLoop();
    if (this.data.gameState === 'playing') this._startEngine();
  },

  onHide() {
    this._stopLoop();
    this._stopEngine();
  },

  onUnload() {
    this._stopLoop();
    this._stopEngine();
    if (this._wac) {
      try { this._wac.close(); } catch (e) {}
      this._wac = null;
    }
  },

  noop() {},

  onShareAppMessage() {
    const d = this.data.dist || 0;
    return {
      title: d > 0
        ? `我在 Clawd 夜行赛车跑了 ${d} 米,来飙一把～`
        : '伪 3D 夜景赛车!压弯、氮气冲刺,一起来跑～',
      path: '/pages/racing/index',
    };
  },

  // ── 赛道构建 ────────────────────────────────────────────
  _buildTrack() {
    const segs = [];
    const add = (curve, y) => {
      const n = segs.length;
      segs.push({
        index: n,
        curve,
        y1: n === 0 ? 0 : segs[n - 1].y2,
        y2: y,
        z1: n * SEG_LEN,
        z2: (n + 1) * SEG_LEN,
        light: Math.floor(n / RUMBLE_LEN) % 2 === 1,
        start: false,
        sprites: [],
        cars: [],
      });
    };
    // dy 以"坡度单位"给出,换算成世界高度需乘以段长
    const addRoad = (enter, hold, leave, curve, dy) => {
      const startY = segs.length ? segs[segs.length - 1].y2 : 0;
      const endY = startY + dy * SEG_LEN;
      const total = enter + hold + leave;
      for (let i = 0; i < enter; i++) add(easeIn(0, curve, i / enter), easeInOut(startY, endY, i / total));
      for (let i = 0; i < hold; i++)  add(curve, easeInOut(startY, endY, (enter + i) / total));
      for (let i = 0; i < leave; i++) add(easeInOut(curve, 0, i / leave), easeInOut(startY, endY, (enter + hold + i) / total));
    };

    this._segments = segs;
    // 起步直道 → 缓弯上坡 → 长直道 → 连续急弯 → 大坡 → 回正
    addRoad(LEN.short, LEN.short, LEN.short, 0, 0);
    addRoad(LEN.medium, LEN.medium, LEN.medium, CURVE.easy, HILL.low);
    addRoad(LEN.medium, LEN.medium, LEN.medium, -CURVE.medium, -HILL.low);
    addRoad(LEN.long, LEN.long, LEN.medium, 0, HILL.medium);
    addRoad(LEN.medium, LEN.medium, LEN.medium, CURVE.hard, -HILL.medium);
    addRoad(LEN.short, LEN.medium, LEN.short, -CURVE.hard, 0);
    addRoad(LEN.medium, LEN.long, LEN.medium, CURVE.medium, HILL.high);
    addRoad(LEN.medium, LEN.medium, LEN.medium, -CURVE.easy, -HILL.high);
    addRoad(LEN.short, LEN.medium, LEN.short, CURVE.hard, HILL.low);
    addRoad(LEN.medium, LEN.medium, LEN.medium, -CURVE.medium, -HILL.low);
    addRoad(LEN.long, LEN.medium, LEN.short, 0, 0);
    // 收尾:把高度拉回 0,保证首尾无缝衔接
    const lastY = segs[segs.length - 1].y2;
    addRoad(LEN.short, LEN.short, LEN.short, 0, -lastY / SEG_LEN);
    segs[segs.length - 1].y2 = 0;

    this._trackLen = segs.length * SEG_LEN;

    // 起跑线标记
    for (let i = 0; i < RUMBLE_LEN * 2; i++) segs[i].start = true;

    // 路边景物:交替的路灯与树,弯道外侧多放一些
    for (let n = 0; n < segs.length; n += 4) {
      const side = (n / 4) % 2 === 0 ? -1 : 1;
      segs[n].sprites.push({
        type: n % 12 === 0 ? 'lamp' : 'tree',
        offset: side * (1.35 + Math.random() * 0.9),
      });
    }
    for (let n = 30; n < segs.length; n += 60) {
      segs[n].sprites.push({ type: 'sign', offset: 1.45 });
    }
    // 氮气:散布在路面上
    this._nitroSprites = [];
    for (let n = 45; n < segs.length; n += 75) {
      const sp = { type: 'nitro', offset: (Math.random() * 1.4 - 0.7), taken: 0 };
      segs[n].sprites.push(sp);
      this._nitroSprites.push({ sp, seg: segs[n] });
    }
  },

  _segmentAt(z) {
    const len = this._trackLen;
    let zz = z % len;
    if (zz < 0) zz += len;
    return this._segments[Math.floor(zz / SEG_LEN)];
  },

  // ── 开局 ────────────────────────────────────────────────
  _resetRun() {
    this._position = 0;
    this._speed = 0;
    this._playerX = 0;
    this._dist = 0;
    this._time = START_TIME;
    this._nextCP = CP_METERS;
    this._nitro = 1;
    this._nitroT = 0;
    this._topSpeed = 0;
    this._keys = { left: false, right: false, brake: false };
    this._steerVis = 0;
    this._shake = 0;
    this._flash = 0;
    this._labels = [];
    this._parts = [];
    this._frame = 0;
    this._crashT = 0;
    this._resetTraffic();
    this._nitroSprites.forEach(n => { n.sp.taken = 0; });
  },

  _resetTraffic() {
    this._segments.forEach(s => { s.cars.length = 0; });
    this._cars = [];
    const count = this._segments.length;
    for (let i = 0; i < TRAFFIC_N; i++) {
      // 起跑前 40 段不放车,免得一开局就撞
      const idx = 40 + Math.floor(Math.random() * (count - 60));
      const car = {
        offset: (Math.random() * 1.6 - 0.8),
        z: idx * SEG_LEN,
        speed: MAX_SPEED * (0.28 + Math.random() * 0.3),
        color: i % CAR_COLORS.length,
      };
      this._cars.push(car);
      this._segmentAt(car.z).cars.push(car);
    }
  },

  onStart() {
    this._resetRun();
    this.setData({ gameState: 'playing', isNewBest: false, dist: 0, topSpeed: 0 });
    this._startLoop();
    this._startEngine();
  },

  onRetry() { this.onStart(); },

  // ── 输入 ────────────────────────────────────────────────
  onLeftStart()  { this._keys.left = true; },
  onLeftEnd()    { this._keys.left = false; },
  onRightStart() { this._keys.right = true; },
  onRightEnd()   { this._keys.right = false; },
  onBrakeStart() { this._keys.brake = true; },
  onBrakeEnd()   { this._keys.brake = false; },

  onNitro() {
    if (this.data.gameState !== 'playing') return;
    if (this._nitro <= 0 || this._nitroT > 0) return;
    this._nitro--;
    this._nitroT = NITRO_TIME;
    this._addLabel('氮气冲刺!', '#60C0FF');
    this._sfxNitro();
  },

  // ── 主循环 ──────────────────────────────────────────────
  _startLoop() {
    if (this._raf || !this._canvas) return;
    this._lastTs = 0;
    const step = (ts) => {
      this._raf = this._canvas.requestAnimationFrame(step);
      const dt = this._lastTs ? Math.min(0.05, (ts - this._lastTs) / 1000) : 0.016;
      this._lastTs = ts;
      this._update(dt);
      this._draw();
    };
    this._raf = this._canvas.requestAnimationFrame(step);
  },

  _stopLoop() {
    if (this._raf && this._canvas) this._canvas.cancelAnimationFrame(this._raf);
    this._raf = null;
  },

  _update(dt) {
    this._frame++;
    // 特效衰减在任何状态下都跑,保证结算画面不僵住
    this._labels = this._labels.filter(lb => ++lb.f < 55);
    this._parts = this._parts.filter(p => {
      p.x += p.vx; p.y += p.vy; p.vy += 0.35;
      return --p.life > 0;
    });
    if (this.data.gameState !== 'playing') return;

    const playerSeg = this._segmentAt(this._position + PLAYER_Z);
    const boost = this._nitroT > 0 ? NITRO_MULT : 1;
    const topSpeed = MAX_SPEED * boost;
    const speedPct = this._speed / MAX_SPEED;

    // ── 转向:转向量与车速挂钩,弯道给离心力 ──
    const dx = dt * 2.4 * speedPct;
    let steer = 0;
    if (this._keys.left)  steer -= 1;
    if (this._keys.right) steer += 1;
    this._playerX += dx * steer;
    this._playerX -= dx * speedPct * playerSeg.curve * CENTRIFUGAL;
    this._playerX = Math.max(-2.2, Math.min(2.2, this._playerX));
    this._steerVis += (steer - this._steerVis) * 0.2;

    // ── 油门 / 刹车 ──
    if (this._crashT > 0) {
      this._crashT -= dt;
      this._speed += DECEL * dt;
    } else if (this._keys.brake) {
      this._speed += BRAKING * dt;
    } else {
      this._speed += ACCEL * boost * dt;
    }

    // ── 压草地 ──
    const offRoad = Math.abs(this._playerX) > 1;
    if (offRoad) {
      if (this._speed > OFF_LIMIT) this._speed += OFF_DECEL * dt;
      if (this._frame % 4 === 0) {
        this._shake = Math.max(this._shake, 2.2);
        this._burst(this._W / 2 - this._steerVis * 20, this._H - 60, '#3A3A55', 2, 3);
      }
    }
    this._speed = Math.max(0, Math.min(topSpeed, this._speed));
    if (this._nitroT > 0) this._nitroT -= dt;

    // ── 前进 ──
    const adv = this._speed * dt;
    this._position = (this._position + adv) % this._trackLen;
    this._dist += adv;
    const kmh = Math.round(this._speed * KMH_PER_UNIT);
    if (kmh > this._topSpeed) this._topSpeed = kmh;

    // ── 对手车前进(跨段时迁移到新段的车列表)──
    for (const car of this._cars) {
      const oldSeg = this._segmentAt(car.z);
      car.z = (car.z + car.speed * dt) % this._trackLen;
      const newSeg = this._segmentAt(car.z);
      if (oldSeg !== newSeg) {
        const i = oldSeg.cars.indexOf(car);
        if (i >= 0) oldSeg.cars.splice(i, 1);
        newSeg.cars.push(car);
      }
    }

    // ── 碰撞:同段且横向重叠 ──
    if (this._crashT <= 0) {
      for (const car of playerSeg.cars) {
        if (this._speed > car.speed && Math.abs(this._playerX - car.offset) < 0.42) {
          this._crash(car);
          break;
        }
      }
    }

    // ── 氮气拾取 ──
    for (const sp of playerSeg.sprites) {
      if (sp.type !== 'nitro' || sp.taken > 0) continue;
      if (Math.abs(this._playerX - sp.offset) < 0.5) {
        sp.taken = 18;   // 18 秒后重新出现
        if (this._nitro < MAX_NITRO) {
          this._nitro++;
          this._addLabel('氮气 +1', '#60C0FF');
        } else {
          this._time += 2;
          this._addLabel('时间 +2s', '#F5C842');
        }
        this._sfxPickup();
      }
    }
    this._nitroSprites.forEach(n => {
      if (n.sp.taken > 0) n.sp.taken = Math.max(0, n.sp.taken - dt);
    });

    // ── 计时与检查点 ──
    this._time -= dt;
    const meters = this._dist * M_PER_UNIT;
    while (meters >= this._nextCP) {
      this._time += CP_BONUS;
      this._nextCP += CP_METERS;
      this._addLabel(`检查点! +${CP_BONUS}s`, '#4CAF50');
      this._sfxCheckpoint();
    }
    if (this._time <= 0) {
      this._time = 0;
      this._finish();
    }

    if (this._flash > 0.02) this._flash *= 0.9;
  },

  _crash(car) {
    this._speed *= CRASH_KEEP;
    this._crashT = 0.55;
    this._shake = 7;
    this._flash = 0.4;
    // 被撞的车向外弹开一点,避免持续贴着刮蹭
    car.offset += (car.offset > this._playerX ? 0.35 : -0.35);
    car.offset = Math.max(-0.85, Math.min(0.85, car.offset));
    this._addLabel('撞车!', '#FF6B6B');
    this._burst(this._W / 2, this._H - 96, '#FF6B6B', 12, 5);
    this._sfxCrash();
  },

  _finish() {
    const meters = Math.round(this._dist * M_PER_UNIT);
    const isNewBest = meters > this._best;
    if (isNewBest) {
      this._best = meters;
      wx.setStorageSync(STORAGE_KEY, this._best);
    }
    this._stopEngine();
    this._sfxFinish();
    this.setData({
      gameState: 'over',
      dist: meters,
      topSpeed: this._topSpeed,
      best: this._best,
      isNewBest,
    });
  },

  _addLabel(text, color) {
    this._labels.push({ text, color, f: 0 });
    if (this._labels.length > 3) this._labels.shift();
  },

  _burst(x, y, color, n, spread) {
    for (let i = 0; i < n; i++) {
      this._parts.push({
        x, y,
        vx: (Math.random() - 0.5) * spread * 2,
        vy: -Math.random() * 3 - 0.5,
        life: 16 + Math.random() * 14,
        color,
        sz: 2 + Math.floor(Math.random() * 2),
      });
    }
  },

  // ── 渲染 ────────────────────────────────────────────────
  _fogIdx(n) {
    const fog = 1 / Math.pow(Math.E, (n / DRAW_DIST) * (n / DRAW_DIST) * FOG_DENSITY);
    return Math.max(0, Math.min(FOG_STEPS - 1, Math.floor(fog * FOG_STEPS)));
  },

  _draw() {
    const ctx = this._ctx;
    if (!ctx) return;
    const W = this._W, H = this._H;

    ctx.save();
    if (this._shake > 0.3) {
      ctx.translate((Math.random() * 2 - 1) * this._shake, (Math.random() * 2 - 1) * this._shake);
      this._shake *= 0.86;
    } else {
      this._shake = 0;
    }

    const baseSeg = this._segmentAt(this._position);
    const basePct = (this._position % SEG_LEN) / SEG_LEN;
    const playerSeg = this._segmentAt(this._position + PLAYER_Z);
    const playerPct = ((this._position + PLAYER_Z) % SEG_LEN) / SEG_LEN;
    const playerY = lerp(playerSeg.y1, playerSeg.y2, playerPct);
    const camY = playerY + CAM_H;
    const camXBase = this._playerX * ROAD_W;

    this._drawSky(ctx, W, H, baseSeg);

    // ── 路面:由近及远投影,并按曲率累加横移 ──
    let x = 0;
    let dx = -(baseSeg.curve * basePct);
    let maxy = H;
    const count = this._segments.length;

    for (let n = 0; n < DRAW_DIST; n++) {
      const seg = this._segments[(baseSeg.index + n) % count];
      const looped = seg.index < baseSeg.index;
      const camZ = this._position - (looped ? this._trackLen : 0);

      const s1 = this._project(seg.z1, seg.y1, camXBase - x, camY, camZ, W, H);
      const s2 = this._project(seg.z2, seg.y2, camXBase - x - dx, camY, camZ, W, H);
      seg.sx1 = s1.x; seg.sy1 = s1.y; seg.sw1 = s1.w; seg.ss1 = s1.scale; seg.cz1 = s1.cz;
      seg.sx2 = s2.x; seg.sy2 = s2.y; seg.sw2 = s2.w; seg.ss2 = s2.scale;
      seg.clip = maxy;
      seg.fogI = this._fogIdx(n);

      x += dx;
      dx += seg.curve;

      if (s1.cz <= CAM_DEPTH || s2.y >= s1.y || s2.y >= maxy) continue;
      this._drawSegment(ctx, W, seg);
      maxy = s2.y;
    }

    // ── 精灵:由远及近绘制,保证近处遮挡远处 ──
    for (let n = DRAW_DIST - 1; n > 0; n--) {
      const seg = this._segments[(baseSeg.index + n) % count];
      if (seg.sw1 === undefined) continue;
      for (const car of seg.cars) {
        const pct = (car.z % SEG_LEN) / SEG_LEN;
        const sc = lerp(seg.ss1, seg.ss2, pct);
        const sx = lerp(seg.sx1, seg.sx2, pct) + sc * car.offset * ROAD_W * W / 2;
        const sy = lerp(seg.sy1, seg.sy2, pct);
        this._drawRival(ctx, sx, sy, sc * ROAD_W * W / 2, car, seg.clip, seg.fogI);
      }
      for (const sp of seg.sprites) {
        if (sp.type === 'nitro' && sp.taken > 0) continue;
        const sx = seg.sx1 + seg.ss1 * sp.offset * ROAD_W * W / 2;
        this._drawSprite(ctx, sx, seg.sy1, seg.ss1 * ROAD_W * W / 2, sp, seg.clip, seg.fogI);
      }
    }

    // ── 玩家车 ──
    this._drawPlayerCar(ctx, W, H);

    // ── 氮气速度线 ──
    if (this._nitroT > 0) {
      ctx.strokeStyle = 'rgba(96, 192, 255, 0.35)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + this._frame * 0.3;
        const r0 = 70 + (i % 3) * 30;
        const cx = W / 2, cy = this._horizon + 40;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0 * 0.6);
        ctx.lineTo(cx + Math.cos(a) * (r0 + 46), cy + Math.sin(a) * (r0 + 46) * 0.6);
        ctx.stroke();
      }
    }

    // 粒子
    for (const p of this._parts) {
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.min(1, p.life / 12);
      ctx.fillRect(p.x, p.y, p.sz, p.sz);
    }
    ctx.globalAlpha = 1;

    // 撞车红闪
    if (this._flash > 0.02) {
      ctx.fillStyle = `rgba(255, 80, 80, ${this._flash})`;
      ctx.fillRect(-10, -10, W + 20, H + 20);
    }

    this._drawHUD(ctx, W, H);

    // 浮字
    for (let i = 0; i < this._labels.length; i++) {
      const lb = this._labels[i];
      const a = lb.f < 6 ? lb.f / 6 : 1 - Math.max(0, lb.f - 30) / 25;
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = lb.color;
      ctx.font = 'bold 22px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(lb.text, W / 2, H * 0.34 - lb.f * 0.5 + i * 26);
    }
    ctx.globalAlpha = 1;

    ctx.restore();
  },

  _project(z, y, camX, camY, camZ, W, H) {
    const cz = z - camZ;
    const scale = CAM_DEPTH / (cz || 0.0001);
    return {
      cz,
      scale,
      x: Math.round(W / 2 - scale * camX * W / 2),
      y: Math.round(H / 2 - scale * (y - camY) * H / 2),
      w: Math.round(scale * ROAD_W * W / 2),
    };
  },

  _drawSegment(ctx, W, seg) {
    const f = seg.fogI;
    const x1 = seg.sx1, y1 = seg.sy1, w1 = seg.sw1;
    const x2 = seg.sx2, y2 = seg.sy2, w2 = seg.sw2;
    const light = seg.light;

    // 草地
    ctx.fillStyle = COLOR_LUT[light ? 'grassL' : 'grassD'][f];
    ctx.fillRect(0, y2, W, y1 - y2);

    // 路肩(远到只剩几像素时省略,雾里本来也看不见)
    if (w1 > 5) {
      const r1 = w1 / Math.max(6, 2 * LANES);
      const r2 = w2 / Math.max(6, 2 * LANES);
      ctx.fillStyle = seg.start
        ? COLOR_LUT[light ? 'startL' : 'startD'][f]
        : COLOR_LUT[light ? 'rumbleL' : 'rumbleD'][f];
      this._quad(ctx, x1 - w1 - r1, y1, x1 - w1, y1, x2 - w2, y2, x2 - w2 - r2, y2);
      this._quad(ctx, x1 + w1 + r1, y1, x1 + w1, y1, x2 + w2, y2, x2 + w2 + r2, y2);
    }

    // 路面
    ctx.fillStyle = seg.start
      ? COLOR_LUT[light ? 'startL' : 'startD'][f]
      : COLOR_LUT[light ? 'roadL' : 'roadD'][f];
    this._quad(ctx, x1 - w1, y1, x1 + w1, y1, x2 + w2, y2, x2 - w2, y2);

    // 车道线(只在亮段画,形成虚线;远处省略)
    if (light && !seg.start && w1 > 14) {
      const lw1 = w1 / Math.max(32, 8 * LANES);
      const lw2 = w2 / Math.max(32, 8 * LANES);
      const lane1 = (w1 * 2) / LANES;
      const lane2 = (w2 * 2) / LANES;
      let lx1 = x1 - w1 + lane1;
      let lx2 = x2 - w2 + lane2;
      ctx.fillStyle = COLOR_LUT.lane[f];
      for (let l = 1; l < LANES; l++) {
        this._quad(ctx, lx1 - lw1, y1, lx1 + lw1, y1, lx2 + lw2, y2, lx2 - lw2, y2);
        lx1 += lane1;
        lx2 += lane2;
      }
    }
  },

  _quad(ctx, x1, y1, x2, y2, x3, y3, x4, y4) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y3);
    ctx.lineTo(x4, y4);
    ctx.closePath();
    ctx.fill();
  },

  // 天空:星空 + 月亮 + 远景城市剪影(随弯道横移)
  _drawSky(ctx, W, H, baseSeg) {
    ctx.fillStyle = '#1A1A2E';
    ctx.fillRect(-10, -10, W + 20, H + 20);

    this._skyOff = (this._skyOff || 0) - baseSeg.curve * this._speed * 0.000018;
    const off = this._skyOff;

    ctx.fillStyle = '#5A5A8A';
    for (const s of this._stars) {
      const sx = ((s.x + off * 30) % (W + 20) + W + 20) % (W + 20) - 10;
      ctx.fillRect(sx, s.y, s.sz, s.sz);
    }

    // 月亮
    const mx = ((W * 0.78 + off * 18) % (W + 60) + W + 60) % (W + 60) - 30;
    ctx.fillStyle = 'rgba(184, 204, 232, 0.9)';
    ctx.beginPath(); ctx.arc(mx, H * 0.14, 22, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1A1A2E';
    ctx.beginPath(); ctx.arc(mx + 9, H * 0.13, 18, 0, Math.PI * 2); ctx.fill();

    // 远景城市
    const hy = this._horizon;
    ctx.fillStyle = '#1F1F38';
    for (const b of this._city) {
      const bx = ((b.x + off * 60) % (W + 120) + W + 120) % (W + 120) - 60;
      ctx.fillRect(bx, hy - b.h, b.w, b.h);
      ctx.fillStyle = 'rgba(74, 111, 165, 0.35)';
      for (let wy = hy - b.h + 5; wy < hy - 4; wy += 9) {
        for (let wx = bx + 3; wx < bx + b.w - 4; wx += 8) ctx.fillRect(wx, wy, 3, 4);
      }
      ctx.fillStyle = '#1F1F38';
    }
  },

  _drawRival(ctx, cx, yBottom, halfRoadPx, car, clip, fogI) {
    const w = Math.round(halfRoadPx * 0.44);
    if (w < 3) return;
    const h = Math.round(w * 0.72);
    const x = Math.round(cx - w / 2);
    const y = Math.round(yBottom - h);
    if (y > clip) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, this._W, clip);
    ctx.clip();
    ctx.globalAlpha = 0.35 + 0.65 * ((fogI + 1) / FOG_STEPS);

    const [body, light] = CAR_COLORS[car.color];
    // 车影
    ctx.fillStyle = 'rgba(10, 10, 26, 0.45)';
    ctx.fillRect(x - w * 0.06, yBottom - h * 0.12, w * 1.12, h * 0.18);
    // 车身 + 车顶
    ctx.fillStyle = body;
    ctx.fillRect(x, y + h * 0.32, w, h * 0.62);
    ctx.fillRect(x + w * 0.16, y, w * 0.68, h * 0.4);
    // 后窗
    ctx.fillStyle = '#12122A';
    ctx.fillRect(x + w * 0.24, y + h * 0.08, w * 0.52, h * 0.26);
    // 高光与尾灯
    ctx.fillStyle = light;
    ctx.fillRect(x, y + h * 0.32, w, Math.max(1, h * 0.08));
    ctx.fillStyle = '#FF6B6B';
    ctx.fillRect(x + w * 0.06, y + h * 0.6, w * 0.2, Math.max(1, h * 0.16));
    ctx.fillRect(x + w * 0.74, y + h * 0.6, w * 0.2, Math.max(1, h * 0.16));
    // 轮胎
    ctx.fillStyle = '#0E0E22';
    ctx.fillRect(x - w * 0.06, y + h * 0.66, w * 0.14, h * 0.3);
    ctx.fillRect(x + w * 0.92, y + h * 0.66, w * 0.14, h * 0.3);

    ctx.restore();
  },

  _drawSprite(ctx, cx, yBottom, halfRoadPx, sp, clip, fogI) {
    const alpha = 0.3 + 0.7 * ((fogI + 1) / FOG_STEPS);
    if (halfRoadPx < 6) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, this._W, clip);
    ctx.clip();
    ctx.globalAlpha = alpha;

    if (sp.type === 'tree') {
      const w = halfRoadPx * 0.3;
      const h = w * 2.1;
      ctx.fillStyle = '#2A2A44';
      ctx.fillRect(cx - w * 0.1, yBottom - h * 0.35, w * 0.2, h * 0.35);
      ctx.fillStyle = '#23503A';
      ctx.beginPath();
      ctx.moveTo(cx, yBottom - h);
      ctx.lineTo(cx + w * 0.6, yBottom - h * 0.3);
      ctx.lineTo(cx - w * 0.6, yBottom - h * 0.3);
      ctx.closePath();
      ctx.fill();
    } else if (sp.type === 'lamp') {
      const h = halfRoadPx * 0.62;
      const w = Math.max(1, halfRoadPx * 0.035);
      const dir = sp.offset > 0 ? -1 : 1;
      ctx.fillStyle = '#3A3A58';
      ctx.fillRect(cx - w / 2, yBottom - h, w, h);
      ctx.fillRect(cx, yBottom - h, dir * h * 0.22, w);
      // 灯头与光晕
      const lx = cx + dir * h * 0.22;
      ctx.fillStyle = '#F5C842';
      ctx.fillRect(lx - w, yBottom - h, w * 2.4, w * 2);
      ctx.globalAlpha = alpha * 0.18;
      ctx.beginPath();
      ctx.arc(lx, yBottom - h, h * 0.24, 0, Math.PI * 2);
      ctx.fill();
    } else if (sp.type === 'sign') {
      const w = halfRoadPx * 0.36;
      const h = w * 0.62;
      const poleH = halfRoadPx * 0.3;
      ctx.fillStyle = '#3A3A58';
      ctx.fillRect(cx - w * 0.05, yBottom - poleH, w * 0.1, poleH);
      ctx.fillStyle = '#D97757';
      ctx.fillRect(cx - w / 2, yBottom - poleH - h, w, h);
      ctx.fillStyle = '#1A1A2E';
      ctx.fillRect(cx - w * 0.34, yBottom - poleH - h * 0.68, w * 0.68, h * 0.18);
    } else if (sp.type === 'nitro') {
      const s = halfRoadPx * 0.16;
      if (s < 2) { ctx.restore(); return; }
      const pulse = 0.7 + 0.3 * Math.sin(this._frame / 6);
      ctx.globalAlpha = alpha * pulse;
      ctx.fillStyle = '#60C0FF';
      ctx.beginPath();
      ctx.moveTo(cx, yBottom - s * 2.4);
      ctx.lineTo(cx + s, yBottom - s * 1.1);
      ctx.lineTo(cx + s * 0.3, yBottom - s * 1.1);
      ctx.lineTo(cx + s * 0.5, yBottom);
      ctx.lineTo(cx - s, yBottom - s * 1.3);
      ctx.lineTo(cx - s * 0.25, yBottom - s * 1.3);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  },

  // 玩家车:后视像素造型,Clawd 露在敞篷座舱里
  _drawPlayerCar(ctx, W, H) {
    const speedPct = this._speed / MAX_SPEED;
    const bob = Math.sin(this._frame * 0.35) * (0.6 + speedPct * 1.6);
    const w = Math.round(W * 0.34);
    const h = Math.round(w * 0.5);
    const cx = Math.round(W / 2 + this._steerVis * 14);
    const yB = Math.round(H - 66 + bob);
    const x = cx - w / 2;
    const y = yB - h;

    // 地面投影
    ctx.fillStyle = 'rgba(10, 10, 26, 0.5)';
    ctx.beginPath();
    ctx.ellipse(cx, yB + 4, w * 0.56, h * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();

    // Clawd 坐在座舱里(先画,车身盖住下半身)
    const ps = w / 46;
    drawClawd(ctx, cx - GRID_COLS * ps / 2, y - GRID_ROWS * ps * 0.52, ps, { legFrame: 'all' });

    // 车身
    ctx.fillStyle = '#D97757';
    ctx.fillRect(x, y + h * 0.3, w, h * 0.58);
    // 侧裙暗部
    ctx.fillStyle = '#A85535';
    ctx.fillRect(x, y + h * 0.74, w, h * 0.14);
    // 车身高光
    ctx.fillStyle = '#F0956F';
    ctx.fillRect(x, y + h * 0.3, w, Math.max(2, h * 0.07));
    // 尾翼
    ctx.fillStyle = '#C0C0E8';
    ctx.fillRect(x + w * 0.08, y + h * 0.16, w * 0.84, h * 0.09);
    ctx.fillStyle = '#8A8AA5';
    ctx.fillRect(x + w * 0.12, y + h * 0.25, w * 0.06, h * 0.08);
    ctx.fillRect(x + w * 0.82, y + h * 0.25, w * 0.06, h * 0.08);
    // 尾灯(刹车时更亮)
    const brakeOn = this._keys && this._keys.brake;
    ctx.fillStyle = brakeOn ? '#FF3B3B' : '#B33A3A';
    ctx.fillRect(x + w * 0.07, y + h * 0.46, w * 0.18, h * 0.14);
    ctx.fillRect(x + w * 0.75, y + h * 0.46, w * 0.18, h * 0.14);
    // 排气火焰(氮气中)
    if (this._nitroT > 0) {
      const fl = 6 + Math.random() * 10;
      ctx.fillStyle = '#60C0FF';
      ctx.fillRect(cx - w * 0.16, yB - h * 0.1, w * 0.1, fl);
      ctx.fillRect(cx + w * 0.06, yB - h * 0.1, w * 0.1, fl);
    }
    // 轮胎
    ctx.fillStyle = '#0E0E22';
    ctx.fillRect(x - w * 0.05, y + h * 0.58, w * 0.13, h * 0.36);
    ctx.fillRect(x + w * 0.92, y + h * 0.58, w * 0.13, h * 0.36);
  },

  _drawHUD(ctx, W, H) {
    const meters = Math.round(this._dist * M_PER_UNIT);
    const kmh = Math.round(this._speed * KMH_PER_UNIT);

    if (this.data.gameState === 'playing') {
      // 剩余时间
      const t = Math.max(0, this._time);
      const urgent = t <= 10;
      ctx.fillStyle = urgent && Math.floor(this._frame / 8) % 2 === 0 ? '#FF6B6B' : '#FFFFFF';
      ctx.font = 'bold 40px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(t.toFixed(1), W / 2, 46);
      ctx.fillStyle = 'rgba(160,160,200,0.8)';
      ctx.font = '12px monospace';
      ctx.fillText('TIME', W / 2, 62);
    }

    // 距离
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(160,160,200,0.8)';
    ctx.font = '12px monospace';
    ctx.fillText('DIST', 14, 26);
    ctx.fillStyle = '#F5C842';
    ctx.font = 'bold 22px monospace';
    ctx.fillText(`${meters}m`, 14, 48);

    // 下一个检查点还差多少
    ctx.fillStyle = 'rgba(120,200,140,0.85)';
    ctx.font = '11px monospace';
    ctx.fillText(`下个检查点 ${Math.max(0, Math.ceil(this._nextCP - meters))}m`, 14, 66);

    // 时速表
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(160,160,200,0.8)';
    ctx.font = '12px monospace';
    ctx.fillText('KM/H', W - 14, 26);
    ctx.fillStyle = this._nitroT > 0 ? '#60C0FF' : '#FFFFFF';
    ctx.font = 'bold 30px monospace';
    ctx.fillText(String(kmh), W - 14, 52);

    // 氮气存量
    for (let i = 0; i < MAX_NITRO; i++) {
      const bx = W - 20 - i * 16;
      ctx.fillStyle = i < this._nitro ? '#60C0FF' : 'rgba(96,192,255,0.2)';
      ctx.fillRect(bx, 62, 12, 6);
    }
  },

  _initStars() {
    this._stars = Array.from({ length: 46 }, () => ({
      x: Math.random() * this._W,
      y: Math.random() * this._horizon * 0.85,
      sz: Math.random() < 0.2 ? 2 : 1,
    }));
    this._city = [];
    let bx = -40;
    while (bx < this._W + 60) {
      const bw = 20 + Math.floor(Math.random() * 30);
      this._city.push({ x: bx, w: bw, h: 16 + Math.floor(Math.random() * 40) });
      bx += bw + 6 + Math.floor(Math.random() * 14);
    }
  },

  // ── 音频 ────────────────────────────────────────────────
  _initAudio() {
    try {
      this._wac = wx.createWebAudioContext();
    } catch (e) {
      this._wac = null;
    }
    this._engine = null;
  },

  // 引擎声:锯齿波,频率跟车速走
  _startEngine() {
    if (!this._wac || this._engine) return;
    try {
      const osc = this._wac.createOscillator();
      const sub = this._wac.createOscillator();
      const g = this._wac.createGain();
      osc.type = 'sawtooth';
      sub.type = 'square';
      osc.frequency.value = 60;
      sub.frequency.value = 30;
      g.gain.value = 0.05;
      osc.connect(g);
      sub.connect(g);
      g.connect(this._wac.destination);
      osc.start();
      sub.start();
      this._engine = { osc, sub, g };
      this._engineTimer = setInterval(() => this._tuneEngine(), 60);
    } catch (e) {
      this._engine = null;
    }
  },

  _tuneEngine() {
    if (!this._engine || !this._wac) return;
    try {
      const pct = Math.min(1, this._speed / MAX_SPEED);
      const f = 55 + pct * 175;
      const t = this._wac.currentTime;
      this._engine.osc.frequency.setValueAtTime(f, t);
      this._engine.sub.frequency.setValueAtTime(f / 2, t);
      this._engine.g.gain.setValueAtTime(0.03 + pct * 0.05, t);
    } catch (e) {}
  },

  _stopEngine() {
    if (this._engineTimer) { clearInterval(this._engineTimer); this._engineTimer = null; }
    if (this._engine) {
      try {
        this._engine.osc.stop();
        this._engine.sub.stop();
        this._engine.g.disconnect();
      } catch (e) {}
      this._engine = null;
    }
  },

  _note(freq, start, dur, vol, type) {
    if (!this._wac || !freq) return;
    try {
      const osc = this._wac.createOscillator();
      const g = this._wac.createGain();
      osc.type = type || 'square';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(vol, start);
      g.gain.exponentialRampToValueAtTime(0.001, start + dur);
      osc.connect(g);
      g.connect(this._wac.destination);
      osc.start(start);
      osc.stop(start + dur);
    } catch (e) {}
  },

  _sfxCrash() {
    if (!this._wac) return;
    const now = this._wac.currentTime;
    try {
      const len = Math.floor(this._wac.sampleRate * 0.25);
      const buf = this._wac.createBuffer(1, len, this._wac.sampleRate);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = this._wac.createBufferSource();
      const g = this._wac.createGain();
      src.buffer = buf;
      g.gain.setValueAtTime(0.3, now);
      src.connect(g);
      g.connect(this._wac.destination);
      src.start(now);
    } catch (e) {}
    this._note(140, now, 0.2, 0.2, 'sawtooth');
  },

  _sfxPickup() {
    if (!this._wac) return;
    const now = this._wac.currentTime;
    this._note(880, now, 0.06, 0.14);
    this._note(1320, now + 0.055, 0.08, 0.12);
  },

  _sfxNitro() {
    if (!this._wac) return;
    const now = this._wac.currentTime;
    [392, 523, 659, 880].forEach((f, i) => this._note(f, now + i * 0.05, 0.1, 0.14, 'sawtooth'));
  },

  _sfxCheckpoint() {
    if (!this._wac) return;
    const now = this._wac.currentTime;
    [659, 784, 1046].forEach((f, i) => this._note(f, now + i * 0.08, 0.12, 0.15));
  },

  _sfxFinish() {
    if (!this._wac) return;
    const now = this._wac.currentTime;
    [523, 440, 392, 262].forEach((f, i) => this._note(f, now + i * 0.15, 0.18, 0.18));
  },
});
