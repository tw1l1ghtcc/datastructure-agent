import { eAlgorithm } from '../../../frontend/src/features/workbench/e-algorithms.js';
import { eVariableText } from '../../../frontend/src/features/workbench/e-state.js';
import { gAlgorithm } from '../../../frontend/src/features/workbench/g-algorithms.js';
import { gVariableText } from '../../../frontend/src/features/workbench/g-state.js';
import { dataAlgorithm as cAlgorithm } from '../../../frontend/src/features/workbench/data-algorithms.js';
import { arraySearch } from '../../../frontend/src/features/workbench/array-search.js';
import { graphAlgorithm } from '../../../frontend/src/features/workbench/graph-algorithms.js';
import { getRun } from '../runs/store.js';
import { checkRateLimit, reserveModelCall, finishModelCall, recordMockCall } from './rate-limit.js';
import { guardOutput } from './output-guard.js';
import { buildPrompt } from './prompt.js';
import { conversations, validateConversation } from './conversation.js';

export async function handleAgentExplain(parsedBody, ctx = {}) {
  if (!validateConversation(parsedBody)) return { status: 400, body: { error: { code: 'INVALID_INPUT', message: 'conversationId与turnId须同时提供，且为8至80位字母、数字或连接符。' } } };
  const run = typeof parsedBody?.runId === 'string' ? getRun(parsedBody.runId) : null;
  if (!run || !Number.isSafeInteger(parsedBody?.stepIndex) || parsedBody.stepIndex < 0 || parsedBody.stepIndex >= run.steps.length ||
      typeof parsedBody.question !== 'string' || !parsedBody.question.trim() || parsedBody.question.length > 2000 ||
      (parsedBody.hintLevel !== undefined && ![1,2,3].includes(parsedBody.hintLevel))) return explain(parsedBody, ctx);
  const turn = conversations.begin(parsedBody, ctx.req);
  if (turn.error) return turn.error;
  if (turn.cached) return turn.cached;
  const execution = { ...ctx, history: turn.history };
  try {
    const result = await explain(parsedBody, execution);
    if (result.status === 200 && typeof result.body.answer === 'string' && result.body.answer.trim()) turn.commit(result);
    return result;
  } finally { turn.release(); }
}

