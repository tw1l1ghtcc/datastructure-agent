import { graphLayer, gridLayer } from '../../../vendor/plus/vendor/engine/model.js';
import { createFStateTable } from './f-state-table.js';
import { compactLabel, createTraceAnimation, indexedCard, sequenceLayer, windowStart } from './trace-animation.js';

const WINDOW_SIZE = 10;
const charLabels = { ' ': '空格', '\t': '制表符', '\n': '换行', '\r': '回车' };
const showChar = char => charLabels[char] ?? char;
const nodeId = index => 'f' + index;

function tail(id, title, values, markTop = false) {
  return sequenceLayer(id, title, values, { focus2: markTop ? [values.length - 1] : [] },
    { first: Math.max(0, values.length - WINDOW_SIZE) });
}

function bracketFrame(chars, step) {
  const { i, stack } = step.variables;
  const failed = step.result?.matched === false;
  const role = failed ? 'swap' : 'focus1';
  const title = failed ? '原字符串 · 下标 ' + step.result.index + ' 未匹配'
    : step.done ? '原字符串 · 匹配成功' : '原字符串';
  return [
    chars.length ? indexedCard('f-text', title, chars, { [role]: Number.isInteger(i) ? [i] : [] })
      : sequenceLayer('f-text', title, []),
    stack.length ? indexedCard('f-brackets', '括号栈（底到顶，格下为原下标）', stack.map(item => item.char),
      { focus2: [stack.length - 1] }, stack.map(item => item.i))
      : sequenceLayer('f-brackets', '括号栈', []),
  ];
}

function revealIndexedCell(host, layer, index) {
  const svg = host.querySelector('[data-avc-svg="' + layer + '"]');
  const viewport = svg?.parentElement;
  if (!viewport) return;
  if (viewport.scrollHeight > viewport.clientHeight) {
    viewport.tabIndex = 0;
    viewport.setAttribute('role', 'region');
    viewport.setAttribute('aria-label', svg.getAttribute('aria-label'));
  } else {
    viewport.removeAttribute('tabindex');
    viewport.removeAttribute('role');
    viewport.removeAttribute('aria-label');
  }
  const cell = svg.querySelector('[data-avc-key="g-' + index + '"] rect');
  if (!cell) return;
  const bounds = cell.getBoundingClientRect();
  const view = viewport.getBoundingClientRect();
  if (bounds.top < view.top + 4) viewport.scrollTop += bounds.top - view.top - 4;
  else if (bounds.bottom > view.bottom - 4) viewport.scrollTop += bounds.bottom - view.bottom + 4;
}

function expressionStacks(v) {
  return [
    tail('f-operators', '运算符栈（栈顶在右）', v.operators.map(token => token.text), true),
    tail('f-postfix', '后缀序列', v.output.map(token => token.text)),
  ];
}

function tokenCard(id, title, tokens, roles) {
  return tokens.length
    ? indexedCard(id, title, tokens.map(token => token.text), roles, tokens.map(token => token.index))
    : sequenceLayer(id, title, []);
}

function evaluationTokenIndex(step) {
  const { index, output } = step.variables;
  const evaluating = step.event === 'value-push' || step.event === 'compute' || step.result?.error;
  if (!evaluating || !Number.isInteger(index)) return -1;
  return output.findIndex(token => token.index === index);
}

function operandCard(step) {
  const { stack } = step.variables;
  let title = '操作数栈（底到顶）';
  if (step.result?.error) title += ' · ' + step.result.error;
  else if (step.done) title += ' · 结果 ' + step.result.value;
  if (!stack.length) return sequenceLayer('f-operands', title, []);
  const role = step.event === 'value-push' || step.event === 'compute' ? 'added' : 'focus2';
  return indexedCard('f-operands', title, stack, { [role]: [stack.length - 1] });
}

function expressionFrame(step, previous) {
  const { operators, output, stack, mode } = step.variables;
  const appended = step.event !== 'postfix' && output.length > (previous?.variables.output.length ?? 0);
  const active = stack ? evaluationTokenIndex(step) : -1;
  const roles = {
    added: appended ? [output.length - 1] : [],
    [step.result?.error ? 'swap' : 'focus1']: active >= 0 ? [active] : [],
  };
  let title = '后缀序列（格下为原下标）';
  if (!stack && step.done) title = step.result?.error ? '已输出词元 · ' + step.result.error : title + ' · 转换完成';
  const layers = [];
  if (stack) layers.push(operandCard(step));
  if (mode !== 'postfix') {
    layers.push(tokenCard('f-operators', '运算符栈（底到顶，格下为原下标）', operators, { focus2: [operators.length - 1] }));
  }
  layers.push(tokenCard('f-postfix', title, output, roles));
  return layers;
}

