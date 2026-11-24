import { graphLayer } from '../../../vendor/plus/vendor/engine/model.js';
import { createStringMatchAnimation } from './f-string-match-animation.js';
import { createBracketAnimation, createExpressionEvaluationAnimation, createInfixToPostfixAnimation } from './f-sequence-animation.js';
import { createCriticalPathStateTable } from './f-state-table.js';
import { compactLabel, createTraceAnimation, indexedCard, sequenceLayer } from './trace-animation.js';

const WINDOW_SIZE = 10;
const charLabels = { ' ': '空格', '\t': '制表符', '\n': '换行', '\r': '回车' };
const showChar = char => charLabels[char] ?? char;
const nodeId = index => 'f' + index;

function tail(id, title, values, markTop = false) {
  return sequenceLayer(id, title, values, { focus2: markTop ? [values.length - 1] : [] },
    { first: Math.max(0, values.length - WINDOW_SIZE) });
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

function dagConversionLayers(step, previous) {
  const { operators, output, nodes } = step.variables;
  const appended = output.length > (previous?.variables.output.length ?? 0);
  const title = step.result?.error && !nodes.length ? '已输出词元 · ' + step.result.error : '后缀序列（格下为原下标）';
  return [
    tokenCard('f-operators', '运算符栈（底到顶，格下为原下标）', operators, { focus2: [operators.length - 1] }),
    tokenCard('f-postfix', title, output, { added: appended ? [output.length - 1] : [] }),
  ];
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
  const layers = dagConversionLayers(step, previous);
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
  if (run.algorithm === 'kmp' || run.algorithm === 'naive-string-match') {
    return createStringMatchAnimation(host, explainHost, run, config, text, pattern);
  }
  if (run.algorithm === 'bracket-matching') return createBracketAnimation(host, explainHost, run, config, text);
  if (run.algorithm === 'infix-to-postfix') return createInfixToPostfixAnimation(host, explainHost, run, config);
  if (run.algorithm === 'expression-evaluation') return createExpressionEvaluationAnimation(host, explainHost, run, config);
  const dag = run.algorithm === 'expression-dag';
  const stateTable = dag ? null : createCriticalPathStateTable(input);
  const frameFor = dag
    ? step => expressionDagFrame(step, run.steps[step.stepIndex - 1])
    : criticalPathFrames(run);
  const animation = createTraceAnimation(host, explainHost, stateTable, frameFor, 'f', { run, config });
  if (!dag) return animation;

  function follow(step) {
    const { operators, output, stack } = step.variables;
    revealCell(host, 'f-operators', operators.length - 1);
    revealCell(host, 'f-postfix', output.length - 1);
    revealCell(host, 'f-build-stack', stack.length - 1);
  }
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
