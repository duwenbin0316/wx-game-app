// 共享 Clawd 精灵（全小程序统一造型，见 utils/clawd.js）
const { GRID_COLS, GRID_ROWS, drawClawd } = require('../../utils/clawd');

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
      },
      {
        id: 'tetris',
        name: '俄罗斯方块',
        desc: '消除方块，挑战最高分！',
        url: '/pages/tetris/index'
      },
      {
        id: 'pet',
        name: '电子宠物',
        desc: '橙色小家伙 Clawd，需要你的照顾',
        url: '/pages/pet/index'
      }
    ]
  },

  onReady() {
    const dpr = wx.getSystemInfoSync().pixelRatio || 2;
    wx.createSelectorQuery()
      .select('#logo-canvas')
      .fields({ node: true, size: true })
      .exec(res => {
        if (!res || !res[0] || !res[0].node) return;
        const node = res[0].node;
        const w = res[0].width;
        const h = res[0].height;
        node.width  = Math.round(w * dpr);
        node.height = Math.round(h * dpr);
        const ctx = node.getContext('2d');
        ctx.scale(dpr, dpr);
        this._drawLogo(ctx, w, h);
      });
  },

  // ── 绘制 Clawd Logo（与宠物/游戏内造型统一）──────────────
  _drawLogo(ctx, W, H) {
    // 图案内容占 col4-27（24格），留 1 格边距选像素尺寸
    const ps = Math.min(W / 26, H / 22);

    // 外发光（品牌橙）
    ctx.fillStyle = 'rgba(217, 119, 87, 0.12)';
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, W * 0.46, 0, Math.PI * 2);
    ctx.fill();

    drawClawd(ctx, (W - GRID_COLS * ps) / 2, (H - GRID_ROWS * ps) / 2, ps);
  },

  onTapGame(e) {
    const url = e.currentTarget.dataset.url;
    wx.navigateTo({ url });
  },

  onShareAppMessage() {
    return {
      title: '像素游戏大厅，来一起玩！',
      path: '/pages/home/index'
    };
  }
});
