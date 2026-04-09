# Tetris 优化设计文档

**日期**: 2026-04-10  
**范围**: `miniprogram/pages/tetris/`  
**目标**: 提升操作手感、重设计控制区布局、添加消行动画、替换 BGM

---

## 1. 控制区重设计（D-Pad + AB）

### 布局

```
左手区（D-Pad）                右手区（A / B）

      [ ↑ DROP ]
  [ ← ] [   ] [ → ]            [ A ROT ]
      [ ↓ SOFT ]                [ B HOLD ]
```

### 按键映射

| 按键 | 功能 |
|------|------|
| D-Pad ↑ | 硬降（Hard Drop） |
| D-Pad ← | 向左移动（支持长按自动重复） |
| D-Pad → | 向右移动（支持长按自动重复） |
| D-Pad ↓ | 软降（Soft Drop，支持长按） |
| A | 旋转（顺时针） |
| B | Hold（暂存当前方块） |

### 实现方式

- WXML：`.controls` 区域拆分为左侧 D-Pad（3×3 CSS Grid）+ 右侧 AB 两键竖排
- WXSS：D-Pad 格子尺寸 140rpx，中心格空白，四角空白；AB 按钮 140rpx
- 现有 `onLeft`、`onRight`、`onDown`、`onDrop`、`onRotate`、`onHold` 处理函数保持不变，只更新绑定位置
- 移除原有滑动手势（`bindtouchstart` / `bindtouchend` 在棋盘上的方向识别逻辑），棋盘区域只保留视觉展示

### 不改动

- 长按自动重复逻辑（`_startRepeat` / `_stopRepeat`）保持不变
- 旋转踢墙逻辑不变

---

## 2. 手感优化：Lock Delay

### 规则

- 方块落地（无法继续下移）时，**不立即锁定**，启动 500ms 倒计时
- 倒计时期间玩家可移动/旋转方块，每次成功操作**重置倒计时**
- 重置次数上限 **15 次**，达到上限后下次落地直接锁定
- 倒计时到期时调用 `_lockCurrentPiece()`

### 新增私有状态

```js
_lockDelayTimer    // setTimeout handle，null 表示未激活
_lockResetCount    // 本块已重置次数，生成新块时归零
```

### 修改点

| 函数 | 改动 |
|------|------|
| `_stepDown()` | 落地时改为调用 `_startLockDelay()`，不再直接调用 `_lockCurrentPiece()` |
| `_tryMove()` | 移动成功后，若方块仍在地面（`_isOnGround()`），调用 `_resetLockDelay()` |
| `_tryRotate()` | 同上 |
| `_setCurrentPiece()` | 生成新块时调用 `_cancelLockDelay()`，`_lockResetCount = 0` |
| `_finishGame()` | 调用 `_cancelLockDelay()` |

### 新增函数

```js
_isOnGround()       // 检查当前块是否无法再下移
_startLockDelay()   // 启动 500ms 定时器
_resetLockDelay()   // 重置定时器（lockResetCount < 15）
_cancelLockDelay()  // 清除定时器
```

### 视觉反馈

- 落地等待期间，当前方块渲染 alpha 从 1.0 降至 **0.75**
- 在 `_drawBoard()` 中根据 `_lockDelayTimer !== null` 判断是否降低 alpha

---

## 3. 消行动画

### 效果描述

消行触发后，被消除的行先显示 **150ms 白色闪光**，再实际移除并恢复游戏。

### 实现逻辑

```
_clearLines() 返回消除行索引数组（而非仅数量）
  └→ 存入 _clearingRows
  └→ _stopGravity()
  └→ 进入动画循环：在 clearingRows 对应行上叠加白色半透明矩形
  └→ 150ms 后：
       实际移除行（原 _clearLines 的 board 更新逻辑）
       _clearingRows = []
       _applyLineClear(count)  ← 计分、升级、音效
       _spawnFromQueue()
       _startGravity()
```

### 动画实现

使用两次 `requestAnimationFrame`（或 `setTimeout(fn, 150)`）驱动闪光：

- 第 1 帧（0ms）：正常绘制棋盘，在消除行上叠加 `rgba(255,255,255,0.85)` 矩形
- 150ms 后：完成实际消除，恢复正常渲染

### 不做

- 不做逐格消散动画
- 不做行坠落动画
- 动画期间操作无效（150ms 内感知不到）

---

## 4. BGM 替换（手动步骤）

代码侧无改动，仅替换音频文件。

### 步骤

1. 前往 [OpenGameArt.org](https://opengameart.org) 搜索 `chiptune puzzle` 或 `lighthearted pixel loop`
2. 下载轻快循环风格 MP3，**文件大小 ≤ 500KB**（整包 2MB 限制，现有音效占用约 1.2MB）
3. 重命名为 `tetris-bgm.mp3`
4. 替换 `miniprogram/assets/sounds/tetris-bgm.mp3`

---

## 改动文件清单

| 文件 | 改动类型 |
|------|---------|
| `miniprogram/pages/tetris/index.js` | 新增 lock delay 逻辑、消行动画逻辑、移除棋盘滑动手势 |
| `miniprogram/pages/tetris/index.wxml` | 控制区结构重写（D-Pad + AB） |
| `miniprogram/pages/tetris/index.wxss` | 控制区样式重写 |
| `miniprogram/assets/sounds/tetris-bgm.mp3` | 手动替换（不在代码改动范围内） |

---

## 不在本次范围内

- Hold 区 canvas 化（文字显示保持）
- 多 NEXT 预览
- T-Spin / Back-to-Back 评分
- 性能分层 Canvas
