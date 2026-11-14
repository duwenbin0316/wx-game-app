// 染色木螺母：六角倒角顶面、三棱立面、内螺纹孔、螺纹木杆与满柱铜帽。纯 Canvas 绘图，可用于分享卡。
const { WOOD, rng, shade, woodFill, drawSlab, drawNail, drawBurnedText, roundRectPath } = require('./wood-art');
const { drawClawd, GRID_COLS, GRID_ROWS } = require('./clawd');

// 七色匠造染木：色相拉开、明度分明，搭配正刻数字与内圈纹饰方便辨色
const PALETTE = [
  '#CF4D3F', // 1 朱砂红
  '#3E8EC4', // 2 霁蓝
  '#5A9E4B', // 3 翠竹绿
  '#E0A438', // 4 琥珀金
  '#8B58AE', // 5 紫檀
  '#D97234', // 6 丹桂橙
  '#38988E', // 7 青黛青
];
const COLOR_NAMES = ['朱砂', '霁蓝', '翠竹', '琥珀', '紫檀', '丹桂', '青黛'];

function ellipse(g, x, y, rx, ry) {
  g.beginPath();
  g.save();
  g.translate(x, y);
  g.scale(rx, ry);
  g.arc(0, 0, 1, 0, Math.PI * 2);
  g.restore();
}

function hexPoints(x, y, r, angle = 0, aspect = 0.46) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = angle + i * Math.PI / 3;
    pts.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r * aspect, a });
  }
  return pts;
}

function traceHex(g, pts, dy = 0) {
  g.beginPath();
  pts.forEach((p, i) => {
    if (!i) g.moveTo(p.x, p.y + dy);
    else g.lineTo(p.x, p.y + dy);
  });
  g.closePath();
}

