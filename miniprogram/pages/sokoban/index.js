// ─── 像素块参数（与跑酷角色一致）────────────────────────
const PSW = 4;   // 像素块宽
const PSH = 5;   // 像素块高

// ─── 8 关关卡数据 ───────────────────────────────────────
// '#' 墙  ' ' 地板  '@' 玩家  '$' 箱子  '.' 目标  '*' 箱=目标  '+' 玩家=目标
const LEVELS = [
  {
    name: 'Level 1',
    map: [
      '#####',
      '#@  #',
      '# $ #',
      '#  .#',
      '#####',
    ]
  },
  {
    name: 'Level 2',
    map: [
      '#######',
      '#@ .  #',
      '#  $  #',
      '#     #',
      '#######',
    ]
  },
  {
    name: 'Level 3',
    map: [
      '#######',
      '#  .  #',
      '#  $  #',
      '#  @  #',
      '#  $  #',
      '#  .  #',
      '#######',
    ]
  },
  {
    name: 'Level 4',
    map: [
      '#######',
      '#  #  #',
      '# $@$ #',
      '#     #',
      '# . . #',
      '#     #',
      '#######',
    ]
  },
  {
    name: 'Level 5',
    map: [
      '#########',
      '#   #   #',
      '# $ . $ #',
      '#   @   #',
      '# $ . $ #',
      '#   #   #',
      '#########',
    ]
  },
  {
    name: 'Level 6',
    map: [
      '#########',
      '# @ #   #',
      '# $ # $ #',
      '#   #   #',
      '# ..#   #',
      '#   $   #',
      '#    .  #',
      '#########',
    ]
  },
  {
    name: 'Level 7',
    map: [
      '##########',
      '#@  #    #',
      '#   # $  #',
      '# $ #  $ #',
      '#   . .  #',
      '# . #    #',
      '#   # $  #',
      '#   .    #',
      '##########',
    ]
  },
  {
    name: 'Level 8',
    map: [
      '##########',
      '#   ##   #',
      '# $ ## $ #',
      '#@ $  $  #',
      '#   ##   #',
      '# . ## . #',
      '#   ..   #',
      '#        #',
      '##########',
    ]
  },
];

// ─── 配色 ────────────────────────────────────────────────
const C_BG      = '#1A1A2E';
const C_FLOOR   = '#222240';
const C_WALL    = '#3A3A5C';
const C_WALL_D  = '#252545';  // 墙右/下暗边
const C_PLAYER  = '#E8873A';
const C_PLAYER_H= '#F5A855';
const C_PLAYER_D= '#C86820';
const C_BOX     = '#8B5E3C';
const C_BOX_H   = '#A0724A';
const C_BOX_D   = '#6A4428';
const C_TARGET  = '#4A6FA5';
const C_DONE    = '#F5C842';
const C_DONE_G  = 'rgba(245,200,66,0.18)';

