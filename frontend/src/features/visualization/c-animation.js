import { createStage } from '../../../vendor/plus/app/svg-stage.js';
import { arrayLayer, treeLayer } from '../../../vendor/plus/vendor/engine/model.js';
import { createCStateTable } from './c-state-table.js';
import { createExplanationPanel } from './explanation-panel.js';
import { describeStructuredStep } from './structured-explanation.js';
import { indexedCard } from './trace-animation.js';

const ARRAY_WINDOW = 16;
const MIN_WIDTH = 320;

function sequence(id, title, values, { focus = [], tail = false, indexBase = 0 } = {}) {
  const size = Math.min(values.length, ARRAY_WINDOW);
  const anchor = focus[0] ?? (tail ? values.length - 1 : 0);
  const first = Math.max(0, Math.min(anchor - Math.floor(size / 2), values.length - size));
  const base = first + indexBase;
  const slice = values.slice(first, first + size);
  return arrayLayer({
    id, title: size < values.length ? title + ' · 下标 ' + base + '–' + (base + size - 1) : title,
    values: slice,
    labels: slice.map(value => value == null ? '空' : String(value)),
    indexBase: base,
    roles: { focus1: focus.map(index => index + indexBase) },
  });
}

function tree(id, title, nodes, roots, roles, { extraEdges = [], edgeTags } = {}) {
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
      id, title, nodes, roots, roles, extraEdges, edgeTags,
      props: { leafGap, canvasHeight: 130 + maxDepth * 63 },
    }),
  };
}

function treeNode(id, label, children) {
  return { id, label, children, value: '#' + id, boxWidth: Math.max(34, label.length * 7 + 16) };
}

function optimalTree(step) {
  const v = step.variables;
  const children = new Set(v.nodes.flatMap(node => [node.left, node.right]));
  const roots = v.nodes.filter(node => !children.has(node.id)).map(node => node.id);
  const nodes = v.nodes.map(node => treeNode(node.id, String(node.weight),
    [node.left, node.right].filter(child => child !== null)));
  const edgeTags = Object.fromEntries(v.nodes.filter(node => node.left != null)
    .flatMap(node => [[node.left, 'L'], [node.right, 'R']]));
  const stage = tree('c-merge-tree', '归并节点森林（L 左，R 右）', nodes, roots, {
    focus1: v.selected, focus2: v.parent == null ? [] : [v.parent],
  }, { edgeTags });
  const candidates = v.candidates.length
    ? indexedCard('c-candidates', '候选段权重（按取出顺序，格下为节点 ID）',
      v.candidates.map(id => v.nodes[id].weight), {}, v.candidates.map(id => '#' + id))
    : sequence('c-candidates', '候选段为空', []);
  return { width: stage.width, layers: [candidates, stage.layer] };
}

function multiway(step) {
  const v = step.variables;
  const heads = (v.group ?? v.runs).map((run, i) => run[v.positions[i] ?? 0] ?? null);
  const groupStart = v.groupStart ?? 0;
  const selected = step.event === 'select' ? [v.selected.run - groupStart] : [];
  const focus = step.event === 'output' ? [v.output.length - 1] : [];
  return { layers: [
    sequence('c-run-heads', '各段下一待取值（按段号）', heads, { focus: selected, indexBase: groupStart }),
    sequence('c-output', step.done ? '归并结果' : '本批输出', v.output, { focus, tail: true }),
  ] };
}

function replacement(step) {
  const { active, frozen, currentRun, incoming, runs } = step.variables;
  const focus = entries => entries.flatMap((entry, index) => entry.index === incoming?.index ? [index] : []);
  const output = step.done ? runs.at(-1) ?? [] : currentRun;
  return { layers: [
    sequence('c-active', '活动缓冲区', active.map(entry => entry.value), { focus: focus(active) }),
    sequence('c-frozen', '冻结缓冲区', frozen.map(entry => entry.value), { focus: focus(frozen) }),
    sequence('c-current-run', step.done && runs.length ? '最后完成的有序段' : '当前输出段', output,
      { focus: step.event === 'output' ? [output.length - 1] : [], tail: true }),
  ] };
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
  const stage = tree('c-search-tree', bPlus ? 'B+ 树与叶链（虚线）' : 'B 树结构',
    display, root == null ? [] : [root], {
      focus1: focused, focus2: partners, done: path,
    }, { extraEdges: leafLinks });
  return { width: stage.width, layers: [stage.layer] };
}

const frameByAlgorithm = {
  'optimal-merge-tree': optimalTree,
  'multiway-merge': multiway,
  'replacement-selection': replacement,
  'b-tree': searchTree,
  'b-plus-tree': searchTree,
};

export function createCAnimation(host, run, config, explainHost) {
  const element = document.createElement('div');
  element.className = 'c-animation';
  element.dataset.vizEngine = 'plus-c';
  const canvas = document.createElement('div');
  canvas.className = 'plus-viz c-animation-stage';
  element.append(canvas);
  const state = run.algorithm === 'optimal-merge-tree' ? null : createCStateTable(config);
  if (state) element.append(state.element);
  host.append(element);
  const stage = createStage(canvas);
  const { explain, caption, status } = createExplanationPanel();
  explainHost.replaceChildren(explain);
  let current = null;

  function showStep(step) {
    current = step;
    const frame = frameByAlgorithm[run.algorithm](step);
    const minWidth = Math.max(MIN_WIDTH, frame.width ?? 0,
      ...frame.layers.filter(layer => layer.style === 1).map(layer => 72 + layer.data.values.length * 37));
    canvas.style.width = minWidth + 'px';
    stage.render(frame.layers);
    for (const [index, svg] of [...canvas.querySelectorAll('.avc-svg')].entries()) {
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', frame.layers[index].title);
      if (svg.dataset.avcSvg === 'c-candidates') {
        const viewport = svg.parentElement;
        viewport.scrollTop = 0;
        if (viewport.scrollHeight > viewport.clientHeight) {
          viewport.tabIndex = 0;
          viewport.setAttribute('role', 'region');
          viewport.setAttribute('aria-label', frame.layers[index].title);
        } else {
          viewport.removeAttribute('tabindex');
          viewport.removeAttribute('role');
          viewport.removeAttribute('aria-label');
        }
      }
    }
    state?.showStep(step);
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
