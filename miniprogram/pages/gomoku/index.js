Page({
  data: {
    board: [],
    currentPlayer: 'black',
    winner: null,
    boardSize: 15,
    gridSize: 14,
    lineGrid: [],
    points: [],
    mode: 'local', // local or online
    roomId: null,
    myColor: null, // black or white
    myOpenid: null,
    roomInfo: null,
    roomName: '',
    inviteJoin: false,
    inviteFromCreate: false,
    userInfo: null,
    blackName: '玩家1',
    whiteName: '玩家2',
    moveHistory: [],
    canPlay: false,
    canUndo: false,
    myUndoCount: 0,
    undoLimit: 3,
    undoLeft: 0,
    isUndoWaiting: false,
    hasClosedRoom: false,
    isAiMode: false,
    aiDifficulty: 'medium',
    lastMoveKey: '',
    showResult: false,
    resultTitle: '',
    resultSub: '',
    resultIsWin: false
  },

  onLoad(options) {
    const { roomId, mode, roomName, created, invite, ai, difficulty } = options;
    const decodedRoomName = roomName ? decodeURIComponent(roomName) : '';

    this.initBoardMeta();
    this.initAudio();
    this.pendingMove = null;
    this.isUndoModalOpen = false;
    this.lastWinnerNotice = null;

    if (mode === 'online' && roomId) {
      this.setData({
        mode: 'online',
        roomId,
        roomName: decodedRoomName,
        inviteJoin: invite === '1',
        inviteFromCreate: created === '1'
      }, () => {
        if (decodedRoomName) {
          wx.setNavigationBarTitle({ title: `房间：${decodedRoomName}` });
        }
        this.initOnlineGame();
      });
    } else {
      this.setData({
        isAiMode: ai === '1',
        aiDifficulty: difficulty || 'medium'
      }, () => {
        this.initLocalGame();
      });
    }
  },

  onUnload() {
    this.isPageActive = false;
    this.clearWatchRetry();
    this.stopRoomWatch();
    this.stopRoomPolling();
    if (this.data.isUndoWaiting) {
      wx.hideLoading();
      this.setData({ isUndoWaiting: false });
    }
    this.stopUndoPolling();
    if (this.audioContext) {
      this.audioContext.destroy();
      this.audioContext = null;
    }
    if (this.opponentAudioContext) {
      this.opponentAudioContext.destroy();
      this.opponentAudioContext = null;
    }
    // 页面卸载时不自动删除房间，保留房间供其他玩家使用
  },

  onShow() {
    this.isPageActive = true;
    if (this.data.mode === 'online' && this.data.roomId && !this.data.hasClosedRoom) {
      this.startRoomWatch();
      this.startRoomPolling();
      this.pollRoomInfo();
      if (this.data.isUndoWaiting) {
        this.startUndoPolling();
      }
    }
  },

  onHide() {
    this.isPageActive = false;
    this.clearWatchRetry();
    this.stopRoomWatch();
    this.stopRoomPolling();
    if (this.data.isUndoWaiting) {
      wx.hideLoading();
      this.setData({ isUndoWaiting: false });
    }
    this.stopUndoPolling();
    // 页面隐藏时不自动删除房间，保留房间供其他玩家使用
  },

  initLocalGame() {
    const boardSize = this.data.boardSize;
    const board = Array(boardSize).fill(null).map(() => Array(boardSize).fill(''));
    const isAiMode = this.data.isAiMode;
    const diffLabels = { easy: '简单', medium: '普通', hard: '困难' };
    const aiLabel = diffLabels[this.data.aiDifficulty] || '普通';
    this.setData({
      board,
      currentPlayer: 'black',
      winner: null,
      canPlay: true,
      blackName: isAiMode ? '玩家' : '玩家1',
      whiteName: isAiMode ? `电脑(${aiLabel})` : '玩家2',
      moveHistory: [],
      canUndo: false,
      myUndoCount: 0,
      undoLeft: this.data.undoLimit,
      isUndoWaiting: false,
      showResult: false,
      lastMoveKey: ''
    });
    this.lastWinnerNotice = null;
  },

  async initOnlineGame() {
    try {
      wx.showLoading({ title: '加载游戏...' });

      const result = await wx.cloud.callFunction({
        name: 'quickstartFunctions',
        data: {
          type: 'getRoomInfo',
          roomId: this.data.roomId
        }
      });

      if (result.result && result.result.success) {
        const room = result.result.room;

        const openidResult = await wx.cloud.callFunction({
          name: 'quickstartFunctions',
          data: { type: 'getOpenId' }
        });
        const myOpenid = openidResult.result.openid;
        const myColor = room.blackPlayer === myOpenid ? 'black' : 'white';
        const canPlay = room.currentPlayer === myColor && room.status === 'playing';

        const undoState = this.getOnlineUndoState(room, myColor);
        this.setData({
          roomInfo: room,
          roomName: room.name || this.data.roomName,
          board: room.board,
          currentPlayer: room.currentPlayer,
          winner: room.winner,
          myColor,
          myOpenid,
          blackName: room.creatorInfo && room.creatorInfo.nickName ? room.creatorInfo.nickName : '玩家1',
          whiteName: room.whitePlayerInfo && room.whitePlayerInfo.nickName ? room.whitePlayerInfo.nickName : '等待加入...',
          canPlay,
          status: room.status,
          canUndo: undoState.canUndo,
          myUndoCount: undoState.myUndoCount,
          undoLeft: undoState.undoLeft
        });
        this.hasRoomReady = true;
        if (room.name) {
          wx.setNavigationBarTitle({ title: `房间：${room.name}` });
        }

        this.handlePendingUndo(room);

        if (this.data.inviteJoin) {
          await this.tryJoinRoomFromInvite(room, myOpenid);
        }

        if (this.data.inviteFromCreate && !this.hasPromptedInvite) {
          this.hasPromptedInvite = true;
          this.promptInvite();
        }

        this.startRoomWatch();
        this.startRoomPolling();
      } else {
        wx.showToast({
          title: (result.result && result.result.errMsg) || '加载游戏失败',
          icon: 'none'
        });
      }
    } catch (e) {
      console.error('初始化在线游戏失败', e);
      wx.showToast({
        title: '网络错误',
        icon: 'none'
      });
    } finally {
      wx.hideLoading();
    }
  },

  initBoardMeta() {
    const boardSize = this.data.boardSize;
    const gridSize = boardSize - 1;
    const lineGrid = Array(gridSize).fill(0);
    const points = [];
    for (let r = 0; r < boardSize; r++) {
      for (let c = 0; c < boardSize; c++) {
        points.push({ id: `${r}-${c}`, r, c });
      }
    }
    this.setData({ gridSize, lineGrid, points });
  },

  initAudio() {
    if (this.audioContext) return;
    const audioContext = wx.createInnerAudioContext();
    audioContext.src = '/assets/sounds/place.wav';
    audioContext.autoplay = false;
    audioContext.onError((err) => {
      console.error('音效播放失败', err);
    });
    this.audioContext = audioContext;

    const opponentAudioContext = wx.createInnerAudioContext();
    opponentAudioContext.src = '/assets/sounds/place-opponent.wav';
    opponentAudioContext.autoplay = false;
    opponentAudioContext.onError((err) => {
      console.error('对手音效播放失败', err);
    });
    this.opponentAudioContext = opponentAudioContext;
  },

  notifyWinner(winner) {
    if (!winner) return;
    const noticeKey = `${this.data.mode}:${this.data.roomId || 'local'}:${winner}`;
    if (this.lastWinnerNotice === noticeKey) return;
    this.lastWinnerNotice = noticeKey;

    const moveCount = this.data.mode === 'online'
      ? (this.data.roomInfo && this.data.roomInfo.moveHistory ? this.data.roomInfo.moveHistory.length : 0)
      : (this.data.moveHistory || []).length;
    const sub = moveCount ? `共落子 ${moveCount} 步` : '';

    let title, isWin;
    if (this.data.mode === 'online') {
      isWin = winner === this.data.myColor;
      title = isWin ? '你赢了！' : '对手获胜';
    } else if (this.data.isAiMode) {
      isWin = winner === 'black';
      title = isWin ? '你赢了！' : '电脑获胜';
    } else {
      isWin = true;
      title = `${winner === 'black' ? this.data.blackName : this.data.whiteName} 获胜`;
    }

    this.setData({ showResult: true, resultTitle: title, resultSub: sub, resultIsWin: isWin });
  },

  onResultRestart() {
    this.setData({ showResult: false });
    if (this.data.mode === 'online') {
      wx.showModal({
        title: '提示',
        content: '联机模式请创建新房间',
        showCancel: false
      });
      return;
    }
    this.initLocalGame();
  },

  onResultLeave() {
    this.setData({ showResult: false });
    if (this.data.mode === 'online') {
      this.closeRoom();
    }
    wx.navigateBack();
  },

  playPlaceSound() {
    if (!this.audioContext) return;
    try {
      this.audioContext.stop();
      this.audioContext.play();
    } catch (e) {
      console.error('音效播放异常', e);
    }
  },

  playOpponentSound() {
    if (!this.opponentAudioContext) return;
    try {
      this.opponentAudioContext.stop();
      this.opponentAudioContext.play();
    } catch (e) {
      console.error('对手音效播放异常', e);
    }
  },

  async handlePendingUndo(room) {
    const pending = room && room.pendingUndo;
    if (!pending || !pending.byOpenid || !this.data.myOpenid) {
      this.lastUndoPromptKey = null;
      this.isUndoModalOpen = false;
      return;
    }
    if (this.isUndoModalOpen) return;
    if (pending.byOpenid === this.data.myOpenid) return;

    const key = `${pending.byOpenid}-${pending.move && pending.move.row}-${pending.move && pending.move.col}-${pending.move && pending.move.player}`;
    if (this.lastUndoPromptKey === key) return;
    this.lastUndoPromptKey = key;
    this.isUndoModalOpen = true;

    wx.showModal({
      title: '对方请求悔棋',
      content: '是否同意对方悔棋？',
      confirmText: '同意',
      cancelText: '拒绝',
      success: async (res) => {
        try {
          wx.showLoading({ title: '处理中...' });
          const result = await wx.cloud.callFunction({
            name: 'quickstartFunctions',
            data: {
              type: 'respondUndo',
              roomId: this.data.roomId,
              approve: !!res.confirm
            }
          });
          wx.hideLoading();
          if (!result || !result.result || !result.result.success) {
            wx.showToast({
              title: (result && result.result && result.result.errMsg) || '处理失败',
              icon: 'none'
            });
          }
        } catch (e) {
          wx.hideLoading();
          wx.showToast({ title: '网络错误', icon: 'none' });
        }
      },
      complete: () => {
        this.isUndoModalOpen = false;
      }
    });
  },

  async ensureUserInfo() {
    if (this.data.userInfo) return this.data.userInfo;
    try {
      const userInfo = await wx.getUserProfile({
        desc: '用于游戏昵称和头像显示'
      });
      this.setData({ userInfo: userInfo.userInfo });
      return userInfo.userInfo;
    } catch (e) {
      return null;
    }
  },

  async tryJoinRoomFromInvite(room, myOpenid) {
    this.setData({ inviteJoin: false });
    if (!room || room.blackPlayer === myOpenid) return;
    if (room.status !== 'waiting' || room.whitePlayer) {
      wx.showToast({ title: '房间已开始或已满', icon: 'none' });
      return;
    }

    const userInfo = await this.ensureUserInfo();
    if (!userInfo) return;

    try {
      wx.showLoading({ title: '加入房间中...' });
      const joinResult = await wx.cloud.callFunction({
        name: 'quickstartFunctions',
        data: {
          type: 'joinRoom',
          roomId: this.data.roomId,
          playerInfo: userInfo
        }
      });
      wx.hideLoading();

      if (!joinResult.result || !joinResult.result.success) {
        wx.showToast({
          title: (joinResult.result && joinResult.result.errMsg) || '加入房间失败',
          icon: 'none'
        });
        return;
      }

      const refreshResult = await wx.cloud.callFunction({
        name: 'quickstartFunctions',
        data: {
          type: 'getRoomInfo',
          roomId: this.data.roomId
        }
      });
      if (refreshResult.result && refreshResult.result.success) {
        this.applyRoomUpdate(refreshResult.result.room);
      }
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '网络错误', icon: 'none' });
    }
  },

  promptInvite() {
    if (!this.data.roomId) return;
    wx.showModal({
      title: '邀请好友',
      content: '房间已创建，是否立即邀请好友加入？',
      confirmText: '邀请好友',
      cancelText: '稍后',
      success: (res) => {
        if (res.confirm) {
          this.onInviteFriend();
        }
      }
    });
  },

  onInviteFriend() {
    if (!this.data.roomId) return;
    const roomName = this.data.roomName ||
      (this.data.roomInfo && this.data.roomInfo.name) ||
      '联机房间';
    const path = `/pages/gomoku/index?roomId=${this.data.roomId}&mode=online&invite=1&roomName=${encodeURIComponent(roomName)}`;
    if (wx.shareAppMessage) {
      wx.shareAppMessage({
        title: `加入房间：${roomName}`,
        path
      });
    } else {
      wx.showShareMenu({ withShareTicket: false });
      wx.showToast({ title: '请使用右上角分享', icon: 'none' });
    }
  },

  onShareAppMessage() {
    const roomName = this.data.roomName ||
      (this.data.roomInfo && this.data.roomInfo.name) ||
      '联机房间';
    if (this.data.mode !== 'online' || !this.data.roomId) {
      return {
        title: '五子棋对战',
        path: '/pages/online/index'
      };
    }
    return {
      title: `加入房间：${roomName}`,
      path: `/pages/gomoku/index?roomId=${this.data.roomId}&mode=online&invite=1&roomName=${encodeURIComponent(roomName)}`
    };
  },

  startRoomWatch() {
    if (this.roomWatcher || !this.data.roomId) return;
    const db = wx.cloud.database();
    this.clearWatchRetry();
    this.roomWatcher = db.collection('gameRooms')
      .where({ _id: this.data.roomId })
      .watch({
        onChange: (snapshot) => {
          const docs = snapshot.docs || [];
          if (!docs.length) {
            if (snapshot.type === 'init') {
              this.fallbackFetchRoom();
              return;
            }
            wx.showToast({ title: '房间已关闭', icon: 'none' });
            this.stopRoomWatch();
            return;
          }
          this.applyRoomUpdate(docs[0]);
        },
        onError: (err) => {
          console.error('房间监听失败', err);
          this.stopRoomWatch();
          if (!this.isPageActive) return;
          if (err && String(err).includes('CLOSED')) return;
          this.watchRetryTimer = setTimeout(() => {
            if (this.data.mode === 'online' && this.data.roomId) {
              this.startRoomWatch();
            }
          }, 2000);
        }
      });
  },

  stopRoomWatch() {
    if (this.roomWatcher) {
      this.roomWatcher.close();
      this.roomWatcher = null;
    }
  },

  startRoomPolling() {
    if (this.roomPollTimer || !this.data.roomId) return;
    this.roomPollTimer = setInterval(() => {
      if (!this.isPageActive) return;
      this.pollRoomInfo();
    }, 2000);
  },

  stopRoomPolling() {
    if (this.roomPollTimer) {
      clearInterval(this.roomPollTimer);
      this.roomPollTimer = null;
    }
  },

  async pollRoomInfo() {
    try {
      const result = await wx.cloud.callFunction({
        name: 'quickstartFunctions',
        data: {
          type: 'getRoomInfo',
          roomId: this.data.roomId
        }
      });
      if (result.result && result.result.success) {
        this.applyRoomUpdate(result.result.room);
        return;
      }
      const errMsg = result && result.result && result.result.errMsg ? String(result.result.errMsg) : '';
      if (errMsg.includes('Room not found')) {
        if (!this.hasRoomClosedToast) {
          this.hasRoomClosedToast = true;
          wx.showToast({ title: '房间已关闭', icon: 'none' });
        }
        this.stopRoomWatch();
        this.stopRoomPolling();
      }
    } catch (e) {
      // 轮询失败时不提示，避免频繁 toast
      console.error('轮询房间失败', e);
    }
  },

  clearWatchRetry() {
    if (this.watchRetryTimer) {
      clearTimeout(this.watchRetryTimer);
      this.watchRetryTimer = null;
    }
  },

  async fallbackFetchRoom() {
    try {
      const result = await wx.cloud.callFunction({
        name: 'quickstartFunctions',
        data: {
          type: 'getRoomInfo',
          roomId: this.data.roomId
        }
      });
      if (result.result && result.result.success) {
        this.applyRoomUpdate(result.result.room);
      } else {
        const errMsg = result && result.result && result.result.errMsg ? String(result.result.errMsg) : '';
        if (errMsg.includes('Room not found')) {
          wx.showToast({ title: '房间已关闭', icon: 'none' });
        }
      }
    } catch (e) {
      console.error('回退拉取房间失败', e);
    }
  },

  applyRoomUpdate(room) {
    const prevWinner = this.data.winner;
    const undoState = this.getOnlineUndoState(room, this.data.myColor);
    const pendingMove = this.pendingMove;
    const hasPendingMove = !!(pendingMove && typeof pendingMove.row === 'number');
    const serverHasPendingMove =
      hasPendingMove &&
      room &&
      room.board &&
      room.board[pendingMove.row] &&
      room.board[pendingMove.row][pendingMove.col] === pendingMove.player;

    if (hasPendingMove && !serverHasPendingMove) {
      const partialUpdates = {
        roomInfo: room,
        roomName: room.name || this.data.roomName,
        canUndo: this.data.canUndo,
        myUndoCount: this.data.myUndoCount,
        undoLeft: this.data.undoLeft,
        blackName: room.creatorInfo && room.creatorInfo.nickName ? room.creatorInfo.nickName : '玩家1',
        whiteName: room.whitePlayerInfo && room.whitePlayerInfo.nickName ? room.whitePlayerInfo.nickName : '等待加入...'
      };
      if (room.name) {
        wx.setNavigationBarTitle({ title: `房间：${room.name}` });
      }
      this.setData(partialUpdates);
      this.handlePendingUndo(room);
      this.updateUndoLoading(room);
      return;
    }

    if (serverHasPendingMove) {
      this.pendingMove = null;
    }

    const canPlay = room.currentPlayer === this.data.myColor && room.status === 'playing';
    const updates = {
      roomInfo: room,
      roomName: room.name || this.data.roomName,
      currentPlayer: room.currentPlayer,
      winner: room.winner,
      status: room.status,
      canPlay,
      canUndo: undoState.canUndo,
      myUndoCount: undoState.myUndoCount,
      undoLeft: undoState.undoLeft,
      blackName: room.creatorInfo && room.creatorInfo.nickName ? room.creatorInfo.nickName : '玩家1',
      whiteName: room.whitePlayerInfo && room.whitePlayerInfo.nickName ? room.whitePlayerInfo.nickName : '等待加入...'
    };
    if (room.name) {
      wx.setNavigationBarTitle({ title: `房间：${room.name}` });
    }
    const currentBoard = this.data.board;
    const nextBoard = room.board;
    let hasBoardChange = false;
    if (Array.isArray(currentBoard) &&
        Array.isArray(nextBoard) &&
        currentBoard.length === nextBoard.length) {
      const changes = [];
      for (let r = 0; r < nextBoard.length; r++) {
        const nextRow = nextBoard[r] || [];
        const curRow = currentBoard[r] || [];
        for (let c = 0; c < nextRow.length; c++) {
          if (nextRow[c] !== curRow[c]) {
            changes.push({ r, c });
            if (changes.length > 3) break;
          }
        }
        if (changes.length > 3) break;
      }
      if (changes.length > 0 && changes.length <= 3) {
        hasBoardChange = true;
        changes.forEach(({ r, c }) => {
          updates[`board[${r}][${c}]`] = nextBoard[r][c];
        });
        if (changes.length === 1) {
          updates.lastMoveKey = `${changes[0].r}-${changes[0].c}`;
        }
      } else {
        hasBoardChange = changes.length > 0;
        updates.board = nextBoard;
      }
    } else {
      hasBoardChange = true;
      updates.board = nextBoard;
    }
    this.setData(updates);

    this.handlePendingUndo(room);
    this.updateUndoLoading(room);

    const shouldPlayRemoteSound =
      this.hasRoomReady &&
      this.data.myColor &&
      hasBoardChange &&
      room.status === 'playing' &&
      room.currentPlayer === this.data.myColor &&
      room.lastActionType !== 'undo';
    if (shouldPlayRemoteSound) {
      this.playOpponentSound();
    }

    if (!prevWinner && room.winner) {
      this.notifyWinner(room.winner);
      this.stopRoomWatch();
      this.stopRoomPolling();
    }
  },

  async onCellTap(e) {
    if (this.data.winner) return;

    if (this.data.mode === 'online') {
      if (!this.data.canPlay) {
        wx.showToast({ title: '不是你的回合', icon: 'none' });
        return;
      }
    }

    // Block tap during AI's turn
    if (this.data.isAiMode && this.data.currentPlayer === 'white') return;

    const { row, col } = e.currentTarget.dataset;
    const board = this.data.board;

    if (board[row][col] !== '') return;

    if (this.data.mode === 'online') {
      await this.makeOnlineMove(row, col);
    } else {
      this.makeLocalMove(row, col);
    }
  },

  makeLocalMove(row, col) {
    const board = this.data.board.map(rowItem => [...rowItem]);
    const moveHistory = (this.data.moveHistory || []).slice();
    const player = this.data.currentPlayer;
    board[row][col] = player;
    moveHistory.push({ row, col, player });

    const canUndo = this.data.isAiMode
      ? player === 'black'  // AI模式：只有你刚落子（AI未响应）时可悔棋
      : moveHistory.length > 0;
    this.setData({
      board,
      currentPlayer: player === 'black' ? 'white' : 'black',
      moveHistory,
      canUndo,
      lastMoveKey: `${row}-${col}`
    });
    this.playPlaceSound();

    if (this.checkWinner(board, row, col)) {
      this.setData({ winner: board[row][col] });
      this.notifyWinner(board[row][col]);
      return;
    }

    // Trigger AI move after player (black) places
    if (this.data.isAiMode && player === 'black') {
      const thinkRange = { easy: [400, 900], medium: [800, 1800], hard: [1200, 2800] };
      const [min, max] = thinkRange[this.data.aiDifficulty] || [800, 1800];
      const delay = min + Math.random() * (max - min);
      setTimeout(() => {
        if (!this.data.winner && this.data.currentPlayer === 'white') this.makeAiMove();
      }, delay);
    }
  },

  makeAiMove() {
    const board = this.data.board.map(r => [...r]);
    const { boardSize, aiDifficulty, winner } = this.data;
    if (winner) return;

    const empties = [];
    for (let r = 0; r < boardSize; r++)
      for (let c = 0; c < boardSize; c++)
        if (board[r][c] === '') empties.push({ r, c });
    if (!empties.length) return;

    if (aiDifficulty === 'easy') {
      const pick = empties[Math.floor(Math.random() * empties.length)];
      this.makeLocalMove(pick.r, pick.c);
      return;
    }

    // Medium/Hard: heuristic scoring
    let best = null;
    let bestScore = -1;
    const center = (boardSize - 1) / 2;

    for (const { r, c } of empties) {
      const aiScore = this.scoreCell(board, r, c, 'white', boardSize);
      if (aiScore >= 100000) { best = { r, c }; break; }

      const blockScore = this.scoreCell(board, r, c, 'black', boardSize);
      let total = aiScore + blockScore * (aiDifficulty === 'hard' ? 1.3 : 1.1);

      if (aiDifficulty === 'hard') {
        total += (boardSize - Math.abs(r - center) - Math.abs(c - center)) * 0.2;
      }

      if (total > bestScore) { bestScore = total; best = { r, c }; }
    }

    if (best) this.makeLocalMove(best.r, best.c);
  },

  scoreCell(board, row, col, color, boardSize) {
    board[row][col] = color;
    let score = 0;
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (const [dr, dc] of dirs) {
      let cnt = 1;
      let open = 0;
      for (let s = 1; s <= 4; s++) {
        const r = row + dr * s, c = col + dc * s;
        if (r < 0 || r >= boardSize || c < 0 || c >= boardSize) break;
        if (board[r][c] === color) cnt++;
        else { if (board[r][c] === '') open++; break; }
      }
      for (let s = 1; s <= 4; s++) {
        const r = row - dr * s, c = col - dc * s;
        if (r < 0 || r >= boardSize || c < 0 || c >= boardSize) break;
        if (board[r][c] === color) cnt++;
        else { if (board[r][c] === '') open++; break; }
      }
      if (cnt >= 5) { score += 100000; break; }
      else if (cnt === 4) score += open >= 1 ? 10000 : 500;
      else if (cnt === 3) score += open === 2 ? 1000 : (open === 1 ? 200 : 0);
      else if (cnt === 2) score += open === 2 ? 100 : (open === 1 ? 20 : 0);
      else if (cnt === 1) score += open >= 1 ? 5 : 0;
    }
    board[row][col] = '';
    return score;
  },

  async makeOnlineMove(row, col) {
    const prevBoard = this.data.board.map(rowItem => [...rowItem]);
    const prevCurrentPlayer = this.data.currentPlayer;
    const prevWinner = this.data.winner;
    const prevCanPlay = this.data.canPlay;
    const prevCanUndo = this.data.canUndo;
    const nextPlayer = prevCurrentPlayer === 'black' ? 'white' : 'black';
    const boardPath = `board[${row}][${col}]`;
    this.pendingMove = { row, col, player: prevCurrentPlayer, ts: Date.now() };

    this.setData({
      [boardPath]: prevCurrentPlayer,
      currentPlayer: nextPlayer,
      canPlay: false,
      canUndo: false
    });
    this.playPlaceSound();

    try {
      const result = await wx.cloud.callFunction({
        name: 'quickstartFunctions',
        data: {
          type: 'makeMove',
          roomId: this.data.roomId,
          row,
          col
        }
      });

      if (result.result.success) {
        this.setData({
          currentPlayer: result.result.currentPlayer,
          winner: result.result.winner,
          status: result.result.status
        });

        if (!prevWinner && result.result.winner) {
          this.notifyWinner(result.result.winner);
        }
      } else {
        this.pendingMove = null;
        this.setData({
          board: prevBoard,
          currentPlayer: prevCurrentPlayer,
          winner: prevWinner,
          canPlay: prevCanPlay,
          canUndo: prevCanUndo
        });
        wx.showToast({
          title: result.result.errMsg || '落子失败',
          icon: 'none'
        });
      }
    } catch (e) {
      console.error('在线落子失败', e);
      this.pendingMove = null;
      this.setData({
        board: prevBoard,
        currentPlayer: prevCurrentPlayer,
        winner: prevWinner,
        canPlay: prevCanPlay,
        canUndo: prevCanUndo
      });
      wx.showToast({
        title: '网络错误',
        icon: 'none'
      });
    }
  },

  checkWinner(board, row, col) {
    const directions = [
      [[0, 1], [0, -1]],   // 水平
      [[1, 0], [-1, 0]],   // 垂直
      [[1, 1], [-1, -1]],  // 对角线
      [[1, -1], [-1, 1]]   // 反对角线
    ];

    const color = board[row][col];

    for (const direction of directions) {
      let count = 1;

      for (const [dx, dy] of direction) {
        let newRow = row + dx;
        let newCol = col + dy;

        while (newRow >= 0 && newRow < this.data.boardSize &&
               newCol >= 0 && newCol < this.data.boardSize &&
               board[newRow][newCol] === color) {
          count++;
          newRow += dx;
          newCol += dy;
        }
      }

      if (count >= 5) return true;
    }

    return false;
  },

  onRestart() {
    if (this.data.mode === 'online') {
      wx.showModal({
        title: '提示',
        content: '联机模式不支持重新开始，请创建新房间',
        showCancel: false
      });
      return;
    }

    wx.showModal({
      title: '重新开始',
      content: '确定要重新开始游戏吗？',
      success: (res) => {
        if (res.confirm) {
          this.initLocalGame();
        }
      }
    });
  },

  async onUndo() {
    if (this.data.mode === 'online') {
      if (!this.data.roomId) return;
      if (this.data.winner) {
        wx.showToast({ title: '对局已结束', icon: 'none' });
        return;
      }
      const room = this.data.roomInfo;
      if (!room || room.status !== 'playing') {
        wx.showToast({ title: '对局未开始', icon: 'none' });
        return;
      }
      const undoCounts = room.undoCounts || {};
      const myUndoCount = this.data.myColor ? (undoCounts[this.data.myColor] || 0) : 0;
      if (myUndoCount >= this.data.undoLimit) {
        wx.showToast({ title: '悔棋次数已用完', icon: 'none' });
        return;
      }
      const moveHistory = Array.isArray(room.moveHistory) ? room.moveHistory : [];
      if (!moveHistory.length) {
        wx.showToast({ title: '暂无可悔棋', icon: 'none' });
        return;
      }
      const lastMove = moveHistory[moveHistory.length - 1];
      if (!lastMove || lastMove.player !== this.data.myColor) {
        wx.showToast({ title: '只能在自己落子后悔棋', icon: 'none' });
        return;
      }
      if (room.currentPlayer === this.data.myColor) {
        wx.showToast({ title: '请等待对方落子前悔棋', icon: 'none' });
        return;
      }
      const hasActivePending = this.hasActivePendingUndo(room);
      if (hasActivePending) {
        await this.refreshRoomForUndo();
        if (this.hasActivePendingUndo(this.data.roomInfo)) {
          wx.showToast({ title: '已有悔棋请求', icon: 'none' });
          return;
        }
      }
      wx.showModal({
        title: '悔棋',
        content: '向对方发起悔棋请求？',
        success: async (res) => {
          if (!res.confirm) return;
          try {
            wx.showLoading({ title: '等待对方确认...' });
            const result = await wx.cloud.callFunction({
              name: 'quickstartFunctions',
              data: {
                type: 'requestUndo',
                roomId: this.data.roomId
              }
            });
            if (result && result.result && result.result.success) {
              this.setData({ isUndoWaiting: true });
              this.startUndoPolling();
            } else {
              wx.hideLoading();
              const errMsg = result && result.result
                ? (result.result.errMsg || '悔棋失败')
                : '服务器响应异常';
              wx.showToast({ title: errMsg, icon: 'none' });
            }
          } catch (e) {
            wx.hideLoading();
            wx.showToast({ title: '网络错误', icon: 'none' });
          }
        }
      });
      return;
    }

    const moveHistory = (this.data.moveHistory || []).slice();
    if (!moveHistory.length) {
      wx.showToast({ title: '暂无可悔棋', icon: 'none' });
      return;
    }

    const board = this.data.board.map(rowItem => [...rowItem]);
    const lastMove = moveHistory.pop();
    board[lastMove.row][lastMove.col] = '';

    const lastInHistory = moveHistory[moveHistory.length - 1];
    const canUndo = this.data.isAiMode
      ? !!(lastInHistory && lastInHistory.player === 'black')
      : moveHistory.length > 0;
    const prevMove = moveHistory[moveHistory.length - 1];
    this.setData({
      board,
      currentPlayer: this.data.isAiMode ? 'black' : lastMove.player,
      winner: null,
      canPlay: true,
      moveHistory,
      canUndo,
      lastMoveKey: prevMove ? `${prevMove.row}-${prevMove.col}` : ''
    });
    this.lastWinnerNotice = null;
  },

  async refreshRoomForUndo() {
    if (!this.data.roomId) return;
    try {
      const result = await wx.cloud.callFunction({
        name: 'quickstartFunctions',
        data: {
          type: 'getRoomInfo',
          roomId: this.data.roomId
        }
      });
      if (result && result.result && result.result.success) {
        this.applyRoomUpdate(result.result.room);
      }
    } catch (e) {
      // 兜底刷新失败不提示，避免阻断操作
      console.error('刷新房间信息失败', e);
    }
  },

  onBoardTap() {
    // 阻止事件冒泡
  },

  onLeaveRoom() {
    wx.showModal({
      title: '离开房间',
      content: '确定要离开当前房间吗？离开后房间将被关闭。',
      confirmText: '确定离开',
      cancelText: '继续游戏',
      success: (res) => {
        if (res.confirm) {
          this.closeRoom();
          wx.navigateBack();
        }
      }
    });
  },

  closeRoom() {
    if (this.data.hasClosedRoom) return;
    if (this.data.mode !== 'online' || !this.data.roomId) return;

    this.data.hasClosedRoom = true;
    wx.setStorageSync('pendingCloseRoomId', this.data.roomId);

    wx.cloud.callFunction({
      name: 'quickstartFunctions',
      data: {
        type: 'closeRoom',
        roomId: this.data.roomId
      }
    }).then(() => {
      console.log('房间关闭成功');
    }).catch((e) => {
      console.error('关闭房间失败', e);
    });
  },
  getOnlineUndoState(room, myColor) {
    if (!room || !myColor) {
      return { canUndo: false, myUndoCount: 0, undoLeft: 0 };
    }
    const undoCounts = room.undoCounts || {};
    const myUndoCount = undoCounts[myColor] || 0;
    const moveHistory = Array.isArray(room.moveHistory) ? room.moveHistory : [];
    const lastMove = moveHistory.length ? moveHistory[moveHistory.length - 1] : null;
    const isMyLastMove = lastMove && lastMove.player === myColor;
    const undoLeft = Math.max(0, this.data.undoLimit - myUndoCount);
    const hasPendingUndo = this.hasActivePendingUndo(room);
    const canUndo =
      room.status === 'playing' &&
      room.currentPlayer !== myColor &&
      !hasPendingUndo &&
      myUndoCount < this.data.undoLimit &&
      moveHistory.length > 0 &&
      isMyLastMove;
    return { canUndo, myUndoCount, undoLeft };
  },
  hasActivePendingUndo(room) {
    if (!room || !room.pendingUndo || !room.pendingUndo.byOpenid) return false;
    const pendingMove = room.pendingUndo.move;
    const moveHistory = Array.isArray(room.moveHistory) ? room.moveHistory : [];
    const lastMove = moveHistory.length ? moveHistory[moveHistory.length - 1] : null;
    if (!pendingMove || !lastMove) return true;
    return (
      pendingMove.row === lastMove.row &&
      pendingMove.col === lastMove.col &&
      pendingMove.player === lastMove.player
    );
  },
  updateUndoLoading(room) {
    if (!this.data.isUndoWaiting) return;
    const hasActive = room && this.hasActivePendingUndo(room);
    const isMine = room && room.pendingUndo && room.pendingUndo.byOpenid === this.data.myOpenid;
    if (!hasActive || !isMine) {
      wx.hideLoading();
      this.setData({ isUndoWaiting: false });
      this.stopUndoPolling();
    }
  },
  startUndoPolling() {
    if (this.undoPollTimer || !this.data.roomId) return;
    this.undoPollTimer = setInterval(() => {
      if (!this.data.isUndoWaiting || !this.isPageActive) return;
      this.pollRoomInfo();
    }, 2000);
  },
  stopUndoPolling() {
    if (this.undoPollTimer) {
      clearInterval(this.undoPollTimer);
      this.undoPollTimer = null;
    }
  }
});
