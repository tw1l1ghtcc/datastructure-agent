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
  ['binary-tree-reconstruction', { root: 'A', nodes: [{ id: 'A', left: 'B', right: 'C' }, { id: 'B', left: null, right: 'D' }, { id: 'D', left: null, right: null }, { id: 'C', left: null, right: null }] }],
  ['threaded-binary-tree', ['B', 'D', 'A', 'C']],
  ['tree-forest-conversion', { root: 'A', nodes: [{ id: 'A', left: 'B', right: 'D' }, { id: 'B', left: null, right: 'C' }, { id: 'C', left: null, right: null }, { id: 'D', left: null, right: null }] }],
  ['tree-forest-traversal', ['A', 'B', 'C', 'D']],
  ['huffman-coding', ['00', '01', '1']],
  ['binary-search-tree', [3, 4, 5, 7], /中序结果/],
];
const retainedCaptions = {
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

async function assertTraversalLayout(page, algorithm) {
  await page.waitForFunction(() => {
    const viewport = document.querySelector('.trace-animation-viewport');
    const svg = viewport?.querySelector('[data-avc-svg="g-tree"]');
    return svg && svg.viewBox.baseVal.width === viewport.clientWidth && svg.viewBox.baseVal.height === viewport.clientHeight;
  });
  const state = await page.locator('.trace-animation-state').boundingBox();
  const tree = await page.locator('.trace-animation-viewport').boundingBox();
  const levelOrder = algorithm === 'binary-tree-level-order';
  const canvas = await page.locator('[data-viz-body]').boundingBox();
  assert.ok(tree.width > state.width && Math.abs(state.x + state.width - tree.x) <= 1);
  assert.ok(Math.abs(state.y - tree.y) <= 1 && Math.abs(state.height - canvas.height) <= 1 && Math.abs(tree.height - canvas.height) <= 1);
  assert.equal(await page.locator('.trace-animation-state table').count(), levelOrder ? 0 : 2);
  assert.equal(await page.locator('.trace-animation-state caption', { hasText: /节点关系/ }).count(), 0);
  assert.equal(await page.locator('.trace-animation-viewport .canvas-card').count(), 0);
  assert.ok(Number(await layer(page, 'g-tree').locator('[data-avc-key^="n-n"] circle').first().getAttribute('r')) > 17);
}

async function assertArrayAndTreeLayout(page, stateName, treeName) {
  const state = page.getByRole('region', { name: stateName });
  const left = await state.boundingBox();
  const right = await page.getByRole('region', { name: treeName }).boundingBox();
  const canvas = await page.locator('[data-viz-body]').boundingBox();
  assert.ok(right.width > left.width && Math.abs(left.x + left.width - right.x) <= 1);
  assert.ok(Math.abs(right.height - canvas.height) <= 1 && Math.abs(left.height - canvas.height) <= 1);
  assert.equal(await state.locator('.array-animation-row').count(), 2);
  assert.equal(await page.locator('.trace-animation-viewport .canvas-card').count(), 0);
}

async function assertForestTraversalSteps(page, run) {
  const ruler = page.locator('[data-tl-ruler]');
  const stack = layer(page, 'g-forest-stack');
  const order = layer(page, 'g-forest-order');
  const stackStatus = page.locator('.g-forest-traversal-state .array-animation-label p').first();
  async function assertRows(step) {
    const v = step.variables;
    assert.deepEqual(await stack.locator('[data-avc-key^="gv-"]').allTextContents(), v.stack.map(frame => frame.id));
    assert.deepEqual(await stack.locator('[data-avc-key^="idx-"]').allTextContents(), v.stack.map(frame => '第 ' + frame.level + ' 层'));
    assert.deepEqual(await order.locator('[data-avc-key^="gv-"]').allTextContents(), v.order);
    if (step.event === 'enter') assert.equal(await stackStatus.textContent(), `${v.currentNode} 入栈`);
    if (step.event === 'return') assert.equal(await stackStatus.textContent(), `${v.currentNode} 即将出栈`);
    const previousStack = run.steps[step.stepIndex - 1]?.variables.stack;
    if (previousStack?.length > v.stack.length) assert.equal(await stackStatus.textContent(), `${previousStack.at(-1).id} 已出栈`);
    if (v.currentNode != null) {
      const node = layer(page, 'g-tree').locator(`[data-avc-key="n-${primitiveKey(v.currentNode)}"] circle`);
      assert.equal(await node.getAttribute('fill'), '#fdf1e0');
    }
  }
  for (const step of run.steps) {
    if (step.stepIndex) await ruler.press('ArrowRight');
    await assertRows(step);
  }
  await ruler.press('ArrowLeft');
  await assertRows(run.steps.at(-2));
  await ruler.press('Home');
  await assertRows(run.steps[0]);
}

async function assertConversionLayout(page, mode) {
  const left = page.getByRole('region', { name: /^输入 ·/ });
  const right = page.getByRole('region', { name: /^结果 ·/ });
  const a = await left.boundingBox();
  const b = await right.boundingBox();
  const body = await page.locator('[data-viz-body]').boundingBox();
  assert.ok(Math.abs(a.width - b.width) <= 1 && Math.abs(a.x + a.width - b.x) <= 1);
  assert.ok(Math.abs(a.height - b.height) <= 1 && Math.abs(b.y + b.height - body.y - body.height) <= 1);
  assert.equal(await left.locator('svg').getAttribute('data-avc-svg'), mode === 'to-forest' ? 'g-binary' : 'g-forest');
  assert.equal(await right.locator('svg').getAttribute('data-avc-svg'), mode === 'to-forest' ? 'g-forest' : 'g-binary');
}

async function assertThreadedLayout(page) {
  const canvas = await page.locator('[data-viz-body]').boundingBox();
  const tree = await page.locator('.g-threaded-viewport').boundingBox();
  const order = await page.locator('.g-threaded-order').boundingBox();
  assert.ok(Math.abs(tree.width - canvas.width) <= 1 && Math.abs(order.width - canvas.width) <= 1);
  assert.ok(Math.abs(tree.y + tree.height - order.y) <= 1 && tree.height > order.height);
}

async function assertHuffmanLayout(page) {
  const state = await page.getByRole('region', { name: '哈夫曼候选结点与码字' }).boundingBox();
  const tree = await page.getByRole('region', { name: '哈夫曼树画布' }).boundingBox();
  const canvas = await page.locator('[data-viz-body]').boundingBox();
  assert.ok(tree.width > state.width && Math.abs(state.x + state.width - tree.x) <= 1);
  assert.ok(Math.abs(state.height - canvas.height) <= 1 && Math.abs(tree.height - canvas.height) <= 1);
  assert.equal(await page.locator('.trace-animation-viewport .canvas-card').count(), 0);
}

async function assertHuffmanStep(page, step) {
  const v = step.variables;
  const picked = page.locator('[data-huffman-picked] li');
  const candidates = page.getByRole('region', { name: '候选结点', exact: true }).locator('li');
  const tree = layer(page, 'g-huffman');
  if (v.root == null && !step.done) {
    assert.deepEqual(await picked.evaluateAll(items => items.map(item => Number(item.dataset.node))), v.selected);
    assert.deepEqual(await candidates.evaluateAll(items => items.map(item => Number(item.dataset.node))), v.candidates);
    assert.deepEqual(await candidates.locator('strong').allTextContents(), v.candidates.map(id => String(v.nodes[id].weight)));
    if (step.event === 'select') assert.equal(await picked.last().getAttribute('data-state'), 'current');
    if (step.event === 'merge') {
      assert.equal(await page.locator('.g-huffman-weights [data-state="added"]').getAttribute('data-node'), String(v.currentNode));
    }
  } else {
    const rows = page.locator('[data-huffman-codes] tbody tr');
    assert.deepEqual(await rows.evaluateAll(items => items.map(row => [...row.cells].map(cell => cell.textContent))),
      v.codes.map(code => [code.id, String(code.weight), code.code]));
    if (v.path != null) assert.ok((await page.locator('[data-huffman-path]').textContent()).endsWith(v.path));
  }
  const expectedEdges = [];
  if (step.event === 'merge') {
    expectedEdges.push(...v.selected.map(child => `e-${primitiveKey(v.currentNode)}-${primitiveKey(child)}`));
  }
  let node = v.root;
  for (const bit of v.path ?? '') {
    const next = bit === '0' ? v.nodes[node].left : v.nodes[node].right;
    if (next == null) break;
    expectedEdges.push(`e-${primitiveKey(node)}-${primitiveKey(next)}`);
    assert.equal(await tree.locator(`[data-avc-key="et-${primitiveKey(next)}"]`).textContent(), bit);
    node = next;
  }
  const highlighted = tree.locator('[data-avc-key^="e-"]').filter({ has: page.locator('line[stroke="#6650cf"]') });
  assert.deepEqual((await highlighted.evaluateAll(edges => edges.map(edge => edge.dataset.avcKey))).sort(), expectedEdges.sort());
}

async function assertThreadedStep(page, run, step) {
  const { order, edge } = step.variables;
  const currentThread = step.lineId === 'thread-output' ? { from: order.at(-2), to: order.at(-1), kind: 'successor' } : edge;
  const revealed = new Set(run.steps.slice(0, step.stepIndex + 1).filter(item => item.event === 'visit').map(item => item.variables.currentNode));
  const sequence = layer(page, 'g-threaded-order');
  assert.deepEqual(await sequence.locator('[data-avc-key^="gv-"]').allTextContents(),
    run.result.order.map(id => revealed.has(id) ? id : '—'));
  if (!currentThread) return;
  const { from, to, kind } = currentThread;
  const tree = layer(page, 'g-tree');
  const emphasis = [[from, '#fdf1e0'], [to, '#fdeff8']];
  for (const [id, fill] of emphasis) {
    if (id == null) continue;
    assert.equal(await tree.locator('[data-avc-key="n-' + primitiveKey(id) + '"] circle').getAttribute('fill'), fill);
    const index = run.result.order.indexOf(id);
    assert.equal(await sequence.locator('[data-avc-key="g-' + index + '"] rect').getAttribute('fill'), fill);
  }
  if (to == null) {
    assert.match(await page.locator('.g-threaded-order .array-animation-label p').textContent(), /→ 空$/);
    return;
  }
  const thread = tree.locator('[data-avc-key="th-' + primitiveKey(from) + '-' + primitiveKey(to) + '"]');
  const path = thread.locator('[stroke-dasharray="5 4"]');
  assert.equal(await path.getAttribute('stroke'), kind === 'predecessor' ? '#8a4b00' : '#0a6b4a');
  assert.equal(await path.getAttribute('stroke-width'), '2.8');
  assert.equal(await thread.locator('[data-role="arrow"]').count(), 1);
}

async function assertTree(page, name, nodes, { huffman = false, threaded = false, reconstruction = false } = {}) {
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
  const edgeShapes = svg.locator('[data-avc-key^="e-n"]');
  const solidEdges = reconstruction ? edgeShapes.filter({ has: page.locator('line:not([stroke-dasharray])') }) : edgeShapes;
  assert.equal(await solidEdges.count(), edgeCount);
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
    if (v.currentNode != null) {
      const node = '[data-avc-key="n-' + primitiveKey(v.currentNode) + '"] circle';
      assert.equal(await layer(page, 'g-forest').locator(node).getAttribute('fill'), '#fdf1e0');
      assert.equal(await layer(page, 'g-binary').locator(node).getAttribute('fill'), '#fdf1e0');
    }
    if (v.edge?.from != null) {
      const edge = '[data-avc-key="e-' + primitiveKey(v.edge.from) + '-' + primitiveKey(v.edge.to) + '"] line';
      const output = v.mode === 'to-forest' ? 'g-forest' : 'g-binary';
      assert.equal(await layer(page, output).locator(edge).getAttribute('stroke'), '#6650cf');
    }
  } else if (step.algorithm === 'huffman-coding') {
    await assertTree(page, 'g-huffman', v.nodes, { huffman: true });
    await assertHuffmanStep(page, step);
  } else {
    await assertTree(page, 'g-tree', v.nodes, {
      threaded: step.algorithm === 'threaded-binary-tree', reconstruction: step.algorithm === 'binary-tree-reconstruction',
    });
    if (isBinaryTraversal(step.algorithm)) {
      if (v.queue) {
        const queue = page.locator('.g-level-order-state .b-traversal-cells');
        assert.deepEqual(await queue.locator('.g-level-order-node').allTextContents(), v.queue.map(entry => entry.id));
        assert.deepEqual(await queue.locator('.g-level-order-level').allTextContents(), v.queue.map(entry => '第 ' + entry.level + ' 层'));
        const visited = page.locator('.g-level-order-levels > li');
        assert.deepEqual(await visited.locator(':scope > span').allTextContents(), v.levels.map((_, index) => '第 ' + (index + 1) + ' 层'));
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
      await assertTraversalLayout(page, id);
      await page.locator('[data-viz-full]').click();
      await assertTraversalLayout(page, id);
      await page.keyboard.press('Escape');
      await assertTraversalLayout(page, id);
    }
    if (id === 'binary-tree-reconstruction' || id === 'tree-forest-traversal') {
      const labels = id === 'binary-tree-reconstruction' ? ['前序与中序的重建区间', '二叉树画布'] : ['递归栈与访问顺序', '森林遍历画布'];
      await assertArrayAndTreeLayout(page, ...labels);
      await page.locator('[data-viz-full]').click();
      await assertArrayAndTreeLayout(page, ...labels);
      await page.keyboard.press('Escape');
      await assertArrayAndTreeLayout(page, ...labels);
    }
    if (id === 'tree-forest-traversal') await assertForestTraversalSteps(page, run);
    if (id === 'huffman-coding') {
      await assertHuffmanLayout(page);
      await page.locator('[data-viz-full]').click();
      await assertHuffmanLayout(page);
      await page.keyboard.press('Escape');
      const ruler = page.locator('[data-tl-ruler]');
      for (const step of run.steps.slice(1)) {
        await ruler.press('ArrowRight');
        await assertStep(page, run, step.stepIndex);
      }
      await ruler.press('Home');
      await assertStep(page, run, 0);
    }
    if (id === 'tree-forest-conversion') {
      await assertConversionLayout(page, 'to-binary');
      await page.locator('[data-viz-full]').click();
      await assertConversionLayout(page, 'to-binary');
      await page.keyboard.press('Escape');
    }
    if (id === 'threaded-binary-tree') {
      await assertThreadedLayout(page);
      await page.locator('[data-viz-full]').click();
      await assertThreadedLayout(page);
      await page.keyboard.press('Escape');
      const ruler = page.locator('[data-tl-ruler]');
      for (const step of run.steps) {
        if (step.stepIndex) await ruler.press('ArrowRight');
        await assertThreadedStep(page, run, step);
      }
      await ruler.press('ArrowLeft');
      await assertThreadedStep(page, run, run.steps.at(-2));
      await ruler.press('Home');
      await assertThreadedStep(page, run, run.steps[0]);
    }
    await page.click('#nextBtn');
    await assertStep(page, run, 1);
    await page.click('[data-t="last"]');
    await assertStep(page, run, run.steps.length - 1);
    if (caption) {
      const state = id === 'binary-tree-level-order' ? '.g-level-order-state' : '.level-order-tables';
      assert.match(await page.locator(state).innerText(), caption, id);
    } else assert.equal(await page.locator('.g-state-tables').count(), 0, id);
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
  await page.click('#fillDemo');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reconstruction = await startRun(page, 'binary-tree-reconstruction');
  const rulerControl = page.locator('[data-tl-ruler]');
  const fills = id => layer(page, id).locator('[data-avc-key^="g-"] rect').evaluateAll(cells => cells.map(cell => cell.getAttribute('fill')));
  await rulerControl.press('ArrowRight');
  const root = layer(page, 'g-tree').locator('[data-avc-key="n-n41"] circle');
  const rootPosition = await root.evaluate(node => node.parentElement.parentElement.style.transform);
  await rulerControl.press('ArrowRight');
  assert.deepEqual(await fills('g-rebuild-preorder'), ['#fdf1e0', '#e7f1fd', '#e7f1fd', '#fdeff8']);
  assert.deepEqual(await fills('g-rebuild-inorder'), ['#e7f1fd', '#e7f1fd', '#fdf1e0', '#fdeff8']);
  await rulerControl.press('ArrowRight');
  await rulerControl.press('ArrowRight');
  await assertStep(page, reconstruction, 4);
  assert.deepEqual(await fills('g-rebuild-preorder'), ['#f7f8fc', '#fdf1e0', '#ffffff', '#f7f8fc']);
  assert.equal(await root.evaluate(node => node.parentElement.parentElement.style.transform), rootPosition);
  assert.match(await page.locator('.g-reconstruction-path').textContent(), /A → B/);
  const pendingEdge = layer(page, 'g-tree').locator('[data-avc-key="e-n41-n42"] line');
  assert.ok(await pendingEdge.getAttribute('stroke-dasharray'));
  await rulerControl.press('ArrowLeft');
  await rulerControl.press('ArrowLeft');
  assert.deepEqual(await fills('g-rebuild-inorder'), ['#e7f1fd', '#e7f1fd', '#fdf1e0', '#fdeff8']);
  assert.equal(await pendingEdge.count(), 0);
  await rulerControl.press('End');
  assert.equal(await pendingEdge.getAttribute('stroke-dasharray'), null);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.click('#g-edit');
  const longNames = ['ReconstructionNodeLeft', 'ReconstructionNodeRight'];
  await page.fill('#g-primary', longNames.join(', '));
  await page.fill('#g-secondary', [...longNames].reverse().join(', '));
  await startRun(page, 'binary-tree-reconstruction');
  await page.locator('[data-t="last"]').click();
  const rebuilt = layer(page, 'g-tree');
  for (const name of longNames) {
    assert.equal(await rebuilt.locator('[data-avc-key="n-' + primitiveKey(name) + '"] circle title').textContent(), name);
  }
  assert.deepEqual(await layer(page, 'g-rebuild-preorder').locator('rect > title').allTextContents(), longNames);

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
  await assertConversionLayout(page, 'to-forest');
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
  const postorder = await startRun(page, 'tree-forest-traversal');
  assert.deepEqual(postorder.result, ['B', 'C', 'A', 'D']);
  await assertForestTraversalSteps(page, postorder);

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
