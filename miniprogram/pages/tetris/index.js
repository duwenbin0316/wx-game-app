// ─── 像素俄罗斯方块 · 重制版 ─────────────────────────────
// 现代规则重写:7-bag 发牌、完整 SRS 踢墙、幽灵投影、HOLD、
// 三连预览、锁定延迟、T-Spin / B2B / 连击 / 全清计分。
// rAF 主循环驱动重力与 DAS/ARR 按键手感,消行闪白收缩、
// 硬降拖尾震屏、危险区红光等动画全部画在棋盘画布上。
const COLS = 10;
const VISIBLE_ROWS = 20;
const HIDDEN_ROWS = 2;                       // 顶部缓冲(出生区)
const ROWS = VISIBLE_ROWS + HIDDEN_ROWS;

const DAS_MS = 160;      // 按住方向后首次连发延迟
const ARR_MS = 40;       // 连发间隔
const SOFT_MS = 35;      // 软降每行间隔
const LOCK_MS = 500;     // 触底锁定延迟
const LOCK_RESETS = 15;  // 锁定延迟最多重置次数
const CLEAR_MS = 300;    // 消行动画时长
const OVER_FILL_MS = 600;// 结束时灰块淹没动画
const STORAGE_KEY = 'tetris_best';

const PIECE_COLORS = {
  I: '#60C0FF', O: '#D97757', T: '#A855F7', S: '#4CAF50',
  Z: '#FF6B6B', J: '#4A6FA5', L: '#F5C842',
};
const PIECE_TYPES = Object.keys(PIECE_COLORS);

// 各方块在包围盒内的出生形态(SRS 标准),其余旋转态程序生成
const BASE_CELLS = {
  I: { size: 4, cells: [[1, 0], [1, 1], [1, 2], [1, 3]] },
  O: { size: 2, cells: [[0, 0], [0, 1], [1, 0], [1, 1]] },
  T: { size: 3, cells: [[0, 1], [1, 0], [1, 1], [1, 2]] },
  S: { size: 3, cells: [[0, 1], [0, 2], [1, 0], [1, 1]] },
  Z: { size: 3, cells: [[0, 0], [0, 1], [1, 1], [1, 2]] },
  J: { size: 3, cells: [[0, 0], [1, 0], [1, 1], [1, 2]] },
  L: { size: 3, cells: [[0, 2], [1, 0], [1, 1], [1, 2]] },
};

const SHAPES = {};      // type → [4 个旋转态的格子列表]
const BOX_SIZE = {};
PIECE_TYPES.forEach(t => {
  const { size, cells } = BASE_CELLS[t];
  const rots = [cells];
  for (let i = 1; i < 4; i++) {
    rots.push(rots[i - 1].map(([r, c]) => [c, size - 1 - r]));
  }
  SHAPES[t] = rots;
  BOX_SIZE[t] = size;
});

// SRS 踢墙表,已换算成 [dRow, dCol](屏幕坐标,行向下为正)
const KICKS_JLSTZ = {
  '0>1': [[0, 0], [0, -1], [-1, -1], [2, 0], [2, -1]],
  '1>0': [[0, 0], [0, 1], [1, 1], [-2, 0], [-2, 1]],
  '1>2': [[0, 0], [0, 1], [1, 1], [-2, 0], [-2, 1]],
  '2>1': [[0, 0], [0, -1], [-1, -1], [2, 0], [2, -1]],
  '2>3': [[0, 0], [0, 1], [-1, 1], [2, 0], [2, 1]],
  '3>2': [[0, 0], [0, -1], [1, -1], [-2, 0], [-2, -1]],
  '3>0': [[0, 0], [0, -1], [1, -1], [-2, 0], [-2, -1]],
  '0>3': [[0, 0], [0, 1], [-1, 1], [2, 0], [2, 1]],
};
const KICKS_I = {
  '0>1': [[0, 0], [0, -2], [0, 1], [1, -2], [-2, 1]],
  '1>0': [[0, 0], [0, 2], [0, -1], [-1, 2], [2, -1]],
  '1>2': [[0, 0], [0, -1], [0, 2], [-2, -1], [1, 2]],
  '2>1': [[0, 0], [0, 1], [0, -2], [2, 1], [-1, -2]],
  '2>3': [[0, 0], [0, 2], [0, -1], [-1, 2], [2, -1]],
  '3>2': [[0, 0], [0, -2], [0, 1], [1, -2], [-2, 1]],
  '3>0': [[0, 0], [0, 1], [0, -2], [2, 1], [-1, -2]],
  '0>3': [[0, 0], [0, -1], [0, 2], [-2, -1], [1, 2]],
};

// T-Spin 判定:T 中心四角(包围盒坐标)与各朝向的"前角"
const T_CORNERS = [[0, 0], [0, 2], [2, 0], [2, 2]];
const T_FRONTS = [
  [[0, 0], [0, 2]],   // 朝上
  [[0, 2], [2, 2]],   // 朝右
  [[2, 0], [2, 2]],   // 朝下
  [[0, 0], [2, 0]],   // 朝左
];

// 计分(均 ×等级)
const CLEAR_SCORES = { 1: 100, 2: 300, 3: 500, 4: 800 };
const TSPIN_SCORES = { 0: 400, 1: 800, 2: 1200, 3: 1600 };
const TSPIN_MINI_SCORES = { 0: 100, 1: 200, 2: 400 };
const PERFECT_SCORES = { 1: 800, 2: 1200, 3: 1800, 4: 2000 };
const CLEAR_LABELS = { 2: '双消!', 3: '三消!', 4: 'TETRIS!' };

