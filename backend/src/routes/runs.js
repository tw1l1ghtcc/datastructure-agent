// backend/src/routes/runs.js
import { generateBracketMatchingSteps } from '../../../shared/algorithms/final/f/bracket-matching.js';
import { generateInfixToPostfixSteps } from '../../../shared/algorithms/final/f/infix-to-postfix.js';
import { generateExpressionEvaluationSteps } from '../../../shared/algorithms/final/f/expression-evaluation.js';
import { generateNaiveStringMatchSteps } from '../../../shared/algorithms/final/f/naive-string-match.js';
import { generateKmpSteps } from '../../../shared/algorithms/final/f/kmp.js';
import { generateExpressionDagSteps } from '../../../shared/algorithms/final/f/expression-dag.js';
import { generateCriticalPathSteps } from '../../../shared/algorithms/final/f/critical-path.js';
import { generateAvlSteps } from '../../../shared/algorithms/final/d/avl-tree.js';
import { generateRedBlackSteps } from '../../../shared/algorithms/final/d/red-black-tree.js';
import { generateHashLinearProbingSteps } from '../../../shared/algorithms/final/d/hash-linear-probing.js';
import { generateHashQuadraticProbingSteps } from '../../../shared/algorithms/final/d/hash-quadratic-probing.js';
import { generateHashDoubleHashingSteps } from '../../../shared/algorithms/final/d/hash-double-hashing.js';
import { generateHashChainingSteps } from '../../../shared/algorithms/final/d/hash-chaining.js';
import { generateBinaryTreeLevelOrderSteps } from '../../../shared/algorithms/final/g/binary-tree-level-order.js';
import { generateBinaryTreePreorderSteps } from '../../../shared/algorithms/final/g/binary-tree-preorder.js';
import { generateBinaryTreeInorderSteps } from '../../../shared/algorithms/final/g/binary-tree-inorder.js';
import { generateBinaryTreePostorderSteps } from '../../../shared/algorithms/final/g/binary-tree-postorder.js';
import { generateBinaryTreeReconstructionSteps } from '../../../shared/algorithms/final/g/binary-tree-reconstruction.js';
import { generateThreadedBinaryTreeSteps } from '../../../shared/algorithms/final/g/threaded-binary-tree.js';
import { generateTreeForestConversionSteps } from '../../../shared/algorithms/final/g/tree-forest-conversion.js';
import { generateTreeForestTraversalSteps } from '../../../shared/algorithms/final/g/tree-forest-traversal.js';
import { generateHuffmanCodingSteps } from '../../../shared/algorithms/final/g/huffman-coding.js';
import { generateBinarySearchTreeReplay, restoreBinarySearchTreeRun } from '../../../shared/algorithms/final/g/binary-search-tree.js';
import { algorithms as cAlgorithms } from '../../../shared/algorithms/final/c/index.js';
import { validateUnionFindInput } from '../../../frontend/src/features/workbench/union-find-input.js';
import { generateUnionFindSteps } from '../../../shared/algorithms/final/b/union-find.js';
import { generateSteps } from '../../../shared/algorithms/binarySearch.js';
import { generateBubbleSteps } from '../../../shared/algorithms/bubbleSort.js';
import { graphAlgorithm, graphMaxEdges, graphMaxWeight } from '../../../frontend/src/features/workbench/graph-algorithms.js';
import { generateDfsSteps } from '../../../shared/algorithms/final/b/dfs.js';
import { generatePrimSteps } from '../../../shared/algorithms/final/b/prim.js';
import { generateKruskalSteps } from '../../../shared/algorithms/final/b/kruskal.js';
import { generateDijkstraSteps } from '../../../shared/algorithms/final/b/dijkstra.js';
import { generateFloydSteps } from '../../../shared/algorithms/final/b/floyd.js';
import { generateTopoSteps } from '../../../shared/algorithms/final/b/topological-sort.js';
import { arraySearchMaxElements } from '../../../frontend/src/features/workbench/array-search.js';
import { generateLinearSearchSteps } from '../../../shared/algorithms/final/d/linear-search.js';
import { generateBlockSearchSteps } from '../../../shared/algorithms/final/d/block-search.js';
import { generateBfsSteps } from '../../../shared/algorithms/final/b/bfs.js';
import { validateGraphInput } from '../../../shared/algorithms/final/b/validate-util.js';
import { createRun, getRun } from '../runs/store.js';

