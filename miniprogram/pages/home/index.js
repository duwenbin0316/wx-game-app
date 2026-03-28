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
        name: '像素跑酷',
        desc: 'Claude 躲避 Bug，坚持最久',
        url: '/pages/runner/index'
      }
    ]
  },

  onTapGame(e) {
    const url = e.currentTarget.dataset.url;
    wx.navigateTo({ url });
  }
});
