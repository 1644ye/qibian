import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { openNativeSidebar } from '../panel-launcher.js';

const source = (await readFile(new URL('../background.js', import.meta.url), 'utf8')).replace("import { openNativeSidebar } from './panel-launcher.js';", '');
const event = () => ({ listeners: [], addListener(listener) { this.listeners.push(listener); }, fire(...args) { return this.listeners.map(listener => listener(...args)); } });
const tick = () => new Promise(resolve => setImmediate(resolve));
function background({ close = true, openError = null, contexts = null, pageURL = 'https://fixture.test/', railError = false } = {}) {
  const calls = [], session = {}, timers = new Map();
  let timerId = 0;
  const chrome = {
    action: { onClicked: event(), setBadgeText:async options=>calls.push(['badge',options]), setTitle:async options=>calls.push(['title',options]) },
    runtime: { onInstalled:event(), onStartup:event(), onConnect:event(), onMessage:event(), getURL:path => 'chrome-extension://test/' + path, sendMessage:async message => { calls.push(['focus', message]); }, ...(contexts ? { getContexts:async () => contexts } : {}) },
    sidePanel: {
      onOpened:event(), onClosed:event(),
      setPanelBehavior:async options => { calls.push(['behavior', options]); },
      setOptions:async options => { calls.push(['options', options]); },
      open:options => { calls.push(['open', options]); return openError ? Promise.reject(new Error(openError)) : Promise.resolve(); },
      ...(close ? { close:async options => { calls.push(['close', options]); } } : {})
    },
    tabs: {
      query:async options => [{ id: options.windowId === 2 ? 22 : 11, windowId:options.windowId || 1, url:pageURL }],
      sendMessage:async (id, message) => { calls.push(['tabMessage', id, message]); if(message.type==='qibian:mini') { if(railError) throw new Error('Receiving end does not exist'); return {ok:true,mode:'mini',width:44}; } }
    },
    windows:{ onRemoved:event() },
    scripting:{ executeScript:async options => { calls.push(['inject', options]); } },
    storage:{ session:{ set:async values => { calls.push(['store', values]); Object.assign(session, values); }, remove:async keys => { calls.push(['remove', keys]); for (const key of keys) delete session[key]; } } }
  };
  vm.runInNewContext(source, { chrome, console, openNativeSidebar, setTimeout:callback => { timers.set(++timerId, callback); return timerId; }, clearTimeout:id => timers.delete(id) });
  const handler = chrome.runtime.onMessage.listeners[0];
  const message = (body, sender = { tab:{ id:11, windowId:1 } }) => new Promise(resolve => {
    const keepOpen = handler(body, sender, resolve);
    if (!keepOpen && !['qibian:rail-state', 'qibian:collapse'].includes(body.type)) resolve(undefined);
  });
  return { chrome, calls, session, handler, message, runTimers() { for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } } };
}
function panel(windowId) {
  return { name:'qibian-panel', sender:{ url:'chrome-extension://test/sidepanel.html' }, onMessage:event(), onDisconnect:event(), windowId };
}
test('standalone extension tabs cannot keep native surface ownership after it closes',async()=>{
  const b=background(), tab=panel(1);tab.sender.tab={id:99,windowId:1};
  b.chrome.runtime.onConnect.fire(tab);tab.onMessage.fire({type:'qibian:panel-ready',windowId:1});
  assert.equal((await b.message({type:'qibian:rail-state'})).nativeOpen,false);
});
test('native visibility broadcasts explicit surface ownership within the same window',async()=>{
  const b=background();b.chrome.sidePanel.onOpened.fire({windowId:1});await tick();
  const notification=b.calls.find(c=>c[0]==='tabMessage'&&c[2].type==='qibian:rail-visibility');
  assert.equal(notification[2].nativeOpen,true);
  assert.equal((await b.message({type:'qibian:rail-state'})).nativeOpen,true);
  assert.equal((await b.message({type:'qibian:rail-state'},{tab:{id:22,windowId:2}})).nativeOpen,false);
  b.chrome.sidePanel.onClosed.fire({windowId:1});await tick();
  assert.equal(b.calls.filter(c=>c[0]==='tabMessage').at(-1)[2].nativeOpen,false);
});
test('web expansion checks live contexts instead of trusting stale native ownership',async()=>{
  const b=background({contexts:[]});b.chrome.sidePanel.onOpened.fire({windowId:1});
  assert.equal((await b.message({type:'qibian:surface-state'})).nativeOpen,false);
});
test('toolbar opens native sidebar synchronously without injection or creating tabs',async()=>{
  const b=background();
  b.chrome.action.onClicked.fire({id:11,windowId:1,url:'https://fixture.test/'});
  assert.ok(b.calls.some(c=>c[0]==='open'),'open must run before returning to the event loop');
  await tick();
  assert.ok(b.calls.every(c=>!['inject','store'].includes(c[0])));
  assert.equal(b.calls.find(c=>c[0]==='open')[1].windowId,1);
  assert.equal(b.calls.find(c=>c[0]==='badge')[1].text,'');
});
test('toolbar opening failure stays on the current tab and exposes retry status',async()=>{
  const b=background({openError:'Blocked'});let newTabs=0;b.chrome.tabs.create=async()=>{newTabs++;};
  b.chrome.action.onClicked.fire({id:11,windowId:1,url:'https://fixture.test/'});await tick();
  assert.equal(newTabs,0);assert.equal(b.calls.find(c=>c[0]==='badge')[1].text,'!');
});

