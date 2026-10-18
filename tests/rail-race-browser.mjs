import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { loadChromium, edgeLaunchOptions } from './browser-runtime.mjs';

const root = resolve(process.env.QIBIAN_EXTENSION_ROOT || '.');
const chromium = await loadChromium();
const context = await chromium.launchPersistentContext('', {
  ...edgeLaunchOptions(), headless:true,
  args:[`--disable-extensions-except=${root}`, `--load-extension=${root}`]
});
try {
  await context.route('https://fixture.test/**', route => route.fulfill({ contentType:'text/html', body:'<!doctype html><title>Rail state race</title>' }));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('https://fixture.test/race');
  const rail = page.locator('#qibian-mini-rail');
  await rail.getByRole('button', { name:'展开栖边', exact:true }).waitFor();
  const target = await worker.evaluate(async () => (await chrome.tabs.query({ url:'https://fixture.test/race' }))[0].id);
  await worker.evaluate(async tabId => {
    await chrome.scripting.executeScript({ target:{ tabId }, func:() => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      const timeout = globalThis.setTimeout.bind(globalThis);
      // Keep the controlled query pending even on a busy Windows CI runner.
      // The production 500ms fallback is tested by the lifecycle suite.
      globalThis.setTimeout = (callback, delay, ...args) => timeout(callback, delay === 500 ? 30000 : delay, ...args);
      globalThis.__qibianRestoreTimer = () => { globalThis.setTimeout = timeout; };
      chrome.runtime.sendMessage = (message, ...args) => message?.type === 'qibian:surface-state'
        ? new Promise(resolve => { globalThis.__qibianResolveSurface = resolve; })
        : send(message, ...args);
    } });
  }, target);
  await rail.getByRole('button', { name:'展开栖边', exact:true }).click();
  const pending = await worker.evaluate(async tabId => (await chrome.scripting.executeScript({ target:{ tabId }, func:() => typeof globalThis.__qibianResolveSurface === 'function' }))[0].result, target);
  assert.equal(pending, true, 'Expansion must really wait for the controlled surface query.');
  await worker.evaluate(tabId => chrome.tabs.sendMessage(tabId, { type:'qibian:rail-visibility', visible:true, nativeOpen:false }, { frameId:0 }), target);
  await worker.evaluate(async tabId => {
    await chrome.scripting.executeScript({ target:{ tabId }, func:() => { globalThis.__qibianResolveSurface({ nativeOpen:false }); globalThis.__qibianRestoreTimer(); } });
  }, target);
  await rail.locator('iframe.workspace-frame').waitFor({ timeout:5000 });
  await page.frameLocator('#qibian-mini-rail iframe.workspace-frame').locator('.shell').waitFor({ timeout:5000 });
  assert.equal(await rail.getAttribute('data-mode'), 'expanded');
  assert.deepEqual(errors, []);
  console.log('PASS duplicate native-closed notification cannot cancel a user expansion while surface-state is pending');
} finally { await context.close(); }
