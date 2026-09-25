// ── Clawd 夜行赛车 · 像素美术 ────────────────────────────────
// 所有精灵在启动时用 fillRect 逐像素画进一张离屏图集(1 倍分辨率),
// 游戏里再用 drawImage 按距离缩放、关闭平滑,得到清晰的像素风。
// 这样每帧只剩 drawImage,比逐帧拼路径省得多。
const { drawClawd } = require('./clawd');

const ATLAS_W = 1024;
const ATLAS_H = 512;
const PAD = 2;

// 可复现的伪随机(同一条赛道每次看起来都一样)
function makeRng(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function R(g, x, y, w, h, c) {
  g.fillStyle = c;
  g.fillRect(Math.floor(x), Math.floor(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
}

// ── 通用色 ──
const GLASS = '#141428';
const GLASS_HI = '#3A3A66';
const TL = '#FF3344';
const TL_HI = '#FFA0A8';
const TIRE = '#0C0C18';
const TREAD = '#24243A';
const PLATE = '#D8D8E8';

// 对手车配色:[车身, 高光, 暗部]
const CAR_PALETTES = [
  ['#4A6FA5', '#6B92C8', '#2E4A75'],
  ['#A855F7', '#C589FF', '#6E2FB0'],
  ['#4CAF50', '#7FD483', '#2E7532'],
  ['#E0484E', '#FF7A7E', '#962A30'],
  ['#F5C842', '#FFE07A', '#B08A20'],
];
const TRUCK_PALETTES = [
  ['#C8CCD8', '#ECEEF6', '#8A8EA0'],
  ['#3AA6A0', '#6FD3CC', '#23706B'],
  ['#E08A3C', '#F5B070', '#9A5A20'],
];

// 车型:尺寸、尾灯位置(精灵像素坐标)、速度区间(占极速比例)
const CAR_TYPES = {
  sedan: { w: 40, h: 26, lights: [[8, 13], [32, 13]], speed: [0.3, 0.5], colors: CAR_PALETTES.length },
  sport: { w: 44, h: 22, lights: [[8, 11], [36, 11]], speed: [0.44, 0.6], colors: CAR_PALETTES.length },
  truck: { w: 44, h: 38, lights: [[6, 24], [38, 24]], speed: [0.24, 0.36], colors: TRUCK_PALETTES.length },
};

// 玩家车:尾灯、排气口、后轮着地点
const PLAYER_META = {
  w: 76,
  h: 46,
  lights: [[14, 22], [62, 22]],
  exhaust: [[28, 35], [47, 35]],
  wheels: [[6, 45], [70, 45]],
};

// 精灵的世界尺寸倍率(1 像素 = SPR_UNIT × k 世界单位)与挂点
const SPRITES = {
  pine:  { k: 2.3 },
  pine2: { k: 2.3 },
  palm:  { k: 2.1 },
  bush:  { k: 1.7 },
  rock:  { k: 1.6 },
  bld0:  { k: 4.2 },
  bld1:  { k: 4.2 },
  bld2:  { k: 4.2 },
  bb0:   { k: 2.8, glow: 'g_magenta', gx: 32, gy: 20 },
  bb1:   { k: 2.8, glow: 'g_cyan', gx: 32, gy: 20 },
  lampR: { k: 2.0, head: [5, 7] },
  lampL: { k: 2.0, head: [16, 7] },
  chevR: { k: 1.7 },
  chevL: { k: 1.7 },
};

// ── 车辆 ──────────────────────────────────────────────────
function drawSedan(g, c) {
  const [body, hi, dark] = c;
  R(g, 11, 0, 18, 2, hi);
  R(g, 9, 2, 22, 8, body);
  R(g, 11, 3, 18, 6, GLASS);
  R(g, 12, 3, 5, 1, GLASS_HI);
  R(g, 13, 4, 3, 1, GLASS_HI);
  R(g, 2, 10, 36, 10, body);
  R(g, 2, 10, 36, 1, hi);
  R(g, 2, 11, 2, 9, dark);
  R(g, 36, 11, 2, 9, dark);
  R(g, 12, 11, 16, 1, dark);
  R(g, 4, 12, 8, 3, TL);
  R(g, 5, 13, 6, 1, TL_HI);
  R(g, 28, 12, 8, 3, TL);
  R(g, 29, 13, 6, 1, TL_HI);
  R(g, 16, 15, 8, 3, PLATE);
  R(g, 17, 16, 6, 1, '#8A8AA0');
  R(g, 2, 18, 36, 2, dark);
  R(g, 8, 20, 24, 2, TIRE);
  R(g, 3, 19, 7, 7, TIRE);
  R(g, 30, 19, 7, 7, TIRE);
  [21, 24].forEach(y => { R(g, 3, y, 7, 1, TREAD); R(g, 30, y, 7, 1, TREAD); });
  R(g, 25, 20, 3, 1, '#6A6A80');
}

function drawSport(g, c) {
  const [body, hi, dark] = c;
  R(g, 4, 0, 36, 2, hi);
  R(g, 4, 2, 36, 1, dark);
  R(g, 9, 3, 2, 5, dark);
  R(g, 33, 3, 2, 5, dark);
  R(g, 13, 3, 18, 6, body);
  R(g, 15, 4, 14, 4, GLASS);
  R(g, 16, 4, 4, 1, GLASS_HI);
  R(g, 1, 8, 42, 8, body);
  R(g, 1, 8, 42, 1, hi);
  R(g, 1, 9, 2, 7, dark);
  R(g, 41, 9, 2, 7, dark);
  R(g, 4, 10, 36, 2, TL);
  R(g, 6, 10, 32, 1, TL_HI);
  R(g, 8, 14, 28, 3, '#1A1A28');
  for (let x = 10; x < 35; x += 4) R(g, x, 14, 1, 3, dark);
  R(g, 17, 15, 3, 2, '#8A8AA0');
  R(g, 24, 15, 3, 2, '#8A8AA0');
  R(g, 1, 14, 7, 8, TIRE);
  R(g, 36, 14, 7, 8, TIRE);
  [16, 19].forEach(y => { R(g, 1, y, 7, 1, TREAD); R(g, 36, y, 7, 1, TREAD); });
}

function drawTruck(g, c) {
  const [body, hi, dark] = c;
  R(g, 3, 0, 38, 28, body);
  R(g, 3, 0, 38, 2, hi);
  R(g, 3, 2, 2, 26, dark);
  R(g, 39, 2, 2, 26, dark);
  R(g, 21, 3, 2, 24, dark);
  for (let y = 7; y < 26; y += 6) {
    R(g, 6, y, 14, 1, dark);
    R(g, 24, y, 14, 1, dark);
  }
  R(g, 18, 13, 2, 5, '#E8E8F0');
  R(g, 24, 13, 2, 5, '#E8E8F0');
  R(g, 3, 28, 38, 3, '#2A2A3A');
  R(g, 4, 21, 4, 6, TL);
  R(g, 5, 22, 2, 4, TL_HI);
  R(g, 36, 21, 4, 6, TL);
  R(g, 37, 22, 2, 4, TL_HI);
  R(g, 18, 28, 8, 3, PLATE);
  R(g, 5, 30, 8, 8, TIRE);
  R(g, 31, 30, 8, 8, TIRE);
  [32, 35].forEach(y => { R(g, 5, y, 8, 1, TREAD); R(g, 31, y, 8, 1, TREAD); });
  R(g, 13, 31, 1, 6, '#141420');
  R(g, 30, 31, 1, 6, '#141420');
}

// 玩家车:后视,Clawd 从敞篷座舱探出脑袋。lean = -1/0/1 表示车身侧倾
function drawPlayer(g, lean) {
  const d = lean * 2;
  const BODY = '#D97757';
  const BODY_HI = '#F4A07E';
  const BODY_DK = '#A85535';
  // Clawd(车身会盖住下半身)
  drawClawd(g, 22 + d, 1, 1, { legFrame: 'all' });
  // 座舱边沿(挡住 Clawd 的身子)
  R(g, 20 + d, 12, 36, 4, '#3A2030');
  // 尾翼(比 Clawd 的小手低,让他像扒着尾翼往前看)
  R(g, 5 + d, 12, 66, 3, '#C0C0E8');
  R(g, 5 + d, 12, 66, 1, '#EEEEFF');
  R(g, 5 + d, 14, 66, 1, '#6A6A90');
  R(g, 14 + d, 15, 3, 2, '#5A5A78');
  R(g, 59 + d, 15, 3, 2, '#5A5A78');
  // 车身
  R(g, 2 + d, 16, 72, 16, BODY);
  R(g, 2 + d, 16, 72, 2, BODY_HI);
  R(g, 2 + d, 18, 3, 14, BODY_DK);
  R(g, 71 + d, 18, 3, 14, BODY_DK);
  R(g, 2 + d, 28, 72, 4, BODY_DK);
  // 双白色赛车条纹
  R(g, 33 + d, 16, 3, 12, '#FFF0E6');
  R(g, 40 + d, 16, 3, 12, '#FFF0E6');
  // 尾灯
  R(g, 6 + d, 20, 16, 4, '#7A1A22');
  R(g, 7 + d, 21, 14, 2, TL);
  R(g, 8 + d, 21, 5, 1, TL_HI);
  R(g, 54 + d, 20, 16, 4, '#7A1A22');
  R(g, 55 + d, 21, 14, 2, TL);
  R(g, 63 + d, 21, 5, 1, TL_HI);
  // 车牌
  R(g, 31 + d, 24, 14, 4, '#1A1A2E');
  R(g, 33 + d, 25, 10, 2, '#F5C842');
  // 扩散器 + 排气
  R(g, 16 + d, 31, 44, 5, '#241A26');
  for (let x = 18; x < 60; x += 5) R(g, x + d, 31, 1, 5, '#3E2E40');
  R(g, 26 + d, 32, 5, 4, '#7A7A92');
  R(g, 27 + d, 33, 3, 2, '#101018');
  R(g, 45 + d, 32, 5, 4, '#7A7A92');
  R(g, 46 + d, 33, 3, 2, '#101018');
  // 后轮(不随车身侧倾)
  R(g, 0, 28, 12, 18, TIRE);
  R(g, 64, 28, 12, 18, TIRE);
  for (let y = 30; y < 46; y += 3) {
    R(g, 0, y, 12, 1, TREAD);
    R(g, 64, y, 12, 1, TREAD);
  }
  // 转向时露出轮胎内侧
  if (lean < 0) R(g, 11, 30, 2, 14, '#3A3A52');
  if (lean > 0) R(g, 63, 30, 2, 14, '#3A3A52');
}

// ── 植被 / 地物 ────────────────────────────────────────────
function drawPine(g, w, h, tiers) {
  const cx = Math.floor(w / 2);
  const trunkH = Math.round(h * 0.18);
  R(g, cx - 2, h - trunkH, 4, trunkH, '#3A2A2E');
  R(g, cx - 2, h - trunkH, 1, trunkH, '#4E3A3E');
  const tierH = Math.round((h - trunkH) / (tiers * 0.75 + 0.25));
  for (let t = 0; t < tiers; t++) {
    const top = Math.round(t * tierH * 0.75);
    const maxHalf = Math.round((w / 2 - 1) * (0.5 + 0.5 * (t + 1) / tiers));
    for (let r = 0; r < tierH; r++) {
      const half = Math.max(1, Math.round(maxHalf * (r + 1) / tierH));
      const y = top + r;
      R(g, cx - half, y, half * 2, 1, '#1F4A3A');
      R(g, cx - half, y, Math.max(1, Math.round(half * 0.7)), 1, '#173828');
      R(g, cx + half - 1, y, 1, 1, '#3E8262');
    }
  }
}

function drawPalm(g, rnd) {
  // 树干:从底部往上微弯
  let tx = 24, ty = 16;
  for (let y = 65; y >= 16; y--) {
    const t = (65 - y) / 49;
    const x = 26 - 7 * t * t;
    R(g, x - 2, y, 4, 1, (y % 4 < 2) ? '#6A5440' : '#52402F');
    if (y === 16) { tx = x; ty = y; }
  }
  // 椰子
  R(g, tx - 3, ty + 1, 3, 3, '#4A3420');
  R(g, tx + 1, ty + 2, 3, 3, '#5A4028');
  // 叶子:7 片向四周垂下
  const fronds = [-2.9, -2.4, -1.9, -1.2, -0.6, -0.2, 0.25];
  fronds.forEach((a, i) => {
    const len = 17 + Math.floor(rnd() * 5);
    const droop = 0.028 + rnd() * 0.02;
    for (let s = 0; s < len; s++) {
      const px = tx + Math.cos(a) * s;
      const py = ty + Math.sin(a) * s + droop * s * s;
      R(g, px, py, 2, 2, i % 2 ? '#2E6A4A' : '#265C3E');
      if (s > 3 && s % 2 === 0) R(g, px, py + 2, 1, 2 + (s % 3), '#1E4A32');
      if (s < len - 3 && s % 5 === 0) R(g, px, py - 1, 1, 1, '#4A9A6A');
    }
  });
}

function drawBush(g, rnd) {
  for (let x = 0; x < 28; x++) {
    const t = (x - 14) / 14;
    const top = Math.round(4 + 8 * t * t + rnd() * 2);
    R(g, x, top, 1, 14 - top, '#1C4034');
    R(g, x, top, 1, 1, '#2E6048');
  }
}

function drawRock(g) {
  const rows = [[7, 14], [4, 17], [2, 19], [1, 20], [0, 21], [0, 22], [0, 22], [1, 21], [1, 21], [2, 20], [2, 20], [3, 19], [3, 19], [4, 18]];
  rows.forEach(([a, b], y) => {
    R(g, a, y, b - a, 1, '#3E4256');
    R(g, a, y, Math.max(1, Math.round((b - a) * 0.3)), 1, '#555A72');
  });
  R(g, 8, 4, 5, 1, '#6A7090');
}

function drawBuilding(g, w, h, rnd, variant) {
  const base = ['#1E1E38', '#221F40', '#191A32'][variant];
  const edgeHi = '#2E2C52';
  R(g, 0, 8, w, h - 8, base);
  R(g, 0, 8, 2, h - 8, edgeHi);
  R(g, w - 2, 8, 2, h - 8, '#12122A');
  R(g, 0, 8, w, 2, '#34305A');
  // 屋顶天线 + 红色航标灯
  const ax = Math.floor(w * 0.68);
  R(g, ax, 0, 1, 8, '#5A5A7A');
  R(g, ax - 1, 0, 3, 1, '#FF4050');
  // 窗户
  const cols = Math.floor((w - 6) / 6);
  const rows = Math.floor((h - 22) / 7);
  const ox = Math.floor((w - cols * 6) / 2) + 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = rnd();
      let col = '#15152C';
      if (v < 0.24) col = '#F5C842';
      else if (v < 0.33) col = '#9FD8FF';
      else if (v < 0.38) col = '#FF6BD5';
      else if (v < 0.46) col = '#6A5A3A';
      R(g, ox + c * 6, 14 + r * 7, 3, 4, col);
    }
  }
  // 霓虹竖条(第二种楼)
  if (variant === 1) {
    R(g, w - 6, 18, 2, Math.floor(h * 0.45), '#FF4FD8');
    R(g, w - 6, 18, 1, Math.floor(h * 0.45), '#FFB0F0');
  }
  // 底层亮着的大堂
  R(g, Math.floor(w / 2) - 6, h - 9, 12, 9, '#6A5230');
  R(g, Math.floor(w / 2) - 5, h - 8, 10, 7, '#F5C842');
}

function drawBillboard(g, variant) {
  const neon = variant === 0 ? '#FF4FD8' : '#4FE0FF';
  const neonHi = variant === 0 ? '#FFC0F4' : '#C0F6FF';
  R(g, 14, 40, 4, 32, '#3A3A58');
  R(g, 46, 40, 4, 32, '#3A3A58');
  R(g, 14, 40, 1, 32, '#50507A');
  R(g, 46, 40, 1, 32, '#50507A');
  R(g, 0, 0, 64, 40, '#1C1A2E');
  R(g, 2, 2, 60, 1, neon); R(g, 2, 37, 60, 1, neon);
  R(g, 2, 2, 1, 36, neon); R(g, 61, 2, 1, 36, neon);
  R(g, 3, 3, 58, 34, '#120C22');
  if (variant === 0) {
    drawClawd(g, 16, 9, 1, { legFrame: 0 });
    // 速度线
    [12, 17, 22].forEach((y, i) => R(g, 6 + i * 2, y, 8 - i * 2, 1, neonHi));
  } else {
    // 闪电
    const bolt = [[36, 6, 4], [33, 9, 5], [30, 12, 6], [27, 15, 10], [30, 18, 6], [28, 21, 5], [26, 24, 4], [24, 27, 3]];
    bolt.forEach(([x, y, w]) => R(g, x, y, w, 3, '#F5C842'));
    R(g, 34, 6, 2, 3, '#FFF0A0');
    [10, 16, 22, 28].forEach((y, i) => R(g, 6, y, 12 - (i % 2) * 4, 1, neonHi));
    [10, 16, 22, 28].forEach((y, i) => R(g, 46 + (i % 2) * 4, y, 12 - (i % 2) * 4, 1, neonHi));
  }
  // 灯箱底部射灯
  R(g, 10, 38, 4, 2, '#FFE8A0');
  R(g, 50, 38, 4, 2, '#FFE8A0');
}

// 路灯(灯杆在右,灯臂伸向左侧路面)
function drawLamp(g) {
  R(g, 17, 4, 3, 68, '#3A3A58');
  R(g, 17, 4, 1, 68, '#50507A');
  R(g, 4, 3, 16, 2, '#3A3A58');
  R(g, 1, 4, 9, 3, '#2A2A40');
  R(g, 2, 7, 7, 1, '#FFE8A0');
  R(g, 15, 66, 7, 6, '#2A2A40');
}

// 弯道指示牌(箭头指向右)
function drawChevron(g) {
  R(g, 0, 0, 22, 16, '#1A1A2E');
  R(g, 1, 1, 20, 14, '#F5C842');
  for (let k = 0; k < 2; k++) {
    const ox = 4 + k * 7;
    for (let i = 0; i < 6; i++) {
      R(g, ox + i, 2 + i, 3, 1, '#1A1A2E');
      R(g, ox + i, 13 - i, 3, 1, '#1A1A2E');
    }
  }
  R(g, 10, 16, 2, 12, '#8A8AA0');
}

function drawGlow(g, rgb) {
  const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, `rgba(${rgb},1)`);
  grd.addColorStop(0.22, `rgba(${rgb},0.6)`);
  grd.addColorStop(0.55, `rgba(${rgb},0.16)`);
  grd.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = grd;
  g.fillRect(0, 0, 32, 32);
}

