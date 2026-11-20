import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { selectWorkbenchAlgorithm } from './select-workbench-algorithm.mjs';

const { chromium } = await import(process.env.TEST_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.TEST_PLAYWRIGHT_MODULE).href : 'playwright');
const server = spawn(process.execPath, ['backend/src/server.js'], {
  cwd: fileURLToPath(new URL('../', import.meta.url)),
  env: { ...process.env, PORT: '0', HOST: '127.0.0.1', AGENT_MOCK: 'true', RATE_LIMIT: 'false' },
  windowsHide: true,
});
const cases = [
  { id: 'bracket-matching', result: true, field: 'matched', caption: /括号栈/, conclusion: /括号全部匹配/ },
  { id: 'infix-to-postfix', result: ['12','3','4','2','-','*','+'], caption: /后缀序列/ },
  { id: 'expression-evaluation', mode: 'postfix', result: -8, field: 'value', caption: /操作数栈/, conclusion: /表达式结果为 -8/ },
  { id: 'naive-string-match', result: [0,1,2], caption: /匹配位置/ },
  { id: 'kmp', mode: 'nextval', result: [2], caption: /预处理表.*nextval/ },
  { id: 'expression-dag', result: 25, field: 'value', caption: /依赖边/, conclusion: /根节点结果为 25/ },
  { id: 'critical-path', result: 5, field: 'duration', caption: /关键路径/ },
];

const layer = (page, name) => page.locator('[data-viz-engine="plus-f"] [data-avc-svg="f-' + name + '"]');
const cells = (page, name) => layer(page, name).locator('[data-avc-key^="gv-"]').allTextContents();
const display = value => String(value ?? '—');

async function assertAnimation(page, run, step) {
  const stage = page.locator('[data-viz-engine="plus-f"] .avc-svg');
  assert.ok(await stage.count(), step.algorithm);
  assert.doesNotMatch((await stage.allTextContents()).join(' '), /渲染失败|undefined|NaN/);
  const v = step.variables;
  if (step.algorithm === 'bracket-matching') {
    assert.deepEqual(await cells(page, 'brackets'), v.stack.slice(-10).map(item => item.char));
  }
  if (v.operators) {
    assert.deepEqual(await cells(page, 'operators'), v.operators.slice(-10).map(token => token.text));
    assert.deepEqual(await cells(page, 'postfix'), v.output.slice(-10).map(token => token.text));
  }
  if (step.algorithm === 'expression-evaluation') {
    assert.deepEqual(await cells(page, 'operands'), v.stack.slice(-10).map(display));
  }
  if (step.algorithm === 'naive-string-match' || step.algorithm === 'kmp') {
    assert.ok(await layer(page, 'match').count());
    assert.deepEqual(await cells(page, 'matches'), v.matches.slice(-10).map(display));
    if (v.mode && Array.from(run.input.pattern).length <= 10) {
      assert.deepEqual(await cells(page, 'jump-table'), Array.from(run.input.pattern, (_, index) => display(v[v.mode][index])));
    }
  }
  if (step.algorithm === 'expression-dag' && v.nodes.length) {
    const graph = layer(page, 'expression-dag');
    assert.equal(await graph.locator('[data-avc-key^="n-f"]').count(), v.nodes.length);
    assert.equal(await graph.locator('[data-avc-key^="e-f"]').count(), v.edges.length);
    if (step.done) {
      const root = graph.locator('[data-avc-key="ns-f' + v.root + '"]');
      assert.equal(await root.textContent(), '= ' + run.result.value);
    }
  }
  if (step.algorithm === 'critical-path') {
    const graph = layer(page, 'activities');
    assert.equal(await graph.locator('[data-avc-key^="n-f"]').count(), run.input.nodes.length);
    assert.equal(await graph.locator('[data-avc-key^="e-f"]').count(), run.input.edges.length);
    if (step.done && !step.result.error) {
      const critical = graph.locator('[data-avc-key^="e-f"] :is(line, polyline):not([data-role="arrow"])[stroke="#0a6b4a"]');
      assert.equal(await critical.count(), v.criticalEdges.length);
    }
  }
}

