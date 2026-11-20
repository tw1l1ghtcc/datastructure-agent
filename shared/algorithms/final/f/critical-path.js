import { validateGraphInput } from '../b/validate-util.js';
import { fSource, fTrace } from './f-trace.js';

const source = fSource('critical-path', `
struct Activity { int from, to; long long weight; };
void save_paths(int from, const Activity edges[], int m, const bool critical[],
                int path[], int depth, int paths[][30], int lengths[], int *count) {
  if (*count == 9) return;
  bool terminal = true;
  for (int j = 0; j < m; ++j) {
    if (!critical[j] || edges[j].from != from) continue;
    terminal = false;
    path[depth] = j;
    save_paths(edges[j].to, edges, m, critical, path, depth + 1, paths, lengths, count);
    if (*count == 9) return;
  }
  if (terminal && depth > 0) {
    for (int k = 0; k < depth; ++k) paths[*count][k] = path[k];
    lengths[(*count)++] = depth;
  }
}
// Weights and times use units of 0.001. Endpoints are zero-based vertex indices.
bool critical_path(int n, const Activity edges[], int m, int order[],
                   long long earliest[], long long latest[], long long slack[],
                   long long *duration, bool critical[], int paths[][30], int lengths[], int *count) {
  int degree[30] = {0}, queue[30], head = 0, tail = 0, sorted = 0; // @init
  for (int j = 0; j < m; ++j) ++degree[edges[j].to];
  for (int i = 0; i < n; ++i) {
    earliest[i] = 0;
    if (!degree[i]) queue[tail++] = i;
  }
  int sources = tail; // @sources
  while (head < tail) {
    int u = queue[head++]; order[sorted++] = u; // @visit
    for (int j = 0; j < m; ++j) if (edges[j].from == u) {
      int v = edges[j].to;
      long long candidate = earliest[u] + edges[j].weight;
      if (candidate > earliest[v]) earliest[v] = candidate;
      if (--degree[v] == 0) queue[tail++] = v; // @earliest
    }
  }
  if (sorted != n) return false; // @cycle
  *duration = 0;
  for (int i = 0; i < n; ++i) if (earliest[i] > *duration) *duration = earliest[i];
  for (int i = 0; i < n; ++i) latest[i] = *duration; // @duration
  for (int i = n - 1; i >= 0; --i) {
    int u = order[i];
    for (int j = 0; j < m; ++j) if (edges[j].from == u) {
      long long candidate = latest[edges[j].to] - edges[j].weight;
      if (candidate < latest[u]) latest[u] = candidate; // @latest
    }
  }
  for (int j = 0; j < m; ++j) {
    slack[j] = latest[edges[j].to] - edges[j].weight - earliest[edges[j].from];
    critical[j] = slack[j] == 0; // @slack
  }
  int path[30]; *count = 0;
  for (int i = 0; i < sources && *count < 9; ++i)
    save_paths(queue[i], edges, m, critical, path, 0, paths, lengths, count); // @paths
  return true; // @done
}
`);

function weightUnits(weight) {
  const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(String(weight));
  if (!match || weight > 1e9) throw new RangeError('工期必须在 0 到 10 亿之间，最多三位小数。');
  return Number(match[1] + (match[2] ?? '').padEnd(3, '0'));
}

