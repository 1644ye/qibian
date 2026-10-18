import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';

export async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

// Only an official, checksum-pinned archive is accepted. Never reuse a developer's installed runtime.
export async function bundleNodeRuntime(output) {
  if (process.platform !== 'win32') throw new Error('Windows portable releases must be built on Windows.');
  const spec = JSON.parse(await readFile(new URL('./node-runtime.lock.json', import.meta.url), 'utf8'));
  if (spec.platform !== 'win32' || spec.arch !== 'x64' || !/^[a-f0-9]{64}$/.test(spec.sha256)) throw new Error('Invalid Node runtime lock file.');
  const cache = resolve('.cache', 'node-runtime');
  await mkdir(cache, { recursive:true });
  const archive = join(cache, spec.archive);
  let valid = false;
  try { valid = await sha256(archive) === spec.sha256; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!valid) {
    const temporary = `${archive}.download`;
    try {
      const response = await fetch(spec.url, { signal:AbortSignal.timeout(180000) });
      if (!response.ok || !response.body) throw new Error(`Node runtime download failed: HTTP ${response.status}`);
      await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));
      if (await sha256(temporary) !== spec.sha256) throw new Error('Node runtime archive SHA-256 mismatch; refusing to package it.');
      await rename(temporary, archive);
    } finally { await rm(temporary, { force:true }); }
  }
  const runtime = join(output, 'runtime');
  await mkdir(runtime, { recursive:true });
  const extract = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($env:QIBIAN_NODE_ARCHIVE)
try {
  foreach ($name in @('node.exe', 'LICENSE')) {
    $entry = $archive.GetEntry('node-v' + $env:QIBIAN_NODE_VERSION + '-win-x64/' + $name)
    if (!$entry) { throw ('Missing official runtime resource: ' + $name) }
    [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $env:QIBIAN_NODE_OUTPUT $name), $true)
  }
} finally { $archive.Dispose() }
`;
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', extract], {
    env:{ ...process.env, QIBIAN_NODE_ARCHIVE:archive, QIBIAN_NODE_VERSION:spec.version, QIBIAN_NODE_OUTPUT:runtime },
    windowsHide:true, stdio:'pipe'
  });
  const actualVersion = execFileSync(join(runtime, 'node.exe'), ['--version'], { encoding:'utf8', windowsHide:true }).trim();
  if (actualVersion !== `v${spec.version}`) throw new Error('Bundled Node runtime version mismatch.');
  const provenance = { ...spec, files:{ 'runtime/node.exe':await sha256(join(runtime, 'node.exe')), 'runtime/LICENSE':await sha256(join(runtime, 'LICENSE')) } };
  await writeFile(join(output, 'runtime-provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
  return provenance;
}