function drawNut(g, x, y, r, color, variant = 0, opts = {}) {
  const idx = ((color % PALETTE.length) + PALETTE.length) % PALETTE.length;
  const base = PALETTE[idx];
  const angle = opts.angle || 0;
  const thickness = r * 0.54;
  const pts = hexPoints(x, y, r, angle);

  g.save();
  if (opts.scaleX || opts.scaleY) {
    g.translate(x, y);
    g.scale(opts.scaleX || 1, opts.scaleY || 1);
    g.translate(-x, -y);
  }

  // 选中悬停时的暖金光晕与投影
  if (opts.lifted) {
    ellipse(g, x, y + thickness * 0.5, r * 1.18, r * 0.56);
    g.fillStyle = 'rgba(255, 214, 120, 0.22)';
    g.fill();
  }

  // 下沿柔和阴影
  ellipse(g, x + r * 0.1, y + thickness + r * 0.15, r * 1.02, r * 0.4);
  g.fillStyle = opts.lifted ? 'rgba(16, 6, 1, 0.26)' : 'rgba(20, 8, 2, 0.42)';
  g.fill();

  // 底面封底，避免侧棱缝隙露白
  traceHex(g, pts, thickness);
  g.fillStyle = shade(base, -0.46);
  g.fill();

  // 朝向镜头的侧面（按 x 从右向左即正面可见棱面绘制）
  const faces = [];
  for (let i = 0; i < 6; i++) {
    const p1 = pts[i], p2 = pts[(i + 1) % 6];
    if (p2.x < p1.x) faces.push({ i, p1, p2, midX: (p1.x + p2.x) / 2 });
  }
  faces.forEach(face => {
    const { i, p1, p2, midX } = face;
    g.save();
    g.beginPath();
    g.moveTo(p1.x, p1.y);
    g.lineTo(p2.x, p2.y);
    g.lineTo(p2.x, p2.y + thickness);
    g.lineTo(p1.x, p1.y + thickness);
    g.closePath();
    g.clip();
    woodFill(g, x - r, y - r, 2 * r, 2.4 * r, base, rng(200 + idx * 13 + variant + i * 7), { lines: 8, lineWidth: 0.45, knot: 0 });
    // 左上受光、右下背光：根据侧面水平位置平滑过渡明暗
    const normX = (midX - x) / r; // -1(左) ~ +1(右)
    const shadeAlpha = normX > 0.25 ? 0.34 : (normX < -0.25 ? 0.03 : 0.15);
    g.fillStyle = `rgba(24, 9, 3, ${shadeAlpha})`;
    g.fillRect(x - r, y - r, 2 * r, 3 * r);
    // 侧面底沿暗边与顶沿亮边
    const sideGrad = g.createLinearGradient(0, Math.min(p1.y, p2.y), 0, Math.max(p1.y, p2.y) + thickness);
    sideGrad.addColorStop(0, 'rgba(255, 240, 210, 0.14)');
    sideGrad.addColorStop(0.7, 'rgba(0, 0, 0, 0)');
    sideGrad.addColorStop(1, 'rgba(15, 5, 0, 0.28)');
    g.fillStyle = sideGrad;
    g.fillRect(x - r, y - r, 2 * r, 3 * r);
    g.restore();

    // 侧棱分界线
    g.beginPath();
    g.moveTo(p1.x, p1.y);
    g.lineTo(p1.x, p1.y + thickness);
    g.strokeStyle = 'rgba(30, 12, 4, 0.36)';
    g.lineWidth = 0.8;
    g.stroke();
  });

  // 顶面木纹与受光渐变
  g.save();
  traceHex(g, pts, 0);
  g.clip();
  woodFill(g, x - r, y - r, 2 * r, 2 * r, base, rng(113 + variant * 37 + idx * 73), { lines: 11, lineWidth: 0.48, knot: 0 });
  const light = g.createLinearGradient(x - r, y - r * 0.5, x + r, y + r * 0.5);
  light.addColorStop(0, 'rgba(255, 246, 220, 0.52)');
  light.addColorStop(0.5, 'rgba(255, 240, 200, 0.08)');
  light.addColorStop(1, 'rgba(24, 9, 2, 0.24)');
  g.fillStyle = light;
  g.fillRect(x - r, y - r, r * 2, r * 2);
  g.restore();

  // 顶面六角内倒角线与车削圆环（真实螺母的环形倒角冠面）
  const innerPts = hexPoints(x, y, r * 0.91, angle);
  traceHex(g, innerPts, 0);
  g.strokeStyle = 'rgba(255, 239, 204, 0.45)';
  g.lineWidth = 0.95;
  g.stroke();

  ellipse(g, x, y, r * 0.74, r * 0.74 * 0.45);
  g.strokeStyle = 'rgba(40, 16, 4, 0.22)';
  g.lineWidth = 0.85;
  g.stroke();
  ellipse(g, x, y - 0.5, r * 0.72, r * 0.72 * 0.45);
  g.strokeStyle = 'rgba(255, 242, 210, 0.30)';
  g.lineWidth = 0.7;
  g.stroke();

  // 中心内螺纹孔（严格裁剪在孔椭圆内，不外溢）
  const holeRx = r * 0.33, holeRy = r * 0.16;
  g.save();
  ellipse(g, x, y, holeRx, holeRy);
  g.clip();
  g.fillStyle = '#2B170C';
  g.fillRect(x - holeRx, y - holeRy, holeRx * 2, holeRy * 2);
  // 孔内下沿受光面与内螺纹圈
  ellipse(g, x + holeRx * 0.08, y + holeRy * 0.32, holeRx * 0.88, holeRy * 0.78);
  g.fillStyle = shade(base, -0.25);
  g.fill();
  for (let ring = 1; ring <= 2; ring++) {
    ellipse(g, x, y + ring * holeRy * 0.22, holeRx * 0.92, holeRy * 0.68);
    g.strokeStyle = 'rgba(255, 230, 185, 0.26)';
    g.lineWidth = 0.65;
    g.stroke();
  }
  // 穿在木杆上时，孔心露出榉木柱芯
  if (!opts.floating) {
    ellipse(g, x, y + holeRy * 0.25, holeRx * 0.58, holeRy * 0.56);
    g.fillStyle = '#C99860';
    g.fill();
    ellipse(g, x - holeRx * 0.12, y + holeRy * 0.18, holeRx * 0.28, holeRy * 0.26);
    g.fillStyle = '#F0D3A2';
    g.fill();
  }
  g.restore();

  // 孔口高光描边
  ellipse(g, x, y, holeRx, holeRy);
  g.strokeStyle = 'rgba(255, 235, 195, 0.42)';
  g.lineWidth = 0.85;
  g.stroke();

  // 正面居中烙印色号（精确落在前立面中央）
  const frontY = y + r * 0.40 + thickness * 0.52;
  const fontSize = Math.max(9, Math.round(r * 0.36));
  g.font = `bold ${fontSize}px monospace`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(24, 10, 2, 0.72)';
  g.fillText(String(idx + 1), x, frontY + 0.8);
  g.fillStyle = 'rgba(255, 244, 218, 0.92)';
  g.fillText(String(idx + 1), x, frontY);

  // 满柱完成时的微光边
  if (opts.complete) {
    traceHex(g, pts, 0);
    g.strokeStyle = 'rgba(255, 226, 138, 0.55)';
    g.lineWidth = 1.1;
    g.stroke();
  }
  g.restore();
}

