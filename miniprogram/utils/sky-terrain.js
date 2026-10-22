// ── 苍穹之翼 · 程序化地形 ─────────────────────────────────────
// 地面按"块"生成:每块宽 360、高 CH 虚拟像素,输出 2 倍分辨率(手机上放大后依旧清楚)。
// 1. 半分辨率网格上算 5 层分形噪声高度场、坡度、波纹 / 沙丘纹理;
// 2. 全分辨率像素:网格双线性插值 → 查颜色表 → 山体光照(左上方来光)
//    → 台地等高线(沙漠岩层 / 冰架)→ 细颗粒纹理;
// 3. 叠加矢量装饰:岛屿的村庄 / 农田 / 树林 / 棕榈 / 礁石 / 帆船,沙漠的公路 / 营地 / 绿洲,
//    极地的浮冰 / 冰裂缝 / 松林 / 科考站。
// 生成按时间预算分帧进行(每帧只花几毫秒),慢设备上也不会卡顿。
// 世界坐标 wy 随卷动增大;块 k 覆盖 [k*CH, (k+1)*CH)。

const CH = 240;
const R = 0.5;          // 高度场网格分辨率(相对虚拟像素)
const TS = 2;           // 输出分辨率(像素 / 虚拟像素)
const LUT_N = 1024;      // 颜色查找表精度
const AHEAD = 3;        // 提前生成几块
const GT = 128;         // 颗粒纹理平铺尺寸
const LE = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;   // 小端机器

