import { createStage } from '../../../vendor/plus/app/svg-stage.js';
import { gridLayer } from '../../../vendor/plus/vendor/engine/model.js';
import { createExplanationPanel } from './explanation-panel.js';
import { describeStructuredStep } from './structured-explanation.js';

// The indexed-array renderer keeps one row at this pitch and inset.
const pitch = 76;
const inset = 24;
const cellCenter = 50;
const svgNamespace = 'http://www.w3.org/2000/svg';

function createTileStrip(id, title, size) {
  const element = document.createElement('div');
  element.className = 'f-kmp-tiles';
  element.style.width = (size * pitch + inset) + 'px';
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

function scrollTrack(className, label) {
  const track = document.createElement('div');
  track.className = className;
  track.tabIndex = 0;
  track.setAttribute('role', 'region');
  track.setAttribute('aria-label', label);
  return track;
}

function label(text) {
  const element = document.createElement('span');
  element.className = 'f-kmp-label';
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
  if (!Number.isInteger(cursor.i)) return { offset: 0, prefix: 0, focus: cursor.k };
  return { offset: cursor.i - j, prefix: Math.max(0, j), i: cursor.i, j, focus: cursor.i };
}

export function createKmpAnimation(host, explainHost, run, config, text, pattern) {
  const mode = run.input.mode ?? 'next';
  const title = config.modes.find(([value]) => value === mode)[1] + ' 数组';
  const element = document.createElement('div');
  element.className = 'f-kmp-animation';
  element.dataset.vizEngine = 'plus-f';
  const main = createTileStrip('f-kmp-text', '主串', text.length);
  const patternStrip = createTileStrip('f-kmp-pattern', '模式串', pattern.length);
  const jumps = createTileStrip('f-kmp-next', title, pattern.length);
  const aligned = document.createElement('div');
  aligned.className = 'f-kmp-alignment';
  const labels = document.createElement('div');
  labels.className = 'f-kmp-row-labels';
  labels.append(label('主串'), label('模式串'));
  const track = scrollTrack('f-kmp-track', '主串与模式串对齐');
  const strip = document.createElement('div');
  strip.className = 'f-kmp-strip';
  const connector = document.createElement('span');
  connector.className = 'f-kmp-connector';
  connector.setAttribute('aria-hidden', 'true');
  patternStrip.element.classList.add('f-kmp-pattern');
  strip.append(main.element, patternStrip.element, connector);
  track.append(strip);
  aligned.append(labels, track);

  const matches = document.createElement('div');
  matches.className = 'f-kmp-matches';
  const table = document.createElement('div');
  table.className = 'f-kmp-next';
  const jumpTrack = scrollTrack('f-kmp-track', title);
  const noPattern = label('模式串为空');
  noPattern.hidden = pattern.length > 0;
  jumpTrack.append(jumps.element, noPattern);
  table.append(label(title), jumpTrack);
  element.append(aligned, matches, table);
  host.append(element);

  const { explain, caption, status } = createExplanationPanel();
  explainHost.replaceChildren(explain);
  const strips = [main, patternStrip, jumps];
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

    const lookup = v.k ?? v.j;
    const fallback = step.event === 'fallback';
    jumps.show(pattern.map((_, index) => v[mode][index] ?? '—'), {
      swap: Number.isInteger(lookup) && !step.done ? [lookup] : [],
      focus2: fallback && v.jump >= 0 ? [v.jump] : [],
    }, pattern.map((char, index) => `${index} · ${char} · 前缀长度 ${v.prefix[index] ?? '—'} · next ${v.next[index] ?? '—'} · nextval ${v.nextval[index] ?? '—'}`));

    matches.textContent = '匹配起点' + (v.matches.length ? '  ' + v.matches.join('、') : '  暂无');
    matches.dataset.positions = v.matches.join(',');
    if (step.stepIndex === 0) {
      track.scrollLeft = 0;
      jumpTrack.scrollLeft = 0;
    } else {
      reveal(track, Math.min(focus ?? 0, Math.max(0, Math.max(text.length, offset + pattern.length) - 1)));
      reveal(jumpTrack, lookup);
    }
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
