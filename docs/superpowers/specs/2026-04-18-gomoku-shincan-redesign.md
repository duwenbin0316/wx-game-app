# 五子棋页面蜡笔小新改版设计文档

**日期：** 2026-04-18  
**状态：** 待实现

---

## 目标

在五子棋页面顶部引入蜡笔小新（小新）和肥嘟嘟左卫门两个角色形象，增强页面趣味性和角色代入感，同时保持现有深色像素风格不变。

---

## 素材

| 文件 | 用途 |
|------|------|
| `miniprogram/images/shinnosuke.png` | 小新角色图（已水平镜像，面朝右） |
| `miniprogram/images/boo.png` | 左卫门角色图（面朝左） |

---

## 页面布局变更

### 顶部 Banner（`game-header`）

原有玩家行（`players-row`）改为新版角色横幅，结构如下：

```
[ 小新图 + 名字 ]  [ 黑棋 · VS · 白棋 ]  [ 左卫门图 + 名字 ]
```

- 小新绑定黑棋，左卫门绑定白棋
- 角色图尺寸：72×80rpx，`object-fit: contain`
- 玩家名显示在角色图正下方，单行省略，最大宽度 90rpx
- 棋子尺寸：30×30rpx，圆形

### 状态行保持不变

模式标签（mode-pill）和状态文字（status-text）位置不变，仍在 banner 顶部两端。

---

## 交互：轮次高亮

| 状态 | 效果 |
|------|------|
| 当前落子方 | opacity: 1，角色图橙色光晕（`drop-shadow #E8873A`），棋子橙色边框+光圈，名字橙色 |
| 等待方 | opacity: 0.35，grayscale(30%)，名字暗蓝色 |

高亮切换跟随 `currentPlayer` 数据变化，用 `this.setData` 驱动 WXML 条件类名。

---

## WXML 结构（新 players-row）

```xml
<view class="players-row">
  <!-- 小新 / 黑棋 -->
  <view class="player-slot {{currentPlayer === 'black' ? 'active' : 'inactive'}}">
    <image class="char-img" src="/images/shinnosuke.png" mode="aspectFit"/>
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
    <image class="char-img" src="/images/boo.png" mode="aspectFit"/>
    <text class="player-name">{{whiteName}}</text>
  </view>
</view>
```

---

## WXSS 关键样式

```css
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
  transition: opacity 0.3s;
}

.player-slot.active  { opacity: 1; }
.player-slot.inactive { opacity: 0.35; filter: grayscale(30%); }

.char-img { width: 72rpx; height: 80rpx; }

.player-slot.active   .player-name { color: #E8873A; }
.player-slot.inactive .player-name { color: #4A6FA5; }

.player-name {
  font-size: 22rpx;
  letter-spacing: 1rpx;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 90rpx;
  font-family: monospace;
}

.vs-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8rpx;
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
}

.chess-piece.black {
  background: radial-gradient(circle at 35% 35%, #6b7280, #1e293b);
  border: 2rpx solid #9ca3af;
}

.chess-piece.black.active {
  border-color: #E8873A;
  box-shadow: 0 0 0 4rpx rgba(232,135,58,0.3);
}

.chess-piece.white {
  background: radial-gradient(circle at 35% 35%, #ffffff, #e5e7eb);
  border: 2rpx solid #aaa;
}

.char-img-active {
  filter: drop-shadow(0 0 6rpx #E8873A);
}

.vs-text {
  font-size: 18rpx;
  font-weight: 700;
  color: #3A3A6A;
  letter-spacing: 3rpx;
  font-family: monospace;
}
```

---

## 不变的部分

- 棋盘区域、底部按钮、结果弹窗保持原样
- 整体深色像素风（`#1A1A2E` 背景）不变
- JS 逻辑、在线模式、悔棋机制不受影响

---

## 验收标准

1. 顶部 banner 展示小新和左卫门图片
2. 当前落子方角色高亮，对方变暗
3. 玩家名正确显示（在线模式显示真实昵称，本地/人机显示默认名）
4. 棋盘宽度不受影响，仍为全宽
