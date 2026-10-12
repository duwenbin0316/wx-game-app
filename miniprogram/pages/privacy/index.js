// 隐私合规 Demo:隐私协议、隐私授权弹窗、撤回、权限容器、权限申请弹窗、
// 防截屏 / 防录屏。各能力按运行时 API 是否存在降级,不支持的会标注出来。
const privacy = require('../../utils/privacy');

const SENSITIVE = {
  phone: ['138****6721', '13812346721'],
  idCard: ['3101**********2516', '310104199001012516'],
};

Page({
  data: {
    sdkVersion: '',
    support: privacy.support,
    // 隐私授权
    needAuthorization: false,
    contractName: '',
    consentText: '未同意',
    // 撤回 / 日志
    log: [],
    // 防截屏 / 录屏
    hideOnCapture: false,
    captureCount: 0,
    lastCapture: '',
    recording: false,
    showPlain: false,
    phone: SENSITIVE.phone[0],
    idCard: SENSITIVE.idCard[0],
    watermarks: [],
    showAgreement: false,
    clipboardResult: '',
  },

  onLoad() {
    let sdk = '';
    try {
      sdk = (wx.getAppBaseInfo ? wx.getAppBaseInfo() : wx.getSystemInfoSync()).SDKVersion || '';
    } catch (e) {}
    const stamp = `Game Hub · ${privacy.formatTime(Date.now()).slice(0, 11)}`;
    this.setData({ sdkVersion: sdk, watermarks: Array.from({ length: 12 }, (_, i) => ({ id: i, text: stamp })) });
    this.bindCaptureListeners();
  },

  onShow() {
    this.refreshPrivacy();
  },

  onUnload() {
    this.unbindCaptureListeners();
    if (this.data.hideOnCapture && privacy.support.visualEffect) {
      wx.setVisualEffectOnCapture({ visualEffect: 'none' });
    }
  },

  // ── 隐私授权状态 ────────────────────────────────────────
  async refreshPrivacy() {
    const res = await privacy.getPrivacySetting();
    const consent = privacy.getConsent();
    this.setData({
      needAuthorization: !!res.needAuthorization,
      contractName: res.privacyContractName || '《隐私保护指引》',
      consentText: consent ? `v${consent.version} · ${privacy.formatTime(consent.agreedAt)}` : '无本地记录',
      log: privacy.getLog().map(l => ({ at: privacy.formatTime(l.at), action: l.action })),
    });
  },

  // ── 1. 隐私协议 ────────────────────────────────────────
  onOpenContract() {
    privacy.openContract();
  },

  onToggleAgreement() {
    this.setData({ showAgreement: !this.data.showAgreement });
  },

  // ── 2. 隐私弹窗 ────────────────────────────────────────
  // 模拟"首次启动":不经过微信,直接展示弹窗
  onShowPopup() {
    this.selectComponent('#privacy-popup').show();
  },

  // 调用一个隐私接口:未授权时微信会回调 onNeedPrivacyAuthorization → 弹窗
  onCallPrivacyApi() {
    this.setData({ clipboardResult: '调用中…' });
    wx.getClipboardData({
      success: res => {
        const text = (res.data || '').slice(0, 20);
        this.setData({ clipboardResult: text ? `读取成功:「${text}」` : '读取成功(剪贴板为空)' });
      },
      fail: err => {
        this.setData({ clipboardResult: `调用失败:${err.errMsg}` });
      },
      complete: () => this.refreshPrivacy(),
    });
  },

  // 主动请求授权(不调用具体接口)
  onRequireAuthorize() {
    if (!privacy.support.requireAuthorize) {
      wx.showToast({ title: '当前基础库不支持', icon: 'none' });
      return;
    }
    wx.requirePrivacyAuthorize({
      success: () => wx.showToast({ title: '已授权', icon: 'none' }),
      fail: () => wx.showToast({ title: '用户未同意', icon: 'none' }),
      complete: () => this.refreshPrivacy(),
    });
  },

  onPopupAgree() {
    wx.showToast({ title: '已同意', icon: 'none' });
    this.refreshPrivacy();
  },

  onPopupDisagree() {
    wx.showToast({ title: '已拒绝', icon: 'none' });
    this.refreshPrivacy();
  },

  // ── 3. 撤回 ────────────────────────────────────────────
  onRevoke() {
    wx.showModal({
      title: '撤回同意',
      content: '将清除本小程序保存的同意记录,下次使用相关功能时重新征求同意。微信侧的授权需在「设置」中处理或删除小程序。',
      confirmText: '撤回',
      success: res => {
        if (!res.confirm) return;
        privacy.revokeConsent();
        this.refreshPrivacy();
        wx.showToast({ title: '已撤回', icon: 'none' });
      },
    });
  },

  onOpenSetting() {
    wx.openSetting({
      complete: () => {
        privacy.addLog('打开权限设置页');
        this.refreshPrivacy();
      },
    });
  },

  onClearLog() {
    try { wx.removeStorageSync('privacy_log'); } catch (e) {}
    this.refreshPrivacy();
  },

  // ── 4. 权限容器 ────────────────────────────────────────
  onPermChange() {
    this.refreshPrivacy();   // 授权变化会写日志,刷新一下展示
  },

  onCameraError(e) {
    wx.showToast({ title: '相机不可用', icon: 'none' });
    console.error('camera error', e.detail);
  },

  // ── 5. 防截屏 / 录屏 ───────────────────────────────────
  onToggleHideOnCapture() {
    if (!privacy.support.visualEffect) {
      wx.showToast({ title: '当前设备/基础库不支持', icon: 'none' });
      return;
    }
    const next = !this.data.hideOnCapture;
    wx.setVisualEffectOnCapture({
      visualEffect: next ? 'hidden' : 'none',
      success: () => {
        this.setData({ hideOnCapture: next });
        privacy.addLog(next ? '开启截屏/录屏隐藏' : '关闭截屏/录屏隐藏');
        this.refreshPrivacy();
      },
      fail: err => wx.showToast({ title: `设置失败:${err.errMsg}`, icon: 'none' }),
    });
  },

  onTogglePlain() {
    const plain = !this.data.showPlain;
    this.setData({
      showPlain: plain,
      phone: SENSITIVE.phone[plain ? 1 : 0],
      idCard: SENSITIVE.idCard[plain ? 1 : 0],
    });
  },

  bindCaptureListeners() {
    this._onCapture = () => {
      const n = this.data.captureCount + 1;
      this.setData({ captureCount: n, lastCapture: privacy.formatTime(Date.now()) });
      privacy.addLog('检测到截屏');
      wx.showToast({ title: '检测到截屏,请注意保护个人信息', icon: 'none' });
    };
    if (privacy.support.captureScreen) wx.onUserCaptureScreen(this._onCapture);

    this._onRecording = res => {
      const on = res && res.state === 'on';
      this.setData({ recording: on });
      if (on) privacy.addLog('检测到录屏开始');
    };
    if (privacy.support.recordingState) {
      wx.onScreenRecordingStateChanged(this._onRecording);
      if (typeof wx.getScreenRecordingState === 'function') {
        wx.getScreenRecordingState({ success: this._onRecording });
      }
    }
  },

  unbindCaptureListeners() {
    if (privacy.support.captureScreen && wx.offUserCaptureScreen) wx.offUserCaptureScreen(this._onCapture);
    if (privacy.support.recordingState && wx.offScreenRecordingStateChanged) {
      wx.offScreenRecordingStateChanged(this._onRecording);
    }
  },
});