async function assertStep(page, run, index) {
  const step = run.steps[index];
  await page.waitForFunction(({ index, lineId }) => (
    document.querySelector('[data-tl-ruler]')?.getAttribute('aria-valuenow') === String(index + 1) &&
    document.querySelector('#code-lines [aria-current="step"]')?.dataset.lineId === lineId
  ), { index, lineId: step.lineId });
  assert.equal(await page.locator('#step-description').textContent(), step.description);
  assert.equal(await page.locator('[data-explain-host] .bsviz-caption').textContent(), step.description);
  await assertAnimation(page, run, step);
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
  await page.goto(base);
  for (const item of cases) {
    const { id, mode, field, result, caption, conclusion } = item;
    await selectWorkbenchAlgorithm(page, id);
    if (mode) await page.selectOption('#f-mode', mode);
    await page.click('#fillDemo');
    const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/algorithms/' + id + '/runs'));
    await page.click('#startBtn');
    const response = await responsePromise;
    assert.equal(response.status(), 200, id);
    const run = await response.json();
    assert.deepEqual(field ? run.result[field] : run.result, result, id);
    if (mode) assert.equal(run.input.mode, mode, id);
    await assertStep(page, run, 0);
    await page.click('#nextBtn');
    await assertStep(page, run, 1);
    await page.click('[data-t="last"]');
    await assertStep(page, run, run.steps.length - 1);
    assert.match(await page.locator('.c-state-tables').innerText(), caption, id);
    const resultTable = page.locator('.c-state-tables caption', { hasText: '运行结果' });
    assert.equal(await resultTable.count(), conclusion ? 0 : 1, id);
    if (conclusion) assert.match(await page.locator('[data-explain-host] .bsviz-caption').textContent(), conclusion, id);
    await page.click('#prevBtn');
    const index = run.steps.length - 2;
    await assertStep(page, run, index);
    const stepResponse = await page.request.get(base + '/api/runs/' + run.runId + '/steps/' + index);
    assert.equal(stepResponse.status(), 200, id);
    assert.deepEqual((await stepResponse.json()).step, run.steps[index]);
    const answer = await page.request.post(base + '/api/agent/explain', {
      data: { runId: run.runId, stepIndex: index, question: '这一步发生了什么？', hintLevel: 2 },
    });
    assert.equal(answer.status(), 200, id);
    const { stepRefs } = await answer.json();
    assert.equal(stepRefs[0].algorithm, id);
    assert.equal(stepRefs[0].stepIndex, index);
    assert.deepEqual(stepRefs[0].variables, run.steps[index].variables);
    await page.click('#resetBtn');
    await assertStep(page, run, 0);
    console.log(id + ' · Plus 动画、状态表、源码、步骤查询、单步回退、重置和 Mock 问答通过');
  }
  await page.click('#c-edit');
  await page.fill('#c-data', 'A, B');
  await page.fill('#f-secondary', 'A, B, 1\nB, A, 1');
  const cycleResponse = page.waitForResponse(response => response.url().endsWith('/api/algorithms/critical-path/runs'));
  await page.click('#startBtn');
  const cycle = await (await cycleResponse).json();
  await assertStep(page, cycle, 0);
  await page.click('[data-t="last"]');
  assert.match(await page.locator('.c-state-tables').innerText(), /有向环/);
  await assertStep(page, cycle, cycle.steps.length - 1);
  const invalid = await page.request.post(base + '/api/algorithms/critical-path/runs', {
    data: { nodes: ['A'], edges: [['A', 'B', 1]], directed: true },
  });
  assert.equal(invalid.status(), 400);
  assert.equal((await invalid.json()).error.code, 'INVALID_INPUT');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.click('#c-edit');
  const labels = Array.from({ length: 30 }, (_, index) => 'V' + index);
  await page.fill('#c-data', labels.join(', '));
  await page.fill('#f-secondary', [...labels.slice(1).map((label, i) => labels[i] + ', ' + label + ', 1'), 'V0, V1, 2'].join('\n'));
  const longResponse = page.waitForResponse(response => response.url().endsWith('/api/algorithms/critical-path/runs'));
  await page.click('#startBtn');
  const longRun = await (await longResponse).json();
  assert.equal(longRun.result.duration, 30);
  await page.click('[data-t="last"]');
  await assertStep(page, longRun, longRun.steps.length - 1);
  const graph = layer(page, 'activities');
  const parallel = await graph.locator('[data-avc-key^="e-f0-f1"] polyline:not([data-role="arrow"])').evaluateAll(edges => edges.map(edge => edge.getAttribute('points')));
  assert.equal(parallel.length, 2);
  assert.notEqual(parallel[0], parallel[1]);
  assert.ok(await graph.evaluate(svg => {
    const box = svg.querySelector('.avc-layer').getBBox();
    const { width, height } = svg.viewBox.baseVal;
    return box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height;
  }), 'all vertices fit the wide graph canvas');
  assert.ok(await page.locator('[data-viz-body]').evaluate(body => {
    body.scrollLeft = body.scrollWidth;
    return body.scrollLeft > 0 && document.documentElement.scrollWidth <= innerWidth;
  }), 'the graph scrolls within the workbench');

  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  server.kill();
}
