# Tetris 优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重设计控制区为 D-Pad + AB 手柄风格，添加 500ms Lock Delay 手感优化，添加消行闪光动画。

**Architecture:** 所有改动限于 `miniprogram/pages/tetris/` 三个文件。控制区是纯 WXML/WXSS 结构替换，现有按键处理函数不变。Lock Delay 通过新增 4 个私有方法 + 修改 5 个现有方法实现，与 gravity timer 相互独立。消行动画通过修改 `_clearLines` 返回行索引、在 `_lockCurrentPiece` 中插入 150ms setTimeout 实现。

**Tech Stack:** WeChat Mini Program 原生 WXML/WXSS/JS，Canvas 2D API

---

## 改动文件

| 文件 | 改动 |
|------|------|
| `miniprogram/pages/tetris/index.wxml` | 替换 `.controls` 区块，移除棋盘 touch 绑定 |
| `miniprogram/pages/tetris/index.wxss` | 替换控制区样式，新增 D-Pad / AB 类 |
| `miniprogram/pages/tetris/index.js` | 移除 touch 手势函数；新增 lock delay 函数；修改 `_clearLines`、`_lockCurrentPiece`、`_applyLineClear`、`_drawBoard` |

---

## Task 1: 控制区 WXML + WXSS 重构（D-Pad + AB）

**Files:**
- Modify: `miniprogram/pages/tetris/index.wxml:56-78`
- Modify: `miniprogram/pages/tetris/index.wxss:296-448`

### 1.1 替换 index.wxml 中的 controls 区块

- [ ] 将 `index.wxml` 第 23-24 行的 `.board-wrap` 的 touch 绑定移除（不再需要滑动手势）：

**改前：**
```xml
<view class="board-wrap" bindtouchstart="onTouchStart" bindtouchend="onTouchEnd">
```

**改后：**
```xml
<view class="board-wrap">
```

- [ ] 将 `index.wxml` 第 56-78 行的 `.controls` 区块整体替换：

**改前（第 56-78 行）：**
```xml
<view class="controls" wx:if="{{gameState === 'playing'}}" catchtouchend="noop">
  <view class="ctrl-move">
    <view class="ctrl-lr">
      <view class="control-btn ctrl-btn-lg" catchtouchstart="onLeft" catchtouchend="onMoveEnd">
        <view class="arr arr-left"></view>
      </view>
      <view class="control-btn ctrl-btn-lg" catchtouchstart="onDown" catchtouchend="onMoveEnd">
        <view class="arr arr-down"></view>
      </view>
      <view class="control-btn ctrl-btn-lg" catchtouchstart="onRight" catchtouchend="onMoveEnd">
        <view class="arr arr-right"></view>
      </view>
    </view>
  </view>
  <view class="ctrl-action">
    <view class="control-btn ctrl-btn-act ctrl-rotate" catchtouchstart="onRotate">
      <text class="rot-text">ROT</text>
    </view>
    <view class="control-btn ctrl-btn-act drop-btn" catchtouchstart="onDrop">
      <text class="drop-text">DROP</text>
    </view>
  </view>
</view>
```

**改后：**
```xml
<view class="controls" wx:if="{{gameState === 'playing'}}" catchtouchend="noop">
  <view class="ctrl-dpad">
    <view class="dpad-row">
      <view class="dpad-gap"></view>
      <view class="control-btn dpad-btn" catchtouchstart="onDrop">
        <view class="arr arr-up"></view>
      </view>
      <view class="dpad-gap"></view>
    </view>
    <view class="dpad-row">
      <view class="control-btn dpad-btn" catchtouchstart="onLeft" catchtouchend="onMoveEnd">
        <view class="arr arr-left"></view>
      </view>
      <view class="dpad-center"></view>
      <view class="control-btn dpad-btn" catchtouchstart="onRight" catchtouchend="onMoveEnd">
        <view class="arr arr-right"></view>
      </view>
    </view>
    <view class="dpad-row">
      <view class="dpad-gap"></view>
      <view class="control-btn dpad-btn" catchtouchstart="onDown" catchtouchend="onMoveEnd">
        <view class="arr arr-down"></view>
      </view>
      <view class="dpad-gap"></view>
    </view>
  </view>

  <view class="ctrl-ab">
    <view class="control-btn ab-btn btn-a" catchtouchstart="onRotate">
      <text class="ab-label">A</text>
      <text class="ab-hint">ROT</text>
    </view>
    <view class="control-btn ab-btn btn-b" catchtouchstart="onHold">
      <text class="ab-label">B</text>
      <text class="ab-hint">HOLD</text>
    </view>
  </view>
</view>
```

