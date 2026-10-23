// 共享 Clawd 精灵（全小程序统一造型，见 utils/clawd.js）
const { GRID_COLS, GRID_ROWS, drawClawd } = require('../../utils/clawd');
const { woodFill, drawNail, rng } = require('../../utils/wood-art.js');

Page({
  data: {
    games: [
      {
        id: 'gomoku',
        icon: '⚫',
        name: '五子棋',
        desc: '经典黑白棋，本地或联机对战',
        url: '/pages/online/index'
      },
      {
        id: 'runner',
        icon: '🏃',
        name: 'Claude 快跑',
        desc: '躲 Bug 吃金币，咖啡护盾冲纪录！',
        url: '/pages/runner/index'
      },
      {
        id: 'sokoban',
        icon: '📦',
        name: '推箱子',
        desc: '10 关烧脑谜题，把箱子推到目标位置',
        url: '/pages/sokoban/index'
      },
      {
        id: 'tetris',
        icon: '🧱',
        name: '俄罗斯方块',
        desc: '重制手感，T-Spin 连击冲高分！',
        url: '/pages/tetris/index'
      },
      {
        id: 'skywing',
        icon: '✈️',
        name: '苍穹之翼',
        desc: '竖版射击:升级战机,击落空中巨舰!',
        url: '/pages/skywing/index'
      },
      {
        id: 'snake',
        icon: '🐍',
        name: 'Clawd 贪吃蛇',
        desc: '吃掉 Bug 越吃越长，小心别咬到自己',
        url: '/pages/snake/index'
      },
      {
        id: 'game2048',
        icon: '🔢',
        name: '2048',
        desc: '滑动合并数字，拼出 2048！',
        url: '/pages/game2048/index'
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

  // ── 绘制 Logo:钉在桌上的枫木圆牌 + Clawd ──────────────
  _drawLogo(ctx, W, H) {
    const cx = W / 2;
    const cy = H / 2 - 2;
    const R = Math.min(W, H) * 0.44;
    // 投影 + 侧边厚度
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.beginPath();
    ctx.arc(cx + 3, cy + 6, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#6E4222';
    ctx.beginPath();
    ctx.arc(cx, cy + 4, R, 0, Math.PI * 2);
    ctx.fill();
    // 圆牌面:枫木纹 + 左上打光
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();
    woodFill(ctx, cx - R, cy - R, R * 2, R * 2, '#E2BF88', rng(7), { lines: 9, lineWidth: 0.9, knot: 0 });
    const lg = ctx.createRadialGradient(cx - R * 0.4, cy - R * 0.4, R * 0.1, cx, cy, R);
    lg.addColorStop(0, 'rgba(255, 248, 225, 0.35)');
    lg.addColorStop(1, 'rgba(110, 60, 20, 0.3)');
    ctx.fillStyle = lg;
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    ctx.restore();
    ctx.strokeStyle = 'rgba(70, 35, 10, 0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, R - 1, 0, Math.PI * 2);
    ctx.stroke();
    // 内圈刻线
    ctx.strokeStyle = 'rgba(90, 45, 12, 0.45)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.84, 0, Math.PI * 2);
    ctx.stroke();
    [0.25, 0.75, 1.25, 1.75].forEach(a => {
      drawNail(ctx, cx + Math.cos(Math.PI * a) * R * 0.92, cy + Math.sin(Math.PI * a) * R * 0.92, Math.max(2, R * 0.05));
    });

    // Clawd 居中站在圆牌上
    const ps = (R * 1.45) / GRID_COLS;
    drawClawd(ctx, cx - (GRID_COLS * ps) / 2, cy - (GRID_ROWS * ps) / 2 + R * 0.1, ps);
  },

  onTapGame(e) {
    const url = e.currentTarget.dataset.url;
    wx.navigateTo({ url });
  },

  onShareAppMessage() {
    return {
      title: '木头游戏大厅，来一起玩！',
      path: '/pages/home/index'
    };
  }
});
