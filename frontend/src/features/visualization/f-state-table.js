import { stateText } from '../workbench/c-algorithms.js';
import { createArrayAnimationRow } from './array-animation-row.js';
import { compactLabel } from './trace-animation.js';

function table(caption, headers, rows, selected = () => false) {
  const element = document.createElement('table');
  element.className = 'uf-table';
  element.createCaption().textContent = caption;
  const head = element.createTHead().insertRow();
  for (const label of headers) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = label;
    head.append(th);
  }
  const body = element.createTBody();
  rows.forEach((values, index) => {
    const row = body.insertRow();
    row.dataset.current = String(selected(index));
    for (const value of values) row.insertCell().textContent = stateText(value);
  });
  return element;
}

const edgeText = edge => edge[0] + ' → ' + edge[1] + '（' + edge[2] + '）';

function criticalPathTables(input, v) {
  const rows = input.edges.map(([from, to, weight], index) => [
    from, to, weight, v.slack[index]?.float, v.criticalEdges.includes(index) ? '是' : '—',
  ]);
  const tables = [table('活动时差与关键边', ['起点', '终点', '工期', '时差', '关键'], rows, index => index === v.activityIndex)];
  if (v.criticalPaths) tables.unshift(table('关键路径', ['活动顺序'], v.criticalPaths.map(path => [path.map(edgeText).join('，')])));
  return tables;
}

export function createCriticalPathState(input) {
  const element = document.createElement('div');
  element.className = 'f-graph-state f-critical-state';
  const queue = createArrayAnimationRow('f-queue');
  const order = createArrayAnimationRow('f-order');
  const tables = document.createElement('div');
  tables.className = 'c-state-tables f-critical-tables';
  tables.tabIndex = 0;
  tables.setAttribute('role', 'region');
  tables.setAttribute('aria-label', '活动时差与关键路径');
  element.append(queue.element, order.element, tables);
  let pathListVisible = false;
  return {
    element,
    label: '拓扑队列与活动时差',
    canvasLabel: '关键路径活动网络画布',
    showStep(step) {
      const v = step.variables;
      if (!step.stepIndex) {
        queue.rewind();
        order.rewind();
      }
      queue.show({ title: '零入度队列', detail: '队首在左', values: v.queue.map(id => compactLabel(id, 8)),
        fullValues: v.queue, roles: { focus2: 0 }, focus: 0, emptyText: '队列为空' });
      order.show({ title: '拓扑序', values: v.order.map(id => compactLabel(id, 8)), fullValues: v.order,
        roles: { added: step.event === 'visit' ? v.order.length - 1 : null }, focus: v.order.length - 1, emptyText: '尚未输出事件' });
      tables.replaceChildren(...criticalPathTables(input, v));
      if (!step.stepIndex || Boolean(v.criticalPaths) !== pathListVisible) tables.scrollTop = 0;
      pathListVisible = Boolean(v.criticalPaths);
      const active = tables.querySelector('tr[data-current="true"]');
      if (active) {
        const frame = tables.getBoundingClientRect();
        const row = active.getBoundingClientRect();
        if (row.top < frame.top + 30 || row.bottom > frame.top + tables.clientHeight) {
          tables.scrollTop += row.top - frame.top - 34;
        }
      }
    },
    destroy() { queue.clear(); order.clear(); },
  };
}

export function createExpressionDagState(run) {
  const element = document.createElement('div');
  element.className = 'f-graph-state';
  const operators = createArrayAnimationRow('f-operators');
  const postfix = createArrayAnimationRow('f-postfix');
  const stack = createArrayAnimationRow('f-build-stack');
  element.append(operators.element, postfix.element, stack.element);
  return {
    element,
    label: '表达式转换和构图状态',
    canvasLabel: '表达式依赖图画布',
    showStep(step) {
      const v = step.variables;
      const previous = run.steps[step.stepIndex - 1]?.variables;
      const last = v.output.length - 1;
      const appended = v.output.length > (previous?.output.length ?? 0);
      if (!step.stepIndex) [operators, postfix, stack].forEach(row => row.rewind());
      operators.show({ title: '运算符栈', detail: '栈顶在右', values: v.operators.map(token => token.text),
        labels: v.operators.map(token => token.index), roles: { focus2: v.operators.length - 1 },
        focus: v.operators.length - 1, emptyText: '栈为空' });
      postfix.show({ title: '后缀序列', detail: '格下为原下标', values: v.output.map(token => token.text),
        labels: v.output.map(token => token.index), focus: last,
        roles: { added: appended ? last : null }, emptyText: '尚未输出词元' });
      stack.show({ title: '构图栈', detail: '格内为结点编号，栈顶在右', values: v.stack,
        roles: { focus2: v.stack.length - 1 }, focus: v.stack.length - 1, emptyText: '栈为空' });
    },
    destroy() { [operators, postfix, stack].forEach(row => row.clear()); },
  };
}