test('opening from the rail calls sidePanel.open before storage and focuses the requested card', async () => {
  const b = background();
  const response = b.message({ type:'qibian:open', cardId:'note-1' });
  assert.equal(b.calls[1][0], 'open');
  assert.deepEqual(JSON.parse(JSON.stringify(b.calls[1][1])), { tabId:11 });
  assert.equal(b.calls[2][0], 'store');
  assert.equal((await response).ok, true);
  assert.equal(b.session.focusCardId, 'note-1');
  assert.equal(b.session.focusWindowId, 1);
  assert.equal(b.calls.find(call => call[0] === 'focus')[1].cardId, 'note-1');
  assert.equal((await b.message({ type:'qibian:rail-state' })).visible, false);
});

test('opening the whole panel clears a previously requested card', async () => {
  const b = background();
  await b.message({ type:'qibian:open', cardId:'note-1' });
  await b.message({ type:'qibian:open' });
  assert.equal(b.session.focusCardId, undefined);
  assert.equal(b.session.focusWindowId, undefined);
});

test('panel visibility is scoped to its browser window and tolerates a reload', async () => {
  const b = background(), first = panel(1), replacement = panel(1);
  b.chrome.runtime.onConnect.fire(first);
  first.onMessage.fire({ type:'qibian:panel-ready', windowId:1 });
  assert.equal((await b.message({ type:'qibian:rail-state' })).visible, false);
  assert.equal((await b.message({ type:'qibian:rail-state' }, { tab:{ id:22, windowId:2 } })).visible, true);
  first.onDisconnect.fire();
  b.chrome.runtime.onConnect.fire(replacement);
  replacement.onMessage.fire({ type:'qibian:panel-ready', windowId:1 });
  b.runTimers();
  assert.equal((await b.message({ type:'qibian:rail-state' })).visible, false);
  replacement.onDisconnect.fire();
  b.runTimers();
  assert.equal((await b.message({ type:'qibian:rail-state' })).visible, true);
});

test('native panel lifecycle events update the rail even without a port', async () => {
  const b = background();
  b.chrome.sidePanel.onOpened.fire({ windowId:1 });
  assert.equal((await b.message({ type:'qibian:rail-state' })).visible, false);
  b.chrome.sidePanel.onClosed.fire({ windowId:1 });
  assert.equal((await b.message({ type:'qibian:rail-state' })).visible, true);
});

test('opening failure reports the error and keeps the rail available', async () => {
  const b = background({ openError:'User gesture required' });
  const result = await b.message({ type:'qibian:open', cardId:'note-1' });
  assert.equal(result.ok, false);
  assert.match(result.error, /User gesture/);
  assert.equal((await b.message({ type:'qibian:rail-state' })).visible, true);
});
test('closing before the panel page connects cannot leave the rail hidden', async () => {
  const b = background({ contexts: [] });
  await b.message({ type:'qibian:open' });
  assert.equal((await b.message({ type:'qibian:rail-state' })).visible, false);
  b.runTimers(); await tick();
  assert.equal((await b.message({ type:'qibian:rail-state' })).visible, true);
});

