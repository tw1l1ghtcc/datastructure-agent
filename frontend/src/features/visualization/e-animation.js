import { gridLayer, linkLayer } from '../../../vendor/plus/vendor/engine/model.js';
import { createTraceAnimation, indexedCard, windowStart } from './trace-animation.js';
import { countingSnapshot, linkedChain } from '../workbench/e-state.js';

const fullCanvasLabels = new Map([
  ['array-list-reverse', ['顺序表', '顺序表动画，i 和 j 标记交换位置']],
  ['array-list-delete-range', ['顺序表', '顺序表动画，源和目标标记搬移位置，浅色格超出逻辑长度']],
  ['singly-linked-list-insert', ['链表与新结点', '链表动画，显示新结点和 next 指向']],
  ['singly-linked-list-delete', ['链表与脱链结点', '链表动画，显示删除后改接的 next 和已脱链的结点']],
  ['singly-linked-list-reverse', ['链表与逆置指针', '链表动画，显示前驱、当前结点和原后继']],
  ['kth-from-end', ['链表与快慢指针', '链表动画，显示快慢指针和找到的结点']],
]);

export function fullECanvasLabels(algorithm) {
  return fullCanvasLabels.get(algorithm);
}

function arrayFrame(step) {
  const { i, j, src, dst, length } = step.variables;
  const moving = step.algorithm === 'array-list-delete-range';
  const from = moving ? src : i;
  const to = moving ? dst : j;
  const title = moving ? '顺序表 · 逻辑长度 ' + length : '顺序表';
  const cellLabels = step.array.map((_, index) => {
    if (index === from) return (moving ? '源' : 'i') + ' · ' + index;
    if (index === to) return (moving ? '目标' : 'j') + ' · ' + index;
    return index;
  });
  return [gridLayer({
    id: 'e-array', title, values: [step.array], cellLabels,
    roles: {
      swap: Number.isInteger(from) ? [from] : [],
      focus2: Number.isInteger(to) ? [to] : [],
      excluded: moving ? Array.from(step.array.keys()).slice(length) : [],
    },
    props: { indexedArray: true },
  })];
}

const listId = id => id == null ? null : 'n' + id;
function listFrame(step, previous, fitViewport) {
  const v = step.variables;
  const inserting = step.algorithm === 'singly-linked-list-insert';
  const deleting = step.algorithm === 'singly-linked-list-delete';
  const reversing = step.algorithm === 'singly-linked-list-reverse';
  const finding = step.algorithm === 'kth-from-end';
  const chain = linkedChain(v);
  const onChain = new Set(chain.map(node => node.id));
  const oldLinks = new Map(previous?.variables.nodes.map(node => [node.id, node.next]));
  const otherChain = linkedChain({ nodes: v.nodes, headId: v.nextId }).filter(node => !onChain.has(node.id));
  const placed = new Set([...onChain, ...otherChain.map(node => node.id)]);
  const ordered = [...chain, ...otherChain, ...v.nodes.filter(node => !placed.has(node.id))];
  const detached = inserting || deleting ? ordered.find(node => !onChain.has(node.id)) : null;
  const previousChain = inserting && previous ? new Set(linkedChain(previous.variables).map(node => node.id)) : null;
  const joined = previousChain ? chain.find(node => !previousChain.has(node.id)) : null;
  const result = finding ? step.result : null;
  const nodes = ordered.map(node => ({
    id: listId(node.id), value: node.value, next: listId(node.next),
    label: '#' + node.id + (!finding && node.next === null ? ' · NULL' : ''),
  }));
  const changed = previous ? v.nodes.filter(node => !oldLinks.has(node.id) || node.next !== oldLinks.get(node.id)) : [];
  const nodeW = Math.max(72, ...nodes.map(node => String(node.value).length * 9 + 14));
  let name = '';
  const nodePointers = [];
  if (finding) {
    if (result?.nodeId != null) name = `找到结点 #${result.nodeId}，值 ${result.value}`;
    else if (v.fastId === null) name = '快指针已越过链尾（fast = NULL）';
    if (v.fastId != null) nodePointers.push({ id: 'fast', node: listId(v.fastId), label: '快 fast' });
    if (v.slowId != null) nodePointers.push({ id: 'slow', node: listId(v.slowId), label: '慢 slow' });
  } else if (deleting && detached) {
    name = `结点 #${detached.id} 已脱链` + (detached.next == null ? '' : '，虚线为它原有的 next');
    nodePointers.push({ id: 'removed', node: listId(detached.id), label: '已脱链' });
  } else if (reversing && v.currId != null) {
    const target = v.prevId == null ? 'NULL' : '#' + v.prevId;
    name = `#${v.currId} 的 next 改为 ${target}` + (v.nextId == null ? '，原后继为 NULL' : `，待处理链从 #${v.nextId} 开始`);
    if (v.prevId != null) nodePointers.push({ id: 'prev', node: listId(v.prevId), label: '前驱 prev' });
    nodePointers.push({ id: 'curr', node: listId(v.currId), label: '当前 curr' });
    if (v.nextId != null) nodePointers.push({ id: 'next', node: listId(v.nextId), label: '原后继 next' });
  } else if (detached) {
    name = `新结点 #${detached.id} 尚未接入链表`;
    nodePointers.push({ id: 'new', node: listId(detached.id), label: '链外' });
  } else if (joined) {
    name = `新结点 #${joined.id} 已接入链表`;
    nodePointers.push({ id: 'new', node: listId(joined.id), label: '新结点' });
  }
  const highlighted = result?.nodeId ?? joined?.id;
  const links = deleting && detached?.next != null ? [{
    from: listId(detached.id), to: listId(detached.next), dash: [5, 4], stroke: '#8796ab',
  }] : [];
  return [linkLayer({
    id: 'e-list', title: finding ? '链表与快慢指针' : '链表节点与 next 指针', name, nodes, links,
    head: listId(v.headId), order: nodes.map(node => node.id),
    roles: {
      swap: [v.currId, v.fastId].map(listId).filter(Boolean),
      focus2: [result?.nodeId === v.slowId ? null : v.slowId, v.prevId].map(listId).filter(Boolean),
      added: changed.map(node => listId(node.id)),
      excluded: deleting && detached ? [listId(detached.id)] : [],
      done: highlighted == null ? [] : [listId(highlighted)],
      pointers: nodePointers,
    },
    props: { nodeW, fitViewport: true, showTailMarker: finding },
  })];
}

