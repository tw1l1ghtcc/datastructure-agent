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

const examples = [
  ['array-list-reverse', [5, 4, 3, 2, 1]],
  ['array-list-delete-range', [1, 5]],
  ['singly-linked-list-insert', [1, 2, 3]],
  ['singly-linked-list-delete', [2, 3]],
  ['singly-linked-list-reverse', [6, 4, 2]],
  ['kth-from-end', { nodeId: 2, value: 1 }],
  ['sparse-matrix-transpose', { rows: 4, cols: 2, triples: [{ i: 0, j: 1, e: -3 }, { i: 2, j: 0, e: 4 }, { i: 3, j: 1, e: 7 }] }],
  ['radix-sort', [3, 10, 21, 21], '排序结果'],
  ['counting-sort', [-1, 0, 2, 2], '输出数组'],
];

const layer = (page, id) => page.locator('[data-viz-engine="plus-e"] [data-avc-svg="' + id + '"]');
const cells = (page, id) => layer(page, id).locator('[data-avc-key^="gv-"]').allTextContents();
const display = value => String(value ?? '—');

const runPath = algorithm => '/api/algorithms/' + algorithm + '/runs';

async function assertFullCanvas(page, id) {
  await page.waitForFunction(id => {
    const viewport = document.querySelector('[data-viz-body]');
    const svg = viewport?.querySelector(`[data-avc-svg="${id}"]`);
    return svg && svg.viewBox.baseVal.width === viewport.clientWidth && svg.viewBox.baseVal.height === viewport.clientHeight;
  }, id);
  assert.equal(await page.locator('.e-state-tables, .trace-animation-stage .canvas-card').count(), 0);
}

async function start(page, algorithm, status = 200) {
  const pending = page.waitForResponse(response => response.url().endsWith(runPath(algorithm)));
  await page.click('#startBtn');
  const response = await pending;
  assert.equal(response.status(), status, algorithm);
  if (status === 200) await page.locator('#e-edit').waitFor();
  return response.json();
}

async function assertStep(page, run, index) {
  const step = run.steps[index];
  await page.waitForFunction(({ index, lineId }) =>
    document.querySelector('[data-tl-ruler]').getAttribute('aria-valuenow') === String(index + 1) &&
    document.querySelector('#code-lines [aria-current="step"]')?.dataset.lineId === lineId,
  { index, lineId: step.lineId });
  assert.equal(await page.locator('[data-explain-host] .bsviz-caption').textContent(), step.description);
  const visible = page.locator('[data-viz-engine="plus-e"] .avc-svg');
  assert.ok(await visible.count(), step.algorithm);
  assert.doesNotMatch((await visible.allTextContents()).join(' '), /渲染失败|undefined|NaN/);
  const v = step.variables;
  if (v.nodes) {
    const svg = layer(page, 'e-list');
    assert.equal(await svg.locator('[data-avc-key^="nv-n"]').count(), v.nodes.length);
    assert.equal(await svg.locator('[data-avc-key^="link-n"]').count(), v.nodes.filter(node => node.next != null).length);
    for (const { id, next, value } of v.nodes) {
      assert.equal(await svg.locator('[data-avc-key="nv-n' + id + '"]').textContent(), String(value));
      if (next != null) assert.equal(await svg.locator('[data-avc-key="link-n' + id + '-n' + next + '"]').count(), 1);
    }
  } else if (v.triples) {
    assert.deepEqual(await cells(page, 'e-triples'), v.triples.flatMap(({ i, j, e }) => [i, j, e].map(display)));
    if (v.out) assert.deepEqual(await cells(page, 'e-transpose'), v.out.flatMap(({ i, j, e }) => [i, j, e].map(display)));
  } else if (step.array.length <= 10) {
    assert.deepEqual(await cells(page, 'e-array'), step.array.map(display));
    if (v.tmp || v.output) assert.deepEqual(await cells(page, 'e-output'), (v.tmp ?? v.output).map(display));
  }
}

const tableRows = (page, title) => page.locator('.e-state-tables table')
  .filter({ has: page.locator('caption', { hasText: title }) }).locator('tbody tr');

