// ── 苍穹之翼 · 精灵图集 ──────────────────────────────────────
// 所有精灵都用矢量路径 + 渐变在启动时画进一张离屏图集(机体 3 倍分辨率,
// 手机上放大后依旧锐利),游戏里只做 drawImage。每个精灵的"虚拟尺寸" = 图集尺寸 / s。
// 统一的美术规则:左上方来光;机体先画一圈深色描边再画本体(任何背景上轮廓都清楚);
// 本体画完再叠一层左上亮、右下暗的体积光。
// 另外为敌人生成两种变体:
//   <name>_w  受击闪白(纯白剪影)
//   <name>_s  投影(柔边黑色剪影,运行时低透明度画在地面上)

const ART = 3;

// ── 小工具 ──
function path(g, pts, close) {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  if (close !== false) g.closePath();
}

function lin(g, x0, y0, x1, y1, stops) {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  stops.forEach(([o, c]) => gr.addColorStop(o, c));
  return gr;
}

function rad(g, x, y, r0, r1, stops, fx, fy) {
  const gr = g.createRadialGradient(fx === undefined ? x : fx, fy === undefined ? y : fy, r0, x, y, r1);
  stops.forEach(([o, c]) => gr.addColorStop(o, c));
  return gr;
}

function fillPath(g, pts, style) {
  path(g, pts);
  g.fillStyle = style;
  g.fill();
}

function ellipse(g, x, y, rx, ry, style, rot) {
  g.beginPath();
  g.ellipse(x, y, rx, ry, rot || 0, 0, Math.PI * 2);
  g.fillStyle = style;
  g.fill();
}

function circle(g, x, y, r, style) {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = style;
  g.fill();
}

function ring(g, x, y, r, color, w) {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.strokeStyle = color;
  g.lineWidth = w;
  g.stroke();
}

function line(g, pts, color, w) {
  path(g, pts, false);
  g.strokeStyle = color;
  g.lineWidth = w;
  g.lineCap = 'round';
  g.stroke();
}

function rect(g, x, y, w, h, style) {
  g.fillStyle = style;
  g.fillRect(x, y, w, h);
}

// 左右对称:pts 只写右半边(x>0),自动镜像出左半边
function mirror(pts) {
  return pts.concat(pts.slice().reverse().map(([x, y]) => [-x, y]));
}

function clip(g, pts, fn) {
  g.save();
  path(g, pts);
  g.clip();
  fn();
  g.restore();
}

