// ── 苍穹之翼 · 精灵图集 ──────────────────────────────────────
// 所有精灵都用矢量路径 + 渐变在启动时画进一张离屏图集(默认 2 倍分辨率),
// 游戏里只做 drawImage。每个精灵的"虚拟尺寸" = 图集尺寸 / s。
// 另外为敌人生成两种变体:
//   <name>_w  受击闪白(纯白剪影)
//   <name>_s  投影(柔边黑色剪影,运行时低透明度画在地面上)

const ART = 2;

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

function line(g, pts, color, w) {
  path(g, pts, false);
  g.strokeStyle = color;
  g.lineWidth = w;
  g.stroke();
}

function makeRng(seed) {
  let s = seed | 0;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

// ── 主角战机(机头朝上)── bank: -2..2 侧倾
function drawPlayer(g, bank) {
  const k = 1 - Math.abs(bank) * 0.12;
  g.save();
  g.scale(k, 1);
  // 主翼
  [-1, 1].forEach(side => {
    const wing = [[side * 4, -6], [side * 25, 13], [side * 25, 17.5], [side * 5, 14]];
    fillPath(g, wing, lin(g, 0, 0, side * 25, 8, [[0, '#EEF2F8'], [0.6, '#B7C2D2'], [1, '#8794A8']]));
    // 侧倾时压下去的那侧变暗,抬起的一侧更亮
    const dip = side * bank;
    if (dip > 0) fillPath(g, wing, `rgba(10,20,40,${0.16 * dip})`);
    else if (dip < 0) fillPath(g, wing, `rgba(255,255,255,${0.1 * -dip})`);
    // 前缘橙色条
    fillPath(g, [[side * 4, -6], [side * 25, 13], [side * 25, 14.8], [side * 4.6, -3.4]], '#D97757');
    // 翼面板线
    line(g, [[side * 9, 2.5], [side * 20, 15]], 'rgba(40,50,70,0.35)', 0.5);
    line(g, [[side * 6, 13.8], [side * 23, 16.6]], 'rgba(40,50,70,0.35)', 0.5);
    // 翼尖挂架
    fillPath(g, [[side * 24.2, 8], [side * 26, 8], [side * 26, 19], [side * 24.2, 19]], '#4E5664');
    circle(g, side * 25.1, 8, 0.9, '#E05A3A');
    // 鸭翼
    fillPath(g, [[side * 4, -14], [side * 10.5, -8.5], [side * 10.5, -7.2], [side * 4, -8]], lin(g, 0, -12, side * 10, -8, [[0, '#DCE3EC'], [1, '#8C98AA']]));
    // 尾翼
    fillPath(g, [[side * 3.6, 14], [side * 12.5, 22], [side * 12.5, 25], [side * 3.6, 21.5]], lin(g, 0, 18, side * 12, 24, [[0, '#C9D2DE'], [1, '#77839A']]));
    fillPath(g, [[side * 9.5, 21.6], [side * 12.5, 22], [side * 12.5, 25], [side * 9.5, 23.8]], '#D97757');
  });
  // 机身
  g.beginPath();
  g.moveTo(0, -27);
  g.bezierCurveTo(2.6, -23, 5, -15, 5.6, -5);
  g.lineTo(5.2, 19);
  g.lineTo(3.8, 24.5);
  g.lineTo(-3.8, 24.5);
  g.lineTo(-5.2, 19);
  g.lineTo(-5.6, -5);
  g.bezierCurveTo(-5, -15, -2.6, -23, 0, -27);
  g.closePath();
  g.fillStyle = lin(g, -6, 0, 6, 0, [[0, '#6E7B90'], [0.28, '#F4F7FB'], [0.62, '#C3CCD9'], [1, '#5F6B80']]);
  g.fill();
  // 进气道
  [-1, 1].forEach(side => {
    fillPath(g, [[side * 5.4, -2], [side * 7.4, 0], [side * 7.4, 9], [side * 5.4, 10]], '#3A4250');
  });
  // 座舱
  ellipse(g, 0, -11, 2.9, 7, lin(g, 0, -18, 0, -4, [[0, '#D8FBFF'], [0.35, '#57B8E0'], [1, '#0C2C48']]));
  ellipse(g, -1, -14.5, 0.9, 2.4, 'rgba(255,255,255,0.75)');
  // 机脊线 + 编号
  line(g, [[0, -2], [0, 18]], 'rgba(40,50,70,0.4)', 0.5);
  fillPath(g, [[-1.6, 4], [1.6, 4], [1.6, 9], [-1.6, 9]], '#D97757');
  // 喷口
  [-1, 1].forEach(side => {
    circle(g, side * 2.3, 24, 2, '#2A2F3A');
    circle(g, side * 2.3, 24, 1.1, '#FFB060');
  });
  g.restore();
}

// ── 敌机:小型战斗机(机头朝下)──
function drawDart(g) {
  [-1, 1].forEach(side => {
    const wing = [[side * 3, 7], [side * 15.5, -2], [side * 15, -5.5], [side * 3, -3]];
    fillPath(g, wing, lin(g, 0, 0, side * 15, 0, [[0, '#7A8A55'], [1, '#46552F']]));
    fillPath(g, [[side * 12.5, -0.3], [side * 15.5, -2], [side * 15, -5.5], [side * 12.5, -4]], '#B8322A');
    fillPath(g, [[side * 2.4, -9], [side * 8.5, -15], [side * 8, -16.5], [side * 2, -14]], '#4E5C36');
  });
  g.beginPath();
  g.moveTo(0, 16);
  g.bezierCurveTo(2.6, 12, 3.6, 5, 3.6, -5);
  g.lineTo(2.6, -15);
  g.lineTo(-2.6, -15);
  g.lineTo(-3.6, -5);
  g.bezierCurveTo(-3.6, 5, -2.6, 12, 0, 16);
  g.closePath();
  g.fillStyle = lin(g, -4, 0, 4, 0, [[0, '#3C4828'], [0.35, '#8E9E66'], [1, '#2E3820']]);
  g.fill();
  ellipse(g, 0, 6, 1.9, 4, lin(g, 0, 2, 0, 10, [[0, '#FFD9B0'], [0.4, '#D06A3A'], [1, '#3A1A10']]));
  circle(g, 0, -15, 1.4, '#FF9A3C');
}

// ── 武装直升机(机头朝下;主旋翼运行时画)──
function drawGunship(g) {
  // 尾梁
  fillPath(g, [[-1.8, -4], [1.8, -4], [1.4, -24], [-1.4, -24]], lin(g, -2, 0, 2, 0, [[0, '#3A4436'], [0.5, '#6E7A62'], [1, '#2E362A']]));
  fillPath(g, [[-7, -22], [7, -22], [7, -19.5], [-7, -19.5]], '#4A5444');
  ellipse(g, 3.2, -23, 1.2, 4, 'rgba(200,210,200,0.5)');
  // 短翼 + 火箭巢
  fillPath(g, [[-17, 0], [17, 0], [17, 4], [-17, 4]], '#4E5848');
  [-1, 1].forEach(side => {
    ellipse(g, side * 16, 2, 2.8, 6.5, lin(g, side * 13, 0, side * 19, 0, [[0, '#5A6450'], [0.5, '#9AA488'], [1, '#3A4232']]));
    circle(g, side * 16, 8, 1.6, '#C8402E');
  });
  // 机舱
  ellipse(g, 0, 4, 9.5, 14.5, lin(g, -10, 0, 10, 0, [[0, '#33402F'], [0.35, '#7A8A68'], [0.7, '#56644A'], [1, '#283224']]));
  ellipse(g, 0, 13, 5.5, 5, lin(g, 0, 8, 0, 18, [[0, '#BFE6F0'], [0.5, '#3E7E9A'], [1, '#102838']]));
  ellipse(g, -1.8, 11, 1.4, 2.2, 'rgba(255,255,255,0.6)');
  circle(g, 0, 0, 2.6, '#22281E');
}

// ── 轰炸机 ──
function drawBomber(g) {
  // 平尾
  fillPath(g, [[-15, -22], [15, -22], [13, -17], [-13, -17]], lin(g, -15, 0, 15, 0, [[0, '#5E6474'], [0.4, '#A4AABA'], [1, '#4E5464']]));
  // 主翼
  const wing = [[-34, -2], [34, -2], [31, 8], [-31, 8]];
  fillPath(g, wing, lin(g, 0, -4, 0, 8, [[0, '#B6BCC8'], [1, '#6C7282']]));
  fillPath(g, wing, lin(g, -34, 0, 34, 0, [[0, 'rgba(0,0,0,0.25)'], [0.45, 'rgba(255,255,255,0.08)'], [1, 'rgba(0,0,0,0.3)']]));
  [-1, 1].forEach(side => {
    fillPath(g, [[side * 26, -2], [side * 34, -2], [side * 31, 8], [side * 26, 8]], '#D8B040');
    // 机徽
    circle(g, side * 20, 3, 3.6, '#E8E0D0');
    circle(g, side * 20, 3, 2.4, '#B8322A');
    // 发动机
    ellipse(g, side * 12, 3, 4, 11, lin(g, side * 8, 0, side * 16, 0, [[0, '#3E4452'], [0.45, '#8A90A0'], [1, '#2E3440']]));
    circle(g, side * 12, 13, 2.4, '#1A1E26');
    circle(g, side * 12, -7.5, 2, '#FF8A3C');
  });
  // 机身
  ellipse(g, 0, 1, 5.6, 26, lin(g, -6, 0, 6, 0, [[0, '#4E5464'], [0.35, '#C8CED8'], [1, '#444A58']]));
  ellipse(g, 0, 19, 3.4, 5, lin(g, 0, 14, 0, 24, [[0, '#CFF2FA'], [0.5, '#4A8AA8'], [1, '#12283A']]));
  line(g, [[0, -20], [0, 10]], 'rgba(30,30,40,0.4)', 0.6);
}

// ── 精英:重型巡航舰(飞翼)──
function drawCruiser(g) {
  const body = [[0, 40], [52, -8], [54, -18], [34, -24], [14, -14], [0, -30], [-14, -14], [-34, -24], [-54, -18], [-52, -8]];
  fillPath(g, body, lin(g, -54, 0, 54, 0, [[0, '#2E2A3C'], [0.32, '#6A6284'], [0.55, '#4E4866'], [1, '#26222F']]));
  fillPath(g, body, lin(g, 0, -30, 0, 40, [[0, 'rgba(0,0,0,0.3)'], [0.5, 'rgba(255,255,255,0.06)'], [1, 'rgba(0,0,0,0.25)']]));
  [-1, 1].forEach(side => {
    // 装甲接缝
    line(g, [[side * 8, 26], [side * 46, -10]], 'rgba(10,8,20,0.6)', 0.8);
    line(g, [[side * 18, -8], [side * 40, -16]], 'rgba(10,8,20,0.6)', 0.8);
    // 发光散热口
    for (let i = 0; i < 4; i++) {
      fillPath(g, [[side * (22 + i * 6), -4 - i * 3], [side * (26 + i * 6), -6 - i * 3], [side * (26 + i * 6), -4.5 - i * 3], [side * (22 + i * 6), -2.5 - i * 3]], '#FF8A3C');
    }
    // 引擎
    ellipse(g, side * 22, -20, 5, 7, lin(g, side * 17, 0, side * 27, 0, [[0, '#24202E'], [0.5, '#5A5470'], [1, '#1A1722']]));
    circle(g, side * 22, -26, 3, '#7FD0FF');
    circle(g, side * 22, -26, 1.6, '#FFFFFF');
  });
  // 中央炮塔座
  circle(g, 0, 6, 11, lin(g, -11, 0, 11, 0, [[0, '#3A3548'], [0.5, '#8A82A4'], [1, '#2E2A3A']]));
  circle(g, 0, 6, 6, '#1A1722');
  circle(g, 0, 6, 3.4, rad(g, 0, 6, 0, 3.4, [[0, '#FFE0C0'], [0.5, '#FF6A3C'], [1, '#8A1A10']]));
  // 驾驶舱
  ellipse(g, 0, 28, 3.4, 6, lin(g, 0, 22, 0, 34, [[0, '#E0C8FF'], [0.5, '#7A4AC8'], [1, '#1A0C30']]));
}

// ── 炮艇(机头朝下)──
function drawBoat(g) {
  const hull = [[0, 30], [9, 14], [10, -22], [8, -28], [-8, -28], [-10, -22], [-9, 14]];
  fillPath(g, hull, lin(g, -10, 0, 10, 0, [[0, '#4A505A'], [0.4, '#A8AEB8'], [1, '#3A4048']]));
  fillPath(g, [[0, 25], [6.5, 12], [7, -20], [-7, -20], [-6.5, 12]], lin(g, -7, 0, 7, 0, [[0, '#7A8088'], [0.45, '#C8CCD2'], [1, '#6A7078']]));
  // 舰桥
  fillPath(g, [[-5, -4], [5, -4], [5, -14], [-5, -14]], lin(g, -5, 0, 5, 0, [[0, '#5A606A'], [0.5, '#E0E4EA'], [1, '#4A5058']]));
  fillPath(g, [[-4, -5.5], [4, -5.5], [4, -7], [-4, -7]], '#2A3A4A');
  circle(g, 0, -18, 2.2, '#3A4048');
  line(g, [[0, -18], [0, -25]], '#2A3038', 0.8);
  // 甲板线
  line(g, [[-6, 18], [6, 18]], 'rgba(30,30,40,0.4)', 0.5);
  line(g, [[-7, -20], [7, -20]], 'rgba(30,30,40,0.4)', 0.5);
}

// ── 坦克车身(炮塔另画)──
function drawTankBody(g) {
  [-1, 1].forEach(side => {
    fillPath(g, [[side * 8, -17], [side * 14, -17], [side * 14, 17], [side * 8, 17]], '#2A2A26');
    for (let y = -15; y < 17; y += 3) line(g, [[side * 8.5, y], [side * 13.5, y]], 'rgba(120,120,110,0.5)', 0.8);
  });
  fillPath(g, [[-9, -14], [9, -14], [9, 15], [-9, 15]], lin(g, -9, 0, 9, 0, [[0, '#5E5A36'], [0.4, '#A6A06A'], [1, '#4A4628']]));
  fillPath(g, [[-8, 12], [8, 12], [8, 15], [-8, 15]], '#4A4628');
  line(g, [[-9, -14], [9, -14]], 'rgba(255,255,220,0.4)', 0.8);
}

// 炮塔头(双管,炮口朝下)
function drawTurretHead(g, twin, color) {
  const c = color || ['#5A606E', '#C8CED8', '#3E4450'];
  [-1, 1].forEach(side => {
    if (!twin && side > 0) return;
    const x = twin ? side * 2.6 : 0;
    fillPath(g, [[x - 1.4, 2], [x + 1.4, 2], [x + 1.4, 15], [x - 1.4, 15]], lin(g, x - 1.5, 0, x + 1.5, 0, [[0, '#2A2E36'], [0.5, '#9AA0AA'], [1, '#22262C']]));
    fillPath(g, [[x - 1.8, 13], [x + 1.8, 13], [x + 1.8, 15.5], [x - 1.8, 15.5]], '#1A1C20');
  });
  circle(g, 0, 0, 7.6, rad(g, 0, 0, 0.5, 7.6, [[0, c[1]], [0.6, c[0]], [1, c[2]]], -2.4, -2.6));
  circle(g, 0, 0, 7.6, 'rgba(0,0,0,0)');
  g.strokeStyle = 'rgba(20,20,30,0.6)';
  g.lineWidth = 0.7;
  g.stroke();
  circle(g, -2.2, -2.4, 1.6, 'rgba(255,255,255,0.45)');
}

function drawTankHead(g) {
  fillPath(g, [[-1.5, 3], [1.5, 3], [1.5, 16], [-1.5, 16]], lin(g, -1.5, 0, 1.5, 0, [[0, '#2A2818'], [0.5, '#8A8458'], [1, '#22201A']]));
  circle(g, 0, 0, 6.8, rad(g, 0, 0, 0.5, 6.8, [[0, '#C0BA80'], [0.6, '#7A7448'], [1, '#3E3A22']], -2, -2));
  circle(g, -1.5, -1.8, 1.2, 'rgba(255,255,230,0.4)');
}

// 地面炮台底座(八角形混凝土)
function drawTurretBase(g) {
  const oct = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    oct.push([Math.cos(a) * 17, Math.sin(a) * 17]);
  }
  fillPath(g, oct, lin(g, -17, -17, 17, 17, [[0, '#C8C4B4'], [0.5, '#8E8A7C'], [1, '#5A574E']]));
  const inner = oct.map(([x, y]) => [x * 0.72, y * 0.72]);
  fillPath(g, inner, lin(g, -12, -12, 12, 12, [[0, '#6A675C'], [1, '#A8A496']]));
  circle(g, 0, 0, 9, '#3A3A36');
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    circle(g, Math.cos(a) * 14, Math.sin(a) * 14, 0.9, '#4A4842');
  }
  // 黄黑警示
  fillPath(g, [[-17 * 0.92, 4], [-17 * 0.92, -4], [-15, -4], [-15, 4]], '#E0B030');
}

