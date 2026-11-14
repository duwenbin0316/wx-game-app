const Rules = require('../../utils/nut-sort');
const Art = require('../../utils/nut-art');
const { createWoodPlayer } = require('../../utils/wood-sfx');
const { buildShareImage } = require('../../utils/share-card');
const SAVE_KEY = 'nut_sort_save_v1';

Page({
  data: {
    level: 1, levelCount: Rules.LEVEL_COUNT, levelName: '', steps: 0, best: 0,
    completed: 0, colors: 3, capacity: 4, tip: '先选一根柱子，再点空柱或顶端同色的柱子',
    gameState: 'playing', canUndo: false, showLevels: false, showHelp: false,
    levelList: [], hintBusy: false, muted: false, ready: false,
  },

  onLoad() {
    this._active = true;
    this._disposed = false;
    this._save = { unlocked: 0, best: {}, muted: false };
    try {
      const saved = wx.getStorageSync(SAVE_KEY);
      if (saved && typeof saved === 'object') {
        if (Number.isInteger(saved.unlocked)) this._save.unlocked = Math.max(0, Math.min(Rules.LEVEL_COUNT - 1, saved.unlocked));
        if (saved.best && typeof saved.best === 'object') {
          Object.keys(saved.best).forEach(k => {
            if (Number.isInteger(+k) && +k >= 0 && +k < Rules.LEVEL_COUNT && Number.isInteger(saved.best[k]) && saved.best[k] > 0) this._save.best[k] = saved.best[k];
          });
        }
        this._save.muted = !!saved.muted;
      }
    } catch (e) { console.warn('读取螺母进度失败', e); }
    this.setData({ muted: this._save.muted });
    this._loadLevel(this._save.unlocked);
  },

  onReady() {
    wx.createSelectorQuery().in(this).select('#nut-canvas').fields({ node: true, size: true }).exec(res => {
      if (this._disposed) return;
      const info = res && res[0];
      if (!info || !info.node) {
        wx.showToast({ title: '画布未能加载，请返回重试', icon: 'none' });
        return;
      }
      this._canvas = info.node;
      this._ctx = this._canvas.getContext('2d');
      this._W = info.width;
      this._H = info.height;
      this._dpr = Math.min(wx.getSystemInfoSync().pixelRatio || 2, 3);
      this._canvas.width = Math.round(this._W * this._dpr);
      this._canvas.height = Math.round(this._H * this._dpr);
      this._ctx.scale(this._dpr, this._dpr);
      this._buildStage();
      this.setData({ ready: true });
      this._render();
    });
  },

  onShow() { this._active = true; this._render(); },
  onHide() {
    this._active = false;
    this._clearHintWork();
    this._stopFrame();
    // 搬运动画中离开页面时提交这一步，回来不会留下半搬状态。
    if (this._animation) this._finishMove();
    if (this._audio && this._audio.suspend) {
      try { this._audio.suspend(); } catch (e) {}
    }
  },
  onUnload() {
    this._disposed = true;
    this._active = false;
    this._stopFrame();
    this._clearHintWork();
    if (this._audio) {
      try { this._audio.close(); } catch (e) {}
    }
    this._audio = null;
    this._sfx = null;
    this._stage = null;
  },

  _persist() {
    try { wx.setStorageSync(SAVE_KEY, this._save); }
    catch (e) { console.warn('保存螺母进度失败', e); }
  },

  _loadLevel(index) {
    this._clearHintWork();
    this._stopFrame();
    this._level = Rules.generateLevel(index);
    this._board = Rules.clone(this._level.rods);
    this._solutionMap = Rules.solutionMap(this._level.rods, this._level.solution, this._level.capacity);
    this._history = [];
    this._selected = -1;
    this._hint = null;
    this._animation = null;
    this.setData({ level: index + 1, levelName: this._level.name, colors: this._level.colors, capacity: this._level.capacity,
      steps: 0, best: this._save.best[index] || 0, gameState: 'playing', canUndo: false,
      showLevels: false, showHelp: false, hintBusy: false,
      tip: index === 0 ? '把相同颜色归到一根柱子，试试先用空柱周转' : '先选一根柱子，再点空柱或顶端同色的柱子' });
    this._syncCompleted();
    this._buildStage();
    this._render();
  },

  _buildStage() {
    if (!this._canvas) return;
    this._metrics = Art.layout(this._W, this._H, this._board.length, this._level.capacity);
    // 木纹、底板和杆子只绘制一次；选中、移动时重用离屏背景。
    try {
      this._stage = wx.createOffscreenCanvas({ type: '2d', width: this._canvas.width, height: this._canvas.height });
      const g = this._stage.getContext('2d');
      g.scale(this._dpr, this._dpr);
      Art.drawStage(g, this._metrics, this._level.capacity);
    } catch (e) { this._stage = null; }
  },

  _render() {
    if (!this._ctx || !this._metrics || !this._active || this._disposed) return;
    const g = this._ctx;
    g.clearRect(0, 0, this._W, this._H);
    if (this._stage) g.drawImage(this._stage, 0, 0, this._W, this._H);
    else Art.drawStage(g, this._metrics, this._level.capacity);
    Art.drawBoard(g, this._board, this._metrics, { selected: this._selected, hint: this._hint, moving: this._animation, capacity: this._level.capacity });
    if (!this._animation) return;
    const a = this._animation;
    const t = Math.min(1, (Date.now() - a.start) / 380);
    const from = this._metrics.positions[a.from], to = this._metrics.positions[a.to];
    const r = this._metrics.radius;
    const y0 = from.y - r * 0.6 - (this._board[a.from].length - 1) * from.step;
    const y1 = to.y - r * 0.6 - this._board[a.to].length * to.step;
    const high = Math.min(from.top, to.top) - r * 0.75;
    let x, y;
    if (t < 0.25) { const k = 1 - Math.pow(1 - t / 0.25, 2); x = from.x; y = y0 + (high - y0) * k; }
    else if (t < 0.7) { const k = (t - 0.25) / 0.45; const s = k * k * (3 - 2 * k); x = from.x + (to.x - from.x) * s; y = high - Math.sin(k * Math.PI) * r * 0.5; }
    else { const k = (t - 0.7) / 0.3; x = to.x; y = high + (y1 - high) * k * k; }
    Art.drawNut(g, x, y, r, Rules.top(this._board[a.from]), a.from);
    if (t >= 1) { this._finishMove(); return; }
    this._raf = this._canvas.requestAnimationFrame(() => { this._raf = null; this._render(); });
  },

  _stopFrame() {
    if (this._raf != null && this._canvas) this._canvas.cancelAnimationFrame(this._raf);
    this._raf = null;
  },

  onCanvasTap(e) {
    if (!this.data.ready || this._animation || this.data.hintBusy || this.data.gameState !== 'playing' || this.data.showLevels || this.data.showHelp) return;
    const touch = e.changedTouches && e.changedTouches[0];
    if (!touch) return;
    const x = touch.x, y = touch.y;
    // Canvas touch 的 x/y 为相对画布坐标，不混用页面 clientX/clientY。
    const index = this._metrics.positions.findIndex(p => Math.abs(x - p.x) <= p.width / 2 && y >= p.top - p.radius && y <= p.y + p.radius);
    if (index < 0) return;
    this._ensureAudio();
    this._hint = null;
    if (this._selected === index) { this._selected = -1; this._render(); return; }
    if (this._selected < 0) { this._select(index); return; }
    if (!Rules.canMove(this._board, this._selected, index, this._level.capacity)) {
      const reason = this._board[index].length === this._level.capacity ? '这根柱子满了，换一根试试' : '只能放到空柱，或顶端颜色相同的柱子';
      this.setData({ tip: reason });
      this._sound('move', 0.65, 0.35);
      return;
    }
    this._animation = { from: this._selected, to: index, start: Date.now() };
    this._selected = -1;
    this._render();
  },

  _select(index) {
    if (!this._board[index].length) { this.setData({ tip: '先点有螺母的柱子，选择顶端的一枚' }); return; }
    this._selected = index;
    this.setData({ tip: '已抬起顶端螺母 · 点另一根柱子放下，再点原柱取消' });
    this._sound('rotate', 1.2, 0.3);
    this._render();
  },

  _finishMove() {
    const a = this._animation;
    if (!a) return;
    const next = Rules.move(this._board, a.from, a.to, this._level.capacity);
    this._animation = null;
    if (!next) { this._render(); return; }
    this._history.push(Rules.clone(this._board));
    this._board = next;
    this.setData({ steps: this._history.length, canUndo: true });
    this._syncCompleted();
    this._sound('lock', 0.9 + Rules.top(next[a.to]) * 0.06, 0.6);
    if (Rules.isSolved(next, this._level.capacity)) {
      const i = this._level.index;
      const steps = this._history.length;
      if (!this._save.best[i] || steps < this._save.best[i]) this._save.best[i] = steps;
      this._save.unlocked = Math.max(this._save.unlocked, Math.min(Rules.LEVEL_COUNT - 1, i + 1));
      this._persist();
      this.setData({ gameState: 'win', best: this._save.best[i], tip: '颜色归位，木作完成！' });
      this._sound('win', 1, 0.65);
    } else {
      const stuck = Rules.legalMoves(next, this._level.capacity).length === 0;
      this.setData({ tip: stuck ? '暂时没有可走的步，点「撤销」换条路线' : '同色归一，慢慢来 · 先选，再放' });
    }
    this._render();
  },

  _syncCompleted() {
    this.setData({ completed: this._board.filter(r => Rules.isComplete(r, this._level.capacity)).length });
  },

  onUndo() {
    if (this._animation || !this._history.length || this.data.gameState !== 'playing') return;
    this._clearHintWork();
    this._board = this._history.pop();
    this._selected = -1;
    this._hint = null;
    this.setData({ steps: this._history.length, canUndo: !!this._history.length, tip: '已撤销一步，试试另一条路线' });
    this._syncCompleted();
    this._render();
    this._sound('move', 0.9, 0.4);
  },

  onRestart() {
    if (this._animation || !this.data.ready) return;
    if (!this._history.length || this.data.gameState === 'win') { this._loadLevel(this._level.index); return; }
    wx.showModal({ title: '重新整理？', content: '本关会回到初始摆放，已解锁的关卡和纪录会保留。', confirmText: '重开',
      success: res => { if (res.confirm && !this._disposed) this._loadLevel(this._level.index); } });
  },

  onNext() {
    if (this.data.gameState !== 'win') return;
    if (this._level.index < Rules.LEVEL_COUNT - 1) this._loadLevel(this._level.index + 1);
    else this.onShowLevels();
  },

  onHint() {
    if (this._animation || this.data.hintBusy || this.data.gameState !== 'playing') return;
    this._selected = -1;
    this.setData({ hintBusy: true, tip: '正在寻找整理路线…' });
    this._hintTimer = setTimeout(() => {
      this._hintTimer = null;
      if (!this._active || this._disposed) return;
      const k = Rules.key(this._board);
      const solution = this._solutionMap.get(k) || Rules.solve(this._board, this._level.capacity);
      if (solution && solution.length) {
        // 缓存求解得到的路线，下一次提示不用重新搜索。
        Rules.solutionMap(this._board, solution, this._level.capacity).forEach((v, state) => this._solutionMap.set(state, v));
        this._hint = solution[0];
        this.setData({ hintBusy: false, tip: `先选 ${this._hint.from + 1} 号柱，再放到 ${this._hint.to + 1} 号柱` });
      } else {
        this._hint = null;
        this.setData({ hintBusy: false, tip: '暂时没找到路线，可撤销几步后再试，或重开本关' });
      }
      this._render();
    }, 30);
  },

  _clearHintWork() {
    if (this._hintTimer != null) clearTimeout(this._hintTimer);
    this._hintTimer = null;
    if (this.data.hintBusy) this.setData({ hintBusy: false });
  },

  onShowLevels() {
    if (this._animation) return;
    this._clearHintWork();
    this.setData({ showLevels: true, showHelp: false, levelList: Array.from({ length: Rules.LEVEL_COUNT }, (_, i) => ({
      index: i, label: i + 1, locked: i > this._save.unlocked, current: i === this._level.index, best: this._save.best[i] || 0,
    })) });
  },
  onCloseLevels() { this.setData({ showLevels: false }); },
  onPickLevel(e) {
    const index = +e.currentTarget.dataset.index;
    if (!Number.isInteger(index) || index < 0 || index > this._save.unlocked) return;
    this._loadLevel(index);
  },
  onHelp() { if (!this._animation) this.setData({ showHelp: true }); },
  onCloseHelp() { this.setData({ showHelp: false }); },
  onMute() {
    const muted = !this.data.muted;
    this._save.muted = muted;
    this.setData({ muted });
    this._persist();
  },
  noop() {},

  _ensureAudio() {
    if (!this._audio && !this.data.muted) {
      try {
        this._audio = wx.createWebAudioContext();
        this._sfx = createWoodPlayer(this._audio, ['move', 'rotate', 'lock', 'win']);
      } catch (e) { this._audio = null; this._sfx = null; }
    }
    if (this._audio && this._audio.resume) {
      try { this._audio.resume(); } catch (e) {}
    }
  },
  _sound(name, rate, vol) { if (!this.data.muted && this._active && this._sfx) this._sfx.play(name, rate, vol); },

  onShareAppMessage() {
    const base = { title: `木螺母归色 · 第 ${this.data.level} 关，一起慢慢整理`, path: '/pages/nut-sort/index' };
    return { ...base, promise: buildShareImage(wx, {
      title: '木螺母归色', subtitle: `第 ${this.data.level} 关`, score: this.data.steps, best: this.data.best,
      mainLabel: '整理步数', bestLabel: '个人最佳', bestText: this.data.best ? String(this.data.best) : '待完成',
      idleLines: ['同色归一', '慢慢整理'],
      art: (g, box) => {
        const m = Art.layout(box.w, box.h, this._board.length, this._level.capacity);
        g.save(); g.translate(box.x, box.y); Art.drawStage(g, m, this._level.capacity);
        Art.drawBoard(g, this._board, m, { capacity: this._level.capacity }); g.restore();
      },
    }).then(image => image ? { ...base, imageUrl: image } : base).catch(() => base) };
  },
});
