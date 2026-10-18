import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { WebSocket } from 'ws';
import { defaults } from '../core.js';

if (process.platform !== 'win32') throw new Error('The portable runtime smoke test requires Windows x64.');
const version = JSON.parse(await readFile('manifest.json', 'utf8')).version;
const built = resolve(process.env.QIBIAN_SYNC_ROOT || `dist/qibian-sync-${version}`);
const temporary = await mkdtemp(resolve('artifacts', 'portable-release-'));
const extracted = join(temporary, '解压后的 栖边同步');
const archive = process.env.QIBIAN_SYNC_ARCHIVE ? resolve(process.env.QIBIAN_SYNC_ARCHIVE) : join(temporary, 'portable.zip');
const powershell = join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const zipScript = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
if ($env:QIBIAN_SMOKE_CREATE -eq '1') { [IO.Compression.ZipFile]::CreateFromDirectory($env:QIBIAN_SMOKE_BUILT, $env:QIBIAN_SMOKE_ARCHIVE) }
[IO.Compression.ZipFile]::ExtractToDirectory($env:QIBIAN_SMOKE_ARCHIVE, $env:QIBIAN_SMOKE_EXTRACTED)
`;
execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', zipScript], {
  env:{ ...process.env, QIBIAN_SMOKE_CREATE:process.env.QIBIAN_SYNC_ARCHIVE ? '0' : '1', QIBIAN_SMOKE_BUILT:built, QIBIAN_SMOKE_ARCHIVE:archive, QIBIAN_SMOKE_EXTRACTED:extracted }, windowsHide:true
});
for (const filename of ['server.cjs', 'start.cmd', 'start.ps1', 'runtime/node.exe', 'runtime/LICENSE', 'runtime-provenance.json', 'ws-LICENSE.txt', 'THIRD-PARTY-NOTICES.txt']) assert.ok((await stat(join(extracted, filename))).size > 0, filename);
for (const filename of ['start.ps1', 'install-autostart.ps1', 'remove-autostart.ps1']) assert.equal((await readFile(join(extracted, filename))).subarray(0, 3).toString('hex'), 'efbbbf', `${filename} must support Windows PowerShell 5.1 UTF-8`);
const data = join(temporary, 'test-user-data');
async function start() {
  const child = spawn(powershell, ['-NoProfile', '-NonInteractive', '-Command', '& $env:QIBIAN_SMOKE_START'], {
    cwd:temporary, windowsHide:true,
    env:{ ...process.env, PATH:[join(process.env.SystemRoot, 'System32'), join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0')].join(';'), QIBIAN_SMOKE_START:join(extracted, 'start.cmd'), QIBIAN_SYNC_DATA:data, QIBIAN_SYNC_PORT:'0' }, stdio:['ignore', 'pipe', 'pipe']
  });
  let buffer = '';
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Packaged helper startup timed out')), 15000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Packaged helper exited before startup: ${code}`)); });
    child.stdout.on('data', chunk => { buffer += chunk.toString(); const match = buffer.match(/127\.0\.0\.1:(\d+)/); if (match) { clearTimeout(timer); resolve(Number(match[1])); } });
    child.stderr.on('data', () => {});
  });
  return { port, child, token:(await readFile(join(data, 'pairing-key.txt'), 'utf8')).trim() };
}
async function stop(service) {
  if (service?.child.exitCode === null) {
    execFileSync(join(process.env.SystemRoot, 'System32', 'taskkill.exe'), ['/PID', String(service.child.pid), '/T', '/F'], { windowsHide:true, stdio:'pipe' });
    await new Promise(resolve => service.child.exitCode !== null ? resolve() : service.child.once('exit', resolve));
  }
}
async function connect(service) {
  const socket = new WebSocket(`ws://127.0.0.1:${service.port}/sync`, { origin:'chrome-extension://abcdefghijklmnopabcdefghijklmnop' });
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  const pending = new Map();
  socket.on('message', raw => { const reply = JSON.parse(raw); if (reply.type === 'reply') { const handler = pending.get(reply.request); if (handler) { pending.delete(reply.request); reply.error ? handler.reject(new Error(reply.error)) : handler.resolve(reply); } } });
  const authenticated = new Promise((resolve, reject) => { socket.once('message', raw => JSON.parse(raw).type === 'authenticated' ? resolve() : reject(new Error('Packaged service authentication failed'))); });
  socket.send(JSON.stringify({ type:'hello', clientId:'portable-release-test', name:'Portable release smoke test', token:service.token }));
  await authenticated;
  return { socket, rpc(message) { return new Promise((resolve, reject) => { const request = crypto.randomUUID(); pending.set(request, { resolve, reject }); socket.send(JSON.stringify({ ...message, request })); }); } };
}
let service, peer;
try {
  service = await start(); peer = await connect(service);
  const state = defaults(); state.cards[0].text = '便携包解压启动、中文目录、持久化测试';
  await peer.rpc({ type:'join', workspace:state, seq:0 });
  const binary = Buffer.alloc(2 * 1024 * 1024, 123);
  assert.equal((await fetch(`http://127.0.0.1:${service.port}/files/portable-file`, { method:'PUT', headers:{ Authorization:`Bearer ${service.token}` }, body:binary })).status, 201);
  const oldToken = service.token;
  peer.socket.close(); await stop(service); service = await start(); peer = await connect(service);
  assert.equal(service.token, oldToken, 'pairing key survives restart');
  const resumed = await peer.rpc({ type:'join', workspace:defaults(), seq:0 });
  assert.equal(resumed.workspace.cards[0].text, state.cards[0].text, 'workspace survives restart');
  const response = await fetch(`http://127.0.0.1:${service.port}/files/portable-file`, { headers:{ Authorization:`Bearer ${service.token}` } });
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), binary, 'imported binary survives restart');
  console.log(JSON.stringify({ ok:true, version, extracted, runtime:execFileSync(join(extracted, 'runtime/node.exe'), ['--version'], { encoding:'utf8', windowsHide:true }).trim(), checks:['actual ZIP extraction and start.cmd launcher', 'Chinese directory with spaces', 'no installed Node in PATH', 'PowerShell 5.1 UTF-8 scripts', 'paired WebSocket', 'workspace and binary save/reload', 'pairing key persistence'] }, null, 2));
} finally { peer?.socket.close(); await stop(service); }
