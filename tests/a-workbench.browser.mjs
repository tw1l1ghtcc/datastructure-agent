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
function chartIndices(page, selector) {
  return page.locator('[data-viz-engine="plus-sort"] .prototype-array-cell' + selector)
    .evaluateAll(cells => cells.map(cell => Number(cell.dataset.index)));
}

function layerValues(page, layer, key) {
  return page.locator('[data-layer="' + layer + '"] [data-avc-key^="' + key + '"]').evaluateAll(elements =>
    elements.sort((a, b) => Number(a.dataset.avcKey.split('-').at(-1)) - Number(b.dataset.avcKey.split('-').at(-1)))
      .map(element => Number(element.querySelector('text')?.textContent)));
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
  await page.goto(base+'/#workbench?algorithm=insertion-sort');
  for(const algorithm of ['insertion-sort','binary-insertion-sort','shell-sort','selection-sort','quick-sort','heap-sort','merge-sort']){
    await selectWorkbenchAlgorithm(page,algorithm);
    await page.click('#fillDemo');
    const pending=page.waitForResponse(response=>response.url().endsWith('/api/algorithms/'+algorithm+'/runs'));
    await page.click('#startBtn');
    const response=await pending;assert.equal(response.status(),200,algorithm);
    const run=await response.json();assert.deepEqual(run.result,[1,2,4,5]);
    await page.locator('[data-viz-engine="plus-sort"]').waitFor();
    await page.locator('#code-lines .active').waitFor();
    assert.deepEqual(await chartIndices(page, '.is-comparing'), []);
    assert.deepEqual(await chartIndices(page, '.is-sorted'), []);
    for(let index=0;index<run.steps.length;index++){
      if(index)await page.click('#nextBtn');
      assert.equal(await page.locator('#code-lines .active').getAttribute('data-line-id'),run.steps[index].lineId,algorithm);
      const step = run.steps[index], v = step.variables;
      assert.doesNotMatch(await page.locator('.variables').innerText(),/undefined|NaN/);
      assert.equal(await page.locator('[data-explain-host] .bsviz-caption').textContent(), step.description);
      assert.deepEqual(await page.locator('.prototype-array-value').allTextContents(), step.array.map(String));
      if (algorithm === 'merge-sort') {
        assert.deepEqual(await layerValues(page, 'a-merge-temp', 'val-'), v.temp);
        if (step.event === 'pick') assert.deepEqual(await chartIndices(page, '.is-comparing'), [v.readIndex]);
        if (step.event === 'copy') assert.deepEqual(await chartIndices(page, '.is-comparing'), [v.low + v.p - 1]);
      } else if (algorithm === 'heap-sort') {
        const size = step.done ? 0 : step.event === 'init' ? step.array.length
          : step.event === 'swap-root' ? v.heapSize + 1 : v.heapSize;
        assert.deepEqual(await layerValues(page, 'a-heap', 'tnv-'), step.array.slice(0, size));
      } else if (algorithm === 'binary-insertion-sort' && step.event === 'compare') {
        assert.deepEqual(await chartIndices(page, '.is-comparing'), [v.mid]);
      } else if (algorithm === 'shell-sort' && step.event === 'compare') {
        assert.deepEqual(await chartIndices(page, '.is-comparing'), [v.j - v.gap, v.j]);
      } else if (algorithm === 'quick-sort' && step.event === 'init-pivot') {
        assert.equal(await page.locator('.a-sort-detail').textContent(), '枢轴值 ' + v.pivot);
      }
    }
    const values=await page.locator('.prototype-array-value').allTextContents();
    assert.deepEqual(values,['1','2','4','5'],algorithm);
    assert.deepEqual(await chartIndices(page, '.is-comparing'), []);
    assert.deepEqual(await chartIndices(page, '.is-sorted'), [0, 1, 2, 3]);
    await page.locator('[data-tl-ruler]').press('ArrowLeft');
    const previous = run.steps.at(-2);
    assert.equal(await page.locator('#code-lines .active').getAttribute('data-line-id'), previous.lineId);
    assert.deepEqual(await page.locator('.prototype-array-value').allTextContents(), previous.array.map(String));
    if (algorithm === 'merge-sort') assert.deepEqual(await layerValues(page, 'a-merge-temp', 'val-'), previous.variables.temp);
    await page.click('#resetBtn');
    assert.deepEqual(await chartIndices(page, '.is-sorted'), []);
    assert.deepEqual(await page.locator('.prototype-array-value').allTextContents(), run.steps[0].array.map(String));
    const answer=await page.request.post(base+'/api/agent/explain',{data:{runId:run.runId,stepIndex:1,question:'解释本步'}});
    assert.equal(answer.status(),200);
    assert.deepEqual((await answer.json()).stepRefs[0].variables,run.steps[1].variables);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [algorithm, input, expected] of [['heap-sort', '', []], ['merge-sort', '0', [0]], ['heap-sort', '2,-3,2,0', [-3,0,2,2]],
    ['heap-sort', '9007199254740991,0,-9007199254740991', [-9007199254740991,0,9007199254740991]]]) {
    await page.goto(base + '/#workbench?algorithm=' + algorithm);
    await page.fill('#arrInput', input);
    const response = page.waitForResponse(reply => reply.url().endsWith('/api/algorithms/' + algorithm + '/runs'));
    await page.click('#startBtn');
    const run = await (await response).json();
    await page.locator('[data-viz-engine="plus-sort"]').waitFor();
    await page.click('[data-viz-view-reset]');
    assert.ok(await page.locator('.a-sort-auxiliary .canvas-card').evaluate(card =>
      card.getBoundingClientRect().bottom <= document.querySelector('.viewport-legend').getBoundingClientRect().top));
    if (input.startsWith('9007')) {
      assert.equal(await page.locator('[data-avc-key="tnv-0"] title').textContent(), '9007199254740991');
      assert.equal(await page.locator('[data-avc-key="tnv-0"] text').getAttribute('textLength'), '24');
    }
    await page.locator('[data-tl-ruler]').press('End');
    assert.deepEqual(run.result, expected);
    assert.deepEqual(await page.locator('.prototype-array-value').allTextContents(), expected.map(String));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  assert.deepEqual(errors,[]);
  console.log('A package workbench acceptance passed.');
}finally{await browser?.close();server.kill();}
