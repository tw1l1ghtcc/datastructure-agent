const MAX_LIST = 64;
const MAX_SORT = 24;
const MAX_TRIPLES = 64;
const MAX_INT = 2147483647;
const MIN_INT = -2147483648;

const configs = {
  'array-list-reverse': {
    title: '顺序表逆置', group: 'list', view: 'array', example: { list: [1, 2, 3, 4, 5] },
    fields: [['len', '表长'], ['i', '左下标'], ['j', '右下标'], ['arr', '当前顺序表']],
    prompt: '为什么只需要交换到中间？',
  },
  'array-list-delete-range': {
    title: '顺序表区间删除', group: 'list', view: 'array', example: { list: [1, 2, 3, 4, 5], left: 1, right: 3 },
    params: [['left', '左端下标'], ['right', '右端下标']],
    help: '删除含两端的闭区间。左右下标从 0 开始。',
    fields: [['length', '逻辑长度'], ['delCount', '删除数量'], ['src', '搬移来源'], ['dst', '搬移目标']],
    prompt: '后面的元素要向前搬几格？',
  },
  'singly-linked-list-insert': {
    title: '单链表插入', group: 'list', view: 'linked', example: { list: [1, 3], pos: 1, value: 2 },
    params: [['pos', '插入下标'], ['value', '新结点值']],
    help: '从 0 开始计数，可在头部、表中或末尾插入。空链表在下标 0 插入。',
    fields: [['headId', '头结点编号'], ['pos', '插入下标'], ['value', '新结点值'], ['chain', '当前链表']],
    prompt: '新结点的 next 应该先指向谁？',
  },
  'singly-linked-list-delete': {
    title: '单链表删除', group: 'list', view: 'linked', example: { list: [1, 2, 3], pos: 0 },
    params: [['pos', '删除下标']], help: '删除下标从 0 开始，须指向现有结点。',
    fields: [['headId', '头结点编号'], ['pos', '删除下标'], ['removed', '本步脱链结点'], ['chain', '当前链表']],
    prompt: '删除结点后，哪个链接发生了变化？',
  },
  'singly-linked-list-reverse': {
    title: '单链表逆置', group: 'list', view: 'linked', example: { list: [2, 4, 6] },
    fields: [['headId', '当前链头编号'], ['prevId', '前驱编号'], ['currId', '当前结点编号'], ['nextId', '原后继编号']],
    prompt: '改写 next 前为什么要保存原来的后继？',
  },
  'kth-from-end': {
    title: '找倒数第 K 个结点', group: 'list', view: 'linked', example: { list: [3, 8, 1, 5], k: 2 },
    params: [['k', '倒数位置 K']], help: 'K 从 1 开始，最大为链表长度。',
    fields: [['k', '倒数位置 K'], ['fastId', '快指针编号'], ['slowId', '慢指针编号'], ['value', '结果值']],
    prompt: '快指针走到链尾时，慢指针为什么恰好在目标位置？',
  },
  'sparse-matrix-transpose': {
    title: '稀疏矩阵转置', group: 'matrix', view: 'matrix',
    example: { rows: 2, cols: 4, triples: [{ i: 1, j: 3, e: 7 }, { i: 0, j: 2, e: 4 }, { i: 1, j: 0, e: -3 }] },
    params: [['rows', '行数'], ['cols', '列数']],
    fields: [['shape', '原矩阵尺寸'], ['k', '当前三元组下标'], ['col', '原列号'], ['pos', '输出下标']],
    prompt: '根据各列的非零项数，怎样求出转置后的写入位置？',
  },
  'radix-sort': {
    title: '基数排序', group: 'sort', view: 'radix', example: { list: [21, 3, 21, 10] },
    help: '元素须为非负整数。支持重复值。',
    fields: [['exp', '当前位权'], ['maxv', '最大值'], ['cnt', '本轮桶计数'], ['tmp', '本轮回填结果']],
    prompt: '为什么从右往左回填可以保留同一数位上的顺序？',
  },
  'counting-sort': {
    title: '计数排序', group: 'sort', view: 'counting', example: { list: [2, -1, 2, 0] },
    help: '支持负数和重复值。最大值减最小值加 1 不得超过 5000。',
    fields: [['min', '最小值'], ['max', '最大值'], ['countDiff', '本步计数变化'], ['output', '输出数组']],
    prompt: '累计计数怎样决定当前元素的输出下标？',
  },
};

export function eAlgorithm(id) {
  return Object.hasOwn(configs, id) ? configs[id] : null;
}

export function eAlgorithmsIn(group) {
  return Object.entries(configs).filter(([, config]) => config.group === group).map(([id, config]) => [id, config.title]);
}

export function eInputHelp(config) {
  if (config.group === 'matrix') {
    return '列数为 0 到 64。最多 ' + MAX_TRIPLES + ' 个三元组，每行填 i,j,e，行列下标从 0 开始，e 为有限数值。空矩阵留空。';
  }
  const limit = config.group === 'sort' ? MAX_SORT : MAX_LIST;
  return '最多 ' + limit + ' 个 32 位整数，以逗号分隔，留空表示空序列。' + (config.help ?? '');
}

function isInt32(value) {
  return Number.isInteger(value) && value >= MIN_INT && value <= MAX_INT;
}

export function validateEInput(config, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('输入必须为对象。');
  for (const [key, label] of config.params ?? []) {
    if (!isInt32(input[key])) throw new TypeError(label + '必须为 32 位整数。');
  }
  if (config.group === 'matrix') {
    if (!Array.isArray(input.triples) || input.triples.length > MAX_TRIPLES) {
      throw new TypeError('最多输入 ' + MAX_TRIPLES + ' 个三元组。');
    }
    return;
  }
  const limit = config.group === 'sort' ? MAX_SORT : MAX_LIST;
  if (!Array.isArray(input.list) || input.list.length > limit || !input.list.every(isInt32)) {
    throw new TypeError('请输入 0 到 ' + limit + ' 个 32 位整数。');
  }
}

export function validEStep(config, step) {
  const v = step.variables;
  if (config.view === 'linked') return Array.isArray(v.nodes) && Object.hasOwn(v, 'headId');
  if (config.view === 'matrix') return Array.isArray(v.triples) && Number.isInteger(v.rows) && Number.isInteger(v.cols);
  return Array.isArray(step.array);
}
