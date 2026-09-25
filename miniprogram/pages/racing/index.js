// ─── Clawd 夜行赛车(伪 3D 街机竞速)──────────────────────
// 渲染:经典伪 3D 路面(路段透视投影 + 曲率累加成弯道),路边景物与车辆
// 用启动时生成的像素图集(utils/racing-art.js)按距离缩放绘制,灯光用叠加
// 混合的光晕贴图。赛道分四个区:霓虹城区 → 海滨公路 → 山体隧道 → 月下山道,
// 首尾相接循环,区与区之间的配色平滑过渡。
// 玩法:计时赛。过检查点续时间;贴着车超过去算"擦肩",加时间、攒氮气;
// 高速时按住漂移键再打方向进入漂移,漂得越久火花越亮,松开给一段小加速。
const { buildArt, makeRng, CAR_TYPES, PLAYER_META, SPRITES } = require('../../utils/racing-art');
const { RacingAudio } = require('../../utils/racing-audio');

// ── 赛道 / 相机参数 ──
const SEG_LEN    = 200;       // 单个路段长度(世界单位)
const RUMBLE_LEN = 3;         // 每 N 段翻转一次路肩明暗
const ROAD_W     = 2000;      // 路面半宽
const LANES      = 3;
const FOV        = 100;
const CAM_H      = 1000;
const DRAW_DIST  = 140;       // 可视路段数
const FOG_DENSITY = 4;
const CAM_DEPTH  = 1 / Math.tan((FOV / 2) * Math.PI / 180);
const PLAYER_Z   = CAM_H * CAM_DEPTH;
const HZ_RATIO   = 0.4;       // 地平线在屏幕高度的比例(竖屏把路面让多一些)
const SPR_UNIT   = 20;        // 精灵 1 像素 = 20 世界单位(再乘各精灵自己的 k)

// ── 车辆动力学 ──
// 调校原则:急弯必须"能靠打方向救回来",减速要是可选项而不是惩罚。
// 满速最硬弯(曲率 6)的离心力 = CENTRIFUGAL×6 = 1.8/秒,
// 小于满转向权限 STEER_RATE(2.6/秒),所以方向打死一定拉得回来。
const MAX_SPEED  = SEG_LEN * 60;      // 世界单位/秒
const ACCEL      = MAX_SPEED / 3.4;   // 约 3.4 秒拉到极速
const BRAKING    = -MAX_SPEED / 3.2;  // 刹车是收速度,不是急停
const DECEL      = -MAX_SPEED / 6;
const OFF_DECEL  = -MAX_SPEED / 3;    // 压草地掉速(可恢复)
const OFF_THROTTLE = 0.25;            // 草地上只剩这点驱动力
const OFF_LIMIT  = MAX_SPEED / 2.2;   // 草地上的限速
const OFF_EDGE   = 1.06;              // 压到这里才算出界,给一点路肩宽容
const STEER_RATE = 2.6;               // 满权限下每秒能横移的路宽比例
const STEER_FLOOR = 0.4;              // 低速保留的转向权限(免得掉草地里出不来)
const CENTRIFUGAL = 0.30;             // 离心力系数(按速度平方计)
const NITRO_MULT = 1.38;
const NITRO_TIME = 2.6;
const CRASH_KEEP = 0.45;              // 撞车后保留的速度比例
const PLAYER_HALF = 0.19;             // 玩家车半宽(路宽比例),用于碰撞

// ── 漂移 ──
// 按住漂移键 + 打方向进入;期间离心力大减、转向更灵,速度只缓慢下降。
const DRIFT_MIN   = 0.5;              // 车速过半才能漂
const DRIFT_DECEL = -MAX_SPEED / 16;
const DRIFT_GRIP  = 0.45;             // 漂移时离心力只剩这么多
const DRIFT_STEER = 1.15;
const DRIFT_PULL  = 0.35;             // 车尾甩出带来的向内切
const DRIFT_GAIN  = 0.34;             // 每秒漂移攒多少格氮气
const MT_LV1 = 0.7;                   // 漂这么久出蓝色火花
const MT_LV2 = 1.6;                   // 漂这么久出橙色火花
const MT_MULT = 1.16;                 // 小加速倍率

// ── 场景尺寸(路宽倍数)──
const TUN_W  = 1.32;                  // 隧道半宽
const TUN_H  = 1.15;                  // 隧道高度
const RAIL_X = 1.4;                   // 海边护栏位置
const RAIL_H = 380;                   // 护栏高度(世界单位)
const EDGE_X = 1.45;                  // 路边景物前的硬边界(再往外会撞进楼/树里)

// 转向面板的位置(rpx,需与 wxss 保持一致),用于判断按到了哪半边
const PAD_LEFT_RPX = 24;
const PAD_W_RPX = 320;

// ── 街机规则 ──
const START_TIME = 62;
const CP_METERS  = 1100;      // 每这么多米一个检查点
const CP_BONUS   = 13;        // 检查点奖励秒数(前几个)
const CP_BONUS_MIN = 7;       // 越往后奖励越少,保证一局总会结束
const NEAR_MISS  = 0.8;       // 超车时横向距离小于这个算擦肩
const NEAR_BONUS = 0.25;      // 擦肩奖励秒数
const COMBO_TIME = 2.6;       // 连续擦肩的间隔上限
const HIT_D      = 120;       // 追尾判定距离(世界单位)
const M_PER_UNIT = 1 / 200;   // 世界单位 → 米
const KMH_PER_UNIT = 3.6 * M_PER_UNIT;
const TRAFFIC_N  = 26;
const TRAFFIC_MAX = 40;
const MAX_NITRO  = 3;
const START_GATE = 12;        // 起点龙门所在路段(发车位在它后面几段)
const STORAGE_KEY = 'racing_best';
// 评级门槛(米)。按脚本模拟校准:只踩油门约 5 km(B),熟练擦肩 + 用氮气约 12 km(S)
const GRADES = [['S', 11000], ['A', 7500], ['B', 4500], ['C', 2000], ['D', 0]];

const FOG_STEPS = 12;

// 画质档位:帧率跟不上时自动降档(2 = 全特效)
const QUALITY = [
  { drawDist: 90,  glows: false, pools: false, vignette: false },
  { drawDist: 115, glows: true,  pools: false, vignette: false },
  { drawDist: DRAW_DIST, glows: true, pools: true, vignette: true },
];

// ── 区域:配色 [亮段, 暗段]、天空 [顶, 地平线]、远景 ──
const ZONES = {
  city: {
    name: '霓虹城区', en: 'NEON CITY', bg: 'bgCity', stars: 0.45,
    sky: [[10, 8, 26], [62, 26, 88]],
    pal: {
      road: [[50, 46, 72], [44, 40, 64]],
      side: [[38, 32, 58], [33, 28, 52]],
      rumble: [[255, 79, 216], [70, 210, 255]],
      lane: [[225, 225, 255], [225, 225, 255]],
      start: [[235, 235, 245], [26, 26, 40]],
    },
  },
  coast: {
    name: '海滨公路', en: 'MOONLIT COAST', bg: 'bgSea', stars: 1,
    sky: [[6, 10, 30], [34, 62, 110]],
    pal: {
      road: [[54, 58, 82], [48, 52, 74]],
      side: [[70, 62, 84], [64, 56, 78]],
      sea: [[20, 44, 90], [18, 40, 84]],
      rumble: [[230, 70, 80], [235, 235, 245]],
      lane: [[225, 225, 255], [225, 225, 255]],
      rail: [[150, 156, 180], [136, 142, 166]],
    },
  },
  tunnel: {
    name: '山体隧道', en: 'TUNNEL', bg: 'bgMount', stars: 1,
    sky: [[5, 8, 18], [28, 48, 62]],
    fog: [22, 16, 16],
    pal: {
      road: [[92, 72, 54], [82, 64, 50]],
      side: [[98, 84, 72], [90, 76, 66]],
      rumble: [[245, 200, 66], [36, 34, 44]],
      lane: [[255, 222, 160], [255, 222, 160]],
      wall: [[112, 94, 78], [98, 82, 68]],
      ceil: [[52, 44, 44], [44, 38, 40]],
      tlight: [[255, 196, 96], [255, 196, 96]],
    },
    // 洞口外立面是从海边看过去的,雾色用海边的
    outer: {
      fog: [34, 62, 110],
      pal: {
        rock: [[40, 46, 66], [40, 46, 66]],
        rim: [[74, 88, 120], [74, 88, 120]],
        frame: [[122, 118, 124], [122, 118, 124]],
      },
    },
  },
  forest: {
    name: '月下山道', en: 'MOUNTAIN PASS', bg: 'bgMount', stars: 1,
    sky: [[5, 8, 18], [28, 48, 62]],
    pal: {
      road: [[52, 56, 68], [46, 50, 62]],
      side: [[26, 48, 42], [22, 42, 36]],
      rumble: [[217, 119, 87], [230, 230, 238]],
      lane: [[225, 225, 255], [225, 225, 255]],
    },
  },
};

// ── 赛道构建用的量级 ──
const LEN   = { short: 25, medium: 50, long: 100 };
const CURVE = { easy: 2, medium: 4, hard: 6 };
const HILL  = { low: 20, medium: 40, high: 60 };
const BLEND = 40;             // 区域交界处配色渐变的半宽(路段数)

