import { mkdtemp, readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startTestService } from './sync-runtime.mjs';
import assert from 'node:assert/strict';
const version = JSON.parse(await readFile('manifest.json', 'utf8')).version;
await mkdir('artifacts', { recursive:true });
const directory = await mkdtemp(resolve('artifacts', 'sync-bundle-'));
process.env.QIBIAN_SYNC_ROOT ||= resolve('dist', `qibian-sync-${version}`);
const service = await startTestService({ directory, port:0 });
try {
  assert.equal(service.token.length, 48);
  assert.equal((await fetch(`http://127.0.0.1:${service.port}/files/missing`)).status, 401);
  assert.equal((await fetch(`http://127.0.0.1:${service.port}/files/missing`, { headers:{ Authorization:`Bearer ${service.token}` } })).status, 404);
  console.log('PASS packaged standalone helper starts outside the project, creates its key, and authenticates HTTP requests');
} finally { await service.close(); }
