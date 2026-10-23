// ── 五子棋 · Canvas 棋盘渲染 ─────────────────────────────────
// 榧木直纹棋盘 + 墨线 + 黑石(那智黑)/ 白石(蛤碁石)。
// 棋盘底(木纹、墨线、星位、坐标)和两种棋子都只画一次存成离屏图,每帧只贴图。
// 动画:
//   落子:棋子从上方落下(略大 → 原尺寸,影子由淡变实),落定时一圈涟漪
//   连五:金色连线呼吸发光
//   瞄准(aim):手指按住拖动时,目标交叉点十字引导线 + 半透明棋子 +
//               手指上方的放大镜(2 倍),手指不会挡住落点
//   预落子(ghost):半透明棋子 + 所在行列高亮(落子确认模式)
//   提示:绿色脉冲圈
// 页面只需 setState(...);点击坐标用 hitTest 换成行列。
const { woodFill, rng } = require('./wood-art.js');

const N = 15;
const LETTERS = 'ABCDEFGHJKLMNOP';   // 惯例跳过 I,避免和 1 混淆
const STARS = [[3, 3], [3, 11], [7, 7], [11, 3], [11, 11]];
const BOARD_WOOD = '#DCA964';
const INK = 'rgba(48, 26, 8, 0.82)';
const DROP_MS = 200;      // 落子下落时长
const RIPPLE_MS = 460;    // 落定涟漪时长
const LOUPE_ZOOM = 2;

