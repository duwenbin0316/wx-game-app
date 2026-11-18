// 螺母分类规则。柱子从底到顶存颜色编号；每次搬运将柱顶连续同色的螺母批量移至目标柱（受目标柱剩余容量限制）。
const LEVELS = require('./nut-levels');
const LEVEL_COUNT = LEVELS.length;
const CAPACITY = 4;
const clone = rods => rods.map(rod => rod.slice());
const top = rod => rod[rod.length - 1];
const isComplete = (rod, capacity) => rod.length === capacity && rod.every(c => c === rod[0]);
const isSolved = (rods, capacity) => rods.every(rod => !rod.length || isComplete(rod, capacity));
const key = rods => rods.map(rod => rod.join(',')).join('|');
const canonicalKey = rods => rods.map(rod => rod.join(',')).sort().join('|');

function topRun(rod) {
  if (!rod || !rod.length) return 0;
  const c = rod[rod.length - 1];
  let count = 1;
  for (let i = rod.length - 2; i >= 0 && rod[i] === c; i--) count++;
  return count;
}

function rateStars(steps, par) {
  if (!Number.isInteger(steps) || steps <= 0) return 0;
  const base = Math.max(1, par || steps);
  if (steps <= Math.max(base + 2, Math.ceil(base * 1.15))) return 3;
  if (steps <= Math.max(base + 6, Math.ceil(base * 1.5))) return 2;
  return 1;
}

function canMove(rods, from, to, capacity) {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from === to) return false;
  const a = rods[from], b = rods[to];
  return !!(a && b && a.length && !isComplete(a, capacity) && b.length < capacity && (!b.length || top(a) === top(b)));
}

function transferCount(rods, from, to, capacity) {
  if (!canMove(rods, from, to, capacity)) return 0;
  return Math.min(topRun(rods[from]), capacity - rods[to].length);
}

function move(rods, from, to, capacity) {
  const count = transferCount(rods, from, to, capacity);
  if (!count) return null;
  const next = clone(rods);
  for (let i = 0; i < count; i++) next[to].push(next[from].pop());
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
  const puzzle = LEVELS[level];
  const rods = puzzle.rods.map(stack => Array.from(stack, Number));
  const capacity = Math.max(...rods.map(rod => rod.length));
  const colors = rods.filter(rod => rod.length).length;
  const solution = puzzle.moves.split(' ').map(pair => ({ from: Number(pair[0]), to: Number(pair[1]) }));
  const name = ['初识木作', '独柱周转', '五色交错', '层叠木阵', '六色连环', '七色匠心'][Math.floor(level / 5)];
  return { index: level, capacity, colors, name, rods, solution, par: solution.length };
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
    if (disorder(board) > depth) return null;
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
    options.sort((a, b) => priority(board, b, capacity) - priority(board, a, capacity));
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

function priority(board, m, capacity) {
  const a = board[m.from], b = board[m.to];
  const count = transferCount(board, m.from, m.to, capacity || CAPACITY);
  const exposesNewColor = a.length > count;
  return (b.length ? 8 + b.length + count * 2 : count) + (exposesNewColor ? 6 : 0);
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

module.exports = { LEVEL_COUNT, CAPACITY, clone, top, topRun, transferCount, key, isComplete, isSolved, canMove, move, disorder, rateStars, generateLevel, legalMoves, solve, solutionMap };
