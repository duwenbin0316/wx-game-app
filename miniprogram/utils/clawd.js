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
// 眼睛中心在身宽约 20% / 80% 处，间距≈半个身宽；
// 默认 2×2 小眼，largeEyes 时 3×3（宠物页近景用）
const ROW_BODY   = makeRow([[6, 25, 1]]);
const ROW_HANDS  = makeRow([[4, 27, 1]]);
const ROW_EYES_S = makeRow([[4, 27, 1], [9, 10, 2], [21, 22, 2]]);
const ROW_EYES_L = makeRow([[4, 27, 1], [9, 11, 2], [20, 22, 2]]);

// 腿：四条细腿。跑步时交替抬腿——着地腿全长（4行）、抬起腿收短（只剩上2行），
// 四条腿始终可见，读感是小跑而不是腿在闪现
const ROW_LEGS_ALL  = makeRow([[8, 9, 1], [11, 12, 1], [19, 20, 1], [22, 23, 1]]);
const ROW_LEGS_ODD  = makeRow([[8, 9, 1], [19, 20, 1]]);   // 第1、3条着地
const ROW_LEGS_EVEN = makeRow([[11, 12, 1], [22, 23, 1]]); // 第2、4条着地

// opts.closed    — true 时闭眼（眨眼/睡觉）
// opts.legFrame  — 'all'（默认，四腿站立/腾空伸展）| 0 | 1（跑步交替抬腿帧）
// opts.largeEyes — true 时 3×3 大眼（近景），默认 2×2 小眼
function buildSprite(opts = {}) {
  const closed = !!opts.closed;
  const legFrame = opts.legFrame === undefined ? 'all' : opts.legFrame;
  // 上2行四腿齐全，下2行只保留当前着地的一组 → 另一组呈"抬起"状
  const legsUp   = ROW_LEGS_ALL;
  const legsDown = legFrame === 'all' ? ROW_LEGS_ALL
                 : legFrame === 0     ? ROW_LEGS_ODD
                 :                      ROW_LEGS_EVEN;
  const EYES = opts.largeEyes ? ROW_EYES_L : ROW_EYES_S;
  // 眼睛区 rows 6-8：大眼占 3 行；小眼占 6-7 两行、第 8 行只有小手。
  // 闭眼时只保留最下一行眼睛 = 眯眼线。
  const eyeRows = opts.largeEyes
    ? [closed ? ROW_HANDS : EYES, closed ? ROW_HANDS : EYES, EYES]
    : [closed ? ROW_HANDS : EYES, EYES, ROW_HANDS];
  return [
    ROW_BODY, ROW_BODY, ROW_BODY, ROW_BODY, ROW_BODY,  // 0-4: 头/身体上部（平顶直角）
    ROW_HANDS,                                          // 5: 小手起始
    eyeRows[0], eyeRows[1], eyeRows[2],                 // 6-8: 眼睛区（小手贯穿）
    ROW_BODY, ROW_BODY, ROW_BODY, ROW_BODY, ROW_BODY, ROW_BODY, ROW_BODY,  // 9-15: 身体下部
    legsUp, legsUp, legsDown, legsDown,                 // 16-19: 细腿（抬起的腿收短一半）
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