### 1.2 替换 index.wxss 中的控制区样式

- [ ] 将 `index.wxss` 第 296-448 行（从 `.controls {` 到文件末尾）整体替换：

**改后（替换全部控制区样式）：**
```css
.controls {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  padding: 16rpx 44rpx 52rpx;
  background: #1E1E38;
  border-top: 2rpx solid #2E3A5C;
  box-shadow: 0 -6rpx 0 #0A0A1A;
  flex-shrink: 0;
}

/* ── D-Pad ─────────────────────────────────────── */
.ctrl-dpad {
  display: flex;
  flex-direction: column;
}

.dpad-row {
  display: flex;
  flex-direction: row;
}

.dpad-btn {
  width: 140rpx;
  height: 140rpx;
}

.dpad-gap {
  width: 140rpx;
  height: 140rpx;
}

.dpad-center {
  width: 140rpx;
  height: 140rpx;
  background: #16162E;
  border: 2rpx solid #2E3A5C;
  box-shadow: 3rpx 3rpx 0 #0A0A1A;
}

/* ── AB 键 ─────────────────────────────────────── */
.ctrl-ab {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
  align-items: center;
}

.ab-btn {
  width: 140rpx;
  height: 140rpx;
  flex-direction: column;
  gap: 4rpx;
}

.btn-a {
  border-color: #A855F7;
}

.btn-a:active {
  border-color: #A855F7 !important;
  background: rgba(168, 85, 247, 0.15) !important;
}

.btn-b {
  border-color: #4A6FA5;
}

.btn-b:active {
  border-color: #60C0FF !important;
  background: rgba(96, 192, 255, 0.12) !important;
}

.ab-label {
  font-size: 30rpx;
  font-weight: 700;
  font-family: monospace;
  color: #C0C0E8;
  line-height: 1;
}

.ab-hint {
  font-size: 16rpx;
  color: #4A6FA5;
  letter-spacing: 1rpx;
  font-family: monospace;
  line-height: 1;
}

/* ── 共用按钮基类（保留） ──────────────────────── */
.control-btn {
  width: 88rpx;
  height: 88rpx;
  background: #16162E;
  border: 2rpx solid #2E3A5C;
  border-radius: 0;
  box-shadow: 3rpx 3rpx 0 #0A0A1A;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #4A6FA5;
  font-size: 34rpx;
  font-family: monospace;
  user-select: none;
}

.control-btn:active {
  border-color: #E8873A;
  color: #E8873A;
  background: rgba(232, 135, 58, 0.12);
}

.control-btn:active .arr-up {
  border-bottom-color: #E8873A;
}

.control-btn:active .arr-left {
  border-right-color: #E8873A;
}

.control-btn:active .arr-right {
  border-left-color: #E8873A;
}

.control-btn:active .arr-down {
  border-top-color: #E8873A;
}

/* ── 方向箭头（保留） ─────────────────────────── */
.arr {
  display: block;
  width: 0;
  height: 0;
}

.arr-up {
  border-left: 16rpx solid transparent;
  border-right: 16rpx solid transparent;
  border-bottom: 24rpx solid #4A6FA5;
}

.arr-left {
  border-top: 16rpx solid transparent;
  border-bottom: 16rpx solid transparent;
  border-right: 24rpx solid #4A6FA5;
}

.arr-right {
  border-top: 16rpx solid transparent;
  border-bottom: 16rpx solid transparent;
  border-left: 24rpx solid #4A6FA5;
}

.arr-down {
  border-left: 16rpx solid transparent;
  border-right: 16rpx solid transparent;
  border-top: 24rpx solid #4A6FA5;
}

/* ── 覆盖层（保留） ───────────────────────────── */
.overlay {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(10, 10, 30, 0.85);
  z-index: 10;
}

.over-card {
  min-width: 480rpx;
  padding: 48rpx 40rpx;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  background: rgba(30, 30, 60, 0.97);
  border: 2rpx solid #E8873A;
  border-radius: 0;
  box-shadow: 6rpx 6rpx 0 #0E0E22;
}

.over-title {
  font-size: 40rpx;
  font-weight: 700;
  color: #FFFFFF;
  letter-spacing: 6rpx;
  font-family: monospace;
  margin-bottom: 16rpx;
}

.newbest-badge {
  padding: 8rpx 24rpx;
  margin-bottom: 20rpx;
  background: rgba(232, 135, 58, 0.18);
  border: 2rpx solid #E8873A;
}

.newbest-text {
  font-size: 24rpx;
  color: #E8873A;
  letter-spacing: 4rpx;
  font-family: monospace;
  font-weight: 700;
}

.over-score-num {
  font-size: 72rpx;
  color: #FFFFFF;
  font-family: monospace;
  font-weight: 700;
  letter-spacing: 2rpx;
  line-height: 1;
}

.over-score-label {
  font-size: 20rpx;
  color: #4A6FA5;
  letter-spacing: 3rpx;
  font-family: monospace;
  margin-bottom: 16rpx;
  margin-top: 4rpx;
}

.over-best {
  font-size: 22rpx;
  color: #4A6FA5;
  letter-spacing: 2rpx;
  font-family: monospace;
  margin-bottom: 36rpx;
}

.restart-btn {
  padding: 20rpx 52rpx;
  background: #E8873A;
  color: #1A1A2E;
  border: 2rpx solid #E8873A;
  border-radius: 0;
  box-shadow: 3rpx 3rpx 0 #0E0E22;
  font-size: 28rpx;
  font-weight: 700;
  letter-spacing: 3rpx;
  font-family: monospace;
}

.restart-btn:active {
  opacity: 0.88;
}

.pause-restart-btn {
  margin-top: 16rpx;
  padding: 16rpx 44rpx;
  background: transparent;
  color: #4A6FA5;
  border: 2rpx solid #2E3A5C;
  border-radius: 0;
  box-shadow: 3rpx 3rpx 0 #0A0A1A;
  font-size: 24rpx;
  letter-spacing: 3rpx;
  font-family: monospace;
}

.pause-restart-btn:active {
  border-color: #E8873A;
  color: #E8873A;
}
```

