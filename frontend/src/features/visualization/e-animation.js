import { gridLayer, linkLayer } from '../../../vendor/plus/vendor/engine/model.js';
import { createEStateTable } from './e-state-table.js';
import { compactLabel, createTraceAnimation, sequenceLayer, windowStart } from './trace-animation.js';
import { countingSnapshot, linkedChain } from '../workbench/e-state.js';

export function usesFullECanvas(algorithm) {
  return algorithm === 'array-list-reverse' || algorithm === 'singly-linked-list-insert' || algorithm === 'kth-from-end';
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

function arrayFrame(step) {
  const { length, i, j, src, dst } = step.variables;
  const values = step.array;
  const from = src ?? i;
  const to = dst ?? j;
  const left = Math.min(from, to);
  const right = Math.max(from, to);
  const title = length == null ? '顺序表' : '顺序表 · 逻辑长度 ' + length;
  const roles = { swap: [from], focus2: [to], excluded: length == null ? [] : values.map((_, n) => n).slice(length) };
  if (Number.isInteger(from) && Number.isInteger(to) && right - left >= 10) {
    return [
      sequenceLayer('e-array', title, values, roles, { first: windowStart(values.length, 10, left) }),
      sequenceLayer('e-array-second', title, values, roles, { first: windowStart(values.length, 10, right) }),
    ];
  }
  const start = Number.isInteger(from) && Number.isInteger(to) ? windowStart(values.length, 10, Math.floor((left + right + 1) / 2)) : undefined;
  return [sequenceLayer('e-array', title, values, roles, { first: start })];
}

const listId = id => id == null ? null : 'n' + id;
function listFrame(step, previous, fitViewport) {
  const v = step.variables;
  const inserting = step.algorithm === 'singly-linked-list-insert';
  const finding = step.algorithm === 'kth-from-end';
  const chain = linkedChain(v);
  const onChain = new Set(chain.map(node => node.id));
  const oldLinks = new Map(previous?.variables.nodes.map(node => [node.id, node.next]));
  const pointers = [[v.prevId, '前驱'], [v.currId, '当前'], [v.nextId, '原后继'], [v.fastId, '快'], [v.slowId, '慢']];
  const otherChain = linkedChain({ nodes: v.nodes, headId: v.nextId }).filter(node => !onChain.has(node.id));
  const placed = new Set([...onChain, ...otherChain.map(node => node.id)]);
  const ordered = [...chain, ...otherChain, ...v.nodes.filter(node => !placed.has(node.id))];
  const detached = inserting ? ordered.find(node => !onChain.has(node.id)) : null;
  const previousChain = inserting && previous ? new Set(linkedChain(previous.variables).map(node => node.id)) : null;
  const joined = previousChain ? chain.find(node => !previousChain.has(node.id)) : null;
  const result = finding ? step.result : null;
  const nodes = ordered.map(node => ({
    id: listId(node.id), value: node.value, next: listId(node.next),
    ...(fitViewport ? { label: '#' + node.id + (inserting && node.next === null ? ' · NULL' : '') }
      : { badge: pointers.filter(([id]) => id === node.id).map(([, label]) => label).join('／') }),
  }));
  const changed = previous ? v.nodes.filter(node => !oldLinks.has(node.id) || node.next !== oldLinks.get(node.id)) : [];
  const nodeW = Math.max(72, ...nodes.map(node => String(node.value).length * 9 + 14));
  const gap = 34;
  const perRow = Math.min(6, Math.max(2, nodes.length));
  const canvasWidth = 76 + perRow * nodeW + (perRow - 1) * gap;
  const canvasHeight = Math.max(168, 54 + Math.ceil(nodes.length / perRow) * 92);
  let name = '';
  const nodePointers = [];
  if (finding) {
    if (result?.nodeId != null) name = `找到结点 #${result.nodeId}，值 ${result.value}`;
    else if (v.fastId === null) name = '快指针已越过链尾（fast = NULL）';
    if (v.fastId != null) nodePointers.push({ id: 'fast', node: listId(v.fastId), label: '快 fast' });
    if (v.slowId != null) nodePointers.push({ id: 'slow', node: listId(v.slowId), label: '慢 slow' });
  } else if (detached) {
    name = `新结点 #${detached.id} 尚未接入链表`;
    nodePointers.push({ id: 'new', node: listId(detached.id), label: '链外' });
  } else if (joined) {
    name = `新结点 #${joined.id} 已接入链表`;
    nodePointers.push({ id: 'new', node: listId(joined.id), label: '新结点' });
  }
  const highlighted = result?.nodeId ?? joined?.id;
  return [linkLayer({
    id: 'e-list', title: finding ? '链表与快慢指针' : '链表节点与 next 指针', name, nodes,
    head: listId(v.headId), order: nodes.map(node => node.id),
    roles: {
      swap: [v.currId, v.fastId].map(listId).filter(Boolean),
      focus2: [result?.nodeId === v.slowId ? null : v.slowId, v.prevId].map(listId).filter(Boolean),
      added: changed.map(node => listId(node.id)),
      done: highlighted == null ? [] : [listId(highlighted)],
      pointers: nodePointers,
    },
    props: { canvasWidth, canvasHeight, nodeW, nodeH: 36, gap, fitViewport, showTailMarker: !inserting },
  })];
}

function tripleLayer(id, title, triples, index) {
  const size = 6;
  const start = windowStart(triples.length, size, index);
  const rows = triples.slice(start, start + size).map(item => [item?.i, item?.j, item?.e].map(value => compactLabel(value, 14)));
  const cellW = Math.max(60, ...rows.flat().map(value => value.length * 7 + 12));
  const range = triples.length > size ? ` · ${start}–${start + rows.length - 1}` : '';
  return gridLayer({
    id, title: title + range, values: rows, colLabels: ['行', '列', '值'], rowLabels: rows.map((_, i) => String(start + i)),
    roles: { swap: Number.isInteger(index) ? [0, 1, 2].map(col => (index - start) + ',' + col) : [] },
    props: { canvasWidth: Math.max(320, 72 + cellW * 4), canvasHeight: Math.max(146, 72 + (rows.length + 1) * 28), cellW, cellH: 28 },
  });
}

function matrixFrame(step) {
  const { rows, cols, triples, k, out, pos, col, num, cpos } = step.variables;
  const layers = [tripleLayer('e-triples', `原矩阵三元组 · ${rows} × ${cols}`, triples, k)];
  if (num) layers.push(sequenceLayer('e-column-counts', '各列非零项数', num, { swap: [col] }));
  if (cpos) layers.push(sequenceLayer('e-write-positions', '各原列下一输出下标', cpos, { swap: [col] }));
  if (out) layers.push(tripleLayer('e-transpose', `转置输出 · ${cols} × ${rows}`, out, pos));
  return layers;
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
  const fillViewport = usesFullECanvas(run.algorithm);
  const init = config.view === 'counting' ? run.steps.find(step => step.event === 'count_init') : null;
  const previous = step => run.steps[step.stepIndex - 1];
  const frames = {
    array: fillViewport ? reverseFrame : arrayFrame,
    linked: step => listFrame(step, previous(step), fillViewport),
    matrix: matrixFrame,
    radix: step => radixFrame(step, previous(step)),
    counting: step => countingFrame(run, step, init),
  };
  const stateTable = fillViewport ? null : createEStateTable(run, config);
  return createTraceAnimation(host, explainHost, stateTable, frames[config.view], 'e', { run, config, fillViewport });
}
