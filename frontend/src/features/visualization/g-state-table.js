import { createStateTable as table } from './state-table.js';
import { framePhases, gVariableText, operationResultText, showList } from '../workbench/g-state.js';

function stackTable(stack) {
  const columns = ['节点', '层号', '当前阶段'];
  const rows = stack.map(frame => [frame.id, frame.level, framePhases[frame.phase]]);
  return table('递归栈（栈底在上）', columns, rows);
}

function orderTable(order, title = '访问顺序') {
  return table(title, ['顺序', '节点'], order.map((id, index) => [index + 1, id]));
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
