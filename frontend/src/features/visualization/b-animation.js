import { createStage } from '../../../vendor/plus/app/svg-stage.js';
import { graphLayer } from '../../../vendor/plus/vendor/engine/model.js';
import { createExplanationPanel } from './explanation-panel.js';
import { describeGraphStep } from './graph-explanation.js';
import { createUnionFindTable } from './union-find-table.js';
import { createTraversalList } from './b-traversal-list.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const GRAPH_STATE_LABELS = new Map([
  ['bfs', '队列'],
  ['dfs', '栈'],
  ['union-find', '父节点与秩'],
  ['floyd', '距离矩阵'],
  ['dijkstra', '最短路径状态表'],
]);

export function graphStateLabel(algorithm) {
  return GRAPH_STATE_LABELS.get(algorithm);
}

function graphVertices(nodes) {
  return nodes.map(id => {
    const chars = [...id];
    const label = chars.length > 4 ? chars.slice(0, 3).join('') + '…' : id;
    return { id, label };
  });
}

function viewportGraphLayout(vertices, { width, height }) {
  const count = vertices.length;
  const spanX = Math.max(1, width - 80);
  const spanY = Math.max(1, height - 80);
  // Keep the same rows as the explanation above the graph grows or collapses.
  const columns = Math.max(1, Math.min(count, Math.max(2, Math.round(Math.sqrt(count * spanX / 340)))));
  const rows = Math.ceil(count / columns);
  const positions = vertices.map((_, index) => {
    if (count === 1) return [0, 0];
    if (count === 2) {
      const offset = index === 0 ? -1 : 1;
      return width >= 320 ? [offset, 0] : [0, offset];
    }
    if (count <= 8) {
      const phase = count === 4 ? -Math.PI / 4 : -Math.PI / 2;
      const angle = phase + 2 * Math.PI * index / count;
      return [Math.cos(angle), Math.sin(angle)];
    }
    const row = Math.floor(index / columns);
    const rowSize = Math.min(columns, count - row * columns);
    return [index % columns - (rowSize - 1) / 2, row - (rows - 1) / 2];
  });
  // Scale both axes in pixels before converting to the renderer's normalized coordinates.
  const extentX = Math.max(0.5, ...positions.map(([x]) => Math.abs(x)));
  const extentY = Math.max(0.5, ...positions.map(([, y]) => Math.abs(y)));
  const scale = 0.44 * Math.min(spanX / extentX, spanY / extentY);
  const nodes = vertices.map((node, index) => {
    const [x, y] = positions[index];
    return { ...node, x: 0.5 + x * scale / spanX, y: 0.5 + y * scale / spanY };
  });
  let spacing = Math.min(width, height) * 0.42;
  for (const [index, node] of nodes.entries()) {
    for (const other of nodes.slice(index + 1)) {
      spacing = Math.min(spacing, Math.hypot((node.x - other.x) * spanX, (node.y - other.y) * spanY));
    }
  }
  const nodeRadius = Math.max(12, Math.min(36, Math.round(spacing * 0.32)));
  return {
    nodes,
    style: {
      nodeRadius,
      nodeLabelSize: Math.max(11, Math.min(17, Math.round(nodeRadius * 0.47))),
      nodeDetailSize: nodeRadius >= 22 ? 12 : 10,
      edgeLabelSize: nodeRadius >= 22 ? 12 : 10,
    },
  };
}

function makeEdgeKey(directed) {
  return (from, to) => JSON.stringify(directed || from <= to ? [from, to] : [to, from]);
}

function prepareGraph(run) {
  const { nodes, edges, directed } = run.graph;
  const keyOf = makeEdgeKey(directed);
  const discoveryAt = new Map();
  const discoveryEvent = run.algorithm === 'bfs' ? 'mark-neighbor' : run.algorithm === 'dfs' ? 'find-neighbor' : null;
  if (discoveryEvent) {
    for (const step of run.steps) {
      if (step.event === discoveryEvent) {
        const key = keyOf(...step.variables.currentEdge);
        if (!discoveryAt.has(key)) discoveryAt.set(key, step.stepIndex);
      }
    }
  }
  const pairs = new Set(edges.map(edge => keyOf(...edge)));
  const links = edges.map(([from, to, w]) => ({
    from, to, w, bend: directed && from !== to && pairs.has(keyOf(to, from)),
  }));
  return { vertices: graphVertices(nodes), links, keyOf, discoveryAt };
}

