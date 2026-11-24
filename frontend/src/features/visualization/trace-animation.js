import { createStage } from '../../../vendor/plus/app/svg-stage.js';
import { gridLayer } from '../../../vendor/plus/vendor/engine/model.js';
import { createExplanationPanel } from './explanation-panel.js';
import { describeStructuredStep } from './structured-explanation.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

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

export function indexedCard(id, title, values, roles = {}, cellLabels) {
  return gridLayer({
    id, title, values: [values], roles, cellLabels,
    props: { indexedArray: true, canvasWidth: 320, canvasHeight: Math.max(130, Math.ceil(values.length / 4) * 44 + 24) },
  });
}

export function createTraceAnimation(host, explainHost, stateTable, frameFor, packageId, { run, config, fillViewport = false }) {
  const element = document.createElement('div');
  element.dataset.vizEngine = 'plus-' + packageId;
  element.classList.toggle('trace-animation-full', fillViewport);
  const split = fillViewport && stateTable;
  const canvas = document.createElement('div');
  canvas.className = 'plus-viz trace-animation-stage';
  let viewport = canvas;
  if (split) {
    element.classList.add('trace-animation-split');
    const state = document.createElement('div');
    state.className = 'trace-animation-state';
    state.setAttribute('role', 'region');
    state.setAttribute('aria-label', '遍历状态');
    state.tabIndex = 0;
    state.append(stateTable.element);
    viewport = document.createElement('div');
    viewport.className = 'trace-animation-viewport';
    viewport.setAttribute('role', 'region');
    viewport.setAttribute('aria-label', '二叉树画布');
    viewport.tabIndex = 0;
    viewport.append(canvas);
    element.append(state, viewport);
  } else {
    element.append(canvas);
    if (stateTable) element.append(stateTable.element);
  }
  host.append(element);

  const stage = createStage(canvas, { fillViewport });
  const { explain, caption, status } = createExplanationPanel();
  explainHost.replaceChildren(explain);
  let current = null;

  function render(step, options) {
    const layers = frameFor(step);
    if (split) {
      const { canvasWidth, canvasHeight } = layers[0].props;
      canvas.style.minWidth = canvasWidth + 'px';
      canvas.style.minHeight = canvasHeight + 'px';
    }
    stage.render(layers, options);
    const byId = new Map(layers.map(layer => [layer.id, layer]));
    for (const svg of canvas.querySelectorAll('.avc-svg')) {
      const layer = byId.get(svg.dataset.avcSvg);
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', layer.title);
      for (const { id, fullLabel } of layer.data.nodes ?? []) {
        if (!fullLabel) continue;
        const circle = svg.querySelector(`[data-avc-key="n-${id}"] circle`);
        if (!circle) continue;
        let title = circle.querySelector('title');
        if (!title) {
          title = document.createElementNS(SVG_NS, 'title');
          circle.append(title);
        }
        title.textContent = fullLabel;
      }
    }
  }
  const observer = fillViewport ? new ResizeObserver(() => {
    if (current) render(current, { animate: false });
  }) : null;
  observer?.observe(viewport);

  return {
    getStep: () => current,
    showStep(step) {
      current = step;
      render(step);
      stateTable?.showStep(step);
      caption.textContent = step.description;
      status.textContent = describeStructuredStep(run, step, config, packageId);
    },
    playEnterAnimation() {
      if (!current) return;
      stage.clear();
      render(current);
    },
    destroy() {
      observer?.disconnect();
      stage.clear();
      element.remove();
      explain.remove();
    },
  };
}
