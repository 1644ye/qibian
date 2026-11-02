import { safeShortcutURL } from './core.js';

export async function openShortcut(api, value) {
  const url = safeShortcutURL(value);
  // Reuse an existing extension tab, keeping OneTab's current selection and scroll position.
  if (await api.permissions.contains({ permissions:['tabs'] })) {
    const existing = (await api.tabs.query({})).find(tab => tab.url === url);
    if (existing) { await api.tabs.update(existing.id, { active:true }); await api.windows.update(existing.windowId, { focused:true }); return; }
  }
  await api.tabs.create({ url });
}

export function mountShortcutEditor(fields) {
  const url = fields.querySelector('[name="url"]'), title = fields.querySelector('[name="title"]');
  const row = document.createElement('div'); row.className = 'button-row';
  const status = document.createElement('p'); status.className = 'muted'; status.setAttribute('role','status');
  for (const [label, oneTab] of [['读取当前页面快捷方式', false], ['读取已打开的 OneTab', true]]) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary'; button.textContent = label;
    button.addEventListener('click', async () => {
      try {
        if (!await chrome.permissions.request({ permissions:['tabs'] })) throw new Error('未授权读取标签页，可直接复制页面地址填写。');
        button.disabled = true;
        const tabs = (await chrome.tabs.query({ currentWindow:true })).filter(tab => tab.url && !tab.url.startsWith(chrome.runtime.getURL('')));
        const candidate = oneTab ? tabs.find(tab => /^(chrome-extension|extension):/.test(tab.url) && /onetab/i.test(tab.title || '')) : tabs.find(tab => tab.active) || tabs.sort((a,b)=>(b.lastAccessed||0)-(a.lastAccessed||0))[0];
        if (!candidate) throw new Error(oneTab ? '请先点击 OneTab 工具栏按钮打开它的页面，再回来读取；也可直接粘贴其地址。' : '没有可读取的页面，请手动填写快捷地址。');
        url.value = safeShortcutURL(candidate.url);
        if (!title.value) title.value = String(candidate.title || (oneTab ? 'OneTab' : '快捷方式')).slice(0,120);
        status.textContent = '已读取页面地址，保存后点击即可打开。';
      } catch (error) { status.textContent = error.message; }
      finally { button.disabled = false; }
    });
    row.append(button);
  }
  url.closest('label').after(row, status);
}
