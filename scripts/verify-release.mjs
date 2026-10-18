import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, dirname, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';

const argument = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const extension = resolve(argument('--extension') || process.env.QIBIAN_EXTENSION_ROOT || '');
const sync = resolve(argument('--sync') || process.env.QIBIAN_SYNC_ROOT || '');
if (!argument('--extension') && !process.env.QIBIAN_EXTENSION_ROOT) throw new Error('Pass --extension with the extracted extension directory.');
if (!argument('--sync') && !process.env.QIBIAN_SYNC_ROOT) throw new Error('Pass --sync with the extracted Windows x64 helper directory.');
const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
if (argument('--version')) assert.equal(manifest.version, argument('--version'));
assert.equal(manifest.manifest_version, 3);
const checked = new Set();
const secretPatterns = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['API key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/],
  ['Google API key', /\bAIza[A-Za-z0-9_-]{35}\b/],
  ['credential literal', /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password|passwd)["']?\s*[:=]\s*["'][^"'\s`$<>{}]{8,}["']/i]
];
async function required(root, resource, source = root) {
  assert.ok(!resource.includes('://') && !resource.startsWith('/'), `Unexpected external runtime resource: ${resource}`);
  const file = resolve(dirname(source === root ? resolve(root, '_') : source), resource.split(/[?#]/)[0]);
  assert.ok(file.startsWith(root + sep), `Resource escapes the package: ${resource}`);
  assert.ok((await stat(file)).isFile(), `Missing runtime resource: ${resource}`);
  checked.add(file);
  return file;
}
for (const resource of [manifest.background.service_worker, manifest.side_panel.default_path, ...Object.values(manifest.icons)]) await required(extension, resource);
for (const content of manifest.content_scripts) for (const resource of [...(content.js || []), ...(content.css || [])]) await required(extension, resource);
for (const entry of manifest.web_accessible_resources) for (const resource of entry.resources) {
  assert.ok(!/[?*]/.test(resource), 'Release resources must name their bundled files explicitly.');
  await required(extension, resource);
}
async function walk(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes:true })) {
    const full = resolve(root, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full)); else files.push(full);
  }
  return files;
}
const extensionFiles = await walk(extension), syncFiles = await walk(sync);
for (const file of [...extensionFiles, ...syncFiles]) {
  const root = file.startsWith(extension + sep) ? extension : sync;
  const name = relative(root, file).replaceAll('\\', '/');
  assert.ok(!/(?:^|\/)(?:node_modules|\.git|\.env(?:\..*)?|pairing-key\.txt|workspace\.json|sync-data)(?:\/|$)/i.test(name), `Private or development data in package: ${name}`);
  if (!/\.(?:js|mjs|cjs|html|css|json|txt|md|ps1|cmd)$/i.test(name)) continue;
  const source = await readFile(file, 'utf8');
  assert.ok(!/[A-Z]:[\\/]Users[\\/]/i.test(source), `Personal absolute path in package: ${name}`);
  for (const [kind, pattern] of secretPatterns) assert.ok(!pattern.test(source), `Potential ${kind} in package: ${name}`);
  if (root === extension && name.endsWith('.html')) {
    for (const match of source.matchAll(/<(?:script|link|img)\b[^>]*?\b(?:src|href)=["']([^"']+)["']/g)) {
      if (/^(?:data:|https?:)/.test(match[1])) continue;
      await required(root, match[1], file);
    }
  }
  if (root === extension && name.endsWith('.js')) {
    for (const match of source.matchAll(/\b(?:import|export)\s*(?:(?:[^"'();]*?)\bfrom\s*)?["'](\.[^"']+)["']/g)) await required(root, match[1], file);
    for (const match of source.matchAll(/\bimport\(["'](\.[^"']+)["']\)/g)) await required(root, match[1], file);
  }
}
for (const name of ['start.cmd', 'start.ps1', 'server.cjs', 'README.md', 'ws-LICENSE.txt', 'THIRD-PARTY-NOTICES.txt', 'runtime/LICENSE', 'runtime-provenance.json']) await required(sync, name);
const runtime = await readFile(await required(sync, 'runtime/node.exe'));
assert.equal(runtime.toString('ascii', 0, 2), 'MZ', 'Bundled Node must be a Windows executable');
const pe = runtime.readUInt32LE(0x3c);
assert.equal(runtime.toString('ascii', pe, pe + 4), 'PE\0\0');
assert.equal(runtime.readUInt16LE(pe + 4), 0x8664, 'Bundled Node must target Windows x64');
assert.ok(runtime.length > 1024 * 1024);
const hash = createHash('sha256').update(runtime).digest('hex');
console.log(JSON.stringify({ version:manifest.version, extensionFiles:extensionFiles.length, helperFiles:syncFiles.length, runtimeResourcesChecked:checked.size, runtimeArchitecture:'windows-x64', nodeRuntimeSha256:hash, result:'PASS: extracted packages are self-contained; private paths and startup resources checked' }, null, 2));