// ── Boss 部件 ──
function drawPod(g) {
  fillPath(g, [[-11, -15], [11, -15], [12, 13], [-12, 13]], lin(g, -12, 0, 12, 0, [[0, '#3A3E4A'], [0.4, '#9AA0B0'], [1, '#2E323C']]));
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 3; c++) {
      const x = -6 + c * 6;
      const y = 2 + r * 6;
      circle(g, x, y, 2.4, '#1A1C22');
      circle(g, x, y + 0.6, 1.5, '#E0402E');
    }
  }
  fillPath(g, [[-11, -15], [11, -15], [11, -11], [-11, -11]], '#D8A030');
}

function drawBigCannon(g) {
  fillPath(g, [[-2.6, 4], [2.6, 4], [2.2, 24], [-2.2, 24]], lin(g, -3, 0, 3, 0, [[0, '#22262E'], [0.5, '#A8B0BC'], [1, '#1C2026']]));
  fillPath(g, [[-3.4, 20], [3.4, 20], [3.4, 25], [-3.4, 25]], '#14161A');
  circle(g, 0, 0, 12, rad(g, 0, 0, 1, 12, [[0, '#B8E8FF'], [0.5, '#3A5A80'], [1, '#141E30']], -4, -4));
  circle(g, 0, 0, 5, '#0A1220');
  circle(g, 0, 0, 2.6, '#7FE8FF');
}

