// ── 五子棋 AI ────────────────────────────────────────────────
// 评估方法:五元组(棋盘上所有连续 5 格的窗口)。一个窗口里只有一方的
// 棋子时,按棋子数给分;两方都有则作废。落一子只影响经过它的最多 20 个
// 窗口,所以评估可以增量更新,搜索很快。
//   简单:按五元组打分挑点,但会随机走次优、偶尔漏看对方的棋
//   普通:五元组贪心(进攻 + 防守),必胜 / 必堵不会漏
//   困难:迭代加深 alpha-beta 搜索 + 冲四强制应对剪枝,有时间预算
// 纯函数模块,不依赖 wx,可以直接在 node 里跑对弈测试。

const N = 15;
const EMPTY = 0;
const BLACK = 1;
const WHITE = 2;
const WIN = 1e9;

// ── 预计算所有五元组窗口,以及每个格子属于哪些窗口 ──
const WINDOWS = [];
const CELL_WINDOWS = Array.from({ length: N * N }, () => []);
[[0, 1], [1, 0], [1, 1], [1, -1]].forEach(([dr, dc]) => {
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const er = r + dr * 4;
      const ec = c + dc * 4;
      if (er < 0 || er >= N || ec < 0 || ec >= N) continue;
      const cells = [];
      for (let k = 0; k < 5; k++) cells.push((r + dr * k) * N + (c + dc * k));
      const id = WINDOWS.length;
      WINDOWS.push(cells);
      cells.forEach(p => CELL_WINDOWS[p].push(id));
    }
  }
});

// 局面评估用(对称):窗口里 k 颗同色子的价值
const EVAL = [0, 4, 40, 400, 6000, WIN];
// 选点用(非对称,"我"要落子):进攻略重于防守
const ATTACK = [7, 35, 800, 15000, 800000, 0];
const DEFEND = [7, 15, 400, 1800, 100000, 0];

class Engine {
  constructor(board) {
    this.cells = new Int8Array(N * N);
    this.cnt = [null, new Int8Array(WINDOWS.length), new Int8Array(WINDOWS.length)];
    this.score = 0;           // 黑方视角的局面分
    this.stones = 0;
    this.winner = EMPTY;
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const v = board[r][c];
        if (v === 'black') this.place(r * N + c, BLACK);
        else if (v === 'white') this.place(r * N + c, WHITE);
      }
    }
  }

  _windowValue(w) {
    const b = this.cnt[BLACK][w];
    const wh = this.cnt[WHITE][w];
    if (b && wh) return 0;
    if (b) return EVAL[b];
    if (wh) return -EVAL[wh];
    return 0;
  }

  place(p, color) {
    const wins = CELL_WINDOWS[p];
    for (let i = 0; i < wins.length; i++) {
      const w = wins[i];
      this.score -= this._windowValue(w);
      this.cnt[color][w]++;
      this.score += this._windowValue(w);
      if (this.cnt[color][w] === 5) this.winner = color;
    }
    this.cells[p] = color;
    this.stones++;
  }

  remove(p) {
    const color = this.cells[p];
    const wins = CELL_WINDOWS[p];
    for (let i = 0; i < wins.length; i++) {
      const w = wins[i];
      this.score -= this._windowValue(w);
      this.cnt[color][w]--;
      this.score += this._windowValue(w);
    }
    this.cells[p] = EMPTY;
    this.stones--;
    this.winner = EMPTY;   // 搜索里只会撤销最后一手,之前不可能已分胜负
  }

  // 给空点打分:me 在这里落子的进攻价值 + 堵住对方的防守价值
  pointScore(p, me) {
    const opp = 3 - me;
    const wins = CELL_WINDOWS[p];
    let s = 0;
    for (let i = 0; i < wins.length; i++) {
      const w = wins[i];
      const a = this.cnt[me][w];
      const d = this.cnt[opp][w];
      if (a && d) continue;
      if (a) s += ATTACK[a];
      else if (d) s += DEFEND[d];
      else s += ATTACK[0];
    }
    return s;
  }

  // color 下在 p 能否直接连五
  winsAt(p, color) {
    const wins = CELL_WINDOWS[p];
    for (let i = 0; i < wins.length; i++) {
      const w = wins[i];
      if (this.cnt[color][w] === 4 && this.cnt[3 - color][w] === 0) return true;
    }
    return false;
  }

  // 已有棋子两格以内的空点(开局空盘时返回天元)
  candidates() {
    if (this.stones === 0) return [7 * N + 7];
    const out = [];
    const seen = new Uint8Array(N * N);
    for (let p = 0; p < N * N; p++) {
      if (!this.cells[p]) continue;
      const r = (p / N) | 0;
      const c = p % N;
      for (let dr = -2; dr <= 2; dr++) {
        const rr = r + dr;
        if (rr < 0 || rr >= N) continue;
        for (let dc = -2; dc <= 2; dc++) {
          const cc = c + dc;
          if (cc < 0 || cc >= N) continue;
          const q = rr * N + cc;
          if (this.cells[q] || seen[q]) continue;
          seen[q] = 1;
          out.push(q);
        }
      }
    }
    return out;
  }

  // 按分数排好序的候选点;有必胜 / 必堵时只返回这些点
  orderedMoves(me, limit) {
    const opp = 3 - me;
    const cands = this.candidates();
    const wins = [];
    const blocks = [];
    for (const p of cands) {
      if (this.winsAt(p, me)) wins.push(p);
      else if (this.winsAt(p, opp)) blocks.push(p);
    }
    if (wins.length) return wins.slice(0, 1);
    if (blocks.length) return blocks;
    const scored = cands.map(p => ({ p, s: this.pointScore(p, me) }));
    scored.sort((a, b) => b.s - a.s);
    return scored.slice(0, limit).map(x => x.p);
  }
}

