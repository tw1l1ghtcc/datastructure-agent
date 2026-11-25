const sequence = list => list.join(' → ') || '空';
const change = (before, after) => before === after ? String(after) : before + ' → ' + after;
const arrayText = values => '[' + (values ?? []).join('、') + ']';
const listChange = (before, after) => change(arrayText(before), arrayText(after));

export function describeGraphStep(run, step) {
  const { variables: state, event, description: action, done } = step;
  const previous = run.steps[step.stepIndex - 1]?.variables ?? {};
  const [, neighbor, weight] = state.currentEdge ?? [];
  const node = state.currentNode;
  const start = run.graph.start;
  let detail;

  switch (run.algorithm) {
    case 'bfs': {
      const queue = '队列（队首到队尾）：' + listChange(previous.queue, state.queue) + '。';
      if (done) detail = '队列已空，从 ' + start + ' 可达的顶点已遍历完毕。发现顺序为 ' + sequence(state.discoveryOrder) + '。';
      else if (event === 'dequeue') detail = queue + ' 从队首取出 ' + node + '，接下来检查它的邻点。';
      else if (event.startsWith('enqueue-')) detail = queue + ' 新发现的顶点排在队尾，已在队列中的顶点先处理。';
      else if (event === 'skip-neighbor') detail = neighbor + ' 已标记，跳过它可避免重复入队。' + queue;
      else if (event.startsWith('mark-')) detail = '发现顺序变为 ' + sequence(state.discoveryOrder) + '。先标记，再入队。';
      else detail = queue + ' 已发现：' + sequence(state.discoveryOrder) + '。';
      break;
    }
    case 'dfs': {
      const stack = '栈（栈底到栈顶）：' + listChange(previous.stack, state.stack) + '。';
      if (done) detail = '栈已空，从 ' + start + ' 出发的探索结束。发现顺序为 ' + sequence(state.discoveryOrder) + '。';
      else if (event === 'pop') detail = stack + (state.stack.length
        ? ' 回到栈顶 ' + state.stack.at(-1) + '，继续找尚未访问的邻点。' : ' 已退回到空栈。');
      else if (event.startsWith('push-')) detail = stack + ' 接下来从新的栈顶继续向深处探索。';
      else detail = stack + ' 发现顺序：' + sequence(state.discoveryOrder) + '。';
      break;
    }
    case 'prim':
      if (done) detail = '从 ' + start + ' 纳入树的顶点有 ' + state.inMST.length + ' 个，树边总权重为 ' + state.totalWeight + '。';
      else if (event === 'update-key') detail = neighbor + ' 的候选连边权重由 ' + previous.key[neighbor] + ' 更新为 ' + state.key[neighbor] + '，连接到 ' + state.parent[neighbor] + '。';
      else if (event === 'check-relax') detail = '比较边权 ' + weight + ' 与 ' + neighbor + ' 的当前候选权重 ' + state.key[neighbor] + '。只保留更轻的连边。';
      else if (event === 'find-min') detail = node + ' 的候选权重 ' + state.key[node] + ' 最小，本轮优先把它纳入树。';
      else detail = '树中顶点：' + sequence(state.inMST) + '。树边总权重 ' + change(previous.totalWeight ?? 0, state.totalWeight) + '。';
      break;
    case 'kruskal':
      if (done) detail = '共选入 ' + state.selectedEdges.length + ' 条边，总权重为 ' + state.totalWeight + '。';
      else if (event === 'union') detail = '两端原属不同集合，合并后选边数为 ' + state.selectedEdges.length + '，总权重 ' + change(previous.totalWeight, state.totalWeight) + '。';
      else if (event === 'sort') detail = '先检查轻边，再用并查集判断选入后是否会成环。';
      else if (state.currentEdge) detail = '当前边权为 ' + weight + '。两端同属一个集合时，加这条边会成环。';
      else detail = '已选 ' + state.selectedEdges.length + ' 条边，总权重为 ' + state.totalWeight + '。';
      break;
    case 'dijkstra':
      if (done) detail = '从 ' + start + ' 可达的顶点距离已确定。标为 ∞ 的顶点从起点不可达。';
      else if (event === 'check-relax' || event === 'update-dist') {
        const oldDistance = (previous.dist ?? state.dist)[neighbor];
        const candidate = state.dist[node] + weight;
        detail = '经 ' + node + ' 到 ' + neighbor + ' 的候选距离为 ' + state.dist[node] + ' + ' + weight + ' = ' + candidate + '。' +
          (event === 'update-dist' ? '距离由 ' + oldDistance + ' 更新为 ' + state.dist[neighbor] + '，前驱改为 ' + node + '。'
            : '当前记录为 ' + state.dist[neighbor] + '，只有候选距离更小时才更新。');
      } else if (event === 'find-min') detail = node + ' 的暂定距离 ' + state.dist[node] + ' 最小，接下来确定它的最短距离。';
      else detail = '起点为 ' + start + '。已确定的顶点：' + sequence(state.visited) + '。';
      break;
    case 'floyd': {
      const { currentI: i, currentJ: j, currentK: k } = state;
      if (done) detail = step.result === 'Has Negative Cycle' ? '负权环上的路径可重复绕行，相关顶点之间没有有限的最短距离。'
        : '所有中转点均已检查。距离矩阵的行是起点、列是终点，∞ 表示不可达。';
      else if (j !== null) {
        const nodes = run.graph.nodes;
        const matrix = event === 'update' ? previous.matrix : state.matrix;
        const distance = (from, to) => matrix[nodes.indexOf(from)].split(', ')[nodes.indexOf(to)];
        const left = distance(i, k), right = distance(k, j), old = distance(i, j);
        const candidate = state.candidateDistance ?? (Number(left) + Number(right));
        detail = left === '∞' || right === '∞' ? '至少有一段不可达，不能经 ' + k + ' 从 ' + i + ' 到 ' + j + '。'
          : '经 ' + k + ' 的候选距离为 ' + left + ' + ' + right + ' = ' + candidate +
            '，原距离为 ' + old + '。' + (event === 'update' ? '候选更短，已更新矩阵。' : '只有候选更短时才更新矩阵。');
      } else detail = k === null ? '距离矩阵记录顶点之间的距离，∞ 表示目前没有可达路径。'
        : '本轮检查经过 ' + k + ' 的路线，看看能否缩短原距离。';
      break;
    }
    case 'topological-sort':
      if (done) detail = step.result === 'Has Cycle' ? '零入度队列已空，但只输出了 ' + state.resultOrder.length + ' / ' + run.graph.nodes.length + ' 个顶点。'
        : '拓扑顺序为 ' + sequence(state.resultOrder) + '。每条有向边的起点均排在终点之前。';
      else if (state.currentEdge) {
        const degree = state.inDegree[neighbor];
        const oldDegree = previous.inDegree[neighbor];
        detail = neighbor + ' 的入度' + (degree === oldDegree ? '当前为 ' + degree + '，接下来减 1。'
          : '由 ' + oldDegree + ' 减为 ' + degree + (degree === 0 ? '，它已加入零入度队列。' : '，仍有前置顶点。'));
      } else detail = '零入度队列：' + sequence(state.queue) + '。已输出：' + sequence(state.resultOrder) + '。';
      break;
  }
  return { action, detail };
}
