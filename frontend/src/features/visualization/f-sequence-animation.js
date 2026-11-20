import { createStage } from '../../../vendor/plus/app/svg-stage.js';
import { gridLayer } from '../../../vendor/plus/vendor/engine/model.js';
import { createExplanationPanel } from './explanation-panel.js';
import { describeStructuredStep } from './structured-explanation.js';
import { compactLabel } from './trace-animation.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function createSequenceRow(id, title, emptyLabel) {
  const element = document.createElement('div');
  element.className = 'f-sequence-row';
  const heading = document.createElement('h3');
  heading.textContent = title;
  const track = document.createElement('div');
  track.className = 'f-sequence-track';
  track.tabIndex = 0;
  track.setAttribute('role', 'region');
  track.setAttribute('aria-label', title);
  const canvas = document.createElement('div');
  canvas.className = 'f-sequence-canvas';
  const empty = document.createElement('p');
  empty.className = 'f-sequence-empty';
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
      const labels = values.map(value => compactLabel(value, 10));
      const hasFocus = Number.isInteger(focus) && focus >= 0;
      // Leave enough width for the Plus array renderer to keep every cell on one row.
      canvas.style.width = (values.length * 76 + 24) + 'px';
      stage.render([gridLayer({
        id, values: [labels], cellLabels: indices,
        props: { indexedArray: true },
        roles: hasFocus && role ? { [role]: [focus] } : {},
      })]);
      const svg = canvas.firstElementChild;
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', title);
      values.forEach((value, index) => {
        if (value === labels[index]) return;
        const box = svg.querySelector(`[data-avc-key="g-${index}"] rect`);
        let tooltip = box.querySelector('title');
        if (!tooltip) {
          tooltip = document.createElementNS(SVG_NS, 'title');
          box.append(tooltip);
        }
        tooltip.textContent = value;
      });
      if (!hasFocus) return;
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

function createSequenceAnimation(host, explainHost, run, config, rows, render) {
  const element = document.createElement('div');
  element.dataset.vizEngine = 'plus-f';
  element.className = 'f-sequence-animation';
  element.append(...rows.map(row => row.element));
  host.append(element);

  const { explain, caption, status } = createExplanationPanel();
  explainHost.replaceChildren(explain);
  let current = null;

  return {
    getStep: () => current,
    showStep(step) {
      current = step;
      render(step);
      if (step.stepIndex === 0) rows.forEach(row => row.rewind());
      caption.textContent = step.description;
      status.textContent = describeStructuredStep(run, step, config, 'f');
    },
    playEnterAnimation() {
      if (!current) return;
      rows.forEach(row => row.clear());
      render(current);
    },
    destroy() {
      rows.forEach(row => row.clear());
      element.remove();
      explain.remove();
    },
  };
}

export function createBracketAnimation(host, explainHost, run, config, text) {
  const source = createSequenceRow('f-text', '原字符串', '字符串为空');
  const brackets = createSequenceRow('f-brackets', '括号栈（栈顶在右）', '栈为空');
  const indices = text.map((_, index) => index);
  return createSequenceAnimation(host, explainHost, run, config, [source, brackets], step => {
    const { i, stack } = step.variables;
    const error = step.done && !step.result.matched;
    source.show(text, indices, i, error ? 'swap' : 'focus1');
    brackets.show(stack.map(item => item.char), stack.map(item => item.i), stack.length - 1,
      step.lineId === 'unclosed' ? 'swap' : 'focus2');
  });
}

function showTokens(row, tokens, focus, role) {
  row.show(tokens.map(token => token.text), tokens.map(token => token.index), focus, role);
}

export function createInfixToPostfixAnimation(host, explainHost, run, config) {
  const source = createSequenceRow('f-infix', '中缀表达式', '表达式为空');
  const stack = createSequenceRow('f-operators', '运算符栈（栈顶在右）', '栈为空');
  const postfix = createSequenceRow('f-postfix', '后缀序列', '尚未输出词元');
  const expression = run.input.expression;
  // Group the original text for display. The trace determines the current token and the stack and output contents.
  const tokens = Array.from(expression.matchAll(/[0-9]+|[^ \t\r\n\f\v]/gu), match => ({ text: match[0], index: match.index }));
  return createSequenceAnimation(host, explainHost, run, config, [source, stack, postfix], step => {
    const { index, operators, output } = step.variables;
    const error = Boolean(step.result?.error);
    const visibleTokens = error && index === expression.length ? [...tokens, { text: '末尾', index }] : tokens;
    const focus = visibleTokens.findIndex(token => token.index === index);
    showTokens(source, visibleTokens, focus, error ? 'swap' : 'focus1');
    showTokens(stack, operators, operators.length - 1, 'focus2');
    const previousOutput = run.steps[step.stepIndex - 1]?.variables.output;
    const added = output.length > (previousOutput?.length ?? 0);
    showTokens(postfix, output, output.length - 1, added ? 'added' : undefined);
  });
}
