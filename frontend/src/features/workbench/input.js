import { eAlgorithm, validEStep, validateEInput } from './e-algorithms.js';
import { gAlgorithm } from './g-algorithms.js';
import { dataAlgorithm as cAlgorithm } from './data-algorithms.js';
import { arraySearch, arraySearchMaxElements } from './array-search.js';
import { graphAlgorithm } from './graph-algorithms.js';

function integer(text, label) {
  if (!/^[+-]?\d+$/.test(text) || !Number.isSafeInteger(Number(text))) throw new Error(`${label}必须为十进制安全整数。`);
  return Number(text);
}
function parseArray(arrayText, limit) {
  const text = arrayText.trim();
  const values = text ? text.split(/[,，]/).map(value => value.trim()) : [];
  if (values.length > limit) throw new Error(`数组最多包含 ${limit} 个元素。`);
  return values.map(value => integer(value, '数组元素'));
}

export function parseInput(arrayText, targetText, algorithm = 'binary-search') {
  const sortAlgorithms = ['bubble-sort', 'insertion-sort', 'binary-insertion-sort', 'shell-sort', 'selection-sort', 'quick-sort', 'heap-sort', 'merge-sort'];
  if (sortAlgorithms.includes(algorithm)) return { array: parseArray(arrayText, 24) };
  
  if (algorithm === 'custom-array') {
    const array = parseArray(arrayText, 24);
    if (array.some(value => value < -2147483648 || value > 2147483647)) throw new Error('自定义代码使用 32 位整数。');
    return { array };
  }
  
  const targetValue = targetText.trim();
  if (!targetValue) throw new Error('目标不能为空。');
  const target = integer(targetValue, '目标');
  
  if (algorithm === 'block-search') {
    const blocks = arrayText.trim() ? arrayText.split(/[;；]/).map(block => parseArray(block, arraySearchMaxElements)) : [];
    if (blocks.length > 64) throw new Error('最多输入 64 个块。');
    if (blocks.reduce((size, block) => size + block.length, 0) > arraySearchMaxElements) throw new Error('所有块合计最多包含 100 个元素。');
    return { blocks, target };
  }
  
  const array = parseArray(arrayText, arraySearchMaxElements);
  if (algorithm === 'linear-search') return { array, target };
  if (array.some((value,i) => i > 0 && value < array[i-1])) throw new Error('数组必须按非递减顺序排列，请勿自动排序或去重。');
  return { array, target };
}

function isIntOrNull(v) { return v === null || Number.isInteger(v); }

function validateSortVariables(step, algorithm) {
  const v = step.variables;
  const len = step.array.length;
  const isInit = step.event === 'init' || step.event === 'sorted' || len === 0;

  if (algorithm === 'insertion-sort') {
    return isIntOrNull(v.i) && isIntOrNull(v.j) && isIntOrNull(v.temp) && isIntOrNull(v.insertIndex);
  }
  if (algorithm === 'binary-insertion-sort') {
    return isIntOrNull(v.i) && isIntOrNull(v.left) && isIntOrNull(v.right) && isIntOrNull(v.mid) && isIntOrNull(v.temp) && isIntOrNull(v.insertIndex);
  }
  if (algorithm === 'shell-sort') {
    if (!isIntOrNull(v.gap) || !isIntOrNull(v.i) || !isIntOrNull(v.j) || !isIntOrNull(v.temp) || !isIntOrNull(v.insertIndex)) return false;
    if (!isInit && v.gap !== null && v.gap <= 0) return false; 
    return true;
  }
  if (algorithm === 'selection-sort') {
    if (!isIntOrNull(v.i) || !isIntOrNull(v.j) || !isIntOrNull(v.minIndex)) return false;
    if (!isInit && v.minIndex !== null && (v.minIndex < 0 || v.minIndex >= len)) return false;
    return true;
  }
  if (algorithm === 'quick-sort') {
    if (!isIntOrNull(v.low) || !isIntOrNull(v.high) || !isIntOrNull(v.i) || !isIntOrNull(v.j) || !isIntOrNull(v.pivot)) return false;
    if (!isInit && v.low !== null && (v.low < 0 || v.low >= len)) return false;
    if (!isInit && v.high !== null && (v.high < 0 || v.high >= len)) return false;
    return true;
  }
  if (algorithm === 'heap-sort') {
    if (!isIntOrNull(v.heapSize) || !isIntOrNull(v.i) || !isIntOrNull(v.largest) || !isIntOrNull(v.l) || !isIntOrNull(v.r)) return false;
    if (!isInit && v.heapSize !== null && (v.heapSize < 0 || v.heapSize > len)) return false;
    // 【修复】移除了 v.i >= v.heapSize 的强校验，因为提取阶段外层 i 可能等于 heapSize
    if (!isInit && v.i !== null && (v.i < 0 || v.i >= len)) return false;
    return true;
  }
  if (algorithm === 'merge-sort') {
    if (!isIntOrNull(v.low) || !isIntOrNull(v.high) || !isIntOrNull(v.mid) || !isIntOrNull(v.i) || !isIntOrNull(v.j) || !isIntOrNull(v.k) || !isIntOrNull(v.p)) return false;
    if (!Array.isArray(v.temp) || !v.temp.every(Number.isInteger)) return false;
    if (!isInit && v.low !== null && (v.low < 0 || v.low >= len)) return false;
    if (!isInit && v.high !== null && (v.high < 0 || v.high >= len)) return false;
    if (!isInit && v.mid !== null && v.high !== null && v.low !== null && (v.mid < v.low || v.mid > v.high)) return false;
    if (!isInit && v.k !== null && v.temp.length !== v.k) return false;
    return true;
  }
  return true;
}