function makeRng(seed) {
  let s = seed | 0;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

// 迷彩斑块(调用方先 clip 到机体范围)
function camo(g, rng, x0, y0, x1, y1, n, colors, r0, r1) {
  for (let i = 0; i < n; i++) {
    const x = x0 + rng() * (x1 - x0);
    const y = y0 + rng() * (y1 - y0);
    const r = r0 + rng() * (r1 - r0);
    ellipse(g, x, y, r, r * (0.5 + rng() * 0.4), colors[i % colors.length], rng() * Math.PI);
  }
}

// 机械细节:随机的小面板,亮边在左上、暗边在右下
function greebles(g, rng, x0, y0, x1, y1, n, base) {
  for (let i = 0; i < n; i++) {
    const w = 2 + rng() * 6;
    const h = 1.5 + rng() * 5;
    const x = x0 + rng() * (x1 - x0 - w);
    const y = y0 + rng() * (y1 - y0 - h);
    rect(g, x, y, w, h, base || 'rgba(0,0,0,0.16)');
    rect(g, x, y, w, 0.45, 'rgba(255,255,255,0.22)');
    rect(g, x, y + h - 0.45, w, 0.45, 'rgba(0,0,0,0.28)');
  }
}

// 座舱玻璃:深色框 + 渐变玻璃 + 高光
function canopy(g, x, y, rx, ry, tint, flip) {
  ellipse(g, x, y, rx + 0.75, ry + 0.75, '#141820');
  const y0 = flip ? y + ry : y - ry;
  const y1 = flip ? y - ry : y + ry;
  ellipse(g, x, y, rx, ry, lin(g, x, y0, x, y1, tint));
  ellipse(g, x - rx * 0.32, y + (flip ? 1 : -1) * ry * 0.3, rx * 0.26, ry * 0.42, 'rgba(255,255,255,0.75)');
  line(g, [[x - rx * 0.9, y + (flip ? -1 : 1) * ry * 0.25], [x + rx * 0.9, y + (flip ? -1 : 1) * ry * 0.25]], 'rgba(20,24,32,0.8)', 0.5);
}

// 喷口:金属环 + 内腔
function nozzle(g, x, y, r, hot) {
  circle(g, x, y, r, rad(g, x, y, 0, r, [[0, '#14161C'], [0.62, '#3A3F4A'], [0.82, '#8A909C'], [1, '#2A2E36']], x - r * 0.3, y - r * 0.3));
  circle(g, x, y, r * 0.55, rad(g, x, y, 0, r * 0.55, [[0, hot || '#FFD6A0'], [0.5, hot ? hot : '#FF8A3C'], [1, '#2A1408']]));
}

const UI_ORANGE = '#E5784C';
const UI_ORANGE_D = '#9E3E1E';

// ── 主角战机(机头朝上)── bank: -2..2 侧倾
function drawPlayer(g, bank) {
  const k = 1 - Math.abs(bank) * 0.12;
  g.save();
  g.scale(k, 1);
  const wingPts = side => [[side * 4.6, -9], [side * 13, 1.2], [side * 24.4, 10.6], [side * 25, 16.4], [side * 16, 17], [side * 5, 15.2]];
  [-1, 1].forEach(side => {
    const dip = side * bank;
    // 平尾
    const stab = [[side * 4.2, 15.6], [side * 12.6, 21.4], [side * 12.9, 24.8], [side * 4.2, 22.8]];
    fillPath(g, stab, lin(g, side * 4, 16, side * 13, 25, [[0, '#E8EDF4'], [1, '#7D8AA0']]));
    fillPath(g, [[side * 10, 19.6], [side * 12.6, 21.4], [side * 12.9, 24.8], [side * 10, 23.8]], UI_ORANGE);
    line(g, [[side * 4.2, 15.6], [side * 12.6, 21.4]], 'rgba(255,255,255,0.8)', 0.4);
    // 主翼
    const wing = wingPts(side);
    fillPath(g, wing, lin(g, side * 4, -6, side * 22, 18, [[0, '#FAFCFF'], [0.5, '#CDD5E1'], [1, '#8794A8']]));
    clip(g, wing, () => {
      // 襟副翼(后缘深色带)
      fillPath(g, [[side * 4, 12.8], [side * 26, 14.4], [side * 26, 20], [side * 4, 20]], 'rgba(56,68,90,0.32)');
      line(g, [[side * 5, 12.9], [side * 25, 14.5]], 'rgba(40,50,70,0.55)', 0.35);
      line(g, [[side * 15, 13.7], [side * 15, 18]], 'rgba(40,50,70,0.55)', 0.35);
      // 面板线 + 铆钉
      line(g, [[side * 8.2, -4], [side * 8.6, 13]], 'rgba(48,60,82,0.35)', 0.32);
      line(g, [[side * 12.4, 0.6], [side * 12.4, 13.4]], 'rgba(48,60,82,0.35)', 0.32);
      line(g, [[side * 5, 5.6], [side * 20, 9.6]], 'rgba(48,60,82,0.3)', 0.32);
      for (let i = 0; i < 6; i++) circle(g, side * (6 + i * 2.6), 7.2 + i * 0.75, 0.22, 'rgba(40,50,70,0.5)');
      // 前缘橙色条
      fillPath(g, [[side * 13.4, 2.4], [side * 24.6, 11.5], [side * 24.8, 13.4], [side * 12.6, 4.6]], UI_ORANGE);
      line(g, [[side * 12.6, 4.6], [side * 24.8, 13.4]], UI_ORANGE_D, 0.35);
      // 侧倾时压下去的一侧变暗
      if (dip > 0) fillPath(g, wing, `rgba(10,20,40,${0.18 * dip})`);
      else if (dip < 0) fillPath(g, wing, `rgba(255,255,255,${0.1 * -dip})`);
    });
    line(g, [[side * 4.6, -9], [side * 13, 1.2], [side * 24.4, 10.6]], 'rgba(255,255,255,0.95)', 0.55);
    // 机徽
    circle(g, side * 16.2, 11.6, 2.5, '#1C3456');
    circle(g, side * 16.2, 11.6, 1.75, '#F4F7FB');
    circle(g, side * 16.2, 11.6, 0.9, UI_ORANGE);
    // 翼下挂架 + 副油箱
    ellipse(g, side * 10.4, 8, 1.5, 5.4, lin(g, side * 9, 0, side * 12, 0, [[0, '#E6EBF2'], [1, '#7E8A9E']]));
    line(g, [[side * 10.4, 3], [side * 10.4, 13]], 'rgba(40,50,70,0.4)', 0.3);
    // 翼尖导弹
    fillPath(g, [[side * 24.4, 5], [side * 25.8, 5], [side * 25.8, 17.4], [side * 24.4, 17.4]], '#3E4656');
    fillPath(g, [[side * 24.5, 3.2], [side * 25.1, 1.4], [side * 25.7, 3.2], [side * 25.7, 13], [side * 24.5, 13]], lin(g, side * 24.4, 0, side * 25.8, 0, [[0, '#FFFFFF'], [1, '#A6AEBC']]));
    fillPath(g, [[side * 24.5, 3.2], [side * 25.1, 1.4], [side * 25.7, 3.2]], '#E04A3A');
    // 鸭翼
    const can = [[side * 4.8, -15.8], [side * 11.2, -10.6], [side * 11.2, -9], [side * 4.8, -10.6]];
    fillPath(g, can, lin(g, side * 5, -15, side * 11, -9, [[0, '#F2F5FA'], [1, '#8C98AA']]));
    line(g, [[side * 4.8, -15.8], [side * 11.2, -10.6]], 'rgba(255,255,255,0.9)', 0.4);
    // 双垂尾(俯视是两片外倾的薄翼)
    fillPath(g, [[side * 4.4, 11.5], [side * 7.6, 20.6], [side * 8.2, 23.6], [side * 6.4, 23.6], [side * 3.9, 15]], lin(g, side * 4, 0, side * 8, 0, [[0, '#59657A'], [0.6, '#C7D0DC'], [1, '#ECF0F6']]));
    fillPath(g, [[side * 7.2, 19.4], [side * 7.6, 20.6], [side * 8.2, 23.6], [side * 7, 23.6]], UI_ORANGE);
  });
  // 机身
  const body = [[0, -27.5], [1.6, -25.4], [3.6, -19.5], [4.8, -12], [5.6, -4], [5.6, 6], [5.4, 18.5], [4.2, 24.6], [-4.2, 24.6], [-5.4, 18.5], [-5.6, 6], [-5.6, -4], [-4.8, -12], [-3.6, -19.5], [-1.6, -25.4]];
  fillPath(g, body, lin(g, -6, 0, 6, 0, [[0, '#57647A'], [0.2, '#C9D1DD'], [0.38, '#FFFFFF'], [0.62, '#C6CFDB'], [1, '#56627A']]));
  clip(g, body, () => {
    // 雷达罩
    fillPath(g, [[-6, -30], [6, -30], [6, -21.6], [-6, -21.6]], lin(g, -4, 0, 4, 0, [[0, '#2E3442'], [0.4, '#6A7486'], [1, '#262B36']]));
    line(g, [[-6, -21.6], [6, -21.6]], 'rgba(255,255,255,0.45)', 0.35);
    // 机脊深色面板
    fillPath(g, [[-1.5, -3], [1.5, -3], [2, 19], [-2, 19]], 'rgba(60,72,92,0.35)');
    // 横向面板线
    [-17, -4, 2.5, 10, 17].forEach(y => line(g, [[-6, y], [6, y]], 'rgba(44,54,74,0.4)', 0.32));
    // 橙色识别带
    fillPath(g, [[-6, 3.6], [6, 3.6], [6, 6.2], [-6, 6.2]], UI_ORANGE);
    fillPath(g, [[-6, 6.2], [6, 6.2], [6, 6.7], [-6, 6.7]], UI_ORANGE_D);
    // 机头箭头涂装
    fillPath(g, [[0, -20.4], [3.6, -17.4], [3.6, -16.2], [0, -19], [-3.6, -16.2], [-3.6, -17.4]], UI_ORANGE);
    for (let i = 0; i < 5; i++) circle(g, -2.6, -2 + i * 4, 0.22, 'rgba(40,50,70,0.5)');
    for (let i = 0; i < 5; i++) circle(g, 2.6, -2 + i * 4, 0.22, 'rgba(40,50,70,0.5)');
  });
  // 进气道
  [-1, 1].forEach(side => {
    fillPath(g, [[side * 5.2, -4.4], [side * 7.6, -2], [side * 7.6, 9.4], [side * 5.4, 10.6]], lin(g, side * 5, 0, side * 7.8, 0, [[0, '#A9B3C2'], [1, '#5A6578']]));
    fillPath(g, [[side * 5.5, -3.6], [side * 7.1, -2], [side * 7.1, -0.6], [side * 5.5, -1.8]], '#14181F');
    line(g, [[side * 5.2, -4.4], [side * 7.6, -2]], 'rgba(255,255,255,0.8)', 0.4);
  });
  // 座舱
  canopy(g, 0, -11.2, 2.7, 6.8, [[0, '#E4FDFF'], [0.3, '#62C4EA'], [0.75, '#16507A'], [1, '#0A2238']]);
  // 双发喷口
  [-1, 1].forEach(side => nozzle(g, side * 2.3, 23.6, 2.15));
  g.restore();
}

// ── 敌机通用调色 ──
const OLIVE = ['#3C4A2A', '#6E7E4C', '#A2B07A'];

// ── 敌机:小型战斗机(机头朝下)──
function drawDart(g) {
  const rng = makeRng(21);
  [-1, 1].forEach(side => {
    // 后掠翼
    const wing = [[side * 3, 8], [side * 15.4, -1.4], [side * 15.6, -5.2], [side * 12, -5], [side * 3, -3.2]];
    fillPath(g, wing, lin(g, side * 3, -4, side * 15, 4, [[0, '#8C9C64'], [1, '#4A5832']]));
    clip(g, wing, () => {
      camo(g, rng, side > 0 ? 3 : -16, -6, side > 0 ? 16 : -3, 8, 6, ['rgba(40,52,26,0.55)', 'rgba(150,160,110,0.35)'], 1.6, 3.4);
      line(g, [[side * 4, -3], [side * 15.5, -5]], 'rgba(30,36,20,0.6)', 0.35);
      fillPath(g, [[side * 12.4, -0.4], [side * 15.6, -2], [side * 15.6, -5.4], [side * 12.4, -4.6]], '#B8322A');
      fillPath(g, [[side * 12.4, -0.4], [side * 15.6, -2], [side * 15.6, -2.6], [side * 12.4, -1]], '#E8E0C8');
    });
    line(g, [[side * 3, 8], [side * 15.4, -1.4]], 'rgba(220,230,190,0.7)', 0.45);
    // 机徽(虚构):红环白芯
    circle(g, side * 9, 0.4, 1.9, '#E8E0C8');
    circle(g, side * 9, 0.4, 1.3, '#B8322A');
    // 平尾
    const tail = [[side * 2.4, -9], [side * 8.6, -15], [side * 8.4, -16.8], [side * 2, -14.4]];
    fillPath(g, tail, lin(g, side * 2, -12, side * 8.6, -16, [[0, '#7A8A54'], [1, '#3E4A2A']]));
  });
  // 机身
  const body = [[0, 16.5], [1.6, 13.6], [3.2, 7], [3.8, -2], [3.6, -10], [2.8, -15.4], [-2.8, -15.4], [-3.6, -10], [-3.8, -2], [-3.2, 7], [-1.6, 13.6]];
  fillPath(g, body, lin(g, -4, 0, 4, 0, [[0, '#2E3820'], [0.3, '#9AAA70'], [0.55, '#76865A'], [1, '#262E18']]));
  clip(g, body, () => {
    fillPath(g, [[-4, 11], [4, 11], [4, 18], [-4, 18]], '#2A3020');
    line(g, [[-4, 11], [4, 11]], 'rgba(220,230,190,0.5)', 0.3);
    [-6, 0].forEach(y => line(g, [[-4, y], [4, y]], 'rgba(30,36,20,0.55)', 0.3));
    line(g, [[0, -14], [0, 2]], 'rgba(30,36,20,0.4)', 0.3);
  });
  // 进气口
  [-1, 1].forEach(side => fillPath(g, [[side * 3.6, 0.4], [side * 5, -1], [side * 5, -6], [side * 3.6, -6.4]], lin(g, side * 3.6, 0, side * 5, 0, [[0, '#56643C'], [1, '#22281A']])));
  canopy(g, 0, 5.4, 1.8, 3.8, [[0, '#FFE2B8'], [0.35, '#E07A3E'], [1, '#3A160A']], true);
  nozzle(g, 0, -15.2, 1.9);
}

// ── 小型无人机(机头朝下):红灰涂装的三角翼 + 发光"眼睛" ──
function drawDrone(g) {
  const wing = [[0, 12.4], [12.6, -4.4], [13, -7.6], [7, -6.4], [0, -9], [-7, -6.4], [-13, -7.6], [-12.6, -4.4]];
  fillPath(g, wing, lin(g, -13, -8, 13, 12, [[0, '#B4BAC6'], [0.5, '#6A7080'], [1, '#2C303A']]));
  clip(g, wing, () => {
    [-1, 1].forEach(side => {
      fillPath(g, [[side * 9.6, -1.6], [side * 13.4, -4.6], [side * 13.4, -8], [side * 9.6, -6]], '#C8302A');
      line(g, [[side * 2.4, 6], [side * 10.4, -4.4]], 'rgba(20,24,32,0.55)', 0.35);
    });
    fillPath(g, [[-14, -9], [14, -9], [14, -6.6], [-14, -6.6]], 'rgba(20,24,32,0.35)');
  });
  line(g, [[-12.6, -4.4], [0, 12.4], [12.6, -4.4]], 'rgba(255,255,255,0.55)', 0.4);
  // 机身吊舱
  ellipse(g, 0, 1, 3.4, 8, lin(g, -3.4, 0, 3.4, 0, [[0, '#2A2E38'], [0.4, '#9AA0AE'], [1, '#22262E']]));
  nozzle(g, 0, -7.6, 1.8);
  // 发光的眼
  circle(g, 0, 6.4, 2.4, '#14080A');
  circle(g, 0, 6.4, 1.7, rad(g, 0, 6.4, 0, 1.7, [[0, '#FFFFFF'], [0.35, '#FF6A5A'], [1, '#A0140C']]));
}

// ── 武装直升机(机头朝下;主旋翼运行时画)──
function drawGunship(g) {
  const rng = makeRng(33);
  // 尾梁 + 尾桨
  const boom = [[-1.9, -4], [1.9, -4], [1.3, -24], [-1.3, -24]];
  fillPath(g, boom, lin(g, -2, 0, 2, 0, [[0, '#2C3628'], [0.45, '#7C8A68'], [1, '#222A1E']]));
  for (let y = -8; y > -23; y -= 3.4) line(g, [[-1.6, y], [1.6, y]], 'rgba(20,26,16,0.5)', 0.3);
  fillPath(g, [[-7.4, -22.6], [7.4, -22.6], [6.6, -19.8], [-6.6, -19.8]], lin(g, 0, -23, 0, -19.6, [[0, '#7C8A68'], [1, '#3A4436']]));
  fillPath(g, [[-0.9, -26], [0.9, -26], [0.9, -19], [-0.9, -19]], '#2A3226');
  ellipse(g, 3.4, -23.4, 1.1, 4.4, 'rgba(210,220,210,0.45)');
  line(g, [[3.4, -27.4], [3.4, -19.4]], 'rgba(30,34,30,0.7)', 0.5);
  // 短翼 + 火箭巢
  fillPath(g, [[-17, -0.4], [17, -0.4], [16, 3.8], [-16, 3.8]], lin(g, 0, -0.4, 0, 3.8, [[0, '#7A8868'], [1, '#3E4838']]));
  [-1, 1].forEach(side => {
    ellipse(g, side * 15.6, 2.4, 2.9, 6.6, lin(g, side * 12.6, 0, side * 18.6, 0, [[0, '#46523C'], [0.45, '#A6B090'], [1, '#2E3626']]));
    for (let i = 0; i < 3; i++) circle(g, side * (14.6 + (i % 2) * 2), 7 + Math.floor(i / 2) * -1.4, 0.7, '#14160F');
    circle(g, side * 15.6, 8.4, 0.75, '#C8402E');
    // 机炮
    fillPath(g, [[side * 9.2, 3.8], [side * 10.4, 3.8], [side * 10.4, 10], [side * 9.2, 10]], '#22261E');
  });
  // 机舱
  const hull = [[0, 18.4], [5, 16], [8.4, 9], [9.6, 0], [8.4, -7], [4.8, -11], [-4.8, -11], [-8.4, -7], [-9.6, 0], [-8.4, 9], [-5, 16]];
  fillPath(g, hull, lin(g, -10, 0, 10, 0, [[0, '#2C3828'], [0.3, '#8A9A74'], [0.6, '#5E6E4E'], [1, '#202A1C']]));
  clip(g, hull, () => {
    camo(g, rng, -10, -11, 10, 18, 9, ['rgba(36,46,28,0.55)', 'rgba(140,150,110,0.3)'], 2, 4.2);
    line(g, [[-10, -3], [10, -3]], 'rgba(20,26,16,0.55)', 0.35);
    greebles(g, rng, -6, -10, 6, -4, 4, 'rgba(0,0,0,0.18)');
    // 排气口
    [-1, 1].forEach(side => {
      fillPath(g, [[side * 3, -9.6], [side * 6, -9.6], [side * 6, -5.4], [side * 3, -5.4]], '#1A1E16');
      fillPath(g, [[side * 3.4, -9.2], [side * 5.6, -9.2], [side * 5.6, -8.2], [side * 3.4, -8.2]], 'rgba(255,140,60,0.7)');
    });
  });
  // 串列双座舱
  canopy(g, 0, 7.6, 4.4, 3.2, [[0, '#D6F2F8'], [0.45, '#3E7E9A'], [1, '#0E2434']], true);
  canopy(g, 0, 13.4, 3.4, 2.8, [[0, '#D6F2F8'], [0.45, '#3E7E9A'], [1, '#0E2434']], true);
  fillPath(g, [[-1, 18], [1, 18], [0.8, 21.6], [-0.8, 21.6]], '#1A1E16');
  circle(g, 0, 0, 2.8, '#1C2218');
  circle(g, 0, 0, 1.4, '#5A6450');
}

// ── 轰炸机 ──
function drawBomber(g) {
  const rng = makeRng(47);
  const STEEL = [[0, '#5A6272'], [0.4, '#B4BCCA'], [1, '#4A5262']];
  // 平尾
  const stab = mirror([[2, -18], [15, -22], [15.4, -19.4], [12.6, -16.4], [2, -15]]);
  fillPath(g, stab, lin(g, -15, 0, 15, 0, STEEL));
  [-1, 1].forEach(side => fillPath(g, [[side * 12.6, -21.2], [side * 15, -22], [side * 15.4, -19.4], [side * 12.6, -18.2]], '#B8322A'));
  // 主翼
  const wing = mirror([[4, -4], [33.6, -1.6], [34.2, 3], [31, 8.4], [4, 8]]);
  fillPath(g, wing, lin(g, 0, -4, 0, 8.4, [[0, '#C4CAD6'], [1, '#6A7282']]));
  clip(g, wing, () => {
    fillPath(g, wing, lin(g, -34, 0, 34, 0, [[0, 'rgba(0,0,0,0.22)'], [0.45, 'rgba(255,255,255,0.08)'], [1, 'rgba(0,0,0,0.28)']]));
    camo(g, rng, -34, -4, 34, 8, 12, ['rgba(60,68,84,0.4)', 'rgba(200,206,216,0.25)'], 2.4, 5);
    line(g, [[-34, 5.4], [34, 5.4]], 'rgba(30,34,44,0.5)', 0.4);
    for (let x = -30; x <= 30; x += 6) line(g, [[x, -3], [x, 5.4]], 'rgba(30,34,44,0.3)', 0.3);
    [-1, 1].forEach(side => {
      fillPath(g, [[side * 26.4, -4], [side * 35, -4], [side * 35, 9], [side * 26.4, 9]], '#D8B040');
      fillPath(g, [[side * 28.6, -4], [side * 30.2, -4], [side * 30.2, 9], [side * 28.6, 9]], '#2A2418');
    });
  });
  line(g, [[-33.6, -1.6], [-4, -4]], 'rgba(255,255,255,0.6)', 0.45);
  line(g, [[33.6, -1.6], [4, -4]], 'rgba(255,255,255,0.6)', 0.45);
  [-1, 1].forEach(side => {
    circle(g, side * 20, 2.6, 3.6, '#E8E0D0');
    circle(g, side * 20, 2.6, 2.4, '#B8322A');
    circle(g, side * 20, 2.6, 0.9, '#E8E0D0');
    // 发动机短舱
    {
      const ex = side * 12;
      ellipse(g, ex, 3.4, 4.2, 11.4, lin(g, ex - 4, 0, ex + 4, 0, [[0, '#2E3440'], [0.4, '#9AA2B2'], [1, '#262A34']]));
      fillPath(g, [[ex - 3.2, 9], [ex + 3.2, 9], [ex + 3.2, 10.2], [ex - 3.2, 10.2]], '#1A1E26');
      circle(g, ex, 14, 2.6, rad(g, ex, 14, 0, 2.6, [[0, '#0A0C10'], [0.7, '#3A404C'], [1, '#8A90A0']]));
      nozzle(g, ex, -7.8, 2.2);
      line(g, [[ex, -6], [ex, 9]], 'rgba(255,255,255,0.35)', 0.35);
    }
  });
  // 机身
  const body = [[0, 27.4], [3.4, 24], [5.4, 14], [5.8, -6], [4.8, -22], [2.4, -26.4], [-2.4, -26.4], [-4.8, -22], [-5.8, -6], [-5.4, 14], [-3.4, 24]];
  fillPath(g, body, lin(g, -6, 0, 6, 0, [[0, '#444A58'], [0.32, '#D2D8E2'], [0.6, '#9AA2B0'], [1, '#3C4250']]));
  clip(g, body, () => {
    [-18, -10, -2, 6, 14].forEach(y => line(g, [[-6, y], [6, y]], 'rgba(30,34,44,0.42)', 0.32));
    fillPath(g, [[-1.4, -16], [1.4, -16], [1.4, 4], [-1.4, 4]], 'rgba(30,34,44,0.28)');
    // 弹舱门
    line(g, [[0, -4], [0, 4]], 'rgba(20,24,32,0.7)', 0.4);
    fillPath(g, [[-6, -26], [6, -26], [6, -22], [-6, -22]], '#B8322A');
  });
  // 玻璃机鼻 + 尾炮塔
  canopy(g, 0, 20.4, 3.2, 5, [[0, '#D8F6FF'], [0.45, '#4A8AA8'], [1, '#12283A']], true);
  for (let i = -2; i <= 2; i++) line(g, [[i * 1.2, 17], [i * 0.8, 24.4]], 'rgba(20,30,40,0.55)', 0.25);
  circle(g, 0, -24, 2.2, '#2A2E36');
  circle(g, 0, -24, 1.2, '#C8402E');
}

// ── 精英:重型巡航舰(飞翼)──
function drawCruiser(g) {
  const rng = makeRng(59);
  const hull = [[0, 40], [52, -8], [54.4, -18], [34, -24.4], [14, -14.4], [0, -30.4], [-14, -14.4], [-34, -24.4], [-54.4, -18], [-52, -8]];
  fillPath(g, hull, lin(g, -54, 0, 54, 0, [[0, '#24202E'], [0.3, '#6E6690'], [0.52, '#4E4868'], [1, '#1E1A26']]));
  clip(g, hull, () => {
    fillPath(g, hull, lin(g, 0, -30, 0, 40, [[0, 'rgba(0,0,0,0.3)'], [0.5, 'rgba(255,255,255,0.06)'], [1, 'rgba(0,0,0,0.25)']]));
    greebles(g, rng, -46, -20, 46, 12, 40, 'rgba(10,8,20,0.22)');
    [-1, 1].forEach(side => {
      // 装甲接缝
      line(g, [[side * 8, 26], [side * 46, -10]], 'rgba(8,6,16,0.7)', 0.7);
      line(g, [[side * 18, -8], [side * 40, -16]], 'rgba(8,6,16,0.7)', 0.7);
      line(g, [[side * 9, 25.4], [side * 47, -9.4]], 'rgba(180,170,220,0.25)', 0.4);
      // 发光散热口
      for (let i = 0; i < 4; i++) {
        const pts = [[side * (22 + i * 6), -4 - i * 3], [side * (26.4 + i * 6), -6 - i * 3], [side * (26.4 + i * 6), -4.4 - i * 3], [side * (22 + i * 6), -2.4 - i * 3]];
        fillPath(g, pts, '#2A0E06');
        fillPath(g, pts.map(([x, y]) => [x, y + 0.3]), lin(g, side * 22, 0, side * 46, 0, [[0, '#FFD28A'], [1, '#FF6A2A']]));
      }
      // 翼尖识别灯带
      fillPath(g, [[side * 50, -12], [side * 54.4, -18], [side * 53, -14], [side * 51, -9]], '#FF8A3C');
    });
  });
  line(g, [[-52, -8], [0, 40], [52, -8]], 'rgba(200,190,240,0.35)', 0.6);
  [-1, 1].forEach(side => {
    // 引擎舱
    ellipse(g, side * 22, -20, 5.4, 7.6, lin(g, side * 16.6, 0, side * 27.4, 0, [[0, '#1E1A28'], [0.45, '#6A6484'], [1, '#16131E']]));
    nozzle(g, side * 22, -26.2, 3.2, '#BFEFFF');
    // 副炮
    circle(g, side * 30, 4, 4, lin(g, side * 26, 0, side * 34, 8, [[0, '#8A82A4'], [1, '#2A2636']]));
    fillPath(g, [[side * 29.3, 6], [side * 30.7, 6], [side * 30.7, 12], [side * 29.3, 12]], '#16131E');
  });
  // 中央炮塔座
  circle(g, 0, 6, 11.4, '#14111C');
  circle(g, 0, 6, 10.6, lin(g, -11, -5, 11, 17, [[0, '#9A92B4'], [0.5, '#4A4462'], [1, '#221E2E']]));
  ring(g, 0, 6, 8.2, 'rgba(10,8,20,0.6)', 0.5);
  circle(g, 0, 6, 6, '#120F18');
  circle(g, 0, 6, 3.6, rad(g, 0, 6, 0, 3.6, [[0, '#FFE6C8'], [0.45, '#FF6A3C'], [1, '#7A1608']]));
  // 驾驶舱
  canopy(g, 0, 28, 3.2, 6, [[0, '#EAD6FF'], [0.45, '#7A4AC8'], [1, '#1A0C30']], true);
}

// ── 炮艇(机头朝下)──
function drawBoat(g) {
  const hull = [[0, 30.4], [6.4, 22], [9.4, 12], [10, -20], [8.4, -28], [-8.4, -28], [-10, -20], [-9.4, 12], [-6.4, 22]];
  fillPath(g, hull, lin(g, -10, 0, 10, 0, [[0, '#3E444E'], [0.35, '#B0B6C0'], [1, '#30363E']]));
  // 甲板
  const deck = [[0, 25.4], [5.4, 18], [7, 10], [7.4, -20], [6.4, -25], [-6.4, -25], [-7.4, -20], [-7, 10], [-5.4, 18]];
  fillPath(g, deck, lin(g, -7, 0, 7, 0, [[0, '#6E747E'], [0.45, '#C8CCD4'], [1, '#5E646C']]));
  clip(g, deck, () => {
    for (let y = -22; y < 24; y += 3) line(g, [[-8, y], [8, y]], 'rgba(40,44,52,0.18)', 0.3);
    fillPath(g, [[-8, 14], [8, 14], [8, 15.2], [-8, 15.2]], '#C8A030');
  });
  line(g, [[0, 30.4], [6.4, 22], [9.4, 12], [10, -20]], 'rgba(255,255,255,0.4)', 0.4);
  // 舰桥(两层)
  fillPath(g, [[-5.4, -2], [5.4, -2], [5.4, -14], [-5.4, -14]], lin(g, -5, 0, 5, 0, [[0, '#4E545E'], [0.45, '#E4E8EE'], [1, '#40464E']]));
  fillPath(g, [[-3.8, -5], [3.8, -5], [3.8, -11], [-3.8, -11]], lin(g, -4, 0, 4, 0, [[0, '#6E747E'], [0.45, '#F4F6FA'], [1, '#5A6068']]));
  fillPath(g, [[-4.4, -2.6], [4.4, -2.6], [4.4, -4], [-4.4, -4]], '#1E3448');
  // 雷达桅杆
  line(g, [[0, -14], [0, -21]], '#2A3038', 0.8);
  line(g, [[-2.6, -18.6], [2.6, -18.6]], '#2A3038', 0.6);
  circle(g, 0, -21, 1.2, '#E04A3A');
  // 救生艇
  [-1, 1].forEach(side => ellipse(g, side * 6.2, -18, 1, 3, '#E07A3E'));
}

// 船尾浪花(V 形,画在船下面)
function drawWake(g) {
  [-1, 1].forEach(side => {
    fillPath(g, [[side * 4, -18], [side * 10, -18], [side * 22, 22], [side * 15, 22]], lin(g, 0, -18, 0, 22, [[0, 'rgba(255,255,255,0.75)'], [1, 'rgba(255,255,255,0)']]));
  });
  ellipse(g, 0, -14, 7, 6, 'rgba(255,255,255,0.6)');
  ellipse(g, 0, 4, 5, 18, lin(g, 0, -12, 0, 22, [[0, 'rgba(220,250,255,0.55)'], [1, 'rgba(220,250,255,0)']]));
}

// ── 坦克车身(炮塔另画)──
function drawTankBody(g) {
  [-1, 1].forEach(side => {
    fillPath(g, [[side * 8, -17.4], [side * 14, -17.4], [side * 14, 17.4], [side * 8, 17.4]], '#1E1E1A');
    for (let y = -16.4; y < 17; y += 2.4) {
      rect(g, side > 0 ? 8.4 : -13.6, y, 5.2, 1.2, '#4A4A40');
      rect(g, side > 0 ? 8.4 : -13.6, y, 5.2, 0.4, 'rgba(200,200,180,0.45)');
    }
  });
  const hull = [[-9.4, -14.4], [9.4, -14.4], [10, -10], [10, 13], [8.4, 15.6], [-8.4, 15.6], [-10, 13], [-10, -10]];
  fillPath(g, hull, lin(g, -10, -14, 10, 15, [[0, '#C0B47A'], [0.45, '#8E8450'], [1, '#4E4628']]));
  clip(g, hull, () => {
    fillPath(g, [[-10, 9.6], [10, 9.6], [10, 16], [-10, 16]], 'rgba(40,36,20,0.4)');
    line(g, [[-10, -10], [10, -10]], 'rgba(40,36,20,0.5)', 0.35);
    // 引擎格栅
    for (let x = -6; x <= 6; x += 2) line(g, [[x, 10.6], [x, 14.4]], 'rgba(20,18,10,0.6)', 0.4);
    // 工具箱 / 油桶
    rect(g, -9, -13, 3.4, 2.4, '#5E5634');
    rect(g, 5.6, -13, 3.4, 2.4, '#5E5634');
    circle(g, -7, 7, 1.4, '#3E3A22');
    circle(g, 7, 7, 1.4, '#3E3A22');
  });
  line(g, [[-9.4, -14.4], [9.4, -14.4]], 'rgba(255,255,220,0.55)', 0.5);
}

// 炮塔头(双管,炮口朝下)
function drawTurretHead(g, twin, color) {
  const c = color || ['#5A606E', '#D4DAE4', '#363C48'];
  [-1, 1].forEach(side => {
    if (!twin && side > 0) return;
    const x = twin ? side * 2.6 : 0;
    fillPath(g, [[x - 1.4, 2], [x + 1.4, 2], [x + 1.4, 15], [x - 1.4, 15]], lin(g, x - 1.5, 0, x + 1.5, 0, [[0, '#22262E'], [0.45, '#A6ACB6'], [1, '#1C2026']]));
    fillPath(g, [[x - 1.9, 12.6], [x + 1.9, 12.6], [x + 1.9, 15.6], [x - 1.9, 15.6]], '#14161A');
    circle(g, x, 15.4, 0.7, '#050608');
  });
  // 炮塔:八角形装甲
  const oct = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    oct.push([Math.cos(a) * 7.8, Math.sin(a) * 7.8]);
  }
  fillPath(g, oct, rad(g, 0, 0, 0.5, 8, [[0, c[1]], [0.55, c[0]], [1, c[2]]], -2.6, -2.8));
  path(g, oct);
  g.strokeStyle = 'rgba(14,16,22,0.7)';
  g.lineWidth = 0.6;
  g.stroke();
  circle(g, 0, -1.4, 3, 'rgba(20,24,32,0.35)');
  circle(g, -0.4, -1.8, 2.2, lin(g, -2, -4, 2, 0, [[0, '#E4E8EE'], [1, '#5A606A']]));
  circle(g, -3.6, -3.4, 1, 'rgba(255,255,255,0.5)');
}