// 满柱顶部黄铜封帽
function drawBrassCap(g, x, y, r) {
  const w = r * 0.48, h = r * 0.30;
  g.save();
  ellipse(g, x, y + 2, w * 1.1, h * 0.48);
  g.fillStyle = 'rgba(20, 8, 0, 0.35)';
  g.fill();
  const grad = g.createLinearGradient(x - w, y - h, x + w, y + h);
  grad.addColorStop(0, '#FFF3C4');
  grad.addColorStop(0.45, '#E2B24A');
  grad.addColorStop(1, '#8A5A14');
  ellipse(g, x, y, w, h * 0.55);
  g.fillStyle = grad;
  g.fill();
  g.strokeStyle = '#5C3909';
  g.lineWidth = 0.8;
  g.stroke();
  ellipse(g, x - w * 0.24, y - h * 0.12, w * 0.28, h * 0.16);
  g.fillStyle = 'rgba(255, 252, 235, 0.75)';
  g.fill();
  g.restore();
}

function layout(width, height, count, capacity) {
  const rows = count <= 5 ? 1 : 2;
  const cols = Math.ceil(count / rows);
  const margin = Math.max(12, width * 0.045);
  const rowH = (height - 28) / rows;
  const colW = (width - margin * 2) / cols;
  const radius = Math.max(10, Math.min(32, colW * 0.35, (rowH - 55) / (capacity * 0.66 + 1.9)));
  const step = radius * 0.64;
  const rodH = capacity * step + radius * 1.4;
  const positions = [];
  for (let row = 0; row < rows; row++) {
    const n = Math.min(cols, count - row * cols);
    const baseY = rows === 1 ? height * 0.57 + rodH * 0.35 : (row + 1) * rowH - 12;
    for (let col = 0; col < n; col++) {
      positions.push({
        x: width / 2 + (col - (n - 1) / 2) * colW,
        y: baseY,
        top: baseY - rodH,
        radius,
        step,
        width: colW * 0.95,
        row,
      });
    }
  }
  return { positions, radius, step, rodH, rows, cols, rowH, width, height };
}

