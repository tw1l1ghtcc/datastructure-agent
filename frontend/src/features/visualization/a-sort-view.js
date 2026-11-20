import { asFrameBuilder } from '../../../vendor/plus/app/host-frame.js';
import { createStage } from '../../../vendor/plus/app/svg-stage.js';
import { arrayLayer, heapLayer } from '../../../vendor/plus/vendor/engine/model.js';
import { aSortDetail, aSortMarks, activeHeapSize } from './a-sort-state.js';
import { createVisualization } from './index.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function buildASortFrame(step, options) {
  if (!step?.array.length) return null;
  const { focus, pointers, range, settled, group } = aSortMarks(step);
  const frame = asFrameBuilder({
    array: step.array, event: step.event, focus, pointers,
    variables: { left: range?.[0], right: range?.[1] },
  }, options);
  const chart = frame.cells[0];
  chart.setAttribute('aria-label', '排序数组柱形图');
  for (const cell of chart.querySelectorAll('.prototype-array-cell')) {
    const index = Number(cell.dataset.index);
    if (settled && index >= settled[0] && index < settled[1]) cell.classList.add('is-sorted');
    if (group && (index - group.index) % group.gap !== 0) cell.classList.add('is-excluded');
  }
  return frame;
}

function layersFor(step) {
  if (!step) return [];
  if (step.algorithm === 'heap-sort') {
    const size = activeHeapSize(step);
    return [heapLayer({
      id: 'a-heap', title: '有效堆',
      name: (step.event === 'init' && size ? '待建堆' : '有效堆') + ' · ' + size + ' 个结点',
      tree: step.array.slice(0, size),
      props: { fitTree: true },
      roles: { focus1: aSortMarks(step).focus.filter(index => index < size) },
    })];
  }

  const { temp, p } = step.variables;
  const readOrWrite = step.event === 'pick' ? temp.length - 1 : step.event === 'copy' ? p - 1 : null;
  return [arrayLayer({
    id: 'a-merge-temp', title: '归并临时数组',
    name: temp.length ? 'temp[]' : '临时数组为空',
    values: temp, roles: { focus1: readOrWrite === null ? [] : [readOrWrite] },
  })];
}

function fitHeapLabels(auxiliary) {
  for (const node of auxiliary.querySelectorAll('[data-avc-key^="tnv-"]')) {
    const text = node.querySelector('text');
    const value = text.textContent;
    text.removeAttribute('textLength');
    text.removeAttribute('lengthAdjust');
    node.querySelector('title')?.remove();
    const index = node.dataset.avcKey.slice(4);
    const circle = auxiliary.querySelector('[data-avc-key="tn-' + index + '"] circle');
    const width = Math.max(3, Math.floor(2 * Number(circle.getAttribute('r')) - 4));
    if (text.getComputedTextLength() <= width) continue;
    text.setAttribute('textLength', String(width));
    text.setAttribute('lengthAdjust', 'spacingAndGlyphs');
    const title = document.createElementNS(SVG_NS, 'title');
    title.textContent = value;
    node.prepend(title);
  }
}

export function createASortVisualization(host, run, explainContainer) {
  const heap = run.algorithm === 'heap-sort';
  const root = document.createElement('div');
  root.className = 'a-sort-view';
  root.classList.toggle('a-heap-view', heap);
  root.dataset.vizEngine = 'plus-sort';
  host.append(root);
  const chart = heap ? document.createElement('div') : root;
  if (heap) {
    chart.className = 'a-heap-chart';
    root.append(chart);
  }
  const view = createVisualization(chart, {
    run, explainContainer,
    frameBuilder: heap ? (step, options) => buildASortFrame(step, {
      ...options,
      width: Math.max(84, chart.clientWidth),
      height: Math.max(112, chart.clientHeight),
    }) : buildASortFrame,
  });

  const detail = heap ? null : document.createElement('p');
  if (detail) {
    detail.className = 'a-sort-detail';
    root.prepend(detail);
  }
  const auxiliary = heap || run.algorithm === 'merge-sort' ? document.createElement('div') : null;
  let stage;
  if (auxiliary) {
    auxiliary.className = 'plus-viz a-sort-auxiliary';
    auxiliary.dataset.sortLayer = heap ? 'heap' : 'temp';
    if (heap) root.prepend(auxiliary);
    else root.append(auxiliary);
    stage = createStage(auxiliary, { fillViewport: heap });
  }

  function renderExtras(step, options) {
    if (detail) detail.textContent = aSortDetail(step);
    if (!stage) return;
    stage.render(layersFor(step), options);
    if (heap) {
      const tree = auxiliary.querySelector('[data-layer="a-heap"]');
      tree?.setAttribute('role', 'img');
      tree?.setAttribute('aria-label', '有效堆树');
      fitHeapLabels(auxiliary);
    }
  }
  renderExtras(view.getStep());
  const observer = heap ? new ResizeObserver(() => {
    const step = view.getStep();
    if (!step) return;
    view.showStep(step);
    renderExtras(step, { animate: false });
  }) : null;
  observer?.observe(root);

  return {
    showStep(step) {
      view.showStep(step);
      renderExtras(step);
    },
    getStep: view.getStep,
    playEnterAnimation() {
      view.playEnterAnimation();
      stage?.clear();
      renderExtras(view.getStep());
    },
    destroy() {
      observer?.disconnect();
      stage?.clear();
      view.destroy();
      root.remove();
    },
  };
}
