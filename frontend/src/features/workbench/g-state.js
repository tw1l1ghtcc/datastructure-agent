export const showList = (items, format = item => item) => items.map(format).join(' → ') || '空';

export const framePhases = { enter: '进入', visit: '访问', left: '递归左子树', right: '递归右子树', return: '返回' };
export const edgeKinds = { left: '左孩子', right: '右孩子', predecessor: '前驱线索', successor: '后继线索',
  'first-child': '首个孩子', 'next-sibling': '右兄弟', root: '根节点', child: '孩子' };
const operationNames = { insert: '插入', search: '查找' };
const statuses = { inserted: '已插入', duplicate: '键已存在', found: '已找到', missing: '未找到' };

export function operationText(operation) {
  return operation ? operationNames[operation.type] + ' ' + operation.key : '—';
}

export function operationResultText(operation) {
  return operation ? operationText(operation) + ' · ' + statuses[operation.status] : '—';
}

export function gVariableText(config, key, variables) {
  const value = variables[key];
  if (value === null || value === undefined) return '—';
  switch (key) {
    case 'queue':
    case 'stack':
      return showList(value, frame => frame.level === undefined ? frame.id : frame.id + '（第 ' + frame.level + ' 层）');
    case 'edge':
      return (value.from ?? value.parent ?? '空') + ' → ' + (value.to ?? value.child ?? '空') + '（' + edgeKinds[value.kind ?? value.side] + '）';
    case 'mode':
      return config.modes.find(([mode]) => mode === value)?.[1] ?? value;
    case 'candidates':
    case 'selected':
      return showList(value, index => '#' + index + '（' + variables.nodes[index].weight + '）');
    case 'path':
      return showList(value, id => variables.nodes[id].key);
    case 'currentNode':
      return config.form === 'operations' ? variables.nodes[value].key : value;
    case 'operation':
      return operationText(value);
    case 'lastResult':
      return operationResultText(value);
    default:
      return Array.isArray(value) ? showList(value) : value;
  }
}