function drawCore(g, open) {
  circle(g, 0, 0, 19, lin(g, -19, -19, 19, 19, [[0, '#A0A6B4'], [0.5, '#4A5060'], [1, '#22262E']]));
  if (open) {
    circle(g, 0, 0, 14, '#120814');
    circle(g, 0, 0, 12, rad(g, 0, 0, 0, 12, [[0, '#FFFFFF'], [0.25, '#FF9AE0'], [0.6, '#C02A8A'], [1, '#3A0828']]));
    circle(g, -3, -4, 2.6, 'rgba(255,255,255,0.7)');
  } else {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      g.save();
      g.rotate(a);
      fillPath(g, [[0, 0], [13.5, -6], [13.5, 6]], lin(g, 0, 0, 14, 0, [[0, '#5A6070'], [1, '#9AA0AE']]));
      g.restore();
    }
    circle(g, 0, 0, 3, '#FF4A6A');
  }
}

function drawWreck(g) {
  circle(g, 0, 0, 14, rad(g, 0, 0, 2, 14, [[0, '#120C08'], [0.6, '#2A2018'], [1, 'rgba(40,30,20,0)']]));
  const rnd = makeRng(9);
  for (let i = 0; i < 9; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 4 + rnd() * 8;
    fillPath(g, [[Math.cos(a) * r, Math.sin(a) * r], [Math.cos(a + 0.3) * (r + 3), Math.sin(a + 0.3) * (r + 3)], [Math.cos(a + 0.5) * r, Math.sin(a + 0.5) * r]], '#3A3430');
  }
  circle(g, 0, 0, 3, '#FF6A2A');
}