function matchFrame(text, pattern, step) {
  const v = step.variables;
  const comparing = Number.isInteger(v.i) && Number.isInteger(v.j);
  const matched = step.event === 'match' || (step.done && v.matches.length > 0);
  const start = v.start ?? (matched ? v.matches.at(-1) : comparing ? Math.max(0, v.i - v.j) : 0);
  const focus = matched ? start + Math.max(0, pattern.length - 1) : v.i ?? start + (v.k ?? 0);
  const length = Math.max(text.length, start + pattern.length);
  const first = windowStart(length, WINDOW_SIZE, focus);
  const indices = Array.from({ length: Math.min(length, WINDOW_SIZE) }, (_, i) => first + i);
  const row = (values, offset = 0) => indices.map(i => values[i - offset] ?? '');
  const values = indices.length ? [row(text), row(pattern, start)] : [];
  const marked = indices.filter(i => matched && i >= start && i < start + pattern.length);
  const caret = (r, i) => indices.includes(i) ? [r + ',' + (i - first)] : [];
  const roles = {
    done: marked.flatMap(i => [...caret(0, i), ...caret(1, i)]),
    swap: !matched && comparing && v.j >= 0 && v.j < pattern.length
      ? [...caret(0, v.i), ...caret(1, start + v.j)] : [],
    focus2: !matched && !comparing ? caret(1, start + v.k) : [],
  };
  const cellW = Math.max(35, ...values.flat().map(char => char.length * 10 + 14));
  const range = indices.length < length ? ' · 下标 ' + first + '–' + indices.at(-1) : '';
  const layers = [gridLayer({
    id: 'f-match', title: '主串与模式串' + range, values, roles,
    colLabels: indices.map(String), rowLabels: ['主串', '模式串'],
    props: { canvasWidth: Math.max(320, 72 + (indices.length + 1) * cellW), canvasHeight: 160, cellW, cellH: 28 },
  })];
  if (v.mode) {
    const current = v.k ?? v.j;
    layers.push(sequenceLayer('f-jump-table', '跳转表 · ' + v.mode,
      pattern.map((_, index) => v[v.mode][index]), { swap: [current], focus2: [v.jump] }));
    if (v.k != null) layers.push(sequenceLayer('f-prefix', '最长真前后缀长度',
      pattern.map((_, index) => v.prefix[index]), { swap: [v.k] }));
  }
  layers.push(tail('f-matches', '已匹配的起点', v.matches));
  return layers;
}

// Derive display columns from the visible dependencies; event order and results come from the run.
function placeGraph(nodes, edges) {
  const outgoing = new Map(nodes.map(({ id }) => [id, []]));
  const degree = new Map(nodes.map(({ id }) => [id, 0]));
  for (const { from, to } of edges) {
    outgoing.get(from).push(to);
    degree.set(to, degree.get(to) + 1);
  }
  const available = nodes.filter(({ id }) => degree.get(id) === 0).map(({ id }) => id);
  const levels = new Map();
  for (const id of available) levels.set(id, 0);
  for (let i = 0; i < available.length; i++) {
    const from = available[i];
    for (const to of outgoing.get(from)) {
      levels.set(to, Math.max(levels.get(to) ?? 0, levels.get(from) + 1));
      degree.set(to, degree.get(to) - 1);
      if (degree.get(to) === 0) available.push(to);
    }
  }

  const columns = new Map();
  const cyclicColumns = Math.ceil(Math.sqrt(nodes.length));
  for (const [index, node] of nodes.entries()) {
    const column = available.length === nodes.length ? levels.get(node.id) : index % cyclicColumns;
    if (!columns.has(column)) columns.set(column, []);
    columns.get(column).push(node);
  }
  const count = Math.max(1, columns.size);
  const rows = Math.max(1, ...[...columns.values()].map(group => group.length));
  return {
    nodes: [...columns.entries()].flatMap(([col, group]) =>
      group.map((node, row) => ({ ...node, x: (col + 0.5) / count, y: (row + 0.5) / group.length }))),
    canvasWidth: Math.max(420, 86 + count * 126),
    canvasHeight: Math.max(234, 84 + rows * 78),
  };
}

const pairKey = (from, to) => from + '/' + to;
function routeEdges(edges) {
  const groups = new Map();
  for (const edge of edges) {
    const key = pairKey(edge.from, edge.to);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(edge);
  }
  for (const group of groups.values()) {
    const { from, to } = group[0];
    const opposite = from !== to && groups.has(pairKey(to, from));
    if (!opposite && group.length === 1) continue;
    const spacing = Math.min(22, 64 / Math.max(1, group.length - 1));
    group.forEach((edge, index) => {
      edge.bend = (opposite ? 14 : 0) + (index - (group.length - 1) / 2) * spacing;
    });
  }
  return edges;
}

