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
function chartIndices(page, selector) {
  return page.locator('[data-viz-engine="plus-sort"] .prototype-array-cell' + selector)
    .evaluateAll(cells => cells.map(cell => Number(cell.dataset.index)));
}

function layerValues(page, layer, key) {
  return page.locator('[data-layer="' + layer + '"] [data-avc-key^="' + key + '"]').evaluateAll(elements =>
    elements.sort((a, b) => Number(a.dataset.avcKey.split('-').at(-1)) - Number(b.dataset.avcKey.split('-').at(-1)))
      .map(element => Number(element.querySelector('text')?.textContent)));
}

async function tempValues(page) {
  const values = await page.locator('.a-merge-cells [data-filled] .bsviz-value').allTextContents();
  return values.map(Number);
}

async function assertSplitCanvas(page, algorithm) {
  await page.waitForFunction(() => {
    const [left, chart] = document.querySelectorAll('.a-sort-split > div');
    if (!left || !chart) return false;
    return [left, chart].every(pane => {
      if (pane.matches('.a-merge-temp')) return true;
      const svg = pane.querySelector('svg');
      return svg?.viewBox.baseVal.width === pane.clientWidth && svg.viewBox.baseVal.height === pane.clientHeight;
    });
  });
  const geometry = await page.locator('.a-sort-split').evaluate(view => {
    const [auxiliary, chart] = view.children;
    const leftBox = auxiliary.getBoundingClientRect();
    const chartBox = chart.getBoundingClientRect();
    const workspace = view.closest('[data-viz-body]').getBoundingClientRect();
    return {
      widths: [leftBox.width + chartBox.width, workspace.width],
      heights: [leftBox.height, chartBox.height, workspace.height],
      gap: chartBox.left - leftBox.right,
      topOffset: chartBox.top - leftBox.top,
      treeRadius: Number(auxiliary.querySelector('[data-avc-key="tn-0"] circle')?.getAttribute('r')),
      largestBar: Math.max(...Array.from(chart.querySelectorAll('.prototype-array-cell g rect'), bar => Number(bar.getAttribute('height'))))
    };
  });
  assert.ok(Math.abs(geometry.widths[0] - geometry.widths[1]) <= 1);
  assert.ok(geometry.heights.every(height => Math.abs(height - geometry.heights[0]) <= 1));
  assert.ok(Math.abs(geometry.gap) <= 1 && Math.abs(geometry.topOffset) <= 1);
  if (algorithm === 'heap-sort') assert.ok(geometry.treeRadius > 13, '堆树结点应随画布放大');
  else assert.equal(await page.locator('.a-merge-temp svg').count(), 0, '临时数组用独立方块显示');
  assert.ok(geometry.largestBar > 94, '柱状图应随画布放大');
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
  await page.goto(base+'/#workbench?algorithm=insertion-sort');
  for(const algorithm of ['insertion-sort','binary-insertion-sort','shell-sort','selection-sort','quick-sort','heap-sort','merge-sort']){
    await selectWorkbenchAlgorithm(page,algorithm);
    await page.click('#fillDemo');
    const pending=page.waitForResponse(response=>response.url().endsWith('/api/algorithms/'+algorithm+'/runs'));
    await page.click('#startBtn');
    const response=await pending;assert.equal(response.status(),200,algorithm);
    const run=await response.json();assert.deepEqual(run.result,[1,2,4,5]);
    await page.locator('[data-viz-engine="plus-sort"]').waitFor();
    await page.locator('#code-lines .active').waitFor();
    if (algorithm === 'heap-sort' || algorithm === 'merge-sort') {
      await assertSplitCanvas(page, algorithm);
      await page.locator('[data-viz-full]').click();
      await assertSplitCanvas(page, algorithm);
      await page.keyboard.press('Escape');
      await assertSplitCanvas(page, algorithm);
    }
    assert.deepEqual(await chartIndices(page, '.is-comparing'), []);
    assert.deepEqual(await chartIndices(page, '.is-sorted'), []);
    let hole = null;
    const fixed = [];
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    for(let index=0;index<run.steps.length;index++){
      const step = run.steps[index], v = step.variables;
      const filling = step.event === 'fill-left' || step.event === 'fill-right';
      const binaryInsertion = algorithm === 'binary-insertion-sort';
      const shell = algorithm === 'shell-sort';
      const insertion = algorithm === 'insertion-sort' || binaryInsertion || shell;
      const heap = algorithm === 'heap-sort';
      const merge = algorithm === 'merge-sort';
      const selection = algorithm === 'selection-sort';
      if (algorithm === 'quick-sort' && filling) {
        assert.ok(await page.locator('[data-tl-ruler]').evaluate((control, destination) => {
          control.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
          return document.querySelector(`.prototype-array-cell[data-index="${destination}"] > g`)?.getAnimations().length > 0;
        }, v.fillTo));
      } else if (insertion && ['select', 'move', 'insert'].includes(step.event)) {
        const destination = step.event === 'move' ? v.j + (shell ? 0 : 1) : v.insertIndex;
        const target = step.event === 'select' ? '.a-sort-held-value'
          : `.prototype-array-cell[data-index="${destination}"] > g`;
        assert.ok(await page.locator('[data-tl-ruler]').evaluate((control, selector) => {
          control.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
          return document.querySelector(selector)?.getAnimations().length > 0;
        }, target));
      } else if ((heap || selection) && step.event === 'swap') {
        const indices = selection ? [v.i, v.minIndex] : step.lineId === 'swap-root' ? [0, v.i] : [v.i, v.largest];
        assert.ok(await page.locator('[data-tl-ruler]').evaluate((control, targets) => {
          control.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
          return targets.every(index => document.querySelector(
            `.prototype-array-cell[data-index="${index}"] > g`)?.getAnimations().length > 0);
        }, indices));
      } else if (merge && ['pick', 'copy'].includes(step.event)) {
        assert.ok(await page.locator('[data-tl-ruler]').evaluate(control => {
          control.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
          return document.querySelector('.a-merge-view .array-animation-moving-value')?.getAnimations().length > 0;
        }));
      } else if(index)await page.click('#nextBtn');
      assert.equal(await page.locator('#code-lines .active').getAttribute('data-line-id'),run.steps[index].lineId,algorithm);
      assert.doesNotMatch(await page.locator('.variables').innerText(),/undefined|NaN/);
      const caption = await page.locator('[data-explain-host] .bsviz-caption').textContent();
      const expected = step.array.map(String);
      if (algorithm === 'quick-sort') {
        assert.equal(caption, await page.locator('#step-description').textContent());
        if (step.event === 'init-pivot') {
          hole = v.low;
          const pivot = page.locator('.a-sort-held-value');
          assert.equal(await pivot.textContent(), String(v.pivot));
          assert.equal(await pivot.evaluate(node => getComputedStyle(node).borderStyle), 'solid');
        }
        if (filling) {
          expected[v.fillTo] = String(step.array[v.fillFrom]);
          hole = v.fillFrom;
          assert.ok(caption.includes('填入 A[' + v.fillTo + ']，坑移到 A[' + v.fillFrom + ']'));
        }
        if (step.event === 'place-pivot') {
          hole = null;
          fixed.push(v.i);
          assert.equal(await page.locator('.a-sort-held-location').textContent(), 'A[' + v.i + ']');
        }
        if (hole != null) expected[hole] = '坑';
        assert.deepEqual(await chartIndices(page, '.is-hole'), hole == null ? [] : [hole]);
        if (!step.done) assert.deepEqual(await chartIndices(page, '.is-sorted'), fixed.slice().sort((a, b) => a - b));
      } else if (insertion) {
        assert.equal(caption, await page.locator('#step-description').textContent());
        if (step.event === 'select') hole = v.i;
        if (step.event === 'move') {
          hole = shell ? v.j - v.gap : v.j;
          assert.ok(caption.includes(shell ? `右移 ${v.gap} 格到 A[${v.j}]` : `右移到 A[${v.j + 1}]`));
        }
        if (step.event === 'insert') {
          hole = null;
          assert.equal(await page.locator('.a-sort-held-value').textContent(), '—');
          assert.equal(await page.locator('.a-sort-held-location').textContent(), '已写回 A[' + v.insertIndex + ']');
          assert.match(caption, /写回/);
        }
        if (hole != null) {
          expected[hole] = '空位';
          assert.equal(await page.locator('.a-sort-held-value').textContent(), String(v.temp));
          assert.equal(await page.locator('.a-sort-held-location').textContent(), '当前空位 A[' + hole + ']');
        }
        assert.deepEqual(await chartIndices(page, '.is-hole'), hole == null ? [] : [hole]);
        if (binaryInsertion && ['init-bounds', 'compare', 'move-left', 'move-right'].includes(step.event)) {
          const range = Array.from({ length: Math.max(0, v.right - v.left + 1) }, (_, offset) => v.left + offset);
          assert.deepEqual(await chartIndices(page, '.is-binary-insertion-range'), range);
          const status = await page.locator('[data-explain-host] .bsviz-status').textContent();
          if (!range.length) assert.match(status, /查找区间已空/);
          if (v.mid != null) assert.equal(await page.locator('[data-ptr="mid"] text').textContent(), 'M');
        }
        if (binaryInsertion && step.event === 'found-pos') {
          assert.equal(await page.locator('[data-ptr="插入"] text').textContent(), '插入');
        }
        if (shell && v.gap > 0 && !step.done) {
          assert.deepEqual(await page.locator('.a-shell-group-label').allTextContents(),
            step.array.map((_, index) => '组' + (index % v.gap + 1)));
          if (step.event === 'gap') {
            assert.deepEqual(await chartIndices(page, '.is-excluded'), []);
            assert.equal(await page.locator('.a-sort-held').isHidden(), true);
          } else {
            assert.deepEqual(await chartIndices(page, '.is-excluded'),
              step.array.flatMap((_, index) => index % v.gap === v.i % v.gap ? [] : [index]));
          }
        }
      } else if (heap || merge || selection) {
        assert.equal(caption, await page.locator('#step-description').textContent());
      } else {
        assert.equal(caption, step.description);
      }
      assert.deepEqual(await page.locator('.prototype-array-value').allTextContents(), expected);
      if (merge) {
        assert.deepEqual(await tempValues(page), v.temp);
        const focusIndex = step.event === 'pick' ? v.temp.length - 1 : step.event === 'copy' ? v.p - 1 : null;
        const active = await page.locator('.a-merge-cells .is-comparing .bsviz-idx').allTextContents();
        assert.deepEqual(active.map(Number), focusIndex === null ? [] : [focusIndex]);
        if (step.event === 'pick') assert.deepEqual(await chartIndices(page, '.is-comparing'), [v.readIndex]);
        if (step.event === 'copy') assert.deepEqual(await chartIndices(page, '.is-comparing'), [v.low + v.p - 1]);
        if (['merge-start', 'compare', 'pick'].includes(step.event)) {
          const left = Array.from({ length: v.mid - v.low + 1 }, (_, offset) => v.low + offset);
          const right = Array.from({ length: v.high - v.mid }, (_, offset) => v.mid + offset + 1);
          assert.deepEqual(await chartIndices(page, '.is-merge-left'), left);
          assert.deepEqual(await chartIndices(page, '.is-merge-right'), right);
          const next = await page.locator('.a-merge-cells .is-next .bsviz-idx').allTextContents();
          assert.deepEqual(next, v.temp.length < v.high - v.low + 1 ? [String(v.temp.length)] : []);
        }
        if (focusIndex != null) {
          const pick = step.event === 'pick';
          const arrayRole = pick ? 'source' : 'destination';
          const tempRole = pick ? 'destination' : 'source';
          assert.deepEqual(await chartIndices(page, `[data-transfer="${arrayRole}"]`),
            [pick ? v.readIndex : v.low + focusIndex]);
          assert.equal(await page.locator(`.a-merge-cells [data-transfer="${tempRole}"] .bsviz-idx`).textContent(), String(focusIndex));
        }
      } else if (algorithm === 'heap-sort') {
        const size = step.done ? 0 : step.event === 'init' ? step.array.length
          : step.event === 'swap-root' ? v.heapSize + 1 : v.heapSize;
        assert.deepEqual(await layerValues(page, 'a-heap', 'tnv-'), step.array.slice(0, size));
        assert.equal(await page.locator('.a-heap-boundary').count(), size > 0 && size < step.array.length ? 1 : 0);
        const highlighted = await page.locator('[data-layer="a-heap"] [data-avc-key^="tn-"] circle[stroke="#8a4b00"]')
          .evaluateAll(circles => circles.map(circle => Number(circle.closest('[data-avc-key]').getAttribute('data-avc-key').slice(3))));
        assert.deepEqual(highlighted, (await chartIndices(page, '.is-comparing')).filter(index => index < size));
        if (step.event === 'swap-root') {
          assert.deepEqual(highlighted, [0, v.i]);
          assert.ok(!(await chartIndices(page, '.is-sorted')).includes(v.i));
        }
        if (step.event === 'swap' && step.lineId === 'swap-root') {
          assert.deepEqual(highlighted, [0]);
          assert.equal((await chartIndices(page, '.is-sorted'))[0], v.i);
          assert.match(caption, /已就位.*从新堆顶/);
        }
        if (step.lineId === 'swap-node') {
          assert.deepEqual(highlighted, [v.largest]);
          assert.ok(caption.includes('下沉到 A[' + v.largest + ']'));
        }
      } else if (algorithm === 'binary-insertion-sort' && step.event === 'compare') {
        assert.deepEqual(await chartIndices(page, '.is-comparing'), [v.mid]);
      } else if (algorithm === 'shell-sort' && step.event === 'compare') {
        assert.deepEqual(await chartIndices(page, '.is-comparing'), [v.j - v.gap]);
      } else if (selection && step.event !== 'init' && !step.done) {
        const placed = step.event === 'swap' || (step.event === 'check-swap' && v.i === v.minIndex);
        const candidate = placed ? v.i : v.minIndex;
        const scan = step.event === 'compare' || step.event === 'update-min';
        assert.equal(await page.locator('.a-selection-candidate .a-sort-held-value').textContent(), String(step.array[candidate]));
        assert.equal(await page.locator('.a-selection-candidate .a-sort-held-location').textContent(), '下标 ' + candidate);
        assert.equal(await page.locator('#varMid').textContent(), String(candidate));
        assert.equal(await page.locator('#varValue').textContent(), String(step.array[candidate]));
        assert.deepEqual(await chartIndices(page, '.is-selection-min'), placed ? [] : [candidate]);
        assert.equal(await page.locator('.a-selection-chart [data-ptr="j"]').count(), scan ? 1 : 0);
        if (step.event === 'compare') assert.deepEqual(await chartIndices(page, '.is-comparing'), [v.j]);
        if (step.event === 'update-min') assert.match(caption, new RegExp('更新为 ' + step.array[candidate] + '，下标是 ' + candidate));
        if (step.event === 'check-swap' && !placed) assert.deepEqual(await chartIndices(page, '.is-comparing'), [v.i, candidate]);
        if (placed) {
          assert.deepEqual(await chartIndices(page, '.is-comparing'), []);
          assert.equal((await chartIndices(page, '.is-sorted')).at(-1), v.i);
          if (step.event === 'check-swap') assert.match(caption, /跳过交换/);
        }
      }
    }
    const values=await page.locator('.prototype-array-value').allTextContents();
    assert.deepEqual(values,['1','2','4','5'],algorithm);
    assert.deepEqual(await chartIndices(page, '.is-comparing'), []);
    assert.deepEqual(await chartIndices(page, '.is-sorted'), [0, 1, 2, 3]);
    await page.locator('[data-tl-ruler]').press('ArrowLeft');
    const previous = run.steps.at(-2);
    assert.equal(await page.locator('#code-lines .active').getAttribute('data-line-id'), previous.lineId);
    assert.deepEqual(await page.locator('.prototype-array-value').allTextContents(), previous.array.map(String));
    if (algorithm === 'merge-sort') assert.deepEqual(await tempValues(page), previous.variables.temp);
    await page.click('#resetBtn');
    assert.deepEqual(await chartIndices(page, '.is-sorted'), []);
    assert.deepEqual(await page.locator('.prototype-array-value').allTextContents(), run.steps[0].array.map(String));
    const answer=await page.request.post(base+'/api/agent/explain',{data:{runId:run.runId,stepIndex:1,question:'解释本步'}});
    assert.equal(answer.status(),200);
    assert.deepEqual((await answer.json()).stepRefs[0].variables,run.steps[1].variables);
  }
  const dense = Array.from({ length: 24 }, (_, index) => Number.MAX_SAFE_INTEGER - index);
  for (const [algorithm, input, expected] of [['heap-sort', '', []], ['merge-sort', '0', [0]], ['heap-sort', '2,-3,2,0', [-3,0,2,2]],
    ['heap-sort', '9007199254740991,0,-9007199254740991', [-9007199254740991,0,9007199254740991]],
    ['heap-sort', Array.from({ length: 24 }, (_, index) => 23 - index).join(','), Array.from({ length: 24 }, (_, index) => index)],
    ['merge-sort', dense.join(','), [...dense].reverse()]]) {
    await page.setViewportSize({ width: 1120, height: 800 });
    await page.goto(base + '/#workbench?algorithm=' + algorithm);
    await page.fill('#arrInput', input);
    const response = page.waitForResponse(reply => reply.url().endsWith('/api/algorithms/' + algorithm + '/runs'));
    await page.click('#startBtn');
    const reply = await response;
    assert.equal(reply.status(), 200, algorithm);
    const run = await reply.json();
    await page.locator('[data-viz-engine="plus-sort"]').waitFor();
    await page.waitForFunction(values => {
      const displayed = document.querySelectorAll('.a-sort-chart .prototype-array-value');
      return displayed.length === values.length && [...displayed].every((node, index) => node.textContent === values[index]);
    }, run.steps[0].array.map(String));
    await page.click('[data-viz-view-reset]');
    const auxiliary = page.locator(algorithm === 'heap-sort' ? '.a-sort-auxiliary svg' : '.a-merge-temp');
    assert.ok(await auxiliary.evaluate(card =>
      card.getBoundingClientRect().bottom <= document.querySelector('.viewport-legend').getBoundingClientRect().top));
    if (algorithm === 'heap-sort' && input.startsWith('9007')) {
      const circle = page.locator('[data-avc-key="tn-0"] circle');
      const label = page.locator('[data-avc-key="tnv-0"] text');
      assert.equal(await label.textContent(), '9007199254740991');
      assert.deepEqual(await page.locator('[data-avc-key="tnv-0"] title').allTextContents(), ['9007199254740991']);
      assert.ok(Number(await label.getAttribute('textLength')) < 2 * Number(await circle.getAttribute('r')));
    }
    if (algorithm === 'heap-sort' && expected.length === 24) {
      assert.equal(await page.locator('[data-avc-key^="tnv-"]').count(), 24);
      assert.equal(await page.locator('.prototype-array-cell').count(), 24);
      assert.ok(await page.locator('.a-sort-split').evaluate(view => [...view.querySelectorAll('svg')].every(svg => {
        const bounds = svg.getBBox();
        const { width, height } = svg.viewBox.baseVal;
        return bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= height;
      })), '24 项数组的堆树和柱状图均在各自的画布内');
    }
    await page.locator('[data-tl-ruler]').press('End');
    assert.deepEqual(run.result, expected);
    assert.deepEqual(await page.locator('.prototype-array-value').allTextContents(), expected.map(String));
    if (algorithm === 'merge-sort' && expected.length === 24) {
      await page.locator('[data-tl-ruler]').press('ArrowLeft');
      assert.deepEqual(await tempValues(page), expected);
      const chart = page.locator('.a-sort-chart');
      const chartBefore = await chart.boundingBox();
      const temp = page.getByRole('region', { name: '归并临时数组' });
      assert.ok(await temp.evaluate(pane => {
        pane.scrollLeft = pane.scrollWidth;
        return pane.scrollLeft > 0;
      }), '较长的临时数组可以独立横向滚动');
      assert.deepEqual(await chart.boundingBox(), chartBefore);
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await page.goto(base + '/#workbench?algorithm=shell-sort');
  await page.fill('#arrInput', dense.join(','));
  await page.click('#startBtn');
  const ruler = page.locator('[data-tl-ruler]');
  await ruler.waitFor();
  await page.locator('#nextBtn').click();
  const groups = page.locator('.prototype-array-cell[data-shell-group]');
  const palette = await groups.evaluateAll(cells => cells.map(cell => {
    const { fill, stroke } = getComputedStyle(cell.querySelector('rect'));
    return [cell.dataset.shellGroup, fill, stroke];
  }));
  assert.equal(palette.length, 24);
  assert.equal(new Set(palette.slice(0, 12).map(([, fill]) => fill)).size, 12);
  assert.equal(new Set(palette.slice(0, 12).map(([, , stroke]) => stroke)).size, 12);
  assert.deepEqual(palette.slice(0, 12), palette.slice(12), '同组的两根柱子使用同一配色');
  await ruler.press('ArrowLeft');
  assert.equal(await groups.count(), 0);
  await ruler.press('ArrowRight');
  assert.deepEqual(await groups.locator('.a-shell-group-label').allTextContents(),
    dense.map((_, index) => '组' + (index % 12 + 1)));
  assert.deepEqual(errors,[]);
  console.log('A package workbench acceptance passed.');
}finally{await browser?.close();server.kill();}
