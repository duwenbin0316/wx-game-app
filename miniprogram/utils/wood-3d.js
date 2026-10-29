// ─── 木质透视 3D(俄罗斯方块用)─────────────────────────────
// 不再是"所有木块都往同一个方向斜出厚度"的固定贴图,而是一台真正的透视镜头
// 往一只木槽里看:
//   · 世界坐标以格为单位,x 向右、y 向下、z 朝向镜头;槽底在 z = 0,
//     木块占 z ∈ [0, depth],正面在 z = depth。
//   · 镜头在 (camX, camY, camZ)。投影时让 z = depth 的平面缩放恰好为 1,
//     所以木块正面永远落在格子上、不随镜头晃动(操作手感不受影响),
//     只有侧面、槽底、内壁会随镜头位置变化——镜头右边的木块露出左侧面,
//     镜头上方的露出底面,离镜头越远露得越多。
//   · 相邻木块之间贴在一起的面是看不见的(真 3D 里它们在内部),直接剔掉;
//     剩下的侧面都在正面的后面,所以先画所有侧面、再画所有正面就不会穿插。
// 侧面是梯形,但木块很薄、镜头较远,前后两条边只差几个百分点,
// 用仿射变换把预渲染的侧面纹理贴成平行四边形即可(误差不到 1 像素)。
// 纯绘图逻辑,不依赖 wx;createCanvas(w, h) 由调用方提供。
const {
  WOOD, VARIANTS, FLOOR_WOOD, FRAME_WOOD, rng, shade, toHex, roundRectPath, poly, woodFill, drawCubeTop, drawNail,
} = require('./wood-art.js');

const DEPTH = 0.7;       // 木块厚度(格)
const CAM_Z = 22;        // 镜头离槽底多远(格):越小透视越夸张
const FRAME = 0.62;      // 托盘围边宽度(格)

// 侧面朝向:上 / 左 / 右 / 下;光从左上前方来,上面最亮、下面最暗
const SIDES = ['top', 'left', 'right', 'bottom'];
const SIDE_LIGHT = { top: -0.04, left: -0.18, right: -0.4, bottom: -0.5 };

// 透视镜头。ox / oy 是棋盘(正面平面)左上角的屏幕坐标,cell 是格子像素
function makeView(o) {
  return {
    ox: o.ox, oy: o.oy, cell: o.cell, cols: o.cols, rows: o.rows,
    depth: o.depth || DEPTH,
    camZ: o.camZ || CAM_Z,
    camX: o.camX === undefined ? o.cols / 2 : o.camX,
    camY: o.camY === undefined ? o.rows / 2 : o.camY,
    dpr: o.dpr || 1,
    // 画布当前已有的平移(比如震屏),setTransform 时要带上
    tx: 0,
    ty: 0,
  };
}

// z 处的缩放(相对正面平面)
function scaleAt(v, z) {
  return (v.camZ - v.depth) / (v.camZ - z);
}

// 世界点 → 屏幕
function project(v, x, y, z) {
  const s = scaleAt(v, z);
  return [v.ox + (v.camX + (x - v.camX) * s) * v.cell, v.oy + (v.camY + (y - v.camY) * s) * v.cell];
}

// 给俄罗斯方块棋盘排版:正面网格居中,四周留出围边
function wellMetrics(W, H, cols, rows, opts) {
  const o = opts || {};
  const cell = Math.max(8, Math.min(o.maxCell || 30, Math.floor(Math.min(W / (cols + FRAME * 2), H / (rows + FRAME * 2)))));
  const width = cell * cols;
  const height = cell * rows;
  return {
    cell, width, height, cols, rows, h: 0,
    x: Math.round((W - width) / 2),
    y: Math.round((H - height) / 2),
    F: Math.max(5, Math.round(cell * FRAME)),
  };
}

