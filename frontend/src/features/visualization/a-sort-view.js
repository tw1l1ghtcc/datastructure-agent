import { asFrameBuilder } from '../../../vendor/plus/app/host-frame.js';
import { createStage } from '../../../vendor/plus/app/svg-stage.js';
import { heapLayer } from '../../../vendor/plus/vendor/engine/model.js';
import { aSortMarks, activeHeapSize, insertionSortFrame, mergeTransfer, quickSortFrames, selectionCandidate, sortSwap } from './a-sort-state.js';
import { animateArrayValue } from './array-animation-row.js';
import { createVisualization } from './index.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
// The 24-element input limit allows at most 12 groups in the first pass.
const shellGroupColors = [
  ['#e7f1fd', '#0b5cad'], ['#efeafd', '#6650cf'], ['#e6f6ef', '#0a6b4a'],
  ['#fdf1e0', '#8a4b00'], ['#fdeff8', '#8b1570'], ['#e4f4f3', '#14696b'],
  ['#f7edc1', '#795a0d'], ['#ddddec', '#454772'], ['#f8d9d5', '#922c25'],
  ['#d9ebc2', '#466520'], ['#cfe8fa', '#315980'], ['#e6d4f4', '#6a2d8d'],
];

function drawHole(cell, chart, index, name = '坑') {
  cell.classList.remove('is-comparing', 'is-sorted', 'is-excluded');
  cell.classList.add('is-hole');
  cell.setAttribute('aria-label', `A[${index}] 是当前的${name}`);
  const bar = cell.querySelector('rect');
  const label = cell.querySelector('.prototype-array-value');
  const top = Math.max(64, Math.min(chart.viewBox.baseVal.height - 75,
    Number(bar.getAttribute('y')) + Number(bar.getAttribute('height')) / 2 - 14));
  bar.setAttribute('x', Number(bar.getAttribute('x')) - 3);
  bar.setAttribute('y', top);
  bar.setAttribute('width', Number(bar.getAttribute('width')) + 6);
  bar.setAttribute('height', 28);
  bar.setAttribute('rx', 4);
  label.textContent = name;
  label.setAttribute('y', top + 18);
  label.removeAttribute('textLength');
  label.removeAttribute('lengthAdjust');
  if (Number(bar.getAttribute('width')) < name.length * 11) {
    label.setAttribute('textLength', Number(bar.getAttribute('width')) - 4);
    label.setAttribute('lengthAdjust', 'spacingAndGlyphs');
  }
  cell.querySelector('title')?.remove();
}

function animateBarMove(cells, { from, to }) {
  const x = index => Number(cells[index].querySelector('.prototype-array-value').getAttribute('x'));
  const mark = cells[to].firstElementChild;
  mark.animate([
    { transform: `translateX(${x(from) - x(to)}px)` },
    { transform: 'translateX(0)' },
  ], { duration: 260, easing: 'ease-out' });
}

function drawHeapBoundary(chart, cells, size) {
  const { width, height } = chart.viewBox.baseVal;
  const count = cells.length;
  if (size > 0 && size < count) {
    const x = index => Number(cells[index].querySelector('.prototype-array-value').getAttribute('x'));
    const boundary = (x(size - 1) + x(size)) / 2;
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('class', 'a-heap-boundary');
    line.setAttribute('x1', boundary);
    line.setAttribute('x2', boundary);
    line.setAttribute('y1', '64');
    line.setAttribute('y2', height - 30);
    chart.prepend(line);
  }
  const label = document.createElementNS(SVG_NS, 'text');
  label.setAttribute('class', 'a-heap-range-label');
  label.setAttribute('x', width / 2);
  label.setAttribute('y', height - 6);
  const indices = (first, last) => first === last ? String(first) : `${first}–${last}`;
  label.textContent = [
    size > 0 ? `堆区 ${indices(0, size - 1)}` : '',
    size < count ? `已就位 ${indices(size, count - 1)}` : '',
  ].filter(Boolean).join(' ｜ ');
  chart.append(label);
}

