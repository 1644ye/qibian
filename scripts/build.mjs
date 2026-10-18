import { build, transform } from 'esbuild';
import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
const dist = resolve(root, 'dist');
const output = resolve(dist, `qibian-edge-${manifest.version}`);
// Only this generated version directory may be replaced, never the source tree.
if (!/^\d+\.\d+\.\d+$/.test(manifest.version) || dirname(output) !== dist) throw new Error('Invalid build destination');
const options = { absWorkingDir:root, minify:true, target:'chrome116', charset:'utf8', legalComments:'eof', write:false, logLevel:'warning' };
const modules = await build({ ...options, entryPoints:['app.js', 'service-worker.js', 'audio-engine.js'], bundle:true, splitting:true, format:'esm', chunkNames:'shared/[hash]', outdir:output, metafile:true });
const rail = await build({ ...options, entryPoints:['rail.js'], bundle:true, format:'iife', outfile:resolve(output, 'rail.js') });
const css = await transform((await readFile(resolve(root, 'styles.css'), 'utf8')) + '\n' + (await readFile(resolve(root, 'modern.css'), 'utf8')), { loader:'css', minify:true, target:'chrome116', legalComments:'eof' });
const files = new Map();
for (const item of [...modules.outputFiles, ...rail.outputFiles]) files.set(relative(output, item.path).split(sep).join('/'), item.contents);
files.set('styles.css', css.code);
for (const name of ['sidepanel.html', 'music.html', 'offscreen.html']) {
  const html = (await readFile(resolve(root, name), 'utf8')).replace('<link rel="stylesheet" href="modern.css">', '').replaceAll('\r\n', '\n');
  files.set(name, html);
}
for (const name of await readdir(resolve(root, 'icons'))) {
  if (Object.values(manifest.icons).includes(`icons/${name}`)) files.set(`icons/${name}`, await readFile(resolve(root, 'icons', name)));
}
// Only the app and its dependency chunks need to be reachable from web iframes.
const exposed = new Set(['sidepanel.html', 'styles.css']);
function expose(modulePath) {
  const name = relative(output, resolve(root, modulePath)).split(sep).join('/');
  if (exposed.has(name)) return;
  exposed.add(name);
  for (const dependency of modules.metafile.outputs[modulePath]?.imports || []) {
    if (dependency.external) throw new Error('Unexpected external runtime dependency');
    expose(dependency.path);
  }
}
expose(Object.keys(modules.metafile.outputs).find(name => modules.metafile.outputs[name].entryPoint === 'app.js'));
manifest.web_accessible_resources[0].resources = [...exposed].sort();
files.set('manifest.json', JSON.stringify(manifest));
files.set('README.md', await readFile(resolve(root, 'docs/EXTENSION-GUIDE.md'), 'utf8'));
for (const name of files.keys()) {
  if (name.startsWith('../') || !resolve(output, name).startsWith(output + sep)) throw new Error('Build file escaped destination');
}
await mkdir(dist, { recursive:true });
await rm(output, { recursive:true, force:true });
for (const [name, content] of files) {
  await mkdir(dirname(resolve(output, name)), { recursive:true });
  await writeFile(resolve(output, name), content);
}
const stats = { version:manifest.version, files:files.size, unpackedBytes:[...files.values()].reduce((sum, content) => sum + Buffer.byteLength(content), 0), output };
await writeFile(resolve(dist, `build-${manifest.version}.json`), JSON.stringify({ ...stats, entries:[...files].map(([name, content])=>({ name, bytes:Buffer.byteLength(content) })) }, null, 2));
console.log(JSON.stringify(stats));
