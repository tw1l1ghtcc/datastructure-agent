import { asFrameBuilder } from '../../../vendor/plus/app/host-frame.js';
import { createStage } from '../../../vendor/plus/app/svg-stage.js';
import { heapLayer } from '../../../vendor/plus/vendor/engine/model.js';
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

function heapFrame(step) {
  const size = activeHeapSize(step);
  return heapLayer({
    id: 'a-heap', title: '有效堆',
    name: (step.event === 'init' && size ? '待建堆' : '有效堆') + ' · ' + size + ' 个结点',
    tree: step.array.slice(0, size),
    props: { fitTree: true },
    roles: { focus1: aSortMarks(step).focus.filter(index => index < size) },
  });
}

function createMergeTemp() {
  const element = document.createElement('div');
  element.className = 'bsviz a-merge-temp';
  const title = document.createElement('p');
  title.className = 'a-merge-title';
  title.textContent = '临时数组 temp[]';
  const track = document.createElement('div');
  track.className = 'a-merge-track';
  track.tabIndex = 0;
  track.setAttribute('role', 'region');
  track.setAttribute('aria-label', '归并临时数组');
  const row = document.createElement('div');
  row.className = 'a-merge-cells';
  track.append(row);
  element.append(title, track);

  return {
    element,
    showStep(step) {
      const { temp = [], p } = step?.variables ?? {};
      if (!temp.length) {
        const empty = document.createElement('div');
        empty.className = 'bsviz-empty';
        empty.textContent = '临时数组为空';
        row.replaceChildren(empty);
        return;
      }
      const focus = step.event === 'pick' ? temp.length - 1 : step.event === 'copy' ? p - 1 : null;
      const cells = temp.map((value, index) => {
        const cell = document.createElement('div');
        cell.className = 'bsviz-cell';
        cell.classList.toggle('is-comparing', index === focus);
        const label = document.createElement('div');
        label.className = 'bsviz-value';
        label.textContent = value;
        const position = document.createElement('div');
        position.className = 'bsviz-idx';
        position.textContent = index;
        cell.append(label, position);
        return cell;
      });
      row.replaceChildren(...cells);
      const active = cells[focus];
      if (active) {
        const left = active.offsetLeft;
        const right = left + active.offsetWidth;
        if (left < track.scrollLeft) track.scrollLeft = left;
        else if (right > track.scrollLeft + track.clientWidth) track.scrollLeft = right - track.clientWidth;
      }
    },
  };
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
  const merge = run.algorithm === 'merge-sort';
  const split = heap || merge;
  const root = document.createElement('div');
  root.className = 'a-sort-view';
  root.classList.toggle('a-sort-split', split);
  root.dataset.vizEngine = 'plus-sort';
  host.append(root);
  const chart = split ? document.createElement('div') : root;
  if (split) {
    chart.className = 'a-sort-chart';
    root.append(chart);
  }
  const view = createVisualization(chart, {
    run, explainContainer,
    frameBuilder: split ? (step, options) => buildASortFrame(step, {
      ...options,
      width: Math.max(84, chart.clientWidth),
      height: Math.max(112, chart.clientHeight),
    }) : buildASortFrame,
  });

  const detail = split ? null : document.createElement('p');
  if (detail) {
    detail.className = 'a-sort-detail';
    root.prepend(detail);
  }
  const heapPane = heap ? document.createElement('div') : null;
  const temp = merge ? createMergeTemp() : null;
  if (heapPane) {
    heapPane.className = 'plus-viz a-sort-auxiliary';
    heapPane.dataset.sortLayer = 'heap';
    root.prepend(heapPane);
  }
  if (temp) root.prepend(temp.element);
  const stage = heapPane ? createStage(heapPane, { fillViewport: true }) : null;

  function renderExtras(step, options) {
    if (detail) detail.textContent = aSortDetail(step);
    temp?.showStep(step);
    if (!stage) return;
    stage.render(step ? [heapFrame(step)] : [], options);
    const svg = heapPane.querySelector('svg');
    svg?.setAttribute('role', 'img');
    svg?.setAttribute('aria-label', '有效堆树');
    fitHeapLabels(heapPane);
  }
  renderExtras(view.getStep());
  const observer = split ? new ResizeObserver(() => {
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
