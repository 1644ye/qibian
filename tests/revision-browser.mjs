// Run: node tests/revision-browser.mjs <absolute path to playwright/index.mjs>
// Uses a fresh real Edge extension profile; all HTTP(S) traffic is fixture-routed.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { defaults } from '../core.js';

const runtime = process.argv[2] || 'C:/Users/yeb/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(runtime).href);
const root = resolve(process.env.QIBIAN_EXTENSION_ROOT || '.');
const passed = [];
const errors = [];
let context;

function record(name) { passed.push(name); console.log(`PASS ${name}`); }

try {
  context = await chromium.launchPersistentContext('', {
    channel: 'msedge', headless: true, viewport: { width: 420, height: 1100 },
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
  });
  await context.route(/^https?:\/\//, route => {
    const url = route.request().url();
    if (url.includes('api.open-meteo.com')) return route.fulfill({ json: { current: { temperature_2m: 23, apparent_temperature: 24, relative_humidity_2m: 61, weather_code: 0 } } });
    if (url.includes('/feed')) return route.fulfill({ contentType: 'text/xml', body: '<rss version="2.0"><channel><item><title>Fixture feed item</title><link>https://fixture.test/article</link></item></channel></rss>' });
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><h1>Local website fixture</h1></body></html>' });
  });
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 10000 });
  assert.ok(worker.url().startsWith('chrome-extension://'), 'A real Edge extension must load; no web-preview fallback');
  const base = `chrome-extension://${new URL(worker.url()).host}`;
  const fixture = defaults();
  fixture.cards.push(
    { id: 'weather-fixture', type: 'weather', title: '天气夹具', city: '上海', latitude: 31.23, longitude: 121.47, height: 220 },
    { id: 'feed-fixture', type: 'feed', title: '信息流夹具', url: 'https://fixture.test/feed', height: 220 }
  );
  await worker.evaluate(state => chrome.storage.local.set({ workspace: state }), fixture);
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(error.message));
  const card = title => page.locator('.card').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  const saved = () => worker.evaluate(async () => (await chrome.storage.local.get('workspace')).workspace);
  const reload = async () => { await page.reload(); await page.locator('.card').first().waitFor(); };
  const close = dialog => page.locator(dialog).getByRole('button', { name: '关闭', exact: true }).click();
  const add = async type => {
    await page.getByRole('button', { name: /添加内容/ }).click();
    if (type !== '网站') await page.locator('#type-picker').getByRole('button', { name: new RegExp(type) }).click();
  };
  const submit = async () => { await page.locator('#submit-card').click(); await page.locator('#editor').waitFor({ state: 'hidden' }); };
  const settings = () => page.getByRole('button', { name: '外观与设置', exact: true }).click();
  const imports = async () => { await settings(); await page.locator('#links-import-button').click(); await page.locator('#links-import').waitFor(); };
  await page.goto(base + '/sidepanel.html');
  await page.locator('.card').nth(4).waitFor();
  record('real-edge-extension-startup');

  await add('网站');
  await page.getByLabel('卡片名称', { exact: true }).fill('网站夹具');
  await page.getByLabel('网站地址', { exact: true }).fill('https://fixture.test/website');
  await page.getByLabel('网站图标（文字或表情）', { exact: true }).fill('🌲');
  await submit();
  assert.equal(await card('网站夹具').locator('.site-icon').textContent(), '🌲');
  await reload();
  assert.equal(await card('网站夹具').locator('.site-icon').textContent(), '🌲');
  await card('网站夹具').getByRole('button', { name: '编辑 网站夹具', exact: true }).click();
  assert.equal(await page.getByLabel('网站图标（文字或表情）', { exact: true }).inputValue(), '🌲');
  await page.getByLabel('网站图标（文字或表情）', { exact: true }).fill('QB');
  await submit();
  await reload();
  assert.equal(await card('网站夹具').locator('.site-icon').textContent(), 'QB');
  record('website-text-icon-add-edit-persistence');

  const imageDataURL = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 8; canvas.height = 8;
    const painter = canvas.getContext('2d'); painter.fillStyle = '#305080'; painter.fillRect(0, 0, 8, 8);
    return canvas.toDataURL('image/png');
  });
  await card('网站夹具').getByRole('button', { name: '编辑 网站夹具', exact: true }).click();
  await page.getByLabel('或上传图标图片', { exact: true }).setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: Buffer.from(imageDataURL.split(',')[1], 'base64') });
  await submit();
  await reload();
  assert.equal(await card('网站夹具').locator('.site-icon img').getAttribute('src'), imageDataURL);
  await page.waitForFunction(() => document.querySelector('.site-icon img')?.naturalWidth === 8);
  await card('网站夹具').getByRole('button', { name: '编辑 网站夹具', exact: true }).click();
  await submit();
  assert.equal(await card('网站夹具').locator('.site-icon img').getAttribute('src'), imageDataURL);
  record('website-image-icon-upload-persistence-preserved-on-edit');

  const positions = await card('网站夹具').evaluate(node => ({
    url: node.querySelector('.site-main small').getBoundingClientRect().bottom,
    buttons: [...node.querySelectorAll('.card-body > .button-row button')].map(button => button.getBoundingClientRect().top)
  }));
  assert.equal(positions.buttons.length, 2);
  assert.ok(positions.buttons.every(top => top >= positions.url), 'Both website actions must appear below the URL');
  await card('网站夹具').getByRole('button', { name: '在栖边中打开', exact: true }).click();
  await card('网站夹具').frameLocator('iframe').getByRole('heading', { name: 'Local website fixture' }).waitFor();
  assert.equal(await card('网站夹具').locator('iframe').getAttribute('src'), 'https://fixture.test/website');
  await card('网站夹具').getByRole('button', { name: '在栖边中打开', exact: true }).click();
  assert.equal(await card('网站夹具').locator('iframe').count(), 1);
  const tabOpened = context.waitForEvent('page');
  await card('网站夹具').getByRole('button', { name: '在网页中打开', exact: true }).click();
  const opened = await tabOpened;
  await opened.waitForURL('https://fixture.test/website');
  await opened.getByRole('heading', { name: 'Local website fixture' }).waitFor();
  await opened.close();
  await card('网站夹具').getByRole('button', { name: '关闭内嵌页面', exact: true }).click();
  assert.equal(await card('网站夹具').locator('iframe').count(), 0);
  record('website-both-opening-actions-and-iframe-close');

  await card('网站夹具').getByRole('button', { name: '复制 网站夹具', exact: true }).click();
  await card('网站夹具 副本').waitFor();
  let state = await saved();
  const originalWebsite = state.cards.find(item => item.title === '网站夹具');
  const websiteCopy = state.cards.find(item => item.title === '网站夹具 副本');
  assert.notEqual(originalWebsite.id, websiteCopy.id);
  assert.equal(originalWebsite.url, websiteCopy.url);
  assert.equal(originalWebsite.icon, websiteCopy.icon);
  assert.equal(state.cards.indexOf(websiteCopy), state.cards.indexOf(originalWebsite) + 1);
  record('website-copy-keeps-icon-url-and-neighbor-order');

  await add('文件');
  await page.getByLabel('卡片名称', { exact: true }).fill('文件夹具');
  const contents = '复制后删除原卡片，文件副本仍然可读。<script>window.importedScriptRan=true</script>';
  await page.getByLabel('选择本地文件', { exact: true }).setInputFiles({ name: 'fixture.txt', mimeType: 'text/plain', buffer: Buffer.from(contents) });
  await submit();
  await card('文件夹具').getByRole('button', { name: '复制 文件夹具', exact: true }).click();
  await card('文件夹具 副本').waitFor();
  state = await saved();
  assert.notEqual(state.cards.find(item => item.title === '文件夹具').id, state.cards.find(item => item.title === '文件夹具 副本').id);
  await page.locator('#arrange').click();
  page.once('dialog', dialog => dialog.accept());
  await card('文件夹具').getByRole('button', { name: '删除', exact: true }).click();
  await card('文件夹具').waitFor({ state: 'hidden' });
  await page.locator('#arrange').click();
  await reload();
  await card('文件夹具 副本').getByRole('button', { name: '预览', exact: true }).click();
  await page.locator('#preview pre').waitFor();
  assert.equal(await page.locator('#preview pre').textContent(), contents);
  assert.equal(await page.evaluate(() => Boolean(window.importedScriptRan)), false);
  await close('#preview');
  record('file-copy-survives-original-deletion-and-reload');

  await settings();
  const presetAccents = { forest: '#547665', ocean: '#277596', sunset: '#c35c39', lavender: '#755b9d', graphite: '#4d5963' };
  for (const [preset, accent] of Object.entries(presetAccents)) {
    await page.locator('#settings-form select[name=palettePreset]').selectOption(preset);
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()), accent);
    assert.equal(await page.locator('#scheme-swatch, .scheme-swatch').count(), 4);
  }
  await page.screenshot({ path: 'artifacts/color-presets.png' });
  record('five-global-color-presets');
  for (const radius of [0, 32, 12]) {
    await page.locator('#settings-form input[name=radius]').fill(String(radius));
    assert.equal(await page.locator('#settings').evaluate(node => getComputedStyle(node).borderTopLeftRadius), `${radius}px`);
    assert.ok((await page.locator('.card').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).borderTopLeftRadius))).every(value => value === `${radius}px`));
  }
  const palettes = {
    light: { background: '#eef1f5', surface: '#dde4ef', text: '#172234', muted: '#516074', line: '#94a2b8', accent: '#254b8a', onAccent: '#fff8e7' },
    dark: { background: '#111c2d', surface: '#223146', text: '#eef5fe', muted: '#a8bbcf', line: '#64788e', accent: '#91b4ea', onAccent: '#11263f' }
  };
  await page.locator('#settings-form select[name=palettePreset]').selectOption('custom');
  const variables = { background: '--bg', surface: '--surface', text: '--text', muted: '--muted', line: '--line', accent: '--accent', onAccent: '--on-accent' };
  for (const theme of ['light', 'dark']) {
    await page.locator('#settings-form select[name=theme]').selectOption(theme);
    for (const [key, value] of Object.entries(palettes[theme])) await page.locator(`[data-palette-key="${key}"]`).fill(value);
    const actual = await page.evaluate(vars => Object.fromEntries(Object.entries(vars).map(([key, variable]) => [key, getComputedStyle(document.documentElement).getPropertyValue(variable).trim()])), variables);
    assert.deepEqual(actual, palettes[theme]);
    const expectedSurface = await page.locator('[data-palette-key=surface]').evaluate(input => { const sample = document.createElement('div'); sample.style.color = input.value; document.body.append(sample); const rgb = getComputedStyle(sample).color; sample.remove(); return rgb; });
    assert.ok((await page.locator('.card').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).backgroundColor))).every(color => color === expectedSurface), `All seven card types must use the ${theme} surface color`);
    assert.equal(await page.locator('#settings').evaluate(node => getComputedStyle(node).backgroundColor), await page.locator('body').evaluate(node => getComputedStyle(node).backgroundColor));
  }
  await close('#settings');
  await reload();
  assert.equal(await page.locator('body').getAttribute('data-theme'), 'dark');
  state = await saved();
  assert.deepEqual(state.settings.palettes, palettes);
  assert.equal(state.settings.radius, 12);
  await settings();
  assert.equal(await page.locator('#settings').evaluate(node => getComputedStyle(node).borderTopLeftRadius), '12px');
  await close('#settings');
  await card('网站夹具').getByRole('button', { name: '编辑 网站夹具', exact: true }).click();
  assert.equal(await page.locator('#editor').evaluate(node => getComputedStyle(node).borderTopLeftRadius), '12px');
  assert.equal(await page.locator('#fields [name=color]').count(), 0);
  await close('#editor');
  for (const text of await page.locator('.media-controls .play').allTextContents()) assert.equal(text, '▶');
  record('global-radius-dialogs-all-card-colors-and-custom-palette-persistence');
  record('media-play-button-triangle-only');

  await imports();
  await page.locator('#onetab-text').fill('https://fixture.test/website | 已有网站\n\nhttps://fixture.test/import-one#part | 同名标题\nhttps://fixture.test/import-one#part | 重复\nhttps://fixture.test/import-two | 同名标题\njavascript:alert(1) | 不安全\n不是网址');
  await page.locator('#parse-onetab').click();
  assert.equal(await page.locator('#links-status').textContent(), '可导入 2 个网站；重复 2 个，无效 2 个，超出容量 0 个。');
  assert.equal(await page.locator('#links-preview li').count(), 2);
  await page.locator('#onetab-text').press('End');
  await page.locator('#onetab-text').press('Space');
  assert.equal(await page.locator('#apply-links').isDisabled(), true);
  await page.locator('#parse-onetab').click();
  await page.locator('#apply-links').click();
  await page.locator('#links-import').waitFor({ state: 'hidden' });
  state = await saved();
  assert.equal(state.cards.filter(item => item.title === '同名标题').length, 2);
  assert.ok(state.cards.some(item => item.url === 'https://fixture.test/import-one#part'));
  record('onetab-text-preview-counts-duplicate-titles-and-stale-preview-invalidation');

  await imports();
  const html = '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8"><TITLE>Bookmarks</TITLE><H1>Bookmarks</H1><DL><p><DT><H3>收藏夹栏</H3><DL><p><DT><A HREF="https://fixture.test/bookmark?a=1&amp;b=2">收藏 &amp; 分享</A><DT><H3>文件夹</H3><DL><p><DT><A HREF="https://fixture.test/import-one#part">已有</A><DT><A HREF="data:text/html,evil">不安全</A><DT><A HREF="https://fixture.test/bookmark-literal">&lt;img src=x onerror=window.importedScriptRan=true&gt;</A></DL><p></DL><p></DL><script>window.importedScriptRan=true</script>';
  await page.locator('#links-file').setInputFiles({ name: 'favorites.html', mimeType: 'text/html', buffer: Buffer.from(html) });
  await page.waitForFunction(() => document.querySelector('#links-status').textContent.startsWith('可导入 2 个网站'));
  assert.equal(await page.locator('#links-status').textContent(), '可导入 2 个网站；重复 1 个，无效 1 个，超出容量 0 个。');
  assert.equal(await page.locator('#links-preview strong').first().textContent(), '收藏 & 分享');
  assert.equal(await page.locator('#links-preview img').count(), 0);
  assert.equal(await page.evaluate(() => Boolean(window.importedScriptRan)), false);
  await page.locator('#apply-links').click();
  await page.locator('#links-import').waitFor({ state: 'hidden' });
  await reload();
  state = await saved();
  assert.ok(state.cards.some(item => item.url === 'https://fixture.test/bookmark?a=1&b=2' && item.title === '收藏 & 分享'));
  assert.equal(await page.locator('.card img:not(.site-icon img)').count(), 0);
  assert.equal(await page.evaluate(() => Boolean(window.importedScriptRan)), false);
  record('real-netscape-bookmarks-html-nesting-entities-url-safety-and-persistence');

  await page.setViewportSize({ width: 300, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await settings();
  assert.equal(await page.locator('#settings').evaluate(node => node.scrollWidth <= node.clientWidth), true);
  await close('#settings');
  record('narrow-sidebar-and-settings-layout');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ mode: 'real-edge-extension', passed, pageErrors: errors }, null, 2));
} finally {
  await context?.close();
}
