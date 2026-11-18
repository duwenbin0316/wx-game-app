// 极简木玩风螺母：饱满哑光漆色、干净三面受光倒角、严丝合缝叠放与圆润榉木柱。
const { canMove } = require('./nut-sort');
const { shade, drawSlab, drawNail, roundRectPath } = require('./wood-art');

// 7 色温润木玩配色（高辨识度哑光色相）
const PALETTE = [
  '#CD5348', // 珊瑚红
  '#518ECE', // 北欧蓝
  '#79A650', // 草木绿
  '#E8BC48', // 蜜蜡黄
  '#9872B8', // 丁香紫
  '#ED9256', // 陶土橙
  '#47B6AD', // 松石青
];
const COLOR_NAMES = ['红', '蓝', '绿', '黄', '紫', '橙', '青'];

const ASPECT = 0.42;

function ellipse(g, x, y, rx, ry) {
  g.beginPath();
  g.save();
  g.translate(x, y);
  g.scale(rx, ry);
  g.arc(0, 0, 1, 0, Math.PI * 2);
  g.restore();
}

function hexPoints(x, y, r, angle = 0, aspect = ASPECT) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = angle + i * Math.PI / 3;
    pts.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r * aspect });
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

function topRunCount(rod) {
  if (!rod || !rod.length) return 0;
  const c = rod[rod.length - 1];
  let n = 1;
  for (let i = rod.length - 2; i >= 0 && rod[i] === c; i--) n++;
  return n;
}

