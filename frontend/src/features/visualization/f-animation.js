import { graphLayer } from '../../../vendor/plus/vendor/engine/model.js';
import { createStringMatchAnimation } from './f-string-match-animation.js';
import { createBracketAnimation, createExpressionEvaluationAnimation, createInfixToPostfixAnimation } from './f-sequence-animation.js';
import { createCriticalPathState, createExpressionDagState } from './f-state-table.js';
import { compactLabel, createTraceAnimation } from './trace-animation.js';

const charLabels = { ' ': '空格', '\t': '制表符', '\n': '换行', '\r': '回车' };
const showChar = char => charLabels[char] ?? char;
const nodeId = index => 'f' + index;

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

function graphScene(id, title, layout, edges, roles) {
  return graphLayer({
    id, title, nodes: layout.nodes, edges, directed: true, roles,
    props: { canvasWidth: layout.canvasWidth, canvasHeight: layout.canvasHeight, routedEdges: true, showLegend: false,
      nodeRadius: 24, nodeLabelSize: 13, nodeDetailSize: 11, nodeDetailOffset: 24 },
  });
}

function dagNodes(v) {
  return v.nodes.map(node => {
    const label = compactLabel(node.token, 5);
    const number = '#' + node.id;
    const sub = Object.hasOwn(v.cache, node.id) ? number + ' = ' + v.cache[node.id]
      : label !== node.token ? number + ' · ' + node.token : number;
    return { id: nodeId(node.id), label, sub, fullLabel: node.token + ' · ' + sub, badge: v.root === node.id ? '根' : undefined };
  });
}

function dagEdges(records, current) {
  return routeEdges(records.map(([from, to, role]) => ({
    from: nodeId(from), to: nodeId(to), w: role === '左操作数' ? '左' : '右',
    state: to === current ? 'active' : 'idle',
  })));
}

function dagCurrent(step) {
  const v = step.variables;
  return step.result?.error ? v.nodes.find(node => node.index === v.index)?.id : v.currentNode;
}

function expressionDagFrames(run) {
  const final = run.steps.at(-1).variables;
  const nodes = dagNodes(final);
  const columnWidth = Math.max(138, ...nodes.map(node => node.sub.length * 7 + 20));
  // Reserve positions using the completed dependency graph. Each frame only draws its own nodes and edges.
  const layout = placeGraph(nodes, dagEdges(final.edges), columnWidth);
  const positions = new Map(layout.nodes.map(({ id, x, y }) => [id, { x, y }]));
  return step => {
    const v = step.variables;
    const current = dagCurrent(step);
    const error = step.result?.error;
    const title = error ? '表达式依赖图 · ' + error : '表达式依赖图（箭头指向使用节点）';
    const visible = dagNodes(v).map(node => ({ ...node, ...positions.get(node.id) }));
    const scene = visible.length ? { ...layout, nodes: visible } : { nodes: [], canvasWidth: 320, canvasHeight: 234 };
    return [graphScene('f-expression-dag', title, scene, dagEdges(v.edges, current), {
      swap: current == null ? [] : [nodeId(current)], done: v.order.map(nodeId),
    })];
  };
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
      columnWidth = Math.max(columnWidth, eventTimes(step.variables, event).length * 7 + 20);
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
      graphScene('f-activities', '活动网络（红色为当前活动，绿色为关键活动）', { ...layout, nodes: timed }, activities, {
        swap: [ids.get(v.currentNode)].filter(Boolean), done: v.order.map(event => ids.get(event)),
      }),
    ];
  };
}

function revealGraphNode(viewport, id) {
  const circle = viewport.querySelector(`[data-avc-key="n-${nodeId(id)}"] circle`);
  if (!circle) return;
  const node = circle.getBoundingClientRect();
  const frame = viewport.getBoundingClientRect();
  if (node.left < frame.left || node.right > frame.left + viewport.clientWidth) {
    viewport.scrollLeft += (node.left + node.right - viewport.clientWidth) / 2 - frame.left;
  }
  if (node.top < frame.top || node.bottom > frame.top + viewport.clientHeight) {
    viewport.scrollTop += (node.top + node.bottom - viewport.clientHeight) / 2 - frame.top;
  }
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
  const state = dag ? createExpressionDagState(run) : createCriticalPathState(input);
  const frameFor = dag ? expressionDagFrames(run) : criticalPathFrames(run);
  const animation = createTraceAnimation(host, explainHost, state, frameFor, 'f', { run, config, fillViewport: true });
  const viewport = host.querySelector('.trace-animation-viewport');
  const eventIndices = dag ? null : new Map(input.nodes.map((id, index) => [id, index]));
  return {
    ...animation,
    showStep(step) {
      animation.showStep(step);
      if (!step.stepIndex) viewport.scrollTo(0, 0);
      const v = step.variables;
      const target = dag ? dagCurrent(step) ?? v.root : eventIndices.get(v.currentNode ?? v.currentEdge?.[step.event === 'latest' ? 0 : 1]);
      if (target != null) revealGraphNode(viewport, target);
    },
  };
}
