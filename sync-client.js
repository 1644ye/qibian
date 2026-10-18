import { defaults } from './core.js';
import { mergePatch } from './workspace-store.js';
import { fileIds, remapPatch } from './sync-model.js';
import { syncFile } from './sync-files.js';

export function createSyncClient({ execute, display }) {
  let socket, config, joined = false, owner = '', serial = Promise.resolve(), flushing = false, lastPong = 0, generation = 0, deferredWorkspace;
  const pending = new Map();
  const uploaded = new Set();
  const status = value => chrome.storage.local.set({ syncStatus:{ ...value, at:Date.now() } });
  const send = message => { if (socket?.readyState !== WebSocket.OPEN) throw new Error('本机同步服务未连接。'); socket.send(JSON.stringify(message)); };
  const rpc = message => new Promise((resolve, reject) => {
    const request = crypto.randomUUID(); const timer = setTimeout(() => { pending.delete(request); reject(new Error('同步超时，请检查本机服务。')); }, 60000);
    pending.set(request, { resolve, reject, timer });
    try { send({ ...message, request }); } catch (e) { clearTimeout(timer); pending.delete(request); reject(e); }
  });
  const enqueue = fn => { const task = serial.catch(() => {}).then(fn); serial = task; return task; };
  async function transfer(workspace, upload) {
    for (const id of fileIds(workspace)) {
      if (upload && uploaded.has(id)) continue;
      const url = `http://127.0.0.1:${config.port}/files/${encodeURIComponent(id)}`;
      const headers = { Authorization:`Bearer ${config.token}` };
      const local = await syncFile('get', id);
      if (upload) {
        if (!local) continue;
        const head = await fetch(url, { method:'HEAD', headers });
        if (head.ok) { uploaded.add(id); continue; }
        if (head.status !== 404) throw new Error(`文件检查失败 (${head.status})`);
        const response = await fetch(url, { method:'PUT', headers:{ ...headers, 'X-File-Type':local.type, 'X-File-Name':encodeURIComponent(local.name || id) }, body:local });
        if (!response.ok && response.status !== 409) throw new Error(`文件上传失败 (${response.status})`);
        if (response.status === 409) throw new Error('另一个浏览器正在上传文件，稍后自动重试。');
        uploaded.add(id);
      } else if (!local) {
        const response = await fetch(url, { headers });
        if (response.status === 404) continue; // Old JSON backups can reference files that were never imported on this computer.
        if (!response.ok) throw new Error(`文件下载失败 (${response.status})`);
        const card = workspace.cards.find(c => c.fileId === id || c.tracks?.some(t => t.fileId === id));
        const track = card?.tracks?.find(t => t.fileId === id);
        await syncFile('put', id, new File([await response.blob()], track?.filename || card?.filename || id, { type:response.headers.get('X-File-Type') || track?.mediaType || 'application/octet-stream' }));
      }
    }
  }
  async function apply(message, activeGeneration) {
    await transfer(message.workspace, false);
    if (activeGeneration !== generation) return;
    await navigator.locks.request('qibian-workspace', async () => {
      const stored = await chrome.storage.local.get(['syncRevision', 'syncOutbox']);
      if (message.revision < (stored.syncRevision || 0)) return;
      const outbox = (stored.syncOutbox || []).filter(op => message.ack === undefined || op.seq > message.ack).map(op => ({ ...op, patch:remapPatch(op.patch, message.mapping) }));
      const workspace = outbox.reduce((value, op) => mergePatch(value, op.patch), message.workspace);
      await chrome.storage.local.set({ workspace, syncRevision:message.revision, syncOutbox:outbox, ...(message.mapping ? { syncMapped:true } : {}) });
    });
  }
  async function flush() {
    if (!joined || flushing) return;
    flushing = true; const activeGeneration = generation;
    try {
      while (joined && activeGeneration === generation) {
        const stored = await chrome.storage.local.get(['syncOutbox', 'workspace']);
        const op = stored.syncOutbox?.[0]; if (!op) break;
        await transfer(stored.workspace, true);
        // Also upload files referenced by queued creates that a later local edit removed.
        await transfer({ cards:op.patch.cards.map(c => c.create || c.fields || {}) }, true);
        const reply = await rpc({ type:'patch', ...op });
        await enqueue(() => apply(reply, activeGeneration));
      }
    } catch (error) { await status({ connected:false, error:error.message }); socket?.close(); }
    finally { flushing = false; }
  }
  async function connect() {
    config = (await chrome.storage.local.get('syncConfig')).syncConfig;
    if (!config?.enabled) { await chrome.alarms.clear('qibian-sync-reconnect'); return; }
    if (socket && socket.readyState < WebSocket.CLOSING) return;
    await chrome.alarms.create('qibian-sync-reconnect', { periodInMinutes:1 });
    const activeGeneration = ++generation; joined = false; deferredWorkspace = null; uploaded.clear();
    const ws = new WebSocket(`ws://127.0.0.1:${config.port}/sync`); socket = ws;
    ws.onopen = () => { lastPong = Date.now(); send({ type:'hello', ...config }); };
    ws.onmessage = event => {
      if (activeGeneration !== generation) return;
      let message; try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === 'reply') {
        const p = pending.get(message.request); if (p) { clearTimeout(p.timer); pending.delete(message.request); message.error ? p.reject(new Error(message.error)) : p.resolve(message); } return;
      }
      if (message.type === 'pong') { lastPong = Date.now(); if (owner === config.clientId) void execute({ action:'lease' }); return; }
      if (message.type === 'peers') { void chrome.storage.local.set({ syncPeers:message.peers }); return; }
      if (message.type === 'music') { owner = message.state.owner; void display(message.state); return; }
      if (message.type === 'execute') {
        void (async () => {
          try {
            if (message.command.action !== 'silence') {
              await serial.catch(() => {});
              if (Date.now() > message.command.deadline) throw new Error('文件仍在同步，请稍后播放。');
            }
            const result = await execute({ ...message.command, synced:true }); send({ type:'executed', request:message.request, ...(result?.ok === false ? { error:result.error } : { state:result }) });
          }
          catch (e) { try { send({ type:'executed', request:message.request, error:e.message }); } catch {} }
        })(); return;
      }
      if (message.type === 'authenticated') {
        void (async () => {
          // Stop any playback that began before pairing, before joining the shared player.
          await execute({ action:'silence' });
          const stored = await navigator.locks.request('qibian-workspace', async () => chrome.storage.local.get(['workspace', 'syncSequence', 'syncMapped']));
          const workspace = stored.workspace || defaults();
          await transfer(workspace, true);
          const reply = await rpc({ type:'join', workspace, seq:stored.syncSequence || 0, mapped:stored.syncMapped });
          await enqueue(() => apply(reply, activeGeneration));
          if (activeGeneration !== generation) return;
          joined = true;
          if (deferredWorkspace) { const latest = deferredWorkspace; deferredWorkspace = null; await enqueue(() => apply(latest, activeGeneration)); }
          await status({ connected:true }); void flush();
        })().catch(async error => { await status({ connected:false, error:error.message }); ws.close(); }); return;
      }
      if (message.type === 'workspace') {
        // A new browser must upload/merge its original snapshot before receiving another browser's state.
        if (!joined) { if (!deferredWorkspace || message.revision >= deferredWorkspace.revision) deferredWorkspace = message; return; }
        void enqueue(() => apply(message, activeGeneration)).catch(error => { void status({ connected:false, error:error.message }); ws.close(); });
      }
    };
    ws.onclose = event => {
      if (activeGeneration !== generation) return;
      joined = false; socket = null;
      for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('本机同步连接已断开。')); } pending.clear();
      void execute({ action:'silence' });
      void status({ connected:false, error:event.code === 1008 ? '配对密钥不正确。' : '等待本机同步服务，修改已保存在本浏览器，连接后自动同步。' });
    };
  }
  setInterval(() => {
    if (socket?.readyState === WebSocket.OPEN) {
      if (Date.now() - lastPong > 10000) socket.close(); else send({ type:'ping' });
    } else if (config?.enabled) void connect();
  }, 2000);
  chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'qibian-sync-reconnect') void connect(); });
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.syncOutbox) void flush(); });
  void connect();
  return {
    async configure(value) {
      if (socket) { socket.close(); socket = null; }
      generation++; joined = false; await execute({ action:'silence' });
      for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('同步设置已更改。')); } pending.clear();
      await navigator.locks.request('qibian-workspace', async () => {
        const old = await chrome.storage.local.get(['syncConfig', 'workspace']);
        const same = old.syncConfig?.token === value.token && old.syncConfig?.port === value.port && (old.syncConfig?.enabled || !value.enabled);
        config = { ...value, clientId:same ? old.syncConfig.clientId : crypto.randomUUID() };
        const changes = { syncConfig:config };
        if (!same) Object.assign(changes, { syncOutbox:[], syncSequence:0, syncRevision:0, syncMapped:false, syncBackup:old.workspace || defaults() });
        await chrome.storage.local.set(changes);
      });
      await status({ connected:false, error:value.enabled ? '正在连接本机同步服务…' : '已关闭跨浏览器同步。' });
      await connect(); return { ok:true };
    },
    async command(message) {
      config = (await chrome.storage.local.get('syncConfig')).syncConfig;
      if (!config?.enabled) return execute(message);
      if (!joined) throw new Error('本机同步尚未就绪，请启动同步服务并等待文件同步完成。');
      await flush();
      const response = await rpc({ type:'command', command:message }); return response.state;
    },
    async publish(state) {
      if (!config?.enabled) return display(state);
      if (socket?.readyState === WebSocket.OPEN && owner === config.clientId) send({ type:'publish', state });
    }
  };
}