function drawNut(g, x, y, r, color, variant = 0, opts = {}) {
  const idx = ((color % PALETTE.length) + PALETTE.length) % PALETTE.length;
  const base = PALETTE[idx];
  const angle = (opts.angle || 0) + ((variant % 3) - 1) * 0.045;
  // 厚度与层高严格咬合，叠放时上下严丝合缝，不留杂乱悬空缝
  const thickness = r * 0.62;
  const pts = hexPoints(x, y, r, angle);

  g.save();

  // 底部接触柔和暗影（抬起时阴影略微扩散变淡）
  if (opts.lifted) {
    ellipse(g, x, y + thickness + r * 0.22, r * 0.88, r * 0.32);
    g.fillStyle = 'rgba(18, 8, 2, 0.24)';
    g.fill();
  } else {
    ellipse(g, x, y + thickness + r * 0.04, r * 0.98, r * 0.38);
    g.fillStyle = 'rgba(20, 8, 2, 0.28)';
    g.fill();
  }

  // 底面封底
  traceHex(g, pts, thickness);
  g.fillStyle = shade(base, -0.38);
  g.fill();

  // 三个正面可见立面：左亮、中平、右暗，干净纯粹不画杂乱线条
  const faces = [];
  for (let i = 0; i < 6; i++) {
    const p1 = pts[i], p2 = pts[(i + 1) % 6];
    if (p2.x < p1.x) faces.push({ p1, p2, midX: (p1.x + p2.x) / 2 });
  }
  faces.forEach(({ p1, p2, midX }) => {
    const normX = (midX - x) / r;
    const tone = normX < -0.25 ? -0.05 : (normX > 0.25 ? -0.32 : -0.17);
    g.beginPath();
    g.moveTo(p1.x, p1.y);
    g.lineTo(p2.x, p2.y);
    g.lineTo(p2.x, p2.y + thickness);
    g.lineTo(p1.x, p1.y + thickness);
    g.closePath();
    const lacquer = g.createLinearGradient(x, p1.y, x, p1.y + thickness);
    lacquer.addColorStop(0, shade(base, tone + 0.12));
    lacquer.addColorStop(0.7, shade(base, tone));
    lacquer.addColorStop(1, shade(base, tone - 0.14));
    g.fillStyle = lacquer;
    g.fill();

    // 侧棱微弱高光折线
    g.beginPath();
    g.moveTo(p1.x, p1.y);
    g.lineTo(p1.x, p1.y + thickness);
    g.strokeStyle = 'rgba(255, 245, 225, 0.14)';
    g.lineWidth = 0.8;
    g.stroke();
  });

  // 编号烙在正面，叠满时也能从侧面辨认各层。
  g.font = 'bold ' + Math.max(8, Math.round(r * 0.49)) + 'px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = [0, 1, 4].includes(idx) ? '#FFF2D8' : '#32261B';
  g.fillText(String(idx + 1), x, y + r * 0.69);

  // 底沿层间咬合暗线，让叠放的每一颗螺母边界干净利落
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const p1 = pts[i], p2 = pts[(i + 1) % 6];
    if (p2.x < p1.x) {
      g.moveTo(p1.x, p1.y + thickness);
      g.lineTo(p2.x, p2.y + thickness);
    }
  }
  g.strokeStyle = 'rgba(24, 10, 2, 0.42)';
  g.lineWidth = 1.1;
  g.stroke();

  // 顶面：左上暖光至右下原色的温润渐变
  g.save();
  traceHex(g, pts, 0);
  g.clip();
  const topGrad = g.createLinearGradient(x - r, y - r * ASPECT, x + r, y + r * ASPECT);
  topGrad.addColorStop(0, shade(base, 0.18));
  topGrad.addColorStop(0.55, shade(base, 0.04));
  topGrad.addColorStop(1, shade(base, -0.08));
  g.fillStyle = topGrad;
  g.fillRect(x - r, y - r, r * 2, r * 2);
  g.restore();

  // 顶面外沿高光倒角
  traceHex(g, pts, 0);
  g.strokeStyle = 'rgba(255, 248, 230, 0.38)';
  g.lineWidth = 1.1;
  g.stroke();

  // 顶面温润圆环倒角（木玩车削质感）
  ellipse(g, x, y, r * 0.68, r * 0.68 * ASPECT);
  g.strokeStyle = 'rgba(255, 248, 230, 0.22)';
  g.lineWidth = 1;
  g.stroke();

  // 中心圆孔与木栓衔接
  const holeRx = r * 0.33, holeRy = r * 0.33 * ASPECT;
  g.save();
  ellipse(g, x, y, holeRx, holeRy);
  g.clip();
  g.fillStyle = shade(base, -0.48);
  g.fillRect(x - holeRx, y - holeRy, holeRx * 2, holeRy * 2);
  g.restore();

  // 孔沿内圈倒角
  ellipse(g, x, y, holeRx, holeRy);
  g.strokeStyle = 'rgba(30, 12, 2, 0.35)';
  g.lineWidth = 0.9;
  g.stroke();

  if (!opts.floating) {
    const rodW = r * 0.36;
    // 最上层的栓身穿过冠面，一直连到孔内。下层只在孔内显露。
    const startY = opts.exposed ? y - r * ASPECT - 1 : y - holeRy;
    g.save();
    if (!opts.exposed) {
      ellipse(g, x, y, holeRx, holeRy);
      g.clip();
    }
    g.fillStyle = shaftFinish(g, x, rodW);
    g.beginPath();
    g.moveTo(x - rodW / 2, startY);
    g.lineTo(x + rodW / 2, startY);
    g.lineTo(x + rodW / 2, y);
    g.quadraticCurveTo(x, y + holeRy * 0.85, x - rodW / 2, y);
    g.closePath();
    g.fill();
    g.restore();
  }

  g.restore();
}

