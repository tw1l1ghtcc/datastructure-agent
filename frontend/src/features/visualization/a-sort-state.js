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

export function sortSwap(step) {
  if (step.event !== 'swap') return null;
  const { i, largest, minIndex } = step.variables;
  if (step.algorithm === 'selection-sort') return [i, minIndex];
  if (step.algorithm === 'heap-sort') return step.lineId === 'swap-root' ? [0, i] : [i, largest];
  return null;
}

export function selectionCandidate(step) {
  const { event, array, variables: v } = step;
  if (event === 'init' || step.done) return null;
  const placed = event === 'swap' || (event === 'check-swap' && v.i === v.minIndex);
  const index = placed ? v.i : v.minIndex;
  return { index, value: array[index], placed };
}

function heapMarks(step) {
  const { event, lineId, array, variables: v } = step;
  const size = activeHeapSize(step);
  const settled = [size, array.length];
  if (event === 'swap-root') return { focus: [0, v.i], cursors: { 堆顶: 0, 末尾: v.i }, settled };
  if (lineId === 'swap-root' || event === 'extract-start' || lineId === 'heapify-call-2') {
    return { focus: [0], cursors: { 堆顶: 0 }, settled };
  }
  const child = lineId === 'compare-l' ? v.l : v.r;
  const comparing = event === 'compare' || event === 'update-largest';
  const focus = comparing ? [v.largest, child] : event === 'swap' ? [v.largest] : [v.i, v.largest];
  const adjacent = event === 'swap' ? [v.i] : [v.i, v.l, v.r];
  const related = adjacent.filter(index => Number.isInteger(index) && index >= 0 && index < size && !focus.includes(index));
  const cursors = event === 'swap' ? { 下沉: v.largest } : { i: v.i, max: v.largest };
  return { focus, related, cursors, settled };
}

export function quickSortFrames(steps) {
  let hole = null;
  const fixed = new Set();
  return steps.map(step => {
    const { event, variables: v } = step;
    let move = null;
    if (event === 'init-pivot') hole = v.low;
    if (event === 'fill-left' || event === 'fill-right') {
      hole = v.fillFrom;
      move = { from: v.fillFrom, to: v.fillTo };
    }
    if (event === 'place-pivot') {
      hole = null;
      fixed.add(v.i);
    }
    const array = step.array.slice();
    // A fill step records the operands before the C assignment. Show its exact write on the chart.
    if (move) array[move.to] = array[move.from];
    // Use the held pivot for the scale calculation, then draw the slot as a hole.
    if (hole != null) array[hole] = v.pivot;
    return { hole, move, array, fixed: [...fixed] };
  });
}

export function insertionSortFrame(step) {
  const { algorithm, event, variables: v } = step;
  const shell = algorithm === 'shell-sort';
  const move = event === 'move'
    ? shell ? { from: v.j - v.gap, to: v.j } : { from: v.j, to: v.j + 1 }
    : null;
  let hole = null;
  if (v.temp != null && !step.done && event !== 'insert' && event !== 'gap') {
    hole = v.i;
    if (move) hole = move.from;
    else if (event === 'compare' && algorithm !== 'binary-insertion-sort') hole = shell ? v.j : v.j + 1;
  }
  const array = step.array.slice();
  // The C array still contains the old value in the open slot. Use the held value for the chart scale.
  if (hole != null) array[hole] = v.temp;
  return { array, hole, holeLabel: '空位', move };
}

