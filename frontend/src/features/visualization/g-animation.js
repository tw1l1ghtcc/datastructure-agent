import { createStage } from '../../../vendor/plus/app/svg-stage.js';
import { graphLayer, treeLayer } from '../../../vendor/plus/vendor/engine/model.js';
import { createArrayAnimationRow } from './array-animation-row.js';
import { createExplanationPanel } from './explanation-panel.js';
import { createForestTraversalState } from './g-forest-traversal-state.js';
import { createHuffmanState } from './g-huffman-state.js';
import { createGStateTable } from './g-state-table.js';
import { createReconstructionState } from './g-reconstruction-state.js';
import { createLevelOrderState } from './level-order-state.js';
import { describeStructuredStep } from './structured-explanation.js';
import { compactLabel, createTraceAnimation, renderTraceLayers, sequenceLayer } from './trace-animation.js';
import { isBinaryTraversal } from '../workbench/g-algorithms.js';

function nodeId(value) {
  if (value == null) return null;
  return 'n' + Array.from(String(value), char => char.codePointAt(0).toString(16)).join('_');
}

function revealNode(viewport, id, neighbor) {
  const nodeBounds = value => viewport.querySelector(`[data-avc-key="n-${nodeId(value)}"] circle`)?.getBoundingClientRect();
  const node = nodeBounds(id);
  if (!node) return;
  const other = neighbor == null ? node : nodeBounds(neighbor) ?? node;
  const bounds = viewport.getBoundingClientRect();
  const left = Math.min(node.left, other.left);
  const right = Math.max(node.right, other.right);
  const top = Math.min(node.top, other.top);
  const bottom = Math.max(node.bottom, other.bottom);
  const x = right - left <= viewport.clientWidth ? [left, right] : [node.left, node.right];
  const y = bottom - top <= viewport.clientHeight ? [top, bottom] : [node.top, node.bottom];
  if (x[0] < bounds.left || x[1] > bounds.left + viewport.clientWidth) {
    viewport.scrollLeft += (x[0] + x[1]) / 2 - bounds.left - viewport.clientWidth / 2;
  }
  if (y[0] < bounds.top || y[1] > bounds.top + viewport.clientHeight) {
    viewport.scrollTop += (y[0] + y[1]) / 2 - bounds.top - viewport.clientHeight / 2;
  }
}

function tree(id, title, records, {
  roots = [], current, visited = [], selected = [], added = [], highlightedEdges = [],
  threaded = false, activeThread, huffman = false, fitViewport = false, preserveLabels = false,
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
    if (threaded) {
      for (const [flag, target, type] of [[node.leftThread, node.left, 'prev'], [node.rightThread, node.right, 'next']]) {
        if (flag && ref(target)) threads.push({
          from: id, to: ref(target), type, directed: true,
          active: activeThread?.from === key && activeThread.to === target,
        });
      }
    }
    const fullLabel = String(huffman ? node.weight : node.key ?? key);
    const label = compactLabel(fullLabel, 14);
    return {
      id, label, left, right, children: node.children ? node.children.map(ref).filter(Boolean) : undefined,
      radius: Math.max(enlarged ? 25 : 17, Math.ceil(label.length * 4.5 / 2 + 8)),
      fontSize: label.length > 8 ? 9 : enlarged ? 14 : 11,
      fullLabel: huffman && node.id != null ? node.id : (fitViewport || preserveLabels) && label !== fullLabel ? fullLabel : undefined,
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
    roles: {
      swap: [ref(current)].filter(Boolean), focus2: selected.map(ref).filter(Boolean),
      done: visited.map(ref).filter(Boolean), added: added.map(ref).filter(Boolean),
    },
    props: {
      canvasWidth, canvasHeight: Math.max(160, 116 + (levels - 1) * Math.max(66, 2 * radius + 24)), fitViewport,
      highlightedEdges: highlightedEdges.map(ref).filter(Boolean),
    },
  });
}

