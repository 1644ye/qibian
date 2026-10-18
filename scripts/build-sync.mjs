import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const version = JSON.parse(await readFile('manifest.json', 'utf8')).version;
const output = resolve('dist', `qibian-sync-${version}`);
await mkdir(output, { recursive:true });
await build({ entryPoints:['companion/main.mjs'], outfile:resolve(output, 'server.cjs'), bundle:true, platform:'node', target:'node20', format:'cjs', minify:true, legalComments:'eof', external:['bufferutil', 'utf-8-validate'] });
for (const name of ['start.ps1', 'start.cmd', 'install-autostart.ps1', 'remove-autostart.ps1', 'README.md']) {
  if (name.endsWith('.ps1')) await writeFile(resolve(output, name), '\ufeff' + await readFile(resolve('companion', name), 'utf8'));
  else await copyFile(resolve('companion', name), resolve(output, name));
}
await copyFile('node_modules/ws/LICENSE', resolve(output, 'ws-LICENSE.txt'));
console.log(output);