test('collapse uses native close and disables then restores the panel on older Edge', async () => {
  const b = background(), sender = { url:'chrome-extension://test/sidepanel.html' };
  assert.equal((await b.message({ type:'qibian:collapse', windowId:1 }, sender)).ok, true);
  assert.equal(b.calls.find(call => call[0] === 'close')[1].windowId, 1);
  const old = background({ close:false });
  assert.equal((await old.message({ type:'qibian:collapse', windowId:1 }, sender)).ok, true);
  assert.deepEqual(old.calls.filter(c => c[0] === 'options').map(c => c[1].enabled), [false, true]);
});

test('only browser startup resets the expanded mode and reinjects existing webpages', async () => {
  const b = background();
  assert.equal(b.calls.some(call => call[0] === 'options'), false);
  b.chrome.sidePanel.onOpened.fire({ windowId:1 });
  b.chrome.runtime.onStartup.fire();
  await tick();
  const options = b.calls.filter(call => call[0] === 'options');
  assert.equal(options[0][1].enabled, false);
  assert.equal(options[1][1].enabled, true);
  assert.equal(b.calls.find(call => call[0] === 'inject')[1].files[0], 'rail.js');
  assert.equal((await b.message({ type:'qibian:rail-state' })).visible, true);
});

test('installation injects the rail into already open webpages', async () => {
  const b = background();
  b.chrome.runtime.onInstalled.fire();
  await tick();
  assert.equal(b.calls.find(call => call[0] === 'inject')[1].target.tabId, 11);
});

test('native compact transition acknowledges webpage icons before closing native width', async () => {
  const b = background({contexts:[{documentId:'native',windowId:1}]});
  const result = await b.message({type:'qibian:release-to-mini',windowId:1},{url:'chrome-extension://test/sidepanel.html',documentId:'native'});
  assert.equal(result.ok,true); assert.equal(result.inPage,false);
  assert.ok(b.calls.findIndex(c=>c[0]==='tabMessage' && c[2].type==='qibian:mini') < b.calls.findIndex(c=>c[0]==='close'));
});
test('native transition keeps the usable panel on restricted pages or failed rail injection', async () => {
  for(const options of [{pageURL:'edge://newtab/'},{railError:true}]) {
    const b=background({...options,contexts:[{documentId:'native',windowId:1}]});
    const result=await b.message({type:'qibian:release-to-mini',windowId:1},{url:'chrome-extension://test/sidepanel.html',documentId:'native'});
    assert.equal(result.ok,false); assert.equal(b.calls.some(c=>c[0]==='close'||c[0]==='options'),false);
  }
});
test('native fallback disables the panel without immediately restoring its empty width', async () => {
  const b=background({close:false,contexts:[{documentId:'native',windowId:1}]});
  const result=await b.message({type:'qibian:release-to-mini',windowId:1},{url:'chrome-extension://test/sidepanel.html',documentId:'native'});
  assert.equal(result.ok,true); assert.ok(b.calls.filter(c=>c[0]==='options').every(c=>c[1].enabled===false));
});
test('a standalone page with the same URL never closes a native panel in another document', async () => {
  const b=background({contexts:[{documentId:'native',windowId:1}]});
  const result=await b.message({type:'qibian:release-to-mini',windowId:1},{url:'chrome-extension://test/sidepanel.html',documentId:'standalone'});
  assert.equal(result.inPage,true); assert.equal(b.calls.some(c=>c[0]==='close'),false);
});
test('Edge native senders without documentId and contexts with windowId -1 still release width', async () => {
  const b=background({contexts:[{documentId:'ABC123',windowId:-1,documentUrl:'chrome-extension://test/sidepanel.html'}]});
  const result=await b.message({type:'qibian:release-to-mini',windowId:1},{url:'chrome-extension://test/sidepanel.html'});
  assert.equal(result.inPage,false); assert.equal(b.calls.find(c=>c[0]==='close')[1].windowId,1);
});
test('reconnected dedicated ports reuse a completed transition without closing twice',async()=>{
  const b=background({contexts:[{documentId:'native',windowId:1}]});const replies=[];
  const create=()=>({name:'qibian-mini-transition',sender:{url:'chrome-extension://test/sidepanel.html',documentId:'native'},onMessage:event(),postMessage:m=>replies.push(m)});
  const first=create(),second=create();b.chrome.runtime.onConnect.fire(first);b.chrome.runtime.onConnect.fire(second);
  const request={type:'qibian:release-to-mini',requestId:'same-request',windowId:1};first.onMessage.fire(request);second.onMessage.fire(request);await tick();
  assert.equal(b.calls.filter(c=>c[0]==='close').length,1);assert.equal(replies.length,2);assert.ok(replies.every(m=>m.result.ok));
});
