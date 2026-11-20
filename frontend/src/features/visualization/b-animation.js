import { createStage } from '../../../vendor/plus/app/svg-stage.js';
import { graphLayer } from '../../../vendor/plus/vendor/engine/model.js';
import { createExplanationPanel } from './explanation-panel.js';
import { describeGraphStep } from './graph-explanation.js';
import { createUnionFindTable } from './union-find-table.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function vertexLayout(nodes) {
  const columns = Math.ceil(Math.sqrt(nodes.length * 1.5));
  const rows = Math.ceil(nodes.length / columns);
  return nodes.map((id, index) => {
    const chars = [...id];
    const label = chars.length > 4 ? chars.slice(0, 3).join('') + '…' : id;
    const node = { id, label };
    if (nodes.length === 1) return { ...node, x: 0.5, y: 0.5 };
    if (nodes.length <= 12) return node;
    return { ...node, x: index % columns / (columns - 1), y: Math.floor(index / columns) / (rows - 1) };
  });
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
  return { vertices: vertexLayout(nodes), links, keyOf, discoveryAt };
}

function graphFrame(run, graph, step) {
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
  const nodes = graph.vertices.map(node => labels ? { ...node, sub: labels[node.id] } : node);
  return graphLayer({
    id: 'b-graph', title: '输入图', nodes, edges, directed: run.graph.directed,
    props: { routedEdges: true },
    roles: {
      done: [...done],
      focus1: [v.currentNode, v.currentK].filter(id => id != null),
      focus2: [v.currentI, v.currentJ, ...(v.currentEdge?.slice(0, 2) ?? []), ...(v.queue ?? [])].filter(id => id != null),
    },
  });
}

function forestFrame(vertices, step, previous) {
  const { parent, currentOp, findPath } = step.variables;
  const changed = previous ? vertices.filter(({ id }) => parent[id] !== previous.variables.parent[id]).map(({ id }) => id) : [];
  const pathEdges = new Map((findPath ?? []).slice(1).map((to, index) => [findPath[index], to]));
  const edges = vertices.flatMap(({ id }) => parent[id] === id ? [] : [{
    from: id, to: parent[id],
    state: changed.includes(id) ? 'active' : pathEdges.get(id) === parent[id] ? 'path' : 'tree',
  }]);
  return graphLayer({
    id: 'b-forest', title: '父指针森林 · 箭头指向父节点', nodes: vertices, edges, directed: true, weighted: false,
    props: { routedEdges: true },
    roles: {
      done: vertices.filter(({ id }) => parent[id] === id).map(({ id }) => id),
      focus1: changed,
      focus2: [...(currentOp?.slice(1) ?? []), ...(findPath ?? [])],
    },
  });
}

function createDistanceTable(nodes) {
  const table = document.createElement('table');
  table.className = 'uf-table';
  table.createCaption().textContent = '距离矩阵（行是起点，列是终点）';
  const header = table.createTHead().insertRow();
  for (const label of ['起点', ...nodes]) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = label;
    header.append(th);
  }

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
  const vertices = graph?.vertices ?? vertexLayout(run.input.elements);
  const element = document.createElement('div');
  element.dataset.vizEngine = 'plus-graph';
  element.className = 'b-animation';
  element.classList.toggle('b-animation-wide', vertices.length > 12);
  const canvas = document.createElement('div');
  canvas.className = 'plus-viz b-animation-stage';
  element.append(canvas);
  host.append(element);
  const stage = createStage(canvas);
  const stateTable = !graph ? createUnionFindTable(run.input)
    : run.algorithm === 'floyd' ? createDistanceTable(run.graph.nodes) : null;
  if (stateTable) {
    const data = document.createElement('div');
    data.className = 'b-animation-data';
    data.classList.toggle('b-animation-matrix', run.algorithm === 'floyd');
    data.tabIndex = 0;
    data.setAttribute('role', 'region');
    data.setAttribute('aria-label', graph ? '距离矩阵' : '父节点与秩');
    data.append(stateTable.element);
    element.append(data);
  }
  const { explain, caption, status } = createExplanationPanel();
  explainHost.replaceChildren(explain);

  let current = null;
  function showStep(step) {
    current = step;
    const previous = run.steps[step.stepIndex - 1];
    const frame = graph ? graphFrame(run, graph, step) : forestFrame(vertices, step, previous);
    stage.render([frame]);
    installVertexTitles(canvas, vertices);
    const svg = canvas.querySelector('.avc-svg');
    svg?.setAttribute('role', 'img');
    svg?.setAttribute('aria-label', frame.title);
    stateTable?.showStep(step, previous);
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
      stage.clear();
      element.remove();
      explain.remove();
    },
  };
}