function graphFrame(run, graph, step, viewportSize) {
  const v = step.variables;
  const { keyOf, discoveryAt } = graph;
  const done = new Set(v.visited ?? v.inMST ?? v.resultOrder ?? []);
  const active = v.currentEdge ? keyOf(...v.currentEdge) : null;
  const previous = run.steps[step.stepIndex - 1];
  const rejected = run.algorithm === 'kruskal' && step.event === 'check-root' && previous?.event === 'check-root' &&
    previous.variables.currentEdge && keyOf(...previous.variables.currentEdge) === active;
  const states = new Map();
  if (run.algorithm === 'prim') {
    for (const { id } of graph.vertices) {
      if (v.parent[id] != null) states.set(keyOf(v.parent[id], id), done.has(id) ? 'tree' : 'candidate');
    }
  }
  if (run.algorithm === 'kruskal') {
    for (const edge of v.selectedEdges) states.set(keyOf(...edge), 'tree');
  }
  if (run.algorithm === 'dijkstra') {
    for (const { id } of graph.vertices) {
      if (v.previous[id] != null) states.set(keyOf(v.previous[id], id), done.has(id) ? 'path' : 'candidate');
    }
  }

  const edges = graph.links.map(edge => {
    const key = keyOf(edge.from, edge.to);
    let state = states.get(key) ?? (discoveryAt.get(key) <= step.stepIndex ? 'tree' : 'idle');
    if (key === active) {
      if (rejected) state = 'reject';
      else if (step.event !== 'union') state = 'active';
    }
    return { ...edge, state };
  });
  const labels = v.dist ?? v.key ?? v.inDegree;
  const layout = viewportGraphLayout(graph.vertices, viewportSize);
  const nodes = layout.nodes.map(node => labels ? { ...node, sub: labels[node.id] } : node);
  return graphLayer({
    id: 'b-graph', title: '输入图', nodes, edges, directed: run.graph.directed,
    props: { routedEdges: true, ...layout.style },
    roles: {
      done: [...done],
      focus1: [v.currentNode, v.currentK].filter(id => id != null),
      focus2: [v.currentI, v.currentJ, ...(v.currentEdge?.slice(0, 2) ?? []), ...(v.queue ?? [])].filter(id => id != null),
    },
  });
}

function forestFrame(vertices, step, previous, viewportSize) {
  const { parent, currentOp, findPath } = step.variables;
  const changed = previous ? vertices.filter(({ id }) => parent[id] !== previous.variables.parent[id]).map(({ id }) => id) : [];
  const pathEdges = new Map((findPath ?? []).slice(1).map((to, index) => [findPath[index], to]));
  const edges = vertices.flatMap(({ id }) => parent[id] === id ? [] : [{
    from: id, to: parent[id],
    state: changed.includes(id) ? 'active' : pathEdges.get(id) === parent[id] ? 'path' : 'tree',
  }]);
  const layout = viewportGraphLayout(vertices, viewportSize);
  return graphLayer({
    id: 'b-forest', title: '父指针森林 · 箭头指向父节点', nodes: layout.nodes, edges, directed: true, weighted: false,
    props: { routedEdges: true, ...layout.style },
    roles: {
      done: vertices.filter(({ id }) => parent[id] === id).map(({ id }) => id),
      focus1: changed,
      focus2: [...(currentOp?.slice(1) ?? []), ...(findPath ?? [])],
    },
  });
}

function createGraphTable(caption, columns) {
  const table = document.createElement('table');
  table.className = 'uf-table';
  table.createCaption().textContent = caption;
  const header = table.createTHead().insertRow();
  for (const label of columns) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = label;
    header.append(th);
  }
  return table;
}

function createDistanceMatrix(nodes) {
  const table = createGraphTable('距离矩阵（行是起点，列是终点）', ['起点', ...nodes]);
  const body = table.createTBody();
  const cells = nodes.map(from => {
    const row = body.insertRow();
    const heading = document.createElement('th');
    heading.scope = 'row';
    heading.textContent = from;
    row.append(heading);
    return nodes.map(() => row.insertCell());
  });
  return {
    element: table,
    showStep({ variables: { matrix, currentI, currentJ, currentK } }) {
      matrix.forEach((line, row) => line.split(', ').forEach((distance, col) => {
        const cell = cells[row][col];
        cell.textContent = distance;
        const from = nodes[row], to = nodes[col];
        cell.dataset.active = from === currentI && to === currentJ ? 'target'
          : currentI !== null && currentJ !== null &&
            ((from === currentI && to === currentK) || (from === currentK && to === currentJ)) ? 'via' : '';
      }));
    },
  };
}