// --- A包新增导入 ---
import { generateInsertionSortSteps } from '../../../shared/algorithms/final/a/insertion-sort.js';
import { generateSelectionSortSteps } from '../../../shared/algorithms/final/a/selection-sort.js';
import { generateQuickSortSteps } from '../../../shared/algorithms/final/a/quick-sort.js';
import { generateMergeSortSteps } from '../../../shared/algorithms/final/a/merge-sort.js';
import { generateBinaryInsertionSortSteps } from '../../../shared/algorithms/final/a/binary-insertion-sort.js';
import { generateShellSortSteps } from '../../../shared/algorithms/final/a/shell-sort.js';
import { generateHeapSortSteps } from '../../../shared/algorithms/final/a/heap-sort.js';

export function handleCreateRun(req, res, body) {
  try {
    const { array, target } = JSON.parse(body);
    if (!Array.isArray(array)) return sendError(res, 400, 'INVALID_INPUT', 'array 必须是数组');
    if (!Number.isSafeInteger(target)) return sendError(res, 400, 'INVALID_INPUT', 'target 必须是安全整数');
    if (array.length > 100) return sendError(res, 400, 'INVALID_INPUT', '数组长度不能超过 100');
    for (let i = 0; i < array.length; i++) {
      if (!Number.isSafeInteger(array[i])) return sendError(res, 400, 'INVALID_INPUT', '数组元素必须全是安全整数');
      if (i > 0 && array[i] < array[i - 1]) return sendError(res, 400, 'INVALID_INPUT', '数组必须是有序的');
    }
    const algoResult = generateSteps(array, target);
    const run = createRun({ algorithm: 'binary-search', sourceVersion: algoResult.sourceVersion, sourceLines: algoResult.sourceLines, steps: algoResult.steps, result: algoResult.result });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(run));
  } catch (e) {
    sendError(res, 400, 'INVALID_INPUT', '请求体格式错误');
  }
}

export function handleCreateBubbleRun(res, body) {
  let input;
  try { input = JSON.parse(body); } catch { return sendError(res, 400, 'INVALID_INPUT', '请求体格式错误'); }
  const array = input?.array;
  if (!Array.isArray(array) || array.length > 24 || !array.every(Number.isSafeInteger)) {
    return sendError(res, 400, 'INVALID_INPUT', '数组必须包含 0 到 24 个安全整数');
  }
  const run = createRun({ algorithm: 'bubble-sort', ...generateBubbleSteps(array) });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(run));
}
const gGenerators = {
  'binary-tree-level-order': generateBinaryTreeLevelOrderSteps,
  'binary-tree-preorder': generateBinaryTreePreorderSteps,
  'binary-tree-inorder': generateBinaryTreeInorderSteps,
  'binary-tree-postorder': generateBinaryTreePostorderSteps,
  'binary-tree-reconstruction': generateBinaryTreeReconstructionSteps,
  'threaded-binary-tree': generateThreadedBinaryTreeSteps,
  'tree-forest-conversion': generateTreeForestConversionSteps,
  'tree-forest-traversal': generateTreeForestTraversalSteps,
  'huffman-coding': generateHuffmanCodingSteps,
  'binary-search-tree': generateBinarySearchTreeReplay,
};