function trailingSequence(id, title, values) {
  return sequenceLayer(id, title, values, {}, { first: Math.max(0, values.length - 10) });
}

function reconstructionFrames(run) {
  const { inorder } = run.steps[0].variables;
  const depths = new Map(run.steps.filter(step => step.event === 'root').map(({ variables }) =>
    [variables.currentNode, variables.stack.length - 1]));
  const maxDepth = Math.max(0, ...depths.values());
  const spread = Math.min(0.76, Math.max(0, inorder.length - 1) * 0.22);
  // Reserve each position from the inorder rank and recursion depth. Draw only the nodes and links built at this step.
  const slots = new Map(inorder.map((id, index) => [id, {
    id: nodeId(id), label: compactLabel(id, 8), fullLabel: id,
    x: 0.5 + spread * (index / Math.max(1, inorder.length - 1) - 0.5),
    y: maxDepth ? 0.12 + 0.76 * depths.get(id) / maxDepth : 0.5,
  }]));
  const props = {
    canvasWidth: Math.max(320, 80 + Math.max(0, inorder.length - 1) * 90),
    canvasHeight: Math.max(180, 80 + maxDepth * 94),
    nodeRadius: 27, nodeLabelSize: 13, showLegend: false,
  };

  return step => {
    const { nodes, stack, currentNode, edge } = step.variables;
    const title = '重建二叉树';
    if (!nodes.length) return [treeLayer({ id: 'g-tree', title, props })];
    const edges = nodes.flatMap(({ id, left, right }) => [[left, '左'], [right, '右']].flatMap(([child, w]) => child == null ? [] : [{
      from: nodeId(id), to: nodeId(child), w, state: edge?.parent === id && edge.child === child ? 'path' : 'idle',
    }]));
    // A recursive call has a known place in the tree before its returned root is assigned to the parent.
    stack.slice(1).forEach((frame, index) => {
      const parent = stack[index];
      const left = frame.inStart < parent.split;
      edges.push({ from: nodeId(parent.id), to: nodeId(frame.id), w: left ? '左' : '右', state: 'candidate' });
    });
    return [graphLayer({
      id: 'g-tree', title, nodes: nodes.map(({ id }) => slots.get(id)), edges, props,
      roles: {
        swap: [nodeId(currentNode)].filter(Boolean),
        added: edge?.side === 'left' ? [nodeId(edge.child)] : [],
        focus2: edge?.side === 'right' ? [nodeId(edge.child)] : [],
      },
    })];
  };
}

function createReconstructionAnimation(host, explainHost, run, config) {
  const animation = createTraceAnimation(host, explainHost, createReconstructionState(), reconstructionFrames(run),
    'g', { run, config, fillViewport: true });
  const viewport = host.querySelector('.trace-animation-viewport');
  return {
    ...animation,
    showStep(step) {
      animation.showStep(step);
      const { edge, currentNode, root } = step.variables;
      const target = edge?.child ?? currentNode ?? (step.done ? root : null);
      if (target == null) viewport.scrollTo(0, 0);
      else revealNode(viewport, target);
    },
  };
}