function shuffle(list) {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function spawnCol(type) {
  return Math.floor((COLS - BOX_SIZE[type]) / 2);
}

// ── BGM 乐谱:8-bit 合成《Korobeiniki》(俄罗斯民歌,公有领域)──
// 用 Web Audio 现场合成,方波主旋律 + 三角波贝斯 + 噪声踩镲,
// 不依赖 mp3 资源。音符记法 [midi, 八分音符数],0 为休止。
const BGM_BPM = 146;
const BGM_MELODY = [
  // A 段
  [76, 2], [71, 1], [72, 1], [74, 2], [72, 1], [71, 1],
  [69, 2], [69, 1], [72, 1], [76, 2], [74, 1], [72, 1],
  [71, 3], [72, 1], [74, 2], [76, 2],
  [72, 2], [69, 2], [69, 4],
  [0, 1], [74, 2], [77, 1], [81, 2], [79, 1], [77, 1],
  [76, 3], [72, 1], [76, 2], [74, 1], [72, 1],
  [71, 2], [71, 1], [72, 1], [74, 2], [76, 2],
  [72, 2], [69, 2], [69, 3], [0, 1],
  // B 段(长音,情绪缓下来再推上去)
  [76, 4], [72, 4],
  [74, 4], [71, 4],
  [72, 4], [69, 4],
  [68, 8],
  [76, 4], [72, 4],
  [74, 4], [71, 4],
  [72, 2], [76, 2], [81, 4],
  [80, 8],
];
// 每小节的贝斯根音(低八度/高八度交替走八分)
const BGM_BASS_ROOTS = [
  40, 45, 47, 45, 38, 36, 47, 45,   // A 段:Em Am B7 Am Dm C B7 Am
  45, 44, 45, 40, 45, 44, 45, 40,   // B 段:Am G# Am E …
];

function midiFreq(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

function buildBgmScore() {
  const eighth = 60 / BGM_BPM / 2;
  const events = [];
  let t = 0;
  BGM_MELODY.forEach(([m, n]) => {
    if (m) events.push({ t, d: n * eighth * 0.9, f: midiFreq(m), w: 'square', v: 0.05 });
    t += n * eighth;
  });
  const dur = t;
  const measures = Math.round(dur / (eighth * 8));
  for (let i = 0; i < measures; i++) {
    const root = BGM_BASS_ROOTS[i % BGM_BASS_ROOTS.length];
    for (let e = 0; e < 8; e++) {
      const bt = (i * 8 + e) * eighth;
      events.push({ t: bt, d: eighth * 0.85, f: midiFreq(e % 2 ? root + 12 : root), w: 'triangle', v: 0.075 });
      events.push({ t: bt, hat: true, v: e % 2 ? 0.012 : 0.024 });
    }
  }
  events.sort((a, b) => a.t - b.t);
  return { events, dur };
}

const BGM_SCORE = buildBgmScore();

function clampChannel(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function tint(color, amount) {
  const hex = color.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const target = amount >= 0 ? 255 : 0;
  const ratio = Math.abs(amount);
  return `rgb(${clampChannel(r + (target - r) * ratio)}, ${clampChannel(g + (target - g) * ratio)}, ${clampChannel(b + (target - b) * ratio)})`;
}

Page({
  data: {
    score: 0,
    best: 0,
    level: 1,
    lines: 0,
    gameState: 'playing',   // 'playing' | 'paused' | 'over'
    isNewBest: false,
    muted: false,
  },

  // ── 生命周期 ────────────────────────────────────────────
  onLoad() {
    this._best = wx.getStorageSync(STORAGE_KEY) || 0;
    this.setData({ best: this._best });
    this._initAudio();
  },

  onReady() {
    const info = wx.getSystemInfoSync();
    this._dpr = info.pixelRatio || 2;

    const query = wx.createSelectorQuery().in(this);
    query.select('#tetris-canvas').fields({ node: true, size: true });
    query.select('#next-canvas').fields({ node: true, size: true });
    query.select('#hold-canvas').fields({ node: true, size: true });
    query.exec(res => {
      if (!res || !res[0] || !res[0].node) return;
      const setup = (r) => {
        const node = r.node;
        node.width = Math.round(r.width * this._dpr);
        node.height = Math.round(r.height * this._dpr);
        const ctx = node.getContext('2d');
        ctx.scale(this._dpr, this._dpr);
        return { node, ctx, w: r.width, h: r.height };
      };
      const board = setup(res[0]);
      this._boardCanvas = board.node;
      this._ctx = board.ctx;
      this._W = board.w;
      this._H = board.h;
      if (res[1] && res[1].node) {
        const next = setup(res[1]);
        this._nextCtx = next.ctx;
        this._nextW = next.w;
        this._nextH = next.h;
      }
      if (res[2] && res[2].node) {
        const hold = setup(res[2]);
        this._holdCtx = hold.ctx;
        this._holdW = hold.w;
        this._holdH = hold.h;
      }
      this._computeMetrics();
      this._isReady = true;
      this._startGame();
    });
  },

  onShow() {
    if (!this._isReady) return;
    this._startLoop();
    if (this._state === 'play' || this._state === 'clearing') this._playBgm();
  },

  onHide() {
    if (this._state === 'play' || this._state === 'clearing') {
      this._state = 'pause';
      this.setData({ gameState: 'paused' });
    }
    this._pauseBgm();
    this._stopLoop();
  },

  onUnload() {
    this._stopLoop();
    this._destroyAudio();
  },

  noop() {},

  onShareAppMessage() {
    const s = this._score || 0;
    return {
      title: s > 0
        ? `我在像素俄罗斯方块拿了 ${s} 分,来挑战我～`
        : '重制版像素俄罗斯方块,T-Spin、连击都安排上了,来一局!',
      path: '/pages/tetris/index',
    };
  },

  // ── 开局 / 状态 ─────────────────────────────────────────
  _reset() {
    this._board = Array.from({ length: ROWS }, () => Array(COLS).fill(''));
    this._bag = [];
    this._queue = [];
    this._refillQueue();
    this._cur = null;
    this._hold = '';
    this._holdUsed = false;
    this._score = 0;
    this._lines = 0;
    this._level = 1;
    this._combo = -1;
    this._b2b = false;
    this._gravMs = this._gravityMs(1);
    this._gravAcc = 0;
    this._lockMs = 0;
    this._lockResets = 0;
    this._lastRotate = null;
    this._stackTop = ROWS;
    this._isNewBest = false;
    this._state = 'play';
    this._now = this._now || 0;
    this._input = { dir: 0, das: 0, arr: 0, soft: false };
    this._fx = { labels: [], trail: null, shake: 0, clearRows: [], clearSet: new Set(), clearStart: 0, overStart: 0 };
  },

  _startGame() {
    this._reset();
    this.setData({
      score: 0, best: this._best || 0, level: 1, lines: 0,
      gameState: 'playing', isNewBest: false,
    });
    this._spawn();
    this._drawHold();
    this._startLoop();
    this._playBgm();
  },

  onRestart() {
    if (!this._isReady) return;
    this._startGame();
  },

  onPause() {
    if (this._state !== 'play') return;
    this._state = 'pause';
    this.setData({ gameState: 'paused' });
    this._pauseBgm();
  },

  onResume() {
    if (this._state !== 'pause') return;
    this._state = 'play';
    this._input.dir = 0;
    this._input.soft = false;
    this.setData({ gameState: 'playing' });
    this._playBgm();
  },

  onToggleMute() {
    const muted = !this.data.muted;
    this.setData({ muted });
    if (muted) {
      this._pauseBgm();
    } else if (this._state === 'play' || this._state === 'clearing') {
      this._playBgm();
    }
  },

  // ── 发牌 ────────────────────────────────────────────────
  _takeFromBag() {
    if (!this._bag.length) this._bag = shuffle(PIECE_TYPES);
    return this._bag.pop();
  },

  _refillQueue() {
    while (this._queue.length < 5) this._queue.push(this._takeFromBag());
  },

  _spawn() {
    const type = this._queue.shift();
    this._refillQueue();
    this._drawNext();
    if (!this._setPiece(type)) return false;
    this._holdUsed = false;
    return true;
  },

  _setPiece(type) {
    this._cur = { type, rot: 0, row: 0, col: spawnCol(type) };
    this._gravAcc = 0;
    this._lockMs = 0;
    this._lockResets = 0;
    this._lastRotate = null;
    if (this._collidesAt(type, 0, this._cur.row, this._cur.col)) {
      this._gameOver();
      return false;
    }
    return true;
  },

  // ── 碰撞 / 几何 ─────────────────────────────────────────
  _collidesAt(type, rot, row, col) {
    const cells = SHAPES[type][rot];
    for (let i = 0; i < cells.length; i++) {
      const r = row + cells[i][0];
      const c = col + cells[i][1];
      if (c < 0 || c >= COLS || r >= ROWS) return true;
      if (r >= 0 && this._board[r][c]) return true;
    }
    return false;
  },

  _curCells(rot, row, col) {
    const p = this._cur;
    return SHAPES[p.type][rot === undefined ? p.rot : rot].map(([dr, dc]) => [
      (row === undefined ? p.row : row) + dr,
      (col === undefined ? p.col : col) + dc,
    ]);
  },

  _grounded() {
    return !!this._cur && this._collidesAt(this._cur.type, this._cur.rot, this._cur.row + 1, this._cur.col);
  },

  _dropDistance() {
    let d = 0;
    while (!this._collidesAt(this._cur.type, this._cur.rot, this._cur.row + d + 1, this._cur.col)) d++;
    return d;
  },

  // ── 操作 ────────────────────────────────────────────────
  _shift(dir) {
    if (!this._cur || this._collidesAt(this._cur.type, this._cur.rot, this._cur.row, this._cur.col + dir)) {
      return false;
    }
    this._cur.col += dir;
    this._lastRotate = null;
    if (this._grounded()) this._resetLock();
    this._tickNote(180, 0.03, 0.1);
    return true;
  },

  _rotate(dir) {
    const p = this._cur;
    if (!p || p.type === 'O') return false;
    const to = (p.rot + (dir > 0 ? 1 : 3)) % 4;
    const table = p.type === 'I' ? KICKS_I : KICKS_JLSTZ;
    const kicks = table[`${p.rot}>${to}`];
    for (let i = 0; i < kicks.length; i++) {
      const [dr, dc] = kicks[i];
      if (!this._collidesAt(p.type, to, p.row + dr, p.col + dc)) {
        p.rot = to;
        p.row += dr;
        p.col += dc;
        this._lastRotate = { kick: i };
        if (this._grounded()) this._resetLock();
        this._tickNote(340, 0.04, 0.12);
        return true;
      }
    }
    return false;
  },

  _fall() {
    if (!this._cur || this._grounded()) return false;
    this._cur.row += 1;
    this._lockMs = 0;
    this._lockResets = 0;
    this._lastRotate = null;
    return true;
  },

  _softStep() {
    if (this._fall()) this._addScore(1);
  },

  _hardDrop() {
    if (!this._cur) return;
    const dist = this._dropDistance();
    this._cur.row += dist;
    if (dist > 0) this._addScore(dist * 2);
    // 拖尾:记录每列的起止行
    const perCol = {};
    this._curCells().forEach(([r, c]) => {
      if (perCol[c] === undefined || r < perCol[c]) perCol[c] = r;
    });
    this._fx.trail = {
      color: PIECE_COLORS[this._cur.type],
      start: this._now,
      cols: Object.keys(perCol).map(c => ({ c: +c, toRow: perCol[c], dist })),
    };
    this._fx.shake = Math.max(this._fx.shake, 2.5);
    this._lock();
  },

  _resetLock() {
    if (this._lockResets >= LOCK_RESETS) return;
    this._lockResets += 1;
    this._lockMs = 0;
  },

  onHold() {
    if (this._state !== 'play' || !this._cur || this._holdUsed) return;
    const t = this._cur.type;
    if (!this._hold) {
      this._hold = t;
      if (!this._spawn()) return;
    } else {
      const swap = this._hold;
      this._hold = t;
      if (!this._setPiece(swap)) return;
    }
    this._holdUsed = true;
    this._drawHold();
    this._tickNote(500, 0.05, 0.12);
  },

  // ── 锁定与消行 ──────────────────────────────────────────
  _detectTSpin() {
    const p = this._cur;
    if (!p || p.type !== 'T' || !this._lastRotate) return null;
    const filled = ([br, bc]) => {
      const r = p.row + br;
      const c = p.col + bc;
      if (c < 0 || c >= COLS || r >= ROWS) return true;
      return r >= 0 && !!this._board[r][c];
    };
    const corners = T_CORNERS.filter(filled).length;
    if (corners < 3) return null;
    const fronts = T_FRONTS[p.rot].filter(filled).length;
    // 前角双满为正宗 T-Spin;用到第 5 个踢墙位(TST 踢)也按正宗算
    if (fronts === 2 || this._lastRotate.kick >= 4) return 'full';
    return 'mini';
  },

  _lock() {
    if (!this._cur) return;
    const tspin = this._detectTSpin();
    const cells = this._curCells();
    let allHidden = true;
    for (let i = 0; i < cells.length; i++) {
      const [r, c] = cells[i];
      if (r < 0) { this._gameOver(); return; }
      this._board[r][c] = this._cur.type;
      if (r >= HIDDEN_ROWS) allHidden = false;
    }
    if (allHidden) { this._gameOver(); return; }
    this._cur = null;
    this._computeStackTop();

    const rows = [];
    for (let r = 0; r < ROWS; r++) {
      if (this._board[r].every(cell => !!cell)) rows.push(r);
    }
    this._scoreLock(rows.length, tspin);

    if (rows.length) {
      this._state = 'clearing';
      this._fx.clearRows = rows;
      this._fx.clearSet = new Set(rows);
      this._fx.clearStart = this._now;
      if (rows.length >= 4) this._fx.shake = 5;
      this._playSfx(rows.length >= 4 ? 'tetris' : 'clear');
    } else {
      this._playSfx('drop');
      this._spawn();
    }
  },

  _scoreLock(n, tspin) {
    const lv = this._level;
    let pts = 0;
    if (tspin) {
      const table = tspin === 'mini' ? TSPIN_MINI_SCORES : TSPIN_SCORES;
      pts += (table[n] || 0) * lv;
      const tag = n === 3 ? 'T-SPIN 三消!' : (n === 2 ? 'T-SPIN 双消!' : 'T-SPIN!');
      this._label(tspin === 'mini' ? 'T-SPIN MINI' : tag, '#A855F7');
    } else if (n > 0) {
      pts += CLEAR_SCORES[n] * lv;
      if (CLEAR_LABELS[n]) this._label(CLEAR_LABELS[n], n >= 4 ? '#F5C842' : '#C0C0E8');
    }

    if (n > 0) {
      const difficult = n >= 4 || !!tspin;
      if (difficult && this._b2b) {
        pts = Math.floor(pts * 1.5);
        this._label('B2B ×1.5', '#60C0FF');
      }
      this._b2b = difficult;

      this._combo += 1;
      if (this._combo >= 1) {
        pts += 50 * this._combo * lv;
        this._label(`COMBO ×${this._combo + 1}`, '#D97757');
      }
    } else {
      this._combo = -1;
    }
    if (pts > 0) this._addScore(pts);
  },

  _finishClear() {
    const n = this._fx.clearRows.length;
    const kept = [];
    for (let r = 0; r < ROWS; r++) {
      if (!this._fx.clearSet.has(r)) kept.push(this._board[r]);
    }
    while (kept.length < ROWS) kept.unshift(Array(COLS).fill(''));
    this._board = kept;
    this._fx.clearRows = [];
    this._fx.clearSet = new Set();
    this._computeStackTop();

    // 全清奖励
    if (this._stackTop >= ROWS) {
      this._addScore((PERFECT_SCORES[n] || 0) * this._level);
      this._label('全清 PERFECT!', '#FFFFFF');
    }

    this._lines += n;
    const nextLevel = Math.floor(this._lines / 10) + 1;
    if (nextLevel !== this._level) {
      this._level = nextLevel;
      this._gravMs = this._gravityMs(nextLevel);
      this._label(`LEVEL ${nextLevel}`, '#F5C842');
      this._playSfx('levelup');
    }
    this.setData({ lines: this._lines, level: this._level });

    this._state = 'play';
    this._spawn();
  },

  _computeStackTop() {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (this._board[r][c]) { this._stackTop = r; return; }
      }
    }
    this._stackTop = ROWS;
  },

  _addScore(pts) {
    if (!pts) return;
    this._score += pts;
    if (this._score > (this._best || 0)) {
      this._best = this._score;
      this._isNewBest = true;
      wx.setStorageSync(STORAGE_KEY, this._best);
    }
  },

  // 等级重力曲线(官方指南):(0.8 - (lv-1)*0.007)^(lv-1) 秒/行
  _gravityMs(level) {
    const s = Math.pow(0.8 - (level - 1) * 0.007, level - 1);
    return Math.max(30, Math.round(s * 1000));
  },

  _gameOver() {
    this._cur = null;
    this._state = 'overAnim';
    this._fx.overStart = this._now;
    this._input.dir = 0;
    this._input.soft = false;
    this._pauseBgm();
    this._playSfx('gameover');
  },

  _finishOver() {
    this._state = 'over';
    this.setData({
      score: this._score,
      best: this._best,
      level: this._level,
      lines: this._lines,
      gameState: 'over',
      isNewBest: this._isNewBest,
    });
  },

  _label(text, color) {
    this._fx.labels.push({ text, color, start: this._now });
    if (this._fx.labels.length > 4) this._fx.labels.shift();
  },

  // ── 主循环 ──────────────────────────────────────────────
  _startLoop() {
    if (this._raf || !this._boardCanvas) return;
    this._lastTs = 0;
    const step = (ts) => {
      this._raf = this._boardCanvas.requestAnimationFrame(step);
      const dt = this._lastTs ? Math.min(50, ts - this._lastTs) : 16;
      this._lastTs = ts;
      this._update(dt, ts);
      this._draw(ts);
    };
    this._raf = this._boardCanvas.requestAnimationFrame(step);
  },

  _stopLoop() {
    if (this._raf && this._boardCanvas) this._boardCanvas.cancelAnimationFrame(this._raf);
    this._raf = null;
  },

  _update(dt, ts) {
    this._now = ts;

    if (this._state === 'play') {
      // DAS/ARR 连发
      const inp = this._input;
      if (inp.dir) {
        inp.das += dt;
        if (inp.das >= DAS_MS) {
          inp.arr += dt;
          while (inp.arr >= ARR_MS) {
            inp.arr -= ARR_MS;
            if (!this._shift(inp.dir)) { inp.arr = 0; break; }
          }
        }
      }
      // 重力
      const gms = inp.soft ? Math.min(SOFT_MS, this._gravMs) : this._gravMs;
      this._gravAcc += dt;
      while (this._gravAcc >= gms) {
        this._gravAcc -= gms;
        if (this._fall()) {
          if (inp.soft) this._addScore(1);
        } else {
          this._gravAcc = 0;
          break;
        }
      }
      // 锁定延迟
      if (this._grounded()) {
        this._lockMs += dt;
        if (this._lockMs >= LOCK_MS) this._lock();
      } else {
        this._lockMs = 0;
      }
    } else if (this._state === 'clearing') {
      if (ts - this._fx.clearStart >= CLEAR_MS) this._finishClear();
    } else if (this._state === 'overAnim') {
      if (ts - this._fx.overStart >= OVER_FILL_MS + 250) this._finishOver();
    }

    // HUD 按需同步
    if (this._score !== this.data.score) {
      this.setData({ score: this._score, best: this._best });
    }
  },

  // ── 渲染 ────────────────────────────────────────────────
  _computeMetrics() {
    const cell = Math.max(8, Math.min(30, Math.floor(Math.min(this._W / COLS, this._H / VISIBLE_ROWS))));
    const width = cell * COLS;
    const height = cell * VISIBLE_ROWS;
    this._rect = {
      cell, width, height,
      x: Math.floor((this._W - width) / 2),
      y: Math.floor((this._H - height) / 2),
    };
  },

  _draw(ts) {
    const ctx = this._ctx;
    if (!ctx || !this._rect) return;
    const { x, y, cell, width, height } = this._rect;
    const fx = this._fx;

    ctx.clearRect(0, 0, this._W, this._H);
    ctx.save();
    if (fx.shake > 0.3) {
      ctx.translate((Math.random() * 2 - 1) * fx.shake, (Math.random() * 2 - 1) * fx.shake);
      fx.shake *= 0.85;
    } else {
      fx.shake = 0;
    }

    // 面板:像素投影 + 底色 + 边框
    ctx.fillStyle = '#0A0A1C';
    ctx.fillRect(x + 4, y + 4, width, height);
    ctx.fillStyle = '#12122A';
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = '#2E3A5C';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, width - 2, height - 2);

    // 网格点(比整线更干净)
    ctx.fillStyle = 'rgba(74, 111, 165, 0.18)';
    for (let r = 1; r < VISIBLE_ROWS; r++) {
      for (let c = 1; c < COLS; c++) {
        ctx.fillRect(x + c * cell - 1, y + r * cell - 1, 2, 2);
      }
    }

    // 已落定方块(消行中的行做闪白/收缩动画)
    const clearing = this._state === 'clearing';
    const p = clearing ? Math.min(1, (ts - fx.clearStart) / CLEAR_MS) : 0;
    for (let r = HIDDEN_ROWS; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const t = this._board[r][c];
        if (!t) continue;
        const px = x + c * cell;
        const py = y + (r - HIDDEN_ROWS) * cell;
        if (clearing && fx.clearSet.has(r) && p >= 0.35) {
          const s = 1 - (p - 0.35) / 0.65;
          const size = cell * s;
          this._blockRect(ctx, px + (cell - size) / 2, py + (cell - size) / 2, size, PIECE_COLORS[t], 1);
        } else {
          this._blockRect(ctx, px, py, cell, PIECE_COLORS[t], 1);
        }
      }
    }
    if (clearing && p < 0.35) {
      ctx.fillStyle = `rgba(255, 255, 255, ${0.85 * (1 - p / 0.35)})`;
      fx.clearRows.forEach(r => {
        if (r >= HIDDEN_ROWS) ctx.fillRect(x, y + (r - HIDDEN_ROWS) * cell, width, cell);
      });
    }

    // 硬降拖尾
    if (fx.trail && ts - fx.trail.start < 160) {
      const a = 1 - (ts - fx.trail.start) / 160;
      ctx.fillStyle = fx.trail.color;
      ctx.globalAlpha = 0.22 * a;
      fx.trail.cols.forEach(({ c, toRow, dist }) => {
        const top = Math.max(HIDDEN_ROWS, toRow - dist);
        const py = y + (top - HIDDEN_ROWS) * cell;
        const ph = (toRow - top) * cell;
        if (ph > 0) ctx.fillRect(x + c * cell + cell * 0.15, py, cell * 0.7, ph);
      });
      ctx.globalAlpha = 1;
    } else if (fx.trail) {
      fx.trail = null;
    }

    // 幽灵投影 + 当前方块
    if (this._cur && (this._state === 'play' || this._state === 'pause')) {
      const ghostDist = this._dropDistance();
      const color = PIECE_COLORS[this._cur.type];
      if (ghostDist > 0) {
        this._curCells(this._cur.rot, this._cur.row + ghostDist, this._cur.col).forEach(([r, c]) => {
          if (r < HIDDEN_ROWS) return;
          const px = x + c * cell;
          const py = y + (r - HIDDEN_ROWS) * cell;
          ctx.save();
          ctx.globalAlpha = 0.08;
          ctx.fillStyle = color;
          ctx.fillRect(px + 2, py + 2, cell - 4, cell - 4);
          ctx.globalAlpha = 0.5;
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.strokeRect(px + 2.5, py + 2.5, cell - 5, cell - 5);
          ctx.restore();
        });
      }
      const alpha = this._lockMs > 0 ? 0.82 : 1;
      this._curCells().forEach(([r, c]) => {
        if (r < HIDDEN_ROWS) return;
        this._blockRect(ctx, x + c * cell, y + (r - HIDDEN_ROWS) * cell, cell, color, alpha);
      });
    }

    // 危险区红光(堆快到顶时脉动)
    if (this._stackTop <= HIDDEN_ROWS + 5 && (this._state === 'play' || this._state === 'clearing')) {
      const a = 0.10 + 0.07 * Math.sin(ts / 160);
      const grad = ctx.createLinearGradient(0, y, 0, y + cell * 5);
      grad.addColorStop(0, `rgba(255, 80, 80, ${a})`);
      grad.addColorStop(1, 'rgba(255, 80, 80, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, width, cell * 5);
    }

    // 结束动画:灰块自底向上淹没
    if (this._state === 'overAnim' || this._state === 'over') {
      const op = Math.min(1, (ts - fx.overStart) / OVER_FILL_MS);
      const nFill = this._state === 'over' ? VISIBLE_ROWS : Math.floor(op * VISIBLE_ROWS);
      for (let i = 0; i < nFill; i++) {
        const r = VISIBLE_ROWS - 1 - i;
        for (let c = 0; c < COLS; c++) {
          this._blockRect(ctx, x + c * cell, y + r * cell, cell, '#3A3A55', 0.92);
        }
      }
    }

    // 浮动大字(TETRIS! / T-SPIN! / COMBO…)
    for (let i = fx.labels.length - 1; i >= 0; i--) {
      const lb = fx.labels[i];
      const age = ts - lb.start;
      if (age > 900) { fx.labels.splice(i, 1); continue; }
      const t01 = age / 900;
      ctx.save();
      ctx.globalAlpha = t01 < 0.15 ? t01 / 0.15 : 1 - (t01 - 0.15) / 0.85;
      ctx.fillStyle = lb.color;
      ctx.font = `bold ${Math.round(cell * 0.9)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const ly = y + height * 0.3 - t01 * 40 + i * cell * 1.1;
      ctx.shadowColor = '#0A0A1A';
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 2;
      ctx.fillText(lb.text, x + width / 2, ly);
      ctx.restore();
    }

    ctx.restore();
  },

  _blockRect(ctx, x, y, size, color, alpha) {
    if (size < 3) return;
    const inset = 1;
    const bevel = Math.max(2, Math.round(size * 0.16));
    const inner = size - inset * 2;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(x + inset, y + inset, inner, inner);
    ctx.fillStyle = tint(color, 0.28);
    ctx.fillRect(x + inset, y + inset, inner, bevel);
    ctx.fillRect(x + inset, y + inset, bevel, inner);
    ctx.fillStyle = tint(color, -0.32);
    ctx.fillRect(x + size - bevel - inset, y + inset, bevel, inner);
    ctx.fillRect(x + inset, y + size - bevel - inset, inner, bevel);
    ctx.strokeStyle = 'rgba(10, 10, 26, 0.35)';
    ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
    ctx.restore();
  },

  _drawMini(ctx, type, cx, cy, cell, alpha) {
    const cells = SHAPES[type][0];
    let minR = 9, maxR = -9, minC = 9, maxC = -9;
    cells.forEach(([r, c]) => {
      minR = Math.min(minR, r); maxR = Math.max(maxR, r);
      minC = Math.min(minC, c); maxC = Math.max(maxC, c);
    });
    const w = (maxC - minC + 1) * cell;
    const h = (maxR - minR + 1) * cell;
    cells.forEach(([r, c]) => {
      this._blockRect(
        ctx,
        cx - w / 2 + (c - minC) * cell,
        cy - h / 2 + (r - minR) * cell,
        cell,
        PIECE_COLORS[type],
        alpha
      );
    });
  },

  _drawNext() {
    const ctx = this._nextCtx;
    if (!ctx) return;
    ctx.clearRect(0, 0, this._nextW, this._nextH);
    ctx.fillStyle = '#0A0A1A';
    ctx.fillRect(0, 0, this._nextW, this._nextH);
    ctx.strokeStyle = '#2E3A5C';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, this._nextW - 1, this._nextH - 1);
    const slotH = this._nextH / 3;
    const cell = Math.max(6, Math.floor(Math.min(this._nextW / 5.2, slotH / 3.4)));
    for (let i = 0; i < 3 && i < this._queue.length; i++) {
      // 第一个最亮,越往后越淡
      this._drawMini(ctx, this._queue[i], this._nextW / 2, slotH * i + slotH / 2, cell, 1 - i * 0.25);
    }
  },

  _drawHold() {
    const ctx = this._holdCtx;
    if (!ctx) return;
    ctx.clearRect(0, 0, this._holdW, this._holdH);
    ctx.fillStyle = '#0A0A1A';
    ctx.fillRect(0, 0, this._holdW, this._holdH);
    ctx.strokeStyle = '#2E3A5C';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, this._holdW - 1, this._holdH - 1);
    if (!this._hold) {
      ctx.fillStyle = 'rgba(74, 111, 165, 0.5)';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('空', this._holdW / 2, this._holdH / 2);
      return;
    }
    const cell = Math.max(6, Math.floor(Math.min(this._holdW / 5.2, this._holdH / 3.4)));
    this._drawMini(ctx, this._hold, this._holdW / 2, this._holdH / 2, cell, this._holdUsed ? 0.35 : 1);
  },

  // ── 按键 ────────────────────────────────────────────────
  onLeft() {
    if (this._state !== 'play') return;
    this._shift(-1);
    this._input.dir = -1;
    this._input.das = 0;
    this._input.arr = 0;
  },

  onRight() {
    if (this._state !== 'play') return;
    this._shift(1);
    this._input.dir = 1;
    this._input.das = 0;
    this._input.arr = 0;
  },

  onMoveEnd() {
    this._input.dir = 0;
  },

  onDown() {
    if (this._state !== 'play') return;
    this._softStep();
    this._input.soft = true;
  },

  onDownEnd() {
    this._input.soft = false;
  },

  onRotCW() {
    if (this._state !== 'play') return;
    this._rotate(1);
  },

  onRotCCW() {
    if (this._state !== 'play') return;
    this._rotate(-1);
  },

  onDrop() {
    if (this._state !== 'play') return;
    this._hardDrop();
  },

  // ── 棋盘手势 ────────────────────────────────────────────
  // 轻点=顺旋;横拖=按格移动;下拖=软降;快速下滑=硬降;上滑=HOLD
  onBoardTouchStart(e) {
    if (this._state !== 'play') return;
    const t = e.touches[0];
    this._touch = {
      x: t.clientX, y: t.clientY,
      sx: t.clientX, sy: t.clientY,
      time: Date.now(), moved: false,
    };
  },

  onBoardTouchMove(e) {
    const bt = this._touch;
    if (!bt || this._state !== 'play') return;
    const t = e.touches[0];
    const cellPx = this._rect ? this._rect.cell : 24;

    // 快速下滑候选交给 touchend 判定硬降,避免途中软降到底
    const dt = Date.now() - bt.time;
    if (dt < 250 && (t.clientY - bt.sy) > cellPx * 1.5 &&
        Math.abs(t.clientX - bt.sx) < (t.clientY - bt.sy) * 0.6) {
      return;
    }

    let dx = t.clientX - bt.x;
    while (Math.abs(dx) >= cellPx) {
      const dir = dx > 0 ? 1 : -1;
      this._shift(dir);
      bt.x += dir * cellPx;
      bt.moved = true;
      dx = t.clientX - bt.x;
    }

    let dy = t.clientY - bt.y;
    while (dy >= cellPx) {
      this._softStep();
      bt.y += cellPx;
      bt.moved = true;
      dy = t.clientY - bt.y;
    }
  },

  onBoardTouchEnd(e) {
    const bt = this._touch;
    this._touch = null;
    if (!bt || this._state !== 'play') return;
    const t = e.changedTouches[0];
    const totalX = t.clientX - bt.sx;
    const totalY = t.clientY - bt.sy;
    const dt = Date.now() - bt.time;

    if (dt < 250 && totalY > 50 && Math.abs(totalX) < totalY * 0.6) {
      this.onDrop();
      return;
    }
    if (totalY < -40 && Math.abs(totalX) < Math.abs(totalY)) {
      this.onHold();
      return;
    }
    if (!bt.moved && dt < 300 && Math.abs(totalX) < 12 && Math.abs(totalY) < 12) {
      this._rotate(1);
    }
  },

  // ── 音频 ────────────────────────────────────────────────
  _initAudio() {
    const mkSfx = (src, vol) => {
      const ctx = wx.createInnerAudioContext();
      ctx.src = src;
      ctx.volume = vol;
      ctx.obeyMuteSwitch = false;
      return ctx;
    };

    this._audio = {
      drop:     mkSfx('/assets/sounds/tetris-drop.mp3',     0.7),
      clear:    mkSfx('/assets/sounds/tetris-clear.mp3',    0.9),
      tetris:   mkSfx('/assets/sounds/tetris-tetris.mp3',   1.0),
      levelup:  mkSfx('/assets/sounds/tetris-levelup.mp3',  0.9),
      gameover: mkSfx('/assets/sounds/tetris-gameover.mp3', 0.9),
    };

    try {
      this._wac = wx.createWebAudioContext();
    } catch (e) {
      this._wac = null;
    }
  },

  _destroyAudio() {
    this._pauseBgm();
    if (this._audio) {
      Object.values(this._audio).forEach(ctx => {
        try { ctx.stop(); ctx.destroy(); } catch (e) {}
      });
      this._audio = null;
    }
    if (this._wac) {
      try { this._wac.close(); } catch (e) {}
      this._wac = null;
    }
  },

  // ── BGM:合成序列器 ─────────────────────────────────────
  // 每 90ms 往前预排 0.35s 内的音符,循环整首乐谱;
  // 速率随等级微升(最多 +25%),越到后面越紧张。
  _playBgm() {
    if (!this._wac || this.data.muted || this._bgmTimer) return;
    this._bgmIdx = 0;
    this._bgmLoopStart = this._wac.currentTime + 0.1;
    this._bgmTimer = setInterval(() => this._scheduleBgm(), 90);
    this._scheduleBgm();
  },

  _pauseBgm() {
    if (this._bgmTimer) {
      clearInterval(this._bgmTimer);
      this._bgmTimer = null;
    }
  },

  _scheduleBgm() {
    const wac = this._wac;
    if (!wac) return;
    const horizon = wac.currentTime + 0.35;
    const rate = Math.min(1.25, 1 + ((this._level || 1) - 1) * 0.02);
    let guard = 0;
    while (guard++ < 64) {
      const ev = BGM_SCORE.events[this._bgmIdx];
      const at = this._bgmLoopStart + ev.t / rate;
      if (at > horizon) break;
      this._bgmNote(ev, at, rate);
      this._bgmIdx++;
      if (this._bgmIdx >= BGM_SCORE.events.length) {
        this._bgmIdx = 0;
        this._bgmLoopStart += BGM_SCORE.dur / rate;
      }
    }
  },

  _bgmNote(ev, at, rate) {
    const wac = this._wac;
    try {
      if (ev.hat) {
        if (this._hatOk === false) return;
        if (!this._hatBuf) {
          const len = Math.floor(wac.sampleRate * 0.03);
          this._hatBuf = wac.createBuffer(1, len, wac.sampleRate);
          const ch = this._hatBuf.getChannelData(0);
          for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len);
        }
        const src = wac.createBufferSource();
        src.buffer = this._hatBuf;
        const gain = wac.createGain();
        gain.gain.setValueAtTime(ev.v, at);
        src.connect(gain);
        gain.connect(wac.destination);
        src.start(at);
        return;
      }
      const osc = wac.createOscillator();
      const gain = wac.createGain();
      osc.type = ev.w;
      osc.frequency.value = ev.f;
      const d = ev.d / rate;
      gain.gain.setValueAtTime(ev.v, at);
      gain.gain.exponentialRampToValueAtTime(0.001, at + d);
      osc.connect(gain);
      gain.connect(wac.destination);
      osc.start(at);
      osc.stop(at + d);
    } catch (e) {
      if (ev.hat) this._hatOk = false;
    }
  },

  _playSfx(name) {
    if (!this._audio || this.data.muted) return;
    const ctx = this._audio[name];
    if (!ctx) return;
    try { ctx.stop(); ctx.play(); } catch (e) {}
  },

  // 移动/旋转这类高频小音效用 Web Audio 合成,避免 mp3 重播延迟
  _tickNote(freq, dur, vol) {
    if (!this._wac || this.data.muted) return;
    try {
      const t = this._wac.currentTime;
      const osc = this._wac.createOscillator();
      const gain = this._wac.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(gain);
      gain.connect(this._wac.destination);
      osc.start(t);
      osc.stop(t + dur);
    } catch (e) {}
  },
});