### 1.3 移除 index.js 中的 touch 手势函数

- [ ] 在 `index.js` 中删除 `onTouchStart` 和 `onTouchEnd` 两个函数（第 280-316 行），连同前面的空行一并删除。这两个函数处理的是棋盘滑动手势，D-Pad 布局后不再需要。

### 1.4 手动测试

在微信开发者工具模拟器中打开俄罗斯方块页面，验证：
- [ ] 底部出现三行 D-Pad 十字键（上/左/右/下各一格，中心格有背景色）
- [ ] 右侧出现 A（ROT）和 B（HOLD）两个竖排按钮
- [ ] 各按钮点击有高亮反馈
- [ ] A 键触发旋转，B 键触发 Hold，方向键和 ↑（DROP）功能正常

### 1.5 提交

- [ ] 
```bash
git add miniprogram/pages/tetris/index.wxml miniprogram/pages/tetris/index.wxss miniprogram/pages/tetris/index.js
git commit -m "feat(tetris): replace controls with D-Pad + AB gamepad layout"
```

---

## Task 2: Lock Delay

**Files:**
- Modify: `miniprogram/pages/tetris/index.js`

### 2.1 在 `_startGame` 中初始化新状态

- [ ] 找到 `_startGame` 函数（约第 404 行），在 `this._holdUsed = false;` 下方添加两行：

```js
this._lockDelayTimer = null;
this._lockResetCount = 0;
```

### 2.2 添加 4 个 lock delay 辅助函数

- [ ] 在 `_stopGravity` 函数（约第 471 行）之后，添加以下 4 个函数：

```js
_isOnGround() {
  return !!this._current && this._collides(this._current, 1, 0, this._current.rotation);
},

_startLockDelay() {
  this._cancelLockDelay();
  this._lockDelayTimer = setTimeout(() => {
    this._lockDelayTimer = null;
    this._lockCurrentPiece();
  }, 500);
},

_resetLockDelay() {
  if (this._lockResetCount >= 15) return;
  this._lockResetCount += 1;
  this._startLockDelay();
},

_cancelLockDelay() {
  if (this._lockDelayTimer) {
    clearTimeout(this._lockDelayTimer);
    this._lockDelayTimer = null;
  }
},
```

