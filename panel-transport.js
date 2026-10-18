// Side-panel documents have privileged APIs; collapsing needs no worker reply.
export async function requestMiniTransition(api, windowId, { timeoutMs = 5000 } = {}) {
  async function step(operation, label, limit = timeoutMs) {
    let timer;
    try {
      return await Promise.race([
        operation(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}超时`)), limit); })
      ]);
    } finally { clearTimeout(timer); }
  }
  // An extension tab must never close a native panel in the same window.
  const ownTab = await step(() => api.tabs.getCurrent(), '识别栖边页面');
  if (ownTab) return { ok:true, inPage:true };
  if (!Number.isInteger(windowId) || windowId < 0) throw new Error('无法确定栖边所在窗口。');
  const [tab] = await step(() => api.tabs.query({ active:true, windowId }), '读取当前网页');
  if (!tab || !/^https?:/.test(tab.url || '')) throw new Error('当前页面不允许放置图标栏。请切换到普通网页后再点击小图标模式。');
  const confirm = async limit => {
    const rail = await step(() => api.tabs.sendMessage(tab.id, { type:'qibian:mini' }, { frameId:0 }), '确认网页图标栏', limit);
    return rail?.ok === true && rail.mode === 'mini' && rail.width > 0 && rail.width <= 64;
  };
  let stage = '连接已有图标栏';
  try {
    // Static content scripts usually already exist. Do not require a second
    // script injection just to collapse them, and never message embedded frames.
    const ready = await confirm(Math.min(timeoutMs, 500)).catch(() => false);
    if (!ready) {
      stage = '加载网页图标栏';
      await step(() => api.scripting.executeScript({ target:{ tabId:tab.id }, files:['rail.js'], injectImmediately:true }), stage);
      stage = '确认网页图标栏';
      if (!await confirm(timeoutMs)) throw new Error('网页图标栏尚未就绪');
    }
  } catch(error) {
    const host = new URL(tab.url).hostname;
    let granted = null;
    try { granted = await step(() => api.permissions.contains({ origins:[new URL(tab.url).origin + '/*'] }), '读取网站权限', 1000); } catch { /* Unknown is not denied. */ }
    const advice = granted === false
      ? `栖边尚未获得 ${host} 的网站访问权限。请在扩展详情中允许访问此网站，返回网页并刷新后重试。`
      : granted === true
        ? `栖边已获得 ${host} 的网站权限，但 Edge 仍拒绝${stage}。请先刷新网页；若仍失败，请复制诊断信息。`
        : `Edge 未能在 ${host} 显示图标栏。请打开扩展权限设置确认网站访问范围，并刷新网页。`;
    const failure = new Error(`${advice}（${error.message}）`);
    const reason = String(error.message).replace(/(?:https?|file|chrome-extension):\/\/[^\s"'<>]+/gi, value => {
      try { const url = new URL(value); return url.protocol + '//' + url.hostname + '/'; } catch { return '[网址]'; }
    });
    failure.miniDiagnostic = { version:api.runtime.getManifest?.().version || 'unknown', host, stage, hostPermission:granted, reason };
    throw failure;
  }
  // Confirm the replacement before releasing the native gutter.
  try {
    await step(() => api.sidePanel.close({ windowId }), '关闭原生侧栏');
  } catch {
    // Older Edge may lack close(), or expose it without completing the call.
    // Re-enabling immediately can restore the empty native gutter.
    await step(() => api.sidePanel.setOptions({ tabId:tab.id, enabled:false }), '关闭当前标签页侧栏');
    await step(() => api.sidePanel.setOptions({ enabled:false }), '关闭窗口侧栏');
  }
  return { ok:true, inPage:false, tabId:tab.id };
}