// ── Boss 船体 ──
function drawBossWhale(g) {
  // 主翼
  [-1, 1].forEach(side => {
    const wing = [[side * 22, -40], [side * 112, -6], [side * 114, 12], [side * 96, 22], [side * 24, 30]];
    fillPath(g, wing, lin(g, 0, 0, side * 114, 0, [[0, '#6C7C92'], [0.5, '#8C9CB2'], [1, '#4A586C']]));
    fillPath(g, wing, lin(g, 0, -40, 0, 30, [[0, 'rgba(255,255,255,0.12)'], [1, 'rgba(0,0,0,0.3)']]));
    // 装甲板
    for (let i = 0; i < 4; i++) {
      line(g, [[side * (34 + i * 18), -34 + i * 7], [side * (36 + i * 16), 27 - i * 1]], 'rgba(20,28,40,0.45)', 1);
    }
    line(g, [[side * 26, 6], [side * 108, 4]], 'rgba(20,28,40,0.45)', 1);
    // 翼尖橙条
    fillPath(g, [[side * 104, -9], [side * 112, -6], [side * 114, 12], [side * 106, 16]], '#D97757');
    // 引擎吊舱
    ellipse(g, side * 50, -26, 9, 18, lin(g, side * 41, 0, side * 59, 0, [[0, '#2E3644'], [0.5, '#7C8AA0'], [1, '#262C38']]));
    circle(g, side * 50, -43, 6, '#1A2030');
    circle(g, side * 50, -43, 4, '#6FD0FF');
    circle(g, side * 50, -43, 2, '#FFFFFF');
    // 部件安装座
    circle(g, side * 62, 18, 13, '#2A303C');
    circle(g, side * 62, 18, 10, '#3E4656');
    fillPath(g, [[side * 84, -32], [side * 108, -32], [side * 108, -4], [side * 84, -4]], '#2A303C');
  });
  // 主船体
  g.beginPath();
  g.moveTo(0, 84);
  g.bezierCurveTo(30, 70, 36, 20, 34, -40);
  g.bezierCurveTo(32, -70, 18, -84, 0, -84);
  g.bezierCurveTo(-18, -84, -32, -70, -34, -40);
  g.bezierCurveTo(-36, 20, -30, 70, 0, 84);
  g.closePath();
  g.fillStyle = lin(g, -36, 0, 36, 0, [[0, '#3C4858'], [0.3, '#A4B2C6'], [0.6, '#7C8AA0'], [1, '#323C4A']]);
  g.fill();
  // 背脊装甲 + 接缝
  fillPath(g, [[-12, -76], [12, -76], [16, 60], [-16, 60]], lin(g, -16, 0, 16, 0, [[0, '#4E5A6C'], [0.5, '#B4C0D2'], [1, '#46505E']]));
  for (let y = -60; y < 60; y += 14) line(g, [[-15, y], [15, y]], 'rgba(20,28,40,0.5)', 0.9);
  // 舰桥
  fillPath(g, [[-10, 54], [10, 54], [7, 72], [-7, 72]], '#2A3240');
  ellipse(g, 0, 66, 5, 4, lin(g, 0, 62, 0, 70, [[0, '#C8F0FF'], [1, '#2A6A8A']]));
  // 核心舱口
  circle(g, 0, 30, 22, '#232A36');
  circle(g, 0, 30, 20, '#353E4E');
  // 舰首标识
  fillPath(g, [[-6, -70], [6, -70], [6, -64], [-6, -64]], '#D97757');
}

