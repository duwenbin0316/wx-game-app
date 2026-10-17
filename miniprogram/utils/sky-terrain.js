// ── 苍穹之翼 · 程序化地形 ─────────────────────────────────────
// 地面按"块"生成:每块宽 360、高 CH 虚拟像素。先在半分辨率网格上算
// 分形噪声高度场,按高度上色并做山体光照(左上方来光),再放大画到整块
// 画布上,叠加树木 / 岩石 / 道路 / 建筑等矢量装饰,最后转成图片。
// 生成按时间预算分帧进行(每帧只花几毫秒),慢设备上也不会卡顿。
// 性能要点:噪声只在半分辨率网格上算;坡度、波纹 / 沙丘纹理也在网格上
// 预先算好;全分辨率像素只做双线性插值 + 查颜色表,不分配对象。
// 世界坐标 wy 随卷动增大;块 k 覆盖 [k*CH, (k+1)*CH)。

const CH = 240;
const R = 0.5;          // 高度场分辨率(相对虚拟像素)
const LUT_N = 1024;      // 颜色查找表精度
const AHEAD = 3;        // 提前生成几块

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
  for (let o = 0; o < 4; o++) {
    v += noise(x * f, y * f, seed + o * 17) * amp;
    f *= 2.03;
    amp *= 0.5;
  }
  return v / 0.9375;
}

function hex(c) {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}

