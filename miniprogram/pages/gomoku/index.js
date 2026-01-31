Page({
  data: {
    board: [],
    currentPlayer: 'black',
    winner: null,
    boardSize: 15,
    mode: 'local', // local or online
    roomId: null,
    myColor: null, // black or white
    roomInfo: null,
    canPlay: false,
    hasClosedRoom: false
  },

  onLoad(options) {
    const { roomId, mode } = options;

    if (mode === 'online' && roomId) {
      this.setData({ mode: 'online', roomId }, () => {
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
      canPlay: true
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

      if (result.result.success) {
        const room = result.result.room;

        wx.cloud.callFunction({
          name: 'quickstartFunctions',
          data: { type: 'getOpenId' }
        }).then(openidResult => {
          const myOpenid = openidResult.result.openid;
          const myColor = room.blackPlayer === myOpenid ? 'black' : 'white';
          const canPlay = room.currentPlayer === myColor && room.status === 'playing';

          this.setData({
            roomInfo: room,
            board: room.board,
            currentPlayer: room.currentPlayer,
            winner: room.winner,
            myColor,
            canPlay,
            status: room.status
          });

          this.startRoomWatch();
        });
      } else {
        wx.showToast({
          title: result.result.errMsg || '加载游戏失败',
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
      currentPlayer: room.currentPlayer,
      winner: room.winner,
      status: room.status,
      canPlay
    };
    const currentBoard = this.data.board;
    const nextBoard = room.board;
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
        changes.forEach(({ r, c }) => {
          updates[`board[${r}][${c}]`] = nextBoard[r][c];
        });
      } else {
        updates.board = nextBoard;
      }
    } else {
      updates.board = nextBoard;
    }
    this.setData(updates);

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
