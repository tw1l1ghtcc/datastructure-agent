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

const primitive = (svg, key) => svg.locator('[data-avc-key="' + key + '"]');

async function checkFrame(animation, step) {
  const v = step.variables;
  if (Array.isArray(v.nodes)) {
    const svg = animation.locator('[data-avc-svg="d-tree"]');
    assert.equal(await svg.locator('[data-avc-key^="n-k"]').count(), v.nodes.length);
    for (const node of v.nodes) {
      const id = 'k' + node.key;
      assert.equal(await primitive(svg, 'nv-' + id).textContent(), String(node.key));
      for (const [child, side] of [[node.left, 'L'], [node.right, 'R']]) {
        if (child == null) continue;
        assert.equal(await primitive(svg, 'e-' + id + '-k' + child).count(), 1);
        assert.equal(await primitive(svg, 'et-k' + child).textContent(), side);
      }
      if (node.color) {
        assert.equal(await primitive(svg, 'nval-' + id).textContent(), node.color === 'R' ? '红' : '黑');
        assert.equal(await primitive(svg, 'n-' + id).locator('circle').getAttribute('fill'), node.color === 'R' ? '#fdeaea' : '#ffffff');
      } else {
        assert.equal(await primitive(svg, 'nval-' + id).textContent(), 'h=' + node.height + ' · BF=' + node.bf);
      }
    }
  } else if (v.buckets) {
    const svg = animation.locator('[data-avc-svg="d-chain"]');
    if (v.bucketIndex == null) {
      assert.equal(await svg.count(), 0);
      return;
    }
    assert.equal(await svg.getAttribute('aria-label'), '桶 ' + v.bucketIndex + ' 的链');
    for (const [index, key] of v.chain.entries()) {
      assert.equal(await primitive(svg, 'nv-pos' + index).textContent(), String(key));
      if (index > 0) assert.equal(await primitive(svg, 'link-pos' + (index - 1) + '-pos' + index).count(), 1);
    }
    if (step.event === 'found') assert.equal(await primitive(svg, 'nfill-pos' + v.position).locator('rect').getAttribute('fill'), '#e9f8ef');
  } else if (v.slot != null) {
    const svg = animation.locator('[data-avc-svg="d-slots"]');
    assert.equal(await primitive(svg, 'gv-0,' + v.slot).textContent(), v.used[v.slot] ? String(v.table[v.slot]) : '空');
    if (step.event === 'found') assert.equal(await primitive(svg, 'g-0,' + v.slot).locator('rect').getAttribute('fill'), '#e9f8ef');
  }
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
  await page.goto(base+'/#workbench?algorithm=hash-linear-probing');
  const ids=['hash-linear-probing','hash-quadratic-probing','hash-double-hashing','hash-chaining','avl-tree','red-black-tree'];
  for(const id of ids){
    await selectWorkbenchAlgorithm(page,id);
    await page.click('#fillDemo');
    const tree=id==='avl-tree'||id==='red-black-tree';
    if(tree){
      await page.click('#c-next');await page.click('#c-back');await page.click('#c-next');
      assert.equal(await page.inputValue('#c-queries'),id==='avl-tree'?'10':'15');
    }else assert.equal(await page.inputValue('#d-target'),'24');
    const pending=page.waitForResponse(response=>response.url().endsWith('/api/algorithms/'+id+'/runs'));
    await page.click('#startBtn');
    const response=await pending;assert.equal(response.status(),200,id);
    const run=await response.json();
    assert.equal(run.steps.at(-1).event,'found',id);
    if(id==='avl-tree')assert.equal(run.steps.find(step=>step.event==='rotate').variables.root,20);
    await page.locator('#c-edit').waitFor();
    const view=page.locator('.d-state-tables');
    await view.waitFor();
    const animation = page.locator('[data-viz-engine="plus-d"]');
    await animation.waitFor();
    await checkFrame(animation, run.steps[0]);
    for(let step=1;step<run.steps.length;step++){
      await page.click('#nextBtn');
      assert.equal(await page.locator('#code-lines .active').getAttribute('data-line-id'),run.steps[step].lineId,id);
      assert.doesNotMatch(await view.innerText(),/undefined|NaN/);
      assert.equal(await page.locator('.bsviz-caption').textContent(), run.steps[step].description);
      await checkFrame(animation, run.steps[step]);
    }
    assert.match(await view.innerText(),/查询结果/);
    if (tree) {
      assert.deepEqual(await view.locator('caption').allTextContents(), ['本步状态', '查询结果']);
      const found = primitive(animation.locator('[data-avc-svg="d-tree"]'), 'n-k' + run.steps.at(-1).variables.searchResult);
      assert.equal(await found.locator('circle').getAttribute('stroke'), '#0a6b4a');
    } else {
      assert.equal(await view.locator('[data-found="true"]').count(),1,id);
    }
    if(!tree && id!=='hash-chaining') {
      const slots=await view.locator('table').first().locator('tbody tr').evaluateAll(rows=>rows.map(row=>row.cells[1].textContent));
      assert.deepEqual(slots,run.result.map(value=>value===null?'空':String(value)));
    }
    await page.click('#prevBtn');
    await checkFrame(animation, run.steps.at(-2));
    await page.locator('[data-viz-replay]').click();
    await checkFrame(animation, run.steps.at(-2));
    await page.click('#resetBtn');await page.click('#nextBtn');
    const answer=await page.request.post(base+'/api/agent/explain',{
      data:{runId:run.runId,stepIndex:1,question:'解释这一步',hintLevel:2}
    });
    assert.equal(answer.status(),200);
    assert.deepEqual((await answer.json()).stepRefs[0].variables,run.steps[1].variables);
    await page.click('#c-edit');
    if(tree)await page.fill('#c-queries','');else await page.fill('#d-target','');
    const buildPending=page.waitForResponse(response=>response.url().endsWith('/api/algorithms/'+id+'/runs'));
    await page.click('#startBtn');
    assert.equal((await (await buildPending).json()).steps.at(-1).event,'done');
    await page.locator('#c-edit').waitFor();
  }
  for(const id of ['hash-quadratic-probing','hash-double-hashing']){
    await selectWorkbenchAlgorithm(page,id);await page.click('#fillDemo');await page.fill('#c-param','4');
    await page.click('#startBtn');assert.match(await page.locator('#msgBox').innerText(),/素数/);
  }
  const cases=[
    ['hash-linear-probing',{keys:[0,-7,7],capacity:7,target:0},run=>assert.equal(run.steps.at(-1).variables.searchResult,0)],
    ['hash-quadratic-probing',{keys:[0,7,14,21,28],capacity:7},run=>assert.ok(run.steps.some(step=>step.event==='probe-exhausted'))],
    ['hash-double-hashing',{keys:[0],capacity:2,target:9},run=>assert.equal(run.steps.at(-1).event,'not-found')],
    ['hash-chaining',{keys:[0,7],bucketCount:7,target:7},run=>assert.deepEqual(run.result[0],[0,7])],
    ['avl-tree',{keys:[0],target:0},run=>assert.equal(run.result.found,0)],
    ['red-black-tree',{keys:[],target:0},run=>assert.equal(run.result.found,null)]
  ];
  for(const [id,input,check]of cases){
    const response=await page.request.post(base+'/api/algorithms/'+id+'/runs',{data:input});
    assert.equal(response.status(),200);check(await response.json());
  }
  await page.setViewportSize({ width: 390, height: 840 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await selectWorkbenchAlgorithm(page, 'hash-linear-probing');
  await page.fill('#c-data', '0, 1023');
  await page.fill('#c-param', '1024');
  await page.fill('#d-target', '1023');
  let pending = page.waitForResponse(response => response.url().endsWith('/api/algorithms/hash-linear-probing/runs'));
  await page.click('#startBtn');
  const hash = await (await pending).json();
  assert.equal(hash.steps.at(-1).variables.slot, 1023);
  await page.click('[data-t="last"]');
  const slots = page.locator('[data-avc-svg="d-slots"]');
  assert.equal(await primitive(slots, 'cht-6').textContent(), '1023');
  assert.equal(await primitive(slots, 'gv-0,6').textContent(), '1023');
  assert.match(await slots.getAttribute('aria-label'), /1017–1023/);
  assert.equal(await page.locator('.d-state-tables table').first().locator('tbody tr').count(), 1024);

  await selectWorkbenchAlgorithm(page, 'hash-chaining');
  await page.fill('#c-data', '0, 1, 2, 3, 4, 5, 6');
  await page.fill('#c-param', '1');
  await page.fill('#d-target', '6');
  pending = page.waitForResponse(response => response.url().endsWith('/api/algorithms/hash-chaining/runs'));
  await page.click('#startBtn');
  assert.equal((await (await pending).json()).steps.at(-1).variables.position, 6);
  await page.click('[data-t="last"]');
  const chain = page.locator('[data-avc-svg="d-chain"]');
  assert.match(await chain.getAttribute('aria-label'), /3–7 \/ 7/);
  assert.equal(await primitive(chain, 'nv-pos6').textContent(), '6');
  assert.equal(await primitive(chain, 'link-pos5-pos6').count(), 1);
  assert.match(await page.locator('.d-state-tables').innerText(), /0 → 1 → 2 → 3 → 4 → 5 → 6/);

  await selectWorkbenchAlgorithm(page, 'avl-tree');
  const keys = Array.from({ length: 64 }, (_, index) => Number.MAX_SAFE_INTEGER - 63 + index);
  await page.fill('#c-data', keys.join(', '));
  await page.click('#c-next');
  await page.fill('#c-queries', String(keys.at(-1)));
  pending = page.waitForResponse(response => response.url().endsWith('/api/algorithms/avl-tree/runs'));
  await page.click('#startBtn');
  const wideTree = await (await pending).json();
  assert.equal(wideTree.steps.at(-1).variables.searchResult, keys.at(-1));
  await page.click('[data-t="last"]');
  const tree = page.locator('[data-avc-svg="d-tree"]');
  await checkFrame(page.locator('[data-viz-engine="plus-d"]'), wideTree.steps.at(-1));
  assert.ok(await tree.evaluate(svg => {
    const bounds = svg.querySelector('.avc-layer').getBBox();
    const view = svg.viewBox.baseVal;
    return bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= view.width && bounds.y + bounds.height <= view.height;
  }), 'the full tree fits in its SVG');
  assert.ok(await page.locator('[data-viz-body]').evaluate(body => {
    body.scrollLeft = body.scrollWidth;
    return body.scrollLeft > 0 && document.documentElement.scrollWidth <= innerWidth;
  }), 'the tree scrolls inside the workbench at mobile width');

  const invalid=await page.request.post(base+'/api/algorithms/hash-double-hashing/runs',{data:{keys:[1],capacity:4}});
  assert.equal(invalid.status(),400);
  await selectWorkbenchAlgorithm(page,'binary-search');await page.click('#fillDemo');await page.click('#startBtn');
  await page.locator('#code-lines [data-line-id="init-left"].active').waitFor();
  assert.deepEqual(errors,[]);
  console.log('D package workbench acceptance passed.');
}finally{
  await browser?.close();server.kill();
}
