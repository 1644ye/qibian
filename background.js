import { openNativeSidebar } from './panel-launcher.js';
const pageMatches = ['http://*/*', 'https://*/*'];
const openWindows = new Set();
const panelPorts = new Map();
const closeTimers = new Map();
const miniTransitions = new Map();
const configure = () => chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(console.error);

async function releaseNativePanel(sender, requestedWindowId) {
  // Match this document, not just its URL: a tab can host the same extension page.
  const contexts = await chrome.runtime.getContexts({ contextTypes:['SIDE_PANEL'] });
  const normalizeId = value => String(value || '').replaceAll('-', '').toLowerCase();
  const context = sender.documentId
    ? contexts.find(item => normalizeId(item.documentId) === normalizeId(sender.documentId))
    // Edge can omit both documentId and tab for native side-panel senders,
    // and report -1 for their context window. Real extension tabs have sender.tab.
    : !sender.tab && contexts.find(item => item.documentUrl === sender.url && (item.windowId === requestedWindowId || item.windowId === -1));
  if (!context) return { ok:true, inPage:true };
  const windowId = context.windowId >= 0 ? context.windowId : requestedWindowId;
  if (!Number.isInteger(windowId) || windowId < 0) throw new Error('无法确定侧栏所在的浏览器窗口，请重新打开栖边。');
  const [tab] = await chrome.tabs.query({ active:true, windowId });
  if (!tab || !/^https?:/.test(tab.url || '')) throw new Error('当前页面不允许放置图标栏。请切换到普通网页后再点击小图标模式，网页就能收回侧栏宽度。');
  // Establish and confirm the replacement before closing the native surface.
  try {
    await chrome.scripting.executeScript({ target:{ tabId:tab.id }, files:['rail.js'] });
    const rail = await chrome.tabs.sendMessage(tab.id, { type:'qibian:mini' }, { frameId:0 });
    if (!rail?.ok || rail.mode !== 'mini' || rail.width > 64) throw new Error('图标栏尚未就绪');
  } catch {
    throw new Error('当前网站未能显示图标栏，请刷新网页或检查栖边的网站访问权限后重试。');
  }
  try {
    if (!chrome.sidePanel.close) throw new Error('No close API');
    await chrome.sidePanel.close({ windowId });
  } catch {
    // Keep disabled until the next explicit open. Re-enabling immediately can
    // restore Edge's still-open native surface and retain the blank gutter.
    await chrome.sidePanel.setOptions({ enabled:false });
    await chrome.sidePanel.setOptions({ tabId:tab.id, enabled:false });
  }
  for (const [port, id] of panelPorts) if (id === windowId) panelPorts.delete(port);
  setPanelVisible(windowId, false);
  return { ok:true, inPage:false, tabId:tab.id };
}

async function notifyRails(windowId, visible) {
  const tabs = await chrome.tabs.query({ windowId, url: pageMatches });
  if (visible !== !openWindows.has(windowId)) return; // Discard an obsolete async open/close notification.
  await Promise.allSettled(tabs.map(tab => chrome.tabs.sendMessage(tab.id, { type: 'qibian:rail-visibility', visible, nativeOpen:!visible }, { frameId: 0 })));
}
function setPanelVisible(windowId, visible) {
  if (!Number.isInteger(windowId) || windowId < 0) return;
  clearTimeout(closeTimers.get(windowId));
  closeTimers.delete(windowId);
  if (visible) openWindows.add(windowId);
  else openWindows.delete(windowId);
  notifyRails(windowId, !visible).catch(console.error);
}
async function injectExistingPages() {
  const tabs = await chrome.tabs.query({ url: pageMatches });
  // Restricted pages (including extension stores) can reject injection despite an HTTPS URL.
  await Promise.allSettled(tabs.map(tab => chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['rail.js'] })));
}
async function reconcilePanel(windowId) {
  // A panel can be closed before its page has connected a port. Edge may omit
  // lifecycle events in this short interval, so confirm the actual view exists.
  if (typeof chrome.runtime.getContexts !== 'function') return;
  try {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'], windowIds: [windowId] });
    if (!contexts.length && ![...panelPorts.values()].includes(windowId)) setPanelVisible(windowId, false);
  } catch (error) { console.warn(error); }
}
chrome.runtime.onInstalled.addListener(() => {
  configure();
  injectExistingPages().catch(console.error);
});
chrome.runtime.onStartup.addListener(() => {
  openWindows.clear();
  panelPorts.clear();
  // Reset only on browser startup, never on an ordinary service-worker restart.
  // Disabling then enabling also works on Edge versions without sidePanel.close().
  chrome.sidePanel.setOptions({ enabled: false })
    .then(() => chrome.sidePanel.setOptions({ path: 'sidepanel.html', enabled: true }))
    .then(configure)
    .then(injectExistingPages)
    .catch(console.error);
});

