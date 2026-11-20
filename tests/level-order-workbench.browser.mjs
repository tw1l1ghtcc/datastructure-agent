import { selectWorkbenchAlgorithm } from './select-workbench-algorithm.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.TEST_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.TEST_PLAYWRIGHT_MODULE).href : 'playwright');
const server = spawn(process.execPath, ['backend/src/server.js'], {
  cwd: fileURLToPath(new URL('../', import.meta.url)),
  env: { ...process.env, PORT: '0', HOST: '127.0.0.1', AGENT_MOCK: 'true', RATE_LIMIT: 'false' },
  windowsHide: true
});
let browser;
try {
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Backend startup timed out')), 10000);
    server.once('error', reject);
    server.stdout.on('data', chunk => {
      const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
  });
  browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'msedge', headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base+'/#workbench?algorithm=binary-tree-level-order');
  await page.click('#fillDemo');
  await page.click('#tree-next');
  assert.equal(await page.inputValue('#tree-root'),'A');
  assert.equal(await page.getByLabel('B 的右孩子',{exact:true}).inputValue(),'D');
  await page.click('#tree-back');await page.click('#tree-next');
  assert.equal(await page.getByLabel('B 的右孩子',{exact:true}).inputValue(),'D');
  const pending=page.waitForResponse(response=>response.url().endsWith('/api/algorithms/binary-tree-level-order/runs'));
  await page.click('#startBtn');
  const response=await pending;assert.equal(response.status(),200);
  const run=await response.json();assert.deepEqual(run.result,['A','B','C','D']);
  await page.locator('#tree-edit').waitFor();
  for(let index=0;index<run.steps.length;index++){
    if(index)await page.click('#nextBtn');
    assert.equal(await page.locator('#code-lines .active').getAttribute('data-line-id'),run.steps[index].lineId);
    const tables=page.locator('.level-order-tables table');
    assert.equal(await tables.count(),2);
    const queue=await tables.first().locator('tbody tr').evaluateAll(rows=>rows.map(row=>[row.cells[0].textContent,Number(row.cells[1].textContent)]));
    assert.deepEqual(queue,run.steps[index].variables.queue.map(entry=>[entry.id,entry.level]));
  }
  assert.match(await page.locator('.level-order-tables').innerText(),/B → C/);
  await page.click('#prevBtn');
  await page.click('#resetBtn');
  assert.equal(await page.locator('#varValue').innerText(),'空');
  const answer=await page.request.post(base+'/api/agent/explain',{
    data:{runId:run.runId,stepIndex:2,question:'为什么出队？',hintLevel:2}
  });
  assert.equal(answer.status(),200);
  assert.deepEqual((await answer.json()).stepRefs[0].variables.queue,run.steps[2].variables.queue);
  await page.click('#tree-edit');
  await page.getByLabel('D 的左孩子',{exact:true}).selectOption('A');
  await page.click('#startBtn');
  await page.waitForFunction(()=>document.querySelector('#msgBox').textContent.includes('环或被重复引用'));
  assert.equal(await page.locator('.level-order-tables').count(),1);
  await page.getByLabel('D 的左孩子',{exact:true}).selectOption('');
  await page.click('#tree-back');await page.fill('#tree-nodes','Solo');await page.click('#tree-next');
  await page.selectOption('#tree-root','Solo');
  const soloPending=page.waitForResponse(response=>response.url().endsWith('/api/algorithms/binary-tree-level-order/runs'));
  await page.click('#startBtn');
  assert.deepEqual((await (await soloPending).json()).result,['Solo']);
  await page.locator('#tree-edit').waitFor();
  await page.click('#tree-edit');await page.click('#tree-back');await page.fill('#tree-nodes','');await page.click('#tree-next');
  const emptyPending=page.waitForResponse(response=>response.url().endsWith('/api/algorithms/binary-tree-level-order/runs'));
  await page.click('#startBtn');
  assert.deepEqual((await (await emptyPending).json()).result,[]);
  await page.locator('#tree-edit').waitFor();
  await page.click('[data-t="last"]');
  assert.match(await page.locator('[data-explain-host]').innerText(),/空树/);
  await selectWorkbenchAlgorithm(page,'binary-search');await page.click('#fillDemo');await page.click('#startBtn');
  await page.locator('#code-lines [data-line-id="init-left"].active').waitFor();
  assert.deepEqual(errors,[]);
  console.log('Level-order workbench acceptance passed.');
} finally {
  await browser?.close();
  server.kill();
}
