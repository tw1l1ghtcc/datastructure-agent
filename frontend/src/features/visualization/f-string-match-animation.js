import { createStage } from '../../../vendor/plus/app/svg-stage.js';
import { gridLayer } from '../../../vendor/plus/vendor/engine/model.js';
import { createExplanationPanel } from './explanation-panel.js';
import { describeStructuredStep } from './structured-explanation.js';

// The indexed-array renderer keeps one row at this pitch and inset.
const pitch = 76;
const inset = 24;
const cellCenter = 50;
const svgNamespace = 'http://www.w3.org/2000/svg';

function createTileStrip(id, title, size, emptyText) {
  const element = document.createElement('div');
  element.className = 'f-string-match-tiles';
  element.style.width = (size * pitch + inset) + 'px';
  if (!size && emptyText) {
    const empty = document.createElement('p');
    empty.className = 'f-string-match-empty';
    empty.textContent = emptyText;
    element.append(empty);
  }
  const stage = createStage(element, { fillViewport: true });
  return {
    element,
    show(values, roles, descriptions) {
      if (!values.length) return;
      stage.render([gridLayer({ id, values: [values], roles, props: { indexedArray: true } })]);
      const svg = element.firstElementChild;
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', title);
      for (const [index, description] of (descriptions ?? []).entries()) {
        const box = svg.querySelector(`[data-avc-key="g-${index}"] rect`);
        let tooltip = box.querySelector('title');
        if (!tooltip) {
          tooltip = document.createElementNS(svgNamespace, 'title');
          box.append(tooltip);
        }
        tooltip.textContent = description;
      }
    },
    clear() { stage.clear(); },
  };
}

function scrollTrack(label) {
  const track = document.createElement('div');
  track.className = 'f-string-match-track';
  track.tabIndex = 0;
  track.setAttribute('role', 'region');
  track.setAttribute('aria-label', label);
  return track;
}

function label(text) {
  const element = document.createElement('span');
  element.className = 'f-string-match-label';
  element.textContent = text;
  return element;
}

function reveal(track, index) {
  if (!Number.isInteger(index)) return;
  const left = 16 + index * pitch;
  const right = left + pitch;
  if (left < track.scrollLeft) track.scrollLeft = left - 8;
  else if (right > track.scrollLeft + track.clientWidth) track.scrollLeft = right - track.clientWidth + 8;
}

function alignment(step, before, patternLength) {
  const v = step.variables;
  const matchedAt = step.event === 'match' ? v.start : step.done ? v.matches.at(-1) : undefined;
  if (matchedAt != null && patternLength) return { offset: matchedAt, prefix: patternLength, focus: matchedAt + patternLength - 1 };
  const cursor = step.done ? before ?? v : v;
  const j = (step.event === 'fallback' || step.done) ? cursor.jump ?? cursor.j : cursor.j;
  if (!Number.isInteger(cursor.i)) return { offset: cursor.start ?? 0, prefix: 0, focus: cursor.k ?? cursor.start };
  return { offset: cursor.start ?? cursor.i - j, prefix: Math.max(0, j), i: cursor.i, j, focus: cursor.i };
}

function createJumpRow(mode, title, pattern) {
  const element = document.createElement('div');
  element.className = 'f-kmp-next';
  const track = scrollTrack(title);
  const tiles = createTileStrip('f-kmp-next', title, pattern.length, '没有跳转项');
  track.append(tiles.element);
  element.append(label(title), track);
  return {
    element,
    show(step) {
      const v = step.variables;
      const lookup = v.k ?? v.j;
      tiles.show(pattern.map((_, index) => v[mode][index] ?? '—'), {
        swap: Number.isInteger(lookup) && !step.done ? [lookup] : [],
        focus2: step.event === 'fallback' && v.jump >= 0 ? [v.jump] : [],
      }, pattern.map((char, index) => `${index} · ${char} · 前缀长度 ${v.prefix[index] ?? '—'} · next ${v.next[index] ?? '—'} · nextval ${v.nextval[index] ?? '—'}`));
      if (step.stepIndex === 0) track.scrollLeft = 0;
      else reveal(track, lookup);
    },
    clear: tiles.clear,
  };
}

