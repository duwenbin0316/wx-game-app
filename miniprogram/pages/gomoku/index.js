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
    this.stopRoomWatch();
    // 页面卸载时不自动删除房间，保留房间供其他玩家使用
  },

  onHide() {
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
      console.error('初始化在线游戏失�?, e);
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
    this.roomWatcher = db.collection('gameRooms')
      .where({ _id: this.data.roomId })
      .watch({
        onChange: (snapshot) => {
          const docs = snapshot.docs || [];
          if (!docs.length) {
            wx.showToast({ title: '�����ѹر�', icon: 'none' });
            this.stopRoomWatch();
            return;
          }
          this.applyRoomUpdate(docs[0]);
        },
        onError: (err) => {
          console.error('�������ʧ��', err);
          this.stopRoomWatch();
          setTimeout(() => {
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

  applyRoomUpdate(room) {
    const canPlay = room.currentPlayer === this.data.myColor && room.status === 'playing';
    this.setData({
      board: room.board,
      currentPlayer: room.currentPlayer,
      winner: room.winner,
      status: room.status,
      canPlay
    });

    if (room.winner) {
      const winnerText = room.winner === this.data.myColor ? '��Ӯ�ˣ�' : '���ֻ�ʤ';
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
    try {
      wx.showLoading({ title: '下棋�?.' });
      
      const result = await wx.cloud.callFunction({
        name: 'quickstartFunctions',
        data: {
          type: 'makeMove',
          roomId: this.data.roomId,
          row,
          col
        }
      });

      wx.hideLoading();

      if (result.result.success) {
        this.setData({
          board: result.result.board,
          currentPlayer: result.result.currentPlayer,
          winner: result.result.winner,
          canPlay: false
        });

        if (result.result.winner) {
          const winnerText = result.result.winner === this.data.myColor ? '你赢了！' : '对手获胜�?;
          wx.showToast({
            title: winnerText,
            icon: result.result.winner === this.data.myColor ? 'success' : 'none'
          });
        }
      } else {
        wx.showToast({
          title: result.result.errMsg || '下棋失败',
          icon: 'none'
        });
      }
    } catch (e) {
      wx.hideLoading();
      console.error('在线下棋失败', e);
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
      [[1, 1], [-1, -1]],  // 对角�?      [[1, -1], [-1, 1]]   // 反对角线
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
      title: '重新开�?,
      content: '确定要重新开始游戏吗�?,
      success: (res) => {
        if (res.confirm) {
          this.initLocalGame();
        }
      }
    });
  },

  onBoardTap(e) {
    // 防止事件冒泡
  },

  onLeaveRoom() {
    wx.showModal({
      title: '离开房间',
      content: '确定要离开当前房间吗？离开后房间将被关闭�?,
      confirmText: '确定离开',
      cancelText: '继续游戏',
      success: (res) => {
        if (res.confirm) {
          // 关闭房间
          this.closeRoomOnExit();
          // 返回到房间列表页�?          wx.navigateBack();
        }
      }
    });
  },

  onLeaveRoom() {
    wx.showModal({
      title: '离开房间',
      content: '确定要离开当前房间吗？离开后房间将被关闭�?,
      confirmText: '确定离开',
      cancelText: '继续游戏',
      success: (res) => {
        if (res.confirm) {
          // 关闭房间
          this.closeRoom();
          // 返回到房间列表页�?          wx.navigateBack();
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


