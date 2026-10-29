// ─── 木质俄罗斯方块 · 重制版 ─────────────────────────────
// 现代规则重写:7-bag 发牌、完整 SRS 踢墙、幽灵投影、HOLD、
// 三连预览、锁定延迟、T-Spin / B2B / 连击 / 全清计分。
// rAF 主循环驱动重力与 DAS/ARR 按键手感,消行闪白收缩、
// 硬降拖尾震屏、危险区红光等动画全部画在棋盘画布上。
// 美术是木质 3D 风格(utils/tetris-wood.js):染色木块 + 胡桃木托盘。
const {
  WOOD, VARIANTS, buildCubeAtlas, drawCubeAt, trayMetrics, buildTray, drawPanel,
} = require('../../utils/wood-art.js');
const { SFX_NAMES, renderSfx } = require('../../utils/wood-sfx.js');
const { buildShareImage } = require('../../utils/share-card.js');

const COLS = 10;
const VISIBLE_ROWS = 20;
const HIDDEN_ROWS = 2;                       // 顶部缓冲(出生区)
const ROWS = VISIBLE_ROWS + HIDDEN_ROWS;

const DAS_MS = 160;      // 按住方向后首次连发延迟
const ARR_MS = 40;       // 连发间隔
const SOFT_DAS_MS = 170; // 按住软降后开始连降前的延迟(点一下只降一格)
const SOFT_MS = 50;      // 软降连降每行间隔
const LOCK_MS = 500;     // 触底锁定延迟
const LOCK_RESETS = 15;  // 锁定延迟最多重置次数
const OVER_FILL_MS = 600;// 结束时灰块淹没动画
// 纪录按模式分开存;旧版 'tetris_best' 是在老规则(软降很快、分数偏高)下打的,不再沿用
const BEST_KEY = 'tetris_best_v2';     // { marathon, sprint(毫秒), ultra, rise }
const MODE_KEY = 'tetris_mode';

// 玩法模式
const MODES = {
  marathon: { name: '经典', desc: '越来越快,看你能撑多久', metric: 'score' },
  sprint:   { name: '40 行冲刺', desc: '最快速度消掉 40 行', metric: 'time', goalLines: 40 },
  ultra:    { name: '2 分钟限时', desc: '两分钟内拿最高分', metric: 'score', timeLimit: 120000 },
  rise:     { name: '木桩涨潮', desc: '木桩从底下往上涨,越涨越快', metric: 'score', rise: true },
};
const MODE_ORDER = ['marathon', 'sprint', 'ultra', 'rise'];
// 木桩涨潮:第一根 9 秒后冒出来,之后每根快 0.35 秒,最快 2.8 秒一根
const RISE_FIRST_MS = 9000;
const RISE_STEP_MS = 350;
const RISE_MIN_MS = 2800;
const RISE_WARN_MS = 1200;   // 冒出来前的预警时间

// 计时显示:冲刺精确到百分之一秒,限时只显示秒
function fmtTime(ms, precise) {
  const t = Math.max(0, ms);
  const m = Math.floor(t / 60000);
  const sec = Math.floor((t % 60000) / 1000);
  const base = `${m}:${String(sec).padStart(2, '0')}`;
  return precise ? `${base}.${String(Math.floor((t % 1000) / 10)).padStart(2, '0')}` : base;
}

const PIECE_TYPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
const PIECE_COLORS = WOOD;

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

// 消行特效分档:消得越多,动画越长、木屑越多、震得越狠。
// stagger:各列依次"崩开"的时间差(占动画时长比例),0 表示一整行同时崩;
// 4 行从中间向两边崩,另加金色冲击波和火花
const CLEAR_FX = {
  1: { ms: 300, shake: 0,   chips: 2, flash: 0.6,  stagger: 0,    settleMs: 130, label: null },
  2: { ms: 380, shake: 1.5, chips: 3, flash: 0.75, stagger: 0.26, settleMs: 150, label: { text: '双消!', color: '#FFE7C2', size: 0.95 } },
  3: { ms: 440, shake: 3,   chips: 4, flash: 0.85, stagger: 0.3,  settleMs: 170, label: { text: '三消!', color: '#FFB25E', size: 1.12 } },
  4: { ms: 580, shake: 6,   chips: 6, flash: 1,    stagger: 0.28, settleMs: 210, label: { text: 'TETRIS!', color: '#FFD46A', size: 1.45 }, gold: true },
};
const MAX_PARTICLES = 280;

