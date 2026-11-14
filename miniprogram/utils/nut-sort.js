// 螺母分类规则。柱子从底到顶存颜色编号；一次只移动顶端一枚。
// 关卡由完成状态逆推，每次逆推均保留合法的正向回退，因而保证可解。
const { rng } = require('./wood-art');
const LEVEL_COUNT = 30;
const CAPACITY = 4;
const clone = rods => rods.map(rod => rod.slice());
const top = rod => rod[rod.length - 1];
const isComplete = (rod, capacity) => rod.length === capacity && rod.every(c => c === rod[0]);
const isSolved = (rods, capacity) => rods.every(rod => !rod.length || isComplete(rod, capacity));
const key = rods => rods.map(rod => rod.join(',')).join('|');
const canonicalKey = rods => rods.map(rod => rod.join(',')).sort().join('|');

function canMove(rods, from, to, capacity) {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from === to) return false;
  const a = rods[from], b = rods[to];
  return !!(a && b && a.length && b.length < capacity && (!b.length || top(a) === top(b)));
}

function move(rods, from, to, capacity) {
  if (!canMove(rods, from, to, capacity)) return null;
  const next = clone(rods);
  next[to].push(next[from].pop());
  return next;
}

function disorder(rods) {
  let total = 0;
  rods.forEach(rod => {
    for (let i = 1; i < rod.length; i++) if (rod[i] !== rod[i - 1]) total++;
  });
  return total;
}

function generateLevel(index) {
  const level = Math.max(0, Math.min(LEVEL_COUNT - 1, Math.floor(index) || 0));
  const colors = Math.min(7, 3 + Math.floor(level / 5));
  const capacity = CAPACITY + Math.floor(level / 10);
  let best = null, bestScore = -1;
  for (let attempt = 0; attempt < 16; attempt++) {
    const random = rng(9017 + level * 7919 + attempt * 104729);
    const rods = Array.from({ length: colors }, (_, c) => Array(capacity).fill(c));
    rods.push([], []);
    const trail = [];
    let last = null;
    const seen = new Set([key(rods)]);
    for (let step = 0; step < 180 + level * 8; step++) {
      const options = [];
      for (let a = 0; a < rods.length; a++) {
        const source = rods[a];
        if (!source.length || (source.length > 1 && top(source) !== source[source.length - 2])) continue;
        for (let b = 0; b < rods.length; b++) {
          if (a === b || rods[b].length === capacity) continue;
          if (last && last.from === b && last.to === a) continue;
          const next = clone(rods);
          next[b].push(next[a].pop());
          if (seen.has(key(next))) continue;
          options.push({ from: a, to: b });
        }
      }
      if (!options.length) break;
      const chosen = options[Math.floor(random() * options.length)];
      rods[chosen.to].push(rods[chosen.from].pop());
      trail.push({ from: chosen.to, to: chosen.from });
      seen.add(key(rods));
      last = chosen;
      const mixed = disorder(rods);
      const score = mixed * 10 + rods.filter(r => r.length && r.length < capacity).length;
      // 起局至少保留一根全空柱，给玩家清楚的周转空间。
      if (rods.some(r => !r.length) && mixed > 0 && score > bestScore) {
        bestScore = score;
        best = { rods: clone(rods), solution: trail.slice().reverse() };
      }
    }
  }
  if (!best) {
    const rods = Array.from({ length: colors }, (_, c) => Array(capacity).fill(c));
    rods.push([], []);
    rods[0][capacity - 1] = 1; rods[1][capacity - 1] = 0;
    best = { rods, solution: [{ from: 0, to: colors }, { from: 1, to: 0 }, { from: colors, to: 1 }] };
  }
  return { index: level, capacity, colors, name: ['初识木作', '色彩工坊', '巧手匠人', '木间谜题', '归色高手', '大师工坊'][Math.floor(level / 5)], ...best };
}

function legalMoves(rods, capacity) {
  const out = [];
  for (let from = 0; from < rods.length; from++) {
    for (let to = 0; to < rods.length; to++) {
      if (canMove(rods, from, to, capacity)) out.push({ from, to });
    }
  }
  return out;
}

// 有界启发式搜索：用于玩家偏离已知解法后的提示；不阻塞无限搜索。
// 完成柱不拆、空柱对称去重；无解/预算耗尽都交给 UI 提示撤销或重开。
function solve(rods, capacity, opts = {}) {
  const maxNodes = opts.maxNodes || 18000;
  const budgetMs = opts.budgetMs || 160;
  const start = Date.now();
  const seen = new Map();
  let nodes = 0;
  function dfs(board, depth, previous) {
    if (isSolved(board, capacity)) return [];
    if (!depth || ++nodes > maxNodes || Date.now() - start > budgetMs) return null;
    const k = canonicalKey(board);
    if ((seen.get(k) || 0) >= depth) return null;
    seen.set(k, depth);
    let emptyUsed;
    const options = legalMoves(board, capacity).filter(m => {
      if (isComplete(board[m.from], capacity)) return false;
      if (previous && m.from === previous.to && m.to === previous.from) return false;
      if (!board[m.to].length) {
        if (board[m.from].every(c => c === board[m.from][0])) return false;
        if (emptyUsed === undefined) emptyUsed = m.to;
        if (m.to !== emptyUsed) return false;
      }
      return true;
    });
    options.sort((a, b) => priority(board, b) - priority(board, a));
    for (const m of options) {
      const next = move(board, m.from, m.to, capacity);
      const rest = dfs(next, depth - 1, m);
      if (rest) return [m, ...rest];
      if (nodes > maxNodes || Date.now() - start > budgetMs) return null;
    }
    return null;
  }
  for (let depth = Math.max(1, disorder(rods)); depth <= 90; depth += 2) {
    seen.clear();
    const solution = dfs(rods, depth, null);
    if (solution) return solution;
    if (nodes > maxNodes || Date.now() - start > budgetMs) break;
  }
  return null;
}

function priority(board, m) {
  const a = board[m.from], b = board[m.to];
  return (b.length ? 8 + b.length : 0) + (a.length > 1 && a[a.length - 2] !== top(a) ? 5 : 0);
}

// 已知解法的沿途局面映射；即便玩家绕路后回到其中，也能立即给出正确提示。
function solutionMap(rods, solution, capacity) {
  const map = new Map();
  let current = clone(rods);
  solution.forEach((m, i) => {
    map.set(key(current), solution.slice(i));
    current = move(current, m.from, m.to, capacity);
  });
  map.set(key(current), []);
  return map;
}

module.exports = { LEVEL_COUNT, CAPACITY, clone, top, key, isComplete, isSolved, canMove, move, generateLevel, legalMoves, solve, solutionMap };
