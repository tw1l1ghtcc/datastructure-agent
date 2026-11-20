import { treeLayer } from '../../../vendor/plus/vendor/engine/model.js';
import { createGStateTable } from './g-state-table.js';
import { createLevelOrderState } from './level-order-state.js';
import { compactLabel, createTraceAnimation, sequenceLayer, windowStart } from './trace-animation.js';
import { isBinaryTraversal } from '../workbench/g-algorithms.js';

function nodeId(value) {
  if (value == null) return null;
  return 'n' + Array.from(String(value), char => char.codePointAt(0).toString(16)).join('_');
}

function tree(id, title, records, {
  roots = [], current, visited = [], selected = [], threaded = false, huffman = false, fitViewport = false, preserveLabels = false,
} = {}) {
  const existing = new Set(records.map(node => huffman ? node.index : node.id));
  const ref = key => existing.has(key) ? nodeId(key) : null;
  const edgeTags = {};
  const threads = [];
  const enlarged = fitViewport && records.length <= 16;
  const nodes = records.map(node => {
    const key = huffman ? node.index : node.id;
    const id = nodeId(key);
    const left = node.leftThread ? null : ref(node.left);
    const right = node.rightThread ? null : ref(node.right);
    if (left) edgeTags[left] = huffman ? '0' : 'L';
    if (right) edgeTags[right] = huffman ? '1' : 'R';
    if (threaded && node.leftThread && ref(node.left)) threads.push({ from: id, to: ref(node.left), type: 'prev' });
    if (threaded && node.rightThread && ref(node.right)) threads.push({ from: id, to: ref(node.right), type: 'next' });
    const fullLabel = String(huffman ? node.weight : node.key ?? key);
    const label = compactLabel(fullLabel, 14);
    return {
      id, label, left, right, children: node.children ? node.children.map(ref).filter(Boolean) : undefined,
      radius: Math.max(enlarged ? 25 : 17, Math.ceil(label.length * 4.5 / 2 + 8)),
      fontSize: label.length > 8 ? 9 : enlarged ? 14 : 11,
      fullLabel: (fitViewport || preserveLabels) && label !== fullLabel ? fullLabel : undefined,
      value: huffman && node.id != null ? compactLabel(node.id, 10) : undefined,
    };
  });
  const children = node => node.children ?? [node.left, node.right].filter(Boolean);
  const descendants = new Set(nodes.flatMap(children));
  const rootIds = [...new Set([...roots.map(ref).filter(Boolean), ...nodes.map(node => node.id)])]
    .filter(id => !descendants.has(id));
  const byId = new Map(nodes.map(node => [node.id, node]));
  const depth = id => 1 + Math.max(0, ...children(byId.get(id)).map(depth));
  const levels = Math.max(1, ...rootIds.map(depth));
  const leaves = nodes.filter(node => children(node).length === 0).length;
  const radius = Math.max(17, ...nodes.map(node => node.radius));
  const canvasWidth = Math.max(320, 112 + (levels - 1) * 24 + Math.max(0, leaves - 1) * Math.max(70, 2 * radius + 22) + 2 * radius);
  return treeLayer({
    id, title, nodes, roots: rootIds, edgeTags, threads,
    roles: { swap: [ref(current)].filter(Boolean), focus2: selected.map(ref).filter(Boolean), done: visited.map(ref).filter(Boolean) },
    props: { canvasWidth, canvasHeight: Math.max(160, 116 + (levels - 1) * Math.max(66, 2 * radius + 24)), fitViewport },
  });
}

function trailingSequence(id, title, values) {
  return sequenceLayer(id, title, values, {}, { first: Math.max(0, values.length - 10) });
}

function treeFrame(step, fitViewport) {
  const v = step.variables;
  const current = v.currentNode;
  const order = v.order ?? [];
  if (step.algorithm === 'huffman-coding') {
    const title = v.path != null ? '哈夫曼树 · 当前码字 ' + v.path : v.root == null ? '哈夫曼节点森林' : '哈夫曼树';
    return [
      tree('g-huffman', title, v.nodes, { roots: [v.root], current, selected: v.selected, huffman: true }),
      sequenceLayer('g-candidates', '候选权重（队首在左）', v.candidates.map(index => v.nodes[index].weight)),
    ];
  }
  if (step.algorithm === 'tree-forest-conversion') {
    const forest = tree('g-forest', '有序森林', v.forestNodes, { roots: v.roots, current, selected: [v.edge?.to], preserveLabels: true });
    const binary = tree('g-binary', '左孩子／右兄弟表示', v.binaryNodes, { roots: [v.root], current, selected: [v.edge?.to], preserveLabels: true });
    return v.mode === 'to-forest' ? [binary, forest] : [forest, binary];
  }
  const forest = step.algorithm === 'tree-forest-traversal';
  const threaded = step.algorithm === 'threaded-binary-tree';
  const title = forest ? '有序森林' : threaded ? '二叉树 · 虚线为前驱／后继线索' : '二叉树';
  const preserveLabels = forest || step.algorithm === 'binary-tree-reconstruction' || step.algorithm === 'binary-search-tree';
  const layers = [tree('g-tree', title, v.nodes, {
    roots: forest ? v.roots : [v.root], current, visited: order, selected: [v.edge?.to ?? v.childNode ?? v.queuedNode?.id], threaded, fitViewport, preserveLabels,
  })];
  if (fitViewport) return layers;
  if (v.queue) layers.push(sequenceLayer('g-queue', '队列（队首在左）', v.queue.map(entry => entry.id)));
  if (v.stack) layers.push(trailingSequence('g-stack', '递归栈（栈顶在右）', v.stack.map(frame => frame.id)));
  if (v.order) layers.push(trailingSequence('g-order', '访问顺序', order));
  if (Array.isArray(v.path)) {
    const keys = v.path.map(id => v.nodes[id]?.key ?? id);
    layers.push(trailingSequence('g-path', '比较路径（键）', keys));
  }
  if (v.inorder) layers.push(trailingSequence('g-inorder', '中序结果', v.inorder));
  return layers;
}

export function createGAnimation(host, explainHost, run, config) {
  const fillViewport = isBinaryTraversal(run.algorithm);
  const levelOrder = run.algorithm === 'binary-tree-level-order';
  let state = null;
  if (levelOrder) state = createLevelOrderState();
  else if (run.algorithm !== 'tree-forest-conversion') state = createGStateTable(run.algorithm, config);
  return createTraceAnimation(host, explainHost, state, step => treeFrame(step, fillViewport), 'g', { run, config, fillViewport });
}
