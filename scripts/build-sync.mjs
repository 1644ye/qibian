import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { bundleNodeRuntime } from './node-runtime.mjs';
const version = JSON.parse(await readFile('manifest.json', 'utf8')).version;
const output = resolve('dist', `qibian-sync-${version}`);
if (!output.startsWith(resolve('dist') + sep) || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Unsafe sync output directory.');
await rm(output, { recursive:true, force:true });
await mkdir(output, { recursive:true });
await build({ entryPoints:['companion/main.mjs'], outfile:resolve(output, 'server.cjs'), bundle:true, platform:'node', target:'node20', format:'cjs', minify:true, legalComments:'eof', external:['bufferutil', 'utf-8-validate'] });
for (const name of ['start.ps1', 'start.cmd', 'install-autostart.ps1', 'remove-autostart.ps1', 'README.md']) {
  if (name.endsWith('.ps1')) await writeFile(resolve(output, name), '\ufeff' + (await readFile(resolve('companion', name), 'utf8')).replace(/^\ufeff/, ''));
  else await copyFile(resolve('companion', name), resolve(output, name));
}
await copyFile('node_modules/ws/LICENSE', resolve(output, 'ws-LICENSE.txt'));
await bundleNodeRuntime(output);
await writeFile(resolve(output, 'THIRD-PARTY-NOTICES.txt'), [
  'Qibian Windows x64 local synchronization helper',
  '',
  'Node.js 24.22.0 (official Windows x64 runtime)',
  'Source: https://nodejs.org/dist/v24.22.0/node-v24.22.0-win-x64.zip',
  'The complete Node.js license and bundled third-party notices are included in runtime/LICENSE.',
  'The official runtime is redistributed unchanged. See runtime-provenance.json for SHA-256 values.',
  '',
  'ws 8.21.3, Copyright (c) 2011 Einar Otto Stangvik and contributors',
  'License: MIT. The complete license is included in ws-LICENSE.txt.',
  'Optional native addons bufferutil and utf-8-validate are not included or required.',
  '',
  'No open-source license has been granted for Qibian project code in this repository.',
  'Third-party licenses above apply only to their respective components.',
  ''
].join('\n'));
console.log(output);
