// Uses isolated contexts with WebGPU unavailable; never creates a 3D device.
// Start the CDP browser first, then: node scripts/audit-fallback.mjs http://localhost:4322
import {chromium} from 'playwright-core';import assert from 'node:assert/strict';import{mkdir,writeFile}from'node:fs/promises';
const base=process.argv[2]??'http://127.0.0.1:4322',dir='artifacts/fallback';await mkdir(dir,{recursive:true});const browser=await chromium.connectOverCDP('http://127.0.0.1:9240');const results=[];
try{for(const [name,width,height]of[['browser',1280,800],['mobile',390,844],['adapter',1280,800],['rejected',1280,800],['https',390,844]]){
 const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  if(name==='https'){await context.route('http://scene.invalid/**',async route=>{const u=new URL(route.request().url());await route.fulfill({response:await context.request.get(base+u.pathname+u.search)})})}
  else await page.addInitScript(mode=>{Object.defineProperty(navigator,'gpu',{configurable:true,value:['browser','mobile'].includes(mode)?undefined:{requestAdapter:async()=>{if(mode==='rejected')throw new Error('adapter unavailable');return null}}})},name);
  const url=name==='https'?'http://scene.invalid/':base;await page.goto(url);await page.locator('#unsupported h1').waitFor({state:'visible'});
  assert.equal(await page.locator('#unsupported').getAttribute('role'),'alert');assert.match(await page.locator('#unsupported').innerText(),/WebGPU/);assert.equal(await page.locator('#loading').isVisible(),false);assert.equal(await page.locator('#performance-monitor').isVisible(),false);assert.equal(await page.locator('#controls').isVisible(),false);
  const expected=name==='mobile'?'browser':name==='rejected'?'adapter':name;assert.equal(await page.evaluate(()=>document.body.dataset.gpu),expected);assert.equal(await page.evaluate(()=>document.body.dataset.ready),'false');assert.equal(await page.evaluate(()=>!!globalThis.__threefxDebug),false);
  const link=await page.locator('.fallback-actions a').getAttribute('href');assert.equal(link,name==='https'?'https://bleach-webgpu.vercel.app/':'https://www.google.com/chrome/');
  const bounds=await page.locator('.fallback-card').boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=width+.1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const navigation=page.waitForEvent('framenavigated',f=>f===page.mainFrame());await page.getByRole('button',{name:'Проверить снова'}).click();await navigation;await page.locator('#unsupported h1').waitFor({state:'visible'});assert.deepEqual(errors,[]);await page.screenshot({path:`${dir}/${name}.png`});results.push({name,passed:true,width,height,retry:true,reason:expected});console.log(name);
 }finally{await context.close()}
}}finally{await writeFile(`${dir}/report.json`,JSON.stringify(results,null,2));await browser.close()}
