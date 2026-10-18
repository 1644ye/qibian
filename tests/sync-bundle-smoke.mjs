import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
const version = JSON.parse(await readFile('manifest.json', 'utf8')).version;
const directory = await mkdtemp(resolve('artifacts', 'sync-bundle-'));
const probe = createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
const child = spawn(process.execPath, [resolve('dist', `qibian-sync-${version}`, 'server.cjs')], { cwd:directory, env:{ ...process.env, QIBIAN_SYNC_DATA:directory, QIBIAN_SYNC_PORT:String(port) }, windowsHide:true, stdio:['ignore', 'pipe', 'pipe'] });
try {
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Bundled helper did not start')), 10000); child.stdout.once('data', () => { clearTimeout(timer); resolve(); }); child.once('exit', code => { clearTimeout(timer); reject(new Error('Helper exited: ' + code)); }); child.once('error', reject); });
  const token = (await readFile(resolve(directory, 'pairing-key.txt'), 'utf8')).trim(); assert.equal(token.length, 48);
  assert.equal((await fetch(`http://127.0.0.1:${port}/files/missing`)).status, 401);
  assert.equal((await fetch(`http://127.0.0.1:${port}/files/missing`, { headers:{ Authorization:`Bearer ${token}` } })).status, 404);
  console.log('PASS packaged standalone helper starts outside the project, creates its key, and authenticates HTTP requests');
} finally { child.kill(); }