function graphCard(id, title, layout, edges, roles) {
  return graphLayer({
    id, title, nodes: layout.nodes, edges, directed: true, roles,
    props: { canvasWidth: layout.canvasWidth, canvasHeight: layout.canvasHeight, routedEdges: true, showLegend: false },
  });
}

function expressionDagFrame(v) {
  const layers = expressionStacks(v);
  if (!v.nodes.length) return layers;
  const nodes = v.nodes.map(node => ({
    id: nodeId(node.id), label: compactLabel(node.token, 5),
    sub: Object.hasOwn(v.cache, node.id) ? '= ' + compactLabel(v.cache[node.id], 12) : '#' + node.id,
  }));
  const edges = routeEdges(v.edges.map(([from, to, role]) => ({
    from: nodeId(from), to: nodeId(to), w: role === '左操作数' ? '左' : '右',
    state: to === v.currentNode ? 'active' : 'idle',
  })));
  const graph = graphCard('f-expression-dag', '表达式依赖图（箭头指向使用节点）', placeGraph(nodes, edges), edges, {
    swap: v.currentNode == null ? [] : [nodeId(v.currentNode)], done: v.order.map(nodeId),
  });
  return [graph, tail('f-build-stack', '构图栈（节点编号，栈顶在右）', v.stack, true), ...layers];
}

function criticalPathFrames(input) {
  const ids = new Map(input.nodes.map((label, index) => [label, nodeId(index)]));
  const edges = routeEdges(input.edges.map(([from, to, weight]) =>
    ({ from: ids.get(from), to: ids.get(to), w: compactLabel(weight, 13) })));
  const layout = placeGraph(input.nodes.map(label => ({ id: ids.get(label), label: compactLabel(label, 4), event: label })), edges);
  return step => {
    const v = step.variables;
    const critical = new Set(v.criticalEdges);
    const timed = layout.nodes.map(node => ({
      ...node,
      sub: '早 ' + compactLabel(v.earliest[node.event], 8) + '　迟 ' + compactLabel(v.latest[node.event], 8),
    }));
    const activities = edges.map((edge, index) => ({
      ...edge, state: index === v.activityIndex ? 'active' : critical.has(index) ? 'tree' : 'idle',
    }));
    return [
      graphCard('f-activities', '活动网络（红色为当前活动，绿色为关键活动）', { ...layout, nodes: timed }, activities, {
        swap: [ids.get(v.currentNode)].filter(Boolean), done: v.order.map(event => ids.get(event)),
      }),
      sequenceLayer('f-queue', '拓扑队列（队首在左）', v.queue),
      tail('f-order', '拓扑序', v.order),
    ];
  };
}

export function createFAnimation(host, explainHost, run, config) {
  const input = run.input;
  const text = Array.from(input.text ?? '', showChar);
  const pattern = Array.from(input.pattern ?? '', showChar);
  const expression = step => expressionFrame(step, run.steps[step.stepIndex - 1]);
  const frames = {
    'bracket-matching': step => bracketFrame(text, step),
    'infix-to-postfix': expression,
    'expression-evaluation': expression,
    'naive-string-match': step => matchFrame(text, pattern, step),
    kmp: step => matchFrame(text, pattern, step),
    'expression-dag': step => expressionDagFrame(step.variables),
    'critical-path': run.algorithm === 'critical-path' ? criticalPathFrames(input) : null,
  };
  const followExpression = step => {
    const { operators, output, stack, mode } = step.variables;
    const active = stack ? evaluationTokenIndex(step) : -1;
    const position = step.event === 'postfix' ? 0 : output.length - 1;
    if (stack) revealIndexedCell(host, 'f-operands', stack.length - 1);
    if (mode !== 'postfix') revealIndexedCell(host, 'f-operators', operators.length - 1);
    revealIndexedCell(host, 'f-postfix', active >= 0 ? active : position);
  };
  const follow = {
    'bracket-matching': step => {
      revealIndexedCell(host, 'f-text', step.variables.i ?? (step.done ? text.length - 1 : 0));
      revealIndexedCell(host, 'f-brackets', step.variables.stack.length - 1);
    },
    'infix-to-postfix': followExpression,
    'expression-evaluation': followExpression,
  }[run.algorithm];
  const stateTable = follow ? null : createFStateTable(config, run.algorithm, input);
  const animation = createTraceAnimation(host, explainHost, stateTable, frames[run.algorithm], 'f', { run, config });
  if (!follow) return animation;
  host.querySelector('[data-viz-engine="plus-f"] .trace-animation-stage').classList.add('f-scroll-cards');
  return {
    ...animation,
    showStep(step) {
      animation.showStep(step);
      follow(step);
    },
    playEnterAnimation() {
      animation.playEnterAnimation();
      const step = animation.getStep();
      if (step) follow(step);
    },
  };
}