function drawStage(g, metrics, capacity) {
  const { width: w, height: h, positions, rows, rowH, rodH, radius: r, step } = metrics;
  const bg = g.createRadialGradient(w * 0.5, h * 0.28, 12, w * 0.5, h * 0.58, Math.max(w, h) * 0.88);
  bg.addColorStop(0, '#523422');
  bg.addColorStop(0.6, '#311C10');
  bg.addColorStop(1, '#1B0E06');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);

  g.save();
  g.globalAlpha = 0.16;
  woodFill(g, 0, 0, w, h, '#68452A', rng(42), { lines: 26, vertical: true, lineWidth: 0.6, knot: 0 });
  g.restore();

  if (rows === 1 && h > 300) {
    const plaqueW = Math.min(w * 0.74, 292), plaqueH = 66;
    const plaqueX = (w - plaqueW) / 2, plaqueY = Math.max(14, h * 0.08);
    drawSlab(g, plaqueX, plaqueY, plaqueW, plaqueH, { base: '#A87440', depth: 5, radius: 8, seed: 72, nails: 2.2 });
    const ps = 1.45;
    drawClawd(g, plaqueX + 18, plaqueY + (plaqueH - GRID_ROWS * ps) / 2, ps);
    const textX = plaqueX + (plaqueW + GRID_COLS * ps + 20) / 2;
    drawBurnedText(g, '木 螺 母 归 色', textX, plaqueY + 25, 16, { color: '#45250F' });
    drawBurnedText(g, 'ARTISAN WOODEN NUTS', textX, plaqueY + 46, 8.5, { color: '#6B431F' });
  }

  for (let row = 0; row < rows; row++) {
    const p = positions.find(pos => pos.row === row);
    if (!p) continue;
    drawSlab(g, 8, p.y - r * 0.26, w - 19, r * 1.15, { base: '#A17243', depth: 6, radius: 7, seed: 44 + row, lines: 9 });
    drawNail(g, 18, p.y + r * 0.45, 2.5);
    drawNail(g, w - 22, p.y + r * 0.45, 2.5);
    if (rows > 1 && row === 0) {
      g.fillStyle = 'rgba(218, 182, 128, 0.35)';
      g.fillRect(w * 0.36, rowH + 3, w * 0.28, 1);
    }
  }

  positions.forEach(p => {
    const x = p.x, bottom = p.y - 4;
    // 法兰木垫圈与底座阴影
    ellipse(g, x + 3, bottom + 8, r * 0.78, r * 0.25);
    g.fillStyle = 'rgba(24, 12, 4, 0.45)';
    g.fill();
    ellipse(g, x, bottom + 4, r * 0.66, r * 0.26);
    g.fillStyle = '#4E2E18';
    g.fill();
    ellipse(g, x, bottom, r * 0.66, r * 0.26);
    g.fillStyle = '#C49256';
    g.fill();
    ellipse(g, x, bottom, r * 0.46, r * 0.18);
    g.strokeStyle = 'rgba(70, 36, 12, 0.55)';
    g.lineWidth = 0.9;
    g.stroke();

    // 榉木螺纹杆身
    const rodW = r * 0.34;
    const rod = g.createLinearGradient(x - rodW / 2, 0, x + rodW / 2, 0);
    rod.addColorStop(0, '#8F5E34');
    rod.addColorStop(0.32, '#F4DAB0');
    rod.addColorStop(0.65, '#DEB884');
    rod.addColorStop(1, '#7D4E28');
    g.fillStyle = rod;
    g.fillRect(x - rodW / 2, bottom - rodH, rodW, rodH);

    // 螺旋木螺纹刻线
    g.strokeStyle = 'rgba(98, 60, 26, 0.38)';
    g.lineWidth = 0.6;
    for (let y = bottom - rodH + 6; y < bottom; y += 4.5) {
      g.beginPath();
      g.moveTo(x - rodW / 2, y + 1.4);
      g.lineTo(x + rodW / 2, y - 1.4);
      g.stroke();
    }

    // 容量层位轻刻度（方便目测剩余空位）
    if (capacity > 0) {
      g.strokeStyle = 'rgba(255, 240, 205, 0.28)';
      g.lineWidth = 0.75;
      for (let slot = 1; slot <= capacity; slot++) {
        const sy = p.y - r * 0.6 - (slot - 1) * step;
        g.beginPath();
        g.moveTo(x - rodW * 0.45, sy);
        g.lineTo(x + rodW * 0.45, sy);
        g.stroke();
      }
    }

    // 圆拱杆顶与高光
    ellipse(g, x, bottom - rodH, rodW / 2, rodW * 0.22);
    g.fillStyle = '#F5DCAEC8';
    g.fill();
    ellipse(g, x - rodW * 0.12, bottom - rodH - 0.5, rodW * 0.2, rodW * 0.09);
    g.fillStyle = 'rgba(255, 250, 235, 0.7)';
    g.fill();
  });
}

