Page({
  data: {
    rooms: [],
    loading: false,
    userInfo: null,
    showRoomNameModal: false,
    roomNameInput: ''
  },

  onLoad() {
    this.loadRoomList();
  },

  onShow() {
    // 不再自动关闭待关闭的房间，改为保留房间
    this.loadRoomList();
  },

  async getUserInfo() {
    try {
      const userInfo = await wx.getUserProfile({
        desc: '用于游戏昵称和头像显示'
      });
      this.setData({ userInfo: userInfo.userInfo });
    } catch (e) {
      console.log('获取用户信息失败', e);
    }
  },

  async loadRoomList() {
    this.setData({ loading: true });
    
    try {
      const result = await wx.cloud.callFunction({
        name: 'quickstartFunctions',
        data: {
          type: 'getRoomList'
        }
      });

      if (result.result.success) {
        const rooms = result.result.rooms.map(room => ({
          ...room,
          createdAt: this.formatTime(room.createdAt)
        }));
        this.setData({ rooms });
      } else {
        wx.showToast({
          title: result.result.errMsg || '获取房间列表失败',
          icon: 'none'
        });
      }
    } catch (e) {
      console.error('加载房间列表失败', e);
      wx.showToast({
        title: '网络错误',
        icon: 'none'
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  async onCreateRoom() {
    const roomName = (this.data.roomNameInput || '').trim();
    if (!roomName) {
      this.setData({ showRoomNameModal: true });
      return;
    }
    this.setData({ showRoomNameModal: false });

    if (!this.data.userInfo) {
      try {
        const userInfo = await wx.getUserProfile({
          desc: '用于游戏昵称和头像显示'
        });
        this.setData({ userInfo: userInfo.userInfo });
      } catch (e) {
        return;
      }
    }

    try {
      wx.showLoading({ title: '创建房间中...' });
      
      const result = await wx.cloud.callFunction({
        name: 'quickstartFunctions',
        data: {
          type: 'createRoom',
          roomName,
          creatorInfo: this.data.userInfo
        }
      });

      wx.hideLoading();

      if (result.result.success) {
        wx.showToast({
          title: '房间创建成功',
          icon: 'success'
        });
        this.setData({ roomNameInput: '' });
        
        wx.navigateTo({
          url: `/pages/gomoku/index?roomId=${result.result.roomId}&mode=online`
        });
      } else {
        wx.showToast({
          title: result.result.errMsg || '创建房间失败',
          icon: 'none'
        });
      }
    } catch (e) {
      wx.hideLoading();
      console.error('创建房间失败', e);
      wx.showToast({
        title: '网络错误',
        icon: 'none'
      });
    }
  },

  onRoomNameInput(e) {
    this.setData({ roomNameInput: e.detail.value });
  },

  onCancelRoomName() {
    this.setData({ showRoomNameModal: false, roomNameInput: '' });
  },

  async onConfirmRoomName() {
    const roomName = (this.data.roomNameInput || '').trim();
    if (!roomName) {
      wx.showToast({ title: '请输入房间名', icon: 'none' });
      return;
    }
    this.setData({ showRoomNameModal: false });
    await this.onCreateRoom();
  },

  onModalTap() {
    // 阻止冒泡
  },

  async onJoinRoom(e) {
    if (!this.data.userInfo) {
      try {
        const userInfo = await wx.getUserProfile({
          desc: '用于游戏昵称和头像显示'
        });
        this.setData({ userInfo: userInfo.userInfo });
      } catch (e) {
        return;
      }
    }

    const roomId = e.currentTarget.dataset.roomId;

    try {
      wx.showLoading({ title: '加入房间中...' });
      
      const result = await wx.cloud.callFunction({
        name: 'quickstartFunctions',
        data: {
          type: 'joinRoom',
          roomId: roomId,
          playerInfo: this.data.userInfo
        }
      });

      wx.hideLoading();

      if (result.result.success) {
        wx.showToast({
          title: '加入房间成功',
          icon: 'success'
        });
        
        wx.navigateTo({
          url: `/pages/gomoku/index?roomId=${roomId}&mode=online`
        });
      } else {
        wx.showToast({
          title: result.result.errMsg || '加入房间失败',
          icon: 'none'
        });
      }
    } catch (e) {
      wx.hideLoading();
      console.error('加入房间失败', e);
      wx.showToast({
        title: '网络错误',
        icon: 'none'
      });
    }
  },

  onRefreshRooms() {
    this.loadRoomList();
  },

  async onClearAllRooms() {
    wx.showModal({
      title: '确认清空',
      content: '确定要清空所有房间吗？此操作不可恢复！',
      success: async (res) => {
        if (res.confirm) {
          try {
            wx.showLoading({ title: '清空中...' });
            
            const result = await wx.cloud.callFunction({
              name: 'quickstartFunctions',
              data: {
                type: 'clearAllRooms'
              }
            });

            wx.hideLoading();

            console.log('清空房间结果:', result);

            if (result && result.result && result.result.success) {
              wx.showToast({
                title: `已清空${result.result.clearedCount}个房间`,
                icon: 'success'
              });
              
              // 延迟500ms后重新加载房间列表，确保数据库同步完成
              setTimeout(() => {
                this.loadRoomList();
              }, 500);
            } else {
              const errorMsg = result && result.result ? 
                (result.result.errMsg || '清空失败') : 
                '服务器响应异常';
              wx.showToast({
                title: errorMsg,
                icon: 'none'
              });
            }
          } catch (e) {
            wx.hideLoading();
            console.error('清空房间失败', e);
            wx.showToast({
              title: '网络错误',
              icon: 'none'
            });
          }
        }
      }
    });
  },

  formatTime(date) {
    const now = new Date();
    const target = new Date(date);
    const diff = now - target;
    
    if (diff < 60000) {
      return '刚刚';
    } else if (diff < 3600000) {
      return `${Math.floor(diff / 60000)}分钟前`;
    } else if (diff < 86400000) {
      return `${Math.floor(diff / 3600000)}小时前`;
    } else {
      return target.toLocaleDateString();
    }
  }
});
