import { createStage } from '../../../vendor/plus/app/svg-stage.js';
import { gridLayer } from '../../../vendor/plus/vendor/engine/model.js';
import { createExplanationPanel } from './explanation-panel.js';
import { describeStructuredStep } from './structured-explanation.js';
import { compactLabel } from './trace-animation.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const OPERAND_HIGHLIGHT_MS = 320;

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
    show(values, indices, focus, role, highlighted = [focus]) {
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
        roles: hasFocus && role ? { [role]: highlighted } : {},
      })]);
      const svg = canvas.firstElementChild;
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', title);
      svg.querySelectorAll('rect > title').forEach(tooltip => tooltip.remove());
      values.forEach((value, index) => {
        if (value === labels[index]) return;
        const box = svg.querySelector(`[data-avc-key="g-${index}"] rect`);
        const tooltip = document.createElementNS(SVG_NS, 'title');
        tooltip.textContent = value;
        box.append(tooltip);
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
  let cancelAnimation;

  function draw(step) {
    cancelAnimation?.();
    cancelAnimation = render(step);
  }

  return {
    getStep: () => current,
    showStep(step) {
      current = step;
      draw(step);
      if (step.stepIndex === 0) rows.forEach(row => row.rewind());
      caption.textContent = step.description;
      status.textContent = describeStructuredStep(run, step, config, 'f');
    },
    playEnterAnimation() {
      if (!current) return;
      rows.forEach(row => row.clear());
      draw(current);
    },
    destroy() {
      cancelAnimation?.();
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

function expressionTokens(expression) {
  // Group the original text for display. The execution trace supplies the active index and computed values.
  return Array.from(expression.matchAll(/[0-9]+|[^ \t\r\n\f\v]/gu), match => ({ text: match[0], index: match.index }));
}

function showExpression(row, tokens, expressionLength, step) {
  const { index } = step.variables;
  const error = Boolean(step.result?.error);
  const visible = error && index === expressionLength ? [...tokens, { text: '末尾', index }] : tokens;
  showTokens(row, visible, visible.findIndex(token => token.index === index), error ? 'swap' : 'focus1');
}

function createConversionRows(expressionLength, tokens, postfix) {
  const source = createSequenceRow('f-infix', '中缀表达式', '表达式为空');
  const operators = createSequenceRow('f-operators', '运算符栈（栈顶在右）', '栈为空');
  return {
    source,
    operators,
    show(step, previous) {
      const v = step.variables;
      showExpression(source, tokens, expressionLength, step);
      showTokens(operators, v.operators, v.operators.length - 1, 'focus2');
      const added = v.output.length > (previous?.output.length ?? 0);
      showTokens(postfix, v.output, v.output.length - 1, added ? 'added' : undefined);
    },
  };
}

export function createInfixToPostfixAnimation(host, explainHost, run, config) {
  const postfix = createSequenceRow('f-postfix', '后缀序列', '尚未输出词元');
  const expression = run.input.expression;
  const conversion = createConversionRows(expression.length, expressionTokens(expression), postfix);
  return createSequenceAnimation(host, explainHost, run, config, [conversion.source, conversion.operators, postfix], step => {
    conversion.show(step, run.steps[step.stepIndex - 1]?.variables);
  });
}

function showOperands(row, step, previousStack) {
  const { stack } = step.variables;
  const final = step.lineId === 'done';
  const pushed = step.lineId === 'value-push' || step.lineId === 'compute';
  const role = final ? 'done' : pushed ? 'added' : 'focus2';
  const showResult = () => row.show(stack.map(String), stack.map((_, index) => final ? '最终结果' : index), stack.length - 1, role);

  if (step.lineId !== 'compute' || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    showResult();
    return;
  }
  const top = previousStack.length - 1;
  row.show(previousStack.map(String), previousStack.map((_, index) => index), top, 'swap', [top - 1, top]);
  const timer = setTimeout(showResult, OPERAND_HIGHLIGHT_MS);
  return () => clearTimeout(timer);
}

export function createExpressionEvaluationAnimation(host, explainHost, run, config) {
  const expression = run.input.expression;
  const tokens = expressionTokens(expression);
  const infix = run.input.mode !== 'postfix';
  const postfix = createSequenceRow('f-postfix', '后缀序列', infix ? '尚未输出词元' : '表达式为空');
  const operands = createSequenceRow('f-operands', '操作数栈（栈顶在右）', '栈为空');
  const conversion = infix ? createConversionRows(expression.length, tokens, postfix) : null;
  const evaluationStart = run.steps.findIndex(step => step.lineId === 'postfix');
  const rows = conversion ? [conversion.source, conversion.operators, postfix, operands] : [postfix, operands];

  return createSequenceAnimation(host, explainHost, run, config, rows, step => {
    const previous = run.steps[step.stepIndex - 1]?.variables;
    if (conversion) {
      const evaluating = evaluationStart >= 0 && step.stepIndex >= evaluationStart;
      conversion.operators.element.hidden = evaluating;
      operands.element.hidden = !evaluating;
      if (!evaluating) {
        operands.clear();
        conversion.show(step, previous);
        return;
      }
      conversion.operators.clear();
      showTokens(conversion.source, tokens);
    }
    showExpression(postfix, infix ? step.variables.output : tokens, expression.length, step);
    return showOperands(operands, step, previous?.stack);
  });
}
