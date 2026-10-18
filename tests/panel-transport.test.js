import test from 'node:test';
import assert from 'node:assert/strict';
import { requestMiniTransition } from '../panel-transport.js';
function fixture({ ownTab, url='https://fixture.test/', width=44, injectionError, close, existing=false, granted=true }={}) {
  const calls=[];let loaded=existing;
  const api={
    runtime:{ connect(){throw new Error('Worker unavailable');}, sendMessage(){throw new Error('Worker unavailable');} },
    permissions:{contains:async()=>granted},
    tabs:{getCurrent:async()=>ownTab,query:async()=>[{id:11,url}],sendMessage:async(id,message,options)=>{
      calls.push(['message',id]);assert.equal(options.frameId,0);assert.equal(message.type,'qibian:mini');
      if(!loaded)throw new Error('Receiving end does not exist');
      return {ok:true,mode:'mini',width};
    }},
    scripting:{executeScript:async options=>{
      calls.push(['inject',options]);
      if(injectionError)throw new Error(injectionError);
      assert.equal(options.injectImmediately,true);
      loaded=true;return [];
    }},
    sidePanel:{close:async options=>{calls.push(['close',options]);if(close)return close();},setOptions:async options=>{calls.push(['options',options]);}}
  };
  return {api,calls};
}
test('native collapse works with no worker transport and verifies the rail before closing',async()=>{
  const {api,calls}=fixture();
  assert.deepEqual(await requestMiniTransition(api,1),{ok:true,inPage:false,tabId:11});
  assert.deepEqual(calls.map(c=>c[0]),['message','inject','message','close']);
});
test('existing rail collapses even when programmatic injection is Blocked',async()=>{
  const {api,calls}=fixture({existing:true,injectionError:'Blocked'});
  assert.equal((await requestMiniTransition(api,1)).ok,true);
  assert.deepEqual(calls.map(c=>c[0]),['message','close']);
});
test('blocked injection distinguishes denied and granted host access without exposing URL paths',async()=>{
  for(const granted of [true,false,null]) {
    const {api,calls}=fixture({url:'https://fixture.test/private?secret=123',injectionError:'Blocked',granted});
    await assert.rejects(requestMiniTransition(api,1),error=>{
      assert.equal(error.miniDiagnostic.hostPermission,granted);
      assert.equal(error.miniDiagnostic.stage,'加载网页图标栏');
      assert.equal(error.miniDiagnostic.reason,'Blocked');
      assert.doesNotMatch(JSON.stringify(error.miniDiagnostic),/private|secret/);
      assert.match(error.message,granted===true?/已获得/:granted===false?/尚未获得/:/确认网站访问范围/);return true;
    });
    assert.ok(calls.every(c=>!['close','options'].includes(c[0])));
  }
});
test('standalone extension tab changes its own layout without closing native UI',async()=>{
  const {api,calls}=fixture({ownTab:{id:9}});
  assert.deepEqual(await requestMiniTransition(api,1),{ok:true,inPage:true});assert.equal(calls.length,0);
});
test('copied diagnostics redact paths and query values embedded in browser errors',async()=>{
  const {api}=fixture({injectionError:'Cannot access contents of url "https://fixture.test/private?secret=123".'});
  await assert.rejects(requestMiniTransition(api,1),error=>{
    assert.doesNotMatch(JSON.stringify(error.miniDiagnostic),/private|secret|123/);
    assert.match(error.miniDiagnostic.reason,/fixture\.test/);return true;
  });
});
test('restricted pages, failed injection and invalid geometry preserve the native panel',async()=>{
  for(const options of [{url:'edge://newtab/'},{injectionError:'Permission denied'},{width:400},{width:0}]) {
    const {api,calls}=fixture(options);
    await assert.rejects(requestMiniTransition(api,1),/当前页面不允许|Edge 仍拒绝/);
    assert.ok(calls.every(c=>!['close','options'].includes(c[0])));
  }
});
test('missing and stalled close API both disable the panel without restoring the gutter',async()=>{
  for(const close of [()=>{throw new Error('unsupported');},()=>new Promise(()=>{})]) {
    const {api,calls}=fixture({close});
    assert.equal((await requestMiniTransition(api,1,{timeoutMs:5})).ok,true);
    assert.deepEqual(calls.filter(c=>c[0]==='options').map(c=>c[1]),[{tabId:11,enabled:false},{enabled:false}]);
  }
});
test('stalled injection reports its specific stage and never closes the panel later',async()=>{
  const {api,calls}=fixture();let finish;
  api.scripting.executeScript=()=>new Promise(resolve=>{finish=resolve;});
  await assert.rejects(requestMiniTransition(api,1,{timeoutMs:5}),/加载网页图标栏超时/);
  finish([]);await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls.map(c=>c[0]),['message']);
});
