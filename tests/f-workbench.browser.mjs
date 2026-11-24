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
  { id: 'expression-evaluation', mode: 'postfix', result: -8, field: 'value', conclusion: /表达式结果为 -8/ },
  { id: 'naive-string-match', result: [0,1,2] },
  { id: 'kmp', mode: 'nextval', result: [2] },
  { id: 'expression-evaluation', mode: 'infix', result: -8, field: 'value', conclusion: /表达式结果为 -8/ },
  { id: 'expression-dag', result: 25, field: 'value', conclusion: /根节点结果为 25/ },
  { id: 'critical-path', result: 5, field: 'duration', caption: /关键路径/, conclusion: /总工期为 5/ },
];

const layer = (page, name) => page.locator('[data-viz-engine="plus-f"] [data-avc-svg="f-' + name + '"]');
const cells = (page, name) => layer(page, name).locator('[data-avc-key^="gv-"]').allTextContents();
const indices = (page, name) => layer(page, name).locator('[data-avc-key^="idx-"]').allTextContents();
const sequenceHeadings = page => page.locator('.f-sequence-row:visible h3').allTextContents();
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
  if (step.algorithm === 'kmp') assert.ok(await page.locator('.f-kmp-animation').isVisible());
  else assert.ok(await stage.count(), step.algorithm);
  assert.doesNotMatch((await stage.allTextContents()).join(' '), /渲染失败|undefined|NaN/);
  const v = step.variables;
  if (step.algorithm === 'bracket-matching') {
    assert.deepEqual(await cells(page, 'brackets'), v.stack.map(item => item.char));
    assert.deepEqual(await indices(page, 'brackets'), v.stack.map(item => String(item.i)));
  }
  if (v.operators && step.algorithm !== 'expression-evaluation') {
    assert.deepEqual(await cells(page, 'operators'), v.operators.map(token => token.text));
    assert.deepEqual(await cells(page, 'postfix'), v.output.map(token => token.text));
    assert.deepEqual(await indices(page, 'operators'), v.operators.map(token => String(token.index)));
    assert.deepEqual(await indices(page, 'postfix'), v.output.map(token => String(token.index)));
  }
  if (step.algorithm === 'expression-evaluation') {
    const boundary = run.steps.findIndex(frame => frame.lineId === 'postfix');
    const computing = v.mode === 'postfix' || (boundary >= 0 && step.stepIndex >= boundary);
    const originalHeading = v.mode === 'infix' ? ['中缀表达式'] : [];
    const headings = computing ? ['后缀序列', '操作数栈（栈顶在右）'] : ['运算符栈（栈顶在右）', '后缀序列'];
    assert.deepEqual(await sequenceHeadings(page), [...originalHeading, ...headings]);
    assert.deepEqual(await cells(page, 'operators'), computing ? [] : v.operators.map(token => token.text));
    if (step.lineId === 'compute') {
      await layer(page, 'operands').locator('rect[stroke="#8a4b00"]').first().waitFor({ state: 'detached' });
    }
    assert.deepEqual(await cells(page, 'operands'), v.stack.map(display));
    if (step.lineId === 'done') {
      assert.deepEqual(await indices(page, 'operands'), ['最终结果']);
      assert.equal(await layer(page, 'operands').locator('[data-avc-key="g-0"] rect').getAttribute('stroke'), '#0a6b4a');
    }
  }
  if (step.algorithm === 'naive-string-match') {
    assert.ok(await layer(page, 'match').count());
    assert.deepEqual(await cells(page, 'matches'), v.matches.map(display));
  }
  if (step.algorithm === 'kmp') {
    assert.deepEqual(await cells(page, 'kmp-next'), Array.from(run.input.pattern, (_, index) => display(v[v.mode][index])));
    assert.equal(await page.locator('.f-kmp-matches').getAttribute('data-positions'), v.matches.join(','));
  }
  if (step.algorithm === 'expression-dag' && v.nodes.length) {
    const graph = layer(page, 'expression-dag');
    assert.equal(await graph.locator('[data-avc-key^="n-f"]').count(), v.nodes.length);
    assert.equal(await graph.locator('[data-avc-key^="e-f"]').count(), v.edges.length);
    if (step.done && !step.result.error) {
      const root = graph.locator('[data-avc-key="ns-f' + v.root + '"]');
      assert.equal(await root.textContent(), '#' + v.root + ' = ' + run.result.value);
    }
  }
  if (step.algorithm === 'critical-path') {
    const graph = layer(page, 'activities');
    assert.equal(await graph.locator('[data-avc-key^="n-f"]').count(), run.input.nodes.length);
    assert.equal(await graph.locator('[data-avc-key^="e-f"]').count(), run.input.edges.length);
    if (step.done && !step.result.error) {
      const critical = graph.locator('[data-avc-key^="e-f"] :is(line, polyline):not([data-role="arrow"])[stroke="#0a6b4a"]');
      assert.equal(await critical.count(), v.criticalEdges.length);
      assert.equal(await page.locator('.c-state-tables caption', { hasText: '事件时间' }).count(), 0);
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
    if (id === 'expression-evaluation') {
      const start = run.steps.findIndex(step => step.lineId === 'postfix');
      let index = 1;
      if (mode === 'infix') {
        for (; index < start; index++) await page.click('#nextBtn');
        await assertStep(page, run, start);
        assert.deepEqual(await cells(page, 'infix'), ['8', '/', '(', '2', '-', '3', ')']);
        await page.click('#prevBtn');
        await assertStep(page, run, --index);
      }
      const firstCompute = run.steps.findIndex(step => step.lineId === 'compute');
      for (; index < firstCompute - 1; index++) await page.click('#nextBtn');
      const highlighted = await page.locator('#nextBtn').evaluate(button => {
        button.click();
        const stack = document.querySelector('[data-avc-svg="f-operands"]');
        return Array.from(stack.querySelectorAll('rect[stroke="#8a4b00"]'), rect => {
          const key = rect.closest('[data-avc-key]').dataset.avcKey.slice(2);
          return stack.querySelector('[data-avc-key="gv-' + key + '"]').textContent;
        });
      });
      assert.deepEqual(highlighted, ['2', '3']);
      await assertStep(page, run, firstCompute);
      assert.deepEqual(await cells(page, 'postfix'), ['8', '2', '3', '-', '/']);
      assert.deepEqual(await cells(page, 'operands'), ['8', '-1']);
      assert.match(await explanation.locator('.bsviz-status').textContent(), /2 - 3 = -1/);
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
    if (id === 'naive-string-match') {
      assert.deepEqual(await cells(page, 'matches'), result.map(String));
    }
    await page.click('#prevBtn');
    const index = run.steps.length - 2;
    await assertStep(page, run, index);
    if (id === 'expression-evaluation') {
      assert.match(await explanation.locator('.bsviz-status').textContent(), /8 \/ \(-1\) = -8/);
    }
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
    if (id === 'expression-evaluation') {
      await page.click('#c-edit');
      await page.fill('#c-data', mode === 'infix' ? '8 / (' : '8 0 /');
      const pending = page.waitForResponse(response => response.url().endsWith('/api/algorithms/expression-evaluation/runs'));
      await page.click('#startBtn');
      const invalid = await (await pending).json();
      await page.click('[data-t="last"]');
      await assertStep(page, invalid, invalid.steps.length - 1);
      assert.match(await explanation.locator('.bsviz-caption').textContent(), mode === 'infix' ? /缺少操作数/ : /除数为零/);
      assert.deepEqual(await indices(page, 'operands'), []);
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

  await page.setViewportSize({ width: 1280, height: 720 });
  const ruler = page.locator('[data-tl-ruler]');
  await selectWorkbenchAlgorithm(page, 'naive-string-match');
  const longText = '\t🙂' + 'a'.repeat(118);
  const longPattern = 'a'.repeat(48);
  const longMatch = await startStringMatch(page, 'naive-string-match', longText, longPattern);
  assert.deepEqual(longMatch.result, Array.from({ length: 71 }, (_, index) => index + 2));
  await assertStep(page, longMatch, 0);
  const alignment = layer(page, 'match');
  const alignmentRows = await alignment.locator('[data-avc-key^="gv-"]').evaluateAll(elements => {
    const strings = [[], []];
    for (const element of elements) {
      const row = Number(element.dataset.avcKey.slice(3).split(',')[0]) % 4;
      if (row < 2 && element.textContent) strings[row].push(element.textContent);
    }
    return strings;
  });
  assert.deepEqual(alignmentRows, [['制表符', '🙂', ...Array(118).fill('a')], Array(48).fill('a')]);
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
  for (const [pattern, result] of [['', [0]], ['aa', []]]) {
    await page.click('#c-edit');
    const run = await startStringMatch(page, 'naive-string-match', 'a', pattern);
    await ruler.press('End');
    await assertStep(page, run, run.steps.length - 1);
    assert.deepEqual(run.result, result);
    assert.match(await layer(page, 'matches').getAttribute('aria-label'), new RegExp(result.length + ' 处'));
  }

  await selectWorkbenchAlgorithm(page, 'kmp');
  const preprocessing = layer(page, 'kmp-next');
  const movingPattern = page.locator('.f-kmp-pattern');
  const connector = page.locator('.f-kmp-connector');
  assert.deepEqual(await page.locator('#f-mode option').allTextContents(), ['改进前 · next', '改进后 · nextval']);
  for (const [mode, jump] of [['next', 1], ['nextval', -1]]) {
    if (mode === 'nextval') await page.click('#c-edit');
    await page.selectOption('#f-mode', mode);
    const run = await startStringMatch(page, 'kmp', 'aab', 'aaa');
    const fallback = run.steps.findIndex(step => step.event === 'fallback');
    for (let index = 0; index < fallback - 1; index++) await ruler.press('ArrowRight');
    if (mode === 'next') {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      assert.ok(await ruler.evaluate(control => {
        const pattern = document.querySelector('.f-kmp-pattern');
        pattern.getBoundingClientRect();
        control.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        return pattern.getAnimations().some(animation => animation.transitionProperty === 'transform');
      }), 'pattern slides during fallback');
      await movingPattern.evaluate(node => Promise.allSettled(node.getAnimations().map(animation => animation.finished)));
      await page.emulateMedia({ reducedMotion: 'reduce' });
    } else await ruler.press('ArrowRight');
    await assertStep(page, run, fallback);
    assert.deepEqual(run.result, []);
    assert.equal(run.steps[fallback].variables.jump, jump);
    assert.equal(await preprocessing.getAttribute('aria-label'), mode === 'next' ? '改进前 · next 数组' : '改进后 · nextval 数组');
    assert.deepEqual(await cells(page, 'kmp-next'), mode === 'next' ? ['-1', '0', '1'] : ['-1', '-1', '-1']);
    assert.equal(await movingPattern.getAttribute('data-offset'), String(2 - jump));
    assert.equal(await preprocessing.locator('[data-avc-key="g-2"] rect').getAttribute('stroke-width'), '2');
    if (jump >= 0) {
      const destination = preprocessing.locator('[data-avc-key="g-1"] rect');
      assert.equal(await destination.getAttribute('stroke-width'), '2');
      assert.ok(await connector.isVisible());
      const main = await layer(page, 'kmp-text').locator('[data-avc-key="g-2"] rect').boundingBox();
      const pattern = await layer(page, 'kmp-pattern').locator('[data-avc-key="g-1"] rect').boundingBox();
      assert.ok(Math.abs(main.x - pattern.x) <= 1);
    } else assert.ok(await connector.isHidden());
    await ruler.press('ArrowLeft');
    await assertStep(page, run, fallback - 1);
    assert.equal(await movingPattern.getAttribute('data-offset'), '0');
  }
  await page.click('#c-edit');
  const longKmp = await startStringMatch(page, 'kmp', longText, longPattern);
  assert.deepEqual(longKmp.result, longMatch.result);
  await assertStep(page, longKmp, 0);
  assert.equal(await preprocessing.locator('[data-avc-key="gv-47"]').textContent(), '—');
  await ruler.press('End');
  await assertStep(page, longKmp, longKmp.steps.length - 1);
  assert.match(await preprocessing.locator('[data-avc-key="g-47"] title').textContent(), /前缀长度 47/);
  await ruler.press('ArrowLeft');
  await assertStep(page, longKmp, longKmp.steps.length - 2);
  assert.ok(await preprocessing.evaluate(svg => svg.closest('.f-kmp-track').scrollLeft > 0));
  await ruler.press('ArrowLeft');
  await assertStep(page, longKmp, longKmp.steps.length - 3);
  assert.equal(await page.locator('.f-kmp-matches').getAttribute('data-positions'), longKmp.result.slice(0, -1).join(','));
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
  }), 'a wide DAG scrolls within the desktop workbench');
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
