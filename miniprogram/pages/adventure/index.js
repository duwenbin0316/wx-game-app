// ─── Clawd 大冒险(横版平台闯关)─────────────────────────
// 原创致敬经典平台跳跃:奔跑/可变高度跳跃、踩扁 Bug、
// 顶砖块与问号块、咖啡护盾道具、终点旗杆,共 3 关。
// 手感:加速度移动 + 松键截断跳跃 + 土狼时间 + 跳跃缓冲。
const { GRID_COLS, GRID_ROWS, drawClawd } = require('../../utils/clawd');

const TILE = 24;
const ROWS = 14;
const PW = 18, PH = 20;        // 玩家碰撞盒
const CLAWD_PS = 0.75;

const GRAV = 0.5;
const MOVE_ACC = 0.38;
const MAX_VX = 2.9;
const FRICTION = 0.8;
const JUMP_V = -9.4;
const JUMP_CUT = -3.5;         // 松开跳跃键时的速度截断
const MAX_VY = 10;
const COYOTE = 6;              // 离台后仍可起跳的帧数
const BUFFER = 6;              // 落地前预按跳跃的缓冲帧
const ENEMY_VX = 0.6;
const INVULN = 90;
const STORAGE_KEY = 'adventure_best';

// 砖块字符 → 数字码:0 空 1 地面 2 硬块 3 砖 4 ?金币 5 ?咖啡 6 已用 7 水管
const TILE_CODE = { '#': 1, 'X': 2, 'B': 3, 'Q': 4, 'M': 5, 'P': 7 };

// ─── 关卡构建 DSL(避免手写长字符串出错)───────────────────
function buildMap(w, fn) {
  const g = Array.from({ length: ROWS }, () => Array(w).fill(' '));
  const set = (r, c, ch) => {
    if (r >= 0 && r < ROWS && c >= 0 && c < w) g[r][c] = ch;
  };
  fn({
    ground(a, b) { for (let c = a; c <= b; c++) { set(12, c, '#'); set(13, c, '#'); } },
    row(r, a, b, ch) { for (let c = a; c <= b; c++) set(r, c, ch); },
    put(r, c, ch) { set(r, c, ch); },
    pipe(c, hgt) { for (let i = 0; i < hgt; i++) set(11 - i, c, 'P'); },
    stairUp(c0, n) { for (let i = 0; i < n; i++) for (let k = 0; k <= i; k++) set(11 - k, c0 + i, 'X'); },
    stairDown(c0, n) { for (let i = 0; i < n; i++) for (let k = 0; k <= n - 1 - i; k++) set(11 - k, c0 + i, 'X'); },
    enemy(c) { set(11, c, 'g'); },
    coins(r, a, b) { for (let c = a; c <= b; c++) set(r, c, 'C'); },
    flag(c) { set(11, c, 'F'); },
  });
  return g.map(r => r.join(''));
}

const LEVELS = [
  // ── 第 1 关:平原教学 ──
  buildMap(130, h => {
    h.ground(0, 23); h.ground(26, 44); h.ground(47, 56);
    h.ground(60, 83); h.ground(87, 129);
    h.put(9, 12, 'Q');
    h.enemy(16); h.pipe(19, 2);
    h.put(9, 29, 'B'); h.put(9, 30, 'Q'); h.put(9, 31, 'B');
    h.enemy(35);
    h.row(9, 38, 41, 'X'); h.coins(8, 38, 41);
    h.stairUp(48, 4); h.stairDown(52, 4);
    h.enemy(63); h.enemy(65);
    h.row(9, 70, 74, 'B'); h.put(9, 72, 'M');
    h.pipe(78, 3);
    h.coins(8, 92, 96); h.enemy(93);
    h.stairUp(104, 4);
    h.flag(112);
  }),
  // ── 第 2 关:砖阵与水管 ──
  buildMap(150, h => {
    h.ground(0, 17); h.ground(21, 39); h.ground(43, 69);
    h.ground(74, 101); h.ground(105, 149);
    h.put(9, 8, 'Q'); h.put(9, 10, 'Q');
    h.enemy(13); h.pipe(16, 2);
    h.row(9, 24, 28, 'B'); h.put(9, 26, 'Q');
    h.enemy(25); h.enemy(27);
    h.row(5, 25, 27, 'B'); h.coins(4, 25, 27);
    h.pipe(33, 3); h.enemy(37);
    h.row(8, 45, 48, 'X'); h.coins(7, 45, 48);
    h.row(6, 51, 54, 'X'); h.coins(5, 51, 54);
    h.enemy(57); h.enemy(59); h.pipe(62, 2);
    h.put(9, 66, 'M');
    h.row(9, 76, 79, 'B'); h.put(9, 78, 'Q');
    h.enemy(82); h.enemy(84); h.enemy(86);
    h.pipe(90, 3);
    h.coins(8, 94, 99); h.enemy(96);
    h.put(9, 108, 'Q'); h.enemy(112); h.enemy(114);
    h.row(9, 118, 122, 'B'); h.coins(8, 118, 122);
    h.enemy(126); h.enemy(128);
    h.stairUp(132, 5);
    h.flag(140);
  }),
  // ── 第 3 关:断桥节奏跳 ──
  buildMap(160, h => {
    h.ground(0, 11); h.ground(15, 24); h.ground(28, 33);
    h.ground(37, 48); h.ground(52, 55); h.ground(59, 88);
    h.ground(92, 95); h.ground(99, 130); h.ground(134, 159);
    h.put(9, 6, 'Q'); h.enemy(8);
    h.enemy(19); h.enemy(21);
    h.put(9, 42, 'M'); h.enemy(44); h.pipe(46, 2);
    h.coins(8, 52, 55);
    h.enemy(62); h.enemy(64); h.enemy(66);
    h.row(9, 70, 73, 'B'); h.put(9, 71, 'Q'); h.put(9, 72, 'Q');
    h.row(5, 70, 73, 'B'); h.coins(4, 70, 73);
    h.pipe(78, 3); h.enemy(82); h.pipe(85, 2);
    h.coins(8, 92, 95); h.enemy(93);
    h.enemy(103); h.enemy(105); h.enemy(107); h.enemy(109);
    h.row(9, 113, 117, 'B'); h.put(9, 115, 'M');
    h.row(6, 120, 123, 'X'); h.coins(5, 120, 123);
    h.pipe(127, 3);
    h.stairUp(138, 6);
    h.flag(148);
  }),
];