export function generateCriticalPathSteps(input) {
  if (!Array.isArray(input?.nodes) || input.nodes.length > 30 || !Array.isArray(input?.edges) || input.edges.length > 120) {
    throw new RangeError('关键路径最多支持 30 个顶点和 120 条活动。');
  }
  if (input.directed !== undefined && input.directed !== true) throw new TypeError('关键路径只接受有向图。');
  try {
    validateGraphInput(input, '关键路径', true);
  } catch (error) {
    throw new TypeError(error.message, { cause: error });
  }
  const { nodes, edges } = input;
  const nodeIndexes = new Map(nodes.map((node, index) => [node, index]));
  // 每行是一项独立活动，同一对顶点间的并行活动按输入顺序保留。
  const activities = edges.map(([from, to, weight], id) => ({
    id, u: nodeIndexes.get(from), v: nodeIndexes.get(to), units: weightUnits(weight),
  }));
  const outgoing = nodes.map(() => []);
  const degree = nodes.map(() => 0);
  const queue = [], order = [], slack = [], criticalEdges = [];
  const earliest = nodes.map(() => 0);
  const latest = nodes.map(() => null);
  const trace = fTrace(source, { order, slack, criticalEdges });
  const times = (items) => Object.fromEntries(nodes.map((node, i) => [node, items[i] === null ? null : items[i] / 1000]));
  const view = () => ({ earliest: times(earliest), latest: times(latest), queue: queue.map(i => nodes[i]) });
  trace.record('init', '初始化活动网络与时间表。', view());
  for (const edge of activities) {
    degree[edge.v] += 1;
    outgoing[edge.u].push(edge);
  }
  const sources = degree.flatMap((value, index) => value === 0 ? [index] : []);
  queue.push(...sources);
  trace.record('sources', '将所有零入度事件加入队列。', view());
  while (queue.length) {
    const u = queue.shift();
    order.push(nodes[u]);
    trace.record('visit', '将事件 ' + nodes[u] + ' 加入拓扑序。', { ...view(), currentNode: nodes[u] });
    for (const edge of outgoing[u]) {
      earliest[edge.v] = Math.max(earliest[edge.v], earliest[u] + edge.units);
      degree[edge.v] -= 1;
      if (degree[edge.v] === 0) queue.push(edge.v);
      trace.record('earliest', '检查该活动是否推迟终点的最早时刻。', { ...view(), currentEdge: edges[edge.id], activityIndex: edge.id });
    }
  }
  if (order.length !== nodes.length) {
    return trace.finish('cycle', '图中存在有向环，无法确定工期。', { error: '图中存在有向环。', order }, view());
  }
  const duration = Math.max(...earliest);
  latest.fill(duration);
  trace.record('duration', '以全部事件的最大最早时刻作为总工期。', { ...view(), duration: duration / 1000 });
  for (let i = order.length - 1; i >= 0; i -= 1) {
    const u = nodeIndexes.get(order[i]);
    for (const edge of outgoing[u]) {
      latest[u] = Math.min(latest[u], latest[edge.v] - edge.units);
      trace.record('latest', '逆拓扑检查起点的最迟时刻。', { ...view(), currentEdge: edges[edge.id], activityIndex: edge.id });
    }
  }
  for (const { id, u, v, units } of activities) {
    const float = (latest[v] - units - earliest[u]) / 1000;
    slack.push({ id, edge: edges[id], float });
    if (float === 0) criticalEdges.push(id);
    trace.record('slack', float === 0 ? '时差为零，标记关键活动。' : '该活动有可用时差。', { ...view(), currentEdge: edges[id], activityIndex: id });
  }

  const critical = new Set(criticalEdges);
  const paths = [];
  function collect(u, path) {
    const next = outgoing[u].filter(edge => critical.has(edge.id));
    if (!next.length && path.length) paths.push(path);
    for (const edge of next) {
      if (paths.length === 9) break;
      collect(edge.v, [...path, edge.id]);
    }
  }
  for (const u of sources) {
    if (paths.length === 9) break;
    collect(u, []);
  }
  const criticalPaths = paths.slice(0, 8).map(path => path.map(id => edges[id]));
  trace.record('paths', '沿关键活动找到从项目起点到终点的路径。', { ...view(), criticalPaths });
  return trace.finish('done', '总工期为 ' + duration / 1000 + '。', {
    duration: duration / 1000, earliest: times(earliest), latest: times(latest), order,
    activities: slack, criticalEdges: criticalEdges.map(id => edges[id]), criticalPaths, morePaths: paths.length > 8,
  }, { ...view(), duration: duration / 1000, criticalPaths });
}
