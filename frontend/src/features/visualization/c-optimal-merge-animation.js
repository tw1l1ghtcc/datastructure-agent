import { createStage } from '../../../vendor/plus/app/svg-stage.js';
import { gridLayer, treeLayer } from '../../../vendor/plus/vendor/engine/model.js';
import { animateArrayValue } from './array-animation-row.js';
import { createExplanationPanel } from './explanation-panel.js';
import { describeStructuredStep } from './structured-explanation.js';

function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

function region(className, label) {
  const view = element('div', className);
  view.setAttribute('role', 'region');
  view.setAttribute('aria-label', label);
  view.tabIndex = 0;
  return view;
}

function renderLayer(canvas, stage, layer, options) {
  stage.render([layer], options);
  const svg = canvas.firstElementChild;
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', layer.title);
}

function weightsLayer(id, title, ids, nodes, roles) {
  return gridLayer({
    id, title, values: [ids.map(id => nodes[id].weight)], cellLabels: ids.map(id => '#' + id),
    props: { indexedArray: true }, roles,
  });
}

function forestFrame(step, viewport) {
  const { nodes, candidates, selected, parent } = step.variables;
  const roots = step.event === 'select' ? [...selected, ...candidates] : candidates;
  const edgeTags = {};
  const depths = [];
  const display = nodes.map(node => {
    const label = String(node.weight);
    const children = node.left == null ? [] : [node.left, node.right];
    depths[node.id] = children.length ? 1 + Math.max(depths[node.left], depths[node.right]) : 0;
    if (children.length) {
      edgeTags[node.left] = 'L';
      edgeTags[node.right] = 'R';
    }
    return { id: node.id, label, value: '#' + node.id, children, boxWidth: Math.max(52, label.length * 9 + 18), fontSize: 14 };
  });
  const leaves = nodes.filter(node => node.left == null).length;
  const box = Math.max(52, ...display.map(node => node.boxWidth));
  const gap = Math.max(box + 22, Math.min(156, (viewport.clientWidth - 72) / Math.max(1, leaves)));
  return {
    width: Math.max(viewport.clientWidth, box + Math.max(0, leaves - 1) * gap + 54),
    height: Math.max(viewport.clientHeight, 130 + Math.max(0, ...depths) * 78),
    layer: treeLayer({
      id: 'c-merge-tree', title: step.done ? '最佳归并树' : '归并森林', nodes: display, roots, edgeTags,
      roles: { swap: selected, added: parent == null ? [] : [parent], done: step.done ? candidates : [] },
      props: { leafGap: gap, fitViewport: true },
    }),
  };
}

function reveal(view, target, horizontal = false) {
  if (!target) return;
  const frame = view.getBoundingClientRect();
  const cell = target.getBoundingClientRect();
  if (horizontal && (cell.left < frame.left || cell.right > frame.left + view.clientWidth)) {
    view.scrollLeft += (cell.left + cell.right) / 2 - frame.left - view.clientWidth / 2;
  }
  if (cell.top < frame.top || cell.bottom > frame.top + view.clientHeight) {
    view.scrollTop += (cell.top + cell.bottom) / 2 - frame.top - view.clientHeight / 2;
  }
}