function tripleLayer(id, title, triples, index) {
  const rows = triples.map(item => [item?.i, item?.j, item?.e].map(value => String(value ?? '—')));
  const cellW = Math.max(60, ...rows.flat().map(value => value.length * 7 + 12));
  return gridLayer({
    id, title, values: rows, colLabels: ['行', '列', '值'],
    roles: { swap: Number.isInteger(index) ? [0, 1, 2].map(col => index + ',' + col) : [] },
    props: { canvasWidth: Math.max(320, 72 + cellW * 4), canvasHeight: Math.max(146, 72 + (rows.length + 1) * 28), cellW, cellH: 28 },
  });
}

function matrixFrame(step, columnCounts) {
  const { rows, cols, triples, k, out, pos, col, num, cpos } = step.variables;
  const layers = [tripleLayer('e-triples', `原矩阵三元组 · ${rows} × ${cols}`, triples, k)];
  if (out) layers.push(tripleLayer('e-transpose', `转置输出 · ${cols} × ${rows}`, out, pos));
  const counts = num ?? (columnCounts?.stepIndex <= step.stepIndex ? columnCounts.variables.num : null);
  if (counts?.length) {
    layers.push(indexedCard('e-column-allocation', '按原列分配输出位置（数量 / 下一输出下标）',
      counts.map((count, index) => count + ' / ' + (cpos?.[index] ?? '—')),
      { swap: Number.isInteger(col) ? [col] : [] }, counts.map((_, index) => '原列 ' + index)));
  }
  return layers;
}

function radixFrame(step, previous) {
  const { cnt, exp, tmp } = step.variables;
  const old = previous?.variables;
  const layers = [indexedCard('e-array', step.done ? '排序结果' : '当前数组', step.array)];
  if (cnt) {
    const changed = old?.cnt && old.exp === exp ? cnt.findIndex((value, i) => value !== old.cnt[i]) : -1;
    layers.push(indexedCard('e-buckets', '桶计数 · 位权 ' + exp, cnt, { swap: changed < 0 ? [] : [changed] }));
  }
  if (tmp) {
    const placed = step.event === 'place' ? tmp.findIndex((value, i) => value !== old?.tmp?.[i]) : -1;
    layers.push(indexedCard('e-output', '本轮回填', tmp.map(value => value ?? '—'), { added: placed < 0 ? [] : [placed] }));
  }
  return layers;
}

function countingFrame(run, step, init) {
  const layers = [indexedCard('e-array', '输入数组', step.array)];
  const snapshot = countingSnapshot(run, step, init);
  const { countDiff } = step.variables;
  const output = step.variables.output ?? (step.done ? step.result ?? [] : null);
  if (snapshot) {
    const { min, counts, current } = snapshot;
    const size = 21;
    const first = windowStart(counts.length, size, current);
    const shown = counts.slice(first, first + size);
    const range = counts.length > size ? ` · 下标 ${first}–${first + shown.length - 1}，共 ${counts.length} 项` : '';
    layers.push(indexedCard('e-counts', '计数（格下为数值）' + range, shown,
      { swap: countDiff ? [countDiff.index - first] : [] }, shown.map((_, offset) => min + first + offset)));
  }
  if (output) {
    const previous = run.steps[step.stepIndex - 1]?.variables.output;
    const placed = step.event === 'place_output' ? output.findIndex((value, i) => value !== (previous?.[i] ?? null)) : -1;
    layers.push(indexedCard('e-output', '输出数组', output.map(value => value ?? '—'), { added: placed < 0 ? [] : [placed] }));
  }
  return layers;
}

export function createEAnimation(host, explainHost, run, config) {
  const fillViewport = fullCanvasLabels.has(run.algorithm);
  const init = config.view === 'counting' ? run.steps.find(step => step.event === 'count_init') : null;
  const columnCounts = config.view === 'matrix' ? run.steps.find(step => step.event === 'start_positions') : null;
  const previous = step => run.steps[step.stepIndex - 1];
  const frames = {
    array: arrayFrame,
    linked: step => listFrame(step, previous(step)),
    matrix: step => matrixFrame(step, columnCounts),
    radix: step => radixFrame(step, previous(step)),
    counting: step => countingFrame(run, step, init),
  };
  return createTraceAnimation(host, explainHost, null, frames[config.view], 'e', { run, config, fillViewport });
}