function conversionLayout(final, binary) {
  const nodes = new Map((binary ? final.binaryNodes : final.forestNodes).map(node => [node.id, node]));
  const slots = new Map();
  let columns = 0;
  let maxDepth = 0;
  function place(id, depth) {
    const node = nodes.get(id);
    maxDepth = Math.max(maxDepth, depth);
    let column;
    if (binary) {
      if (node.left != null) place(node.left, depth + 1);
      column = columns++;
      if (node.right != null) place(node.right, depth + 1);
    } else {
      const children = node.children.map(child => place(child, depth + 1));
      column = children.length ? (children[0] + children.at(-1)) / 2 : columns++;
    }
    slots.set(id, { column, depth });
    return column;
  }
  for (const root of binary ? [final.root] : final.roots) {
    if (root != null) place(root, 0);
  }

  // Size each complete structure once so adding an edge never reorders the nodes.
  const spread = Math.min(1, Math.max(0, columns - 1) * 0.24);
  const levelSpread = maxDepth > 4 ? 1 : 0.76;
  const positions = new Map([...slots].map(([id, { column, depth }]) => [id, {
    id: nodeId(id), label: compactLabel(id, 7), fullLabel: id,
    x: 0.5 + spread * (column / Math.max(1, columns - 1) - 0.5),
    y: maxDepth ? 0.5 + levelSpread * (depth / maxDepth - 0.5) : 0.5,
  }]));
  return {
    positions,
    width: Math.max(280, 80 + Math.max(0, columns - 1) * 86),
    height: Math.max(180, 80 + maxDepth * 96),
  };
}

function conversionPane(final, binary, output) {
  const type = binary ? '左孩子／右兄弟二叉树' : '有序森林';
  const title = (output ? '结果' : '输入') + ' · ' + type;
  const id = binary ? 'g-binary' : 'g-forest';
  const layout = conversionLayout(final, binary);
  const element = document.createElement('section');
  element.className = 'g-conversion-pane';
  const heading = document.createElement('h3');
  heading.textContent = title;
  const viewport = document.createElement('div');
  viewport.className = 'g-conversion-viewport';
  viewport.setAttribute('role', 'region');
  viewport.setAttribute('aria-label', title);
  viewport.tabIndex = 0;
  const canvas = document.createElement('div');
  canvas.className = 'g-conversion-canvas';
  canvas.style.minWidth = layout.width + 'px';
  canvas.style.minHeight = layout.height + 'px';
  viewport.append(canvas);
  element.append(heading, viewport);
  const stage = createStage(canvas, { fillViewport: true });

  return {
    element, viewport, stage, rootId: binary ? final.root : final.roots[0],
    render(step, animate) {
      const { edge, currentNode, forestNodes, binaryNodes, roots, root } = step.variables;
      const records = binary ? binaryNodes : forestNodes;
      const nodes = records.map(node => layout.positions.get(node.id));
      const connected = new Set(binary ? [root] : roots);
      const edges = records.flatMap(node => {
        const links = binary ? [[node.left, '左孩子'], [node.right, '右兄弟']] : node.children.map(child => [child]);
        return links.filter(([child]) => child != null).map(([child, w]) => {
          connected.add(node.id);
          connected.add(child);
          const active = child === edge?.to && (!output || node.id === edge.from);
          return { from: nodeId(node.id), to: nodeId(child), w, state: active ? 'path' : 'idle' };
        });
      });
      const layer = nodes.length ? graphLayer({
        id, title, nodes, edges,
        props: { nodeRadius: 24, nodeLabelSize: 12, showLegend: false },
        roles: {
          swap: [nodeId(currentNode)].filter(Boolean),
          focus2: [edge?.from, edge?.to].filter(value => value != null && value !== currentNode).map(nodeId),
          excluded: output ? records.filter(node => !connected.has(node.id)).map(node => nodeId(node.id)) : [],
        },
      }) : treeLayer({ id, title });
      renderTraceLayers(canvas, stage, [layer], { animate });
    },
  };
}

