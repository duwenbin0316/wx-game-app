// ── 五子棋 · Canvas 棋盘渲染 ─────────────────────────────────
// 木纹棋盘 + 有光泽的棋子 + 坐标。只在状态变化或有动画时重绘:
//   落子:新棋子从略大缩回原尺寸,外圈一道涟漪
//   连五:金色连线呼吸发光
//   预落子:半透明棋子 + 所在行列高亮(落子确认模式)
//   提示:绿色脉冲圈
// 页面只需 setState(...) 后调用 draw();点击坐标用 hitTest 换成行列。

const N = 15;
const LETTERS = 'ABCDEFGHJKLMNOP';   // 惯例跳过 I,避免和 1 混淆
const STARS = [[3, 3], [3, 11], [7, 7], [11, 3], [11, 11]];

// 木纹:确定性的几十条波浪线,每次画出来都一样
function makeGrain() {
  let s = 20260926;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const lines = [];
  for (let i = 0; i < 46; i++) {
    lines.push({
      y: rnd(),
      amp: 0.002 + rnd() * 0.005,
      freq: 1 + rnd() * 2,
      phase: rnd() * Math.PI * 2,
      w: 0.5 + rnd() * 1.2,
      a: 0.025 + rnd() * 0.05,
      dark: rnd() < 0.7,
    });
  }
  return lines;
}
const GRAIN = makeGrain();

class BoardRenderer {
  constructor(canvas, ctx, size) {
    this.canvas = canvas;
    this.ctx = ctx;
    this.size = size;
    this.margin = Math.round(size * 0.07);
    this.gap = (size - this.margin * 2) / (N - 1);
    this.radius = this.gap * 0.46;
    this.state = {
      board: null, lastKey: '', winCells: [], numbers: null,
      ghost: null, hint: null, dim: false,
    };
    this.anims = [];      // 落子动画 { r, c, t0 }
    this.raf = null;
    this.prevBoard = null;
    this._buildGradients();
  }

