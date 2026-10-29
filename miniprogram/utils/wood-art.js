// ─── 木质 3D 美术(各游戏共用)────────────────────────────
// 斜 45° 俯视,光从左上来:格子里是一块有厚度的染色木块
// (顶面 + 南 / 东两个侧面),棋盘是一只带围边的胡桃木托盘。
// 方块按尺寸预渲染进离屏图集;托盘拆成"底板"(画在方块下面)
// 和"围边"(画在方块上面,正好挡住最右列 / 最底行的侧面)两层。
// 另有木板(drawSlab)、凹槽(drawSocket)、烙字(drawBurnedText)等零件。
// createCanvas(w, h) 由调用方提供(小程序里是 wx.createOffscreenCanvas),
// 纯绘图逻辑,不依赖 wx,可在浏览器里预览。

// 染色木:保留经典七色的色相,好辨认;X 是结束时淹没用的灰木
const WOOD = {
  I: '#4F9CC9', O: '#D58A4E', T: '#9466B5', S: '#6BA35B',
  Z: '#C9564A', J: '#4E6BA6', L: '#E0B552', X: '#8C8173',
};
const WOOD_TYPES = Object.keys(WOOD);
const VARIANTS = 4;               // 每种木块几种不同纹理

const FLOOR_WOOD = '#4A2C18';     // 托盘底板(深胡桃)
const FRAME_WOOD = '#8A5530';     // 托盘围边
const PANEL_WOOD = '#3E2514';     // HOLD / NEXT 小木槽