function createConversionAnimation(host, explainHost, run, config) {
  const element = document.createElement('div');
  element.className = 'g-conversion';
  element.dataset.vizEngine = 'plus-g';
  const final = run.steps.at(-1).variables;
  const reverse = final.mode === 'to-forest';
  const panes = [conversionPane(final, reverse, false), conversionPane(final, !reverse, true)];
  element.append(...panes.map(pane => pane.element));
  host.append(element);
  const { explain, caption, status } = createExplanationPanel();
  explainHost.replaceChildren(explain);
  let current = null;
  const observer = new ResizeObserver(() => {
    if (current) panes.forEach(pane => pane.render(current, false));
  });
  panes.forEach(pane => observer.observe(pane.viewport));

  return {
    getStep: () => current,
    showStep(step) {
      current = step;
      caption.textContent = step.description;
      status.textContent = describeStructuredStep(run, step, config, 'g');
      for (const pane of panes) {
        pane.render(step, true);
        if (!step.stepIndex) pane.viewport.scrollTo(0, 0);
        const target = step.stepIndex ? step.variables.edge?.to ?? step.variables.currentNode : pane.rootId;
        if (target != null) revealNode(pane.viewport, target);
      }
    },
    playEnterAnimation() {
      if (!current) return;
      for (const pane of panes) {
        pane.stage.clear();
        pane.render(current, true);
      }
    },
    destroy() {
      observer.disconnect();
      panes.forEach(pane => pane.stage.clear());
      element.remove();
      explain.remove();
    },
  };
}

function threadAtStep(step) {
  const { edge, order } = step.variables;
  return step.lineId === 'thread-output' ? { from: order.at(-2), to: order.at(-1), kind: 'successor' } : edge;
}

function createThreadedAnimation(host, explainHost, run, config) {
  const order = run.steps.at(-1).variables.order;
  const indices = new Map(order.map((id, index) => [id, index]));
  const seenAt = new Map(run.steps.filter(step => step.event === 'visit')
    .map(({ variables, stepIndex }) => [variables.currentNode, stepIndex]));
  const row = createArrayAnimationRow('g-threaded-order');
  row.element.classList.add('g-threaded-order');

  function frame(step) {
    const v = step.variables;
    const activeThread = threadAtStep(step);
    return tree('g-tree', '中序线索二叉树', v.nodes, {
      roots: [v.root], current: activeThread?.from ?? v.currentNode, selected: [activeThread?.to], visited: v.order,
      activeThread, threaded: true, fitViewport: true,
    });
  }

  const animation = createTraceAnimation(host, explainHost, null, step => [frame(step)], 'g', { run, config, fillViewport: true });
  const element = host.querySelector('.trace-animation-full');
  element.classList.add('g-threaded');
  const canvas = element.querySelector('.trace-animation-stage');
  const { canvasWidth, canvasHeight } = frame(run.steps[0]).props;
  canvas.style.minWidth = canvasWidth + 'px';
  canvas.style.minHeight = canvasHeight + 'px';
  const viewport = document.createElement('div');
  viewport.className = 'g-threaded-viewport';
  viewport.setAttribute('role', 'region');
  viewport.setAttribute('aria-label', '线索二叉树画布');
  viewport.tabIndex = 0;
  viewport.append(canvas);
  element.append(viewport, row.element);

  return {
    ...animation,
    showStep(step) {
      animation.showStep(step);
      const v = step.variables;
      const edge = threadAtStep(step);
      const from = edge?.from ?? v.currentNode;
      const to = edge?.to;
      const target = to ?? from;
      const revealed = order.map(id => seenAt.get(id) <= step.stepIndex ? id : null);
      let detail = '';
      if (step.done && order.length) detail = '首项前驱为空，末项后继为空';
      if (edge) {
        const action = step.lineId === 'thread-output' ? '沿后继访问' : edge.kind === 'predecessor' ? '前驱' : '后继';
        detail = `${action} ${from} → ${to ?? '空'}`;
      }
      if (!step.stepIndex || step.done) row.rewind();
      row.show({
        title: '中序序列', detail, values: revealed.map(value => compactLabel(value, 8)), fullValues: revealed,
        focus: indices.get(target), emptyText: '空树没有中序序列',
        roles: {
          swap: indices.get(from), focus2: indices.get(to), done: v.order.map(id => indices.get(id)),
          excluded: revealed.flatMap((value, index) => value == null ? [index] : []),
        },
      });
      if (!step.stepIndex) viewport.scrollTo(0, 0);
      const treeTarget = !step.stepIndex ? v.root : target;
      if (treeTarget != null) revealNode(viewport, treeTarget, to == null ? null : from);
    },
    destroy() {
      row.clear();
      animation.destroy();
    },
  };
}

