# CLAUDE.md

This file provides guidance for AI assistants (Claude and others) working in this WeChat Mini Program game hub repository.

## Project Overview

A WeChat Mini Program game hub featuring four games (Gomoku/Five-in-a-Row, Tetris, Sokoban, Runner) with real-time multiplayer infrastructure powered by Tencent CloudBase (TCB). The app uses native WeChat APIs exclusively — no external UI libraries.

- **AppID**: `wxe5b06e8c6ba926fc`
- **Library Version**: 2.20.1
- **Cloud Platform**: Tencent CloudBase / WeChat Cloud Development

---

## Repository Structure

```
wx-game-app/
├── miniprogram/                  # Frontend (WeChat Mini Program)
│   ├── app.js                    # Global init + wx.cloud.init()
│   ├── app.json                  # App manifest with page routes
│   ├── app.wxss                  # Global styles
│   ├── pages/
│   │   ├── home/                 # Game launcher hub (pixel art logo)
│   │   ├── gomoku/               # Five-in-a-row, online + offline (~1180 lines)
│   │   ├── online/               # Multiplayer lobby, room list (~363 lines)
│   │   ├── runner/               # Platformer game (~822 lines)
│   │   ├── sokoban/              # Puzzle game, 8 levels (~480 lines)
│   │   └── tetris/               # Tetris with SRS rotations (~807 lines)
│   ├── components/
│   │   └── cloudTipModal/        # Reusable modal for cloud setup tips
│   ├── assets/sounds/            # place.wav, place-opponent.wav
│   ├── images/icons/             # UI icons and sprites
│   └── envList.js                # Cloud environment ID list
│
├── cloudfunctions/
│   └── quickstartFunctions/      # Single cloud function gateway (~882 lines)
│       ├── index.js              # Switch-case on event.type, 15+ handlers
│       └── package.json          # wx-server-sdk ~2.4.0
│
├── .github/workflows/
│   ├── deploy-cloud.yml          # Deploy cloud functions on cloudfunctions/** push
│   └── upload.yml                # Upload mini program v1.3.0 on miniprogram/** push
│
├── .mini-wiki/wiki/              # Auto-generated architecture docs (mermaid diagrams)
├── project.config.json           # WeChat DevTools config (compiler, source maps)
├── cloudbaserc.json              # Cloud DB environment and function list
├── AGENTS.md                     # Developer guidelines (code style, patterns)
└── README.md                     # Chinese quickstart guide
```

Each page directory contains exactly 4 files: `index.js`, `index.json`, `index.wxml`, `index.wxss`.

---

## Build and Deployment

### There Are No npm Build Scripts

Development, testing, and deployment are WeChat-tooling driven:

- **Dev/Test**: Open project in WeChat Developer Tools — the simulator handles compilation
- **Deploy cloud functions**: Right-click `cloudfunctions/quickstartFunctions` in WeChat DevTools → "上传并部署-云端安装依赖" (or use `uploadCloudFunction.sh`)
- **Upload mini program**: Use WeChat Developer Tools upload button

### CI/CD (GitHub Actions)

Two automated workflows trigger on pushes to `master`:
- **`deploy-cloud.yml`**: Fires when `cloudfunctions/**` changes → deploys to TCB via `@cloudbase/cli`
- **`upload.yml`**: Fires when `miniprogram/**` changes → uploads v1.3.0 via `miniprogram-ci`

### Environment Configuration

Cloud environment ID comes from `miniprogram/envList.js`. Local development uses `.env.local` (not committed, contains `ENV_ID`).

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | WeChat Mini Program (native WXML/WXSS/JS) |
| Rendering | HTML5 Canvas 2D API (all games) |
| Audio | WeChat `InnerAudioContext` |
| Backend | Serverless Node.js (Tencent CloudBase) |
| Database | Cloud Database (MongoDB-compatible) |
| Real-time | `db.watch()` with 2-second polling fallback |
| Auth | WeChat's built-in `wxContext.OPENID` |
| State | Page-local via `this.setData()`, Cloud DB for multiplayer |

**No external UI libraries** — only `wx-server-sdk` in cloud functions.

---

## Code Style Conventions

### JavaScript

- **Indentation**: 2 spaces (enforced by project.config.json)
- **Syntax**: ES6+ with async/await; CommonJS `require()` in cloud functions
- **Semicolons**: Required
- **Async errors**: Always wrap cloud calls in `try/catch`

### Naming

| Item | Convention | Example |
|------|-----------|---------|
| Files | kebab-case | `cloud-tip-modal` |
| Functions | camelCase | `onCreateRoom`, `getRoomList` |
  | Variables | camelCase | `roomList`, `userInfo` |
| Constants (env IDs) | UPPER_SNAKE_CASE | `ENV_ID` |

### WXML Templates

- Prefer `<view>` over `<button>` for better styling control
- Use `wx:if` / `wx:elif` / `wx:else` for conditional rendering
- Always add `wx:key` on `wx:for` loops
- Use `bindtap` for click handlers; no inline styles — use WXSS classes

### WXSS Styles

- Use `rpx` units for responsive layout (750rpx = full screen width)
- BEM-like naming for component classes
- `box-sizing: border-box` for predictable layouts
- Minimum touch target: 44rpx

### State Management

- **Always** use `this.setData({ key: value })` — never mutate `this.data` directly
- Initialize all state in the `data: {}` block
- Use `observers` in `Component()` for reactive computed values

