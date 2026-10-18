import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { WebSocket } from 'ws';
import { startServer } from '../companion/server.mjs';
import { defaults } from '../core.js';
const origin = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
await mkdir(resolve('artifacts'), { recursive:true });
async function peer(server, name, token = server.token) {
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}/sync`, { origin });
  const pending = new Map(), events = [];
  ws.on('message', raw => {
    const message = JSON.parse(raw); events.push(message);
    if (message.type === 'reply') { const item = pending.get(message.request); if (item) { pending.delete(message.request); message.error ? item.reject(new Error(message.error)) : item.resolve(message); } }
  });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const send = message => ws.send(JSON.stringify(message));
  send({ type:'hello', clientId:name, name, token });
  await new Promise((resolve, reject) => { ws.once('message', raw => JSON.parse(raw).type === 'authenticated' ? resolve() : reject(new Error('Not authenticated'))); ws.once('close', () => reject(new Error('Authentication rejected'))); });
  const rpc = message => new Promise((resolve, reject) => { const request = crypto.randomUUID(); pending.set(request, { resolve, reject }); send({ ...message, request }); });
  return { ws, send, rpc, events };
}
test('local service authenticates, streams binary files, merges and acknowledges idempotently across reconnects', async () => {
  const directory = await mkdtemp(resolve('artifacts', 'sync-unit-'));
  let server = await startServer({ directory, port:0 }); const peers = [];
  try {
    await assert.rejects(peer(server, 'invalid-client', 'wrong-key'), /rejected/);
    const base = `http://127.0.0.1:${server.port}/files/test-file`;
    assert.equal((await fetch(base)).status, 401);
    assert.equal((await fetch(base, { headers:{ Origin:'https://evil.example', Authorization:`Bearer ${server.token}` } })).status, 403);
    const body = Buffer.alloc(3 * 1024 * 1024, 171); const headers = { Authorization:`Bearer ${server.token}`, 'X-File-Type':'image/png' };
    assert.equal((await fetch(base, { method:'PUT', headers, body })).status, 201);
    const response = await fetch(base, { headers }); assert.equal(response.headers.get('X-File-Type'), 'image/png'); assert.deepEqual(Buffer.from(await response.arrayBuffer()), body);
    const a = await peer(server, 'edge-client'); peers.push(a); const b = await peer(server, 'chrome-client'); peers.push(b);
    const first = defaults(); first.cards[0].text = 'Edge 独有';
    await a.rpc({ type:'join', workspace:first, seq:0 });
    const second = defaults(); second.cards[0].text = 'Chrome 独有';
    const joined = await b.rpc({ type:'join', workspace:second, seq:0 });
    assert.equal(joined.workspace.cards.length, 4); assert.ok(joined.mapping.welcome); assert.equal(joined.workspace.cards.filter(c => c.type === 'note').length, 2);
    const retryJoin = await b.rpc({ type:'join', workspace:second, seq:0 }); assert.equal(retryJoin.mapping.welcome, joined.mapping.welcome, 'recover mapping if the first join reply was lost');
    const mappedJoin = await b.rpc({ type:'join', workspace:second, seq:0, mapped:true }); assert.deepEqual(mappedJoin.mapping, {});
    const patch = { settings:{ palettePreset:'ocean' }, cards:[{ id:'welcome', fields:{ text:'修改' } }], removed:[] };
    const changed = await a.rpc({ type:'patch', seq:1, patch }); assert.equal(changed.ack, 1);
    const duplicate = await a.rpc({ type:'patch', seq:1, patch }); assert.equal(duplicate.revision, changed.revision);
    await assert.rejects(a.rpc({ type:'patch', seq:3, patch }), /不连续/);
    const persisted = JSON.parse(await readFile(resolve(directory, 'workspace.json'), 'utf8')); assert.equal(persisted.workspace.cards[0].text, '修改');
    const token = server.token; for (const p of peers) p.ws.close(); await server.close(); server = await startServer({ directory, port:0 }); assert.equal(server.token, token);
    const returning = await peer(server, 'edge-client'); peers.push(returning);
    const resumed = await returning.rpc({ type:'join', workspace:defaults(), seq:0 }); assert.equal(resumed.ack, 1); assert.equal(resumed.workspace.settings.palettePreset, 'ocean');
  } finally { for (const p of peers) p.ws.close(); await server.close(); }
});
test('remote stop targets the owner; handover must await the old player acknowledgement', async () => {
  const directory = await mkdtemp(resolve('artifacts', 'sync-player-')); const server = await startServer({ directory, port:0 });
  const peers = [], calls = [];
  try {
    const edge = await peer(server, 'edge-player'); const chrome = await peer(server, 'chrome-player'); peers.push(edge, chrome);
    for (const p of peers) p.ws.on('message', raw => {
      const m = JSON.parse(raw); if (m.type !== 'execute') return;
      calls.push([p === edge ? 'edge' : 'chrome', m.command.action]);
      setTimeout(() => p.send({ type:'executed', request:m.request, state:{ cardId:'media', trackId:'track', paused:['toggle-stop', 'silence'].includes(m.command.action), currentTime:10 } }), m.command.action === 'silence' ? 100 : 0);
    });
    await chrome.rpc({ type:'command', command:{ action:'play', cardId:'media' } });
    await edge.rpc({ type:'command', command:{ action:'toggle-stop', cardId:'media' } });
    const result = await edge.rpc({ type:'command', command:{ action:'takeover', cardId:'media' } });
    assert.equal(result.state.owner, 'edge-player');
    assert.deepEqual(calls, [['chrome', 'play'], ['chrome', 'toggle-stop'], ['chrome', 'silence'], ['edge', 'play']]);
  } finally { for (const p of peers) p.ws.close(); await server.close(); }
});
