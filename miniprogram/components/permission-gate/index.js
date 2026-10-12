// 权限容器:包住需要某项系统权限的功能
//   已授权 → 显示插槽里的内容
//   未授权 → 显示用途说明 + "开启"按钮;点按钮先弹"申请说明"弹窗,
//            用户确认后才真正调用 wx.authorize(先说明、后申请)
//   被拒过 → wx.authorize 不会再弹系统框,改为引导去设置页
// <permission-gate scope="scope.camera" name="相机" reason="..." bind:change="...">
//   <camera .../>
// </permission-gate>
const privacy = require('../../utils/privacy');

Component({
  options: { multipleSlots: false },

  properties: {
    scope: { type: String, value: '' },
    name: { type: String, value: '' },
    reason: { type: String, value: '' },
  },

  data: {
    status: 'unknown',   // unknown | notAsked | authorized | denied
    dialog: false,
  },

  lifetimes: {
    attached() { this.refresh(); },
  },

  // 从设置页回来要重新读一次
  pageLifetimes: {
    show() { this.refresh(); },
  },

  methods: {
    refresh() {
      const scope = this.data.scope;
      if (!scope) return;
      wx.getSetting({
        success: res => {
          const v = res.authSetting[scope];
          this._setStatus(v === true ? 'authorized' : (v === false ? 'denied' : 'notAsked'));
        },
      });
    },

    _setStatus(status) {
      if (status === this.data.status) return;
      this.setData({ status });
      this.triggerEvent('change', { scope: this.data.scope, status });
    },

    onRequest() {
      this.setData({ dialog: true });
    },

    onDialogCancel() {
      this.setData({ dialog: false });
      privacy.addLog(`取消申请${this.data.name}权限`);
    },

    onDialogConfirm() {
      this.setData({ dialog: false });
      if (this.data.status === 'denied') {
        wx.openSetting({ complete: () => this.refresh() });
        return;
      }
      wx.authorize({
        scope: this.data.scope,
        success: () => {
          privacy.addLog(`授予${this.data.name}权限`);
          this._setStatus('authorized');
        },
        fail: err => {
          privacy.addLog(`未授予${this.data.name}权限`);
          // 用户拒绝或隐私授权未同意:以 getSetting 为准
          this.refresh();
          if (err && /privacy/i.test(err.errMsg || '')) {
            wx.showToast({ title: '需先同意隐私保护指引', icon: 'none' });
          }
        },
      });
    },

    noop() {},
  },
});
