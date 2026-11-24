import { createStage } from '../../../vendor/plus/app/svg-stage.js';
import { gridLayer } from '../../../vendor/plus/vendor/engine/model.js';
import { createExplanationPanel } from './explanation-panel.js';
import { describeStructuredStep } from './structured-explanation.js';

const display = value => value == null ? '—' : String(value);
const cellHeight = 28;

function createMatrixPane(title, emptyText, scrollAxis) {
  const element = document.createElement('div');
  element.className = 'e-matrix-pane';
  const heading = document.createElement('h3');
  heading.textContent = title;
  const track = document.createElement('div');
  track.className = 'e-matrix-track';
  track.setAttribute('role', 'region');
  track.setAttribute('aria-label', title);
  track.tabIndex = 0;
  const canvas = document.createElement('div');
  const empty = document.createElement('p');
  empty.className = 'e-matrix-empty';
  empty.textContent = emptyText;
  track.append(canvas, empty);
  element.append(heading, track);

  const stage = createStage(canvas, { fillViewport: true });
  let current;
  let activeCell;

  function render(animate) {
    if (!current) return;
    stage.render([current], { animate });
    const svg = canvas.firstElementChild;
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', title);
    const cell = svg.querySelector(`[data-avc-key="g-${activeCell}"] rect`);
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
    show(layer, focus) {
      current = layer;
      activeCell = focus;
      canvas.hidden = !layer;
      empty.hidden = Boolean(layer);
      if (!layer) {
        stage.clear();
        return;
      }
      canvas.style.minWidth = layer.props.canvasWidth + 'px';
      canvas.style.height = layer.props.canvasHeight + 'px';
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

function matrixGrid(id, values, colLabels, rowLabels, cellW, roles) {
  return gridLayer({
    id, values, colLabels, rowLabels, roles,
    props: {
      canvasWidth: 72 + (colLabels.length + 1) * cellW,
      canvasHeight: 68 + (values.length + 1) * cellHeight,
      cellW, cellH: cellHeight,
    },
  });
}

function tripleGrid(id, triples, index, role) {
  if (!triples.length) return null;
  const rows = triples.map(triple => [triple.i, triple.j, triple.e].map(display));
  const cellW = Math.max(46, ...rows.flat().map(text => text.length * 7 + 12));
  const marked = Number.isInteger(index) ? [0, 1, 2].map(column => index + ',' + column) : [];
  return matrixGrid(id, rows, ['行', '列', '值'], rows.map((_, offset) => String(offset)), cellW, { [role]: marked });
}

export function createMatrixAnimation(host, explainHost, run, config) {
  const { rows, cols, triples } = run.input;
  const element = document.createElement('div');
  element.className = 'e-matrix-animation';
  element.dataset.vizEngine = 'plus-e';
  const input = createMatrixPane(`原三元组 · ${rows} × ${cols}`, '没有三元组', 'y');
  const output = createMatrixPane(`转置输出 · ${cols} × ${rows}`, '没有三元组', 'y');
  const columns = createMatrixPane('按原列分配输出位置', cols ? '等待列计数' : '没有可统计的列', 'x');
  columns.element.classList.add('e-matrix-columns');
  element.append(input.element, output.element, columns.element);
  host.append(element);

  const { explain, caption, status } = createExplanationPanel();
  explainHost.replaceChildren(explain);
  const startPositions = run.steps.find(step => step.event === 'start_positions');
  const emptySlots = triples.map(() => ({ i: null, j: null, e: null }));
  const panes = [input, output, columns];
  let current = null;

  function render(step) {
    const { triples, k, out, pos, col, cpos } = step.variables;
    const num = step.variables.num ?? (startPositions?.stepIndex <= step.stepIndex ? startPositions.variables.num : null);
    input.show(tripleGrid('e-triples', triples, k, 'swap'), k + ',0');
    output.show(tripleGrid('e-transpose', out ?? emptySlots, pos, 'added'), pos + ',0');
    const highlighted = Number.isInteger(col) ? ['0,' + col, '1,' + col] : [];
    const columnGrid = num?.length ? matrixGrid('e-column-positions', [num, num.map((_, i) => display(cpos?.[i]))],
      num.map((_, i) => String(i)), ['非零项数', '下一下标'], 64, { swap: highlighted }) : null;
    columns.show(columnGrid, '0,' + col);
    if (step.stepIndex === 0) panes.forEach(pane => pane.resetScroll());
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
      panes.forEach(pane => pane.clear());
      render(current);
    },
    destroy() {
      panes.forEach(pane => pane.destroy());
      element.remove();
      explain.remove();
    },
  };
}
