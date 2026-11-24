import { stateText } from '../workbench/c-algorithms.js';

function table(caption, headers, rows, selected = () => false) {
  const element = document.createElement('table');
  element.className = 'uf-table';
  element.createCaption().textContent = caption;
  const head = element.createTHead().insertRow();
  for (const label of headers) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = label;
    head.append(th);
  }
  const body = element.createTBody();
  rows.forEach((values, index) => {
    const row = body.insertRow();
    row.dataset.current = String(selected(index));
    for (const value of values) row.insertCell().textContent = stateText(value);
  });
  return element;
}

const characterText = char => ({ ' ': '空格', '\t': '制表符', '\n': '换行', '\r': '回车' })[char] ?? char;
const characterRows = text => Array.from(text ?? '', (char, index) => [index, characterText(char)]);
const tokenRows = tokens => tokens.map(({ text, index }) => [text, index]);
const edgeText = edge => edge[0] + ' → ' + edge[1] + '（' + edge[2] + '）';

function matchTables(input, v, algorithm) {
  const tables = [
    table('匹配位置', ['已找到的起点'], [[v.matches]]),
    table('主串', ['下标', '字符'], characterRows(input.text), index => index === v.i),
    table('模式串', ['下标', '字符'], characterRows(input.pattern), index => index === (v.k ?? v.j)),
  ];
  if (algorithm === 'kmp') {
    const rows = Array.from(input.pattern, (char, index) => [index, characterText(char), v.prefix[index], v.next[index], v.nextval[index]]);
    tables.splice(1, 0, table('预处理表 · 当前使用 ' + v.mode, ['下标', '字符', '前缀长度', 'next', 'nextval'], rows,
      index => index === (v.k ?? v.j)));
  }
  return tables;
}

function graphTables(algorithm, input, v) {
  if (algorithm === 'expression-dag') {
    return [
      table('子表达式节点', ['编号', '词元', '左依赖', '右依赖', '缓存值'],
        v.nodes.map(node => [node.id, node.token, node.left, node.right, v.cache[node.id]]), index => index === v.currentNode),
      table('依赖边', ['操作数节点', '使用节点', '角色'], v.edges),
    ];
  }
  const rows = input.edges.map(([from, to, weight], index) => [
    from, to, weight, v.slack[index]?.float, v.criticalEdges.includes(index) ? '是' : '—',
  ]);
  const tables = [
    table('事件时间', ['事件', '最早时刻', '最迟时刻'], input.nodes.map(node => [node, v.earliest[node], v.latest[node]]),
      index => input.nodes[index] === v.currentNode),
    table('活动时差与关键边', ['起点', '终点', '工期', '时差', '关键'], rows, index => index === v.activityIndex),
  ];
  if (v.criticalPaths) tables.unshift(table('关键路径', ['活动顺序'], v.criticalPaths.map(path => [path.map(edgeText).join('，')])));
  return tables;
}

function outcome(algorithm, value) {
  if (value?.error) return value.error;
  if (algorithm === 'critical-path') return '工期 ' + value.duration + (value.morePaths ? '，表中展示前 8 条关键路径' : '');
  return value?.value ?? value;
}

export function createFStateTable(config, algorithm, input) {
  const element = document.createElement('div');
  element.className = 'c-state-tables';
  return {
    element,
    showStep(step) {
      const v = step.variables;
      let views;
      if (config.chapter === 4) {
        views = matchTables(input, v, algorithm);
      } else {
        const stacks = v.operators ? [
          table('运算符栈（底到顶）', ['词元', '原下标'], tokenRows(v.operators)),
          table('后缀序列', ['词元', '原下标'], tokenRows(v.output)),
        ] : [];
        if (algorithm === 'expression-evaluation') stacks.unshift(table('操作数栈（底到顶）', ['值'], v.stack.map(value => [value])));
        views = config.chapter === 6 ? [...graphTables(algorithm, input, v), ...stacks] : stacks;
      }
      if (step.done) views.unshift(table('运行结果', ['结果'], [[outcome(algorithm, step.result)]]));
      element.replaceChildren(...views);
    },
  };
}
