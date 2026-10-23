// ─── Claude 快跑 · 木质舞台布景 ─────────────────────────────
// 把跑酷背景做成一座黄昏的木头小剧场:
//   backdrop  背板:竖向木板刷成暮色渐变,黄铜钉当星星,一块枫木圆片当月亮
//   strip     远景小镇:胡桃木剪影(窗户透着暖光),宽 2 屏、首尾相接循环滚动
//   clouds    云:奶油色胶合板剪影,自带投在背板上的影子
//   ground    地面:一根橡木横梁(顶面)+ 下面一层层叠起来的木板,可横向平铺
// 全部只在开局前画一次,运行时只 drawImage。纯绘图逻辑,不依赖 wx。
const { rng, shade, toHex, woodFill, drawNail } = require('./wood-art.js');

const SKY_TOP = 'rgba(28, 30, 62, 0.78)';
const SKY_MID = 'rgba(92, 56, 82, 0.55)';
const SKY_LOW = 'rgba(214, 120, 62, 0.5)';
const PLANK = '#8A6440';
const TOWN = '#3A2416';
const GROUND_TOP = '#C8945C';
const GROUND_FACE = '#7E5230';

function makeCanvas(createCanvas, w, h, dpr) {
  const c = createCanvas(Math.max(1, Math.round(w * dpr)), Math.max(1, Math.round(h * dpr)));
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  return { c, g };
}

// 背板(画到地面线为止)
function paintBackdrop(g, W, gY, rand) {
  const pw = 46;
  for (let x = 0; x < W; x += pw) {
    const base = toHex(shade(PLANK, (rand() - 0.5) * 0.2));
    woodFill(g, x, 0, pw, gY, base, rand, { vertical: true, lines: 4, lineWidth: 0.8, knot: 0.4 });
  }
  // 暮色:上深蓝紫 → 中间紫红 → 地平线橙
  const sky = g.createLinearGradient(0, 0, 0, gY);
  sky.addColorStop(0, SKY_TOP);
  sky.addColorStop(0.55, SKY_MID);
  sky.addColorStop(1, SKY_LOW);
  g.fillStyle = sky;
  g.fillRect(0, 0, W, gY);
  // 拼缝 + 上下钉
  for (let x = 0; x < W; x += pw) {
    g.fillStyle = 'rgba(10, 4, 0, 0.55)';
    g.fillRect(x, 0, 1.2, gY);
    g.fillStyle = 'rgba(255, 220, 180, 0.08)';
    g.fillRect(x + 1.2, 0, 1, gY);
  }
  // 星星:小黄铜钉,只在上半部分
  for (let i = 0; i < 26; i++) {
    const sx = rand() * W;
    const sy = 8 + rand() * gY * 0.5;
    drawNail(g, sx, sy, 0.9 + rand() * 1.1);
  }
}

