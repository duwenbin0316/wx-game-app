// 染色木螺母：六角顶面、厚侧面、木纹、中心孔、暖光。纯 Canvas 绘图，可用于分享卡。
const { WOOD, rng, shade, woodFill, drawSlab, drawNail, drawBurnedText } = require('./wood-art');
const { drawClawd, GRID_COLS, GRID_ROWS } = require('./clawd');
const PALETTE = [WOOD.Z, WOOD.I, WOOD.S, WOOD.L, WOOD.T, WOOD.O, WOOD.J];

function ellipse(g, x, y, rx, ry) {
  g.beginPath();
  g.save();
  g.translate(x, y);
  g.scale(rx, ry);
  g.arc(0, 0, 1, 0, Math.PI * 2);
  g.restore();
}

function hex(g, x, y, r) {
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3;
    const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r * 0.46;
    if (!i) g.moveTo(px, py); else g.lineTo(px, py);
  }
  g.closePath();
}

function drawNut(g, x, y, r, color, variant = 0) {
  const base = PALETTE[color % PALETTE.length];
  const thickness = r * 0.53;
  g.save();
  // 下沿投影和六角柱侧面
  ellipse(g, x + r * 0.12, y + thickness + r * 0.15, r, r * 0.39);
  g.fillStyle = 'rgba(20, 8, 2, 0.38)';
  g.fill();
  hex(g, x, y + thickness, r);
  g.fillStyle = shade(base, -0.43);
  g.fill();
  for (let i = 0; i < 3; i++) {
    const a = i * Math.PI / 3, b = (i + 1) * Math.PI / 3;
    const x1 = x + Math.cos(a) * r, y1 = y + Math.sin(a) * r * 0.46;
    const x2 = x + Math.cos(b) * r, y2 = y + Math.sin(b) * r * 0.46;
    g.save();
    g.beginPath();
    g.moveTo(x1, y1); g.lineTo(x2, y2); g.lineTo(x2, y2 + thickness); g.lineTo(x1, y1 + thickness); g.closePath();
    g.clip();
    woodFill(g, x - r, y - r, 2 * r, 2 * r, base, rng(200 + color * 13 + variant), { lines: 9, lineWidth: 0.45, knot: 0 });
    g.fillStyle = `rgba(25, 10, 5, ${[0.32, 0.12, 0.02][i]})`;
    g.fillRect(x - r, y - r, 2 * r, 3 * r);
    g.restore();
  }
  // 顶面木纹与倒角
  g.save(); hex(g, x, y, r); g.clip();
  woodFill(g, x - r, y - r, 2 * r, 2 * r, base, rng(113 + variant * 37 + color * 73), { lines: 12, lineWidth: 0.48, knot: 0 });
  const light = g.createLinearGradient(x - r, y - r, x + r, y + r);
  light.addColorStop(0, 'rgba(255, 243, 210, 0.48)'); light.addColorStop(1, 'rgba(20, 8, 2, 0.18)');
  g.fillStyle = light; g.fillRect(x - r, y - r, r * 2, r * 2); g.restore();
  hex(g, x, y, r * 0.92);
  g.strokeStyle = 'rgba(255, 237, 197, 0.42)'; g.lineWidth = 1; g.stroke();
  // 孔内壁，露出中间的榉木杆
  ellipse(g, x, y, r * 0.32, r * 0.155); g.fillStyle = '#3A2417'; g.fill();
  ellipse(g, x, y + r * 0.045, r * 0.22, r * 0.10); g.fillStyle = '#A67A4D'; g.fill();
  g.fillStyle = '#E7C18B'; g.fillRect(x - r * 0.16, y - r * 0.11, r * 0.32, r * 0.19);
  // 每色有编号，颜色相近或色觉受限时仍可区分
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `bold ${Math.max(9, r * 0.37)}px sans-serif`;
  g.fillStyle = 'rgba(34, 17, 8, 0.68)'; g.fillText(String(color + 1), x, y + thickness * 0.8);
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
      positions.push({ x: width / 2 + (col - (n - 1) / 2) * colW, y: baseY, top: baseY - rodH,
        radius, step, width: colW * 0.95, row });
    }
  }
  return { positions, radius, step, rodH, rows, cols, rowH, width, height };
}