// ── 困难:迭代加深 negamax + alpha-beta ──
function search(engine, me, budgetMs) {
  const start = Date.now();
  let timeUp = false;
  let nodes = 0;

  const negamax = (depth, alpha, beta, side, width) => {
    if (engine.winner) return -WIN - depth;   // 上一手已连五:当前方输(越早输越糟)
    if ((++nodes & 255) === 0 && Date.now() - start > budgetMs) timeUp = true;
    if (timeUp) return 0;
    if (depth === 0) return side === BLACK ? engine.score : -engine.score;
    const moves = engine.orderedMoves(side, width);
    if (!moves.length) return 0;
    let best = -Infinity;
    for (const p of moves) {
      engine.place(p, side);
      const v = -negamax(depth - 1, -beta, -alpha, 3 - side, Math.max(6, width - 2));
      engine.remove(p);
      if (timeUp) return best === -Infinity ? 0 : best;
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  };

  let rootMoves = engine.orderedMoves(me, 14);
  if (rootMoves.length === 1) return rootMoves[0];
  let bestMove = rootMoves[0];
  for (let depth = 2; depth <= 8; depth += 2) {
    let alpha = -Infinity;
    let iterBest = null;
    const scores = [];
    for (const p of rootMoves) {
      engine.place(p, me);
      const v = -negamax(depth - 1, -Infinity, -alpha, 3 - me, 10);
      engine.remove(p);
      if (timeUp) break;
      scores.push({ p, v });
      if (v > alpha) { alpha = v; iterBest = p; }
    }
    if (timeUp) break;          // 本层没搜完,沿用上一层结果
    bestMove = iterBest;
    if (alpha >= WIN) break;    // 已找到必胜
    // 下一层先搜本层最好的点,剪枝更有效
    scores.sort((a, b) => b.v - a.v);
    rootMoves = scores.map(s => s.p);
    if (Date.now() - start > budgetMs * 0.45) break;   // 下一层大概率超时,不开了
  }
  return bestMove;
}

function toMove(p) {
  return { r: (p / N) | 0, c: p % N };
}

// board: 15×15 的 'black' | 'white' | '';color: 该谁下
// 返回 { r, c };棋盘已满返回 null
function chooseMove(board, color, level, opts) {
  const me = color === 'black' ? BLACK : WHITE;
  const engine = new Engine(board);
  const rand = (opts && opts.random) || Math.random;
  const moves = engine.orderedMoves(me, 8);
  if (!moves.length) return null;

  if (level === 'easy') {
    const opp = 3 - me;
    const cands = engine.candidates();
    // 自己能连五一定下;对方要连五时只有六成概率看得见
    const win = cands.find(p => engine.winsAt(p, me));
    if (win !== undefined) return toMove(win);
    const block = cands.find(p => engine.winsAt(p, opp));
    if (block !== undefined && rand() < 0.6) return toMove(block);
    // 其余情况在前几名里随机挑,越靠前概率越大
    const scored = cands.map(p => ({ p, s: engine.pointScore(p, me) * (0.6 + rand() * 0.8) }));
    scored.sort((a, b) => b.s - a.s);
    const k = Math.min(scored.length, 4);
    const pick = Math.floor(Math.pow(rand(), 1.6) * k);
    return toMove(scored[pick].p);
  }

  if (level === 'medium' || moves.length === 1) {
    // 分数接近的几个点里随机一个,开局不会每盘都一样
    const top = engine.pointScore(moves[0], me);
    const near = moves.filter(p => engine.pointScore(p, me) >= top * 0.95);
    return toMove(near[Math.floor(rand() * near.length)]);
  }

  const budget = (opts && opts.budgetMs) || 700;
  return toMove(search(engine, me, budget));
}

module.exports = { chooseMove, N };
