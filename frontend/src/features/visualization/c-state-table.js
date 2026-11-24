import { stateText } from '../workbench/c-algorithms.js';

function table(caption, headers, rows) {
  const result=document.createElement('table');
  result.className='uf-table';
  result.createCaption().textContent=caption;
  const head=result.createTHead().insertRow();
  for(const title of headers) { const th=document.createElement('th'); th.scope='col'; th.textContent=title; head.append(th); }
  const body=result.createTBody();
  for(const values of rows) {
    const row=body.insertRow();
    for(const value of values) row.insertCell().textContent=stateText(value);
  }
  return result;
}

export function createCStateTable(config) {
  const element=document.createElement('div');
  element.className='c-state-tables';
  return {
    element,
    showStep(step) {
      const v=step.variables;
      const views=[];
      if (config.tree && Array.isArray(v.nodes)) {
        const tree=table('节点表 · 根 ID ' + stateText(v.root), ['ID','键','孩子 ID','叶节点','下一叶 ID'],
          v.nodes.map(node=>[node.id,node.keys,node.children,node.leaf ? '是' : '否',node.next]));
        for(const row of tree.tBodies[0].rows) row.dataset.current=String(Number(row.cells[0].textContent)===v.currentNode);
        views.push(tree);
        if (v.leafKeys) views.push(table('叶链中的键',['按顺序排列'],[[v.leafKeys]]));
      }
      if (Array.isArray(v.runs)) views.push(table(config.field==='runs' ? '当前有序段' : '已完成段',['段号（从 0 开始）','元素'],v.runs.map((run,index)=>[index,run])));
      if (config.field==='runs') {
        views.push(table('本批归并',['字段','内容'],[['各段读取位置',v.positions],['本趟已生成段',v.producedRuns]]));
      }
      if (step.done && config.tree) {
        views.push(table('查询结果',['查询键','结果','节点 ID','节点内位置','访问路径'],
          step.result.queries.map(query=>[query.key,query.found ? '命中' : '未命中',query.node,query.index,query.path])));
      }
      element.replaceChildren(...views);
    }
  };
}