Page({
  data: {
    gameState: 'idle',   // 'idle' | 'playing' | 'over' | 'clear'
    score: 0,
    best: 0,
    lives: 3,
    levelNum: 1,
    isNewBest: false,
  },

  onLoad() {
    this._best = wx.getStorageSync(STORAGE_KEY) || 0;
    this.setData({ best: this._best });
    this._initAudio();
  },

  onReady() {
    const info = wx.getSystemInfoSync();
    this._dpr = info.pixelRatio || 2;

    wx.createSelectorQuery()
      .select('#game-canvas')
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
        this._ctx = ctx;
        this._W = w;
        this._H = h;
        this._mapBottom = h - 8;              // 地图底边贴画布底
        this._initStars();
        this._loadLevel(0);
        this._startLoop();
      });
  },

  onShow() {
    if (this._canvas) {
      this._startLoop();
      if (this.data.gameState === 'playing') this._startBGM();
    }
  },

  onHide() {
    this._stopLoop();
    this._stopBGM();
  },

  onUnload() {
    this._stopLoop();
    this._stopBGM();
    if (this._wac) {
      try { this._wac.close(); } catch (e) {}
      this._wac = null;
    }
  },

  noop() {},

  onShareAppMessage() {
    const s = this.data.score || 0;
    return {
      title: s > 0
        ? `我在 Clawd 大冒险拿了 ${s} 分!来闯关～`
        : '像素横版闯关!踩扁 Bug 顶砖块,一起大冒险～',
      path: '/pages/adventure/index',
    };
  },

  // ── 开局 / 关卡加载 ─────────────────────────────────────
  onStart() {
    this._score = 0;
    this._coins = 0;
    this._lives = 3;
    this._shield = false;
    this._levelIdx = 0;
    this.setData({ gameState: 'playing', score: 0, lives: 3, levelNum: 1, isNewBest: false });
    this._loadLevel(0);
    this._startBGM();
  },

  onRetry() {
    this.onStart();
  },

  _loadLevel(idx) {
    this._levelIdx = idx;
    const rows = LEVELS[idx];
    this._mapW = rows[0].length;
    this._grid = [];
    this._enemies = [];
    this._coinList = [];
    this._items = [];
    this._flagCol = this._mapW - 5;

    for (let r = 0; r < ROWS; r++) {
      const line = [];
      for (let c = 0; c < this._mapW; c++) {
        const ch = rows[r][c];
        if (ch === 'g') {
          this._enemies.push({ x: c * TILE + 3, y: (r + 1) * TILE - 18, vx: -ENEMY_VX, w: 18, h: 18, alive: true, squash: 0, on: false });
          line.push(0);
        } else if (ch === 'C') {
          this._coinList.push({ c, r, taken: false });
          line.push(0);
        } else if (ch === 'F') {
          this._flagCol = c;
          line.push(0);
        } else {
          line.push(TILE_CODE[ch] || 0);
        }
      }
      this._grid.push(line);
    }

    this._player = {
      x: 2 * TILE + 3, y: 12 * TILE - PH,
      vx: 0, vy: 0,
      onGround: false, coyote: 0, buffer: 0, invuln: 0,
    };
    this._keys = { left: false, right: false, jumpHeld: false };
    this._cam = 0;
    this._frame = 0;
    this._dying = 0;
    this._winWalk = 0;
    this._bumps = [];
    this._parts = [];
    this._labels = [];
    this._coinFly = [];
    this._shake = 0;
    this._introT = 70;   // 关卡标题展示帧数
    this._addLabel(`LEVEL ${idx + 1}`, '#F5C842');
  },

  // ── 输入 ────────────────────────────────────────────────
  onLeftStart()  { this._keys.left = true; },
  onLeftEnd()    { this._keys.left = false; },
  onRightStart() { this._keys.right = true; },
  onRightEnd()   { this._keys.right = false; },
  onJumpStart()  { this._keys.jumpHeld = true; if (this._player) this._player.buffer = BUFFER; },
  onJumpEnd()    { this._keys.jumpHeld = false; },

  // ── 主循环 ──────────────────────────────────────────────
  _startLoop() {
    if (this._raf || !this._canvas) return;
    const step = () => {
      this._raf = this._canvas.requestAnimationFrame(step);
      this._update();
      this._draw();
    };
    this._raf = this._canvas.requestAnimationFrame(step);
  },

  _stopLoop() {
    if (this._raf && this._canvas) this._canvas.cancelAnimationFrame(this._raf);
    this._raf = null;
  },

  // ── 碰撞工具 ────────────────────────────────────────────
  _solid(c, r) {
    if (c < 0 || c >= this._mapW) return true;   // 左右边界墙
    if (r < 0 || r >= ROWS) return false;
    return this._grid[r][c] !== 0;
  },

  _update() {
    if (this.data.gameState !== 'playing') return;
    this._frame++;
    if (this._introT > 0) this._introT--;

    if (this._dying > 0) {
      this._updateDying();
      return;
    }

    const p = this._player;
    const k = this._keys;

    // ── 横向移动:加速度 + 摩擦 ──
    if (this._winWalk > 0) {
      p.vx = 1.5;   // 过关演出:自动向右走
    } else {
      if (k.left)  p.vx -= MOVE_ACC;
      if (k.right) p.vx += MOVE_ACC;
      if (!k.left && !k.right && p.onGround) p.vx *= FRICTION;
      if (Math.abs(p.vx) < 0.05) p.vx = 0;
      p.vx = Math.max(-MAX_VX, Math.min(MAX_VX, p.vx));
    }

    // X 轴位移与碰撞
    p.x += p.vx;
    this._collideX(p);

    // ── 跳跃:土狼时间 + 缓冲 + 松键截断 ──
    if (p.onGround) p.coyote = COYOTE;
    else if (p.coyote > 0) p.coyote--;
    if (p.buffer > 0) {
      p.buffer--;
      if ((p.onGround || p.coyote > 0) && this._winWalk === 0) {
        p.vy = JUMP_V;
        p.onGround = false;
        p.coyote = 0;
        p.buffer = 0;
        this._sfxJump();
      }
    }
    if (!k.jumpHeld && p.vy < JUMP_CUT) p.vy = JUMP_CUT;

    // Y 轴位移与碰撞
    p.vy = Math.min(MAX_VY, p.vy + GRAV);
    p.y += p.vy;
    this._collideY(p);

    if (p.invuln > 0) p.invuln--;

    // 掉坑
    if (p.y > ROWS * TILE + 40) {
      this._die();
      return;
    }

    // ── 敌人 ──
    const camR = this._cam + this._W + 80;
    for (const e of this._enemies) {
      if (!e.alive) continue;
      if (!e.on) {
        if (e.x < camR) e.on = true;
        else continue;
      }
      if (e.squash > 0) {
        if (--e.squash === 0) e.alive = false;
        continue;
      }
      e.x += e.vx;
      // 撞墙折返
      const er = Math.floor((e.y + e.h - 1) / TILE);
      const headC = e.vx < 0 ? Math.floor(e.x / TILE) : Math.floor((e.x + e.w) / TILE);
      if (this._solid(headC, er) || this._solid(headC, er - 1)) {
        e.vx = -e.vx;
        e.x += e.vx * 2;
      }
      // 重力与落地
      e.vy = (e.vy || 0) + GRAV;
      e.y += e.vy;
      const fc1 = Math.floor((e.x + 2) / TILE);
      const fc2 = Math.floor((e.x + e.w - 2) / TILE);
      const fr = Math.floor((e.y + e.h) / TILE);
      if (e.vy > 0 && (this._solid(fc1, fr) || this._solid(fc2, fr))) {
        e.y = fr * TILE - e.h;
        e.vy = 0;
      }
      if (e.y > ROWS * TILE + 60) { e.alive = false; continue; }

      // 与玩家碰撞
      if (p.invuln <= 0 && this._winWalk === 0 &&
          p.x < e.x + e.w - 3 && p.x + PW > e.x + 3 &&
          p.y < e.y + e.h - 2 && p.y + PH > e.y + 2) {
        if (p.vy > 1.5 && p.y + PH - e.y < 12) {
          // 踩扁
          e.squash = 18;
          p.vy = -6.5;
          this._addScore(200);
          this._addLabel('+200', '#C0C0E8', e.x + e.w / 2, e.y);
          this._sfxStomp();
        } else {
          this._hurt();
          if (this._dying > 0) return;
        }
      }
    }

    // ── 金币 ──
    for (const c of this._coinList) {
      if (c.taken) continue;
      const cx = c.c * TILE + TILE / 2, cy = c.r * TILE + TILE / 2;
      if (Math.abs(p.x + PW / 2 - cx) < 16 && Math.abs(p.y + PH / 2 - cy) < 18) {
        c.taken = true;
        this._collectCoin(cx, cy);
      }
    }

    // ── 咖啡道具 ──
    this._items = this._items.filter(it => {
      if (Math.abs(p.x + PW / 2 - it.x) < 18 && Math.abs(p.y + PH / 2 - it.y) < 20) {
        if (this._shield) {
          this._addScore(500);
          this._addLabel('+500', '#60C0FF', it.x, it.y - 10);
        } else {
          this._shield = true;
          this._addLabel('咖啡护盾!', '#60C0FF');
        }
        this._sfxPower();
        return false;
      }
      return true;
    });

    // ── 终点旗杆 ──
    if (this._winWalk === 0 && p.x + PW >= this._flagCol * TILE + 6) {
      this._winWalk = 70;
      this._addScore(1000);
      this._addLabel('过关!', '#F5C842');
      this._stopBGM();
      this._sfxWin();
    }
    if (this._winWalk > 0 && --this._winWalk === 0) {
      if (this._levelIdx + 1 < LEVELS.length) {
        this._loadLevel(this._levelIdx + 1);
        this.setData({ levelNum: this._levelIdx + 1 });
        this._startBGM();
      } else {
        this._allClear();
      }
      return;
    }

    // 相机
    const target = Math.max(0, Math.min(p.x - this._W * 0.38, this._mapW * TILE - this._W));
    this._cam += (target - this._cam) * 0.18;

    // 特效衰减
    this._bumps = this._bumps.filter(b => ++b.t < 12);
    this._parts = this._parts.filter(pt => {
      pt.x += pt.vx; pt.y += pt.vy; pt.vy += 0.3;
      return --pt.life > 0;
    });
    this._coinFly = this._coinFly.filter(cf => {
      cf.y += cf.vy; cf.vy += 0.4;
      return ++cf.t < 26;
    });
    this._labels = this._labels.filter(lb => ++lb.f < 55);
  },

  _collideX(p) {
    const top = Math.floor(p.y / TILE);
    const bot = Math.floor((p.y + PH - 1) / TILE);
    if (p.vx > 0) {
      const c = Math.floor((p.x + PW) / TILE);
      for (let r = top; r <= bot; r++) {
        if (this._solid(c, r)) { p.x = c * TILE - PW - 0.01; p.vx = 0; break; }
      }
    } else if (p.vx < 0) {
      const c = Math.floor(p.x / TILE);
      for (let r = top; r <= bot; r++) {
        if (this._solid(c, r)) { p.x = (c + 1) * TILE + 0.01; p.vx = 0; break; }
      }
    }
  },

  _collideY(p) {
    const l = Math.floor((p.x + 2) / TILE);
    const rr = Math.floor((p.x + PW - 2) / TILE);
    p.onGround = false;
    if (p.vy > 0) {
      const r = Math.floor((p.y + PH) / TILE);
      for (let c = l; c <= rr; c++) {
        if (this._solid(c, r)) {
          p.y = r * TILE - PH;
          p.vy = 0;
          p.onGround = true;
          break;
        }
      }
    } else if (p.vy < 0) {
      const r = Math.floor(p.y / TILE);
      let hitC = -1, best = 1e9;
      for (let c = l; c <= rr; c++) {
        if (this._solid(c, r)) {
          const d = Math.abs((c + 0.5) * TILE - (p.x + PW / 2));
          if (d < best) { best = d; hitC = c; }
        }
      }
      if (hitC >= 0) {
        p.y = (r + 1) * TILE;
        p.vy = 0;
        this._hitBlock(hitC, r);
      }
    }
  },

  // 顶砖:问号块出金币/咖啡,砖块带盾可击碎
  _hitBlock(c, r) {
    const t = this._grid[r][c];
    if (t === 4) {
      this._grid[r][c] = 6;
      this._coinFly.push({ x: c * TILE + TILE / 2, y: r * TILE - 6, vy: -6, t: 0 });
      this._collectCoin(c * TILE + TILE / 2, r * TILE, true);
      this._bumps.push({ c, r, t: 0 });
    } else if (t === 5) {
      this._grid[r][c] = 6;
      this._items.push({ x: c * TILE + TILE / 2, y: r * TILE - TILE / 2 - 2 });
      this._bumps.push({ c, r, t: 0 });
      this._sfxBump();
    } else if (t === 3) {
      if (this._shield) {
        this._grid[r][c] = 0;
        this._addScore(50);
        for (let i = 0; i < 6; i++) {
          this._parts.push({
            x: c * TILE + TILE / 2, y: r * TILE + TILE / 2,
            vx: (Math.random() - 0.5) * 4, vy: -Math.random() * 4 - 1,
            life: 24, color: '#C97050', sz: 4,
          });
        }
        this._sfxBreak();
      } else {
        this._bumps.push({ c, r, t: 0 });
        this._sfxBump();
      }
    } else {
      this._sfxBump();
    }
  },

  _collectCoin(x, y, fromBlock) {
    this._coins++;
    this._addScore(100);
    if (!fromBlock) this._addLabel('+100', '#F5C842', x, y - 8);
    this._sfxCoin();
  },

  _addScore(n) {
    this._score += n;
    this.setData({ score: this._score });
  },

  _addLabel(text, color, x, y) {
    this._labels.push({ text, color, x, y, f: 0 });
    if (this._labels.length > 4) this._labels.shift();
  },

  // ── 受伤 / 死亡 / 结算 ──────────────────────────────────
  _hurt() {
    if (this._shield) {
      this._shield = false;
      this._player.invuln = INVULN;
      this._shake = 4;
      this._addLabel('护盾抵挡!', '#60C0FF');
      this._sfxHurt();
    } else {
      this._die();
    }
  },

  _die() {
    if (this._dying > 0) return;
    this._dying = 1;
    this._player.vy = -8;
    this._shake = 5;
    this._stopBGM();
    this._sfxDie();
  },

  _updateDying() {
    this._dying++;
    const p = this._player;
    p.vy = Math.min(MAX_VY, p.vy + GRAV);
    p.y += p.vy;
    this._parts = this._parts.filter(pt => {
      pt.x += pt.vx; pt.y += pt.vy; pt.vy += 0.3;
      return --pt.life > 0;
    });
    this._labels = this._labels.filter(lb => ++lb.f < 55);
    if (this._dying > 65) {
      this._lives--;
      this.setData({ lives: this._lives });
      this._shield = false;
      if (this._lives > 0) {
        this._loadLevel(this._levelIdx);
        this._startBGM();
      } else {
        this._gameOver();
      }
    }
  },

  _gameOver() {
    const isNewBest = this._score > this._best;
    if (isNewBest) {
      this._best = this._score;
      wx.setStorageSync(STORAGE_KEY, this._best);
    }
    this.setData({ gameState: 'over', score: this._score, best: this._best, isNewBest });
  },

  _allClear() {
    this._addScore(2000);
    const isNewBest = this._score > this._best;
    if (isNewBest) {
      this._best = this._score;
      wx.setStorageSync(STORAGE_KEY, this._best);
    }
    this._stopBGM();
    this.setData({ gameState: 'clear', score: this._score, best: this._best, isNewBest });
  },

  // ── 渲染 ────────────────────────────────────────────────
  _draw() {
    const ctx = this._ctx;
    if (!ctx) return;
    const W = this._W, H = this._H;
    const offY = H - ROWS * TILE;    // 地图底对齐画布底
    const cam = Math.round(this._cam);

    ctx.save();
    if (this._shake > 0.3) {
      ctx.translate((Math.random() * 2 - 1) * this._shake, (Math.random() * 2 - 1) * this._shake);
      this._shake *= 0.86;
    }

    // 天空 + 星星(慢视差)+ 月亮
    ctx.fillStyle = '#1A1A2E';
    ctx.fillRect(-10, -10, W + 20, H + 20);
    ctx.fillStyle = '#5A5A8A';
    for (const s of (this._stars || [])) {
      const sx = ((s.x - cam * 0.12) % (W + 20) + W + 20) % (W + 20) - 10;
      ctx.fillRect(sx, s.y, s.sz, s.sz);
    }
    ctx.fillStyle = 'rgba(184, 204, 232, 0.85)';
    ctx.beginPath();
    ctx.arc(W - 52, 48, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1A1A2E';
    ctx.beginPath();
    ctx.arc(W - 44, 44, 16, 0, Math.PI * 2);
    ctx.fill();

    // 瓦片
    const c0 = Math.max(0, Math.floor(cam / TILE) - 1);
    const c1 = Math.min(this._mapW - 1, Math.ceil((cam + W) / TILE) + 1);
    for (let r = 0; r < ROWS; r++) {
      for (let c = c0; c <= c1; c++) {
        const t = this._grid[r][c];
        if (!t) continue;
        let by = offY + r * TILE;
        const bump = this._bumps.find(b => b.c === c && b.r === r);
        if (bump) by -= Math.round(5 * Math.sin((bump.t / 12) * Math.PI));
        this._drawTile(ctx, c * TILE - cam, by, t, r, c);
      }
    }

    // 旗杆
    this._drawFlag(ctx, this._flagCol * TILE - cam + TILE / 2, offY);

    // 金币
    for (const c of this._coinList) {
      if (c.taken) continue;
      this._drawCoin(ctx, c.c * TILE - cam + TILE / 2, offY + c.r * TILE + TILE / 2);
    }
    for (const cf of this._coinFly) {
      this._drawCoin(ctx, cf.x - cam, offY + cf.y);
    }

    // 咖啡道具
    for (const it of this._items) {
      this._drawCup(ctx, it.x - cam, offY + it.y);
    }

    // 敌人
    for (const e of this._enemies) {
      if (!e.alive) continue;
      this._drawEnemy(ctx, e.x - cam, offY + e.y, e);
    }

    // 玩家(无敌闪烁 + 护盾光环)
    const p = this._player;
    const blink = p.invuln > 0 && Math.floor(this._frame / 4) % 2 === 0;
    if (!blink) {
      const cw = GRID_COLS * CLAWD_PS;
      const chh = GRID_ROWS * CLAWD_PS;
      const airborne = !p.onGround;
      const step = Math.floor(this._frame / 5) % 2;
      const moving = Math.abs(p.vx) > 0.3;
      drawClawd(
        ctx,
        p.x - cam + (PW - cw) / 2,
        offY + p.y + PH - chh,
        CLAWD_PS,
        { legFrame: airborne ? 'all' : (moving ? step : 0) }
      );
    }
    if (this._shield && this._dying === 0) {
      const pulse = 0.35 + 0.2 * Math.sin(this._frame / 8);
      ctx.strokeStyle = `rgba(96, 192, 255, ${pulse})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x - cam + PW / 2, offY + p.y + PH / 2, 20, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 粒子
    for (const pt of this._parts) {
      ctx.fillStyle = pt.color;
      ctx.globalAlpha = Math.min(1, pt.life / 10);
      ctx.fillRect(pt.x - cam, offY + pt.y, pt.sz, pt.sz);
    }
    ctx.globalAlpha = 1;

    // 浮字(带坐标的跟世界,不带的居中)
    for (const lb of this._labels) {
      const a = lb.f < 6 ? lb.f / 6 : 1 - Math.max(0, lb.f - 30) / 25;
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = lb.color;
      ctx.textAlign = 'center';
      if (lb.x !== undefined) {
        ctx.font = 'bold 12px monospace';
        ctx.fillText(lb.text, lb.x - cam, offY + lb.y - lb.f * 0.6);
      } else {
        ctx.font = 'bold 24px monospace';
        ctx.fillText(lb.text, W / 2, H * 0.3 - lb.f * 0.4);
      }
    }
    ctx.globalAlpha = 1;

    // HUD
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`SCORE ${String(this._score || 0).padStart(6, '0')}`, 12, 24);
    ctx.fillStyle = '#F5C842';
    ctx.fillText(`◆×${this._coins || 0}`, 12, 42);
    ctx.fillStyle = '#FF6B6B';
    ctx.fillText(`♥×${this._lives !== undefined ? this._lives : 3}`, 80, 42);
    ctx.fillStyle = '#4A6FA5';
    ctx.fillText(`L${(this._levelIdx || 0) + 1}`, 140, 42);
    if (this._shield) {
      ctx.fillText('☕', 170, 42);
    }

    ctx.restore();
  },

  _drawTile(ctx, x, y, t, r, c) {
    if (t === 1) {
      // 地面:顶行草边,下层泥土
      const topSoil = r === 0 || this._grid[r - 1][c] === 0;
      ctx.fillStyle = topSoil ? '#7A4432' : '#5E3526';
      ctx.fillRect(x, y, TILE, TILE);
      if (topSoil) {
        ctx.fillStyle = '#4CAF50';
        ctx.fillRect(x, y, TILE, 5);
        ctx.fillStyle = '#66C76A';
        ctx.fillRect(x, y, TILE, 2);
      }
      ctx.fillStyle = 'rgba(10,10,26,0.25)';
      ctx.fillRect(x, y + TILE - 2, TILE, 2);
    } else if (t === 2) {
      ctx.fillStyle = '#8A8AA5';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#A5A5C0';
      ctx.fillRect(x, y, TILE, 3);
      ctx.fillRect(x, y, 3, TILE);
      ctx.fillStyle = '#5A5A75';
      ctx.fillRect(x + TILE - 3, y, 3, TILE);
      ctx.fillRect(x, y + TILE - 3, TILE, 3);
    } else if (t === 3) {
      ctx.fillStyle = '#C97050';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#8A4432';
      ctx.fillRect(x, y + 11, TILE, 2);
      ctx.fillRect(x + 11, y, 2, 11);
      ctx.fillRect(x + 5, y + 13, 2, 11);
      ctx.fillRect(x + 17, y + 13, 2, 11);
      ctx.strokeStyle = 'rgba(10,10,26,0.4)';
      ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
    } else if (t === 4 || t === 5) {
      const pulse = 0.75 + 0.25 * Math.sin(this._frame / 12);
      ctx.fillStyle = `rgba(245, 200, 66, ${pulse})`;
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#FFEB8A';
      ctx.fillRect(x, y, TILE, 3);
      ctx.fillRect(x, y, 3, TILE);
      ctx.fillStyle = '#B8860B';
      ctx.fillRect(x + TILE - 3, y, 3, TILE);
      ctx.fillRect(x, y + TILE - 3, TILE, 3);
      ctx.fillStyle = '#1A1A2E';
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('?', x + TILE / 2, y + TILE / 2 + 5);
    } else if (t === 6) {
      ctx.fillStyle = '#55556E';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.strokeStyle = 'rgba(10,10,26,0.4)';
      ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
    } else if (t === 7) {
      // 水管:上方非水管则画管口
      const cap = r === 0 || this._grid[r - 1][c] !== 7;
      ctx.fillStyle = '#3A9A5A';
      ctx.fillRect(x + 2, y, TILE - 4, TILE);
      ctx.fillStyle = '#66C76A';
      ctx.fillRect(x + 2, y, 4, TILE);
      if (cap) {
        ctx.fillStyle = '#3A9A5A';
        ctx.fillRect(x, y, TILE, 8);
        ctx.fillStyle = '#66C76A';
        ctx.fillRect(x, y, TILE, 3);
        ctx.fillStyle = 'rgba(10,10,26,0.3)';
        ctx.fillRect(x, y + 6, TILE, 2);
      }
    }
  },

  _drawFlag(ctx, x, offY) {
    const topY = offY + 4 * TILE;
    const baseY = offY + 12 * TILE;
    ctx.fillStyle = '#C0C0E8';
    ctx.fillRect(x - 2, topY, 4, baseY - topY);
    ctx.fillStyle = '#F5C842';
    ctx.beginPath();
    ctx.arc(x, topY - 3, 5, 0, Math.PI * 2);
    ctx.fill();
    // 旗面飘动
    const wave = Math.sin(this._frame / 10) * 2;
    ctx.fillStyle = '#D97757';
    ctx.beginPath();
    ctx.moveTo(x + 2, topY + 2);
    ctx.lineTo(x + 24 + wave, topY + 9);
    ctx.lineTo(x + 2, topY + 16);
    ctx.closePath();
    ctx.fill();
  },

  _drawCoin(ctx, cx, cy) {
    const ph = Math.abs(Math.sin(this._frame / 8 + cx * 0.02));
    const hw = 5 * (0.3 + 0.7 * ph);
    ctx.fillStyle = '#F5C842';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 7);
    ctx.lineTo(cx + hw, cy);
    ctx.lineTo(cx, cy + 7);
    ctx.lineTo(cx - hw, cy);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#FFEB8A';
    ctx.fillRect(cx - 1, cy - 3, 2, 6);
  },

  _drawCup(ctx, x, y) {
    const s = 2;
    const px = x - 7;
    const py = y - 8;
    ctx.fillStyle = '#F0F0F5';
    ctx.fillRect(px, py + 3 * s, 6 * s, 4 * s);
    ctx.fillRect(px + 6 * s, py + 3 * s, s, s);
    ctx.fillRect(px + 7 * s, py + 4 * s, s, s);
    ctx.fillRect(px + 6 * s, py + 5 * s, s, s);
    ctx.fillStyle = '#8A5A3A';
    ctx.fillRect(px + s, py + 3 * s, 4 * s, s);
    ctx.fillStyle = '#C8C8D8';
    ctx.fillRect(px - s, py + 7 * s, 8 * s, s);
  },

  _drawEnemy(ctx, x, y, e) {
    const S = 3;
    const squashed = e.squash > 0;
    const bx = x - 1;
    const by = squashed ? y + 8 : y;
    ctx.fillStyle = squashed ? '#8A4444' : '#FF6B6B';
    const rows = squashed ? [[2, 0, 5], [3, 0, 5]] : null;
    if (squashed) {
      rows.forEach(([r, a, b]) => {
        for (let c = a; c <= b; c++) ctx.fillRect(bx + c * S, by + (r - 2) * S, S, S);
      });
      return;
    }
    // 复用 Bug 像素造型,走路时左右腿交替
    const step = Math.floor(this._frame / 8) % 2;
    const BUG = [
      [0, 1], [0, 4],
      [1, 1], [1, 2], [1, 3], [1, 4],
      [2, 0], [2, 1], [2, 2], [2, 3], [2, 4], [2, 5],
      [3, 0], [3, 1], [3, 2], [3, 3], [3, 4], [3, 5],
    ];
    const LEGS = step === 0 ? [[4, 0], [4, 3], [4, 5]] : [[4, 0], [4, 2], [4, 5]];
    BUG.concat(LEGS).forEach(([r, c]) => {
      ctx.fillRect(bx + c * S, by + r * S, S, S);
    });
    ctx.fillStyle = '#FFB3B3';
    [[1, 2], [1, 3]].forEach(([r, c]) => {
      ctx.fillRect(bx + c * S, by + r * S, S, S);
    });
  },

  _initStars() {
    this._stars = Array.from({ length: 36 }, () => ({
      x: Math.random() * this._W,
      y: Math.random() * this._H * 0.5,
      sz: Math.random() < 0.2 ? 2 : 1,
    }));
  },

  // ── 音频(Web Audio 合成)─────────────────────────────────
  _initAudio() {
    try {
      this._wac = wx.createWebAudioContext();
      this._bgmGain = null;
    } catch (e) {
      this._wac = null;
    }
    this._bgmOn = false;
    this._bgmTimer = null;
  },

  _note(freq, start, dur, vol, type, useBgm) {
    if (!this._wac || !freq) return;
    try {
      const osc = this._wac.createOscillator();
      const g = this._wac.createGain();
      osc.type = type || 'square';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(vol, start);
      g.gain.exponentialRampToValueAtTime(0.001, start + dur);
      osc.connect(g);
      g.connect(useBgm && this._bgmGain ? this._bgmGain : this._wac.destination);
      osc.start(start);
      osc.stop(start + dur);
    } catch (e) {}
  },

  // BGM:原创欢快大调小循环,两段乐句交替
  _scheduleBGM() {
    if (!this._wac || !this._bgmOn) return;
    const now = this._wac.currentTime + 0.05;
    const S = 60 / 152 * 0.5;
    const phraseB = (this._bgmBar = (this._bgmBar || 0) + 1) % 2 === 0;
    const mel = phraseB
      ? [784, 659, 587, 659, 784, 880, 784, 659, 587, 523, 587, 659, 587, 523, 440, 0]
      : [523, 659, 784, 659, 880, 784, 659, 523, 587, 659, 587, 523, 440, 523, 587, 0];
    const bas = phraseB
      ? [392, 0, 392, 0, 349, 0, 349, 0, 330, 0, 330, 0, 262, 0, 262, 0]
      : [262, 0, 262, 0, 330, 0, 330, 0, 349, 0, 349, 0, 392, 0, 392, 0];
    mel.forEach((f, i) => this._note(f, now + i * S, S * 0.8, 0.11, 'square', true));
    bas.forEach((f, i) => this._note(f, now + i * S, S * 0.6, 0.08, 'triangle', true));
    this._bgmTimer = setTimeout(() => this._scheduleBGM(), mel.length * S * 1000 - 80);
  },

  _startBGM() {
    if (!this._wac || this._bgmOn) return;
    this._bgmGain = this._wac.createGain();
    this._bgmGain.connect(this._wac.destination);
    this._bgmOn = true;
    this._scheduleBGM();
  },

  _stopBGM() {
    this._bgmOn = false;
    if (this._bgmTimer) { clearTimeout(this._bgmTimer); this._bgmTimer = null; }
    if (this._bgmGain) {
      try { this._bgmGain.disconnect(); } catch (e) {}
      this._bgmGain = null;
    }
  },

  _sfxJump() {
    if (!this._wac) return;
    try {
      const now = this._wac.currentTime;
      const osc = this._wac.createOscillator();
      const g = this._wac.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(180, now);
      osc.frequency.exponentialRampToValueAtTime(700, now + 0.1);
      g.gain.setValueAtTime(0.2, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.connect(g);
      g.connect(this._wac.destination);
      osc.start(now);
      osc.stop(now + 0.12);
    } catch (e) {}
  },

  _sfxCoin() {
    if (!this._wac) return;
    const now = this._wac.currentTime;
    this._note(1319, now, 0.05, 0.13);
    this._note(1568, now + 0.05, 0.09, 0.13);
  },

  _sfxStomp() {
    if (!this._wac) return;
    const now = this._wac.currentTime;
    this._note(220, now, 0.06, 0.18);
    this._note(140, now + 0.04, 0.07, 0.14);
  },

  _sfxBump() {
    if (!this._wac) return;
    this._note(120, this._wac.currentTime, 0.06, 0.16, 'triangle');
  },

  _sfxBreak() {
    if (!this._wac) return;
    const now = this._wac.currentTime;
    this._note(160, now, 0.05, 0.15, 'sawtooth');
    this._note(110, now + 0.04, 0.06, 0.12, 'sawtooth');
  },

  _sfxPower() {
    if (!this._wac) return;
    const now = this._wac.currentTime;
    [523, 659, 784, 1046].forEach((f, i) => this._note(f, now + i * 0.06, 0.08, 0.14));
  },

  _sfxHurt() {
    if (!this._wac) return;
    try {
      const now = this._wac.currentTime;
      const osc = this._wac.createOscillator();
      const g = this._wac.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(360, now);
      osc.frequency.exponentialRampToValueAtTime(90, now + 0.18);
      g.gain.setValueAtTime(0.2, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.connect(g);
      g.connect(this._wac.destination);
      osc.start(now);
      osc.stop(now + 0.2);
    } catch (e) {}
  },

  _sfxDie() {
    if (!this._wac) return;
    const now = this._wac.currentTime;
    [523, 392, 330, 262, 196].forEach((f, i) => this._note(f, now + i * 0.12, 0.14, 0.18));
  },

  _sfxWin() {
    if (!this._wac) return;
    const now = this._wac.currentTime;
    [523, 659, 784, 1046, 1319].forEach((f, i) => this._note(f, now + i * 0.09, 0.14, 0.16));
  },
});