// ── 木块图集 ──────────────────────────────────────────────
// 每个木种一行:前 VARIANTS 格是正面(不同纹理),后 4 格是上 / 左 / 右 / 下侧面纹理。
// 侧面纹理 u 沿正面的那条棱,v 从前棱(0)走到槽底(1):前棱一道亮边,越往里越暗
// 侧面在屏幕上只有零点几格宽,纹理会被压扁,所以这里的细节都往"压扁后还看得清"的方向做:
// 纹路细而少;前棱一道倒角亮边 + 下面一道细暗线;两端各一道深色接缝,
// 并排的木块侧面不会连成一整条木板
function paintSide(g, c, base, rand, light) {
  const lw = Math.max(0.5, c / 34);
  woodFill(g, 0, 0, c, c, toHex(shade(base, light)), rand, { lines: 4, lineWidth: lw, knot: 0, contrast: 0.7 });
  const ao = g.createLinearGradient(0, 0, 0, c);
  ao.addColorStop(0, 'rgba(255, 240, 215, 0.1)');
  ao.addColorStop(0.35, 'rgba(255, 240, 215, 0)');
  ao.addColorStop(1, 'rgba(18, 8, 0, 0.5)');
  g.fillStyle = ao;
  g.fillRect(0, 0, c, c);
  // 前棱倒角
  const bev = Math.max(1, c * 0.14);
  const bg = g.createLinearGradient(0, 0, 0, bev);
  bg.addColorStop(0, light > -0.2 ? 'rgba(255, 242, 215, 0.55)' : 'rgba(255, 242, 215, 0.22)');
  bg.addColorStop(1, 'rgba(255, 242, 215, 0)');
  g.fillStyle = bg;
  g.fillRect(0, 0, c, bev);
  g.fillStyle = 'rgba(30, 12, 0, 0.18)';
  g.fillRect(0, bev, c, Math.max(0.5, c * 0.025));
  // 两端接缝:中间深、两侧各带一点亮边
  const sw = Math.max(1, c * 0.05);
  g.fillStyle = 'rgba(22, 9, 0, 0.6)';
  g.fillRect(0, 0, sw, c);
  g.fillRect(c - sw, 0, sw, c);
  g.fillStyle = 'rgba(255, 235, 200, 0.14)';
  g.fillRect(sw, 0, sw * 0.6, c);
}

function buildBlockAtlas(createCanvas, cell, dpr, palette) {
  const pal = palette || WOOD;
  const keys = Object.keys(pal);
  const slot = Math.ceil(cell * dpr) + 2;
  const cols = VARIANTS + SIDES.length;
  const canvas = createCanvas(slot * cols, slot * keys.length);
  const g = canvas.getContext('2d');
  keys.forEach((key, row) => {
    for (let i = 0; i < cols; i++) {
      g.save();
      g.translate(i * slot + 1, row * slot + 1);
      g.scale(dpr, dpr);
      if (i < VARIANTS) {
        drawCubeTop(g, 0, 0, cell, pal[key], rng(row * 131 + i * 17 + 7), { radius: 0.1, fine: true });
      } else {
        const side = SIDES[i - VARIANTS];
        paintSide(g, cell, pal[key], rng(row * 53 + i * 29 + 11), SIDE_LIGHT[side]);
      }
      g.restore();
    }
  });
  return {
    canvas, cell, slot, dpr,
    rowOf: keys.reduce((m, t, i) => { m[t] = i; return m; }, {}),
  };
}