function drawTankHead(g) {
  fillPath(g, [[-1.5, 3], [1.5, 3], [1.5, 16], [-1.5, 16]], lin(g, -1.5, 0, 1.5, 0, [[0, '#2A2818'], [0.45, '#9A9466'], [1, '#22201A']]));
  fillPath(g, [[-2, 14], [2, 14], [2, 16.6], [-2, 16.6]], '#1A1810');
  const head = [[-6.4, -5], [-3.6, -7.4], [3.6, -7.4], [6.4, -5], [7, 3], [4, 6.4], [-4, 6.4], [-7, 3]];
  fillPath(g, head, lin(g, -7, -7, 7, 6, [[0, '#D0C68E'], [0.5, '#8A8250'], [1, '#423C22']]));
  circle(g, -2, -2, 2.2, '#5E5634');
  circle(g, -2.3, -2.4, 1.5, lin(g, -3.6, -3.8, -0.8, -0.8, [[0, '#C8BE86'], [1, '#4A4428']]));
  rect(g, 2, -4, 3, 2, '#3E3A22');
  line(g, [[-6.4, -5], [-3.6, -7.4], [3.6, -7.4]], 'rgba(255,255,230,0.55)', 0.4);
}

// 地面炮台底座(八角形混凝土 + 沙袋)
function drawTurretBase(g) {
  const oct = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    oct.push([Math.cos(a) * 17, Math.sin(a) * 17]);
  }
  fillPath(g, oct, lin(g, -17, -17, 17, 17, [[0, '#D6D2C2'], [0.5, '#949080'], [1, '#56534A']]));
  const inner = oct.map(([x, y]) => [x * 0.74, y * 0.74]);
  fillPath(g, inner, lin(g, -12, -12, 12, 12, [[0, '#5E5B52'], [1, '#B0AC9E']]));
  // 黄黑警示环
  for (let i = 0; i < 16; i++) {
    const a0 = (i / 16) * Math.PI * 2;
    const a1 = ((i + 1) / 16) * Math.PI * 2;
    g.beginPath();
    g.arc(0, 0, 12.4, a0, a1);
    g.arc(0, 0, 10.6, a1, a0, true);
    g.closePath();
    g.fillStyle = i % 2 ? '#2A2418' : '#E0B030';
    g.fill();
  }
  circle(g, 0, 0, 10, '#2E2E2A');
  ring(g, 0, 0, 8.6, 'rgba(0,0,0,0.5)', 0.6);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    circle(g, Math.cos(a) * 14.6, Math.sin(a) * 14.6, 0.8, '#3E3C36');
    circle(g, Math.cos(a) * 14.6 - 0.25, Math.sin(a) * 14.6 - 0.25, 0.35, 'rgba(255,255,255,0.4)');
  }
  path(g, oct);
  g.strokeStyle = 'rgba(255,255,240,0.35)';
  g.lineWidth = 0.5;
  g.stroke();
}

