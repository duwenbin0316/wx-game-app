# 联机五子棋小程序（WeChat Mini Program）

基于微信小程序云开发实现的联机五子棋示例，包含本地对弈与联机对战、房间管理、邀请分享、实时同步与音效反馈。

## 功能概览
- 联机大厅：创建/加入房间、房间列表实时刷新
- 邀请加入：创建房间后可直接邀请好友进入
- 对局体验：交叉点落子（15×15 落子点 / 14×14 格）、星位标记
- 音效反馈：自己/对手落子音效区分
- 云函数后端：统一入口处理房间创建、加入、落子、修复与清理

## 目录结构
```
miniprogram/          小程序前端
cloudfunctions/       云函数
```

## 快速开始
1. 使用微信开发者工具导入项目根目录
2. 配置云环境 ID（`miniprogram/app.js` 的 `globalData.env`）
3. 部署云函数  
   在开发者工具中右键 `cloudfunctions/quickstartFunctions` → “上传并部署-云端安装依赖”
4. 启动模拟器，进入联机大厅进行体验

## 云函数说明
云函数统一入口：`cloudfunctions/quickstartFunctions/index.js`

常用 `type`：
- `createRoom` 创建房间
- `getRoomList` 获取房间列表
- `joinRoom` 加入房间
- `makeMove` 落子
- `getRoomInfo` 获取房间信息
- `closeRoom` 关闭房间
- `clearAllRooms` 清空房间
- `repairRooms` 修复历史房间字段异常

## 本地调试与多账号
使用“云开发本地调试”+ 多账号模拟器可进行联机测试。  
若加入房间异常，先确保**云函数已重新部署**，必要时调用 `repairRooms` 修复历史数据。

## 文档
项目文档位于 `.mini-wiki/wiki/`，入口：
- `.mini-wiki/wiki/index.md`

## 参考文档
- [微信云开发文档](https://developers.weixin.qq.com/miniprogram/dev/wxcloud/basis/getting-started.html)