// ── 小工具 ────────────────────────────────────────────────
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp255(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

// amount > 0 向白混合,< 0 向黑混合
function shade(hex, amount) {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const target = amount >= 0 ? 255 : 0;
  const k = Math.abs(amount);
  return `rgb(${clamp255(r + (target - r) * k)}, ${clamp255(g + (target - g) * k)}, ${clamp255(b + (target - b) * k)})`;
}

function toHex(rgbStr) {
  const m = rgbStr.match(/\d+/g);
  return '#' + m.slice(0, 3).map(v => (+v).toString(16).padStart(2, '0')).join('');
}

function roundRectPath(g, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  g.moveTo(x + rr, y);
  g.lineTo(x + w - rr, y);
  g.arcTo(x + w, y, x + w, y + rr, rr);
  g.lineTo(x + w, y + h - rr);
  g.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  g.lineTo(x + rr, y + h);
  g.arcTo(x, y + h, x, y + h - rr, rr);
  g.lineTo(x, y + rr);
  g.arcTo(x, y, x + rr, y, rr);
  g.closePath();
}

// 不依赖 ctx.ellipse(部分基础库没有):四段贝塞尔近似
function ellipsePath(g, cx, cy, rx, ry) {
  const k = 0.5523;
  g.moveTo(cx + rx, cy);
  g.bezierCurveTo(cx + rx, cy + ry * k, cx + rx * k, cy + ry, cx, cy + ry);
  g.bezierCurveTo(cx - rx * k, cy + ry, cx - rx, cy + ry * k, cx - rx, cy);
  g.bezierCurveTo(cx - rx, cy - ry * k, cx - rx * k, cy - ry, cx, cy - ry);
  g.bezierCurveTo(cx + rx * k, cy - ry, cx + rx, cy - ry * k, cx + rx, cy);
  g.closePath();
}

function poly(g, pts) {
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.closePath();
}

// ── 木纹 ──────────────────────────────────────────────────
// 在矩形里铺一层木纹:底色 → 深浅软色带 → 波浪年轮细线 → 偶尔一个木节。
// 调用方负责裁剪形状;vertical 表示纹路沿竖直方向走。
function woodFill(g, x, y, w, h, base, rand, opts) {
  const o = opts || {};
  const vertical = !!o.vertical;
  const lines = o.lines || 6;
  const lw = o.lineWidth || 1;
  const contrast = o.contrast || 1;
  const len = vertical ? h : w;
  const span = vertical ? w : h;
  const at = (t, d) => (vertical ? [x + d, y + t] : [x + t, y + d]);

  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.fillStyle = base;
  g.fillRect(x, y, w, h);

  // 软色带:几条宽而淡的深浅条,模拟心材 / 边材的色差
  const bands = 2 + Math.floor(rand() * 3);
  for (let i = 0; i < bands; i++) {
    const d = rand() * span;
    const bw = span * (0.12 + rand() * 0.25);
    g.globalAlpha = 0.10 + rand() * 0.12;
    g.fillStyle = rand() < 0.5 ? shade(base, -0.35) : shade(base, 0.25);
    if (vertical) g.fillRect(x + d - bw / 2, y, bw, h);
    else g.fillRect(x, y + d - bw / 2, w, bw);
  }

  // 年轮细线:两层正弦叠加的波浪线
  const steps = 18;
  for (let i = 0; i < lines; i++) {
    const off = ((i + 0.2 + rand() * 0.6) / lines) * span;
    const amp = span * (0.01 + rand() * 0.03);
    const freq = ((0.3 + rand() * 0.7) * Math.PI * 2) / len;
    const ph = rand() * Math.PI * 2;
    g.globalAlpha = (0.25 + rand() * 0.35) * contrast;
    g.strokeStyle = shade(base, -(0.22 + rand() * 0.25));
    g.lineWidth = lw * (0.45 + rand() * 0.9);
    g.beginPath();
    for (let s = 0; s <= steps; s++) {
      const t = (s / steps) * len;
      const d = off + Math.sin(t * freq + ph) * amp + Math.sin(t * freq * 2.7 + ph * 1.7) * amp * 0.35;
      const [px, py] = at(t, d);
      if (s === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.stroke();
    // 每条深线旁边带一条亮线,纹理更立体
    if (rand() < 0.5) {
      g.globalAlpha *= 0.5;
      g.strokeStyle = shade(base, 0.22);
      g.lineWidth = lw * 0.4;
      g.beginPath();
      for (let s = 0; s <= steps; s++) {
        const t = (s / steps) * len;
        const d = off + lw * 0.9 + Math.sin(t * freq + ph) * amp + Math.sin(t * freq * 2.7 + ph * 1.7) * amp * 0.35;
        const [px, py] = at(t, d);
        if (s === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.stroke();
    }
  }

  // 木节
  if (rand() < (o.knot === undefined ? 0.2 : o.knot)) {
    const [kx, ky] = at(len * (0.2 + rand() * 0.6), span * (0.25 + rand() * 0.5));
    const kr = Math.min(w, h) * (0.06 + rand() * 0.06);
    for (let i = 3; i >= 1; i--) {
      g.globalAlpha = 0.22 + 0.12 * (3 - i);
      g.strokeStyle = shade(base, -0.4);
      g.lineWidth = lw * 0.6;
      g.beginPath();
      if (vertical) ellipsePath(g, kx, ky, kr * i * 0.7, kr * i * 1.6);
      else ellipsePath(g, kx, ky, kr * i * 1.6, kr * i * 0.7);
      g.stroke();
    }
    g.globalAlpha = 0.4;
    g.fillStyle = shade(base, -0.4);
    g.beginPath();
    ellipsePath(g, kx, ky, kr * (vertical ? 0.5 : 0.9), kr * (vertical ? 0.9 : 0.5));
    g.fill();
  }
  g.restore();
}

// ── 木块 ──────────────────────────────────────────────────
// 精灵坐标:顶面占 [0, c]²,南 / 东侧面往右下伸出 h,精灵总边长 c + h。
// 落在格子 (px, py) 上时,精灵画在 (px - h, py - h):顶面"抬高"后
// 往左上偏 h,侧面正好落在格子自己的范围里,相邻木块彼此遮挡关系正确。
function drawCube(g, ox, oy, c, h, base, rand, opts) {
  const lw = Math.max(0.6, c / 26);
  const o = opts || {};

  // 南侧面(朝向镜头,半阴影)
  g.save();
  poly(g, [ox, oy + c, ox + c, oy + c, ox + c + h, oy + c + h, ox + h, oy + c + h]);
  g.clip();
  woodFill(g, ox, oy + c, c + h, h, toHex(shade(base, -0.28)), rand, { lines: 2, lineWidth: lw, knot: 0 });
  const sg = g.createLinearGradient(0, oy + c, 0, oy + c + h);
  sg.addColorStop(0, 'rgba(30, 14, 4, 0.10)');
  sg.addColorStop(1, 'rgba(30, 14, 4, 0.38)');
  g.fillStyle = sg;
  g.fillRect(ox, oy + c, c + h, h);
  g.restore();

  // 东侧面(背光,最暗;竖纹)
  g.save();
  poly(g, [ox + c, oy, ox + c + h, oy + h, ox + c + h, oy + c + h, ox + c, oy + c]);
  g.clip();
  woodFill(g, ox + c, oy, h, c + h, toHex(shade(base, -0.45)), rand, { lines: 2, vertical: true, lineWidth: lw, knot: 0 });
  const eg = g.createLinearGradient(ox + c, 0, ox + c + h, 0);
  eg.addColorStop(0, 'rgba(20, 10, 2, 0.12)');
  eg.addColorStop(1, 'rgba(20, 10, 2, 0.40)');
  g.fillStyle = eg;
  g.fillRect(ox + c, oy, h, c + h);
  g.restore();

  // 侧面棱线
  g.save();
  g.strokeStyle = 'rgba(28, 14, 4, 0.55)';
  g.lineWidth = lw * 0.8;
  g.beginPath();
  g.moveTo(ox + c, oy + c);
  g.lineTo(ox + c + h, oy + c + h);
  g.stroke();
  g.restore();

  drawCubeTop(g, ox, oy, c, base, rand, o);
}

// 木块顶面(正对镜头的那一面):木纹 + 打光 + 倒角 + 清漆高光 + 描边
function drawCubeTop(g, ox, oy, c, base, rand, opts) {
  const lw = Math.max(0.6, c / 26);
  const o = opts || {};
  const r = c * (o.radius === undefined ? 0.12 : o.radius);
  g.save();
  g.beginPath();
  roundRectPath(g, ox, oy, c, c, r);
  g.clip();
  if (o.fine) {
    // 细纹:年轮多而细、对比低,再撒一层顺纹的短导管纹,近看更像真木头
    woodFill(g, ox, oy, c, c, base, rand, { lines: 10 + Math.floor(rand() * 4), lineWidth: lw * 0.55, knot: 0.12, contrast: 0.7 });
    g.lineWidth = Math.max(0.3, lw * 0.35);
    g.strokeStyle = shade(base, -0.32);
    for (let i = 0; i < 22; i++) {
      const px = ox + rand() * c;
      const py = oy + rand() * c;
      const len = c * (0.06 + rand() * 0.2);
      g.globalAlpha = 0.1 + rand() * 0.14;
      g.beginPath();
      g.moveTo(px, py);
      g.lineTo(px + len, py + (rand() - 0.5) * c * 0.02);
      g.stroke();
    }
    g.globalAlpha = 1;
  } else {
    woodFill(g, ox, oy, c, c, base, rand, { lines: 5 + Math.floor(rand() * 3), lineWidth: lw, knot: 0.18, contrast: 0.8 });
  }

  const lg = g.createLinearGradient(ox, oy, ox + c, oy + c);
  lg.addColorStop(0, 'rgba(255, 246, 225, 0.26)');
  lg.addColorStop(0.5, 'rgba(255, 246, 225, 0)');
  lg.addColorStop(1, 'rgba(40, 18, 2, 0.20)');
  g.fillStyle = lg;
  g.fillRect(ox, oy, c, c);

  const b = Math.max(1.2, c * 0.11);
  g.fillStyle = 'rgba(255, 244, 220, 0.38)';
  poly(g, [ox, oy, ox + c, oy, ox + c - b, oy + b, ox + b, oy + b]);
  g.fill();
  g.fillStyle = 'rgba(255, 244, 220, 0.18)';
  poly(g, [ox, oy, ox + b, oy + b, ox + b, oy + c - b, ox, oy + c]);
  g.fill();
  g.fillStyle = 'rgba(30, 14, 2, 0.20)';
  poly(g, [ox + c, oy, ox + c, oy + c, ox + c - b, oy + c - b, ox + c - b, oy + b]);
  g.fill();
  g.fillStyle = 'rgba(30, 14, 2, 0.30)';
  poly(g, [ox, oy + c, ox + b, oy + c - b, ox + c - b, oy + c - b, ox + c, oy + c]);
  g.fill();

  const gloss = g.createRadialGradient(ox + c * 0.32, oy + c * 0.28, 0, ox + c * 0.32, oy + c * 0.28, c * 0.6);
  gloss.addColorStop(0, 'rgba(255, 255, 255, 0.20)');
  gloss.addColorStop(1, 'rgba(255, 255, 255, 0)');
  g.fillStyle = gloss;
  g.fillRect(ox, oy, c, c);
  g.restore();

  g.save();
  g.strokeStyle = 'rgba(32, 16, 4, 0.6)';
  g.lineWidth = lw * 0.8;
  g.beginPath();
  roundRectPath(g, ox + lw * 0.4, oy + lw * 0.4, c - lw * 0.8, c - lw * 0.8, r);
  g.stroke();
  g.restore();
}

function cubeDepth(cell, ratio) {
  return Math.max(2, Math.round(cell * (ratio || 0.24)));
}

// 投在底板上的软影(左上来光 → 落在右下),叠三层越来越偏的半透明方块
function drawCastShadow(g, ox, oy, c, h, s) {
  g.save();
  g.fillStyle = 'rgb(12, 5, 0)';
  [0.35, 0.7, 1].forEach(t => {
    g.globalAlpha = 0.16;
    g.beginPath();
    roundRectPath(g, ox + h + s * t, oy + h + s * t, c, c, c * 0.15);
    g.fill();
  });
  g.restore();
}

// 某一尺寸的木块图集:行 = 木种,列 = 纹理变体。
// 每格 = 木块 + 右下的投影,精灵边长 S = cell + h + s。
// palette 默认是俄罗斯方块七色;opts.depth 是厚度比例,opts.radius 是顶面圆角比例,
// opts.decorate(g, key, cell) 可以在每块顶面上再画东西(如木箱的条板)
function buildCubeAtlas(createCanvas, cell, dpr, palette, opts) {
  const pal = palette || WOOD;
  const o = opts || {};
  const keys = Object.keys(pal);
  const variants = o.variants || VARIANTS;
  const h = cubeDepth(cell, o.depth);
  const sh = Math.max(1, Math.round(h * 0.8));
  const S = cell + h + sh;
  const slot = Math.ceil(S * dpr) + 2;
  const canvas = createCanvas(slot * variants, slot * keys.length);
  const g = canvas.getContext('2d');
  keys.forEach((key, row) => {
    for (let v = 0; v < variants; v++) {
      g.save();
      g.translate(v * slot + 1, row * slot + 1);
      g.scale(dpr, dpr);
      drawCastShadow(g, 0, 0, cell, h, sh);
      drawCube(g, 0, 0, cell, h, pal[key], rng(row * 131 + v * 17 + 7), { radius: o.radius });
      if (o.decorate) o.decorate(g, key, cell, rng(row * 71 + v * 13 + 3));
      g.restore();
    }
  });
  return {
    canvas, cell, h, S, slot, variants,
    rowOf: keys.reduce((m, t, i) => { m[t] = i; return m; }, {}),
  };
}

// 把木块画在格子 (px, py) 上;scale 用于消行收缩(绕顶面中心缩放)
function drawCubeAt(ctx, atlas, img, type, variant, px, py, alpha, scale) {
  const row = atlas.rowOf[type];
  if (row === undefined) return;
  const { S, h, slot, cell } = atlas;
  const k = scale === undefined ? 1 : scale;
  const size = S * k;
  if (size < 2) return;
  const cx = px - h + cell / 2;
  const cy = py - h + cell / 2;
  const dx = cx - (cell / 2) * k;
  const dy = cy - (cell / 2) * k;
  const prev = ctx.globalAlpha;
  if (alpha !== undefined && alpha !== 1) ctx.globalAlpha = prev * alpha;
  ctx.drawImage(img || atlas.canvas, (variant % (atlas.variants || VARIANTS)) * slot + 1, row * slot + 1, slot - 2, slot - 2, dx, dy, size, size);
  ctx.globalAlpha = prev;
}

// ── 托盘 ──────────────────────────────────────────────────
// 根据可用画布尺寸算格子与托盘各部分厚度
function trayMetrics(W, H, cols, rows, opts) {
  const o = opts || {};
  // 横向占用 ≈ cols + 2*0.6(围边)+ 0.4(外侧面);纵向同理
  const cell = Math.max(8, Math.min(o.maxCell || 30, Math.floor(Math.min(W / (cols + 1.65), H / (rows + 1.65)))));
  const h = cubeDepth(cell, o.depth);
  const F = Math.max(5, Math.round(cell * 0.6));
  const D = h + Math.max(2, Math.round(cell * 0.16));
  const width = cell * cols;
  const height = cell * rows;
  const totalW = width + F * 2 + D;
  const totalH = height + F * 2 + D;
  // (x, y) 是底板格子区的左上角;围边的开口比它整体往左上偏 h
  const x = Math.floor((W - totalW) / 2) + F + h;
  const y = Math.floor((H - totalH) / 2) + F + h;
  return { cell, h, F, D, width, height, x, y, cols, rows, floorWood: o.floorWood, grid: o.grid };
}

function frameBox(m) {
  return {
    x0: m.x - m.h - m.F,
    y0: m.y - m.h - m.F,
    x1: m.x + m.width - m.h + m.F,
    y1: m.y + m.height - m.h + m.F,
  };
}

// 底板层:桌面投影 + 木板底 + 刻槽网格 + 内壁(上 / 左)与阴影
function drawTrayFloor(g, m, rand) {
  const { x, y, cell, h, width, height, cols, rows, D } = m;
  const fb = frameBox(m);
  const lw = Math.max(0.6, cell / 26);

  // 托盘在桌面上的投影
  g.save();
  g.shadowColor = 'rgba(0, 0, 0, 0.55)';
  g.shadowBlur = cell * 0.8;
  g.shadowOffsetX = D * 0.6;
  g.shadowOffsetY = D;
  g.fillStyle = '#2A170B';
  g.beginPath();
  roundRectPath(g, fb.x0 + D * 0.5, fb.y0 + D * 0.5, fb.x1 - fb.x0, fb.y1 - fb.y0, cell * 0.35);
  g.fill();
  g.restore();

  // 开口区域(底板 + 两面内壁都在这里面)
  const hx = x - h;
  const hy = y - h;
  g.save();
  g.beginPath();
  g.rect(hx, hy, width, height);
  g.clip();

  // 竖向木板,每块两列宽,色调各有差别
  const plankW = cell * 2;
  for (let i = 0; i * plankW < width + h; i++) {
    const px = hx + i * plankW;
    const base = toHex(shade(m.floorWood || FLOOR_WOOD, (rand() - 0.5) * 0.18));
    woodFill(g, px, hy, plankW, height + h, base, rand, { vertical: true, lines: 5, lineWidth: lw, knot: 0.35 });
    g.fillStyle = 'rgba(12, 5, 0, 0.6)';
    g.fillRect(px - 0.5, hy, 1, height + h);
  }

  // 刻槽网格(格子落点):深线 + 右下一条亮线
  g.globalAlpha = 1;
  for (let c = 1; c < (m.grid === false ? 0 : cols); c++) {
    const gx = x + c * cell;
    g.fillStyle = 'rgba(10, 4, 0, 0.32)';
    g.fillRect(gx - 0.5, y, 1, height);
    g.fillStyle = 'rgba(255, 210, 160, 0.06)';
    g.fillRect(gx + 0.5, y, 1, height);
  }
  for (let r = 1; r < (m.grid === false ? 0 : rows); r++) {
    const gy = y + r * cell;
    g.fillStyle = 'rgba(10, 4, 0, 0.32)';
    g.fillRect(x, gy - 0.5, width, 1);
    g.fillStyle = 'rgba(255, 210, 160, 0.06)';
    g.fillRect(x, gy + 0.5, width, 1);
  }

  // 内壁投在底板上的阴影(左上来光)
  const ts = g.createLinearGradient(0, y, 0, y + cell * 0.9);
  ts.addColorStop(0, 'rgba(10, 4, 0, 0.55)');
  ts.addColorStop(1, 'rgba(10, 4, 0, 0)');
  g.fillStyle = ts;
  g.fillRect(hx, y, width + h, cell * 0.9);
  const ls = g.createLinearGradient(x, 0, x + cell * 0.9, 0);
  ls.addColorStop(0, 'rgba(10, 4, 0, 0.45)');
  ls.addColorStop(1, 'rgba(10, 4, 0, 0)');
  g.fillStyle = ls;
  g.fillRect(x, hy, cell * 0.9, height + h);

  // 上内壁(朝南,半阴影)
  g.save();
  poly(g, [hx, hy, hx + width + h, hy, x + width, y, x, y]);
  g.clip();
  woodFill(g, hx, hy, width + h, h, toHex(shade(FRAME_WOOD, -0.3)), rand, { lines: 2, lineWidth: lw, knot: 0 });
  g.fillStyle = 'rgba(20, 8, 0, 0.25)';
  g.fillRect(hx, hy, width + h, h);
  g.restore();
  // 左内壁(朝东,背光)
  g.save();
  poly(g, [hx, hy, x, y, x, y + height, hx, hy + height]);
  g.clip();
  woodFill(g, hx, hy, h, height + h, toHex(shade(FRAME_WOOD, -0.45)), rand, { lines: 2, vertical: true, lineWidth: lw, knot: 0 });
  g.fillStyle = 'rgba(20, 8, 0, 0.3)';
  g.fillRect(hx, hy, h, height + h);
  g.restore();
  g.strokeStyle = 'rgba(15, 6, 0, 0.5)';
  g.lineWidth = lw;
  g.beginPath();
  g.moveTo(hx, hy);
  g.lineTo(x, y);
  g.stroke();

  g.restore();
}

// 围边层:外侧面 + 画框式斜接的四条边 + 倒角 + 角钉;中间开口镂空
function drawTrayRim(g, m, rand) {
  const { x, y, cell, h, width, height, D } = m;
  const fb = frameBox(m);
  const hx = x - h;
  const hy = y - h;
  const hx1 = hx + width;
  const hy1 = hy + height;
  const R = cell * 0.35;
  const lw = Math.max(0.6, cell / 26);

  // 外侧面(南 / 东),先画,被顶面盖住接缝
  g.save();
  poly(g, [fb.x0 + R * 0.3, fb.y1, fb.x1, fb.y1, fb.x1 + D, fb.y1 + D, fb.x0 + D + R * 0.3, fb.y1 + D]);
  g.clip();
  woodFill(g, fb.x0, fb.y1, fb.x1 - fb.x0 + D, D, toHex(shade(FRAME_WOOD, -0.3)), rand, { lines: 3, lineWidth: lw, knot: 0 });
  const sg = g.createLinearGradient(0, fb.y1, 0, fb.y1 + D);
  sg.addColorStop(0, 'rgba(20, 8, 0, 0.15)');
  sg.addColorStop(1, 'rgba(20, 8, 0, 0.5)');
  g.fillStyle = sg;
  g.fillRect(fb.x0, fb.y1, fb.x1 - fb.x0 + D, D);
  g.restore();
  g.save();
  poly(g, [fb.x1, fb.y0 + R * 0.3, fb.x1 + D, fb.y0 + D + R * 0.3, fb.x1 + D, fb.y1 + D, fb.x1, fb.y1]);
  g.clip();
  woodFill(g, fb.x1, fb.y0, D, fb.y1 - fb.y0 + D, toHex(shade(FRAME_WOOD, -0.48)), rand, { lines: 3, vertical: true, lineWidth: lw, knot: 0 });
  g.fillStyle = 'rgba(20, 8, 0, 0.3)';
  g.fillRect(fb.x1, fb.y0, D, fb.y1 - fb.y0 + D);
  g.restore();

  // 顶面环形路径:外圆角矩形顺时针 + 开口逆时针(非零环绕即可镂空)
  const ring = () => {
    g.beginPath();
    roundRectPath(g, fb.x0, fb.y0, fb.x1 - fb.x0, fb.y1 - fb.y0, R);
    g.moveTo(hx, hy);
    g.lineTo(hx, hy1);
    g.lineTo(hx1, hy1);
    g.lineTo(hx1, hy);
    g.closePath();
  };

  g.save();
  ring();
  g.clip();
  // 四条斜接木条:上下横纹,左右竖纹
  const bars = [
    { pts: [fb.x0, fb.y0, fb.x1, fb.y0, hx1, hy, hx, hy], rect: [fb.x0, fb.y0, fb.x1 - fb.x0, hy - fb.y0], v: false },
    { pts: [fb.x0, fb.y1, hx, hy1, hx1, hy1, fb.x1, fb.y1], rect: [fb.x0, hy1, fb.x1 - fb.x0, fb.y1 - hy1], v: false },
    { pts: [fb.x0, fb.y0, hx, hy, hx, hy1, fb.x0, fb.y1], rect: [fb.x0, fb.y0, hx - fb.x0, fb.y1 - fb.y0], v: true },
    { pts: [fb.x1, fb.y0, fb.x1, fb.y1, hx1, hy1, hx1, hy], rect: [hx1, fb.y0, fb.x1 - hx1, fb.y1 - fb.y0], v: true },
  ];
  bars.forEach((bar, i) => {
    g.save();
    poly(g, bar.pts);
    g.clip();
    const base = toHex(shade(FRAME_WOOD, (i % 2 ? -0.04 : 0.04)));
    woodFill(g, bar.rect[0], bar.rect[1], bar.rect[2], bar.rect[3], base, rand, {
      vertical: bar.v, lines: bar.v ? 3 : 4, lineWidth: lw, knot: 0.5,
    });
    g.restore();
    // 斜接缝
    g.strokeStyle = 'rgba(25, 10, 0, 0.45)';
    g.lineWidth = lw * 0.7;
    g.beginPath();
    g.moveTo(bar.pts[0], bar.pts[1]);
    g.lineTo(bar.pts[6], bar.pts[7]);
    g.stroke();
  });
  // 整体打光
  const lg = g.createLinearGradient(fb.x0, fb.y0, fb.x1, fb.y1);
  lg.addColorStop(0, 'rgba(255, 236, 200, 0.22)');
  lg.addColorStop(0.5, 'rgba(255, 236, 200, 0)');
  lg.addColorStop(1, 'rgba(30, 12, 0, 0.22)');
  g.fillStyle = lg;
  g.fillRect(fb.x0, fb.y0, fb.x1 - fb.x0, fb.y1 - fb.y0);
  g.restore();

  // 外沿倒角:左上亮、右下暗
  const e = Math.max(1, cell * 0.08);
  g.save();
  g.lineWidth = e;
  g.strokeStyle = 'rgba(255, 230, 190, 0.35)';
  g.beginPath();
  g.moveTo(fb.x0 + e / 2, fb.y1 - R);
  g.lineTo(fb.x0 + e / 2, fb.y0 + R);
  g.arcTo(fb.x0 + e / 2, fb.y0 + e / 2, fb.x0 + R, fb.y0 + e / 2, R - e / 2);
  g.lineTo(fb.x1 - R, fb.y0 + e / 2);
  g.stroke();
  g.strokeStyle = 'rgba(25, 10, 0, 0.35)';
  g.beginPath();
  g.moveTo(fb.x1 - e / 2, fb.y0 + R);
  g.lineTo(fb.x1 - e / 2, fb.y1 - R);
  g.arcTo(fb.x1 - e / 2, fb.y1 - e / 2, fb.x1 - R, fb.y1 - e / 2, R - e / 2);
  g.lineTo(fb.x0 + R, fb.y1 - e / 2);
  g.stroke();
  // 开口内沿:上 / 左内沿是往下折的棱,亮一点;下 / 右压在方块上,深色
  g.lineWidth = lw;
  g.strokeStyle = 'rgba(255, 225, 180, 0.28)';
  g.beginPath();
  g.moveTo(hx, hy1);
  g.lineTo(hx, hy);
  g.lineTo(hx1, hy);
  g.stroke();
  g.strokeStyle = 'rgba(20, 8, 0, 0.6)';
  g.beginPath();
  g.moveTo(hx1, hy);
  g.lineTo(hx1, hy1);
  g.lineTo(hx, hy1);
  g.stroke();
  g.restore();

  // 四角黄铜钉
  const nr = Math.max(1.5, cell * 0.13);
  const nails = [
    [(fb.x0 + hx) / 2, (fb.y0 + hy) / 2], [(fb.x1 + hx1) / 2, (fb.y0 + hy) / 2],
    [(fb.x0 + hx) / 2, (fb.y1 + hy1) / 2], [(fb.x1 + hx1) / 2, (fb.y1 + hy1) / 2],
  ];
  nails.forEach(([nx, ny]) => {
    g.save();
    g.fillStyle = 'rgba(20, 8, 0, 0.45)';
    g.beginPath();
    g.arc(nx + nr * 0.25, ny + nr * 0.35, nr, 0, Math.PI * 2);
    g.fill();
    const ng = g.createRadialGradient(nx - nr * 0.35, ny - nr * 0.35, nr * 0.1, nx, ny, nr);
    ng.addColorStop(0, '#FFF1C2');
    ng.addColorStop(0.45, '#D9A93F');
    ng.addColorStop(1, '#7A5212');
    g.fillStyle = ng;
    g.beginPath();
    g.arc(nx, ny, nr, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(70, 40, 5, 0.7)';
    g.lineWidth = Math.max(0.5, nr * 0.25);
    g.beginPath();
    g.moveTo(nx - nr * 0.55, ny + nr * 0.55);
    g.lineTo(nx + nr * 0.55, ny - nr * 0.55);
    g.stroke();
    g.restore();
  });
}

// 托盘两层静态图,尺寸与棋盘画布一致
function buildTray(createCanvas, W, H, dpr, m) {
  const make = (fn, seed) => {
    const canvas = createCanvas(Math.round(W * dpr), Math.round(H * dpr));
    const g = canvas.getContext('2d');
    g.scale(dpr, dpr);
    fn(g, m, rng(seed));
    return canvas;
  };
  return { floor: make(drawTrayFloor, 2024), rim: make(drawTrayRim, 77) };
}

// HOLD / NEXT 小木槽:凹进去的深色木板 + 内阴影
function drawPanel(g, w, h) {
  const rand = rng(Math.round(w * 13 + h * 7));
  const r = Math.min(10, w * 0.08);
  g.save();
  g.beginPath();
  roundRectPath(g, 0, 0, w, h, r);
  g.clip();
  woodFill(g, 0, 0, w, h, PANEL_WOOD, rand, { lines: 7, lineWidth: 0.8, knot: 0.4 });
  const ts = g.createLinearGradient(0, 0, 0, 10);
  ts.addColorStop(0, 'rgba(8, 3, 0, 0.6)');
  ts.addColorStop(1, 'rgba(8, 3, 0, 0)');
  g.fillStyle = ts;
  g.fillRect(0, 0, w, 10);
  const ls = g.createLinearGradient(0, 0, 8, 0);
  ls.addColorStop(0, 'rgba(8, 3, 0, 0.45)');
  ls.addColorStop(1, 'rgba(8, 3, 0, 0)');
  g.fillStyle = ls;
  g.fillRect(0, 0, 8, h);
  g.fillStyle = 'rgba(255, 220, 170, 0.12)';
  g.fillRect(0, h - 1.5, w, 1.5);
  g.fillRect(w - 1.5, 0, 1.5, h);
  g.restore();
}

// ── 通用零件 ──────────────────────────────────────────────

// 凸起的木板(棋盘底座 / 木牌):顶面 + 右下两个侧面 + 桌面投影,可选四角铜钉
function drawSlab(g, x, y, w, h, o) {
  const opt = o || {};
  const base = opt.base || FRAME_WOOD;
  const d = opt.depth === undefined ? Math.max(3, Math.round(Math.min(w, h) * 0.03)) : opt.depth;
  const r = opt.radius === undefined ? Math.min(w, h) * 0.05 : opt.radius;
  const rand = rng(opt.seed || 91);
  const lw = Math.max(0.6, Math.min(w, h) / 300);

  // 桌面投影
  g.save();
  g.shadowColor = 'rgba(0, 0, 0, 0.5)';
  g.shadowBlur = d * 3;
  g.shadowOffsetX = d * 0.8;
  g.shadowOffsetY = d * 1.4;
  g.fillStyle = '#2A170B';
  g.beginPath();
  roundRectPath(g, x + d * 0.5, y + d * 0.5, w, h, r);
  g.fill();
  g.restore();

  // 侧面:整块往右下错开 d 画一遍深色,再盖顶面
  g.save();
  g.beginPath();
  roundRectPath(g, x + d, y + d, w, h, r);
  g.clip();
  woodFill(g, x, y, w + d, h + d, toHex(shade(base, -0.42)), rand, { lines: 6, lineWidth: lw, knot: 0 });
  g.fillStyle = 'rgba(20, 8, 0, 0.25)';
  g.fillRect(x, y, w + d, h + d);
  g.restore();
  for (let i = 1; i < d; i++) {
    g.save();
    g.beginPath();
    roundRectPath(g, x + i, y + i, w, h, r);
    g.fillStyle = toHex(shade(base, -0.38 - 0.1 * (i / d)));
    g.globalAlpha = 0.9;
    g.fill();
    g.restore();
  }

  // 顶面
  g.save();
  g.beginPath();
  roundRectPath(g, x, y, w, h, r);
  g.clip();
  woodFill(g, x, y, w, h, base, rand, { lines: opt.lines || 12, lineWidth: lw * 1.2, knot: 0.6 });
  const lg = g.createLinearGradient(x, y, x + w, y + h);
  lg.addColorStop(0, 'rgba(255, 236, 200, 0.2)');
  lg.addColorStop(0.5, 'rgba(255, 236, 200, 0)');
  lg.addColorStop(1, 'rgba(30, 12, 0, 0.22)');
  g.fillStyle = lg;
  g.fillRect(x, y, w, h);
  g.restore();

  // 倒角:左上亮、右下暗
  const e = Math.max(1, d * 0.4);
  g.save();
  g.lineWidth = e;
  g.strokeStyle = 'rgba(255, 230, 190, 0.32)';
  g.beginPath();
  g.moveTo(x + e / 2, y + h - r);
  g.lineTo(x + e / 2, y + r);
  g.arcTo(x + e / 2, y + e / 2, x + r, y + e / 2, Math.max(0, r - e / 2));
  g.lineTo(x + w - r, y + e / 2);
  g.stroke();
  g.strokeStyle = 'rgba(25, 10, 0, 0.35)';
  g.beginPath();
  g.moveTo(x + w - e / 2, y + r);
  g.lineTo(x + w - e / 2, y + h - r);
  g.arcTo(x + w - e / 2, y + h - e / 2, x + w - r, y + h - e / 2, Math.max(0, r - e / 2));
  g.lineTo(x + r, y + h - e / 2);
  g.stroke();
  g.restore();

  if (opt.nails) {
    const nr = Math.max(1.5, opt.nails);
    const inset = nr * 2.4;
    [[x + inset, y + inset], [x + w - inset, y + inset], [x + inset, y + h - inset], [x + w - inset, y + h - inset]]
      .forEach(([nx, ny]) => drawNail(g, nx, ny, nr));
  }
}

// 黄铜钉
function drawNail(g, nx, ny, nr) {
  g.save();
  g.fillStyle = 'rgba(20, 8, 0, 0.45)';
  g.beginPath();
  g.arc(nx + nr * 0.25, ny + nr * 0.35, nr, 0, Math.PI * 2);
  g.fill();
  const ng = g.createRadialGradient(nx - nr * 0.35, ny - nr * 0.35, nr * 0.1, nx, ny, nr);
  ng.addColorStop(0, '#FFF1C2');
  ng.addColorStop(0.45, '#D9A93F');
  ng.addColorStop(1, '#7A5212');
  g.fillStyle = ng;
  g.beginPath();
  g.arc(nx, ny, nr, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(70, 40, 5, 0.7)';
  g.lineWidth = Math.max(0.5, nr * 0.25);
  g.beginPath();
  g.moveTo(nx - nr * 0.55, ny + nr * 0.55);
  g.lineTo(nx + nr * 0.55, ny - nr * 0.55);
  g.stroke();
  g.restore();
}

// 挖进木板里的方槽:深色底 + 上 / 左内壁阴影 + 下 / 右沿一道亮边
function drawSocket(g, x, y, s, o) {
  const opt = o || {};
  const r = s * (opt.radius === undefined ? 0.1 : opt.radius);
  const base = opt.base || PANEL_WOOD;
  const rand = rng(opt.seed || Math.round(x * 7 + y * 13));
  const d = Math.max(2, s * 0.08);
  g.save();
  g.beginPath();
  roundRectPath(g, x, y, s, s, r);
  g.clip();
  woodFill(g, x, y, s, s, base, rand, { lines: 4, lineWidth: Math.max(0.6, s / 60), knot: 0 });
  const ts = g.createLinearGradient(0, y, 0, y + d * 2.2);
  ts.addColorStop(0, 'rgba(8, 3, 0, 0.7)');
  ts.addColorStop(1, 'rgba(8, 3, 0, 0)');
  g.fillStyle = ts;
  g.fillRect(x, y, s, d * 2.2);
  const ls = g.createLinearGradient(x, 0, x + d * 1.8, 0);
  ls.addColorStop(0, 'rgba(8, 3, 0, 0.5)');
  ls.addColorStop(1, 'rgba(8, 3, 0, 0)');
  g.fillStyle = ls;
  g.fillRect(x, y, d * 1.8, s);
  g.restore();
  g.save();
  g.strokeStyle = 'rgba(255, 225, 180, 0.22)';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(x + s - 0.5, y + r);
  g.lineTo(x + s - 0.5, y + s - r);
  g.moveTo(x + r, y + s - 0.5);
  g.lineTo(x + s - r, y + s - 0.5);
  g.stroke();
  g.restore();
}

// 烙在木头上的字:深色字 + 下方一道亮边(刻痕的受光面);
// light 为真时是嵌进深色木头里的浅色字
function drawBurnedText(g, text, cx, cy, size, opt) {
  const o = opt || {};
  g.save();
  g.font = `bold ${Math.round(size)}px ${o.font || 'monospace'}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const off = Math.max(0.8, size * 0.05);
  if (o.light) {
    g.fillStyle = 'rgba(30, 12, 2, 0.6)';
    g.fillText(text, cx, cy - off);
    g.fillStyle = o.color || '#FFF2DA';
    g.fillText(text, cx, cy);
  } else {
    g.fillStyle = 'rgba(255, 238, 205, 0.45)';
    g.fillText(text, cx, cy + off);
    g.fillStyle = o.color || '#3A1F0C';
    g.fillText(text, cx, cy);
  }
  g.restore();
}

module.exports = {
  WOOD,
  VARIANTS,
  FLOOR_WOOD,
  FRAME_WOOD,
  PANEL_WOOD,
  rng,
  shade,
  toHex,
  roundRectPath,
  poly,
  woodFill,
  drawCube,
  drawCubeTop,
  drawCastShadow,
  cubeDepth,
  buildCubeAtlas,
  drawCubeAt,
  trayMetrics,
  buildTray,
  drawPanel,
  drawSlab,
  drawNail,
  drawSocket,
  drawBurnedText,
};