// ── 远景(256 宽无缝平铺)────────────────────────────────────
function wrapRect(g, x, y, w, h, c, tileW) {
  R(g, x, y, w, h, c);
  if (x + w > tileW) R(g, x - tileW, y, w, h, c);
  if (x < 0) R(g, x + tileW, y, w, h, c);
}

function drawBgCity(g, rnd) {
  const TW = 256, TH = 80;
  // 后排:紫色雾里的楼群
  let x = 0;
  while (x < TW) {
    const w = 10 + Math.floor(rnd() * 18);
    const h = 22 + Math.floor(rnd() * 40);
    wrapRect(g, x, TH - h, w, h, '#2A1E4A', TW);
    for (let wy = TH - h + 4; wy < TH - 4; wy += 6) {
      for (let wx = x + 2; wx < x + w - 2; wx += 4) {
        if (rnd() < 0.18) wrapRect(g, wx, wy, 1, 2, '#6A4E9A', TW);
      }
    }
    x += w + 1 + Math.floor(rnd() * 4);
  }
  // 电视塔
  wrapRect(g, 186, 6, 2, TH - 6, '#1C1636', TW);
  wrapRect(g, 182, 26, 10, 5, '#1C1636', TW);
  wrapRect(g, 186, 3, 2, 3, '#FF4050', TW);
  wrapRect(g, 183, 28, 8, 1, '#FF6BD5', TW);
  // 前排:更暗更矮,窗户更亮
  x = 3;
  while (x < TW) {
    const w = 12 + Math.floor(rnd() * 20);
    const h = 10 + Math.floor(rnd() * 28);
    wrapRect(g, x, TH - h, w, h, '#15122A', TW);
    for (let wy = TH - h + 3; wy < TH - 2; wy += 5) {
      for (let wx = x + 2; wx < x + w - 2; wx += 4) {
        const v = rnd();
        if (v < 0.16) wrapRect(g, wx, wy, 2, 2, '#C8A04A', TW);
        else if (v < 0.21) wrapRect(g, wx, wy, 2, 2, '#FF6BD5', TW);
        else if (v < 0.27) wrapRect(g, wx, wy, 2, 2, '#6FC8FF', TW);
      }
    }
    if (rnd() < 0.3) wrapRect(g, x + Math.floor(w / 2), TH - h - 4, 1, 4, '#3A3060', TW);
    x += w + Math.floor(rnd() * 5);
  }
}