function drawBossFortress(g) {
  // 外墙:十二边形混凝土平台
  const n = 12;
  const outer = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.PI / n;
    outer.push([Math.cos(a) * 126, Math.sin(a) * 98]);
  }
  fillPath(g, outer, lin(g, -126, -98, 126, 98, [[0, '#D8C8A0'], [0.5, '#A8946C'], [1, '#6E5E44']]));
  const wall = outer.map(([x, y]) => [x * 0.9, y * 0.88]);
  fillPath(g, wall, lin(g, -110, -86, 110, 86, [[0, '#7A6A4C'], [1, '#B8A47C']]));
  const floor = outer.map(([x, y]) => [x * 0.84, y * 0.8]);
  fillPath(g, floor, lin(g, 0, -80, 0, 80, [[0, '#B4A27C'], [1, '#9A8864']]));
  // 地面网格 + 警示条
  for (let x = -90; x <= 90; x += 30) line(g, [[x, -70], [x, 70]], 'rgba(80,64,40,0.35)', 0.8);
  for (let y = -60; y <= 60; y += 30) line(g, [[-100, y], [100, y]], 'rgba(80,64,40,0.35)', 0.8);
  for (let i = -5; i < 5; i++) {
    fillPath(g, [[i * 10, 74], [i * 10 + 5, 74], [i * 10 + 2, 80], [i * 10 - 3, 80]], i % 2 ? '#2A2418' : '#E0B030');
  }
  // 塔楼
  [[-104, 0], [104, 0], [0, -86], [0, 86]].forEach(([x, y]) => {
    circle(g, x, y, 10, lin(g, x - 10, y - 10, x + 10, y + 10, [[0, '#E0D0A8'], [1, '#6E5E44']]));
    circle(g, x, y, 5, '#4A3E2A');
  });
  // 部件安装座
  [[-80, -40], [80, -40], [-88, 46], [88, 46], [0, -62]].forEach(([x, y]) => {
    circle(g, x, y, 15, '#5A4C36');
    circle(g, x, y, 12, '#8A7A5A');
  });
  // 停机坪 H
  circle(g, -40, 10, 16, '#8A7A5E');
  g.strokeStyle = '#E8E0C8';
  g.lineWidth = 1.2;
  g.stroke();
  line(g, [[-46, 3], [-46, 17]], '#E8E0C8', 2);
  line(g, [[-34, 3], [-34, 17]], '#E8E0C8', 2);
  line(g, [[-46, 10], [-34, 10]], '#E8E0C8', 2);
  // 机库
  fillPath(g, [[24, -6], [62, -6], [62, 20], [24, 20]], lin(g, 24, 0, 62, 0, [[0, '#6E6A60'], [0.5, '#B8B2A2'], [1, '#5E5A50']]));
  for (let x = 28; x < 62; x += 5) line(g, [[x, -6], [x, 20]], 'rgba(40,36,30,0.5)', 0.8);
  // 中央穹顶(核心)
  circle(g, 0, 22, 26, '#4A3E2A');
  circle(g, 0, 22, 23, rad(g, 0, 22, 2, 23, [[0, '#C8BA98'], [1, '#6A5C42']], -7, 14));
}