### 2.3 修改 `_stepDown`

- [ ] 将 `_stepDown` 整体替换（原约第 483-497 行）：

**改前：**
```js
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
```

**改后：**
```js
_stepDown(fromSoftDrop) {
  if (!this._current) return false;

  if (!this._collides(this._current, 1, 0, this._current.rotation)) {
    this._current.row += 1;
    if (fromSoftDrop) {
      this._addScore(1);
    }
    this._cancelLockDelay();
    this._renderAll();
    return true;
  }

  this._startLockDelay();
  this._renderAll();
  return false;
},
```

### 2.4 修改 `_tryMove`

- [ ] 将 `_tryMove` 整体替换（原约第 499-506 行）：

**改前：**
```js
_tryMove(rowDelta, colDelta) {
  if (!this._current || this._collides(this._current, rowDelta, colDelta, this._current.rotation)) {
    return false;
  }
  this._current.row += rowDelta;
  this._current.col += colDelta;
  return true;
},
```

**改后：**
```js
_tryMove(rowDelta, colDelta) {
  if (!this._current || this._collides(this._current, rowDelta, colDelta, this._current.rotation)) {
    return false;
  }
  this._current.row += rowDelta;
  this._current.col += colDelta;
  if (this._isOnGround()) {
    this._resetLockDelay();
  }
  return true;
},
```

### 2.5 修改 `_tryRotate`

- [ ] 将 `_tryRotate` 整体替换（原约第 508-527 行）：

**改前：**
```js
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
```

**改后：**
```js
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
      if (this._isOnGround()) {
        this._resetLockDelay();
      }
      return true;
    }
  }

  return false;
},
```

### 2.6 修改 `_setCurrentPiece`

- [ ] 在 `_setCurrentPiece` 函数开头（原约第 444 行，`this._current = {` 之前）插入两行：

```js
this._cancelLockDelay();
this._lockResetCount = 0;
```

完整函数改后：
```js
_setCurrentPiece(type) {
  this._cancelLockDelay();
  this._lockResetCount = 0;
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
```

### 2.7 修改 `_finishGame`

- [ ] 在 `_finishGame` 函数的 `this._stopGravity();` 前插入一行 `this._cancelLockDelay();`：

```js
_finishGame() {
  this._cancelLockDelay();
  this._stopGravity();
  // ... 其余代码不变 ...
},
```

### 2.8 修改 `onDrop`（硬降时取消 lock delay）

- [ ] 在 `onDrop` 函数开头（`let distance = 0;` 前）插入一行：

```js
onDrop() {
  if (this.data.gameState !== 'playing' || !this._current) return;
  this._cancelLockDelay();

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
```

### 2.9 在 `_drawBoard` 中添加落地变暗视觉反馈

- [ ] 找到 `_drawBoard` 中绘制当前方块的代码段（约第 737-741 行）：

**改前：**
```js
const currentCells = this._getPieceCells(this._current);
currentCells.forEach(cell => {
  this._drawBlock(ctx, cell.row, cell.col, cell.color, 1);
});
```

**改后：**
```js
const lockAlpha = this._lockDelayTimer ? 0.75 : 1;
const currentCells = this._getPieceCells(this._current);
currentCells.forEach(cell => {
  this._drawBlock(ctx, cell.row, cell.col, cell.color, lockAlpha);
});
```

### 2.10 手动测试

- [ ] 在模拟器中运行游戏，让方块落到底部：
  - 方块接触地面后不立即锁定，轻微变暗（约 0.75 透明度）
  - 此时左右移动或旋转，方块可以移动且倒计时重置
  - 静止等待约 0.5 秒，方块锁定
  - 硬降（↑ 按钮）仍然立即锁定

### 2.11 提交

- [ ] 
```bash
git add miniprogram/pages/tetris/index.js
git commit -m "feat(tetris): add 500ms lock delay with up-to-15 resets"
```

---

## Task 3: 消行闪光动画

**Files:**
- Modify: `miniprogram/pages/tetris/index.js`

### 3.1 在 `_startGame` 中初始化 `_clearingRows`

- [ ] 在 `_startGame` 中 `this._lockResetCount = 0;` 下方添加：

```js
this._clearingRows = [];
```

