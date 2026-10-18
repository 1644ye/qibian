import { resolve } from 'node:path';
import { loadChromium, edgeLaunchOptions } from './browser-runtime.mjs';
import { mkdir, writeFile, truncate } from 'node:fs/promises';
import assert from 'node:assert/strict';
const chromium = await loadChromium();
const root=resolve(process.env.QIBIAN_EXTENSION_ROOT || '.'), profile=resolve('artifacts','large-files-profile-'+Date.now()); await mkdir(profile,{recursive:true});
const file=resolve(profile,'large.wav'), size=51*1024*1024+44;
const header=Buffer.alloc(44); header.write('RIFF'); header.writeUInt32LE(size-8,4); header.write('WAVEfmt ',8); header.writeUInt32LE(16,16); header.writeUInt16LE(1,20); header.writeUInt16LE(1,22); header.writeUInt32LE(8000,24); header.writeUInt32LE(16000,28); header.writeUInt16LE(2,32); header.writeUInt16LE(16,34); header.write('data',36); header.writeUInt32LE(size-44,40);
await writeFile(file,header); await truncate(file,size);
const ctx=await chromium.launchPersistentContext(profile,{...edgeLaunchOptions(),headless:true,args:[`--disable-extensions-except=${root}`,`--load-extension=${root}`]});
try {
  const worker=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker'); const base=worker.url().split('/').slice(0,3).join('/');
  const page=await ctx.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message)); await page.goto(base+'/sidepanel.html');
  await page.getByRole('button',{name:'选择音乐',exact:true}).click(); await page.locator('#media-file').setInputFiles(file);
  await page.getByRole('button',{name:'添加音乐',exact:true}).waitFor();
  await page.getByRole('button',{name:'播放',exact:true}).click(); await page.getByText('正在播放',{exact:true}).waitFor();
  assert.equal(await page.locator('.local-play').textContent(),'Ⅱ');
  await page.locator('.card[data-id="media"]').screenshot({path:resolve('artifacts/playing-1.4.1.png')});
  await page.getByRole('button',{name:'暂停',exact:true}).click();
  await page.locator('#add-button').click(); await page.locator('#type-picker').getByRole('button',{name:'文件',exact:false}).click();
  await page.getByLabel('卡片名称').fill('大文件'); await page.getByLabel('选择本地文件',{exact:true}).setInputFiles(file); await page.locator('#submit-card').click();
  await page.locator('#editor').waitFor({state:'hidden'});
  const sizes=await page.evaluate(async()=>{
    const workspace=(await chrome.storage.local.get('workspace')).workspace;
    const ids=[workspace.cards.find(c=>c.type==='media').tracks[0].fileId,workspace.cards.find(c=>c.title==='大文件').fileId];
    const db=await new Promise(resolve=>{const r=indexedDB.open('qibian-files',1);r.onsuccess=()=>resolve(r.result);});
    return Promise.all(ids.map(id=>new Promise(resolve=>{const r=db.transaction('files').objectStore('files').get(id);r.onsuccess=()=>resolve(r.result.size);}))); });
  assert.deepEqual(sizes,[size,size]); assert.deepEqual(errors,[]);
  console.log('PASS 51 MiB music and file-card imports persist full size; large WAV decodes and plays; playing/pause icons switch');
} finally { await ctx.close(); }
