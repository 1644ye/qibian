// Keep all browser calls in the click handler's synchronous stack. In particular,
// awaiting messages or permissions before open() loses the native user gesture.
export function openNativeSidebar(api, tab) {
  if (!Number.isInteger(tab?.windowId) || tab.windowId < 0) return Promise.reject(new Error('无法确定当前浏览器窗口。'));
  const pending = [];
  try {
    pending.push(api.sidePanel.setOptions({ path:'sidepanel.html', enabled:true }));
    if (Number.isInteger(tab.id) && tab.id >= 0) pending.push(api.sidePanel.setOptions({ tabId:tab.id, path:'sidepanel.html', enabled:true }));
    pending.push(api.sidePanel.open({ windowId:tab.windowId }));
  } catch(error) { pending.push(Promise.reject(error)); }
  return Promise.all(pending);
}
