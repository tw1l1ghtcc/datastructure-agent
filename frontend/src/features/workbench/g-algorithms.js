const recursiveFields = [['currentNode', '当前节点'], ['level', '当前层号'], ['stack', '递归栈（栈顶在右）'], ['order', '访问顺序']];
const configs = {
  'binary-tree-preorder': { title: '二叉树前序遍历', form: 'binary', fields: recursiveFields, prompt: '为什么这一步先访问根节点？' },
  'binary-tree-inorder': { title: '二叉树中序遍历', form: 'binary', fields: recursiveFields, prompt: '什么时候访问当前子树的根节点？' },
  'binary-tree-postorder': { title: '二叉树后序遍历', form: 'binary', fields: recursiveFields, prompt: '为什么要等左右子树都返回后才访问根？' },
  'binary-tree-level-order': { title: '二叉树层序遍历', form: 'binary',
    fields: [['currentNode', '当前节点'], ['level', '当前层号'], ['queue', '队列（队首在左）'], ['order', '访问顺序']],
    prompt: '为什么要先把左孩子加入队列？' },
  'binary-tree-reconstruction': { title: '二叉树重建', form: 'sequences',
    fields: [['root', '全树根节点'], ['currentNode', '当前子树根'], ['stack', '递归栈（栈顶在右）'], ['edge', '本步新增链接']],
    prompt: '怎样从前序和中序序列划分左右子树？' },
  'threaded-binary-tree': { title: '二叉树线索化', form: 'binary',
    fields: [['currentNode', '当前节点'], ['previous', '上一个访问节点'], ['edge', '本步线索'], ['order', '沿线索访问顺序']],
    prompt: '这一步修改的是孩子指针还是线索？' },
  'tree-forest-conversion': { title: '树与森林转换', form: 'conversion',
    modes: [['to-binary', '树／森林转二叉树'], ['to-forest', '二叉树还原树／森林']],
    fields: [['mode', '转换方向'], ['roots', '森林根节点'], ['root', '二叉树根节点'], ['edge', '本步链接']],
    prompt: '这里的左链接和右链接分别表示什么？' },
  'tree-forest-traversal': { title: '树与森林遍历', form: 'forest',
    modes: [['preorder', '先根遍历'], ['postorder', '后根遍历']],
    fields: [['treeIndex', '当前树序号'], ['currentNode', '当前节点'], ['stack', '递归栈（栈顶在右）'], ['order', '访问顺序']],
    prompt: '当前节点什么时候加入访问顺序？' },
  'huffman-coding': { title: '哈夫曼编码', form: 'symbols',
    fields: [['candidates', '候选节点'], ['selected', '选中节点'], ['weightedPathLength', '带权路径长度'], ['encodedBitLength', '编码总位数']],
    prompt: '这一步为什么选择这两个节点？' },
  'binary-search-tree': { title: '二叉排序树', form: 'operations',
    fields: [['operation', '当前操作'], ['currentNode', '当前节点键'], ['path', '比较路径（键）'], ['lastResult', '最近完成的操作']],
    prompt: '为什么这一步沿这个方向继续查找？' },
};

export const gAlgorithmIds = Object.keys(configs);
export function gAlgorithm(id) { return Object.hasOwn(configs, id) ? configs[id] : null; }

export function isBinaryTraversal(id) {
  return id === 'binary-tree-preorder' || id === 'binary-tree-inorder' ||
    id === 'binary-tree-postorder' || id === 'binary-tree-level-order';
}
