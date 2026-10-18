import { difference, writePatch } from './workspace-store.js';
import { requestMiniTransition } from './panel-transport.js';
import { openNativeSidebar } from './panel-launcher.js';
import { mountTutorial } from './tutorial.js';
import { mountSyncSettings } from './sync-settings.js';
import { mountWebsiteEditor } from './website-editor.js';
import { defaults, kinds, safeURL, safeIcon, moveCard, validateState, weatherLabel, paletteDefaults, palettePresets, resolvedPalette } from './core.js';
import { parseOneTab, parseBookmarksHTML, flattenBookmarks, prepareWebsiteImport } from './importers.js';

const $ = (s, root = document) => root.querySelector(s);
mountTutorial($('#settings'));
if (globalThis.chrome?.runtime?.id) mountSyncSettings($('#settings'));
const manager = location.pathname.endsWith('/music.html');
const embedded = new URLSearchParams(location.search).has('embedded') && window.parent !== window;
const quickCardId = new URLSearchParams(location.search).has('quick') ? new URLSearchParams(location.search).get('card') : '';
let baseline, pendingSaves = 0, musicState = {}, selectedPlaylist = new URLSearchParams(location.search).get('card') || '';
const ext = Boolean(globalThis.chrome?.runtime?.id);
const icons = { website: '↗', file: '▤', weather: '☀', feed: '≋', media: '♫', note: '✎', clock: '◷' };
let state, editing = null, selectedType = 'website', selectedCity = null, arranging = false, dragId = null, mediaTarget = null;
let websiteEditor;
let toastTimer, saveQueue = Promise.resolve(), panelPort, panelWindowId, pendingEntries = [];
const blobs = new Map(), remoteTabs = new Map(), dataCache = new Map();
const dbReady = new Promise((resolve, reject) => {
  const request = indexedDB.open('qibian-files', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('files');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
async function fileStore(method, key, value) {
  const db = await dbReady;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', method === 'get' ? 'readonly' : 'readwrite');
    const store = tx.objectStore('files');
    const req = method === 'put' ? store.put(value, key) : store[method](key);
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('文件保存失败。'));
  });
}
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(text, className, action, label) {
  const b = el('button', className, text); b.type = 'button';
  if (label) { b.title = label; b.setAttribute('aria-label', label); }
  b.addEventListener('click', () => Promise.resolve().then(action).catch(report)); return b;
}
function toast(message) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false; toastTimer = setTimeout(() => $('#toast').hidden = true, 4200); }
function report(error) { console.error(error); toast(error.message || '操作失败，请重试。'); }
function reportMiniError(error) {
  if (!error.miniDiagnostic) { report(error); return; }
  console.error(error);
  let dialog = $('#mini-error');
  if (!dialog) { dialog = el('dialog'); dialog.id = 'mini-error'; document.body.append(dialog); }
  dialog.setAttribute('aria-labelledby', 'mini-error-title');
  const title = el('h2', '', '图标栏未能显示'); title.id = 'mini-error-title';
  const heading = el('div', 'dialog-heading'); heading.append(title, button('×', 'icon-button', () => dialog.close(), '关闭'));
  const actions = el('div', 'button-row');
  actions.append(button('打开扩展权限设置', 'primary', () => chrome.tabs.create({ url:'edge://extensions/?id=' + chrome.runtime.id })),
    button('复制诊断信息', 'secondary', async () => { await navigator.clipboard.writeText(JSON.stringify(error.miniDiagnostic, null, 2)); toast('诊断信息已复制'); }),
    button('重试', 'secondary', () => { dialog.close(); $('#mini-button').click(); }));
  dialog.replaceChildren(heading, el('p', '', error.message), actions);
  if (!dialog.open) dialog.showModal();
}
function save() {
  const snapshot = structuredClone(state);
  const patch = difference(baseline || snapshot, snapshot); baseline = snapshot; pendingSaves++;
  const work = saveQueue.catch(() => {}).then(async () => {
    if (ext) await writePatch(patch);
    else localStorage.setItem('qibian', JSON.stringify(snapshot));
    $('#save-status').textContent = '已保存 · 仅存于此设备';
  });
  saveQueue = work;
  work.finally(() => { pendingSaves--; if (ext && !pendingSaves) void refreshWorkspace(); }).catch(() => {});
  work.catch(error => { $('#save-status').textContent = '保存失败，请导出备份'; report(error); });
  return work;
}
function applySettings() {
  const s = state.settings;
  document.body.dataset.theme = s.theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : s.theme;
  document.body.dataset.density = s.density; document.body.dataset.columns = s.columns;
  const palette = resolvedPalette(s, document.body.dataset.theme);
  const variables = { background: 'bg', surface: 'surface', text: 'text', muted: 'muted', line: 'line', accent: 'accent', onAccent: 'on-accent' };
  for (const [key, variable] of Object.entries(variables)) document.documentElement.style.setProperty('--' + variable, palette[key]);
  document.documentElement.style.setProperty('--radius', s.radius + 'px');
  $('#radius-value').textContent = s.radius + ' px';
}
function openURL(url) { const valid = safeURL(url); if (ext) return chrome.tabs.create({ url: valid }); window.open(valid, '_blank', 'noopener,noreferrer'); }
async function permission(origins, permissions = []) {
  if (!ext) return true;
  if (!await chrome.permissions.request({ origins, permissions })) throw new Error('未获得访问权限。你可以再次点击重试。');
  return true;
}
async function fetchText(url) {
  if (ext && !await chrome.permissions.contains({ origins: [new URL(url).origin + '/*'] })) throw new Error('请点击「授权并刷新」以访问此来源。');
  const response = await fetch(url, { signal: AbortSignal.timeout(15000), credentials: 'omit', redirect: 'error' });
  if (!response.ok) throw new Error(`来源暂不可用（${response.status}），请稍后刷新。`);
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new Error('响应超过 2 MB，请使用较小的信息源。'); } chunks.push(value); }
  return new Blob(chunks).text();
}
async function blobURL(id) {
  if (blobs.has(id)) return blobs.get(id);
  const file = await fileStore('get', id);
  if (!file) throw new Error('此设备没有该文件，请编辑卡片并重新选择文件。');
  const url = URL.createObjectURL(file); blobs.set(id, url); return url;
}
function download(url, name) { const a = el('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); }
function render() {
  applySettings();
  renderCompactNavigation();
  const container = $('#cards'); container.replaceChildren();
  document.body.classList.toggle('arranging', arranging);
  $('#arrange').setAttribute('aria-pressed', String(arranging)); $('#arrange').textContent = arranging ? '✓ 完成' : '⇅ 整理';
  $('#count').textContent = String(state.cards.length).padStart(2, '0'); $('#empty').hidden = state.cards.length > 0;
  if (manager) renderPlaylistNavigation();
  for (const card of state.cards.filter(c => (!quickCardId || c.id === quickCardId) && (!manager || c.type === 'media' && c.id === selectedPlaylist))) {
    const node = el('article', 'card'); node.dataset.id = card.id;
    node.style.setProperty('--height', card.height + 'px');
    const head = el('div', 'card-head'); head.append(el('span', 'card-label', `${icons[card.type]} ${kinds[card.type]}`), el('h2', 'card-title', card.type === 'media' ? '音乐' : card.title));
    const tools = el('div', 'card-tools');
    tools.append(button('⧉', '', () => duplicateCard(card), '复制 ' + card.title), button('···', '', () => openEditor(card), '编辑 ' + card.title)); head.append(tools); node.append(head);
    const body = el('div', 'card-body'); node.append(body);
    if (card.type === 'note') {
      const note = el('textarea', 'note'); note.value = card.text || ''; note.setAttribute('aria-label', card.title); note.placeholder = '写下此刻的想法…';
      note.style.minHeight = Math.max(90, card.height - 80) + 'px';
      note.addEventListener('input', () => { card.text = note.value.slice(0, 30000); void save(); }); body.append(note);
    } else if (card.type === 'clock') {
      body.append(el('span', 'clock-caption', '慢慢来，也很好'), el('div', 'clock-time'), el('div', 'clock-date'));
    } else if (card.type === 'website') renderWebsite(body, card);
    else if (card.type === 'file') renderFile(body, card);
    else if (card.type === 'media') renderMedia(body, card);
    else renderRemote(body, card);
    const arrange = el('div', 'arrange-tools'); const handle = el('span', 'drag-handle', '⠿ 拖动排序'); handle.draggable = true; handle.title = '拖动此处排序，也可使用右侧上移下移按钮';
    handle.addEventListener('dragstart', e => { dragId = card.id; e.dataTransfer.setData('text/plain', card.id); e.dataTransfer.effectAllowed = 'move'; node.classList.add('dragging'); });
    handle.addEventListener('dragend', () => { dragId = null; document.querySelectorAll('.dragging,.drop-target').forEach(n => n.classList.remove('dragging', 'drop-target')); });
    node.addEventListener('dragover', e => { if (arranging && dragId && dragId !== card.id) { e.preventDefault(); node.classList.add('drop-target'); } });
    node.addEventListener('dragleave', () => node.classList.remove('drop-target'));
    node.addEventListener('drop', e => { e.preventDefault(); if (!arranging || !dragId) return; reorder(dragId, state.cards.findIndex(c => c.id === card.id)); dragId = null; });
    arrange.append(handle, button('↑', 'text-button', () => reorder(card.id, state.cards.indexOf(card) - 1), '上移'), button('↓', 'text-button', () => reorder(card.id, state.cards.indexOf(card) + 1), '下移'), button('删除', 'text-button', () => deleteCard(card)));
    node.append(arrange); container.append(node);
  }
  updateClock();
}
function renderCompactNavigation() {
  if (manager) return;
  let nav = $('#compact-navigation');
  if (!nav) { nav = el('nav', 'compact-navigation'); nav.id = 'compact-navigation'; nav.setAttribute('aria-label', '栖边小图标模式'); document.body.append(nav); }
  nav.replaceChildren(button('⇤', 'compact-expand', () => setDisplayMode('expanded'), '展开完整模式'));
  const list = el('div', 'compact-cards');
  for (const card of state.cards) {
    const name = card.type === 'media' ? card.playlistName || card.title : card.title;
    const shortcut = button('', 'compact-card', () => activateCompactCard(card), '打开 ' + name);
    shortcut.dataset.cardId = card.id; shortcut.dataset.type = card.type; shortcut.dataset.name = name;
    if (card.type === 'website') shortcut.append(websiteIcon(card)); else shortcut.textContent = icons[card.type];
    shortcut.classList.toggle('playing', card.id === musicState.cardId && !musicState.paused);
    list.append(shortcut);
  }
  nav.append(list, button('＋', '', () => { setDisplayMode('expanded'); openEditor(); }, '添加内容'), button('⚙', '', () => { setDisplayMode('expanded'); $('#settings-button').click(); }, '外观与设置'));
  updateCompactIcons();
}
function updateCompactIcons() {
  document.querySelectorAll('.compact-card').forEach(node => {
    const playing = node.dataset.cardId === musicState.cardId && !musicState.paused;
    node.classList.toggle('playing', playing);
    const label = node.dataset.type === 'media' ? `${playing ? '停止' : '播放'} ${node.dataset.name}` : `打开 ${node.dataset.name}`;
    node.title = label; node.setAttribute('aria-label', label);
    if (node.dataset.type === 'media') { node.textContent = playing ? '■' : '▶'; node.setAttribute('aria-pressed', String(playing)); }
  });
}
async function activateCompactCard(card) {
  if (card.type === 'website') { await openURL(card.url); return; }
  if (card.type === 'media') { await musicCommand(card.id, 'toggle-stop'); return; }
  if (card.type === 'file') { await previewFile(card); return; }
  let dialog = $('#quick-view');
  if (!dialog) { dialog = el('dialog'); dialog.id = 'quick-view'; document.body.append(dialog); dialog.addEventListener('close', render); }
  dialog.replaceChildren(button('×', 'icon-button', () => dialog.close(), '关闭组件'));
  const node = [...document.querySelectorAll('#cards .card')].find(n => n.dataset.id === card.id);
  if (node) dialog.append(node); dialog.showModal();
}
function setDisplayMode(mode) {
  if (manager) return;
  const compact = mode === 'mini';
  document.body.classList.toggle('compact-mode', compact);
  document.body.dataset.displayMode = compact ? 'mini' : 'expanded';
  $('#mini-button').setAttribute('aria-expanded', String(!compact));
  if (compact) {
    renderCompactNavigation();
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    $('#compact-navigation .compact-expand')?.focus();
  } else $('#mini-button').focus();
  if (embedded) window.parent.postMessage({ type:'qibian:display-mode', mode:compact ? 'mini' : 'expanded' }, '*');
}
function reorder(id, index) { state.cards = moveCard(state.cards, state.cards.findIndex(c => c.id === id), index); void save(); render(); }
async function duplicateCard(card) {
  if (state.cards.length >= 200) throw new Error('最多支持 200 张卡片。');
  const copy = { ...structuredClone(card), id: crypto.randomUUID(), title: (card.title.slice(0, 115) + ' 副本') };
  // Stored files are immutable; copies may share the blob until a card replaces it.
  const previous = state.cards; state.cards = [...previous]; state.cards.splice(previous.indexOf(card) + 1, 0, copy);
  try { await save(); } catch (error) { state.cards = previous; throw error; }
  render(); toast('已复制卡片');
}
async function deleteCard(card) {
  const fileIds = cardFileIds(card);
  if (!confirm(`删除「${card.title}」？${fileIds.length ? '未被其他卡片引用的本地媒体也会删除。' : ''}`)) return;
  const before = state.cards; state.cards = state.cards.filter(c => c.id !== card.id);
  try { await save(); } catch { state.cards = before; return; }
  remoteTabs.delete(card.id); dataCache.delete(card.id);
  for (const id of fileIds) await removeUnusedFile(id);
  render(); toast('已删除卡片');
}
function renderWebsite(body, card) {
  const main = el('div', 'site-main');
  const info = el('div'); info.append(el('strong', '', card.title), el('small', '', card.url));
  main.append(websiteIcon(card), info); body.append(main);
  const row = el('div', 'button-row');
  row.append(button('在栖边中打开', 'secondary open-in-qibian', () => {
    if ($('iframe', body)) { $('iframe', body).focus(); return; }
    const wrap = el('div', 'embedded-site');
    const frame = el('iframe', 'website-frame'); frame.src = card.url; frame.title = card.title; frame.referrerPolicy = 'no-referrer'; frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin allow-popups');
    wrap.append(el('p', 'muted', '如网站禁止内嵌或登录失败，请使用「在网页中打开」。'), button('关闭内嵌页面', 'text-button', () => wrap.remove()), frame); body.append(wrap);
  }), button('在网页中打开', 'secondary', () => openURL(card.url))); body.append(row);
}
function websiteIcon(card) {
  const node = el('span', 'site-icon');
  if (card.icon?.startsWith('data:image/')) { const img = el('img'); img.src = card.icon; img.alt = ''; node.append(img); }
  else node.textContent = card.icon || card.title.slice(0, 1).toUpperCase();
  return node;
}
function renderFile(body, card) {
  const row = el('div', 'media-hero'); row.append(el('span', 'file-icon', '▤'), el('span', 'file-name', card.filename || '尚未选择文件')); body.append(row);
  const buttons = el('div', 'button-row'); buttons.append(button('预览', 'secondary', () => previewFile(card)), button('下载副本 ↓', 'secondary', async () => download(await blobURL(card.fileId), card.filename))); body.append(buttons, el('p', 'muted', '保存在此设备的文件副本，不会随原文件更新。'));
}
async function previewFile(card) {
  const file = await fileStore('get', card.fileId); if (!file) throw new Error('文件副本不存在，请编辑卡片重新选择。');
  $('#preview-title').textContent = card.filename; const body = $('#preview-body'); body.replaceChildren();
  if (/^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(file.type)) { const img = el('img'); img.src = await blobURL(card.fileId); img.alt = card.filename; body.append(img); }
  else if (/^(audio|video)\//.test(file.type)) { const media = el(file.type.startsWith('video') ? 'video' : 'audio'); media.controls = true; media.src = await blobURL(card.fileId); body.append(media); }
  else if (file.type.startsWith('text/') || /\.(txt|md|json|csv|log)$/i.test(card.filename)) { body.append(el('pre', '', await file.slice(0, 300000).text())); if (file.size > 300000) body.append(el('p', 'muted', '仅预览前 300 KB。')); }
  else body.append(el('p', 'muted', '此格式请下载后使用本机应用打开。'));
  body.append(button('下载文件', 'secondary', async () => download(await blobURL(card.fileId), card.filename))); $('#preview').showModal();
}
async function musicCommand(cardId, action, extra = {}) {
  if (!ext) throw new Error('请在 Edge 扩展中使用后台音乐播放器。');
  const result = await chrome.runtime.sendMessage({ type: 'music:command', cardId, action, ...extra });
  if (result?.ok === false) throw new Error(result.error); musicState = result || {}; updatePlayback();
}
function updatePlayback() {
  updateCompactIcons();
  document.querySelectorAll('.music-status').forEach(node => {
    const active = node.dataset.cardId === musicState.cardId;
    node.textContent = active && musicState.error ? musicState.error : active && !musicState.paused ? '正在播放' : active && musicState.stopped ? '已停止' : '已暂停';
    if (active && musicState.ownerName) node.textContent += ` · ${musicState.ownerName}`;
  });
  document.querySelectorAll('.local-play').forEach(node => {
    const playing = node.dataset.cardId === musicState.cardId && !musicState.paused;
    node.textContent = playing ? 'Ⅱ' : '▶'; node.title = playing ? '暂停' : '播放';
    node.setAttribute('aria-label', playing ? '暂停' : '播放'); node.setAttribute('aria-pressed', String(playing));
    node.closest('.card')?.classList.toggle('is-playing', playing);
  });
  document.querySelectorAll('.music-seek').forEach(node => { const active = node.dataset.cardId === musicState.cardId; node.max = active ? musicState.duration || 0 : 0; node.value = active ? musicState.currentTime || 0 : 0; node.disabled = !active || !musicState.duration; });
  document.querySelectorAll('.music-time').forEach(node => { const active = node.dataset.cardId === musicState.cardId; const format = n => `${Math.floor((n || 0) / 60)}:${String(Math.floor((n || 0) % 60)).padStart(2, '0')}`; node.textContent = active ? `${format(musicState.currentTime)} / ${format(musicState.duration)}` : '0:00 / 0:00'; });
  document.querySelectorAll('.music-volume').forEach(node => { node.value = musicState.volume ?? 1; });
  document.querySelectorAll('.playlist li').forEach(node => node.classList.toggle('active', node.dataset.trackId === musicState.trackId && node.dataset.cardId === musicState.cardId));
}
function openMusic(cardId) {
  const url = chrome.runtime.getURL('music.html') + '?card=' + encodeURIComponent(cardId || '');
  return chrome.tabs.create({ url });
}
function renderPlaylistNavigation() {
  const lists = state.cards.filter(c => c.type === 'media');
  if (!lists.some(c => c.id === selectedPlaylist)) selectedPlaylist = lists[0]?.id || '';
  const nav = $('#playlist-navigation'); nav.replaceChildren(el('h2', '', '我的歌单'));
  for (const card of lists) nav.append(button(card.playlistName || card.title, card.id === selectedPlaylist ? 'playlist-choice active' : 'playlist-choice', () => { selectedPlaylist = card.id; render(); }));
  $('#empty').hidden = !!lists.length;
}
function renderMedia(body, card) {
  const tracks = card.tracks || [];
  const hero = el('div', 'media-hero'); const details = el('div');
  details.append(el('h3', 'media-name', card.playlistName || card.title));
  const statusNode = el('p', 'music-status muted', '已暂停'); statusNode.dataset.cardId = card.id; details.append(statusNode);
  hero.append(el('div', 'record'), details); body.append(hero);
  const controls = el('div', 'media-controls local-controls');
  const play = button('▶', 'play local-play', () => musicCommand(card.id, 'toggle'), '播放'); play.dataset.cardId = card.id;
  controls.append(button('‹', '', () => musicCommand(card.id, 'previous'), '上一首'), play, button('›', '', () => musicCommand(card.id, 'next'), '下一首')); body.append(controls);
  if (ext) {
    const takeover = button('在此浏览器播放', 'secondary sync-takeover', () => musicCommand(card.id, 'takeover'));
    takeover.hidden = true; body.append(takeover);
    chrome.storage.local.get('syncConfig').then(({ syncConfig }) => { takeover.hidden = !syncConfig?.enabled; });
  }
  const seek = el('input', 'music-seek'); seek.type = 'range'; seek.min = 0; seek.step = .1; seek.dataset.cardId = card.id; seek.setAttribute('aria-label', '播放进度');
  seek.addEventListener('change', () => musicCommand(card.id, 'seek', { value: Number(seek.value) }).catch(report));
  const time = el('div', 'music-time muted'); time.dataset.cardId = card.id; body.append(seek, time);
  const volumeLabel = el('label', 'volume-label', '音量'); const volume = el('input', 'music-volume'); volume.type = 'range'; volume.min = 0; volume.max = 1; volume.step = .05; volume.value = musicState.volume ?? 1; volume.setAttribute('aria-label', '音量'); volume.addEventListener('change', () => musicCommand(card.id, 'volume', { value: Number(volume.value) }).catch(report)); volumeLabel.append(volume); body.append(volumeLabel);
  const mode = selectField('播放顺序', 'playMode', [['order', '顺序播放'], ['repeat-all', '列表循环'], ['repeat-one', '单曲循环'], ['shuffle', '随机播放']], card.playMode || 'order');
  const selector = $('select', mode); selector.setAttribute('aria-label', '播放顺序'); selector.addEventListener('change', () => { card.playMode = selector.value; void save(); }); body.append(mode);
  if (manager) {
    const list = el('ol', 'playlist'); list.setAttribute('aria-label', '歌单曲目');
    tracks.forEach((track, index) => {
      const item = el('li'); item.dataset.trackId = track.fileId; item.dataset.cardId = card.id;
      const choose = button('', 'track-name', () => musicCommand(card.id, 'play', { trackId: track.fileId }), `播放 ${track.filename}`);
      choose.append(el('span', 'track-number', String(index + 1).padStart(2, '0')), el('span', '', track.filename));
      const tools = el('span', 'track-tools'); tools.append(button('↑', '', () => moveTrack(card.id, index, index - 1), `上移 ${track.filename}`), button('↓', '', () => moveTrack(card.id, index, index + 1), `下移 ${track.filename}`), button('×', '', () => removeTrack(card.id, track.fileId), `移除 ${track.filename}`));
      item.append(choose, tools); list.append(item);
    }); body.append(list);
  }
  const row = el('div', 'button-row');
  row.append(button(tracks.length ? '添加音乐' : '选择音乐', 'secondary', () => { mediaTarget = card.id; $('#media-file').click(); }));
  if (!manager) row.append(button('管理歌单 ↗', 'secondary', () => openMusic(card.id)));
  body.append(row);
  if (!tracks.length) body.append(el('p', 'muted', '支持多选，不设曲目数量上限。'));
  queueMicrotask(updatePlayback);
  const remote = el('details', 'remote-section'); remote.append(el('summary', '', '网页媒体控制'));
  remote.append(button(manager ? '选择媒体网页' : '连接当前网页', 'secondary', () => connectMedia(card, body)));
  const status = el('p', 'status-line', remoteTabs.has(card.id) ? '已连接网页，可控制主页面的音视频。' : '连接正在播放的网页后，可在这里控制。'); remote.append(status);
  const remoteControls = el('div', 'media-controls remote-controls');
  for (const [text, action, label] of [['−10', 'back', '后退 10 秒'], ['▶', 'toggle', '播放或暂停网页媒体'], ['+10', 'forward', '前进 10 秒'], ['♪', 'mute', '切换静音']]) remoteControls.append(button(text, action === 'toggle' ? 'play' : '', async () => {
    const tabId = remoteTabs.get(card.id); if (!tabId) throw new Error('请先连接当前网页。');
    const results = await chrome.scripting.executeScript({ target: { tabId }, func: controlPageMedia, args: [action] });
    status.textContent = results[0]?.result || '未找到可控制的媒体。';
  }, label)); remote.append(remoteControls); body.append(remote);
}
async function moveTrack(cardId, from, to) {
  const card = state.cards.find(item => item.id === cardId); if (!card || to < 0 || to >= card.tracks.length) return;
  card.tracks = moveCard(card.tracks, from, to); await save(); render();
}
async function removeTrack(cardId, fileId) {
  const card = state.cards.find(item => item.id === cardId); const track = card?.tracks.find(item => item.fileId === fileId); if (!card || !track) return;
  if (!confirm(`从歌单移除「${track.filename}」？`)) return;
  const before = structuredClone(card); const wasCurrent = card.currentTrackId === fileId;
  card.tracks = card.tracks.filter(item => item.fileId !== fileId);
  if (wasCurrent) card.currentTrackId = card.tracks[0]?.fileId || '';
  try { await save(); } catch (error) { Object.assign(card, before); throw error; }
  await removeUnusedFile(fileId); render();
}
function controlPageMedia(action) {
  const elements = [...document.querySelectorAll('audio,video')];
  const media = elements.find(m => !m.paused) || elements[0];
  if (!media) return '未找到主页面音视频。跨域播放器或受保护内容可能不支持。';
  if (action === 'toggle') { if (media.paused) return media.play().then(() => '正在播放').catch(() => '网页拒绝播放，请先在网页中播放一次。'); media.pause(); }
  if (action === 'back' || action === 'forward') { if (Number.isFinite(media.duration)) media.currentTime = Math.max(0, Math.min(media.duration, media.currentTime + (action === 'back' ? -10 : 10))); else return '直播媒体不支持快进或后退。'; }
  if (action === 'mute') media.muted = !media.muted;
  return `${media.paused ? '已暂停' : '正在播放'}${media.muted ? ' · 静音' : ''}`;
}
async function connectMedia(card, body) {
  if (!ext) throw new Error('请在 Edge 中加载扩展后使用网页媒体控制。');
  await permission([], ['tabs', 'scripting']);
  const tabs = await chrome.tabs.query(manager ? { currentWindow: true, url: ['http://*/*', 'https://*/*'] } : { active: true, currentWindow: true });
  const status = $('.status-line', body); status.textContent = '选择要连接的网页';
  $('.host-grant', body)?.remove(); const choices = el('div', 'host-grant button-row');
  for (const tab of tabs.filter(t => /^https?:/.test(t.url || ''))) {
    const url = safeURL(tab.url);
    choices.append(button(manager ? tab.title || new URL(url).hostname : '授权并连接此网站', 'secondary', async () => {
      await permission([new URL(url).origin + '/*']);
      const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: controlPageMedia, args: ['status'] });
      remoteTabs.set(card.id, tab.id); await chrome.storage.session.set({ ['remoteMediaTab:' + card.id]: tab.id });
      status.textContent = results[0]?.result || '已连接'; choices.remove();
    }));
  }
  if (!choices.children.length) status.textContent = '请先打开包含音乐或视频的普通网页。';
  $('.remote-section', body).append(choices);
}
function renderRemote(body, card) {
  const content = el('div'); const refresh = button('授权并刷新', 'text-button', async () => {
    const origins = card.type === 'weather' ? ['https://api.open-meteo.com/*'] : [new URL(card.url).origin + '/*'];
    await permission(origins); dataCache.delete(card.id); await loadRemote(content, card);
  }); body.append(content, refresh);
  void loadRemote(content, card);
}
async function loadRemote(content, card) {
  content.replaceChildren(el('p', 'muted', '正在获取…'));
  try {
    let data = dataCache.get(card.id);
    if (!data || Date.now() - data.at > 10 * 60 * 1000) {
      const url = card.type === 'weather' ? `https://api.open-meteo.com/v1/forecast?latitude=${card.latitude}&longitude=${card.longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code&timezone=auto` : card.url;
      const text = await fetchText(url); data = { text, at: Date.now() }; dataCache.set(card.id, data);
    }
    content.replaceChildren();
    if (card.type === 'weather') {
      const weather = JSON.parse(data.text).current; if (!weather || !Number.isFinite(weather.temperature_2m)) throw new Error('天气服务返回的数据不完整。');
      const [symbol, label] = weatherLabel(weather.weather_code); const line = el('div', 'temperature');
      line.append(el('strong', '', `${Math.round(weather.temperature_2m)}°`), el('span', 'weather-symbol', symbol));
      const meta = el('div', 'weather-meta'); meta.append(el('span', '', `体感 ${Math.round(weather.apparent_temperature)}°`), el('span', '', `湿度 ${weather.relative_humidity_2m}%`));
      const source = el('a', 'source', 'Open-Meteo · 天气模型数据 ↗'); source.href = 'https://open-meteo.com/'; source.target = '_blank'; source.rel = 'noopener noreferrer';
      content.append(line, el('div', '', `${card.city} · ${label}`), meta, source);
    } else {
      const xml = new DOMParser().parseFromString(data.text, 'text/xml');
      if (xml.querySelector('parsererror') || !['rss', 'feed', 'RDF'].includes(xml.documentElement.localName)) throw new Error('这不是有效的 RSS / Atom 信息源。');
      const list = el('ul', 'feed-list');
      for (const item of [...xml.querySelectorAll('item, entry')].slice(0, 8)) {
        const title = item.querySelector('title')?.textContent || '未命名文章';
        const links = [...item.getElementsByTagName('link')];
        const link = links.find(n => !n.getAttribute('rel') || n.getAttribute('rel') === 'alternate');
        let url; try { url = safeURL(new URL(link?.getAttribute('href') || link?.textContent || '', card.url).href); } catch { continue; }
        const a = el('a', '', title); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
        const date = new Date(item.querySelector('pubDate, published, updated')?.textContent || '');
        if (!Number.isNaN(date.getTime())) a.append(el('small', '', date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })));
        const li = el('li'); li.append(a); list.append(li);
      }
      content.append(list.children.length ? list : el('p', 'muted', '信息源暂时没有文章。'));
    }
    content.append(el('p', 'source', '更新于 ' + new Date(data.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })));
  } catch (error) { content.replaceChildren(el('p', 'status-line', error.message || '连接失败，请刷新重试。')); }
}
function updateClock() {
  const now = new Date(); $('#today').textContent = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(now) + '  /  为日常留一处安静';
  document.querySelectorAll('.clock-time').forEach(n => n.textContent = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }));
  document.querySelectorAll('.clock-date').forEach(n => n.textContent = now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }));
}

