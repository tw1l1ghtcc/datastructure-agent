import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { selectWorkbenchAlgorithm } from './select-workbench-algorithm.mjs';
import { restoreBinarySearchTreeRun } from '../shared/algorithms/final/g/binary-search-tree.js';
import { isBinaryTraversal } from '../frontend/src/features/workbench/g-algorithms.js';
import { framePhases } from '../frontend/src/features/workbench/g-state.js';

const { chromium } = await import(process.env.TEST_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.TEST_PLAYWRIGHT_MODULE).href : 'playwright');
const server = spawn(process.execPath, ['backend/src/server.js'], {
  cwd: fileURLToPath(new URL('../', import.meta.url)),
  env: { ...process.env, PORT: '0', HOST: '127.0.0.1', AGENT_MOCK: 'true', RATE_LIMIT: 'false' },
  windowsHide: true,
});
const examples = [
  ['binary-tree-preorder', ['A', 'B', 'D', 'C'], /递归栈/],
  ['binary-tree-inorder', ['B', 'D', 'A', 'C'], /递归栈/],
  ['binary-tree-postorder', ['D', 'B', 'C', 'A'], /递归栈/],
  ['binary-tree-level-order', ['A', 'B', 'C', 'D'], /分层访问结果/],
  ['binary-tree-reconstruction', { root: 'A', nodes: [{ id: 'A', left: 'B', right: 'C' }, { id: 'B', left: null, right: 'D' }, { id: 'D', left: null, right: null }, { id: 'C', left: null, right: null }] }, /重建区间/],
  ['threaded-binary-tree', ['B', 'D', 'A', 'C'], /前驱线索/],
  ['tree-forest-conversion', { root: 'A', nodes: [{ id: 'A', left: 'B', right: 'D' }, { id: 'B', left: null, right: 'C' }, { id: 'C', left: null, right: null }, { id: 'D', left: null, right: null }] }, /左孩子右兄弟表示/],
  ['tree-forest-traversal', ['A', 'B', 'C', 'D'], /访问顺序/],
  ['huffman-coding', ['00', '01', '1'], /码字表/],
  ['binary-search-tree', [3, 4, 5, 7], /中序结果/],
];
const retainedCaptions = {
  'binary-tree-reconstruction': ['重建区间（栈底在上）'],
  'tree-forest-traversal': ['递归栈（栈底在上）', '访问顺序'],
  'binary-search-tree': ['本次操作', '中序结果'],
};

async function startRun(page, id, expectedStatus = 200) {
  const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/algorithms/' + id + '/runs'));
  await page.click('#startBtn');
  const response = await responsePromise;
  assert.equal(response.status(), expectedStatus, id);
  const data = await response.json();
  if (expectedStatus !== 200) return data;
  const run = id === 'binary-search-tree' ? restoreBinarySearchTreeRun(data) : data;
  await page.waitForFunction(() => !document.querySelector('#g-edit').parentElement.hidden || !document.querySelector('#tree-edit').parentElement.hidden);
  return run;
}

const primitiveKey = value => 'n' + Array.from(String(value), char => char.codePointAt(0).toString(16)).join('_');
const layer = (page, id) => page.locator('[data-viz-engine="plus-g"] [data-avc-svg="' + id + '"]');
const rows = (page, title) => page.locator('.trace-animation-state table').filter({ has: page.locator('caption', { hasText: title }) })
  .locator('tbody tr').evaluateAll(rows => rows.map(row => [...row.cells].map(cell => cell.textContent)));

async function assertTraversalLayout(page) {
  await page.waitForFunction(() => {
    const viewport = document.querySelector('.trace-animation-viewport');
    const svg = viewport?.querySelector('[data-avc-svg="g-tree"]');
    return svg && svg.viewBox.baseVal.width === viewport.clientWidth && svg.viewBox.baseVal.height === viewport.clientHeight;
  });
  const left = await page.locator('.trace-animation-state').boundingBox();
  const right = await page.locator('.trace-animation-viewport').boundingBox();
  const canvas = await page.locator('[data-viz-body]').boundingBox();
  assert.ok(right.width > left.width && Math.abs(left.x + left.width - right.x) <= 1);
  assert.ok(Math.abs(left.y - right.y) <= 1 && Math.abs(left.height - canvas.height) <= 1 && Math.abs(right.height - canvas.height) <= 1);
  assert.equal(await page.locator('.trace-animation-state table').count(), 2);
  assert.equal(await page.locator('.trace-animation-state caption', { hasText: /节点关系/ }).count(), 0);
  assert.equal(await page.locator('.trace-animation-viewport .canvas-card').count(), 0);
  assert.ok(Number(await layer(page, 'g-tree').locator('[data-avc-key^="n-n"] circle').first().getAttribute('r')) > 17);
}