function drawBossAurora(g) {
  // 新月形船体
  g.beginPath();
  g.moveTo(0, 70);
  g.bezierCurveTo(70, 66, 124, 30, 130, -40);
  g.bezierCurveTo(110, -20, 80, -30, 60, -60);
  g.bezierCurveTo(40, -80, 20, -92, 0, -92);
  g.bezierCurveTo(-20, -92, -40, -80, -60, -60);
  g.bezierCurveTo(-80, -30, -110, -20, -130, -40);
  g.bezierCurveTo(-124, 30, -70, 66, 0, 70);
  g.closePath();
  g.fillStyle = lin(g, -130, 0, 130, 0, [[0, '#121A30'], [0.3, '#3A4C78'], [0.5, '#56689A'], [0.7, '#34446C'], [1, '#0E1428']]);
  g.fill();
  g.fillStyle = lin(g, 0, -92, 0, 70, [[0, 'rgba(255,255,255,0.12)'], [1, 'rgba(0,0,0,0.35)']]);
  g.fill();
  // 发光能量线
  [-1, 1].forEach(side => {
    line(g, [[side * 12, 60], [side * 70, 40], [side * 120, -26]], '#5FF0FF', 1.4);
    line(g, [[side * 20, -80], [side * 56, -52], [side * 92, -34]], '#5FF0FF', 1);
    line(g, [[side * 16, 40], [side * 40, -40]], 'rgba(95,240,255,0.5)', 0.8);
    // 尾鳍
    fillPath(g, [[side * 30, -70], [side * 44, -96], [side * 50, -94], [side * 42, -62]], lin(g, side * 30, 0, side * 50, 0, [[0, '#3A4C78'], [1, '#121A30']]));
    // 部件安装座
    circle(g, side * 70, 40, 15, '#0E1428');
    circle(g, side * 110, -10, 12, '#0E1428');
    circle(g, side * 40, -52, 12, '#0E1428');
    // 引擎
    ellipse(g, side * 84, -50, 6, 10, '#0A1020', -side * 0.5);
    circle(g, side * 88, -58, 4, '#9AF8FF');
  });
  // 中央水晶核心座
  circle(g, 0, 14, 25, '#0A0E1E');
  circle(g, 0, 14, 22, '#1E2848');
  // 舰桥
  fillPath(g, [[-8, 48], [8, 48], [5, 62], [-5, 62]], '#1E2848');
  ellipse(g, 0, 56, 4, 3, '#9AF8FF');
}