// 周期函数叠加 → 首尾无缝的山脊线
function ridge(rnd, n) {
  const waves = [];
  for (let i = 0; i < n; i++) {
    waves.push({ k: [1, 2, 3, 5, 7, 11][i], a: rnd(), p: rnd() * Math.PI * 2 });
  }
  const sum = waves.reduce((s, w) => s + w.a / w.k, 0);
  return x => waves.reduce((s, w) => s + (w.a / w.k) * Math.sin((x / 256) * Math.PI * 2 * w.k + w.p), 0) / sum;
}

function drawBgMount(g, rnd) {
  const TH = 64;
  const far = ridge(rnd, 5);
  const near = ridge(rnd, 6);
  for (let x = 0; x < 256; x++) {
    const hf = Math.round(38 + far(x) * 18);
    R(g, x, TH - hf, 1, hf, '#1C2742');
    R(g, x, TH - hf, 1, 1, '#34466A');
    const hn = Math.round(20 + near(x) * 10);
    R(g, x, TH - hn, 1, hn, '#111A2C');
    // 近处山脊上的松树尖
    if (x % 5 === 0 && rnd() < 0.8) {
      const th = 3 + Math.floor(rnd() * 4);
      R(g, x, TH - hn - th, 1, th, '#111A2C');
      R(g, x - 1, TH - hn - Math.floor(th / 2), 3, Math.floor(th / 2), '#111A2C');
    }
  }
}