// ── 木块 ──────────────────────────────────────────────────
// blocks: [{ x, y, key: 'T2', alpha?, scale?, n? }]
//   x / y 是格坐标(可以是小数,如消行后下落);scale 用于消行收缩;
//   n 是被邻居挡住的面(1 上 / 2 下 / 4 左 / 8 右),这些面不画
function drawBlocks(ctx, v, atlas, img, blocks) {
  const src = img || atlas.canvas;
  const { cell, camX, camY, dpr, depth, tx, ty } = v;
  const slot = atlas.slot;
  const sw = slot - 2;
  const list = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const row = atlas.rowOf[b.key[0]];
    const k = b.scale === undefined ? 1 : b.scale;
    if (row === undefined || k <= 0.03) continue;
    list.push({ b, row, k });
  }

  ctx.save();
  // 第一遍:侧面
  for (let i = 0; i < list.length; i++) {
    const { b, row, k } = list[i];
    const x0 = b.x + (1 - k) / 2;
    const y0 = b.y + (1 - k) / 2;
    const x1 = x0 + k;
    const y1 = y0 + k;
    const sb = scaleAt(v, depth * (1 - k));
    const n = b.n || 0;
    ctx.globalAlpha = b.alpha === undefined ? 1 : b.alpha;
    const sy = row * slot + 1;
    // 前棱 (ax, ay) → (bx, by),从 (ax, ay) 往槽底方向贴纹理
    const face = (side, ax, ay, bx, by) => {
      const px = v.ox + ax * cell;
      const py = v.oy + ay * cell;
      const qx = v.ox + (camX + (ax - camX) * sb) * cell;
      const qy = v.oy + (camY + (ay - camY) * sb) * cell;
      ctx.setTransform((bx - ax) * cell * dpr, (by - ay) * cell * dpr, (qx - px) * dpr, (qy - py) * dpr, (px + tx) * dpr, (py + ty) * dpr);
      ctx.drawImage(src, (VARIANTS + side) * slot + 1, sy, sw, sw, 0, 0, 1, 1);
    };
    if (y0 > camY && !(n & 1)) face(0, x0, y0, x1, y0);
    if (y1 < camY && !(n & 2)) face(3, x0, y1, x1, y1);
    if (x0 > camX && !(n & 4)) face(1, x0, y0, x0, y1);
    if (x1 < camX && !(n & 8)) face(2, x1, y0, x1, y1);
  }
  // 第二遍:正面(都在最前面的平面上,盖住所有侧面)
  ctx.setTransform(dpr, 0, 0, dpr, tx * dpr, ty * dpr);
  for (let i = 0; i < list.length; i++) {
    const { b, row, k } = list[i];
    const variant = (+b.key[1] || 0) % VARIANTS;
    ctx.globalAlpha = b.alpha === undefined ? 1 : b.alpha;
    ctx.drawImage(src, variant * slot + 1, row * slot + 1, sw, sw,
      v.ox + (b.x + (1 - k) / 2) * cell, v.oy + (b.y + (1 - k) / 2) * cell, k * cell, k * cell);
  }
  ctx.restore();
}

// 木块投在槽底的影子:光从左上前方来,影子落在右下;所有块的影子并成一个路径一次填充,
// 重叠处不会越叠越黑
function drawFloorShadows(ctx, v, blocks) {
  const s0 = scaleAt(v, 0);
  const size = s0 * v.cell;
  ctx.save();
  [[0.14, 0.2, 0.34], [0.3, 0.4, 0.16]].forEach(([dx, dy, a]) => {
    ctx.beginPath();
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.scale !== undefined && b.scale < 0.4) continue;
      const X = v.ox + (v.camX + (b.x + dx - v.camX) * s0) * v.cell;
      const Y = v.oy + (v.camY + (b.y + dy - v.camY) * s0) * v.cell;
      ctx.rect(X, Y, size, size);
    }
    ctx.fillStyle = `rgba(8, 3, 0, ${a})`;
    ctx.fill();
  });
  ctx.restore();
}

// 正面的清漆反光:一大片柔和高光只铺在木块正面上,位置跟着镜头反向滑动,
// 歪手机 / 方块移动时反光在木块上流过去
function drawFrontSheen(ctx, v, blocks, cx, cy, r, alpha) {
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.scale !== undefined && b.scale < 1) continue;
    ctx.rect(v.ox + b.x * v.cell, v.oy + b.y * v.cell, v.cell, v.cell);
  }
  const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  gr.addColorStop(0, `rgba(255, 248, 230, ${alpha})`);
  gr.addColorStop(0.5, `rgba(255, 248, 230, ${alpha * 0.4})`);
  gr.addColorStop(1, 'rgba(255, 248, 230, 0)');
  ctx.fillStyle = gr;
  ctx.fill();
  ctx.restore();
}

