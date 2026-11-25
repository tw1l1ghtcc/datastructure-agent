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

async function assertFullCanvas(page, selector = '[data-graph-view="canvas"] [data-viz-body], .b-graph-viewport') {
  await page.waitForFunction(selector => {
    const body = document.querySelector(selector);
    const svg = body?.querySelector('.b-animation-stage > svg');
    return svg && Math.abs(svg.viewBox.baseVal.width - body.clientWidth) <= 1 &&
      Math.abs(svg.viewBox.baseVal.height - body.clientHeight) <= 1;
  }, selector);
  const stage = page.locator('.b-animation-stage');
  assert.equal(await stage.locator('> svg').count(), 1);
  assert.equal(await stage.locator('.canvas-card').count(), 0);
  const geometry = await stage.locator('> svg').evaluate(svg => {
    const circles = Array.from(svg.querySelectorAll('[data-graph-node] circle'), circle => circle.getBoundingClientRect());
    const box = svg.getBoundingClientRect();
    const graphWidth = Math.max(...circles.map(circle => circle.right)) - Math.min(...circles.map(circle => circle.left));
    const graphHeight = Math.max(...circles.map(circle => circle.bottom)) - Math.min(...circles.map(circle => circle.top));
    return {
      occupied: Math.max(graphWidth, graphHeight) / Math.min(box.width, box.height),
      points: circles.map(circle => ({ x: circle.x + circle.width / 2, y: circle.y + circle.height / 2 })),
    };
  });
  const { occupied, points } = geometry;
  if (points.length < 3) return;
  assert.ok(occupied >= 0.65, '图节点应使用可用空间，实际比例 ' + occupied);
  if (points.length <= 8) {
    const distances = points.map((point, index) => {
      const next = points[(index + 1) % points.length];
      return Math.hypot(next.x - point.x, next.y - point.y);
    });
    assert.ok(Math.max(...distances) - Math.min(...distances) < 1, '环形布局上的节点应保持等距');
  } else {
    const nextRow = points.find(point => point.y > points[0].y + 1);
    const xSpacing = points[1].x - points[0].x;
    const ySpacing = nextRow.y - points[0].y;
    assert.ok(Math.abs(xSpacing - ySpacing) < 1, '网格的横向和纵向间距应相等');
  }
}

async function assertSplitCanvas(page, tablePane) {
  await assertFullCanvas(page, '.b-graph-viewport');
  const graphPane = page.locator('.b-graph-viewport');
  const tableBox = await tablePane.boundingBox();
  const graphBox = await graphPane.boundingBox();
  const workspace = await page.locator('[data-viz-body]').boundingBox();
  assert.ok(Math.abs(tableBox.x + tableBox.width - graphBox.x) <= 1 &&
    graphBox.width > tableBox.width && Math.abs(tableBox.y - graphBox.y) <= 1 &&
    Math.abs(tableBox.width + graphBox.width - workspace.width) <= 1 &&
    Math.abs(tableBox.height - workspace.height) <= 1 && Math.abs(graphBox.height - workspace.height) <= 1,
  '状态表和图应左右并排铺满画布');
  const style = await tablePane.evaluate(element => {
    const pane = getComputedStyle(element);
    const header = getComputedStyle(element.querySelector('thead th'));
    const viewport = getComputedStyle(element.closest('[data-viz-body]'));
    const bar = getComputedStyle(element.closest('.vizwin').querySelector('.win-bar'));
    return {
      colors: [pane.backgroundColor, header.backgroundColor, header.borderBottomColor],
      theme: [viewport.backgroundColor, viewport.backgroundColor, bar.borderBottomColor],
      divider: pane.borderRightWidth
    };
  });
  assert.deepEqual(style.colors, style.theme);
  assert.equal(style.divider, '0px');
  const scale = () => graphPane.locator('.b-animation-stage').evaluate(stage =>
    new DOMMatrix(getComputedStyle(stage).transform).a);
  await tablePane.dispatchEvent('wheel', { ctrlKey: true, deltaY: -100 });
  assert.equal(await scale(), 1);
  await graphPane.dispatchEvent('wheel', { ctrlKey: true, deltaY: -100,
    clientX: graphBox.x + graphBox.width / 2, clientY: graphBox.y + graphBox.height / 2 });
  assert.ok(await scale() > 1);
  assert.deepEqual(await tablePane.boundingBox(), tableBox);
  await page.locator('[data-viz-view-reset]').click();
  assert.equal(await scale(), 1);
}