function markShellGroup(cell, chart, index, group) {
  const number = index % group.gap;
  const [fill, stroke] = shellGroupColors[number];
  cell.dataset.shellGroup = number;
  cell.style.setProperty('--shell-group-fill', fill);
  cell.style.setProperty('--shell-group-stroke', stroke);
  if (group.index != null && number !== group.index) cell.classList.add('is-excluded');
  const label = document.createElementNS(SVG_NS, 'text');
  label.setAttribute('class', 'a-shell-group-label');
  label.setAttribute('x', cell.querySelector('.prototype-array-value').getAttribute('x'));
  label.setAttribute('y', chart.viewBox.baseVal.height - 4);
  label.textContent = '组' + (number + 1);
  cell.append(label);
}

function buildASortFrame(step, options, sortFrame) {
  if (!step?.array.length) return null;
  const { focus, related, pointers, range, settled, group, candidate } = aSortMarks(step);
  const frame = asFrameBuilder({
    array: sortFrame?.array ?? step.array, event: step.event, focus, pointers,
    variables: { left: range?.[0], right: range?.[1] },
  }, options);
  const chart = frame.cells[0];
  chart.setAttribute('aria-label', '排序数组柱形图');
  const folding = step.algorithm === 'binary-insertion-sort';
  const selection = step.algorithm === 'selection-sort';
  if (selection) chart.classList.add('a-selection-chart');
  if (folding || selection) {
    for (const marker of frame.pointers.values()) {
      for (const part of marker.querySelectorAll('[y]')) {
        part.setAttribute('y', Number(part.getAttribute('y')) - 8);
      }
    }
  }
  const merge = step.algorithm === 'merge-sort';
  const transfer = merge ? mergeTransfer(step) : null;
  const { low, mid, high } = step.variables;
  const cells = chart.querySelectorAll('.prototype-array-cell');
  for (const cell of cells) {
    const index = Number(cell.dataset.index);
    const placed = settled && index >= settled[0] && index < settled[1];
    if (placed) cell.classList.add('is-sorted');
    if (merge && !placed && Number.isInteger(mid) && index >= low && index <= high) {
      cell.classList.add(index <= mid ? 'is-merge-left' : 'is-merge-right');
    }
    if (transfer?.arrayIndex === index) cell.dataset.transfer = step.event === 'pick' ? 'source' : 'destination';
    if (group) markShellGroup(cell, chart, index, group);
    if (candidate === index) cell.classList.add('is-selection-min');
    if (folding && range && index >= range[0] && index <= range[1]) {
      cell.classList.add('is-binary-insertion-range');
    }
    if (related?.includes(index)) cell.classList.add('is-heap-related');
    if (sortFrame?.fixed?.includes(index)) {
      cell.classList.add('is-sorted');
      cell.classList.remove('is-excluded', 'is-comparing');
    }
    if (sortFrame?.hole === index) drawHole(cell, chart, index, sortFrame.holeLabel);
  }
  const heap = step.algorithm === 'heap-sort';
  if (heap) drawHeapBoundary(chart, cells, activeHeapSize(step));
  if (!options.reduced && !options.enter && options.previous?.stepIndex + 1 === step.stepIndex) {
    if (sortFrame?.move) animateBarMove(cells, sortFrame.move);
    const exchange = sortSwap(step);
    if (exchange) {
      const [from, to] = exchange;
      animateBarMove(cells, { from, to });
      animateBarMove(cells, { from: to, to: from });
    }
  }
  return frame;
}

function createHeldValue() {
  const element = document.createElement('div');
  element.className = 'a-sort-held';
  const title = document.createElement('span');
  const value = document.createElement('strong');
  value.className = 'a-sort-held-value';
  const location = document.createElement('span');
  location.className = 'a-sort-held-location';
  element.append(title, value, location);
  return {
    element,
    value,
    show(text, number, target, placed) {
      element.style.visibility = number == null ? 'hidden' : 'visible';
      element.classList.toggle('is-placed', placed);
      title.textContent = text;
      value.textContent = number ?? '';
      location.textContent = target;
    },
  };
}

function animateHeldValue(root, from, target) {
  const to = target.getBoundingClientRect();
  const scale = root.getBoundingClientRect().width / root.offsetWidth || 1;
  const x = (from.left + from.width / 2 - to.left - to.width / 2) / scale;
  const y = (from.top + from.height / 2 - to.top - to.height / 2) / scale;
  return target.animate([
    { transform: `translate(${x}px, ${y}px)` },
    { transform: 'translate(0, 0)' },
  ], { duration: 260, easing: 'ease-out' });
}

