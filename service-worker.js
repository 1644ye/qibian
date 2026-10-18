import './background.js';
import { writePatch } from './workspace-store.js';
import { safeURL, defaults, validateState } from './core.js';
import { createSyncClient } from './sync-client.js';
let creating;
let indicator = '';
async function displayMusic(state) {
  await chrome.storage.session.set({ musicState:state });
  const next = { cardId:state.cardId, paused:state.paused };
  if (JSON.stringify(next) !== indicator) { await chrome.storage.local.set({ musicIndicator:next }); indicator = JSON.stringify(next); }
  return { ok:true };
}
const sync = createSyncClient({ display:displayMusic, execute:async message => {
  if (['silence', 'lease'].includes(message.action) && !await chrome.offscreen.hasDocument()) return { paused:true, stopped:true };
  await ensurePlayer(); return chrome.runtime.sendMessage({ ...message, type:'music:engine' });
} });
async function ensurePlayer() {
  if (await chrome.offscreen.hasDocument()) return;
  if (!creating) creating = chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['AUDIO_PLAYBACK'], justification: '让音乐管理页与侧栏共享播放，并在侧栏收起后继续播放。' }).finally(() => creating = null);
  await creating;
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === 'qibian:activate-card' && sender.id === chrome.runtime.id && (sender.url?.startsWith(chrome.runtime.getURL('')) || sender.tab && /^https?:/.test(sender.url || ''))) {
    (async () => {
      const workspace = validateState((await chrome.storage.local.get('workspace')).workspace || defaults());
      const card = workspace.cards.find(c => c.id === message.cardId);
      if (!card) throw new Error('卡片不存在，请刷新图标栏。');
      if (card.type === 'website') { await chrome.tabs.create({ url:safeURL(card.url) }); return { ok:true }; }
      if (card.type === 'media') {
        if (!card.tracks?.length && !card.fileId) throw new Error('歌单为空，请展开栖边添加音乐。');
        return sync.command({ cardId:card.id, action:'toggle-stop' });
      }
      return { ok:true, view:true };
    })().then(respond, error => respond({ ok:false, error:error.message }));
    return true;
  }
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return;
  let task;
  if (message.type === 'sync:configure') task = sync.configure(message.config);
  if (message.type === 'music:command') task = sync.command(message);
  if (message.type === 'music:workspace') task = chrome.storage.local.get('workspace').then(value => ({ workspace:validateState(value.workspace || defaults()) }));
  if (message.type === 'music:publish') task = sync.publish(message.state).then(() => ({ ok:true }));
  if (message.type === 'music:cursor') task = writePatch({ settings: {}, cards: [{ id: message.cardId, fields: { currentTrackId: message.trackId } }], removed: [] }).then(() => ({ ok: true }));
  if (!task) return;
  task.then(respond, error => respond({ ok: false, error: error.message })); return true;
});
chrome.runtime.onStartup.addListener(() => chrome.storage.local.set({ musicIndicator:{ paused:true } }));
chrome.runtime.onInstalled.addListener(() => chrome.storage.local.set({ musicIndicator:{ paused:true } }));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.workspace) chrome.runtime.sendMessage({ type: 'music:reconcile' }).catch(() => {});
});
