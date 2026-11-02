import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, validateState, safeURL, safeShortcutURL } from '../core.js';
import { openShortcut } from '../shortcut.js';
test('shortcut URLs allow installed extension pages and selected browser pages without weakening website URLs', () => {
  for (const url of ['chrome-extension://'+'a'.repeat(32)+'/onetab.html','extension://'+'b'.repeat(32)+'/page.html','edge://favorites/','chrome://bookmarks/','https://example.com/']) assert.equal(safeShortcutURL(url), url);
  for (const url of ['javascript:alert(1)','data:text/html,x','file:///C:/test','edge://crash','chrome://quit','chrome-extension://bad/page.html','chrome-extension://name@'+'a'.repeat(32)+'/x','https://name:pass@example.com/']) assert.throws(() => safeShortcutURL(url));
  assert.throws(() => safeURL('chrome-extension://'+'a'.repeat(32)+'/onetab.html'));
});
test('position and custom shortcuts survive validation/backup; positions stay within the viewport range', () => {
  const state=defaults(); state.settings.railSide='left'; state.settings.railOffset=.73;
  state.cards.push({id:'onetab',type:'shortcut',title:'OneTab',url:'chrome-extension://'+'a'.repeat(32)+'/onetab.html',icon:'O'});
  const restored=validateState(JSON.parse(JSON.stringify(validateState(state))));
  assert.equal(restored.settings.railOffset,.73); assert.equal(restored.settings.railSide,'left'); assert.equal(restored.cards.at(-1).icon,'O');
  assert.equal(validateState({...state,settings:{railOffset:100}}).settings.railOffset,1);
  assert.equal(validateState({...state,settings:{railOffset:-1}}).settings.railOffset,0);
  assert.equal(validateState({...state,settings:{railOffset:'bad',railSide:'bad'}}).settings.railSide,'right');
});
test('shortcut focuses an existing extension tab when authorized and otherwise opens directly', async () => {
  const calls=[],url='chrome-extension://'+'a'.repeat(32)+'/onetab.html';
  const api={permissions:{contains:async()=>true},tabs:{query:async()=>[{id:2,windowId:3,url}],update:async(id,p)=>calls.push(['focus',id,p]),create:async p=>calls.push(['new',p])},windows:{update:async id=>calls.push(['window',id])}};
  await openShortcut(api,url); assert.equal(calls[0][0],'focus'); assert.equal(calls[1][1],3);
  api.permissions.contains=async()=>false; await openShortcut(api,url); assert.equal(calls.at(-1)[0],'new');
});
