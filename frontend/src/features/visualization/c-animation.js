import { createStage } from '../../../vendor/plus/app/svg-stage.js';
import { treeLayer } from '../../../vendor/plus/vendor/engine/model.js';
import { createMultiwayAnimation } from './c-multiway-animation.js';
import { createOptimalMergeAnimation } from './c-optimal-merge-animation.js';
import { createReplacementAnimation } from './c-replacement-animation.js';
import { createCStateTable } from './c-state-table.js';
import { createExplanationPanel } from './explanation-panel.js';
import { describeStructuredStep } from './structured-explanation.js';

const MIN_WIDTH = 320;

function tree(id, title, nodes, roots, roles, extraEdges) {
  const boxWidth = Math.max(32, ...nodes.map(node => node.boxWidth));
  const leafGap = boxWidth + 20;
  const byId = new Map(nodes.map(node => [node.id, node]));
  const pending = roots.map(root => [root, 0]);
  let maxDepth = 0;
  while (pending.length) {
    const [node, depth] = pending.pop();
    maxDepth = Math.max(depth, maxDepth);
    for (const child of byId.get(node).children) pending.push([child, depth + 1]);
  }
  const leaves = nodes.filter(node => !node.children.length).length;
  return {
    width: Math.max(MIN_WIDTH, boxWidth + Math.max(0, leaves - 1) * leafGap + 44),
    layer: treeLayer({
      id, title, nodes, roots, roles, extraEdges,
      props: { leafGap, canvasHeight: 130 + maxDepth * 63 },
    }),
  };
}

function treeNode(id, label, children) {
  return { id, label, children, value: '#' + id, boxWidth: Math.max(34, label.length * 7 + 16) };
}

function searchTree(step) {
  const { nodes, root, currentNode, split, path, overflowNode } = step.variables;
  const bPlus = step.algorithm === 'b-plus-tree';
  const display = nodes.map(node => treeNode(node.id, node.keys.join(' · ') || '空', node.children));
  const leafLinks = bPlus ? nodes.filter(node => node.leaf && node.next != null).map(node => ({
    from: node.id, to: node.next, horizontal: true, color: '#0a6b4a', dash: [5, 4],
  })) : [];
  const focused = [currentNode, overflowNode].filter(id => id != null);
  const partners = split ? [split.left, split.right] : [];
  return tree('c-search-tree', bPlus ? 'B+ 树与叶链（虚线）' : 'B 树结构',
    display, root == null ? [] : [root], {
      focus1: focused, focus2: partners, done: path,
    }, leafLinks);
}

export function createCAnimation(host, run, config, explainHost) {
  if (run.algorithm === 'optimal-merge-tree') return createOptimalMergeAnimation(host, run, config, explainHost);
  if (run.algorithm === 'multiway-merge') return createMultiwayAnimation(host, run, config, explainHost);
  if (run.algorithm === 'replacement-selection') return createReplacementAnimation(host, run, config, explainHost);
  const element = document.createElement('div');
  element.className = 'c-animation';
  element.dataset.vizEngine = 'plus-c';
  const canvas = document.createElement('div');
  canvas.className = 'plus-viz c-animation-stage';
  element.append(canvas);
  const state = createCStateTable(config);
  element.append(state.element);
  host.append(element);
  const stage = createStage(canvas);
  const { explain, caption, status } = createExplanationPanel();
  explainHost.replaceChildren(explain);
  let current = null;

  function showStep(step) {
    current = step;
    const { width, layer } = searchTree(step);
    canvas.style.width = width + 'px';
    stage.render([layer]);
    const svg = canvas.querySelector('.avc-svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', layer.title);
    state.showStep(step);
    caption.textContent = step.description;
    status.textContent = describeStructuredStep(run, step, config, 'c');
  }

  return {
    showStep,
    getStep: () => current,
    playEnterAnimation() {
      if (!current) return;
      stage.clear();
      showStep(current);
    },
    destroy() {
      stage.clear();
      element.remove();
      explain.remove();
    },
  };
}
