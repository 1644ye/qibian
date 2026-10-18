export function mountSyncSettings(settings) {
  const section = document.createElement('details'); section.className = 'sync-settings';
  section.innerHTML = `<summary>跨浏览器同步 · 本机</summary><p class="muted">先启动「栖边本机同步服务」，在 Edge、Chrome 等浏览器填写相同密钥。配对后自动同步卡片、设置、歌单、已导入文件和音乐控制。仅连接这台电脑。</p><label>配对密钥<input type="password" name="sync-token" autocomplete="off" placeholder="填写本机服务显示的密钥"></label><label>本机端口<input type="number" name="sync-port" value="17381" min="1024" max="65535"></label><div class="button-row"><button type="button" data-sync="connect">连接并自动同步</button><button type="button" data-sync="disconnect">关闭同步</button></div><p class="muted" data-sync-status role="status"></p><p class="muted">首次连接会合并两个浏览器的卡片，使用先连接浏览器的全局设置；同名冲突卡片保留两份。播放按钮控制当前播放浏览器；「在此浏览器播放」切换播放位置。网站自身的音视频、浏览器下载文件和未导入的文件不在同步范围内。</p>`;
  settings.querySelector('.dialog-heading').after(section);
  section.querySelector('[data-sync="connect"]').className = 'primary';
  section.querySelector('[data-sync="disconnect"]').className = 'secondary';
  const token = section.querySelector('[name="sync-token"]'), port = section.querySelector('[name="sync-port"]'), output = section.querySelector('[data-sync-status]');
  async function refresh(initial) {
    const stored = await chrome.storage.local.get(['syncConfig', 'syncStatus', 'syncPeers', 'syncOutbox']);
    if (initial) { token.value = stored.syncConfig?.token || ''; port.value = stored.syncConfig?.port || 17381; }
    output.textContent = stored.syncStatus?.connected ? `已连接：${(stored.syncPeers || []).map(p => p.name).join('、')} · 待同步 ${stored.syncOutbox?.length || 0} 项` : stored.syncStatus?.error || '尚未启用';
  }
  section.addEventListener('click', async event => {
    const action = event.target.dataset.sync; if (!action) return;
    const enabled = action === 'connect'; const value = Number(port.value);
    if (enabled && (!token.value.trim() || !Number.isInteger(value) || value < 1024 || value > 65535)) { output.textContent = '请填写配对密钥和有效端口。'; return; }
    try {
      const name = /Edg\//.test(navigator.userAgent) ? 'Microsoft Edge' : /OPR\//.test(navigator.userAgent) ? 'Opera' : /Chrome\//.test(navigator.userAgent) ? 'Google Chrome / Chromium' : '浏览器';
      const response = await chrome.runtime.sendMessage({ type:'sync:configure', config:{ enabled, token:token.value.trim(), port:value, name } });
      if (!response?.ok) throw new Error(response?.error || '无法连接扩展后台'); await refresh();
    } catch (e) { output.textContent = e.message; }
  });
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && (changes.syncStatus || changes.syncPeers || changes.syncOutbox)) void refresh(); });
  void refresh(true);
}