async function assertTree(page, name, nodes, { huffman = false, threaded = false } = {}) {
  const svg = layer(page, name);
  assert.equal(await svg.locator('[data-avc-key^="n-n"]').count(), nodes.length);
  const ids = new Set(nodes.map(node => huffman ? node.index : node.id));
  let edgeCount = 0;
  let threadCount = 0;
  for (const node of nodes) {
    const from = primitiveKey(huffman ? node.index : node.id);
    for (const [child, isThread] of node.children ? node.children.map(id => [id, false])
      : [[node.left, node.leftThread], [node.right, node.rightThread]]) {
      if (!ids.has(child)) continue;
      const prefix = isThread ? 'th' : 'e';
      assert.equal(await svg.locator('[data-avc-key="' + prefix + '-' + from + '-' + primitiveKey(child) + '"]').count(), 1);
      if (isThread) threadCount++;
      else edgeCount++;
    }
  }
  assert.equal(await svg.locator('[data-avc-key^="e-n"]').count(), edgeCount);
  if (threaded) assert.equal(await svg.locator('[data-avc-key^="th-n"]').count(), threadCount);
}

async function assertStep(page, run, index) {
  const step = run.steps[index];
  await page.waitForFunction(({ index, lineId }) =>
    document.querySelector('[data-tl-ruler]').getAttribute('aria-valuenow') === String(index + 1) &&
    document.querySelector('#code-lines [aria-current="step"]')?.dataset.lineId === lineId,
  { index, lineId: step.lineId });
  assert.equal(await page.locator('#step-description').textContent(), step.description);
  assert.equal(await page.locator('[data-explain-host] .bsviz-caption').textContent(), step.description);
  const visible = page.locator('[data-viz-engine="plus-g"] .avc-svg');
  assert.ok(await visible.count(), step.algorithm);
  assert.doesNotMatch((await visible.allTextContents()).join(' '), /渲染失败|undefined|NaN/);
  const v = step.variables;
  if (step.algorithm === 'tree-forest-conversion') {
    await assertTree(page, 'g-forest', v.forestNodes);
    await assertTree(page, 'g-binary', v.binaryNodes);
  } else if (step.algorithm === 'huffman-coding') {
    await assertTree(page, 'g-huffman', v.nodes, { huffman: true });
    assert.deepEqual(await layer(page, 'g-candidates').locator('[data-avc-key^="gv-"]').allTextContents(),
      v.candidates.map(index => String(v.nodes[index].weight)));
  } else {
    await assertTree(page, 'g-tree', v.nodes, { threaded: step.algorithm === 'threaded-binary-tree' });
    if (isBinaryTraversal(step.algorithm)) {
      if (v.queue) {
        assert.deepEqual(await rows(page, '队列'), v.queue.map(({ id, level }) => [id, String(level)]));
        assert.deepEqual(await rows(page, '分层访问结果'), v.levels.map((ids, index) => [String(index + 1), ids.join(' → ')]));
      } else {
        assert.deepEqual(await rows(page, '递归栈'), v.stack.map(({ id, level, phase }) => [id, String(level), framePhases[phase]]));
        assert.deepEqual(await rows(page, '访问顺序'), v.order.map((id, index) => [String(index + 1), id]));
      }
    }
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
  await page.goto(base);
  for (const [id, result, caption] of examples) {
    await selectWorkbenchAlgorithm(page, id);
    await page.click('#fillDemo');
    if (await page.locator('#tree-next').isVisible()) await page.click('#tree-next');
    const run = await startRun(page, id);
    const actual = id === 'huffman-coding' ? run.result.codes.map(code => code.code)
      : id === 'binary-search-tree' ? run.result.inorder : run.result.order ?? run.result;
    assert.deepEqual(actual, result, id);
    await assertStep(page, run, 0);
    if (isBinaryTraversal(id)) {
      await assertTraversalLayout(page);
      await page.locator('[data-viz-full]').click();
      await assertTraversalLayout(page);
      await page.keyboard.press('Escape');
      await assertTraversalLayout(page);
    }
    await page.click('#nextBtn');
    await assertStep(page, run, 1);
    await page.click('[data-t="last"]');
    await assertStep(page, run, run.steps.length - 1);
    assert.match(await page.locator('.level-order-tables').innerText(), caption, id);
    if (retainedCaptions[id]) {
      assert.deepEqual(await page.locator('.g-state-tables caption').allTextContents(), retainedCaptions[id]);
    }
    await page.click('#prevBtn');
    const currentIndex = run.steps.length - 2;
    await assertStep(page, run, currentIndex);
    const answer = await page.request.post(base + '/api/agent/explain', {
      data: { runId: run.runId, stepIndex: currentIndex, question: '这一步发生了什么？', hintLevel: 2 },
    });
    assert.equal(answer.status(), 200, id);
    const { stepRefs } = await answer.json();
    assert.equal(stepRefs[0].algorithm, id);
    assert.equal(stepRefs[0].stepIndex, currentIndex);
    assert.deepEqual(stepRefs[0].variables, run.steps[currentIndex].variables);
    await page.click('#resetBtn');
    await assertStep(page, run, 0);
  }

  await selectWorkbenchAlgorithm(page, 'binary-tree-reconstruction');
  if (await page.locator('#g-edit').isVisible()) await page.click('#g-edit');
  const longNames = ['ReconstructionNodeLeft', 'ReconstructionNodeRight'];
  await page.fill('#g-primary', longNames.join(', '));
  await page.fill('#g-secondary', [...longNames].reverse().join(', '));
  await startRun(page, 'binary-tree-reconstruction');
  await page.locator('[data-t="last"]').click();
  const rebuilt = layer(page, 'g-tree');
  for (const name of longNames) {
    assert.equal(await rebuilt.locator('[data-avc-key="n-' + primitiveKey(name) + '"] circle title').textContent(), name);
  }

  await selectWorkbenchAlgorithm(page, 'binary-tree-preorder');
  await page.setViewportSize({ width: 1120, height: 800 });
  if (await page.locator('#tree-edit').isVisible()) await page.click('#tree-edit');
  if (await page.locator('#tree-back').isVisible()) await page.click('#tree-back');
  const names = ['LongTraversalNodeNameAtRoot', ...Array.from({ length: 63 }, (_, index) => 'N' + (index + 1))];
  await page.fill('#tree-nodes', names.join(', '));
  await page.click('#tree-next');
  await page.selectOption('#tree-root', names[0]);
  for (const [index, name] of names.slice(0, -1).entries()) {
    await page.getByLabel(name + ' 的右孩子', { exact: true }).selectOption(names[index + 1]);
  }
  const deep = await startRun(page, 'binary-tree-preorder');
  await page.locator('[data-tl-ruler]').press('End');
  assert.deepEqual(deep.result, names);
  await assertStep(page, deep, deep.steps.length - 1);
  const deepTree = layer(page, 'g-tree');
  assert.equal(await deepTree.locator('[data-avc-key="n-' + primitiveKey(names[0]) + '"] circle title').textContent(), names[0]);
  assert.ok(await deepTree.evaluate(svg => {
    const box = svg.querySelector('.avc-layer').getBBox();
    const { width, height } = svg.viewBox.baseVal;
    return box.x >= -1 && box.y >= -1 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1;
  }), '64 个节点和连线都在树画布内');
  const treeViewport = page.locator('.trace-animation-viewport');
  assert.ok(await treeViewport.evaluate(pane => {
    pane.scrollTop = pane.scrollHeight;
    return pane.scrollTop > 0;
  }));
  const statePane = page.locator('.trace-animation-state');
  assert.equal(await statePane.evaluate(pane => pane.scrollTop), 0);
  assert.ok(await statePane.evaluate(pane => {
    pane.scrollTop = pane.scrollHeight;
    return pane.scrollTop > 0;
  }));
  assert.equal(await page.locator('[data-viz-body]').evaluate(pane => pane.scrollTop), 0);
  await page.setViewportSize({ width: 1280, height: 720 });

  await selectWorkbenchAlgorithm(page, 'tree-forest-conversion');
  await page.selectOption('#g-mode', 'to-forest');
  await page.click('#fillDemo');
  await page.click('#tree-next');
  const forest = await startRun(page, 'tree-forest-conversion');
  assert.deepEqual(forest.result.roots, ['A', 'D']);
  assert.deepEqual(forest.result.nodes.find(node => node.id === 'A').children, ['B', 'C']);
  await page.click('#tree-edit');
  await page.getByLabel('C 的左孩子', { exact: true }).selectOption('A');
  assert.equal((await startRun(page, 'tree-forest-conversion', 400)).error.code, 'INVALID_INPUT');
  await page.click('#nextBtn');
  await assertStep(page, forest, 1);
  await page.selectOption('#g-mode', 'to-binary');
  await page.fill('#g-primary', '');
  await page.fill('#g-secondary', '');
  assert.deepEqual((await startRun(page, 'tree-forest-conversion')).result, { root: null, nodes: [] });

  await selectWorkbenchAlgorithm(page, 'tree-forest-traversal');
  await page.selectOption('#g-mode', 'postorder');
  await page.click('#fillDemo');
  assert.deepEqual((await startRun(page, 'tree-forest-traversal')).result, ['B', 'C', 'A', 'D']);

  await selectWorkbenchAlgorithm(page, 'binary-search-tree');
  const operations = [...Array.from({ length: 64 }, (_, key) => 'insert ' + key), ...Array(64).fill('search 64')];
  await page.fill('#g-primary', operations.join('\n'));
  const started = performance.now();
  const worst = await startRun(page, 'binary-search-tree');
  const elapsedMs = Math.round(performance.now() - started);
  assert.equal(worst.steps.length, 12482);
  assert.ok(await page.locator('.tl-tick').count() <= 100);
  const lookup = await page.request.get(base + '/api/runs/' + worst.runId);
  assert.equal(lookup.status(), 200);
  const transportBytes = (await lookup.body()).length;
  assert.ok(transportBytes < 3_000_000, 'Expected compact replay on run lookup');

  const ruler = page.locator('[data-tl-ruler]');
  await ruler.press('End');
  await assertStep(page, worst, worst.steps.length - 1);
  await ruler.press('ArrowLeft');
  const missing = worst.steps.at(-2);
  await assertStep(page, worst, missing.stepIndex);
  assert.equal(missing.variables.path.length, 64);
  assert.match(await page.locator('#varValue').innerText(), /查找 64 · 未找到/);
  const tableViewport = page.locator('[data-viz-body]');
  assert.ok(await tableViewport.evaluate(element => {
    element.scrollTop = element.scrollHeight;
    return element.scrollTop > 0;
  }), 'Large state tables can be scrolled');
  const stepLookup = await page.request.get(base + '/api/runs/' + worst.runId + '/steps/' + missing.stepIndex);
  assert.deepEqual((await stepLookup.json()).step, missing);
  await page.click('#tutor-toggle');
  await page.fill('#question-input', '本次未命中的比较路径是什么？');
  const replyPromise = page.waitForResponse(response => response.url().endsWith('/api/agent/explain'));
  await page.click('#send-btn');
  const reply = await (await replyPromise).json();
  assert.equal(reply.runId, worst.runId);
  assert.equal(reply.stepIndex, missing.stepIndex);
  assert.deepEqual(reply.stepRefs[0].variables, missing.variables);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('[data-viz-replay]').click();
  const svg = layer(page, 'g-tree');
  assert.ok(await svg.evaluate(element => {
    const box = element.querySelector('.avc-layer').getBBox();
    const { width, height } = element.viewBox.baseVal;
    return box.x >= -1 && box.y >= -1 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1;
  }), '64-node deep tree fits its canvas');
  assert.ok(await tableViewport.evaluate(element => {
    element.scrollLeft = element.scrollWidth;
    return element.scrollLeft > 0 && document.documentElement.scrollWidth <= innerWidth;
  }), 'deep tree scrolls inside the workbench at mobile width');
  assert.deepEqual(errors, []);
  console.log('G workbench acceptance passed. Large BST replay: ' + transportBytes + ' bytes, ' + elapsedMs + ' ms to first rendered step.');
} finally {
  await browser?.close();
  server.kill();
}
