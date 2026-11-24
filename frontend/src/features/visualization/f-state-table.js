import { stateText } from '../workbench/c-algorithms.js';

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

function outcome(value) {
  if (value?.error) return value.error;
  return '工期 ' + value.duration + (value.morePaths ? '，表中展示前 8 条关键路径' : '');
}

export function createCriticalPathStateTable(input) {
  const element = document.createElement('div');
  element.className = 'c-state-tables';
  return {
    element,
    showStep(step) {
      const views = criticalPathTables(input, step.variables);
      if (step.done) views.unshift(table('运行结果', ['结果'], [[outcome(step.result)]]));
      element.replaceChildren(...views);
    },
  };
}
