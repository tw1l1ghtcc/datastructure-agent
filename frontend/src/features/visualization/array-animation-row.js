import { createStage } from '../../../vendor/plus/app/svg-stage.js';
import { gridLayer } from '../../../vendor/plus/vendor/engine/model.js';

const canvasInset = 24;

export function arrayAnimationPitch(values) {
  return Math.max(76, ...values.map(value => String(value).length * 8 + 20));
}

export function createArrayAnimationRow(id, cellPitch = 76) {
  const element = document.createElement('div');
  element.className = 'array-animation-row';
  const label = document.createElement('div');
  label.className = 'array-animation-label';
  const heading = document.createElement('h3');
  const note = document.createElement('p');
  label.append(heading, note);
  const track = document.createElement('div');
  track.className = 'array-animation-track';
  track.setAttribute('role', 'region');
  track.tabIndex = 0;
  const canvas = document.createElement('div');
  canvas.className = 'array-animation-tiles';
  const empty = document.createElement('p');
  empty.className = 'array-animation-empty';
  track.append(canvas, empty);
  element.append(label, track);
  const stage = createStage(canvas, { fillViewport: true });
  const cell = index => canvas.querySelector(`[data-avc-key="g-${index}"] rect`);

  return {
    element,
    visibleCell(index) {
      const bounds = cell(index)?.getBoundingClientRect();
      if (!bounds?.width) return null;
      const left = track.getBoundingClientRect().left;
      return bounds.left >= left - 1 && bounds.right <= left + track.clientWidth + 1 ? bounds : null;
    },
    show({ title, detail = '', values = [], fullValues, labels, focus, roles, emptyText = '等待处理' }) {
      heading.textContent = title;
      note.textContent = detail;
      track.setAttribute('aria-label', title);
      empty.hidden = Boolean(values.length);
      canvas.hidden = !values.length;
      if (!values.length) {
        empty.textContent = emptyText;
        stage.clear();
        return;
      }

      canvas.style.width = (values.length * cellPitch + canvasInset) + 'px';
      stage.render([gridLayer({
        id, values: [Array.from(values, value => value ?? '—')], cellLabels: labels,
        roles, props: { indexedArray: true },
      })]);
      const svg = canvas.firstElementChild;
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', title);
      fullValues?.forEach((value, index) => {
        const box = cell(index);
        let tooltip = box?.querySelector('title');
        if (value == null || value === values[index]) {
          tooltip?.remove();
          return;
        }
        if (!tooltip && box) {
          tooltip = document.createElementNS('http://www.w3.org/2000/svg', 'title');
          box.append(tooltip);
        }
        if (tooltip) tooltip.textContent = value;
      });
      if (focus == null) return;
      const focusedCell = cell(focus);
      if (!focusedCell) return;
      const { left, right } = focusedCell.getBoundingClientRect();
      const bounds = track.getBoundingClientRect();
      const inset = 8;
      if (left < bounds.left + inset) track.scrollLeft += left - bounds.left - inset;
      else if (right > bounds.left + track.clientWidth - inset) track.scrollLeft += right - bounds.left - track.clientWidth + inset;
    },
    clear() { stage.clear(); },
    rewind() { track.scrollLeft = 0; },
  };
}

export function createArrayAnimationRows(panel, prefix, pitch) {
  const rows = [];
  return {
    show(frames) {
      while (rows.length > frames.length) {
        const row = rows.pop();
        row.clear();
        row.element.remove();
      }
      frames.forEach((frame, index) => {
        if (!rows[index]) {
          rows[index] = createArrayAnimationRow(prefix + index, pitch);
          panel.append(rows[index].element);
        }
        rows[index].show(frame);
      });
      panel.hidden = !frames.length;
    },
    get(index) { return rows[index]; },
    clear() { rows.forEach(row => row.clear()); },
  };
}

export function animateArrayValue(host, value, from, to) {
  const bounds = host.getBoundingClientRect();
  const tile = document.createElement('span');
  tile.className = 'array-animation-moving-value';
  tile.setAttribute('aria-hidden', 'true');
  tile.textContent = value;
  Object.assign(tile.style, {
    left: from.left - bounds.left + 'px',
    top: from.top - bounds.top + 'px',
    width: from.width + 'px',
    height: from.height + 'px',
  });
  host.append(tile);
  const animation = tile.animate([
    { transform: 'translate(0, 0)', opacity: 1 },
    { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px)`, opacity: 0.8 },
  ], { duration: 260, easing: 'ease-in-out' });
  const remove = () => tile.remove();
  animation.finished.then(remove, remove);
  return () => {
    animation.cancel();
    remove();
  };
}
