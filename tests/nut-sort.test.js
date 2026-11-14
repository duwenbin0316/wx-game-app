const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Rules = require('../miniprogram/utils/nut-sort');
const Art = require('../miniprogram/utils/nut-art');

test('移动只能取顶端一枚，不能混色、越界、溢出或移动空柱', () => {
  const board = [[0, 1], [1], [], [2, 2, 2, 2]];
  assert.deepEqual(Rules.move(board, 0, 1, 4), [[0], [1, 1], [], [2, 2, 2, 2]]);
  assert.deepEqual(board, [[0, 1], [1], [], [2, 2, 2, 2]]);
  assert.deepEqual(Rules.move(board, 0, 2, 4), [[0], [1], [1], [2, 2, 2, 2]]);
  for (const [from, to] of [[2, 0], [0, 3], [3, 0], [0, 0], [-1, 0], [0, 9], ['0', 2]]) {
    assert.equal(Rules.move(board, from, to, 4), null);
  }
});

test('同色未满柱不算通关，所有颜色各满一柱才算通关', () => {
  assert.equal(Rules.isSolved([[0, 0], [0, 0], []], 4), false);
  assert.equal(Rules.isSolved([[0, 0, 0, 0], [], [1, 1, 1, 1]], 4), true);
  assert.equal(Rules.isSolved([[0, 0, 1, 1], []], 4), false);
});

test('30 关确定、互异、数量守恒，且都有可逐步回放的合法解', () => {
  const seen = new Set();
  for (let index = 0; index < Rules.LEVEL_COUNT; index++) {
    const level = Rules.generateLevel(index);
    assert.deepEqual(level, Rules.generateLevel(index));
    assert.equal(Rules.isSolved(level.rods, level.capacity), false);
    assert.ok(level.rods.some(r => r.length === 0));
    assert.ok(level.rods.every(r => r.length <= level.capacity));
    const all = level.rods.flat();
    for (let color = 0; color < level.colors; color++) assert.equal(all.filter(c => c === color).length, level.capacity);
    assert.equal(all.length, level.colors * level.capacity);
    const id = Rules.key(level.rods);
    assert.equal(seen.has(id), false);
    seen.add(id);
    let current = Rules.clone(level.rods);
    const hints = Rules.solutionMap(current, level.solution, level.capacity);
    for (const step of level.solution) {
      assert.ok(hints.has(Rules.key(current)));
      current = Rules.move(current, step.from, step.to, level.capacity);
      assert.ok(current, `关卡 ${index + 1} 有非法解法步骤`);
    }
    assert.equal(Rules.isSolved(current, level.capacity), true);
  }
});

test('偏离预设路线时，搜索提示能完成一个独立局面', () => {
  const initial = [[0, 1, 0, 1], [1, 0, 1, 0], [], []];
  const solution = Rules.solve(initial, 4, { maxNodes: 50000, budgetMs: 1000 });
  assert.ok(solution && solution.length);
  let board = initial;
  for (const step of solution) {
    board = Rules.move(board, step.from, step.to, 4);
    assert.ok(board);
  }
  assert.equal(Rules.isSolved(board, 4), true);
  assert.equal(Rules.solve([[0, 1], [1, 0]], 2, { budgetMs: 30 }), null);
});

function loadPage(saved) {
  let spec;
  const storage = {};
  const warnings = [];
  const wx = {
    getStorageSync: () => saved,
    setStorageSync: (k, v) => { storage[k] = JSON.parse(JSON.stringify(v)); },
  };
  const file = path.resolve(__dirname, '../miniprogram/pages/nut-sort/index.js');
  const context = { wx, Page: p => { spec = p; }, require: name => require(path.resolve(path.dirname(file), name)),
    console: { warn: (...a) => warnings.push(a) }, setTimeout, clearTimeout, Date };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context);
  const page = { ...spec, data: { ...spec.data }, setData(patch) { Object.assign(this.data, patch); } };
  page.onLoad();
  return { page, storage, warnings };
}

test('动画中切后台只提交一次；撤销回到原局面和步数', () => {
  const { page } = loadPage();
  const before = Rules.clone(page._board);
  const step = page._level.solution[0];
  page._animation = { ...step, start: Date.now() };
  page.onHide();
  assert.equal(page.data.steps, 1);
  assert.equal(page._animation, null);
  page.onHide();
  assert.equal(page.data.steps, 1);
  page.onShow();
  page.onUndo();
  assert.deepEqual(page._board, before);
  assert.equal(page.data.steps, 0);
  assert.equal(page.data.canUndo, false);
});

test('完成一关保存纪录并解锁下一关；最后一关不越界', () => {
  const { page, storage } = loadPage();
  for (const step of page._level.solution) {
    page._animation = step;
    page._finishMove();
  }
  assert.equal(page.data.gameState, 'win');
  const saved = storage.nut_sort_save_v1;
  assert.equal(saved.unlocked, 1);
  assert.equal(saved.best[0], page.data.steps);
  const restored = loadPage(saved).page;
  assert.equal(restored.data.level, 2);
  restored._save.unlocked = 29;
  restored._loadLevel(29);
  for (const step of restored._level.solution) { restored._animation = step; restored._finishMove(); }
  restored.onNext();
  assert.equal(restored.data.level, 30);
  assert.equal(restored.data.showLevels, true);
  assert.equal(restored._save.unlocked, 29);
});