// ── Boss 部件 ──
function drawPod(g) {
  const box = [[-11, -15], [11, -15], [12, 13], [-12, 13]];
  fillPath(g, box, lin(g, -12, -15, 12, 13, [[0, '#B4BACA'], [0.45, '#6E7484'], [1, '#2A2E38']]));
  clip(g, box, () => {
    fillPath(g, [[-12, -15], [12, -15], [12, -10.6], [-12, -10.6]], '#D8A030');
    for (let i = -12; i < 12; i += 4) fillPath(g, [[i, -15], [i + 2, -15], [i + 0.6, -10.6], [i - 1.4, -10.6]], '#2A2418');
  });
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 3; c++) {
      const x = -6 + c * 6;
      const y = 2 + r * 6;
      circle(g, x, y, 2.5, '#121418');
      circle(g, x, y + 0.5, 1.6, rad(g, x, y + 0.5, 0, 1.6, [[0, '#FFB0A0'], [0.5, '#E0402E'], [1, '#5A1008']]));
    }
  }
  line(g, [[-11, -15], [11, -15]], 'rgba(255,255,255,0.5)', 0.5);
}

function drawBigCannon(g) {
  fillPath(g, [[-2.8, 4], [2.8, 4], [2.3, 24], [-2.3, 24]], lin(g, -3, 0, 3, 0, [[0, '#1C2026'], [0.45, '#B4BCC8'], [1, '#161A20']]));
  for (let y = 8; y < 20; y += 4) rect(g, -3, y, 6, 1, 'rgba(10,12,16,0.6)');
  fillPath(g, [[-3.6, 20], [3.6, 20], [3.6, 25.4], [-3.6, 25.4]], '#101216');
  circle(g, 0, 0, 12.4, '#0C1220');
  circle(g, 0, 0, 11.6, rad(g, 0, 0, 1, 12, [[0, '#C4ECFF'], [0.45, '#3E6088'], [1, '#121C2E']], -4, -4));
  ring(g, 0, 0, 8.4, 'rgba(160,220,255,0.35)', 0.5);
  circle(g, 0, 0, 5, '#0A1220');
  circle(g, 0, 0, 2.8, rad(g, 0, 0, 0, 2.8, [[0, '#FFFFFF'], [0.5, '#7FE8FF'], [1, '#1A6A9A']]));
}

