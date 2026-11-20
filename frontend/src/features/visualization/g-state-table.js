import { createStateTable as table } from './state-table.js';
import { framePhases, gVariableText, operationResultText, showList } from '../workbench/g-state.js';

function markCurrent(element, index) {
  if (index >= 0) element.tBodies[0].rows[index].dataset.current = 'true';
  return element;
}

function binaryTable(nodes, title, current, labels) {
  return markCurrent(table(title, ['节点', ...labels], nodes.map(({ id, left, right }) => [id, left, right])),
    nodes.findIndex(node => node.id === current));
}

function forestTable(nodes, roots, current) {
  return markCurrent(table('有序森林 · 根节点 ' + showList(roots), ['节点', '孩子（按顺序）'],
    nodes.map(node => [node.id, showList(node.children)])), nodes.findIndex(node => node.id === current));
}

function stackTable(stack, withPhase = true) {
  const columns = withPhase ? ['节点', '层号', '当前阶段'] : ['节点', '层号'];
  const rows = stack.map(frame => withPhase ? [frame.id, frame.level, framePhases[frame.phase]] : [frame.id, frame.level]);
  return table('递归栈（栈底在上）', columns, rows);
}

function orderTable(order, title = '访问顺序') {
  return table(title, ['顺序', '节点'], order.map((id, index) => [index + 1, id]));
}

function reconstruction({ stack }) {
  const range = (start, end) => '[' + start + ', ' + end + ')';
  return [
    table('重建区间（栈底在上）', ['子树根', '前序区间', '中序区间', '中序根下标', '左右中序子区间'],
      stack.map(frame => [frame.id, range(frame.preStart, frame.preEnd), range(frame.inStart, frame.inEnd),
        frame.split, frame.leftRange && range(...frame.leftRange.inorder) + ' / ' + range(...frame.rightRange.inorder)])),
  ];
}

function threaded({ nodes, root, currentNode, order }) {
  const link = (id, isThread, name) => isThread ? (id ?? '空') + '（' + name + '）' : id;
  const relationships = table('线索二叉树 · 根节点 ' + (root ?? '空'), ['节点', '左链接', '右链接'],
    nodes.map(node => [node.id, link(node.left, node.leftThread, '前驱线索'), link(node.right, node.rightThread, '后继线索')]));
  return [markCurrent(relationships, nodes.findIndex(node => node.id === currentNode)), orderTable(order, '沿线索访问顺序')];
}

function huffman({ nodes, candidates, selected, codes, root, currentNode }) {
  const indexText = index => index === null ? null : '#' + index;
  const nodeTable = table('哈夫曼节点 · 根节点 ' + (indexText(root) ?? '尚未确定'), ['编号', '符号', '权重', '左链接（0）', '右链接（1）'],
    nodes.map(node => [indexText(node.index), node.id ?? '内部节点', node.weight, indexText(node.left), indexText(node.right)]));
  return [
    table('最小权重优先', ['候选节点', '本轮选中'], [[showList(candidates, indexText), showList(selected, indexText)]]),
    markCurrent(nodeTable, nodes.findIndex(node => node.index === currentNode)),
    table('码字表', ['符号', '权重', '码字'], codes.map(code => [code.id, code.weight, code.code])),
  ];
}

function bst(config, variables) {
  const { lastResult, inorder } = variables;
  return [
    table('本次操作', ['当前操作', '比较路径（键）', '最近完成的操作'],
      [[gVariableText(config, 'operation', variables), gVariableText(config, 'path', variables), operationResultText(lastResult)]]),
    ...(inorder ? [table('中序结果', ['键序列'], [[showList(inorder)]])] : []),
  ];
}

export function createGStateTable(algorithm, config) {
  const element = document.createElement('div');
  element.className = 'level-order-tables g-state-tables';
  return {
    element,
    showStep({ variables: v }) {
      let tables;
      switch (algorithm) {
        case 'binary-tree-reconstruction':
          tables = reconstruction(v);
          break;
        case 'threaded-binary-tree':
          tables = threaded(v);
          break;
        case 'tree-forest-conversion':
          tables = [
            forestTable(v.forestNodes, v.roots, v.currentNode),
            binaryTable(v.binaryNodes, '左孩子右兄弟表示 · 根节点 ' + (v.root ?? '空'), v.currentNode, ['首个孩子', '右兄弟']),
          ];
          if (v.mode === 'to-forest') tables.reverse();
          break;
        case 'tree-forest-traversal':
          tables = [stackTable(v.stack, false), orderTable(v.order)];
          break;
        case 'huffman-coding':
          tables = huffman(v);
          break;
        case 'binary-search-tree':
          tables = bst(config, v);
          break;
        default:
          tables = [stackTable(v.stack), orderTable(v.order)];
      }
      element.replaceChildren(...tables);
    },
  };
}
