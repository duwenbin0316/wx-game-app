// 隐私授权弹窗:放在每个会调用隐私接口的页面里
//   - 微信需要隐私授权时(onNeedPrivacyAuthorization),由 utils/privacy 调起
//   - 也可以由页面主动 show()(比如首次启动展示)
// "同意"必须是 open-type="agreePrivacyAuthorization" 的 button,且 resolve
// 时带上它的 id,微信才认这次同意。
const privacy = require('../../utils/privacy');

Component({
  data: {
    visible: false,
    contractName: '《隐私保护指引》',
    reason: '',
  },

  lifetimes: {
    attached() {
      privacy.mount(this);
      privacy.getPrivacySetting().then(res => {
        if (res.privacyContractName) this.setData({ contractName: res.privacyContractName });
      });
    },
    detached() {
      privacy.unmount(this);
      this._finish({ event: 'disagree' });
    },
  },

  // 只让当前可见页面的弹窗接管请求
  pageLifetimes: {
    show() { privacy.mount(this); },
    hide() { privacy.unmount(this); },
  },

  methods: {
    // 由 utils/privacy 调用:微信在等用户表态
    openForRequest(resolve, eventInfo) {
      this._finish({ event: 'disagree' });   // 上一次没处理完的先按拒绝结束
      this._resolve = resolve;
      const api = eventInfo && eventInfo.referrer ? `(触发接口:${eventInfo.referrer})` : '';
      this.setData({ visible: true, reason: api });
      resolve({ event: 'exposureAuthorization' });   // 告诉微信弹窗已展示
      privacy.addLog(`弹出隐私授权弹窗${api}`);
    },

    // 页面主动展示(首次启动 / 演示)
    show() {
      this.setData({ visible: true, reason: '' });
    },

    _finish(result) {
      if (this._resolve) {
        this._resolve(result);
        this._resolve = null;
      }
    },

    onOpenContract() {
      privacy.openContract();
    },

    onAgree() {
      this._finish({ buttonId: 'privacy-agree-btn', event: 'agree' });
      privacy.saveConsent();
      this.setData({ visible: false });
      this.triggerEvent('agree');
    },

    onDisagree() {
      this._finish({ event: 'disagree' });
      privacy.addLog('拒绝隐私保护指引');
      this.setData({ visible: false });
      this.triggerEvent('disagree');
    },

    noop() {},
  },
});