function drawCore(g, open) {
  circle(g, 0, 0, 19.6, '#10141C');
  circle(g, 0, 0, 18.8, lin(g, -19, -19, 19, 19, [[0, '#B0B6C4'], [0.5, '#4E5464'], [1, '#1E222A']]));
  ring(g, 0, 0, 15.6, 'rgba(10,12,18,0.6)', 0.7);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    circle(g, Math.cos(a) * 17.2, Math.sin(a) * 17.2, 0.55, 'rgba(255,255,255,0.4)');
  }
  if (open) {
    circle(g, 0, 0, 14.4, '#120814');
    circle(g, 0, 0, 12.4, rad(g, 0, 0, 0, 12.4, [[0, '#FFFFFF'], [0.22, '#FFB0EA'], [0.58, '#D0308E'], [1, '#3A0828']]));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      line(g, [[Math.cos(a) * 4, Math.sin(a) * 4], [Math.cos(a) * 11, Math.sin(a) * 11]], 'rgba(255,220,250,0.5)', 0.6);
    }
    circle(g, -3.4, -4.4, 2.6, 'rgba(255,255,255,0.75)');
  } else {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      g.save();
      g.rotate(a);
      fillPath(g, [[0.8, 0], [14.6, -6.4], [14.6, 6.4]], lin(g, 0, -6, 14, 6, [[0, '#A8AEBC'], [1, '#4A5060']]));
      line(g, [[0.8, 0], [14.6, -6.4]], 'rgba(255,255,255,0.45)', 0.4);
      g.restore();
    }
    circle(g, 0, 0, 3.2, '#10141C');
    circle(g, 0, 0, 2.2, rad(g, 0, 0, 0, 2.2, [[0, '#FFC0CC'], [1, '#E02A4A']]));
  }
}

function drawWreck(g) {
  circle(g, 0, 0, 14, rad(g, 0, 0, 2, 14, [[0, '#120C08'], [0.6, '#2A2018'], [1, 'rgba(40,30,20,0)']]));
  const rnd = makeRng(9);
  for (let i = 0; i < 11; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 4 + rnd() * 8;
    fillPath(g, [[Math.cos(a) * r, Math.sin(a) * r], [Math.cos(a + 0.3) * (r + 3), Math.sin(a + 0.3) * (r + 3)], [Math.cos(a + 0.5) * r, Math.sin(a + 0.5) * r]], i % 3 ? '#3A3430' : '#5A524A');
  }
  circle(g, 0, 0, 3.4, rad(g, 0, 0, 0, 3.4, [[0, '#FFD08A'], [0.5, '#FF6A2A'], [1, 'rgba(120,30,10,0)']]));
}

// ── Boss 船体 ──
function drawBossWhale(g) {
  const rng = makeRng(71);
  [-1, 1].forEach(side => {
    const wing = [[side * 22, -40], [side * 112, -6], [side * 114, 12], [side * 96, 22], [side * 24, 30]];
    fillPath(g, wing, lin(g, 0, 0, side * 114, 0, [[0, '#5E6E84'], [0.5, '#93A3B9'], [1, '#46546A']]));
    clip(g, wing, () => {
      fillPath(g, wing, lin(g, 0, -40, 0, 30, [[0, 'rgba(255,255,255,0.14)'], [1, 'rgba(0,0,0,0.32)']]));
      greebles(g, rng, side > 0 ? 26 : -110, -30, side > 0 ? 110 : -26, 24, 34, 'rgba(14,20,32,0.2)');
      for (let i = 0; i < 5; i++) line(g, [[side * (32 + i * 16), -36 + i * 6.6], [side * (34 + i * 15), 28 - i * 1.2]], 'rgba(16,22,34,0.5)', 0.7);
      line(g, [[side * 26, 6], [side * 110, 4]], 'rgba(16,22,34,0.5)', 0.7);
      line(g, [[side * 26, 7.2], [side * 110, 5.2]], 'rgba(255,255,255,0.18)', 0.5);
      fillPath(g, [[side * 100, -10], [side * 120, -4], [side * 120, 20], [side * 102, 18]], '#D97757');
      for (let i = 0; i < 4; i++) fillPath(g, [[side * (101 + i * 4), -9], [side * (103 + i * 4), -8.4], [side * (103 + i * 4), 19], [side * (101 + i * 4), 18.6]], 'rgba(40,20,10,0.35)');
    });
    line(g, [[side * 22, -40], [side * 112, -6]], 'rgba(255,255,255,0.4)', 0.8);
    // 引擎吊舱
    ellipse(g, side * 50, -26, 9.4, 18.4, '#141A24');
    ellipse(g, side * 50, -26, 8.6, 17.6, lin(g, side * 41, 0, side * 59, 0, [[0, '#2A3240'], [0.45, '#8494AA'], [1, '#222834']]));
    for (let y = -38; y < -12; y += 5) line(g, [[side * 43, y], [side * 57, y]], 'rgba(14,20,30,0.45)', 0.5);
    circle(g, side * 50, -43, 6.4, '#121824');
    circle(g, side * 50, -43, 4.4, rad(g, side * 50, -43, 0, 4.4, [[0, '#FFFFFF'], [0.4, '#8FE4FF'], [1, '#1A5A8A']]));
    // 部件安装座
    circle(g, side * 62, 18, 13.4, '#161B24');
    circle(g, side * 62, 18, 12.4, lin(g, side * 50, 6, side * 74, 30, [[0, '#5A6476'], [1, '#262C38']]));
    ring(g, side * 62, 18, 10, 'rgba(0,0,0,0.5)', 0.6);
    fillPath(g, [[side * 84, -32], [side * 108, -32], [side * 108, -4], [side * 84, -4]], '#222834');
    fillPath(g, [[side * 85, -31], [side * 107, -31], [side * 107, -29.6], [side * 85, -29.6]], 'rgba(255,255,255,0.25)');
  });
  // 主船体
  g.beginPath();
  g.moveTo(0, 84);
  g.bezierCurveTo(30, 70, 36, 20, 34, -40);
  g.bezierCurveTo(32, -70, 18, -84, 0, -84);
  g.bezierCurveTo(-18, -84, -32, -70, -34, -40);
  g.bezierCurveTo(-36, 20, -30, 70, 0, 84);
  g.closePath();
  g.fillStyle = lin(g, -36, 0, 36, 0, [[0, '#323E4E'], [0.28, '#AAB8CC'], [0.6, '#7A889E'], [1, '#2A3442']]);
  g.fill();
  g.save();
  g.clip();
  greebles(g, rng, -32, -76, 32, 76, 60, 'rgba(14,20,32,0.18)');
  // 背脊装甲 + 接缝
  fillPath(g, [[-12.4, -78], [12.4, -78], [16.4, 62], [-16.4, 62]], lin(g, -16, 0, 16, 0, [[0, '#44505E'], [0.45, '#BAC6D8'], [1, '#3C4654']]));
  for (let y = -64; y < 60; y += 12) {
    line(g, [[-16, y], [16, y]], 'rgba(16,22,34,0.55)', 0.6);
    line(g, [[-16, y + 0.8], [16, y + 0.8]], 'rgba(255,255,255,0.16)', 0.4);
  }
  // 侧舷炮窗
  [-1, 1].forEach(side => { for (let y = -60; y < 50; y += 9) rect(g, side * 26 - 1.6, y, 3.2, 4, '#141A24'); });
  g.restore();
  // 舰桥
  fillPath(g, [[-10.4, 54], [10.4, 54], [7.4, 72.4], [-7.4, 72.4]], '#222A36');
  canopy(g, 0, 65.4, 5, 4.2, [[0, '#D0F4FF'], [1, '#2A6A8A']], true);
  // 核心舱口
  circle(g, 0, 30, 22.6, '#161C26');
  circle(g, 0, 30, 21, lin(g, -20, 10, 20, 50, [[0, '#4E5868'], [1, '#232A36']]));
  ring(g, 0, 30, 19.6, 'rgba(255,255,255,0.15)', 0.5);
  fillPath(g, [[-6.4, -72], [6.4, -72], [6.4, -64.4], [-6.4, -64.4]], '#D97757');
}