async function values(rows, column) {
  return rows.evaluateAll((elements, index) => elements.map(row => row.cells[index].textContent), column);
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

  for (const [algorithm, expected, title] of examples) {
    await selectWorkbenchAlgorithm(page, algorithm);
    await page.click('#fillDemo');
    const run = await start(page, algorithm);
    assert.deepEqual(run.result, expected, algorithm);
    assert.deepEqual(run.steps.at(-1).result, expected, algorithm);
    await assertStep(page, run, 0);
    if (algorithm === 'sparse-matrix-transpose') {
      assert.equal(await page.locator('.e-state-tables').count(), 0);
    } else if (!title) {
      const id = algorithm.startsWith('array-list-') ? 'e-array' : 'e-list';
      await assertFullCanvas(page, id);
      await page.locator('[data-viz-full]').click();
      await assertFullCanvas(page, id);
      await page.keyboard.press('Escape');
      await assertFullCanvas(page, id);
    }
    await page.click('#nextBtn');
    await assertStep(page, run, 1);
    if (algorithm === 'array-list-reverse') {
      const svg = layer(page, 'e-array');
      for (const [index, label] of [[0, 'i · 0'], [4, 'j · 4']]) {
        assert.equal(await svg.locator(`[data-avc-key="idx-${index}"]`).textContent(), label);
        assert.equal(await svg.locator(`[data-avc-key="g-${index}"] rect`).getAttribute('stroke-width'), '2');
      }
    }
    if (algorithm === 'array-list-delete-range') {
      await page.click('#nextBtn');
      await assertStep(page, run, 2);
      const svg = layer(page, 'e-array');
      for (const [index, label] of [[4, '源 · 4'], [1, '目标 · 1']]) {
        assert.equal(await svg.locator(`[data-avc-key="idx-${index}"]`).textContent(), label);
        assert.equal(await svg.locator(`[data-avc-key="g-${index}"] rect`).getAttribute('stroke-width'), '2');
      }
    }
    if (algorithm === 'kth-from-end') {
      const svg = layer(page, 'e-list');
      assert.equal(await svg.locator('[data-avc-key="nid-n0"]').textContent(), '#0');
      assert.equal(await svg.locator('[data-avc-key="ptr-fast"]').textContent(), '快 fast');
      assert.equal(await svg.locator('[data-avc-key="ptr-slow"]').textContent(), '慢 slow');
    }
    if (algorithm === 'singly-linked-list-insert') {
      const svg = layer(page, 'e-list');
      assert.equal(await svg.locator('[data-avc-key="ptr-new"]').textContent(), '链外');
      assert.equal(await svg.locator('[data-avc-key="nid-n1"]').textContent(), '#1 · NULL');
      assert.equal(await svg.locator('[data-avc-key="nid-n2"]').textContent(), '#2 · NULL');
      assert.equal(await svg.locator('[data-avc-key="link-n0-n2"]').count(), 0);
      await page.click('#nextBtn');
      await assertStep(page, run, 2);
      assert.equal(await svg.locator('[data-avc-key="ptr-new"]').textContent(), '新结点');
      assert.equal(await svg.locator('[data-avc-key="link-n0-n2"]').count(), 1);
      assert.equal(await svg.locator('[data-avc-key="link-n2-n1"]').count(), 1);
    }
    if (algorithm === 'singly-linked-list-delete') {
      const svg = layer(page, 'e-list');
      assert.equal(await svg.locator('[data-avc-key="ptr-removed"]').textContent(), '已脱链');
      assert.equal(await svg.locator('[data-avc-key="link-n0-n1"] polyline').first().getAttribute('stroke-dasharray'), '5 4');
      assert.equal(await svg.locator('[data-avc-key="link-n1-n2"] polyline').first().getAttribute('stroke-dasharray'), null);
    }
    if (algorithm === 'singly-linked-list-reverse') {
      const svg = layer(page, 'e-list');
      assert.equal(await svg.locator('[data-avc-key="nid-n0"]').textContent(), '#0 · NULL');
      assert.equal(await svg.locator('[data-avc-key="ptr-curr"]').textContent(), '当前 curr');
      assert.equal(await svg.locator('[data-avc-key="ptr-next"]').textContent(), '原后继 next');
      await page.click('#nextBtn');
      await assertStep(page, run, 2);
      assert.equal(await svg.locator('[data-avc-key="ptr-prev"]').textContent(), '前驱 prev');
      assert.equal(await svg.locator('[data-avc-key="link-n1-n0"]').count(), 1);
      assert.equal(await svg.locator('[data-avc-key="link-n0-n1"]').count(), 0);
    }
    if (algorithm === 'sparse-matrix-transpose') {
      const allocation = layer(page, 'e-column-allocation');
      await page.click('#nextBtn');
      await assertStep(page, run, 2);
      assert.equal(await allocation.locator('[data-avc-key="gv-2"]').textContent(), '1 / —');
      assert.equal(await allocation.locator('[data-avc-key="g-2"] rect').getAttribute('stroke-width'), '2');
      const firstWrite = run.steps.find(step => step.event === 'write_out');
      for (let index = 3; index <= firstWrite.stepIndex; index++) await page.click('#nextBtn');
      await assertStep(page, run, firstWrite.stepIndex);
      assert.deepEqual(await cells(page, 'e-column-allocation'), ['1 / 0', '0 / 1', '1 / 2', '1 / 2']);
      for (const [id, row] of [['e-triples', firstWrite.variables.k], ['e-transpose', firstWrite.variables.pos]]) {
        assert.equal(await layer(page, id).locator('[data-avc-key="g-' + row + ',0"] rect').getAttribute('stroke-width'), '2');
      }
      await page.click('#prevBtn');
      await assertStep(page, run, firstWrite.stepIndex - 1);
      assert.equal(await allocation.locator('[data-avc-key="gv-2"]').textContent(), '1 / 1');
      assert.equal(await layer(page, 'e-transpose').count(), 0);
    }
    await page.click('[data-t="last"]');
    await assertStep(page, run, run.steps.length - 1);
    if (algorithm === 'array-list-delete-range') {
      const svg = layer(page, 'e-array');
      assert.equal(await svg.getAttribute('aria-label'), '顺序表 · 逻辑长度 2');
      assert.equal(await svg.locator('[data-avc-key="g-1"] rect').getAttribute('fill'), '#ffffff');
      assert.equal(await svg.locator('[data-avc-key="g-2"] rect').getAttribute('fill'), '#f7f8fc');
    }
    if (algorithm === 'kth-from-end') {
      const svg = layer(page, 'e-list');
      assert.match(await svg.locator('[data-avc-key="name"]').textContent(), /找到结点 #2，值 1/);
      assert.equal(await svg.locator('[data-avc-key="ne-n2-0"] line').getAttribute('stroke'), '#0a6b4a');
    }
    if (title) assert.ok(await page.locator('.e-state-tables caption', { hasText: title }).count(), algorithm);
    await page.click('#prevBtn');
    const step = run.steps.at(-2);
    await assertStep(page, run, step.stepIndex);
    if (algorithm === 'kth-from-end') {
      assert.match(await layer(page, 'e-list').locator('[data-avc-key="name"]').textContent(), /fast = NULL/);
    }
    const response = await page.request.post(base + '/api/agent/explain', {
      data: { runId: run.runId, stepIndex: step.stepIndex, question: '这一步改变了什么？', hintLevel: 2 },
    });
    assert.equal(response.status(), 200, algorithm);
    const { stepRefs } = await response.json();
    assert.equal(stepRefs[0].algorithm, algorithm);
    assert.equal(stepRefs[0].stepIndex, step.stepIndex);
    assert.deepEqual(stepRefs[0].variables, step.variables);
    await page.click('#resetBtn');
    await assertStep(page, run, 0);
  }

  // A long move crosses the old ten-cell window. All storage remains available in the canvas.
  await selectWorkbenchAlgorithm(page, 'array-list-delete-range');
  const stored = Array.from({ length: 64 }, (_, index) => index);
  await page.fill('#e-data', stored.join(','));
  await page.fill('#e-left', '1');
  await page.fill('#e-right', '61');
  const longDelete = await start(page, 'array-list-delete-range');
  await assertFullCanvas(page, 'e-array');
  assert.deepEqual(await cells(page, 'e-array'), stored.map(String));
  await page.click('#nextBtn');
  await page.click('#nextBtn');
  await assertStep(page, longDelete, 2);
  const deleteSvg = layer(page, 'e-array');
  assert.equal(await deleteSvg.locator('[data-avc-key="idx-62"]').textContent(), '源 · 62');
  assert.equal(await deleteSvg.locator('[data-avc-key="idx-1"]').textContent(), '目标 · 1');
  assert.deepEqual(await cells(page, 'e-array'), longDelete.steps[2].array.map(String));
  await page.click('#prevBtn');
  await assertStep(page, longDelete, 1);
  assert.deepEqual(await cells(page, 'e-array'), stored.map(String));
  assert.deepEqual(longDelete.result, [0, 62, 63]);
  await page.click('#e-edit');
  await page.fill('#e-left', '0');
  await page.fill('#e-right', '63');
  const deleteAll = await start(page, 'array-list-delete-range');
  await page.click('[data-t="last"]');
  await assertStep(page, deleteAll, deleteAll.steps.length - 1);
  assert.deepEqual(deleteAll.result, []);
  assert.equal(await deleteSvg.getAttribute('aria-label'), '顺序表 · 逻辑长度 0');
  assert.equal(await deleteSvg.locator('rect[fill="#f7f8fc"]').count(), stored.length);

  await selectWorkbenchAlgorithm(page, 'counting-sort');
  await page.click('#fillDemo');
  await start(page, 'counting-sort');
  const ruler = page.locator('[data-tl-ruler]');
  const counts = tableRows(page, '计数表');
  await ruler.press('End');
  assert.deepEqual(await values(counts, 2), ['0', '1', '2', '2']);
  await ruler.press('Home');
  await ruler.press('ArrowRight');
  assert.deepEqual(await values(counts, 2), ['0', '0', '0', '0']);
  await ruler.press('ArrowRight');
  assert.deepEqual(await values(counts, 2), ['0', '0', '0', '1']);
  assert.deepEqual(await cells(page, 'e-counts'), ['0', '0', '0', '1']);
  await ruler.press('ArrowLeft');
  assert.deepEqual(await values(counts, 2), ['0', '0', '0', '0']);
  assert.deepEqual(await cells(page, 'e-counts'), ['0', '0', '0', '0']);

  await page.click('#e-edit');
  await page.fill('#e-data', '-2500, 2499, -2500');
  const wide = await start(page, 'counting-sort');
  assert.ok(wide.steps.length > 5000);
  assert.ok(await page.locator('.tl-tick').count() <= 100);
  await ruler.press('End');
  await assertStep(page, wide, wide.steps.length - 1);
  assert.deepEqual(await values(tableRows(page, '输出数组'), 1), ['-2500', '-2500', '2499']);
  await page.click('#e-edit');
  await page.fill('#e-data', '-2500, 2500');
  assert.equal((await start(page, 'counting-sort', 400)).error.code, 'INVALID_INPUT');
  await page.waitForFunction(() => document.querySelector('#msgBox').textContent.includes('值域跨度'));
  await assertStep(page, wide, wide.steps.length - 1);

  await selectWorkbenchAlgorithm(page, 'singly-linked-list-insert');
  await page.fill('#e-pos', '0');
  await page.fill('#e-value', '0');
  const insert = await start(page, 'singly-linked-list-insert');
  assert.deepEqual(insert.result, [0]);
  await assertFullCanvas(page, 'e-list');
  await page.click('#nextBtn');
  const insertSvg = layer(page, 'e-list');
  assert.equal(await insertSvg.locator('[data-avc-key="ptr-new"]').textContent(), '链外');
  assert.equal(await insertSvg.locator('[data-avc-key="null-head"]').textContent(), 'head=∧');
  await page.click('#nextBtn');
  assert.equal(await insertSvg.locator('[data-avc-key="head"]').textContent(), 'head');
  assert.equal(await insertSvg.locator('[data-avc-key="nv-n0"]').textContent(), '0');

  await page.setViewportSize({ width: 1120, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const fullList = Array(64).fill(-2147483648);
  await page.click('#e-edit');
  await page.fill('#e-data', fullList.join(','));
  await page.fill('#e-pos', String(fullList.length));
  await page.fill('#e-value', '0');
  const tailInsert = await start(page, 'singly-linked-list-insert');
  await assertFullCanvas(page, 'e-list');
  await page.click('#nextBtn');
  assert.equal(await insertSvg.locator('[data-avc-key="nid-n63"]').textContent(), '#63 · NULL');
  assert.equal(await insertSvg.locator('[data-avc-key="nid-n64"]').textContent(), '#64 · NULL');
  await page.click('#nextBtn');
  await assertStep(page, tailInsert, 2);
  assert.equal(await insertSvg.locator('[data-avc-key="link-n63-n64"]').count(), 1);
  assert.ok(await insertSvg.evaluate(svg => {
    const box = svg.querySelector('.avc-layer').getBBox();
    const { width, height } = svg.viewBox.baseVal;
    return box.x >= -1 && box.y >= -1 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1;
  }), '插入后 65 个结点都显示在画布内');
  assert.deepEqual(tailInsert.result, [...fullList, 0]);

  await selectWorkbenchAlgorithm(page, 'singly-linked-list-delete');
  for (const [input, pos, expected] of [[[0], 0, []], [[7, 7, 7], 1, [7, 7]], [[1, 2, 3], 2, [1, 2]]]) {
    await page.fill('#e-data', input.join(','));
    await page.fill('#e-pos', String(pos));
    const run = await start(page, 'singly-linked-list-delete');
    await assertFullCanvas(page, 'e-list');
    await page.click('#nextBtn');
    await assertStep(page, run, 1);
    const svg = layer(page, 'e-list');
    assert.match(await svg.locator('[data-avc-key="name"]').textContent(), new RegExp(`结点 #${pos} 已脱链`));
    if (!expected.length) assert.equal(await svg.locator('[data-avc-key="null-head"]').textContent(), 'head=∧');
    if (pos === 1) assert.equal(await svg.locator('[data-avc-key="link-n0-n2"]').count(), 1);
    if (pos === 2) assert.equal(await svg.locator('[data-avc-key="nid-n1"]').textContent(), '#1 · NULL');
    assert.deepEqual(run.result, expected);
    await page.click('#e-edit');
  }

  await selectWorkbenchAlgorithm(page, 'sparse-matrix-transpose');
  const triples = Array.from({ length: 64 }, (_, j) => ({ i: 63 - j, j, e: j + 0.12345678901234567 }));
  await page.fill('#e-rows', '64');
  await page.fill('#e-cols', '64');
  await page.fill('#e-data', triples.map(({ i, j, e }) => [i, j, e].join(',')).join('\n'));
  const matrix = await start(page, 'sparse-matrix-transpose');
  assert.deepEqual(matrix.result, { rows: 64, cols: 64, triples: triples.map(({ i, j, e }) => ({ i: j, j: i, e })) });
  await assertStep(page, matrix, 0);
  await page.locator('[data-t="last"]').click();
  await assertStep(page, matrix, matrix.steps.length - 1);
  assert.equal(await page.locator('.e-state-tables').count(), 0);
  assert.deepEqual(await cells(page, 'e-column-allocation'), triples.map(({ j }) => '1 / ' + (j + 1)));
  assert.equal(await layer(page, 'e-column-allocation').locator('[data-avc-key="idx-63"]').textContent(), '原列 63');
  const matrixStep = await page.request.get(base + '/api/runs/' + matrix.runId + '/steps/' + (matrix.steps.length - 1));
  assert.deepEqual((await matrixStep.json()).step, matrix.steps.at(-1));
  await page.click('#e-edit');
  await page.fill('#e-rows', '0');
  await page.fill('#e-cols', '0');
  await page.fill('#e-data', '');
  const emptyMatrix = await start(page, 'sparse-matrix-transpose');
  await page.locator('[data-t="last"]').click();
  await assertStep(page, emptyMatrix, emptyMatrix.steps.length - 1);
  assert.deepEqual(emptyMatrix.result, { rows: 0, cols: 0, triples: [] });
  assert.equal(await layer(page, 'e-column-allocation').count(), 0);

  await selectWorkbenchAlgorithm(page, 'array-list-reverse');
  await page.setViewportSize({ width: 1120, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reverseInputs = [[], [0], Array.from({ length: 64 }, (_, index) => -2147483648 + index)];
  for (const [index, input] of reverseInputs.entries()) {
    if (index) await page.click('#e-edit');
    await page.fill('#e-data', input.join(','));
    const run = await start(page, 'array-list-reverse');
    await assertFullCanvas(page, 'e-array');
    assert.deepEqual(await cells(page, 'e-array'), input.map(String));
    if (input.length === 0) assert.match(await layer(page, 'e-array').textContent(), /顺序表为空/);
    if (input.length === 64) {
      await page.click('#nextBtn');
      await assertStep(page, run, 1);
      assert.deepEqual(await cells(page, 'e-array'), run.steps[1].array.map(String));
      assert.equal(await layer(page, 'e-array').locator('[data-avc-key="idx-63"]').textContent(), 'j · 63');
      assert.ok(await layer(page, 'e-array').evaluate(svg => {
        const content = svg.getBBox();
        return content.x >= 0 && content.y >= 0 && content.x + content.width <= svg.viewBox.baseVal.width &&
          content.y + content.height <= svg.viewBox.baseVal.height;
      }), '64 个元素都显示在画布内');
    }
    await ruler.press('End');
    assert.deepEqual(await cells(page, 'e-array'), [...input].reverse().map(String));
  }

  await selectWorkbenchAlgorithm(page, 'kth-from-end');
  const repeated = Array(64).fill(-2147483648);
  for (const k of [64, 1]) {
    await page.fill('#e-data', repeated.join(','));
    await page.fill('#e-k', String(k));
    const run = await start(page, 'kth-from-end');
    await assertFullCanvas(page, 'e-list');
    await ruler.press('End');
    await assertStep(page, run, run.steps.length - 1);
    assert.deepEqual(run.result, { nodeId: 64 - k, value: repeated[0] });
    const svg = layer(page, 'e-list');
    assert.equal(await svg.locator('[data-avc-key^="nid-"]').count(), 64);
    assert.equal(await svg.locator(`[data-avc-key="ne-n${64 - k}-0"] line`).getAttribute('stroke'), '#0a6b4a');
    assert.ok(await svg.evaluate(element => {
      const box = element.querySelector('.avc-layer').getBBox();
      const { width, height } = element.viewBox.baseVal;
      return box.x >= -1 && box.y >= -1 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1;
    }), '64 个结点、指针和结果都显示在画布内');
    if (k === 64) await page.click('#e-edit');
  }

  for (const [algorithm, data] of [
    ['radix-sort', { list: [1, -1] }],
    ['radix-sort', { list: Array(25).fill(0) }],
    ['array-list-reverse', { list: ['1'] }],
    ['kth-from-end', { list: [0], k: 2 }],
    ['singly-linked-list-delete', { list: [], pos: 0 }],
    ['array-list-delete-range', { list: [1], left: 1, right: 0 }],
    ['sparse-matrix-transpose', { rows: 1, cols: 65, triples: [] }],
    ['sparse-matrix-transpose', { rows: 1, cols: 1, triples: [{ i: 0, j: 0, e: 1 }, { i: 0, j: 0, e: 2 }] }],
  ]) {
    const response = await page.request.post(base + runPath(algorithm), { data });
    assert.equal(response.status(), 400, algorithm);
    assert.equal((await response.json()).error.code, 'INVALID_INPUT', algorithm);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + '/#workbench?algorithm=radix-sort');
  await page.click('#fillDemo');
  await page.fill('#e-data', '2147483647, 1000000000, 0');
  assert.deepEqual((await start(page, 'radix-sort')).result, [0, 1000000000, 2147483647]);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile layout fits viewport');
  await page.setViewportSize({ width: 1120, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await selectWorkbenchAlgorithm(page, 'singly-linked-list-reverse');
  const keys = Array.from({ length: 64 }, (_, index) => index + 1000);
  await page.fill('#e-data', keys.join(', '));
  const longList = await start(page, 'singly-linked-list-reverse');
  await assertFullCanvas(page, 'e-list');
  const svg = layer(page, 'e-list');
  await page.click('#nextBtn');
  await assertStep(page, longList, 1);
  assert.equal(await svg.locator('[data-avc-key^="nid-"]').count(), 64);
  assert.equal(await svg.locator('[data-avc-key="ptr-next"]').textContent(), '原后继 next');
  await page.locator('[data-t="last"]').click();
  assert.deepEqual(longList.result, [...keys].reverse());
  await assertStep(page, longList, longList.steps.length - 1);
  assert.ok(await svg.evaluate(element => {
    const box = element.querySelector('.avc-layer').getBBox();
    const { width, height } = element.viewBox.baseVal;
    return box.x >= -1 && box.y >= -1 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1;
  }), '64-node list fits its canvas');

  assert.deepEqual(errors, []);
  console.log('E package workbench acceptance passed. Counting sort boundary: ' + wide.steps.length + ' steps.');
} finally {
  await browser?.close();
  server.kill();
}
