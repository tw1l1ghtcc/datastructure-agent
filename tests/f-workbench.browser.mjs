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
  { id: 'bracket-matching', result: true, field: 'matched' },
  { id: 'infix-to-postfix', result: ['12','3','4','2','-','*','+'] },
  { id: 'expression-evaluation', mode: 'postfix', result: -8, field: 'value' },
  { id: 'naive-string-match', result: [0,1,2] },
  { id: 'kmp', mode: 'nextval', result: [2] },
  { id: 'expression-dag', result: 25, field: 'value' },
  { id: 'critical-path', result: 5, field: 'duration', caption: /关键路径/ },
];

const layer = (page, name) => page.locator('[data-viz-engine="plus-f"] [data-avc-svg="f-' + name + '"]');
const cells = (page, name) => layer(page, name).locator('[data-avc-key^="gv-"]').allTextContents();
const display = value => String(value ?? '—');

async function startStringMatch(page, algorithm, text, pattern) {
  await page.fill('#c-data', text);
  await page.fill('#f-secondary', pattern);
  const pending = page.waitForResponse(response => response.url().endsWith('/api/algorithms/' + algorithm + '/runs'));
  await page.click('#startBtn');
  const response = await pending;
  assert.equal(response.status(), 200);
  return response.json();
}

async function assertAnimation(page, run, step) {
  const stage = page.locator('[data-viz-engine="plus-f"] .avc-svg');
  assert.ok(await stage.count(), step.algorithm);
  assert.doesNotMatch((await stage.allTextContents()).join(' '), /渲染失败|undefined|NaN/);
  const v = step.variables;
  if (step.algorithm === 'bracket-matching') {
    assert.equal(await page.locator('.c-state-tables').count(), 0);
    assert.deepEqual(await cells(page, 'brackets'), v.stack.map(item => item.char));
    assert.deepEqual(await layer(page, 'brackets').locator('[data-avc-key^="idx-"]').allTextContents(), v.stack.map(item => String(item.i)));
  }
  if (v.operators) {
    assert.equal(await page.locator('.c-state-tables').count(), 0);
    for (const [name, tokens] of [['operators', v.operators], ['postfix', v.output]]) {
      assert.deepEqual(await cells(page, name), tokens.map(token => token.text));
      assert.deepEqual(await layer(page, name).locator('[data-avc-key^="idx-"]').allTextContents(), tokens.map(token => String(token.index)));
    }
  }
  if (step.algorithm === 'expression-evaluation') {
    assert.deepEqual(await cells(page, 'operands'), v.stack.map(display));
    if (v.mode === 'postfix') assert.equal(await layer(page, 'operators').count(), 0);
  }
  if (step.algorithm === 'naive-string-match' || step.algorithm === 'kmp') {
    assert.ok(await layer(page, 'match').count());
    assert.equal(await page.locator('.c-state-tables').count(), 0);
    assert.deepEqual(await cells(page, 'matches'), v.matches.map(display));
    if (step.algorithm === 'kmp') {
      const expected = Array.from(run.input.pattern, (_, index) => [v.prefix[index], v.next[index], v.nextval[index]].map(display)).flat();
      const displayed = (await cells(page, 'kmp-table')).filter((_, index) => index % 4 !== 0);
      assert.deepEqual(displayed, expected);
    }
  }
  if (step.algorithm === 'expression-dag' && v.nodes.length) {
    const graph = layer(page, 'expression-dag');
    assert.deepEqual(await cells(page, 'build-stack'), v.stack.map(display));
    assert.equal(await graph.locator('[data-avc-key^="n-f"]').count(), v.nodes.length);
    assert.equal(await graph.locator('[data-avc-key^="e-f"]').count(), v.edges.length);
    if (step.done && !step.result.error) {
      const root = graph.locator('[data-avc-key="ns-f' + v.root + '"]');
      assert.equal(await root.textContent(), '#' + v.root + ' = ' + run.result.value);
      assert.equal(await graph.locator('[data-avc-key="nb-f' + v.root + '"]').textContent(), '根');
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
    const { id, mode, field, result, caption } = item;
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
    if (caption) assert.match(await page.locator('.c-state-tables').innerText(), caption, id);
    else if (id === 'bracket-matching') assert.match(await layer(page, 'text').getAttribute('aria-label'), /匹配成功/);
    else if (id === 'expression-evaluation') assert.match(await layer(page, 'operands').getAttribute('aria-label'), /结果 -8/);
    else if (id === 'naive-string-match') assert.match(await layer(page, 'matches').getAttribute('aria-label'), /3 处/);
    else if (id === 'kmp') assert.match(await layer(page, 'kmp-table').getAttribute('aria-label'), /当前使用 nextval/);
    else if (id === 'expression-dag') {
      const shared = run.result.nodes.find(node => node.token === '+');
      const graph = layer(page, 'expression-dag');
      const pair = '-f' + shared.id + '-f' + run.result.root;
      assert.deepEqual(await graph.locator('[data-avc-key^="w' + pair + '"]').allTextContents(), ['左', '右']);
      const edges = await graph.locator('[data-avc-key^="e' + pair + '"] polyline:not([data-role="arrow"])')
        .evaluateAll(elements => elements.map(element => element.getAttribute('points')));
      assert.equal(edges.length, 2);
      assert.notEqual(edges[0], edges[1]);
      assert.equal(run.steps.filter(step => step.event === 'evaluate' && step.variables.currentNode === shared.id).length, 1);
    } else assert.match(await layer(page, 'postfix').getAttribute('aria-label'), /转换完成/);
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
    console.log(id + ' · Plus 动画、源码、步骤查询、单步回退、重置和 Mock 问答通过');
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

  await selectWorkbenchAlgorithm(page, 'bracket-matching');
  const bracketText = '🙂\t' + '('.repeat(117) + ']';
  await page.fill('#c-data', bracketText);
  const bracketResponse = page.waitForResponse(response => response.url().endsWith('/api/algorithms/bracket-matching/runs'));
  await page.click('#startBtn');
  const brackets = await (await bracketResponse).json();
  assert.deepEqual(brackets.result, { matched: false, index: 119, reason: 'mismatch' });
  await assertStep(page, brackets, 0);
  assert.deepEqual(await cells(page, 'text'), ['🙂', '制表符', ...Array(117).fill('('), ']']);
  await page.click('[data-t="last"]');
  await assertStep(page, brackets, brackets.steps.length - 1);
  assert.match(await layer(page, 'text').getAttribute('aria-label'), /下标 119 未匹配/);
  for (const [name, index] of [['text', 119], ['brackets', 116]]) {
    const cell = layer(page, name).locator('[data-avc-key="g-' + index + '"] rect');
    assert.equal(await cell.getAttribute('stroke-width'), '2');
    assert.ok(await cell.evaluate(rect => {
      const viewport = rect.closest('.avc-svg-wrap');
      const r = rect.getBoundingClientRect();
      const v = viewport.getBoundingClientRect();
      return viewport.scrollTop > 0 && r.top >= v.top - 1 && r.bottom <= v.bottom + 1;
    }), 'the current ' + name + ' cell has been scrolled into view');
  }
  await page.click('#prevBtn');
  await assertStep(page, brackets, brackets.steps.length - 2);
  assert.equal(await layer(page, 'text').getAttribute('aria-label'), '原字符串');
  await page.click('#resetBtn');
  await assertStep(page, brackets, 0);
  assert.equal(await layer(page, 'text').evaluate(svg => svg.parentElement.scrollTop), 0);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'bracket cards fit the mobile workbench');

  await selectWorkbenchAlgorithm(page, 'infix-to-postfix');
  await page.fill('#c-data', '('.repeat(20) + '2147483647' + ')'.repeat(20) + ' + 12'.repeat(11));
  const conversionResponse = page.waitForResponse(response => response.url().endsWith('/api/algorithms/infix-to-postfix/runs'));
  await page.click('#startBtn');
  const conversion = await (await conversionResponse).json();
  assert.deepEqual(conversion.result, ['2147483647', ...Array.from({ length: 11 }, () => ['12', '+']).flat()]);
  const ruler = page.locator('[data-tl-ruler]');
  for (let index = 0; index < 21; index++) await ruler.press('ArrowRight');
  await assertStep(page, conversion, 21);
  assert.equal(conversion.steps[21].variables.operators.length, 20);
  const operators = layer(page, 'operators');
  assert.equal(await operators.locator('[data-avc-key="g-19"] rect').getAttribute('stroke-width'), '2');
  assert.ok(await operators.evaluate(svg => svg.parentElement.scrollTop > 0));
  await ruler.press('End');
  await assertStep(page, conversion, conversion.steps.length - 1);
  await ruler.press('ArrowLeft');
  await assertStep(page, conversion, conversion.steps.length - 2);
  const postfix = layer(page, 'postfix');
  assert.equal(await postfix.locator('[data-avc-key="g-22"] rect').getAttribute('stroke-width'), '2');
  assert.ok(await postfix.evaluate(svg => svg.parentElement.scrollTop > 0));
  await ruler.press('ArrowLeft');
  await assertStep(page, conversion, conversion.steps.length - 3);
  assert.equal(await postfix.locator('[data-avc-key="gv-22"]').count(), 0);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'conversion cards fit the mobile workbench');

  await page.click('#c-edit');
  await page.fill('#c-data', '(1 + 2');
  const syntaxResponse = page.waitForResponse(response => response.url().endsWith('/api/algorithms/infix-to-postfix/runs'));
  await page.click('#startBtn');
  const syntax = await (await syntaxResponse).json();
  await ruler.press('End');
  await assertStep(page, syntax, syntax.steps.length - 1);
  assert.match(syntax.result.error, /左括号未闭合.*下标 0/);
  assert.match(await postfix.getAttribute('aria-label'), /左括号未闭合.*下标 0/);

  await selectWorkbenchAlgorithm(page, 'expression-evaluation');
  await page.selectOption('#f-mode', 'postfix');
  await page.fill('#c-data', [...Array(32).fill('1'), ...Array(31).fill('+')].join(' '));
  const evaluationResponse = page.waitForResponse(response => response.url().endsWith('/api/algorithms/expression-evaluation/runs'));
  await page.click('#startBtn');
  const evaluation = await (await evaluationResponse).json();
  assert.deepEqual(evaluation.result, { value: 32 });
  for (let index = 0; index < 33; index++) await ruler.press('ArrowRight');
  await assertStep(page, evaluation, 33);
  assert.equal(evaluation.steps[33].variables.stack.length, 32);
  const operands = layer(page, 'operands');
  for (const svg of [operands, postfix]) {
    assert.equal(await svg.locator('[data-avc-key="g-31"] rect').getAttribute('stroke-width'), '2');
    assert.ok(await svg.evaluate(element => element.parentElement.scrollTop > 0));
  }
  await ruler.press('End');
  await assertStep(page, evaluation, evaluation.steps.length - 1);
  assert.match(await operands.getAttribute('aria-label'), /结果 32/);
  await ruler.press('ArrowLeft');
  await ruler.press('ArrowLeft');
  await assertStep(page, evaluation, evaluation.steps.length - 3);
  assert.deepEqual(await cells(page, 'operands'), ['1', '31']);

  await page.click('#c-edit');
  await page.selectOption('#f-mode', 'infix');
  await page.fill('#c-data', '8/(2-2)');
  const arithmeticResponse = page.waitForResponse(response => response.url().endsWith('/api/algorithms/expression-evaluation/runs'));
  await page.click('#startBtn');
  const arithmetic = await (await arithmeticResponse).json();
  const open = arithmetic.steps.findIndex(step => step.event === 'push-open');
  for (let index = 0; index < open; index++) await ruler.press('ArrowRight');
  await assertStep(page, arithmetic, open);
  assert.deepEqual(await cells(page, 'operators'), ['/', '(']);
  await ruler.press('End');
  await assertStep(page, arithmetic, arithmetic.steps.length - 1);
  assert.match(await operands.getAttribute('aria-label'), /除数为零.*下标 1/);
  assert.equal(await postfix.locator('[data-avc-key="idx-4"]').textContent(), '1');
  assert.equal(await postfix.locator('[data-avc-key="g-4"] rect').getAttribute('stroke-width'), '2');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'evaluation cards fit the mobile workbench');

  await selectWorkbenchAlgorithm(page, 'naive-string-match');
  const longText = '\t🙂' + 'a'.repeat(118);
  const longPattern = 'a'.repeat(48);
  const longMatch = await startStringMatch(page, 'naive-string-match', longText, longPattern);
  assert.deepEqual(longMatch.result, Array.from({ length: 71 }, (_, index) => index + 2));
  await assertStep(page, longMatch, 0);
  const alignment = layer(page, 'match');
  const rows = await alignment.locator('[data-avc-key^="gv-"]').evaluateAll(elements => {
    const strings = [[], []];
    for (const element of elements) {
      const row = Number(element.dataset.avcKey.slice(3).split(',')[0]) % 4;
      if (row < 2 && element.textContent) strings[row].push(element.textContent);
    }
    return strings;
  });
  assert.deepEqual(rows, [['制表符', '🙂', ...Array(118).fill('a')], Array(48).fill('a')]);
  await ruler.press('ArrowRight');
  await ruler.press('ArrowRight');
  await assertStep(page, longMatch, 2);
  assert.equal(longMatch.steps[2].variables.equal, false);
  assert.equal(await alignment.locator('[data-avc-key="g-0,0"] rect').getAttribute('stroke-width'), '2');
  await ruler.press('End');
  await assertStep(page, longMatch, longMatch.steps.length - 1);
  assert.match(await layer(page, 'matches').getAttribute('aria-label'), /71 处/);
  await ruler.press('ArrowLeft');
  await assertStep(page, longMatch, longMatch.steps.length - 2);
  assert.equal(await layer(page, 'matches').locator('[data-avc-key="g-70"] rect').getAttribute('stroke-width'), '2');
  await ruler.press('ArrowLeft');
  await assertStep(page, longMatch, longMatch.steps.length - 3);
  assert.equal(await layer(page, 'matches').locator('[data-avc-key="gv-70"]').count(), 0);
  assert.equal(await alignment.locator('[data-avc-key="gv-75,5"]').textContent(), '119');
  assert.equal(await alignment.locator('[data-avc-key="gv-78,5"]').textContent(), '47');
  for (const row of [76, 77]) {
    const cell = alignment.locator('[data-avc-key="g-' + row + ',5"] rect');
    assert.equal(await cell.getAttribute('stroke-width'), '2');
    assert.ok(await cell.evaluate(rect => {
      const viewport = rect.closest('.avc-svg-wrap');
      const r = rect.getBoundingClientRect();
      const v = viewport.getBoundingClientRect();
      return viewport.scrollTop > 0 && r.top >= v.top - 1 && r.bottom <= v.bottom + 1;
    }), 'both compared cells are visible');
  }
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'alignment fits the mobile workbench');
  for (const [pattern, result] of [['', [0]], ['aa', []]]) {
    await page.click('#c-edit');
    const run = await startStringMatch(page, 'naive-string-match', 'a', pattern);
    await ruler.press('End');
    await assertStep(page, run, run.steps.length - 1);
    assert.deepEqual(run.result, result);
    assert.match(await layer(page, 'matches').getAttribute('aria-label'), new RegExp(result.length + ' 处'));
  }

  await selectWorkbenchAlgorithm(page, 'kmp');
  const preprocessing = layer(page, 'kmp-table');
  for (const [mode, jump] of [['next', 1], ['nextval', -1]]) {
    if (mode === 'nextval') await page.click('#c-edit');
    await page.selectOption('#f-mode', mode);
    const run = await startStringMatch(page, 'kmp', 'aab', 'aaa');
    const fallback = run.steps.findIndex(step => step.event === 'fallback');
    for (let index = 0; index < fallback; index++) await ruler.press('ArrowRight');
    await assertStep(page, run, fallback);
    assert.deepEqual(run.result, []);
    assert.equal(run.steps[fallback].variables.jump, jump);
    assert.match(await preprocessing.getAttribute('aria-label'), new RegExp('当前使用 ' + mode + '$'));
    assert.deepEqual(await cells(page, 'kmp-table'), ['a', '0', '-1', '-1', 'a', '1', '0', '-1', 'a', '2', '1', '-1']);
    assert.equal(await preprocessing.locator('[data-avc-key="g-2,0"] rect').getAttribute('stroke-width'), '2');
    if (jump >= 0) {
      const destination = preprocessing.locator('[data-avc-key="g-1,0"] rect');
      assert.equal(await destination.getAttribute('stroke-width'), '2');
      await ruler.press('ArrowLeft');
      await assertStep(page, run, fallback - 1);
      assert.equal(await destination.getAttribute('stroke-width'), '1');
    }
  }
  await page.click('#c-edit');
  const longKmp = await startStringMatch(page, 'kmp', longText, longPattern);
  assert.deepEqual(longKmp.result, longMatch.result);
  await assertStep(page, longKmp, 0);
  assert.equal(await preprocessing.locator('[data-avc-key="gv-47,3"]').textContent(), '—');
  await ruler.press('End');
  await assertStep(page, longKmp, longKmp.steps.length - 1);
  assert.equal(await preprocessing.locator('[data-avc-key="gv-47,1"]').textContent(), '47');
  await ruler.press('ArrowLeft');
  await assertStep(page, longKmp, longKmp.steps.length - 2);
  assert.ok(await preprocessing.evaluate(svg => svg.parentElement.scrollTop > 0));
  await ruler.press('ArrowLeft');
  await assertStep(page, longKmp, longKmp.steps.length - 3);
  assert.equal(await layer(page, 'matches').locator('[data-avc-key="gv-70"]').count(), 0);
  await page.click('#c-edit');
  const emptyKmp = await startStringMatch(page, 'kmp', 'a', '');
  await ruler.press('End');
  await assertStep(page, emptyKmp, emptyKmp.steps.length - 1);
  assert.deepEqual(emptyKmp.result, [0]);
  assert.equal(await preprocessing.count(), 0);

  await selectWorkbenchAlgorithm(page, 'expression-dag');
  const startDag = async expression => {
    await page.fill('#c-data', expression);
    const pending = page.waitForResponse(response => response.url().endsWith('/api/algorithms/expression-dag/runs'));
    await page.click('#startBtn');
    const response = await pending;
    assert.equal(response.status(), 200);
    return response.json();
  };
  const wideDag = await startDag(Array(10).fill('(2147483647/3)').join(' + '));
  await ruler.press('End');
  await assertStep(page, wideDag, wideDag.steps.length - 1);
  const dagGraph = layer(page, 'expression-dag');
  const rootLabel = dagGraph.locator('[data-avc-key="ns-f' + wideDag.result.root + '"]');
  const expectedValue = Array(10).fill(2147483647 / 3).reduce((sum, term) => sum + term, 0);
  assert.equal(wideDag.result.value, expectedValue);
  assert.equal(await rootLabel.textContent(), '#' + wideDag.result.root + ' = ' + expectedValue);
  assert.equal(await dagGraph.locator('[data-avc-key="ns-f0"]').textContent(), '#0 = 2147483647');
  assert.equal((await cells(page, 'postfix')).length, 39);
  assert.ok(await dagGraph.evaluate(svg => {
    const box = svg.querySelector('.avc-layer').getBBox();
    const { width, height } = svg.viewBox.baseVal;
    return box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height;
  }), 'full cache labels fit the graph canvas');
  assert.ok(await page.locator('[data-viz-body]').evaluate(body => {
    body.scrollLeft = body.scrollWidth;
    return body.scrollLeft > 0 && document.documentElement.scrollWidth <= innerWidth;
  }), 'a wide DAG scrolls within the mobile workbench');
  await ruler.press('ArrowLeft');
  await ruler.press('ArrowLeft');
  await assertStep(page, wideDag, wideDag.steps.length - 3);
  assert.equal(await rootLabel.textContent(), '#' + wideDag.result.root);

  await page.click('#c-edit');
  const badDag = await startDag('8/(2-2)');
  await ruler.press('End');
  await assertStep(page, badDag, badDag.steps.length - 1);
  assert.match(await dagGraph.getAttribute('aria-label'), /除数为零.*下标 1/);
  const failed = badDag.steps.at(-1).variables.nodes.find(node => node.token === '/');
  assert.equal(await dagGraph.locator('[data-avc-key="n-f' + failed.id + '"] circle').getAttribute('stroke-width'), '2.4');

  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  server.kill();
}