function drawBossFortress(g) {
  const rng = makeRng(83);
  const n = 12;
  const outer = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.PI / n;
    outer.push([Math.cos(a) * 126, Math.sin(a) * 98]);
  }
  fillPath(g, outer, lin(g, -126, -98, 126, 98, [[0, '#E2D2AA'], [0.5, '#A8946C'], [1, '#62523A']]));
  const wall = outer.map(([x, y]) => [x * 0.9, y * 0.88]);
  fillPath(g, wall, lin(g, -110, -86, 110, 86, [[0, '#6E5E42'], [1, '#C0AC84']]));
  const floor = outer.map(([x, y]) => [x * 0.84, y * 0.8]);
  fillPath(g, floor, lin(g, 0, -80, 0, 80, [[0, '#B8A680'], [1, '#9A8864']]));
  clip(g, floor, () => {
    for (let x = -90; x <= 90; x += 30) line(g, [[x, -80], [x, 80]], 'rgba(80,64,40,0.35)', 0.6);
    for (let y = -60; y <= 60; y += 30) line(g, [[-110, y], [110, y]], 'rgba(80,64,40,0.35)', 0.6);
    // 油渍 / 车辙
    for (let i = 0; i < 14; i++) ellipse(g, (rng() - 0.5) * 200, (rng() - 0.5) * 140, 3 + rng() * 8, 2 + rng() * 5, 'rgba(60,46,28,0.18)', rng() * 3);
    greebles(g, rng, -100, -70, 100, 70, 36, 'rgba(60,46,28,0.2)');
  });
  for (let i = -5; i < 5; i++) {
    fillPath(g, [[i * 10, 74], [i * 10 + 5, 74], [i * 10 + 2, 80], [i * 10 - 3, 80]], i % 2 ? '#2A2418' : '#E0B030');
  }
  // 城垛
  for (let i = 0; i < n; i++) {
    const [x0, y0] = outer[i];
    const [x1, y1] = outer[(i + 1) % n];
    for (let t = 0.15; t < 0.9; t += 0.2) {
      const x = (x0 + (x1 - x0) * t) * 0.95;
      const y = (y0 + (y1 - y0) * t) * 0.94;
      rect(g, x - 2, y - 2, 4, 4, '#7A6A4C');
      rect(g, x - 2, y - 2, 4, 1, 'rgba(255,250,230,0.4)');
    }
  }
  // 塔楼
  [[-104, 0], [104, 0], [0, -86], [0, 86]].forEach(([x, y]) => {
    circle(g, x, y, 11, '#4A3E2A');
    circle(g, x, y, 10, lin(g, x - 10, y - 10, x + 10, y + 10, [[0, '#ECDCB4'], [1, '#6E5E44']]));
    circle(g, x, y, 5, '#3A3020');
    circle(g, x, y, 2, '#FF6A3C');
  });
  // 部件安装座
  [[-80, -40], [80, -40], [-88, 46], [88, 46], [0, -62]].forEach(([x, y]) => {
    circle(g, x, y, 15.4, '#4A3E2A');
    circle(g, x, y, 14, lin(g, x - 14, y - 14, x + 14, y + 14, [[0, '#A8987A'], [1, '#5A4C36']]));
    ring(g, x, y, 11.4, 'rgba(40,30,16,0.5)', 0.6);
  });
  // 停机坪 H
  circle(g, -40, 10, 16.6, '#5A4E3A');
  circle(g, -40, 10, 16, '#8A7A5E');
  ring(g, -40, 10, 14, '#E8E0C8', 1);
  line(g, [[-46, 3], [-46, 17]], '#E8E0C8', 2);
  line(g, [[-34, 3], [-34, 17]], '#E8E0C8', 2);
  line(g, [[-46, 10], [-34, 10]], '#E8E0C8', 2);
  // 机库(拱顶)
  fillPath(g, [[24, -6], [62, -6], [62, 20], [24, 20]], lin(g, 24, 0, 62, 0, [[0, '#5E5A50'], [0.4, '#C8C2B2'], [1, '#4E4A40']]));
  for (let x = 28; x < 62; x += 4) line(g, [[x, -6], [x, 20]], 'rgba(40,36,30,0.5)', 0.5);
  fillPath(g, [[24, 17], [62, 17], [62, 20], [24, 20]], '#2A2620');
  // 油罐
  [[-52, -66], [-40, -72], [-60, -56]].forEach(([x, y]) => {
    circle(g, x + 1.4, y + 1.4, 6, 'rgba(40,30,16,0.4)');
    circle(g, x, y, 6, rad(g, x, y, 0, 6, [[0, '#F4F0E4'], [1, '#9A9484']], x - 2, y - 2));
    ring(g, x, y, 4, 'rgba(80,70,50,0.4)', 0.5);
  });
  // 中央穹顶(核心)
  circle(g, 0, 22, 27, '#3A3020');
  circle(g, 0, 22, 25, '#4A3E2A');
  circle(g, 0, 22, 23, rad(g, 0, 22, 2, 23, [[0, '#D4C6A4'], [1, '#62553C']], -7, 14));
}

function drawBossAurora(g) {
  const rng = makeRng(97);
  g.beginPath();
  g.moveTo(0, 70);
  g.bezierCurveTo(70, 66, 124, 30, 130, -40);
  g.bezierCurveTo(110, -20, 80, -30, 60, -60);
  g.bezierCurveTo(40, -80, 20, -92, 0, -92);
  g.bezierCurveTo(-20, -92, -40, -80, -60, -60);
  g.bezierCurveTo(-80, -30, -110, -20, -130, -40);
  g.bezierCurveTo(-124, 30, -70, 66, 0, 70);
  g.closePath();
  g.fillStyle = lin(g, -130, 0, 130, 0, [[0, '#0E1528'], [0.3, '#3C4E7C'], [0.5, '#5A6CA0'], [0.7, '#34446C'], [1, '#0A1022']]);
  g.fill();
  g.save();
  g.clip();
  g.fillStyle = lin(g, 0, -92, 0, 70, [[0, 'rgba(255,255,255,0.14)'], [1, 'rgba(0,0,0,0.38)']]);
  g.fillRect(-140, -100, 280, 180);
  greebles(g, rng, -120, -84, 120, 60, 70, 'rgba(6,10,24,0.22)');
  // 装甲分区
  [-1, 1].forEach(side => {
    for (let i = 0; i < 6; i++) line(g, [[side * (10 + i * 20), -90 + i * 8], [side * (14 + i * 18), 66 - i * 10]], 'rgba(6,10,24,0.5)', 0.6);
  });
  g.restore();
  [-1, 1].forEach(side => {
    // 发光能量线(外发光 + 亮芯)
    [[3, 'rgba(95,240,255,0.25)'], [1.2, '#9AF8FF']].forEach(([w, c]) => {
      line(g, [[side * 12, 60], [side * 70, 40], [side * 120, -26]], c, w);
      line(g, [[side * 20, -80], [side * 56, -52], [side * 92, -34]], c, w * 0.8);
    });
    line(g, [[side * 16, 40], [side * 40, -40]], 'rgba(95,240,255,0.45)', 0.6);
    // 尾鳍
    fillPath(g, [[side * 30, -70], [side * 44, -96], [side * 50, -94], [side * 42, -62]], lin(g, side * 30, 0, side * 50, 0, [[0, '#4A5C8C'], [1, '#101830']]));
    line(g, [[side * 30, -70], [side * 44, -96]], 'rgba(160,220,255,0.6)', 0.6);
    // 部件安装座
    [[70, 40, 15], [110, -10, 12], [40, -52, 12]].forEach(([x, y, r]) => {
      circle(g, side * x, y, r + 0.8, '#060A16');
      circle(g, side * x, y, r, lin(g, side * x - r, y - r, side * x + r, y + r, [[0, '#2A3658'], [1, '#0A0E1E']]));
      ring(g, side * x, y, r - 2.4, 'rgba(95,240,255,0.25)', 0.5);
    });
    // 引擎
    ellipse(g, side * 84, -50, 6.4, 10.4, '#080C18', -side * 0.5);
    circle(g, side * 88, -58, 4.2, rad(g, side * 88, -58, 0, 4.2, [[0, '#FFFFFF'], [0.45, '#9AF8FF'], [1, '#1A6A9A']]));
  });
  // 中央水晶核心座
  circle(g, 0, 14, 25.6, '#060A16');
  circle(g, 0, 14, 23, lin(g, -22, -8, 22, 36, [[0, '#2E3A62'], [1, '#0E1428']]));
  ring(g, 0, 14, 21, 'rgba(95,240,255,0.35)', 0.7);
  // 舰桥
  fillPath(g, [[-8, 48], [8, 48], [5, 62], [-5, 62]], '#1E2848');
  canopy(g, 0, 56, 4, 3, [[0, '#E0FFFF'], [1, '#2A8AAA']], true);
}

