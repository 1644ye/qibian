import test from 'node:test';
import assert from 'node:assert/strict';
import { newerVersion, checkRelease, installUpdateChecks } from '../updates.js';
const event=()=>({listeners:[],addListener(fn){this.listeners.push(fn);},fire(...args){return this.listeners.map(fn=>fn(...args));}});
test('release versions compare numerically and ignore invalid versions',()=>{
  assert.equal(newerVersion('1.10.0','1.9.9'),true);
  for(const v of ['1.6.1','1.6.0','1.6.2-beta','bad']) assert.equal(newerVersion(v,'1.6.1'),false);
});
test('checks stable GitHub releases without accepting a remote redirect link',async()=>{
  const status=await checkRelease('1.6.0',async url=>{
    assert.equal(url,'https://api.github.com/repos/1644ye/qibian/releases/latest');
    return {ok:true,json:async()=>({tag_name:'v1.6.1',html_url:'https://untrusted.test/',draft:false,prerelease:false})};
  });
  assert.equal(status.available,true); assert.equal(status.url,'https://github.com/1644ye/qibian/releases/tag/v1.6.1');
  await assert.rejects(checkRelease('1.6.1',async()=>({ok:false})),/无法检查/);
  await assert.rejects(checkRelease('1.6.1',async()=>({ok:true,json:async()=>({tag_name:'v1.7.0',prerelease:true})})),/正式版本/);
});
test('disk updates defer reload while native UI or music is active',async t=>{
  const local={}, alarms=[], contexts=[]; let music={paused:true}, reloads=0;
  const api={runtime:{id:'test',getURL:path=>'chrome-extension://test/'+path,getManifest:()=>({version:'1.6.0'}),getContexts:async()=>contexts,reload:()=>reloads++,onStartup:event(),onInstalled:event(),onMessage:event()},storage:{local:{get:async()=>local,set:async value=>Object.assign(local,value)},session:{get:async()=>({musicState:music})}},alarms:{create:(...args)=>alarms.push(args),onAlarm:event()}};
  t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>({version:'1.6.1'})}));
  installUpdateChecks(api); assert.equal(alarms.length,2);
  const tick=()=>new Promise(resolve=>setImmediate(resolve));
  contexts.push({contextType:'SIDE_PANEL'}); api.alarms.onAlarm.fire({name:'qibian-installed-update'}); await tick(); assert.equal(reloads,0);
  contexts.length=0; music={paused:false}; api.alarms.onAlarm.fire({name:'qibian-installed-update'}); await tick(); assert.equal(reloads,0);
  music={paused:true}; api.alarms.onAlarm.fire({name:'qibian-installed-update'}); await tick(); assert.equal(reloads,1);
});