Page({
  data: {
    gameState: 'playing',   // 'playing' | 'win'
    levelIndex: 0,
    steps: 0,
    isAllDone: false,
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

        this._loadLevel(0);
      });
  },

  onUnload() {
    this._stopWinAnim();
  },

  // ─── 触摸滑动手势 ─────────────────────────────────────
  noop() {},

  onTouchStart(e) {
    const t = e.touches[0];
    this._tx = t.clientX;
    this._ty = t.clientY;
  },

  onTouchEnd(e) {
    if (this.data.gameState !== 'playing') return;
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

  // ─── 撤销 ─────────────────────────────────────────────
  onUndo() {
    if (!this._history || !this._history.length) return;
    const prev = this._history.pop();
    this._map  = prev.map;
    this._px   = prev.px;
    this._py   = prev.py;
    this.setData({ steps: Math.max(0, this.data.steps - 1) });
    this._draw();
  },

  // ─── 通关按钮 ─────────────────────────────────────────
  onRestart() {
    this._loadLevel(this.data.levelIndex);
  },

  onNext() {
    const next = this.data.levelIndex + 1;
    if (next < LEVELS.length) {
      this._loadLevel(next);
    }
  },

  // ─── 关卡加载 ─────────────────────────────────────────
  _loadLevel(idx) {
    this._stopWinAnim();
    const level = LEVELS[idx];
    // 深拷贝地图（字符串数组 → 字符数组的二维数组）
    const map = level.map.map(row => row.split(''));

    // 找玩家初始位置
    let px = 0, py = 0;
    map.forEach((row, r) => row.forEach((c, col) => {
      if (c === '@' || c === '+') { px = col; py = r; }
    }));

    this._map     = map;
    this._px      = px;
    this._py      = py;
    this._history = [];
    this._winAnimFrame = null;

    // 计算格子大小（适配地图尺寸）
    const cols = map[0].length;
    const rows = map.length;
    const maxW = this._W;
    const maxH = this._H;
    this._cell  = Math.floor(Math.min(maxW / cols, maxH / rows));
    this._offX  = Math.round((this._W - cols * this._cell) / 2);
    this._offY  = Math.round((this._H - rows * this._cell) / 2);

    this.setData({ gameState: 'playing', levelIndex: idx, steps: 0, isAllDone: false });
    this._draw();
  },

  // ─── 移动逻辑 ─────────────────────────────────────────
  _move(dx, dy) {
    if (this.data.gameState !== 'playing') return;
    const map = this._map;
    const nx  = this._px + dx;
    const ny  = this._py + dy;

    if (!this._inBounds(nx, ny)) return;
    const target = map[ny][nx];

    if (target === '#') return;  // 墙

    // 保存历史（深拷贝）
    this._history.push({
      map: map.map(r => [...r]),
      px: this._px,
      py: this._py,
    });

    const isBox   = target === '$' || target === '*';
    if (isBox) {
      const bx = nx + dx;
      const by = ny + dy;
      if (!this._inBounds(bx, by)) { this._history.pop(); return; }
      const behind = map[by][bx];
      if (behind === '#' || behind === '$' || behind === '*') {
        this._history.pop(); return;
      }
      // 移动箱子
      map[by][bx] = (behind === '.') ? '*' : '$';
      map[ny][nx] = (target === '*') ? '.' : ' ';
    }

    // 移动玩家
    const curCell = map[this._py][this._px];
    map[this._py][this._px] = (curCell === '+') ? '.' : ' ';
    map[ny][nx] = (map[ny][nx] === '.') ? '+' : '@';
    this._px = nx;
    this._py = ny;

    this.setData({ steps: this.data.steps + 1 });
    this._draw();
    this._checkWin();
  },

  _inBounds(x, y) {
    return y >= 0 && y < this._map.length && x >= 0 && x < this._map[y].length;
  },

  _checkWin() {
    // 没有未放置的箱子 '$' 则通关
    const won = !this._map.some(row => row.includes('$'));
    if (!won) return;
    const isAllDone = this.data.levelIndex >= LEVELS.length - 1;
    this._startWinAnim();
    setTimeout(() => {
      this.setData({ gameState: 'win', isAllDone });
    }, 600);
  },

  // ─── 胜利闪光动画 ─────────────────────────────────────
  _startWinAnim() {
    this._winAnimT = 0;
    const tick = () => {
      this._winAnimT++;
      this._draw(true);
      this._winAnimFrame = this._canvas.requestAnimationFrame(tick);
    };
    this._winAnimFrame = this._canvas.requestAnimationFrame(tick);
  },

  _stopWinAnim() {
    if (this._winAnimFrame) {
      // WeChat canvas RAF 无法取消，用标志位
      this._winAnimFrame = null;
    }
    this._winAnimT = 0;
  },

  // ─── 绘制 ─────────────────────────────────────────────
  _draw(isWinAnim) {
    const { _ctx: ctx, _map: map, _cell: C, _offX: ox, _offY: oy } = this;
    if (!ctx || !map) return;

    // 清屏
    ctx.fillStyle = C_BG;
    ctx.fillRect(0, 0, this._W, this._H);

    // 遍历格子
    map.forEach((row, r) => {
      row.forEach((ch, c) => {
        const x = ox + c * C;
        const y = oy + r * C;
        this._drawCell(ctx, ch, x, y, C, isWinAnim);
      });
    });
  },

  _drawCell(ctx, ch, x, y, C, isWinAnim) {
    switch (ch) {
      case '#': this._drawWall(ctx, x, y, C);   break;
      case ' ': this._drawFloor(ctx, x, y, C);  break;
      case '.': this._drawTarget(ctx, x, y, C); break;
      case '@': this._drawFloor(ctx, x, y, C);  this._drawPlayer(ctx, x, y, C); break;
      case '+': this._drawTarget(ctx, x, y, C); this._drawPlayer(ctx, x, y, C); break;
      case '$': this._drawFloor(ctx, x, y, C);  this._drawBox(ctx, x, y, C, false, isWinAnim); break;
      case '*': this._drawTarget(ctx, x, y, C); this._drawBox(ctx, x, y, C, true, isWinAnim);  break;
    }
  },

  // ── 墙 ──
  _drawWall(ctx, x, y, C) {
    ctx.fillStyle = C_WALL;
    ctx.fillRect(x, y, C, C);
    // 右/下暗边（立体感）
    ctx.fillStyle = C_WALL_D;
    ctx.fillRect(x + C - 2, y, 2, C);
    ctx.fillRect(x, y + C - 2, C, 2);
    // 左/上亮边
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(x, y, C, 2);
    ctx.fillRect(x, y, 2, C);
  },

  // ── 地板 ──
  _drawFloor(ctx, x, y, C) {
    ctx.fillStyle = C_FLOOR;
    ctx.fillRect(x, y, C, C);
  },

  // ── 目标点（蓝色菱形轮廓）──
  _drawTarget(ctx, x, y, C) {
    this._drawFloor(ctx, x, y, C);
    const cx = x + C / 2;
    const cy = y + C / 2;
    const r  = C * 0.28;
    ctx.strokeStyle = C_TARGET;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx,     cy - r);
    ctx.lineTo(cx + r, cy    );
    ctx.lineTo(cx,     cy + r);
    ctx.lineTo(cx - r, cy    );
    ctx.closePath();
    ctx.stroke();
  },

  // ── 箱子 ──
  _drawBox(ctx, x, y, C, onTarget, isWinAnim) {
    const pad = 3;
    const bx  = x + pad;
    const by  = y + pad;
    const bw  = C - pad * 2;
    const bh  = C - pad * 2;

    if (onTarget) {
      // 到位：金黄色 + 可选光晕
      if (isWinAnim && this._winAnimT !== undefined) {
        const pulse = 0.12 + 0.08 * Math.sin(this._winAnimT * 0.2);
        ctx.fillStyle = `rgba(245,200,66,${pulse})`;
        ctx.fillRect(x - 4, y - 4, C + 8, C + 8);
      }
      ctx.fillStyle = C_DONE;
      ctx.fillRect(bx, by, bw, bh);
      // 十字纹高光
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(bx, by + bh / 2 - 1, bw, 2);
      ctx.fillRect(bx + bw / 2 - 1, by, 2, bh);
      // 暗边
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(bx + bw - 2, by, 2, bh);
      ctx.fillRect(bx, by + bh - 2, bw, 2);
    } else {
      // 未到位：木色
      ctx.fillStyle = C_BOX;
      ctx.fillRect(bx, by, bw, bh);
      // 高光
      ctx.fillStyle = C_BOX_H;
      ctx.fillRect(bx, by, bw, 3);
      ctx.fillRect(bx, by, 3, bh);
      // 十字纹
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      ctx.fillRect(bx, by + bh / 2 - 1, bw, 2);
      ctx.fillRect(bx + bw / 2 - 1, by, 2, bh);
      // 暗边
      ctx.fillStyle = C_BOX_D;
      ctx.fillRect(bx + bw - 3, by, 3, bh);
      ctx.fillRect(bx, by + bh - 3, bw, 3);
    }
  },

  // ── 玩家（复用跑酷角色像素参数）──
  _drawPlayer(ctx, x, y, C) {
    // 按格子大小缩放：格子可能比跑酷里的 PW=32 小
    const scale = C / 32;
    const pw = PSW * scale;
    const ph = PSH * scale;

    // 身体5列×4行，居中于格子
    const bodyW = 5 * pw;
    const bodyH = 4 * ph;
    const legH  = ph;
    const totalH = bodyH + legH;
    const bx = x + (C - bodyW) / 2;
    const by = y + (C - totalH) / 2;

    // 主体（橙色）
    ctx.fillStyle = C_PLAYER;
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 5; c++) {
        ctx.fillRect(bx + c * pw, by + r * ph, pw, ph);
      }
    }
    // 侧臂：row1-2 左右各凸1格
    ctx.fillRect(bx - pw,     by + 1 * ph, pw, 2 * ph);
    ctx.fillRect(bx + 5 * pw, by + 1 * ph, pw, 2 * ph);

    // 高光（左上角）
    ctx.fillStyle = C_PLAYER_H;
    [[0,0],[0,1],[1,0]].forEach(([r, c]) =>
      ctx.fillRect(bx + c * pw, by + r * ph, pw, ph));

    // 眼睛
    ctx.fillStyle = '#1A1A2E';
    [[1,1],[1,3]].forEach(([r, c]) =>
      ctx.fillRect(bx + c * pw + 1, by + r * ph + 1, pw - 2, ph - 2));

    // 腿
    ctx.fillStyle = C_PLAYER_D;
    ctx.fillRect(bx + 1 * pw, by + bodyH, pw, ph);
    ctx.fillRect(bx + 3 * pw, by + bodyH, pw, ph);
  },
});
