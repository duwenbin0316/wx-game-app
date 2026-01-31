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
    roomInfo: null,
    roomName: '',
    inviteJoin: false,
    inviteFromCreate: false,
    userInfo: null,
    blackName: '玩家1',
    whiteName: '玩家2',
    canPlay: false,
    hasClosedRoom: false
  },

  onLoad(options) {
    const { roomId, mode, roomName, created, invite } = options;
    const decodedRoomName = roomName ? decodeURIComponent(roomName) : '';

    this.initBoardMeta();
    this.initAudio();

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
      this.initLocalGame();
    }
  },

  onUnload() {
    this.isPageActive = false;
    this.clearWatchRetry();
    this.stopRoomWatch();
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
  },

  onHide() {
    this.isPageActive = false;
    this.clearWatchRetry();
    this.stopRoomWatch();
    // 页面隐藏时不自动删除房间，保留房间供其他玩家使用
  },

  initLocalGame() {
    const boardSize = this.data.boardSize;
    const board = Array(boardSize).fill(null).map(() => Array(boardSize).fill(''));
    this.setData({
      board,
      currentPlayer: 'black',
      winner: null,
      canPlay: true,
      blackName: '玩家1',
      whiteName: '玩家2'
    });
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

        this.setData({
          roomInfo: room,
          roomName: room.name || this.data.roomName,
          board: room.board,
          currentPlayer: room.currentPlayer,
          winner: room.winner,
          myColor,
          blackName: room.creatorInfo && room.creatorInfo.nickName ? room.creatorInfo.nickName : '玩家1',
          whiteName: room.whitePlayerInfo && room.whitePlayerInfo.nickName ? room.whitePlayerInfo.nickName : '等待加入...',
          canPlay,
          status: room.status
        });
        this.hasRoomReady = true;
        if (room.name) {
          wx.setNavigationBarTitle({ title: `房间：${room.name}` });
        }

        if (this.data.inviteJoin) {
          await this.tryJoinRoomFromInvite(room, myOpenid);
        }

        if (this.data.inviteFromCreate && !this.hasPromptedInvite) {
          this.hasPromptedInvite = true;
          this.promptInvite();
        }

        this.startRoomWatch();
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
        wx.showToast({ title: '房间已关闭', icon: 'none' });
      }
    } catch (e) {
      console.error('回退拉取房间失败', e);
    }
  },

  applyRoomUpdate(room) {
    const canPlay = room.currentPlayer === this.data.myColor && room.status === 'playing';
    const updates = {
      roomInfo: room,
      roomName: room.name || this.data.roomName,
      currentPlayer: room.currentPlayer,
      winner: room.winner,
      status: room.status,
      canPlay,
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
      } else {
        hasBoardChange = changes.length > 0;
        updates.board = nextBoard;
      }
    } else {
      hasBoardChange = true;
      updates.board = nextBoard;
    }
    this.setData(updates);

    const shouldPlayRemoteSound =
      this.hasRoomReady &&
      this.data.myColor &&
      hasBoardChange &&
      room.status === 'playing' &&
      room.currentPlayer === this.data.myColor;
    if (shouldPlayRemoteSound) {
      this.playOpponentSound();
    }

    if (room.winner) {
      const winnerText = room.winner === this.data.myColor ? '你赢了！' : '对手获胜';
      wx.showToast({
        title: winnerText,
        icon: room.winner === this.data.myColor ? 'success' : 'none'
      });
      this.stopRoomWatch();
    }
  },

  async onCellTap(e) {
    if (this.data.winner) return;

    if (this.data.mode === 'online') {
      if (!this.data.canPlay) {
        wx.showToast({
          title: '不是你的回合',
          icon: 'none'
        });
        return;
      }
    }

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
    const board = this.data.board;
    board[row][col] = this.data.currentPlayer;

    this.setData({
      board,
      currentPlayer: this.data.currentPlayer === 'black' ? 'white' : 'black'
    });
    this.playPlaceSound();

    if (this.checkWinner(board, row, col)) {
      this.setData({
        winner: board[row][col]
      });
      wx.showToast({
        title: `${board[row][col] === 'black' ? '黑棋' : '白棋'}获胜！`,
        icon: 'success'
      });
    }
  },

  async makeOnlineMove(row, col) {
    const prevBoard = this.data.board.map(rowItem => [...rowItem]);
    const prevCurrentPlayer = this.data.currentPlayer;
    const prevWinner = this.data.winner;
    const prevCanPlay = this.data.canPlay;
    const nextPlayer = prevCurrentPlayer === 'black' ? 'white' : 'black';
    const boardPath = `board[${row}][${col}]`;

    this.setData({
      [boardPath]: prevCurrentPlayer,
      currentPlayer: nextPlayer,
      canPlay: false
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

        if (result.result.winner) {
          const winnerText = result.result.winner === this.data.myColor ? '你赢了！' : '对手获胜';
          wx.showToast({
            title: winnerText,
            icon: result.result.winner === this.data.myColor ? 'success' : 'none'
          });
        }
      } else {
        this.setData({
          board: prevBoard,
          currentPlayer: prevCurrentPlayer,
          winner: prevWinner,
          canPlay: prevCanPlay
        });
        wx.showToast({
          title: result.result.errMsg || '落子失败',
          icon: 'none'
        });
      }
    } catch (e) {
      console.error('在线落子失败', e);
      this.setData({
        board: prevBoard,
        currentPlayer: prevCurrentPlayer,
        winner: prevWinner,
        canPlay: prevCanPlay
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
  }
});
