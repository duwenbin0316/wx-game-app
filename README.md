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

## CI 自动上传体验版（GitHub Actions）
本项目已配置 GitHub Actions，在推送到 `main`/`master` 后自动上传体验版代码。需要先在仓库 Secrets 中配置：
- `WX_PRIVATE_KEY`：小程序后台生成的 miniprogram-ci 私钥内容（完整内容，包含换行）
- `WX_APPID`：小程序 AppID（可选，默认读取 `project.config.json` 的 `appid`）

流程说明：
1. 在小程序后台「开发」→「开发设置」生成 miniprogram-ci 私钥。
2. 在 GitHub 仓库 Settings → Secrets and variables → Actions 中添加上面的密钥。
3. 推送代码到 `main`/`master`，Actions 会运行并上传体验版。
4. 如需手动上传，可在 Actions 页面运行 `WeChat Mini Program Experience Upload`，并可选填写 `version` 与 `desc`。

注意：若未配置 `WX_PRIVATE_KEY`，工作流会直接失败并提示缺失必需密钥。

## 参考文档
- [微信云开发文档](https://developers.weixin.qq.com/miniprogram/dev/wxcloud/basis/getting-started.html)
