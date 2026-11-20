import { createStage } from '../../../vendor/plus/app/svg-stage.js';
import { gridLayer } from '../../../vendor/plus/vendor/engine/model.js';
import { createExplanationPanel } from './explanation-panel.js';
import { describeStructuredStep } from './structured-explanation.js';

export function windowStart(length, size, focus = 0) {
  return Math.max(0, Math.min(focus - Math.floor(size / 2), length - size));
}

export function compactLabel(value, limit = 16) {
  if (value == null) return '—';
  const characters = Array.from(String(value));
  return characters.length > limit ? characters.slice(0, limit - 1).join('') + '…' : characters.join('');
}

export function sequenceLayer(id, title, values, roles = {}, { first, indexBase = 0 } = {}) {
  const size = 10;
  const focus = Object.values(roles).flat().find(index => Number.isInteger(index));
  const start = first ?? windowStart(values.length, size, focus);
  const visible = values.slice(start, start + size).map(value => compactLabel(value));
  const indices = visible.map((_, index) => start + index + indexBase);
  const cellW = Math.max(30, ...visible.map(label => label.length * 9 + 12),
    ...indices.map(index => String(index).length * 7 + 12));
  const cellRoles = Object.fromEntries(Object.entries(roles).map(([role, positions]) =>
    [role, positions.filter(Number.isInteger).map(index => '0,' + (index - start))]));
  const range = values.length > size ? ` · ${indices[0]}–${indices.at(-1)}` : '';
  return gridLayer({
    id, title: title + range, values: visible.length ? [visible] : [],
    colLabels: indices.map(String), rowLabels: ['值'], roles: cellRoles,
    props: { canvasWidth: Math.max(320, 72 + cellW * (visible.length + 1)), canvasHeight: 146, cellW, cellH: 28 },
  });
}

export function createTraceAnimation(host, explainHost, stateTable, frameFor, packageId, { run, config }) {
  const element = document.createElement('div');
  element.dataset.vizEngine = 'plus-' + packageId;
  const canvas = document.createElement('div');
  canvas.className = 'plus-viz trace-animation-stage';
  element.append(canvas, stateTable.element);
  host.append(element);

  const stage = createStage(canvas);
  const { explain, caption, status } = createExplanationPanel();
  explainHost.replaceChildren(explain);
  let current = null;

  function render(step) {
    const layers = frameFor(step);
    stage.render(layers);
    const titleById = new Map(layers.map(layer => [layer.id, layer.title]));
    for (const svg of canvas.querySelectorAll('.avc-svg')) {
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', titleById.get(svg.dataset.avcSvg));
    }
  }

  return {
    getStep: () => current,
    showStep(step) {
      current = step;
      render(step);
      stateTable.showStep(step);
      caption.textContent = step.description;
      status.textContent = describeStructuredStep(run, step, config, packageId);
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
