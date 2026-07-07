// ── Clawd 吉祥物共享精灵 ─────────────────────────────────────
// 全小程序统一的像素角色：平顶直角方身 + 两侧小手 + 四条细腿。
// 使用方：pages/pet（宠物）、pages/home（Logo）、pages/runner（主角）、
// pages/sokoban（主角）。改造型只改这一个文件。

const COLORS = {
  1: '#D97757',  // 身体（Claude 品牌橙，纯色扁平）
  2: '#000000',  // 眼睛
};

// 32列 × 20行精灵网格（细网格便于精确还原眼睛大小与间距）
const GRID_COLS = 32;
const GRID_ROWS = 20;

// 按 [起始col, 结束col, 色号] 区段生成一行
function makeRow(spans) {
  const row = new Array(GRID_COLS).fill(0);
  spans.forEach(([s, e, ci]) => { for (let i = s; i <= e; i++) row[i] = ci; });
  return row;
}

// 身体 col6-25（20宽，平顶直角）；小手 col4-5 / col26-27；
// 眼睛 3×3：左 col9-11、右 col20-22（中心在身宽约 22% / 78% 处，间距≈半个身宽）
const ROW_BODY  = makeRow([[6, 25, 1]]);
const ROW_HANDS = makeRow([[4, 27, 1]]);
const ROW_EYES  = makeRow([[4, 27, 1], [9, 11, 2], [20, 22, 2]]);

// 腿：四条细腿（静止），跑步时内外两对交替
const ROW_LEGS_ALL   = makeRow([[8, 9, 1], [11, 12, 1], [19, 20, 1], [22, 23, 1]]);
const ROW_LEGS_OUTER = makeRow([[8, 9, 1], [19, 20, 1]]);
const ROW_LEGS_INNER = makeRow([[11, 12, 1], [22, 23, 1]]);

// opts.closed   — true 时闭眼（眨眼/睡觉）
// opts.legFrame — 'all'（默认，四腿站立）| 0 | 1（跑步交替帧）
function buildSprite(opts = {}) {
  const closed = !!opts.closed;
  const legFrame = opts.legFrame === undefined ? 'all' : opts.legFrame;
  const legs = legFrame === 'all' ? ROW_LEGS_ALL
             : legFrame === 0     ? ROW_LEGS_OUTER
             :                      ROW_LEGS_INNER;
  return [
    ROW_BODY, ROW_BODY, ROW_BODY, ROW_BODY, ROW_BODY,  // 0-4: 头/身体上部（平顶直角）
    ROW_HANDS,                                          // 5: 小手起始
    closed ? ROW_HANDS : ROW_EYES,                      // 6: 眼睛上行（闭眼时无）
    closed ? ROW_HANDS : ROW_EYES,                      // 7: 眼睛中行（闭眼时无）
    ROW_EYES,                                           // 8: 眼睛下行（闭眼时只剩此行=眯眼线）
    ROW_BODY, ROW_BODY, ROW_BODY, ROW_BODY, ROW_BODY, ROW_BODY, ROW_BODY,  // 9-15: 身体下部
    legs, legs, legs, legs,                             // 16-19: 细腿
  ];
}

// 以 (x, y) 为网格左上角、ps 为单格边长绘制。
// 网格整体 32ps 宽 × 20ps 高，图案在网格内水平居中（内容占 col4-27）。
function drawClawd(ctx, x, y, ps, opts = {}) {
  const sprite = buildSprite(opts);
  sprite.forEach((row, r) => {
    row.forEach((ci, c) => {
      if (!ci) return;
      ctx.fillStyle = COLORS[ci];
      ctx.fillRect(x + c * ps, y + r * ps, ps, ps);
    });
  });
}

module.exports = { COLORS, GRID_COLS, GRID_ROWS, buildSprite, drawClawd };