function sendRun(res, run) {
  const { replay, runId, createdAt, algorithm, input } = run;
  const payload = replay ? { runId, createdAt, algorithm, input, ...replay } : run;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

const fGenerators = {
  'bracket-matching': generateBracketMatchingSteps,
  'infix-to-postfix': generateInfixToPostfixSteps,
  'expression-evaluation': generateExpressionEvaluationSteps,
  'naive-string-match': generateNaiveStringMatchSteps,
  kmp: generateKmpSteps,
  'expression-dag': generateExpressionDagSteps,
  'critical-path': generateCriticalPathSteps,
};

export function handleCreateFRun(res, body, algorithm) {
  let input, result;
  try {
    input = JSON.parse(body);
    result = fGenerators[algorithm](input);
  } catch (error) {
    if (!(error instanceof SyntaxError || error instanceof TypeError || error instanceof RangeError)) throw error;
    return sendError(res, 400, 'INVALID_INPUT', error.message);
  }
  sendRun(res, createRun({ algorithm, input, ...result }));
}

export function handleCreateGRun(res, body, algorithm) {
  let input, result;
  try {
    input = JSON.parse(body);
    result = gGenerators[algorithm](input);
  } catch (error) {
    if (!(error instanceof TypeError || error instanceof SyntaxError)) throw error;
    return sendError(res, 400, 'INVALID_INPUT', error.message);
  }
  // Step lookup and tutoring use the same expanded snapshots as the browser.
  const runData = algorithm === 'binary-search-tree'
    ? { replay: result, ...restoreBinarySearchTreeRun(result) }
    : result;
  sendRun(res, createRun({ algorithm, input, ...runData }));
}

const dGenerators={
  'avl-tree':generateAvlSteps,'red-black-tree':generateRedBlackSteps,
  'hash-linear-probing':generateHashLinearProbingSteps,
  'hash-quadratic-probing':generateHashQuadraticProbingSteps,
  'hash-double-hashing':generateHashDoubleHashingSteps,
  'hash-chaining':generateHashChainingSteps
};
export function handleCreateDRun(res,body,algorithm){
  let input,result;
  try{
    input=JSON.parse(body);
    if(!input || typeof input!=='object' || Array.isArray(input))throw new TypeError('输入必须为对象。');
    result=dGenerators[algorithm](input);
  }catch(error){
    if(!(error instanceof TypeError || error instanceof SyntaxError))throw error;
    return sendError(res,400,'INVALID_INPUT',error.message);
  }
  res.writeHead(200,{'Content-Type':'application/json'});
  res.end(JSON.stringify(createRun({algorithm,input,...result})));
}

export function handleCreateCRun(res, body, algorithm) {
  let input, result;
  try {
    input = JSON.parse(body);
    result = cAlgorithms[algorithm].generate(input);
  } catch (error) {
    if (!(error instanceof TypeError || error instanceof SyntaxError)) throw error;
    return sendError(res, 400, 'INVALID_INPUT', error.message);
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(createRun({ algorithm, input, ...result })));
}

export function handleCreateUnionFindRun(res, body) {
  let input;
  try {
    input = validateUnionFindInput(JSON.parse(body));
  } catch (error) {
    return sendError(res, 400, 'INVALID_INPUT', error.message);
  }
  const run = createRun({ algorithm: 'union-find', input, ...generateUnionFindSteps(input) });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(run));
}

// --- A包新增：通用排序处理路由 ---
const sortGenerators = {
  'insertion-sort': generateInsertionSortSteps,
  'selection-sort': generateSelectionSortSteps,
  'quick-sort': generateQuickSortSteps,
  'merge-sort': generateMergeSortSteps,
  'binary-insertion-sort': generateBinaryInsertionSortSteps,
  'shell-sort': generateShellSortSteps,
  'heap-sort': generateHeapSortSteps,
};

