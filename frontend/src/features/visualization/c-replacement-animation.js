import { animateArrayValue, arrayAnimationPitch, createArrayAnimationRow, createArrayAnimationRows } from './array-animation-row.js';
import { createExplanationPanel } from './explanation-panel.js';
import { describeStructuredStep } from './structured-explanation.js';

function transfers(step, previous) {
  const { active, selected, incoming, currentRun } = step.variables;
  switch (step.event) {
    case 'load':
      return active.map((item, index) => ({
        value: item.value, from: 'input', source: item.index, to: 'active', destination: index,
      }));
    case 'freeze':
    case 'activate': {
      const to = step.event === 'freeze' ? 'frozen' : 'active';
      const destination = step.variables[to].findIndex(item => item.index === incoming.index);
      return [{ value: incoming.value, from: 'input', source: incoming.index, to, destination }];
    }
    case 'output':
      return [{ value: selected.value, from: 'active', source: 0, to: 'output', destination: currentRun.length - 1 }];
    case 'new-run': {
      const original = new Map(previous.variables.frozen.map((item, index) => [item.index, index]));
      return active.map((item, index) => ({
        value: item.value, from: 'frozen', source: original.get(item.index), to: 'active', destination: index,
      }));
    }
    default:
      return [];
  }
}

function bufferFrame(title, detail, items, incoming, roles) {
  const added = items.findIndex(item => item.index === incoming?.index);
  return {
    title, detail,
    values: items.map(item => item.value),
    labels: items.map(item => '#' + item.index),
    emptyText: '空',
    focus: added >= 0 ? added : items.length ? 0 : null,
    roles: { ...roles, swap: added >= 0 ? [added] : [] },
  };
}

export function createReplacementAnimation(host, run, config, explainHost) {
  const pitch = arrayAnimationPitch(run.input.array);
  const element = document.createElement('div');
  element.className = 'c-replacement-selection';
  element.dataset.vizEngine = 'plus-c';
  const rows = {
    input: createArrayAnimationRow('c-replacement-input', pitch),
    active: createArrayAnimationRow('c-active', pitch),
    frozen: createArrayAnimationRow('c-frozen', pitch),
    output: createArrayAnimationRow('c-current-run', pitch),
  };
  const buffers = document.createElement('div');
  buffers.className = 'c-replacement-buffers';
  buffers.append(rows.active.element, rows.frozen.element);
  const completedPanel = document.createElement('div');
  completedPanel.className = 'c-replacement-completed';
  completedPanel.setAttribute('role', 'region');
  completedPanel.setAttribute('aria-label', '已完成的有序段');
  completedPanel.tabIndex = 0;
  const completed = createArrayAnimationRows(completedPanel, 'c-replacement-result-', pitch);
  const emptyResult = document.createElement('p');
  emptyResult.className = 'array-animation-empty';
  emptyResult.textContent = '没有生成有序段';
  element.append(rows.input.element, buffers, rows.output.element, completedPanel, emptyResult);
  host.append(element);

  const { explain, caption, status } = createExplanationPanel();
  explainHost.replaceChildren(explain);
  let current = null;
  let movements = [];

  function draw(step) {
    const { array, readIndex, active, frozen, currentRun, runs, runIndex, incoming } = step.variables;
    const cursor = readIndex < array.length ? readIndex : null;
    const reading = incoming?.index;
    const writing = step.event === 'output';
    const unfreezing = step.event === 'new-run';
    const destination = currentRun.length - 1;
    element.dataset.finished = String(step.done);
    buffers.hidden = step.done;
    rows.output.element.hidden = step.done;
    emptyResult.hidden = !step.done || runs.length > 0;

    rows.input.show({
      title: '输入流', detail: cursor == null ? (array.length ? '已读完' : '') : '下一读取下标 ' + cursor,
      values: array, focus: reading ?? cursor,
      roles: {
        excluded: Array.from({ length: readIndex }, (_, index) => index),
        focus2: cursor == null ? [] : [cursor],
        swap: reading == null ? [] : [reading],
      },
      emptyText: '没有输入',
    });
    if (!step.done) {
      const activeDetail = active.length
        ? `${active.length} 项 · 最小值 ${active[0].value}`
        : '暂无可输出项';
      rows.active.show(bufferFrame('活动区', unfreezing ? '已解冻，开始新段' : activeDetail,
        active, incoming, unfreezing ? { added: active.map((_, index) => index) } : { focus2: active.length && !incoming ? [0] : [] }));
      rows.frozen.show(bufferFrame('冻结区', frozen.length ? frozen.length + ' 项 · 留到下一段' : '',
        frozen, incoming, {}));
      rows.output.show({
        title: '当前输出段 ' + runIndex,
        detail: writing ? `来自原下标 #${step.variables.selected.index}` : '',
        values: currentRun, focus: destination >= 0 ? destination : null,
        roles: writing ? { added: [destination] } : {},
        emptyText: '尚未输出',
      });
    } else {
      rows.active.clear();
      rows.frozen.clear();
      rows.output.clear();
    }
    completed.show(runs.map((values, index) => ({ title: '已完成段 ' + index, values })));
    if (step.event === 'run-end' || step.done) completedPanel.scrollTop = completedPanel.scrollHeight;
    if (step.stepIndex === 0) Object.values(rows).forEach(row => row.rewind());
  }

  function stopMovements() {
    movements.forEach(cancel => cancel());
    movements = [];
  }

  function showStep(step) {
    stopMovements();
    const advancing = current?.stepIndex + 1 === step.stepIndex && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    const origins = advancing ? transfers(step, current).flatMap(transfer => {
      const start = rows[transfer.from].visibleCell(transfer.source);
      return start ? [{ ...transfer, start }] : [];
    }) : [];
    current = step;
    draw(step);
    movements = origins.flatMap(({ value, start, to, destination }) => {
      const end = rows[to].visibleCell(destination);
      return end ? [animateArrayValue(element, value, start, end)] : [];
    });
    caption.textContent = step.description;
    status.textContent = describeStructuredStep(run, step, config, 'c');
  }

  function clear() {
    stopMovements();
    Object.values(rows).forEach(row => row.clear());
    completed.clear();
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
