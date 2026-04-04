const BOARD_COLS = 10;
const BOARD_ROWS = 20;
const PREVIEW_GRID = 4;
const BASE_GRAVITY = 800;
const LEVEL_GRAVITY_STEP = 80;
const MIN_GRAVITY = 100;
const STORAGE_KEY = 'tetris_best';

const COLORS = {
  bg: '#1A1A2E',
  grid: '#2E3A5C',
  accent: '#E8873A',
  shadow: '#0A0A1A',
  previewBg: '#0A0A1A'
};

const LINE_SCORES = {
  1: 100,
  2: 300,
  3: 500,
  4: 800
};

const TETROMINOES = {
  I: {
    color: '#60C0FF',
    rotations: [
      [[0, -1], [0, 0], [0, 1], [0, 2]],
      [[-1, 1], [0, 1], [1, 1], [2, 1]],
      [[1, -1], [1, 0], [1, 1], [1, 2]],
      [[-1, 0], [0, 0], [1, 0], [2, 0]]
    ]
  },
  O: {
    color: '#E8873A',
    rotations: [
      [[0, 0], [0, 1], [1, 0], [1, 1]],
      [[0, 0], [0, 1], [1, 0], [1, 1]],
      [[0, 0], [0, 1], [1, 0], [1, 1]],
      [[0, 0], [0, 1], [1, 0], [1, 1]]
    ]
  },
  T: {
    color: '#A855F7',
    rotations: [
      [[-1, 0], [0, -1], [0, 0], [0, 1]],   // N spawn: .T. / TTT
      [[-1, 0], [0, 0], [0, 1], [1, 0]],    // E: .T. / .TT / .T.
      [[0, -1], [0, 0], [0, 1], [1, 0]],    // S: TTT / .T.
      [[-1, 0], [0, -1], [0, 0], [1, 0]]    // W: .T. / TT. / .T.
    ]
  },
  S: {
    color: '#4CAF50',
    rotations: [
      [[-1, 0], [-1, 1], [0, -1], [0, 0]],  // N spawn: .SS / SS.
      [[-1, 0], [0, 0], [0, 1], [1, 1]],    // E: S. / SS / .S
      [[-1, 0], [-1, 1], [0, -1], [0, 0]],  // S = N
      [[-1, 0], [0, 0], [0, 1], [1, 1]]     // W = E
    ]
  },
  Z: {
    color: '#FF6B6B',
    rotations: [
      [[-1, -1], [-1, 0], [0, 0], [0, 1]],  // N spawn: ZZ. / .ZZ
      [[-1, 1], [0, 0], [0, 1], [1, 0]],    // E: .Z / ZZ / Z.
      [[-1, -1], [-1, 0], [0, 0], [0, 1]],  // S = N
      [[-1, 1], [0, 0], [0, 1], [1, 0]]     // W = E
    ]
  },
  J: {
    color: '#4A6FA5',
    rotations: [
      [[-1, -1], [0, -1], [0, 0], [0, 1]],  // N spawn: J.. / JJJ
      [[-1, 0], [-1, 1], [0, 0], [1, 0]],   // E: JJ / J. / J.
      [[0, -1], [0, 0], [0, 1], [1, 1]],    // S: JJJ / ..J
      [[-1, 0], [0, 0], [1, -1], [1, 0]]    // W: .J / .J / JJ
    ]
  },
  L: {
    color: '#F5C842',
    rotations: [
      [[-1, 1], [0, -1], [0, 0], [0, 1]],   // N spawn: ..L / LLL
      [[-1, 0], [0, 0], [1, 0], [1, 1]],    // E: L. / L. / LL
      [[0, -1], [0, 0], [0, 1], [1, -1]],   // S: LLL / L..
      [[-1, -1], [-1, 0], [0, 0], [1, 0]]   // W: LL / .L / .L
    ]
  }
};

const PIECE_TYPES = Object.keys(TETROMINOES);

function createEmptyBoard() {
  return Array.from({ length: BOARD_ROWS }, () => Array(BOARD_COLS).fill(''));
}

