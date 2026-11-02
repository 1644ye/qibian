import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { loadChromium, edgeLaunchOptions } from './browser-runtime.mjs';
const version=JSON.parse(await readFile('manifest.json','utf8')).version;
const root=resolve(process.env.QIBIAN_EXTENSION_ROOT || `dist/qibian-edge-${version}`), directory=resolve('artifacts','update-ui-'+Date.now());
await mkdir(directory,{recursive:true});
const context=await (await loadChromium()).launchPersistentContext(resolve(directory,'profile'),{...edgeLaunchOptions(),headless:true,args:[`--disable-extensions-except=${root}`,`--load-extension=${root}`]});
try {
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await worker.evaluate(async()=>{for(let i=0;i<150;i++){if((await chrome.storage.local.get('updateStatus')).updateStatus) return; await new Promise(resolve=>setTimeout(resolve,100));}});
  await worker.evaluate(()=>{
    const original=globalThis.fetch.bind(globalThis);
    globalThis.updateFixtureOffline=false;
    globalThis.fetch=(url,options)=>{
      if(String(url)==='https://api.github.com/repos/1644ye/qibian/releases/latest') {
        if(globalThis.updateFixtureOffline) return Promise.reject(new Error('network fixture'));
        return Promise.resolve(new Response(JSON.stringify({tag_name:'v1.7.0',draft:false,prerelease:false}),{status:200}));
      }
      return original(url,options);
    };
  });
  await context.route('https://github.com/1644ye/qibian/releases/tag/v1.7.0',r=>r.fulfill({contentType:'text/html',body:'<title>Release fixture</title>'}));
  const page=await context.newPage(); const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  await page.goto(worker.url().split('/').slice(0,3).join('/')+'/sidepanel.html');
  await page.getByRole('button',{name:'外观与设置',exact:true}).click();
  await page.locator('details.update-settings > summary').click();
  await page.getByRole('button',{name:'检查更新',exact:true}).click();
  await page.locator('[data-update-status]').getByText(`当前 ${version} · 发现新版 1.7.0`,{exact:true}).waitFor();
  const opened=context.waitForEvent('page'); await page.getByRole('button',{name:'下载新版',exact:true}).click();
  const download=await opened; await download.waitForURL('https://github.com/1644ye/qibian/releases/tag/v1.7.0'); await download.close();
  await worker.evaluate(()=>{globalThis.updateFixtureOffline=true;});
  await page.getByRole('button',{name:'检查更新',exact:true}).click();
  await page.locator('[data-update-status]').getByText(/暂时无法检查更新，请检查网络后重试/).waitFor();
  assert.equal(await page.getByRole('button',{name:'检查更新',exact:true}).isEnabled(),true);
  assert.deepEqual(errors,[]);
  console.log('PASS production update settings check the background, display the newer release, open the correct download page and recover from offline errors');
} finally {await context.close();}
