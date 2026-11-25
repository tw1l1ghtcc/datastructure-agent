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
  await page.goto(base + '/#workbench?algorithm=optimal-merge-tree');
  const ids=['optimal-merge-tree','multiway-merge','replacement-selection','b-tree','b-plus-tree'];
  for (const algorithm of ids) {
    await selectWorkbenchAlgorithm(page,algorithm);
    await page.click('#fillDemo');
    const tree=['b-tree','b-plus-tree'].includes(algorithm);
    if (tree) {
      await page.click('#c-next');
      await page.click('#c-back');
      await page.click('#c-next');
      assert.equal(await page.inputValue('#c-queries'), algorithm==='b-tree' ? '6, 7' : '30, 35');
    }
    const inputBeforeRun=await page.inputValue('#c-data');
    const pending=page.waitForResponse(response=>response.url().endsWith('/api/algorithms/'+algorithm+'/runs'));
    await page.click('#startBtn');
    const response=await pending;
    assert.equal(response.status(),200,algorithm);
    const run=await response.json();
    if(algorithm==='optimal-merge-tree') assert.equal(run.result.cost,17);
    if(algorithm==='multiway-merge') assert.deepEqual(run.result,[0,1,2,3,4,5]);
    if(algorithm==='replacement-selection') assert.deepEqual(run.result,[[4,5],[1,2,6]]);
    if(tree) assert.deepEqual(run.result.queries.map(query=>query.found),[true,false]);
    await page.locator('#c-edit').waitFor();
    const animated = page.locator('[data-viz-engine="plus-c"]');
    await animated.waitFor();
    assert.ok(await animated.locator('.avc-svg').count());
    assert.equal(await page.locator('#c-fields').isHidden(),true);
    await page.click('#nextBtn');
    assert.equal(await page.locator('#code-lines .active').count(),1);
    if (algorithm === 'optimal-merge-tree') {
      const [left, right] = await Promise.all(['.c-optimal-sidebar', '.c-optimal-tree-pane'].map(selector =>
        animated.locator(selector).boundingBox()));
      assert.ok(left.x + left.width < right.x && left.y === right.y && right.width > 2 * left.width);
      const picked = animated.locator('[data-layer="c-selected"]');
      assert.deepEqual(await picked.locator('[data-avc-key^="gv-"]').allTextContents(), ['2', '3']);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      assert.ok(await page.locator('[data-tl-ruler]').evaluate(control => {
        control.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        const tile = document.querySelector('.array-animation-moving-value');
        return tile?.textContent === '5' && tile.getAnimations().length > 0;
      }));
      assert.match(await page.locator('[data-explain-host] .bsviz-status').textContent(), /2 \+ 3 = 5.*0 \+ 5 = 5/);
      assert.equal(await animated.locator('.c-optimal-cost').textContent(), '累计代价 5');
    }
    if (algorithm === 'replacement-selection') {
      const values = id => animated.locator(`[data-layer="${id}"] [data-avc-key^="gv-"]`).allTextContents();
      assert.deepEqual(await values('c-replacement-input'), ['4', '5', '1', '2', '6']);
      assert.deepEqual(await values('c-active'), ['4', '5']);
      const [active, frozen] = await Promise.all(['c-active', 'c-frozen'].map(id =>
        animated.getByRole('region', { name: id === 'c-active' ? '活动区' : '冻结区' }).boundingBox()));
      assert.ok(active.width > 0 && frozen.x > active.x && frozen.y === active.y);
      await page.click('#nextBtn');
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      const ruler = page.locator('[data-tl-ruler]');
      assert.ok(await ruler.evaluate(control => {
        control.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        const tile = document.querySelector('.array-animation-moving-value');
        return tile?.textContent === '1' && tile.getAnimations().length > 0;
      }));
      assert.deepEqual(await values('c-frozen'), ['1']);
      assert.match(await page.locator('[data-explain-host] .bsviz-status').textContent(), /读入 A\[2\] = 1.*本段末值 4/);
      await ruler.press('ArrowLeft');
      assert.deepEqual(await values('c-frozen'), []);
      assert.equal(await animated.locator('.array-animation-moving-value').count(), 0);
    }
    await page.click('[data-t="last"]');
    assert.match(await page.locator('[data-explain-host]').innerText(),/运行结束/);
    const last = run.steps.at(-1);
    if (tree || algorithm === 'optimal-merge-tree') {
      assert.equal(await animated.locator('[data-avc-key^="n-"]').count(), last.variables.nodes.length);
    }
    if (algorithm === 'b-plus-tree') {
      assert.equal(await animated.locator('[data-avc-key^="x-"] [data-role="arrow"]').count(),
        last.variables.nodes.filter(node => node.leaf && node.next != null).length);
    }
    if (algorithm === 'multiway-merge') {
      assert.deepEqual(await animated.locator('[data-layer="c-output"] [data-avc-key^="gv-"]').allTextContents(),
        run.result.map(String));
    }
    const tables = animated.locator('.c-state-tables');
    if (!tree) {
      assert.equal(await tables.count(), 0);
      if (algorithm === 'optimal-merge-tree') assert.match(await page.locator('[data-explain-host]').innerText(), /总代价 17/);
    } else {
      const tableText = await tables.innerText();
      assert.doesNotMatch(tableText, /undefined|NaN/);
      if (tree) assert.match(tableText, /查询结果.*查询键/s);
    }
    await page.click('#prevBtn');
    assert.equal(await page.locator('#code-lines .active').count(),1);
    assert.equal(await page.locator('[data-explain-host] .bsviz-caption').textContent(), run.steps.at(-2).description);
    if (tree || algorithm === 'optimal-merge-tree') {
      assert.equal(await animated.locator('[data-avc-key^="n-"]').count(), run.steps.at(-2).variables.nodes.length);
    }
    await page.locator('[data-tl-ruler]').press('Home');
    if (tree) assert.equal(await animated.locator('[data-avc-key^="n-"]').count(), 0);
    const answer=await page.request.post(base+'/api/agent/explain',{
      data:{runId:run.runId,stepIndex:1,question:'解释本步',hintLevel:2}
    });
    assert.equal(answer.status(),200);
    assert.deepEqual((await answer.json()).stepRefs[0].variables,run.steps[1].variables);
    await page.click('#c-edit');
    assert.equal(await page.inputValue('#c-data'), inputBeforeRun);
  }
  await selectWorkbenchAlgorithm(page,'multiway-merge');
  await page.fill('#c-data','3, 1\n2, 4');
  await page.click('#startBtn');
  assert.match(await page.locator('#msgBox').innerText(),/非递减/);
  const cases=[
    ['optimal-merge-tree',{weights:[]},result=>assert.equal(result.cost,0)],
    ['multiway-merge',{runs:[[],[1]],k:2},result=>assert.deepEqual(result,[1])],
    ['replacement-selection',{array:[],capacity:1},result=>assert.deepEqual(result,[])],
    ['b-tree',{keys:[],queries:[7],t:2},result=>assert.equal(result.queries[0].found,false)],
    ['b-plus-tree',{keys:[],queries:[]},result=>assert.equal(result.root,null)]
  ];
  for(const [algorithm,input,check] of cases) {
    const response=await page.request.post(base+'/api/algorithms/'+algorithm+'/runs',{data:input});
    assert.equal(response.status(),200);
    check((await response.json()).result);
  }
  await selectWorkbenchAlgorithm(page,'b-tree');
  await page.click('#fillDemo');
  await page.click('#c-next');
  await page.fill('#c-queries','');
  const buildPending=page.waitForResponse(response=>response.url().endsWith('/api/algorithms/b-tree/runs'));
  await page.click('#startBtn');
  assert.deepEqual((await (await buildPending).json()).result.queries,[]);
  await page.locator('#c-edit').waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + '/#workbench?algorithm=b-plus-tree');
  await page.fill('#c-data', Array.from({ length: 64 }, (_, i) => i).join(','));
  await page.click('#c-next');
  const largePending = page.waitForResponse(response => response.url().endsWith('/api/algorithms/b-plus-tree/runs'));
  await page.click('#startBtn');
  const largeResponse = await largePending;
  assert.equal(largeResponse.status(), 200);
  const large = await largeResponse.json();
  await page.locator('#c-edit').waitFor();
  await page.locator('[data-tl-ruler]').press('End');
  const treeSvg = page.locator('[data-layer="c-search-tree"] svg');
  assert.equal(await treeSvg.locator('[data-avc-key^="n-"]').count(), large.result.nodes.length);
  assert.equal(await treeSvg.locator('[data-avc-key^="x-"] [data-role="arrow"]').count(),
    large.result.nodes.filter(node => node.leaf && node.next != null).length);
  assert.ok(await page.locator('[data-viz-body]').evaluate(body => body.scrollWidth > body.clientWidth));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  await page.setViewportSize({ width: 1280, height: 800 });
  await selectWorkbenchAlgorithm(page, 'optimal-merge-tree');
  const startOptimal = async weights => {
    await page.fill('#c-data', weights.join(','));
    const pending = page.waitForResponse(response => response.url().endsWith('/api/algorithms/optimal-merge-tree/runs'));
    await page.click('#startBtn');
    const response = await pending;
    assert.equal(response.status(), 200);
    await page.locator('#c-edit').waitFor();
    return response.json();
  };
  const weights = Array.from({ length: 64 }, (_, index) => index % 3 === 0 ? 0 : 1);
  weights[0] = Number.MAX_SAFE_INTEGER - 10000;
  const optimal = await startOptimal(weights);
  const candidates = page.locator('svg[data-layer="c-candidates"]');
  const forest = page.locator('svg[data-layer="c-merge-tree"]');
  const queueViewport = page.locator('.c-optimal-queue');
  const assertCandidates = async index => {
    const { nodes, candidates: ids } = optimal.steps[index].variables;
    assert.deepEqual(await candidates.locator('[data-avc-key^="idx-"]').allTextContents(), ids.map(id => '#' + id));
    assert.deepEqual(await candidates.locator('[data-avc-key^="gv-"]').allTextContents(), ids.map(id => String(nodes[id].weight)));
    assert.equal(await page.locator('[data-viz-engine="plus-c"] .c-state-tables').count(), 0);
  };
  await assertCandidates(0);
  assert.equal(await queueViewport.getAttribute('tabindex'), '0');
  assert.ok(await queueViewport.evaluate(element => {
    element.scrollTop = element.scrollHeight;
    return element.scrollTop > 0;
  }));
  await page.click('#nextBtn');
  await assertCandidates(1);
  assert.equal(await queueViewport.evaluate(element => element.scrollTop), 0);
  assert.deepEqual(optimal.steps[1].variables.selected, [3, 6]);
  for (const id of [3, 6]) {
    assert.equal(await forest.locator('[data-avc-key="n-' + id + '"] rect').getAttribute('stroke-width'), '2');
  }
  await page.click('#nextBtn');
  await assertCandidates(2);
  const parentPosition = optimal.steps[2].variables.candidates.indexOf(64);
  assert.equal(await candidates.locator(`[data-avc-key="g-${parentPosition}"] rect`).getAttribute('stroke-width'), '2');
  assert.equal(await forest.locator('[data-avc-key="n-64"] rect').getAttribute('stroke-width'), '2');
  for (const [child, tag] of [[3, 'L'], [6, 'R']]) {
    assert.equal(await forest.locator('[data-avc-key="e-64-' + child + '"]').count(), 1);
    assert.equal(await forest.locator('[data-avc-key="et-' + child + '"]').textContent(), tag);
  }
  await page.click('#prevBtn');
  await assertCandidates(1);
  assert.equal(await forest.locator('[data-avc-key="n-64"]').count(), 0);
  await page.locator('[data-tl-ruler]').press('End');
  await assertCandidates(optimal.steps.length - 1);
  assert.equal(await forest.locator('[data-avc-key^="n-"]').count(), 127);
  const root = optimal.result.root;
  assert.ok(await forest.locator(`[data-avc-key="n-${root}"] rect`).evaluate(rect => {
    const viewport = rect.closest('.c-optimal-tree-viewport');
    const bounds = viewport.getBoundingClientRect();
    const cell = rect.getBoundingClientRect();
    return viewport.scrollWidth > viewport.clientWidth && cell.left >= bounds.left - 1 &&
      cell.right <= bounds.left + viewport.clientWidth + 1 && cell.top >= bounds.top - 1;
  }));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  for (const input of [[], [7]]) {
    await page.click('#c-edit');
    const run = await startOptimal(input);
    await page.locator('[data-tl-ruler]').press('End');
    assert.equal(run.result.cost, 0);
    assert.equal(await forest.locator('[data-avc-key^="n-"]').count(), input.length);
    assert.deepEqual(await candidates.locator('[data-avc-key^="gv-"]').allTextContents(), input.map(String));
  }

  await selectWorkbenchAlgorithm(page, 'multiway-merge');
  const mergeRuns = Array.from({ length: 4 }, (_, run) =>
    Array.from({ length: 32 }, (_, index) => index * 2 + run % 2 - 32));
  mergeRuns[1][0] = mergeRuns[0][0];
  mergeRuns[3][31] = Number.MAX_SAFE_INTEGER;
  await page.fill('#c-data', mergeRuns.map(run => run.join(',')).join('\n'));
  await page.fill('#c-param', '2');
  const mergePending = page.waitForResponse(response => response.url().endsWith('/api/algorithms/multiway-merge/runs'));
  await page.click('#startBtn');
  const mergeResponse = await mergePending;
  assert.equal(mergeResponse.status(), 200);
  const merge = await mergeResponse.json();
  await page.locator('#c-edit').waitFor();
  const timeline = page.locator('[data-tl-ruler]');
  const output = page.locator('svg[data-layer="c-output"]');
  const outputValues = output.locator('[data-avc-key^="gv-"]');
  const input = run => page.locator('svg[data-layer="c-input-' + run + '"]');
  const countInputs = page.locator('.c-merge-inputs .array-animation-row');
  const outputViewport = page.locator('.c-merge-output .array-animation-track');
  const assertMergeStep = async index => {
    const step = merge.steps[index];
    assert.equal(await timeline.getAttribute('aria-valuenow'), String(index + 1));
    assert.equal(await page.locator('#code-lines .active').getAttribute('data-line-id'), step.lineId);
    assert.deepEqual(await outputValues.allTextContents(), step.variables.output.map(String));
  };
  assert.equal(await countInputs.count(), 4);
  assert.deepEqual(await input(0).locator('[data-avc-key^="gv-"]').allTextContents(), mergeRuns[0].map(String));
  await timeline.press('ArrowRight');
  await timeline.press('ArrowRight');
  await assertMergeStep(2);
  assert.equal(merge.steps[2].variables.selected.run, 0);
  assert.equal(await input(0).locator('[data-avc-key="g-0"] rect').getAttribute('fill'), '#fdf1e0');
  assert.match(await page.locator('[data-explain-host] .bsviz-status').textContent(), /候选值相同时/);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  assert.ok(await timeline.evaluate(ruler => {
    ruler.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    return document.querySelector('.array-animation-moving-value')?.getAnimations().length > 0;
  }));
  await assertMergeStep(3);
  assert.equal(await input(0).locator('[data-avc-key="g-1"] rect').getAttribute('stroke-width'), '2');
  assert.match(await page.locator('[data-explain-host] .bsviz-status').textContent(), /来源游标 移到下标 1/);
  await timeline.press('ArrowLeft');
  await assertMergeStep(2);
  assert.equal(await page.locator('.array-animation-moving-value').count(), 0);
  assert.equal(await input(0).locator('[data-avc-key="g-1"] rect').getAttribute('stroke-width'), '1');
  await page.emulateMedia({ reducedMotion: 'reduce' });

  const firstGenerated = merge.steps.findIndex(step => step.event === 'select' && step.variables.producedRuns.length > 0);
  await timeline.press('Home');
  for (let index = 0; index < firstGenerated; index++) await timeline.press('ArrowRight');
  await assertMergeStep(firstGenerated);
  assert.deepEqual(await page.locator('[data-layer="c-generated-0"] [data-avc-key^="gv-"]').allTextContents(),
    merge.steps[firstGenerated].variables.producedRuns[0].map(String));

  await timeline.press('End');
  assert.deepEqual(merge.result, mergeRuns.flat().sort((a, b) => a - b));
  assert.equal(merge.result.length, 128);
  assert.equal(merge.steps.at(-1).variables.pass, 2);
  await assertMergeStep(merge.steps.length - 1);
  assert.equal(await outputViewport.getAttribute('tabindex'), '0');
  assert.ok(await outputViewport.evaluate(element => element.scrollLeft > 0));
  await timeline.press('ArrowLeft');
  await assertMergeStep(merge.steps.length - 2);
  assert.equal(await output.count(), 0);
  await timeline.press('ArrowLeft');
  await assertMergeStep(merge.steps.length - 3);
  assert.equal(await countInputs.count(), 2);
  assert.equal(await page.locator('.c-multiway-merge table').count(), 0);
  await timeline.press('ArrowLeft');
  await assertMergeStep(merge.steps.length - 4);
  const lastWrite = output.locator('[data-avc-key="g-127"] rect');
  assert.equal(await lastWrite.getAttribute('stroke-width'), '2');
  assert.ok(await lastWrite.evaluate(rect => {
    const viewport = rect.closest('.array-animation-track').getBoundingClientRect();
    const cell = rect.getBoundingClientRect();
    return cell.left >= viewport.left - 1 && cell.right <= viewport.right + 1;
  }));
  await timeline.press('ArrowLeft');
  await assertMergeStep(merge.steps.length - 5);
  assert.equal(await lastWrite.count(), 0);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  await page.click('#c-edit');
  await page.fill('#c-data', Array.from({ length: 32 }, (_, index) => String(31 - index)).join('\n'));
  await page.fill('#c-param', '32');
  await page.click('#startBtn');
  await page.locator('#c-edit').waitFor();
  await timeline.press('ArrowRight');
  await timeline.press('ArrowRight');
  assert.equal(await countInputs.count(), 32);
  assert.ok(await input(31).locator('[data-avc-key="g-0"] rect').evaluate(rect => {
    const panel = rect.closest('.c-merge-inputs');
    const bounds = panel.getBoundingClientRect();
    const cell = rect.getBoundingClientRect();
    return panel.scrollTop > 0 && cell.top >= bounds.top - 1 && cell.bottom <= bounds.bottom + 1;
  }));

  await selectWorkbenchAlgorithm(page, 'replacement-selection');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const firstRun = Array(64).fill(10);
  const laterValues = Array.from({ length: 64 }, (_, index) => index % 2 ? -3 : -4);
  laterValues[63] = Number.MIN_SAFE_INTEGER;
  await page.fill('#c-data', [...firstRun, ...laterValues].join(','));
  await page.fill('#c-param', '64');
  const replacementPending = page.waitForResponse(response => response.url().endsWith('/api/algorithms/replacement-selection/runs'));
  await page.click('#startBtn');
  const replacementResponse = await replacementPending;
  assert.equal(replacementResponse.status(), 200);
  const replacement = await replacementResponse.json();
  await page.locator('#c-edit').waitFor();
  const buffer = id => page.locator('svg[data-layer="' + id + '"]');
  const completed = page.locator('.c-replacement-completed .array-animation-row');
  const assertReplacementStep = async index => {
    const step = replacement.steps[index];
    assert.equal(await timeline.getAttribute('aria-valuenow'), String(index + 1));
    assert.equal(await page.locator('#code-lines .active').getAttribute('data-line-id'), step.lineId);
    for (const [id, entries] of [['c-active', step.variables.active], ['c-frozen', step.variables.frozen]]) {
      assert.deepEqual(await buffer(id).locator('[data-avc-key^="gv-"]').allTextContents(), entries.map(entry => String(entry.value)));
      assert.deepEqual(await buffer(id).locator('[data-avc-key^="idx-"]').allTextContents(), entries.map(entry => '#' + entry.index));
    }
    assert.deepEqual(await buffer('c-current-run').locator('[data-avc-key^="gv-"]').allTextContents(), step.variables.currentRun.map(String));
    assert.equal(await completed.count(), step.variables.runs.length);
    for (const [index, segment] of step.variables.runs.entries()) {
      assert.deepEqual(await buffer('c-replacement-result-' + index).locator('[data-avc-key^="gv-"]').allTextContents(),
        segment.map(String));
    }
    assert.equal(await page.locator('.c-replacement-selection table').count(), 0);
  };
  await timeline.press('ArrowRight');
  await assertReplacementStep(1);
  assert.equal(replacement.steps[1].variables.active.length, 64);
  await timeline.press('End');
  await assertReplacementStep(replacement.steps.length - 1);
  assert.deepEqual(replacement.result, [firstRun, [...laterValues].sort((a, b) => a - b)]);
  assert.equal(await buffer('c-current-run').count(), 0);
  const lastFreeze = replacement.steps.findLastIndex(step => step.event === 'freeze');
  for (let index = replacement.steps.length - 1; index > lastFreeze; index--) await timeline.press('ArrowLeft');
  await assertReplacementStep(lastFreeze);
  assert.equal(replacement.steps[lastFreeze].variables.frozen.length, 64);
  const frozenLast = buffer('c-frozen').locator('[data-avc-key="g-63"] rect');
  assert.equal(await frozenLast.getAttribute('stroke-width'), '2');
  assert.ok(await frozenLast.evaluate(rect => {
    const container = rect.closest('.array-animation-track');
    const view = container.getBoundingClientRect();
    const cell = rect.getBoundingClientRect();
    return container.scrollLeft > 0 && cell.left >= view.left - 1 && cell.right <= view.right + 1;
  }), 'the newly frozen element is in view');
  await timeline.press('ArrowRight');
  await assertReplacementStep(lastFreeze + 1);
  assert.equal(await completed.count(), 1);
  await timeline.press('ArrowRight');
  await assertReplacementStep(lastFreeze + 2);
  assert.equal(await buffer('c-active').locator('[data-avc-key="idx-0"]').textContent(), '#127');
  await timeline.press('ArrowLeft');
  await timeline.press('ArrowLeft');
  await timeline.press('ArrowLeft');
  await assertReplacementStep(lastFreeze - 1);
  assert.equal(await frozenLast.count(), 0);
  assert.equal(await buffer('c-current-run').locator('[data-avc-key="g-63"] rect').getAttribute('stroke-width'), '2');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  await selectWorkbenchAlgorithm(page,'binary-search');
  await page.click('#fillDemo');
  await page.click('#startBtn');
  await page.locator('#code-lines [data-line-id="init-left"].active').waitFor();
  assert.deepEqual(errors,[]);
  console.log('C package workbench acceptance passed.');
} finally {
  await browser?.close();
  server.kill();
}