// 月亮:枫木圆片钉在背板上,带投影
function paintMoon(g, cx, cy, R, rand) {
  g.save();
  g.fillStyle = 'rgba(10, 4, 0, 0.4)';
  g.beginPath();
  g.arc(cx + 4, cy + 5, R, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.clip();
  woodFill(g, cx - R, cy - R, R * 2, R * 2, '#E8D3A4', rand, { lines: 6, lineWidth: 0.8, knot: 1 });
  const lg = g.createRadialGradient(cx - R * 0.35, cy - R * 0.35, R * 0.1, cx, cy, R);
  lg.addColorStop(0, 'rgba(255, 250, 230, 0.35)');
  lg.addColorStop(1, 'rgba(120, 70, 30, 0.25)');
  g.fillStyle = lg;
  g.fillRect(cx - R, cy - R, R * 2, R * 2);
  g.restore();
  g.save();
  g.strokeStyle = 'rgba(60, 30, 8, 0.6)';
  g.lineWidth = 1.2;
  g.beginPath();
  g.arc(cx, cy, R - 0.6, 0, Math.PI * 2);
  g.stroke();
  // 一圈暖色光晕
  const halo = g.createRadialGradient(cx, cy, R, cx, cy, R + 26);
  halo.addColorStop(0, 'rgba(255, 220, 160, 0.18)');
  halo.addColorStop(1, 'rgba(255, 220, 160, 0)');
  g.fillStyle = halo;
  g.beginPath();
  g.arc(cx, cy, R + 26, 0, Math.PI * 2);
  g.fill();
  g.restore();
  drawNail(g, cx, cy, 2);
}

// 云的轮廓:几个压扁的圆拼起来
function cloudPath(g, cx, cy, r) {
  g.beginPath();
  [
    [0, 0, r], [-r * 0.55, r * 0.2, r * 0.68], [r * 0.55, r * 0.2, r * 0.68],
    [-r * 0.95, r * 0.42, r * 0.48], [r * 0.95, r * 0.42, r * 0.48], [0, r * 0.38, r * 0.6],
  ].forEach(([dx, dy, rad]) => {
    g.moveTo(cx + dx + rad, cy + dy * 0.6);
    g.ellipse
      ? g.ellipse(cx + dx, cy + dy * 0.6, rad, rad * 0.62, 0, 0, Math.PI * 2)
      : g.arc(cx + dx, cy + dy * 0.6, rad * 0.8, 0, Math.PI * 2);
  });
}

function makeCloud(createCanvas, r, dpr, seed) {
  const w = r * 4.2;
  const h = r * 2.4;
  const { c, g } = makeCanvas(createCanvas, w, h, dpr);
  const cx = w / 2 - 2;
  const cy = h * 0.42;
  const rand = rng(seed);
  // 投影
  g.save();
  g.fillStyle = 'rgba(10, 4, 0, 0.32)';
  cloudPath(g, cx + 3, cy + 4, r);
  g.fill();
  g.restore();
  // 胶合板本体
  g.save();
  cloudPath(g, cx, cy, r);
  g.clip();
  woodFill(g, 0, 0, w, h, '#E3C9AE', rand, { lines: 5, lineWidth: 0.7, knot: 0.3 });
  const lg = g.createLinearGradient(0, cy - r, 0, cy + r);
  lg.addColorStop(0, 'rgba(255, 240, 220, 0.25)');
  lg.addColorStop(1, 'rgba(140, 70, 50, 0.3)');
  g.fillStyle = lg;
  g.fillRect(0, 0, w, h);
  g.restore();
  g.save();
  g.strokeStyle = 'rgba(80, 40, 20, 0.45)';
  g.lineWidth = 1;
  cloudPath(g, cx, cy, r);
  g.stroke();
  g.restore();
  return { canvas: c, w, h, ox: cx, oy: cy };
}

// 远景小镇剪影条:宽 SW,房子不跨越首尾,保证循环无缝
function makeTown(createCanvas, SW, dpr, rand) {
  const SH = 46;
  const { c, g } = makeCanvas(createCanvas, SW, SH, dpr);
  const houses = [];
  let x = 4;
  while (x < SW - 30) {
    const w = 18 + Math.floor(rand() * 26);
    const h = 12 + Math.floor(rand() * 26);
    if (x + w > SW - 4) break;
    houses.push({ x, w, h, roof: rand() < 0.45 });
    x += w + 3 + Math.floor(rand() * 10);
  }
  // 影子
  g.fillStyle = 'rgba(10, 4, 0, 0.35)';
  houses.forEach(hs => {
    g.fillRect(hs.x + 3, SH - hs.h + 3, hs.w, hs.h);
  });
  houses.forEach(hs => {
    const top = SH - hs.h;
    g.save();
    g.beginPath();
    g.rect(hs.x, top, hs.w, hs.h);
    if (hs.roof) {
      g.moveTo(hs.x - 2, top);
      g.lineTo(hs.x + hs.w / 2, top - Math.min(10, hs.w * 0.4));
      g.lineTo(hs.x + hs.w + 2, top);
    }
    g.clip();
    woodFill(g, hs.x - 2, top - 12, hs.w + 4, hs.h + 12, toHex(shade(TOWN, (rand() - 0.5) * 0.3)), rand, { vertical: true, lines: 2, lineWidth: 0.6, knot: 0 });
    g.restore();
    // 顶边一道亮线
    g.fillStyle = 'rgba(255, 200, 140, 0.25)';
    g.fillRect(hs.x, top, hs.w, 1);
    // 窗户:有的亮着暖光
    for (let wy = top + 4; wy < SH - 5; wy += 8) {
      for (let wx = hs.x + 3; wx < hs.x + hs.w - 4; wx += 7) {
        if (rand() < 0.45) {
          g.fillStyle = rand() < 0.5 ? 'rgba(255, 196, 110, 0.9)' : 'rgba(255, 170, 80, 0.7)';
        } else {
          g.fillStyle = 'rgba(20, 10, 4, 0.55)';
        }
        g.fillRect(wx, wy, 3, 4);
      }
    }
  });
  return { canvas: c, w: SW, h: SH };
}

// 地面一节:顶面是橡木横梁,下面是层层木板,宽 TW 可平铺
function makeGround(createCanvas, TW, GH, dpr, rand) {
  const { c, g } = makeCanvas(createCanvas, TW, GH, dpr);
  const topH = 9;
  // 横梁顶面
  woodFill(g, 0, 0, TW, topH, GROUND_TOP, rand, { lines: 3, lineWidth: 0.7, knot: 0 });
  g.fillStyle = 'rgba(255, 240, 210, 0.35)';
  g.fillRect(0, 0, TW, 1.5);
  g.fillStyle = 'rgba(30, 12, 0, 0.45)';
  g.fillRect(0, topH - 1.5, TW, 1.5);
  // 下面一层层木板,每层接缝位置不同
  let y = topH;
  let row = 0;
  while (y < GH) {
    const ph = 16 + Math.floor(rand() * 8);
    const base = toHex(shade(GROUND_FACE, -0.05 - row * 0.08 + (rand() - 0.5) * 0.1));
    woodFill(g, 0, y, TW, ph, base, rand, { lines: 3, lineWidth: 0.7, knot: 0.3 });
    // 越往下越暗
    g.fillStyle = `rgba(15, 6, 0, ${Math.min(0.55, 0.12 + row * 0.12)})`;
    g.fillRect(0, y, TW, ph);
    g.fillStyle = 'rgba(10, 4, 0, 0.6)';
    g.fillRect(0, y, TW, 1);
    g.fillStyle = 'rgba(255, 220, 170, 0.1)';
    g.fillRect(0, y + 1, TW, 1);
    // 竖向接缝 + 钉子(行与行错开)
    const joint = Math.floor(TW * (0.25 + rand() * 0.5));
    [0, joint].forEach(jx => {
      g.fillStyle = 'rgba(10, 4, 0, 0.55)';
      g.fillRect(jx, y, 1.2, ph);
      drawNail(g, jx + 5, y + ph / 2, 1.4);
    });
    y += ph;
    row++;
  }
  // 横梁投在木板上的影子
  const sh = g.createLinearGradient(0, topH, 0, topH + 8);
  sh.addColorStop(0, 'rgba(10, 4, 0, 0.5)');
  sh.addColorStop(1, 'rgba(10, 4, 0, 0)');
  g.fillStyle = sh;
  g.fillRect(0, topH, TW, 8);
  return { canvas: c, w: TW, h: GH };
}

// 一次画好全部布景。moon 位置与原像素版一致(右上角)
function buildRunnerArt(createCanvas, W, H, gY, dpr) {
  const rand = rng(4242);
  const back = makeCanvas(createCanvas, W, gY, dpr);
  paintBackdrop(back.g, W, gY, rand);
  paintMoon(back.g, W - 48, 58, 28, rand);
  return {
    backdrop: back.c,
    town: makeTown(createCanvas, Math.round(W * 2), dpr, rand),
    ground: makeGround(createCanvas, 120, H - gY + 4, dpr, rand),
    clouds: [14, 16, 18].reduce((m, r, i) => { m[r] = makeCloud(createCanvas, r, dpr, 900 + i); return m; }, {}),
    makeCloud: r => makeCloud(createCanvas, r, dpr, 900 + r),
  };
}

module.exports = { buildRunnerArt };
