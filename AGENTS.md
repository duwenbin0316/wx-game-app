# AGENTS.md

This file contains guidelines and commands for agentic coding agents working in this WeChat Mini Program project.

## Project Overview

WeChat Mini Program with cloud development features including Cloud Functions, Cloud Database, Cloud Storage, and real-time multiplayer Gomoku game.

## Build/Deploy Commands

### Cloud Functions
```bash
# Deploy cloud functions via WeChat Developer Tools IDE
# Right-click cloudfunctions/quickstartFunctions → "上传并部署-云端安装依赖"

# Alternative: Use provided shell script
./uploadCloudFunction.sh
```

### Development
- Use WeChat Developer Tools for all development and testing
- Mini program root: `miniprogram/`
- Cloud functions root: `cloudfunctions/`
- No npm scripts - testing is manual in simulator

### Testing
- **No automated tests** - test manually in WeChat Developer Tools simulator
- Test cloud functions via `wx.cloud.callFunction()` in mini program
- Test multiplayer features with multiple simulator instances

## Code Style Guidelines

### JavaScript/TypeScript
- **2 spaces indentation** (project.config.json)
- ES6+ features enabled, use async/await for async operations
- Consistent semicolons
- Error handling with try/catch blocks

### WXML Templates
- **Prefer `<view>` over `<button>`** - better styling control
- Use `wx:if` for conditional rendering
- Use `wx:for` with `wx:key` for lists
- Use `bindtap` for click handlers
- **No inline styles** - use WXSS classes

### WXSS Styling
- Use rpx units for responsive design
- Follow BEM-like naming conventions
- Use gradients and shadows sparingly for clean UI
- Prefer `padding` over `margin` for spacing
- Use `box-sizing: border-box` for predictable layouts

### Import Patterns
- **Cloud functions**: CommonJS `require()` for wx-server-sdk
- **Mini program**: No external libraries - use WeChat APIs only
- Cloud function dependencies in `cloudfunctions/*/package.json`

### Naming Conventions
- **Files**: kebab-case (e.g., user-profile)
- **Functions**: camelCase (e.g., onCreateRoom, getRoomList)
- **Variables**: camelCase (e.g., roomList, userInfo)
- **Classes**: PascalCase (rare, mostly functional)
- **Constants**: UPPER_SNAKE_CASE for environment IDs

### State Management
- Use `this.setData({ key: value })` for state updates
- Initialize state in `data: {}` object
- Use observers for reactive data changes in components
- Don't modify `this.data` directly - use `setData()`

### Cloud Function Patterns
- **Single entry point**: `exports.main(event, context)` with switch-case on `event.type`
- **Consistent response format**: `{ success: boolean, data?: any, errMsg?: string }`
- Use `cloud.DYNAMIC_CURRENT_ENV` for environment detection
- Handle database write errors gracefully (e.g., collection exists)
- Always check `result.result` exists before accessing properties

### Error Handling
- Always catch cloud function errors
- Use `wx.showModal` for user-facing errors
- Check for `result && result.result` before accessing nested properties
- Validate required parameters before API calls
- Handle network errors gracefully with user-friendly messages

### Component Patterns
- Use `Page()` for pages, `Component()` for custom components
- Define properties, data, observers, and methods
- Emit events with `this.triggerEvent()`
- Use lifecycle hooks: onLoad, onShow, onHide, onUnload

### File Organization
```
miniprogram/
├── app.js          # Global app config with cloud.init()
├── app.json        # App manifest and page routes
├── pages/          # Page directories with 4 files each
│   ├── index/
│   ├── gomoku/
│   └── online/
├── components/     # Reusable components
└── images/         # Static assets

cloudfunctions/
└── quickstartFunctions/
    ├── index.js    # Cloud function with switch-case handlers
    └── package.json
```

### WeChat API Usage
- **Navigation**: wx.navigateTo(), wx.navigateBack(), wx.showModal()
- **Data storage**: wx.setStorageSync(), wx.getStorageSync()
- **Cloud**: wx.cloud.callFunction(), wx.cloud.database()
- **User info**: wx.getUserProfile() (requires user consent)

### Security
- Never expose sensitive data in client code
- Use cloud functions for server-side operations
- Validate input in cloud functions
- Use WeChat's built-in authentication (wxContext.OPENID)

### UI/UX Best Practices
- Use consistent spacing (20rpx, 30rpx, 50rpx)
- Implement loading states with wx.showLoading()
- Use gradients sparingly for accents only
- Prefer solid backgrounds over gradients
- Add hover effects for interactive elements
- Ensure touch targets are at least 44rpx

### Gomoku Game Features
- **Modes**: local (offline) and online (multiplayer)
- **Room management**: create, join, list, close rooms
- **Game state**: sync via polling every 2 seconds
- **Winner detection**: check 4 directions (horizontal, vertical, 2 diagonals)
- **Board**: 15x15 grid, cells store 'black', 'white', or ''
- **Player colors**: black goes first, white second

### Common Patterns
```javascript
// Cloud function call with error handling
try {
  const result = await wx.cloud.callFunction({
    name: 'quickstartFunctions',
    data: { type: 'getRoomList' }
  });
  if (result.result?.success) {
    this.setData({ rooms: result.result.rooms });
  }
} catch (e) {
  wx.showToast({ title: '网络错误', icon: 'none' });
}

// Conditional rendering
<view wx:if="{{rooms.length === 0}}">空状态</view>
<view wx:elif="{{loading}}">加载中...</view>
<view wx:else>列表内容</view>
```
