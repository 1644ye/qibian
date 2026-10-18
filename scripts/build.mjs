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
files.set('README.md', `# 栖边 ${manifest.version}\n\n这是已合并、压缩的 Edge 扩展安装包，不需要 Node.js 或联网安装依赖。\n\n首次安装：解压到固定文件夹，在 edge://extensions 开启开发人员模式，选择「加载解压缩的扩展」，选中含 manifest.json 的文件夹。\n\n更新：完整覆盖原扩展目录，再点击「重新加载」。保持原目录，不要卸载旧扩展，以保留卡片、文件和歌单。返回普通网页并刷新，点击工具栏栖边图标打开右侧边栏；向右按钮切换为小图标模式。\n\n网页图标栏需要网站访问权限。浏览器内部页面和禁止注入的站点可使用完整原生边栏。音乐管理页面、网站/文件/组件、导入、配色及播放控制功能均保留。\n\n可读源码、完整说明、测试和构建工具保留在开发项目内，不随安装包分发。\n`);
files.set('README.md', files.get('README.md') + '\n同机跨浏览器同步：Chrome 可在 chrome://extensions 加载同一份扩展。另行解压 qibian-sync-' + manifest.version + '.zip 并运行 start.cmd（需要 Node.js 20+）；将显示的密钥填写到各浏览器栖边设置的「跨浏览器同步 · 本机」。先连接主要内容所在浏览器，再连接其他浏览器。支持栖边卡片、设置、歌单、导入文件与共享音乐控制，不扫描网站媒体和未导入的本机文件。完整教程已集成到设置中。\n');
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