export function createStringMatchAnimation(host, explainHost, run, config, text, pattern) {
  const kmp = run.algorithm === 'kmp';
  const id = kmp ? 'f-kmp' : 'f-naive';
  const element = document.createElement('div');
  element.className = 'f-string-match-animation';
  element.dataset.vizEngine = 'plus-f';
  const main = createTileStrip(id + '-text', '主串', text.length, '主串为空');
  const patternStrip = createTileStrip(id + '-pattern', '模式串', pattern.length, '模式串为空');
  const aligned = document.createElement('div');
  aligned.className = 'f-string-match-alignment';
  const labels = document.createElement('div');
  labels.className = 'f-string-match-row-labels';
  labels.append(label('主串'), label('模式串'));
  const track = scrollTrack('主串与模式串对齐');
  const strip = document.createElement('div');
  strip.className = 'f-string-match-strip';
  const connector = document.createElement('span');
  connector.className = 'f-string-match-connector';
  connector.setAttribute('aria-hidden', 'true');
  patternStrip.element.classList.add('f-string-match-pattern');
  strip.append(main.element, patternStrip.element, connector);
  track.append(strip);
  aligned.append(labels, track);

  const matches = document.createElement('div');
  matches.className = 'f-string-match-matches';
  element.append(aligned, matches);
  const strips = [main, patternStrip];
  let jumps;
  if (kmp) {
    const mode = run.input.mode ?? 'next';
    const title = config.modes.find(([value]) => value === mode)[1] + ' 数组';
    jumps = createJumpRow(mode, title, pattern);
    strips.push(jumps);
    element.append(jumps.element);
  }
  host.append(element);

  const { explain, caption, status } = createExplanationPanel();
  explainHost.replaceChildren(explain);
  let current = null;

  function render(step, slide) {
    const v = step.variables;
    const before = run.steps[step.stepIndex - 1]?.variables;
    const { offset, prefix, i, j, focus } = alignment(step, before, pattern.length);
    const comparing = i >= 0 && i < text.length && j >= 0 && j < pattern.length;
    const failed = v.equal === false;
    const known = Array.from({ length: prefix }, (_, index) => index);
    const mainCurrent = i >= 0 && i < text.length ? [i] : [];
    const patternCurrent = comparing ? [j] : Number.isInteger(v.k) ? [v.k] : [];
    main.show(text, { done: known.map(index => index + offset), [failed || step.event === 'fallback' ? 'swap' : 'focus1']: mainCurrent });
    patternStrip.show(pattern, { done: known, [failed ? 'swap' : 'focus1']: patternCurrent });
    strip.style.width = (Math.max(1, text.length, offset + pattern.length) * pitch + inset) + 'px';
    patternStrip.element.classList.toggle('is-sliding', slide);
    patternStrip.element.style.transform = `translateX(${offset * pitch}px)`;
    patternStrip.element.dataset.offset = String(offset);
    connector.hidden = !comparing;
    connector.style.left = (cellCenter + i * pitch) + 'px';
    connector.classList.toggle('is-mismatch', failed);

    jumps?.show(step);
    matches.textContent = '匹配起点' + (v.matches.length ? '  ' + v.matches.join('、') : '  暂无');
    matches.dataset.positions = v.matches.join(',');
    if (step.stepIndex === 0) track.scrollLeft = 0;
    else reveal(track, Math.min(focus ?? 0, Math.max(0, Math.max(text.length, offset + pattern.length) - 1)));
  }

  return {
    getStep: () => current,
    showStep(step) {
      const slide = current != null && Math.abs(step.stepIndex - current.stepIndex) === 1;
      current = step;
      render(step, slide);
      caption.textContent = step.description;
      status.textContent = describeStructuredStep(run, step, config, 'f');
    },
    playEnterAnimation() {
      if (!current) return;
      strips.forEach(row => row.clear());
      render(current, false);
    },
    destroy() {
      strips.forEach(row => row.clear());
      element.remove();
      explain.remove();
    },
  };
}