function describeQuickSortAction(step) {
  const { event, array, variables: v } = step;
  switch (event) {
    case 'init-pivot':
      return `暂存 A[${v.low}] 中的枢轴 ${v.pivot}，这个位置成为第一个坑。`;
    case 'fill-left':
    case 'fill-right': {
      const relation = event === 'fill-left' ? '小于' : '大于';
      return `A[${v.fillFrom}] 中的 ${array[v.fillFrom]} ${relation}枢轴 ${v.pivot}，填入 A[${v.fillTo}]，坑移到 A[${v.fillFrom}]。`;
    }
    case 'compare-left':
      return `A[${v.i}] = ${array[v.i]} 小于或等于枢轴 ${v.pivot}，i 继续向右扫描。`;
    case 'compare-right':
      return `A[${v.j}] = ${array[v.j]} 大于或等于枢轴 ${v.pivot}，j 继续向左扫描。`;
    case 'place-pivot':
      return `i 和 j 在下标 ${v.i} 相遇，将枢轴 ${v.pivot} 写回 A[${v.i}]，完成这一轮分区。`;
    default:
      return step.description;
  }
}

function describeInsertionSortAction(step) {
  const { event, array, variables: v } = step;
  switch (event) {
    case 'select':
      return `取出 A[${v.i}] = ${v.temp} 暂存，A[${v.i}] 留为空位。`;
    case 'compare': {
      const value = array[v.j];
      if (value > v.temp) return `A[${v.j}] = ${value} 大于暂存值 ${v.temp}，需要向右移动。`;
      if (value === v.temp) return `A[${v.j}] 与暂存值 ${v.temp} 相等，停止右移。插在它后面可以保留原有顺序。`;
      return `A[${v.j}] = ${value} 小于暂存值 ${v.temp}，停止移动，准备插在它后面。`;
    }
    case 'move':
      return `把 ${array[v.j]} 从 A[${v.j}] 右移到 A[${v.j + 1}]，空位移到 A[${v.j}]。`;
    case 'insert':
      return `将暂存值 ${v.temp} 写回 A[${v.insertIndex}]，前 ${v.i + 1} 个元素已经有序。`;
    default:
      return step.description;
  }
}

function describeBinaryInsertionSortAction(step) {
  const { event, array, variables: v } = step;
  switch (event) {
    case 'init-bounds':
      return `在有序前缀 A[0…${v.right}] 内折半查找插入位置。`;
    case 'compare':
      return `取中点 mid = ${v.mid}，比较 A[${v.mid}] = ${array[v.mid]} 和暂存值 ${v.temp}。`;
    case 'move-left':
      return array[v.mid] === v.temp
        ? `A[${v.mid}] 与暂存值 ${v.temp} 相等，将 left 移到 ${v.left} 继续往右找，保留相等元素的原有顺序。`
        : `A[${v.mid}] = ${array[v.mid]} 小于暂存值 ${v.temp}，将 left 移到 ${v.left}，在右半区查找。`;
    case 'move-right':
      return `A[${v.mid}] = ${array[v.mid]} 大于暂存值 ${v.temp}，将 right 移到 ${v.right}，在左半区查找。`;
    case 'found-pos':
      return v.left === v.i
        ? `有序前缀的值都不大于 ${v.temp}，直接写回原位置 A[${v.left}]。`
        : `查找区间已空。A[${v.left}] 是前缀中第一个大于 ${v.temp} 的位置，将它和后面的元素右移腾出空位。`;
    default:
      return describeInsertionSortAction(step);
  }
}

function describeShellSortAction(step) {
  const { event, array, variables: v } = step;
  const { gap, j, temp, insertIndex } = v;
  switch (event) {
    case 'gap':
      return gap === 1 ? 'gap = 1，所有下标归为一组，最后做一轮直接插入排序。'
        : `gap = ${gap}。下标对 ${gap} 取余相同的元素分到一组，组内相邻元素相隔 ${gap} 格。`;
    case 'compare': {
      const from = j - gap;
      const action = array[from] > temp ? `大于暂存值 ${temp}，需要右移 ${gap} 格`
        : `不大于暂存值 ${temp}，停止右移`;
      return `同组元素 A[${from}] = ${array[from]} ${action}。`;
    }
    case 'move': {
      const from = j - gap;
      return `把 ${array[j]} 从 A[${from}] 右移 ${gap} 格到 A[${j}]，空位移到 A[${from}]。`;
    }
    case 'insert':
      return `将暂存值 ${temp} 写回 A[${insertIndex}]，完成这一次组内插入。`;
    default:
      return describeInsertionSortAction(step);
  }
}