async function assertTraversalSlides(page, run) {
  const queue = run.algorithm === 'bfs';
  const key = queue ? 'queue' : 'stack';
  const pane = page.getByRole('region', { name: queue ? '队列' : '栈', exact: true });
  assert.match(await pane.locator('.b-traversal-ends').innerText(), queue ? /队首.*出队\s+队尾.*入队/ : /栈底\s+栈顶.*入栈.*出栈/);
  const drawer = await pane.boundingBox();
  const graph = await page.locator('.b-graph-viewport').boundingBox();
  assert.ok(Math.abs(drawer.x + drawer.width - graph.x) <= 1);
  const readMove = direction => page.evaluate(direction => {
    document.querySelector(direction > 0 ? '#nextBtn' : '#prevBtn').click();
    return [...document.querySelectorAll('.b-traversal-cell')].map(cell => ({
      value: cell.textContent,
      leaving: Boolean(cell.closest('.b-traversal-exits')),
      frames: cell.getAnimations().flatMap(animation => animation.effect.getKeyframes().map(frame => frame.transform)),
    }));
  }, direction);
  function assertMotion(moves, from, to, sign, leaving) {
    const changed = (leaving ? from : to).find(value => !(leaving ? to : from).includes(value));
    const item = moves.find(item => item.value === changed && item.leaving === leaving);
    assert.ok(item?.frames.length, '变化的顶点应滑动');
    const offset = leaving ? item.frames.at(-1) : item.frames[0];
    assert.equal(Math.sign(Number(offset.match(/translateX\(([-\d.]+)px\)/)[1])), sign);
    assert.deepEqual(moves.filter(item => !item.leaving).map(item => item.value), to);
  }
  const ruler = page.locator('[data-tl-ruler]');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  for (const [event, leaving] of [[queue ? 'enqueue-neighbor' : 'push-neighbor', false], [queue ? 'dequeue' : 'pop', true]]) {
    const step = run.steps.find(step => step.event === event &&
      (leaving ? run.steps[step.stepIndex - 1] : step).variables[key].length > 1);
    await ruler.press('Home');
    for (let i = 1; i < step.stepIndex; i++) await ruler.press('ArrowRight');
    const before = run.steps[step.stepIndex - 1].variables[key];
    const after = step.variables[key];
    const sign = queue && leaving ? -1 : 1;
    assertMotion(await readMove(1), before, after, sign, leaving);
    assert.ok((await page.locator('[data-explain-host] .bsviz-status').textContent())
      .includes('[' + before.join('、') + '] → [' + after.join('、') + ']'));
    assertMotion(await readMove(-1), after, before, sign, !leaving);
  }
  const exits = pane.locator('.b-traversal-exits > *');
  await pane.locator('.b-traversal-lane').evaluate(async lane => {
    await Promise.allSettled(lane.getAnimations({ subtree: true }).map(animation => animation.finished));
  });
  assert.equal(await exits.count(), 0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
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
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/#workbench?algorithm=bfs');
  assert.equal(await page.locator('#algorithm-trigger').getAttribute('data-algorithm'), 'bfs');
  assert.equal(await page.locator('#tutor-toggle').isVisible(), true);
  const trigger = page.locator('#algorithm-trigger');
  await trigger.hover();
  const graphChapter = page.getByRole('button', { name: '第六章 · 图' });
  await graphChapter.hover();
  const graphMenu = page.locator('#' + await graphChapter.getAttribute('aria-controls'));
  await graphMenu.waitFor();
  const graphBounds = await graphMenu.boundingBox();
  const chapterBounds = await graphChapter.boundingBox();
  assert.ok(graphBounds.x >= chapterBounds.x + chapterBounds.width);
  await page.mouse.move(graphBounds.x + 12, graphBounds.y + 12, { steps: 8 });
  assert.equal(await graphMenu.isVisible(), true);
  assert.equal(await trigger.getAttribute('data-algorithm'), 'bfs');
  await page.locator('[data-algorithm-choice="bfs"]').click();
  assert.equal(await page.locator('#algorithm-chapters').isHidden(), true);
  await trigger.focus();
  await page.keyboard.press('ArrowDown');
  await graphChapter.focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('[data-algorithm-choice="bfs"]').evaluate(node => node === document.activeElement), true);
  await page.keyboard.press('Escape');
  assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
  await page.click('#fillDemo');
  assert.match(await page.locator('#bfs-count').innerText(), /5/);
  await page.click('#bfs-next');
  await page.click('#bfs-back');
  await page.click('#bfs-next');
  assert.equal(await page.inputValue('#bfs-start'), 'A');
  assert.deepEqual(await page.locator('#bfs-edges select').evaluateAll(items => items.map(item => item.value)),
    ['A', 'B', 'A', 'C', 'B', 'D']);
  const responsePending = page.waitForResponse(response => response.url().endsWith('/api/algorithms/bfs/runs'));
  await page.click('#startBtn');
  const response = await responsePending;
  assert.equal(response.status(), 200);
  const run = await response.json();
  assert.deepEqual(run.result, ['A', 'B', 'C', 'D']);
  const stepResponse = await page.request.get(base + '/api/runs/' + run.runId + '/steps/0');
  assert.equal(stepResponse.status(), 200);
  await page.locator('[data-viz-engine="plus-graph"]').waitFor();
  const isolated = page.locator('[data-graph-node="E"] circle');
  await isolated.waitFor();
  await assertFullCanvas(page);
  const originalViewport = page.viewportSize();
  await page.setViewportSize({ width: 1720, height: 760 });
  await assertFullCanvas(page);
  await page.setViewportSize(originalViewport);
  assert.equal(await page.locator('#bfs-fields').isHidden(), true);
  assert.equal(await page.locator('#fillDemo').isHidden(), true);
  assert.equal(await page.locator('#bfs-run-detail').innerText(), '无向图 · 5 个顶点 · 3 条边 · 起点 A');
  await page.click('#nextBtn');
  assert.equal(await page.locator('#code-lines .active').getAttribute('data-line-id'), 'init-visited');
  const explanation = page.locator('[data-explain-host]');
  await explanation.getByRole('button', { name: '收起' }).click();
  assert.equal(await explanation.locator('.bsviz-status').isHidden(), true);
  await explanation.getByRole('button', { name: '展开' }).click();
  assert.match(await explanation.locator('.bsviz-status').innerText(), /队列/);
  await page.click('#prevBtn');
  assert.equal(await page.locator('#code-lines .active').getAttribute('data-line-id'), 'init');
  await page.click('[data-t="last"]');
  assert.match(await page.locator('[data-explain-host]').innerText(), /A -> B -> C -> D/);
  assert.equal(await isolated.getAttribute('fill'), '#eef4ff');

  const enqueue = run.steps.find(step => step.event === 'enqueue-neighbor');
  await page.locator('[data-tl-ruler]').focus();
  await page.keyboard.press('Home');
  for (let step = 0; step < enqueue.stepIndex; step++) await page.keyboard.press('ArrowRight');
  await page.click('#tutor-toggle');
  assert.equal(await page.locator('.tutor-practice').isHidden(), true);
  await page.fill('#question-input', '为什么这个顶点入队？');
  const explainPending = page.waitForResponse(response => response.url().endsWith('/api/agent/explain'));
  await page.click('#send-btn');
  const explain = await explainPending;
  assert.equal(explain.status(), 200);
  const reply = await explain.json();
  assert.equal(reply.runId, run.runId);
  assert.equal(reply.stepIndex, enqueue.stepIndex);
  assert.deepEqual(reply.stepRefs[0].variables, enqueue.variables);
  assert.match(reply.answer, /BFS.*队列/);
  await page.locator('.message.assistant').getByText(/BFS.*队列/).waitFor();
  await page.click('#tutor-close');
  await assertTraversalSlides(page, run);
  await page.click('[data-t="last"]');

  await page.click('#bfs-edit');
  assert.equal(await page.inputValue('#bfs-start'), 'A');
  assert.equal(await page.locator('#startBtn').innerText(), '重新运行');
  await page.click('#bfs-back');
  await page.fill('#bfs-nodes', 'A, C, D, E');
  await page.click('#bfs-next');
  assert.equal(await page.locator('#bfs-edges [aria-invalid="true"]').count(), 2);
  await page.click('#startBtn');
  assert.match(await page.locator('#msgBox').innerText(), /第 1 条边/);
  assert.match(await page.locator('[data-explain-host]').innerText(), /A -> B -> C -> D/);

  await page.click('#bfs-back');
  await page.fill('#bfs-nodes', 'Solo');
  await page.click('#bfs-next');
  for (const button of await page.locator('#bfs-edges button').all()) {
    await page.locator('#bfs-edges button').first().click();
  }
  await page.selectOption('#bfs-start', 'Solo');
  const soloPending = page.waitForResponse(response => response.url().endsWith('/api/algorithms/bfs/runs'));
  await page.click('#startBtn');
  const solo = await (await soloPending).json();
  assert.deepEqual(solo.result, ['Solo']);
  await page.locator('#bfs-edit').waitFor();
  assert.equal(await page.locator('#bfs-run-detail').innerText(), '无向图 · 1 个顶点 · 0 条边 · 起点 Solo');

  const invalid = await page.request.post(base + '/api/algorithms/bfs/runs', {
    data: { nodes: ['A'], edges: [['A', 'B']], start: 'A' }
  });
  assert.equal(invalid.status(), 400);
  const graphExamples = [
    ['dfs', false, true, null, result => assert.deepEqual(result, ['A', 'B', 'D', 'C'])],
    ['prim', true, true, false, result => assert.equal(result.totalWeight, 8)],
    ['kruskal', true, false, false, result => assert.equal(result.totalWeight, 8)],
    ['dijkstra', true, true, null, result => assert.equal(result.E, 8)],
    ['floyd', true, false, null, result => assert.equal(result[0], '0, 2, 3, 5, 8')],
    ['topological-sort', false, false, true, result => assert.deepEqual(result, ['A', 'E', 'B', 'C', 'D'])]
  ];
  for (const [algorithm, weighted, hasStart, directed, checkResult] of graphExamples) {
    await selectWorkbenchAlgorithm(page, algorithm);
    await page.click('#fillDemo');
    await page.click('#bfs-next');
    assert.equal(await page.locator('.graph-weight').first().isVisible(), weighted, algorithm);
    assert.equal(await page.locator('#bfs-start').isVisible(), hasStart, algorithm);
    assert.equal(await page.locator('#bfs-directed').isVisible(), directed === null, algorithm);
    if (directed !== null) {
      assert.match(await page.locator('#graph-fixed-direction').innerText(), directed ? /有向图/ : /无向图/);
    }
    if (algorithm === 'dijkstra') {
      const weight = page.locator('.graph-weight input').first();
      await weight.fill('-1');
      await page.click('#startBtn');
      assert.match(await page.locator('#msgBox').innerText(), /非负权重/);
      await weight.fill('2');
      await page.click('#bfs-back');
      const nodes = page.locator('#bfs-nodes');
      await nodes.fill(await nodes.inputValue() + ', 孤立点');
      await page.click('#bfs-next');
    }
    const pending = page.waitForResponse(response => response.url().endsWith('/api/algorithms/' + algorithm + '/runs'));
    await page.click('#startBtn');
    const response = await pending;
    assert.equal(response.status(), 200, algorithm);
    const graphRun = await response.json();
    assert.equal(graphRun.graph.directed, directed ?? false);
    assert.equal(Object.hasOwn(graphRun.graph, 'start'), hasStart);
    assert.equal(graphRun.graph.edges[0].length, weighted ? 3 : 2);
    checkResult(graphRun.result);
    await page.locator('#bfs-edit').waitFor();
    await page.click('[data-t="last"]');
    assert.equal(await page.locator('#code-lines .active').getAttribute('data-line-id'), graphRun.steps.at(-1).lineId);
    assert.equal(await page.locator('[data-explain-host] .bsviz-caption').innerText(), graphRun.steps.at(-1).description);
    assert.ok((await page.locator('[data-explain-host] .bsviz-status').innerText()).length > 10, algorithm);
    assert.equal(await page.locator('[data-viz-engine="plus-graph"] [data-graph-node]').count(), graphRun.graph.nodes.length);
    if (algorithm !== 'floyd' && algorithm !== 'dijkstra') await assertFullCanvas(page);
    if (algorithm === 'dfs') await assertTraversalSlides(page, graphRun);
    if (algorithm === 'kruskal') {
      const selected = page.locator('[data-layer="b-graph"] [data-avc-key^="e-"] line[stroke="#0a6b4a"]');
      assert.equal(await selected.count(), graphRun.result.selectedEdges.length);
    }
    if (algorithm === 'dijkstra') {
      const status = page.getByRole('region', { name: '最短路径状态表' });
      await assertSplitCanvas(page, status);
      assert.match(await status.locator('caption').innerText(), /起点：A/);
      const rows = status.locator('tbody tr');
      const displayed = () => rows.evaluateAll(rows => rows.map(row => Array.from(row.cells, cell => cell.textContent)));
      const expected = ({ dist, previous, visited }) => graphRun.graph.nodes.map(node =>
        [node, String(dist[node]), previous[node] ?? '—', visited.includes(node) ? '是' : '否']);
      assert.deepEqual(await displayed(), expected(graphRun.steps.at(-1).variables));
      assert.deepEqual(await rows.filter({ hasText: '孤立点' }).locator('td').allTextContents(), ['∞', '—', '否']);

      const ruler = page.locator('[data-tl-ruler]');
      await ruler.press('Home');
      assert.deepEqual(await displayed(), expected(graphRun.steps[0].variables));
      const update = graphRun.steps.find(step => step.event === 'update-dist');
      for (let i = 0; i < update.stepIndex; i++) await ruler.press('ArrowRight');
      assert.deepEqual(await displayed(), expected(update.variables));
      assert.deepEqual(await rows.nth(graphRun.graph.nodes.indexOf(update.variables.currentEdge[1]))
        .locator('[data-active="target"]').allTextContents(), [String(update.variables.currentEdge[2]), 'A']);
    }
    if (algorithm === 'floyd') {
      const matrix = page.getByRole('region', { name: '距离矩阵' });
      await assertSplitCanvas(page, matrix);
      const table = matrix.locator('.uf-table');
      const graphPane = page.locator('.b-graph-viewport');
      const values = await table.locator('tbody tr').evaluateAll(rows =>
        rows.map(row => Array.from(row.querySelectorAll('td'), cell => cell.textContent).join(', ')));
      assert.deepEqual(values, graphRun.steps.at(-1).variables.matrix);
      await page.locator('[data-tl-ruler]').press('Home');
      const initial = await table.locator('tbody tr').evaluateAll(rows =>
        rows.map(row => Array.from(row.querySelectorAll('td'), cell => cell.textContent).join(', ')));
      assert.deepEqual(initial, graphRun.steps[0].variables.matrix);
      await page.locator('[data-viz-full]').click();
      await assertFullCanvas(page, '.b-graph-viewport');
      await page.keyboard.press('Escape');
      await assertFullCanvas(page, '.b-graph-viewport');

      await page.click('#bfs-edit');
      await page.click('#bfs-back');
      await page.fill('#bfs-nodes', 'A, B, C, D, E, LongVertexNameOne, LongVertexNameTwo, LongVertexNameThree');
      await page.click('#bfs-next');
      await page.click('#startBtn');
      await page.locator('#bfs-edit').waitFor();
      assert.equal(await table.locator('tbody tr').count(), 8);
      const beforeScroll = await graphPane.boundingBox();
      assert.ok(await matrix.evaluate(element => {
        element.scrollLeft = element.scrollWidth;
        return element.scrollLeft > 0;
      }), '较宽的 Floyd 距离矩阵可独立横向滚动');
      assert.deepEqual(await graphPane.boundingBox(), beforeScroll);
    }
    const agent = await page.request.post(base + '/api/agent/explain', {
      data: { runId: graphRun.runId, stepIndex: 1, question: '这一步发生了什么？', hintLevel: 2 }
    });
    assert.equal(agent.status(), 200, algorithm);
    assert.deepEqual((await agent.json()).stepRefs[0].variables, graphRun.steps[1].variables);
  }
  const cyclePending = page.waitForResponse(response => response.url().endsWith('/api/algorithms/topological-sort/runs'));
  await page.click('#bfs-edit');
  await page.click('#bfs-add-edge');
  const closingEdge = page.locator('.bfs-edge').last().locator('select');
  await closingEdge.nth(0).selectOption('D');
  await closingEdge.nth(1).selectOption('A');
  await page.click('#startBtn');
  assert.equal((await (await cyclePending).json()).result, 'Has Cycle');
  await page.locator('#bfs-edit').waitFor();
  await page.click('[data-t="last"]');
  assert.match(await page.locator('[data-explain-host]').innerText(), /存在环/);
  await page.locator('[data-viz-full]').click();
  await assertFullCanvas(page);
  await page.keyboard.press('Escape');
  await assertFullCanvas(page);

  await selectWorkbenchAlgorithm(page, 'bfs');
  await page.click('#fillDemo');
  await page.click('#bfs-next');
  await page.selectOption('#bfs-directed', 'true');
  for (const [from, to] of [['B', 'A'], ['D', 'D']]) {
    await page.click('#bfs-add-edge');
    const row = page.locator('.bfs-edge').last();
    await row.locator('select').nth(0).selectOption(from);
    await row.locator('select').nth(1).selectOption(to);
  }
  const directedPending = page.waitForResponse(response => response.url().endsWith('/api/algorithms/bfs/runs'));
  await page.click('#startBtn');
  assert.equal((await directedPending).status(), 200);
  await page.locator('#bfs-edit').waitFor();
  const edge = key => page.locator('[data-layer="b-graph"] [data-avc-key="' + key + '"]');
  const route = key => edge(key).locator('polyline:not([data-role="arrow"])').getAttribute('points');
  assert.notEqual(await route('e-A-B'), await route('e-B-A'));
  assert.equal((await route('e-D-D')).split(' ').length, 4);
  assert.equal(await edge('e-D-D').locator('[data-role="arrow"]').count(), 1);
  await page.locator('[data-tl-ruler]').press('End');
  await page.locator('[data-tl-ruler]').press('Home');
  assert.equal(await edge('e-D-D').locator('[data-role="arrow"]').count(), 1);

  await page.setViewportSize({ width: 1120, height: 800 });
  await assertFullCanvas(page);
  const viewport = page.locator('.b-graph-viewport');
  const scene = page.locator('.b-animation-stage');
  const scale = () => scene.evaluate(element => new DOMMatrix(getComputedStyle(element).transform).a);
  await viewport.scrollIntoViewIfNeeded();
  const bounds = await viewport.boundingBox();
  const startX = bounds.x + bounds.width / 2;
  const startY = bounds.y + bounds.height / 2;
  await viewport.dispatchEvent('wheel', { ctrlKey: true, deltaY: -100, clientX: startX, clientY: startY });
  assert.ok(await scale() > 1);
  await page.locator('#nextBtn').click();
  assert.ok(await scale() > 1);
  await page.locator('[data-viz-view-reset]').click();
  assert.equal(await scale(), 1);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 32, startY + 20);
  await page.mouse.up();
  assert.ok(await scene.evaluate(element => new DOMMatrix(getComputedStyle(element).transform).e) > 0);
  await page.locator('[data-viz-view-reset]').click();
  await page.locator('[data-viz-full]').click();
  await assertFullCanvas(page);
  await page.keyboard.press('Escape');
  await assertFullCanvas(page);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  await page.click('#bfs-edit');
  await page.click('#bfs-back');
  const denseNodes = ['A', 'B', 'C', 'D', 'E', ...Array.from({ length: 25 }, (_, i) => 'N' + (i + 1))];
  await page.fill('#bfs-nodes', denseNodes.join(', '));
  await page.click('#bfs-next');
  for (const to of denseNodes.slice(3)) {
    await page.click('#bfs-add-edge');
    const row = page.locator('.bfs-edge').last();
    await row.locator('select').nth(0).selectOption('A');
    await row.locator('select').nth(1).selectOption(to);
  }
  const densePending = page.waitForResponse(response => response.url().endsWith('/api/algorithms/bfs/runs'));
  await page.click('#startBtn');
  const denseResponse = await densePending;
  assert.equal(denseResponse.status(), 200);
  const denseRun = await denseResponse.json();
  await page.locator('#bfs-edit').waitFor();
  await assertFullCanvas(page);
  const denseGraph = page.locator('.b-animation-stage > svg');
  assert.equal(await denseGraph.locator('[data-graph-node]').count(), 30);
  assert.ok(await denseGraph.evaluate(svg => {
    const box = svg.querySelector('.avc-layer').getBBox();
    const { width, height } = svg.viewBox.baseVal;
    return box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height;
  }), '30 个顶点及其图元均在画布内');
  const widest = denseRun.steps.find(step => step.variables.queue.length === denseNodes.length - 1);
  await page.locator('#nextBtn').evaluate((button, count) => {
    for (let i = 0; i < count; i++) button.click();
  }, widest.stepIndex);
  const queuePane = page.getByRole('region', { name: '队列', exact: true });
  assert.deepEqual(await queuePane.locator('.b-traversal-cells > li').allTextContents(), widest.variables.queue);
  const scroll = queuePane.locator('.b-traversal-scroll');
  assert.ok(await scroll.evaluate(element => element.scrollLeft > 0), '长队列入队时露出队尾');
  const dequeue = denseRun.steps.slice(widest.stepIndex + 1).find(step => step.event === 'dequeue');
  await page.locator('#nextBtn').evaluate((button, count) => {
    for (let i = 0; i < count; i++) button.click();
  }, dequeue.stepIndex - widest.stepIndex);
  assert.deepEqual(await queuePane.locator('.b-traversal-cells > li').allTextContents(), dequeue.variables.queue);
  assert.equal(await scroll.evaluate(element => element.scrollLeft), 0, '出队时回到队首');
  await page.setViewportSize({ width: 1280, height: 900 });

  await selectWorkbenchAlgorithm(page, 'binary-search');
  await page.click('#fillDemo');
  await page.click('#startBtn');
  await page.locator('#code-lines [data-line-id="init-left"].active').waitFor();
  assert.deepEqual(errors, []);
  console.log('Graph workbench browser acceptance passed.');
} finally {
  await browser?.close();
  server.kill();
}
