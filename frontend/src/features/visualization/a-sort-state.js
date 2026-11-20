const algorithms = new Set([
  'insertion-sort', 'binary-insertion-sort', 'shell-sort', 'selection-sort',
  'quick-sort', 'heap-sort', 'merge-sort',
]);

export const isASort = algorithm => algorithms.has(algorithm);

export function activeHeapSize(step) {
  if (step.done) return 0;
  if (step.event === 'init') return step.array.length;
  // The engine records the outer boundary before swapping out the root.
  return step.variables.heapSize + (step.event === 'swap-root' ? 1 : 0);
}

function insertionFocus(event, i, j, target) {
  if (event === 'select') return [i];
  if (event === 'compare') return [j];
  if (event === 'move') return [j, j + 1];
  if (event === 'insert') return [target];
  return [];
}

const foldingEvents = new Set(['init-bounds', 'compare', 'move-left', 'move-right']);

function snapshotMarks(step) {
  const { algorithm, array, event, lineId, variables: v } = step;
  switch (algorithm) {
    case 'insertion-sort':
      return {
        focus: insertionFocus(event, v.i, v.j, v.insertIndex),
        cursors: { i: v.i, j: event === 'insert' ? null : v.j },
        settled: [0, v.i + (event === 'insert' ? 1 : 0)],
      };
    case 'binary-insertion-sort': {
      const searching = foldingEvents.has(event);
      const range = searching && v.left <= v.right ? [v.left, v.right] : null;
      const focus = event === 'compare' ? [v.mid] : event === 'found-pos' ? [v.left]
        : insertionFocus(event, v.i, v.j, v.insertIndex);
      return {
        focus, range,
        cursors: range ? { left: v.left, right: v.right, mid: v.mid, i: v.i }
          : event === 'move' ? { i: v.i, j: v.j } : { i: v.i },
        settled: [0, v.i + (event === 'insert' ? 1 : 0)],
      };
    }
    case 'shell-sort': {
      if (event === 'gap') return {};
      const pair = [v.j - v.gap, v.j];
      const focus = event === 'select' ? [v.i] : event === 'insert' ? [v.insertIndex] : pair;
      return { focus, cursors: { i: v.i, j: v.j }, group: { index: v.i, gap: v.gap } };
    }
    case 'selection-sort': {
      const placed = event === 'swap' || (event === 'check-swap' && v.i === v.minIndex);
      const focus = event === 'check-swap' || event === 'swap' ? [v.i, v.minIndex] : [v.minIndex, v.j];
      return {
        focus, settled: [0, v.i + (placed ? 1 : 0)],
        cursors: { i: v.i, j: event === 'compare' || event === 'update-min' ? v.j : null, min: v.minIndex },
      };
    }
    case 'quick-sort': {
      const focus = event === 'init-pivot' ? [v.low] : event === 'compare-left' ? [v.i]
        : event === 'compare-right' ? [v.j] : event === 'place-pivot' ? [v.i]
          : [v.fillFrom, v.fillTo];
      return {
        focus, range: [v.low, v.high], settled: event === 'place-pivot' ? [v.i, v.i + 1] : null,
        cursors: { low: v.low, high: v.high, i: v.i, j: v.j },
      };
    }
    case 'heap-sort': {
      const extracting = event === 'swap-root' || (event === 'swap' && lineId === 'swap-root');
      const comparing = event === 'compare' || event === 'update-largest';
      const child = lineId === 'compare-l' ? v.l : v.r;
      const focus = extracting ? [0, v.i] : comparing ? [v.largest, child] : [v.i, v.largest];
      return {
        focus, settled: [activeHeapSize(step), array.length],
        cursors: extracting ? { end: v.i } : { i: v.i, max: v.largest },
      };
    }
    case 'merge-sort': {
      const left = v.i != null && v.i <= v.mid ? v.i : null;
      const right = v.j != null && v.j <= v.high ? v.j : null;
      const focus = event === 'pick' ? [v.readIndex] : event === 'copy' ? [v.low + v.p - 1]
        : event === 'compare' ? [left, right] : [];
      return { focus, range: [v.low, v.high], cursors: { low: v.low, high: v.high, i: left, j: right } };
    }
    default:
      return {};
  }
}

export function aSortMarks(step) {
  const { array } = step;
  if (step.done) return { focus: [], pointers: [], settled: [0, array.length] };
  if (step.event === 'init') return { focus: [], pointers: [] };
  const { focus = [], cursors = {}, ...marks } = snapshotMarks(step);
  if (cursors.left != null && cursors.left === cursors.right) {
    cursors['L/R'] = cursors.left;
    delete cursors.left;
    delete cursors.right;
  }
  const inBounds = index => Number.isInteger(index) && index >= 0 && index < array.length;
  return {
    ...marks,
    focus: [...new Set(focus.filter(inBounds))],
    pointers: Object.entries(cursors).flatMap(([id, index]) => inBounds(index) ? [{ id, label: id, index }] : []),
  };
}

export function aSortDetail(step) {
  if (!step || !step.array.length || step.done) return '';
  const v = step.variables;
  switch (step.algorithm) {
    case 'insertion-sort':
    case 'binary-insertion-sort':
      return v.temp == null ? '' : '暂存值 ' + v.temp;
    case 'shell-sort':
      if (v.gap === 0) return '';
      return '增量 gap = ' + v.gap + (step.event === 'gap' ? '' : ' · 暂存值 ' + v.temp);
    case 'quick-sort':
      return v.pivot == null ? '' : '枢轴值 ' + v.pivot;
    default:
      return '';
  }
}