// ── 木槽 ──────────────────────────────────────────────────
// floor:槽底木板(按正面网格大小画,运行时缩小贴到透视位置)
// wall:内壁纹理(u 沿槽口的棱,v 从槽口走到槽底),上下左右共用
// rim:槽口一圈围边 + 桌面投影 + 四角铜钉,画在最上面
function drawWellFloor(g, w, h, cols, rows, rand, floorWood) {
  const cell = w / cols;
  const lw = Math.max(0.6, cell / 26);
  const plankW = cell * 2;
  for (let i = 0; i * plankW < w; i++) {
    const base = toHex(shade(floorWood || FLOOR_WOOD, (rand() - 0.5) * 0.18));
    woodFill(g, i * plankW, 0, plankW, h, base, rand, { vertical: true, lines: 5, lineWidth: lw, knot: 0.35 });
    g.fillStyle = 'rgba(12, 5, 0, 0.6)';
    g.fillRect(i * plankW - 0.5, 0, 1, h);
  }
  // 刻槽网格
  for (let c = 1; c < cols; c++) {
    g.fillStyle = 'rgba(10, 4, 0, 0.3)';
    g.fillRect(c * cell - 0.5, 0, 1, h);
    g.fillStyle = 'rgba(255, 210, 160, 0.05)';
    g.fillRect(c * cell + 0.5, 0, 1, h);
  }
  for (let r = 1; r < rows; r++) {
    g.fillStyle = 'rgba(10, 4, 0, 0.3)';
    g.fillRect(0, r * cell - 0.5, w, 1);
    g.fillStyle = 'rgba(255, 210, 160, 0.05)';
    g.fillRect(0, r * cell + 0.5, w, 1);
  }
  // 墙角暗:四边往里一圈渐暗,上 / 左(背光的墙投下影子)更重
  const edge = (x0, y0, x1, y1, a, len) => {
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, `rgba(8, 3, 0, ${a})`);
    gr.addColorStop(1, 'rgba(8, 3, 0, 0)');
    g.fillStyle = gr;
    if (x0 === x1) g.fillRect(0, Math.min(y0, y0 + (y1 > y0 ? 0 : -len)), w, len);
    else g.fillRect(Math.min(x0, x0 + (x1 > x0 ? 0 : -len)), 0, len, h);
  };
  const L = cell * 1.1;
  edge(0, 0, 0, L, 0.6, L);
  edge(0, 0, L, 0, 0.5, L);
  edge(0, h, 0, h - L * 0.6, 0.3, L * 0.6);
  edge(w, 0, w - L * 0.6, 0, 0.35, L * 0.6);
}

function drawWellWall(g, w, h, rand) {
  const lw = Math.max(0.6, h / 20);
  woodFill(g, 0, 0, w, h, toHex(shade(FRAME_WOOD, -0.12)), rand, { lines: 3, lineWidth: lw, knot: 0.3 });
  const ao = g.createLinearGradient(0, 0, 0, h);
  ao.addColorStop(0, 'rgba(255, 236, 200, 0.18)');
  ao.addColorStop(0.25, 'rgba(255, 236, 200, 0)');
  ao.addColorStop(1, 'rgba(10, 4, 0, 0.6)');
  g.fillStyle = ao;
  g.fillRect(0, 0, w, h);
}

