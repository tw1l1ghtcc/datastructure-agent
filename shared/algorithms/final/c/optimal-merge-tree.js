import { integers, objectInput, checkedAdd, recorder, sourceLines, LIMITS } from './util.js';
import { OPTIMAL_SOURCE } from './sources.js';
export const SOURCE_VERSION = 'c-optimal-merge-v1';
export const SOURCE_LINES = sourceLines(OPTIMAL_SOURCE, 'optimal');
export const DEFAULT_INPUT = { weights: [2, 3, 7] };

export function generateOptimalMergeTreeSteps(input) {
  objectInput(input);
  const weights = integers(input.weights, 'weights', LIMITS.keys, 0);
  const nodes = weights.map((weight, id) => ({ id, weight, left: null, right: null, inputIndex: id }));
  const queue = nodes.map(n => n.id);
  const rec = recorder('optimal-merge-tree', SOURCE_VERSION, SOURCE_LINES);
  let cost = 0;
  const sort = () => queue.sort((a, b) => nodes[a].weight - nodes[b].weight || a - b);
  const view = extra => ({ nodes, candidates: queue, cost, ...extra });
  sort(); rec.add('init', 'init', '按权重排序候选段；同权按节点创建顺序取出。', view({ selected: [] }));
  while (queue.length > 1) {
    const left = queue.shift(), right = queue.shift();
    rec.add('select', 'select', `取出最小的 ${nodes[left].weight} 和 ${nodes[right].weight}。`, view({ selected: [left, right] }));
    const weight = checkedAdd(nodes[left].weight, nodes[right].weight);
    cost = checkedAdd(cost, weight);
    const parent = nodes.length;
    nodes.push({ id: parent, weight, left, right, inputIndex: null });
    queue.push(parent); sort();
    rec.add('merge', 'merge', `合并为 ${weight}，累计代价 ${cost}。`, view({ selected: [left, right], parent }));
  }
  const result = { root: queue[0] ?? null, nodes, cost };
  rec.add('done', 'done', `归并完成，总代价 ${cost}。`, view({ selected: [] }), result);
  return rec.finish(result);
}