function createDijkstraTable({ nodes, start }) {
  const table = createGraphTable('最短路径状态表（起点：' + start + '）', ['顶点', '距离', '前驱', '已确定']);
  const body = table.createTBody();
  const cells = nodes.map(node => {
    const row = body.insertRow();
    const heading = document.createElement('th');
    heading.scope = 'row';
    heading.textContent = node;
    row.append(heading);
    return [node, row.insertCell(), row.insertCell(), row.insertCell()];
  });
  return {
    element: table,
    showStep({ event, variables: { dist, previous, visited, currentEdge, currentNode } }) {
      const settled = new Set(visited);
      const [from, to] = currentEdge ?? [];
      const target = event === 'start-dist' ? start : to;
      for (const [node, distance, predecessor, confirmed] of cells) {
        distance.textContent = dist[node];
        predecessor.textContent = previous[node] ?? '—';
        confirmed.textContent = settled.has(node) ? '是' : '否';
        distance.dataset.active = node === target ? 'target' : node === from ? 'via' : '';
        predecessor.dataset.active = node === to && event === 'update-dist' ? 'target' : '';
        confirmed.dataset.active = node === currentNode && event === 'mark-visited' ? 'target' : '';
      }
    },
  };
}

function installVertexTitles(host, vertices) {
  const byKey = new Map(vertices.map(({ id }) => ['n-' + id, id]));
  for (const shape of host.querySelectorAll('[data-avc-key^="n-"]')) {
    const id = byKey.get(shape.dataset.avcKey);
    if (id === undefined) continue;
    shape.dataset.graphNode = id;
    let title = shape.querySelector('title');
    if (!title) {
      title = document.createElementNS(SVG_NS, 'title');
      shape.prepend(title);
    }
    title.textContent = id;
  }
}

export function createBAnimation(host, run, explainHost) {
  const graph = run.graph ? prepareGraph(run) : null;
  const vertices = graph?.vertices ?? graphVertices(run.input.elements);
  const traversal = run.algorithm === 'bfs' || run.algorithm === 'dfs';
  let stateView;
  if (traversal) stateView = createTraversalList(run.algorithm);
  else if (!graph) stateView = createUnionFindTable(run.input);
  else if (run.algorithm === 'floyd') stateView = createDistanceMatrix(run.graph.nodes);
  else if (run.algorithm === 'dijkstra') stateView = createDijkstraTable(run.graph);
  const element = document.createElement('div');
  element.dataset.vizEngine = 'plus-graph';
  element.className = 'b-animation';
  const canvas = document.createElement('div');
  canvas.className = 'plus-viz b-animation-stage';
  if (stateView) {
    element.classList.add('b-animation-split');
    element.classList.toggle('b-animation-paths', Boolean(graph) && !traversal);
    element.classList.toggle('b-animation-traversal', traversal);
    element.classList.toggle('b-animation-matrix', run.algorithm === 'floyd');
    const data = document.createElement('div');
    data.className = 'b-animation-data';
    data.tabIndex = 0;
    data.setAttribute('role', 'region');
    data.setAttribute('aria-label', graphStateLabel(run.algorithm));
    data.append(stateView.element);
    const graphPane = document.createElement('div');
    graphPane.className = 'b-graph-viewport';
    graphPane.append(canvas);
    element.append(data, graphPane);
  } else {
    element.append(canvas);
  }
  host.append(element);
  const stage = createStage(canvas, { fillViewport: true });
  const { explain, caption, status } = createExplanationPanel();
  explainHost.replaceChildren(explain);

  let current = null;
  function draw(step, animate = true) {
    const viewportSize = { width: canvas.clientWidth, height: canvas.clientHeight };
    const previous = run.steps[step.stepIndex - 1];
    const frame = graph ? graphFrame(run, graph, step, viewportSize) : forestFrame(vertices, step, previous, viewportSize);
    stage.render([frame], { animate });
    installVertexTitles(canvas, vertices);
    const svg = canvas.querySelector('.avc-svg');
    svg?.setAttribute('role', 'img');
    svg?.setAttribute('aria-label', frame.title);
  }
  const observer = new ResizeObserver(() => {
    if (current) draw(current, false);
  });
  observer.observe(canvas);

  function showStep(step) {
    current = step;
    draw(step);
    const previous = run.steps[step.stepIndex - 1];
    stateView?.showStep(step, previous);
    const explanation = graph ? describeGraphStep(run, step) : {
      action: step.description,
      detail: '集合数量：' + step.variables.setCount +
        (step.variables.findPath ? ' ｜ 查找路径：' + step.variables.findPath.join(' → ') : ''),
    };
    caption.textContent = explanation.action;
    status.textContent = '第 ' + (step.stepIndex + 1) + ' 步' + (explanation.detail ? ' ｜ ' + explanation.detail : '');
  }
  return {
    showStep,
    getStep: () => current,
    playEnterAnimation() {
      if (!current) return;
      stage.clear();
      showStep(current);
    },
    destroy() {
      observer.disconnect();
      stateView?.destroy?.();
      stage.clear();
      element.remove();
      explain.remove();
    },
  };
}