  // 棋子渐变以 (0,0) 为圆心建一次,画时 translate 过去复用
  _buildGradients() {
    const ctx = this.ctx;
    const R = this.radius;
    const b = ctx.createRadialGradient(-R * 0.35, -R * 0.38, R * 0.05, 0, 0, R);
    b.addColorStop(0, '#7A7A80');
    b.addColorStop(0.28, '#35353A');
    b.addColorStop(0.75, '#111114');
    b.addColorStop(1, '#050507');
    const w = ctx.createRadialGradient(-R * 0.35, -R * 0.38, R * 0.05, 0, 0, R);
    w.addColorStop(0, '#FFFFFF');
    w.addColorStop(0.45, '#F4F2EC');
    w.addColorStop(0.85, '#D9D5CA');
    w.addColorStop(1, '#BDB8AC');
    this.gradBlack = b;
    this.gradWhite = w;
    const S = this.size;
    const wood = ctx.createLinearGradient(0, 0, S, S);
    wood.addColorStop(0, '#E9C48A');
    wood.addColorStop(0.5, '#DDB06A');
    wood.addColorStop(1, '#CF9C55');
    this.gradWood = wood;
    const vig = ctx.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S * 0.75);
    vig.addColorStop(0, 'rgba(90,50,10,0)');
    vig.addColorStop(1, 'rgba(90,50,10,0.28)');
    this.gradVig = vig;
  }

  pos(i) {
    return this.margin + i * this.gap;
  }

  // 触点(canvas 内坐标)→ 最近的交叉点;离得太远返回 null
  hitTest(x, y) {
    const c = Math.round((x - this.margin) / this.gap);
    const r = Math.round((y - this.margin) / this.gap);
    if (r < 0 || r >= N || c < 0 || c >= N) return null;
    const dx = x - this.pos(c);
    const dy = y - this.pos(r);
    if (dx * dx + dy * dy > (this.gap * 0.75) * (this.gap * 0.75)) return null;
    return { r, c };
  }

  setState(patch) {
    const next = Object.assign({}, this.state, patch);
    // 新出现的棋子播落子动画(本地、电脑、对手联机落子都走这里)
    const board = next.board;
    if (board && this.prevBoard && !patch.noAnim) {
      let added = 0;
      const fresh = [];
      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          if (board[r][c] && !this.prevBoard[r][c]) { added++; fresh.push({ r, c }); }
        }
      }
      // 一次冒出很多子是整盘替换(进房、复盘跳转),不逐个动画
      if (added > 0 && added <= 2) {
        const now = Date.now();
        fresh.forEach(p => this.anims.push({ r: p.r, c: p.c, t0: now }));
      }
    }
    this.prevBoard = board ? board.map(row => row.slice()) : null;
    this.state = next;
    this.draw();
  }

  _needsLoop() {
    return this.anims.length > 0 || this.state.winCells.length > 0 || !!this.state.hint;
  }

  draw() {
    if (this.raf) return;   // 已经在动画循环里,下一帧会画
    this._frame();
    if (this._needsLoop()) this._loop();
  }

  _loop() {
    const step = () => {
      this._frame();
      if (this._needsLoop()) {
        this.raf = this.canvas.requestAnimationFrame(step);
      } else {
        this.raf = null;
      }
    };
    this.raf = this.canvas.requestAnimationFrame(step);
  }

  stop() {
    if (this.raf) {
      this.canvas.cancelAnimationFrame(this.raf);
      this.raf = null;
    }
  }

  _frame() {
    const now = Date.now();
    this.anims = this.anims.filter(a => now - a.t0 < 420);
    const ctx = this.ctx;
    const S = this.size;
    ctx.clearRect(0, 0, S, S);
    this._drawWood(ctx, S);
    this._drawGrid(ctx);
    const st = this.state;
    if (st.ghost) this._drawGhostLines(ctx, st.ghost);
    if (st.board) this._drawStones(ctx, st, now);
    if (st.winCells.length) this._drawWinLine(ctx, st.winCells, now);
    if (st.hint) this._drawHint(ctx, st.hint, now);
    if (st.ghost) this._drawGhost(ctx, st.ghost);
    if (st.dim) {
      ctx.fillStyle = 'rgba(20,12,4,0.25)';
      ctx.fillRect(0, 0, S, S);
    }
  }

  _drawWood(ctx, S) {
    ctx.fillStyle = this.gradWood;
    ctx.fillRect(0, 0, S, S);
    // 木纹
    ctx.save();
    for (const g of GRAIN) {
      ctx.strokeStyle = g.dark ? `rgba(120,70,20,${g.a})` : `rgba(255,235,190,${g.a})`;
      ctx.lineWidth = g.w;
      ctx.beginPath();
      for (let x = 0; x <= S; x += S / 24) {
        const y = (g.y + Math.sin((x / S) * g.freq * Math.PI * 2 + g.phase) * g.amp) * S;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = this.gradVig;
    ctx.fillRect(0, 0, S, S);
  }

  _drawGrid(ctx) {
    const lo = this.pos(0);
    const hi = this.pos(N - 1);
    ctx.strokeStyle = 'rgba(58,32,10,0.78)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const p = Math.round(this.pos(i)) + 0.5;
      ctx.moveTo(lo, p); ctx.lineTo(hi, p);
      ctx.moveTo(p, lo); ctx.lineTo(p, hi);
    }
    ctx.stroke();
    // 外框加粗
    ctx.lineWidth = 2;
    ctx.strokeRect(lo, lo, hi - lo, hi - lo);
    // 星位
    ctx.fillStyle = 'rgba(58,32,10,0.9)';
    for (const [r, c] of STARS) {
      ctx.beginPath();
      ctx.arc(this.pos(c), this.pos(r), Math.max(2, this.gap * 0.11), 0, Math.PI * 2);
      ctx.fill();
    }
    // 坐标
    const fs = Math.max(8, Math.round(this.margin * 0.42));
    ctx.fillStyle = 'rgba(80,45,15,0.72)';
    ctx.font = `${fs}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const m = this.margin * 0.48;
    for (let i = 0; i < N; i++) {
      ctx.fillText(LETTERS[i], this.pos(i), m);
      ctx.fillText(String(N - i), m, this.pos(i));
    }
    ctx.textBaseline = 'alphabetic';
  }

  _stone(ctx, x, y, color, scale, alpha) {
    const R = this.radius;
    ctx.save();
    ctx.translate(x, y);
    if (scale !== 1) ctx.scale(scale, scale);
    ctx.globalAlpha = alpha;
    // 投影
    ctx.fillStyle = 'rgba(40,20,0,0.35)';
    ctx.beginPath();
    ctx.arc(R * 0.1, R * 0.16, R * 1.02, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color === 'black' ? this.gradBlack : this.gradWhite;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fill();
    // 顶部高光
    ctx.fillStyle = color === 'black' ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.7)';
    ctx.beginPath();
    ctx.ellipse(-R * 0.3, -R * 0.42, R * 0.34, R * 0.16, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _drawStones(ctx, st, now) {
    const board = st.board;
    const winSet = {};
    st.winCells.forEach(k => { winSet[k] = true; });
    const animMap = {};
    this.anims.forEach(a => { animMap[`${a.r}-${a.c}`] = a; });
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const v = board[r][c];
        if (v !== 'black' && v !== 'white') continue;
        const key = `${r}-${c}`;
        const x = this.pos(c);
        const y = this.pos(r);
        let scale = 1;
        let alpha = 1;
        const a = animMap[key];
        if (a) {
          const t = Math.min(1, (now - a.t0) / 180);
          const e = 1 - Math.pow(1 - t, 3);
          scale = 1.35 - 0.35 * e;
          alpha = 0.3 + 0.7 * e;
          // 涟漪
          const rt = Math.min(1, (now - a.t0) / 420);
          ctx.strokeStyle = `rgba(255,240,200,${0.7 * (1 - rt)})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, this.radius * (1 + rt * 1.1), 0, Math.PI * 2);
          ctx.stroke();
        }
        this._stone(ctx, x, y, v, scale, alpha);
        if (winSet[key]) {
          ctx.strokeStyle = '#FFD24A';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, this.radius + 1.5, 0, Math.PI * 2);
          ctx.stroke();
        }
        const num = st.numbers && st.numbers[key];
        if (num) {
          ctx.fillStyle = key === st.lastKey ? '#E8483E' : (v === 'black' ? '#F2F0EA' : '#1A1A1E');
          ctx.font = `bold ${Math.round(this.radius * (num >= 100 ? 0.78 : 0.95))}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(num), x, y + 0.5);
          ctx.textBaseline = 'alphabetic';
        } else if (key === st.lastKey && !a) {
          // 最后一手:红点
          ctx.fillStyle = '#E8483E';
          ctx.beginPath();
          ctx.arc(x, y, this.radius * 0.24, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  _drawWinLine(ctx, cells, now) {
    const pts = cells.map(k => k.split('-').map(Number));
    // 按行列排序,取两端
    pts.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
    const [r1, c1] = pts[0];
    const [r2, c2] = pts[pts.length - 1];
    const pulse = 0.55 + 0.45 * Math.sin(now / 220);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = `rgba(255,200,60,${0.25 * pulse})`;
    ctx.lineWidth = this.radius * 1.3;
    ctx.beginPath();
    ctx.moveTo(this.pos(c1), this.pos(r1));
    ctx.lineTo(this.pos(c2), this.pos(r2));
    ctx.stroke();
    ctx.strokeStyle = `rgba(255,220,90,${0.65 + 0.35 * pulse})`;
    ctx.lineWidth = Math.max(2, this.radius * 0.22);
    ctx.stroke();
    ctx.restore();
  }

  _drawHint(ctx, hint, now) {
    const x = this.pos(hint.c);
    const y = this.pos(hint.r);
    const t = (now % 1000) / 1000;
    ctx.strokeStyle = `rgba(60,200,120,${0.9 - t * 0.7})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, this.radius * (0.7 + t * 0.7), 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(60,200,120,0.85)';
    ctx.beginPath();
    ctx.arc(x, y, this.radius * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawGhostLines(ctx, g) {
    const lo = this.pos(0);
    const hi = this.pos(N - 1);
    ctx.strokeStyle = 'rgba(217,119,87,0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(lo, this.pos(g.r)); ctx.lineTo(hi, this.pos(g.r));
    ctx.moveTo(this.pos(g.c), lo); ctx.lineTo(this.pos(g.c), hi);
    ctx.stroke();
  }

  _drawGhost(ctx, g) {
    this._stone(ctx, this.pos(g.c), this.pos(g.r), g.color, 1, 0.55);
    ctx.strokeStyle = '#D97757';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(this.pos(g.c), this.pos(g.r), this.radius + 2, 0, Math.PI * 2);
    ctx.stroke();
  }
}

module.exports = { BoardRenderer, LETTERS };