test('损坏存档降级，锁定关卡不能通过事件跳入', () => {
  const { page } = loadPage({ unlocked: 'oops', best: { 0: -5, 1: 'hi', 40: 20 }, muted: false });
  assert.equal(page.data.level, 1);
  assert.equal(page.data.best, 0);
  page.onPickLevel({ currentTarget: { dataset: { index: 12 } } });
  assert.equal(page.data.level, 1);
  page.onPickLevel({ currentTarget: { dataset: { index: -1 } } });
  assert.equal(page.data.level, 1);
});

test('隐藏或卸载时取消待执行提示，不再更新页面', async () => {
  const { page } = loadPage();
  page.onHint();
  assert.equal(page.data.hintBusy, true);
  page.onHide();
  assert.equal(page.data.hintBusy, false);
  assert.equal(page._hintTimer, null);
  await new Promise(resolve => setTimeout(resolve, 45));
  assert.equal(page._hint, null);
  page.onUnload();
  assert.equal(page._disposed, true);
});

test('窄屏和多行布局中，螺母不会重叠，画布内保留抬起空间', () => {
  for (const [width, height] of [[320, 280], [375, 420], [430, 520]]) {
    for (const index of [0, 10, 20, 29]) {
      const level = Rules.generateLevel(index);
      const m = Art.layout(width, height, level.rods.length, level.capacity);
      for (const p of m.positions) {
        assert.ok(p.x - p.radius >= 0 && p.x + p.radius < width);
        assert.ok(p.top - p.radius * 0.75 >= 0, `${width}×${height}: 抬起空间越界`);
        assert.ok(p.y + p.radius < height);
      }
      const sameRow = m.positions.filter(p => p.row === 0);
      for (let i = 1; i < sameRow.length; i++) assert.ok(sameRow[i].x - sameRow[i - 1].x > m.radius * 2);
    }
  }
});

function prepareTouchPage() {
  const { page } = loadPage();
  page.data.ready = true;
  page._metrics = Art.layout(375, 420, page._board.length, page._level.capacity);
  const step = page._level.solution[0];
  const position = i => {
    const p = page._metrics.positions[i];
    return { identifier: 7, x: p.x, y: (p.top + p.y) / 2 };
  };
  return { page, step, position };
}

function tap(page, touch) {
  page.onCanvasTouchStart({ touches: [touch] });
  page.onCanvasTouchEnd({ touches: [], changedTouches: [touch] });
}

test('单指轻点可选中和搬运；滑动、多指、取消与无起点松手不操作棋面', () => {
  const { page, step, position } = prepareTouchPage();
  const source = position(step.from), target = position(step.to);
  page.onCanvasTouchEnd({ touches: [], changedTouches: [source] });
  assert.equal(page._selected, -1);
  tap(page, source);
  assert.equal(page._selected, step.from);
  page.onCanvasTouchStart({ touches: [target] });
  page.onCanvasTouchMove({ touches: [{ ...target, x: target.x + 25 }] });
  page.onCanvasTouchEnd({ touches: [], changedTouches: [target] });
  assert.equal(page._animation, null);
  page.onCanvasTouchStart({ touches: [target] });
  page.onCanvasTouchStart({ touches: [target, { ...target, identifier: 8 }] });
  page.onCanvasTouchEnd({ touches: [target], changedTouches: [{ ...target, identifier: 8 }] });
  page.onCanvasTouchEnd({ touches: [], changedTouches: [target] });
  assert.equal(page._animation, null);
  page.onCanvasTouchStart({ touches: [target] });
  page.onCanvasTouchCancel();
  page.onCanvasTouchEnd({ touches: [], changedTouches: [target] });
  assert.equal(page._animation, null);
  tap(page, target);
  assert.ok(page._animation);
  page._finishMove();
  assert.equal(page.data.steps, 1);
});

test('松手位置远离起点、跨指松手以及跨关卡的触摸均不触发选择', () => {
  const { page, step, position } = prepareTouchPage();
  const source = position(step.from);
  page.onCanvasTouchStart({ touches: [{ ...source, x: source.x - 30 }] });
  page.onCanvasTouchEnd({ touches: [], changedTouches: [source] });
  assert.equal(page._selected, -1);
  page.onCanvasTouchStart({ touches: [source] });
  page.onCanvasTouchEnd({ touches: [], changedTouches: [{ ...source, identifier: 8 }] });
  assert.equal(page._selected, -1);
  page.onCanvasTouchStart({ touches: [source] });
  page._loadLevel(0);
  page.onCanvasTouchEnd({ touches: [], changedTouches: [source] });
  assert.equal(page._selected, -1);
});

test('提示被后台中断后恢复普通提示；卸载不再 setData', async () => {
  const { page } = loadPage();
  page.onHint();
  page.onHide();
  page.onShow();
  assert.equal(page.data.hintBusy, false);
  assert.notEqual(page.data.tip, '正在寻找整理路线…');
  page._select(page._level.solution[0].from);
  page.onHint();
  page.onHide();
  page.onShow();
  assert.equal(page._selected, -1);
  assert.equal(page.data.tip.includes('已抬起'), false);
  page.onHint();
  let updates = 0;
  const original = page.setData;
  page.setData = function(patch) { updates++; original.call(this, patch); };
  page.onUnload();
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(updates, 0);
});
