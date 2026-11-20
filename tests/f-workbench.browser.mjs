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
  { id: 'bracket-matching', result: true, field: 'matched', conclusion: /括号全部匹配/ },
  { id: 'infix-to-postfix', result: ['12','3','4','2','-','*','+'], conclusion: /转换完成/ },
  { id: 'expression-evaluation', mode: 'postfix', result: -8, field: 'value', caption: /操作数栈/, conclusion: /表达式结果为 -8/ },
  { id: 'naive-string-match', result: [0,1,2], caption: /匹配位置/ },
  { id: 'kmp', mode: 'nextval', result: [2], caption: /预处理表.*nextval/ },
  { id: 'expression-dag', result: 25, field: 'value', caption: /依赖边/, conclusion: /根节点结果为 25/ },
  { id: 'critical-path', result: 5, field: 'duration', caption: /关键路径/, conclusion: /总工期为 5/ },
];

const layer = (page, name) => page.locator('[data-viz-engine="plus-f"] [data-avc-svg="f-' + name + '"]');
const cells = (page, name) => layer(page, name).locator('[data-avc-key^="gv-"]').allTextContents();
const indices = (page, name) => layer(page, name).locator('[data-avc-key^="idx-"]').allTextContents();
const display = value => String(value ?? '—');

async function assertScrolledTo(cell) {
  const bounds = await cell.evaluate(rect => {
    const track = rect.closest('.f-sequence-track');
    const { left, right } = rect.getBoundingClientRect();
    const viewLeft = track.getBoundingClientRect().left;
    return { left, right, viewLeft, viewRight: viewLeft + track.clientWidth, scroll: track.scrollLeft };
  });
  assert.ok(bounds.scroll > 0 && bounds.left >= bounds.viewLeft && bounds.right <= bounds.viewRight + 1, JSON.stringify(bounds));
}