function hash2(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 982451653);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// 值噪声:用打乱的排列表查格点随机值(查表比乘法哈希快得多,iOS 无 JIT 时尤其明显)
const PERM = new Uint8Array(512);
const VAL = new Float32Array(256);
(function initPerm() {
  let s = 1234567;
  const rnd = () => {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const p = [];
  for (let i = 0; i < 256; i++) { p.push(i); VAL[i] = rnd(); }
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
})();

function noise(x, y, seed) {
  const fxi = Math.floor(x);
  const fyi = Math.floor(y);
  const fx = x - fxi;
  const fy = y - fyi;
  const ix = (fxi + seed * 31) & 255;
  const iy = (fyi + seed * 17) & 255;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const r0 = PERM[ix];
  const r1 = PERM[ix + 1];
  const a = VAL[PERM[r0 + iy]];
  const b = VAL[PERM[r1 + iy]];
  const c = VAL[PERM[r0 + iy + 1]];
  const d = VAL[PERM[r1 + iy + 1]];
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm(x, y, seed) {
  let v = 0;
  let amp = 0.5;
  let f = 1;
  for (let o = 0; o < 5; o++) {
    v += noise(x * f, y * f, seed + o * 17) * amp;
    f *= 2.03;
    amp *= 0.5;
  }
  return v / 0.96875;
}

// 颗粒纹理:两层不同尺度的值噪声,[-1, 1]。像素上按两种步长采样,不会看出平铺
const GRAIN = new Float32Array(GT * GT);
(function initGrain() {
  for (let y = 0; y < GT; y++) {
    for (let x = 0; x < GT; x++) {
      // 周期性采样(按 GT 取模),平铺无接缝
      const a = noise((x / GT) * 16, (y / GT) * 16, 5);
      const b = noise((x / GT) * 32 + 0.5, (y / GT) * 32 + 0.5, 9);
      const c = hash2(x, y, 3);
      GRAIN[y * GT + x] = (a - 0.5) * 1.1 + (b - 0.5) * 0.7 + (c - 0.5) * 0.5;
    }
  }
})();

function hex(c) {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}

function mix(a, b, t) {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

const C = {
  // 群岛
  deep: hex('#0A3766'), mid: hex('#136A9E'), shallow: hex('#1F9CBA'), lagoon: hex('#58BFC4'), foam: hex('#F2FBF6'),
  wet: hex('#C9B27C'), sand: hex('#EBDAA4'), grass1: hex('#93C455'), grass2: hex('#5F9E3A'), forest: hex('#3A7430'),
  hill: hex('#6E8446'), rock: hex('#8E8474'), peak: hex('#CFC8B6'),
  // 沙漠
  dsand1: hex('#D79E5C'), dsand2: hex('#F0CF92'), dbed: hex('#B5845A'), oasis1: hex('#156A78'), oasis2: hex('#3FB4AA'),
  reed: hex('#7E9A3C'), strata: ['#B4643C', '#CF8450', '#A05430', '#D9965E', '#B8703F'].map(hex), mesaTop: hex('#E0A86E'),
  // 极地
  isea1: hex('#061A30'), isea2: hex('#0C3858'), sub1: hex('#1E7A9E'), sub2: hex('#7CCDE4'), iedge: hex('#FFFFFF'),
  ice: hex('#D6E9F5'), snow: hex('#F4F9FF'), irock: hex('#4E5A6E'), irock2: hex('#8C98AA'),
};

// 每种地貌:高度函数参数 + 上色
// color(h, o):把结果写进 o(避免每个像素分配对象)
//   o.c 颜色,o.lit 做山体光照,o.k 光照强度,o.gr 颗粒强度,o.terr 等高线密度(0 = 无),
//   o.wave 浪线带(按波纹亮暗断开),o.dune 沙丘纹理
const BIOMES = {
  islands: {
    base: '#136A9E',
    scale: 0.0062,
    bias: -0.035,       // 让海面多一些
    land: 0.52,
    ripAmp: 0.1,
    color(h, o) {
      o.lit = h >= 0.52;
      o.k = 1;
      o.gr = 0.035;
      if (!o.lit) {
        o.gr = 0.012;
        if (h < 0.4) o.c = mix(C.deep, C.mid, (h - 0.26) / 0.14);
        else if (h < 0.494) o.c = mix(C.mid, C.shallow, (h - 0.4) / 0.094);
        else if (h < 0.513) o.c = mix(C.shallow, C.lagoon, (h - 0.494) / 0.019);
        else o.c = mix(C.lagoon, C.foam, (h - 0.513) / 0.007);
        o.wave = h > 0.5 && h < 0.505;
        return;
      }
      // 色带之间都做小范围渐变,避免硬边锯齿
      if (h < 0.524) o.c = mix(C.foam, C.wet, (h - 0.52) / 0.004);
      else if (h < 0.53) o.c = mix(C.wet, C.sand, (h - 0.524) / 0.006);
      else if (h < 0.54) o.c = C.sand;
      else if (h < 0.552) o.c = mix(C.sand, C.grass1, (h - 0.54) / 0.012);
      else if (h < 0.63) o.c = mix(C.grass1, C.grass2, (h - 0.552) / 0.078);
      else if (h < 0.68) o.c = mix(C.grass2, C.forest, (h - 0.63) / 0.05);
      else if (h < 0.72) o.c = mix(C.forest, C.hill, (h - 0.68) / 0.04);
      else if (h < 0.75) o.c = mix(C.hill, C.rock, (h - 0.72) / 0.03);
      else o.c = mix(C.rock, C.peak, (h - 0.75) / 0.07);
      o.gr = h < 0.54 ? 0.03 : h < 0.72 ? 0.07 : 0.09;
      o.terr = h > 0.72 ? 70 : 0;
      o.k = h > 0.72 ? 1.3 : 1;
    },
  },
  desert: {
    base: '#D79E5C',
    scale: 0.0058,
    land: -1,
    ripAmp: 0.1,
    color(h, o) {
      o.lit = true;
      o.k = 1;
      o.gr = 0.05;
      if (h < 0.285) {
        // 绿洲水面
        o.lit = false;
        o.c = mix(C.oasis1, C.oasis2, (h - 0.23) / 0.055);
        o.gr = 0.01;
        return;
      }
      if (h < 0.3) { o.c = mix(C.reed, C.dbed, (h - 0.285) / 0.015); o.gr = 0.1; return; }
      if (h < 0.36) { o.c = mix(C.dbed, C.dsand1, (h - 0.312) / 0.048); o.gr = 0.08; return; }
      if (h <= 0.6) { o.c = mix(C.dsand1, C.dsand2, (h - 0.36) * 2); o.dune = true; o.gr = 0.04; return; }
      // 台地:一层层岩层,等高线勾出台阶
      const band = Math.floor((h - 0.6) / 0.024);
      const col = C.strata[band % C.strata.length];
      o.c = h < 0.612 ? mix(C.dsand1, col, (h - 0.6) / 0.012) : band >= 4 ? mix(col, C.mesaTop, 0.5) : col;
      o.k = 1.7;
      o.gr = 0.09;
      o.terr = 1 / 0.024;
    },
  },
  arctic: {
    base: '#0C3858',
    scale: 0.0068,
    land: 0.47,
    ripAmp: 0.08,
    color(h, o) {
      o.lit = h >= 0.47;
      o.k = 1.3;
      o.gr = 0.02;
      if (!o.lit) {
        o.gr = 0.01;
        if (h < 0.42) o.c = mix(C.isea1, C.isea2, (h - 0.3) / 0.12);
        else if (h < 0.448) o.c = mix(C.isea2, C.sub1, (h - 0.42) / 0.028);
        else o.c = mix(C.sub1, C.sub2, (h - 0.448) / 0.022);   // 水下冰架,透出青色
        return;
      }
      if (h < 0.476) o.c = mix(C.iedge, C.ice, (h - 0.47) / 0.006);
      else if (h < 0.6) o.c = mix(C.ice, C.snow, (h - 0.476) / 0.124);
      else if (h < 0.69) o.c = C.snow;
      else if (h < 0.72) o.c = mix(C.snow, C.irock2, (h - 0.69) / 0.03);
      else o.c = mix(C.irock2, C.irock, (h - 0.72) * 6);
      o.gr = h > 0.69 ? 0.09 : 0.025;
      o.k = h > 0.69 ? 1.6 : 1.3;
      o.terr = h > 0.52 && h < 0.69 ? 13 : h >= 0.69 ? 50 : 0;
    },
  },
};

// 按高度预先算好颜色表
function buildLut(B) {
  const n = LUT_N;
  const lut = {
    r: new Float32Array(n), g: new Float32Array(n), b: new Float32Array(n),
    lit: new Uint8Array(n), k: new Float32Array(n), gr: new Float32Array(n), terr: new Float32Array(n),
    wave: new Uint8Array(n), dune: new Uint8Array(n),
  };
  const o = {};
  for (let i = 0; i < n; i++) {
    o.c = null; o.lit = false; o.k = 1; o.gr = 0; o.terr = 0; o.wave = false; o.dune = false;
    B.color(i / (n - 1), o);
    lut.r[i] = o.c[0];
    lut.g[i] = o.c[1];
    lut.b[i] = o.c[2];
    lut.lit[i] = o.lit ? 1 : 0;
    lut.k[i] = o.k || 1;
    lut.gr[i] = o.gr || 0;
    lut.terr[i] = o.terr || 0;
    lut.wave[i] = o.wave ? 1 : 0;
    lut.dune[i] = o.dune ? 1 : 0;
  }
  return lut;
}

class Terrain {
  // createCanvas(w, h) → 离屏 canvas;toImage(canvas, cb(img|null)) 把画布转成可绘制图片
  constructor(biome, seed, vw, createCanvas, toImage) {
    this.biome = BIOMES[biome] ? biome : 'islands';
    this.B = BIOMES[this.biome];
    this.seed = seed;
    this.vw = vw;
    this.createCanvas = createCanvas;
    this.toImage = toImage;
    this.chunks = {};
    this.queue = [];
    this.lut = buildLut(this.B);
    this.desert = this.biome === 'desert';
    this.gw = Math.ceil(vw * R);
    this.gh = Math.ceil(CH * R);
    this.pw = vw * TS;
    this.ph = CH * TS;
    // 每一列像素对应的网格下标 / 插值系数,所有行共用
    this.colI = new Int32Array(this.pw);
    this.colF = new Float32Array(this.pw);
    this.colG1 = new Int32Array(this.pw);
    this.colG2 = new Int32Array(this.pw);
    for (let x = 0; x < this.pw; x++) {
      const gx = ((x + 0.5) / TS) * R + 1.5;
      this.colI[x] = gx | 0;
      this.colF[x] = gx - (gx | 0);
      this.colG1[x] = x & (GT - 1);
      this.colG2[x] = (((x * 3) >> 2) + 71) & (GT - 1);
    }
    // 沙漠公路:沿世界 y 蜿蜒的一条长路,逐块画也能首尾相接
    this.roadX0 = 110 + hash2(seed, 1, 77) * 140;
  }

  height(x, wy) {
    const s = this.B.scale;
    return fbm(x * s, wy * s, this.seed) + (this.B.bias || 0);
  }

  isLand(x, wy) {
    return this.height(x, wy) > this.B.land;
  }

  isWater(x, wy) {
    return this.B.land > 0 && this.height(x, wy) < this.B.land - 0.04;
  }

  // 每帧调用:排队需要的块,在时间预算内推进生成,丢掉已经离开屏幕的块
  update(scroll, vh, budgetMs) {
    const first = Math.floor(scroll / CH);
    const last = Math.floor((scroll + vh) / CH) + AHEAD;
    for (let k = first; k <= last; k++) {
      if (!this.chunks[k]) {
        this.chunks[k] = { k, row: 0, ready: false, img: null };
        this.queue.push(k);
      }
    }
    Object.keys(this.chunks).forEach(key => {
      const k = +key;
      if (k < first - 1) {
        delete this.chunks[k];
        const i = this.queue.indexOf(k);
        if (i >= 0) this.queue.splice(i, 1);
      }
    });
    const t0 = Date.now();
    const budget = budgetMs === undefined ? 4 : budgetMs;
    do {
      if (!this.queue.length) break;
      this._step();
    } while (Date.now() - t0 < budget);
  }

  // 当前屏幕上的块是否都已生成(并且转成了图片)
  ready(scroll, vh, needImg) {
    const first = Math.floor(scroll / CH);
    const last = Math.floor((scroll + vh) / CH);
    for (let k = first; k <= last; k++) {
      const ch = this.chunks[k];
      if (!ch || !ch.ready || (needImg && !ch.img)) return false;
    }
    return true;
  }

  // 同步生成到可见块就绪为止(测试 / 预热用)
  warm(scroll, vh) {
    this.update(scroll, vh, 0);
    let guard = 0;
    while (this.queue.length && guard++ < 40000) this._step();
  }

  // 推进一小步:一行网格,或者几行像素
  _step() {
    const k = this.queue[0];
    if (k === undefined) return;
    const ch = this.chunks[k];
    if (!ch) { this.queue.shift(); return; }
    // 高度场四周各多算 2 圈,插值和求坡度时不会越界
    const W2 = this.gw + 4;
    const H2 = this.gh + 4;
    const top = (k + 1) * CH;
    if (!ch.h) {
      ch.h = new Float32Array(W2 * H2);
      ch.tone = new Float32Array(W2 * H2);
      ch.slope = new Float32Array(W2 * H2);
      ch.hrow = 0;
      ch.srow = 1;
      ch.row = 0;
    }
    if (ch.hrow < H2) {
      const j = ch.hrow;
      const wy = top - (j - 1.5) / R;
      const base = j * W2;
      for (let i = 0; i < W2; i++) {
        const x = (i - 1.5) / R;
        ch.h[base + i] = this.height(x, wy);
        // 水面波纹 / 沙丘:几组正弦叠加就够了,不必再算一层噪声
        const rip = 0.25 * (Math.sin(x * 0.11 + wy * 0.031) + Math.sin(x * 0.047 - wy * 0.083 + 1.7));
        ch.tone[base + i] = this.desert ? 0.5 + 0.5 * Math.sin(x * 0.05 + wy * 0.018 + rip * 3 + Math.sin(wy * 0.007) * 2) : rip;
      }
      ch.hrow++;
      return;
    }
    if (ch.srow < H2 - 1) {
      // 坡度:左上与右下两个网格点的高度差(左上来光)
      const hs = ch.h;
      const j = ch.srow;
      for (let i = 1; i < W2 - 1; i++) {
        const q = j * W2 + i;
        ch.slope[q] = hs[q - W2 - 1] - hs[q + W2 + 1];
      }
      ch.srow++;
      return;
    }
    const pw = this.pw;
    if (!ch.canvas) {
      ch.canvas = this.createCanvas(pw, this.ph);
      ch.g = ch.canvas.getContext('2d');
      ch.data = ch.g.createImageData(pw, this.ph);
    }
    const d = ch.data.data;
    // 一次写一个 32 位像素(小端:ABGR),比逐字节写快得多;不支持时退回逐字节
    if (ch.d32 === undefined) {
      try {
        ch.d32 = LE ? new Uint32Array(d.buffer, d.byteOffset, d.length >> 2) : null;
      } catch (e) {
        ch.d32 = null;
      }
    }
    const d32 = ch.d32;
    const hs = ch.h;
    const ts = ch.tone;
    const ss = ch.slope;
    const L = this.lut;
    const desert = this.desert;
    const ripAmp = this.B.ripAmp;
    const colI = this.colI;
    const colF = this.colF;
    const colG1 = this.colG1;
    const colG2 = this.colG2;
    const end = Math.min(this.ph, ch.row + 8);
    // 每行先把各网格列的纵向插值算好,像素上只剩一次横向插值
    if (!this._hv) {
      this._hv = new Float32Array(W2);
      this._sv = new Float32Array(W2);
      this._tv = new Float32Array(W2);
    }
    const hv = this._hv;
    const sv = this._sv;
    const tv = this._tv;
    const s1 = C.dsand1;
    const s2 = C.dsand2;
    // 无 JIT 的解释器里属性读取很贵:颜色表各列先取到局部变量
    const Lr = L.r;
    const Lg = L.g;
    const Lb = L.b;
    const Llit = L.lit;
    const Lk = L.k;
    const Lgr = L.gr;
    const Lterr = L.terr;
    const Lwave = L.wave;
    const Ldune = L.dune;
    const GR = GRAIN;
    const GM = GT - 1;
    const LN = LUT_N - 1;
    for (let y = ch.row; y < end; y++) {
      const gy = ((y + 0.5) / TS) * R + 1.5;
      const j0 = gy | 0;
      const fy = gy - j0;
      const fy1 = 1 - fy;
      const ra = j0 * W2;
      const rb = ra + W2;
      for (let i = 0; i < W2; i++) {
        hv[i] = hs[ra + i] * fy1 + hs[rb + i] * fy;
        sv[i] = ss[ra + i] * fy1 + ss[rb + i] * fy;
        tv[i] = ts[ra + i] * fy1 + ts[rb + i] * fy;
      }
      const grow1 = (y & (GT - 1)) * GT;
      const grow2 = (((y * 3) >> 2) + 37 & (GT - 1)) * GT;
      let p = d32 ? y * pw : y * pw * 4;
      for (let x = 0; x < pw; x++) {
        const i0 = colI[x];
        const fx = colF[x];
        const ha = hv[i0];
        const h = ha + (hv[i0 + 1] - ha) * fx;
        let li = (h * LN) | 0;
        if (li < 0) li = 0; else if (li > LN) li = LN;
        let r = Lr[li];
        let g = Lg[li];
        let bl = Lb[li];
        let m;
        if (Llit[li]) {
          const sa = sv[i0];
          m = 1 - (sa + (sv[i0 + 1] - sa) * fx) * 9 * Lk[li];
          if (m < 0.58) m = 0.58; else if (m > 1.34) m = 1.34;
          // 沙丘:沙地色带里按沙丘纹理在两种沙色之间渐变
          if (desert && Ldune[li]) {
            const ta = tv[i0];
            let t = (ta + (tv[i0 + 1] - ta) * fx) * 0.75 + (h - 0.36) * 0.7;
            if (t < 0) t = 0; else if (t > 1) t = 1;
            r = s1[0] + (s2[0] - s1[0]) * t;
            g = s1[1] + (s2[1] - s1[1]) * t;
            bl = s1[2] + (s2[2] - s1[2]) * t;
          }
          // 等高线:台阶上沿一道亮边、下沿一道暗边
          const tr = Lterr[li];
          if (tr) {
            let f = h * tr;
            f -= f | 0;
            if (f < 0.07) m *= 1.14;
            else if (f > 0.86) m *= 0.8;
          }
        } else {
          const ta = tv[i0];
          const tn = ta + (tv[i0 + 1] - ta) * fx;
          m = 1 + tn * ripAmp;
          // 外圈浪线:按波纹断续出现的白色碎浪
          if (Lwave[li] && tn > 0.14) {
            r += (255 - r) * 0.42;
            g += (255 - g) * 0.42;
            bl += (255 - bl) * 0.42;
          }
        }
        const ga = Lgr[li];
        if (ga) m *= 1 + (GR[grow1 + colG1[x]] + GR[grow2 + colG2[x]]) * ga;
        r *= m; g *= m; bl *= m;
        if (r > 255) r = 255;
        if (g > 255) g = 255;
        if (bl > 255) bl = 255;
        if (d32) {
          d32[p] = 0xff000000 | (bl << 16) | (g << 8) | r;
          p++;
        } else {
          d[p] = r;
          d[p + 1] = g;
          d[p + 2] = bl;
          d[p + 3] = 255;
          p += 4;
        }
      }
    }
    ch.row = end;
    if (ch.row < this.ph) return;
    this._finish(ch);
    this.queue.shift();
  }

  _finish(ch) {
    const g = ch.g;
    g.putImageData(ch.data, 0, 0);
    g.save();
    g.scale(TS, TS);
    try {
      this._decorate(g, ch.k);
    } catch (e) {
      // 装饰失败不影响地面本身
    }
    g.restore();
    ch.data = null;
    ch.h = null;
    ch.tone = null;
    ch.slope = null;
    ch.g = null;
    ch.ready = true;
    this.toImage(ch.canvas, img => {
      if (this.chunks[ch.k] === ch && img) {
        ch.img = img;
        ch.canvas = null;   // 已有图片,释放画布内存
      }
    });
  }

  // ── 装饰 ──────────────────────────────────────────────
  // 小物件按 12×12 的格子撒,上下各多扫两格:跨块边界的物件两边都画一半,拼起来才完整;
  // 大物件(村庄 / 营地 / 科考站)整个放在块内部,不跨边界。
  _decorate(g, k) {
    const top = (k + 1) * CH;
    const seed = this.seed;
    const cell = 12;
    const biome = this.biome;
    // 大物件先占地,小物件(树 / 灌木 / 岩石)不往里面撒
    this._occ = [];
    if (biome === 'desert') this._highway(g, k, top);
    if (biome === 'islands') { this._fields(g, k, top); this._village(g, k, top); }
    if (biome === 'desert') this._compound(g, k, top);
    if (biome === 'arctic') { this._floes(g, k, top); this._station(g, k, top); }
    const occ = this._occ;
    for (let cy = -cell * 2; cy < CH + cell * 2; cy += cell) {
      for (let cx = 0; cx < this.vw; cx += cell) {
        const gy = Math.floor((top - cy) / cell);
        const gx = cx / cell;
        const r1 = hash2(gx, gy, seed + 101);
        const r2 = hash2(gx, gy, seed + 202);
        const r3 = hash2(gx, gy, seed + 303);
        const x = cx + r1 * cell;
        const y = cy + r2 * cell;
        let inside = false;
        for (let i = 0; i < occ.length; i++) {
          const o = occ[i];
          if (x > o[0] - 5 && x < o[2] + 5 && y > o[1] - 5 && y < o[3] + 5) { inside = true; break; }
        }
        if (inside) continue;
        const h = this.height(x, top - y);
        if (biome === 'islands') {
          if (h > 0.64 && h < 0.74 && r3 < 0.9) this._grove(g, x, y, 3 + Math.floor(r2 * 4), r1, h > 0.68 ? 1 : 0);
          else if (h > 0.6 && h <= 0.64 && r3 < 0.35) this._grove(g, x, y, 2 + Math.floor(r2 * 2), r1, 0);
          else if (h > 0.555 && h <= 0.6 && r3 < 0.08) this._grove(g, x, y, 1, r2, 0);
          else if (h > 0.526 && h < 0.545 && r3 < 0.16) this._palm(g, x, y, 3.4 + r1 * 1.6, r2 * 6.28);
          else if (h > 0.74 && r3 < 0.35) this._rock(g, x, y, 2.6 + r2 * 3, '#6A6456', '#D4CCB8');
          else if (h > 0.47 && h < 0.505 && r3 < 0.05) this._reef(g, x, y, 1.6 + r1 * 2);
        } else if (biome === 'desert') {
          if (h > 0.6 && h < 0.66 && r3 < 0.22) this._rock(g, x, y, 1.8 + r2 * 2.6, '#7A3A1C', '#E0A070');
          else if (h > 0.285 && h < 0.305 && r3 < 0.7) this._palm(g, x, y, 3.4 + r1 * 1.8, r2 * 6.28);
          else if (h > 0.32 && h < 0.4 && r3 < 0.12) this._bush(g, x, y, 1.6 + r1 * 1.4);
          else if (h > 0.4 && h < 0.58 && r3 < 0.025) this._bush(g, x, y, 1.4 + r1);
        } else {
          if (h > 0.52 && h < 0.6 && r3 < 0.22) this._pines(g, x, y, 2 + Math.floor(r2 * 3));
          else if (h > 0.49 && h < 0.66 && r3 < 0.07) this._crevasse(g, x, y, r1 * 6.28, 6 + r2 * 10);
          else if (h > 0.71 && r3 < 0.3) this._rock(g, x, y, 2.6 + r2 * 3, '#3A4658', '#EEF5FC', true);
        }
      }
    }
  }

  _hit(x0, y0, x1, y1) {
    return this._occ.some(o => x0 < o[2] && x1 > o[0] && y0 < o[3] && y1 > o[1]);
  }

  // 在块内部找一块"高度都在范围内"的平地(查九个点)
  _flatSpot(k, top, salt, w, h, lo, hi) {
    for (let tries = 0; tries < 16; tries++) {
      const x = 20 + w / 2 + hash2(k, salt + tries * 3, this.seed) * (this.vw - 40 - w);
      const y = 16 + h / 2 + hash2(k, salt + tries * 3 + 1, this.seed) * (CH - 32 - h);
      let ok = true;
      for (let i = -1; i <= 1 && ok; i++) {
        for (let j = -1; j <= 1 && ok; j++) {
          const v = this.height(x + i * w / 2, top - (y + j * h / 2));
          if (v < lo || v > hi) ok = false;
        }
      }
      if (ok) return { x, y };
    }
    return null;
  }

  // 圆形渐变只建一次,画的时候平移 + 缩放复用
  _ball(g, key, stops) {
    // 渐变对象只在创建它的画布上下文里用(不同离屏画布之间不共享)
    if (this._ballCtx !== g) {
      this._ballCtx = g;
      this._balls = {};
    }
    let gr = this._balls[key];
    if (!gr) {
      gr = g.createRadialGradient(-0.4, -0.45, 0, 0, 0, 1);
      stops.forEach(([o, c]) => gr.addColorStop(o, c));
      this._balls[key] = gr;
    }
    return gr;
  }

  _blob(g, x, y, s, style) {
    g.save();
    g.translate(x, y);
    g.scale(s, s);
    g.fillStyle = style;
    g.beginPath();
    g.arc(0, 0, 1, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  // ── 群岛 ──
  // 一簇阔叶树:先画整簇的影子,再画树冠
  _grove(g, x, y, n, r, dense) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const tx = x + (hash2(i, Math.floor(x * 7), this.seed) - 0.5) * 11;
      const ty = y + (hash2(i, Math.floor(y * 7), this.seed + 3) - 0.5) * 11;
      const s = 2.6 + hash2(i, Math.floor(x + y), this.seed + 5) * 2.4 + dense * 0.6;
      pts.push([tx, ty, s, hash2(i, Math.floor(x - y), this.seed + 9)]);
    }
    g.fillStyle = 'rgba(8,30,10,0.32)';
    pts.forEach(([tx, ty, s]) => {
      g.beginPath();
      g.arc(tx + s * 0.55, ty + s * 0.65, s * 1.02, 0, Math.PI * 2);
      g.fill();
    });
    const pal = [
      this._ball(g, 'tree0', [[0, '#9ED062'], [0.55, '#4E9636'], [1, '#22521E']]),
      this._ball(g, 'tree1', [[0, '#7CBF4E'], [0.55, '#3A7E2C'], [1, '#183E16']]),
      this._ball(g, 'tree2', [[0, '#B4D46A'], [0.55, '#6A9E3C'], [1, '#2E5A1E']]),
    ];
    pts.forEach(([tx, ty, s, v]) => {
      this._blob(g, tx, ty, s, pal[v < 0.45 ? 0 : v < 0.8 ? 1 : 2]);
      // 树冠上的叶簇高光
      g.fillStyle = 'rgba(230,255,180,0.22)';
      g.beginPath();
      g.arc(tx - s * 0.35, ty - s * 0.4, s * 0.38, 0, Math.PI * 2);
      g.fill();
    });
  }

  _palm(g, x, y, s, rot) {
    g.save();
    g.translate(x, y);
    // 影子
    g.fillStyle = 'rgba(20,30,10,0.3)';
    g.beginPath();
    g.ellipse(s * 0.7, s * 0.8, s * 1.1, s * 0.5, 0.6, 0, Math.PI * 2);
    g.fill();
    g.rotate(rot);
    for (let i = 0; i < 6; i++) {
      g.save();
      g.rotate((i / 6) * Math.PI * 2);
      g.fillStyle = i % 2 ? '#3E7E2A' : '#5C9A34';
      g.beginPath();
      g.moveTo(0, 0);
      g.quadraticCurveTo(s * 0.5, -s * 0.38, s * 1.15, -s * 0.05);
      g.quadraticCurveTo(s * 0.5, s * 0.22, 0, 0);
      g.fill();
      g.strokeStyle = 'rgba(200,230,140,0.55)';
      g.lineWidth = 0.25;
      g.beginPath();
      g.moveTo(0, 0);
      g.quadraticCurveTo(s * 0.5, -s * 0.12, s * 1.1, -s * 0.05);
      g.stroke();
      g.restore();
    }
    g.fillStyle = '#7A5A30';
    g.beginPath();
    g.arc(0, 0, s * 0.18, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  _reef(g, x, y, s) {
    g.fillStyle = 'rgba(240,255,250,0.55)';
    g.beginPath();
    g.ellipse(x, y, s * 1.7, s * 1.2, 0, 0, Math.PI * 2);
    g.fill();
    this._rock(g, x, y, s, '#5A5A50', '#B8B4A4');
  }

  // 农田:低平草地上一片片带垄沟的矩形田块
  _fields(g, k, top) {
    const n = 1 + Math.floor(hash2(k, 40, this.seed) * 3);
    const cols = ['#C8C05A', '#A8C860', '#B89A5A', '#D8C870', '#88B450'];
    for (let i = 0; i < n; i++) {
      const w = 26 + hash2(k, 41 + i, this.seed) * 22;
      const h = 18 + hash2(k, 51 + i, this.seed) * 16;
      const spot = this._flatSpot(k, top, 60 + i * 37, w, h, 0.548, 0.69);
      if (!spot) continue;
      const rot = (hash2(k, 71 + i, this.seed) - 0.5) * 0.7;
      const ex = (w * Math.abs(Math.cos(rot)) + h * Math.abs(Math.sin(rot))) / 2;
      const ey = (w * Math.abs(Math.sin(rot)) + h * Math.abs(Math.cos(rot))) / 2;
      if (this._hit(spot.x - ex, spot.y - ey, spot.x + ex, spot.y + ey)) continue;
      this._occ.push([spot.x - ex, spot.y - ey, spot.x + ex, spot.y + ey]);
      g.save();
      g.translate(spot.x, spot.y);
      g.rotate(rot);
      // 分成 2~3 块不同作物
      const parts = 2 + Math.floor(hash2(k, 81 + i, this.seed) * 2);
      for (let j = 0; j < parts; j++) {
        const pw = w / parts;
        const px = -w / 2 + j * pw;
        const col = cols[Math.floor(hash2(k * 7 + j, 91 + i, this.seed) * cols.length)];
        g.fillStyle = col;
        g.fillRect(px, -h / 2, pw - 0.8, h);
        g.strokeStyle = 'rgba(80,70,30,0.28)';
        g.lineWidth = 0.4;
        g.beginPath();
        const vertical = (j + i) % 2 === 0;
        if (vertical) for (let s = px + 1.2; s < px + pw - 1; s += 1.6) { g.moveTo(s, -h / 2 + 0.6); g.lineTo(s, h / 2 - 0.6); }
        else for (let s = -h / 2 + 1.2; s < h / 2 - 0.6; s += 1.6) { g.moveTo(px + 0.6, s); g.lineTo(px + pw - 1.4, s); }
        g.stroke();
      }
      // 田埂 / 树篱
      g.strokeStyle = 'rgba(60,90,30,0.7)';
      g.lineWidth = 0.9;
      g.strokeRect(-w / 2, -h / 2, w - 0.8, h);
      g.restore();
    }
  }

  // 海边小村:几栋双坡屋顶的房子 + 土路
  _village(g, k, top) {
    if (hash2(k, 5, this.seed + 9) > 0.8) return;
    const spot = this._flatSpot(k, top, 120, 36, 26, 0.527, 0.68);
    if (!spot || this._hit(spot.x - 22, spot.y - 17, spot.x + 22, spot.y + 17)) return;
    this._occ.push([spot.x - 22, spot.y - 17, spot.x + 22, spot.y + 17]);
    const n = 4 + Math.floor(hash2(k, 6, this.seed) * 5);
    const roofs = [['#D8643A', '#A8442A'], ['#E8E0D0', '#B0A898'], ['#4A7AA8', '#2E5478'], ['#C87A3A', '#965428']];
    // 广场 + 土路
    g.fillStyle = 'rgba(200,180,130,0.85)';
    g.beginPath();
    g.ellipse(spot.x, spot.y, 7, 5, 0, 0, Math.PI * 2);
    g.fill();
    const houses = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + hash2(k, 7 + i, this.seed);
      const d = 10 + hash2(k, 17 + i, this.seed) * 10;
      houses.push([spot.x + Math.cos(a) * d, spot.y + Math.sin(a) * d * 0.75, a]);
    }
    g.strokeStyle = 'rgba(190,168,120,0.9)';
    g.lineWidth = 1.4;
    g.beginPath();
    houses.forEach(([hx, hy]) => { g.moveTo(spot.x, spot.y); g.lineTo(hx, hy); });
    g.stroke();
    houses.forEach(([hx, hy, a], i) => {
      const w = 6 + hash2(k, 27 + i, this.seed) * 3;
      const h = 4.4 + hash2(k, 37 + i, this.seed) * 2;
      this._house(g, hx, hy, w, h, a + Math.PI / 2, roofs[i % roofs.length]);
    });
  }

  _house(g, x, y, w, h, rot, roof) {
    g.save();
    g.translate(x, y);
    g.rotate(Math.round(rot / (Math.PI / 2)) * (Math.PI / 2) + 0.12);
    g.fillStyle = 'rgba(10,20,10,0.35)';
    g.fillRect(-w / 2 + 1.2, -h / 2 + 1.4, w, h);
    // 双坡屋顶:迎光半边亮、背光半边暗
    g.fillStyle = roof[0];
    g.fillRect(-w / 2, -h / 2, w, h / 2);
    g.fillStyle = roof[1];
    g.fillRect(-w / 2, 0, w, h / 2);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.fillRect(-w / 2, -0.25, w, 0.5);
    g.strokeStyle = 'rgba(30,20,10,0.5)';
    g.lineWidth = 0.3;
    g.strokeRect(-w / 2, -h / 2, w, h);
    g.restore();
  }

  // ── 沙漠 ──
  // 一条沿世界 y 蜿蜒的公路(块与块之间首尾相接),偶尔有一条横向岔路
  _roadX(wy) {
    return this.roadX0 + Math.sin(wy * 0.0042 + this.seed) * 70 + Math.sin(wy * 0.011) * 18;
  }

  _highway(g, k, top) {
    const pts = [];
    for (let y = -12; y <= CH + 12; y += 6) pts.push([this._roadX(top - y), y]);
    const stroke = (w, c) => {
      g.strokeStyle = c;
      g.lineWidth = w;
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke();
    };
    g.lineJoin = 'round';
    g.save();
    g.translate(1.6, 1.8);
    stroke(15, 'rgba(70,40,16,0.25)');
    g.restore();
    stroke(15, '#BC9A6A');
    stroke(11.4, '#5E5A56');
    stroke(10.4, '#6E6A64');
    // 车道线:按世界 y 每 8 个单位画一段,保证跨块连续
    g.strokeStyle = '#F0E0A0';
    g.lineWidth = 0.8;
    g.beginPath();
    for (let y = -12; y < CH + 12; y += 4) {
      if (Math.floor((top - y) / 8) % 2) continue;
      g.moveTo(this._roadX(top - y), y);
      g.lineTo(this._roadX(top - y - 4), y + 4);
    }
    g.stroke();
    [-4.4, 4.4].forEach(off => {
      g.save();
      g.translate(off, 0);
      stroke(0.5, 'rgba(240,235,220,0.7)');
      g.restore();
    });
    // 横向岔路
    if (hash2(k, 3, this.seed + 5) < 0.45) {
      const y = 50 + hash2(k, 4, this.seed) * (CH - 100);
      const x0 = this._roadX(top - y);
      const dir = hash2(k, 5, this.seed) < 0.5 ? -1 : 1;
      const x1 = dir < 0 ? -10 : this.vw + 10;
      g.fillStyle = 'rgba(70,40,16,0.22)';
      g.fillRect(Math.min(x0, x1) + 1.5, y - 3.2, Math.abs(x1 - x0), 8);
      g.fillStyle = '#BC9A6A';
      g.fillRect(Math.min(x0, x1), y - 4.4, Math.abs(x1 - x0), 8.8);
      g.fillStyle = '#6A6660';
      g.fillRect(Math.min(x0, x1), y - 3.4, Math.abs(x1 - x0), 6.8);
      g.fillStyle = '#E8D8A0';
      for (let x = Math.min(x0, x1) + 8; x < Math.max(x0, x1) - 8; x += 12) g.fillRect(x, y - 0.3, 6, 0.6);
    }
  }

  // 军事营地:铁丝网围起来的一片平地,里面是平顶建筑、油罐、停机坪
  _compound(g, k, top) {
    if (hash2(k, 9, this.seed + 1) > 0.55) return;
    const w = 70 + hash2(k, 10, this.seed) * 30;
    const h = 50 + hash2(k, 11, this.seed) * 24;
    const spot = this._flatSpot(k, top, 200, w, h, 0.36, 0.6);
    if (!spot) return;
    // 避开公路
    const rx = this._roadX(top - spot.y);
    if (Math.abs(rx - spot.x) < w / 2 + 12) return;
    const x0 = spot.x - w / 2;
    const y0 = spot.y - h / 2;
    this._occ.push([x0, y0, x0 + w, y0 + h]);
    g.fillStyle = 'rgba(200,170,120,0.55)';
    g.fillRect(x0, y0, w, h);
    g.strokeStyle = 'rgba(60,50,40,0.6)';
    g.lineWidth = 0.4;
    g.strokeRect(x0, y0, w, h);
    g.fillStyle = 'rgba(50,40,30,0.8)';
    for (let i = 0; i <= w; i += 4) { g.fillRect(x0 + i - 0.4, y0 - 0.4, 0.8, 0.8); g.fillRect(x0 + i - 0.4, y0 + h - 0.4, 0.8, 0.8); }
    for (let i = 0; i <= h; i += 4) { g.fillRect(x0 - 0.4, y0 + i - 0.4, 0.8, 0.8); g.fillRect(x0 + w - 0.4, y0 + i - 0.4, 0.8, 0.8); }
    // 连到公路的土路
    g.fillStyle = 'rgba(170,140,100,0.9)';
    const gateY = spot.y;
    if (rx > spot.x) g.fillRect(x0 + w, gateY - 2.4, rx - (x0 + w), 4.8);
    else g.fillRect(rx, gateY - 2.4, x0 - rx, 4.8);
    const rnd = (i) => hash2(k, 300 + i, this.seed);
    // 建筑
    const nb = 2 + Math.floor(rnd(0) * 3);
    for (let i = 0; i < nb; i++) {
      const bw = 14 + rnd(1 + i) * 12;
      const bh = 9 + rnd(11 + i) * 8;
      const bx = x0 + 4 + rnd(21 + i) * (w * 0.55 - bw);
      const by = y0 + 4 + (i % 2) * (h / 2) + rnd(31 + i) * (h / 2 - bh - 8);
      this._building(g, bx, by, bw, bh);
    }
    // 油罐
    const tx = x0 + w * 0.78;
    const ty = y0 + h * 0.3;
    [[0, 0], [9, 2], [3, 10]].forEach(([dx, dy]) => this._tank(g, tx + dx, ty + dy, 3.6));
    // 停机坪
    const hx = x0 + w * 0.74;
    const hy = y0 + h * 0.76;
    g.fillStyle = '#7A746A';
    g.beginPath();
    g.arc(hx, hy, 8, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#F0E8D0';
    g.lineWidth = 0.6;
    g.beginPath();
    g.arc(hx, hy, 6.4, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(hx - 2.2, hy - 3); g.lineTo(hx - 2.2, hy + 3);
    g.moveTo(hx + 2.2, hy - 3); g.lineTo(hx + 2.2, hy + 3);
    g.moveTo(hx - 2.2, hy); g.lineTo(hx + 2.2, hy);
    g.stroke();
  }

  _building(g, x, y, w, h) {
    g.fillStyle = 'rgba(50,30,10,0.35)';
    g.fillRect(x + 2.4, y + 2.6, w, h);
    const gr = g.createLinearGradient(x, y, x + w, y + h);
    gr.addColorStop(0, '#E8DCC0');
    gr.addColorStop(1, '#A4967A');
    g.fillStyle = gr;
    g.fillRect(x, y, w, h);
    g.fillStyle = 'rgba(255,255,240,0.45)';
    g.fillRect(x, y, w, 0.6);
    g.fillRect(x, y, 0.6, h);
    g.fillStyle = 'rgba(70,50,30,0.35)';
    g.fillRect(x, y + h - 0.6, w, 0.6);
    g.fillRect(x + w - 0.6, y, 0.6, h);
    // 屋顶设备(空调外机 / 通风口)
    g.fillStyle = '#8A8070';
    for (let i = 0; i < 3; i++) {
      const ax = x + 2 + hash2(Math.floor(x), i, 7) * (w - 6);
      const ay = y + 2 + hash2(Math.floor(y), i, 9) * (h - 5);
      g.fillRect(ax, ay, 2.4, 1.8);
      g.fillStyle = 'rgba(40,30,20,0.4)';
      g.fillRect(ax + 0.6, ay + 1.8, 2.4, 0.6);
      g.fillStyle = '#8A8070';
    }
  }

  _tank(g, x, y, r) {
    g.fillStyle = 'rgba(50,30,10,0.35)';
    g.beginPath();
    g.arc(x + r * 0.45, y + r * 0.5, r, 0, Math.PI * 2);
    g.fill();
    this._blob(g, x, y, r, this._ball(g, 'tank', [[0, '#FFFFFF'], [0.6, '#D8D2C4'], [1, '#8E887A']]));
    g.strokeStyle = 'rgba(90,80,60,0.45)';
    g.lineWidth = 0.3;
    g.beginPath();
    g.arc(x, y, r * 0.62, 0, Math.PI * 2);
    g.stroke();
  }

  _bush(g, x, y, s) {
    g.fillStyle = 'rgba(70,40,10,0.3)';
    g.beginPath();
    g.arc(x + s * 0.6, y + s * 0.6, s, 0, Math.PI * 2);
    g.fill();
    this._blob(g, x, y, s, this._ball(g, 'bush', [[0, '#A8A85A'], [0.6, '#7A7A3A'], [1, '#4A4A20']]));
  }

  // ── 极地 ──
  // 浮冰:冰架外侧水面上的碎冰块
  _floes(g, k, top) {
    const n = 18;
    for (let i = 0; i < n; i++) {
      const x = hash2(k, 500 + i, this.seed) * this.vw;
      const y = hash2(k, 600 + i, this.seed) * CH;
      const h = this.height(x, top - y);
      if (h < 0.39 || h > 0.455) continue;
      const s = 2.4 + hash2(k, 700 + i, this.seed) * 5;
      const sides = 5 + Math.floor(hash2(k, 800 + i, this.seed) * 3);
      const pts = [];
      for (let j = 0; j < sides; j++) {
        const a = (j / sides) * Math.PI * 2 + hash2(i, j, this.seed) * 0.6;
        const rr = s * (0.7 + hash2(j, i, this.seed + 1) * 0.5);
        pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.8]);
      }
      const poly = (dx, dy, style) => {
        g.fillStyle = style;
        g.beginPath();
        pts.forEach(([px, py], j) => (j ? g.lineTo(px + dx, py + dy) : g.moveTo(px + dx, py + dy)));
        g.closePath();
        g.fill();
      };
      poly(0.8, 1, 'rgba(120,200,230,0.55)');   // 水下部分
      poly(0, 0, '#F2F8FF');
      poly(0.5, 0.6, 'rgba(160,190,215,0.4)');
      g.strokeStyle = 'rgba(255,255,255,0.9)';
      g.lineWidth = 0.35;
      g.beginPath();
      pts.forEach(([px, py], j) => (j ? g.lineTo(px, py) : g.moveTo(px, py)));
      g.closePath();
      g.stroke();
    }
  }

  _crevasse(g, x, y, a, len) {
    g.strokeStyle = 'rgba(90,140,190,0.55)';
    g.lineWidth = 0.9;
    g.beginPath();
    let px = x;
    let py = y;
    g.moveTo(px, py);
    for (let i = 0; i < 4; i++) {
      px += Math.cos(a) * len / 4 + (hash2(i, Math.floor(x), this.seed) - 0.5) * 3;
      py += Math.sin(a) * len / 4 + (hash2(Math.floor(y), i, this.seed) - 0.5) * 3;
      g.lineTo(px, py);
    }
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.7)';
    g.lineWidth = 0.4;
    g.save();
    g.translate(-0.6, -0.6);
    g.stroke();
    g.restore();
  }

  _pines(g, x, y, n) {
    for (let i = 0; i < n; i++) {
      const tx = x + (hash2(i, Math.floor(x * 5), this.seed) - 0.5) * 12;
      const ty = y + (hash2(i, Math.floor(y * 5), this.seed + 1) - 0.5) * 12;
      const s = 2.6 + hash2(i, Math.floor(x - y), this.seed + 2) * 2;
      // 影子拉长到右下
      g.fillStyle = 'rgba(40,70,110,0.32)';
      g.beginPath();
      g.moveTo(tx + 0.8, ty - s * 0.3);
      g.lineTo(tx + s * 2.4, ty + s * 1.8);
      g.lineTo(tx - 0.4, ty + s * 0.9);
      g.closePath();
      g.fill();
      // 两层针叶星形,外暗内亮,顶上积雪
      [[s, '#1E3E36'], [s * 0.66, '#2E5A48']].forEach(([rr, c]) => {
        g.fillStyle = c;
        g.beginPath();
        for (let a = 0; a < 10; a++) {
          const r = a % 2 ? rr * 0.48 : rr;
          const ang = (a / 10) * Math.PI * 2;
          if (a === 0) g.moveTo(tx + Math.cos(ang) * r, ty + Math.sin(ang) * r);
          else g.lineTo(tx + Math.cos(ang) * r, ty + Math.sin(ang) * r);
        }
        g.closePath();
        g.fill();
      });
      g.fillStyle = 'rgba(245,250,255,0.85)';
      g.beginPath();
      g.arc(tx - s * 0.22, ty - s * 0.26, s * 0.36, 0, Math.PI * 2);
      g.fill();
    }
  }

  // 科考站:橙色营房 + 雷达球 + 天线
  _station(g, k, top) {
    if (hash2(k, 13, this.seed + 3) > 0.55) return;
    const spot = this._flatSpot(k, top, 400, 50, 36, 0.48, 0.68);
    if (!spot) return;
    const { x, y } = spot;
    this._occ.push([x - 25, y - 20, x + 25, y + 20]);
    g.fillStyle = 'rgba(150,180,210,0.45)';
    g.fillRect(x - 25, y - 18, 50, 36);
    g.strokeStyle = 'rgba(110,140,180,0.6)';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(x - 25, y + 4); g.lineTo(x + 25, y + 4);
    g.stroke();
    [[-18, -12, 14, 7], [-18, 8, 12, 6], [0, -14, 10, 8]].forEach(([dx, dy, w, h]) => {
      g.fillStyle = 'rgba(30,60,100,0.35)';
      g.fillRect(x + dx + 1.6, y + dy + 1.8, w, h);
      g.fillStyle = '#E8642E';
      g.fillRect(x + dx, y + dy, w, h);
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillRect(x + dx, y + dy, w, 0.8);
      g.fillStyle = 'rgba(40,20,10,0.3)';
      for (let i = 1; i < 4; i++) g.fillRect(x + dx + (w * i) / 4, y + dy, 0.4, h);
    });
    // 雷达球
    g.fillStyle = 'rgba(30,60,100,0.35)';
    g.beginPath();
    g.arc(x + 15, y + 11, 6.4, 0, Math.PI * 2);
    g.fill();
    this._blob(g, x + 14, y + 10, 6, this._ball(g, 'dome', [[0, '#FFFFFF'], [0.6, '#E4ECF4'], [1, '#9AAABE']]));
    g.strokeStyle = 'rgba(120,140,170,0.5)';
    g.lineWidth = 0.3;
    g.beginPath();
    g.arc(x + 14, y + 10, 4, 0, Math.PI * 2);
    g.moveTo(x + 8, y + 10); g.lineTo(x + 20, y + 10);
    g.stroke();
    // 天线
    g.strokeStyle = '#3A4658';
    g.lineWidth = 0.6;
    g.beginPath();
    g.moveTo(x + 16, y - 12); g.lineTo(x + 22, y - 18);
    g.stroke();
    g.fillStyle = '#FF4A3A';
    g.beginPath();
    g.arc(x + 22, y - 18, 0.9, 0, Math.PI * 2);
    g.fill();
  }

  _rock(g, x, y, s, dark, light, snowy) {
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.beginPath();
    g.ellipse(x + s * 0.55, y + s * 0.55, s, s * 0.7, 0, 0, Math.PI * 2);
    g.fill();
    const pts = [[x - s, y], [x - s * 0.3, y - s * 0.85], [x + s * 0.7, y - s * 0.5], [x + s, y + s * 0.3], [x + s * 0.1, y + s * 0.75]];
    g.fillStyle = dark;
    g.beginPath();
    pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
    g.closePath();
    g.fill();
    // 迎光的两个面
    g.fillStyle = light;
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    g.lineTo(pts[1][0], pts[1][1]);
    g.lineTo(pts[2][0], pts[2][1]);
    g.lineTo(x + s * 0.05, y + s * 0.05);
    g.closePath();
    g.fill();
    if (snowy) {
      g.fillStyle = 'rgba(255,255,255,0.9)';
      g.beginPath();
      g.moveTo(pts[1][0], pts[1][1]);
      g.lineTo(pts[2][0], pts[2][1]);
      g.lineTo(x + s * 0.1, y - s * 0.2);
      g.closePath();
      g.fill();
    }
  }

  // 画出所有可见块
  draw(ctx, scroll, vh) {
    const first = Math.floor(scroll / CH);
    const last = Math.floor((scroll + vh) / CH);
    for (let k = first; k <= last; k++) {
      const ch = this.chunks[k];
      const y = vh - ((k + 1) * CH - scroll);
      if (ch && (ch.img || ch.canvas)) {
        try {
          ctx.drawImage(ch.img || ch.canvas, 0, Math.floor(y), this.vw, CH + 1);
          continue;
        } catch (e) {
          ch.canvas = null;
        }
      }
      ctx.fillStyle = this.B.base;
      ctx.fillRect(0, y, this.vw, CH + 1);
    }
  }
}

module.exports = { Terrain, CH, fbm };