function heapFrame(step) {
  const size = activeHeapSize(step);
  const { focus, related = [] } = aSortMarks(step);
  return heapLayer({
    id: 'a-heap', title: '有效堆',
    name: (step.event === 'init' && size ? '待建堆' : '有效堆') + ' · ' + size + ' 个结点',
    tree: step.array.slice(0, size),
    props: { fitTree: true },
    roles: { swap: focus.filter(index => index < size), focus2: related },
  });
}

function markHeapEdge(heapPane, step) {
  const { event, lineId, variables: v } = step;
  const comparing = event === 'compare' || event === 'update-largest';
  const moving = event === 'check-swap' || lineId === 'swap-node';
  if (!comparing && !moving) return;
  const child = comparing ? (lineId === 'compare-l' ? v.l : v.r) : v.largest;
  const edge = heapPane.querySelector(`[data-avc-key="te-${v.i}-${child}"] line`);
  edge?.setAttribute('stroke', '#8a4b00');
  edge?.setAttribute('stroke-width', '2');
}

function createMergeTemp() {
  const element = document.createElement('div');
  element.className = 'bsviz a-merge-temp';
  const title = document.createElement('p');
  title.className = 'a-merge-title';
  title.textContent = '临时数组 temp[]';
  const progress = document.createElement('p');
  progress.className = 'a-merge-progress';
  const heading = document.createElement('div');
  heading.append(title, progress);
  const track = document.createElement('div');
  track.className = 'a-merge-track';
  track.tabIndex = 0;
  track.setAttribute('role', 'region');
  track.setAttribute('aria-label', '归并临时数组');
  const row = document.createElement('div');
  row.className = 'a-merge-cells';
  track.append(row);
  element.append(heading, track);

  function reveal(index) {
    const cell = row.children[index];
    if (!cell) return null;
    const left = cell.offsetLeft;
    const right = left + cell.offsetWidth;
    if (left < track.scrollLeft) track.scrollLeft = left;
    else if (right > track.scrollLeft + track.clientWidth) track.scrollLeft = right - track.clientWidth;
    return cell;
  }

  return {
    element,
    reveal,
    showStep(step) {
      const { temp = [], p, low, high } = step?.variables ?? {};
      const collecting = ['merge-start', 'compare', 'pick'].includes(step?.event);
      const size = collecting ? high - low + 1 : temp.length;
      const next = collecting && temp.length < size ? temp.length : null;
      const transfer = step ? mergeTransfer(step) : null;
      progress.textContent = next != null ? `下一写入 temp[${next}]`
        : step?.event === 'copy' ? `已写回 ${p} / ${size}` : '';
      if (!size) {
        const empty = document.createElement('div');
        empty.className = 'bsviz-empty';
        empty.textContent = '临时数组为空';
        row.replaceChildren(empty);
        return;
      }
      const cells = Array.from({ length: size }, (_, index) => {
        const cell = document.createElement('div');
        cell.className = 'bsviz-cell';
        cell.classList.toggle('is-comparing', index === transfer?.tempIndex);
        cell.classList.toggle('is-next', index === next);
        if (index < temp.length) cell.dataset.filled = 'true';
        if (index === transfer?.tempIndex) cell.dataset.transfer = step.event === 'pick' ? 'destination' : 'source';
        const label = document.createElement('div');
        label.className = 'bsviz-value';
        label.textContent = temp[index] ?? '—';
        const position = document.createElement('div');
        position.className = 'bsviz-idx';
        position.textContent = index;
        cell.append(label, position);
        return cell;
      });
      row.replaceChildren(...cells);
      reveal(transfer?.tempIndex ?? next);
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
  const quick = run.algorithm === 'quick-sort';
  const shell = run.algorithm === 'shell-sort';
  const selection = run.algorithm === 'selection-sort';
  const insertion = run.algorithm === 'insertion-sort' || run.algorithm === 'binary-insertion-sort' || shell;
  const frames = quick ? quickSortFrames(run.steps) : insertion ? run.steps.map(insertionSortFrame) : null;
  const root = document.createElement('div');
  root.className = 'a-sort-view';
  root.classList.toggle('a-sort-split', split);
  root.classList.toggle('a-merge-view', merge);
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
    }) : (step, options) => buildASortFrame(step, options, frames?.[step?.stepIndex]),
  });

  const heapPane = heap ? document.createElement('div') : null;
  const temp = merge ? createMergeTemp() : null;
  if (heapPane) {
    heapPane.className = 'plus-viz a-sort-auxiliary';
    heapPane.dataset.sortLayer = 'heap';
    root.prepend(heapPane);
  }
  if (temp) root.prepend(temp.element);
  const held = frames || selection ? createHeldValue() : null;
  if (selection) held.element.classList.add('a-selection-candidate');
  if (held) root.prepend(held.element);
  const shellGap = shell ? document.createElement('p') : null;
  if (shellGap) {
    shellGap.className = 'a-shell-gap';
    root.prepend(shellGap);
  }
  const stage = heapPane ? createStage(heapPane, { fillViewport: true }) : null;
  const barAt = index => root.querySelector(`.prototype-array-cell[data-index="${index}"] > g`);
  let cancelMotion;

  function renderExtras(step, options) {
    if (shellGap) {
      const gap = step?.variables.gap;
      shellGap.textContent = gap && !step.done
        ? `gap = ${gap} · ${step.event === 'gap' ? '共 ' + gap + ' 组' : '正在处理组 ' + (step.variables.i % gap + 1)}`
        : '';
    }
    if (selection && step) {
      const candidate = selectionCandidate(step);
      held.show(candidate?.placed ? '本轮已就位' : '当前最小值', candidate?.value,
        candidate ? '下标 ' + candidate.index : '', Boolean(candidate?.placed));
    } else if (held && step) {
      const { hole } = frames[step.stepIndex];
      const { pivot, temp, i, insertIndex } = step.variables;
      if (quick) {
        const placed = step.event === 'place-pivot';
        held.show(placed ? '枢轴已归位' : '暂存枢轴', pivot,
          placed ? `A[${i}]` : hole == null ? '' : `当前的坑 A[${hole}]`, placed);
      } else {
        const inserted = step.event === 'insert';
        held.show('暂存格', inserted ? '—' : step.done || step.event === 'gap' ? null : temp,
          inserted ? `已写回 A[${insertIndex}]` : hole == null ? '' : `当前空位 A[${hole}]`, inserted);
      }
    }
    temp?.showStep(step);
    if (!stage) return;
    stage.render(step ? [heapFrame(step)] : [], options);
    const svg = heapPane.querySelector('svg');
    svg?.setAttribute('role', 'img');
    svg?.setAttribute('aria-label', '有效堆树');
    if (step) markHeapEdge(heapPane, step);
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
      cancelMotion?.();
      cancelMotion = undefined;
      const event = step?.event;
      const advancing = (insertion || merge) && view.getStep()?.stepIndex + 1 === step?.stepIndex &&
        !matchMedia('(prefers-reduced-motion: reduce)').matches;
      const transfer = advancing && merge ? mergeTransfer(step) : null;
      let origin;
      if (transfer) origin = event === 'pick' ? barAt(transfer.arrayIndex) : temp.reveal(transfer.tempIndex);
      else if (advancing && insertion && event === 'select') origin = barAt(step.variables.i);
      else if (advancing && insertion && event === 'insert') origin = held.value;
      const from = origin ? origin.getBoundingClientRect() : null;
      view.showStep(step);
      renderExtras(step);
      if (from && transfer) {
        const target = event === 'pick' ? temp.reveal(transfer.tempIndex) : barAt(transfer.arrayIndex);
        if (target) {
          const value = step.variables.temp[transfer.tempIndex];
          const width = Math.max(48, String(value).length * 8 + 12);
          const chip = box => ({ left: box.left + (box.width - width) / 2, top: box.top + (box.height - 30) / 2, width, height: 30 });
          cancelMotion = animateArrayValue(root, value, chip(from), chip(target.getBoundingClientRect()));
        }
      } else if (from) {
        const target = event === 'select' ? held.value : barAt(step.variables.insertIndex);
        if (target) {
          const motion = animateHeldValue(root, from, target);
          cancelMotion = () => motion.cancel();
        }
      }
    },
    getStep: view.getStep,
    playEnterAnimation() {
      cancelMotion?.();
      view.playEnterAnimation();
      stage?.clear();
      renderExtras(view.getStep());
    },
    destroy() {
      cancelMotion?.();
      observer?.disconnect();
      stage?.clear();
      view.destroy();
      root.remove();
    },
  };
}
