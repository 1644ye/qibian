const releaseAPI = 'https://api.github.com/repos/1644ye/qibian/releases/latest';
export function newerVersion(candidate, current) {
  if (!/^\d+\.\d+\.\d+$/.test(candidate) || !/^\d+\.\d+\.\d+$/.test(current)) return false;
  const a=candidate.split('.').map(Number), b=current.split('.').map(Number);
  for(let i=0;i<3;i++) { if(a[i]!==b[i]) return a[i]>b[i]; } return false;
}
export async function checkRelease(current, request = fetch) {
  let response;
  try { response = await request(releaseAPI, { cache:'no-store', signal:AbortSignal.timeout(12000) }); }
  catch { throw new Error('暂时无法检查更新，请检查网络后重试。'); }
  if (!response.ok) throw new Error('暂时无法检查更新，请稍后重试。');
  const release = await response.json(), version = String(release.tag_name || '').replace(/^v/,'');
  if (release.draft || release.prerelease || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('没有可用的正式版本。');
  return { version, available:newerVersion(version,current), checkedAt:Date.now(), url:`https://github.com/1644ye/qibian/releases/tag/v${version}` };
}
export function installUpdateChecks(api) {
  let checking;
  async function reloadInstalled() {
    try {
      const manifest=await (await fetch(api.runtime.getURL('manifest.json'),{cache:'no-store'})).json();
      if (!newerVersion(manifest.version,api.runtime.getManifest().version)) return;
      const contexts=await api.runtime.getContexts({contextTypes:['SIDE_PANEL','TAB']});
      const {musicState}=await api.storage.session.get('musicState');
      if (!contexts.length && (!musicState || musicState.paused)) api.runtime.reload();
    } catch { /* An in-progress disk update is retried at the next local check. */ }
  }
  async function check() {
    if (!checking) checking=(async()=>{
      try { const result=await checkRelease(api.runtime.getManifest().version); await api.storage.local.set({updateStatus:result}); return result; }
      catch(error) { const old=(await api.storage.local.get('updateStatus')).updateStatus || {}; const result={...old,error:error.message}; await api.storage.local.set({updateStatus:result}); return result; }
    })().finally(()=>checking=null);
    return checking;
  }
  api.alarms.create('qibian-updates',{periodInMinutes:360});
  api.alarms.create('qibian-installed-update',{periodInMinutes:5});
  api.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='qibian-updates') void check(); if(alarm.name==='qibian-installed-update') void reloadInstalled();});
  api.runtime.onStartup.addListener(()=>{void reloadInstalled(); void check();});
  api.runtime.onInstalled.addListener(()=>void check());
  api.runtime.onMessage.addListener((message,sender,reply)=>{
    if(sender.id!==api.runtime.id || !sender.url?.startsWith(api.runtime.getURL(''))) return;
    if(message?.type==='update:check') { check().then(reply); return true; }
    if(message?.type==='update:reload') { reply({ok:true}); setTimeout(()=>api.runtime.reload(),100); }
  });
}
export function mountUpdateSettings(settings, beforeReload = async()=>{}) {
  const section=document.createElement('details'); section.className='update-settings';
  section.innerHTML='<summary>版本与自动更新</summary><p class="muted" data-update-status role="status"></p><p class="muted">每 6 小时自动检查正式版本。Windows 完整包的 sync/start.cmd 启动时会自动下载安装新版，同时更新同目录 extension 和同步服务。保持原加载目录；侧栏、音乐管理页和网页面板均关闭且音乐暂停后，5 分钟内自动重新加载，也可在此立即重新加载或重启浏览器。</p><div class="button-row"><button type="button" class="secondary" data-update-check>检查更新</button><button type="button" class="secondary" data-update-download hidden>下载新版</button><button type="button" class="secondary" data-update-reload>重新加载扩展</button></div><p class="muted">仅扩展包不能自行写入安装目录；请使用完整包的本机服务，或下载后覆盖原目录。更新不会卸载扩展或清空配置、文件和歌单。自动更新只在服务启动时安装，不会在使用中关闭原生侧栏。</p>';
  settings.querySelector('.dialog-heading').after(section);
  const output=section.querySelector('[data-update-status]'), check=section.querySelector('[data-update-check]'), download=section.querySelector('[data-update-download]');
  let status;
  const refresh=async()=>{
    status=(await chrome.storage.local.get('updateStatus')).updateStatus;
    output.textContent=`当前 ${chrome.runtime.getManifest().version} · ${status?.error || (status?.available ? '发现新版 '+status.version : status?.checkedAt ? '已是最新正式版' : '尚未检查')}`;
    download.hidden=!status?.available;
  };
  check.addEventListener('click',async()=>{ check.disabled=true; output.textContent='正在检查…'; try { await chrome.runtime.sendMessage({type:'update:check'}); await refresh(); } catch(error) {output.textContent=error.message;} finally {check.disabled=false;} });
  download.addEventListener('click',()=>chrome.tabs.create({url:status.url}));
  section.querySelector('[data-update-reload]').addEventListener('click',async()=>{try {await beforeReload(); await chrome.runtime.sendMessage({type:'update:reload'});} catch(error){output.textContent=error.message;}});
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local' && changes.updateStatus) void refresh();});
  void refresh();
}
