import { createStage } from '../../../vendor/plus/app/svg-stage.js';
import { gridLayer } from '../../../vendor/plus/vendor/engine/model.js';
import { createExplanationPanel } from './explanation-panel.js';
import { describeStructuredStep } from './structured-explanation.js';
import { compactLabel } from './trace-animation.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const tilePitch = 76;
const canvasInset = 24;

function createTileLane(title, emptyText, scrollAxis) {
  const element = document.createElement('div');
  element.className = 'e-matrix-lane';
  const heading = document.createElement('h3');
  heading.textContent = title;
  const track = document.createElement('div');
  track.className = 'e-matrix-track';
  track.setAttribute('role', 'region');
  track.setAttribute('aria-label', title);
  track.tabIndex = 0;
  const canvas = document.createElement('div');
  canvas.className = 'e-matrix-tiles';
  const empty = document.createElement('p');
  empty.className = 'e-matrix-empty';
  empty.textContent = emptyText;
  track.append(canvas, empty);
  element.append(heading, track);

  const stage = createStage(canvas, { fillViewport: true });
  let current;

  function render(animate) {
    if (!current) return;
    const { id, values, labels, focus, role, details } = current;
    if (scrollAxis === 'x') {
      canvas.style.width = (tilePitch * values.length + canvasInset) + 'px';
      canvas.style.height = '104px';
    } else {
      const cellsPerRow = Math.max(1, Math.floor((track.clientWidth - canvasInset) / tilePitch));
      const height = Math.ceil(values.length / cellsPerRow) * 76 + canvasInset;
      canvas.style.height = Math.max(track.clientHeight, height) + 'px';
    }
    stage.render([gridLayer({
      id, values: [values], cellLabels: labels,
      props: { indexedArray: true },
      roles: Number.isInteger(focus) ? { [role]: [focus] } : {},
    })], { animate });
    const svg = canvas.firstElementChild;
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', title);
    const tiles = svg.querySelectorAll('[data-avc-key^="g-"] rect');
    for (const [index, rect] of tiles.entries()) {
      let tooltip = rect.querySelector('title');
      if (!tooltip) {
        tooltip = document.createElementNS(SVG_NS, 'title');
        rect.append(tooltip);
      }
      tooltip.textContent = details[index];
    }

    const cell = tiles[focus];
    if (!cell) return;
    const view = track.getBoundingClientRect();
    const bounds = cell.getBoundingClientRect();
    if (scrollAxis === 'x') {
      if (bounds.left < view.left) track.scrollLeft += bounds.left - view.left - 8;
      else if (bounds.right > view.left + track.clientWidth) track.scrollLeft += bounds.right - view.left - track.clientWidth + 8;
    } else {
      if (bounds.top < view.top) track.scrollTop += bounds.top - view.top - 8;
      else if (bounds.bottom > view.top + track.clientHeight) track.scrollTop += bounds.bottom - view.top - track.clientHeight + 8;
    }
  }

  const observer = new ResizeObserver(() => render(false));
  observer.observe(track);
  return {
    element,
    show(frame) {
      const hasValues = frame.values.length > 0;
      current = hasValues ? frame : null;
      canvas.hidden = !hasValues;
      empty.hidden = hasValues;
      if (!hasValues) {
        stage.clear();
        return;
      }
      render(true);
    },
    resetScroll() { track.scrollTo(0, 0); },
    clear() { stage.clear(); },
    destroy() {
      observer.disconnect();
      stage.clear();
    },
  };
}

function tripleTiles(id, triples, focus, role) {
  return {
    id, focus, role,
    values: triples.map(triple => triple ? compactLabel(triple.e, 14) : '—'),
    labels: triples.map((triple, index) => triple ? compactLabel(`${index} · (${triple.i},${triple.j})`, 15) : String(index)),
    details: triples.map((triple, index) => triple ? `下标 ${index} · (${triple.i}, ${triple.j}, ${triple.e})` : `下标 ${index} · 等待写入`),
  };
}

function columnTiles(num, cpos, focus) {
  return {
    id: 'e-column-positions', focus, role: 'swap',
    values: num.map((count, index) => `${count} → ${cpos?.[index] ?? '—'}`),
    labels: num.map((_, index) => '原列 ' + index),
    details: num.map((count, index) => `原列 ${index} · 非零项数 ${count} · 下一写入下标 ${cpos?.[index] ?? '待分配'}`),
  };
}

export function createMatrixAnimation(host, explainHost, run, config) {
  const { rows, cols, triples } = run.input;
  const element = document.createElement('div');
  element.className = 'e-matrix-animation';
  element.dataset.vizEngine = 'plus-e';
  const input = createTileLane(`原三元组 · ${rows} × ${cols}`, '没有三元组', 'y');
  const output = createTileLane(`转置输出 · ${cols} × ${rows}`, '没有三元组', 'y');
  const arrow = document.createElement('span');
  arrow.className = 'e-matrix-direction';
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = '→';
  const columns = createTileLane('各列非零项数 → 下一写入下标', cols ? '等待列计数' : '没有可统计的列', 'x');
  columns.element.classList.add('e-matrix-columns');
  element.append(input.element, arrow, output.element, columns.element);
  host.append(element);

  const { explain, caption, status } = createExplanationPanel();
  explainHost.replaceChildren(explain);
  const startPositions = run.steps.find(step => step.event === 'start_positions');
  const emptySlots = triples.map(() => null);
  const lanes = [input, output, columns];
  let current = null;

  function render(step) {
    const { triples, k, out, pos, col, cpos } = step.variables;
    const num = step.variables.num ?? (startPositions?.stepIndex <= step.stepIndex ? startPositions.variables.num : []);
    input.show(tripleTiles('e-triples', triples, k, 'swap'));
    output.show(tripleTiles('e-transpose', (out ?? emptySlots).map(triple => triple?.i == null ? null : triple), pos, 'added'));
    columns.show(columnTiles(num, cpos, col));
    if (step.stepIndex === 0) lanes.forEach(lane => lane.resetScroll());
  }

  return {
    getStep: () => current,
    showStep(step) {
      current = step;
      render(step);
      caption.textContent = step.description;
      status.textContent = describeStructuredStep(run, step, config, 'e');
    },
    playEnterAnimation() {
      if (!current) return;
      lanes.forEach(lane => lane.clear());
      render(current);
    },
    destroy() {
      lanes.forEach(lane => lane.destroy());
      element.remove();
      explain.remove();
    },
  };
}
