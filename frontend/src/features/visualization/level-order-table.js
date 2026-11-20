import { createStateTable } from './state-table.js';

export function createLevelOrderTable(){
  const element=document.createElement('div');element.className='level-order-tables';
  return {element,showStep(step){
    const v=step.variables;
    element.replaceChildren(
      createStateTable('队列（队首在上，队尾在下）',['节点','层号'],v.queue.map(entry=>[entry.id,entry.level])),
      createStateTable('分层访问结果',['层号','访问顺序'],v.levels.map((ids,index)=>[index+1,ids.join(' → ')])));
  }};
}
