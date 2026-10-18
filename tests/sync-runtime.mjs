import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startServer } from '../companion/server.mjs';

// Setting QIBIAN_SYNC_ROOT exercises the extracted product and its bundled runtime.
export async function startTestService(options) {
  if (!process.env.QIBIAN_SYNC_ROOT) return startServer(options);
  const root = resolve(process.env.QIBIAN_SYNC_ROOT);
  let port = options.port;
  if (!port) {
    const probe = createServer();
    await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
    port = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
  }
  const child = spawn(resolve(root, 'runtime', 'node.exe'), [resolve(root, 'server.cjs')], {
    cwd:options.directory,
    env:{ ...process.env, QIBIAN_SYNC_DATA:options.directory, QIBIAN_SYNC_PORT:String(port) },
    windowsHide:true, stdio:['ignore', 'ignore', 'pipe']
  });
  let failure;
  child.once('error', error => { failure = error; });
  child.once('exit', code => { failure ||= new Error('Packaged helper exited before readiness: ' + code); });
  // Do not echo service output: it contains the local pairing key.
  child.stderr.resume();
  const close = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise(resolve => { child.once('exit', resolve); child.kill(); });
  };
  try {
    const until = Date.now() + 20000;
    while (Date.now() < until) {
      if (failure) throw failure;
      try {
        const token = (await readFile(resolve(options.directory, 'pairing-key.txt'), 'utf8')).trim();
        if (!/^[0-9a-f]{48}$/.test(token)) throw new Error('Invalid pairing key');
        const response = await fetch(`http://127.0.0.1:${port}/files/release-readiness`, { headers:{ Authorization:`Bearer ${token}` } });
        if (response.status === 404) return { directory:options.directory, port, token, close };
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Extracted Windows helper did not become ready.');
  } catch (error) { await close(); throw error; }
}
