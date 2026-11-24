import { createStateTable as table } from './state-table.js';
import { countingSnapshot } from '../workbench/e-state.js';

function highlight(tableElement, indices) {
  for (const index of indices) {
    const row = tableElement.tBodies[0].rows[index];
    if (row) row.dataset.current = 'true';
  }
  return tableElement;
}

function indexedTable(title, values, indices = []) {
  return highlight(table(title, ['下标', '值'], values.map((value, index) => [index, value])), indices);
}

function radixTables(step) {
  const { tmp } = step.variables;
  const views = [indexedTable(step.done ? '排序结果' : '当前数组', step.array)];
  if (tmp) views.push(indexedTable('本轮回填', tmp));
  return views;
}

function countingTables(run, step, countInit) {
  const v = step.variables;
  const views = [indexedTable('输入数组', step.array)];
  const snapshot = countingSnapshot(run, step, countInit);
  if (snapshot) {
    const { min, counts, current: activeIndex } = snapshot;
    const countLength = counts.length;
    const size = Math.min(countLength, 21);
    const first = Math.max(0, Math.min(activeIndex - 10, countLength - size));
    const rows = Array.from({ length: size }, (_, offset) => {
      const index = first + offset;
      return [index, min + index, counts[index]];
    });
    const caption = size === countLength ? '计数表'
      : '计数表 · 显示下标 ' + first + '–' + (first + size - 1) + '（共 ' + countLength + ' 项）';
    const changed = v.countDiff ? [v.countDiff.index - first] : [];
    views.push(highlight(table(caption, ['下标', '对应数值', '当前计数'], rows), changed));
  }
  if (v.output || step.done) views.push(indexedTable('输出数组', v.output ?? step.result));
  return views;
}

export function createEStateTable(run, config) {
  const element = document.createElement('div');
  element.className = 'e-state-tables';
  const countInit = config.view === 'counting' ? run.steps.find(step => step.event === 'count_init') : null;
  const renderers = {
    radix: radixTables,
    counting: step => countingTables(run, step, countInit),
  };
  const render = renderers[config.view];
  let lastStep = null;
  return {
    element,
    showStep(step) {
      if (lastStep === step) return;
      element.replaceChildren(...render(step));
      lastStep = step;
    },
  };
}