function layout(width, height, count, capacity) {
  const rows = count <= 5 ? 1 : 2;
  const cols = Math.ceil(count / rows);
  const margin = Math.max(12, width * 0.045);
  const availableRowH = (height - 28) / rows;
  const colW = (width - margin * 2) / cols;
  const radius = Math.max(10, Math.min(38, colW * 0.36, (availableRowH - 55) / (capacity * 0.66 + 1.9)));
  const step = radius * 0.64;
  const rodH = capacity * step + radius * 1.4;
  const rowH = Math.min(availableRowH, rodH + radius * 3.45);
  const trayTop = (height - rowH * rows) / 2;
  const positions = [];
  for (let row = 0; row < rows; row++) {
    const n = Math.min(cols, count - row * cols);
    const baseY = trayTop + row * rowH + (rowH + rodH) / 2;
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

function shaftFinish(g, x, rodW) {
  const rodGrad = g.createLinearGradient(x - rodW / 2, 0, x + rodW / 2, 0);
  rodGrad.addColorStop(0, '#A67542');
  rodGrad.addColorStop(0.35, '#F4DAB0');
  rodGrad.addColorStop(0.7, '#D8AD78');
  rodGrad.addColorStop(1, '#85562B');
  return rodGrad;
}

function drawRodShaft(g, x, topY, bottomY, rodW, step) {
  g.fillStyle = shaftFinish(g, x, rodW);
  g.fillRect(x - rodW / 2, topY, rodW, bottomY - topY);

  // 车削的浅槽与实际层距对齐。
  g.strokeStyle = 'rgba(91, 55, 28, 0.37)';
  g.lineWidth = 1;
  for (let y = bottomY - step; y > topY + rodW * 0.4; y -= step) {
    g.beginPath();
    g.moveTo(x - rodW * 0.46, y);
    g.quadraticCurveTo(x, y + rodW * 0.25, x + rodW * 0.46, y);
    g.stroke();
  }

  // 圆润柱顶
  ellipse(g, x, topY, rodW / 2, rodW * 0.22);
  g.fillStyle = '#F6E0BA';
  g.fill();
}

function drawStage(g, metrics) {
  const { positions, rows, rodH, radius: r } = metrics;

  // 胡桃木框内嵌墨绿色台毡。整块托盘与柱架一起离屏缓存。
  const trayH = rows * metrics.rowH;
  const trayY = (metrics.height - trayH) / 2;
  const trayW = metrics.width - 16;
  drawSlab(g, 8, trayY, trayW, trayH, { base: '#84583A', depth: 3, radius: 16, seed: 19, lines: 20 });
  g.beginPath();
  roundRectPath(g, 14, trayY + 6, trayW - 12, trayH - 12, 11);
  const felt = g.createLinearGradient(0, trayY, metrics.width, trayY + trayH);
  felt.addColorStop(0, '#37534C');
  felt.addColorStop(0.55, '#293F39');
  felt.addColorStop(1, '#1D302C');
  g.fillStyle = felt;
  g.fill();
  g.strokeStyle = '#37291E';
  g.lineWidth = 2;
  g.stroke();
  g.beginPath();
  roundRectPath(g, 18, trayY + 10, trayW - 20, trayH - 20, 8);
  g.strokeStyle = 'rgba(220, 196, 142, 0.35)';
  g.lineWidth = 0.8;
  g.stroke();

  // 每排底座是一块干净厚实的胡桃木条，直接摆在桌面背景上
  for (let row = 0; row < rows; row++) {
    const rowPos = positions.filter(pos => pos.row === row);
    if (!rowPos.length) continue;
    const minX = rowPos[0].x;
    const padX = r * 1.65;
    const slabX = Math.max(22, minX - padX);
    const slabW = metrics.width - 2 * slabX;
    const slabY = rowPos[0].y - r * 0.36;
    const slabH = r * 1.32;
    drawSlab(g, slabX, slabY, slabW, slabH, {
      base: '#946037',
      depth: 6,
      radius: 10,
      seed: 44 + row,
      lines: 6,
    });
    drawNail(g, slabX + 14, slabY + slabH * 0.5, 2.4);
    drawNail(g, slabX + slabW - 14, slabY + slabH * 0.5, 2.4);
  }

  // 绘制每根榉木圆栓与底座垫圈
  positions.forEach((p, i) => {
    const x = p.x, bottom = p.y - 2;
    // 底座深色凹槽与木垫圈
    ellipse(g, x + 2, bottom + 5, r * 0.68, r * 0.24);
    g.fillStyle = 'rgba(20, 8, 0, 0.38)';
    g.fill();
    ellipse(g, x, bottom + 2, r * 0.58, r * 0.22);
    g.fillStyle = '#56341B';
    g.fill();
    ellipse(g, x, bottom, r * 0.58, r * 0.22);
    g.fillStyle = '#C8965C';
    g.fill();

    const rodW = r * 0.36;
    drawRodShaft(g, x, bottom - rodH, bottom, rodW, p.step);
    g.fillStyle = '#FFE3AB';
    g.font = 'bold ' + Math.max(8, Math.round(r * 0.33)) + 'px monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(i + 1).padStart(2, '0'), x, p.y + r * 0.7);
  });
}

// 满柱完成时顶部温润的金色木塞球
function drawFinialCap(g, x, y, r) {
  const capR = r * 0.34;
  g.save();
  ellipse(g, x, y + 2, capR * 1.05, capR * 0.45);
  g.fillStyle = 'rgba(20, 8, 0, 0.32)';
  g.fill();
  const grad = g.createRadialGradient(x - capR * 0.3, y - capR * 0.3, capR * 0.1, x, y, capR);
  grad.addColorStop(0, '#FFF5D0');
  grad.addColorStop(0.5, '#E8B84B');
  grad.addColorStop(1, '#9A6818');
  ellipse(g, x, y - capR * 0.15, capR, capR * 0.65);
  g.fillStyle = grad;
  g.fill();
  g.restore();
}

function drawBoard(g, board, metrics, opts = {}) {
  const { positions, radius: r, step } = metrics;
  const selected = opts.selected !== undefined ? opts.selected : -1;
  const capacity = opts.capacity || 4;
  const selectedRod = selected >= 0 ? board[selected] : null;
  const selectedRun = selectedRod ? topRunCount(selectedRod) : 0;
  const movingCount = (opts.moving && opts.moving.count) || 1;

  positions.forEach((p, i) => {
    const rod = board[i] || [];
    const complete = rod.length === capacity && rod.every(c => c === rod[0]);

    const hintedSource = opts.hint && i === opts.hint.from;
    const hintedTarget = opts.hint && i === opts.hint.to;
    if (selected === i || hintedSource || hintedTarget || canMove(board, selected, i, capacity)) {
      ellipse(g, p.x, p.y + r * 0.06, r * 1.1, r * 0.43);
      g.strokeStyle = selected === i || hintedSource ? '#FFD47D' : '#AAF1C8';
      g.lineWidth = Math.max(2, r * 0.09);
      g.stroke();
    }

    let shakeX = 0;
    if (opts.shake && opts.shake.rod === i) {
      shakeX = opts.shake.offset || 0;
    }

    // 从底到顶严丝合缝叠放螺母
    const liftedCount = opts.moving && i === opts.moving.from ? movingCount : (selected === i ? selectedRun : 0);
    rod.forEach((color, level) => {
      if (opts.moving && i === opts.moving.from && level >= rod.length - movingCount) return;
      const isLiftedGroup = selected === i && level >= rod.length - selectedRun;
      const lift = isLiftedGroup ? r * 0.72 : 0;
      const dx = level >= rod.length - Math.max(1, selected === i ? selectedRun : 1) ? shakeX : 0;
      drawNut(g, p.x + dx, p.y - r * 0.6 - level * step - lift, r, color, i + level, {
        lifted: isLiftedGroup && level === rod.length - selectedRun,
        floating: isLiftedGroup,
        exposed: level === rod.length - liftedCount - 1,
        complete,
      });
    });

    // 满柱完成加盖小金塞
    if (complete) {
      drawFinialCap(g, p.x, p.top - 1, r);
    }
  });

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
