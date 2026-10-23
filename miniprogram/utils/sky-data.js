// ── 苍穹之翼 · 数据 ──────────────────────────────────────────
// 纯数据 + 纯函数(敌人定义、飞行轨迹、关卡脚本、升级表),不依赖 wx,
// 可以直接在 node 里跑测试。坐标单位是"虚拟像素":画面宽固定 360,
// 高度随屏幕比例变化;y 向下为正。

const VW = 360;

function makeRng(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── 敌人 ──
// air: 空中单位(按轨迹飞,有投影);ground: 地面单位(跟着地面卷动)
// fire: 开火方式;stars: 掉落星星数;r: 碰撞半径
const ENEMIES = {
  // 小型无人机:成群出现的杂兵,一两发就碎,很少开火
  drone:   { sprite: 'e_drone', air: true, hp: 2, r: 11, score: 60, stars: 1, starChance: 0.45, fire: { pattern: 'aimed', rate: 3.2, speed: 140, delay: 0.9, chance: 0.12 } },
  dart:    { sprite: 'e_dart', air: true, hp: 4, r: 13, score: 100, stars: 1, fire: { pattern: 'aimed', rate: 2.6, speed: 150, delay: 0.7, chance: 0.55 } },
  gunship: { sprite: 'e_gunship', air: true, hp: 18, r: 18, score: 300, stars: 3, rotor: true, fire: { pattern: 'burst', count: 3, rate: 1.9, speed: 165, delay: 0.5 } },
  bomber:  { sprite: 'e_bomber', air: true, hp: 42, r: 28, score: 600, stars: 6, fire: { pattern: 'fan', count: 5, spread: 0.7, rate: 1.7, speed: 135, delay: 0.6 } },
  cruiser: { sprite: 'e_cruiser', air: true, hp: 170, r: 40, score: 2000, stars: 20, elite: true, fire: { pattern: 'ring', count: 14, rate: 1.5, speed: 120, delay: 0.8, alt: 'fan' } },
  turret:  { sprite: 't_base', head: 't_head', ground: true, hp: 20, r: 15, score: 250, stars: 3, fire: { pattern: 'aimed2', rate: 1.6, speed: 160, delay: 0.4 } },
  tank:    { sprite: 'k_body', head: 'k_head', ground: true, hp: 12, r: 13, score: 200, stars: 2, moves: true, fire: { pattern: 'aimed', rate: 2.2, speed: 150, delay: 0.5 } },
  boat:    { sprite: 'b_body', head: 't_head', water: true, ground: true, hp: 16, r: 14, score: 250, stars: 3, moves: true, fire: { pattern: 'aimed2', rate: 1.9, speed: 150, delay: 0.5 } },
};

// ── 飞行轨迹:t = 出生后秒数,p = 参数 → 位置 ──
// 所有轨迹都从屏幕外进入,最终飞出屏幕(由页面判定离场)
const PATHS = {
  // 直线俯冲,可带横向漂移
  dive(t, p) {
    return { x: p.x + (p.drift || 0) * t, y: -30 + p.speed * t };
  },
  // 正弦蛇形
  sine(t, p) {
    return { x: p.x + Math.sin(t * p.freq + (p.phase || 0)) * p.amp, y: -30 + p.speed * t };
  },
  // 侧面进场横穿,y 方向带弧度
  sweep(t, p) {
    const dir = p.side < 0 ? 1 : -1;
    const x = (p.side < 0 ? -40 : VW + 40) + dir * p.speed * t;
    return { x, y: p.y + Math.sin((t * p.speed) / (VW + 80) * Math.PI) * p.arc };
  },
  // 下到 holdY 悬停一阵左右晃,再加速离开
  hover(t, p) {
    const enter = (p.holdY + 40) / p.speed;
    if (t < enter) {
      const k = t / enter;
      const e = 1 - (1 - k) * (1 - k);
      return { x: p.x, y: -40 + (p.holdY + 40) * e };
    }
    const th = t - enter;
    const sway = Math.sin(th * 0.9) * (p.sway || 30);
    if (th < p.hold) return { x: p.x + sway, y: p.holdY + Math.sin(th * 1.7) * 6 };
    const tl = th - p.hold;
    return { x: p.x + Math.sin(p.hold * 0.9) * (p.sway || 30) + (p.exitDx || 0) * tl, y: p.holdY + tl * tl * 90 };
  },
  // 俯冲后掉头爬升(像 U 形)
  loop(t, p) {
    const T = p.turn;
    if (t < T) return { x: p.x, y: -30 + p.speed * t };
    const a = Math.min(Math.PI, ((t - T) * p.speed) / p.radius);
    const cx = p.x + p.dir * p.radius;
    const cy = -30 + p.speed * T;
    const x = cx - p.dir * Math.cos(a) * p.radius;
    const y = cy + Math.sin(a) * p.radius;
    if (a < Math.PI) return { x, y };
    const rest = (t - T) - (Math.PI * p.radius) / p.speed;
    return { x: cx + p.dir * p.radius, y: cy - rest * p.speed };
  },
};

// ── 升级(机库里用星星买)──
// cost[i] = 从 i 级升到 i+1 级的花费
const UPGRADES = [
  { id: 'cannon', name: '主炮', max: 6, base: 1, cost: [0, 60, 140, 280, 500, 820], desc: lv => `${['', '双联', '三联', '四联', '五联扩散', '六联扩散', '七联风暴'][lv]}` },
  { id: 'missile', name: '追踪导弹', max: 5, base: 0, cost: [80, 170, 320, 560, 880], desc: lv => (lv ? `${lv} 级 · 每 ${(0.95 - lv * 0.11).toFixed(2)} 秒一对` : '未安装') },
  { id: 'armor', name: '装甲', max: 5, base: 0, cost: [70, 150, 300, 520, 820], desc: lv => `耐久 ${100 + lv * 30}` },
  { id: 'magnet', name: '星星磁铁', max: 4, base: 0, cost: [50, 120, 240, 420], desc: lv => `吸附半径 ${50 + lv * 30}` },
  { id: 'bomb', name: '超级炸弹', max: 3, base: 0, cost: [100, 240, 480], desc: lv => `每关 ${1 + lv} 枚` },
];

// 主炮各级弹道:dx 枪口横向偏移,a 偏角(弧度)
const CANNON = [
  null,
  [{ dx: -5, a: 0 }, { dx: 5, a: 0 }],
  [{ dx: -8, a: 0 }, { dx: 0, a: 0 }, { dx: 8, a: 0 }],
  [{ dx: -10, a: -0.02 }, { dx: -3.5, a: 0 }, { dx: 3.5, a: 0 }, { dx: 10, a: 0.02 }],
  [{ dx: -12, a: -0.1 }, { dx: -6, a: 0 }, { dx: 0, a: 0 }, { dx: 6, a: 0 }, { dx: 12, a: 0.1 }],
  [{ dx: -14, a: -0.14 }, { dx: -9, a: -0.05 }, { dx: -3, a: 0 }, { dx: 3, a: 0 }, { dx: 9, a: 0.05 }, { dx: 14, a: 0.14 }],
  [{ dx: -16, a: -0.2 }, { dx: -11, a: -0.09 }, { dx: -5, a: -0.02 }, { dx: 0, a: 0 }, { dx: 5, a: 0.02 }, { dx: 11, a: 0.09 }, { dx: 16, a: 0.2 }],
];

// ── 关卡 ──
const STAGES = [
  { id: 1, name: '翡翠群岛', en: 'EMERALD ISLES', biome: 'islands', length: 5400, speed: 44, seed: 11, boss: 'whale' },
  { id: 2, name: '赤沙要塞', en: 'CRIMSON DUNES', biome: 'desert', length: 6000, speed: 46, seed: 23, boss: 'fortress' },
  { id: 3, name: '极光冰原', en: 'AURORA FIELD', biome: 'arctic', length: 6600, speed: 48, seed: 37, boss: 'aurora' },
];

// 每关难度倍率
function stageScale(stageId) {
  const k = stageId - 1;
  return { hp: 1 + k * 0.45, fire: 1 + k * 0.22, bulletSpeed: 1 + k * 0.1, damage: 1 + k * 0.2 };
}

// ── Boss ──
// parts: 可单独击毁的部件(相对船体中心的位置);core 在部件全毁后才开放
const BOSSES = {
  whale: {
    name: '铁鲸号', hull: 'boss1', w: 230, h: 170, hp: 0, holdY: 150, sway: 60, score: 20000, stars: 80,
    parts: [
      { kind: 'turret', x: -62, y: 18, hp: 70, fire: { pattern: 'burst', count: 3, rate: 1.5, speed: 170 } },
      { kind: 'turret', x: 62, y: 18, hp: 70, fire: { pattern: 'burst', count: 3, rate: 1.5, speed: 170 } },
      { kind: 'pod', x: -96, y: -18, hp: 90, fire: { pattern: 'fan', count: 5, spread: 0.8, rate: 2.0, speed: 140 } },
      { kind: 'pod', x: 96, y: -18, hp: 90, fire: { pattern: 'fan', count: 5, spread: 0.8, rate: 2.0, speed: 140 } },
    ],
    core: { x: 0, y: 30, hp: 520, fire: { pattern: 'spiral', count: 3, rate: 0.12, speed: 130 }, fire2: { pattern: 'ring', count: 18, rate: 2.2, speed: 115 } },
  },
  fortress: {
    name: '沙暴堡垒', hull: 'boss2', w: 260, h: 200, hp: 0, holdY: 165, sway: 40, score: 30000, stars: 110,
    parts: [
      { kind: 'turret', x: -80, y: -40, hp: 85, fire: { pattern: 'aimed2', rate: 1.2, speed: 175 } },
      { kind: 'turret', x: 80, y: -40, hp: 85, fire: { pattern: 'aimed2', rate: 1.2, speed: 175 } },
      { kind: 'turret', x: -88, y: 46, hp: 85, fire: { pattern: 'burst', count: 4, rate: 1.6, speed: 165 } },
      { kind: 'turret', x: 88, y: 46, hp: 85, fire: { pattern: 'burst', count: 4, rate: 1.6, speed: 165 } },
      { kind: 'pod', x: 0, y: -62, hp: 120, fire: { pattern: 'ring', count: 12, rate: 2.1, speed: 120 } },
    ],
    core: { x: 0, y: 22, hp: 700, fire: { pattern: 'spiral', count: 4, rate: 0.11, speed: 125 }, fire2: { pattern: 'fan', count: 9, spread: 1.2, rate: 1.6, speed: 150 } },
  },
  aurora: {
    name: '极光母舰', hull: 'boss3', w: 260, h: 190, hp: 0, holdY: 160, sway: 50, score: 40000, stars: 150,
    parts: [
      { kind: 'cannon', x: -70, y: 40, hp: 120, fire: { pattern: 'stream', count: 5, rate: 1.7, speed: 210 } },
      { kind: 'cannon', x: 70, y: 40, hp: 120, fire: { pattern: 'stream', count: 5, rate: 1.7, speed: 210 } },
      { kind: 'turret', x: -110, y: -10, hp: 90, fire: { pattern: 'burst', count: 3, rate: 1.3, speed: 175 } },
      { kind: 'turret', x: 110, y: -10, hp: 90, fire: { pattern: 'burst', count: 3, rate: 1.3, speed: 175 } },
      { kind: 'pod', x: -40, y: -52, hp: 100, fire: { pattern: 'ring', count: 10, rate: 2.0, speed: 125 } },
      { kind: 'pod', x: 40, y: -52, hp: 100, fire: { pattern: 'ring', count: 10, rate: 2.0, speed: 125 } },
    ],
    core: { x: 0, y: 14, hp: 900, fire: { pattern: 'flower', count: 6, rate: 0.09, speed: 120 }, fire2: { pattern: 'ring', count: 24, rate: 1.9, speed: 105 } },
  },
};

// ── 关卡脚本(按卷动距离触发的出怪事件)──
// 用模板 + 确定性随机拼出来:同一关每次一样,方便刷勋章
function buildScript(stage) {
  const rnd = makeRng(stage.seed * 7919);
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const ev = [];
  const L = stage.length;
  const hasWater = stage.biome !== 'desert';

  const templates = [
    // 无人机大 V 编队
    { w: 3, min: 0, make(at) {
      const x = 110 + rnd() * 140;
      for (let k = -4; k <= 4; k++) ev.push({ at: at + Math.abs(k) * 7, kind: 'drone', path: 'dive', p: { x: x + k * 22, speed: 165 } });
    } },
    // 无人机横排压境(两排)
    { w: 3, min: 0, make(at) {
      for (let r = 0; r < 2; r++) {
        for (let i = 0; i < 6; i++) ev.push({ at: at + r * 34 + (i % 2) * 6, kind: 'drone', path: 'dive', p: { x: 45 + i * 54 + r * 27 - 13, speed: 125 } });
      }
    } },
    // 无人机两侧回旋
    { w: 3, min: 0.05, make(at) {
      for (let i = 0; i < 6; i++) {
        ev.push({ at: at + i * 9, kind: 'drone', path: 'loop', p: { x: 70, dir: 1, turn: 1.3, radius: 70, speed: 200 } });
        ev.push({ at: at + i * 9, kind: 'drone', path: 'loop', p: { x: 290, dir: -1, turn: 1.3, radius: 70, speed: 200 } });
      }
    } },
    // 无人机俯冲雨
    { w: 3, min: 0.1, make(at) {
      for (let i = 0; i < 10; i++) ev.push({ at: at + i * 8, kind: 'drone', path: 'dive', p: { x: 30 + rnd() * 300, drift: (rnd() - 0.5) * 80, speed: 170 + rnd() * 50 } });
    } },
    // 无人机两翼包抄
    { w: 2, min: 0.15, make(at) {
      const y = 110 + rnd() * 120;
      for (let i = 0; i < 5; i++) {
        ev.push({ at: at + i * 9, kind: 'drone', path: 'sweep', p: { side: -1, y, arc: 90, speed: 210 } });
        ev.push({ at: at + i * 9, kind: 'drone', path: 'sweep', p: { side: 1, y: y + 40, arc: 90, speed: 210 } });
      }
    } },
    // 一列俯冲
    { w: 2, min: 0, make(at) {
      const x = 60 + rnd() * 240;
      const drift = (rnd() - 0.5) * 60;
      for (let i = 0; i < 7; i++) ev.push({ at: at + i * 12, kind: 'dart', path: 'dive', p: { x, drift, speed: 150 } });
    } },
    // V 字编队
    { w: 2, min: 0, make(at) {
      const x = 90 + rnd() * 180;
      [0, -1, 1, -2, 2, -3, 3].forEach(k => ev.push({ at: at + Math.abs(k) * 10, kind: 'dart', path: 'dive', p: { x: x + k * 26, speed: 130 } }));
    } },
    // 左右交叉横穿
    { w: 2, min: 0.05, make(at) {
      const y = 120 + rnd() * 140;
      for (let i = 0; i < 4; i++) {
        ev.push({ at: at + i * 12, kind: 'dart', path: 'sweep', p: { side: -1, y, arc: 80, speed: 170 } });
        ev.push({ at: at + 30 + i * 12, kind: 'dart', path: 'sweep', p: { side: 1, y: y + 50, arc: 70, speed: 170 } });
      }
    } },
    // 蛇形
    { w: 2, min: 0.1, make(at) {
      const x = 100 + rnd() * 160;
      for (let i = 0; i < 6; i++) ev.push({ at: at + i * 12, kind: 'dart', path: 'sine', p: { x, amp: 70, freq: 2.2, speed: 120, phase: 0 } });
    } },
    // U 形回旋
    { w: 2, min: 0.2, make(at) {
      const dir = rnd() < 0.5 ? -1 : 1;
      const x = dir > 0 ? 70 : 290;
      for (let i = 0; i < 5; i++) ev.push({ at: at + i * 12, kind: 'dart', path: 'loop', p: { x, dir, turn: 1.6, radius: 80, speed: 170 } });
    } },
    // 武装直升机,两侧悬停
    { w: 3, min: 0.1, make(at) {
      ev.push({ at, kind: 'gunship', path: 'hover', p: { x: 80, holdY: 130 + rnd() * 60, hold: 4, speed: 80, sway: 25, exitDx: -40 } });
      ev.push({ at: at + 20, kind: 'gunship', path: 'hover', p: { x: 280, holdY: 150 + rnd() * 60, hold: 4, speed: 80, sway: 25, exitDx: 40 } });
    } },
    // 轰炸机
    { w: 3, min: 0.2, make(at) {
      ev.push({ at, kind: 'bomber', path: 'hover', p: { x: 120 + rnd() * 120, holdY: 120, hold: 5, speed: 55, sway: 50 } });
      for (let i = 0; i < 3; i++) ev.push({ at: at + 30 + i * 10, kind: 'dart', path: 'dive', p: { x: 40 + i * 20, speed: 160, drift: 30 } });
    } },
    // 地面炮塔群
    { w: 3, min: 0, make(at) {
      const n = 2 + Math.floor(rnd() * 2);
      for (let i = 0; i < n; i++) ev.push({ at: at + i * 30, kind: 'turret' });
    } },
    // 坦克 / 炮艇
    { w: 3, min: 0.08, make(at) {
      const kind = hasWater && rnd() < 0.5 ? 'boat' : 'tank';
      for (let i = 0; i < 3; i++) ev.push({ at: at + i * 26, kind });
    } },
  ];

  let d = 140;
  let midDone = false;
  while (d < L - 360) {
    const phase = d / L;
    if (!midDone && phase > 0.5) {
      // 中段精英:重型巡航舰
      ev.push({ at: d, kind: 'cruiser', path: 'hover', p: { x: 180, holdY: 140, hold: 9, speed: 45, sway: 70 } });
      midDone = true;
      d += 360;
      continue;
    }
    const pool = templates.filter(t => phase >= t.min);
    const total = pool.reduce((s, t) => s + t.w, 0);
    const pickTpl = () => {
      let r = rnd() * total;
      for (const t of pool) { r -= t.w; if (r <= 0) return t; }
      return pool[0];
    };
    pickTpl().make(d);
    // 时不时两波叠在一起(后半程更常见)
    if (rnd() < 0.18 + phase * 0.25) pickTpl().make(d + 40);
    // 越往后越密
    d += 135 - phase * 45 + rnd() * 50;
    // 穿插一点地面目标
    if (rnd() < 0.35) ev.push({ at: d - 40, kind: pick(['turret', 'turret', 'tank']) });
  }
  ev.push({ at: L, boss: stage.boss });
  ev.sort((a, b) => a.at - b.at);
  return ev;
}

// 勋章:击落 ≥70%、击落 100%、无伤
const MEDALS = [
  { id: 'kill70', name: '击落 70%', bonus: 40 },
  { id: 'kill100', name: '击落 100%', bonus: 80 },
  { id: 'nodmg', name: '无伤通关', bonus: 80 },
];

module.exports = { VW, makeRng, ENEMIES, PATHS, UPGRADES, CANNON, STAGES, BOSSES, MEDALS, stageScale, buildScript };
