// Integration harness: node tests/browser.mjs <absolute path to playwright/index.mjs>
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { loadChromium, edgeLaunchOptions } from './browser-runtime.mjs';
import assert from 'node:assert/strict';
import { defaults } from '../core.js';

const chromium = await loadChromium(process.argv[2]);
const root = resolve(process.env.QIBIAN_EXTENSION_ROOT || '.');
await mkdir('artifacts', { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const name = req.url === '/' ? 'sidepanel.html' : req.url.slice(1).split('?')[0];
    if (name.includes('..')) throw Error('Invalid path');
    const body = await readFile(resolve(root, name));
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[extname(name)] || 'application/octet-stream'); res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let context;
try {
  context = await chromium.launchPersistentContext('', { ...edgeLaunchOptions(), headless: true, viewport: { width: 390, height: 1000 }, args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`] });
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 8000 }).catch(() => null);
  const base = worker ? `chrome-extension://${new URL(worker.url()).host}` : origin;
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '/sidepanel.html');
  await page.locator('.card').nth(2).waitFor();
  assert.equal(await page.locator('.card').count(), 3);
  await page.getByRole('button', { name: /添加内容/ }).click();
  await page.getByLabel('卡片名称').fill('测试网站');
  await page.getByLabel('网站地址', { exact: true }).fill('https://example.com');
  await page.getByRole('button', { name: '添加到空间', exact: true }).click();
  await page.locator('#editor').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.card').count(), 4);
  await page.reload(); await page.getByRole('heading', { name: '测试网站' }).waitFor();
  await page.getByRole('button', { name: '⇅ 整理' }).click();
  await page.locator('.card').last().getByRole('button', { name: '上移', exact: true }).click();
  assert.equal(await page.locator('.card').nth(2).locator('h2').textContent(), '测试网站');
  await page.setViewportSize({ width: 390, height: 1800 });
  await page.locator('.card').filter({ has: page.getByRole('heading', { name: '测试网站' }) }).locator('.drag-handle').dragTo(page.locator('.card').first().locator('.card-head'));
  await page.waitForFunction(() => document.querySelector('.card h2')?.textContent === '测试网站');
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.getByRole('button', { name: '✓ 完成' }).click();
  await page.locator('.note').fill('持久化测试 <script>alert(1)</script>');
  await page.reload(); await page.locator('.note').waitFor(); assert.equal(await page.locator('.note').inputValue(), '持久化测试 <script>alert(1)</script>');
  await page.getByRole('button', { name: '外观与设置', exact: true }).click();
  await page.getByLabel('显示主题').selectOption('dark');
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  await page.reload(); await page.locator('body[data-theme=dark]').waitFor();
  await page.getByRole('button', { name: /添加内容/ }).click();
  await page.locator('#type-picker').getByRole('button', { name: '文件', exact: false }).click();
  await page.getByLabel('卡片名称').fill('测试文件');
  await page.getByLabel('选择本地文件').setInputFiles({ name: 'hello.txt', mimeType: 'text/plain', buffer: Buffer.from('你好，栖边。<script>safe</script>') });
  await page.getByRole('button', { name: '添加到空间', exact: true }).click(); await page.locator('#editor').waitFor({ state: 'hidden' });
  await page.reload(); await page.getByRole('button', { name: '预览', exact: true }).click();
  await page.locator('#preview pre').waitFor(); assert.equal(await page.locator('#preview pre').textContent(), '你好，栖边。<script>safe</script>');
  await page.locator('#preview').getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '外观与设置', exact: true }).click();
  await page.getByLabel('显示主题').selectOption('light'); await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  await page.screenshot({ path: 'artifacts/sidebar.png', fullPage: true });
  await page.setViewportSize({ width: 300, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.setViewportSize({ width: 800, height: 900 });
  await page.getByRole('button', { name: '外观与设置', exact: true }).click(); await page.getByLabel('布局').selectOption('2'); await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  assert.equal(await page.locator('#cards').evaluate(n => getComputedStyle(n).gridTemplateColumns.split(' ').length), 2);
  if (worker) {
    const behavior = await worker.evaluate(() => chrome.sidePanel.getPanelBehavior()); assert.equal(behavior.openPanelOnActionClick, false);
  }
  const fixture = defaults();
  fixture.cards = [
    { id: 'weather', type: 'weather', title: '上海天气', city: '上海', latitude: 31.23, longitude: 121.47, color: 'sand', height: 220 },
    { id: 'feed', type: 'feed', title: '测试订阅', url: 'https://fixture.test/feed', color: 'plain', height: 220 }
  ];
  const preview = await context.newPage(); preview.on('pageerror', e => errors.push(e.message));
  await preview.addInitScript(s => localStorage.setItem('qibian', JSON.stringify(s)), fixture);
  await preview.route('https://api.open-meteo.com/**', route => route.fulfill({ json: { current: { temperature_2m: 23, apparent_temperature: 24, relative_humidity_2m: 61, weather_code: 0 } } }));
  await preview.route('https://fixture.test/feed', route => route.fulfill({ contentType: 'text/xml', body: '<rss version="2.0"><channel><item><title>安全文章</title><link>https://example.com/article</link></item><item><title>恶意链接</title><link>javascript:alert(1)</link></item><item><title>&lt;img src=x onerror=alert(1)&gt;</title><link>https://example.com/safe</link></item></channel></rss>' }));
  await preview.goto(origin + '/sidepanel.html'); await preview.getByText('23°', { exact: true }).waitFor(); await preview.getByText('安全文章', { exact: true }).waitFor();
  assert.equal(await preview.locator('.feed-list a').count(), 2); assert.equal(await preview.locator('.feed-list img').count(), 0);
  assert.equal(await preview.getByText('恶意链接', { exact: true }).count(), 0);
  await preview.route('https://fixture.test/feed', route => route.fulfill({ status: 503, body: 'Unavailable' }));
  await preview.locator('.card').last().getByRole('button', { name: '授权并刷新' }).click(); await preview.getByText(/来源暂不可用（503）/).waitFor();
  await page.getByRole('button', { name: '外观与设置', exact: true }).click();
  const downloadEvent = page.waitForEvent('download'); await page.getByRole('button', { name: '导出配置', exact: true }).click(); const backup = await downloadEvent;
  assert.equal(JSON.parse(await readFile(await backup.path(), 'utf8')).cards.length, 5);
  page.once('dialog', d => d.accept());
  await page.locator('#import-file').setInputFiles({ name: 'restore.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(defaults())) });
  await page.locator('#settings').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.card').count(), 3);
  // A short PCM WAV verifies real decoding, playback, and persisted media files.
  const wav = Buffer.alloc(44 + 16000); wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(16000, 40);
  for (let i = 0; i < 8000; i++) wav.writeInt16LE(Math.round(Math.sin(i * Math.PI * 2 * 440 / 8000) * 2000), 44 + i * 2);
  await page.getByRole('button', { name: '选择音乐', exact: true }).click();
  await page.locator('#media-file').setInputFiles([
    { name: '第一首.wav', mimeType: 'audio/wav', buffer: wav },
    { name: '第二首.wav', mimeType: 'audio/wav', buffer: wav },
    { name: '第三首.wav', mimeType: 'audio/wav', buffer: wav }
  ]);
  await page.getByRole('button', { name: '添加音乐', exact: true }).waitFor();
  assert.equal(await page.locator('.playlist li').count(), 0);
  await page.getByLabel('播放顺序').selectOption('repeat-all');
  await page.reload(); await page.locator('.media-name').waitFor();
  assert.equal(await page.locator('.media-name').textContent(), '我的播放器');
  assert.equal(await page.getByLabel('播放顺序').inputValue(), 'repeat-all');
  const storedMedia = await page.evaluate(async () => (globalThis.chrome?.runtime?.id ? (await chrome.storage.local.get('workspace')).workspace : JSON.parse(localStorage.getItem('qibian'))).cards.find(c => c.type === 'media'));
  assert.deepEqual(storedMedia.tracks.map(t => t.filename), ['第一首.wav', '第二首.wav', '第三首.wav']);
  // Shared playback, track ordering and actual audio endings are covered in modern-browser.mjs.
  await page.locator('.card[data-id="media"]').screenshot({ path: 'artifacts/playlist.png' });
  page.once('dialog', d => d.accept());
  await page.getByRole('button', { name: '⇅ 整理' }).click();
  await page.locator('.card').last().getByRole('button', { name: '删除', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.card').length === 2);
  await page.getByRole('button', { name: '✓ 完成' }).click();
  await page.getByRole('button', { name: '外观与设置', exact: true }).click();
  page.once('dialog', d => d.accept());
  await page.locator('#import-file').setInputFiles({ name: 'restore.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(defaults())) });
  await page.locator('#settings').waitFor({ state: 'hidden' });
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.locator('#toast').waitFor({ state: 'hidden', timeout: 6000 });
  await page.screenshot({ path: 'artifacts/sidebar.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ mode: worker ? 'real-edge-extension' : 'web-preview', passed: ['startup', 'add-website', 'persistence', 'reorder-buttons-and-drag', 'note-text-safety', 'theme-persistence', 'file-indexeddb-preview', 'narrow-layout', 'two-columns', 'weather-fixture', 'rss-fixture-and-url-safety', 'network-failure', 'export-import', 'multi-select-playlist-reorder-mode-playback-persistence', 'delete-card', ...(worker ? ['sidePanel-behavior'] : [])], pageErrors: errors }, null, 2));
} finally { await context?.close(); await new Promise(resolve => server.close(resolve)); }