function mix(a, b, t) {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

const C = {
  deep: hex('#0A3560'), mid: hex('#12608A'), shallow: hex('#2AA8B8'), foam: hex('#9FE6DC'),
  sand: hex('#E6D49A'), grass1: hex('#86B850'), grass2: hex('#4E8A34'), forest: hex('#2F6A2A'),
  rock: hex('#8A8270'), peak: hex('#B8B09C'),
  dsand1: hex('#D49A58'), dsand2: hex('#EAC688'), dbed: hex('#B88A58'), mesa: hex('#A8582E'), mesaTop: hex('#CC7A48'),
  isea1: hex('#06203A'), isea2: hex('#0E3C5E'), iedge: hex('#8EC0D8'), ice: hex('#DCECF6'), snow: hex('#F4FAFF'), irock: hex('#56647A'),
};

// 每种地貌:高度函数 + 上色 + 是否陆地
// color(h, x, wy, rip, o):把颜色写进 o(避免每个像素分配对象)
//   o.c 颜色,o.lit 是否做光照,o.k 光照强度,o.m 水面波纹亮度
const BIOMES = {
  islands: {
    base: '#12608A',
    scale: 0.0062,
    bias: -0.035,       // 让海面多一些
    land: 0.52,
    color(h, x, wy, rip, o) {
      o.lit = h >= 0.52;
      o.k = 1;
      if (!o.lit) {
        if (h < 0.4) o.c = mix(C.deep, C.mid, (h - 0.26) / 0.14);
        else if (h < 0.49) o.c = mix(C.mid, C.shallow, (h - 0.4) / 0.09);
        else o.c = mix(C.shallow, C.foam, (h - 0.49) / 0.03);
        o.m = 1 + rip * 0.12;
        return;
      }
      // 色带之间都做小范围渐变,避免硬边锯齿
      if (h < 0.528) o.c = mix(C.foam, C.sand, (h - 0.52) / 0.008);
      else if (h < 0.538) o.c = C.sand;
      else if (h < 0.552) o.c = mix(C.sand, C.grass1, (h - 0.538) / 0.014);
      else if (h < 0.63) o.c = mix(C.grass1, C.grass2, (h - 0.552) / 0.078);
      else if (h < 0.7) o.c = mix(C.grass2, C.forest, (h - 0.63) / 0.04);
      else if (h < 0.74) o.c = mix(C.forest, C.rock, (h - 0.7) / 0.04);
      else o.c = mix(C.rock, C.peak, (h - 0.74) / 0.08);
    },
  },
  desert: {
    base: '#D49A58',
    scale: 0.0058,
    land: -1,
    color(h, x, wy, rip, o) {
      o.lit = true;
      o.k = 1;
      if (h > 0.6) {
        o.c = h < 0.62 ? mix(C.dsand1, C.mesa, (h - 0.6) / 0.02) : h < 0.665 ? C.mesa : mix(C.mesa, C.mesaTop, (h - 0.665) / 0.01);
        o.k = 1.6;
        return;
      }
      if (h < 0.36) { o.c = mix(C.dbed, C.dsand1, (h - 0.28) / 0.08); return; }
      const dune = 0.5 + 0.5 * Math.sin(x * 0.05 + wy * 0.018 + rip * 7);
      o.c = mix(C.dsand1, C.dsand2, dune * 0.8 + (h - 0.36) * 0.6);
    },
  },
  arctic: {
    base: '#0E3C5E',
    scale: 0.0068,
    land: 0.47,
    color(h, x, wy, rip, o) {
      o.lit = h >= 0.47;
      o.k = 1.3;
      if (!o.lit) {
        o.c = h < 0.42 ? mix(C.isea1, C.isea2, (h - 0.3) / 0.12) : mix(C.isea2, C.iedge, (h - 0.42) / 0.05);
        o.m = 1 + rip * 0.1;
        return;
      }
      if (h < 0.478) o.c = mix(C.iedge, C.ice, (h - 0.47) / 0.008);
      else if (h < 0.6) o.c = mix(C.ice, C.snow, (h - 0.478) / 0.122);
      else if (h < 0.69) o.c = C.snow;
      else if (h < 0.72) o.c = mix(C.snow, C.irock, (h - 0.69) / 0.03);
      else o.c = mix(C.irock, C.iedge, (h - 0.72) * 3);
    },
  },
};

// 按高度预先算好颜色表:r/g/b、是否打光、光照强度
function buildLut(B) {
  const lut = { r: new Float32Array(LUT_N), g: new Float32Array(LUT_N), b: new Float32Array(LUT_N), lit: new Uint8Array(LUT_N), k: new Float32Array(LUT_N) };
  const o = { c: null, lit: false, k: 1, m: 1 };
  for (let i = 0; i < LUT_N; i++) {
    B.color(i / (LUT_N - 1), 0, 0, 0, o);
    lut.r[i] = o.c[0];
    lut.g[i] = o.c[1];
    lut.b[i] = o.c[2];
    lut.lit[i] = o.lit ? 1 : 0;
    lut.k[i] = o.k || 1;
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
    this.ripAmp = this.biome === 'islands' ? 0.12 : 0.1;
    this.gw = Math.ceil(vw * R);
    this.gh = Math.ceil(CH * R);
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
    while (this.queue.length && guard++ < 20000) this._step();
  }

  // 推进一小步:一行网格,或者 6 行像素。两段:
  //   1. 半分辨率网格:高度(5 层噪声)、坡度、纹理(水面波纹 / 沙丘)
  //   2. 全分辨率像素:三张网格双线性插值 → 查颜色表 → 光照
  _step() {
    const k = this.queue[0];
    if (k === undefined) return;
    const ch = this.chunks[k];
    if (!ch) { this.queue.shift(); return; }
    // 高度场四周各多算 2 圈,插值和求坡度时不会越界
    const W2 = this.gw + 4;
    const H2 = this.gh + 4;
    const top = (k + 1) * CH;
    const sd = this.seed;
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
    if (!ch.canvas) {
      ch.canvas = this.createCanvas(this.vw, CH);
      ch.g = ch.canvas.getContext('2d');
      ch.data = ch.g.createImageData(this.vw, CH);
    }
    const d = ch.data.data;
    const hs = ch.h;
    const ts = ch.tone;
    const ss = ch.slope;
    const L = this.lut;
    const vw = this.vw;
    const desert = this.desert;
    const ripAmp = this.ripAmp;
    const end = Math.min(CH, ch.row + 6);
    // 每行先把各网格列的纵向插值算好,像素上只剩一次横向插值
    if (!this._hv) {
      this._hv = new Float32Array(W2);
      this._sv = new Float32Array(W2);
      this._tv = new Float32Array(W2);
    }
    const hv = this._hv;
    const sv = this._sv;
    const tv = this._tv;
    for (let y = ch.row; y < end; y++) {
      // 网格坐标:像素 (x, y) → 网格 (x*R + 1.5, y*R + 1.5)
      const gy = (y + 0.5) * R + 1.5;
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
      let p = y * vw * 4;
      for (let x = 0; x < vw; x++) {
        const gx = (x + 0.5) * R + 1.5;
        const i0 = gx | 0;
        const fx = gx - i0;
        const h = hv[i0] + (hv[i0 + 1] - hv[i0]) * fx;
        let li = (h * (LUT_N - 1)) | 0;
        li = li < 0 ? 0 : li >= LUT_N ? LUT_N - 1 : li;
        let r = L.r[li];
        let g = L.g[li];
        let bl = L.b[li];
        let m;
        if (L.lit[li]) {
          const sl = sv[i0] + (sv[i0 + 1] - sv[i0]) * fx;
          m = 1 - sl * 9 * L.k[li];
          m = m < 0.62 ? 0.62 : m > 1.32 ? 1.32 : m;
          // 沙漠沙丘:沙地色带里按沙丘纹理在两种沙色之间渐变
          if (desert && h >= 0.36 && h <= 0.6) {
            let t = (tv[i0] + (tv[i0 + 1] - tv[i0]) * fx) * 0.8 + (h - 0.36) * 0.6;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            r = C.dsand1[0] + (C.dsand2[0] - C.dsand1[0]) * t;
            g = C.dsand1[1] + (C.dsand2[1] - C.dsand1[1]) * t;
            bl = C.dsand1[2] + (C.dsand2[2] - C.dsand1[2]) * t;
          }
        } else {
          m = 1 + (tv[i0] + (tv[i0 + 1] - tv[i0]) * fx) * ripAmp;
        }
        r *= m; g *= m; bl *= m;
        d[p] = r > 255 ? 255 : r;
        d[p + 1] = g > 255 ? 255 : g;
        d[p + 2] = bl > 255 ? 255 : bl;
        d[p + 3] = 255;
        p += 4;
      }
    }
    ch.row = end;
    if (ch.row < CH) return;
    this._finish(ch);
    this.queue.shift();
  }

  _finish(ch) {
    ch.g.putImageData(ch.data, 0, 0);
    this._decorate(ch.g, ch.k);
    ch.data = null;
    ch.h = null;
    ch.tone = null;
    ch.slope = null;
    ch.g = null;
    ch.ready = true;
    this.toImage(ch.canvas, img => {
      if (this.chunks[ch.k] === ch && img) ch.img = img;
    });
  }

  // ── 装饰:按 12×12 的格子撒,用哈希保证确定性 ──
  _decorate(g, k) {
    const top = (k + 1) * CH;
    const seed = this.seed;
    const cell = 12;
    // 上下各多扫两格:跨块边界的树两边都画一半,拼起来才完整
    for (let cy = -cell * 2; cy < CH + cell * 2; cy += cell) {
      for (let cx = 0; cx < this.vw; cx += cell) {
        const gy = Math.floor((top - cy) / cell);
        const gx = cx / cell;
        const r1 = hash2(gx, gy, seed + 101);
        const r2 = hash2(gx, gy, seed + 202);
        const x = cx + r1 * cell;
        const y = cy + r2 * cell;
        const h = this.height(x, top - y);
        if (this.biome === 'islands') {
          if (h > 0.63 && h < 0.74 && r1 < 0.85) this._trees(g, x, y, 3 + Math.floor(r2 * 3), r1, '#2A6A26', '#4E9A3A');
          else if (h > 0.56 && h < 0.63 && r1 < 0.18) this._trees(g, x, y, 1, r2, '#3A7A2E', '#6AAE48');
          else if (h > 0.74 && r1 < 0.25) this._rock(g, x, y, 3 + r2 * 3, '#6E6858', '#C8C0AC');
          else if (h > 0.522 && h < 0.535 && r1 < 0.06) this._hut(g, x, y, r2);
        } else if (this.biome === 'desert') {
          if (h > 0.6 && h < 0.62 && r1 < 0.25) this._rock(g, x, y, 2 + r2 * 2.5, '#7A3E20', '#D08A58');
          else if (h < 0.5 && r1 < 0.04) this._bush(g, x, y);
        } else if (h > 0.5 && h < 0.62 && r1 < 0.5) {
          this._pines(g, x, y, 2 + Math.floor(r2 * 3), r1);
        } else if (h > 0.72 && r1 < 0.3) {
          this._rock(g, x, y, 3 + r2 * 3, '#3E4A5C', '#E8F2FA');
        }
      }
    }
    if (this.biome === 'desert') this._desertBase(g, k, top);
  }

  _trees(g, x, y, n, r, dark, light) {
    for (let i = 0; i < n; i++) {
      const tx = x + (hash2(i, Math.floor(x * 7), this.seed) - 0.5) * 10;
      const ty = y + (hash2(i, Math.floor(y * 7), this.seed + 3) - 0.5) * 10;
      const s = 3 + hash2(i, Math.floor(x + y), this.seed + 5) * 2.6;
      g.fillStyle = 'rgba(10,30,10,0.35)';
      g.beginPath();
      g.arc(tx + s * 0.5, ty + s * 0.6, s, 0, Math.PI * 2);
      g.fill();
      const gr = g.createRadialGradient(tx - s * 0.4, ty - s * 0.4, 0, tx, ty, s);
      gr.addColorStop(0, light);
      gr.addColorStop(1, dark);
      g.fillStyle = gr;
      g.beginPath();
      g.arc(tx, ty, s, 0, Math.PI * 2);
      g.fill();
    }
  }

  _pines(g, x, y, n, r) {
    for (let i = 0; i < n; i++) {
      const tx = x + (hash2(i, Math.floor(x * 5), this.seed) - 0.5) * 12;
      const ty = y + (hash2(i, Math.floor(y * 5), this.seed + 1) - 0.5) * 12;
      const s = 3 + hash2(i, Math.floor(x - y), this.seed + 2) * 2;
      g.fillStyle = 'rgba(40,60,90,0.3)';
      g.beginPath();
      g.moveTo(tx + 1, ty + s * 0.4);
      g.lineTo(tx + s * 2.2, ty + s * 1.6);
      g.lineTo(tx + 1, ty + s * 1.4);
      g.fill();
      g.fillStyle = '#24463A';
      g.beginPath();
      for (let a = 0; a < 8; a++) {
        const rr = a % 2 ? s * 0.45 : s;
        const ang = (a / 8) * Math.PI * 2;
        if (a === 0) g.moveTo(tx + Math.cos(ang) * rr, ty + Math.sin(ang) * rr);
        else g.lineTo(tx + Math.cos(ang) * rr, ty + Math.sin(ang) * rr);
      }
      g.closePath();
      g.fill();
      g.fillStyle = 'rgba(240,250,255,0.75)';
      g.beginPath();
      g.arc(tx - s * 0.25, ty - s * 0.25, s * 0.35, 0, Math.PI * 2);
      g.fill();
    }
  }

  _rock(g, x, y, s, dark, light) {
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.beginPath();
    g.ellipse(x + s * 0.5, y + s * 0.5, s, s * 0.7, 0, 0, Math.PI * 2);
    g.fill();
    const gr = g.createLinearGradient(x - s, y - s, x + s, y + s);
    gr.addColorStop(0, light);
    gr.addColorStop(1, dark);
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(x - s, y);
    g.lineTo(x - s * 0.3, y - s * 0.8);
    g.lineTo(x + s * 0.7, y - s * 0.5);
    g.lineTo(x + s, y + s * 0.3);
    g.lineTo(x + s * 0.1, y + s * 0.7);
    g.closePath();
    g.fill();
  }

  _bush(g, x, y) {
    g.fillStyle = 'rgba(60,30,10,0.3)';
    g.beginPath();
    g.arc(x + 1.5, y + 1.5, 2.6, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#7A7A3A';
    g.beginPath();
    g.arc(x, y, 2.4, 0, Math.PI * 2);
    g.fill();
  }

  _hut(g, x, y, r) {
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(x - 3, y - 2, 9, 7);
    g.fillStyle = r < 0.5 ? '#C8643A' : '#D8D0C0';
    g.fillRect(x - 4, y - 4, 8, 6);
    g.fillStyle = 'rgba(255,255,255,0.3)';
    g.fillRect(x - 4, y - 4, 8, 2);
  }

  // 沙漠:道路 + 营地建筑
  _desertBase(g, k, top) {
    const r = hash2(k, 7, this.seed + 33);
    if (r < 0.55) {
      const y = 40 + hash2(k, 8, this.seed) * (CH - 80);
      g.fillStyle = 'rgba(60,40,20,0.25)';
      g.fillRect(0, y + 2, this.vw, 12);
      g.fillStyle = '#8A7A64';
      g.fillRect(0, y, this.vw, 11);
      g.fillStyle = '#E8D8A8';
      for (let x = 4; x < this.vw; x += 18) g.fillRect(x, y + 5, 9, 1.2);
      // 路边建筑
      const n = 2 + Math.floor(hash2(k, 9, this.seed) * 4);
      for (let i = 0; i < n; i++) {
        const bx = hash2(k, 10 + i, this.seed) * (this.vw - 40) + 10;
        const by = y + (i % 2 ? 18 : -30) + hash2(k, 20 + i, this.seed) * 8;
        const bw = 14 + hash2(k, 30 + i, this.seed) * 16;
        const bh = 10 + hash2(k, 40 + i, this.seed) * 10;
        this._building(g, bx, by, bw, bh);
      }
    }
    if (hash2(k, 11, this.seed) < 0.35) {
      // 弹坑
      const x = hash2(k, 12, this.seed) * this.vw;
      const y = hash2(k, 13, this.seed) * CH;
      const gr = g.createRadialGradient(x, y, 0, x, y, 9);
      gr.addColorStop(0, 'rgba(70,40,20,0.7)');
      gr.addColorStop(1, 'rgba(70,40,20,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(x, y, 9, 0, Math.PI * 2);
      g.fill();
    }
  }

  _building(g, x, y, w, h) {
    g.fillStyle = 'rgba(50,30,10,0.35)';
    g.fillRect(x + 3, y + 3, w, h);
    const gr = g.createLinearGradient(x, y, x + w, y + h);
    gr.addColorStop(0, '#E0D4B8');
    gr.addColorStop(1, '#9A8C70');
    g.fillStyle = gr;
    g.fillRect(x, y, w, h);
    g.fillStyle = 'rgba(80,60,40,0.4)';
    g.fillRect(x + 2, y + 2, w - 4, 1);
    g.fillRect(x + 2, y + h - 3, w - 4, 1);
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