export function createOptimalMergeAnimation(host, run, config, explainHost) {
  const root = element('div', 'c-optimal-merge');
  root.dataset.vizEngine = 'plus-c';
  const sidebar = element('div', 'c-optimal-sidebar');
  const cost = element('p', 'c-optimal-cost');
  const picked = element('div', 'c-optimal-picked');
  const pickedCanvas = element('div', 'c-optimal-picked-canvas');
  picked.append(element('h3', '', '本次取出'), pickedCanvas);
  const queueView = region('c-optimal-queue', '候选段');
  const queueCanvas = element('div', 'c-optimal-queue-canvas');
  const emptyQueue = element('p', 'c-optimal-empty', '候选段为空');
  queueView.append(queueCanvas, emptyQueue);
  const header = element('div', 'c-optimal-caption');
  header.append(element('h3', '', '候选段'), element('p', '', '按取出顺序排列，格下为节点编号'));
  sidebar.append(cost, picked, header, queueView);

  const treePane = element('div', 'c-optimal-tree-pane');
  const treeTitle = element('h3', 'c-optimal-tree-title');
  const treeView = region('c-optimal-tree-viewport', '归并树图');
  const treeCanvas = element('div', 'c-optimal-tree-canvas');
  treeView.append(treeCanvas);
  treePane.append(treeTitle, treeView);
  root.append(sidebar, treePane);
  host.append(root);

  const pickedStage = createStage(pickedCanvas, { fillViewport: true });
  const queueStage = createStage(queueCanvas, { fillViewport: true });
  const treeStage = createStage(treeCanvas, { fillViewport: true });
  const { explain, caption, status } = createExplanationPanel();
  explainHost.replaceChildren(explain);
  let current = null;
  let cancelMove;

  function draw(step, { animate, follow } = {}) {
    const { candidates, selected, nodes, cost: total, parent } = step.variables;
    cost.textContent = (step.done ? '总代价 ' : '累计代价 ') + total;
    picked.hidden = !selected.length;
    if (selected.length) {
      renderLayer(pickedCanvas, pickedStage, weightsLayer('c-selected', '本次取出', selected, nodes, { swap: [0, 1] }), { animate });
    } else pickedStage.clear();

    const parentPosition = candidates.indexOf(parent);
    queueCanvas.hidden = !candidates.length;
    emptyQueue.hidden = Boolean(candidates.length);
    if (candidates.length) {
      const columns = Math.max(1, Math.floor((queueView.clientWidth - 24) / 76));
      queueCanvas.style.height = Math.max(74, Math.ceil(candidates.length / columns) * 52 + 26) + 'px';
      renderLayer(queueCanvas, queueStage, weightsLayer('c-candidates', '候选段', candidates, nodes, {
        added: parentPosition < 0 ? [] : [parentPosition],
        done: step.done ? [0] : [],
      }), { animate });
    } else queueStage.clear();

    const frame = forestFrame(step, treeView);
    treeTitle.textContent = frame.layer.title;
    treeCanvas.style.width = frame.width + 'px';
    treeCanvas.style.height = frame.height + 'px';
    renderLayer(treeCanvas, treeStage, frame.layer, { animate });
    if (parent != null) {
      for (const child of selected) {
        const edge = treeCanvas.querySelector(`[data-avc-key="e-${parent}-${child}"] line`);
        edge?.setAttribute('stroke', '#0b5cad');
        edge?.setAttribute('stroke-width', '2');
      }
    }

    const candidate = queueCanvas.querySelector(`[data-avc-key="g-${parentPosition}"] rect`);
    const parentCell = treeCanvas.querySelector(`[data-avc-key="n-${parent}"] rect`);
    if (follow) {
      if (step.event === 'init' || step.event === 'select' || step.done) queueView.scrollTop = 0;
      if (step.event === 'init' || step.event === 'select') treeView.scrollTo(0, 0);
      const rootId = step.done ? candidates[0] : selected[0];
      reveal(treeView, parentCell ?? treeCanvas.querySelector(`[data-avc-key="n-${rootId}"] rect`), true);
      reveal(queueView, candidate);
    }
    return { candidate, parentCell };
  }

  const observer = new ResizeObserver(() => {
    if (current) draw(current, { animate: false, follow: true });
  });
  observer.observe(root);

  function clear() {
    cancelMove?.();
    pickedStage.clear();
    queueStage.clear();
    treeStage.clear();
  }

  return {
    getStep: () => current,
    showStep(step) {
      cancelMove?.();
      cancelMove = undefined;
      const forwardMerge = step.event === 'merge' && current?.stepIndex + 1 === step.stepIndex;
      current = step;
      const { candidate, parentCell } = draw(step, { follow: true });
      if (forwardMerge && candidate && parentCell && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        cancelMove = animateArrayValue(root, step.variables.nodes[step.variables.parent].weight,
          parentCell.getBoundingClientRect(), candidate.getBoundingClientRect());
      }
      caption.textContent = step.description;
      status.textContent = describeStructuredStep(run, step, config, 'c');
    },
    playEnterAnimation() {
      if (!current) return;
      clear();
      draw(current, { follow: true });
    },
    destroy() {
      observer.disconnect();
      clear();
      root.remove();
      explain.remove();
    },
  };
}