### 3.2 修改 `_clearLines`：返回行索引 + 新棋盘

- [ ] 将 `_clearLines` 整体替换（原约第 557-575 行）：

**改前：**
```js
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
```

**改后：**
```js
_clearLines() {
  const clearingRows = [];
  const nextBoard = [];

  for (let row = 0; row < BOARD_ROWS; row += 1) {
    if (this._board[row].every(cell => !!cell)) {
      clearingRows.push(row);
    } else {
      nextBoard.push(this._board[row]);
    }
  }

  while (nextBoard.length < BOARD_ROWS) {
    nextBoard.unshift(Array(BOARD_COLS).fill(''));
  }

  return { clearingRows, nextBoard };
},
```

### 3.3 修改 `_applyLineClear`：移除 clear/tetris 音效调用

- [ ] 将 `_applyLineClear` 整体替换（原约第 577-601 行）：

**改前：**
```js
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
```

**改后（移除 clear/tetris sfx，该音效改为在动画开始前播放）：**
```js
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
  if (levelUp) setTimeout(() => this._playSfx('levelup'), 300);
},
```

### 3.4 修改 `_lockCurrentPiece`：插入动画流程

- [ ] 将 `_lockCurrentPiece` 整体替换（原约第 529-555 行）：

**改前：**
```js
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
```

**改后：**
```js
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

  const { clearingRows, nextBoard } = this._clearLines();

  if (clearingRows.length > 0) {
    this._playSfx(clearingRows.length >= 4 ? 'tetris' : 'clear');
    this._stopGravity();
    this._clearingRows = clearingRows;
    this._current = null;
    this._renderAll();
    setTimeout(() => {
      this._clearingRows = [];
      this._board = nextBoard;
      this._applyLineClear(clearingRows.length);
      if (!this._spawnFromQueue()) return;
      this._startGravity();
      this._renderAll();
    }, 150);
  } else {
    this._playSfx('drop');
    if (!this._spawnFromQueue()) return;
    this._renderAll();
  }
},
```

### 3.5 在 `_drawBoard` 中绘制闪光叠加层

- [ ] 找到 `_drawBoard` 中游戏结束遮罩绘制之前（约第 743 行，`if (this.data.gameState === 'over')` 之前），插入以下代码：

```js
if (this._clearingRows && this._clearingRows.length > 0) {
  const { x, y, cell, width } = this._boardRect;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  this._clearingRows.forEach(row => {
    ctx.fillRect(x, y + row * cell, width, cell);
  });
}
```

### 3.6 手动测试

- [ ] 在模拟器中累积行直到触发消行，验证：
  - 消行时被消除的行瞬间变成白色亮条（持续约 150ms）
  - 白色消失后行正常移除，上方方块下落
  - 消行音效在闪光开始时立即播放（不滞后）
  - 四行同消（Tetris）时播放 tetris 音效，少于四行播放 clear 音效
  - 升级时 levelup 音效约 300ms 后播放

### 3.7 提交

- [ ] 
```bash
git add miniprogram/pages/tetris/index.js
git commit -m "feat(tetris): add 150ms line clear flash animation"
```

---

## Task 4: 推送

- [ ] 推送到 master，触发 CI：

```bash
git push origin master
```

告知用户推送完成，让其在 GitHub Actions 查看 upload workflow 结果。

---

## BGM 替换（手动步骤，不在代码范围）

以下步骤由开发者手动完成：

1. 前往 [https://opengameart.org](https://opengameart.org) 搜索 `chiptune puzzle` 或 `lighthearted pixel loop`
2. 选择轻快循环风格 MP3，文件大小 ≤ 500KB
3. 重命名为 `tetris-bgm.mp3`
4. 替换 `miniprogram/assets/sounds/tetris-bgm.mp3`
5. 提交并推送

---

## 自检结果

- **Spec coverage**: 控制区 D-Pad+AB ✅，Lock Delay 500ms+15次重置 ✅，消行动画 150ms ✅，BGM 手动替换说明 ✅
- **Placeholders**: 无 TBD/TODO
- **Type consistency**: `_clearLines` 返回 `{ clearingRows, nextBoard }`，在 `_lockCurrentPiece` 中解构使用，一致
- **`_cancelLockDelay` / `_startLockDelay`**: Task 2 定义，Task 2 和 Task 3 均使用，一致
