import { graphLayer, gridLayer } from '../../../vendor/plus/vendor/engine/model.js';
import { createCriticalPathStateTable } from './f-state-table.js';
import { compactLabel, createTraceAnimation, indexedCard, sequenceLayer } from './trace-animation.js';

const WINDOW_SIZE = 10;
const MATCH_COLUMNS = 6;
const MATCH_ROWS = 4;
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

function revealCell(host, layer, key) {
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
  const cell = svg.querySelector('[data-avc-key="g-' + key + '"] rect');
  if (!cell) return;
  const bounds = cell.getBoundingClientRect();
  const view = viewport.getBoundingClientRect();
  if (bounds.top < view.top + 4) viewport.scrollTop += bounds.top - view.top - 4;
  else if (bounds.bottom > view.bottom - 4) viewport.scrollTop += bounds.bottom - view.bottom + 4;
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
  const { operators, output, mode, nodes } = step.variables;
  const evaluating = step.algorithm === 'expression-evaluation';
  const appended = step.event !== 'postfix' && output.length > (previous?.variables.output.length ?? 0);
  const active = evaluating ? evaluationTokenIndex(step) : -1;
  const roles = {
    added: appended ? [output.length - 1] : [],
    [step.result?.error ? 'swap' : 'focus1']: active >= 0 ? [active] : [],
  };
  let title = '后缀序列（格下为原下标）';
  if (!evaluating && step.result?.error && !nodes?.length) title = '已输出词元 · ' + step.result.error;
  else if (step.algorithm === 'infix-to-postfix' && step.done) title += ' · 转换完成';
  const layers = [];
  if (evaluating) layers.push(operandCard(step));
  if (mode !== 'postfix') {
    layers.push(tokenCard('f-operators', '运算符栈（底到顶，格下为原下标）', operators, { focus2: [operators.length - 1] }));
  }
  layers.push(tokenCard('f-postfix', title, output, roles));
  return layers;
}

// The first group shows main-string indices in the grid header.
const matchCell = (index, row) => (Math.floor(index / MATCH_COLUMNS) * MATCH_ROWS + row - 1) + ',' + (index % MATCH_COLUMNS);

function stringAlignment(step, patternLength) {
  const { i, j, k, start, matches } = step.variables;
  const matched = patternLength > 0 && (step.event === 'match' || (step.done && matches.length > 0));
  const currentOffset = Number.isInteger(i) && Number.isInteger(j) ? Math.max(0, i - j) : 0;
  const offset = start ?? (matched ? matches.at(-1) : currentOffset);
  const focus = matched ? offset + patternLength - 1 : i ?? k ?? offset;
  return { offset, matched, focus };
}

function kmpTable(pattern, step) {
  const { mode, prefix, next, nextval, k, j, jump } = step.variables;
  const cells = row => Number.isInteger(row) && row >= 0 && row < pattern.length
    ? [0, 1, 2, 3].map(col => row + ',' + col) : [];
  return gridLayer({
    id: 'f-kmp-table', title: '预处理表 · 当前使用 ' + mode,
    values: pattern.map((char, index) => [char, prefix[index] ?? '—', next[index] ?? '—', nextval[index] ?? '—']),
    colLabels: ['字符', '前缀长度', 'next', 'nextval'],
    roles: { swap: cells(k ?? j), focus2: cells(jump) },
    props: { canvasWidth: 320, canvasHeight: Math.max(146, 72 + (pattern.length + 1) * 24), cellW: 50, cellH: 24 },
  });
}

function stringMatchFrame(text, pattern, step) {
  const { matches, i, j, k, jump, equal, mode } = step.variables;
  const { offset, matched } = stringAlignment(step, pattern.length);
  const length = Math.max(text.length, offset + pattern.length);
  const values = [];
  const rowLabels = [];
  for (let first = 0; first < length; first += MATCH_COLUMNS) {
    const indices = Array.from({ length: MATCH_COLUMNS }, (_, col) => first + col);
    if (first > 0) {
      values.push(indices.map(index => index < length ? index : ''));
      rowLabels.push('下标');
    }
    values.push(
      indices.map(index => text[index] ?? ''),
      indices.map(index => pattern[index - offset] ?? ''),
      indices.map(index => index >= offset && index < offset + pattern.length ? index - offset : ''),
    );
    rowLabels.push('主串', '模式串', '下标');
  }
  const compared = !matched && Number.isInteger(i) && Number.isInteger(j) && i >= 0 && i < text.length && j >= 0 && j < pattern.length
    ? [matchCell(i, 1), matchCell(i, 2)] : [];
  const patternCursors = [k, jump].filter(index => Number.isInteger(index) && index >= 0 && index < pattern.length);
  const comparisonRole = equal === false || step.event === 'fallback' ? 'swap' : 'focus1';
  const aligned = gridLayer({
    id: 'f-match', title: '主串与模式串 · 对齐起点 ' + offset, values, rowLabels,
    colLabels: Array.from({ length: MATCH_COLUMNS }, (_, col) => col < length ? String(col) : ''),
    roles: {
      [comparisonRole]: compared,
      focus2: patternCursors.map(index => matchCell(offset + index, 2)),
      done: matched ? pattern.flatMap((_, index) => [matchCell(offset + index, 1), matchCell(offset + index, 2)]) : [],
    },
    props: { canvasWidth: 320, canvasHeight: Math.max(150, 72 + (values.length + 1) * 24), cellW: 36, cellH: 24 },
  });
  const title = '匹配起点（' + matches.length + ' 处）';
  const found = matches.length ? indexedCard('f-matches', title, matches, {
    added: step.event === 'match' || step.event === 'empty' ? [matches.length - 1] : [],
  }) : sequenceLayer('f-matches', title, []);
  return mode && pattern.length ? [aligned, kmpTable(pattern, step), found] : [aligned, found];
}