class BoardRenderer {
  // opts.createCanvas(w, h) 用来建离屏图(没有就每帧直接画);opts.dpr 是像素比
  constructor(canvas, ctx, size, opts) {
    this.canvas = canvas;
    this.ctx = ctx;
    this.size = size;
    this.dpr = (opts && opts.dpr) || 2;
    this.createCanvas = opts && opts.createCanvas;
    this.margin = Math.round(size * 0.065);
    this.gap = (size - this.margin * 2) / (N - 1);
    this.radius = this.gap * 0.47;
    this.state = {
      board: null, lastKey: '', winCells: [], numbers: null,
      ghost: null, hint: null, aim: null, dim: false,
    };
    this.anims = [];      // 落子动画 { r, c, t0 }
    this.raf = null;
    this.prevBoard = null;
    this._bake();
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

  // 拖动瞄准用:不限距离,夹到棋盘范围内
  nearest(x, y) {
    const clamp = v => Math.max(0, Math.min(N - 1, v));
    return {
      r: clamp(Math.round((y - this.margin) / this.gap)),
      c: clamp(Math.round((x - this.margin) / this.gap)),
    };
  }

  setState(patch) {
    const next = Object.assign({}, this.state, patch);
    // 新出现的棋子播落子动画(本地、电脑、对手联机落子都走这里)
    const board = next.board;
    if (board && this.prevBoard && !patch.noAnim && patch.board) {
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
    if (patch.board) this.prevBoard = board ? board.map(row => row.slice()) : null;
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

  // ── 离屏图:棋盘底 + 黑白棋子 ──────────────────────────────
  _bake() {
    this.bg = null;
    this.stones = null;
    if (!this.createCanvas) return;
    try {
      const S = this.size;
      const bg = this.createCanvas(Math.round(S * this.dpr), Math.round(S * this.dpr));
      const g = bg.getContext('2d');
      g.scale(this.dpr, this.dpr);
      this._paintBoard(g, S);
      this.bg = bg;
      // 棋子精灵:边长 = 直径 + 投影余量
      const R = this.radius;
      const pad = Math.ceil(R * 0.45);
      const side = Math.ceil(R * 2 + pad * 2);
      const mk = color => {
        const c = this.createCanvas(Math.ceil(side * this.dpr), Math.ceil(side * this.dpr));
        const sg = c.getContext('2d');
        sg.scale(this.dpr, this.dpr);
        this._paintStone(sg, side / 2, side / 2, R, color);
        return c;
      };
      this.stones = { black: mk('black'), white: mk('white'), side };
    } catch (e) {
      this.bg = null;
      this.stones = null;
    }
  }

  // 棋盘:榧木直纹 + 四边倒角 + 墨线 + 星位 + 刻字坐标
  _paintBoard(g, S) {
    woodFill(g, 0, 0, S, S, BOARD_WOOD, rng(1507), { vertical: true, lines: 26, lineWidth: 0.9, knot: 0, contrast: 0.75 });
    const light = g.createLinearGradient(0, 0, S, S);
    light.addColorStop(0, 'rgba(255, 246, 225, 0.22)');
    light.addColorStop(0.55, 'rgba(255, 246, 225, 0)');
    light.addColorStop(1, 'rgba(90, 45, 10, 0.18)');
    g.fillStyle = light;
    g.fillRect(0, 0, S, S);
    // 倒角:左上一道亮边、右下一道暗边
    const e = Math.max(2, S * 0.008);
    g.fillStyle = 'rgba(255, 240, 210, 0.45)';
    g.fillRect(0, 0, S, e);
    g.fillRect(0, 0, e, S);
    g.fillStyle = 'rgba(70, 35, 8, 0.35)';
    g.fillRect(0, S - e, S, e);
    g.fillRect(S - e, 0, e, S);

    // 墨线:内线细、外框粗
    const lo = this.pos(0);
    const hi = this.pos(N - 1);
    g.strokeStyle = INK;
    g.lineWidth = Math.max(0.8, this.gap * 0.045);
    g.beginPath();
    for (let i = 0; i < N; i++) {
      const p = Math.round(this.pos(i) * 2) / 2;
      g.moveTo(lo, p); g.lineTo(hi, p);
      g.moveTo(p, lo); g.lineTo(p, hi);
    }
    g.stroke();
    g.lineWidth = Math.max(1.6, this.gap * 0.09);
    g.strokeRect(lo, lo, hi - lo, hi - lo);
    g.fillStyle = 'rgba(48, 26, 8, 0.92)';
    for (const [r, c] of STARS) {
      g.beginPath();
      g.arc(this.pos(c), this.pos(r), Math.max(2, this.gap * 0.12), 0, Math.PI * 2);
      g.fill();
    }
    // 坐标:刻进木头的字(下方一道亮边)
    const fs = Math.max(8, Math.round(this.margin * 0.44));
    g.font = `bold ${fs}px sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const m = this.margin * 0.46;
    for (let i = 0; i < N; i++) {
      [[LETTERS[i], this.pos(i), m], [String(N - i), m, this.pos(i)]].forEach(([t, x, y]) => {
        g.fillStyle = 'rgba(255, 238, 205, 0.55)';
        g.fillText(t, x, y + 0.8);
        g.fillStyle = 'rgba(82, 44, 12, 0.78)';
        g.fillText(t, x, y);
      });
    }
    g.textBaseline = 'alphabetic';
  }

  // 一颗棋子(含柔和投影):黑石哑光带一点光泽,白石带蛤壳细纹和高光
  _paintStone(g, x, y, R, color) {
    g.save();
    // 投影:几层越来越大越来越淡,像软阴影
    [[0.16, 0.2, 1.02, 0.22], [0.2, 0.26, 1.1, 0.12], [0.24, 0.32, 1.2, 0.06]].forEach(([dx, dy, k, a]) => {
      g.fillStyle = `rgba(40, 18, 0, ${a})`;
      g.beginPath();
      g.arc(x + R * dx, y + R * dy, R * k, 0, Math.PI * 2);
      g.fill();
    });
    const grad = g.createRadialGradient(x - R * 0.32, y - R * 0.36, R * 0.05, x, y, R);
    if (color === 'black') {
      grad.addColorStop(0, '#5C5C62');
      grad.addColorStop(0.3, '#2C2C31');
      grad.addColorStop(0.8, '#121215');
      grad.addColorStop(1, '#060608');
    } else {
      grad.addColorStop(0, '#FFFFFF');
      grad.addColorStop(0.5, '#F5F2EA');
      grad.addColorStop(0.88, '#DEDACE');
      grad.addColorStop(1, '#C4BEB0');
    }
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, R, 0, Math.PI * 2);
    g.fill();
    g.save();
    g.beginPath();
    g.arc(x, y, R, 0, Math.PI * 2);
    g.clip();
    if (color === 'white') {
      // 蛤碁石的细纹:一组很淡的弧线
      g.strokeStyle = 'rgba(150, 140, 120, 0.16)';
      g.lineWidth = Math.max(0.4, R * 0.035);
      for (let i = -4; i <= 4; i++) {
        g.beginPath();
        g.arc(x - R * 1.6, y + R * 1.6, R * (2.1 + i * 0.16), -Math.PI / 2, 0);
        g.stroke();
      }
    } else {
      // 黑石底部一圈很淡的反光,显得圆润
      const rim = g.createRadialGradient(x + R * 0.3, y + R * 0.35, R * 0.4, x, y, R);
      rim.addColorStop(0, 'rgba(255, 255, 255, 0)');
      rim.addColorStop(0.85, 'rgba(255, 255, 255, 0)');
      rim.addColorStop(1, 'rgba(255, 255, 255, 0.08)');
      g.fillStyle = rim;
      g.fillRect(x - R, y - R, R * 2, R * 2);
    }
    g.restore();
    // 高光
    const hl = g.createRadialGradient(x - R * 0.36, y - R * 0.42, 0, x - R * 0.36, y - R * 0.42, R * 0.5);
    hl.addColorStop(0, color === 'black' ? 'rgba(255, 255, 255, 0.32)' : 'rgba(255, 255, 255, 0.9)');
    hl.addColorStop(1, 'rgba(255, 255, 255, 0)');
    g.fillStyle = hl;
    g.beginPath();
    g.arc(x, y, R, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  _stone(ctx, x, y, color, scale, alpha) {
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = prev * alpha;
    if (this.stones) {
      const s = this.stones.side * scale;
      ctx.drawImage(this.stones[color], x - s / 2, y - s / 2, s, s);
    } else {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      this._paintStone(ctx, 0, 0, this.radius, color);
      ctx.restore();
    }
    ctx.globalAlpha = prev;
  }

  // ── 每帧 ────────────────────────────────────────────────
  _frame() {
    const now = Date.now();
    this.anims = this.anims.filter(a => now - a.t0 < RIPPLE_MS);
    const ctx = this.ctx;
    const S = this.size;
    ctx.clearRect(0, 0, S, S);
    this._drawScene(ctx, now);
    const st = this.state;
    if (st.dim) {
      ctx.fillStyle = 'rgba(20, 12, 4, 0.25)';
      ctx.fillRect(0, 0, S, S);
    }
    if (st.aim && st.aim.touch) this._drawLoupe(ctx, st.aim, now);
  }

  // 棋盘 + 引导线 + 棋子 + 各种标记;放大镜里也用它再画一遍
  _drawScene(ctx, now) {
    const S = this.size;
    if (this.bg) ctx.drawImage(this.bg, 0, 0, S, S);
    else this._paintBoard(ctx, S);
    const st = this.state;
    const target = st.aim || st.ghost;
    if (target) this._drawGuide(ctx, target, !!st.aim);
    if (st.board) this._drawStones(ctx, st, now);
    if (st.winCells.length) this._drawWinLine(ctx, st.winCells, now);
    if (st.hint) this._drawHint(ctx, st.hint, now);
    if (target && !(st.board && st.board[target.r] && st.board[target.r][target.c])) this._drawGhost(ctx, target, !!st.aim);
  }

  _drawStones(ctx, st, now) {
    const board = st.board;
    const winSet = {};
    st.winCells.forEach(k => { winSet[k] = true; });
    const animMap = {};
    this.anims.forEach(a => { animMap[`${a.r}-${a.c}`] = a; });
    const R = this.radius;
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const v = board[r][c];
        if (v !== 'black' && v !== 'white') continue;
        const key = `${r}-${c}`;
        const x = this.pos(c);
        const y = this.pos(r);
        const a = animMap[key];
        if (a) {
          // 从上方落下:前 DROP_MS 毫秒放大 + 往上偏,落定后一圈涟漪
          const t = Math.min(1, (now - a.t0) / DROP_MS);
          const e = t * t;
          const lift = (1 - e) * R * 0.9;
          if (t >= 1) {
            const rt = Math.min(1, (now - a.t0 - DROP_MS) / (RIPPLE_MS - DROP_MS));
            ctx.strokeStyle = `rgba(255, 240, 200, ${0.65 * (1 - rt)})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(x, y, R * (1 + rt * 0.9), 0, Math.PI * 2);
            ctx.stroke();
          }
          this._stone(ctx, x, y - lift, v, 1.22 - 0.22 * e, 0.55 + 0.45 * e);
        } else {
          this._stone(ctx, x, y, v, 1, 1);
        }
        if (winSet[key]) {
          ctx.strokeStyle = '#FFD24A';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, R + 1.5, 0, Math.PI * 2);
          ctx.stroke();
        }
        const num = st.numbers && st.numbers[key];
        if (num) {
          ctx.fillStyle = key === st.lastKey ? '#E8483E' : (v === 'black' ? '#F2F0EA' : '#1A1A1E');
          ctx.font = `bold ${Math.round(R * (num >= 100 ? 0.78 : 0.95))}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(num), x, y + 0.5);
          ctx.textBaseline = 'alphabetic';
        } else if (key === st.lastKey && !a) {
          // 最后一手:红色小圆点,带一圈浅色描边,黑白子上都显眼
          ctx.fillStyle = v === 'black' ? 'rgba(255, 255, 255, 0.85)' : 'rgba(40, 20, 10, 0.5)';
          ctx.beginPath();
          ctx.arc(x, y, R * 0.3, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#E8483E';
          ctx.beginPath();
          ctx.arc(x, y, R * 0.22, 0, Math.PI * 2);
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
    ctx.strokeStyle = `rgba(255, 200, 60, ${0.25 * pulse})`;
    ctx.lineWidth = this.radius * 1.3;
    ctx.beginPath();
    ctx.moveTo(this.pos(c1), this.pos(r1));
    ctx.lineTo(this.pos(c2), this.pos(r2));
    ctx.stroke();
    ctx.strokeStyle = `rgba(255, 220, 90, ${0.65 + 0.35 * pulse})`;
    ctx.lineWidth = Math.max(2, this.radius * 0.22);
    ctx.stroke();
    ctx.restore();
  }

  _drawHint(ctx, hint, now) {
    const x = this.pos(hint.c);
    const y = this.pos(hint.r);
    const t = (now % 1000) / 1000;
    ctx.strokeStyle = `rgba(60, 200, 120, ${0.9 - t * 0.7})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, this.radius * (0.7 + t * 0.7), 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(60, 200, 120, 0.85)';
    ctx.beginPath();
    ctx.arc(x, y, this.radius * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  // 目标点所在的行列:一道暖色引导线 + 交叉点上的小十字
  _drawGuide(ctx, g, strong) {
    const lo = this.pos(0);
    const hi = this.pos(N - 1);
    const x = this.pos(g.c);
    const y = this.pos(g.r);
    ctx.save();
    ctx.strokeStyle = strong ? 'rgba(200, 70, 30, 0.6)' : 'rgba(200, 70, 30, 0.42)';
    ctx.lineWidth = strong ? 2 : 1.5;
    ctx.beginPath();
    ctx.moveTo(lo, y); ctx.lineTo(hi, y);
    ctx.moveTo(x, lo); ctx.lineTo(x, hi);
    ctx.stroke();
    ctx.restore();
  }

  // 半透明的待落棋子 + 一圈金色描边(瞄准时描边更亮)
  _drawGhost(ctx, g, aiming) {
    const x = this.pos(g.c);
    const y = this.pos(g.r);
    this._stone(ctx, x, y, g.color, 1, aiming ? 0.7 : 0.6);
    ctx.save();
    ctx.strokeStyle = aiming ? '#FFB547' : '#E0902C';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, this.radius + 2.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // 放大镜:在手指上方(上面放不下就放下面)画一个圆,里面是目标点附近 2 倍放大
  _drawLoupe(ctx, aim, now) {
    const S = this.size;
    const LR = this.gap * 2.6;                 // 放大镜半径
    const tx = aim.touch.x;
    const ty = aim.touch.y;
    let cx = Math.max(LR + 2, Math.min(S - LR - 2, tx));
    let cy = ty - LR - this.gap * 1.6;
    if (cy - LR < 2) cy = ty + LR + this.gap * 1.6;
    cy = Math.max(LR + 2, Math.min(S - LR - 2, cy));
    const px = this.pos(aim.c);
    const py = this.pos(aim.r);
    ctx.save();
    // 外框投影 + 木框
    ctx.fillStyle = 'rgba(30, 14, 2, 0.4)';
    ctx.beginPath();
    ctx.arc(cx + 2, cy + 4, LR + 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#6E4222';
    ctx.beginPath();
    ctx.arc(cx, cy, LR + 4, 0, Math.PI * 2);
    ctx.fill();
    // 里面:以目标点为中心放大重画整盘(裁到圆里)
    ctx.beginPath();
    ctx.arc(cx, cy, LR, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(cx, cy);
    ctx.scale(LOUPE_ZOOM, LOUPE_ZOOM);
    ctx.translate(-px, -py);
    this._drawScene(ctx, now);
    ctx.restore();
    // 镜片高光 + 金属圈
    ctx.save();
    const gl = ctx.createLinearGradient(cx - LR, cy - LR, cx + LR, cy + LR);
    gl.addColorStop(0, 'rgba(255, 255, 255, 0.22)');
    gl.addColorStop(0.45, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = gl;
    ctx.beginPath();
    ctx.arc(cx, cy, LR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#D9A93F';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, LR + 1, 0, Math.PI * 2);
    ctx.stroke();
    // 坐标小牌
    const label = `${LETTERS[aim.c]}${N - aim.r}`;
    const fs = Math.max(10, Math.round(this.gap * 0.62));
    ctx.font = `bold ${fs}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lw = ctx.measureText ? ctx.measureText(label).width + 12 : fs * 2.6;
    const ly = cy + LR - fs * 0.2;
    ctx.fillStyle = 'rgba(60, 30, 8, 0.88)';
    ctx.fillRect(cx - lw / 2, ly - fs * 0.62, lw, fs * 1.24);
    ctx.fillStyle = '#FFE7B0';
    ctx.fillText(label, cx, ly);
    ctx.restore();
  }
}

module.exports = { BoardRenderer, LETTERS };