// ── 子弹 / 特效 / 拾取物 ──
// 我方子弹:细长的亮黄光弹(叠加混合)
function drawPlayerBullet(g) {
  ellipse(g, 0, 1, 5, 12, rad(g, 0, 1, 0, 12, [[0, 'rgba(255,220,130,0.5)'], [1, 'rgba(255,150,40,0)']]));
  ellipse(g, 0, 0, 1.9, 9, lin(g, 0, -9, 0, 9, [[0, '#FFFFFF'], [0.35, '#FFF4C8'], [0.8, '#FFB84A'], [1, 'rgba(255,140,40,0)']]));
}

function drawMissile(g) {
  fillPath(g, [[-1.7, -7], [0, -9.6], [1.7, -7], [1.7, 6], [-1.7, 6]], '#1A1E26');
  fillPath(g, [[-1.3, -6.8], [0, -9], [1.3, -6.8], [1.3, 5.6], [-1.3, 5.6]], lin(g, -1.4, 0, 1.4, 0, [[0, '#9AA0AA'], [0.45, '#FFFFFF'], [1, '#7A808A']]));
  fillPath(g, [[-1.3, -6.8], [0, -9], [1.3, -6.8]], '#E04A3A');
  rect(g, -1.3, 1, 2.6, 0.8, '#E04A3A');
  fillPath(g, [[-1.6, 2.6], [-3.6, 7], [-1.6, 6]], '#4A5060');
  fillPath(g, [[1.6, 2.6], [3.6, 7], [1.6, 6]], '#4A5060');
}

// 敌弹:实心圆珠 + 深色描边 + 白芯 —— 形状和颜色都和金色五角星完全不同
function drawBullet(g, r, rim, mid, core) {
  circle(g, 0, 0, r * 1.35, rad(g, 0, 0, r * 0.6, r * 1.35, [[0, mid], [1, 'rgba(0,0,0,0)']]));
  circle(g, 0, 0, r, rim);
  circle(g, 0, 0, r * 0.8, rad(g, 0, 0, 0, r * 0.8, [[0, '#FFFFFF'], [0.42, core], [1, mid]]));
  circle(g, -r * 0.24, -r * 0.28, r * 0.2, 'rgba(255,255,255,0.95)');
}

function drawNeedle(g) {
  ellipse(g, 0, 0, 4, 9.6, rad(g, 0, 0, 0, 9.6, [[0, 'rgba(120,230,255,0.6)'], [1, 'rgba(40,120,255,0)']]));
  ellipse(g, 0, 0, 2.4, 7.2, '#0A2E5A');
  ellipse(g, 0, 0, 1.7, 6.4, lin(g, 0, -6.4, 0, 6.4, [[0, '#FFFFFF'], [0.5, '#BFF6FF'], [1, '#3AB8FF']]));
}

function drawGlow(g, rgb, r) {
  circle(g, 0, 0, r, rad(g, 0, 0, 0, r, [[0, `rgba(${rgb},1)`], [0.25, `rgba(${rgb},0.55)`], [0.6, `rgba(${rgb},0.15)`], [1, `rgba(${rgb},0)`]]));
}

// 闪光十字星(星星上的高光、拾取瞬间用)
function drawGlint(g) {
  [[0, 1], [Math.PI / 2, 1], [Math.PI / 4, 0.45], [-Math.PI / 4, 0.45]].forEach(([a, k]) => {
    g.save();
    g.rotate(a);
    ellipse(g, 0, 0, 1.1 * k + 0.3, 11 * k, rad(g, 0, 0, 0, 11 * k, [[0, 'rgba(255,255,255,1)'], [0.4, 'rgba(255,250,210,0.6)'], [1, 'rgba(255,240,180,0)']]));
    g.restore();
  });
  circle(g, 0, 0, 3, rad(g, 0, 0, 0, 3, [[0, '#FFFFFF'], [1, 'rgba(255,255,240,0)']]));
}

