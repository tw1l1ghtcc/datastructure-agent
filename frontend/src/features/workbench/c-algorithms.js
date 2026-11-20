const configs = {
  'optimal-merge-tree': { title: '最佳归并树', field: 'weights', label: '各段长度／权重', example: '2, 3, 7',
    help: '最多 64 个非负安全整数，逗号分隔。留空表示没有待归并段。', fields: [['candidates','候选节点'],['selected','本次选中'],['parent','新节点'],['cost','累计代价']] },
  'multiway-merge': { title: '多路平衡归并', field: 'runs', label: '输入有序段（一行一段）', example: '1, 4\n2, 3\n0, 5', param: 'k', paramLabel: '归并路数 k', min: 2, max: 32, default: 2,
    help: '每段非递减有序，最多 32 段、合计 128 个安全整数。空行表示空段。', fields: [['pass','当前趟数'],['groupStart','本批首段'],['positions','读取位置'],['output','本批输出']] },
  'replacement-selection': { title: '置换选择', field: 'array', label: '原始数组', example: '4, 5, 1, 2, 6', param: 'capacity', paramLabel: '缓冲容量', min: 1, max: 64, default: 2,
    help: '最多 128 个安全整数，逗号分隔。输入可以无序、重复或留空。', fields: [['readIndex','下一读取下标'],['active','活动区'],['frozen','冻结区'],['currentRun','当前输出段']] },
  'b-tree': { title: 'B 树', field: 'keys', label: '按顺序插入的键', example: '10, 20, 5, 6', param: 't', paramLabel: '最小度数 t', min: 2, max: 8, default: 2, tree: true,
    help: '最多 64 个安全整数，重复键忽略。t=2 时每节点最多 3 个键。', fields: [['phase','阶段'],['key','当前键'],['currentNode','当前节点 ID'],['path','访问路径']] },
  'b-plus-tree': { title: 'B+ 树', field: 'keys', label: '按顺序插入的键', example: '10, 20, 30, 40, 50, 60, 70', tree: true,
    help: '最多 64 个安全整数，重复键忽略。内部节点最多 3 个孩子，叶节点最多 2 个键。', fields: [['phase','阶段'],['key','当前键'],['currentNode','当前节点 ID'],['path','访问路径']] }
};
export function cAlgorithm(id) { return Object.hasOwn(configs,id) ? configs[id] : null; }
export const cAlgorithmIds = Object.keys(configs);
export function stateText(value) {
  if (value === null || value === undefined) return '—';
  if (Array.isArray(value)) return value.length ? value.map(item => Array.isArray(item) ? '[' + stateText(item) + ']' : stateText(item)).join('、') : '空';
  if (typeof value === 'object') {
    if (typeof value.text === 'string' && Number.isInteger(value.index)) return value.text;
    if (typeof value.char === 'string' && Number.isInteger(value.i)) return value.char + '（' + value.i + '）';
    if (Object.hasOwn(value,'value')) return value.value + '（原下标 ' + value.index + '）';
    return JSON.stringify(value);
  }
  return String(value);
}
