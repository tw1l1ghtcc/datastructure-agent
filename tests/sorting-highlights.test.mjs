import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrototypeArrayFrame } from '../frontend/src/features/visualization/prototype-array.js';
import { aSortMarks, activeHeapSize, describeSortAction, insertionSortFrame, mergeTransfer, quickSortFrames, selectionCandidate } from '../frontend/src/features/visualization/a-sort-state.js';
import { generateSteps } from '../shared/algorithms/binarySearch.js';
import { generateBubbleSteps } from '../shared/algorithms/bubbleSort.js';
import { generateInsertionSortSteps } from '../shared/algorithms/final/a/insertion-sort.js';
import { generateBinaryInsertionSortSteps } from '../shared/algorithms/final/a/binary-insertion-sort.js';
import { generateShellSortSteps } from '../shared/algorithms/final/a/shell-sort.js';
import { generateSelectionSortSteps } from '../shared/algorithms/final/a/selection-sort.js';
import { generateQuickSortSteps } from '../shared/algorithms/final/a/quick-sort.js';
import { generateHeapSortSteps } from '../shared/algorithms/final/a/heap-sort.js';
import { generateMergeSortSteps } from '../shared/algorithms/final/a/merge-sort.js';

// Exercise the actual SVG frame builder without a browser or animation timers.
function frameCells(step) {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElementNS() {
      const element = {
        attributes: {}, classes: new Set(), children: [],
        setAttribute(name, value) {
          this.attributes[name] = String(value);
          if (name === 'class') for (const token of String(value).split(/\s+/)) this.classes.add(token);
        },
        append(...children) { this.children.push(...children); }
      };
      element.classList = { add(...names) { for (const name of names) element.classes.add(name); } };
      return element;
    }
  };
  try {
    const frame = buildPrototypeArrayFrame(step, { previous: null, enter: false, reduced: true });
    const cells = [];
    function visit(node) {
      if (Object.hasOwn(node.attributes, 'data-index')) cells.push({ index: Number(node.attributes['data-index']), classes: node.classes });
      for (const child of node.children) visit(child);
    }
    for (const cell of frame?.cells ?? []) visit(cell);
    return cells;
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
}
const marked = (step, name) => frameCells(step).filter(cell => cell.classes.has(name)).map(cell => cell.index);

test('quick sort shows each write and the new hole while preserving the recorded array and value range', () => {
  const input = [0, -1, 2, -2, 0];
  const { steps } = generateQuickSortSteps(input);
  const original = structuredClone(steps);
  const frames = quickSortFrames(steps);
  const writes = new Set();
  for (const [index, step] of steps.entries()) {
    const frame = frames[index];
    assert.deepEqual(frame.array.slice().sort((a, b) => a - b), input.slice().sort((a, b) => a - b));
    if (frame.move) {
      writes.add(step.event);
      const { from, to } = frame.move;
      assert.equal(frame.hole, from);
      assert.equal(frame.array[to], steps[index + 1].array[to]);
    }
    if (step.event === 'place-pivot') {
      assert.equal(frame.hole, null);
      assert.ok(frame.fixed.includes(step.variables.i));
    }
  }
  assert.deepEqual(writes, new Set(['fill-left', 'fill-right']));
  assert.deepEqual(steps, original);
});

test('direct insertion retains its held value across shifts and inserts after an equal item', () => {
  const input = [4, 2, 3, -1, 3];
  const { steps } = generateInsertionSortSteps(input);
  const original = structuredClone(steps);
  for (const step of steps) {
    const frame = insertionSortFrame(step);
    assert.deepEqual(frame.array.slice().sort((a, b) => a - b), input.slice().sort((a, b) => a - b));
    if (step.event === 'move') {
      const { j, temp } = step.variables;
      assert.deepEqual(frame.move, { from: j, to: j + 1 });
      assert.equal(frame.hole, j);
      assert.equal(frame.array[frame.hole], temp);
      assert.equal(frame.array[j + 1], step.array[j]);
    }
    if (step.event === 'insert') assert.equal(frame.hole, null);
  }
  const equal = steps.find(step => step.event === 'compare' && step.array[step.variables.j] === step.variables.temp);
  assert.match(describeSortAction(equal), /相等.*插在它后面.*保留原有顺序/);
  assert.deepEqual(steps, original);
});