chrome.runtime.onConnect.addListener(port => {
  if (port.name === 'qibian-mini-transition') {
    if (!port.sender?.url?.startsWith(chrome.runtime.getURL('sidepanel.html'))) { port.disconnect(); return; }
    port.onMessage.addListener(message => {
      if (message?.type !== 'qibian:release-to-mini' || typeof message.requestId !== 'string' || message.requestId.length > 80) return;
      const key = `${port.sender.documentId || port.sender.tab?.id || port.sender.url}:${message.windowId}:${message.requestId}`;
      let transition = miniTransitions.get(key);
      if (!transition) {
        transition = releaseNativePanel(port.sender, message.windowId).catch(error => ({ ok:false, error:error.message || '图标模式切换失败，请检查当前网页。' }));
        miniTransitions.set(key, transition);
        transition.finally(() => setTimeout(() => miniTransitions.delete(key), 60000));
      }
      transition.then(result => { try { port.postMessage({ requestId:message.requestId, result }); } catch { /* A closed native panel no longer needs the response. */ } });
    });
    return;
  }
  if (port.name !== 'qibian-panel' || port.sender?.tab || !port.sender?.url?.startsWith(chrome.runtime.getURL('sidepanel.html'))) return;
  panelPorts.set(port, null);
  port.onMessage.addListener(message => {
    if (message?.type === 'qibian:panel-ready' && Number.isInteger(message.windowId) && message.windowId >= 0) {
      panelPorts.set(port, message.windowId);
      setPanelVisible(message.windowId, true);
    }
  });
  port.onDisconnect.addListener(() => {
    const windowId = panelPorts.get(port);
    panelPorts.delete(port);
    if (!Number.isInteger(windowId)) return;
    clearTimeout(closeTimers.get(windowId));
    closeTimers.set(windowId, setTimeout(() => {
      closeTimers.delete(windowId);
      if (![...panelPorts.values()].includes(windowId)) setPanelVisible(windowId, false);
    }, 300));
  });
});

