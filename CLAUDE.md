# CLAUDE.md

This file provides guidance for AI assistants (Claude and others) working in this WeChat Mini Program game hub repository.

## Project Overview

A WeChat Mini Program game hub featuring seven entries — Gomoku (online + offline), Runner, Sokoban, Tetris, Sky Wing (vertical shmup), Snake, and 2048 — with real-time Gomoku multiplayer powered by Tencent CloudBase (TCB). Several games share a pixel-art mascot, Clawd (`miniprogram/utils/clawd.js`). The app uses native WeChat APIs exclusively — no external UI libraries.

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
│   │   ├── home/                 # Game launcher hub (pixel art logo, game list)
│   │   ├── online/               # Gomoku lobby: room list, create/join (~360 lines)
│   │   ├── gomoku/               # Five-in-a-row, online + offline, canvas board (~1730 lines)
│   │   ├── tetris/               # SRS kicks, T-Spin/B2B/combo, chiptune BGM, wooden 3D look (~1250 lines)
│   │   ├── runner/               # "Claude 快跑": coins combo, coffee shield (~1150 lines)
│   │   ├── sokoban/              # Puzzle game, 10 levels (~720 lines)
│   │   ├── snake/                # Snake eating bugs (~620 lines)
│   │   ├── game2048/             # Pixel 2048 with share card (~600 lines)
│   │   └── skywing/              # "苍穹之翼" vertical shmup: 3 stages, bosses, upgrades, medals (~1570 lines)
│   ├── utils/
│   │   ├── clawd.js              # Shared Clawd sprite (COLORS, GRID_COLS/ROWS, buildSprite, drawClawd)
│   │   ├── gomoku-ai.js          # Gomoku AI: 5-tuple eval, easy/medium greedy, hard alpha-beta (pure, node-testable)
│   │   ├── gomoku-board.js       # Gomoku canvas renderer (wood board, stones, drop/win animations, hit test)
│   │   ├── wood-art.js           # Shared wooden 3D canvas art: wood grain, cube atlases (any palette), tray (floor/rim), slab, socket, burned text
│   │   ├── tetris-sfx.js         # Tetris wood SFX synthesis (modal impacts, cracks, debris, boom; pure, node-testable)
│   │   ├── runner-wood.js        # Runner wooden stage scenery (backdrop, moon, clouds, town strip, ground tile; pure)
│   │   ├── sky-data.js           # Sky Wing data: enemies, flight paths, stage scripts, bosses, upgrades (pure, node-testable)
│   │   ├── sky-art.js            # Sky Wing vector sprite atlas (3×, outlined ships, bosses, FX) + flash/shadow variants
│   │   ├── sky-terrain.js        # Sky Wing procedural terrain chunks (fbm heightfield, hillshade, contours, villages/roads/stations)
│   │   └── sky-audio.js          # Sky Wing WebAudio SFX + step-sequencer music (battle / boss)
│   ├── styles/
│   │   └── wood.wxss             # Shared wooden UI theme: wood-page/header/knob/plate/console/key, overlay plaque
│   ├── components/
│   │   └── cloudTipModal/        # Reusable modal for cloud setup tips
│   ├── assets/sounds/            # Gomoku place sounds + Tetris SFX (level-up/game-over + baked wood SFX fallbacks)
│   ├── images/icons/             # UI icons and sprites
│   └── envList.js                # Cloud environment ID list
│
├── cloudfunctions/
│   └── quickstartFunctions/      # Single cloud function gateway (~1080 lines)
│       ├── index.js              # Switch-case on event.type (rooms, sample CRUD)
│       └── package.json          # wx-server-sdk ~2.4.0
│
├── .github/workflows/
│   ├── deploy-cloud.yml          # Deploy cloud functions on cloudfunctions/** push
│   └── upload.yml                # Upload mini program on miniprogram/** push (version in APP_VERSION)
│
├── scripts/
│   └── gen-tetris-sfx.js         # Bakes Tetris wood SFX fallback mp3s (needs ffmpeg)
├── openspec/                     # OpenSpec specs (specs/) and change proposals (changes/)
├── docs/superpowers/             # Design specs and implementation plans
├── .mini-wiki/wiki/              # Auto-generated architecture docs (mermaid diagrams)
├── project.config.json           # WeChat DevTools config (compiler, source maps)
├── cloudbaserc.json              # Cloud env (cloud1-8gt2mwuq5b21c8ab) and function list
├── uploadCloudFunction.sh        # CLI helper to deploy the cloud function
├── AGENTS.md                     # Developer guidelines (code style, patterns)
└── README.md                     # Chinese quickstart guide
```

### Adding a New Game

1. Create `miniprogram/pages/<id>/` with the 4 standard files.
2. Register the route in `miniprogram/app.json` → `pages`.
3. Add an entry (`id`, `name`, `desc`, `url`) to the `games` array in `miniprogram/pages/home/index.js`.
4. Reuse `utils/clawd.js` for the mascot sprite instead of redrawing it.

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
- **`upload.yml`**: Fires when `miniprogram/**` changes → uploads via `miniprogram-ci`; version comes from `APP_VERSION` in the workflow (currently `1.3.0`) and is injected into `pages/online/index.js` (replacing `version: 'dev'`)

### Environment Configuration

Cloud environment ID comes from `miniprogram/envList.js` and `cloudbaserc.json` (`cloud1-8gt2mwuq5b21c8ab`). `.env.local` is tracked in the repo and holds `ENV_ID` / `AI_DEFAULT_AGENT`.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | WeChat Mini Program (native WXML/WXSS/JS) |
| Rendering | Canvas 2D (`<canvas type="2d">` node API) for all games, including the Gomoku board |
| Audio | WeChat `InnerAudioContext` |
| Backend | Serverless Node.js (Tencent CloudBase) |
| Database | Cloud Database (MongoDB-compatible): `gameRooms` |
| Real-time | `db.watch()` with 2-second polling fallback |
| Auth | WeChat's built-in `wxContext.OPENID` |
| State | Page-local via `this.setData()`; best scores in local storage; Cloud DB for multiplayer |

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

### Gomoku (online + offline)

- **Flow**: `home` → `online` (lobby: room list, create/join) → `gomoku` (board)
- **Board**: 15×15 array of `'black'` | `'white'` | `''` in `data.board`, drawn on `<canvas id="board-canvas">` by `utils/gomoku-board.js`. The page wraps `setData` so every update redraws the board; taps go through `onBoardTouch` → `hitTest` → `onCellTap(row, col)`
- **Local features**: tap-to-confirm placement, move numbers (prefs in `gomoku_prefs`), 3 hints per game, post-game review from move history, AI win/loss record (`gomoku_ai_record`)
- **AI**: `chooseMove(board, color, level)` in `utils/gomoku-ai.js`; hard uses iterative-deepening alpha-beta with a time budget (keeps iOS responsive)
- **Win detection**: `checkWinner()` in the cloud function checks 4 directions from the last move; 5+ consecutive pieces wins
- **Undo**: max 3 per player (`MAX_UNDO_COUNT`); opponent must approve via `pendingUndo`
- **Rematch**: request/approve via `requestRestart` / `respondRestart` (`pendingRestart`); `restartRoom` is kept only for old clients. `flipTable` ends the game.
- **Online sync**: `db.watch()` on the room document with auto-retry, plus a 2-second polling fallback
- **Legacy data**: `repairRooms` / `normalizeRoomBoardIfNeeded` backfill missing `pendingUndo` / `undoCounts` and fix malformed boards
- **Look**: lobby and game page use the shared wood theme (`styles/wood.wxss`: `wood-bg` scrolling background, wood plates/keys, plaque result dialog); the board frame is a CSS walnut rim with brass nails around the canvas

### Cloud Database Schema

`gameRooms`:

```javascript
{
  _id: string,
  name: string,                 // trimmed, max 20 chars; defaults to "<nickName>的房间"
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
  pendingUndo: { byOpenid, byColor, move, at } | {},   // {} when none
  pendingRestart: { ... } | {},                        // {} when none
  undoCounts: { black: number, white: number },         // max 3 each
  lastActionType: string,       // create | join | move | flip | restart | restartRequest | restartRejected | undo | undo_request | undo_reject | undo_stale_clear
  createdAt: Date,
  lastActionAt: Date
}
```

### Single-Player Games

All render on a `<canvas type="2d">` node (queried via `wx.createSelectorQuery().fields({ node: true, size: true })`, scaled by `pixelRatio`) and most drive the loop with `requestAnimationFrame`.

| Game | Notes | Local storage key |
|------|-------|-------------------|
| Tetris | SRS rotations + wall kicks, T-Spin / B2B / combo, hold/next, controller-style buttons with auto-repeat, chiptune BGM + SFX. Wooden 3D look: blocks are oblique-projected wooden cubes (top face lifted up-left by `h`, south/east sides visible) drawn row-by-row top→bottom so later cubes occlude earlier sides; tray floor drawn under cubes, rim over them; board cells store type + grain variant (e.g. `'T2'`). Line clears are tiered via `CLEAR_FX` (1–4 lines: duration, column sweep, wood-chip particles, shake, label size; 4 lines adds gold shockwave/sparks) with a gravity "settle" of the rows above; all piece SFX (move/rotate/hold/lock/hard drop/clears) are physically-modelled wood sounds from `utils/tetris-sfx.js` (modal wood impacts, fracture crackle, splinter debris, boom), rendered into WebAudio buffers at load and played through a compressed SFX bus; clears escalate crack → smash → wooden explosion, combo raises playbackRate; without WebAudio the mp3s baked by `scripts/gen-tetris-sfx.js` are used | `tetris_best` |
| Runner | Endless runner: coin combos, coffee shield, death animation. Wooden dusk-stage look from `utils/runner-wood.js` (painted plank backdrop with nail stars + maple moon, plywood clouds, 2-screen town strip, tiling oak-beam ground), baked once and blitted; scroll distance in `_woodScroll` | `runner_best` |
| Sokoban | 10 verified levels, level data inline in `index.js`. Wooden look: per-level floor layer (oak parquet + burned target rings), walnut wall / crate cubes from an atlas with `decorateBlock` (planks, brace, nails, burned check when on target), drawn row by row and column-sorted within a row so 3D sides occlude correctly; controls stay in layout (hidden, not removed) so the canvas never stretches | `sokoban_best`, `sokoban_unlocked` |
| Snake | Clawd eats bugs. Wooden look: walnut tray via `trayMetrics`/`buildTray` (rows fitted to the canvas), body is a chain of orange-stained wood cubes darkening toward the tail, head cube carries Clawd eyes | `snake_best` |
| 2048 | Swipe merge, off-screen canvas share card. Wooden look: board is a `drawSlab` with carved sockets (baked once), tiles are stained-wood blocks with burned numbers cached per value; slide/merge use wood SFX buffers from `tetris-sfx.js` | `game2048_best` |
| Sky Wing | Vertical shmup in virtual 360-wide coords; plane follows the finger, lifting it eases the battle into slow motion (`SLOW_SCALE`); terrain generated in 240-unit chunks at 2× resolution a few rows per frame (time-budgeted) and converted to images; sprite atlas drawn at 3× with dark outlines; stars bought upgrades in the hangar; per-stage medals (kill 70% / 100% / no damage); boss core opens only after all parts are destroyed | `skywing_save` (stars, upgrades, unlocked, medals, best) |

### Sharing

Most game pages implement `onShareAppMessage` (not yet Sokoban). Share text reports the current run's result only after a game has started; otherwise it uses a plain invite message.

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

2. **Canvas**: Pages use the Canvas 2D node API (`<canvas type="2d" id="...">` + `node.getContext('2d')`), not the legacy `wx.createCanvasContext()`/`ctx.draw()`. Set `node.width/height` to CSS size × `pixelRatio` and `ctx.scale(dpr, dpr)`. Stop animation loops/timers in `onHide`/`onUnload`.

3. **Cloud DB watches**: Call `watcher.close()` and clear retry/poll timers in `onUnload()` to prevent memory leaks on page navigation. Watch pushes deliver `Date` objects while polling returns ISO strings — normalize timestamps before comparing.

4. **Room state race conditions**: `makeMove` does read → validate (status, turn owner, empty cell) → `update`, without `db.runTransaction()`. Server-side turn checks prevent most conflicts, but keep this in mind when adding concurrent actions.

5. **`result.result`**: Cloud function results are double-wrapped — `callFunction()` returns `{ result: { success, data } }`.

6. **WXSS units**: Use `rpx` (not `px`) everywhere for responsive layout. 1rpx = 0.5px on iPhone 6 (750rpx design width).

---

## Workflow Conventions

After making and committing changes, **always push directly to `master`** — GitHub Actions will handle deployment automatically. Tell the user once that the push is done so they can monitor the Action and verify the result themselves.

## Testing

No automated test suite exists. All testing is manual:

- **Simulator**: WeChat Developer Tools built-in simulator for single-player testing
- **Multiplayer**: Use "多账号调试" (multi-account simulator) in DevTools — opens two simultaneous instances
- **Cloud functions**: Test via `wx.cloud.callFunction()` calls from the simulator console
- **Cloud DB**: Inspect and edit records directly in WeChat Developer Tools cloud panel
- **Syntax check** (outside DevTools): `node --check miniprogram/pages/<page>/index.js`

---

## Documentation

- **`.mini-wiki/wiki/`** — Auto-generated architecture docs with Mermaid diagrams:
  - `index.md` — Project overview
  - `architecture.md` — System design and data flow sequence diagrams
  - `getting-started.md` — Setup, deployment, troubleshooting
- **`openspec/`** — Feature specs (`specs/`) and archived change proposals (`changes/archive/`)
- **`docs/superpowers/`** — Design specs and implementation plans
- **`AGENTS.md`** — Developer code style guidelines and common snippets
- **`README.md`** — Chinese quickstart guide for WeChat developers
