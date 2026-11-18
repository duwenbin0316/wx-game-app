// 极简木玩风螺母：饱满哑光漆色、干净三面受光倒角、严丝合缝叠放与圆润榉木柱。
const { canMove } = require('./nut-sort');
const { shade, roundRectPath } = require('./wood-art');

// 7 色温润木玩配色（高辨识度哑光色相）
const PALETTE = [
  '#B84237', // 珊瑚红
  '#3265A5', // 北欧蓝
  '#567649', // 草木绿
  '#D6A52F', // 蜜蜡黄
  '#84619E', // 丁香紫
  '#CF7441', // 陶土橙
  '#348C89', // 松石青
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

// 图集的行对应七种漆色，列是一个六角对称周期内的六个视角。
const TILE_W = 144, TILE_H = 112, MODEL_RADIUS = 61, CROWN_Y = 37;

function drawNut(g, x, y, r, color, variant = 0, opts = {}) {
  const angle = (opts.angle || 0) + (variant % 3) * Math.PI / 18;
  const base = PALETTE[color];
  g.save();
  if (opts.lifted) {
    ellipse(g, x + r * 0.09, y + r * 1.35, r * 0.78, r * 0.22);
    g.fillStyle = 'rgba(56, 43, 30, 0.16)';
    g.fill();
  }
  if (opts.atlas) {
    const frame = Math.round(angle * 18 / Math.PI) % 6;
    const scale = r / MODEL_RADIUS;
    g.drawImage(opts.atlas, frame * TILE_W, color * TILE_H, TILE_W, TILE_H,
      x - TILE_W * scale / 2, y - CROWN_Y * scale, TILE_W * scale, TILE_H * scale);
  } else {
    // 图集解码前也可操作。简化几何与成品共用孔位、层距和编号。
    const pts = hexPoints(x, y, r, angle);
    traceHex(g, pts, r * 0.63);
    g.fillStyle = shade(base, -0.22);
    g.fill();
    for (let i = 0; i < 6; i++) {
      const a = pts[i], b = pts[(i + 1) % 6];
      if (a.x <= b.x) continue;
      traceHex(g, [a, b, { x: b.x, y: b.y + r * 0.63 }, { x: a.x, y: a.y + r * 0.63 }]);
      g.fillStyle = shade(base, -0.16 - ((a.x + b.x) / 2 - x) / r * 0.2);
      g.fill();
    }
    traceHex(g, pts);
    g.fillStyle = shade(base, 0.21);
    g.fill();
    ellipse(g, x, y, r * 0.39, r * 0.16);
    g.fillStyle = shade(base, -0.53);
    g.fill();
  }

  // 从孔口补画露出的木栓，保证抬起一组或移走顶层时的遮挡顺序。
  if (opts.exposed && !opts.floating) {
    const w = r * 0.36;
    g.fillStyle = shaftFinish(g, x, w);
    g.beginPath();
    g.moveTo(x - w / 2, y - r * 0.45);
    g.lineTo(x + w / 2, y - r * 0.45);
    g.lineTo(x + w / 2, y);
    g.quadraticCurveTo(x, y + r * 0.1, x - w / 2, y);
    g.fill();
  }
  g.font = '600 ' + Math.max(8, Math.round(r * 0.39)) + 'px Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = color === 3 || color === 5 ? '#4A3423' : '#FFF2DE';
  g.fillText(String(color + 1), x, y + r * 0.67);
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
  rodGrad.addColorStop(0, '#916642');
  rodGrad.addColorStop(0.35, '#EDD3AA');
  rodGrad.addColorStop(0.7, '#D8AD78');
  rodGrad.addColorStop(1, '#89633F');
  return rodGrad;
}

function drawRodShaft(g, x, topY, bottomY, rodW, step) {
  g.fillStyle = shaftFinish(g, x, rodW);
  g.fillRect(x - rodW / 2, topY, rodW, bottomY - topY);

  // 车削的浅槽与实际层距对齐。
  g.strokeStyle = 'rgba(91, 55, 28, 0.27)';
  g.lineWidth = 1;
  for (let y = bottomY - step; y > topY + rodW * 0.4; y -= step * 0.55) {
    g.beginPath();
    g.moveTo(x - rodW * 0.46, y);
    g.quadraticCurveTo(x, y + rodW * 0.18, x + rodW * 0.46, y - rodW * 0.24);
    g.stroke();
  }

  // 圆润柱顶
  ellipse(g, x, topY, rodW / 2, rodW * 0.22);
  g.fillStyle = '#F6E0BA';
  g.fill();
}

function drawPlinth(g, x, y, width, r, atlas) {
  const depth = r * 0.64;
  const thickness = r * 0.55;
  const rim = r * 0.4;

  g.save();
  g.translate(x + width * 0.54, y + depth + thickness);
  g.scale(width * 0.59, r * 0.83);
  const shadow = g.createRadialGradient(0, 0, 0, 0, 0, 1);
  shadow.addColorStop(0, 'rgba(65, 48, 29, 0.38)');
  shadow.addColorStop(0.7, 'rgba(65, 48, 29, 0.16)');
  shadow.addColorStop(1, 'rgba(65, 48, 29, 0)');
  g.fillStyle = shadow;
  g.fillRect(-1, -1, 2, 2);
  g.restore();

  if (atlas) {
    // 图集最后一行是与棋子同光源渲染的枫木底座。
    g.drawImage(atlas, 0, 784, 721, 114, x, y - depth, width, depth * 2 + thickness);
  } else {
    g.beginPath();
    roundRectPath(g, x, y - depth, width, depth * 2 + thickness, rim);
    g.fillStyle = '#BA9877';
    g.fill();
    g.beginPath();
    roundRectPath(g, x, y - depth, width, depth * 2, rim);
    g.fillStyle = '#DFC6A7';
    g.fill();
  }
}

function drawStage(g, metrics, atlas) {
  const { width, height, rows, positions, rodH, radius: r } = metrics;
  g.save();
  const daylight = g.createLinearGradient(0, height * 0.48, width, height * 0.14);
  daylight.addColorStop(0, '#F4F0E7');
  daylight.addColorStop(0.43, '#FAF7EF');
  daylight.addColorStop(0.61, '#F3EDE1');
  daylight.addColorStop(1, '#E9E1D3');
  g.fillStyle = daylight;
  g.fillRect(0, 0, width, height);
  for (let row = 0; row < rows; row++) {
    const rack = positions.filter(pos => pos.row === row);
    const x = Math.max(12, rack[0].x - r * 1.42);
    drawPlinth(g, x, rack[0].y, width - 2 * x, r, atlas);
  }
  positions.forEach((p, i) => {
    const x = p.x, bottom = p.y - 2;
    ellipse(g, x + r * 0.13, bottom + r * 0.12, r * 0.7, r * 0.23);
    g.fillStyle = 'rgba(91, 59, 32, 0.2)';
    g.fill();
    ellipse(g, x, bottom, r * 0.55, r * 0.22);
    g.fillStyle = '#AE8460';
    g.fill();
    ellipse(g, x, bottom - r * 0.07, r * 0.54, r * 0.21);
    g.fillStyle = '#E6C8A1';
    g.fill();
    drawRodShaft(g, x, bottom - rodH, bottom, r * 0.36, p.step);
    g.fillStyle = '#4B382D';
    g.font = Math.max(8, Math.round(r * 0.32)) + 'px Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(i + 1).padStart(2, '0'), x, p.y + r * 0.9);
  });
  g.restore();
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

    if (rod.length) {
      g.save();
      g.translate(p.x + r * 0.24, p.y + r * 0.18);
      g.scale(r * 1.19, r * 0.37);
      const contact = g.createRadialGradient(0, 0, 0, 0, 0, 1);
      contact.addColorStop(0, 'rgba(65, 45, 32, 0.54)');
      contact.addColorStop(0.75, 'rgba(65, 45, 32, 0.18)');
      contact.addColorStop(1, 'rgba(65, 45, 32, 0)');
      g.fillStyle = contact;
      g.fillRect(-1, -1, 2, 2);
      g.restore();
    }

    const hintedSource = opts.hint && i === opts.hint.from;
    const hintedTarget = opts.hint && i === opts.hint.to;
    if (selected === i || hintedSource || hintedTarget || canMove(board, selected, i, capacity)) {
      ellipse(g, p.x, p.y + r * 0.06, r * 1.1, r * 0.43);
      g.strokeStyle = selected === i || hintedSource ? '#905320' : '#196859';
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
        atlas: opts.atlas,
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
