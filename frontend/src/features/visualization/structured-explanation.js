import { stateText } from '../workbench/c-algorithms.js';
import { eVariableText } from '../workbench/e-state.js';
import { gVariableText } from '../workbench/g-state.js';

function short(value) {
  if (Array.isArray(value)) {
    if (!value.length) return '空';
    const items = value.slice(0, 6).map(short).join('、');
    return value.length > 6 ? items + '…（共 ' + value.length + ' 项）' : items;
  }
  const text = stateText(value);
  return text.length > 96 ? text.slice(0, 95) + '…' : text;
}

function fields(pairs) {
  return pairs.flatMap(([label, value]) => {
    if (value == null || value === '—' || value === '') return [];
    return [label + ' ' + short(value)];
  });
}

function dataDetails({ variables: v, algorithm, event }) {
  switch (algorithm) {
    case 'optimal-merge-tree': {
      if (event === 'merge') {
        const [left, right] = v.selected.map(id => v.nodes[id].weight);
        const parent = v.nodes[v.parent].weight;
        return [`本次合并 ${left} + ${right} = ${parent}`, `累计代价 ${v.cost - parent} + ${parent} = ${v.cost}`];
      }
      const picked = v.selected.map(id => '#' + id + '（权重 ' + v.nodes[id].weight + '）').join('、');
      return fields([['取出', picked], [event === 'done' ? '总代价' : '累计代价', v.cost]]);
    }
    case 'multiway-merge': {
      const { selected } = v;
      const position = selected ? v.positions[selected.run - v.groupStart] : null;
      const next = event === 'output' ? (v.runs[selected.run][position] === undefined ? '已读完' : '移到下标 ' + position) : null;
      const details = fields([['输入有序段', event === 'init' ? v.runs.length : null],
        ['归并路数', event === 'init' ? v.k : null], ['归并趟次', v.pass || null],
        ['来源', selected && `段 ${selected.run}，下标 ${selected.index}，值 ${selected.value}`],
        ['来源游标', next], ['本批已输出', v.group ? v.output.length + ' 项' : null]]);
      if (event === 'select' && v.candidates.some(candidate => candidate.run !== selected.run && candidate.value === selected.value)) {
        details.push('候选值相同时先取段号较小的一路');
      }
      return details;
    }
    case 'replacement-selection': {
      const readValue = v.incoming ? `A[${v.incoming.index}] = ${v.incoming.value}` : null;
      const last = v.incoming ? v.selected.value : null;
      return fields([
        ['当前输出段', ['run-end', 'done'].includes(event) ? null : v.runIndex],
        ['读入', readValue], ['本段末值', last],
        ['缓冲占用', v.active.length + v.frozen.length + ' / ' + v.capacity],
        ['已完成有序段', v.runs.length ? v.runs.length + ' 段' : null],
      ]);
    }
    default: {
      const current = v.nodes.find(node => node.id === v.currentNode);
      return fields([['当前键', v.key], ['当前节点的键', current?.keys],
        ['访问路径', v.path?.length ? v.path : null], ['根节点', v.root == null ? '空' : '#' + v.root]]);
    }
  }
}

function keyedDetails(v) {
  if (v.table) {
    const slotValue = v.slot == null ? null : v.used[v.slot] ? v.table[v.slot] : '空槽';
    return fields([['当前键', v.key], ['初始槽', v.hash ?? v.h1], ['探测步长', v.h2],
      ['槽 ' + v.slot + ' 的内容', slotValue], ['探测次数', v.probes]]);
  }
  if (v.buckets) {
    return fields([['当前键', v.key], ['当前桶', v.bucketIndex],
      ['桶内键', v.bucketIndex == null ? null : v.buckets[v.bucketIndex]], ['比较次数', v.compared],
      ['桶数量', v.bucketIndex == null ? v.buckets.length : null]]);
  }
  const current = v.nodes.find(node => node.key === (v.unbalancedAt ?? v.z ?? v.path?.at(-1) ?? v.key));
  return fields([['根键', v.root ?? '空'], ['访问路径', v.path?.length ? v.path : null],
    ['平衡因子', current?.bf], ['旋转类型', v.rotation],
    ['当前节点颜色', current?.color == null ? null : current.color === 'R' ? '红' : '黑']]);
}

function stringDetails(run, step) {
  const v = step.variables;
  const input = run.input;
  switch (step.algorithm) {
    case 'bracket-matching':
      return fields([['当前下标', v.i], ['字符', v.char], ['括号栈（底到顶）', v.stack.map(item => item.char)],
        ['错误原因', v.reason]]);
    case 'naive-string-match':
    case 'kmp': {
      const main = v.i == null ? null : Array.from(input.text)[v.i];
      const pattern = v.j == null ? null : Array.from(input.pattern)[v.j];
      return fields([['主串下标 ' + v.i, main == null ? null : JSON.stringify(main)],
        ['模式下标 ' + v.j, pattern == null ? null : JSON.stringify(pattern)], ['对齐起点', v.start],
        ['构表下标', v.k], ['真前后缀长度', v.prefix?.[v.k]], ['跳转表', v.mode], ['回退至', v.jump], ['匹配起点', v.matches]]);
    }
    case 'critical-path': {
      const endpoints = v.currentEdge?.slice(0, 2);
      const current = v.currentNode;
      const details = fields([['活动', endpoints?.join(' → ')], ['工期', v.currentEdge?.[2]], ['当前事件', v.currentNode],
        ['最早时刻', current == null ? null : v.earliest[current]], ['最迟时刻', current == null ? null : v.latest[current]],
        ['关键活动', v.criticalEdges.length + ' 项'], ['事件数量', !endpoints && !v.currentNode ? input.nodes.length : null]]);
      if (step.done && step.result?.morePaths) details.push('表中仅展示前 8 条关键路径');
      return details;
    }
    case 'expression-evaluation': {
      const details = fields([['当前词元', v.token], ['原串下标', v.index], ['操作数栈（底到顶）', v.stack],
        ['运算符栈', v.operators.length ? v.operators.map(token => token.text) : null],
        ['后缀序列', v.output.map(token => token.text)]]);
      if (step.lineId === 'compute') {
        const right = v.right < 0 ? '(' + v.right + ')' : v.right;
        details.unshift(v.left + ' ' + v.token + ' ' + right + ' = ' + v.value);
      }
      return details;
    }
    default:
      return fields([['当前词元', v.token], ['左操作数', v.left], ['右操作数', v.right], ['计算结果', v.value],
        ['节点', v.currentNode], ['当前节点缓存值', v.cache?.[v.currentNode]],
        ['运算符栈', v.operators.map(token => token.text)], ['后缀序列', v.output.map(token => token.text)]]);
  }
}

export function describeStructuredStep(run, step, config, packageId) {
  const { variables: v } = step;
  let details;
  if (packageId === 'c') details = dataDetails(step);
  if (packageId === 'd') details = keyedDetails(v);
  if (packageId === 'e') {
    const previous = run.steps[step.stepIndex - 1];
    details = fields(config.fields.map(([key, label]) => [label, eVariableText(key, step, run.input, previous)]));
    if (!details.length) details = fields([['元素数量', step.array?.length ?? v.nodes?.length ?? 0]]);
  }
  if (packageId === 'f') details = stringDetails(run, step);
  if (packageId === 'g') details = fields(config.fields.map(([key, label]) => [label, gVariableText(config, key, v)]));
  const position = '第 ' + (step.stepIndex + 1) + ' 步';
  return [position, ...(details ?? []), ...(step.done ? ['运行结束'] : [])].join(' ｜ ');
}
