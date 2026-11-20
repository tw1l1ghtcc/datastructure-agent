import { createStateTable } from './state-table.js';

export function createLevelOrderTable(){
  const element=document.createElement('div');element.className='level-order-tables';
  return {element,showStep(step){
    const v=step.variables;
    const nodes=createStateTable('节点关系 · 根节点 '+(v.root??'空'),['节点','左孩子','右孩子','访问状态'],
      v.nodes.map(node=>[node.id,node.left,node.right,v.order.includes(node.id)?'已访问':'未访问']));
    for(const row of nodes.tBodies[0].rows)row.dataset.current=String(row.cells[0].textContent===v.currentNode);
    element.replaceChildren(nodes,
      createStateTable('队列（队首在上，队尾在下）',['节点','层号'],v.queue.map(entry=>[entry.id,entry.level])),
      createStateTable('分层访问结果',['层号','访问顺序'],v.levels.map((ids,index)=>[index+1,ids.join(' → ')])));
  }};
}
