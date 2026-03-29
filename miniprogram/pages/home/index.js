// 像素参数（与跑酷一致）
const PSW = 4;
const PSH = 5;

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

  // ── 绘制像素角色 Logo ──────────────────────────────────
  _drawLogo(ctx, W, H) {
    const scale = 3.5;
    const pw = PSW * scale;
    const ph = PSH * scale;
    const bodyW = 5 * pw;
    const bodyH = 4 * ph;
    const legH  = ph;
    const totalH = bodyH + legH;
    const bx = (W - bodyW) / 2;
    const by = (H - totalH) / 2;

    // 外发光
    ctx.fillStyle = 'rgba(232, 135, 58, 0.12)';
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, W * 0.46, 0, Math.PI * 2);
    ctx.fill();

    // 主体（橙色）
    ctx.fillStyle = '#E8873A';
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 5; c++)
        ctx.fillRect(bx + c * pw, by + r * ph, pw, ph);

    // 侧臂（rows 1-2）
    ctx.fillRect(bx - pw,     by + ph, pw, 2 * ph);
    ctx.fillRect(bx + 5 * pw, by + ph, pw, 2 * ph);

    // 高光（左上角）
    ctx.fillStyle = '#F5A855';
    [[0,0],[0,1],[1,0]].forEach(([r, c]) =>
      ctx.fillRect(bx + c * pw, by + r * ph, pw, ph));

    // 眼睛
    ctx.fillStyle = '#1A1A2E';
    [[1,1],[1,3]].forEach(([r, c]) =>
      ctx.fillRect(bx + c * pw + 1, by + r * ph + 1, pw - 2, ph - 2));

    // 腿
    ctx.fillStyle = '#C86820';
    ctx.fillRect(bx + 1 * pw, by + bodyH, pw, legH);
    ctx.fillRect(bx + 3 * pw, by + bodyH, pw, legH);
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
