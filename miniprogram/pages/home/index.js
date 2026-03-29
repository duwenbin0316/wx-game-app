Page({
  data: {
    games: [
      {
        id: 'gomoku',
        name: '五子棋',
        desc: '经典黑白棋，本地或联机对战',
        url: '/pages/online/index'
      },
      {
        id: 'runner',
        name: 'Claude 快跑',
        desc: '躲避 Bug，坚持跑得最远！',
        url: '/pages/runner/index'
      },
      {
        id: 'sokoban',
        name: '像素推箱子',
        desc: '把箱子推到目标位置，共 8 关',
        url: '/pages/sokoban/index'
      }
    ]
  },

  onTapGame(e) {
    const url = e.currentTarget.dataset.url;
    wx.navigateTo({ url });
  },

  onShareAppMessage() {
    return {
      title: '五子棋 & 像素跑酷，来一起玩！',
      path: '/pages/home/index'
    };
  }
});