// 全清奖励和弦(Hz)
const CHIME_MAJOR = [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98];
// 木头音效的 mp3 兜底(没有 WebAudio 时用;由 scripts/gen-tetris-sfx.js 导出)
const SFX_FALLBACK = ['lock', 'harddrop', 'clear1', 'clear2', 'clear3', 'clear4'];

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
    gameState: 'menu',      // 'menu' | 'playing' | 'paused' | 'over'
    isNewBest: false,
    muted: false,
    mode: 'marathon',
    modeName: '经典',
    modeList: [],           // 选模式面板:{ id, name, desc, best }
    hudLabel: 'SCORE',      // 顶栏右侧:分数,冲刺模式显示用时
    hudValue: '0',
    stat1Label: 'LINES',    // 侧栏小木牌两行
    stat1Value: '0',
    stat2Label: 'BEST',
    stat2Value: '0',
    result: null,           // 结算:{ title, mainLabel, main, cells: [{ label, value }] }
  },

  // ── 生命周期 ────────────────────────────────────────────
  onLoad() {
    let bests = {};
    try { bests = wx.getStorageSync(BEST_KEY) || {}; } catch (e) {}
    this._bests = bests;
    let mode = 'marathon';
    try { mode = wx.getStorageSync(MODE_KEY) || 'marathon'; } catch (e) {}
    this._mode = MODES[mode] ? mode : 'marathon';
    this._best = this._bests[this._mode] || 0;
    this.setData({ mode: this._mode, modeName: MODES[this._mode].name });
    this._refreshModeList();
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
      this._showMenu();
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

  // 分享:配一张自己画的分享卡(左边是当前盘面的木块快照,右边木牌写成绩),
  // 不然微信会截页面顶部一块,结算弹层只露半截
  onShareAppMessage() {
    const s = this._score || 0;
    const played = this.data.gameState === 'over' || s > 0;
    const sprintDone = this._mode === 'sprint' && this._finished;
    let title = '木头方块搭起来,冲刺、限时、木桩涨潮都安排上了,来一局!';
    if (sprintDone) title = `我 40 行冲刺只用了 ${fmtTime(this._elapsed, true)},来挑战我～`;
    else if (played && s > 0) title = `我在俄罗斯方块「${MODES[this._mode].name}」拿了 ${s} 分,来挑战我～`;
    const base = { title, path: '/pages/tetris/index' };
    const best = this._bests[this._mode];
    // 冲刺比用时:完成了写用时,没完成写消到第几行;其他模式写分数
    let card = { score: s, mainLabel: '本局得分', mainText: String(s), bestText: String(best || s) };
    if (this._mode === 'sprint') {
      const bestText = best ? fmtTime(best, true) : '--';
      card = sprintDone
        ? { score: 1, mainLabel: '冲刺用时', mainText: fmtTime(this._elapsed, true), bestLabel: '最快', bestText }
        : { score: this._lines, mainLabel: '冲刺消行', mainText: `${this._lines}/40`, bestLabel: '最快', bestText };
    }
    return {
      ...base,
      promise: buildShareImage(wx, {
        title: '俄罗斯方块',
        subtitle: MODES[this._mode].name,
        ...card,
        idleLines: ['四种玩法', '冲刺 · 限时'],
        art: (g, box) => this._paintShareBoard(g, box),
      }).then(img => (img ? { ...base, imageUrl: img } : base)).catch(() => base),
    };
  },

  // 分享卡左边:迷你托盘 + 当前盘面(还没玩时摆一个示意盘面)
  _paintShareBoard(g, box) {
    const make = (w, h) => wx.createOffscreenCanvas({ type: '2d', width: w, height: h });
    const m = trayMetrics(box.w, box.h, COLS, VISIBLE_ROWS);
    const tray = buildTray(make, box.w, box.h, 2, m);
    const atlas = buildCubeAtlas(make, m.cell, 2);
    let board = this._board;
    const hasCells = board && board.some(row => row.some(Boolean));
    if (!hasCells) {
      board = Array.from({ length: ROWS }, () => Array(COLS).fill(''));
      const demo = ['..........', '....T.....', '...TTT..ZZ', 'LL.....ZZI', 'JLL.SS..OI', 'JJLSSOOOOI', 'JJTTTOOIII'];
      demo.forEach((row, i) => row.split('').forEach((ch, c) => {
        if (ch !== '.') board[ROWS - demo.length + i][c] = ch + ((i + c) % VARIANTS);
      }));
    }
    g.drawImage(tray.floor, box.x, box.y, box.w, box.h);
    for (let r = HIDDEN_ROWS; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const key = board[r][c];
        if (!key) continue;
        drawCubeAt(g, atlas, null, key[0], +key[1] || 0, box.x + m.x + c * m.cell, box.y + m.y + (r - HIDDEN_ROWS) * m.cell);
      }
    }
    g.drawImage(tray.rim, box.x, box.y, box.w, box.h);
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
    this._input = { dir: 0, das: 0, arr: 0, soft: false, softWait: 0 };
    this._fx = {
      labels: [], trail: null, shake: 0, overStart: 0,
      clearRows: [], clearSet: new Set(), clearStart: 0, clearMs: 300, clearTier: 1, clearTspin: false,
      particles: [], pops: [], wave: null, settle: null, lastDraw: 0,
    };
  },

  _startGame() {
    this._reset();
    this._elapsed = 0;
    this._finished = false;
    this._riseAcc = 0;
    this._riseCount = 0;
    this._holeCol = Math.floor(Math.random() * COLS);
    this._best = this._bests[this._mode] || 0;
    this.setData({
      score: 0, best: this._best, level: 1, lines: 0,
      gameState: 'playing', isNewBest: false, result: null,
      mode: this._mode, modeName: MODES[this._mode].name,
    });
    this._syncHud(true);
    this._spawn();
    this._drawHold();
    this._startLoop();
    this._playBgm();
  },

  // ── 模式 ────────────────────────────────────────────────
  // 选模式面板:每个模式显示自己的纪录
  _refreshModeList() {
    const modeList = MODE_ORDER.map(id => {
      const b = this._bests[id];
      let best = '还没有纪录';
      if (b) best = id === 'sprint' ? `最快 ${fmtTime(b, true)}` : `最高 ${b}`;
      return { id, name: MODES[id].name, desc: MODES[id].desc, best, current: id === this._mode };
    });
    this.setData({ modeList });
  },

  _showMenu() {
    this._reset();
    this._state = 'menu';
    this._pauseBgm();
    this._refreshModeList();
    this.setData({ gameState: 'menu', result: null });
    this._drawNext();
    this._drawHold();
    this._startLoop();
  },

  onPickMode(e) {
    const id = e.currentTarget.dataset.mode;
    if (!MODES[id] || !this._isReady) return;
    this._mode = id;
    try { wx.setStorageSync(MODE_KEY, id); } catch (err) {}
    this._startGame();
  },

  onChangeMode() {
    if (!this._isReady) return;
    this._showMenu();
  },

  // 顶栏和侧栏木牌上的数字:按模式显示不同内容,文字变了才 setData
  _syncHud(force) {
    const m = MODES[this._mode];
    const best = this._bests[this._mode];
    let hud;
    if (this._mode === 'sprint') {
      hud = {
        hudLabel: 'TIME', hudValue: fmtTime(this._elapsed, true),
        stat1Label: 'LINES', stat1Value: `${Math.min(this._lines, m.goalLines)}/${m.goalLines}`,
        stat2Label: 'BEST', stat2Value: best ? fmtTime(best, true) : '--',
      };
    } else if (this._mode === 'ultra') {
      hud = {
        hudLabel: 'SCORE', hudValue: String(this._score),
        stat1Label: 'TIME', stat1Value: fmtTime(m.timeLimit - this._elapsed + 999, false),
        stat2Label: 'BEST', stat2Value: String(best || 0),
      };
    } else {
      hud = {
        hudLabel: 'SCORE', hudValue: String(this._score),
        stat1Label: 'LINES', stat1Value: String(this._lines),
        stat2Label: 'BEST', stat2Value: String(best || 0),
      };
    }
    const d = this.data;
    const changed = force || Object.keys(hud).some(k => d[k] !== hud[k]);
    if (changed) this.setData(hud);
  },

  // 冲刺消满 40 行 / 限时到点:不是失败,直接结算(不放灰木块淹没动画)
  _completeRun(label) {
    this._finished = true;
    this._cur = null;
    this._state = 'overAnim';
    this._fx.overStart = this._now;
    this._input.dir = 0;
    this._input.soft = false;
    this._label(label, '#FFD46A', 1.4);
    this._pauseBgm();
    this._playSfx('levelup');
  },

  // 木桩涨潮:整盘往上推一行,底下冒出一行带一个缺口的灰木桩
  _addGarbage() {
    if (this._board[0].some(Boolean)) { this._gameOver(); return; }
    // 缺口大多数时候留在同一列,方便连着消;偶尔换位置
    if (Math.random() < 0.3) this._holeCol = Math.floor(Math.random() * COLS);
    const row = Array.from({ length: COLS }, (_, c) => (c === this._holeCol ? '' : 'X' + ((c + this._riseCount) % VARIANTS)));
    this._board.shift();
    this._board.push(row);
    this._riseCount += 1;
    // 正在落的方块被顶到了就往上挪一格,还是挪不开就算输
    if (this._cur && this._collidesAt(this._cur.type, this._cur.rot, this._cur.row, this._cur.col)) {
      this._cur.row -= 1;
      if (this._collidesAt(this._cur.type, this._cur.rot, this._cur.row, this._cur.col)) { this._gameOver(); return; }
    }
    this._computeStackTop();
    this._fx.shake = Math.max(this._fx.shake, 2);
    this._sfx('harddrop', 0.8, 0.6);
  },

  _riseInterval() {
    return Math.max(RISE_MIN_MS, RISE_FIRST_MS - this._riseCount * RISE_STEP_MS);
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
    // vars:4 个格子各自的木纹变体,落定后跟着格子存进棋盘(如 'T2')
    const vars = [0, 1, 2, 3].map(() => Math.floor(Math.random() * VARIANTS));
    this._cur = { type, vars, rot: 0, row: 0, col: spawnCol(type) };
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
    this._sfx('move');
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
        this._sfx('rotate');
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
    this._hardLanding = true;
    this._lock();
    this._hardLanding = false;
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
    this._sfx('hold');
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
    // 软降不带到下一块:新方块要重新按才会加速,避免一直按着一路砸到底
    this._input.soft = false;
    const tspin = this._detectTSpin();
    const cells = this._curCells();
    let allHidden = true;
    for (let i = 0; i < cells.length; i++) {
      const [r, c] = cells[i];
      if (r < 0) { this._gameOver(); return; }
      this._board[r][c] = this._cur.type + this._cur.vars[i];
      if (r >= HIDDEN_ROWS) allHidden = false;
    }
    if (allHidden) { this._gameOver(); return; }
    this._cur = null;
    this._computeStackTop();

    const rows = [];
    for (let r = 0; r < ROWS; r++) {
      if (this._board[r].every(cell => !!cell)) rows.push(r);
    }
    const pts = this._scoreLock(rows.length, tspin);
    // 落地声先响,消行的断裂 / 爆炸晚 20ms 叠上去;有消行时落地声压低,两层加起来不爆音
    this._sfx(this._hardLanding ? 'harddrop' : 'lock', 1, rows.length ? 0.5 : 1);

    if (rows.length) {
      const n = Math.min(4, rows.length);
      const tier = CLEAR_FX[n];
      const fx = this._fx;
      this._state = 'clearing';
      fx.clearRows = rows;
      fx.clearSet = new Set(rows);
      fx.clearStart = this._now;
      fx.clearMs = tier.ms + (tspin ? 60 : 0);
      fx.clearTier = n;
      fx.clearTspin = !!tspin;
      fx.shake = Math.max(fx.shake, tier.shake + (tspin ? 1.5 : 0));
      this._spawnClearFx(rows, tier, pts);
      this._playClearSfx(n, !!tspin, this._combo);
    } else {
      if (tspin) this._playClearSfx(0, true, 0);
      this._spawn();
    }
  },

  // 某列在消行动画里"崩开"的时刻(占动画时长的比例)
  _clearPopAt(c) {
    const fx = this._fx;
    const st = CLEAR_FX[fx.clearTier].stagger;
    const mid = (COLS - 1) / 2;
    const k = fx.clearTier >= 4 ? Math.abs(c - mid) / mid : c / (COLS - 1);
    return 0.2 + st * k;
  },

  // 消行粒子:每个木块崩出几片木屑(带木块自己的颜色),3 行以上加木粉,
  // 4 行加金色火花和冲击波;再在消行位置飘一个 +分数
  _spawnClearFx(rows, tier, pts) {
    const fx = this._fx;
    const m = this._rect;
    if (!m) return;
    const { x, y, cell } = m;
    const h = this._art ? m.h : 0;
    const ms = fx.clearMs;
    const now = this._now;
    const vis = rows.filter(r => r >= HIDDEN_ROWS);
    const list = fx.particles;
    const rnd = (a, b) => a + Math.random() * (b - a);
    const midX = x - h + (COLS * cell) / 2;
    vis.forEach(r => {
      const cy = y + (r - HIDDEN_ROWS) * cell - h + cell / 2;
      for (let c = 0; c < COLS; c++) {
        const key = this._board[r][c];
        if (!key) continue;
        const base = WOOD[key[0]] || WOOD.X;
        const cx = x + c * cell - h + cell / 2;
        const born = now + this._clearPopAt(c) * ms;
        const out = tier.gold ? Math.sign(cx - midX) || 1 : 0;
        for (let i = 0; i < tier.chips; i++) {
          if (list.length >= MAX_PARTICLES) break;
          list.push({
            kind: 'chip', born, life: rnd(450, 800),
            x: cx + rnd(-0.3, 0.3) * cell, y: cy + rnd(-0.3, 0.3) * cell,
            vx: (rnd(-1, 1) + out * rnd(0.5, 1.5)) * cell * 5,
            vy: -rnd(4, 9 + tier.chips) * cell,
            g: cell * 32,
            rot: rnd(0, Math.PI), vr: rnd(-14, 14),
            w: cell * rnd(0.2, 0.38), hgt: cell * rnd(0.08, 0.15),
            color: Math.random() < 0.5 ? base : tint(base, Math.random() < 0.5 ? 0.3 : -0.3),
          });
        }
        if (tier.chips >= 4 && list.length < MAX_PARTICLES) {
          list.push({
            kind: 'dust', born, life: rnd(380, 560),
            x: cx, y: cy, vx: rnd(-1, 1) * cell, vy: -rnd(0.5, 1.5) * cell, g: 0,
            r0: cell * 0.15, r1: cell * rnd(0.45, 0.65), color: '#FFE9C8',
          });
        }
        if (tier.gold) {
          for (let i = 0; i < 2 && list.length < MAX_PARTICLES; i++) {
            list.push({
              kind: 'spark', born: born + rnd(0, 80), life: rnd(500, 900),
              x: cx, y: cy,
              vx: rnd(-1, 1) * cell * 9, vy: -rnd(3, 12) * cell, g: cell * 14,
              size: cell * rnd(0.08, 0.16),
              color: Math.random() < 0.6 ? '#FFE08A' : '#FFFFFF',
            });
          }
        }
      }
    });
    if (!vis.length) return;
    const top = Math.min(...vis);
    const bottom = Math.max(...vis);
    const rowsCy = y + ((top + bottom + 1) / 2 - HIDDEN_ROWS) * cell - h;
    if (tier.gold) fx.wave = { start: now + 0.18 * ms, x: midX, y: rowsCy };
    if (pts > 0) {
      fx.pops.push({ text: `+${pts}`, x: midX, y: rowsCy, start: now + 0.3 * ms, big: tier.gold || fx.clearTspin });
      if (fx.pops.length > 3) fx.pops.shift();
    }
  },

  _scoreLock(n, tspin) {
    const lv = this._level;
    let pts = 0;
    if (tspin) {
      const table = tspin === 'mini' ? TSPIN_MINI_SCORES : TSPIN_SCORES;
      pts += (table[n] || 0) * lv;
      const tag = n === 3 ? 'T-SPIN 三消!' : (n === 2 ? 'T-SPIN 双消!' : 'T-SPIN!');
      this._label(tspin === 'mini' ? 'T-SPIN MINI' : tag, '#D7A6FF', tspin === 'mini' ? 0.9 : 1.2 + n * 0.08);
    } else if (n > 0) {
      pts += CLEAR_SCORES[n] * lv;
      const lb = CLEAR_FX[Math.min(4, n)].label;
      if (lb) this._label(lb.text, lb.color, lb.size);
    }

    if (n > 0) {
      const difficult = n >= 4 || !!tspin;
      if (difficult && this._b2b) {
        pts = Math.floor(pts * 1.5);
        this._label('B2B ×1.5', '#8FD3FF', 0.8);
      }
      this._b2b = difficult;

      this._combo += 1;
      if (this._combo >= 1) {
        pts += 50 * this._combo * lv;
        this._label(`COMBO ×${this._combo + 1}`, '#FF9A6B', Math.min(1.1, 0.75 + this._combo * 0.05));
      }
    } else {
      this._combo = -1;
    }
    if (pts > 0) this._addScore(pts);
    return pts;
  },

  _finishClear() {
    const n = this._fx.clearRows.length;
    const kept = [];
    const shift = [];   // 留下的每行要往下掉几行,给"落下"动画用
    let below = n;
    for (let r = 0; r < ROWS; r++) {
      if (this._fx.clearSet.has(r)) { below -= 1; continue; }
      kept.push(this._board[r]);
      shift.push(below);
    }
    while (kept.length < ROWS) { kept.unshift(Array(COLS).fill('')); shift.unshift(0); }
    this._board = kept;
    if (shift.some(v => v > 0)) {
      const tier = CLEAR_FX[Math.min(4, n)];
      this._fx.settle = { start: this._now, ms: tier.settleMs, shift, landShake: Math.min(3, n * 0.7) };
    }
    this._fx.clearRows = [];
    this._fx.clearSet = new Set();
    this._computeStackTop();

    // 全清奖励
    if (this._stackTop >= ROWS) {
      this._addScore((PERFECT_SCORES[n] || 0) * this._level);
      this._label('全清 PERFECT!', '#FFFFFF', 1.3);
      this._playChord(CHIME_MAJOR.slice(2, 6), 0.05, 0.16, 1.2);
    }

    this._lines += n;
    // 冲刺模式:消满 40 行就结束;冲刺不升级,重力保持一级
    if (this._mode === 'sprint') {
      this.setData({ lines: this._lines });
      if (this._lines >= MODES.sprint.goalLines) {
        this._completeRun('完成!');
        return;
      }
      this._state = 'play';
      this._spawn();
      return;
    }
    const nextLevel = Math.floor(this._lines / 10) + 1;
    if (nextLevel !== this._level) {
      this._level = nextLevel;
      this._gravMs = this._gravityMs(nextLevel);
      this._label(`LEVEL ${nextLevel}`, '#F5C842', 1);
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

  // 结算:按模式比较纪录(冲刺比用时、只有完成才算;其他比分数),组装结算木牌
  _finishOver() {
    this._state = 'over';
    const mode = this._mode;
    const old = this._bests[mode];
    let isNewBest = false;
    if (mode === 'sprint') {
      if (this._finished && (!old || this._elapsed < old)) {
        this._bests.sprint = Math.round(this._elapsed);
        isNewBest = true;
      }
    } else if (this._score > 0 && this._score > (old || 0)) {
      this._bests[mode] = this._score;
      isNewBest = true;
    }
    if (isNewBest) {
      try { wx.setStorageSync(BEST_KEY, this._bests); } catch (e) {}
    }
    this._isNewBest = isNewBest;
    this._best = this._bests[mode] || 0;

    const best = this._bests[mode];
    let result;
    if (mode === 'sprint') {
      result = this._finished
        ? { title: '冲刺完成', mainLabel: '用时', main: fmtTime(this._elapsed, true),
          cells: [{ label: '消行', value: String(this._lines) }, { label: '得分', value: String(this._score) }, { label: '最快', value: best ? fmtTime(best, true) : '--' }] }
        : { title: '冲刺失败', mainLabel: '消了', main: `${this._lines}/40`,
          cells: [{ label: '用时', value: fmtTime(this._elapsed, false) }, { label: '得分', value: String(this._score) }, { label: '最快', value: best ? fmtTime(best, true) : '--' }] };
    } else {
      const title = mode === 'ultra' && this._finished ? '时间到' : '游戏结束';
      const third = mode === 'rise' ? { label: '木桩', value: String(this._riseCount) } : { label: '消行', value: String(this._lines) };
      result = { title, mainLabel: '本局得分', main: String(this._score),
        cells: [{ label: '等级', value: String(this._level) }, third, { label: '最高', value: String(best || 0) }] };
    }
    this._syncHud(true);
    this.setData({
      score: this._score,
      best: this._best,
      level: this._level,
      lines: this._lines,
      gameState: 'over',
      isNewBest,
      result,
    });
  },

  _label(text, color, size) {
    this._fx.labels.push({ text, color, size: size || 1, start: this._now });
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

    // 计时:游戏进行中(含消行动画)才走
    if (this._state === 'play' || this._state === 'clearing') {
      this._elapsed += dt;
      const lim = MODES[this._mode].timeLimit;
      // 到点时若正在消行,等这次消完再结算
      if (lim && this._elapsed >= lim && this._state === 'play') {
        this._elapsed = lim;
        this._completeRun('时间到!');
      }
    }
    if (this._state === 'play' && MODES[this._mode].rise) {
      this._riseAcc += dt;
      if (this._riseAcc >= this._riseInterval()) {
        this._riseAcc = 0;
        this._addGarbage();
      }
    }

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
      // 重力(软降按住超过 SOFT_DAS_MS 才开始连降)
      let soft = false;
      if (inp.soft) {
        if (inp.softWait > 0) {
          inp.softWait -= dt;
          // 延迟期间攒下的重力时间清掉,否则开始连降那一帧会一下子补掉好几格
          if (inp.softWait <= 0) this._gravAcc = 0;
        } else {
          soft = true;
        }
      }
      const gms = soft ? Math.min(SOFT_MS, this._gravMs) : this._gravMs;
      this._gravAcc += dt;
      while (this._gravAcc >= gms) {
        this._gravAcc -= gms;
        if (this._fall()) {
          if (soft) this._addScore(1);
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
      if (ts - this._fx.clearStart >= this._fx.clearMs) this._finishClear();
    } else if (this._state === 'overAnim') {
      if (ts - this._fx.overStart >= OVER_FILL_MS + 250) this._finishOver();
    }

    // 剩下的行落地那一下轻震
    const st = this._fx.settle;
    if (st && ts - st.start >= st.ms) {
      this._fx.shake = Math.max(this._fx.shake, st.landShake);
      this._fx.settle = null;
    }

    // HUD 按需同步(文字变了才 setData)
    if (this._state !== 'menu' && this._state !== 'over') this._syncHud(false);
  },

  // ── 渲染 ────────────────────────────────────────────────
  _computeMetrics() {
    // cell / x / y / width / height 与原来含义相同;h 是木块厚度(顶面往左上抬起的量)
    this._rect = trayMetrics(this._W, this._H, COLS, VISIBLE_ROWS);
    this._initArt();
  },

  // 木块图集 + 托盘两层先画在离屏 canvas 上,主棋盘用的再导出成图片
  // (导出前直接拿离屏 canvas 当图源);离屏 canvas 不可用时退回平面方块
  _initArt() {
    this._art = null;
    try {
      const make = (w, h) => wx.createOffscreenCanvas({ type: '2d', width: w, height: h });
      const tray = buildTray(make, this._W, this._H, this._dpr, this._rect);
      const atlas = buildCubeAtlas(make, this._rect.cell, this._dpr);
      this._art = { make, atlas, floor: tray.floor, rim: tray.rim, img: {}, mini: {} };
      this._bake('atlas', atlas.canvas);
      this._bake('floor', tray.floor);
      this._bake('rim', tray.rim);
    } catch (e) {
      this._art = null;
    }
  },

  _bake(key, canvas) {
    wx.canvasToTempFilePath({
      canvas,
      fileType: 'png',
      success: r => {
        const img = this._boardCanvas.createImage();
        img.onload = () => { if (this._art) this._art.img[key] = img; };
        img.src = r.tempFilePath;
      },
    });
  },

  // HOLD / NEXT 用的小尺寸图集,按格子大小缓存
  _miniAtlas(cell) {
    const art = this._art;
    if (!art) return null;
    if (!art.mini[cell]) {
      try {
        art.mini[cell] = buildCubeAtlas(art.make, cell, this._dpr);
      } catch (e) {
        return null;
      }
    }
    return art.mini[cell];
  },

  // 一个格子上的木块;key 是棋盘里存的 'T2'(木种 + 纹理变体),scale 用于消行收缩
  _cube(ctx, atlas, img, key, px, py, cell, alpha, scale) {
    const type = key[0];
    const variant = +key[1] || 0;
    if (atlas) {
      drawCubeAt(ctx, atlas, img, type, variant, px, py, alpha, scale);
      return;
    }
    const size = cell * (scale === undefined ? 1 : scale);
    this._blockRect(ctx, px + (cell - size) / 2, py + (cell - size) / 2, size, WOOD[type], alpha);
  },

  _draw(ts) {
    const ctx = this._ctx;
    if (!ctx || !this._rect) return;
    const { x, y, cell, width, height } = this._rect;
    const art = this._art;
    const atlas = art && art.atlas;
    const atlasImg = art && art.img.atlas;
    const h = art ? this._rect.h : 0;
    const fx = this._fx;
    const live = this._state === 'play' || this._state === 'pause';

    ctx.clearRect(0, 0, this._W, this._H);
    ctx.save();
    if (fx.shake > 0.3) {
      ctx.translate((Math.random() * 2 - 1) * fx.shake, (Math.random() * 2 - 1) * fx.shake);
      fx.shake *= 0.85;
    } else {
      fx.shake = 0;
    }

    // 托盘底板(木板 + 刻槽 + 内壁);离屏不可用时画个平面木色底
    if (art) {
      ctx.drawImage(art.img.floor || art.floor, 0, 0, this._W, this._H);
    } else {
      ctx.fillStyle = '#4A2C18';
      ctx.fillRect(x, y, width, height);
    }

    // 木桩涨潮预警:快冒出来时底部一条琥珀色光带闪烁
    if (MODES[this._mode].rise && this._state === 'play') {
      const left = this._riseInterval() - this._riseAcc;
      if (left < RISE_WARN_MS) {
        const k = 1 - left / RISE_WARN_MS;
        const a = (0.25 + 0.35 * k) * (0.6 + 0.4 * Math.sin(ts / 70));
        const grad = ctx.createLinearGradient(0, y - h + height, 0, y - h + height - cell * 1.6);
        grad.addColorStop(0, `rgba(255, 150, 50, ${a})`);
        grad.addColorStop(1, 'rgba(255, 150, 50, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(x - h, y - h + height - cell * 1.6, width, cell * 1.6);
      }
    }

    // 危险区红光(堆快到顶时脉动),铺在底板上
    if (this._stackTop <= HIDDEN_ROWS + 5 && (this._state === 'play' || this._state === 'clearing')) {
      const a = 0.16 + 0.08 * Math.sin(ts / 160);
      const grad = ctx.createLinearGradient(0, y - h, 0, y - h + cell * 5);
      grad.addColorStop(0, `rgba(255, 70, 40, ${a})`);
      grad.addColorStop(1, 'rgba(255, 70, 40, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(x - h, y - h, width, cell * 5);
    }

    // 幽灵投影:木块落点处一圈淡淡的描边
    if (this._cur && live) {
      const ghostDist = this._dropDistance();
      const color = PIECE_COLORS[this._cur.type];
      if (ghostDist > 0) {
        ctx.save();
        this._curCells(this._cur.rot, this._cur.row + ghostDist, this._cur.col).forEach(([r, c]) => {
          if (r < HIDDEN_ROWS) return;
          const px = x + c * cell - h;
          const py = y + (r - HIDDEN_ROWS) * cell - h;
          ctx.globalAlpha = 0.16;
          ctx.fillStyle = color;
          ctx.fillRect(px + 2, py + 2, cell - 4, cell - 4);
          ctx.globalAlpha = 0.7;
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(px + 2.5, py + 2.5, cell - 5, cell - 5);
        });
        ctx.restore();
      }
    }

    // 木块:落定的和正在下落的合在一起,按行从上到下、列从左到右画,
    // 后画的(下方 / 右方)正好盖住前一块伸出来的侧面
    const curAt = {};
    if (this._cur && live) {
      this._curCells().forEach(([r, c], i) => { curAt[r * COLS + c] = i; });
    }
    const curAlpha = this._lockMs > 0 ? 0.82 : 1;
    const clearing = this._state === 'clearing';
    const p = clearing ? Math.min(1, (ts - fx.clearStart) / fx.clearMs) : 0;
    const popAt = [];
    if (clearing) for (let c = 0; c < COLS; c++) popAt.push(this._clearPopAt(c));
    // 消行后上面的行像受重力一样加速落下(只是视觉偏移,逻辑棋盘已经更新)
    const st = fx.settle;
    const fall = st ? Math.min(1, (ts - st.start) / st.ms) : 1;
    // 消行行的闪光颜色:普通暖白、T-Spin 淡紫、4 行金色
    const glowRGB = fx.clearTspin ? '230, 200, 255' : (fx.clearTier >= 4 ? '255, 222, 130' : '255, 246, 222');
    for (let r = HIDDEN_ROWS; r < ROWS; r++) {
      const off = st && st.shift[r] ? -st.shift[r] * cell * (1 - fall * fall) : 0;
      const py = y + (r - HIDDEN_ROWS) * cell + off;
      const isClear = clearing && fx.clearSet.has(r);
      for (let c = 0; c < COLS; c++) {
        const px = x + c * cell;
        const t = this._board[r][c];
        if (t) {
          if (isClear) {
            // 扫到这一列时先亮一下,随后缩小崩成木屑
            const k = (p - popAt[c]) / 0.22;
            const scale = k <= 0 ? 1 : 1 - Math.min(1, k);
            this._cube(ctx, atlas, atlasImg, t, px, py, cell, 1, scale);
            const glow = Math.max(0, 1 - Math.abs(p - popAt[c]) / 0.12);
            if (glow > 0 && scale > 0) {
              ctx.fillStyle = `rgba(${glowRGB}, ${0.85 * glow})`;
              const sz = cell * Math.max(scale, 0.3);
              ctx.fillRect(px - h + (cell - sz) / 2, py - h + (cell - sz) / 2, sz, sz);
            }
          } else {
            this._cube(ctx, atlas, atlasImg, t, px, py, cell, 1);
          }
        } else if (curAt[r * COLS + c] !== undefined) {
          const i = curAt[r * COLS + c];
          this._cube(ctx, atlas, atlasImg, this._cur.type + this._cur.vars[i], px, py, cell, curAlpha);
        }
      }
    }
    if (clearing) {
      // 整行闪光:档位越高越亮
      const flash = CLEAR_FX[fx.clearTier].flash;
      if (p < 0.2) {
        ctx.fillStyle = `rgba(${glowRGB}, ${flash * (1 - p / 0.2)})`;
        fx.clearRows.forEach(r => {
          if (r >= HIDDEN_ROWS) ctx.fillRect(x - h, y + (r - HIDDEN_ROWS) * cell - h, width, cell + h);
        });
      }
      // 4 行:整盘泛一层金光
      if (fx.clearTier >= 4) {
        const a = 0.22 * Math.max(0, 1 - p / 0.7);
        ctx.fillStyle = `rgba(255, 205, 90, ${a})`;
        ctx.fillRect(x - h, y - h, width, height);
      }
    }

    // 硬降拖尾
    if (fx.trail && ts - fx.trail.start < 160) {
      const a = 1 - (ts - fx.trail.start) / 160;
      ctx.fillStyle = fx.trail.color;
      ctx.globalAlpha = 0.28 * a;
      fx.trail.cols.forEach(({ c, toRow, dist }) => {
        const top = Math.max(HIDDEN_ROWS, toRow - dist);
        const py = y + (top - HIDDEN_ROWS) * cell - h;
        const ph = (toRow - top) * cell;
        if (ph > 0) ctx.fillRect(x + c * cell - h + cell * 0.15, py, cell * 0.7, ph);
      });
      ctx.globalAlpha = 1;
    } else if (fx.trail) {
      fx.trail = null;
    }

    // 结束动画:灰木块自底向上淹没(从上往下画,保持遮挡顺序);冲刺完成 / 时间到不淹没
    if ((this._state === 'overAnim' || this._state === 'over') && !this._finished) {
      const op = Math.min(1, (ts - fx.overStart) / OVER_FILL_MS);
      const nFill = this._state === 'over' ? VISIBLE_ROWS : Math.floor(op * VISIBLE_ROWS);
      for (let r = VISIBLE_ROWS - nFill; r < VISIBLE_ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          this._cube(ctx, atlas, atlasImg, 'X' + ((r + c) % VARIANTS), x + c * cell, y + r * cell, cell, 0.96);
        }
      }
    }

    // 托盘围边盖在最上面:挡住最右列 / 最底行木块的侧面
    if (art) ctx.drawImage(art.img.rim || art.rim, 0, 0, this._W, this._H);

    // 消行特效:冲击波、木屑 / 木粉 / 火花、+分数,都盖在围边上面
    const pdt = fx.lastDraw ? Math.min(50, ts - fx.lastDraw) / 1000 : 0.016;
    fx.lastDraw = ts;
    this._drawWave(ctx, ts, width);
    this._drawParticles(ctx, ts, pdt);
    this._drawPops(ctx, ts, cell);

    // 浮动大字(TETRIS! / T-SPIN! / COMBO…):弹出时先放大再回弹,档位越高字越大
    for (let i = fx.labels.length - 1; i >= 0; i--) {
      const lb = fx.labels[i];
      const age = ts - lb.start;
      const life = 750 + lb.size * 300;
      if (age > life) { fx.labels.splice(i, 1); continue; }
      const t01 = age / life;
      const k = Math.min(1, age / 220);
      const back = 1 + 2.7 * Math.pow(k - 1, 3) + 1.7 * Math.pow(k - 1, 2);
      const scale = 0.35 + 0.65 * back;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, age / 60, (1 - t01) / 0.3));
      const fs = Math.round(cell * 0.9 * lb.size * scale);
      ctx.font = `bold ${fs}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const lx = x - h + width / 2;
      const ly = y + height * 0.3 - t01 * 30 + i * cell * 1.15;
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(3, fs * 0.18);
      ctx.strokeStyle = '#2A1408';
      ctx.strokeText(lb.text, lx + 1.5, ly + 2);
      ctx.strokeText(lb.text, lx, ly);
      ctx.fillStyle = lb.color;
      ctx.fillText(lb.text, lx, ly);
      if (lb.size >= 1.3) {
        // 大字顶部一道高光,更像烫金
        ctx.save();
        ctx.beginPath();
        ctx.rect(lx - width / 2, ly - fs / 2, width, fs * 0.42);
        ctx.clip();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.fillText(lb.text, lx, ly);
        ctx.restore();
      }
      ctx.restore();
    }

    ctx.restore();
  },

  // 4 行消除的金色冲击波:两道圆环从消行中心扩散
  _drawWave(ctx, ts, width) {
    const w = this._fx.wave;
    if (!w) return;
    const age = ts - w.start;
    if (age < 0) return;
    if (age > 520) { this._fx.wave = null; return; }
    ctx.save();
    [0, 90].forEach(lag => {
      const t = (age - lag) / 430;
      if (t <= 0 || t >= 1) return;
      const e = 1 - Math.pow(1 - t, 3);
      ctx.globalAlpha = (1 - t) * 0.85;
      ctx.strokeStyle = lag ? '#FFFFFF' : '#FFD46A';
      ctx.lineWidth = Math.max(1, (1 - t) * 7);
      ctx.beginPath();
      ctx.arc(w.x, w.y, 6 + e * width * 0.85, 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.restore();
  },

  _drawParticles(ctx, ts, dt) {
    const list = this._fx.particles;
    if (!list.length) return;
    ctx.save();
    for (let i = list.length - 1; i >= 0; i--) {
      const q = list[i];
      const age = ts - q.born;
      if (age < 0) continue;
      if (age > q.life) { list.splice(i, 1); continue; }
      q.vy += q.g * dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      const t = age / q.life;
      if (q.kind === 'chip') {
        q.rot += q.vr * dt;
        ctx.globalAlpha = t < 0.7 ? 1 : (1 - t) / 0.3;
        const c = Math.cos(q.rot);
        const sn = Math.sin(q.rot);
        ctx.setTransform(c * this._dpr, sn * this._dpr, -sn * this._dpr, c * this._dpr, q.x * this._dpr, q.y * this._dpr);
        ctx.fillStyle = 'rgba(30, 14, 4, 0.5)';
        ctx.fillRect(-q.w / 2 + 0.6, -q.hgt / 2 + 0.6, q.w, q.hgt);
        ctx.fillStyle = q.color;
        ctx.fillRect(-q.w / 2, -q.hgt / 2, q.w, q.hgt);
      } else if (q.kind === 'dust') {
        ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
        ctx.globalAlpha = 0.16 * (1 - t) * (1 - t);
        ctx.fillStyle = q.color;
        ctx.beginPath();
        ctx.arc(q.x, q.y, q.r0 + (q.r1 - q.r0) * t, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // 火花:闪烁的小亮点,拖一点尾巴
        ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
        ctx.globalAlpha = (1 - t) * (0.6 + 0.4 * Math.sin(age / 30));
        ctx.strokeStyle = q.color;
        ctx.lineWidth = q.size;
        ctx.beginPath();
        ctx.moveTo(q.x, q.y);
        ctx.lineTo(q.x - q.vx * 0.025, q.y - q.vy * 0.025);
        ctx.stroke();
      }
    }
    ctx.restore();
  },

  // +分数:从消行位置往上飘
  _drawPops(ctx, ts, cell) {
    const pops = this._fx.pops;
    for (let i = pops.length - 1; i >= 0; i--) {
      const pp = pops[i];
      const age = ts - pp.start;
      if (age < 0) continue;
      if (age > 800) { pops.splice(i, 1); continue; }
      const t = age / 800;
      const fs = Math.round(cell * (pp.big ? 0.8 : 0.62));
      ctx.save();
      ctx.globalAlpha = Math.min(1, age / 80, (1 - t) / 0.35);
      ctx.font = `bold ${fs}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const py = pp.y - (1 - Math.pow(1 - t, 2)) * cell * 1.6;
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(2.5, fs * 0.2);
      ctx.strokeStyle = '#2A1408';
      ctx.strokeText(pp.text, pp.x, py);
      ctx.fillStyle = pp.big ? '#FFE9A8' : '#FFF4E0';
      ctx.fillText(pp.text, pp.x, py);
      ctx.restore();
    }
  },

  // 平面方块:离屏 canvas 不可用时的兜底画法
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
    ctx.strokeStyle = 'rgba(40, 20, 6, 0.45)';
    ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
    ctx.restore();
  },

  _drawMini(ctx, type, cx, cy, cell, alpha) {
    const atlas = this._miniAtlas(cell);
    const h = atlas ? atlas.h : 0;
    // 先上后下、先左后右,保证木块侧面的遮挡顺序
    const cells = SHAPES[type][0].slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let minR = 9, maxR = -9, minC = 9, maxC = -9;
    cells.forEach(([r, c]) => {
      minR = Math.min(minR, r); maxR = Math.max(maxR, r);
      minC = Math.min(minC, c); maxC = Math.max(maxC, c);
    });
    const w = (maxC - minC + 1) * cell;
    const hh = (maxR - minR + 1) * cell;
    // 木块整体(顶面 + 侧面)居中
    const ox = cx - w / 2 + h / 2;
    const oy = cy - hh / 2 + h / 2;
    cells.forEach(([r, c], i) => {
      this._cube(ctx, atlas, null, type + (i % VARIANTS), ox + (c - minC) * cell, oy + (r - minR) * cell, cell, alpha);
    });
  },

  _drawNext() {
    const ctx = this._nextCtx;
    if (!ctx) return;
    const W = this._nextW;
    const H = this._nextH;
    ctx.clearRect(0, 0, W, H);
    drawPanel(ctx, W, H);

    // 余光里要一眼分清"下一个":第一个独占上半截的亮框、方块最大;
    // 后两个在刻槽下面,小一号且变暗,大小和亮度差比位置更容易被余光捕捉
    const firstH = Math.round(H * 0.46);
    const pad = 4;
    const r = 6;
    const bx = pad, by = pad, bw = W - pad * 2, bh = firstH - pad * 2;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(bx + r, by);
    ctx.arcTo(bx + bw, by, bx + bw, by + bh, r);
    ctx.arcTo(bx + bw, by + bh, bx, by + bh, r);
    ctx.arcTo(bx, by + bh, bx, by, r);
    ctx.arcTo(bx, by, bx + bw, by, r);
    ctx.closePath();
    const glow = ctx.createRadialGradient(W / 2, firstH / 2, 0, W / 2, firstH / 2, bw * 0.7);
    glow.addColorStop(0, 'rgba(255, 214, 140, 0.30)');
    glow.addColorStop(1, 'rgba(255, 214, 140, 0.06)');
    ctx.fillStyle = glow;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255, 214, 140, 0.75)';
    ctx.stroke();
    ctx.restore();

    // 分隔刻槽
    ctx.fillStyle = 'rgba(10, 4, 0, 0.6)';
    ctx.fillRect(pad, firstH + 1, W - pad * 2, 1.5);
    ctx.fillStyle = 'rgba(255, 220, 170, 0.12)';
    ctx.fillRect(pad, firstH + 2.5, W - pad * 2, 1);

    const big = Math.max(6, Math.floor(Math.min((bw - 6) / 4.4, (bh - 6) / 2.8)));
    if (this._queue.length) this._drawMini(ctx, this._queue[0], W / 2, firstH / 2, big, 1);

    const slotH = (H - firstH) / 2;
    const small = Math.max(5, Math.min(Math.round(big * 0.6), Math.floor(Math.min(W / 6, slotH / 3.4))));
    for (let i = 1; i < 3 && i < this._queue.length; i++) {
      this._drawMini(ctx, this._queue[i], W / 2, firstH + slotH * (i - 0.5) + 2, small, i === 1 ? 0.6 : 0.4);
    }
  },

  _drawHold() {
    const ctx = this._holdCtx;
    if (!ctx) return;
    ctx.clearRect(0, 0, this._holdW, this._holdH);
    drawPanel(ctx, this._holdW, this._holdH);
    if (!this._hold) {
      ctx.fillStyle = 'rgba(255, 228, 185, 0.4)';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('空', this._holdW / 2, this._holdH / 2);
      return;
    }
    const cell = Math.max(6, Math.floor(Math.min(this._holdW / 5.4, this._holdH / 3.6)));
    this._drawMini(ctx, this._hold, this._holdW / 2, this._holdH / 2, cell, this._holdUsed ? 0.4 : 1);
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
    this._sfx('soft');
    this._input.soft = true;
    this._input.softWait = SOFT_DAS_MS;
    this._gravAcc = 0;
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
      levelup:  mkSfx('/assets/sounds/tetris-levelup.mp3',  0.9),
      gameover: mkSfx('/assets/sounds/tetris-gameover.mp3', 0.9),
    };

    try {
      this._wac = wx.createWebAudioContext();
    } catch (e) {
      this._wac = null;
    }
    if (this._wac) {
      this._buildSfxBuffers();
    } else {
      SFX_FALLBACK.forEach(name => {
        this._audio[name] = mkSfx(`/assets/sounds/tetris-${name}.mp3`, 1);
      });
    }
  },

  // 木头音效直接合成进 WebAudio buffer(延迟低,还能变调);
  // 每帧只合成一个,不卡开局
  _buildSfxBuffers() {
    this._sfxBuf = {};
    const wac = this._wac;
    const queue = SFX_NAMES.slice();
    const next = () => {
      if (!this._wac || !queue.length) return;
      const name = queue.shift();
      try {
        const data = renderSfx(name, wac.sampleRate);
        const buf = wac.createBuffer(1, data.length, wac.sampleRate);
        const ch = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) ch[i] = data[i];
        this._sfxBuf[name] = buf;
      } catch (e) {}
      setTimeout(next, 16);
    };
    next();
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
      this._bus = null;
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

  // 木头音效:优先 WebAudio buffer(rate 变调,±2% 随机,听起来不机械),
  // 没有就退回 mp3(只有落定 / 硬降 / 消行有兜底)
  _sfx(name, rate, vol, delay) {
    if (this.data.muted) return;
    const buf = this._sfxBuf && this._sfxBuf[name];
    if (buf && this._wac) {
      try {
        const src = this._wac.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = (rate || 1) * (0.98 + Math.random() * 0.04);
        const gain = this._wac.createGain();
        gain.gain.value = vol === undefined ? 1 : vol;
        src.connect(gain);
        gain.connect(this._sfxBus());
        src.start(this._wac.currentTime + (delay || 0));
      } catch (e) {}
      return;
    }
    this._playSfx(name);
  },

  // 音效总线:统一压一点音量,支持的话再过压缩器,多个音效叠在一起时不削波
  _sfxBus() {
    if (!this._bus) {
      const wac = this._wac;
      const bus = wac.createGain();
      bus.gain.value = 0.72;
      try {
        const comp = wac.createDynamicsCompressor();
        comp.threshold.value = -10;
        comp.knee.value = 6;
        comp.ratio.value = 8;
        comp.attack.value = 0.002;
        comp.release.value = 0.15;
        bus.connect(comp);
        comp.connect(wac.destination);
      } catch (e) {
        bus.connect(wac.destination);
      }
      this._bus = bus;
    }
    return this._bus;
  },

  // 消行:木头断裂 → 砸碎 → 爆炸,行数越多越猛;
  // T-Spin 先"呼"一声;连击每次音高升 3%(最多 8 级)
  _playClearSfx(n, tspin, combo) {
    if (tspin) this._sfx('whoosh');
    if (n <= 0) return;
    const rate = 1 + Math.min(Math.max(combo, 0), 8) * 0.03;
    this._sfx(`clear${Math.min(4, n)}`, rate, 1, 0.02);
  },

  _osc(type, freq, at, dur, vol) {
    const wac = this._wac;
    const osc = wac.createOscillator();
    const gain = wac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(vol, at + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, at + dur);
    osc.connect(gain);
    gain.connect(wac.destination);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  },

  // 和弦余音(全清奖励)
  _playChord(freqs, gap, vol, dur, at) {
    const wac = this._wac;
    if (!wac || this.data.muted) return;
    try {
      const t0 = at || wac.currentTime + 0.01;
      freqs.forEach((f, i) => {
        this._osc('triangle', f, t0 + i * gap, dur, vol);
        this._osc('sine', f * 2, t0 + i * gap, dur * 0.6, vol * 0.3);
      });
    } catch (e) {}
  },
});