function shuffle(list) {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function clampChannel(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
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
    gameState: 'playing',
    isNewBest: false,
    holdPiece: '--',
    holdClass: 'hold-empty',
    muted: false,
  },

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
    query.exec(res => {
      if (!res || !res[0] || !res[1] || !res[0].node || !res[1].node) return;

      const boardNode = res[0].node;
      const boardWidth = res[0].width;
      const boardHeight = res[0].height;
      boardNode.width = Math.round(boardWidth * this._dpr);
      boardNode.height = Math.round(boardHeight * this._dpr);

      const boardCtx = boardNode.getContext('2d');
      boardCtx.scale(this._dpr, this._dpr);

      const nextNode = res[1].node;
      const nextWidth = res[1].width;
      const nextHeight = res[1].height;
      nextNode.width = Math.round(nextWidth * this._dpr);
      nextNode.height = Math.round(nextHeight * this._dpr);

      const nextCtx = nextNode.getContext('2d');
      nextCtx.scale(this._dpr, this._dpr);

      this._boardCanvas = boardNode;
      this._ctx = boardCtx;
      this._canvasWidth = boardWidth;
      this._canvasHeight = boardHeight;

      this._nextCanvas = nextNode;
      this._nextCtx = nextCtx;
      this._nextWidth = nextWidth;
      this._nextHeight = nextHeight;

      this._computeBoardMetrics();
      this._isReady = true;
      this._startGame();
    });
  },

  onShow() {
    if (this._isReady && this.data.gameState === 'playing' && !this._gravityTimer) {
      this._startGravity();
      this._renderAll();
      this._playBgm();
    }
  },

  onHide() {
    if (this.data.gameState === 'playing') {
      this._stopGravity();
      this.setData({ gameState: 'paused' });
    } else {
      this._stopGravity();
    }
    this._pauseBgm();
  },

  onPause() {
    if (this.data.gameState !== 'playing') return;
    this._stopGravity();
    this.setData({ gameState: 'paused' });
    this._pauseBgm();
  },

  onResume() {
    if (this.data.gameState !== 'paused') return;
    this.setData({ gameState: 'playing' });
    this._startGravity();
    this._playBgm();
  },

  onUnload() {
    this._stopGravity();
    this._destroyAudio();
  },

  noop() {},

  onToggleMute() {
    const muted = !this.data.muted;
    this.setData({ muted });
    if (this._audio) {
      this._audio.bgm.volume = muted ? 0 : 0.45;
    }
  },

  // ── 音频系统 ────────────────────────────────────────────────
  _initAudio() {
    const bgm = wx.createInnerAudioContext();
    bgm.src = '/assets/sounds/tetris-bgm.mp3';
    bgm.loop = true;
    bgm.volume = 0.45;
    bgm.obeyMuteSwitch = false;

    const mkSfx = (src, vol = 0.8) => {
      const ctx = wx.createInnerAudioContext();
      ctx.src = src;
      ctx.volume = vol;
      ctx.obeyMuteSwitch = false;
      return ctx;
    };

    this._audio = {
      bgm,
      drop:     mkSfx('/assets/sounds/tetris-drop.mp3',     0.7),
      clear:    mkSfx('/assets/sounds/tetris-clear.mp3',    0.9),
      tetris:   mkSfx('/assets/sounds/tetris-tetris.mp3',   1.0),
      levelup:  mkSfx('/assets/sounds/tetris-levelup.mp3',  0.9),
      gameover: mkSfx('/assets/sounds/tetris-gameover.mp3', 0.9),
    };
  },

  _destroyAudio() {
    if (!this._audio) return;
    Object.values(this._audio).forEach(ctx => {
      try { ctx.stop(); ctx.destroy(); } catch (e) {}
    });
    this._audio = null;
  },

  _playBgm() {
    if (!this._audio || this.data.muted) return;
    this._audio.bgm.play();
  },

  _pauseBgm() {
    if (!this._audio) return;
    try { this._audio.bgm.pause(); } catch (e) {}
  },

  _playSfx(name) {
    if (!this._audio || this.data.muted) return;
    const ctx = this._audio[name];
    if (!ctx) return;
    try { ctx.stop(); ctx.play(); } catch (e) {}
  },

  onTouchStart(e) {
    const touch = e.touches && e.touches[0];
    if (!touch) return;
    this._touchStartX = touch.clientX;
    this._touchStartY = touch.clientY;
    this._touchStartAt = Date.now();
  },

  onTouchEnd(e) {
    if (this.data.gameState !== 'playing') return;
    const touch = e.changedTouches && e.changedTouches[0];
    if (!touch) return;

    const dx = touch.clientX - (this._touchStartX || 0);
    const dy = touch.clientY - (this._touchStartY || 0);
    const dt = Date.now() - (this._touchStartAt || Date.now());
    const MIN = 30;

    if (Math.abs(dx) < MIN && Math.abs(dy) < MIN) return;

    if (Math.abs(dx) >= Math.abs(dy)) {
      dx > 0 ? this.onRight() : this.onLeft();
      return;
    }

    if (dy < 0) {
      this.onRotate();
      return;
    }

    const speed = Math.abs(dy) / Math.max(dt, 1);
    if (speed > 0.45 || Math.abs(dy) > 120) {
      this.onDrop();
    } else {
      this.onDown();
    }
  },

  onLeft() {
    if (this.data.gameState !== 'playing') return;
    if (this._tryMove(0, -1)) this._renderAll();
    this._startRepeat(() => {
      if (this._tryMove(0, -1)) this._renderAll();
    });
  },

  onRight() {
    if (this.data.gameState !== 'playing') return;
    if (this._tryMove(0, 1)) this._renderAll();
    this._startRepeat(() => {
      if (this._tryMove(0, 1)) this._renderAll();
    });
  },

  onDown() {
    if (this.data.gameState !== 'playing') return;
    this._stepDown(true);
    this._startRepeat(() => this._stepDown(true));
  },

  onMoveEnd() {
    this._stopRepeat();
  },

  _startRepeat(fn) {
    this._stopRepeat();
    this._repeatDelay = setTimeout(() => {
      this._repeatTimer = setInterval(fn, 80);
    }, 200);
  },

  _stopRepeat() {
    if (this._repeatDelay) { clearTimeout(this._repeatDelay); this._repeatDelay = null; }
    if (this._repeatTimer) { clearInterval(this._repeatTimer); this._repeatTimer = null; }
  },

  onRotate() {
    if (this.data.gameState !== 'playing') return;
    if (this._tryRotate()) {
      this._renderAll();
    }
  },

  onDrop() {
    if (this.data.gameState !== 'playing' || !this._current) return;

    let distance = 0;
    while (!this._collides(this._current, 1, 0, this._current.rotation)) {
      this._current.row += 1;
      distance += 1;
    }

    if (distance > 0) {
      this._addScore(distance * 2);
    }

    this._renderAll();
    this._lockCurrentPiece();
  },

  onHold() {
    if (this.data.gameState !== 'playing' || !this._current || this._holdUsed) return;

    const currentType = this._current.type;
    if (!this._holdType) {
      this._holdType = currentType;
      this._syncHoldData();
      if (!this._spawnFromQueue()) return;
    } else {
      const swapType = this._holdType;
      this._holdType = currentType;
      this._syncHoldData();
      if (!this._setCurrentPiece(swapType)) return;
      this._drawNextPreview();
    }

    this._holdUsed = true;
  },

  onRestart() {
    if (!this._isReady) return;
    this._startGame();
  },

  _startGame() {
    this._stopGravity();
    this._board = createEmptyBoard();
    this._bag = [];
    this._score = 0;
    this._lines = 0;
    this._level = 1;
    this._holdType = '';
    this._holdUsed = false;
    this._nextType = this._takeFromBag();

    this.setData({
      score: 0,
      best: this._best || 0,
      level: 1,
      lines: 0,
      gameState: 'playing',
      isNewBest: false
    });
    this._syncHoldData();

    if (!this._spawnFromQueue()) return;
    this._startGravity();
    this._renderAll();
    this._playBgm();
  },

  _takeFromBag() {
    if (!this._bag || !this._bag.length) {
      this._bag = shuffle(PIECE_TYPES);
    }
    return this._bag.pop();
  },

  _spawnFromQueue() {
    const type = this._nextType || this._takeFromBag();
    this._nextType = this._takeFromBag();
    return this._setCurrentPiece(type);
  },

  _setCurrentPiece(type) {
    this._current = {
      type,
      color: TETROMINOES[type].color,
      rotation: 0,
      row: 1,
      col: 4
    };
    this._holdUsed = false;

    if (this._collides(this._current, 0, 0, this._current.rotation)) {
      this._finishGame();
      return false;
    }

    this._renderAll();
    return true;
  },

  _startGravity() {
    this._stopGravity();
    const delay = Math.max(MIN_GRAVITY, BASE_GRAVITY - (this._level - 1) * LEVEL_GRAVITY_STEP);
    this._gravityTimer = setInterval(() => {
      this._tick();
    }, delay);
  },

  _stopGravity() {
    if (this._gravityTimer) {
      clearInterval(this._gravityTimer);
      this._gravityTimer = null;
    }
  },

  _tick() {
    if (this.data.gameState !== 'playing') return;
    this._stepDown(false);
  },

  _stepDown(fromSoftDrop) {
    if (!this._current) return false;

    if (!this._collides(this._current, 1, 0, this._current.rotation)) {
      this._current.row += 1;
      if (fromSoftDrop) {
        this._addScore(1);
      }
      this._renderAll();
      return true;
    }

    this._lockCurrentPiece();
    return false;
  },

  _tryMove(rowDelta, colDelta) {
    if (!this._current || this._collides(this._current, rowDelta, colDelta, this._current.rotation)) {
      return false;
    }
    this._current.row += rowDelta;
    this._current.col += colDelta;
    return true;
  },

  _tryRotate() {
    if (!this._current) return false;

    const nextRotation = (this._current.rotation + 1) % 4;
    const kicks = this._current.type === 'I'
      ? [[0, 0], [0, -1], [0, 1], [0, -2], [0, 2], [-1, 0], [1, 0]]
      : [[0, 0], [0, -1], [0, 1], [-1, 0], [1, 0], [0, -2], [0, 2]];

    for (let i = 0; i < kicks.length; i += 1) {
      const [rowDelta, colDelta] = kicks[i];
      if (!this._collides(this._current, rowDelta, colDelta, nextRotation)) {
        this._current.rotation = nextRotation;
        this._current.row += rowDelta;
        this._current.col += colDelta;
        return true;
      }
    }

    return false;
  },

  _lockCurrentPiece() {
    const cells = this._getPieceCells(this._current);
    let toppedOut = false;

    cells.forEach(({ row, col, color }) => {
      if (row < 0) {
        toppedOut = true;
        return;
      }
      this._board[row][col] = color;
    });

    if (toppedOut) {
      this._finishGame();
      return;
    }

    const cleared = this._clearLines();
    if (cleared > 0) {
      this._applyLineClear(cleared);
    } else {
      this._playSfx('drop');
    }

    if (!this._spawnFromQueue()) return;
    this._renderAll();
  },

  _clearLines() {
    const nextBoard = [];
    let cleared = 0;

    for (let row = 0; row < BOARD_ROWS; row += 1) {
      if (this._board[row].every(cell => !!cell)) {
        cleared += 1;
      } else {
        nextBoard.push(this._board[row]);
      }
    }

    while (nextBoard.length < BOARD_ROWS) {
      nextBoard.unshift(Array(BOARD_COLS).fill(''));
    }

    this._board = nextBoard;
    return cleared;
  },

  _applyLineClear(count) {
    const gained = (LINE_SCORES[count] || 0) * this._level;
    if (gained > 0) {
      this._addScore(gained, false);
    }

    this._lines += count;
    const nextLevel = Math.floor(this._lines / 10) + 1;
    const patch = {
      score: this._score,
      best: this._best,
      lines: this._lines,
      level: nextLevel
    };

    const levelUp = nextLevel !== this._level;
    if (levelUp) {
      this._level = nextLevel;
      this._startGravity();
    }

    this.setData(patch);
    this._playSfx(count >= 4 ? 'tetris' : 'clear');
    if (levelUp) setTimeout(() => this._playSfx('levelup'), 300);
  },

  _addScore(points, syncData = true) {
    if (!points) return;

    this._score += points;
    if (this._score > (this._best || 0)) {
      this._best = this._score;
      wx.setStorageSync(STORAGE_KEY, this._best);
    }

    if (syncData) {
      this.setData({
        score: this._score,
        best: this._best
      });
    }
  },

  _finishGame() {
    this._stopGravity();

    const isNewBest = this._score > (this._best || 0);
    if (isNewBest) {
      this._best = this._score;
      wx.setStorageSync(STORAGE_KEY, this._best);
    }

    this.setData({
      score: this._score,
      best: this._best,
      level: this._level,
      lines: this._lines,
      gameState: 'over',
      isNewBest
    });
    this._pauseBgm();
    this._playSfx('gameover');
    this._renderAll();
  },

  _syncHoldData() {
    this.setData({
      holdPiece: this._holdType || '--',
      holdClass: this._holdType ? `hold-${this._holdType}` : 'hold-empty'
    });
  },

  _collides(piece, rowOffset, colOffset, rotation) {
    const cells = this._getPieceCells(
      piece,
      rotation,
      piece.row + rowOffset,
      piece.col + colOffset
    );

    for (let i = 0; i < cells.length; i += 1) {
      const { row, col } = cells[i];
      if (col < 0 || col >= BOARD_COLS || row >= BOARD_ROWS) {
        return true;
      }
      if (row >= 0 && this._board[row][col]) {
        return true;
      }
    }

    return false;
  },

  _getPieceCells(piece, rotation = piece.rotation, row = piece.row, col = piece.col) {
    const shape = TETROMINOES[piece.type].rotations[rotation];
    return shape.map(([rowOffset, colOffset]) => ({
      row: row + rowOffset,
      col: col + colOffset,
      color: piece.color
    }));
  },

  _getDropDistance(piece) {
    let distance = 0;
    while (!this._collides(piece, distance + 1, 0, piece.rotation)) {
      distance += 1;
    }
    return distance;
  },

  _computeBoardMetrics() {
    const MAX_CELL = 30; // cap to keep blocks crisp, not chunky
    const cell = Math.max(8, Math.min(MAX_CELL, Math.floor(Math.min(this._canvasWidth / BOARD_COLS, this._canvasHeight / BOARD_ROWS))));
    const width = cell * BOARD_COLS;
    const height = cell * BOARD_ROWS;
    this._boardRect = {
      cell,
      width,
      height,
      x: Math.floor((this._canvasWidth - width) / 2),
      y: Math.floor((this._canvasHeight - height) / 2)
    };
  },

  _renderAll() {
    this._drawBoard();
    this._drawNextPreview();
  },

  _drawBoard() {
    const ctx = this._ctx;
    if (!ctx || !this._boardRect) return;

    ctx.clearRect(0, 0, this._canvasWidth, this._canvasHeight);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, this._canvasWidth, this._canvasHeight);

    this._drawBoardGrid(ctx);

    for (let row = 0; row < BOARD_ROWS; row += 1) {
      for (let col = 0; col < BOARD_COLS; col += 1) {
        const color = this._board[row][col];
        if (color) {
          this._drawBlock(ctx, row, col, color, 1);
        }
      }
    }

    if (this._current) {
      const ghostDistance = this._getDropDistance(this._current);
      const ghostCells = this._getPieceCells(
        this._current,
        this._current.rotation,
        this._current.row + ghostDistance,
        this._current.col
      );
      ghostCells.forEach(cell => {
        this._drawBlock(ctx, cell.row, cell.col, this._current.color, 0.2);
      });

      const currentCells = this._getPieceCells(this._current);
      currentCells.forEach(cell => {
        this._drawBlock(ctx, cell.row, cell.col, cell.color, 1);
      });
    }

    if (this.data.gameState === 'over') {
      ctx.fillStyle = 'rgba(10, 10, 30, 0.42)';
      ctx.fillRect(
        this._boardRect.x,
        this._boardRect.y,
        this._boardRect.width,
        this._boardRect.height
      );
    }
  },

  _drawBoardGrid(ctx) {
    const { x, y, width, height, cell } = this._boardRect;

    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(x, y, width, height);

    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);

    ctx.strokeStyle = 'rgba(46, 58, 92, 0.3)';
    for (let row = 0; row <= BOARD_ROWS; row += 1) {
      const py = y + row * cell + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, py);
      ctx.lineTo(x + width, py);
      ctx.stroke();
    }

    for (let col = 0; col <= BOARD_COLS; col += 1) {
      const px = x + col * cell + 0.5;
      ctx.beginPath();
      ctx.moveTo(px, y);
      ctx.lineTo(px, y + height);
      ctx.stroke();
    }
  },

  _drawBlock(ctx, row, col, color, alpha) {
    if (row < 0 || row >= BOARD_ROWS || col < 0 || col >= BOARD_COLS) return;

    const { x, y, cell } = this._boardRect;
    const px = x + col * cell;
    const py = y + row * cell;
    this._drawBlockRect(ctx, px, py, cell, color, alpha);
  },

  _drawBlockRect(ctx, x, y, size, color, alpha) {
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

  _drawNextPreview() {
    const ctx = this._nextCtx;
    if (!ctx) return;

    ctx.clearRect(0, 0, this._nextWidth, this._nextHeight);
    ctx.fillStyle = COLORS.previewBg;
    ctx.fillRect(0, 0, this._nextWidth, this._nextHeight);
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, this._nextWidth - 1, this._nextHeight - 1);

    const cell = Math.max(10, Math.floor(Math.min(this._nextWidth, this._nextHeight) / PREVIEW_GRID));
    const gridWidth = cell * PREVIEW_GRID;
    const gridHeight = cell * PREVIEW_GRID;
    const offsetX = Math.floor((this._nextWidth - gridWidth) / 2);
    const offsetY = Math.floor((this._nextHeight - gridHeight) / 2);

    ctx.strokeStyle = 'rgba(46, 58, 92, 0.25)';
    for (let row = 0; row <= PREVIEW_GRID; row += 1) {
      const y = offsetY + row * cell + 0.5;
      ctx.beginPath();
      ctx.moveTo(offsetX, y);
      ctx.lineTo(offsetX + gridWidth, y);
      ctx.stroke();
    }

    for (let col = 0; col <= PREVIEW_GRID; col += 1) {
      const x = offsetX + col * cell + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, offsetY);
      ctx.lineTo(x, offsetY + gridHeight);
      ctx.stroke();
    }

    if (!this._nextType) return;

    const shape = TETROMINOES[this._nextType].rotations[0];
    let minRow = Infinity;
    let maxRow = -Infinity;
    let minCol = Infinity;
    let maxCol = -Infinity;

    shape.forEach(([row, col]) => {
      minRow = Math.min(minRow, row);
      maxRow = Math.max(maxRow, row);
      minCol = Math.min(minCol, col);
      maxCol = Math.max(maxCol, col);
    });

    const pieceWidth = maxCol - minCol + 1;
    const pieceHeight = maxRow - minRow + 1;
    const colShift = Math.floor((PREVIEW_GRID - pieceWidth) / 2) - minCol;
    const rowShift = Math.floor((PREVIEW_GRID - pieceHeight) / 2) - minRow;

    shape.forEach(([row, col]) => {
      const drawCol = col + colShift;
      const drawRow = row + rowShift;
      this._drawBlockRect(
        ctx,
        offsetX + drawCol * cell,
        offsetY + drawRow * cell,
        cell,
        TETROMINOES[this._nextType].color,
        1
      );
    });
  }
});
