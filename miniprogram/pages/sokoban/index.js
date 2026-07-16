// ─── 像素推箱子 ──────────────────────────────────────────
// 10 关谜题（含经典 Microban 布局），全部经 BFS 求解器验证可解，
// par 为最少步数。砖纹墙 + 木箱 + 发光目标点 + 推动滑动动画 +
// 8-bit 音效；进度与个人纪录本地保存，支持选关。
const { GRID_COLS, GRID_ROWS, drawClawd } = require('../../utils/clawd');

// '#' 墙  ' ' 地板  '@' 玩家  '$' 箱子  '.' 目标  '*' 箱=目标  '+' 玩家=目标
const LEVELS = [
  {
    name: '热身', par: 4,
    map: [
      '######',
      '#    #',
      '# .  #',
      '#  $ #',
      '#  @ #',
      '######',
    ]
  },
  {
    name: '绕个弯', par: 5,
    map: [
      '######',
      '#  . #',
      '#    #',
      '# $  #',
      '# @  #',
      '######',
    ]
  },
  {
    name: '窄门', par: 16,
    map: [
      '######',
      '#    #',
      '# #@ #',
      '# $* #',
      '# .* #',
      '#    #',
      '######',
    ]
  },
  {
    name: '经典小屋', par: 33,
    map: [
      '####',
      '# .#',
      '#  ###',
      '#*@  #',
      '#  $ #',
      '#  ###',
      '####',
    ]
  },
  {
    name: '回字仓', par: 21,
    map: [
      '########',
      '#  @   #',
      '# $$$  #',
      '# #  # #',
      '# . .  #',
      '##  . ##',
      ' ######',
    ]
  },
  {
    name: '一字排开', par: 23,
    map: [
      '########',
      '#      #',
      '# .**$@#',
      '#      #',
      '#####  #',
      '    ####',
    ]
  },
  {
    name: '拐角仓库', par: 41,
    map: [
      '  ####',
      '###  ####',
      '#     $ #',
      '# #  #$ #',
      '# . .#@ #',
      '#########',
    ]
  },
  {
    name: '十字花', par: 25,
    map: [
      ' #######',
      ' #     #',
      ' # .$. #',
      '## $@$ #',
      '#  .$. #',
      '#      #',
      '########',
    ]
  },
  {
    name: '双室调度', par: 33,
    map: [
      '#########',
      '#   #   #',
      '# $ . $ #',
      '#   #   #',
      '## ### ##',
      '#   #   #',
      '# $ . @ #',
      '#   .   #',
      '#########',
    ]
  },
  {
    name: '四角归位', par: 23,
    map: [
      '########',
      '#.    .#',
      '#  $$  #',
      '#  @   #',
      '#  $$  #',
      '#.    .#',
      '########',
    ]
  },
];

const SLIDE_MS = 90;    // 推动滑动动画时长
const LAND_MS  = 140;   // 箱子到位弹一下

// ─── 配色 ────────────────────────────────────────────────
const C_BG      = '#1A1A2E';
const C_FLOOR_A = '#20203C';
const C_FLOOR_B = '#232345';
const C_WALL_A  = '#3B3B60';
const C_WALL_B  = '#383858';
const C_MORTAR  = '#262648';
const C_BOX     = '#8B5E3C';
const C_BOX_D   = '#6A4428';
const C_BOX_S   = '#4E2F1B';
const C_DONE    = '#F5C842';
const C_DONE_D  = '#C9992B';
const C_TARGET  = '#5C87C9';