function inputField(label, name, value = '', type = 'text', required = false) {
  const wrap = el('label', '', label); const input = el('input'); input.type = type; input.name = name; if (type !== 'file') input.value = value; input.required = required; wrap.append(input); return wrap;
}
function selectField(label, name, choices, value) {
  const wrap = el('label', '', label); const select = el('select'); select.name = name;
  for (const [key, text] of choices) { const option = el('option', '', text); option.value = key; select.append(option); } select.value = value; wrap.append(select); return wrap;
}
function openEditor(card = null) {
  editing = card; selectedType = card?.type || 'website'; selectedCity = card?.type === 'weather' ? { latitude: card.latitude, longitude: card.longitude, name: card.city } : null;
  $('#editor-title').textContent = card ? '调整这张卡片' : '添加到你的空间'; $('#submit-card').textContent = card ? '保存修改' : '添加到空间'; $('#form-error').textContent = '';
  renderFields(); $('#editor').showModal();
}
$('#editor').addEventListener('close', () => { websiteEditor?.dispose(); websiteEditor = null; });
function renderFields() {
  websiteEditor?.dispose(); websiteEditor = null;
  const picker = $('#type-picker'); picker.replaceChildren(); picker.hidden = Boolean(editing);
  for (const [type, name] of Object.entries(kinds)) {
    const b = button('', type === selectedType ? 'active' : '', () => { selectedType = type; selectedCity = null; renderFields(); }); b.append(el('span', '', icons[type]), document.createTextNode(name)); picker.append(b);
  }
  const fields = $('#fields'); fields.replaceChildren(inputField('卡片名称', 'title', editing?.title || '', 'text', true)); $('[name=title]', fields).maxLength = 120;
  if (selectedType === 'website' || selectedType === 'feed') {
    fields.append(inputField(selectedType === 'feed' ? 'RSS / Atom 地址' : '网站地址', 'url', editing?.url || 'https://', 'url', true));
    if (selectedType === 'website') {
      fields.append(inputField('网站图标（文字或表情）', 'icon', editing?.icon?.startsWith('data:') ? '' : editing?.icon || ''));
      $('[name=icon]', fields).maxLength = 16;
      const upload = inputField('或上传图标图片', 'iconFile', '', 'file'); $('input', upload).accept = 'image/png,image/jpeg,image/webp,image/gif'; fields.append(upload);
      fields.append(el('p', 'muted', '自动读取网站图标，也可填写文字或上传不超过 256 KB 的 PNG/JPEG/WebP/GIF；上传图片优先。'));
      if (editing?.icon) { const label = el('label', 'check'); const reset = el('input'); reset.name = 'resetIcon'; reset.type = 'checkbox'; label.append(reset, document.createTextNode('恢复默认图标')); fields.append(label); }
      websiteEditor = mountWebsiteEditor(fields, editing);
    }
    else fields.append(el('p', 'muted', '保存后点击「授权并刷新」读取信息源。使用直接地址，不支持跳转链接。'));
  }
  if (selectedType === 'weather') {
    fields.append(inputField('搜索城市（也可输入英文 / 拼音）', 'city', editing?.city || ''));
    fields.append(button('搜索城市', 'secondary', searchCities), el('div', '', ''));
    const results = el('div'); results.id = 'city-results'; fields.append(results);
    if (selectedCity) results.append(el('p', 'muted', '已选择：' + selectedCity.name));
    fields.append(el('p', 'muted', '搜索会向 Open-Meteo 发送城市名称；不读取你的定位。'));
  }
  if (selectedType === 'file') {
    fields.append(inputField(editing?.fileId ? '更换文件（留空保留原文件）' : '选择本地文件', 'file', '', 'file', !editing?.fileId)); fields.append(el('p', 'muted', '保存文件副本，不设单个文件大小上限。支持图片、文本、音视频预览，其他格式可下载。'));
  }
  if (selectedType === 'note') { const label = el('label', '', '便笺内容'); const text = el('textarea', 'field'); text.name = 'text'; text.rows = 5; text.maxLength = 30000; text.value = editing?.text || ''; label.append(text); fields.append(label); }
  if (selectedType === 'media') { fields.append(inputField('歌单名称', 'playlistName', editing?.playlistName || editing?.title || '', 'text', true)); fields.append(el('p', 'muted', '小组件显示歌单名称，在独立音乐页管理曲目。')); }
  const row = el('div'); row.append(inputField('最小高度（像素）', 'height', editing?.height || 220, 'number'), el('p', 'muted', '颜色和圆角统一跟随「外观与设置」。'));
  $('[name=height]', row).min = 160; $('[name=height]', row).max = 600; fields.append(row);
}
async function searchCities() {
  const name = $('[name=city]').value.trim(); if (!name) throw new Error('请输入城市名称。');
  const result = $('#city-results'); result.textContent = '正在搜索…';
  try {
    await permission(['https://geocoding-api.open-meteo.com/*', 'https://api.open-meteo.com/*']);
    const data = JSON.parse(await fetchText(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=5&language=zh&format=json`));
    if (!result.isConnected) return;
    result.replaceChildren(); selectedCity = null;
    for (const city of data.results || []) {
      const choice = button([city.name, city.admin1, city.country].filter(Boolean).join(' · '), 'secondary', () => {
      selectedCity = city; for (const n of result.children) n.classList.remove('selected');
      choice.classList.add('selected');
      if (!$('[name=title]').value) $('[name=title]').value = city.name + '天气';
      }); result.append(choice);
    }
    if (!result.children.length) result.textContent = '未找到城市，试试英文或拼音。';
  } catch (error) { result.textContent = error.message; }
}
$('#card-form').addEventListener('submit', async event => {
  event.preventDefault(); const submit = $('#submit-card'); submit.disabled = true; $('#form-error').textContent = '';
  let storedId;
  try {
    if (!editing && state.cards.length >= 200) throw new Error('最多支持 200 张卡片。');
    const data = new FormData(event.currentTarget);
    const card = { ...(editing || {}), id: editing?.id || crypto.randomUUID(), type: selectedType, title: data.get('title').trim(), height: Number(data.get('height')) };
    if (!card.title) throw new Error('请输入卡片名称。');
    if (['website', 'feed'].includes(selectedType)) card.url = safeURL(data.get('url'));
    if (selectedType === 'website') {
      const keepCustomIcon = card.icon && !card.autoIcon && !websiteEditor?.preferAutomatic;
      const automaticIcon = data.get('iconFile')?.size || data.get('icon').trim() || data.get('resetIcon') === 'on' || keepCustomIcon ? '' : await websiteEditor?.icon(card.url);
      card.icon = data.get('resetIcon') === 'on' ? '' : safeIcon(data.get('icon').trim() || (keepCustomIcon ? card.icon : automaticIcon) || '');
      const iconFile = data.get('iconFile');
      if (iconFile?.size && data.get('resetIcon') !== 'on') card.icon = await readIconFile(iconFile);
      card.autoIcon = Boolean(automaticIcon && card.icon === automaticIcon && !iconFile?.size && !data.get('icon').trim() && data.get('resetIcon') !== 'on');
    }
    if (selectedType === 'note') card.text = data.get('text');
    if (selectedType === 'media') card.playlistName = data.get('playlistName').trim();
    if (selectedType === 'weather') { if (!selectedCity) throw new Error('请搜索并选择一个城市。'); Object.assign(card, { latitude: selectedCity.latitude, longitude: selectedCity.longitude, city: selectedCity.name }); }
    const file = data.get('file');
    if (selectedType === 'file' && file?.size) { storedId = crypto.randomUUID(); await fileStore('put', storedId, file); card.fileId = storedId; card.filename = file.name; }
    else if (selectedType === 'file' && !card.fileId) throw new Error('请选择非空文件。');
    const oldState = state;
    state = validateState({ ...state, cards: editing ? state.cards.map(c => c.id === card.id ? card : c) : [...state.cards, card] });
    try { await save(); } catch (error) { state = oldState; throw error; }
    if (storedId && editing?.fileId) await removeUnusedFile(editing.fileId);
    if (manager) selectedPlaylist = card.id;
    dataCache.delete(card.id); $('#editor').close(); render(); toast(editing ? '卡片已更新' : '已添加到你的空间');
  } catch (error) { if (storedId && !state.cards.some(c => c.fileId === storedId)) await fileStore('delete', storedId); $('#form-error').textContent = error.message; }
  finally { submit.disabled = false; }
});
async function readIconFile(file) {
  if (file.size > 256 * 1024 || !/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error('图标请使用不超过 256 KB 的 PNG / JPEG / WebP / GIF。');
  try { const bitmap = await createImageBitmap(file); bitmap.close(); } catch { throw new Error('无法读取图标，请选择有效的图片。'); }
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(safeIcon(reader.result)); reader.onerror = () => reject(new Error('图标读取失败。')); reader.readAsDataURL(file); });
}
async function removeUnusedFile(id) {
  if (state.cards.some(card => cardFileIds(card).includes(id))) return;
  await fileStore('delete', id); if (blobs.has(id)) URL.revokeObjectURL(blobs.get(id)); blobs.delete(id);
}
function cardFileIds(card) {
  return [...new Set([...(card?.fileId ? [card.fileId] : []), ...((card?.tracks || []).map(track => track.fileId).filter(Boolean))])];
}
$('#media-file').addEventListener('change', async event => {
  const files = [...event.target.files]; event.target.value = ''; if (!files.length) return;
  const storedIds = [];
  try {
    const card = state.cards.find(c => c.id === mediaTarget); if (!card) return;
    const tracks = card.tracks || [];
    for (const file of files) { if (!/^(audio|video)\//.test(file.type)) throw new Error(`「${file.name}」不是可播放的音频或视频。`); }
    const added = [];
    for (const file of files) { const fileId = crypto.randomUUID(); await fileStore('put', fileId, file); storedIds.push(fileId); added.push({ fileId, filename: file.name, mediaType: file.type }); }
    const before = structuredClone(card); card.tracks = [...tracks, ...added]; card.currentTrackId ||= added[0]?.fileId || '';
    try { await save(); } catch (error) { Object.assign(card, before); throw error; }
    render(); toast(`已向歌单添加 ${added.length} 首`);
  } catch (error) { for (const id of storedIds) if (!state.cards.some(card => cardFileIds(card).includes(id))) await fileStore('delete', id); report(error); }
});
$('#add-button').addEventListener('click', () => { openEditor(); if (manager) { selectedType = 'media'; renderFields(); $('#type-picker').hidden = true; } });
$('#arrange').addEventListener('click', () => { arranging = !arranging; render(); });
document.querySelectorAll('.close-dialog').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
$('#preview').addEventListener('close', () => { $('#preview-body').querySelectorAll('audio,video').forEach(n => n.pause()); $('#preview-body').replaceChildren(); });
$('#settings-button').addEventListener('click', () => {
  for (const key of ['theme', 'palettePreset', 'radius', 'density', 'columns']) $('#settings-form').elements[key].value = state.settings[key];
  $('#palette-mode').value = document.body.dataset.theme;
  renderSchemePreview(); renderPaletteFields();
  $('#settings').showModal();
});
const paletteLabels = { background: '空间背景', surface: '卡片与控件', text: '主要文字', muted: '次要文字', line: '边框', accent: '强调色', onAccent: '强调色上的文字' };
function renderSchemePreview() {
  const preset = state.settings.palettePreset; const mode = document.body.dataset.theme;
  const palette = resolvedPalette(state.settings, mode); const preview = $('#scheme-preview'); preview.replaceChildren();
  for (const key of ['background', 'surface', 'accent', 'text']) { const swatch = el('span', 'scheme-swatch'); swatch.style.background = palette[key]; swatch.title = paletteLabels[key]; preview.append(swatch); }
  $('#custom-palette').hidden = preset !== 'custom';
  const named = palettePresets()[preset]; $('#scheme-description').textContent = preset === 'custom' ? '当前使用你的自定义方案。' : `当前使用「${named.name}」预设；浅色与深色模式会自动使用对应版本。`;
}
function renderPaletteFields() {
  const mode = $('#palette-mode').value; const fields = $('#palette-fields'); fields.replaceChildren();
  for (const [key, label] of Object.entries(paletteLabels)) {
    const field = inputField(label, 'palette-' + key, state.settings.palettes[mode][key], 'color');
    $('input', field).dataset.paletteKey = key; fields.append(field);
  }
}
$('#palette-mode').addEventListener('change', renderPaletteFields);
$('#reset-palette').addEventListener('click', () => { const mode = $('#palette-mode').value; state.settings.palettes[mode] = paletteDefaults()[mode]; renderPaletteFields(); applySettings(); renderSchemePreview(); void save(); });
$('#settings-form').addEventListener('submit', e => e.preventDefault());
$('#settings-form').addEventListener('input', event => {
  if (event.target.id === 'palette-mode') return;
  const settings = { ...state.settings };
  if (event.target.dataset.paletteKey) settings.palettes[$('#palette-mode').value][event.target.dataset.paletteKey] = event.target.value;
  else if (['theme', 'palettePreset', 'radius', 'density', 'columns'].includes(event.target.name)) settings[event.target.name] = event.target.value;
  state.settings = validateState({ ...state, settings }).settings; applySettings(); void save();
  if (event.target.name === 'theme') { $('#palette-mode').value = document.body.dataset.theme; renderPaletteFields(); }
  if (event.target.name === 'theme' || event.target.name === 'palettePreset' || event.target.dataset.paletteKey) renderSchemePreview();
});
$('#export').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })); download(url, `栖边配置-${new Date().toISOString().slice(0, 10)}.json`); setTimeout(() => URL.revokeObjectURL(url), 60000);
});
$('#import').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error('配置文件不能超过 5 MB。');
    const next = validateState(JSON.parse(await file.text()));
    if (!confirm(`导入 ${next.cards.length} 张卡片并替换当前布局？建议先导出当前配置。文件内容不会随配置导入。`)) return;
    const before = state; state = next; try { await save(); } catch (error) { state = before; throw error; }
    remoteTabs.clear(); dataCache.clear();
    $('#settings').close(); render(); toast('配置已导入；缺失的文件请重新选择。');
  } catch (error) { report(error); }
});
function previewWebsiteImport(entries) {
  pendingEntries = entries;
  const result = prepareWebsiteImport(entries, state.cards);
  $('#links-status').textContent = `可导入 ${result.cards.length} 个网站；重复 ${result.duplicates} 个，无效 ${result.invalid} 个，超出容量 ${result.truncated} 个。`;
  $('#links-preview').replaceChildren();
  for (const card of result.cards.slice(0, 30)) { const li = el('li'); li.append(el('strong', '', card.title), el('small', 'muted', card.url)); $('#links-preview').append(li); }
  if (result.cards.length > 30) $('#links-preview').append(el('li', 'muted', `还有 ${result.cards.length - 30} 个网站…`));
  $('#apply-links').disabled = result.cards.length === 0;
}
$('#links-import-button').addEventListener('click', () => {
  $('#settings').close(); pendingEntries = []; $('#onetab-text').value = ''; $('#links-preview').replaceChildren();
  $('#links-status').textContent = '导入前可预览结果，最多保留 200 张卡片。'; $('#apply-links').disabled = true; $('#links-import').showModal();
});
$('#onetab-text').addEventListener('input', () => { pendingEntries = []; $('#apply-links').disabled = true; $('#links-preview').replaceChildren(); $('#links-status').textContent = '文本已修改，请重新预览。'; });
$('#parse-onetab').addEventListener('click', () => { try { previewWebsiteImport(parseOneTab($('#onetab-text').value)); } catch (error) { report(error); } });
$('#choose-links-file').addEventListener('click', () => $('#links-file').click());
$('#links-file').addEventListener('change', async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error('导入文件不能超过 5 MB。');
    const text = await file.text(); const html = /\.html?$/i.test(file.name) || /^\s*<!DOCTYPE NETSCAPE-Bookmark-file-1>/i.test(text);
    previewWebsiteImport(html ? parseBookmarksHTML(text) : parseOneTab(text));
  } catch (error) { report(error); }
});
$('#read-bookmarks').addEventListener('click', async () => {
  try {
    if (!ext) throw new Error('请在 Edge 扩展中读取收藏夹，或选择导出的 HTML 文件。');
    await permission([], ['bookmarks']); previewWebsiteImport(flattenBookmarks(await chrome.bookmarks.getTree()));
  } catch (error) { report(error); }
});
$('#apply-links').addEventListener('click', async () => {
  const submit = $('#apply-links'); submit.disabled = true;
  try {
    const result = prepareWebsiteImport(pendingEntries, state.cards); if (!result.cards.length) throw new Error('没有可导入的新网站。');
    const before = state; state = validateState({ ...state, cards: [...state.cards, ...result.cards] });
    try { await save(); } catch (error) { state = before; throw error; }
    pendingEntries = []; $('#links-import').close(); render(); toast(`已导入 ${result.cards.length} 个网站`);
  } catch (error) { report(error); submit.disabled = false; }
});
function focusCard(id) {
  if (!id || !state) return;
  const card = state.cards.find(c => c.id === id); if (!card) return;
  if (document.body.classList.contains('compact-mode')) setDisplayMode('expanded');
  const node = [...document.querySelectorAll('.card')].find(n => n.dataset.id === id);
  node?.scrollIntoView({ block: 'start', behavior: 'instant' });
  if (node) { node.tabIndex = -1; node.focus({ preventScroll: true }); }
  if (card.type === 'website') $('.open-in-qibian', node)?.click();
}
let closingPanel = false;
async function connectPanel() {
  if (!ext || embedded || manager || closingPanel) return;
  try {
    // A standalone tab shares the native panel URL but must not claim its lifetime.
    if (await chrome.tabs.getCurrent()) return;
    if (chrome.runtime.getContexts && !(await chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'], documentUrls: [location.href] })).length) return;
    const win = await chrome.windows.getCurrent(); panelWindowId = win.id;
    panelPort = chrome.runtime.connect({ name: 'qibian-panel' });
    panelPort.postMessage({ type: 'qibian:panel-ready', windowId: panelWindowId });
    panelPort.onDisconnect.addListener(() => { if (!closingPanel) setTimeout(connectPanel, 500); });
  } catch (error) { console.warn('无法连接缩略栏', error); }
}
$('#mini-button').title = '切换到小图标模式';
$('#mini-button').setAttribute('aria-label', '切换到小图标模式');
$('#mini-button').setAttribute('aria-controls', 'compact-navigation');
$('#mini-button').setAttribute('aria-expanded', 'true');
$('#mini-button').addEventListener('click', async () => {
  if (!ext || embedded) { try { await saveQueue; setDisplayMode('mini'); } catch(error) { report(error); } return; }
  const button = $('#mini-button'); button.disabled = true;
  try {
    await saveQueue;
    const windowId = panelWindowId ?? (await chrome.windows.getCurrent()).id;
    const result = await requestMiniTransition(chrome, windowId);
    if (!result.ok) throw new Error(result.error || '当前网页未能显示图标栏，请检查网站访问权限。');
    if (result.inPage) setDisplayMode('mini');
  } catch (error) { reportMiniError(error); }
  finally { button.disabled = false; }
});
if (ext) {
  chrome.runtime.onMessage.addListener(message => { if (message?.type === 'qibian:focus' && (!message.windowId || message.windowId === panelWindowId)) focusCard(message.cardId); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.syncConfig) document.querySelectorAll('.sync-takeover').forEach(node => { node.hidden = !changes.syncConfig.newValue?.enabled; });
    if (area === 'local' && changes.workspace && !pendingSaves) void refreshWorkspace();
    if (area === 'session' && changes.musicState) { musicState = changes.musicState.newValue || {}; updatePlayback(); }
    if (area === 'session') for (const [key, change] of Object.entries(changes)) if (key.startsWith('remoteMediaTab:')) remoteTabs.set(key.slice(15), change.newValue);
    if (area === 'session' && changes.focusCardId?.newValue) chrome.storage.session.get(['focusCardId', 'focusWindowId']).then(pending => {
      if (!pending.focusWindowId || pending.focusWindowId === panelWindowId) focusCard(pending.focusCardId);
    }).catch(console.warn);
  });
  window.addEventListener('pagehide', () => { closingPanel = true; panelPort?.disconnect(); });
  setInterval(() => { try { panelPort?.postMessage({ type: 'qibian:panel-ready', windowId: panelWindowId }); } catch { /* reconnect handles worker restarts */ } }, 25000);
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applySettings());
async function init() {
  try { const saved = ext ? (await chrome.storage.local.get('workspace')).workspace : JSON.parse(localStorage.getItem('qibian') || 'null'); state = saved ? validateState(saved) : defaults(); }
  catch (error) { state = defaults(); report(new Error('无法读取已有配置，已显示临时默认布局。请先检查备份。')); }
  baseline = structuredClone(state);
  if (embedded) document.body.classList.add('embedded-panel');
  if (ext && !embedded && !manager) {
    const ownTab = await chrome.tabs.getCurrent();
    if (ownTab) {
      const notice = el('aside', 'standalone-notice');
      notice.append(el('span', '', '当前是独立标签页。浏览其他网页时，点击工具栏中的栖边图标即可打开右侧边栏。'));
      const recent = (await chrome.tabs.query({ windowId:ownTab.windowId })).filter(tab => tab.id !== ownTab.id && /^https?:/.test(tab.url || '')).sort((a,b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
      if (recent) {
        const launch = el('button', 'secondary', '返回网页并打开边栏'); launch.type = 'button';
        launch.addEventListener('click', () => {
          // Queue tab activation and opening without awaiting either operation.
          const activate = chrome.tabs.update(recent.id, { active:true });
          Promise.all([activate, openNativeSidebar(chrome, recent)]).catch(report);
        });
        notice.append(launch);
      }
      document.body.prepend(notice);
    }
  }
  if (quickCardId) { document.body.classList.add('quick-panel'); $('#mini-button').textContent = '×'; $('#mini-button').title = '关闭组件'; $('#mini-button').setAttribute('aria-label','关闭组件'); }
  if (manager) { document.body.classList.add('music-manager'); $('#mini-button').hidden = true; $('#add-button').textContent = '+ 新建歌单'; }
  render(); setInterval(updateClock, 1000);
  if (ext) {
    musicState = (await chrome.storage.session.get('musicState')).musicState || {};
    for (const [key, value] of Object.entries(await chrome.storage.session.get(null))) if (key.startsWith('remoteMediaTab:')) remoteTabs.set(key.slice(15), value);
    if (!musicState.owner && !await chrome.offscreen.hasDocument()) musicState.paused = true; updatePlayback();
    if (embedded) { focusCard(new URLSearchParams(location.search).get('card')); window.parent.postMessage({ type: 'qibian:frame-ready' }, '*'); if (quickCardId) { const card = state.cards.find(c => c.id === quickCardId); if(card?.type === 'file') previewFile(card).catch(report); } return; }
    if (manager) return;
    await connectPanel(); const pending = await chrome.storage.session.get(['focusCardId', 'focusWindowId']);
    if (!pending.focusWindowId || pending.focusWindowId === panelWindowId) { focusCard(pending.focusCardId); await chrome.storage.session.remove(['focusCardId', 'focusWindowId']); }
  }
}
void init();

async function refreshWorkspace() {
  if (!baseline || pendingSaves) return;
  try {
    const saved = (await chrome.storage.local.get('workspace')).workspace;
    if (!saved || pendingSaves) return;
    const next = validateState(saved);
    if (JSON.stringify(next) === JSON.stringify(state)) return;
    state = next; baseline = structuredClone(next); render();
  } catch (error) { report(error); }
}
if (embedded) window.addEventListener('message', event => {
  if (event.source !== window.parent) return;
  if (event.data?.type === 'qibian:focus') focusCard(event.data.cardId);
  if (event.data?.type === 'qibian:set-display-mode') setDisplayMode(event.data.mode === 'mini' ? 'mini' : 'expanded');
});