function drawWellRim(g, W, H, m, rand) {
  const { x, y, width, height, cell, F } = m;
  const x0 = x - F;
  const y0 = y - F;
  const x1 = x + width + F;
  const y1 = y + height + F;
  const R = cell * 0.35;
  const lw = Math.max(0.6, cell / 26);

  // 桌面投影 + 托盘外侧厚度(往右下伸出一点,和其它游戏的木托盘一致)
  const D = Math.max(3, Math.round(cell * 0.28));
  const hole = () => {
    g.moveTo(x, y);
    g.lineTo(x, y + height);
    g.lineTo(x + width, y + height);
    g.lineTo(x + width, y);
    g.closePath();
  };
  g.save();
  g.beginPath();
  g.rect(0, 0, W, H);
  hole();
  g.clip();
  g.shadowColor = 'rgba(0, 0, 0, 0.55)';
  g.shadowBlur = cell * 0.8;
  g.shadowOffsetX = D * 0.6;
  g.shadowOffsetY = D;
  g.fillStyle = '#2A170B';
  g.beginPath();
  roundRectPath(g, x0 + D * 0.5, y0 + D * 0.5, x1 - x0, y1 - y0, R);
  g.fill();
  g.restore();
  // 外侧厚度只露在围边外面:外圈顺时针 + 槽口逆时针,中间镂空
  g.save();
  g.beginPath();
  roundRectPath(g, x0 + D, y0 + D, x1 - x0, y1 - y0, R);
  hole();
  g.clip();
  woodFill(g, x0, y0, x1 - x0 + D, y1 - y0 + D, toHex(shade(FRAME_WOOD, -0.42)), rand, { lines: 4, lineWidth: lw, knot: 0 });
  g.restore();

  // 围边顶面:四条斜接木条,中间镂空
  const ring = () => {
    g.beginPath();
    roundRectPath(g, x0, y0, x1 - x0, y1 - y0, R);
    hole();
  };
  g.save();
  ring();
  g.clip();
  const xi1 = x + width;
  const yi1 = y + height;
  const bars = [
    { pts: [x0, y0, x1, y0, xi1, y, x, y], rect: [x0, y0, x1 - x0, F], v: false },
    { pts: [x0, y1, x, yi1, xi1, yi1, x1, y1], rect: [x0, yi1, x1 - x0, F], v: false },
    { pts: [x0, y0, x, y, x, yi1, x0, y1], rect: [x0, y0, F, y1 - y0], v: true },
    { pts: [x1, y0, x1, y1, xi1, yi1, xi1, y], rect: [xi1, y0, F, y1 - y0], v: true },
  ];
  bars.forEach((bar, i) => {
    g.save();
    poly(g, bar.pts);
    g.clip();
    woodFill(g, bar.rect[0], bar.rect[1], bar.rect[2], bar.rect[3], toHex(shade(FRAME_WOOD, i % 2 ? -0.04 : 0.04)), rand, {
      vertical: bar.v, lines: bar.v ? 3 : 4, lineWidth: lw, knot: 0.5,
    });
    g.restore();
    g.strokeStyle = 'rgba(25, 10, 0, 0.45)';
    g.lineWidth = lw * 0.7;
    g.beginPath();
    g.moveTo(bar.pts[0], bar.pts[1]);
    g.lineTo(bar.pts[6], bar.pts[7]);
    g.stroke();
  });
  const lg = g.createLinearGradient(x0, y0, x1, y1);
  lg.addColorStop(0, 'rgba(255, 236, 200, 0.22)');
  lg.addColorStop(0.5, 'rgba(255, 236, 200, 0)');
  lg.addColorStop(1, 'rgba(30, 12, 0, 0.22)');
  g.fillStyle = lg;
  g.fillRect(x0, y0, x1 - x0, y1 - y0);
  g.restore();

  // 外沿倒角 + 槽口内沿(往下折进槽里的棱:亮一道)
  const e = Math.max(1, cell * 0.08);
  g.save();
  g.lineWidth = e;
  g.strokeStyle = 'rgba(255, 230, 190, 0.35)';
  g.beginPath();
  g.moveTo(x0 + e / 2, y1 - R);
  g.lineTo(x0 + e / 2, y0 + R);
  g.arcTo(x0 + e / 2, y0 + e / 2, x0 + R, y0 + e / 2, R - e / 2);
  g.lineTo(x1 - R, y0 + e / 2);
  g.stroke();
  g.strokeStyle = 'rgba(25, 10, 0, 0.35)';
  g.beginPath();
  g.moveTo(x1 - e / 2, y0 + R);
  g.lineTo(x1 - e / 2, y1 - R);
  g.arcTo(x1 - e / 2, y1 - e / 2, x1 - R, y1 - e / 2, R - e / 2);
  g.lineTo(x0 + R, y1 - e / 2);
  g.stroke();
  g.lineWidth = Math.max(1, lw * 1.4);
  g.strokeStyle = 'rgba(255, 228, 185, 0.4)';
  g.strokeRect(x - g.lineWidth / 2, y - g.lineWidth / 2, width + g.lineWidth, height + g.lineWidth);
  g.lineWidth = lw;
  g.strokeStyle = 'rgba(20, 8, 0, 0.55)';
  g.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
  g.restore();

  const nr = Math.max(1.5, cell * 0.13);
  [[x0 + F / 2, y0 + F / 2], [x1 - F / 2, y0 + F / 2], [x0 + F / 2, y1 - F / 2], [x1 - F / 2, y1 - F / 2]]
    .forEach(([nx, ny]) => drawNail(g, nx, ny, nr));
}

