import { createStage } from '../../../vendor/plus/app/svg-stage.js';
import { gridLayer, linkLayer, treeLayer } from '../../../vendor/plus/vendor/engine/model.js';
import { createDStateTable } from './d-state-table.js';
import { createExplanationPanel } from './explanation-panel.js';
import { describeStructuredStep } from './structured-explanation.js';

const MIN_WIDTH = 320;
const SLOT_WINDOW = 7;
const CHAIN_WINDOW = 5;

function windowStart(length, size, current) {
  return Math.max(0, Math.min(current - Math.floor(size / 2), length - size));
}

function indexedRow(id, title, rowLabel, values, current, state) {
  const first = windowStart(values.length, SLOT_WINDOW, current ?? 0);
  const visible = values.slice(first, first + SLOT_WINDOW);
  const indices = visible.map((_, index) => String(first + index));
  const cellW = Math.max(40, ...visible.map(value => String(value).length * 7 + 12));
  const range = values.length > visible.length ? ` · ${indices[0]}–${indices.at(-1)} / ${values.length} 格` : '';
  return {
    width: 72 + cellW * (visible.length + 1),
    layer: gridLayer({
      id, title: title + range,
      values: [visible], colLabels: indices, rowLabels: [rowLabel],
      roles: current == null ? {} : { [state]: ['0,' + (current - first)] },
      props: { cellW, cellH: 32 },
    }),
  };
}

function hashFrame(step) {
  const v = step.variables;
  const home = v.hash ?? v.h1;
  const current = v.slot ?? home;
  const state = step.event === 'found' ? 'done' : step.event === 'place' ? 'added' : v.slot == null ? 'focus2' : 'swap';
  const row = indexedRow('d-slots', '哈希槽位', '键', v.table.map((value, index) => v.used[index] ? value : '空'), current, state);
  return { width: row.width, layers: [row.layer] };
}

function chainingFrame(step) {
  const { buckets, bucketIndex, chain, position } = step.variables;
  const row = indexedRow('d-buckets', '哈希桶', '链长', buckets.map(bucket => bucket.length), bucketIndex, 'focus2');
  if (bucketIndex == null) return { width: row.width, layers: [row.layer] };

  const first = windowStart(chain.length, CHAIN_WINDOW, position ?? 0);
  const visible = chain.slice(first, first + CHAIN_WINDOW);
  const nodes = visible.map((value, index) => {
    const offset = first + index;
    return { id: 'pos' + offset, value, next: offset + 1 < chain.length ? 'pos' + (offset + 1) : null };
  });
  const state = step.event === 'found' ? 'done' : step.event === 'insert-tail' ? 'added' : 'swap';
  const nodeW = Math.max(52, ...visible.map(value => String(value).length * 8 + 12));
  const gap = 32;
  const range = visible.length < chain.length ? ` · 节点 ${first + 1}–${first + visible.length} / ${chain.length}` : '';
  return {
    width: Math.max(row.width, 68 + nodeW * nodes.length + gap * Math.max(0, nodes.length - 1)),
    layers: [
      row.layer,
      linkLayer({
        id: 'd-chain', title: `桶 ${bucketIndex} 的链${range}`, nodes,
        head: first === 0 ? nodes[0]?.id : null,
        roles: position == null ? {} : { [state]: ['pos' + position] },
        props: { nodeW, nodeH: 36, gap },
      }),
    ],
  };
}

const nodeId = key => key == null ? null : 'k' + key;

function treeFrame(step) {
  const v = step.variables;
  const redBlack = step.algorithm === 'red-black-tree';
  const nodes = v.nodes.map(node => ({
    id: nodeId(node.key), label: String(node.key),
    left: nodeId(node.left), right: nodeId(node.right),
    radius: Math.max(17, Math.ceil(String(node.key).length * 2.5 + 5)),
    fontSize: String(node.key).length > 11 ? 8 : 10,
    color: redBlack ? (node.color === 'R' ? 'red' : 'black') : undefined,
    value: redBlack ? (node.color === 'R' ? '红' : '黑') : `h=${node.height} · BF=${node.bf}`,
  }));
  const edgeTags = Object.fromEntries(nodes.flatMap(node => [
    ...(node.left ? [[node.left, 'L']] : []),
    ...(node.right ? [[node.right, 'R']] : []),
  ]));
  const byId = new Map(nodes.map(node => [node.id, node]));
  const root = nodeId(v.root);
  const depth = id => id == null ? 0 : 1 + Math.max(depth(byId.get(id).left), depth(byId.get(id).right));
  const leaves = nodes.filter(node => !node.left && !node.right).length;
  const radius = Math.max(17, ...nodes.map(node => node.radius));
  const current = step.event === 'found' ? v.searchResult
    : v.unbalancedAt ?? v.z ?? (step.event === 'insert' ? v.key : v.path?.at(-1));
  const state = step.event === 'found' ? 'done' : 'swap';
  return {
    width: Math.max(MIN_WIDTH, 90 + Math.max(0, leaves - 1) * Math.max(70, radius * 2 + 24) + radius * 2),
    layers: [treeLayer({
      id: 'd-tree', title: redBlack ? '红黑树结构' : 'AVL 树结构', nodes, roots: root == null ? [] : [root], edgeTags,
      roles: { [state]: current == null ? [] : [nodeId(current)], added: (v.path ?? []).map(nodeId) },
      props: { canvasHeight: Math.max(160, 100 + Math.max(0, depth(root) - 1) * Math.max(70, radius * 2 + 26)), keepNodeColors: redBlack },
    })],
  };
}

export function createDAnimation(host, run, config, explainHost) {
  const element = document.createElement('div');
  element.className = 'd-animation';
  element.dataset.vizEngine = 'plus-d';
  const canvas = document.createElement('div');
  canvas.className = 'plus-viz d-animation-stage';
  const table = createDStateTable(config);
  element.append(canvas, table.element);
  host.append(element);
  const stage = createStage(canvas);
  const { explain, caption, status } = createExplanationPanel();
  explainHost.replaceChildren(explain);
  const frameFor = config.tree ? treeFrame : run.algorithm === 'hash-chaining' ? chainingFrame : hashFrame;
  let current = null;

  function render(step) {
    const { layers, width } = frameFor(step);
    canvas.style.width = Math.max(MIN_WIDTH, width) + 'px';
    stage.render(layers);
    for (const [index, svg] of [...canvas.querySelectorAll('.avc-svg')].entries()) {
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', layers[index].title);
    }
  }

  return {
    getStep: () => current,
    showStep(step) {
      current = step;
      render(step);
      table.showStep(step);
      caption.textContent = step.description;
      status.textContent = describeStructuredStep(run, step, config, 'd');
    },
    playEnterAnimation() {
      if (!current) return;
      stage.clear();
      render(current);
    },
    destroy() {
      stage.clear();
      element.remove();
      explain.remove();
    },
  };
}