---

## Cloud Function Patterns

### Entry Point Structure

All cloud operations go through a single function using a `switch` on `event.type`:

```javascript
exports.main = async (event, context) => {
  const { type } = event;
  switch (type) {
    case 'createRoom': return await createRoom(event, context);
    case 'makeMove':   return await makeMove(event, context);
    // ...
    default: return { success: false, errMsg: 'Unknown type' };
  }
};
```

### Consistent Response Format

```javascript
// Success
return { success: true, data: result };

// Error
return { success: false, errMsg: 'Descriptive message' };
```

### Calling Cloud Functions (Client Side)

```javascript
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
```

Always check `result.result?.success` before accessing data. Use optional chaining.

### Authentication

User identity is from WeChat's runtime — never trust client-provided openid:

```javascript
const wxContext = cloud.getWXContext();
const openid = wxContext.OPENID;  // Always use this
```

---

## Game Architecture

### Board Games (Gomoku)

- **Board**: 15×15 array of `'black'` | `'white'` | `''`
- **Rendering**: Two canvas layers — grid lines (static) + intersection points (interactive)
- **Win detection**: Check 4 directions from last move; 5+ consecutive pieces wins
- **Undo system**: Max 3 undos per player; opponent must approve via `pendingUndo` field
- **Online sync**: `db.watch()` on the room document + 2-second polling fallback

### Cloud Database Schema (gameRooms collection)

```javascript
{
  _id: string,
  name: string,
  creatorOpenid: string,
  creatorInfo: { nickName, avatarUrl },
  status: 'waiting' | 'playing' | 'finished',
  board: string[15][15],
  currentPlayer: 'black' | 'white',
  blackPlayer: string,          // creator's openid
  whitePlayer: string | null,   // joiner's openid
  whitePlayerInfo: { nickName, avatarUrl },
  winner: string | null,
  moveHistory: [{ row, col, player, ts }],
  pendingUndo: { byOpenid, byColor, move, at } | null,
  undoCounts: { black: number, white: number },  // max 3 each
  lastActionAt: Date
}
```

### Tetris

- Implements SRS (Super Rotation System) spawn orientations
- Game-controller style controls: left-hand movement, right-hand actions
- Auto-repeat on held buttons

### Sokoban

- 8 levels with carefully designed puzzles
- Leveldata stored inline in `index.js`
- Player and box positions tracked as coordinate pairs

### Runner

- Canvas-based platformer with pixel art rendering
- Double jump, enemy spawning, collision detection

---

## WeChat APIs Reference

| Purpose | API |
|---------|-----|
| Navigate to page | `wx.navigateTo({ url })` |
| Go back | `wx.navigateBack()` |
| Show dialog | `wx.showModal({ title, content })` |
| Show toast | `wx.showToast({ title, icon })` |
| Loading indicator | `wx.showLoading()` / `wx.hideLoading()` |
| Local storage (sync) | `wx.setStorageSync()` / `wx.getStorageSync()` |
| Cloud function call | `wx.cloud.callFunction({ name, data })` |
| Database access | `wx.cloud.database()` |
| User profile | `wx.getUserProfile()` (requires consent) |
| Audio | `wx.createInnerAudioContext()` |
| Canvas | `wx.createCanvasContext()` / Canvas 2D API |

---

## Security Guidelines

- **Never** expose sensitive data in client-side `miniprogram/` code
- All game rule validation and state mutations happen in cloud functions, not the client
- Always use `wxContext.OPENID` from the server — never trust `event.openid` from client
- Validate all required parameters in cloud functions before DB operations
- Handle missing/malformed data defensively (check for null/undefined before property access)

---

## Common Pitfalls

1. **`setData` with nested objects**: Always use dot-path notation (`'obj.key': value`) to update nested fields without overwriting siblings.

2. **Canvas contexts**: `miniprogram/` uses `wx.createCanvasContext()` for compatibility; always call `ctx.draw()` after drawing operations.

3. **Cloud DB watches**: Call `watcher.close()` in `onUnload()` to prevent memory leaks on page navigation.

4. **Room state race conditions**: Cloud functions use `db.runTransaction()` for atomic moves to prevent simultaneous-move corruption.

5. **`result.result`**: Cloud function results are double-wrapped — `callFunction()` returns `{ result: { success, data } }`.

6. **WXSS units**: Use `rpx` (not `px`) everywhere for responsive layout. 1rpx = 0.5px on iPhone 6 (750rpx design width).

---

## Testing

No automated test suite exists. All testing is manual:

- **Simulator**: WeChat Developer Tools built-in simulator for single-player testing
- **Multiplayer**: Use "多账号调试" (multi-account simulator) in DevTools — opens two simultaneous instances
- **Cloud functions**: Test via `wx.cloud.callFunction()` calls from the simulator console
- **Cloud DB**: Inspect and edit records directly in WeChat Developer Tools cloud panel

---

## Documentation

- **`.mini-wiki/wiki/`** — Auto-generated architecture docs with Mermaid diagrams:
  - `index.md` — Project overview
  - `architecture.md` — System design and data flow sequence diagrams
  - `getting-started.md` — Setup, deployment, troubleshooting
- **`AGENTS.md`** — Developer code style guidelines and common snippets
- **`README.md`** — Chinese quickstart guide for WeChat developers
