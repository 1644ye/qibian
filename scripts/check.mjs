import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
if (manifest.version !== pkg.version) throw new Error('manifest.json and package.json versions differ');
if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error('Version must be X.Y.Z');
async function check(directory, recursive) {
  for (const entry of await readdir(directory, { withFileTypes:true })) {
    const path = resolve(directory, entry.name);
    if (recursive && entry.isDirectory()) await check(path, true);
    if (!entry.isFile() || !/\.(?:m?js)$/.test(entry.name)) continue;
    const result = spawnSync(process.execPath, ['--check', path], { stdio:'inherit', windowsHide:true });
    if (result.error) throw result.error;
    if (result.status) throw new Error(`Syntax check failed: ${entry.name}`);
  }
}
await check('.', false);
for (const directory of ['scripts', 'tests', 'companion']) await check(directory, true);
console.log(`PASS version ${pkg.version} and JavaScript syntax checks`);
