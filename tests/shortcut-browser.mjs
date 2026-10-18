import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { defaults } from '../core.js';
const {chromium}=await import(pathToFileURL('C:/Users/yeb/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const root=resolve(process.env.QIBIAN_EXTENSION_ROOT || '.'),profile=resolve('artifacts','shortcut-profile-'+Date.now());await mkdir(profile,{recursive:true});
const context=await chromium.launchPersistentContext(profile,{channel:'msedge',headless:true,args:[`--disable-extensions-except=${root}`,`--load-extension=${root}`]});
const results=[];
try {
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const base=worker.url().split('/').slice(0,3).join('/');
 const fixture=defaults();fixture.cards.push({id:'site',type:'website',title:'测试网站',url:'https://fixture.test/destination',icon:'★',height:220},{id:'file',type:'file',title:'测试文件',fileId:'text-file',filename:'hello.txt',height:220});
 await worker.evaluate(workspace=>chrome.storage.local.set({workspace}),fixture);
 const app=await context.newPage();const errors=[];app.on('pageerror',e=>errors.push(e.message));await app.goto(base+'/sidepanel.html');
 await app.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('qibian-files',1);r.onsuccess=()=>resolve(r.result);});await new Promise(resolve=>{const tx=db.transaction('files','readwrite');tx.objectStore('files').put(new Blob(['文件预览内容'],{type:'text/plain'}),'text-file');tx.oncomplete=resolve;});});
 const size=44+8000*2*12,b=Buffer.alloc(size);b.write('RIFF');b.writeUInt32LE(size-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(size-44,40);for(let i=0;i<(size-44)/2;i++)b.writeInt16LE(Math.round(200*Math.sin(i*.2)),44+2*i);
 await app.getByRole('button',{name:'选择音乐',exact:true}).click();await app.locator('#media-file').setInputFiles({name:'test.wav',mimeType:'audio/wav',buffer:b});await app.getByRole('button',{name:'添加音乐',exact:true}).waitFor();
 await context.route('https://fixture.test/**',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><h1>测试网页</h1>'}));
 const web=await context.newPage();web.on('pageerror',e=>errors.push(e.message));await web.goto('https://fixture.test/main');const rail=web.locator('#qibian-mini-rail');const music=rail.locator('[data-card-id="media"]');
 await music.click();await app.waitForFunction(async()=>{const s=(await chrome.storage.session.get('musicState')).musicState;return s?.cardId==='media'&&!s.paused&&s.currentTime>.2;});
 await web.waitForFunction(()=>document.querySelector('#qibian-mini-rail').shadowRoot.querySelector('[data-card-id="media"]').textContent==='■');assert.equal(await rail.locator('iframe').count(),0);assert.equal(await rail.evaluate(n=>n.getBoundingClientRect().width),44);
 await music.click();await app.waitForFunction(async()=>{const s=(await chrome.storage.session.get('musicState')).musicState;return s?.stopped&&s.paused&&s.currentTime===0;});await web.waitForFunction(()=>document.querySelector('#qibian-mini-rail').shadowRoot.querySelector('[data-card-id="media"]').textContent==='▶');
 results.push('web mini music shortcut plays and stops/reset-to-zero without opening any workspace iframe');
 const opened=context.waitForEvent('page');await rail.locator('[data-card-id="site"]').click();const destination=await opened;await destination.waitForURL('https://fixture.test/destination');assert.equal(web.url(),'https://fixture.test/main');assert.equal(await rail.locator('iframe').count(),0);await destination.close();
 results.push('web mini website shortcut opens configured URL directly in a new tab');
 await rail.locator('[data-card-id="welcome"]').click();const quick=web.frameLocator('#qibian-mini-rail .quick-frame');await quick.locator('textarea.note').waitFor();assert.equal(await quick.locator('#cards .card').count(),1);assert.equal(await rail.evaluate(n=>n.dataset.mode),'mini');
 await quick.locator('textarea.note').fill('从小图标编辑便笺');await quick.getByRole('button',{name:'关闭组件',exact:true}).click();await rail.locator('.quick-frame').waitFor({state:'detached'});
 await app.waitForFunction(async()=> (await chrome.storage.local.get('workspace')).workspace.cards.find(c=>c.id==='welcome').text==='从小图标编辑便笺');
 await rail.locator('button[data-card-id="file"]').click();await quick.locator('#preview pre').waitFor();assert.equal(await quick.locator('#preview pre').textContent(),'文件预览内容');assert.equal(await rail.evaluate(n=>n.getBoundingClientRect().width),44);
 await rail.locator('button[data-card-id="file"]').click();await rail.locator('.quick-frame').waitFor({state:'detached'});
 results.push('note icon opens only that editable widget and file icon directly previews the file while staying mini');
 await app.locator('#mini-button').click();await app.locator('#compact-navigation').waitFor();const local=app.locator('.compact-card[data-card-id="media"]');await local.click();await app.waitForFunction(()=>document.querySelector('.compact-card[data-card-id="media"]').textContent==='■');assert.equal(await app.locator('.shell').isVisible(),false);await local.click();await app.waitForFunction(()=>document.querySelector('.compact-card[data-card-id="media"]').textContent==='▶');
 const newTab=context.waitForEvent('page');await app.locator('.compact-card[data-card-id="site"]').click();const site=await newTab;await site.waitForURL('https://fixture.test/destination');await site.close();assert.equal(await app.locator('.shell').isVisible(),false);
 results.push('standalone compact icons use the same direct website and play/stop behavior');
 // This function is serialized by executeScript. Test the actual bundled copy,
 // since minification must not introduce references to extension-only variables.
 await web.evaluate(async bytes=>{
   const audio=document.createElement('audio');audio.src=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:'audio/wav'}));audio.controls=true;document.body.append(audio);
   await new Promise((resolve,reject)=>{audio.onloadedmetadata=resolve;audio.onerror=reject;});
 },[...b]);
 const tabId=await worker.evaluate(async()=> (await chrome.tabs.query({url:'https://fixture.test/main'}))[0].id);
 await worker.evaluate(tabId=>chrome.storage.session.set({'remoteMediaTab:media':tabId}),tabId);
 await app.getByRole('button',{name:'展开完整模式',exact:true}).click();
 await app.locator('.remote-section summary').click();
 await app.getByRole('button',{name:'切换静音',exact:true}).click();await web.waitForFunction(()=>document.querySelector('audio').muted);
 await app.getByRole('button',{name:'前进 10 秒',exact:true}).click();await web.waitForFunction(()=>document.querySelector('audio').currentTime>=9.9);
 await app.getByRole('button',{name:'后退 10 秒',exact:true}).click();await web.waitForFunction(()=>document.querySelector('audio').currentTime<.2);
 await app.getByRole('button',{name:'播放或暂停网页媒体',exact:true}).click();await web.waitForFunction(()=>!document.querySelector('audio').paused);
 await app.getByRole('button',{name:'播放或暂停网页媒体',exact:true}).click();await web.waitForFunction(()=>document.querySelector('audio').paused);
 results.push('serialized webpage media controller still mutes, seeks, plays and pauses after bundling/minification');
 assert.deepEqual(errors,[]);console.log(results.join('\n'));
}finally{await context.close();}