function drawBgSea(g, rnd) {
  const TH = 40;
  const isl = ridge(rnd, 4);
  for (let x = 0; x < 256; x++) {
    const v = isl(x);
    if (v > 0.1) {
      const h = Math.round((v - 0.1) * 40);
      R(g, x, TH - h, 1, h, '#141C36');
      R(g, x, TH - h, 1, 1, '#243056');
    }
  }
  // 灯塔
  R(g, 204, TH - 20, 3, 20, '#C8CCE0');
  for (let y = TH - 18; y < TH; y += 6) R(g, 204, y, 3, 3, '#C04048');
  R(g, 203, TH - 23, 5, 3, '#2A2A40');
  R(g, 204, TH - 22, 3, 1, '#FFF0A0');
  // 海平线上零星船灯
  R(g, 70, TH - 2, 2, 1, '#F5C842');
  R(g, 140, TH - 1, 1, 1, '#FF6B6B');
}

// ── 组装图集 ──────────────────────────────────────────────
// createCanvas(w, h) 由调用方提供(小程序里是 wx.createOffscreenCanvas)
function buildArt(createCanvas) {
  const canvas = createCanvas(ATLAS_W, ATLAS_H);
  const g = canvas.getContext('2d');
  const rects = {};
  let sx = 0;
  let sy = 0;
  let shelfH = 0;

  function add(name, w, h, fn, mirror) {
    if (sx + w > ATLAS_W) {
      sx = 0;
      sy += shelfH + PAD;
      shelfH = 0;
    }
    g.save();
    g.translate(sx, sy);
    if (mirror) {
      g.translate(w, 0);
      g.scale(-1, 1);
    }
    fn(g);
    g.restore();
    rects[name] = { x: sx, y: sy, w, h };
    sx += w + PAD;
    shelfH = Math.max(shelfH, h);
  }

  const rnd = makeRng(20260925);

  // 第一排:远景与高楼
  add('bgCity', 256, 80, gg => drawBgCity(gg, rnd));
  add('bgMount', 256, 64, gg => drawBgMount(gg, rnd));
  add('bgSea', 256, 40, gg => drawBgSea(gg, rnd));
  add('bld0', 56, 120, gg => drawBuilding(gg, 56, 120, rnd, 0));
  add('bld1', 44, 150, gg => drawBuilding(gg, 44, 150, rnd, 1));
  add('bld2', 70, 100, gg => drawBuilding(gg, 70, 100, rnd, 2));

  // 车辆
  [-1, 0, 1].forEach(l => add(`player_${l}`, PLAYER_META.w, PLAYER_META.h, gg => drawPlayer(gg, l)));
  CAR_PALETTES.forEach((c, i) => add(`car_sedan_${i}`, 40, 26, gg => drawSedan(gg, c)));
  CAR_PALETTES.forEach((c, i) => add(`car_sport_${i}`, 44, 22, gg => drawSport(gg, c)));
  TRUCK_PALETTES.forEach((c, i) => add(`car_truck_${i}`, 44, 38, gg => drawTruck(gg, c)));

  // 路边
  add('palm', 44, 66, gg => drawPalm(gg, rnd));
  add('pine', 30, 58, gg => drawPine(gg, 30, 58, 4));
  add('pine2', 24, 44, gg => drawPine(gg, 24, 44, 3));
  add('bb0', 64, 72, gg => drawBillboard(gg, 0));
  add('bb1', 64, 72, gg => drawBillboard(gg, 1));
  add('lampR', 22, 72, drawLamp);
  add('lampL', 22, 72, drawLamp, true);
  add('chevR', 22, 28, drawChevron);
  add('chevL', 22, 28, drawChevron, true);
  add('bush', 28, 14, gg => drawBush(gg, rnd));
  add('rock', 22, 14, drawRock);

  // 光晕(绘制时开平滑 + 叠加混合)
  const glows = {
    g_white: '255,244,220',
    g_orange: '255,170,70',
    g_red: '255,60,70',
    g_cyan: '90,220,255',
    g_magenta: '255,80,220',
    g_blue: '96,160,255',
    g_green: '120,255,140',
  };
  Object.keys(glows).forEach(k => add(k, 32, 32, gg => drawGlow(gg, glows[k])));

  return { canvas, rects };
}

module.exports = { buildArt, makeRng, CAR_TYPES, PLAYER_META, SPRITES };
