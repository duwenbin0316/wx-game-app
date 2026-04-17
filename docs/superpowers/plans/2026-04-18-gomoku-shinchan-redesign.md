# 五子棋蜡笔小新改版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将五子棋顶部玩家行替换为「小新图 · 黑棋 · VS · 白棋 · 左卫门图」横幅，当前落子方高亮，等待方变暗。

**Architecture:** 仅修改 `miniprogram/pages/gomoku/index.wxml` 和 `index.wxss`，不触碰 JS 逻辑。WXML 用现有 `currentPlayer`、`blackName`、`whiteName` 数据驱动条件类名，WXSS 控制高亮/暗淡样式。

**Tech Stack:** WeChat Mini Program WXML/WXSS，无第三方库。

---

## 涉及文件

| 操作 | 文件 |
|------|------|
| Modify | `miniprogram/pages/gomoku/index.wxml` |
| Modify | `miniprogram/pages/gomoku/index.wxss` |

---

### Task 1: 替换 WXML 玩家行

**Files:**
- Modify: `miniprogram/pages/gomoku/index.wxml:12-26`

- [ ] **Step 1: 在模拟器中记录当前外观**

  打开微信开发者工具，进入五子棋页面，确认顶部玩家行当前样子（两个 player-card + VS 文字）。这是改前基准。

- [ ] **Step 2: 替换 players-row 内容**

  将 `index.wxml` 第 12–26 行的 `players-row` 整块替换为：

  ```xml
  <view class="players-row">
    <!-- 小新 / 黑棋 -->
    <view class="player-slot {{currentPlayer === 'black' ? 'active' : 'inactive'}}">
      <image class="char-img {{currentPlayer === 'black' ? 'char-active' : ''}}" src="/images/shinnosuke.png" mode="aspectFit"/>
      <text class="player-name">{{blackName}}</text>
    </view>

    <!-- 中间：棋子 + VS -->
    <view class="vs-block">
      <view class="pieces-row">
        <view class="chess-piece black {{currentPlayer === 'black' ? 'active' : ''}}"></view>
        <text class="vs-text">VS</text>
        <view class="chess-piece white {{currentPlayer === 'white' ? 'active' : ''}}"></view>
      </view>
    </view>

    <!-- 左卫门 / 白棋 -->
    <view class="player-slot {{currentPlayer === 'white' ? 'active' : 'inactive'}}">
      <image class="char-img {{currentPlayer === 'white' ? 'char-active' : ''}}" src="/images/boo.png" mode="aspectFit"/>
      <text class="player-name">{{whiteName}}</text>
    </view>
  </view>
  ```

- [ ] **Step 3: 在模拟器中验证结构**

  保存后模拟器热更新。检查：
  - 顶部横幅出现两张角色图和 VS
  - 不报 `image` 路径 404（图片能加载）
  - 页面不崩溃

---

### Task 2: 更新 WXSS —— 替换旧 player-card 样式，添加新样式

**Files:**
- Modify: `miniprogram/pages/gomoku/index.wxss`

- [ ] **Step 1: 删除旧的 players-row / player-card 相关样式**

  删除 `index.wxss` 中以下几段（共约 70 行）：

  ```css
  /* 删除这整块 ── 玩家行 ── */
  .players-row { ... }
  .player-card { ... }
  .player-card.active { ... }
  .player-card.my-player { ... }
  .player-label { ... }
  .vs { ... }
  .chess-piece { ... }
  .chess-piece.black { ... }
  .chess-piece.white { ... }
  ```

  对应 `index.wxss` 第 68–140 行。

- [ ] **Step 2: 在"── 玩家行 ──"注释处写入新样式**

  在删除位置插入：

  ```css
  /* ── 玩家行 ── */
  .players-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 14rpx;
  }

  .player-slot {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6rpx;
    width: 96rpx;
  }

  .player-slot.active   { opacity: 1; }
  .player-slot.inactive { opacity: 0.35; filter: grayscale(30%); }

  .char-img { width: 72rpx; height: 80rpx; }

  .char-active {
    filter: drop-shadow(0 0 6rpx rgba(232,135,58,0.9));
  }

  .player-name {
    font-size: 22rpx;
    letter-spacing: 1rpx;
    font-family: monospace;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 90rpx;
    text-align: center;
  }

  .player-slot.active   .player-name { color: #E8873A; }
  .player-slot.inactive .player-name { color: #4A6FA5; }

  .vs-block {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
  }

  .pieces-row {
    display: flex;
    align-items: center;
    gap: 10rpx;
  }

  .chess-piece {
    width: 30rpx;
    height: 30rpx;
    border-radius: 50%;
    box-sizing: border-box;
    flex-shrink: 0;
  }

  .chess-piece.black {
    background: radial-gradient(circle at 35% 35%, #5b6470, #111827);
    border: 2rpx solid #9ca3af;
    box-shadow: 0 2rpx 6rpx rgba(0,0,0,0.5);
  }

  .chess-piece.black.active {
    border-color: #E8873A;
    box-shadow: 0 0 0 4rpx rgba(232,135,58,0.3), 0 2rpx 6rpx rgba(0,0,0,0.5);
  }

  .chess-piece.white {
    background: radial-gradient(circle at 35% 35%, #ffffff, #ddd);
    border: 2rpx solid #aaa;
    box-shadow: 0 2rpx 6rpx rgba(0,0,0,0.3);
  }

  .chess-piece.white.active {
    border-color: #A78BFA;
    box-shadow: 0 0 0 4rpx rgba(167,139,250,0.3), 0 2rpx 6rpx rgba(0,0,0,0.3);
  }

  .vs-text {
    font-size: 18rpx;
    font-weight: 700;
    color: #3A3A6A;
    letter-spacing: 3rpx;
    font-family: monospace;
  }
  ```

- [ ] **Step 3: 模拟器验证样式**

  检查：
  - 两侧角色图正确显示，尺寸合理
  - 三列纵向居中对齐（角色图中心、棋子中心、VS 文字在同一水平线附近）
  - 玩家名单行省略，不溢出

- [ ] **Step 4: 验证高亮交互**

  本地对战模式下落子，确认：
  - 黑棋落子后：小新高亮（橙色光晕）+ 黑棋子橙色边框，左卫门变暗
  - 白棋落子后：左卫门高亮 + 白棋子紫色边框，小新变暗
  - 人机模式：电脑落子后左卫门亮，玩家落子后小新亮

- [ ] **Step 5: 验证在线模式**

  在线模式下（可用模拟器单人测试），确认：
  - `blackName` / `whiteName` 正确渲染为房间内玩家昵称
  - 角色绑定不随房间身份变化（小新始终是黑棋，左卫门始终是白棋）

- [ ] **Step 6: Commit**

  ```bash
  git add miniprogram/pages/gomoku/index.wxml miniprogram/pages/gomoku/index.wxss
  git commit -m "feat(gomoku): replace player row with shinchan character banner"
  ```

---

### Task 3: 推送并验证 CI

- [ ] **Step 1: 推送到 master**

  ```bash
  git push origin master
  ```

- [ ] **Step 2: 确认 CI 触发**

  GitHub Actions `upload.yml` 会因 `miniprogram/**` 变更自动触发，告知用户关注 Action 执行结果。

---

## 验收清单

- [ ] 顶部横幅：小新（左）· 黑棋 · VS · 白棋 · 左卫门（右）
- [ ] 三列纵向居中对齐
- [ ] 轮次高亮正确切换（黑/白双方）
- [ ] 玩家名正确展示，不溢出
- [ ] 棋盘全宽不受影响
- [ ] 结果弹窗、悔棋、重新开始功能正常（无回归）
