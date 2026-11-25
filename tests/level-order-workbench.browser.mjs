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
async function assertSlide(page, button, leaving, sign) {
  const move = await page.locator(button).evaluate((control, leaving) => {
    control.click();
    const selector = leaving ? '.b-traversal-exits > .b-traversal-cell' : '.b-traversal-cells > .b-traversal-cell';
    const tile = document.querySelector('.g-level-order-state ' + selector);
    const frames = tile?.getAnimations()[0]?.effect.getKeyframes();
    const edge = leaving ? frames?.at(-1)?.transform : frames?.[0]?.transform;
    return { label: tile?.textContent, offset: Number(edge?.match(/translateX\(([-\d.]+)px\)/)?.[1]) };
  }, leaving);
  assert.equal(move.label, 'A第 1 层');
  assert.equal(Math.sign(move.offset), sign);
}

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
  const state = page.locator('.g-level-order-state');
  const queueCells = state.locator('.b-traversal-cells > li');
  const levels = state.locator('.g-level-order-levels > li');
  assert.equal(await state.locator('table').count(), 0);
  for(let index=0;index<run.steps.length;index++){
    if(index)await page.click('#nextBtn');
    assert.equal(await page.locator('#code-lines .active').getAttribute('data-line-id'),run.steps[index].lineId);
    const { queue, levels: visited } = run.steps[index].variables;
    assert.deepEqual(await queueCells.locator('.g-level-order-node').allTextContents(), queue.map(entry => entry.id));
    assert.deepEqual(await queueCells.locator('.g-level-order-level').allTextContents(), queue.map(entry => '第 ' + entry.level + ' 层'));
    assert.deepEqual(await levels.evaluateAll(rows => rows.map(row => [...row.querySelectorAll('.g-level-order-visited > li')]
      .map(node => node.textContent))), visited);
  }
  await page.click('#resetBtn');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await assertSlide(page, '#nextBtn', false, 1);
  await assertSlide(page, '#nextBtn', true, -1);
  await assertSlide(page, '#prevBtn', false, -1);
  await assertSlide(page, '#prevBtn', true, 1);
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
  assert.equal(await state.count(), 1);
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
  assert.equal(await queueCells.count(), 0);
  assert.equal(await levels.count(), 0);
  await selectWorkbenchAlgorithm(page,'binary-search');await page.click('#fillDemo');await page.click('#startBtn');
  await page.locator('#code-lines [data-line-id="init-left"].active').waitFor();
  assert.deepEqual(errors,[]);
  console.log('Level-order workbench acceptance passed.');
} finally {
  await browser?.close();
  server.kill();
}