test('binary insertion shrinks the visible search range before shifting the hole and writes after equal items', () => {
  const input = [2, 3, 2, -1];
  const { steps, result } = generateBinaryInsertionSortSteps(input);
  assert.deepEqual(result, [-1, 2, 2, 3]);
  const equal = steps.find(step => step.event === 'move-left' && step.array[step.variables.mid] === step.variables.temp);
  assert.match(describeSortAction(equal), /相等.*往右找.*保留相等元素的原有顺序/);
  assert.deepEqual(aSortMarks(equal).range, [1, 1]);
  const found = steps.find(step => step.event === 'found-pos' && step.variables.i === 2);
  assert.equal(found.variables.left, 1);
  assert.equal(insertionSortFrame(found).hole, 2);
  assert.deepEqual(aSortMarks(found).focus, [1]);
  for (const step of steps) {
    const frame = insertionSortFrame(step);
    assert.deepEqual(frame.array.slice().sort((a, b) => a - b), result);
    if (step.event === 'move') {
      assert.equal(frame.hole, step.variables.j);
      assert.deepEqual(frame.move, { from: frame.hole, to: frame.hole + 1 });
    }
    if (step.event === 'insert') assert.equal(frame.hole, null);
  }
});

test('Shell sort resets the held value for each gap and moves a value within its group', () => {
  const input = [7, 6, 0, 5, 3, 0, -1, 4];
  const { steps, result } = generateShellSortSteps(input);
  assert.deepEqual(steps.filter(step => step.event === 'gap').map(step => aSortMarks(step).group),
    [4, 2, 1].map(gap => ({ gap, index: null })));
  const firstGap = steps.findIndex(step => step.event === 'gap' && step.variables.gap === 1);
  assert.match(describeSortAction(steps[firstGap]), /同.*组.*直接插入排序|一组.*直接插入排序/);
  for (const step of steps) {
    const frame = insertionSortFrame(step);
    assert.deepEqual(frame.array.slice().sort((a, b) => a - b), result);
    if (step.event === 'gap') assert.equal(frame.hole, null);
    if (step.event === 'move') {
      const { j, gap } = step.variables;
      assert.deepEqual(frame.move, { from: j - gap, to: j });
      assert.equal(frame.hole, j - gap);
      assert.match(describeSortAction(step), new RegExp('右移 ' + gap + ' 格'));
    }
  }
});

test('selection candidate follows the minimum value rather than the old index after a swap', () => {
  const { steps } = generateSelectionSortSteps([3, -1, -1, 2]);
  const compare = steps.find(step => step.event === 'compare');
  assert.deepEqual(aSortMarks(compare).focus, [1]);
  assert.deepEqual(selectionCandidate(compare), { index: 0, value: 3, placed: false });
  const updated = steps.find(step => step.event === 'update-min');
  assert.match(describeSortAction(updated), /更新为 -1，下标是 1/);
  const equal = steps.find(step => step.event === 'compare' && step.variables.j === 2);
  assert.match(describeSortAction(equal), /保留当前最小值/);
  const swapped = steps.find(step => step.event === 'swap');
  assert.deepEqual(selectionCandidate(swapped), { index: 0, value: -1, placed: true });
  assert.deepEqual(aSortMarks(swapped).settled, [0, 1]);
  const skipped = generateSelectionSortSteps([1, 2, 3]).steps.find(step => step.event === 'check-swap');
  assert.match(describeSortAction(skipped), /已在起点.*跳过交换/);
  assert.deepEqual(aSortMarks(skipped).focus, []);
  assert.deepEqual(aSortMarks(skipped).settled, [0, 1]);
});

test('sorting initialization is idle; completed frames mark every item settled without active comparisons', () => {
  const generators = [generateBubbleSteps, generateInsertionSortSteps, generateBinaryInsertionSortSteps,
    generateShellSortSteps, generateSelectionSortSteps, generateQuickSortSteps, generateHeapSortSteps, generateMergeSortSteps];
  for (const generate of generators) {
    for (const array of [[], [7], [3, 1, 2], [2, 1, 2]]) {
      const { steps } = generate(array);
      const start = steps[0], end = steps.at(-1);
      assert.deepEqual(marked(start, 'is-sorted'), [], start.algorithm + ': initialization');
      assert.deepEqual(marked(start, 'is-comparing'), [], start.algorithm + ': initialization');
      assert.deepEqual(marked(end, 'is-sorted'), array.map((_, index) => index), end.algorithm + ': completion');
      assert.deepEqual(marked(end, 'is-comparing'), [], end.algorithm + ': completion');
      assert.deepEqual(marked(end, 'is-mid'), [], end.algorithm + ': completion');
    }
  }
});