// ── 子弹 / 特效 / 拾取物 ──
function drawPlayerBullet(g) {
  ellipse(g, 0, 0, 5.5, 12, rad(g, 0, 0, 0, 12, [[0, 'rgba(255,200,120,0.55)'], [1, 'rgba(255,120,40,0)']]));
  ellipse(g, 0, 0, 2, 8, lin(g, 0, -8, 0, 8, [[0, '#FFFFFF'], [0.5, '#FFE6A0'], [1, '#FF9A3C']]));
}

function drawMissile(g) {
  fillPath(g, [[-1.6, -7], [0, -9.5], [1.6, -7], [1.6, 6], [-1.6, 6]], lin(g, -1.6, 0, 1.6, 0, [[0, '#9AA0AA'], [0.5, '#FFFFFF'], [1, '#8A9098']]));
  fillPath(g, [[-1.6, -7], [0, -9.5], [1.6, -7]], '#E04A3A');
  fillPath(g, [[-1.6, 3], [-3.4, 7], [-1.6, 6]], '#5A6070');
  fillPath(g, [[1.6, 3], [3.4, 7], [1.6, 6]], '#5A6070');
}

function drawOrb(g, r, outer, mid) {
  circle(g, 0, 0, r, rad(g, 0, 0, 0, r, [[0, 'rgba(255,255,255,0.0)'], [0.55, mid], [0.8, outer], [1, 'rgba(0,0,0,0)']]));
  circle(g, 0, 0, r * 0.62, '#FFFFFF');
  circle(g, 0, 0, r * 0.62, 'rgba(0,0,0,0)');
  g.strokeStyle = outer;
  g.lineWidth = r * 0.16;
  g.stroke();
}

function drawNeedle(g) {
  ellipse(g, 0, 0, 3.6, 9, rad(g, 0, 0, 0, 9, [[0, 'rgba(120,230,255,0.9)'], [1, 'rgba(40,120,255,0)']]));
  ellipse(g, 0, 0, 1.6, 6.5, '#E8FFFF');
}

function drawGlow(g, rgb, r) {
  circle(g, 0, 0, r, rad(g, 0, 0, 0, r, [[0, `rgba(${rgb},1)`], [0.25, `rgba(${rgb},0.55)`], [0.6, `rgba(${rgb},0.15)`], [1, `rgba(${rgb},0)`]]));
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

function drawStar(g, R, big) {
  circle(g, 0, 0, R * 1.3, rad(g, 0, 0, 0, R * 1.3, [[0, big ? 'rgba(255,160,60,0.5)' : 'rgba(255,220,100,0.45)'], [1, 'rgba(255,200,80,0)']]));
  const pts = starPts(R, R * 0.45);
  path(g, pts);
  g.fillStyle = lin(g, 0, -R, 0, R, big ? [[0, '#FFF4C0'], [0.5, '#FFA03C'], [1, '#C0501A']] : [[0, '#FFFBE0'], [0.5, '#FFD040'], [1, '#C8860E']]);
  g.fill();
  g.strokeStyle = '#7A4A0A';
  g.lineWidth = 0.7;
  g.stroke();
  fillPath(g, starPts(R * 0.45, R * 0.2).map(([x, y]) => [x - R * 0.12, y - R * 0.18]), 'rgba(255,255,255,0.7)');
}

function drawCapsule(g, color, dark, label) {
  g.beginPath();
  g.moveTo(-6, -9);
  g.arc(0, -3, 6, Math.PI, 0);
  g.lineTo(6, 3);
  g.arc(0, 3, 6, 0, Math.PI);
  g.closePath();
  g.fillStyle = lin(g, -6, 0, 6, 0, [[0, dark], [0.4, color], [1, dark]]);
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.8)';
  g.lineWidth = 0.8;
  g.stroke();
  g.fillStyle = '#FFFFFF';
  if (label === '+') {
    g.fillRect(-1.2, -4.5, 2.4, 9);
    g.fillRect(-4.5, -1.2, 9, 2.4);
  } else {
    g.font = 'bold 10px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, 0, 0.5);
  }
}

