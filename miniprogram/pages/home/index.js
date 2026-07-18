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
        desc: '躲 Bug 吃金币，咖啡护盾冲纪录！',
        url: '/pages/runner/index'
      },
      {
        id: 'sokoban',
        name: '像素推箱子',
        desc: '10 关烧脑谜题，把箱子推到目标位置',
        url: '/pages/sokoban/index'
      },
      {
        id: 'tetris',
        name: '俄罗斯方块',
        desc: '重制手感，T-Spin 连击冲高分！',
        url: '/pages/tetris/index'
      },
      {
        id: 'snake',
        name: 'Clawd 贪吃蛇',
        desc: '吃掉 Bug 越吃越长，小心别咬到自己',
        url: '/pages/snake/index'
      },
      {
        id: 'game2048',
        name: '2048',
        desc: '滑动合并数字，拼出 2048！',
        url: '/pages/game2048/index'
      },
      {
        id: 'adventure',
        name: 'Clawd 大冒险',
        desc: '横版闯关！踩扁 Bug，顶砖块吃金币',
        url: '/pages/adventure/index'
      },
      {
        id: 'stack',
        name: '像素盖楼',
        desc: '看准时机点一下，盖出最高像素塔！',
        url: '/pages/stack/index'
      },
      {
        id: 'pet',
        name: '电子宠物',
        desc: '陪 Clawd 散步、喂食，一起抓 Bug',
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