const gStepArrays = {
  'binary-tree-level-order': ['nodes', 'queue', 'order', 'levels'],
  'binary-tree-reconstruction': ['nodes', 'stack'],
  'threaded-binary-tree': ['nodes', 'order'],
  'tree-forest-conversion': ['roots', 'forestNodes', 'binaryNodes'],
  'tree-forest-traversal': ['roots', 'nodes', 'stack', 'order'],
  'huffman-coding': ['nodes', 'candidates', 'selected', 'codes'],
  'binary-search-tree': ['nodes', 'path'],
};

function validVariables(step, algorithm) {
  const variables = step.variables;
  if (!variables) return false;
  if (cAlgorithm(algorithm)) return step.algorithm === algorithm && typeof step.description === 'string' && typeof variables === 'object';
  const e = eAlgorithm(algorithm);
  if (e) return step.algorithm === algorithm && typeof step.description === 'string' && validEStep(e, step);
  const g = gAlgorithm(algorithm);
  if (g) {
    return step.algorithm === algorithm && typeof step.description === 'string' && typeof variables === 'object' &&
      g.fields.every(([key]) => Object.hasOwn(variables, key)) &&
      (gStepArrays[algorithm] ?? ['nodes', 'stack', 'order']).every(key => Array.isArray(variables[key]));
  }
  if (algorithm === 'union-find') {
    return typeof step.description === 'string' && variables.parent && variables.rank &&
      Number.isInteger(variables.setCount) && variables.setCount >= 0;
  }
  if (arraySearch(algorithm)) {
    const { index, current, comparisons, ranges, blockIndex } = variables;
    return step.algorithm === algorithm && typeof step.description === 'string' && Number.isSafeInteger(step.target) &&
      Number.isInteger(comparisons) && comparisons >= 0 &&
      (index === null ? current === null : Number.isInteger(index) && index >= 0 && index < step.array.length && current === step.array[index]) &&
      (algorithm !== 'block-search' || (Array.isArray(ranges) &&
        (blockIndex === null || (Number.isInteger(blockIndex) && blockIndex >= 0 && blockIndex < ranges.length))));
  }

  const graph = graphAlgorithm(algorithm);
  if (graph) {
    return step.algorithm === algorithm && typeof step.description === 'string' &&
      graph.fields.every(([key]) => Object.hasOwn(variables, key));
  }

  if (algorithm === 'custom-array') {
    const { line, index, writes } = variables;
    return typeof step.description === 'string' && Number.isInteger(line) && line > 0 && String(line) === step.lineId &&
      Number.isInteger(writes) && writes >= 0 &&
      (index === null || (Number.isInteger(index) && index >= 0 && index < step.array.length));
  }

  if (algorithm === 'bubble-sort') {
    const { index, pass, sortedFrom } = variables;
    return step.algorithm === algorithm && typeof step.description === 'string' && Number.isInteger(pass) && pass >= 0 &&
      Number.isInteger(sortedFrom) && sortedFrom >= 0 && sortedFrom <= step.array.length &&
      (index === null || (Number.isInteger(index) && index >= 0 && index + 1 < step.array.length));
  }

  const sortAlgorithms = ['insertion-sort', 'binary-insertion-sort', 'shell-sort', 'selection-sort', 'quick-sort', 'heap-sort', 'merge-sort'];
  if (sortAlgorithms.includes(algorithm)) {
    if (step.algorithm !== algorithm || typeof step.description !== 'string') return false;
    return validateSortVariables(step, algorithm);
  }

  return Number.isSafeInteger(variables.left) && Number.isSafeInteger(variables.right) &&
    (variables.mid === null || Number.isSafeInteger(variables.mid));
}

export function validateRun(run, algorithm = 'binary-search') {
  if (!run || typeof run.runId !== 'string' || !run.runId || run.algorithm !== algorithm || typeof run.sourceVersion !== 'string' || !run.sourceVersion ||
      !Array.isArray(run.steps) || !run.steps.length || !Array.isArray(run.sourceLines) || !run.sourceLines.length) throw new Error('运行数据不完整，无法展示步骤。');
  const graph = graphAlgorithm(algorithm);
  if (graph && (!Array.isArray(run.graph?.nodes) || !Array.isArray(run.graph?.edges) || typeof run.graph.directed !== 'boolean')) {
    throw new Error('缺少本次运行的图结构。');
  }
  const e = eAlgorithm(algorithm);
  if (e) validateEInput(e, run.input);
  const ids = new Set(run.sourceLines.map(line => line?.lineId));
  if (ids.size !== run.sourceLines.length || run.sourceLines.some(line => typeof line?.lineId !== 'string' || typeof line.text !== 'string') ||
      run.steps.some((step,i) => !step || step.stepIndex !== i || !ids.has(step.lineId) || (!graph && !cAlgorithm(algorithm) && algorithm !== 'union-find' && !gAlgorithm(algorithm) && !e && !Array.isArray(step.array)) ||
        !validVariables(step, algorithm))) throw new Error('步骤或源码映射不完整，无法同步展示。');
  return run;
}
