import http from 'node:http';
import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { randomBytes, createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { defaults, validateState } from '../core.js';
import { mergePatch } from '../workspace-store.js';

export async function startServer({ directory, port = 17381, token: suppliedToken } = {}) {
  await mkdir(join(directory, 'files'), { recursive:true });
  const tokenPath = join(directory, 'pairing-key.txt');
  let token = suppliedToken;
  if (!token) { try { token = (await readFile(tokenPath, 'utf8')).trim(); } catch { token = randomBytes(24).toString('hex'); await writeFile(tokenPath, token, { mode:0o600 }); } }
  let saved;
  try { saved = JSON.parse(await readFile(join(directory, 'workspace.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let state = saved || { workspace:null, revision:0, clients:{} };
  let music = { paused:true, stopped:true }, owner = '', queue = Promise.resolve();
  const peers = new Map(), pending = new Map(), uploads = new Set();
  const serialize = fn => { const task = queue.then(fn); queue = task.catch(() => {}); return task; };
  const persist = async () => { await writeFile(join(directory, 'workspace.tmp'), JSON.stringify(state)); await rename(join(directory, 'workspace.tmp'), join(directory, 'workspace.json')); };
  const send = (socket, message) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); };
  const broadcast = message => { for (const peer of peers.values()) send(peer.socket, message); };
  const roster = () => broadcast({ type:'peers', peers:[...peers.values()].map(p => ({ id:p.id, name:p.name })) });
  const publish = () => broadcast({ type:'music', state:{ ...music, owner, ownerName:peers.get(owner)?.name || '' } });
  const validToken = value => typeof value === 'string' && Buffer.byteLength(value) === Buffer.byteLength(token) && timingSafeEqual(Buffer.from(value), Buffer.from(token));
  const validOrigin = origin => /^((chrome|moz)-extension|extension):\/\/[a-zA-Z0-9-]+$/.test(origin || '');
  const filePath = id => join(directory, 'files', createHash('sha256').update(id).digest('hex'));
  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (origin && !validOrigin(origin) || !/^127\.0\.0\.1:\d+$/.test(req.headers.host || '')) { res.writeHead(403).end(); return; }
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Expose-Headers', 'X-File-Type, X-File-Name');
    if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-File-Name, X-File-Type'); res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, PUT, OPTIONS'); res.writeHead(204).end(); return; }
    if (!validToken(req.headers.authorization?.replace(/^Bearer /, ''))) { res.writeHead(401).end(); return; }
    try {
      const url = new URL(req.url, 'http://localhost');
      if (!url.pathname.startsWith('/files/')) { res.writeHead(404).end(); return; }
      const id = decodeURIComponent(url.pathname.slice(7)); if (!id || id.length > 200) throw new Error('Invalid file id');
      const path = filePath(id);
      if (req.method === 'HEAD' || req.method === 'GET') {
        let info; try { info = await stat(path); } catch { res.writeHead(404).end(); return; }
        res.setHeader('Content-Length', info.size); res.setHeader('Content-Type', 'application/octet-stream');
        try { const meta = JSON.parse(await readFile(path + '.json', 'utf8')); res.setHeader('X-File-Type', meta.type); res.setHeader('X-File-Name', meta.name); } catch {}
        if (req.method === 'HEAD') res.end(); else await pipeline(createReadStream(path), res); return;
      }
      if (req.method !== 'PUT') { res.writeHead(405).end(); return; }
      if (uploads.has(id)) { res.writeHead(409).end('File upload in progress'); return; }
      try { await stat(path); res.writeHead(204).end(); req.resume(); return; } catch {}
      uploads.add(id);
      try {
        // Stream to disk, with no per-file size cap; unfinished files are never published.
        await pipeline(req, createWriteStream(path + '.part'));
        await writeFile(path + '.json', JSON.stringify({ type:String(req.headers['x-file-type'] || '').slice(0, 200), name:String(req.headers['x-file-name'] || '').slice(0, 2000) }));
        await rename(path + '.part', path); res.writeHead(201).end();
      } finally { uploads.delete(id); }
    } catch (error) { if (!res.headersSent) res.writeHead(500); res.end(error.message); }
  });
  const wss = new WebSocketServer({ noServer:true, maxPayload:64 * 1024 * 1024 });
  server.requestTimeout = 0; // Large local files must not inherit Node's five-minute upload deadline.
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/sync' || !validOrigin(req.headers.origin) || !/^127\.0\.0\.1:\d+$/.test(req.headers.host || '')) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  });
  const execute = (id, command) => new Promise((resolve, reject) => {
    const peer = peers.get(id); if (!peer) { reject(new Error('播放浏览器已断开，请稍后重试。')); return; }
    const request = randomUUID(); const timer = setTimeout(() => { pending.delete(request); reject(new Error('播放浏览器未响应，未启动新的播放。')); }, 10000);
    pending.set(request, { id, resolve, reject, timer }); send(peer.socket, { type:'execute', request, command:{ ...command, deadline:Date.now() + 9500 } });
  });
  wss.on('connection', socket => {
    socket.on('error', () => {}); // Protocol errors close only this peer, not the helper process.
    let client;
    const authTimer = setTimeout(() => socket.close(1008, 'Authentication required'), 10000);
    socket.on('message', raw => {
      let message; try { message = JSON.parse(raw); } catch { socket.close(1008); return; }
      if (!message || typeof message !== 'object' || Array.isArray(message)) { socket.close(1008); return; }
      if (message.type === 'hello') {
        if (client || !validToken(message.token) || !/^[\w-]{8,100}$/.test(message.clientId || '') || ['__proto__', 'constructor', 'prototype'].includes(message.clientId)) { socket.close(1008, 'Invalid pairing key'); return; }
        clearTimeout(authTimer); client = message.clientId;
        const old = peers.get(client); if (old) old.socket.close(1000, 'Reconnected');
        peers.set(client, { id:client, name:String(message.name || '浏览器').slice(0, 60), socket });
        send(socket, { type:'authenticated' }); roster(); publish(); return;
      }
      if (!client || peers.get(client)?.socket !== socket) return;
      if (message.type === 'ping') { send(socket, { type:'pong' }); return; }
      if (message.type === 'executed') {
        const p = pending.get(message.request); if (p?.id === client) { clearTimeout(p.timer); pending.delete(message.request); message.error ? p.reject(new Error(message.error)) : p.resolve(message.state); } return;
      }
      if (message.type === 'publish') { if (client === owner) { music = message.state; publish(); } return; }
      serialize(async () => {
        if (message.type === 'join') {
          const mapping = {};
          if (!state.clients[client]) {
            const incoming = validateState(message.workspace);
            if (!state.workspace) state.workspace = incoming;
            else {
              const initial = validateState(defaults()); const cards = [...state.workspace.cards];
              for (const card of incoming.cards) {
                const existing = cards.find(c => c.id === card.id);
                if (!existing) cards.push(card);
                else if (JSON.stringify(existing) !== JSON.stringify(card) && JSON.stringify(initial.cards.find(c => c.id === card.id)) !== JSON.stringify(card)) {
                  const id = randomUUID(); mapping[card.id] = id; cards.push({ ...card, id });
                }
              }
              if (cards.length > 200) throw new Error('合并后超过 200 张卡片，请先备份并减少卡片。');
              state.workspace = validateState({ ...state.workspace, cards });
            }
            state.clients[client] = { seq:message.seq || 0, mapping }; state.revision++; await persist();
          }
          send(socket, { type:'reply', request:message.request, workspace:state.workspace, revision:state.revision, ack:state.clients[client].seq, mapping:message.mapped ? {} : state.clients[client].mapping || {} });
          broadcast({ type:'workspace', workspace:state.workspace, revision:state.revision }); return;
        }
        if (message.type === 'patch') {
          if (!state.clients[client]) throw new Error('请先连接同步空间。');
          const previous = state.clients[client].seq;
          if (message.seq > previous) {
            if (message.seq !== previous + 1) throw new Error('同步序列不连续，请重新连接。');
            const next = mergePatch(state.workspace, message.patch);
            state = { ...state, workspace:next, revision:state.revision + 1, clients:{ ...state.clients, [client]:{ ...state.clients[client], seq:message.seq } } }; await persist();
          }
          send(socket, { type:'reply', request:message.request, workspace:state.workspace, revision:state.revision, ack:state.clients[client].seq });
          broadcast({ type:'workspace', workspace:state.workspace, revision:state.revision }); return;
        }
        if (message.type === 'command') {
          let command = message.command;
          if (command.action === 'state') { send(socket, { type:'reply', request:message.request, state:{ ...music, owner, ownerName:peers.get(owner)?.name || '' } }); return; }
          if (!owner || command.action === 'takeover') {
            const oldOwner = owner;
            const previousMusic = music;
            if (oldOwner && oldOwner !== client) await execute(oldOwner, { action:'silence' });
            // Grant only after the old player confirms it stopped.
            owner = client;
            if (command.action === 'takeover') command = { ...command, action:'play', ...(command.cardId === previousMusic.cardId ? { trackId:previousMusic.trackId, currentTime:previousMusic.currentTime } : {}) };
          }
          music = await execute(owner, command); publish();
          send(socket, { type:'reply', request:message.request, state:{ ...music, owner, ownerName:peers.get(owner)?.name || '' } }); return;
        }
        throw new Error('Unknown sync operation');
      }).catch(error => send(socket, { type:'reply', request:message.request, error:error.message }));
    });
    socket.on('close', () => {
      clearTimeout(authTimer);
      if (peers.get(client)?.socket !== socket) return;
      peers.delete(client);
      for (const [key, p] of pending) if (p.id === client) { clearTimeout(p.timer); pending.delete(key); p.reject(new Error('播放浏览器已断开。')); }
      // Keep the owner identity while disconnected: a new player cannot start without a stop acknowledgement.
      if (owner === client) {
        music = { ...music, paused:true, stopped:true }; publish();
        // The offscreen engine expires its playback lease after eight seconds without a pong.
        setTimeout(() => { if (owner === client && !peers.has(client)) { owner = ''; publish(); } }, 12000).unref();
      }
      roster();
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { port:server.address().port, token, directory, close:async () => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('Service stopped')); } pending.clear(); for (const s of wss.clients) s.terminate(); await new Promise(resolve => server.close(resolve)); } };
}
