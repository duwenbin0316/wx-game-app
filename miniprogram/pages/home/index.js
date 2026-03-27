Page({
  data: {
    games: [
      {
        id: 'gomoku',
        name: '五子棋',
        desc: '经典黑白棋，本地或联机对战',
        url: '/pages/online/index'
      }
    ]
  },

  onTapGame(e) {
    const url = e.currentTarget.dataset.url;
    wx.navigateTo({ url });
  }
});