async function explain(parsedBody, ctx = {}) {
  const mode = ctx.mode || 'mock';
  const req = ctx.req;
  const bodySessionId = parsedBody?.sessionId;

  if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
    return { status: 400, body: { error: { code: 'INVALID_INPUT', message: '请求体必须为 JSON 对象' } } };
  }

  const { runId, stepIndex, question, hintLevel } = parsedBody;

  if (typeof runId !== 'string' || !runId.trim()) {
    return { status: 400, body: { error: { code: 'INVALID_INPUT', message: 'runId 为必填字符串' } } };
  }
  if (hintLevel !== undefined) {
    if (!Number.isInteger(hintLevel) || hintLevel < 1 || hintLevel > 3) {
      return { status: 400, body: { error: { code: 'INVALID_INPUT', message: 'hintLevel 必须为 1、2 或 3' } } };
    }
  }

  if (stepIndex === undefined || stepIndex === null) {
    return { status: 400, body: { error: { code: 'INVALID_INPUT', message: 'stepIndex 为必填' } } };
  }
  if (typeof stepIndex !== 'number' || !Number.isSafeInteger(stepIndex) || stepIndex < 0) {
    return { status: 400, body: { error: { code: 'INVALID_INPUT', message: 'stepIndex 必须为非负整数' } } };
  }
  const idx = stepIndex;

  if (typeof question !== 'string' || !question.trim() || question.length > 2000) {
    return { status: 400, body: { error: { code: 'INVALID_INPUT', message: 'question 必须为1至2000字符的非空字符串' } } };
  }

  const level = hintLevel === undefined ? 1 : hintLevel;

  const run = getRun(runId);
  if (!run) return { status: 404, body: { error: { code: 'RUN_NOT_FOUND', message: 'run 不存在或已过期，请重新运行算法' } } };
  if (run.algorithm === 'custom-array') return { status: 400, body: { error: { code: 'INVALID_INPUT', message: '自定义代码运行暂未接入步骤问答。' } } };
  
  const steps = Array.isArray(run.steps) ? run.steps : [];
  if (idx >= steps.length) return { status: 400, body: { error: { code: 'STEP_OUT_OF_RANGE', message: `stepIndex 越界` } } };
  
  const step = steps[idx] || {};
  const arr = Array.isArray(step.array) ? step.array : [];
  const target = step.target;
  const left = step.variables?.left;
  const right = step.variables?.right;
  const mid = step.variables?.mid;
  const ev = step.event;
  const stepNo = step.stepIndex ?? idx;

  if (process.env.RATE_LIMIT !== 'false' && req) {
    const limit = checkRateLimit(req);
    if (!limit.allowed) return { status: 429, body: { error: { code: 'RATE_LIMIT_EXCEEDED', message: '请求过于频繁' } } };
  }
  if (mode !== 'real') recordMockCall(req, bodySessionId);
  
  const metadata = { sourceRefs: [], knowledgeUsed: false, retrieval: { method: 'none', status: 'disabled', matchedCardIds: [], contextCardId: null, matches: [] } };
  
  const isSorting = run.algorithm.endsWith('-sort'); // 适配所有排序
  const bfs = run.algorithm === 'bfs';
  const graph = graphAlgorithm(run.algorithm);
  const search = arraySearch(run.algorithm);
  const c = cAlgorithm(run.algorithm);
  const e = eAlgorithm(run.algorithm);
  const g = gAlgorithm(run.algorithm);
  const tree = run.algorithm === 'binary-tree-level-order';
  const bst = run.algorithm === 'binary-search-tree';
  const uf = run.algorithm === 'union-find';
  const stepRefs = uf || c || g || e
    ? [{ runId, stepIndex: idx, algorithm: run.algorithm, event: ev, variables: step.variables }]
    : search
    ? [{ runId, stepIndex: idx, algorithm: run.algorithm, event: ev, target, array: arr, variables: step.variables }]
    : graph
    ? [{ runId, stepIndex: idx, algorithm: run.algorithm, event: ev, variables: step.variables }]
    : isSorting
    ? [{ runId, stepIndex: idx, algorithm: run.algorithm, event: ev, array: arr, variables: step.variables }]
    : [{ runId, stepIndex: idx, event: ev, left, right, mid, array: arr, target }];

  if (mode === 'real') {
    // ... (真实模型代码保持不变)
    let receipt;
    const startedAt = Date.now();
    try {
      const { DeepSeekProvider } = await import('./providers/deepseek.js');
      const provider = new DeepSeekProvider();
      const messages = buildPrompt(run, step, level, question, ctx.history || []);
      const maxTokens = 1024;
      const maximumTokens = Buffer.byteLength(JSON.stringify(messages), 'utf8') + maxTokens + 256;
      const allocation = reserveModelCall(req, bodySessionId, maximumTokens);
      if (!allocation.allowed) return { status: allocation.code === 'BUDGET_UNAVAILABLE' ? 503 : 429, body: { error: { code: allocation.code, message: '额度不足' } } };
      receipt = allocation.receipt;
      const timeoutMs = Number(process.env.MODEL_TIMEOUT_MS) || 15000;
      const result = await provider.chat(messages, { timeoutMs, maxTokens });
      const elapsedMs = Date.now() - startedAt;
      const guard = guardOutput(result.content);
      if (!guard.valid && !guard.truncated) throw new Error('MODEL_CALL_FAILED');
      const finalAnswer = guard.valid ? result.content : guard.truncated;
      finishModelCall(receipt, { tokens: result.usage?.totalTokens ?? null, cost: result.cost ?? null, elapsedMs });
      return { status: 200, body: { runId, stepIndex: idx, hintLevel: level, answer: finalAnswer, stepRefs, ...metadata, usage: { model: result.model || provider.model, cost: result.cost ?? null, mock: false, tokens: result.usage || null, elapsedMs } } };
    } catch (err) {
      finishModelCall(receipt, { elapsedMs: Date.now() - startedAt, failed: true });
      if (err.message === 'MODEL_TIMEOUT') return { status: 504, body: { error: { code: 'MODEL_TIMEOUT', message: '超时', degraded: false } } };
      return { status: 502, body: { error: { code: 'MODEL_CALL_FAILED', message: '调用失败' } } };
    }
  }

  const prefix = '[Mock开发模式] ';
  let answer = '';

  if (bst) {
    answer = prefix + '二叉排序树第 ' + (stepNo + 1) + ' 步。' + step.description;
    const { nodes, path, operation } = step.variables;
    if (level >= 2 && operation) {
      const keys = path.map(id => nodes[id].key);
      answer += ' 当前比较路径（键）：' + (keys.join(' → ') || '空') + '。';
    }
    if (level === 3 && steps[idx + 1]) answer += ' 下一步：' + steps[idx + 1].description;
  } else if(tree){
    answer=prefix+'层序遍历第 '+(stepNo+1)+' 步。'+step.description;
    if(level>=2)answer+=' 当前队列（队首在左）：'+(step.variables.queue.map(entry=>entry.id+'（第'+entry.level+'层）').join('、')||'空')+'。';
    if(level===3 && steps[idx+1])answer+=' 下一步：'+steps[idx+1].description;
  } else if (e) {
    answer = prefix + e.title + '第 ' + (stepNo + 1) + ' 步。' + step.description;
    if (level >= 2) {
      const details = e.fields.map(([key, label]) => label + '：' + eVariableText(key, step, run.input, steps[idx - 1]));
      answer += ' ' + details.join('；') + '。';
    }
    if (level === 3 && steps[idx + 1]) answer += ' 下一步：' + steps[idx + 1].description;
  } else if (g) {
    answer = prefix + g.title + '第 ' + (stepNo + 1) + ' 步。' + step.description;
    if (level >= 2) {
      const details = g.fields.map(([key, label]) => label + '：' + gVariableText(g, key, step.variables));
      answer += ' ' + details.join('；') + '。';
    }
    if (level === 3 && steps[idx + 1]) answer += ' 下一步：' + steps[idx + 1].description;
  } else if (c) {
    answer = prefix + c.title + '第 ' + (stepNo + 1) + ' 步。' + step.description;
    if (level >= 2) answer += ' 当前状态：' + JSON.stringify(step.variables);
    if (level === 3 && steps[idx + 1]) answer += ' 下一步：' + steps[idx + 1].description;
  } else if (uf) {
    answer = prefix + '并查集第 ' + (stepNo + 1) + ' 步。' + step.description;
    if (level >= 2) answer += ' 当前集合数量为 ' + step.variables.setCount + '，父节点表为 ' + JSON.stringify(step.variables.parent) + '。';
    if (level === 3 && steps[idx + 1]) answer += ' 下一步：' + steps[idx + 1].description;
  } else if (bfs) {
    const { queue, currentNode, currentEdge, discoveryOrder } = step.variables;
    answer = prefix + 'BFS 第 ' + (stepNo + 1) + ' 步。' + step.description + ' 队列：' + (queue.join(' → ') || '空') + '。';
    if (level >= 2) answer += ' 当前顶点：' + (currentNode ?? '无') + '；当前检查的边：' + (currentEdge?.join(' → ') ?? '无') + '。';
    if (level === 3) answer += ' 发现顺序：' + (discoveryOrder.join(' → ') || '暂无') + '。';
    if (level === 3 && steps[idx + 1]) answer += ' 下一步：' + steps[idx + 1].description;
  } else if (graph) {
    answer = prefix + graph.name + ' 第 ' + (stepNo + 1) + ' 步。' + step.description;
    if (level >= 2) {
      const details = graph.fields.map(([key, label]) => label + '：' + JSON.stringify(step.variables[key]));
      answer += ' ' + details.join('；') + '。';
    }
    if (level === 3 && steps[idx + 1]) answer += ' 下一步：' + steps[idx + 1].description;
  } else if (search) {
    answer = prefix + search.title + '第 ' + (stepNo + 1) + ' 步。' + step.description;
    if (level >= 2) answer += ' 已比较 ' + step.variables.comparisons + ' 次。';
    if (level === 3 && steps[idx + 1]) answer += ' 下一步：' + steps[idx + 1].description;
  } else if (isSorting) {
    // 适配排序
    if (run.algorithm === 'bubble-sort') {
      const { pass, index, sortedFrom } = step.variables;
      const comparison = index === null ? '' : ` 关注下标 ${index} 和 ${index + 1}。`;
      const settled = sortedFrom < arr.length ? `下标 ${sortedFrom} 到 ${arr.length - 1} 的元素已就位。` : '目前还没有确认就位的元素。';
      answer = `${prefix}冒泡排序第 ${stepNo + 1} 步，当前数组 [${arr.join(', ')}]。${pass ? `第 ${pass} 轮。` : ''}${comparison} ${settled}`;
    } else {
      answer = `${prefix}排序第 ${stepNo + 1} 步，当前数组 [${arr.join(', ')}]。`;
    }
    if (level >= 2) answer += ` ${step.description}`;
    if (level === 3 && steps[idx + 1]) answer += ` 下一步：${steps[idx + 1].description}`;
  } else if (typeof left === 'number' && typeof right === 'number' && left > right) {
    // 二分查找：空区间
    answer = `${prefix}候选区间已为空（left=${left} > right=${right}），查找结束，返回 -1（not-found）。`;
  } else if (level === 1) {
    answer = `${prefix}当前步骤（第${stepNo + 1}步）：事件为 ${ev}，区间 [${left}, ${right}]`;
    if (typeof mid === 'number') {
      answer += `，mid=${mid}`;
      if (arr.length > mid) answer += `，A[${mid}]=${arr[mid]}`;
    }
    answer += `。目标值为 ${target}。`;
  } else if (level === 2) {
    answer = `${prefix}步骤 ${stepNo + 1} 事件 ${ev}：候选区间 [${left}, ${right}]`;
    if (typeof mid === 'number') answer += `，mid=${mid}，A[${mid}]=${arr[mid] ?? '?'}`;
    answer += `。目标 ${target}。`;
    if (ev === 'probe') answer += ' 正在比较目标与中间元素。';
    else if (ev === 'move-left') answer += ' 更新左边界。';
    else if (ev === 'move-right') answer += ' 更新右边界。';
    else if (ev === 'found') answer += ' 找到目标，查找成功。';
    else if (ev === 'not-found') answer += ' 候选区间已空，查找结束。';
    else if (ev === 'init') answer += ' 初始化查找区间。';
  } else {
    let next = '下一步继续二分查找流程。';
    if (arr.length === 0) next = '数组为空，查找直接结束（not-found）。';
    else if (ev === 'init') next = '初始化完成，下一步将计算 mid 并与目标比较。';
    else if (ev === 'probe') {
      const value = arr[mid];
      next = value === target ? '下一步：命中（found），返回当前中点下标。' : value < target ? '下一步：更新左边界（left=mid+1）。' : '下一步：更新右边界（right=mid-1）。';
    }
    else if (ev === 'move-left') next = '已更新左边界，下一步重新计算 mid。';
    else if (ev === 'move-right') next = '已更新右边界，下一步重新计算 mid。';
    else if (ev === 'found') next = '已找到目标，查找成功结束。';
    else if (ev === 'not-found') next = '查找结束，目标不在数组中。';

    answer = `${prefix}步骤 ${stepNo + 1} 事件 ${ev}：区间 [${left}, ${right}]`;
    if (typeof mid === 'number') answer += `，mid=${mid}，A[${mid}]=${arr[mid] ?? '?'}`;
    answer += `。目标 ${target}。${next}`;
  }

  return { status: 200, body: { runId, stepIndex: idx, hintLevel: level, answer, stepRefs, ...metadata, usage: { model: 'mock', cost: 0, mock: true } } };
}