function describeSelectionSortAction(step) {
  const { event, array, variables: v } = step;
  const { i, j, minIndex } = v;
  const minimum = array[minIndex];
  switch (event) {
    case 'compare': {
      const value = array[j];
      const action = value < minimum ? '扫描值更小，更新候选' : '保留当前最小值';
      return `比较扫描值 A[${j}] = ${value} 和当前最小值 A[${minIndex}] = ${minimum}。${action}。`;
    }
    case 'update-min':
      return `当前最小值更新为 ${minimum}，下标是 ${minIndex}。`;
    case 'check-swap':
      return minIndex === i ? `本轮最小值 ${minimum} 已在起点 A[${i}]，直接标记就位，跳过交换。`
        : `本轮最小值 ${minimum} 在 A[${minIndex}]，准备与 A[${i}] = ${array[i]} 交换。`;
    case 'swap':
      return `最小值 ${array[i]} 已放到 A[${i}]，原来的 ${minimum} 移到 A[${minIndex}]。`;
    default:
      return step.description;
  }
}

function describeHeapSortAction(step) {
  const { event, lineId, array, variables: v } = step;
  const at = index => `A[${index}] = ${array[index]}`;
  if (!step.done && lineId === 'swap-root') {
    if (event === 'swap-root') return `交换堆顶 ${at(0)} 和有效堆末尾 ${at(v.i)}。`;
    return `${at(v.i)} 已就位，移出有效堆。接下来只检查前 ${v.heapSize} 项，从新堆顶 ${at(0)} 开始。`;
  }
  if (lineId === 'heapify-call-2') return `从新堆顶 ${at(0)} 开始调整，只检查有效堆里的前 ${v.heapSize} 项。`;
  switch (event) {
    case 'extract-start':
      return '大根堆已建好，每轮把堆顶最大值放到有效堆末尾。';
    case 'heapify-init': {
      const children = [v.l, v.r].filter(index => index < v.heapSize).map(at);
      return children.length
        ? `从 ${at(v.i)} 开始，检查孩子 ${children.join(' 和 ')} 是否更大。`
        : `${at(v.i)} 是有效堆里的叶节点，这条下沉路径结束。`;
    }
    case 'compare': {
      const child = lineId === 'compare-l' ? v.l : v.r;
      const result = array[child] > array[v.largest] ? '孩子更大' : '保留当前最大候选';
      return `比较${lineId === 'compare-l' ? '左' : '右'}孩子 ${at(child)} 和当前最大候选 ${at(v.largest)}，${result}。`;
    }
    case 'update-largest':
      return `${lineId === 'compare-l' ? '左' : '右'}孩子更大，将 ${at(v.largest)} 记为当前最大候选。`;
    case 'check-swap':
      return `${at(v.largest)} 是较大的孩子，和当前节点 ${at(v.i)} 交换。`;
    case 'swap':
      return `${array[v.i]} 升到 A[${v.i}]，原来的 ${array[v.largest]} 下沉到 A[${v.largest}]。接下来检查这里的孩子。`;
    default:
      return step.description;
  }
}

export function mergeTransfer(step) {
  const { event, variables: v } = step;
  if (event === 'pick') return { arrayIndex: v.readIndex, tempIndex: v.temp.length - 1 };
  if (event === 'copy') return { arrayIndex: v.low + v.p - 1, tempIndex: v.p - 1 };
  return null;
}

