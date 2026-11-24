import { gridLayer, linkLayer } from '../../../vendor/plus/vendor/engine/model.js';
import { createMatrixAnimation } from './e-matrix-animation.js';
import { createEStateTable } from './e-state-table.js';
import { createTraceAnimation, sequenceLayer, windowStart } from './trace-animation.js';
import { countingSnapshot, linkedChain } from '../workbench/e-state.js';

const fullCanvasLabels = new Map([
  ['array-list-reverse', ['顺序表', '顺序表动画，i 和 j 标记交换位置']],
  ['array-list-delete-range', ['顺序表', '顺序表动画，显示逻辑长度、搬移来源和目标以及无效槽位']],
  ['singly-linked-list-insert', ['链表与新结点', '链表动画，显示新结点和 next 指向']],
  ['singly-linked-list-delete', ['链表与脱链结点', '链表动画，显示删除后改接的 next 和已脱链的结点']],
  ['singly-linked-list-reverse', ['链表与逆置指针', '链表动画，显示前驱、当前结点和原后继']],
  ['kth-from-end', ['链表与快慢指针', '链表动画，显示快慢指针和找到的结点']],
]);

export function fullECanvasLabels(algorithm) {
  return fullCanvasLabels.get(algorithm);
}

function reverseFrame(step) {
  const { i, j } = step.variables;
  const cellLabels = step.array.map((_, index) => index === i ? 'i · ' + index : index === j ? 'j · ' + index : index);
  return [gridLayer({
    id: 'e-array', title: '顺序表', values: [step.array], cellLabels,
    roles: { swap: Number.isInteger(i) ? [i] : [], focus2: Number.isInteger(j) ? [j] : [] },
    props: { indexedArray: true },
  })];
}

function deleteRangeFrame(step) {
  const { length, left, right, src, dst } = step.variables;
  const indices = step.array.map((_, index) => index);
  const marking = step.event === 'calc-del';
  const deleting = marking ? indices.slice(left, right + 1) : [];
  const cellLabels = indices.map(index => {
    if (index >= length) return '无效 ' + index;
    if (index === src) return '来源 ' + index;
    if (index === dst) return '目标 ' + index;
    if (marking && index >= left && index <= right) return '待删 ' + index;
    return index;
  });
  const lengthText = '逻辑长度 ' + length;
  const layer = gridLayer({
    id: 'e-array', title: '顺序表 · ' + lengthText, values: [step.array], cellLabels,
    roles: {
      swap: Number.isInteger(src) ? [src] : deleting,
      focus2: Number.isInteger(dst) ? [dst] : [],
      excluded: indices.slice(length),
      done: step.event === 'sorted' ? indices.slice(0, length) : [],
    },
    props: { indexedArray: true },
  });
  if (indices.length) {
    layer.annotations = [{ id: 'length', kind: 'note', target: Math.min(length, indices.length - 1), text: lengthText, anchor: 'below' }];
  }
  return [layer];
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

function radixFrame(step, previous) {
  const { cnt, exp, tmp } = step.variables;
  const old = previous?.variables;
  const changed = old?.exp === exp && old?.cnt ? cnt?.findIndex((value, i) => value !== old.cnt[i]) : undefined;
  const placed = step.event === 'place' ? tmp?.findIndex((value, i) => value !== old?.tmp?.[i]) : undefined;
  const layers = [sequenceLayer('e-array', step.done ? '排序结果' : '当前数组', step.array)];
  if (cnt) layers.push(sequenceLayer('e-buckets', '桶计数 · 位权 ' + exp, cnt, { swap: [changed] }));
  if (tmp) layers.push(sequenceLayer('e-output', '本轮回填', tmp, { added: [placed] }));
  return layers;
}

function countingFrame(run, step, init) {
  const layers = [sequenceLayer('e-array', '输入数组', step.array)];
  const snapshot = countingSnapshot(run, step, init);
  if (!snapshot) {
    if (step.done) layers.push(sequenceLayer('e-output', '输出数组', step.result ?? []));
    return layers;
  }
  const { min, counts, current } = snapshot;
  const v = step.variables;
  layers.push(sequenceLayer('e-counts', '计数表（列标题为对应数值）', counts,
    { swap: [v.countDiff?.index] }, { first: windowStart(counts.length, 10, current), indexBase: min }));
  const out = v.output;
  if (out) {
    const previous = run.steps[step.stepIndex - 1]?.variables.output;
    const placed = step.event === 'place_output' ? out.findIndex((value, i) => value !== (previous?.[i] ?? null)) : -1;
    layers.push(sequenceLayer('e-output', '输出数组', out, { added: [placed] }));
  }
  return layers;
}

export function createEAnimation(host, explainHost, run, config) {
  if (config.view === 'matrix') return createMatrixAnimation(host, explainHost, run, config);
  const fillViewport = fullCanvasLabels.has(run.algorithm);
  const init = config.view === 'counting' ? run.steps.find(step => step.event === 'count_init') : null;
  const previous = step => run.steps[step.stepIndex - 1];
  const frames = {
    array: run.algorithm === 'array-list-delete-range' ? deleteRangeFrame : reverseFrame,
    linked: step => listFrame(step, previous(step)),
    radix: step => radixFrame(step, previous(step)),
    counting: step => countingFrame(run, step, init),
  };
  const stateTable = fillViewport ? null : createEStateTable(run, config);
  return createTraceAnimation(host, explainHost, stateTable, frames[config.view], 'e', { run, config, fillViewport });
}
