import { nextTrackIndex } from './core.js';
const audio = new Audio(); audio.preload = 'auto';
let cardId = '', trackId = '', objectURL, queue = Promise.resolve(), errorText = '', stopped = false;
let leaseUntil = Infinity;
const db = new Promise((resolve, reject) => { const r = indexedDB.open('qibian-files', 1); r.onupgradeneeded = () => r.result.createObjectStore('files'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
const snapshot = () => ({ cardId, trackId, paused: audio.paused, stopped, currentTime: audio.currentTime || 0, duration: Number.isFinite(audio.duration) ? audio.duration : 0, volume: audio.volume, error: errorText });
const publish = () => chrome.runtime.sendMessage({ type: 'music:publish', state: snapshot() }).catch(() => {});
async function workspace() { return (await chrome.runtime.sendMessage({ type: 'music:workspace' })).workspace; }
async function load(card, id) {
  const track = card?.tracks?.find(t => t.fileId === id); if (!track) throw new Error('歌单为空，请先添加音乐。');
  if (cardId === card.id && trackId === id && objectURL) return;
  audio.pause(); const database = await db;
  const file = await new Promise((resolve, reject) => { const r = database.transaction('files').objectStore('files').get(id); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  if (!file) throw new Error('此设备缺少该音乐文件，请在音乐管理页重新添加。');
  if (objectURL) URL.revokeObjectURL(objectURL); objectURL = URL.createObjectURL(file);
  cardId = card.id; trackId = id; errorText = ''; audio.src = objectURL; audio.load();
  await chrome.runtime.sendMessage({ type: 'music:cursor', cardId, trackId });
}
async function command(m) {
  if (m.action === 'lease') { if (leaseUntil !== 0) leaseUntil = Date.now() + 8000; return snapshot(); }
  if (['silence', 'stop', 'pause'].includes(m.action)) {
    if (m.action === 'silence') leaseUntil = 0;
    audio.pause(); stopped = m.action !== 'pause';
    if (stopped) audio.currentTime = 0;
    await publish(); return snapshot();
  }
  if (m.deadline && Date.now() > m.deadline) throw new Error('播放请求已过期，请重试。');
  if (m.synced) leaseUntil = Date.now() + 8000;
  else if (!['ended', 'reconcile', 'state'].includes(m.action)) leaseUntil = Infinity;
  if (m.action === 'ended' && Date.now() > leaseUntil) return snapshot();
  const state = await workspace(); const card = state?.cards.find(c => c.id === (m.cardId || cardId) && c.type === 'media');
  if (m.action === 'state') return snapshot();
  if (m.action === 'reconcile') {
    const active = state?.cards.find(c => c.id === cardId);
    if (cardId && !active?.tracks?.some(t => t.fileId === trackId)) { audio.pause(); audio.removeAttribute('src'); audio.load(); if (objectURL) URL.revokeObjectURL(objectURL); objectURL = null; cardId = ''; trackId = ''; }
    await publish(); return snapshot();
  }
  if (!card) throw new Error('歌单不存在。');
  if (m.action === 'seek') { if (card.id === cardId && Number.isFinite(m.value) && Number.isFinite(audio.duration)) audio.currentTime = Math.max(0, Math.min(audio.duration, m.value)); }
  else if (m.action === 'volume') audio.volume = Math.max(0, Math.min(1, Number(m.value) || 0));
  else if (m.action === 'toggle' && card.id === cardId && !audio.paused) audio.pause();
  else if (m.action === 'toggle-stop' && card.id === cardId && !audio.paused) { stopped = true; audio.pause(); audio.currentTime = 0; }
  else {
    let id = m.trackId || (card.id === cardId ? trackId : card.currentTrackId) || card.tracks[0]?.fileId;
    if (['next', 'previous', 'ended'].includes(m.action)) {
      const index = nextTrackIndex(card.tracks.length, card.tracks.findIndex(t => t.fileId === id), card.playMode, m.action === 'previous' ? -1 : 1, m.action === 'ended');
      if (index < 0) { await publish(); return snapshot(); } id = card.tracks[index].fileId;
    }
    await load(card, id); if (m.action === 'ended' && audio.ended) audio.currentTime = 0;
    if (Number.isFinite(m.currentTime) && m.currentTime > 0) {
      if (audio.readyState < 1) await new Promise((resolve, reject) => {
        const done = () => { clearTimeout(timer); audio.removeEventListener('loadedmetadata', done); audio.removeEventListener('error', fail); resolve(); };
        const fail = () => { clearTimeout(timer); audio.removeEventListener('loadedmetadata', done); audio.removeEventListener('error', fail); reject(new Error('读取音乐信息失败。')); };
        const timer = setTimeout(fail, 5000); audio.addEventListener('loadedmetadata', done); audio.addEventListener('error', fail);
      });
      audio.currentTime = Math.min(m.currentTime, Number.isFinite(audio.duration) ? audio.duration : m.currentTime);
    }
    if (m.deadline && Date.now() > m.deadline) throw new Error('音乐仍在加载，请稍后播放。');
    stopped = false; await audio.play();
  }
  await publish(); return snapshot();
}
function enqueue(m) { const task = queue.catch(() => {}).then(() => command(m)); queue = task; return task.catch(async e => { errorText = e.message; await publish(); return { ok: false, error: errorText }; }); }
chrome.runtime.onMessage.addListener((m, sender, respond) => {
  if (m?.type === 'music:reconcile') { void enqueue({ action: 'reconcile' }); return; }
  if (m?.type !== 'music:engine') return;
  enqueue(m).then(respond); return true;
});
audio.addEventListener('ended', () => void enqueue({ action: 'ended' }));
for (const event of ['play', 'pause', 'loadedmetadata', 'seeked', 'volumechange']) audio.addEventListener(event, publish);
audio.addEventListener('error', () => { errorText = '无法解码此媒体，请使用 Edge 支持的音频格式。'; void publish(); });
setInterval(() => { if (!audio.paused && Date.now() > leaseUntil) { audio.pause(); stopped = true; void publish(); } else if (!audio.paused) void publish(); }, 1000);