function drawCloud(g, seed, w, h) {
  const rnd = makeRng(seed);
  for (let i = 0; i < 26; i++) {
    const x = (rnd() - 0.5) * w * 0.7;
    const y = (rnd() - 0.5) * h * 0.45;
    const r = h * (0.18 + rnd() * 0.22) * (1 - Math.abs(x) / w);
    circle(g, x, y, r, rad(g, x, y, 0, r, [[0, 'rgba(255,255,255,0.55)'], [0.6, 'rgba(240,246,255,0.3)'], [1, 'rgba(230,240,255,0)']], x - r * 0.3, y - r * 0.3));
  }
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
  const flash = { flash: true };
  const shadowed = { flash: true, shadow: true };

  [-2, -1, 0, 1, 2].forEach(b => add(`player${b}`, 54, 56, g => drawPlayer(g, b), b === 0 ? { shadow: true } : null));
  add('e_dart', 32, 34, drawDart, shadowed);
  add('e_gunship', 40, 52, drawGunship, shadowed);
  add('e_bomber', 72, 56, drawBomber, shadowed);
  add('e_cruiser', 112, 76, drawCruiser, shadowed);
  add('b_body', 22, 62, drawBoat, flash);
  add('k_body', 30, 38, drawTankBody, flash);
  add('k_head', 16, 34, drawTankHead, flash);
  add('t_base', 36, 36, drawTurretBase, flash);
  add('t_head', 18, 34, g => drawTurretHead(g, true), flash);
  add('p_pod', 26, 32, drawPod, flash);
  add('p_cannon', 26, 52, drawBigCannon, flash);
  add('p_core', 40, 40, g => drawCore(g, false), flash);
  add('p_core_open', 40, 40, g => drawCore(g, true), flash);
  add('p_wreck', 32, 32, drawWreck);
  add('boss1', 232, 172, drawBossWhale, { shadow: true });
  add('boss2', 256, 200, drawBossFortress);
  add('boss3', 264, 192, drawBossAurora, { shadow: true });

  add('pb', 12, 26, drawPlayerBullet);
  add('pm', 8, 20, drawMissile);
  add('eb', 16, 16, g => drawOrb(g, 7.6, '#FF2A6A', 'rgba(255,90,150,0.8)'));
  add('eb2', 12, 12, g => drawOrb(g, 5.6, '#FF7A1A', 'rgba(255,170,60,0.8)'));
  add('eb3', 8, 20, drawNeedle);
  add('star', 16, 16, g => drawStar(g, 6.5, false));
  add('star_big', 24, 24, g => drawStar(g, 9.5, true));
  add('pu_hp', 16, 22, g => drawCapsule(g, '#4CD08A', '#1E7A4A', '+'));
  add('pu_pow', 16, 22, g => drawCapsule(g, '#FF9A3C', '#B04A10', 'P'));

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
  all.sort((a, b) => b.h * b.s - a.h * a.s);
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
  all.forEach(it => {
    g.save();
    g.beginPath();
    g.rect(it.px, it.py, it.pw, it.ph);
    g.clip();
    const cx = it.px + it.pw / 2;
    const cy = it.py + it.ph / 2;
    if (it.variant === 'shadow') {
      // 抖动叠几次,得到柔边剪影
      [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([ox, oy]) => {
        g.save();
        g.translate(cx + ox, cy + oy);
        g.scale(it.s, it.s);
        it.draw(g);
        g.restore();
      });
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = '#000814';
      g.fillRect(it.px, it.py, it.pw, it.ph);
    } else {
      g.translate(cx, cy);
      g.scale(it.s, it.s);
      it.draw(g);
      if (it.variant === 'flash') {
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalCompositeOperation = 'source-atop';
        g.fillStyle = '#FFFFFF';
        g.fillRect(it.px, it.py, it.pw, it.ph);
      }
    }
    g.restore();
    rects[it.name] = { x: it.px, y: it.py, w: it.pw, h: it.ph, vw: it.w, vh: it.h };
  });
  return { canvas, rects };
}

module.exports = { buildArt };
