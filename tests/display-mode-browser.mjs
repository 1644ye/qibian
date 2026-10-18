import { resolve } from 'node:path';
import { loadChromium, edgeLaunchOptions } from './browser-runtime.mjs';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const chromium=await loadChromium();
const root=resolve(process.env.QIBIAN_EXTENSION_ROOT || '.'), profile=resolve('artifacts','display-mode-profile-'+Date.now()); await mkdir(profile,{recursive:true});
const context=await chromium.launchPersistentContext(profile,{...edgeLaunchOptions(),headless:true,viewport:null,args:['--window-size=1400,900',`--disable-extensions-except=${root}`,`--load-extension=${root}`]});
const results=[];
try {
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'); const base=worker.url().split('/').slice(0,3).join('/');
  const page=await context.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message)); await page.goto(base+'/sidepanel.html');
  await page.locator('#cards .card').first().waitFor();
  const initialURL=page.url(); await page.locator('#mini-button').click();
  await page.locator('#compact-navigation').waitFor();
  assert.equal(page.isClosed(),false); assert.equal(page.url(),initialURL);
  assert.equal(await page.locator('#compact-navigation').isVisible(),true); assert.equal(await page.locator('.shell').isVisible(),false);
  assert.equal(await page.locator('.compact-card').count(),3);
  await page.screenshot({path:resolve('artifacts/in-panel-mini-1.4.2.png')});
  await page.getByRole('button',{name:'展开完整模式',exact:true}).click();
  assert.equal(await page.locator('.shell').isVisible(),true); assert.equal(await page.locator('.card[data-id="media"]').isVisible(),true);
  results.push('standalone header arrow switches to in-place icons and card shortcut restores full mode without closing page');
  if (process.argv.includes('--with-music')) {
    const b=Buffer.alloc(44+8000*2*120);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);
    for(let i=0;i<(b.length-44)/2;i++)b.writeInt16LE(Math.round(200*Math.sin(i*.2)),44+i*2);
    await page.getByRole('button',{name:'选择音乐',exact:true}).click();await page.locator('#media-file').setInputFiles({name:'native-background.wav',mimeType:'audio/wav',buffer:b});await page.getByRole('button',{name:'添加音乐',exact:true}).waitFor();
    await page.getByRole('button',{name:'播放',exact:true}).click();await page.getByText('正在播放',{exact:true}).waitFor();
  }
  const stalled=process.argv.includes('--stalled-page');let releaseResource;
  const resourceGate=new Promise(resolve=>{releaseResource=resolve;});
  await context.route('https://fixture.test/**',async r=>{
    if(r.request().url().endsWith('/stall.js')) { await resourceGate; await r.fulfill({contentType:'text/javascript',body:''}); }
    else await r.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><title>Fixture</title><p>网页可用宽度测试</p>'+(stalled?'<script src="/stall.js"></script>':'')});
  });
  const web=await context.newPage(); await web.goto('https://fixture.test/',{waitUntil:stalled?'commit':'load'});
  await web.locator('p').waitFor();
  if(stalled) {
    assert.equal(await web.evaluate(()=>document.readyState),'loading');
    await worker.evaluate(async()=>{
      const [tab]=await chrome.tabs.query({url:'https://fixture.test/*'});
      globalThis.defaultInjectionDone=false;
      chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>true}).then(()=>{globalThis.defaultInjectionDone=true;});
    });
  }
  const availableBefore = await web.evaluate(()=>innerWidth);
  let previousWorkspace;
  if(process.argv.includes('--exclusive-surfaces')) {
    await web.locator('#qibian-mini-rail').getByRole('button',{name:'展开栖边',exact:true}).click();
    const workspace=web.frameLocator('#qibian-mini-rail iframe.workspace-frame');
    await workspace.locator('textarea.note').fill('切换两种面板时保留我的便笺');
    await page.waitForFunction(async()=> (await chrome.storage.local.get('workspace')).workspace.cards.find(c=>c.id==='welcome').text==='切换两种面板时保留我的便笺');
    previousWorkspace=await web.locator('#qibian-mini-rail iframe.workspace-frame').elementHandle();
  }
  if(process.argv.includes('--return-to-web')) { await page.reload();await page.getByRole('button',{name:'返回网页并打开边栏',exact:true}).waitFor(); }
  // Exercise the same header button in a real native SIDE_PANEL context.
  await page.evaluate(async({disabled,returnToWeb})=>{
    const [targetTab]=await chrome.tabs.query({url:'https://fixture.test/*'});
    if(disabled) {await chrome.sidePanel.setOptions({enabled:false});await chrome.sidePanel.setOptions({tabId:targetTab.id,enabled:false});}
    if(returnToWeb) return;
    const {openNativeSidebar}=await import('./panel-launcher.js');
    const b=document.createElement('button');b.id='native-fixture';b.textContent='Open native fixture';
    b.onclick=()=>openNativeSidebar(chrome,targetTab).catch(error=>{b.dataset.error=error.message;});document.body.append(b);
  },{disabled:process.argv.includes('--disabled-launch'),returnToWeb:process.argv.includes('--return-to-web')});
  const tabsBeforeLaunch=await worker.evaluate(()=>chrome.tabs.query({}).then(tabs=>tabs.length));
  if(process.argv.includes('--return-to-web')) {
    await page.getByRole('button',{name:'返回网页并打开边栏',exact:true}).click();
    assert.equal((await worker.evaluate(()=>chrome.tabs.query({active:true,lastFocusedWindow:true})))[0].url,'https://fixture.test/');
    results.push('old standalone page return button activates the webpage and opens its sidebar');
  } else await page.locator('#native-fixture').click();
  await web.bringToFront();
  const cdp=await context.newCDPSession(page);
  const ownTarget=(await cdp.send('Target.getTargetInfo')).targetInfo.targetId;
  let target;
  for(let i=0;i<30;i++) { const targets=(await cdp.send('Target.getTargets')).targetInfos; target=targets.find(t=>t.url===locationURL(base) && t.targetId!==ownTarget); if(target)break; await new Promise(r=>setTimeout(r,100)); }
  assert.ok(target,'native SIDE_PANEL target opened');
  if(previousWorkspace) {
    await web.waitForFunction(()=>{const host=document.querySelector('#qibian-mini-rail');return host.dataset.mode==='mini'&&getComputedStyle(host).visibility==='hidden';});
    assert.equal(await previousWorkspace.evaluate(n=>n.isConnected&&n.hidden),true);
    results.push('opening native sidebar hides the previously expanded web workspace without destroying it');
    await page.reload();await page.locator('#cards .card').first().waitFor();await web.bringToFront();
  }
  assert.equal(await worker.evaluate(()=>chrome.tabs.query({}).then(tabs=>tabs.length)),tabsBeforeLaunch,'launch must not create a standalone tab');
  if(process.argv.includes('--disabled-launch')) results.push('toolbar launcher restores disabled sidebar options and opens native sidebar without a new tab');
  if(process.argv.includes('--switch-webpages')) {
    const second=await context.newPage();await second.goto('https://fixture.test/second');await second.bringToFront();
    assert.ok(await second.evaluate(()=>innerWidth)<availableBefore,'native sidebar remains beside another webpage');
    assert.ok((await cdp.send('Target.getTargets')).targetInfos.some(t=>t.targetId===target.targetId));
    if(previousWorkspace) await second.waitForFunction(()=>getComputedStyle(document.querySelector('#qibian-mini-rail')).visibility==='hidden');
    await second.close();await web.bringToFront();
    results.push('same native sidebar stays available when switching between two ordinary webpages');
  }
  const {sessionId}=await cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:false}); let nextId=0;
  const run=expression=>new Promise((resolve,reject)=>{ const id=++nextId; const timer=setTimeout(()=>{cdp.off('Target.receivedMessageFromTarget',listener);reject(new Error('Native evaluation timed out'));},10000); const listener=event=>{const data=JSON.parse(event.message);if(event.sessionId!==sessionId||data.id!==id)return;clearTimeout(timer);cdp.off('Target.receivedMessageFromTarget',listener);if(data.error)reject(new Error(data.error.message));else resolve(data.result?.result?.value);};cdp.on('Target.receivedMessageFromTarget',listener);cdp.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}})}).catch(reject);});
  for(let i=0;i<40;i++){if(await run('Boolean(document.querySelector("#compact-navigation"))'))break;await new Promise(r=>setTimeout(r,100));}
  const availableWithNative = await web.evaluate(()=>innerWidth);
  if(stalled) assert.equal(await worker.evaluate(()=>globalThis.defaultInjectionDone),false,'old default injection waits for stalled page loading');
  if(process.argv.includes('--no-transition-worker')) await run(`(() => {
    const connect=chrome.runtime.connect.bind(chrome.runtime), send=chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.connect=(options)=>{if(options?.name==='qibian-mini-transition')throw new Error('Transition worker unavailable');return connect(options);};
    chrome.runtime.sendMessage=(message,...args)=>{if(message?.type==='qibian:release-to-mini')throw new Error('Transition worker unavailable');return send(message,...args);};
  })()`);
  if(process.argv.includes('--no-close-api')) await run('chrome.sidePanel.close = undefined');
  if(process.argv.includes('--blocked-injection')) {
    await web.locator('#qibian-mini-rail nav.rail').waitFor({state:'attached'});
    await run('chrome.scripting.executeScript = async () => { throw new Error("Blocked"); }');
  }
  if(process.argv.includes('--blocked-without-rail')) {
    await worker.evaluate(async()=>{
      const [tab]=await chrome.tabs.query({url:'https://fixture.test/*'});
      await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>globalThis.__qibianRail?.destroy()});
    });
    await run('globalThis.savedInjection = chrome.scripting.executeScript; chrome.scripting.executeScript = async () => { throw new Error("Blocked"); }');
  }
  await worker.evaluate(()=>chrome.runtime.onMessage.addListener((m,s)=>{ if(m.type==='qibian:release-to-mini') globalThis.miniTestSender={documentId:s.documentId,url:s.url,tabId:s.tab?.id}; }));
  if(process.argv.includes('--native-close')) {
    await worker.evaluate(async()=>{
      const [tab]=await chrome.tabs.query({url:'https://fixture.test/'});
      await chrome.sidePanel.close({windowId:tab.windowId});
    });
  } else await run('document.querySelector("#mini-button").click()');
  if(process.argv.includes('--blocked-without-rail')) {
    for(let i=0;i<40;i++){if(await run('Boolean(document.querySelector("#mini-error[open]"))'))break;await new Promise(r=>setTimeout(r,100));}
    assert.match(await run('document.querySelector("#mini-error").textContent'),/已获得.*Edge 仍拒绝.*Blocked/);
    assert.equal(await run('document.querySelector("#mini-button").disabled'),false);
    assert.equal(await web.evaluate(()=>innerWidth),availableWithNative);
    const settingsOpened=context.waitForEvent('page');
    await run('[...document.querySelectorAll("#mini-error button")].find(b=>b.textContent==="打开扩展权限设置").click()');
    const settingsPage=await settingsOpened;await settingsPage.waitForURL('edge://extensions/?id='+base.split('/')[2]);await settingsPage.close();await web.bringToFront();
    await run('chrome.scripting.executeScript = globalThis.savedInjection; [...document.querySelectorAll("#mini-error button")].find(b=>b.textContent==="重试").click()');
    results.push('Blocked without an existing rail preserves the native panel, offers verified extension settings link and succeeds on retry after injection is restored');
  }
  for(let i=0;i<60;i++){ if(!(await cdp.send('Target.getTargets')).targetInfos.some(t=>t.targetId===target.targetId))break; await new Promise(r=>setTimeout(r,100)); }
  if((await cdp.send('Target.getTargets')).targetInfos.some(t=>t.targetId===target.targetId)) {
    console.log('Native debug',await run('JSON.stringify({ mode:document.body.dataset.displayMode, toast:document.querySelector("#toast").textContent, url:location.href })'));
    console.log('Contexts',await worker.evaluate(()=>chrome.runtime.getContexts({contextTypes:['SIDE_PANEL']})));
    console.log('Tabs',await worker.evaluate(()=>chrome.tabs.query({active:true})));
    console.log('Sender',await worker.evaluate(()=>globalThis.miniTestSender));
  }
  assert.equal((await cdp.send('Target.getTargets')).targetInfos.some(t=>t.targetId===target.targetId),false,'native panel must really close to release its gutter');
  const rail=web.locator('#qibian-mini-rail'); await rail.locator('nav.rail').waitFor();
  if(previousWorkspace) {
    assert.equal(await previousWorkspace.evaluate(n=>n.isConnected&&n.hidden),true);
    assert.equal(await rail.isVisible(),true);
    results.push('native collapse restores visible icons while keeping the saved web workspace collapsed');
  }
  assert.equal(await rail.evaluate(n=>n.getBoundingClientRect().width),44);
  const availableAfter = await web.evaluate(()=>innerWidth);
  assert.equal(availableAfter,availableBefore);
  assert.ok(availableWithNative < availableBefore,'fixture must include an actual native sidebar gutter');
  assert.ok(availableAfter > availableWithNative,'webpage must regain the width occupied by the native sidebar');
  if(stalled) {
    assert.equal(await web.evaluate(()=>document.readyState),'loading');
    assert.equal(await worker.evaluate(()=>globalThis.defaultInjectionDone),false);
    results.push('default injection remains blocked while immediate injection releases native width on a still-loading webpage');
    releaseResource();await web.waitForLoadState('load');
  }
  results.push(`native panel closes after the 44px webpage rail is ready; viewport widths before/open/after: ${availableBefore}/${availableWithNative}/${availableAfter}`);
  if(process.argv.includes('--no-transition-worker')) results.push('native collapse succeeds with both transition messaging APIs disabled');
  if(process.argv.includes('--no-close-api')) results.push('older Edge fallback releases the native gutter without close API');
  if(process.argv.includes('--blocked-injection')) results.push('existing webpage rail releases native width even when executeScript rejects with Blocked');
  if(process.argv.includes('--with-music')) { assert.equal((await worker.evaluate(()=>chrome.runtime.sendMessage({type:'music:engine',action:'state'}))).paused,false);results.push('background music continues after native collapse'); }
  await web.screenshot({path:resolve('artifacts/released-space-1.4.3.png')});
  await rail.getByRole('button',{name:'展开栖边',exact:true}).click();
  const frame=web.frameLocator('#qibian-mini-rail iframe.workspace-frame'); await frame.locator('#cards .card').first().waitFor();
  if(previousWorkspace) {
    assert.equal(await previousWorkspace.evaluate(n=>n.isConnected&&!n.hidden),true);
    assert.equal(await frame.locator('textarea.note').inputValue(),'切换两种面板时保留我的便笺');
  }
  const identity=await rail.locator('iframe').elementHandle(); await frame.locator('#mini-button').click();
  await web.waitForFunction(()=>document.querySelector('#qibian-mini-rail').dataset.mode==='mini');
  assert.equal(await rail.locator('iframe').count(),1); assert.equal(await identity.evaluate(n=>n.isConnected),true); assert.equal(await rail.locator('nav.rail').isVisible(),true);
  assert.equal(await rail.evaluate(n=>n.getBoundingClientRect().width),44);
  await rail.getByRole('button',{name:'展开栖边',exact:true}).click(); await frame.locator('.shell').waitFor(); assert.equal(await identity.evaluate(n=>n.isConnected&&!n.hidden),true);
  results.push('web header arrow keeps the same workspace iframe alive and toggles icons/full layout');
  assert.deepEqual(errors,[]); console.log(results.join('\n'));
} finally {await context.close();}
function locationURL(base){return base+'/sidepanel.html';}