function buildWell(createCanvas, W, H, dpr, m, opts) {
  const o = opts || {};
  const make = (w, h, fn) => {
    const c = createCanvas(Math.max(1, Math.round(w * dpr)), Math.max(1, Math.round(h * dpr)));
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    fn(g);
    return c;
  };
  const wallLen = Math.max(m.width, m.height);
  const wallDepth = Math.max(4, Math.round(m.cell * 0.9));
  return {
    floor: make(m.width, m.height, g => drawWellFloor(g, m.width, m.height, m.cols, m.rows, rng(2024), o.floorWood)),
    wall: make(wallLen, wallDepth, g => drawWellWall(g, wallLen, wallDepth, rng(515))),
    wallLen,
    rim: make(W, H, g => drawWellRim(g, W, H, m, rng(77))),
  };
}

// 槽底 + 四面内壁(随镜头变化);rim 由调用方在木块之后再盖上
function drawWell(ctx, v, well, imgs) {
  const im = imgs || {};
  const floor = im.floor || well.floor;
  const wall = im.wall || well.wall;
  const W = v.cols;
  const Hh = v.rows;
  const [fx0, fy0] = project(v, 0, 0, 0);
  const [fx1, fy1] = project(v, W, Hh, 0);
  const bx0 = v.ox;
  const by0 = v.oy;
  const bx1 = v.ox + W * v.cell;
  const by1 = v.oy + Hh * v.cell;
  ctx.drawImage(floor, fx0, fy0, fx1 - fx0, fy1 - fy0);

  const dpr = v.dpr;
  const wl = well.wallLen;
  // 每面墙:槽口的棱 A→B,槽底对应的点 D(A 那头),clip 成精确的梯形再贴纹理
  const walls = [
    { quad: [bx0, by0, bx1, by0, fx1, fy0, fx0, fy0], a: [bx0, by0], b: [bx1, by0], d: [fx0, fy0], len: W, dark: 0.42 },
    { quad: [bx0, by1, bx1, by1, fx1, fy1, fx0, fy1], a: [bx0, by1], b: [bx1, by1], d: [fx0, fy1], len: W, dark: 0 },
    { quad: [bx0, by0, bx0, by1, fx0, fy1, fx0, fy0], a: [bx0, by0], b: [bx0, by1], d: [fx0, fy0], len: Hh, dark: 0.12 },
    { quad: [bx1, by0, bx1, by1, fx1, fy1, fx1, fy0], a: [bx1, by0], b: [bx1, by1], d: [fx1, fy0], len: Hh, dark: 0.45 },
  ];
  walls.forEach(w => {
    ctx.save();
    poly(ctx, w.quad);
    ctx.clip();
    const used = (w.len * v.cell) / wl;
    const ax = w.a[0], ay = w.a[1];
    ctx.setTransform((w.b[0] - ax) * dpr, (w.b[1] - ay) * dpr, (w.d[0] - ax) * dpr, (w.d[1] - ay) * dpr, (ax + v.tx) * dpr, (ay + v.ty) * dpr);
    // 纹理稍微多取一点、贴大一点,保证盖满梯形
    ctx.drawImage(wall, 0, 0, Math.min(wall.width, wall.width * used), wall.height, -0.02, 0, 1.04, 1.15);
    ctx.setTransform(dpr, 0, 0, dpr, v.tx * dpr, v.ty * dpr);
    if (w.dark) {
      ctx.fillStyle = `rgba(14, 6, 0, ${w.dark})`;
      ctx.fill();
    }
    ctx.restore();
  });
  // 墙与槽底交界的折线
  ctx.save();
  ctx.strokeStyle = 'rgba(10, 4, 0, 0.55)';
  ctx.lineWidth = Math.max(0.6, v.cell / 30);
  ctx.strokeRect(fx0, fy0, fx1 - fx0, fy1 - fy0);
  ctx.restore();
}

module.exports = {
  DEPTH, CAM_Z, makeView, scaleAt, project, wellMetrics,
  buildBlockAtlas, drawBlocks, drawFloorShadows, drawFrontSheen, buildWell, drawWell,
};