// Newer Edge versions expose native lifecycle events; ports remain the fallback.
chrome.sidePanel.onOpened?.addListener(info => setPanelVisible(info.windowId, true));
chrome.sidePanel.onClosed?.addListener(info => {
  for (const [port, windowId] of panelPorts) if (windowId === info.windowId) panelPorts.set(port, null);
  setPanelVisible(info.windowId, false);
});
chrome.windows.onRemoved.addListener(windowId => {
  openWindows.delete(windowId);
  clearTimeout(closeTimers.get(windowId));
  closeTimers.delete(windowId);
  for (const [port, id] of panelPorts) if (id === windowId) panelPorts.delete(port);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'qibian:surface-state' && sender.tab) {
    (async () => {
      const windowId = sender.tab.windowId;
      let nativeOpen = openWindows.has(windowId);
      if (chrome.runtime.getContexts) {
        const contexts = await chrome.runtime.getContexts({ contextTypes:['SIDE_PANEL'] });
        nativeOpen = contexts.some(context => context.windowId === windowId || context.windowId === -1 && nativeOpen);
      }
      sendResponse({ nativeOpen });
    })().catch(() => sendResponse({ nativeOpen:openWindows.has(sender.tab.windowId) }));
    return true;
  }
  if (message?.type === 'qibian:release-to-mini' && sender.url?.startsWith(chrome.runtime.getURL('sidepanel.html'))) {
    releaseNativePanel(sender, message.windowId).then(sendResponse, error => sendResponse({ ok:false, error:error.message }));
    return true;
  }
  if (message?.type === 'qibian:mini-page' && sender.url?.startsWith(chrome.runtime.getURL('sidepanel.html')) && Number.isInteger(sender.tab?.id)) {
    chrome.scripting.executeScript({ target: { tabId: sender.tab.id }, files: ['rail.js'] })
      .then(() => chrome.tabs.sendMessage(sender.tab.id, { type:'qibian:mini' }, { frameId:0 }))
      .then(sendResponse, error => sendResponse({ ok:false, error:error.message }));
    return true;
  }
  if (message?.type === 'qibian:rail-state' && sender.tab) {
    sendResponse({ visible: !openWindows.has(sender.tab.windowId), nativeOpen:openWindows.has(sender.tab.windowId) });
    return;
  }
  if (message?.type === 'qibian:open' && Number.isInteger(sender.tab?.id)) {
    let opening;
    try {
      // Keep this call in the click's message-handler stack: awaiting storage first
      // loses the user gesture required by Edge's sidePanel.open().
      opening = chrome.sidePanel.open({ tabId: sender.tab.id });
    } catch (error) {
      sendResponse({ ok: false, error: error.message });
      return;
    }
    const cardId = typeof message.cardId === 'string' && message.cardId.length <= 200 ? message.cardId : '';
    const focus = cardId
      ? chrome.storage.session.set({ focusCardId: cardId, focusWindowId: sender.tab.windowId })
      : chrome.storage.session.remove(['focusCardId', 'focusWindowId']);
    Promise.all([opening, focus]).then(() => {
      setPanelVisible(sender.tab.windowId, true);
      setTimeout(() => reconcilePanel(sender.tab.windowId), 1000);
      if (cardId) chrome.runtime.sendMessage({ type: 'qibian:focus', cardId, windowId: sender.tab.windowId }).catch(() => {});
      sendResponse({ ok: true });
    }).catch(error => {
      sendResponse({ ok: false, error: error.message });
    });
    return true;
  }
  if (message?.type === 'qibian:collapse' && sender.url?.startsWith(chrome.runtime.getURL('sidepanel.html')) && Number.isInteger(message.windowId) && message.windowId >= 0) {
    (async () => {
      try {
        if (typeof chrome.sidePanel.close !== 'function') throw new Error('fallback');
        await chrome.sidePanel.close({ windowId: message.windowId });
      } catch {
        await chrome.sidePanel.setOptions({ enabled: false });
        await chrome.sidePanel.setOptions({ enabled: true, path: 'sidepanel.html' });
      }
      setPanelVisible(message.windowId, false);
      sendResponse({ ok: true });
    })().catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});
configure();

chrome.action.onClicked.addListener(tab => {
  openNativeSidebar(chrome, tab).then(() => {
    setPanelVisible(tab.windowId, true);
    setTimeout(() => reconcilePanel(tab.windowId), 1000);
    chrome.action.setBadgeText({ text:'' }).catch(console.error);
    chrome.action.setTitle({ title:'在当前网页右侧打开栖边' }).catch(console.error);
  }).catch(error => {
    console.error('无法打开 Edge 边栏', error);
    chrome.action.setBadgeText({ text:'!' }).catch(console.error);
    chrome.action.setTitle({ title:'边栏未能打开，请再次点击栖边图标。' }).catch(console.error);
  });
});
