// ─── 分享卡(5:4,微信分享图比例)────────────────────────────
// 左边是游戏画面的木质小快照(由页面在 art(g, box) 里自己画),
// 右边是一块钉了铜钉的木牌:游戏名 + 本局分数 + 最高分 + "来挑战我"。
// 不传自定义图时,微信会截页面顶部一块当分享图(结算弹层只露半截),所以每个游戏都配一张。
const { drawSlab } = require('./wood-art.js');

const CARD_W = 500;
const CARD_H = 400;
const SCALE = 2;

function carve(g, text, x, y, size, color) {
  g.save();
  g.font = `bold ${size}px sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(40, 18, 4, 0.7)';
  g.fillText(text, x, y + Math.max(1.5, size * 0.07));
  g.fillStyle = color;
  g.fillText(text, x, y);
  g.restore();
}

// 画整张卡。opts: { title, subtitle?, score, best, idleLines, art(g, box),
//   mainLabel? / mainText? / bestLabel? / bestText?(不是比分数的模式,比如冲刺比用时,用这几个覆盖) }
function drawShareCard(g, opts) {
  const bg = g.createRadialGradient(CARD_W * 0.35, CARD_H * 0.4, 20, CARD_W * 0.5, CARD_H * 0.5, CARD_W * 0.7);
  bg.addColorStop(0, '#4A2C1B');
  bg.addColorStop(1, '#1C0F07');
  g.fillStyle = bg;
  g.fillRect(0, 0, CARD_W, CARD_H);

  // 左:游戏快照
  const box = { x: 24, y: 22, w: 252, h: 356 };
  if (opts.art) {
    g.save();
    g.beginPath();
    g.rect(box.x - 6, box.y - 6, box.w + 18, box.h + 18);
    g.clip();
    opts.art(g, box);
    g.restore();
  }

  // 右:木牌
  const px = 296;
  const pw = 182;
  drawSlab(g, px, 40, pw, 316, { base: '#A86F3E', depth: 5, radius: 14, seed: 33, nails: 3.5 });
  const cx = px + pw / 2;
  carve(g, opts.title, cx, opts.subtitle ? 84 : 92, opts.title.length > 5 ? 22 : 28, '#FFD46A');
  if (opts.subtitle) carve(g, opts.subtitle, cx, 110, 14, '#F6DDB0');
  g.fillStyle = 'rgba(60, 30, 10, 0.45)';
  g.fillRect(px + 22, 122, pw - 44, 2);
  g.fillStyle = 'rgba(255, 230, 190, 0.2)';
  g.fillRect(px + 22, 124, pw - 44, 1);
  if (opts.score > 0) {
    carve(g, opts.mainLabel || '本局得分', cx, 154, 15, '#F6DDB0');
    const s = opts.mainText || String(opts.score);
    carve(g, s, cx, 196, s.length > 6 ? 32 : 42, '#FFF2DA');
    carve(g, opts.bestLabel || '最高', cx, 250, 15, '#F6DDB0');
    carve(g, opts.bestText || String(opts.best || opts.score), cx, 280, 26, '#FFD46A');
  } else {
    (opts.idleLines || []).forEach((t, i) => carve(g, t, cx, 180 + i * 36, 20, '#FFF2DA'));
  }
  carve(g, '来挑战我', cx, 326, 15, '#F6DDB0');
}

// 生成分享图临时文件;env 里传 wx.createOffscreenCanvas / wx.canvasToTempFilePath。
// 失败或 1.5 秒内没画完就返回 null,分享降级成纯文字标题
function buildShareImage(env, opts) {
  return new Promise(resolve => {
    let settled = false;
    const done = v => { if (!settled) { settled = true; resolve(v); } };
    setTimeout(() => done(null), 1500);
    try {
      const canvas = env.createOffscreenCanvas({ type: '2d', width: CARD_W * SCALE, height: CARD_H * SCALE });
      const g = canvas.getContext('2d');
      g.scale(SCALE, SCALE);
      drawShareCard(g, opts);
      env.canvasToTempFilePath({
        canvas,
        fileType: 'png',
        success: res => done(res.tempFilePath),
        fail: () => done(null),
      });
    } catch (e) {
      done(null);
    }
  });
}

module.exports = { CARD_W, CARD_H, drawShareCard, buildShareImage };
