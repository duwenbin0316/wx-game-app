// ── 隐私合规工具 ─────────────────────────────────────────────
// 1. 接管微信隐私授权:wx.onNeedPrivacyAuthorization 只能全局注册一次、
//    且无法注销,所以这里统一注册一次,再把弹窗请求转给"当前可见页面"上
//    挂着的 <privacy-popup> 组件(组件在页面 show/hide 时自动登记/注销)。
//    注意:注册之后整个小程序都不再弹微信官方弹窗。凡是调用隐私接口的页面
//    都要放一个 <privacy-popup>;没放的页面这次调用会按"拒绝"处理。
// 2. 本地留存一份同意记录(协议版本 + 时间)和操作日志,用于展示与撤回。
//    微信侧的隐私授权本身没有撤回接口,用户只能在微信里删除小程序或到
//    "设置 → 隐私"里处理;这里能撤回的是我们自己保存的同意记录。

const POLICY_VERSION = '2026.10';
const CONSENT_KEY = 'privacy_consent';   // { version, agreedAt }
const LOG_KEY = 'privacy_log';           // [{ action, at }],最多 30 条

// 运行时能力检测(基础库版本不同,接口可能不存在)
const support = {
  privacySetting: typeof wx.getPrivacySetting === 'function',
  needAuthorization: typeof wx.onNeedPrivacyAuthorization === 'function',
  openContract: typeof wx.openPrivacyContract === 'function',
  requireAuthorize: typeof wx.requirePrivacyAuthorize === 'function',
  visualEffect: typeof wx.setVisualEffectOnCapture === 'function',
  captureScreen: typeof wx.onUserCaptureScreen === 'function',
  recordingState: typeof wx.onScreenRecordingStateChanged === 'function',
};

const popups = [];          // 已挂载且可见的弹窗组件,最后一个是当前页的
let installed = false;

function install() {
  if (installed || !support.needAuthorization) return;
  installed = true;
  wx.onNeedPrivacyAuthorization((resolve, eventInfo) => {
    const popup = popups[popups.length - 1];
    if (popup) {
      popup.openForRequest(resolve, eventInfo);
    } else {
      // 当前页面没有挂弹窗组件:无法让用户点击同意按钮,只能拒绝这次调用
      resolve({ event: 'disagree' });
      addLog('当前页面无隐私弹窗,已拒绝本次调用');
    }
  });
}

function mount(popup) {
  install();
  unmount(popup);
  popups.push(popup);
}

function unmount(popup) {
  const i = popups.indexOf(popup);
  if (i >= 0) popups.splice(i, 1);
}

function getPrivacySetting() {
  return new Promise(resolve => {
    if (!support.privacySetting) {
      resolve({ supported: false, needAuthorization: false, privacyContractName: '' });
      return;
    }
    wx.getPrivacySetting({
      success: res => resolve(Object.assign({ supported: true }, res)),
      fail: () => resolve({ supported: true, needAuthorization: false, privacyContractName: '' }),
    });
  });
}

function getConsent() {
  try {
    return wx.getStorageSync(CONSENT_KEY) || null;
  } catch (e) {
    return null;
  }
}

function addLog(action) {
  let log = [];
  try { log = wx.getStorageSync(LOG_KEY) || []; } catch (e) {}
  log.unshift({ action, at: Date.now() });
  try { wx.setStorageSync(LOG_KEY, log.slice(0, 30)); } catch (e) {}
}

function getLog() {
  try {
    return wx.getStorageSync(LOG_KEY) || [];
  } catch (e) {
    return [];
  }
}

function saveConsent() {
  const consent = { version: POLICY_VERSION, agreedAt: Date.now() };
  try { wx.setStorageSync(CONSENT_KEY, consent); } catch (e) {}
  addLog(`同意隐私保护指引 v${POLICY_VERSION}`);
  return consent;
}

function revokeConsent() {
  try { wx.removeStorageSync(CONSENT_KEY); } catch (e) {}
  addLog('撤回同意(已清除本地同意记录)');
}

function openContract() {
  if (!support.openContract) {
    wx.showToast({ title: '当前基础库不支持', icon: 'none' });
    return;
  }
  wx.openPrivacyContract({
    fail: () => wx.showToast({ title: '打开失败,请检查后台隐私指引配置', icon: 'none' }),
  });
}

function formatTime(ts) {
  const d = new Date(ts);
  const p = n => (n < 10 ? `0${n}` : `${n}`);
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

module.exports = {
  POLICY_VERSION,
  support,
  install,
  mount,
  unmount,
  getPrivacySetting,
  getConsent,
  saveConsent,
  revokeConsent,
  addLog,
  getLog,
  openContract,
  formatTime,
};
