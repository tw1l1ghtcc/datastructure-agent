import { createStage } from '../../../vendor/plus/app/svg-stage.js';
import { gridLayer } from '../../../vendor/plus/vendor/engine/model.js';
import { createExplanationPanel } from './explanation-panel.js';
import { describeStructuredStep } from './structured-explanation.js';

function createBracketRow(id, title, emptyLabel) {
  const element = document.createElement('div');
  element.className = 'f-bracket-row';
  const heading = document.createElement('h3');
  heading.textContent = title;
  const track = document.createElement('div');
  track.className = 'f-bracket-track';
  track.tabIndex = 0;
  track.setAttribute('role', 'region');
  track.setAttribute('aria-label', title);
  const canvas = document.createElement('div');
  canvas.className = 'f-bracket-canvas';
  const empty = document.createElement('p');
  empty.className = 'f-bracket-empty';
  empty.textContent = emptyLabel;
  track.append(canvas, empty);
  element.append(heading, track);
  const stage = createStage(canvas, { fillViewport: true });

  return {
    element,
    show(values, indices, focus, role) {
      const hasValues = values.length > 0;
      canvas.hidden = !hasValues;
      empty.hidden = hasValues;
      if (!hasValues) {
        stage.clear();
        return;
      }
      // Leave enough width for the Plus array renderer to keep every cell on one row.
      canvas.style.width = (values.length * 76 + 24) + 'px';
      stage.render([gridLayer({
        id, values: [values], cellLabels: indices,
        props: { indexedArray: true },
        roles: focus == null ? {} : { [role]: [focus] },
      })]);
      const svg = canvas.firstElementChild;
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', title);
      const cell = canvas.querySelector(`[data-avc-key="g-${focus}"] rect`);
      if (!cell) return;
      const { left, right } = cell.getBoundingClientRect();
      const inset = 12;
      const visibleLeft = track.getBoundingClientRect().left + inset;
      const visibleRight = visibleLeft + track.clientWidth - inset * 2;
      if (left < visibleLeft) track.scrollLeft += left - visibleLeft;
      else if (right > visibleRight) track.scrollLeft += right - visibleRight;
    },
    rewind: () => { track.scrollLeft = 0; },
    clear: () => stage.clear(),
  };
}

export function createBracketAnimation(host, explainHost, run, config, text) {
  const element = document.createElement('div');
  element.dataset.vizEngine = 'plus-f';
  element.className = 'f-bracket-animation';
  const source = createBracketRow('f-text', '原字符串', '字符串为空');
  const brackets = createBracketRow('f-brackets', '括号栈（栈顶在右）', '栈为空');
  const indices = text.map((_, index) => index);
  element.append(source.element, brackets.element);
  host.append(element);

  const { explain, caption, status } = createExplanationPanel();
  explainHost.replaceChildren(explain);
  let current = null;

  function render(step) {
    const { i, stack } = step.variables;
    const error = step.done && !step.result.matched;
    source.show(text, indices, i, error ? 'swap' : 'focus1');
    if (step.stepIndex === 0) source.rewind();
    brackets.show(stack.map(item => item.char), stack.map(item => item.i), stack.length - 1,
      step.event === 'unclosed' ? 'swap' : 'focus2');
  }

  return {
    getStep: () => current,
    showStep(step) {
      current = step;
      render(step);
      caption.textContent = step.description;
      status.textContent = describeStructuredStep(run, step, config, 'f');
    },
    playEnterAnimation() {
      if (!current) return;
      source.clear();
      brackets.clear();
      render(current);
    },
    destroy() {
      source.clear();
      brackets.clear();
      element.remove();
      explain.remove();
    },
  };
}