test('merge picks and copies use original-array positions, including right runs and exhausted sides', () => {
  const { steps } = generateMergeSortSteps([4, 3, 2, 1]);
  const picks = steps.filter(step => step.event === 'pick');
  const expectedReads = [1, 0, 3, 2, 2, 3, 0, 1];
  assert.deepEqual(picks.map(step => step.variables.readIndex), expectedReads);
  picks.forEach((step, index) => {
    assert.deepEqual(marked(step, 'is-comparing'), [expectedReads[index]]);
    assert.equal(step.array[step.variables.readIndex], step.variables.pickedValue);
    const transfer = mergeTransfer(step);
    assert.equal(transfer.arrayIndex, expectedReads[index]);
    assert.equal(step.variables.temp[transfer.tempIndex], step.variables.pickedValue);
  });
  const copies = steps.filter(step => step.event === 'copy');
  const expectedWrites = [0, 1, 2, 3, 0, 1, 2, 3];
  copies.forEach((step, index) => {
    assert.deepEqual(marked(step, 'is-comparing'), [expectedWrites[index]]);
    const { arrayIndex, tempIndex } = mergeTransfer(step);
    assert.equal(arrayIndex, expectedWrites[index]);
    assert.equal(step.array[arrayIndex], step.variables.temp[tempIndex]);
  });
  for (const step of steps.filter(step => step.event === 'compare')) {
    assert.deepEqual(marked(step, 'is-comparing'), [step.variables.i, step.variables.j].sort((a, b) => a - b));
  }
});

test('merge explanation shows why an equal element is taken from the left half', () => {
  const { steps } = generateMergeSortSteps([3, 1, 3, 2]);
  const equality = steps.findIndex(step => step.event === 'compare' &&
    step.array[step.variables.i] === step.array[step.variables.j]);
  assert.match(describeSortAction(steps[equality]), /两值相等，先取左段，保留原有顺序/);
  const pick = steps[equality + 1];
  const { arrayIndex, tempIndex } = mergeTransfer(pick);
  assert.equal(pick.lineId, 'pick-left');
  assert.equal(arrayIndex, steps[equality].variables.i);
  assert.ok(describeSortAction(pick).includes(`写入 temp[${tempIndex}]`));
});

test('heap construction has no settled suffix; extraction settles it and binary search still excludes discarded values', () => {
  const heap = generateHeapSortSteps([3, 1, 2]);
  assert.deepEqual(marked(heap.steps.find(step => step.event === 'build-start'), 'is-sorted'), []);
  assert.deepEqual(marked(heap.steps.find(step => step.event === 'swap'), 'is-sorted'), [2]);
  const binary = generateSteps([1, 3, 5, 7, 9], 7);
  assert.deepEqual(marked(binary.steps.find(step => step.event === 'move-left'), 'is-excluded'), [0, 1, 2]);
});

test('heap extraction settles the maximum, shrinks the heap, and follows the sinking node', () => {
  const { steps } = generateHeapSortSteps([5, 4, 2, 1]);
  const start = steps.findIndex(step => step.event === 'swap-root');
  const [before, placed, restart] = steps.slice(start, start + 3);
  assert.equal(activeHeapSize(before), 4);
  assert.deepEqual(aSortMarks(before).focus, [0, 3]);
  assert.equal(activeHeapSize(placed), 3);
  assert.deepEqual(aSortMarks(placed).focus, [0]);
  assert.deepEqual(aSortMarks(placed).settled, [3, 4]);
  assert.match(describeSortAction(placed), /A\[3\] = 5 已就位.*前 3 项.*A\[0\] = 1/);
  assert.deepEqual(aSortMarks(restart).focus, [0]);
  const sink = steps.slice(start).find(step => step.lineId === 'swap-node');
  assert.deepEqual(aSortMarks(sink).focus, [1]);
  assert.match(describeSortAction(sink), /1 下沉到 A\[1\]/);
});
