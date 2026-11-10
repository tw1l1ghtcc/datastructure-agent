import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCPreviewServer } from '../scripts/preview-final-c.mjs';
const moduleName=process.env.TEST_PLAYWRIGHT_MODULE;
const { chromium }=await import(moduleName?pathToFileURL(resolve(moduleName)).href:'playwright');
const server=createCPreviewServer();server.listen(0,'127.0.0.1');await once(server,'listening');
let browser;
try{
  browser=await chromium.launch({channel:process.env.TEST_BROWSER_CHANNEL??'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:1366,height:950}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForSelector('#algorithm option',{state:'attached'});
  const ids=await page.locator('#algorithm option').evaluateAll(a=>a.map(o=>o.value));assert.equal(ids.length,5);
  for(const id of ids){
    await page.selectOption('#algorithm',id);await page.click('#run');await page.waitForFunction(()=>document.getElementById('position').textContent.startsWith('第 1 /'));
    assert.equal(await page.locator('#code .active').count(),1);
    const initial=await page.locator('#state').textContent();await page.click('#next');await page.click('#prev');assert.equal(await page.locator('#state').textContent(),initial);
    await page.click('#end');assert.equal(await page.locator('#next').isDisabled(),true);assert.equal(await page.locator('#code .active').count(),1);
    assert.equal(await page.locator('#code').evaluate(code=>{const box=code.getBoundingClientRect(),line=code.querySelector('.active').getBoundingClientRect();return line.top>=box.top-1&&line.bottom<=box.bottom+1;}),true,'高亮行应在源码滚动区内可见');
    const state=JSON.parse(await page.locator('#state').textContent());
    if(id==='optimal-merge-tree')assert.equal(state.cost,17);
    if(id==='b-plus-tree')assert.deepEqual(state.leafKeys,[10,20,30,40,50,60,70]);
    if(state.nodes)assert.equal(await page.locator('#tree svg rect').count(),state.nodes.length);
    await page.click('#reset');assert.equal(await page.locator('#state').textContent(),initial);
    await page.click('#play');await page.waitForTimeout(850);await page.click('#play');assert.notEqual(await page.locator('#state').textContent(),initial);
  }
  await page.fill('#input','{');await page.click('#run');await page.waitForFunction(()=>document.getElementById('message').textContent.length>0);assert.match(await page.locator('#position').textContent(),/尚未运行/);
  await page.selectOption('#algorithm','b-plus-tree');await page.click('#run');await page.waitForFunction(()=>document.getElementById('position').textContent.startsWith('第 1 /'));await page.click('#end');
  await mkdir('artifacts/local/final-c',{recursive:true});
  await page.screenshot({path:'artifacts/local/final-c/desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'artifacts/local/final-c/mobile.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'手机外层页面不能横向溢出');
  assert.deepEqual(errors,[]);console.log('C包浏览器检查通过：五算法实际运行、源码高亮、前进/回退/播放/暂停/末步/重置、输入失效、桌面/手机。');
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