async function assertAnimation(page, run, step) {
  const stage = page.locator('[data-viz-engine="plus-f"] .avc-svg');
  assert.ok(await stage.count(), step.algorithm);
  assert.doesNotMatch((await stage.allTextContents()).join(' '), /渲染失败|undefined|NaN/);
  const v = step.variables;
  if (step.algorithm === 'bracket-matching') {
    assert.deepEqual(await cells(page, 'brackets'), v.stack.map(item => item.char));
    assert.deepEqual(await indices(page, 'brackets'), v.stack.map(item => String(item.i)));
  }
  if (v.operators) {
    const full = step.algorithm === 'infix-to-postfix';
    const operators = full ? v.operators : v.operators.slice(-10);
    const output = full ? v.output : v.output.slice(-10);
    assert.deepEqual(await cells(page, 'operators'), operators.map(token => token.text));
    assert.deepEqual(await cells(page, 'postfix'), output.map(token => token.text));
    if (full) {
      assert.deepEqual(await indices(page, 'operators'), operators.map(token => String(token.index)));
      assert.deepEqual(await indices(page, 'postfix'), output.map(token => String(token.index)));
    }
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
  const explanation = page.locator('[data-explain-host]');
  const stateTables = page.locator('.c-state-tables');
  const rows = title => stateTables.locator('table')
    .filter({ has: page.locator('caption', { hasText: title }) }).locator('tbody tr');
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
    if (id === 'infix-to-postfix') {
      await page.click('#nextBtn');
      await page.click('#nextBtn');
      await assertStep(page, run, 3);
      assert.deepEqual(await cells(page, 'operators'), ['+']);
      assert.deepEqual(await cells(page, 'postfix'), ['12']);
      assert.ok(await page.locator('.f-sequence-animation').evaluate(animation => {
        const viewport = animation.closest('[data-viz-body]');
        return animation.getBoundingClientRect().bottom <= viewport.getBoundingClientRect().bottom;
      }), 'all three rows fit in the desktop demo viewport');
    }
    await page.click('[data-t="last"]');
    await assertStep(page, run, run.steps.length - 1);
    if (caption) assert.match(await stateTables.innerText(), caption, id);
    else assert.equal(await stateTables.count(), 0, id);
    assert.equal(await stateTables.locator('caption', { hasText: '运行结果' }).count(), 0, id);
    if (conclusion) assert.match(await explanation.locator('.bsviz-caption').textContent(), conclusion, id);
    if (id === 'infix-to-postfix') {
      assert.deepEqual(await cells(page, 'infix'), ['12', '+', '3', '*', '(', '4', '-', '2', ')']);
      assert.deepEqual(await indices(page, 'infix'), ['0', '2', '3', '4', '5', '6', '7', '8', '9']);
      assert.deepEqual(await cells(page, 'postfix'), result);
    }
    if (id === 'naive-string-match' || id === 'kmp') {
      assert.equal(await rows('匹配位置').locator('td').textContent(), result.join('、'));
    }
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
    if (id === 'bracket-matching') {
      await page.click('#c-edit');
      const text = '😀\t(a' + '['.repeat(116);
      await page.fill('#c-data', text);
      const pending = page.waitForResponse(other => other.url().endsWith('/api/algorithms/bracket-matching/runs'));
      await page.click('#startBtn');
      const long = await (await pending).json();
      assert.deepEqual(long.result, { matched: false, index: 119, reason: 'unclosed' });
      await page.click('[data-t="last"]');
      await assertStep(page, long, long.steps.length - 1);
      assert.deepEqual(await cells(page, 'text'), ['😀', '制表符', '(', 'a', ...Array(116).fill('[')]);
      const source = layer(page, 'text');
      const brackets = layer(page, 'brackets');
      assert.equal(await source.locator('[data-avc-key="idx-119"]').textContent(), '119');
      assert.equal(await brackets.locator('[data-avc-key="idx-0"]').textContent(), '2');
      assert.equal(await brackets.locator('[data-avc-key="idx-116"]').textContent(), '119');
      await assertScrolledTo(source.locator('[data-avc-key="g-119"] rect'));
      await assertScrolledTo(brackets.locator('[data-avc-key="g-116"] rect'));
      assert.match(await explanation.locator('.bsviz-caption').textContent(), /左括号尚未闭合/);
      await page.click('#resetBtn');
      await assertStep(page, long, 0);
      assert.equal(await source.evaluate(svg => svg.closest('.f-sequence-track').scrollLeft), 0);
      assert.ok(await page.getByText('栈为空', { exact: true }).isVisible());
    }
    if (id === 'infix-to-postfix') {
      const path = '/api/algorithms/infix-to-postfix/runs';
      const literal = '0000000000000012';
      const expression = literal + ' + 1'.repeat(14);
      await page.click('#c-edit');
      await page.fill('#c-data', expression);
      const pending = page.waitForResponse(other => other.url().endsWith(path));
      await page.click('#startBtn');
      const long = await (await pending).json();
      await page.click('[data-t="last"]');
      await assertStep(page, long, long.steps.length - 1);
      assert.equal((await cells(page, 'postfix')).length, 29);
      assert.equal(await layer(page, 'infix').locator('[data-avc-key="g-0"] title').textContent(), literal);
      await assertScrolledTo(layer(page, 'postfix').locator('[data-avc-key="g-28"] rect'));

      await page.click('#c-edit');
      await page.fill('#c-data', '12 +');
      const invalidPending = page.waitForResponse(other => other.url().endsWith(path));
      await page.click('#startBtn');
      const invalid = await (await invalidPending).json();
      await page.click('[data-t="last"]');
      await assertStep(page, invalid, invalid.steps.length - 1);
      assert.deepEqual(await cells(page, 'infix'), ['12', '+', '末尾']);
      assert.deepEqual(await indices(page, 'infix'), ['0', '3', '4']);
      assert.match(await explanation.locator('.bsviz-caption').textContent(), /缺少操作数/);
    }
    console.log(id + ' · Plus 动画、状态显示、源码、步骤查询、单步回退、重置和 Mock 问答通过');
  }
  await page.click('#c-edit');
  await page.fill('#c-data', 'A, B');
  await page.fill('#f-secondary', 'A, B, 1\nB, A, 1');
  const cycleResponse = page.waitForResponse(response => response.url().endsWith('/api/algorithms/critical-path/runs'));
  await page.click('#startBtn');
  const cycle = await (await cycleResponse).json();
  await assertStep(page, cycle, 0);
  await page.click('[data-t="last"]');
  await assertStep(page, cycle, cycle.steps.length - 1);
  assert.match(await explanation.locator('.bsviz-caption').textContent(), /有向环/);
  const invalid = await page.request.post(base + '/api/algorithms/critical-path/runs', {
    data: { nodes: ['A'], edges: [['A', 'B', 1]], directed: true },
  });
  assert.equal(invalid.status(), 400);
  assert.equal((await invalid.json()).error.code, 'INVALID_INPUT');
  await page.click('#c-edit');
  await page.fill('#c-data', 'A, B');
  await page.fill('#f-secondary', Array(9).fill('A, B, 1').join('\n'));
  const manyPathsResponse = page.waitForResponse(response => response.url().endsWith('/api/algorithms/critical-path/runs'));
  await page.click('#startBtn');
  const manyPathsRun = await (await manyPathsResponse).json();
  assert.equal(manyPathsRun.result.morePaths, true);
  await page.click('[data-t="last"]');
  await assertStep(page, manyPathsRun, manyPathsRun.steps.length - 1);
  assert.equal(await rows('关键路径').count(), 8);
  const stepStatus = explanation.locator('.bsviz-status');
  assert.match(await stepStatus.textContent(), /表中仅展示前 8 条关键路径/);
  await page.click('#prevBtn');
  await assertStep(page, manyPathsRun, manyPathsRun.steps.length - 2);
  assert.doesNotMatch(await stepStatus.textContent(), /前 8 条/);
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
