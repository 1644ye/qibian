import { resolve } from 'node:path';
import { loadChromium, edgeLaunchOptions, chromeLaunchOptions } from './browser-runtime.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { startTestService } from './sync-runtime.mjs';
import { defaults, validateState } from '../core.js';
const chromium = await loadChromium();
const root = resolve(process.env.QIBIAN_EXTENSION_ROOT || '.');
const directory = resolve('artifacts', 'sync-' + Date.now()); await mkdir(directory, { recursive:true });
await mkdir(resolve(directory, 'service'), { recursive:true });
let service = await startTestService({ directory:resolve(directory, 'service'), port:0 });
const contexts = [], errors = [], passed = [];
function record(name) { passed.push(name); console.log('PASS', name); }
async function wait(predicate, label, timeout = 25000) { const until = Date.now() + timeout; while (Date.now() < until) { if (await predicate()) return; await new Promise(r => setTimeout(r, 100)); } throw new Error('Timed out: ' + label); }
function wav(seconds) { const b = Buffer.alloc(44 + 8000 * seconds * 2); b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(b.length - 44, 40); for (let i = 44; i < b.length; i += 2) b.writeInt16LE(Math.round(300 * Math.sin(i * .3)), i); return b; }
async function browser(name, options, debugLoad = false) {
  const context = await chromium.launchPersistentContext(resolve(directory, name), { ...options, headless:true, ignoreDefaultArgs:['--disable-extensions'], viewport:{ width:1100, height:900 }, args:[...(debugLoad ? [] : [`--disable-extensions-except=${root}`, `--load-extension=${root}`]), '--autoplay-policy=no-user-gesture-required', '--enable-unsafe-extension-debugging'] });
  contexts.push(context);
  let loadedId;
  if (debugLoad) {
    const session = await context.browser().newBrowserCDPSession();
    loadedId = (await session.send('Extensions.loadUnpacked', { path:root })).id;
  }
  let worker = context.serviceWorkers()[0];
  if (!worker && !loadedId) worker = await context.waitForEvent('serviceworker', { timeout:15000 });
  const origin = loadedId ? `chrome-extension://${loadedId}` : worker.url().split('/').slice(0, 3).join('/');
  const page = await context.newPage(); page.on('pageerror', e => errors.push(`${name}: ${e.message}`)); await page.goto(origin + '/music.html?card=media');
  await page.locator('.card[data-id="media"]').waitFor();
  await page.evaluate(() => chrome.runtime.sendMessage({ type:'music:workspace' }));
  worker ||= context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout:15000 });
  const read = key => worker.evaluate(async key => (await chrome.storage.local.get(key))[key], key);
  const command = (action, extra = {}) => page.evaluate(message => chrome.runtime.sendMessage(message), { type:'music:command', cardId:'media', action, ...extra });
  const configure = async () => {
    await page.getByRole('button', { name:'外观与设置', exact:true }).click();
    await page.locator('.sync-settings summary').click();
    await page.locator('[name="sync-token"]').fill(service.token);
    await page.locator('[name="sync-port"]').fill(String(service.port));
    await page.getByRole('button', { name:'连接并自动同步', exact:true }).click();
    await wait(async () => (await read('syncStatus'))?.connected, name + ' connected');
    await page.locator('#settings .close-dialog').click();
    await page.getByRole('button', { name:'在此浏览器播放', exact:true }).waitFor();
  };
  return { context, worker, page, read, command, configure, origin };
}
try {
  const edge = await browser('Microsoft Edge', edgeLaunchOptions());
  const chrome = await browser('Google Chrome', await chromeLaunchOptions(), true);
  record('Real Edge and Google Chrome load the extension');
  await edge.page.getByRole('button', { name:'选择音乐', exact:true }).click();
  const track = wav(120);
  await edge.page.locator('#media-file').setInputFiles([{ name:'同步音乐.wav', mimeType:'audio/wav', buffer:track }]);
  await edge.page.locator('.playlist li').waitFor();
  await edge.configure(); await chrome.configure();
  await chrome.page.locator('.playlist li').waitFor();
  const workspace = await chrome.read('workspace'); const trackId = workspace.cards.find(c => c.id === 'media').tracks[0].fileId;
  const file = await chrome.page.evaluate(async id => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('qibian-files', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const file = await new Promise(resolve => { const r = db.transaction('files').objectStore('files').get(id); r.onsuccess = () => resolve(r.result); });
    return { size:file.size, type:file.type, name:file.name, hash:[...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))] };
  }, trackId);
  assert.equal(file.size, track.length); assert.equal(file.type, 'audio/wav'); assert.equal(file.name, '同步音乐.wav');
  assert.deepEqual(file.hash, [...new Uint8Array(await crypto.subtle.digest('SHA-256', track))]);
  record('Imported binary music arrives automatically in Chrome, byte-for-byte identical');
  // Exercise the settings UI so bundled builds use the exact production store path.
  await edge.page.getByRole('button', { name:'外观与设置', exact:true }).click();
  await edge.page.locator('[name="palettePreset"]').selectOption('ocean');
  await wait(async () => (await chrome.read('workspace')).settings.palettePreset === 'ocean', 'live settings');
  await edge.page.locator('#settings .close-dialog').click();
  record('Edge setting changes reach Chrome without reloading');
  await chrome.page.getByRole('button', { name:'添加音乐', exact:true }).click();
  await chrome.page.locator('#media-file').setInputFiles([{ name:'第二首.wav', mimeType:'audio/wav', buffer:wav(8) }]);
  await wait(async () => (await edge.read('workspace')).cards.find(c => c.id === 'media').tracks.length === 2, 'live playlist import');
  await chrome.page.getByLabel('播放顺序', { exact:true }).selectOption('repeat-all');
  await wait(async () => (await edge.read('workspace')).cards.find(c => c.id === 'media').playMode === 'repeat-all', 'playlist order');
  record('Songs added in Chrome and playlist playback order synchronize back to Edge');
  const edgePanel = await edge.context.newPage(), chromePanel = await chrome.context.newPage();
  for (const [panel, b] of [[edgePanel, edge], [chromePanel, chrome]]) { panel.on('pageerror', e => errors.push(e.message)); await panel.goto(b.origin + '/sidepanel.html'); await panel.locator('.card').first().waitFor(); }
  await edgePanel.getByRole('button', { name:/添加内容/ }).click();
  await edgePanel.locator('#type-picker').getByRole('button', { name:/文件/ }).click();
  await edgePanel.getByLabel('卡片名称', { exact:true }).fill('同步图片');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=', 'base64');
  await edgePanel.getByLabel('选择本地文件', { exact:true }).setInputFiles({ name:'测试.png', mimeType:'image/png', buffer:png });
  await edgePanel.locator('#submit-card').click(); await edgePanel.locator('#editor').waitFor({ state:'hidden' });
  const remoteFile = chromePanel.locator('.card').filter({ has:chromePanel.getByRole('heading', { name:'同步图片', exact:true }) });
  await remoteFile.getByRole('button', { name:'预览', exact:true }).click();
  await chromePanel.locator('#preview img').waitFor();
  assert.equal(await chromePanel.locator('#preview img').evaluate(img => img.complete && img.naturalWidth === 1), true);
  await chromePanel.locator('#preview .close-dialog').click();
  await remoteFile.getByRole('button', { name:'复制 同步图片', exact:true }).click();
  await wait(async () => (await edge.read('workspace')).cards.some(c => c.title === '同步图片 副本'), 'copied file card');
  await chromePanel.locator('#arrange').click(); chromePanel.once('dialog', dialog => dialog.accept());
  await remoteFile.getByRole('button', { name:'删除', exact:true }).click();
  await wait(async () => !(await edge.read('workspace')).cards.some(c => c.title === '同步图片'), 'remote deletion');
  assert.ok((await edge.read('workspace')).cards.some(c => c.title === '同步图片 副本'));
  record('Image files preserve preview type; card copy and deletion synchronize in both directions');
  await edgePanel.close(); await chromePanel.close();
  let result = await chrome.command('play'); assert.notEqual(result.ok, false, result.error);
  await wait(async () => (await edge.worker.evaluate(async () => (await chrome.storage.session.get('musicState')).musicState))?.paused === false, 'remote playing state');
  assert.match(await edge.page.locator('.music-status').textContent(), /Google Chrome/);
  result = await edge.command('toggle-stop'); assert.notEqual(result.ok, false, result.error);
  const raw = b => b.worker.evaluate(() => chrome.runtime.sendMessage({ type:'music:engine', action:'state' })).catch(() => null);
  assert.equal((await raw(chrome)).paused, true); assert.equal((await raw(chrome)).stopped, true);
  record('Chrome plays; Edge shows its state and stops Chrome');
  await chrome.command('play');
  result = await edge.command('takeover'); assert.notEqual(result.ok, false, result.error);
  assert.equal((await raw(chrome)).paused, true); assert.equal((await raw(edge)).paused, false);
  await new Promise(r => setTimeout(r, 10000));
  assert.equal((await raw(edge)).paused, false, 'owner heartbeats renew playback lease');
  record('Playback handover stops Chrome before Edge starts, and the lease stays alive');
  const port = service.port, token = service.token;
  await service.close();
  await wait(async () => (await raw(edge)).paused, 'playback stops after disconnection');
  await edge.page.getByRole('button', { name:'外观与设置', exact:true }).click();
  await edge.page.locator('[name="palettePreset"]').selectOption('sunset');
  await wait(async () => (await edge.read('syncOutbox'))?.length > 0, 'offline queued edit');
  service = await startTestService({ directory:resolve(directory, 'service'), port, token });
  await wait(async () => (await chrome.read('workspace')).settings.palettePreset === 'sunset', 'reconnected edit');
  await wait(async () => !(await edge.read('syncOutbox'))?.length, 'outbox acknowledged');
  record('Service interruption stops shared playback; offline edits replay after reconnect');
  await edge.page.locator('.sync-settings').evaluate(node => { node.open = true; });
  await edge.page.screenshot({ path:resolve(directory, 'sync-settings.png'), fullPage:true });
  await chrome.page.screenshot({ path:resolve(directory, 'chrome-music.png'), fullPage:true });
  assert.deepEqual(errors, []);
  await writeFile(resolve(directory, 'results.json'), JSON.stringify({ passed, errors }, null, 2));
  console.log(JSON.stringify({ passed, artifacts:directory }));
} finally { for (const c of contexts) await c.close(); await service.close(); }