export function handleCreateSortRun(res, body, algorithm) {
  let input;
  try { input = JSON.parse(body); } catch { return sendError(res, 400, 'INVALID_INPUT', '请求体格式错误'); }
  const array = input?.array;
  if (!Array.isArray(array) || array.length > 24 || !array.every(Number.isSafeInteger)) {
    return sendError(res, 400, 'INVALID_INPUT', '数组必须包含 0 到 24 个安全整数');
  }
  
  const generator = sortGenerators[algorithm];
  if (!generator) return sendError(res, 404, 'ALGORITHM_NOT_FOUND', '未找到该排序算法');

  const run = createRun({ algorithm, ...generator(array) });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(run));
}

export function handleCreateArraySearchRun(res, body, algorithm) {
  let result;
  try {
    const input = JSON.parse(body);
    if (algorithm === 'linear-search') {
      if (!Array.isArray(input?.array)) throw new TypeError('array 必须是数组。');
      if (input.array.length > arraySearchMaxElements) throw new TypeError('数组最多包含 100 个元素。');
      result = generateLinearSearchSteps(input);
    } else {
      if (Array.isArray(input?.blocks) && input.blocks.reduce((size, block) => size + (Array.isArray(block) ? block.length : 0), 0) > arraySearchMaxElements) {
        throw new TypeError('所有块合计最多包含 100 个元素。');
      }
      result = generateBlockSearchSteps(input);
    }
  } catch (error) {
    if (!(error instanceof TypeError || error instanceof SyntaxError)) throw error;
    return sendError(res, 400, 'INVALID_INPUT', error.message);
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(createRun({ algorithm, ...result })));
}

const graphGenerators = {
  bfs: generateBfsSteps,
  dfs: generateDfsSteps,
  prim: generatePrimSteps,
  kruskal: generateKruskalSteps,
  dijkstra: generateDijkstraSteps,
  floyd: generateFloydSteps,
  'topological-sort': generateTopoSteps
};

export function handleCreateGraphRun(res, body, algorithm) {
  const config = graphAlgorithm(algorithm);
  const maxNodes = config.maxNodes ?? 30;
  let input;
  try { input = JSON.parse(body); } catch { return sendError(res, 400, 'INVALID_INPUT', '请求体格式错误'); }
  if (input?.nodes?.length > maxNodes || input?.edges?.length > graphMaxEdges) {
    return sendError(res, 400, 'INVALID_INPUT', config.name + ' 最多支持 ' + maxNodes + ' 个顶点和 ' + graphMaxEdges + ' 条边。');
  }
  let graph;
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('图输入必须为 JSON 对象。');
    const directed = Object.hasOwn(input, 'directed') ? input.directed : config.directed ?? false;
    const validated = validateGraphInput({ ...input, directed }, config.name, Boolean(config.weighted));
    if (config.weighted && input.edges.some(([, , weight]) => Math.abs(weight) > graphMaxWeight)) {
      throw new Error('边权的绝对值不得超过 ' + graphMaxWeight + '。');
    }
    const edges = validated.map(({ u, v, w }) => config.weighted ? [u, v, w] : [u, v]);
    graph = { nodes: input.nodes, edges, directed, ...(config.start ? { start: input.start } : {}) };
  } catch (error) { return sendError(res, 400, 'INVALID_INPUT', error.message); }
  const run = createRun({ algorithm, graph, ...graphGenerators[algorithm](graph) });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(run));
}

export function handleGetRun(req, res, runId) {
  const run = getRun(runId);
  if (!run) return sendError(res, 404, 'RUN_NOT_FOUND', '未找到该 run');
  sendRun(res, run);
}

export function handleGetStep(req, res, runId, stepIndex) {
  const run = getRun(runId);
  if (!run) return sendError(res, 404, 'RUN_NOT_FOUND', '未找到该 run');
  const index = parseInt(stepIndex, 10);
  if (isNaN(index) || index < 0 || index >= run.steps.length) return sendError(res, 400, 'STEP_OUT_OF_RANGE', '步骤索引越界');
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ runId, step: run.steps[index] }));
}

function sendError(res, status, code, message) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { code, message } }));
}