function drawFireball(g, seed) {
  const rnd = makeRng(seed);
  for (let i = 0; i < 9; i++) {
    const a = rnd() * Math.PI * 2;
    const d = rnd() * 10;
    const r = 12 + rnd() * 10;
    circle(g, Math.cos(a) * d, Math.sin(a) * d, r, rad(g, Math.cos(a) * d, Math.sin(a) * d, 0, r, [[0, 'rgba(255,240,200,0.9)'], [0.35, 'rgba(255,190,80,0.75)'], [0.7, 'rgba(240,80,30,0.45)'], [1, 'rgba(120,20,10,0)']]));
  }
  circle(g, 0, 0, 10, rad(g, 0, 0, 0, 10, [[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,230,160,0)']]));
}

function drawSmoke(g, seed) {
  const rnd = makeRng(seed);
  for (let i = 0; i < 10; i++) {
    const a = rnd() * Math.PI * 2;
    const d = rnd() * 12;
    const r = 10 + rnd() * 12;
    const v = 70 + Math.floor(rnd() * 50);
    circle(g, Math.cos(a) * d, Math.sin(a) * d, r, rad(g, Math.cos(a) * d - 3, Math.sin(a) * d - 3, 0, r, [[0, `rgba(${v + 40},${v + 40},${v + 44},0.55)`], [0.6, `rgba(${v},${v},${v + 4},0.3)`], [1, `rgba(${v},${v},${v},0)`]]));
  }
}

function drawRing(g) {
  circle(g, 0, 0, 30, rad(g, 0, 0, 0, 30, [[0, 'rgba(255,255,255,0)'], [0.72, 'rgba(255,240,210,0)'], [0.86, 'rgba(255,240,210,0.9)'], [1, 'rgba(255,200,120,0)']]));
}

function starPts(R, r) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r : R;
    pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
  }
  return pts;
}

// 金色立体五角星:每个角分成迎光 / 背光两个面,转起来像一枚金币
function drawStar(g, R, big) {
  const pts = starPts(R, R * 0.47);
  path(g, pts);
  g.lineJoin = 'round';
  g.strokeStyle = big ? '#6A2606' : '#6A3E04';
  g.lineWidth = R * 0.26;
  g.stroke();
  const light = big ? [255, 236, 170] : [255, 248, 190];
  const dark = big ? [214, 96, 20] : [212, 140, 10];
  const la = -Math.PI * 0.75;   // 左上方来光
  for (let i = 0; i < 10; i++) {
    const p0 = pts[i];
    const p1 = pts[(i + 1) % 10];
    const ma = Math.atan2((p0[1] + p1[1]) / 2, (p0[0] + p1[0]) / 2);
    const t = 0.5 + 0.5 * Math.cos(ma - la);
    const c = light.map((v, j) => Math.round(dark[j] + (v - dark[j]) * t));
    fillPath(g, [[0, 0], p0, p1], `rgb(${c[0]},${c[1]},${c[2]})`);
  }
  // 中心凸起 + 高光
  fillPath(g, starPts(R * 0.34, R * 0.16), big ? 'rgba(255,240,200,0.7)' : 'rgba(255,255,230,0.75)');
  circle(g, -R * 0.28, -R * 0.36, R * 0.13, 'rgba(255,255,255,0.95)');
}

function drawCapsule(g, color, dark, label) {
  g.beginPath();
  g.moveTo(-6, -3);
  g.arc(0, -3, 6, Math.PI, 0);
  g.lineTo(6, 3);
  g.arc(0, 3, 6, 0, Math.PI);
  g.closePath();
  g.fillStyle = lin(g, -6, 0, 6, 0, [[0, dark], [0.35, color], [1, dark]]);
  g.fill();
  g.strokeStyle = '#FFFFFF';
  g.lineWidth = 1;
  g.stroke();
  ellipse(g, -2.4, -4.6, 1.4, 3, 'rgba(255,255,255,0.6)');
  g.fillStyle = '#FFFFFF';
  if (label === '+') {
    g.fillRect(-1.3, -4.6, 2.6, 9.2);
    g.fillRect(-4.6, -1.3, 9.2, 2.6);
  } else {
    g.font = 'bold 10px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, 0, 0.5);
  }
}

// 云:先铺一层偏蓝灰的底(背光面),再在左上叠亮白的团块,体积感更强
function drawCloud(g, seed, w, h) {
  const rnd = makeRng(seed);
  const puffs = [];
  for (let i = 0; i < 22; i++) {
    const x = (rnd() - 0.5) * w * 0.66;
    const y = (rnd() - 0.5) * h * 0.4;
    const r = h * (0.16 + rnd() * 0.2) * (1 - Math.abs(x) / w);
    puffs.push([x, y, r]);
  }
  puffs.forEach(([x, y, r]) => circle(g, x + r * 0.18, y + r * 0.22, r, rad(g, x, y, 0, r, [[0, 'rgba(196,212,232,0.55)'], [0.7, 'rgba(180,198,224,0.32)'], [1, 'rgba(170,190,220,0)']])));
  puffs.forEach(([x, y, r]) => circle(g, x - r * 0.12, y - r * 0.16, r * 0.82, rad(g, x - r * 0.3, y - r * 0.35, 0, r * 0.82, [[0, 'rgba(255,255,255,0.75)'], [0.55, 'rgba(250,252,255,0.4)'], [1, 'rgba(240,246,255,0)']])));
}

function drawCrater(g) {
  circle(g, 0, 0, 20, rad(g, 0, 0, 0, 20, [[0, 'rgba(20,14,10,0.85)'], [0.5, 'rgba(40,30,22,0.6)'], [1, 'rgba(40,30,22,0)']]));
  const rnd = makeRng(4);
  for (let i = 0; i < 14; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 6 + rnd() * 12;
    circle(g, Math.cos(a) * r, Math.sin(a) * r, 0.8 + rnd() * 1.4, 'rgba(30,22,16,0.8)');
  }
}

// ── 组装 ──
// 先按尺寸排版,再按需要的高度建画布,最后逐个绘制
function buildArt(createCanvas) {
  const items = [];
  const add = (name, w, h, draw, opts) => items.push(Object.assign({ name, w, h, draw, s: ART }, opts || {}));
  // ol: 描边宽度(虚拟像素);shade: 叠体积光
  const ship = { flash: true, shadow: true, ol: 0.7, shade: true };
  const unit = { flash: true, ol: 0.65, shade: true };

  [-2, -1, 0, 1, 2].forEach(b => add(`player${b}`, 56, 58, g => drawPlayer(g, b), Object.assign({ ol: 0.7, shade: true }, b === 0 ? { shadow: true } : {})));
  add('e_drone', 30, 30, drawDrone, ship);
  add('e_dart', 34, 38, drawDart, ship);
  add('e_gunship', 42, 58, drawGunship, ship);
  add('e_bomber', 74, 58, drawBomber, ship);
  add('e_cruiser', 116, 86, drawCruiser, ship);
  add('b_body', 24, 64, drawBoat, unit);
  add('b_wake', 48, 48, drawWake, { s: 1.5 });
  add('k_body', 32, 40, drawTankBody, unit);
  add('k_head', 18, 36, drawTankHead, unit);
  add('t_base', 38, 38, drawTurretBase, unit);
  add('t_head', 20, 36, g => drawTurretHead(g, true), unit);
  add('p_pod', 28, 34, drawPod, unit);
  add('p_cannon', 28, 54, drawBigCannon, unit);
  add('p_core', 42, 42, g => drawCore(g, false), unit);
  add('p_core_open', 42, 42, g => drawCore(g, true), unit);
  add('p_wreck', 32, 32, drawWreck);
  // Boss 体积大,2 倍就够,图集不会太大
  add('boss1', 236, 174, drawBossWhale, { s: 2, shadow: true, ol: 0.9, shade: true });
  add('boss2', 258, 202, drawBossFortress, { s: 2, ol: 0.9, shade: true });
  add('boss3', 266, 194, drawBossAurora, { s: 2, shadow: true, ol: 0.9, shade: true });

  add('pb', 12, 26, drawPlayerBullet);
  add('pm', 10, 22, drawMissile);
  add('eb', 18, 18, g => drawBullet(g, 6.2, '#4A0626', 'rgba(255,40,120,0.9)', '#FFB6D6'));
  add('eb2', 14, 14, g => drawBullet(g, 4.6, '#3A0846', 'rgba(190,70,255,0.9)', '#EBC8FF'));
  add('eb3', 10, 22, drawNeedle);
  add('star', 18, 18, g => drawStar(g, 7.4, false));
  add('star_big', 26, 26, g => drawStar(g, 10.6, true));
  add('glint', 26, 26, drawGlint, { s: 2 });
  add('pu_hp', 18, 24, g => drawCapsule(g, '#4CD08A', '#1E7A4A', '+'));
  add('pu_pow', 18, 24, g => drawCapsule(g, '#FF9A3C', '#B04A10', 'P'));

  // 柔和的大块特效用 1 倍分辨率就够
  const glows = { g_w: '255,250,235', g_o: '255,160,60', g_r: '255,60,60', g_b: '90,170,255', g_c: '90,240,255', g_y: '255,230,120', g_p: '255,90,200' };
  Object.keys(glows).forEach(k => add(k, 64, 64, g => drawGlow(g, glows[k], 31), { s: 1 }));
  add('fire1', 64, 64, g => drawFireball(g, 3), { s: 1 });
  add('fire2', 64, 64, g => drawFireball(g, 17), { s: 1 });
  add('smoke1', 64, 64, g => drawSmoke(g, 5), { s: 1 });
  add('smoke2', 64, 64, g => drawSmoke(g, 29), { s: 1 });
  add('ring', 64, 64, drawRing, { s: 1 });
  add('crater', 44, 44, drawCrater, { s: 1 });
  [1, 2, 3].forEach(i => add(`cloud${i}`, 220, 130, g => drawCloud(g, i * 13, 220, 130), { s: 1, shadow: true }));

  // 变体也要占位
  const all = [];
  items.forEach(it => {
    all.push(it);
    if (it.flash) all.push(Object.assign({}, it, { name: `${it.name}_w`, variant: 'flash' }));
    if (it.shadow) all.push(Object.assign({}, it, { name: `${it.name}_s`, variant: 'shadow' }));
  });

  // 排版
  const AW = 2048;
  const PAD = 2;
  let x = 0;
  let y = 0;
  let rowH = 0;
  // 按高度排(同一精灵的变体紧挨着,草稿画布可以连用)
  all.forEach((it, i) => { it.ord = i; });
  all.sort((a, b) => (b.h * b.s - a.h * a.s) || (a.ord - b.ord));
  all.forEach(it => {
    it.pw = Math.ceil(it.w * it.s);
    it.ph = Math.ceil(it.h * it.s);
    if (x + it.pw > AW) { x = 0; y += rowH + PAD; rowH = 0; }
    it.px = x;
    it.py = y;
    x += it.pw + PAD;
    rowH = Math.max(rowH, it.ph);
  });
  const AH = y + rowH;

  const canvas = createCanvas(AW, AH);
  const g = canvas.getContext('2d');
  const rects = {};
  // 一圈 12 个方向的偏移,画出来的剪影就是"外扩一圈"的描边
  const ring12 = [];
  for (let i = 0; i < 12; i++) ring12.push([Math.cos((i / 12) * Math.PI * 2), Math.sin((i / 12) * Math.PI * 2)]);
  const soft5 = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];

  // 快速路径:每个精灵的矢量只画一次到草稿画布,描边 / 闪白 / 投影都用 drawImage 盖章。
  // 先实测一下"画布画到画布"在当前环境是否可用,不行就退回每次重画矢量
  let scratch = null;
  let sg = null;
  try {
    let mw = 0;
    let mh = 0;
    all.forEach(it => { if (!it.variant) { mw = Math.max(mw, it.pw); mh = Math.max(mh, it.ph); } });
    scratch = createCanvas(mw, mh);
    sg = scratch.getContext('2d');
    sg.fillStyle = '#FF0000';
    sg.fillRect(0, 0, 2, 2);
    g.drawImage(scratch, 0, 0, 2, 2, 0, 0, 2, 2);
    const px = g.getImageData(0, 0, 1, 1).data;
    if (!(px[0] > 200 && px[3] > 200)) scratch = null;
    g.clearRect(0, 0, 4, 4);
  } catch (e) {
    scratch = null;
  }

  const byName = {};
  all.forEach(it => { if (!it.variant) byName[it.name] = it; });
  const renderVec = (gg, it, cx, cy) => {
    gg.save();
    gg.translate(cx, cy);
    gg.scale(it.s, it.s);
    it.draw(gg);
    gg.restore();
  };
  let cur = null;   // 草稿画布里现在是哪个精灵
  all.forEach(it => {
    const base = it.variant ? byName[it.name.replace(/_[ws]$/, '')] : it;
    const cx = it.px + it.pw / 2;
    const cy = it.py + it.ph / 2;
    // stamp(ox, oy):把这个精灵在 (中心 + 偏移) 处画一次
    let stamp;
    if (scratch) {
      if (cur !== base) {
        sg.clearRect(0, 0, scratch.width, scratch.height);
        renderVec(sg, base, base.pw / 2, base.ph / 2);
        cur = base;
      }
      stamp = (ox, oy) => g.drawImage(scratch, 0, 0, base.pw, base.ph, it.px + ox, it.py + oy, base.pw, base.ph);
    } else {
      stamp = (ox, oy) => renderVec(g, base, cx + ox, cy + oy);
    }
    g.save();
    g.beginPath();
    g.rect(it.px, it.py, it.pw, it.ph);
    g.clip();
    const fillRegion = (style, op) => {
      g.save();
      g.globalCompositeOperation = op;
      g.fillStyle = style;
      g.fillRect(it.px, it.py, it.pw, it.ph);
      g.restore();
    };
    if (it.variant === 'shadow') {
      // 抖动叠几次,得到柔边剪影
      soft5.forEach(([ox, oy]) => stamp(ox, oy));
      fillRegion('#000814', 'source-atop');
    } else {
      if (it.ol) {
        const o = it.ol * it.s;
        ring12.forEach(([dx, dy]) => stamp(dx * o, dy * o));
        fillRegion('rgba(8,10,18,0.92)', 'source-atop');
      }
      stamp(0, 0);
      if (it.shade) {
        // 体积光:左上亮、右下暗
        const gr = g.createLinearGradient(it.px, it.py, it.px + it.pw, it.py + it.ph);
        gr.addColorStop(0, 'rgba(255,255,255,0.14)');
        gr.addColorStop(0.5, 'rgba(255,255,255,0)');
        gr.addColorStop(1, 'rgba(0,6,20,0.2)');
        fillRegion(gr, 'source-atop');
      }
      if (it.variant === 'flash') fillRegion('#FFFFFF', 'source-atop');
    }
    g.restore();
    rects[it.name] = { x: it.px, y: it.py, w: it.pw, h: it.ph, vw: it.w, vh: it.h };
  });
  return { canvas, rects };
}

module.exports = { buildArt };