function drawStage(g, metrics, capacity) {
  const { width: w, height: h, positions, rows, rowH, rodH, radius: r } = metrics;
  const bg = g.createRadialGradient(w * 0.5, h * 0.3, 10, w * 0.5, h * 0.6, Math.max(w, h) * 0.85);
  bg.addColorStop(0, '#4C3020'); bg.addColorStop(1, '#201107');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.save(); g.globalAlpha = 0.16;
  woodFill(g, 0, 0, w, h, '#654328', rng(42), { lines: 25, vertical: true, lineWidth: 0.6, knot: 0 }); g.restore();
  if (rows === 1 && h > 300) {
    const plaqueW = Math.min(w * 0.72, 285), plaqueH = 66;
    const plaqueX = (w - plaqueW) / 2, plaqueY = Math.max(14, h * 0.085);
    drawSlab(g, plaqueX, plaqueY, plaqueW, plaqueH, { base: '#A87440', depth: 5, radius: 7, seed: 72, nails: 2.1 });
    const ps = 1.45;
    drawClawd(g, plaqueX + 17, plaqueY + (plaqueH - GRID_ROWS * ps) / 2, ps);
    const textX = plaqueX + (plaqueW + GRID_COLS * ps + 20) / 2;
    drawBurnedText(g, '木 螺 母 归 色', textX, plaqueY + 25, 16, { color: '#45250F' });
    drawBurnedText(g, 'WOODEN NUTS', textX, plaqueY + 46, 9, { color: '#6B431F' });
  }
  for (let row = 0; row < rows; row++) {
    const p = positions.find(pos => pos.row === row);
    drawSlab(g, 8, p.y - r * 0.24, w - 19, r * 1.1, { base: '#A17243', depth: 6, radius: 6, seed: 44 + row, lines: 8 });
    drawNail(g, 17, p.y + r * 0.45, 2.4); drawNail(g, w - 22, p.y + r * 0.45, 2.4);
    if (rows > 1 && row === 0) {
      g.fillStyle = '#CFAC7977'; g.fillRect(w * 0.38, rowH + 3, w * 0.24, 1);
    }
  }
  positions.forEach(p => {
    const x = p.x, bottom = p.y - 4;
    ellipse(g, x + 3, bottom + 8, r * 0.75, r * 0.24); g.fillStyle = '#24140766'; g.fill();
    ellipse(g, x, bottom + 4, r * 0.64, r * 0.25); g.fillStyle = '#53331C'; g.fill();
    ellipse(g, x, bottom, r * 0.64, r * 0.25); g.fillStyle = '#BE8C50'; g.fill();
    const rodW = r * 0.33;
    const rod = g.createLinearGradient(x - rodW / 2, 0, x + rodW / 2, 0);
    rod.addColorStop(0, '#9A693D'); rod.addColorStop(0.35, '#F2D6A6'); rod.addColorStop(0.65, '#DDB784'); rod.addColorStop(1, '#8C5B32');
    g.fillStyle = rod; g.fillRect(x - rodW / 2, bottom - rodH, rodW, rodH);
    g.strokeStyle = '#73502B55'; g.lineWidth = 0.55;
    for (let y = bottom - rodH + 6; y < bottom; y += 5) {
      g.beginPath(); g.moveTo(x - rodW / 2, y + 1.5); g.lineTo(x + rodW / 2, y - 1.5); g.stroke();
    }
    ellipse(g, x, bottom - rodH, rodW / 2, rodW * 0.2); g.fillStyle = '#F3D7A7'; g.fill();
  });
}

function drawBoard(g, board, metrics, opts = {}) {
  const { positions, radius: r, step } = metrics;
  positions.forEach((p, i) => {
    const rod = board[i];
    if (opts.hint && (i === opts.hint.from || i === opts.hint.to)) {
      ellipse(g, p.x, p.y + 7, r * 1.13, r * 0.38);
      g.strokeStyle = i === opts.hint.from ? '#FFF0BB' : '#A8D487'; g.lineWidth = 2; g.stroke();
    }
    rod.forEach((color, level) => {
      if (opts.moving && i === opts.moving.from && level === rod.length - 1) return;
      const lift = opts.selected === i && level === rod.length - 1 ? r * 0.75 : 0;
      drawNut(g, p.x, p.y - r * 0.6 - level * step - lift, r, color, i + level);
    });
    const complete = rod.length === opts.capacity && rod.every(c => c === rod[0]);
    g.font = `${complete ? 'bold ' : ''}${Math.max(10, r * 0.38)}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = complete ? '#E6C572' : '#E2C094AA';
    g.fillText(complete ? '✓' : String(i + 1).padStart(2, '0'), p.x, p.y + r * 0.57);
  });
}

module.exports = { PALETTE, drawNut, layout, drawStage, drawBoard };