function drawBoard(g, board, metrics, opts = {}) {
  const { positions, radius: r, step } = metrics;
  const selected = opts.selected !== undefined ? opts.selected : -1;
  const capacity = opts.capacity || 4;
  const selectedRod = selected >= 0 ? board[selected] : null;
  const selectedColor = selectedRod && selectedRod.length ? selectedRod[selectedRod.length - 1] : -1;

  positions.forEach((p, i) => {
    const rod = board[i] || [];
    const complete = rod.length === capacity && rod.every(c => c === rod[0]);
    const isTarget = selected >= 0 && selected !== i && selectedColor >= 0 &&
      rod.length < capacity && (!rod.length || rod[rod.length - 1] === selectedColor);

    // 1. 选中柱或合法目标柱的底座光圈与落点虚影
    if (selected === i) {
      ellipse(g, p.x, p.y - 2, r * 0.88, r * 0.33);
      g.fillStyle = 'rgba(255, 216, 110, 0.22)';
      g.fill();
      g.strokeStyle = '#FFE08A';
      g.lineWidth = 2;
      g.stroke();
    } else if (isTarget) {
      ellipse(g, p.x, p.y - 2, r * 0.84, r * 0.31);
      g.fillStyle = 'rgba(168, 224, 130, 0.18)';
      g.fill();
      g.strokeStyle = 'rgba(182, 232, 142, 0.78)';
      g.lineWidth = 1.6;
      g.stroke();
      // 目标槽位微光提示环
      const targetY = p.y - r * 0.6 - rod.length * step;
      const ghostPts = hexPoints(p.x, targetY, r * 0.88, 0);
      traceHex(g, ghostPts, 0);
      g.strokeStyle = 'rgba(210, 245, 175, 0.45)';
      g.lineWidth = 1.2;
      g.stroke();
    }

    // 2. 提示高亮（起点金圈，落点翠圈）
    if (opts.hint && (i === opts.hint.from || i === opts.hint.to)) {
      const isFrom = i === opts.hint.from;
      ellipse(g, p.x, p.y + 4, r * 1.12, r * 0.38);
      g.strokeStyle = isFrom ? '#FFE898' : '#9CE078';
      g.lineWidth = 2.4;
      g.stroke();
      // 柱顶方向小标
      const badgeY = p.top - r * 0.45;
      g.font = `bold ${Math.max(10, Math.round(r * 0.42))}px sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = isFrom ? '#FFE898' : '#9CE078';
      g.fillText(isFrom ? '↑' : '↓', p.x, badgeY);
    }

    // 3. 违例轻晃反馈
    let shakeX = 0;
    if (opts.shake && opts.shake.rod === i) {
      shakeX = opts.shake.offset || 0;
      ellipse(g, p.x, p.y - 2, r * 0.86, r * 0.32);
      g.strokeStyle = 'rgba(235, 100, 80, 0.75)';
      g.lineWidth = 2;
      g.stroke();
    }

    // 4. 逐层绘制螺母
    rod.forEach((color, level) => {
      if (opts.moving && i === opts.moving.from && level === rod.length - 1) return;
      const isTopSelected = selected === i && level === rod.length - 1;
      const lift = isTopSelected ? r * 0.75 : 0;
      const dx = level === rod.length - 1 ? shakeX : 0;
      drawNut(g, p.x + dx, p.y - r * 0.6 - level * step - lift, r, color, i + level, {
        lifted: isTopSelected,
        floating: isTopSelected,
        complete,
      });
    });

    // 5. 满柱顶部加盖黄铜螺帽
    if (complete) {
      drawBrassCap(g, p.x, p.top - 1, r);
    }

    // 6. 底座木梁前缘柱号铭牌
    const tagW = Math.max(20, r * 0.92), tagH = Math.max(12, r * 0.48);
    const tagX = p.x - tagW / 2, tagY = p.y + r * 0.56 - tagH / 2;
    g.save();
    g.beginPath();
    roundRectPath(g, tagX, tagY, tagW, tagH, 3);
    g.fillStyle = complete ? 'rgba(235, 184, 72, 0.28)' : 'rgba(42, 21, 8, 0.42)';
    g.fill();
    g.strokeStyle = complete ? 'rgba(255, 224, 130, 0.65)' : 'rgba(255, 220, 175, 0.18)';
    g.lineWidth = 0.8;
    g.stroke();
    g.font = `bold ${Math.max(10, Math.round(r * 0.36))}px monospace`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = complete ? '#FFE28A' : '#E5C496';
    g.fillText(complete ? '✓' : String(i + 1).padStart(2, '0'), p.x, p.y + r * 0.57);
    g.restore();
  });

  // 7. 粒子与归位庆典飘字
  if (opts.particles && opts.particles.length) {
    opts.particles.forEach(pt => {
      g.save();
      g.globalAlpha = Math.max(0, Math.min(1, pt.alpha));
      g.fillStyle = pt.color;
      g.translate(pt.x, pt.y);
      g.rotate(pt.rot || 0);
      g.fillRect(-pt.size / 2, -pt.size / 2, pt.size, pt.size * 0.65);
      g.restore();
    });
  }
}

module.exports = { PALETTE, COLOR_NAMES, drawNut, layout, drawStage, drawBoard };
