import { createStateTable as table } from './state-table.js';
import { countingSnapshot, linkedChain } from '../workbench/e-state.js';

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

function arrayTable(step) {
  const { length, src, dst } = step.variables;
  const rows = step.array.map((value, index) => [index, value, index < length ? '有效' : '超出逻辑长度']);
  return [highlight(table('顺序表 · 逻辑长度 ' + length, ['下标', '存储值', '逻辑状态'], rows), [src, dst])];
}

function listTables(step, previous) {
  const { nodes, headId, prevId, currId, nextId, fastId, slowId } = step.variables;
  const chain = linkedChain(step.variables);
  const chainIds = new Set(chain.map(node => node.id));
  const previousLinks = new Map(previous?.variables.nodes.map(node => [node.id, node.next]));
  const pointers = [[headId, '表头'], [prevId, '前驱'], [currId, '当前'], [nextId, '原后继'], [fastId, '快'], [slowId, '慢']];
  const rows = nodes.map(({ id, value, next }) => {
    const labels = pointers.filter(([target]) => target === id).map(([, name]) => name);
    return [id, value, next, labels.join('、') || '—', chainIds.has(id) ? '从表头可达' : '链外'];
  });
  const changed = nodes.flatMap(({ id, next }, index) => {
    const linkChanged = previous && (!previousLinks.has(id) || previousLinks.get(id) !== next);
    const target = pointers.slice(1).some(([target]) => target === id);
    const headChanged = previous && id === headId && previous.variables.headId !== headId;
    return linkChanged || target || headChanged ? [index] : [];
  });
  const details = [table('当前链表（从表头开始）', ['结点编号', '值'], chain.map(node => [node.id, node.value])),
    highlight(table('结点与链接', ['编号', '值', 'next 编号', '指针', '可达状态'], rows), changed)];
  if (step.done && step.algorithm === 'kth-from-end') {
    details.push(table('查找结果', ['结点编号', '值'], [[step.result.nodeId, step.result.value]]));
  }
  return details;
}

function tripleTable(title, triples, index) {
  return highlight(table(title, ['下标', '行', '列', '值'],
    triples.map(({ i, j, e }, offset) => [offset, i, j, e])), [index]);
}

function matrixTables(step, columnCounts) {
  const v = step.variables;
  const matrices = [tripleTable('原矩阵三元组 · ' + v.rows + ' × ' + v.cols, v.triples, v.k)];
  const num = v.num ?? (columnCounts?.stepIndex <= step.stepIndex ? columnCounts.variables.num : null);
  if (num) {
    matrices.push(highlight(table('按原列分配输出位置', ['原列', '三元组数量', '下一输出下标'],
      num.map((count, col) => [col, count, v.cpos?.[col] ?? '—'])), [v.col]));
  }
  if (v.out) matrices.push(tripleTable('转置输出 · ' + v.cols + ' × ' + v.rows, v.out, v.pos));
  return matrices;
}

function radixTables(step) {
  const { cnt, exp, tmp } = step.variables;
  const views = [indexedTable(step.done ? '排序结果' : '当前数组', step.array)];
  if (cnt) views.push(table('位权 ' + exp + ' 的计数表', ['数位', '计数'], cnt.map((value, index) => [index, value])));
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
  const columnCounts = config.view === 'matrix' ? run.steps.find(step => step.event === 'start_positions') : null;
  const renderers = {
    array: arrayTable,
    linked: step => listTables(step, run.steps[step.stepIndex - 1]),
    matrix: step => matrixTables(step, columnCounts),
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