function describeMergeSortAction(step) {
  const { event, lineId, array, variables: v } = step;
  switch (event) {
    case 'divide':
      return `将 A[${v.low}…${v.high}] 拆成左段 A[${v.low}…${v.mid}] 和右段 A[${v.mid + 1}…${v.high}]，分别排序。`;
    case 'compare': {
      const left = array[v.i], right = array[v.j];
      const choice = left === right ? '两值相等，先取左段，保留原有顺序' : left < right ? '左段值更小' : '右段值更小';
      return `比较左段 A[${v.i}] = ${left} 和右段 A[${v.j}] = ${right}。${choice}。`;
    }
    case 'pick': {
      const { arrayIndex, tempIndex } = mergeTransfer(step);
      const left = arrayIndex <= v.mid;
      const side = left ? '左' : '右';
      const reason = lineId === 'pick-remain' ? (left ? '右' : '左') + '段已经读完，' : '';
      return `${reason}将${side}段 A[${arrayIndex}] = ${v.pickedValue} 写入 temp[${tempIndex}]。`;
    }
    case 'copy': {
      const { arrayIndex, tempIndex } = mergeTransfer(step);
      return `将 temp[${tempIndex}] = ${v.temp[tempIndex]} 写回 A[${arrayIndex}]。`;
    }
    default:
      return step.description;
  }
}

export function describeSortAction(step) {
  if (step.algorithm === 'quick-sort') return describeQuickSortAction(step);
  if (step.algorithm === 'insertion-sort') return describeInsertionSortAction(step);
  if (step.algorithm === 'binary-insertion-sort') return describeBinaryInsertionSortAction(step);
  if (step.algorithm === 'shell-sort') return describeShellSortAction(step);
  if (step.algorithm === 'selection-sort') return describeSelectionSortAction(step);
  if (step.algorithm === 'heap-sort') return describeHeapSortAction(step);
  if (step.algorithm === 'merge-sort') return describeMergeSortAction(step);
  return step.description;
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
      const range = searching ? [v.left, v.right] : null;
      const focus = event === 'compare' ? [v.mid] : event === 'found-pos' ? [v.left]
        : insertionFocus(event, v.i, v.j, v.insertIndex);
      const locating = event === 'found-pos' || event === 'move';
      return {
        focus, range,
        cursors: searching ? { left: v.left, right: v.right, mid: v.mid }
          : locating ? { 插入: v.left, j: v.j } : { i: v.i },
        settled: [0, v.i + (event === 'insert' ? 1 : 0)],
      };
    }
    case 'shell-sort': {
      if (event === 'gap') return { group: { index: null, gap: v.gap } };
      const focus = event === 'select' ? [v.i] : event === 'insert' ? [v.insertIndex]
        : event === 'compare' ? [v.j - v.gap] : [v.j];
      return { focus, cursors: { i: v.i, j: event === 'compare' ? v.j : null }, group: { index: v.i % v.gap, gap: v.gap } };
    }
    case 'selection-sort': {
      const { index, placed } = selectionCandidate(step);
      const scanning = event === 'compare' || event === 'update-min';
      const focus = event === 'check-swap' && !placed ? [v.i, index] : event === 'compare' ? [v.j] : [];
      return {
        focus, candidate: placed ? null : index, settled: [0, v.i + (placed ? 1 : 0)],
        cursors: { i: v.i, j: scanning ? v.j : null, 最小: placed ? null : index },
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
    case 'heap-sort':
      return heapMarks(step);
    case 'merge-sort': {
      const left = v.i != null && v.i <= v.mid ? v.i : null;
      const right = v.j != null && v.j <= v.high ? v.j : null;
      const transfer = mergeTransfer(step);
      const focus = transfer ? [transfer.arrayIndex] : event === 'compare' ? [left, right] : [];
      const written = event === 'merge' ? [v.low, v.high + 1] : event === 'copy' ? [v.low, v.low + v.p] : null;
      return { focus, range: [v.low, v.high], settled: written, cursors: { low: v.low, high: v.high, i: left, j: right } };
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