function easeIn(a, b, p)    { return a + (b - a) * Math.pow(p, 2); }
function easeInOut(a, b, p) { return a + (b - a) * (-Math.cos(p * Math.PI) / 2 + 0.5); }
function lerp(a, b, p)      { return a + (b - a) * p; }
function clamp(v, lo, hi)   { return v < lo ? lo : (v > hi ? hi : v); }
function lerpRgb(a, b, t)   { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
function rgb(c)             { return `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`; }

// 一种颜色按雾浓度预生成 FOG_STEPS 个色串,避免每帧拼字符串
function fogRamp(c, fog) {
  const out = [];
  for (let i = 0; i < FOG_STEPS; i++) {
    const f = (i + 0.5) / FOG_STEPS;   // f=1 清晰,f→0 融入雾色
    out.push(rgb(lerpRgb(fog, c, f)));
  }
  return out;
}

function buildLut(pal, fog, into) {
  const out = into || {};
  Object.keys(pal).forEach(k => {
    out[k] = [fogRamp(pal[k][0], fog), fogRamp(pal[k][1], fog)];
  });
  return out;
}

function zoneFog(z) { return z.fog || z.sky[1]; }

// 两个区之间按 t 混合出的配色表(结果缓存)
const _lutCache = {};
function zoneLut(a, b, t) {
  const key = `${a}|${b}|${t}`;
  if (_lutCache[key]) return _lutCache[key];
  const za = ZONES[a];
  const zb = ZONES[b];
  const pal = {};
  const main = t < 0.5 ? za : zb;
  Object.keys(main.pal).forEach(k => {
    const pa = za.pal[k] || main.pal[k];
    const pb = zb.pal[k] || main.pal[k];
    pal[k] = [lerpRgb(pa[0], pb[0], t), lerpRgb(pa[1], pb[1], t)];
  });
  const lut = buildLut(pal, lerpRgb(zoneFog(za), zoneFog(zb), t));
  if (main.outer) buildLut(main.outer.pal, main.outer.fog, lut);
  _lutCache[key] = lut;
  return lut;
}

// 洞口外面的山体轮廓:[离洞口的横向距离, 高度](路宽倍数)
const MOUNTAIN = [[0, 2.1], [0.5, 2.35], [1.4, 2.7], [2.6, 2.2], [3.8, 2.9], [5.4, 2.1], [7.5, 1.6], [10, 1.1], [14, 0.5], [20, 0]];

Page({
  data: {
    gameState: 'idle',   // 'idle' | 'playing' | 'paused' | 'over'
    best: 0,
    isNewBest: false,
    dist: 0,
    topSpeed: 0,
    timeLeft: 0,
    nitroCount: 0,
    nitroReady: false,
    drifting: false,
    steerDir: 0,        // -1 左 / 0 松开 / 1 右,用于面板高亮
    overtakes: 0,
    nearMiss: 0,
    bestCombo: 0,
    bestDrift: '0.0',
    checkpoints: 0,
    grade: 'C',
  },

  onLoad() {
    this._best = wx.getStorageSync(STORAGE_KEY) || 0;
    this.setData({ best: this._best });
    this._audio = new RacingAudio();
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
        this._hz = Math.round(h * HZ_RATIO);
        this._carY = Math.min(h - 8, this._hz + Math.round(h / 2) - 4);
        // 玩家车按整数设备像素放大,像素边缘才齐整
        const devScale = Math.max(1, Math.floor(w * 0.37 * this._dpr / PLAYER_META.w));
        this._pScale = devScale / this._dpr;
        this._bgScale = w / 230;

        this._q = 2;
        this._dtAcc = 0;
        this._dtN = 0;
        this._initArt();
        this._buildTrack();
        this._initSky();
        this._resetRun();
        this._speed = MAX_SPEED * 0.6;   // 待机画面里自动巡航
        this._startLoop();
      });
  },

  onShow() {
    if (this._canvas) this._startLoop();
  },

  // 切后台自动暂停,回来不会一睁眼就撞车
  onHide() {
    if (this.data.gameState === 'playing') this.onPause();
    this._stopLoop();
    if (this._audio) this._audio.stopEngine();
  },

  onUnload() {
    this._stopLoop();
    if (this._audio) {
      this._audio.close();
      this._audio = null;
    }
  },

  noop() {},

  onShareAppMessage() {
    const d = this.data.dist || 0;
    const over = this.data.gameState === 'over';
    const res = {
      title: d > 0
        ? `我在 Clawd 夜行赛车跑了 ${d} 米${over ? `,评级 ${this.data.grade}` : ''},来飙一把～`
        : '伪 3D 夜景赛车!漂移攒氮气、擦肩超车,一起来跑～',
      path: '/pages/racing/index',
    };
    if (this._shareImg) res.imageUrl = this._shareImg;
    return res;
  },

  // ── 美术资源 ────────────────────────────────────────────
  // 图集先画在离屏 canvas 上,再导出成图片给主 canvas 用(几十毫秒,
  // 期间只画底色,开始画面盖着看不出来);导出失败才直接拿离屏 canvas 当图源
  _initArt() {
    this._img = null;
    try {
      const art = buildArt((w, h) => wx.createOffscreenCanvas({ type: '2d', width: w, height: h }));
      this._rects = art.rects;
      const fallback = () => { this._img = art.canvas; };
      wx.canvasToTempFilePath({
        canvas: art.canvas,
        fileType: 'png',
        success: r => {
          const img = this._canvas.createImage();
          img.onload = () => { this._img = img; };
          img.onerror = fallback;
          img.src = r.tempFilePath;
        },
        fail: fallback,
      });
    } catch (e) {
      this._rects = null;
      this._img = null;
    }
  },

  // ── 赛道构建 ────────────────────────────────────────────
  _buildTrack() {
    const segs = [];
    let zone = 'city';
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
        zone,
        tunnel: zone === 'tunnel',
        start: false,
        rail: false,
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

    // 霓虹城区:起步直道,缓弯 + S 弯 + 一个硬左
    zone = 'city';
    addRoad(LEN.short, LEN.short, LEN.short, 0, 0);
    addRoad(40, 60, 40, CURVE.easy, 0);
    addRoad(30, 40, 30, -CURVE.medium, HILL.low);
    addRoad(20, 30, 20, CURVE.medium, -HILL.low);
    addRoad(50, 70, 50, 0, 0);
    addRoad(30, 40, 30, -CURVE.hard, 0);
    addRoad(40, 40, 40, CURVE.easy, HILL.low);
    // 海滨公路:大半径长弯,左手边是海
    zone = 'coast';
    addRoad(60, 100, 60, -CURVE.easy, -HILL.low);
    addRoad(40, 80, 40, CURVE.medium, HILL.low);
    addRoad(40, 60, 40, -CURVE.medium, 0);
    addRoad(50, 60, 50, CURVE.easy, -HILL.low);
    addRoad(LEN.short, LEN.medium, LEN.short, 0, 0);
    // 山体隧道:平路,中段带一个弯
    zone = 'tunnel';
    addRoad(20, 30, 20, 0, 0);
    addRoad(40, 70, 40, CURVE.medium, 0);
    addRoad(30, 30, 30, 0, 0);
    // 月下山道:连续起伏 + 急弯
    zone = 'forest';
    addRoad(40, 40, 40, 0, HILL.medium);
    addRoad(25, 45, 25, CURVE.hard, -HILL.low);
    addRoad(25, 45, 25, -CURVE.hard, HILL.low);
    addRoad(40, 60, 40, CURVE.medium, HILL.high);
    addRoad(40, 60, 40, -CURVE.medium, -HILL.high);
    addRoad(30, 40, 30, CURVE.hard, 0);
    addRoad(40, 40, 40, -CURVE.easy, -HILL.low);
    // 回到城区,高度收回 0,首尾无缝
    zone = 'city';
    const lastY = segs[segs.length - 1].y2;
    addRoad(40, 50, 40, CURVE.easy, -lastY / SEG_LEN);
    addRoad(LEN.short, LEN.short, LEN.short, 0, 0);
    segs[segs.length - 1].y2 = 0;

    this._trackLen = segs.length * SEG_LEN;

    // 起跑线格子
    segs[START_GATE - 1].start = true;
    segs[START_GATE].start = true;
    for (let i = 1; i < segs.length; i++) {
      if (segs[i].tunnel && !segs[i - 1].tunnel) segs[i].portal = true;
    }

    this._assignPalettes();
    this._placeScenery();
  },

  // 每段的配色表与天空归属;非隧道区之间在交界两侧 BLEND 段内渐变
  _assignPalettes() {
    const segs = this._segments;
    const count = segs.length;
    segs.forEach(s => {
      s.pal = zoneLut(s.zone, s.zone, 0);
      const sky = s.zone === 'tunnel' ? 'forest' : s.zone;
      s.skyA = sky;
      s.skyB = sky;
      s.skyT = 0;
    });
    for (let i = 1; i < count; i++) {
      const a = segs[i - 1].zone;
      const b = segs[i].zone;
      if (a === b || a === 'tunnel' || b === 'tunnel') continue;
      for (let j = -BLEND; j < BLEND; j++) {
        const s = segs[(i + j + count) % count];
        const t = Math.round(((j + BLEND) / (2 * BLEND)) * 8) / 8;
        s.pal = zoneLut(a, b, t);
        s.skyA = a;
        s.skyB = b;
        s.skyT = (j + BLEND) / (2 * BLEND);
      }
    }
  },

  // 路边景物:各区不同(确定性随机,每局赛道长得一样)
  _placeScenery() {
    const segs = this._segments;
    const rects = this._rects;
    const rnd = makeRng(7);
    const halfW = name => (rects ? rects[name].w : 40) * SPR_UNIT * SPRITES[name].k / ROAD_W / 2;
    // 景物一律摆在硬边界 EDGE_X 之外,车开不进去,也就不会"穿过"它们
    const put = (seg, name, side, gap) => {
      seg.sprites.push({ name, offset: side * (EDGE_X + 0.08 + halfW(name) + gap) });
    };

    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (s.zone === 'city') {
        if (i % 3 === 0) {
          const side = (i / 3) % 2 === 0 ? -1 : 1;
          put(s, `bld${Math.floor(rnd() * 3)}`, side, 0.05 + rnd() * 0.9);
        }
        if (i % 10 === 0) {
          s.sprites.push({ name: 'lampR', offset: EDGE_X + 0.02 });
          s.sprites.push({ name: 'lampL', offset: -EDGE_X - 0.02 });
        }
        if (i % 50 === 25) put(s, rnd() < 0.5 ? 'bb0' : 'bb1', rnd() < 0.5 ? -1 : 1, 0.05);
      } else if (s.zone === 'coast') {
        s.rail = true;
        if (i % 5 === 0) put(s, 'palm', 1, rnd() * 1.2);
        if (i % 9 === 4) put(s, 'palm', 1, 1.4 + rnd() * 1.5);
        if (i % 14 === 0) s.sprites.push({ name: 'lampR', offset: EDGE_X + 0.02 });
        if (i % 17 === 8) put(s, 'bush', 1, rnd() * 0.6);
      } else if (s.zone === 'forest') {
        if (i % 2 === 0) put(s, rnd() < 0.6 ? 'pine' : 'pine2', rnd() < 0.5 ? -1 : 1, rnd() * 2.4);
        if (i % 3 === 1) put(s, rnd() < 0.6 ? 'pine' : 'pine2', rnd() < 0.5 ? -1 : 1, 0.8 + rnd() * 3);
        if (i % 7 === 3) put(s, 'bush', rnd() < 0.5 ? -1 : 1, rnd() * 0.5);
        if (i % 13 === 5) put(s, 'rock', rnd() < 0.5 ? -1 : 1, rnd() * 0.8);
      }
      // 弯道外侧立箭头牌(隧道里不放)
      if (!s.tunnel && Math.abs(s.curve) >= 3 && i % 6 === 0) {
        const outside = s.curve > 0 ? -1 : 1;
        const name = s.curve > 0 ? 'chevR' : 'chevL';
        // 海边左侧是护栏,箭头牌立在护栏外
        s.sprites.push({ name, offset: outside * (s.rail && outside < 0 ? RAIL_X + 0.14 : EDGE_X + 0.26) });
      }
    }

    // 氮气:散布在路面上
    this._nitroSprites = [];
    for (let n = 45; n < segs.length; n += 150) {
      const sp = { name: 'nitro', offset: (rnd() * 1.4 - 0.7), taken: 0 };
      segs[n].sprites.push(sp);
      this._nitroSprites.push(sp);
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
    this._cpCount = 0;
    this._nitro = 1;
    this._nitroT = 0;
    this._mtT = 0;
    this._mtLevel = 0;
    this._drift = null;
    this._driftVis = 0;
    this._topSpeed = 0;
    this._keys = { left: false, right: false, brake: false };
    this._steerVis = 0;
    this._shake = 0;
    this._flash = 0;
    this._flashColor = '255,80,80';
    this._labels = [];
    this._parts = [];
    this._frame = 0;
    this._t = 0;
    this._crashT = 0;
    this._countdown = 0;
    this._dragActive = false;
    this._dragDx = 0;
    this._skidT = 0;
    this._scrapeT = 0;
    this._combo = 0;
    this._comboT = 0;
    this._comboShow = 0;
    this._banner = null;
    this._curZone = this._segments[0].zone;
    this._lastPSeg = -1;
    this._autoLane = 0;
    this._fovK = 0;
    this._stats = { overtakes: 0, nearMiss: 0, bestCombo: 0, bestDrift: 0 };
    this._resetTraffic();
    this._nitroSprites.forEach(sp => { sp.taken = 0; });
  },

  _resetTraffic() {
    this._segments.forEach(s => { s.cars.length = 0; });
    this._cars = [];
    for (let i = 0; i < TRAFFIC_N; i++) {
      // 起跑前 40 段不放车,免得一开局就撞
      const idx = 40 + Math.floor(Math.random() * (this._segments.length - 60));
      this._spawnCar(idx);
    }
  },

  _spawnCar(idx) {
    const r = Math.random();
    const type = r < 0.55 ? 'sedan' : (r < 0.8 ? 'sport' : 'truck');
    const t = CAR_TYPES[type];
    const color = Math.floor(Math.random() * t.colors);
    const offset = [-0.66, 0, 0.66][Math.floor(Math.random() * 3)] + (Math.random() - 0.5) * 0.2;
    const car = {
      type,
      spr: `car_${type}_${color}`,
      half: t.w * SPR_UNIT / ROAD_W / 2,
      offset,
      pref: offset,          // 习惯车道:没有避让需求时会慢慢回来
      z: (idx % this._segments.length) * SEG_LEN + Math.random() * SEG_LEN * 0.5,
      speed: MAX_SPEED * (t.speed[0] + Math.random() * (t.speed[1] - t.speed[0])),
      prevD: undefined,
      hitT: 0,
    };
    this._cars.push(car);
    this._segmentAt(car.z).cars.push(car);
  },

  onStart() {
    if (!this._segments) return;   // canvas 还没准备好
    this._resetRun();
    this._shareImg = null;
    this._countdown = 3;      // 3 · 2 · 1 · GO
    this._audio.beep(false);
    this.setData({
      gameState: 'playing', isNewBest: false, dist: 0, topSpeed: 0,
      nitroCount: Math.floor(this._nitro), nitroReady: false, drifting: false,
    });
    this._startLoop();
    this._audio.startEngine();      // 倒计时期间是怠速声
  },

  onRetry() { this.onStart(); },

  onPause() {
    if (this.data.gameState !== 'playing') return;
    this._keys.left = this._keys.right = this._keys.brake = false;
    this._dragActive = false;
    this._dragDx = 0;
    if (this._drift) this._endDrift(false);
    this._audio.stopEngine();
    this.setData({
      steerDir: 0,
      gameState: 'paused',
      dist: Math.round(this._dist * M_PER_UNIT),
      timeLeft: Math.max(0, Math.ceil(this._time)),
    });
  },

  onResume() {
    if (this.data.gameState !== 'paused') return;
    this._countdown = 2;    // 回到赛道给两秒缓冲
    this._audio.beep(false);
    this.setData({ gameState: 'playing' });
    this._audio.startEngine();
  },

  // ── 输入 ────────────────────────────────────────────────
  // 转向是一整块面板:按左半边左转、右半边右转,手指在面板上
  // 滑动可以直接换向,不会像分开的两个按钮那样一滑就失效
  onSteerTouch(e) {
    if (this.data.gameState !== 'playing') return;
    const t = e.touches && e.touches[0];
    if (!t) return;
    const mid = (PAD_LEFT_RPX + PAD_W_RPX / 2) * this._W / 750;
    const dir = t.clientX < mid ? -1 : 1;
    this._keys.left = dir < 0;
    this._keys.right = dir > 0;
    if (dir !== this.data.steerDir) this.setData({ steerDir: dir });
  },

  onSteerEnd() {
    this._keys.left = false;
    this._keys.right = false;
    if (this.data.steerDir !== 0) this.setData({ steerDir: 0 });
  },

  onBrakeStart() { this._keys.brake = true; },
  onBrakeEnd()   { this._keys.brake = false; },

  // 画面上左右拖动也能转向(按钮 catch 掉了自己的 touchstart,
  // 所以按按钮时不会误触发拖动)
  onTouchStart(e) {
    if (this.data.gameState !== 'playing' || this._countdown > 0) return;
    this._dragActive = true;
    this._dragLastX = e.touches[0].clientX;
  },

  onTouchMove(e) {
    if (!this._dragActive) return;
    const x = e.touches[0].clientX;
    this._dragDx += (x - this._dragLastX) / (this._W * 0.45);
    this._dragLastX = x;
  },

  onTouchEnd() {
    this._dragActive = false;
  },

  onNitro() {
    if (this.data.gameState !== 'playing' || this._countdown > 0) return;
    if (this._nitro < 1 || this._nitroT > 0) return;
    this._nitro -= 1;
    this._nitroT = NITRO_TIME;
    this._flash = 0.35;
    this._flashColor = '96,192,255';
    this._addLabel('氮气冲刺!', '#60C0FF');
    this._vibrate('medium');
    this._audio.nitro();
  },

  _vibrate(type) {
    try { wx.vibrateShort({ type }); } catch (e) {}
  },

  // ── 主循环 ──────────────────────────────────────────────
  _startLoop() {
    if (this._raf || !this._canvas) return;
    this._lastTs = 0;
    const step = (ts) => {
      this._raf = this._canvas.requestAnimationFrame(step);
      const raw = this._lastTs ? (ts - this._lastTs) / 1000 : 0.016;
      const dt = Math.min(0.05, raw);
      this._lastTs = ts;
      this._watchFps(raw);
      this._update(dt);
      this._draw();
    };
    this._raf = this._canvas.requestAnimationFrame(step);
  },

  // 连续 2 秒平均帧间隔偏长就降一档画质(只降不升,避免来回跳)
  _watchFps(raw) {
    if (this._q <= 0 || raw > 0.25) return;   // 切后台回来的长间隔不算
    this._dtAcc += raw;
    this._dtN++;
    if (this._dtAcc < 2) return;
    const avg = this._dtAcc / this._dtN;
    this._dtAcc = 0;
    this._dtN = 0;
    if (avg > 0.024) {
      this._q--;
      this._vig = null;
    }
  },

  _stopLoop() {
    if (this._raf && this._canvas) this._canvas.cancelAnimationFrame(this._raf);
    this._raf = null;
  },

  _update(dt) {
    const state = this.data.gameState;
    if (state === 'paused') return;
    this._frame++;
    this._t += dt;
    // 特效衰减在任何状态下都跑,保证结算画面不僵住
    this._labels = this._labels.filter(lb => ++lb.f < 60);
    this._parts = this._parts.filter(p => {
      p.x += p.vx; p.y += p.vy; p.vy += p.g;
      return --p.life > 0;
    });
    if (this._flash > 0.02) this._flash *= 0.9; else this._flash = 0;
    if (this._banner) {
      this._banner.t += dt;
      if (this._banner.t > 2.8) this._banner = null;
    }
    if (this._comboShow > 0) this._comboShow -= dt;
    this._fovK += ((this._nitroT > 0 ? 1 : 0) - this._fovK) * Math.min(1, dt * 4);

    if (state === 'idle') {
      this._autoDrive(dt);
      this._advance(dt, false);
      this._moveTraffic(dt, false);
      return;
    }
    if (state === 'over') {
      // 时间到后车子滑行停下,背景继续动
      this._speed = Math.max(0, this._speed + DECEL * 1.4 * dt);
      this._steerVis *= 0.9;
      this._advance(dt, false);
      this._moveTraffic(dt, false);
      return;
    }

    // ── 发车 / 恢复倒计时:画面照常渲染,但不计时不前进 ──
    if (this._countdown > 0) {
      const prev = Math.ceil(this._countdown);
      this._countdown -= dt;
      const now = Math.ceil(this._countdown);
      if (now !== prev && now > 0) this._audio.beep(false);
      if (this._countdown <= 0) {
        this._countdown = 0;
        this._addLabel('GO!', '#4CAF50');
        this._audio.beep(true);
        this._vibrate('light');
      }
      this._tuneEngine();
      return;
    }

    this._updatePlay(dt);
  },

  // 待机画面:自动巡航,会绕开前车
  _autoDrive(dt) {
    this._speed += (MAX_SPEED * 0.66 - this._speed) * Math.min(1, dt * 1.5);
    const segs = this._segments;
    const count = segs.length;
    const base = this._segmentAt(this._position + PLAYER_Z).index;
    let aim = this._autoLane;
    for (let i = 1; i < 16; i++) {
      const cars = segs[(base + i) % count].cars;
      let hit = null;
      for (const car of cars) {
        if (Math.abs(car.offset - aim) < 0.5) { hit = car; break; }
      }
      if (hit) {
        aim = hit.offset > 0 ? hit.offset - 0.95 : hit.offset + 0.95;
        aim = clamp(aim, -0.8, 0.8);
        break;
      }
    }
    this._autoLane = aim;
    const prevX = this._playerX;
    this._playerX += (aim - this._playerX) * Math.min(1, dt * 1.6);
    const vx = (this._playerX - prevX) / Math.max(dt, 0.001);
    this._steerVis += (clamp(vx * 1.6, -1, 1) - this._steerVis) * 0.12;
  },

  _advance(dt, counts) {
    const adv = this._speed * dt;
    this._position = (this._position + adv) % this._trackLen;
    if (counts) this._dist += adv;
    // 天空视差随弯道横移
    const seg = this._segmentAt(this._position + PLAYER_Z);
    this._skyOff = (this._skyOff || 0) - seg.curve * (this._speed / MAX_SPEED) * dt;
  },

  _updatePlay(dt) {
    const k = this._keys;
    const playerSeg = this._segmentAt(this._position + PLAYER_Z);

    if (this._nitroT > 0) this._nitroT -= dt;
    if (this._mtT > 0) this._mtT -= dt;
    if (this._comboT > 0) {
      this._comboT -= dt;
      if (this._comboT <= 0) this._combo = 0;
    }
    const boost = this._nitroT > 0 ? NITRO_MULT : (this._mtT > 0 ? MT_MULT : 1);
    const topSpeed = MAX_SPEED * boost;
    const speedPct = this._speed / MAX_SPEED;
    const offRoad = Math.abs(this._playerX) > OFF_EDGE;

    let steer = 0;
    if (k.left)  steer -= 1;
    if (k.right) steer += 1;

    // ── 漂移:按住漂移键 + 打方向进入,松开漂移键结束 ──
    if (!this._drift) {
      if (k.brake && steer !== 0 && speedPct > DRIFT_MIN && !offRoad && this._crashT <= 0) {
        this._drift = { dir: steer, t: 0, level: 0 };
      }
    } else if (!k.brake || speedPct < DRIFT_MIN * 0.85 || offRoad || this._crashT > 0) {
      this._endDrift(!offRoad && this._crashT <= 0);
    }
    const drift = this._drift;

    // ── 转向:按钮与拖动并存 ──
    // 转向权限随速度提升但保留下限,低速也能把车从草地里拧回来
    const steerRate = STEER_RATE * (STEER_FLOOR + (1 - STEER_FLOOR) * Math.min(1, speedPct)) *
      (drift ? DRIFT_STEER : 1);
    this._playerX += dt * steerRate * steer;
    if (drift) this._playerX += dt * DRIFT_PULL * drift.dir * speedPct;
    if (this._dragDx !== 0) {
      this._playerX += this._dragDx * (0.5 + 0.5 * speedPct);
      steer += clamp(this._dragDx * 14, -1, 1);
      this._dragDx = 0;
    }
    // 离心力按速度平方算:慢速过弯轻松,高速才吃力;漂移时大部分被抵消
    this._playerX -= dt * CENTRIFUGAL * speedPct * speedPct * playerSeg.curve * (drift ? DRIFT_GRIP : 1);
    this._steerVis += (clamp(steer, -1, 1) - this._steerVis) * 0.2;
    this._driftVis += ((drift ? drift.dir : 0) - this._driftVis) * Math.min(1, dt * 8);

    // ── 隧道墙 / 海边护栏:硬边界,蹭上去掉速冒火花 ──
    let hiX = EDGE_X;
    let loX = -EDGE_X;
    if (playerSeg.tunnel) { hiX = TUN_W - 0.24; loX = -hiX; }
    if (playerSeg.rail) loX = -(RAIL_X - 0.22);
    if (this._playerX > hiX) { this._playerX = hiX; this._scrape(dt, 1); }
    else if (this._playerX < loX) { this._playerX = loX; this._scrape(dt, -1); }

    // ── 油门 / 刹车 / 漂移 ──
    // 出界要同时收油门,否则驱动力会把掉速抵消掉,等于没惩罚
    const wasOver = this._speed > topSpeed;   // 氮气刚结束时会高于上限
    if (this._crashT > 0) {
      this._crashT -= dt;
      this._speed += DECEL * dt;
    } else if (drift) {
      this._speed += DRIFT_DECEL * dt;
      drift.t += dt;
      const lv = drift.t > MT_LV2 ? 2 : (drift.t > MT_LV1 ? 1 : 0);
      if (lv > drift.level) {
        drift.level = lv;
        this._vibrate('light');
      }
      const before = Math.floor(this._nitro);
      this._nitro = Math.min(MAX_NITRO, this._nitro + dt * DRIFT_GAIN * (0.6 + 0.4 * speedPct));
      if (Math.floor(this._nitro) > before) {
        this._addLabel('氮气 +1', '#60C0FF');
        this._audio.pickup();
      }
      this._driftFx(drift);
    } else if (k.brake) {
      this._speed += BRAKING * dt;
      // 高速刹车:轮胎烟
      if (this._speed > MAX_SPEED * 0.35 && this._frame % 3 === 0) {
        this._wheelSmoke(1);
      }
    } else if (!wasOver) {
      this._speed += ACCEL * boost * dt * (offRoad ? OFF_THROTTLE : 1);
    }

    // ── 压草地 ──
    if (offRoad) {
      if (this._speed > OFF_LIMIT) this._speed += OFF_DECEL * dt;
      if (this._frame % 4 === 0) {
        this._shake = Math.max(this._shake, 2.2);
        this._wheelSmoke(0, '#4A4A66');
      }
    }
    // 超出上限:本来就超(氮气刚结束)则平滑回落,不突然掉速;刚加速超过则卡在上限
    if (this._speed > topSpeed) {
      this._speed = wasOver ? Math.max(topSpeed, this._speed + DECEL * 1.5 * dt) : topSpeed;
    }
    this._speed = Math.max(0, this._speed);

    // ── 前进 ──
    this._advance(dt, true);
    const kmh = Math.round(this._speed * KMH_PER_UNIT);
    if (kmh > this._topSpeed) this._topSpeed = kmh;

    // ── 对手车 + 超车 / 擦肩 / 追尾判定 ──
    this._moveTraffic(dt, true);

    // ── 氮气拾取(检查这一帧跨过的所有路段,高速也不会漏)──
    const pSeg = this._segmentAt(this._position + PLAYER_Z);
    const count = this._segments.length;
    let from = this._lastPSeg < 0 ? pSeg.index : this._lastPSeg;
    let steps = (pSeg.index - from + count) % count;
    if (steps > 6) { from = pSeg.index; steps = 0; }
    for (let i = 0; i <= steps; i++) this._checkPickups(this._segments[(from + i) % count]);
    this._lastPSeg = pSeg.index;
    this._nitroSprites.forEach(sp => {
      if (sp.taken > 0) sp.taken = Math.max(0, sp.taken - dt);
    });

    // ── 区域切换横幅 ──
    if (pSeg.zone !== this._curZone) {
      this._curZone = pSeg.zone;
      this._banner = { zone: pSeg.zone, t: 0 };
      this._audio.zone();
    }

    // ── 计时与检查点 ──
    this._time -= dt;
    const meters = this._dist * M_PER_UNIT;
    while (meters >= this._nextCP) {
      // 前两个检查点给满,之后每个少 1 秒
      const bonus = Math.max(CP_BONUS_MIN, CP_BONUS - Math.max(0, this._cpCount - 1));
      this._time += bonus;
      this._nextCP += CP_METERS;
      this._cpCount++;
      this._addLabel(`检查点! +${bonus}s`, '#4CAF50');
      this._vibrate('light');
      this._audio.checkpoint();
      // 越往后车越多
      for (let i = 0; i < 2 && this._cars.length < TRAFFIC_MAX; i++) {
        this._spawnCar(pSeg.index + DRAW_DIST + 10 + i * 17);
      }
    }
    if (this._time <= 0) {
      this._time = 0;
      this._finish();
      return;
    }

    this._tuneEngine();

    // 按钮状态只在变化时同步,避免每帧 setData
    const n = Math.floor(this._nitro);
    const ready = n > 0 && this._nitroT <= 0;
    const drifting = !!this._drift;
    if (ready !== this.data.nitroReady || n !== this.data.nitroCount || drifting !== this.data.drifting) {
      this.setData({ nitroReady: ready, nitroCount: n, drifting });
    }
  },

  _endDrift(reward) {
    const d = this._drift;
    this._drift = null;
    if (!d) return;
    if (d.t > this._stats.bestDrift) this._stats.bestDrift = d.t;
    if (reward && d.level > 0) {
      this._mtT = d.level > 1 ? 1.1 : 0.55;
      this._mtLevel = d.level;
      this._addLabel(d.level > 1 ? '超级加速!' : '漂移加速!', d.level > 1 ? '#FF9A3C' : '#60C0FF');
      this._audio.miniTurbo(d.level);
      this._vibrate('light');
    }
  },

  // 漂移特效:后轮烟 + 按档位变色的火花
  _driftFx(drift) {
    if (this._frame % 2 === 0) this._wheelSmoke(1);
    if (drift.level > 0) {
      const color = drift.level > 1 ? '#FF9A3C' : '#60C0FF';
      const w = PLAYER_META.w * this._pScale;
      const y = this._carY;
      for (let s = -1; s <= 1; s += 2) {
        const x = this._W / 2 + s * w * 0.42 + this._steerVis * 12;
        this._parts.push({
          x, y: y - 2,
          vx: (Math.random() - 0.5) * 3 - drift.dir * 1.5,
          vy: -Math.random() * 2.5 - 0.5,
          g: 0.25, life: 10 + Math.random() * 8,
          color, sz: 2, add: true,
        });
      }
    }
  },

  _wheelSmoke(both, color) {
    const w = PLAYER_META.w * this._pScale;
    const y = this._carY - 4;
    for (let s = -1; s <= 1; s += 2) {
      if (!both && s < 0 && Math.random() < 0.5) continue;
      this._parts.push({
        x: this._W / 2 + s * w * 0.42 + this._steerVis * 12,
        y,
        vx: (Math.random() - 0.5) * 2,
        vy: -Math.random() * 1.2 - 0.3,
        g: -0.02, life: 18 + Math.random() * 12,
        color: color || 'rgba(170,170,200,0.55)', sz: 3 + Math.floor(Math.random() * 3),
      });
    }
  },

  _scrape(dt, side) {
    this._speed *= (1 - dt * 0.9);
    this._shake = Math.max(this._shake, 2.5);
    if (this._drift) this._endDrift(false);
    const w = PLAYER_META.w * this._pScale;
    const x = this._W / 2 + side * w * 0.5;
    for (let i = 0; i < 2; i++) {
      this._parts.push({
        x, y: this._carY - 10 - Math.random() * 10,
        vx: -side * (1 + Math.random() * 3), vy: -Math.random() * 3,
        g: 0.3, life: 8 + Math.random() * 8, color: '#FFD27A', sz: 2, add: true,
      });
    }
    this._scrapeT -= dt;
    if (this._scrapeT <= 0) {
      this._audio.scrape();
      this._scrapeT = 0.15;
    }
  },

  _checkPickups(seg) {
    for (const sp of seg.sprites) {
      if (sp.name !== 'nitro' || sp.taken > 0) continue;
      if (Math.abs(this._playerX - sp.offset) < 0.5) {
        sp.taken = 18;   // 18 秒后重新出现
        if (this._nitro < MAX_NITRO) {
          this._nitro = Math.min(MAX_NITRO, Math.floor(this._nitro) + 1);
          this._addLabel('氮气 +1', '#60C0FF');
        } else {
          // 氮气满了只给一点时间(给多了能靠捡氮气无限续命)
          this._time += 0.5;
          this._addLabel('时间 +0.5s', '#F5C842');
        }
        this._audio.pickup();
      }
    }
  },

  // 对手车移动;detect 时顺带做超车 / 擦肩 / 追尾判定
  _moveTraffic(dt, detect) {
    const len = this._trackLen;
    const pz = (this._position + PLAYER_Z) % len;
    for (const car of this._cars) {
      this._steerRival(car, dt, pz);
      const oldSeg = this._segmentAt(car.z);
      car.z = (car.z + car.speed * dt) % len;
      const newSeg = this._segmentAt(car.z);
      if (oldSeg !== newSeg) {
        const i = oldSeg.cars.indexOf(car);
        if (i >= 0) oldSeg.cars.splice(i, 1);
        newSeg.cars.push(car);
      }
      if (car.hitT > 0) car.hitT -= dt;
      if (!detect) { car.prevD = undefined; continue; }

      // 相对距离(前方为正),处理赛道首尾相接
      let d = car.z - pz;
      if (d > len / 2) d -= len;
      if (d < -len / 2) d += len;
      const prev = car.prevD;
      car.prevD = d;
      if (prev === undefined || this._crashT > 0) continue;
      const lat = Math.abs(this._playerX - car.offset);
      // 追上并横向重叠 → 追尾
      if (prev > HIT_D && d <= HIT_D && d > -SEG_LEN * 4 && lat < car.half + PLAYER_HALF && car.hitT <= 0) {
        this._crash(car);
        car.prevD = HIT_D + 1;
        continue;
      }
      // 从前方变到后方 → 超车
      if (prev > 0 && d <= 0 && d > -SEG_LEN * 6) this._passCar(car, lat);
    }
  },

  _passCar(car, lat) {
    this._stats.overtakes++;
    if (car.hitT > 0 || lat > NEAR_MISS || this._speed < MAX_SPEED * 0.45) return;
    this._combo = this._comboT > 0 ? this._combo + 1 : 1;
    this._comboT = COMBO_TIME;
    this._comboShow = 1.4;
    this._stats.nearMiss++;
    if (this._combo > this._stats.bestCombo) this._stats.bestCombo = this._combo;
    this._time += NEAR_BONUS;
    this._nitro = Math.min(MAX_NITRO, this._nitro + 0.12);
    this._audio.whoosh(this._combo);
    // 从车侧甩出几道风线
    const side = car.offset > this._playerX ? 1 : -1;
    for (let i = 0; i < 6; i++) {
      this._parts.push({
        x: this._W / 2 + side * this._W * 0.25, y: this._carY - 20 - Math.random() * 40,
        vx: side * (3 + Math.random() * 4), vy: (Math.random() - 0.5),
        g: 0, life: 10, color: '#C8E8FF', sz: 2, add: true,
      });
    }
  },

  // 对手车走位:避让前方慢车和玩家,平时慢慢回到习惯车道
  _steerRival(car, dt, pz) {
    if (car.pref === undefined) car.pref = car.offset;   // 兜底,避免 offset 变 NaN
    const segs = this._segments;
    const count = segs.length;
    const base = this._segmentAt(car.z).index;
    let dir = 0;
    let gap = 1;
    for (let i = 1; i <= 6 && dir === 0; i++) {
      const ahead = segs[(base + i) % count];
      for (const other of ahead.cars) {
        if (other === car) continue;
        if (car.speed > other.speed && Math.abs(car.offset - other.offset) < 0.42) {
          dir = car.offset > other.offset ? 1 : -1;
          gap = i;
          break;
        }
      }
    }
    // 从后面追上玩家时也让一让(玩家撞车后减速的情况)
    if (dir === 0 && this.data.gameState === 'playing' && car.speed > this._speed) {
      let d = pz - car.z;
      if (d < 0) d += this._trackLen;
      if (d > 0 && d < SEG_LEN * 6 && Math.abs(car.offset - this._playerX) < 0.45) {
        dir = car.offset > this._playerX ? 1 : -1;
        gap = Math.max(1, Math.round(d / SEG_LEN));
      }
    }
    if (dir !== 0) car.offset += dir * dt * 1.4 / gap;
    else car.offset += (car.pref - car.offset) * dt * 0.6;
    car.offset = clamp(car.offset, -0.9, 0.9);
  },

  _crash(car) {
    this._speed = Math.min(this._speed * CRASH_KEEP, car.speed * 0.85);
    this._crashT = 0.55;
    this._shake = 7;
    this._flash = 0.4;
    this._flashColor = '255,80,80';
    this._combo = 0;
    this._comboT = 0;
    if (this._drift) this._endDrift(false);
    car.hitT = 1.5;
    // 被撞的车向外弹开、加点速,避免持续贴着刮蹭
    car.offset += (car.offset > this._playerX ? 0.35 : -0.35);
    car.offset = clamp(car.offset, -0.85, 0.85);
    car.speed = Math.min(MAX_SPEED * 0.7, car.speed * 1.1);
    this._addLabel('撞车!', '#FF6B6B');
    this._burst(this._W / 2, this._carY - 30, '#FF6B6B', 12, 5);
    this._burst(this._W / 2, this._carY - 30, '#FFD27A', 8, 4, true);
    this._vibrate('heavy');
    this._audio.crash();
  },

  _finish() {
    const meters = Math.round(this._dist * M_PER_UNIT);
    const isNewBest = meters > this._best;
    if (isNewBest) {
      this._best = meters;
      wx.setStorageSync(STORAGE_KEY, this._best);
    }
    if (this._drift) this._endDrift(false);
    this._keys.left = this._keys.right = this._keys.brake = false;
    this._audio.stopEngine();
    this._audio.finish();
    const grade = GRADES.find(g => meters >= g[1])[0];
    const st = this._stats;
    this._makeShareCard(meters, this._topSpeed, grade);
    this.setData({
      gameState: 'over',
      dist: meters,
      topSpeed: this._topSpeed,
      best: this._best,
      isNewBest,
      steerDir: 0,
      drifting: false,
      overtakes: st.overtakes,
      nearMiss: st.nearMiss,
      bestCombo: st.bestCombo,
      bestDrift: st.bestDrift.toFixed(1),
      checkpoints: this._cpCount,
      grade,
    });
  },

  // 当前档位与档内转速(给引擎声和转速表用)
  _gearRpm() {
    const pct = this._speed / MAX_SPEED;
    const edges = [0, 0.18, 0.36, 0.55, 0.76, NITRO_MULT];
    let g = 1;
    while (g < 5 && pct > edges[g]) g++;
    const lo = edges[g - 1];
    const hi = edges[g];
    const rpm = 0.25 + 0.75 * clamp((pct - lo) / (hi - lo), 0, 1);
    return { gear: g, rpm };
  },

  _tuneEngine() {
    if (!this._audio || this._frame % 2) return;
    const { gear, rpm } = this._gearRpm();
    let skid = 0;
    if (this._drift) skid = 1;
    else if (this._keys.brake && this._speed > MAX_SPEED * 0.35) skid = 0.6;
    this._audio.updateEngine(rpm, gear, this._nitroT > 0 || this._mtT > 0, skid);
  },

  // 离屏画一张 5:4 成绩卡,分享时带图(失败就退回纯文字分享)
  _makeShareCard(meters, topSpeed, grade) {
    try {
      const dpr = 2, cw = 500, ch = 400;
      const off = wx.createOffscreenCanvas({
        type: '2d', width: cw * dpr, height: ch * dpr,
      });
      const ctx = off.getContext('2d');
      ctx.scale(dpr, dpr);

      const sky = ctx.createLinearGradient(0, 0, 0, ch * 0.55);
      sky.addColorStop(0, '#0A081A');
      sky.addColorStop(1, '#3E1A58');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, cw, ch);
      // 星空
      ctx.fillStyle = '#6A6A9A';
      for (let i = 0; i < 40; i++) {
        ctx.fillRect(Math.random() * cw, Math.random() * ch * 0.45, 2, 2);
      }
      // 城市剪影
      if (this._rects && this._img) {
        const r = this._rects.bgCity;
        try {
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(this._img, r.x, r.y, r.w, r.h, 0, ch * 0.55 - r.h * 2, r.w * 2, r.h * 2);
        } catch (e) {}
      }
      // 透视赛道 + 霓虹路肩
      const hz = ch * 0.55;
      ctx.fillStyle = '#211C38';
      ctx.fillRect(0, hz, cw, ch - hz);
      const road = (half, color) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(cw / 2 - half * 0.12, hz);
        ctx.lineTo(cw / 2 + half * 0.12, hz);
        ctx.lineTo(cw / 2 + half, ch);
        ctx.lineTo(cw / 2 - half, ch);
        ctx.closePath();
        ctx.fill();
      };
      road(240, '#FF4FD8');
      road(222, '#34304E');
      ctx.fillStyle = '#E1E1FF';
      for (let i = 0; i < 5; i++) {
        const t0 = i / 5, t1 = t0 + 0.055;
        const y0 = hz + (ch - hz) * t0 * t0, y1 = hz + (ch - hz) * t1 * t1;
        const w0 = 2 + 6 * t0 * t0, w1 = 2 + 6 * t1 * t1;
        ctx.beginPath();
        ctx.moveTo(cw / 2 - w0, y0); ctx.lineTo(cw / 2 + w0, y0);
        ctx.lineTo(cw / 2 + w1, y1); ctx.lineTo(cw / 2 - w1, y1);
        ctx.closePath(); ctx.fill();
      }
      // 玩家车
      if (this._rects && this._img) {
        const r = this._rects.player_0;
        try {
          ctx.drawImage(this._img, r.x, r.y, r.w, r.h, cw / 2 - r.w * 1.5, ch - r.h * 3 - 8, r.w * 3, r.h * 3);
        } catch (e) {}
      }

      ctx.textAlign = 'center';
      ctx.fillStyle = '#A78BFA';
      ctx.font = '16px monospace';
      ctx.fillText('CLAWD NIGHT RACER', cw / 2, 40);
      ctx.fillStyle = '#F5C842';
      ctx.font = 'bold 72px monospace';
      ctx.fillText(`${meters}m`, cw / 2, 118);
      ctx.fillStyle = '#C0C0E8';
      ctx.font = '18px monospace';
      ctx.fillText(`评级 ${grade} · 最高 ${topSpeed} km/h`, cw / 2, 150);

      wx.canvasToTempFilePath({
        canvas: off,
        fileType: 'png',
        success: r => { this._shareImg = r.tempFilePath; },
        fail: () => { this._shareImg = null; },
      });
    } catch (e) {
      this._shareImg = null;
    }
  },

  _addLabel(text, color) {
    this._labels.push({ text, color, f: 0 });
    if (this._labels.length > 3) this._labels.shift();
  },

  _burst(x, y, color, n, spread, add) {
    for (let i = 0; i < n; i++) {
      this._parts.push({
        x, y,
        vx: (Math.random() - 0.5) * spread * 2,
        vy: -Math.random() * 3 - 0.5,
        g: 0.35,
        life: 16 + Math.random() * 14,
        color,
        sz: 2 + Math.floor(Math.random() * 2),
        add: !!add,
      });
    }
  },

  // ── 渲染 ────────────────────────────────────────────────
  _fogIdx(n, dist) {
    const fog = 1 / Math.pow(Math.E, (n / dist) * (n / dist) * FOG_DENSITY);
    return Math.max(0, Math.min(FOG_STEPS - 1, Math.floor(fog * FOG_STEPS)));
  },

  // 从图集贴一个精灵;底边低于 clip 的部分裁掉(被近处坡顶挡住)
  _blit(r, dx, dy, dw, dh, clip) {
    if (dy >= clip || dw < 0.5) return;
    let sh = r.h;
    let h = dh;
    if (dy + dh > clip) {
      h = clip - dy;
      sh = r.h * h / dh;
      if (sh < 0.5) return;
    }
    this._ctx.drawImage(this._img, r.x, r.y, r.w, sh, dx, dy, dw, h);
  },

  // 叠加混合的光晕
  _glow(name, cx, cy, w, h, alpha, essential) {
    if (w < 2 || alpha < 0.03 || !this._rects) return;
    if (!essential && !QUALITY[this._q].glows) return;
    const maxW = this._W * 1.4;
    if (w > maxW) { h *= maxW / w; w = maxW; }
    if (cx + w / 2 < 0 || cx - w / 2 > this._W || cy + h / 2 < 0 || cy - h / 2 > this._H) return;
    const ctx = this._ctx;
    const r = this._rects[name];
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this._img, r.x, r.y, r.w, r.h, cx - w / 2, cy - h / 2, w, h);
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  },

  _draw() {
    const ctx = this._ctx;
    if (!ctx || !this._rects) return;
    const W = this._W, H = this._H, hz = this._hz;
    if (!this._img) {
      ctx.fillStyle = '#0A081A';
      ctx.fillRect(0, 0, W, H);
      return;
    }
    ctx.imageSmoothingEnabled = false;

    ctx.save();
    if (this._shake > 0.3) {
      ctx.translate((Math.random() * 2 - 1) * this._shake, (Math.random() * 2 - 1) * this._shake);
      this._shake *= 0.86;
    } else {
      this._shake = 0;
    }

    const depth = CAM_DEPTH * (1 - 0.1 * this._fovK);   // 氮气时视野拉宽
    const len = this._trackLen;
    const baseSeg = this._segmentAt(this._position);
    const basePct = (this._position % SEG_LEN) / SEG_LEN;
    const playerSeg = this._segmentAt(this._position + PLAYER_Z);
    const playerPct = ((this._position + PLAYER_Z) % SEG_LEN) / SEG_LEN;
    const playerY = lerp(playerSeg.y1, playerSeg.y2, playerPct);
    const camY = playerY + CAM_H;
    const camX = this._playerX * ROAD_W;
    // 本帧投影过的路段打上编号(不随开局重置,避免与旧编号撞车)
    const fid = this._drawId = (this._drawId || 0) + 1;

    this._drawSky(ctx, W, H, playerSeg);

    // ── 路面:由近及远投影,并按曲率累加横移 ──
    let x = 0;
    let dx = -(baseSeg.curve * basePct);
    let maxy = H;
    const count = this._segments.length;
    const Q = QUALITY[this._q];
    const drawDist = Q.drawDist;
    const halfW = W / 2;
    const halfH = H / 2;

    for (let n = 0; n < drawDist; n++) {
      const seg = this._segments[(baseSeg.index + n) % count];
      const looped = seg.index < baseSeg.index;
      const camZ = this._position - (looped ? len : 0);
      const cz1 = seg.z1 - camZ;
      const cz2 = seg.z2 - camZ;
      const s1 = depth / (cz1 || 0.0001);
      const s2 = depth / (cz2 || 0.0001);
      seg.sx1 = Math.round(halfW - s1 * (camX - x) * halfW);
      seg.sy1 = Math.round(hz - s1 * (seg.y1 - camY) * halfH);
      seg.px1 = s1 * halfW;
      seg.sw1 = seg.px1 * ROAD_W;
      seg.sx2 = Math.round(halfW - s2 * (camX - x - dx) * halfW);
      seg.sy2 = Math.round(hz - s2 * (seg.y2 - camY) * halfH);
      seg.px2 = s2 * halfW;
      seg.sw2 = seg.px2 * ROAD_W;
      seg.clip = maxy;
      seg.fogI = this._fogIdx(n, drawDist);
      seg.pf = fid;
      seg.vis = false;
      seg.front = cz1 > depth;

      x += dx;
      dx += seg.curve;

      if (cz1 <= depth || seg.sy2 >= seg.sy1 || seg.sy2 >= maxy) continue;
      seg.vis = true;
      this._drawSegment(ctx, W, seg);
      maxy = seg.sy2;
    }
    // 最远的路面和地平线之间补一条雾色(不用整屏铺底色,省填充)
    if (maxy > hz + 2) {
      ctx.fillStyle = this._skyBot;
      ctx.fillRect(-10, hz + 2, W + 20, maxy - hz - 2);
    }

    // 隧道里视距尽头还是隧道:把尽头的洞口涂成隧道深处的暗色,别露出天空
    const far = this._segments[(baseSeg.index + drawDist - 1) % count];
    if (far.tunnel && far.pf === fid) {
      const tw = TUN_W * ROAD_W;
      const th = TUN_H * ROAD_W * (H / W);
      ctx.fillStyle = far.pal.wall[0][0];
      ctx.fillRect(far.sx2 - far.px2 * tw - 1, far.sy2 - far.px2 * th - 1, far.px2 * tw * 2 + 2, far.px2 * th + 2);
    }

    // ── 景物 / 隧道 / 车辆:由远及近绘制,近处遮挡远处 ──
    const gateSeg = this._gateSegment();
    for (let n = drawDist - 1; n > 0; n--) {
      const seg = this._segments[(baseSeg.index + n) % count];
      if (seg.pf !== fid) continue;
      // 隧道壳按"在镜头前"画,不看 vis:远处路段不足 1 像素时路面会被跳过,
      // 但墙和顶照样要画,否则会露出一个个洞
      if (seg.tunnel && seg.front) this._drawTunnel(ctx, seg);
      if (seg.portal && seg.front) this._drawPortal(ctx, W, seg);
      const alpha = Math.min(1, 0.2 + 0.8 * (seg.fogI + 1) / FOG_STEPS);
      for (const sp of seg.sprites) this._drawSprite(ctx, seg, sp, alpha);
      if (seg.rail && seg.vis) this._drawRail(ctx, seg);
      for (const car of seg.cars) this._drawCar(ctx, seg, car, alpha);
      if (seg.index === START_GATE) this._drawGate(ctx, seg, 'START', '#F5C842', '#FF4FD8');
      if (gateSeg === seg) this._drawGate(ctx, seg, 'CHECKPOINT', '#4CFF8A', '#4CFF8A');
    }

    // ── 玩家车 ──
    this._drawPlayerCar(ctx, W, H);
    this._drawSpeedLines(ctx, W, H);

    // 粒子
    for (const p of this._parts) {
      ctx.globalAlpha = Math.min(1, p.life / 12);
      if (p.add) ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.sz, p.sz);
      if (p.add) ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;

    if (Q.vignette) this._drawVignette(ctx, W, H);

    // 撞车红闪 / 氮气蓝闪
    if (this._flash > 0.02) {
      ctx.fillStyle = `rgba(${this._flashColor}, ${this._flash})`;
      ctx.fillRect(-10, -10, W + 20, H + 20);
    }

    const state = this.data.gameState;
    if (state === 'playing' || state === 'paused') {
      this._drawCurveWarning(ctx, W, H);
      this._drawHUD(ctx, W, H);
      this._drawBanner(ctx, W, H);
      this._drawCountdown(ctx, W, H);
      this._drawLabels(ctx, W, H);
    }

    ctx.restore();
  },

  // 下一个检查点龙门落在哪个路段
  _gateSegment() {
    if (this.data.gameState !== 'playing') return null;
    const ahead = (this._nextCP - this._dist * M_PER_UNIT) / M_PER_UNIT;
    if (ahead < 0 || ahead > QUALITY[this._q].drawDist * SEG_LEN) return null;
    return this._segmentAt(this._position + PLAYER_Z + ahead);
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

  _drawSegment(ctx, W, seg) {
    const P = seg.pal;
    const f = seg.fogI;
    const L = seg.light ? 0 : 1;
    const x1 = seg.sx1, y1 = seg.sy1, w1 = seg.sw1;
    const x2 = seg.sx2, y2 = seg.sy2, w2 = seg.sw2;

    // 路边地面
    ctx.fillStyle = P.side[L][f];
    ctx.fillRect(0, y2, W, y1 - y2);

    // 海:左侧沙滩外是海面,月光在海面上拉出一道波光
    if (P.sea) {
      const e1 = x1 - w1 * 1.75;
      const e2 = x2 - w2 * 1.75;
      if (e1 > 0 || e2 > 0) {
        ctx.fillStyle = P.sea[L][f];
        this._quad(ctx, -2, y1, e1, y1, e2, y2, -2, y2);
        const mx = this._moonX;
        if (mx !== undefined && mx < Math.min(e1, e2) && (seg.index + (this._frame >> 3)) % 3 === 0) {
          const gw = Math.max(2, (y1 - y2) * 4 + 6);
          ctx.fillStyle = f > 3 ? 'rgba(210,225,255,0.35)' : 'rgba(210,225,255,0.18)';
          ctx.fillRect(mx - gw / 2 + ((seg.index * 7) % 5 - 2), y2, gw, Math.max(1, (y1 - y2) * 0.5));
        }
      }
    }

    // 路肩(远到只剩几像素时省略,雾里本来也看不见)
    if (w1 > 5) {
      const r1 = w1 / Math.max(6, 2 * LANES);
      const r2 = w2 / Math.max(6, 2 * LANES);
      ctx.fillStyle = P.rumble[L][f];
      this._quad(ctx, x1 - w1 - r1, y1, x1 - w1, y1, x2 - w2, y2, x2 - w2 - r2, y2);
      this._quad(ctx, x1 + w1 + r1, y1, x1 + w1, y1, x2 + w2, y2, x2 + w2 + r2, y2);
    }

    // 路面
    ctx.fillStyle = P.road[L][f];
    this._quad(ctx, x1 - w1, y1, x1 + w1, y1, x2 + w2, y2, x2 - w2, y2);

    // 起跑线:黑白格
    if (seg.start) {
      const cols = 10;
      for (let c = 0; c < cols; c++) {
        if ((c + seg.index) % 2) continue;
        const a1 = x1 - w1 + (2 * w1 * c) / cols;
        const b1 = a1 + (2 * w1) / cols;
        const a2 = x2 - w2 + (2 * w2 * c) / cols;
        const b2 = a2 + (2 * w2) / cols;
        ctx.fillStyle = P.start ? P.start[0][f] : '#EEE';
        this._quad(ctx, a1, y1, b1, y1, b2, y2, a2, y2);
      }
      return;
    }

    // 边线(实线)+ 车道虚线(只在亮段画)
    if (w1 > 18) {
      const e1 = w1 * 0.93, e2 = w2 * 0.93;
      const t1 = w1 * 0.018, t2 = w2 * 0.018;
      ctx.fillStyle = P.lane[0][f];
      this._quad(ctx, x1 - e1 - t1, y1, x1 - e1 + t1, y1, x2 - e2 + t2, y2, x2 - e2 - t2, y2);
      this._quad(ctx, x1 + e1 - t1, y1, x1 + e1 + t1, y1, x2 + e2 + t2, y2, x2 + e2 - t2, y2);
      if (seg.light) {
        const lw1 = w1 / Math.max(32, 8 * LANES);
        const lw2 = w2 / Math.max(32, 8 * LANES);
        const lane1 = (w1 * 2) / LANES;
        const lane2 = (w2 * 2) / LANES;
        let lx1 = x1 - w1 + lane1;
        let lx2 = x2 - w2 + lane2;
        for (let l = 1; l < LANES; l++) {
          this._quad(ctx, lx1 - lw1, y1, lx1 + lw1, y1, lx2 + lw2, y2, lx2 - lw2, y2);
          lx1 += lane1;
          lx2 += lane2;
        }
      }
    }
  },

  // 隧道一节:两侧墙 + 顶,顶灯隔段亮
  _drawTunnel(ctx, seg) {
    const P = seg.pal;
    const f = seg.fogI;
    const L = seg.light ? 0 : 1;
    const tw = TUN_W * ROAD_W;
    const th = TUN_H * ROAD_W * (this._H / this._W);
    const xl1 = seg.sx1 - seg.px1 * tw, xr1 = seg.sx1 + seg.px1 * tw, t1 = seg.sy1 - seg.px1 * th;
    const xl2 = seg.sx2 - seg.px2 * tw, xr2 = seg.sx2 + seg.px2 * tw, t2 = seg.sy2 - seg.px2 * th;

    ctx.fillStyle = P.wall[L][f];
    this._quad(ctx, xl1, seg.sy1, xl1, t1, xl2, t2, xl2, seg.sy2);
    this._quad(ctx, xr1, seg.sy1, xr1, t1, xr2, t2, xr2, seg.sy2);
    ctx.fillStyle = P.ceil[L][f];
    this._quad(ctx, xl1, t1, xr1, t1, xr2, t2, xl2, t2);

    // 墙上一条灯带(离地 35%)
    const b1 = seg.px1 * th * 0.35, b2 = seg.px2 * th * 0.35;
    const bh1 = Math.max(1, seg.px1 * 60), bh2 = Math.max(1, seg.px2 * 60);
    if (seg.index % 2 === 0) {
      ctx.fillStyle = P.tlight[0][f];
      this._quad(ctx, xl1, seg.sy1 - b1, xl2, seg.sy2 - b2, xl2, seg.sy2 - b2 + bh2, xl1, seg.sy1 - b1 + bh1);
      this._quad(ctx, xr1, seg.sy1 - b1, xr2, seg.sy2 - b2, xr2, seg.sy2 - b2 + bh2, xr1, seg.sy1 - b1 + bh1);
    }
    // 顶灯
    if (seg.index % 4 === 0) {
      const lw1 = seg.px1 * tw * 0.1, lw2 = seg.px2 * tw * 0.1;
      ctx.fillStyle = P.tlight[0][f];
      this._quad(ctx, seg.sx1 - lw1, t1, seg.sx1 + lw1, t1, seg.sx2 + lw2, t2, seg.sx2 - lw2, t2);
      const gw = seg.px1 * tw * 0.9;
      if (gw > 4) this._glow('g_orange', seg.sx1, t1, gw, gw * 0.5, 0.35 * (f + 1) / FOG_STEPS);
    }
  },

  // 隧道口:山体立面 + 混凝土门框(中间挖出洞口,不依赖 evenodd)
  _drawPortal(ctx, W, seg) {
    const P = seg.pal;
    const f = seg.fogI;
    const p = seg.px1;
    const R = ROAD_W;
    const V = TUN_H * R * (this._H / this._W);   // 洞口高度(与隧道内一致)
    const MV = V * 0.7;                          // 山体高度单位
    const gy = seg.sy1;
    const xl = seg.sx1 - p * TUN_W * R;
    const xr = seg.sx1 + p * TUN_W * R;
    const top = gy - p * V;
    const plateau = gy - p * MOUNTAIN[0][1] * MV;

    const side = dir => {
      const ox = dir < 0 ? xl : xr;
      ctx.beginPath();
      ctx.moveTo(ox, gy);
      for (const [d, h] of MOUNTAIN) ctx.lineTo(ox + dir * p * d * R, gy - p * h * MV);
      ctx.lineTo(ox + dir * p * 20 * R, gy);
      ctx.closePath();
      ctx.fill();
    };
    ctx.fillStyle = P.rock[0][f];
    side(-1);
    side(1);
    ctx.fillRect(xl - 1, plateau, xr - xl + 2, top - plateau);

    // 山脊月光描边
    ctx.strokeStyle = P.rim[0][f];
    ctx.lineWidth = Math.max(1, p * 50);
    for (const dir of [-1, 1]) {
      const ox = dir < 0 ? xl : xr;
      ctx.beginPath();
      ctx.moveTo(ox, plateau);
      for (const [d, h] of MOUNTAIN) ctx.lineTo(ox + dir * p * d * R, gy - p * h * MV);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(xl, plateau);
    ctx.lineTo(xr, plateau);
    ctx.stroke();

    // 门框
    const fw = Math.max(1, p * R * 0.12);
    ctx.fillStyle = P.frame[0][f];
    ctx.fillRect(xl - fw, top - fw, fw, gy - top + fw);
    ctx.fillRect(xr, top - fw, fw, gy - top + fw);
    ctx.fillRect(xl - fw, top - fw, xr - xl + fw * 2, fw);
    // 门楣黄黑警示条
    const n = 12;
    const sw = (xr - xl + fw * 2) / n;
    ctx.fillStyle = '#F5C842';
    for (let i = 0; i < n; i += 2) ctx.fillRect(xl - fw + i * sw, top - fw * 0.7, sw, fw * 0.4);
    // 洞口两盏灯
    const gw = p * R * 0.8;
    if (gw > 3) {
      this._glow('g_orange', xl - fw * 0.5, top - fw * 1.3, gw, gw, 0.5);
      this._glow('g_orange', xr + fw * 0.5, top - fw * 1.3, gw, gw, 0.5);
    }
  },

  // 海边护栏
  _drawRail(ctx, seg) {
    const P = seg.pal;
    if (!P.rail) return;
    const f = seg.fogI;
    const x1 = seg.sx1 - seg.px1 * ROAD_W * RAIL_X;
    const x2 = seg.sx2 - seg.px2 * ROAD_W * RAIL_X;
    const h1 = seg.px1 * RAIL_H, h2 = seg.px2 * RAIL_H;
    const t1 = Math.max(1, seg.px1 * 110), t2 = Math.max(1, seg.px2 * 110);
    ctx.fillStyle = P.rail[seg.light ? 0 : 1][f];
    this._quad(ctx, x1, seg.sy1 - h1, x2, seg.sy2 - h2, x2, seg.sy2 - h2 + t2, x1, seg.sy1 - h1 + t1);
    if (seg.index % 2 === 0) {
      const pw = Math.max(1, seg.px1 * 60);
      ctx.fillStyle = P.rail[1][Math.max(0, f - 3)];
      ctx.fillRect(x1 - pw / 2, seg.sy1 - h1, pw, h1);
    }
    if (seg.index % 6 === 0 && seg.sw1 > 30) {
      this._glow('g_orange', x1, seg.sy1 - h1 + t1 / 2, seg.px1 * 260, seg.px1 * 260, 0.6);
    }
  },

  _drawSprite(ctx, seg, sp, alpha) {
    const px = seg.px1;
    const cx = seg.sx1 + px * sp.offset * ROAD_W;
    const by = seg.sy1;

    if (sp.name === 'nitro') {
      if (sp.taken > 0) return;
      const s = px * ROAD_W * 0.13;
      if (s < 2 || by - s * 2.6 > seg.clip) return;
      const hover = Math.sin(this._t * 5 + seg.index) * s * 0.25;
      const y = by - s * 0.6 + hover;
      this._glow('g_cyan', cx, y - s * 1.2, s * 5, s * 5, 0.55 * alpha, true);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#60C0FF';
      ctx.beginPath();
      ctx.moveTo(cx + s * 0.2, y - s * 2.4);
      ctx.lineTo(cx + s, y - s * 1.1);
      ctx.lineTo(cx + s * 0.3, y - s * 1.1);
      ctx.lineTo(cx + s * 0.5, y);
      ctx.lineTo(cx - s, y - s * 1.3);
      ctx.lineTo(cx - s * 0.25, y - s * 1.3);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#E0F6FF';
      ctx.fillRect(cx - s * 0.1, y - s * 1.9, s * 0.25, s * 0.5);
      ctx.globalAlpha = 1;
      return;
    }

    const info = SPRITES[sp.name];
    const r = this._rects[sp.name];
    const u = SPR_UNIT * info.k * px;
    const dw = r.w * u;
    const dh = r.h * u;
    if (dw < 1) return;
    const x = cx - dw / 2;
    const y = by - dh;
    ctx.globalAlpha = alpha;
    this._blit(r, x, y, dw, dh, seg.clip);
    ctx.globalAlpha = 1;

    // 路灯:灯头光晕 + 路面光斑
    if (info.head && y + info.head[1] * u < seg.clip) {
      const hx = x + info.head[0] * u;
      const hy = y + info.head[1] * u;
      this._glow('g_orange', hx, hy, dw * 2.6, dw * 2.6, 0.7 * alpha);
      if (by < seg.clip && seg.fogI > 5 && QUALITY[this._q].pools) this._glow('g_orange', hx, by, dw * 7, dw * 1.6, 0.28 * alpha);
    }
    // 广告牌霓虹泛光
    if (info.glow && y + info.gy * u < seg.clip) {
      this._glow(info.glow, x + info.gx * u, y + info.gy * u, dw * 1.6, dw * 1.1, 0.4 * alpha);
    }
  },

  _drawCar(ctx, seg, car, alpha) {
    const pct = (car.z % SEG_LEN) / SEG_LEN;
    const px = lerp(seg.px1, seg.px2, pct);
    const cx = lerp(seg.sx1, seg.sx2, pct) + px * car.offset * ROAD_W;
    const by = lerp(seg.sy1, seg.sy2, pct);
    const r = this._rects[car.spr];
    const u = SPR_UNIT * px;
    const dw = r.w * u;
    const dh = r.h * u;
    if (dw < 2 || by - dh >= seg.clip) return;
    // 车影
    if (by <= seg.clip) {
      ctx.fillStyle = 'rgba(6,6,16,0.45)';
      ctx.fillRect(cx - dw * 0.52, by - dh * 0.06, dw * 1.04, dh * 0.1);
    }
    ctx.globalAlpha = alpha;
    this._blit(r, cx - dw / 2, by - dh, dw, dh, seg.clip);
    ctx.globalAlpha = 1;
    // 尾灯光晕
    const lights = CAR_TYPES[car.type].lights;
    for (const [lx, ly] of lights) {
      const gy = by - dh + ly * u;
      if (gy < seg.clip) this._glow('g_red', cx - dw / 2 + lx * u, gy, dw * 0.55, dw * 0.4, 0.8 * alpha, true);
    }
  },

  // 起点 / 检查点龙门
  _drawGate(ctx, seg, label, textColor, neon) {
    const px = seg.px1;
    const half = px * ROAD_W * 1.2;
    if (half < 6) return;
    const cx = seg.sx1;
    const gy = seg.sy1;
    const pw = Math.max(2, px * ROAD_W * 0.07);
    const ph = px * ROAD_W * 1.3;
    const bh = px * ROAD_W * 0.26;
    ctx.save();
    ctx.beginPath();
    ctx.rect(-10, -10, this._W + 20, seg.clip + 10);
    ctx.clip();
    ctx.fillStyle = '#26243E';
    ctx.fillRect(cx - half - pw / 2, gy - ph, pw, ph);
    ctx.fillRect(cx + half - pw / 2, gy - ph, pw, ph);
    ctx.fillStyle = neon;
    const stripe = Math.max(1, pw * 0.2);
    ctx.fillRect(cx - half - pw / 2, gy - ph, stripe, ph);
    ctx.fillRect(cx + half + pw / 2 - stripe, gy - ph, stripe, ph);
    const by = gy - ph - bh * 0.3;
    ctx.fillStyle = '#120E24';
    ctx.fillRect(cx - half - pw / 2, by, half * 2 + pw, bh);
    ctx.strokeStyle = neon;
    ctx.lineWidth = Math.max(1, bh * 0.08);
    ctx.strokeRect(cx - half - pw / 2, by, half * 2 + pw, bh);
    const fs = Math.floor(bh * 0.62);
    if (fs >= 6) {
      ctx.fillStyle = textColor;
      ctx.font = `bold ${fs}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, cx, by + bh / 2);
      ctx.textBaseline = 'alphabetic';
    }
    ctx.restore();
    this._glow(neon === '#4CFF8A' ? 'g_green' : 'g_magenta', cx, by + bh / 2, half * 2.6, bh * 3, 0.35);
  },

  // 天空:渐变 + 星星 + 月亮 + 分区远景(随弯道视差横移)
  _drawSky(ctx, W, H, seg) {
    const hz = this._hz;
    const za = ZONES[seg.skyA];
    const zb = ZONES[seg.skyB];
    const t = seg.skyT;
    const top = lerpRgb(za.sky[0], zb.sky[0], t);
    const bot = lerpRgb(za.sky[1], zb.sky[1], t);
    const key = rgb(top) + rgb(bot);
    if (this._skyKey !== key) {
      const grd = ctx.createLinearGradient(0, 0, 0, hz);
      grd.addColorStop(0, rgb(top));
      grd.addColorStop(0.6, rgb(lerpRgb(top, bot, 0.35)));
      grd.addColorStop(1, rgb(bot));
      this._skyGrad = grd;
      this._skyKey = key;
      this._skyBot = rgb(bot);
    }
    ctx.fillStyle = this._skyGrad;
    ctx.fillRect(-10, -10, W + 20, hz + 12);

    const off = this._skyOff || 0;
    // 星星(城区光污染,星星少一些)
    const starA = lerp(za.stars, zb.stars, t);
    for (let i = 0; i < this._stars.length; i++) {
      const s = this._stars[i];
      const sx = ((s.x + off * 8) % (W + 20) + W + 20) % (W + 20) - 10;
      const tw = ((this._frame + s.ph) % 90) < 6 ? 1 : 0.55;
      ctx.globalAlpha = starA * tw * s.a;
      ctx.fillStyle = '#E0E4FF';
      ctx.fillRect(sx, s.y, s.sz, s.sz);
    }
    ctx.globalAlpha = 1;

    // 月亮
    const mx = ((W * 0.76 + off * 14) % (W + 80) + W + 80) % (W + 80) - 40;
    const my = hz * 0.3;
    this._moonX = mx;
    this._glow('g_white', mx, my, 170, 170, 0.28);
    ctx.fillStyle = '#E8ECF8';
    ctx.beginPath();
    ctx.arc(mx, my, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#C6CCE2';
    ctx.beginPath(); ctx.arc(mx - 5, my - 3, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(mx + 4, my + 5, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(mx + 6, my - 6, 1.8, 0, Math.PI * 2); ctx.fill();

    // 远景:两个区的远景按过渡比例叠化
    if (za.bg === zb.bg) {
      this._drawBgLayer(ctx, W, za.bg, 1, off);
    } else {
      this._drawBgLayer(ctx, W, za.bg, 1 - t, off);
      this._drawBgLayer(ctx, W, zb.bg, t, off);
    }
  },

  _drawBgLayer(ctx, W, name, alpha, off) {
    if (alpha <= 0.02) return;
    const r = this._rects[name];
    const s = this._bgScale;
    const tw = r.w * s;
    const th = r.h * s;
    const y = this._hz - th + 2;
    let x0 = (off * 30) % tw;
    if (x0 > 0) x0 -= tw;
    ctx.globalAlpha = alpha;
    for (let x = x0; x < W; x += tw) {
      ctx.drawImage(this._img, r.x, r.y, r.w, r.h, Math.floor(x), y, Math.ceil(tw) + 1, th);
    }
    ctx.globalAlpha = 1;
  },

  // 玩家车:车灯照亮前方路面,车底霓虹,尾灯 / 氮气火焰 / 漂移侧滑
  _drawPlayerCar(ctx, W, H) {
    const speedPct = this._speed / MAX_SPEED;
    const s = this._pScale;
    const dv = this._driftVis;
    const lean = dv < -0.4 ? -1 : dv > 0.4 ? 1 : (this._steerVis < -0.35 ? -1 : this._steerVis > 0.35 ? 1 : 0);
    const r = this._rects[`player_${lean}`];
    const dw = r.w * s;
    const dh = r.h * s;
    const bob = this._speed > 0 ? Math.sin(this._t * 21) * (0.4 + speedPct * 1.1) : 0;
    const cx = Math.round(W / 2 + this._steerVis * 12 + dv * 10);
    const by = Math.round(this._carY + bob);

    // 前大灯打在路面上
    this._glow('g_white', cx, by - dh * 1.25, W * 1.05, dh * 1.4, 0.2);
    this._glow('g_white', cx, by - dh * 1.9, W * 0.55, dh * 0.8, 0.12);
    // 车影 + 车底霓虹
    ctx.fillStyle = 'rgba(6,6,16,0.55)';
    ctx.beginPath();
    ctx.ellipse(cx, by + 1, dw * 0.56, dh * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    this._glow('g_magenta', cx, by, dw * 1.5, dh * 0.45, 0.55 + 0.1 * Math.sin(this._t * 6));

    ctx.save();
    ctx.translate(cx, by);
    ctx.rotate(dv * 0.07 + this._steerVis * 0.015);
    ctx.drawImage(this._img, r.x, r.y, r.w, r.h, -dw / 2, -dh, dw, dh);

    // 尾灯(刹车 / 漂移时更亮)
    const brake = this._keys.brake && this.data.gameState === 'playing';
    for (const [lx, ly] of PLAYER_META.lights) {
      this._glow('g_red', (lx - r.w / 2) * s, (ly - r.h) * s, dw * (brake ? 0.55 : 0.4), dh * (brake ? 0.55 : 0.35), brake ? 1 : 0.6, true);
    }
    // 排气火焰:氮气蓝、小加速按档位蓝/橙
    const flame = this._nitroT > 0 ? 'nitro' : (this._mtT > 0 ? (this._mtLevel > 1 ? 'orange' : 'blue') : null);
    if (flame) {
      const col = flame === 'orange' ? '#FF9A3C' : '#60C0FF';
      const core = flame === 'orange' ? '#FFE0A0' : '#E0F6FF';
      const len = (flame === 'nitro' ? 18 : 11) * s * (0.7 + Math.random() * 0.6);
      for (const [ex, ey] of PLAYER_META.exhaust) {
        const fx = (ex - r.w / 2) * s;
        const fy = (ey - r.h) * s;
        ctx.fillStyle = col;
        ctx.fillRect(fx - 2 * s, fy, 4 * s, len * 0.25);
        ctx.fillStyle = core;
        ctx.fillRect(fx - s, fy, 2 * s, len * 0.15);
        this._glow(flame === 'orange' ? 'g_orange' : 'g_blue', fx, fy + len * 0.1, len * 1.6, len * 1.2, 0.8, true);
      }
    }
    ctx.restore();

    // 漂移蓄力条
    if (this._drift) {
      const d = this._drift;
      const w = dw * 0.6;
      const pct = clamp(d.t / MT_LV2, 0, 1);
      const y = by - dh - 14;
      ctx.fillStyle = 'rgba(10,10,26,0.7)';
      ctx.fillRect(cx - w / 2 - 1, y - 1, w + 2, 6);
      ctx.fillStyle = d.level > 1 ? '#FF9A3C' : d.level > 0 ? '#60C0FF' : '#8A8AAA';
      ctx.fillRect(cx - w / 2, y, w * pct, 4);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillRect(cx - w / 2 + w * (MT_LV1 / MT_LV2), y, 1, 4);
    }
  },

  // 速度线:高速时从消失点向外飞;氮气时更密、偏蓝
  _drawSpeedLines(ctx, W, H) {
    const pct = this._speed / MAX_SPEED;
    const nitro = this._nitroT > 0;
    const strength = nitro ? 1 : clamp((pct - 0.72) / 0.28, 0, 1) * 0.6;
    if (!this._lines) {
      this._lines = Array.from({ length: 22 }, () => ({ a: Math.random() * Math.PI * 2, r: Math.random() }));
    }
    if (strength <= 0) return;
    const cx = W / 2;
    const cy = this._hz + 10;
    const maxR = Math.hypot(W, H) * 0.6;
    ctx.strokeStyle = nitro ? 'rgba(140,210,255,0.5)' : 'rgba(220,220,255,0.28)';
    ctx.lineWidth = nitro ? 2 : 1.5;
    ctx.beginPath();
    for (const l of this._lines) {
      l.r += (0.02 + pct * 0.035) * (nitro ? 1.5 : 1);
      if (l.r > 1) { l.r = 0.25 + Math.random() * 0.1; l.a = Math.random() * Math.PI * 2; }
      if (Math.random() > strength) continue;
      const r0 = maxR * l.r;
      const r1 = r0 + maxR * 0.12 * l.r;
      const ca = Math.cos(l.a), sa = Math.sin(l.a);
      ctx.moveTo(cx + ca * r0, cy + sa * r0 * 0.7);
      ctx.lineTo(cx + ca * r1, cy + sa * r1 * 0.7);
    }
    ctx.stroke();
  },

  _drawVignette(ctx, W, H) {
    if (!this._vig) {
      const g = ctx.createRadialGradient(W / 2, H * 0.52, H * 0.25, W / 2, H * 0.52, H * 0.78);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(4,2,14,0.55)');
      this._vig = g;
    }
    ctx.fillStyle = this._vig;
    ctx.fillRect(-10, -10, W + 20, H + 20);
  },

  // 带描边的文字(浅色字在亮背景上也看得清)
  _text(ctx, str, x, y, font, color, align, stroke) {
    ctx.font = font;
    ctx.textAlign = align || 'left';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';   // 默认尖角描边在 N、M 这类字母上会戳出黑刺
    ctx.strokeStyle = stroke || 'rgba(8,6,20,0.85)';
    ctx.strokeText(str, x, y);
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  },

  _panel(ctx, x, y, w, h, border) {
    ctx.fillStyle = 'rgba(12,10,30,0.62)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = 'rgba(8,6,20,0.6)';
    ctx.fillRect(x + 2, y + h, w, 2);
    ctx.fillRect(x + w, y + 2, 2, h);
  },

  _drawHUD(ctx, W, H) {
    const meters = Math.round(this._dist * M_PER_UNIT);
    const kmh = Math.round(this._speed * KMH_PER_UNIT);

    // ── 顶部中央:剩余时间 + 检查点进度 ──
    const t = Math.max(0, this._time);
    const urgent = t <= 10;
    const blink = urgent && Math.floor(this._t * 4) % 2 === 0;
    const pw = 124;
    const px = W / 2 - pw / 2;
    this._panel(ctx, px, 8, pw, 54, urgent ? '#FF6B6B' : 'rgba(167,139,250,0.7)');
    this._text(ctx, 'TIME', W / 2, 22, '10px monospace', 'rgba(190,180,240,0.9)', 'center');
    this._text(ctx, t.toFixed(1), W / 2, 52, 'bold 30px monospace', blink ? '#FF6B6B' : '#FFFFFF', 'center');
    const prog = clamp(1 - (this._nextCP - meters) / CP_METERS, 0, 1);
    ctx.fillStyle = 'rgba(76,175,80,0.25)';
    ctx.fillRect(px, 68, pw, 4);
    ctx.fillStyle = '#4CFF8A';
    ctx.fillRect(px, 68, pw * prog, 4);
    this._text(ctx, `检查点 ${Math.max(0, Math.ceil(this._nextCP - meters))}m`, W / 2, 86, '10px monospace', 'rgba(140,240,170,0.95)', 'center');

    // ── 左上:里程 + 区域 + 超车 ──
    this._text(ctx, 'DIST', 14, 22, '10px monospace', 'rgba(190,180,240,0.9)');
    this._text(ctx, `${meters}m`, 14, 44, 'bold 20px monospace', '#F5C842');
    const zone = ZONES[this._curZone];
    this._text(ctx, zone.name, 14, 62, '11px monospace', '#C0C0E8');
    this._text(ctx, `超车 ${this._stats.overtakes}  擦肩 ${this._stats.nearMiss}`, 14, 78, '10px monospace', 'rgba(160,160,200,0.85)');
    if (this._best > 0 && meters > this._best) {
      this._text(ctx, '★ 新纪录', 14, 94, 'bold 10px monospace', '#F5C842');
    }

    // ── 右上:转速表式速度计 + 档位 + 氮气 ──
    const cx = W - 54;
    const cy = 100;
    const rad = 34;
    const segs = 20;
    const a0 = Math.PI * 0.75;
    const sweep = Math.PI * 1.5;
    const lit = Math.round(clamp(this._speed / (MAX_SPEED * NITRO_MULT), 0, 1) * segs);
    ctx.fillStyle = 'rgba(12,10,30,0.55)';
    ctx.beginPath();
    ctx.arc(cx, cy, rad + 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 6;
    for (let i = 0; i < segs; i++) {
      const a = a0 + sweep * (i + 0.1) / segs;
      const b = a0 + sweep * (i + 0.85) / segs;
      let col = 'rgba(120,120,170,0.25)';
      if (i < lit) {
        if (this._nitroT > 0) col = '#60C0FF';
        else col = i < segs * 0.5 ? '#4CFF8A' : i < segs * 0.72 ? '#F5C842' : '#FF6B6B';
      }
      ctx.strokeStyle = col;
      ctx.beginPath();
      ctx.arc(cx, cy, rad, a, b);
      ctx.stroke();
    }
    this._text(ctx, String(kmh), cx, cy + 6, 'bold 20px monospace', this._nitroT > 0 ? '#60C0FF' : '#FFFFFF', 'center');
    this._text(ctx, 'KM/H', cx, cy + 20, '9px monospace', 'rgba(190,180,240,0.9)', 'center');
    const { gear } = this._gearRpm();
    this._text(ctx, `${gear}`, cx, cy + 38, 'bold 12px monospace', '#D97757', 'center');

    // 氮气三格(可以是半格)
    const nw = 22, nh = 7, gap = 4;
    const nx0 = cx - (nw * MAX_NITRO + gap * (MAX_NITRO - 1)) / 2;
    const ny = cy + 50;
    for (let i = 0; i < MAX_NITRO; i++) {
      const x = nx0 + i * (nw + gap);
      ctx.fillStyle = 'rgba(96,192,255,0.18)';
      ctx.fillRect(x, ny, nw, nh);
      const fill = clamp(this._nitro - i, 0, 1);
      ctx.fillStyle = fill >= 1 ? '#60C0FF' : 'rgba(96,192,255,0.55)';
      ctx.fillRect(x, ny, nw * fill, nh);
    }
    this._text(ctx, 'N2O', cx, ny + 19, '9px monospace', '#60C0FF', 'center');

    // ── 擦肩连击 ──
    if (this._comboShow > 0 && this._combo > 0) {
      const a = clamp(this._comboShow / 0.4, 0, 1);
      const pop = 1 + Math.max(0, this._comboShow - 1.2) * 1.5;
      ctx.globalAlpha = a;
      this._text(ctx, '擦肩!', 16, H * 0.36, 'bold 14px monospace', '#C8E8FF');
      this._text(ctx, `×${this._combo}`, 16, H * 0.36 + 30 * pop, `bold ${Math.round(26 * pop)}px monospace`, '#60C0FF');
      this._text(ctx, `+${NEAR_BONUS}s`, 16, H * 0.36 + 48 * pop, '11px monospace', '#F5C842');
      ctx.globalAlpha = 1;
    }
  },

  // 进入新区域时的横幅
  _drawBanner(ctx, W, H) {
    const b = this._banner;
    if (!b) return;
    const z = ZONES[b.zone];
    const inT = clamp(b.t / 0.35, 0, 1);
    const outT = clamp((b.t - 2.2) / 0.6, 0, 1);
    const slide = (1 - inT) * (1 - inT) * W * 0.6 - outT * outT * W * 0.6;
    const y = H * 0.22;
    ctx.globalAlpha = inT * (1 - outT);
    ctx.fillStyle = 'rgba(12,10,30,0.7)';
    ctx.fillRect(slide, y - 26, W, 44);
    ctx.fillStyle = '#D97757';
    ctx.fillRect(slide, y - 26, W, 2);
    ctx.fillRect(slide, y + 16, W, 2);
    this._text(ctx, z.en, W / 2 + slide, y - 10, '10px monospace', '#A78BFA', 'center');
    this._text(ctx, z.name, W / 2 + slide, y + 10, 'bold 20px monospace', '#FFFFFF', 'center');
    ctx.globalAlpha = 1;
  },

  _drawLabels(ctx, W, H) {
    for (let i = 0; i < this._labels.length; i++) {
      const lb = this._labels[i];
      const a = lb.f < 6 ? lb.f / 6 : 1 - Math.max(0, lb.f - 34) / 26;
      const scale = lb.f < 6 ? 1.4 - lb.f * 0.066 : 1;
      ctx.globalAlpha = Math.max(0, a);
      this._text(ctx, lb.text, W / 2, H * 0.33 - lb.f * 0.5 + i * 28, `bold ${Math.round(22 * scale)}px monospace`, lb.color, 'center');
    }
    ctx.globalAlpha = 1;
  },

  // 前方弯道的平均曲率(用于预警)
  _lookAheadCurve() {
    const segs = this._segments;
    const count = segs.length;
    const base = this._segmentAt(this._position + PLAYER_Z).index;
    let sum = 0;
    for (let i = 6; i < 46; i++) sum += segs[(base + i) % count].curve;
    return sum / 40;
  },

  // 弯道预警:提前用箭头告诉玩家往哪拐、有多急
  _drawCurveWarning(ctx, W, H) {
    if (this._countdown > 0) return;
    const c = this._lookAheadCurve();
    const mag = Math.abs(c);
    if (mag < 0.8) return;

    const dir = c > 0 ? 1 : -1;
    const n = mag > 4 ? 3 : (mag > 2 ? 2 : 1);   // 越急箭头越多
    const hard = mag > 4;
    const y = this._hz + 30;
    const pulse = 0.55 + 0.45 * Math.sin(this._t * 10);

    ctx.save();
    ctx.globalAlpha = Math.min(1, (mag - 0.6) / 2) * pulse;
    ctx.fillStyle = hard ? '#FF6B6B' : '#F5C842';
    ctx.strokeStyle = 'rgba(8,6,20,0.8)';
    ctx.lineWidth = 2;
    for (let i = 0; i < n; i++) {
      const x = W / 2 + dir * (26 + i * 20);
      ctx.beginPath();
      ctx.moveTo(x, y - 13);
      ctx.lineTo(x + dir * 15, y);
      ctx.lineTo(x, y + 13);
      ctx.lineTo(x - dir * 5, y + 13);
      ctx.lineTo(x + dir * 10, y);
      ctx.lineTo(x - dir * 5, y - 13);
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
    }
    // 急弯且车速过快时提示:漂过去
    if (hard && this._speed > MAX_SPEED * 0.72 && !this._drift) {
      ctx.globalAlpha = pulse;
      this._text(ctx, '急弯 · 按住漂移+转向', W / 2, y + 36, 'bold 13px monospace', '#FF6B6B', 'center');
    }
    ctx.restore();
  },

  // 发车信号灯 + 倒计时大字
  _drawCountdown(ctx, W, H) {
    if (this._countdown <= 0) return;
    const n = Math.ceil(this._countdown);
    const frac = this._countdown - Math.floor(this._countdown);  // 1 → 0
    // 三盏红灯依次点亮
    const lit = 4 - n;
    const lx = W / 2 - 48;
    const ly = H * 0.25;
    this._panel(ctx, lx - 10, ly - 20, 116, 40, 'rgba(167,139,250,0.7)');
    for (let i = 0; i < 3; i++) {
      const on = i < lit;
      ctx.fillStyle = on ? '#FF3B3B' : '#2A2238';
      ctx.beginPath();
      ctx.arc(lx + i * 48, ly, 12, 0, Math.PI * 2);
      ctx.fill();
      if (on) this._glow('g_red', lx + i * 48, ly, 60, 60, 0.7, true);
    }
    const size = Math.round(58 + (1 - frac) * 26);
    ctx.globalAlpha = Math.max(0, Math.min(1, frac * 1.8));
    this._text(ctx, String(n), W / 2, H * 0.6, `bold ${size}px monospace`, n <= 1 ? '#4CFF8A' : '#F5C842', 'center');
    ctx.globalAlpha = 1;
    this._text(ctx, '准 备', W / 2, H * 0.6 + 28, '13px monospace', 'rgba(200,200,232,0.85)', 'center');
  },

  _initSky() {
    this._stars = Array.from({ length: 60 }, () => ({
      x: Math.random() * this._W,
      y: Math.random() * this._hz * 0.8,
      sz: Math.random() < 0.2 ? 2 : 1,
      a: 0.5 + Math.random() * 0.5,
      ph: Math.floor(Math.random() * 90),
    }));
  },
});