// Derive display columns from the visible dependencies; event order and results come from the run.
function placeGraph(nodes, edges, columnWidth = 126) {
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
    canvasWidth: Math.max(420, 86 + count * columnWidth),
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

function expressionDagFrame(step, previous) {
  const v = step.variables;
  const layers = expressionFrame(step, previous);
  if (!v.nodes.length) return layers;
  const nodes = v.nodes.map(node => {
    const label = compactLabel(node.token, 5);
    const number = '#' + node.id;
    const sub = Object.hasOwn(v.cache, node.id) ? number + ' = ' + v.cache[node.id]
      : label !== node.token ? number + ' · ' + node.token : number;
    return { id: nodeId(node.id), label, sub, badge: v.root === node.id ? '根' : undefined };
  });
  const error = step.result?.error;
  const current = error ? v.nodes.find(node => node.index === v.index)?.id : v.currentNode;
  const edges = routeEdges(v.edges.map(([from, to, role]) => ({
    from: nodeId(from), to: nodeId(to), w: role === '左操作数' ? '左' : '右',
    state: to === current ? 'active' : 'idle',
  })));
  const title = error ? '表达式依赖图 · ' + error : '表达式依赖图（箭头指向使用节点）';
  const columnWidth = Math.max(126, ...nodes.map(node => node.sub.length * 6 + 20));
  const graph = graphCard('f-expression-dag', title, placeGraph(nodes, edges, columnWidth), edges, {
    swap: current == null ? [] : [nodeId(current)], done: v.order.map(nodeId),
  });
  const stack = indexedCard('f-build-stack', '构图栈（底到顶）', v.stack, { focus2: [v.stack.length - 1] });
  return [graph, stack, ...layers];
}

function eventTimes(variables, event) {
  return '早 ' + (variables.earliest[event] ?? '—') + '　迟 ' + (variables.latest[event] ?? '—');
}

function criticalPathFrames({ input, steps }) {
  const ids = new Map(input.nodes.map((label, index) => [label, nodeId(index)]));
  const edges = routeEdges(input.edges.map(([from, to, weight]) =>
    ({ from: ids.get(from), to: ids.get(to), w: compactLabel(weight, 13) })));
  const nodes = input.nodes.map(event => ({ id: ids.get(event), label: compactLabel(event, 4), event }));
  let columnWidth = 126;
  for (const step of steps) {
    for (const event of input.nodes) {
      columnWidth = Math.max(columnWidth, eventTimes(step.variables, event).length * 6 + 20);
    }
  }
  const layout = placeGraph(nodes, edges, columnWidth);
  return step => {
    const v = step.variables;
    const critical = new Set(v.criticalEdges);
    const timed = layout.nodes.map(node => {
      const sub = eventTimes(v, node.event);
      return { ...node, sub, fullLabel: node.event + ' · ' + sub };
    });
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
  const stringMatch = step => stringMatchFrame(text, pattern, step);
  const frames = {
    'bracket-matching': step => bracketFrame(text, step),
    'infix-to-postfix': expression,
    'expression-evaluation': expression,
    'naive-string-match': stringMatch,
    kmp: stringMatch,
    'expression-dag': step => expressionDagFrame(step, run.steps[step.stepIndex - 1]),
    'critical-path': run.algorithm === 'critical-path' ? criticalPathFrames(run) : null,
  };
  const followExpression = step => {
    const { operators, output, stack, mode } = step.variables;
    const evaluating = step.algorithm === 'expression-evaluation';
    const active = evaluating ? evaluationTokenIndex(step) : -1;
    const position = step.event === 'postfix' ? 0 : output.length - 1;
    if (evaluating) revealCell(host, 'f-operands', stack.length - 1);
    if (mode !== 'postfix') revealCell(host, 'f-operators', operators.length - 1);
    revealCell(host, 'f-postfix', active >= 0 ? active : position);
  };
  const followMatch = step => {
    const { k, j, matches, mode } = step.variables;
    const { focus } = stringAlignment(step, pattern.length);
    revealCell(host, 'f-match', matchCell(focus, focus < MATCH_COLUMNS ? 1 : 0));
    revealCell(host, 'f-match', matchCell(focus, 3));
    if (mode) revealCell(host, 'f-kmp-table', (k ?? j ?? 0) + ',0');
    revealCell(host, 'f-matches', matches.length - 1);
  };
  const follow = {
    'bracket-matching': step => {
      revealCell(host, 'f-text', step.variables.i ?? (step.done ? text.length - 1 : 0));
      revealCell(host, 'f-brackets', step.variables.stack.length - 1);
    },
    'infix-to-postfix': followExpression,
    'expression-evaluation': followExpression,
    'naive-string-match': followMatch,
    kmp: followMatch,
    'expression-dag': step => {
      followExpression(step);
      revealCell(host, 'f-build-stack', step.variables.stack.length - 1);
    },
  }[run.algorithm];
  const stateTable = follow ? null : createCriticalPathStateTable(input);
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
