# 微信小程序游戏合集

基于微信小程序云开发实现的游戏合集，包含四款游戏：联机五子棋、俄罗斯方块、推箱子、跑酷。全部使用原生微信 API，无第三方 UI 库。

## 游戏列表

| 游戏 | 说明 |
|------|------|
| **五子棋** | 15×15 棋盘，支持本地双人与联机对战、悔棋、音效 |
| **俄罗斯方块** | SRS 标准旋转系统，游戏手柄式操控布局 |
| **推箱子** | 8 关精心设计的关卡，逐关解锁 |
| **跑酷** | 像素风横版跑酷，双跳 + 障碍物闪避 |

## 功能概览

- **联机大厅**：创建/加入房间、房间列表实时刷新
- **邀请好友**：创建房间后可直接邀请好友加入
- **五子棋对局**：交叉点落子、星位标记、悔棋（每人最多 3 次，需对方确认）
- **音效反馈**：自己/对手落子音效区分
- **云函数后端**：统一入口处理房间创建、加入、落子、修复与清理

## 目录结构

```
miniprogram/          小程序前端
  pages/
    home/             游戏合集首页
    gomoku/           五子棋（含联机）
    online/           联机大厅
    tetris/           俄罗斯方块
    sokoban/          推箱子
    runner/           跑酷
  components/
    cloudTipModal/    云开发提示弹窗组件
cloudfunctions/
  quickstartFunctions/  云函数统一入口
```

## 快速开始

1. 使用微信开发者工具导入项目根目录
2. 配置云环境 ID（`miniprogram/envList.js`）
3. 部署云函数  
   在开发者工具中右键 `cloudfunctions/quickstartFunctions` → "上传并部署-云端安装依赖"
4. 启动模拟器，从首页选择游戏体验

## 云函数说明

云函数统一入口：`cloudfunctions/quickstartFunctions/index.js`

常用 `type`：

| type | 说明 |
|------|------|
| `createRoom` | 创建房间 |
| `getRoomList` | 获取房间列表 |
| `joinRoom` | 加入房间 |
| `makeMove` | 落子 |
| `getRoomInfo` | 获取房间信息 |
| `requestUndo` | 申请悔棋 |
| `respondUndo` | 响应悔棋 |
| `closeRoom` | 关闭房间 |
| `clearAllRooms` | 清空所有房间 |
| `repairRooms` | 修复历史房间字段异常 |

## 本地调试与多账号

使用"云开发本地调试" + 多账号模拟器可进行联机测试。  
若加入房间异常，先确保**云函数已重新部署**，必要时调用 `repairRooms` 修复历史数据。

## CI/CD

推送到 `master` 分支自动触发：
- `cloudfunctions/**` 变更 → 自动部署云函数到 TCB
- `miniprogram/**` 变更 → 自动上传小程序 v1.3.0

## 文档

- **`.mini-wiki/wiki/`** — 架构文档与 Mermaid 流程图
- **`CLAUDE.md`** — AI 助手代码库指南
- **`AGENTS.md`** — 开发规范与常用代码片段

## 参考文档

- [微信云开发文档](https://developers.weixin.qq.com/miniprogram/dev/wxcloud/basis/getting-started.html)
- [微信小程序开发文档](https://developers.weixin.qq.com/miniprogram/dev/framework/)