function huffmanPath({ path, root, nodes }) {
  if (path == null || root == null) return [];
  const indices = [root];
  for (const bit of path) {
    const node = nodes[indices.at(-1)];
    const next = bit === '0' ? node.left : node.right;
    if (next == null) break; // A single symbol has code 0 and no edge to follow.
    indices.push(next);
  }
  return indices;
}

function createHuffmanAnimation(host, explainHost, run, config) {
  function frame(step) {
    const v = step.variables;
    const path = huffmanPath(v);
    const merging = step.event === 'merge';
    return [tree('g-huffman', v.root == null ? '哈夫曼森林' : '哈夫曼树', v.nodes, {
      roots: v.root == null ? [...v.selected, ...v.candidates] : [v.root],
      current: merging ? null : v.currentNode,
      selected: path.length ? path.slice(0, -1) : v.selected.filter(id => merging || id !== v.currentNode),
      added: merging ? [v.currentNode] : [],
      highlightedEdges: merging ? v.selected : path.slice(1),
      huffman: true, fitViewport: true,
    })];
  }
  const animation = createTraceAnimation(host, explainHost, createHuffmanState(), frame, 'g', { run, config, fillViewport: true });
  const viewport = host.querySelector('.trace-animation-viewport');
  return {
    ...animation,
    showStep(step) {
      animation.showStep(step);
      const { currentNode, root, candidates, selected } = step.variables;
      if (!step.stepIndex) viewport.scrollTo(0, 0);
      const target = currentNode ?? root ?? candidates[0];
      if (target != null) revealNode(viewport, target, selected[0]);
    },
  };
}

function treeFrame(step, fitViewport) {
  const v = step.variables;
  const current = v.currentNode;
  const order = v.order ?? [];
  const forest = step.algorithm === 'tree-forest-traversal';
  const title = forest ? '有序森林' : '二叉树';
  const preserveLabels = forest || step.algorithm === 'binary-search-tree';
  const layers = [tree('g-tree', title, v.nodes, {
    roots: forest ? v.roots : [v.root], current, visited: order, selected: [v.edge?.to ?? v.childNode ?? v.queuedNode?.id], fitViewport, preserveLabels,
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
  if (run.algorithm === 'binary-tree-reconstruction') return createReconstructionAnimation(host, explainHost, run, config);
  if (run.algorithm === 'tree-forest-conversion') return createConversionAnimation(host, explainHost, run, config);
  if (run.algorithm === 'threaded-binary-tree') return createThreadedAnimation(host, explainHost, run, config);
  if (run.algorithm === 'huffman-coding') return createHuffmanAnimation(host, explainHost, run, config);
  const forestTraversal = run.algorithm === 'tree-forest-traversal';
  const fillViewport = isBinaryTraversal(run.algorithm) || forestTraversal;
  const levelOrder = run.algorithm === 'binary-tree-level-order';
  let state = null;
  if (levelOrder) state = createLevelOrderState();
  else if (forestTraversal) state = createForestTraversalState(run);
  else state = createGStateTable(run.algorithm, config);
  const animation = createTraceAnimation(host, explainHost, state, step => treeFrame(step, fillViewport), 'g', { run, config, fillViewport });
  if (!forestTraversal) return animation;

  const viewport = host.querySelector('.trace-animation-viewport');
  return {
    ...animation,
    showStep(step) {
      animation.showStep(step);
      const { roots, currentNode, childNode } = step.variables;
      if (!step.stepIndex) viewport.scrollTo(0, 0);
      const target = step.event === 'descend' ? childNode : currentNode ?? childNode ?? (!step.stepIndex ? roots[0] : null);
      if (target != null) revealNode(viewport, target, target === currentNode ? childNode : currentNode);
    },
  };
}
