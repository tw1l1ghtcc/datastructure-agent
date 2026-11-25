import { animateArrayValue, arrayAnimationPitch, createArrayAnimationRow, createArrayAnimationRows } from './array-animation-row.js';
import { createExplanationPanel } from './explanation-panel.js';
import { describeStructuredStep } from './structured-explanation.js';

function inputFrames(step) {
  if (step.done) return [];
  const { runs, group, groupStart, positions, selected } = step.variables;
  return runs.map((values, index) => {
    const position = group ? positions[index - groupStart] : null;
    const active = position != null;
    const consumed = active ? position : group && index < groupStart ? values.length : 0;
    const focus = active && position < values.length ? position : null;
    const source = selected?.run === index ? selected.index : null;
    let detail = '';
    if (active) detail = focus == null ? '已读完' : `游标在下标 ${position}`;
    else if (group) detail = index < groupStart ? '本趟已归并' : '等待归并';
    else if (step.event === 'pass-end') detail = '本趟生成';
    return {
      title: '段 ' + index, values, detail, focus: focus ?? source,
      emptyText: '空段',
      roles: {
        excluded: Array.from({ length: consumed }, (_, index) => index),
        focus2: focus == null || focus === source ? [] : [focus],
        swap: source == null ? [] : [source],
      },
    };
  });
}

function revealRow(panel, row) {
  const viewport = panel.getBoundingClientRect();
  const bounds = row.element.getBoundingClientRect();
  if (bounds.top < viewport.top) panel.scrollTop += bounds.top - viewport.top;
  else if (bounds.bottom > viewport.top + panel.clientHeight) {
    panel.scrollTop += bounds.bottom - viewport.top - panel.clientHeight;
  }
}

export function createMultiwayAnimation(host, run, config, explainHost) {
  const pitch = arrayAnimationPitch(run.input.runs.flat());
  const element = document.createElement('div');
  element.className = 'c-multiway-merge';
  element.dataset.vizEngine = 'plus-c';
  const inputPanel = document.createElement('div');
  inputPanel.className = 'c-merge-inputs';
  const completedPanel = document.createElement('div');
  completedPanel.className = 'c-merge-completed';
  for (const [panel, label] of [[inputPanel, '本趟有序段'], [completedPanel, '本趟已生成段']]) {
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', label);
    panel.tabIndex = 0;
  }
  const inputs = createArrayAnimationRows(inputPanel, 'c-input-', pitch);
  const completed = createArrayAnimationRows(completedPanel, 'c-generated-', pitch);
  const output = createArrayAnimationRow('c-output', pitch);
  output.element.classList.add('c-merge-output');
  element.append(inputPanel, completedPanel, output.element);
  host.append(element);
  const { explain, caption, status } = createExplanationPanel();
  explainHost.replaceChildren(explain);
  let current = null;
  let cancelMove;

  function draw(step) {
    const v = step.variables;
    inputs.show(inputFrames(step));
    if (!v.group) inputPanel.scrollTop = 0;
    completed.show((step.event === 'run-end' ? v.producedRuns.slice(0, -1) : v.producedRuns ?? [])
      .map((values, index) => ({ title: '已生成段 ' + index, values })));
    const last = v.output.length - 1;
    const writing = step.event === 'output';
    output.show({
      title: step.done ? '归并结果' : '本批输出',
      detail: writing ? `写入下标 ${last}` : step.event === 'run-end' ? '本批归并完成' : '',
      values: v.output, focus: last >= 0 ? last : null,
      roles: writing ? { added: [last] } : {},
      emptyText: step.done ? '没有元素' : '尚未输出',
    });
    if (v.selected) revealRow(inputPanel, inputs.get(v.selected.run));
    if (step.stepIndex === 0) output.rewind();
  }

  function showStep(step) {
    cancelMove?.();
    cancelMove = undefined;
    const { selected } = step.variables;
    const movingForward = step.event === 'output' && current?.event === 'select' && current.stepIndex + 1 === step.stepIndex;
    const origin = movingForward && !matchMedia('(prefers-reduced-motion: reduce)').matches
      ? inputs.get(selected.run)?.visibleCell(selected.index) : null;
    current = step;
    draw(step);
    const target = origin && output.visibleCell(step.variables.output.length - 1);
    if (target) cancelMove = animateArrayValue(element, selected.value, origin, target);
    caption.textContent = step.description;
    status.textContent = describeStructuredStep(run, step, config, 'c');
  }

  function clear() {
    cancelMove?.();
    cancelMove = undefined;
    inputs.clear();
    completed.clear();
    output.clear();
  }

  return {
    getStep: () => current,
    showStep,
    playEnterAnimation() {
      if (!current) return;
      clear();
      draw(current);
    },
    destroy() {
      clear();
      element.remove();
      explain.remove();
    },
  };
}