Page({
  data: {
    gameState: 'playing',   // 'playing' | 'win'
    levelIndex: 0,
    levelName: '',
    levelCount: LEVELS.length,
    steps: 0,
    par: 0,
    best: 0,
    isPerfect: false,
    isAllDone: false,
    showSelect: false,
    levelList: [],
  },

  onLoad() {
    this._unlocked = wx.getStorageSync('sokoban_unlocked') || 0;
    this._best = wx.getStorageSync('sokoban_best') || {};
  },

  onReady() {
    const info = wx.getSystemInfoSync();
    this._dpr = info.pixelRatio || 2;

    wx.createSelectorQuery()
      .select('#sokoban-canvas')
      .fields({ node: true, size: true })
      .exec(res => {
        if (!res || !res[0] || !res[0].node) return;
        const node = res[0].node;
        const w = res[0].width;
        const h = res[0].height;

        node.width  = Math.round(w * this._dpr);
        node.height = Math.round(h * this._dpr);

        const ctx = node.getContext('2d');
        ctx.scale(this._dpr, this._dpr);

        this._canvas = node;
        this._ctx    = ctx;
        this._W      = w;
        this._H      = h;

        this._initAudio();
        this._loadLevel(Math.min(this._unlocked, LEVELS.length - 1));
        this._startLoop();
      });
  },

  onUnload() { this._stopLoop(); },
  onHide()   { this._stopLoop(); },
  onShow()   { if (this._canvas) this._startLoop(); },

  // ─── 触摸滑动手势 ─────────────────────────────────────
  noop() {},

  onTouchStart(e) {
    const t = e.touches[0];
    this._tx = t.clientX;
    this._ty = t.clientY;
  },

  onTouchEnd(e) {
    if (this.data.gameState !== 'playing' || this.data.showSelect) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - this._tx;
    const dy = t.clientY - this._ty;
    const MIN = 30;
    if (Math.abs(dx) < MIN && Math.abs(dy) < MIN) return;
    if (Math.abs(dx) >= Math.abs(dy)) {
      this._move(dx > 0 ? 1 : -1, 0);
    } else {
      this._move(0, dy > 0 ? 1 : -1);
    }
  },

  // ─── 方向按钮 ─────────────────────────────────────────
  onUp()    { this._move(0, -1); },
  onDown()  { this._move(0,  1); },
  onLeft()  { this._move(-1, 0); },
  onRight() { this._move(1,  0); },

  // ─── 撤销 / 重开 ──────────────────────────────────────
  onUndo() {
    if (!this._history || !this._history.length) return;
    if (this.data.gameState !== 'playing') return;
    const prev = this._history.pop();
    this._map  = prev.map;
    this._px   = prev.px;
    this._py   = prev.py;
    this._anim = null;
    this.setData({ steps: Math.max(0, this.data.steps - 1) });
    this._sfxUndo();
  },

  onRestartLevel() {
    if (this.data.steps > 0 && this.data.gameState === 'playing') {
      wx.showModal({
        title: '重开本关',
        content: '当前步数将清零，确定重开吗？',
        confirmText: '重开',
        cancelText: '继续玩',
        success: res => { if (res.confirm) this._loadLevel(this.data.levelIndex); }
      });
    } else {
      this._loadLevel(this.data.levelIndex);
    }
  },

  // ─── 选关 ─────────────────────────────────────────────
  onSelectShow() {
    const list = LEVELS.map((lv, i) => ({
      index: i,
      name: lv.name,
      locked: i > this._unlocked,
      best: this._best[i] || 0,
      current: i === this.data.levelIndex,
    }));
    this.setData({ showSelect: true, levelList: list });
  },

  onSelectClose() {
    this.setData({ showSelect: false });
  },

  onSelectLevel(e) {
    const idx = e.currentTarget.dataset.index;
    if (idx > this._unlocked) {
      wx.showToast({ title: '先通过前面的关卡吧', icon: 'none' });
      return;
    }
    this.setData({ showSelect: false });
    this._loadLevel(idx);
  },

  // ─── 通关按钮 ─────────────────────────────────────────
  onRestart() {
    const idx = this.data.isAllDone ? 0 : this.data.levelIndex;
    this._loadLevel(idx);
  },

  onNext() {
    const next = this.data.levelIndex + 1;
    if (next < LEVELS.length) {
      this._loadLevel(next);
    }
  },

  // ─── 关卡加载 ─────────────────────────────────────────
  _loadLevel(idx) {
    const level = LEVELS[idx];
    // 深拷贝并补齐行宽（地图可能是不规则形状）
    const cols = Math.max(...level.map.map(r => r.length));
    const map = level.map.map(row => {
      const arr = row.split('');
      while (arr.length < cols) arr.push(' ');
      return arr;
    });

    let px = 0, py = 0;
    map.forEach((row, r) => row.forEach((c, col) => {
      if (c === '@' || c === '+') { px = col; py = r; }
    }));

    this._map     = map;
    this._px      = px;
    this._py      = py;
    this._history = [];
    this._anim    = null;
    this._landPulse = null;
    this._winAt   = 0;
    this._blinkAt = Date.now() + 3000;
    this._interior = this._floodInterior(map, px, py);

    const rows = map.length;
    this._cell  = Math.min(64, Math.floor(Math.min(this._W / cols, this._H / rows)));
    this._offX  = Math.round((this._W - cols * this._cell) / 2);
    this._offY  = Math.round((this._H - rows * this._cell) / 2);

    this.setData({
      gameState: 'playing',
      levelIndex: idx,
      levelName: level.name,
      steps: 0,
      par: level.par,
      best: this._best[idx] || 0,
      isPerfect: false,
      isAllDone: false,
    });
  },

  // 从玩家出发洪水填充，标记地图内部（外部空格不画地板）
  _floodInterior(map, px, py) {
    const rows = map.length, cols = map[0].length;
    const interior = new Set();
    const queue = [[px, py]];
    interior.add(py * cols + px);
    while (queue.length) {
      const [x, y] = queue.pop();
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const k = ny * cols + nx;
        if (interior.has(k) || map[ny][nx] === '#') continue;
        interior.add(k);
        queue.push([nx, ny]);
      }
    }
    return interior;
  },

  // ─── 移动逻辑 ─────────────────────────────────────────
  _move(dx, dy) {
    if (this.data.gameState !== 'playing' || this.data.showSelect) return;
    this._anim = null;   // 连续操作时上一步动画立即完成
    const map = this._map;
    const fx  = this._px, fy = this._py;
    const nx  = fx + dx;
    const ny  = fy + dy;

    if (!this._inBounds(nx, ny)) return;
    const target = map[ny][nx];
    if (target === '#') return;

    this._history.push({
      map: map.map(r => [...r]),
      px: fx,
      py: fy,
    });

    const isBox = target === '$' || target === '*';
    let landed = false;
    if (isBox) {
      const bx = nx + dx;
      const by = ny + dy;
      if (!this._inBounds(bx, by)) { this._history.pop(); return; }
      const behind = map[by][bx];
      if (behind === '#' || behind === '$' || behind === '*') {
        this._history.pop(); return;
      }
      landed = behind === '.';
      map[by][bx] = landed ? '*' : '$';
      map[ny][nx] = (target === '*') ? '.' : ' ';
      this._anim = { fx, fy, tx: nx, ty: ny, bfx: nx, bfy: ny, btx: bx, bty: by, start: Date.now() };
      if (landed) {
        this._landPulse = { x: bx, y: by, at: Date.now() + SLIDE_MS };
        try { wx.vibrateShort({ type: 'light' }); } catch (e) {}
        this._sfxDing();
      } else {
        this._sfxPush();
      }
    } else {
      this._anim = { fx, fy, tx: nx, ty: ny, start: Date.now() };
      this._sfxStep();
    }

    const curCell = map[fy][fx];
    map[fy][fx] = (curCell === '+') ? '.' : ' ';
    map[ny][nx] = (map[ny][nx] === '.') ? '+' : '@';
    this._px = nx;
    this._py = ny;

    this.setData({ steps: this.data.steps + 1 });
    this._checkWin();
  },

  _inBounds(x, y) {
    return y >= 0 && y < this._map.length && x >= 0 && x < this._map[y].length;
  },

  _checkWin() {
    const won = !this._map.some(row => row.includes('$'));
    if (!won) return;
    const idx = this.data.levelIndex;
    const steps = this.data.steps;
    const isAllDone = idx >= LEVELS.length - 1;

    // 解锁进度 + 个人纪录
    if (idx >= this._unlocked && idx + 1 < LEVELS.length) {
      this._unlocked = idx + 1;
      wx.setStorageSync('sokoban_unlocked', this._unlocked);
    }
    if (!this._best[idx] || steps < this._best[idx]) {
      this._best[idx] = steps;
      wx.setStorageSync('sokoban_best', this._best);
    }

    this._winAt = Date.now();
    this._sfxWin();
    setTimeout(() => {
      this.setData({
        gameState: 'win',
        isAllDone,
        best: this._best[idx],
        isPerfect: steps <= LEVELS[idx].par,
      });
    }, 700);
  },

  // ─── 渲染主循环 ───────────────────────────────────────
  _startLoop() {
    this._stopLoop();
    const loop = () => {
      this._draw(Date.now());
      this._raf = this._canvas.requestAnimationFrame(loop);
    };
    loop();
  },

  _stopLoop() {
    if (this._raf && this._canvas) {
      this._canvas.cancelAnimationFrame(this._raf);
      this._raf = null;
    }
  },

  _draw(now) {
    const { _ctx: ctx, _map: map, _cell: C, _offX: ox, _offY: oy } = this;
    if (!ctx || !map) return;
    const cols = map[0].length;

    ctx.fillStyle = C_BG;
    ctx.fillRect(0, 0, this._W, this._H);

    // 第一遍：整张地图的像素硬阴影
    ctx.fillStyle = '#0E0E22';
    map.forEach((row, r) => row.forEach((ch, c) => {
      if (ch === '#' || this._interior.has(r * cols + c)) {
        ctx.fillRect(ox + c * C + 5, oy + r * C + 5, C, C);
      }
    }));

    // 第二遍：地基（墙 / 地板 / 目标点）
    map.forEach((row, r) => {
      row.forEach((ch, c) => {
        const x = ox + c * C;
        const y = oy + r * C;
        if (ch === '#') {
          this._drawWall(ctx, x, y, C, r, c);
        } else if (this._interior.has(r * cols + c)) {
          this._drawFloor(ctx, x, y, C, r, c);
          if (ch === '.' || ch === '*' || ch === '+') {
            this._drawTarget(ctx, x, y, C, now, ch === '*');
          }
        }
      });
    });

    // 滑动动画插值
    const anim = this._anim;
    let t = 1;
    if (anim) {
      t = Math.min(1, (now - anim.start) / SLIDE_MS);
      if (t >= 1) this._anim = null;
    }
    const lerp = (from, to) => to + (from - to) * (1 - t);

    // 第三遍：箱子
    map.forEach((row, r) => {
      row.forEach((ch, c) => {
        if (ch !== '$' && ch !== '*') return;
        let bx = ox + c * C, by = oy + r * C;
        if (anim && t < 1 && c === anim.btx && r === anim.bty) {
          bx = ox + lerp(anim.bfx, anim.btx) * C;
          by = oy + lerp(anim.bfy, anim.bty) * C;
        }
        let scale = 1;
        if (this._landPulse && this._landPulse.x === c && this._landPulse.y === r) {
          const pt = (now - this._landPulse.at) / LAND_MS;
          if (pt >= 0 && pt < 1) scale = 1 + Math.sin(pt * Math.PI) * 0.13;
          else if (pt >= 1) this._landPulse = null;
        }
        this._drawBox(ctx, bx, by, C, ch === '*', now, scale);
      });
    });

    // 第四遍：玩家
    let pxPix = ox + this._px * C, pyPix = oy + this._py * C;
    if (anim && t < 1) {
      pxPix = ox + lerp(anim.fx, anim.tx) * C;
      pyPix = oy + lerp(anim.fy, anim.ty) * C;
    }
    this._drawPlayer(ctx, pxPix, pyPix, C, now);
  },

  // ── 墙（砖纹 + 立体棱边）──
  _drawWall(ctx, x, y, C, r, c) {
    ctx.fillStyle = (r + c) % 2 === 0 ? C_WALL_A : C_WALL_B;
    ctx.fillRect(x, y, C, C);
    // 砖缝：上下两层砖，错缝排列
    ctx.fillStyle = C_MORTAR;
    const mid = Math.round(C / 2);
    ctx.fillRect(x, y + mid - 1, C, 2);
    if ((r + c) % 2 === 0) {
      ctx.fillRect(x + Math.round(C / 2) - 1, y, 2, mid);
      ctx.fillRect(x + Math.round(C / 4) - 1, y + mid, 2, C - mid);
      ctx.fillRect(x + Math.round(C * 3 / 4) - 1, y + mid, 2, C - mid);
    } else {
      ctx.fillRect(x + Math.round(C / 4) - 1, y, 2, mid);
      ctx.fillRect(x + Math.round(C * 3 / 4) - 1, y, 2, mid);
      ctx.fillRect(x + Math.round(C / 2) - 1, y + mid, 2, C - mid);
    }
    // 左上亮棱 / 右下暗棱
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(x, y, C, 2);
    ctx.fillRect(x, y, 2, C);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(x + C - 2, y, 2, C);
    ctx.fillRect(x, y + C - 2, C, 2);
  },

  // ── 地板（棋盘格双色）──
  _drawFloor(ctx, x, y, C, r, c) {
    ctx.fillStyle = (r + c) % 2 === 0 ? C_FLOOR_A : C_FLOOR_B;
    ctx.fillRect(x, y, C, C);
  },

  // ── 目标点（呼吸发光圆点；箱子压住时只留微光）──
  _drawTarget(ctx, x, y, C, now, covered) {
    const cx = x + C / 2;
    const cy = y + C / 2;
    const pulse = 0.5 + Math.sin(now / 450) * 0.5;   // 0~1 呼吸
    if (covered) {
      ctx.fillStyle = 'rgba(245,200,66,0.10)';
      ctx.fillRect(x, y, C, C);
      return;
    }
    // 外圈光晕
    ctx.fillStyle = `rgba(92,135,201,${0.10 + pulse * 0.12})`;
    ctx.beginPath();
    ctx.arc(cx, cy, C * 0.34, 0, Math.PI * 2);
    ctx.fill();
    // 圆环
    ctx.strokeStyle = C_TARGET;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, C * 0.22, 0, Math.PI * 2);
    ctx.stroke();
    // 中心亮点
    ctx.fillStyle = `rgba(140,180,235,${0.35 + pulse * 0.5})`;
    ctx.beginPath();
    ctx.arc(cx, cy, C * (0.06 + pulse * 0.03), 0, Math.PI * 2);
    ctx.fill();
  },

  // ── 箱子（木板条纹 + 角钉；到位换金色打勾）──
  _drawBox(ctx, x, y, C, onTarget, now, scale) {
    const pad = Math.max(3, Math.round(C * 0.07));
    let bw = C - pad * 2;
    let bx = x + pad, by = y + pad;
    if (scale !== 1) {
      const grow = (bw * (scale - 1)) / 2;
      bx -= grow; by -= grow; bw += grow * 2;
    }

    if (onTarget) {
      // 通关时全体金箱脉动光晕
      if (this._winAt) {
        const glow = 0.10 + 0.10 * Math.abs(Math.sin((now - this._winAt) / 180));
        ctx.fillStyle = `rgba(245,200,66,${glow})`;
        ctx.fillRect(x - 4, y - 4, C + 8, C + 8);
      }
      ctx.fillStyle = C_DONE;
      ctx.fillRect(bx, by, bw, bw);
      ctx.fillStyle = C_DONE_D;
      const f = Math.max(2, Math.round(bw * 0.09));
      ctx.fillRect(bx, by, bw, f);
      ctx.fillRect(bx, by, f, bw);
      ctx.fillRect(bx + bw - f, by, f, bw);
      ctx.fillRect(bx, by + bw - f, bw, f);
      // 打勾
      ctx.strokeStyle = '#7A5B12';
      ctx.lineWidth = Math.max(2, Math.round(bw * 0.1));
      ctx.beginPath();
      ctx.moveTo(bx + bw * 0.26, by + bw * 0.52);
      ctx.lineTo(bx + bw * 0.44, by + bw * 0.70);
      ctx.lineTo(bx + bw * 0.76, by + bw * 0.32);
      ctx.stroke();
    } else {
      ctx.fillStyle = C_BOX;
      ctx.fillRect(bx, by, bw, bw);
      // 三条木板 + 顶部受光
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(bx, by + Math.round(bw / 3) - 1, bw, 2);
      ctx.fillRect(bx, by + Math.round(bw * 2 / 3) - 1, bw, 2);
      ctx.fillStyle = 'rgba(255,255,255,0.13)';
      ctx.fillRect(bx, by, bw, Math.max(2, Math.round(bw * 0.08)));
      // 外框
      ctx.fillStyle = C_BOX_D;
      const f = Math.max(2, Math.round(bw * 0.08));
      ctx.fillRect(bx, by, f, bw);
      ctx.fillRect(bx + bw - f, by, f, bw);
      // 四角铆钉
      ctx.fillStyle = C_BOX_S;
      const s = Math.max(2, Math.round(bw * 0.09));
      const o = f + 1;
      ctx.fillRect(bx + o, by + o, s, s);
      ctx.fillRect(bx + bw - o - s, by + o, s, s);
      ctx.fillRect(bx + o, by + bw - o - s, s, s);
      ctx.fillRect(bx + bw - o - s, by + bw - o - s, s, s);
    }
  },

  // ── 玩家（共享 Clawd 造型，带眨眼）──
  _drawPlayer(ctx, x, y, C, now) {
    let closed = false;
    if (now >= this._blinkAt) {
      if (now > this._blinkAt + 160) {
        this._blinkAt = now + 3000 + Math.random() * 1500;
      } else {
        closed = true;
      }
    }
    const ps = C / 28;
    drawClawd(ctx, x + (C - GRID_COLS * ps) / 2, y + (C - GRID_ROWS * ps) / 2, ps, { closed });
  },

  // ─── 音频（Web Audio 合成，不支持时静默降级）───────────
  _initAudio() {
    try {
      this._ac = wx.createWebAudioContext();
    } catch (e) {
      this._ac = null;
    }
  },

  _note(freq, startTime, dur, vol = 0.15, type = 'square') {
    if (!this._ac || freq === 0) return;
    const ac = this._ac;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.connect(g);
    g.connect(ac.destination);
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(vol, startTime);
    g.gain.exponentialRampToValueAtTime(0.001, startTime + dur * 0.88);
    osc.start(startTime);
    osc.stop(startTime + dur);
  },

  _sfxStep() {
    if (!this._ac) return;
    this._note(170, this._ac.currentTime, 0.04, 0.05, 'triangle');
  },

  _sfxPush() {
    if (!this._ac) return;
    this._note(110, this._ac.currentTime, 0.08, 0.13, 'square');
  },

  _sfxDing() {
    if (!this._ac) return;
    const now = this._ac.currentTime;
    this._note(880, now, 0.09, 0.16);
    this._note(1320, now + 0.06, 0.12, 0.12);
  },

  _sfxUndo() {
    if (!this._ac) return;
    const now = this._ac.currentTime;
    this._note(300, now, 0.06, 0.1, 'triangle');
    this._note(220, now + 0.05, 0.07, 0.1, 'triangle');
  },

  _sfxWin() {
    if (!this._ac) return;
    const now = this._ac.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => this._note(f, now + i * 0.1, 0.14, 0.18));
  },
});
