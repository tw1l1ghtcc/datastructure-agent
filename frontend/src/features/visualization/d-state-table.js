import { stateText } from '../workbench/c-algorithms.js';

function table(title,headers,rows){
  const element=document.createElement('table');element.className='uf-table';
  element.createCaption().textContent=title;
  const head=element.createTHead().insertRow();
  for(const text of headers){const th=document.createElement('th');th.scope='col';th.textContent=text;head.append(th);}
  const body=element.createTBody();
  for(const values of rows){const row=body.insertRow();for(const value of values)row.insertCell().textContent=stateText(value);}
  return element;
}
export function createDStateTable(config){
  const element=document.createElement('div');element.className='d-state-tables';
  return {element,showStep(step){
    const v=step.variables,views=[];
    if(Array.isArray(v.table)){
      const slots=table('哈希槽位表',['槽位下标','键／空槽'],
        v.table.map((value,index)=>[index,v.used[index] ? value : '空']));
      for(const [index,row]of Array.from(slots.tBodies[0].rows).entries()){
        row.dataset.current=String(index===v.slot);
        row.dataset.found=String(step.event==='found'&&index===v.slot);
      }
      views.push(slots);
      views.push(table('本步探测',['字段','数值'],[
        ['初始槽',v.hash??v.h1],['步长',v.h2],['偏移',v.offset],['探测次数',v.probes],['探测公式',v.formula]
      ]));
    }else if(Array.isArray(v.buckets)){
      const buckets=table('哈希桶与链（链从左到右）',['桶下标','链上键'],v.buckets.map((chain,index)=>[index,chain.length?chain.join(' → '):'空']));
      for(const [index,row]of Array.from(buckets.tBodies[0].rows).entries()){
        row.dataset.current=String(index===v.bucketIndex);
        row.dataset.found=String(step.event==='found'&&index===v.bucketIndex);
      }
      views.push(buckets);
    }else{
      views.push(table('本步状态',['字段','内容'],[
        ['阶段',({insert:'插入',search:'查询',fixup:'修复'})[v.phase]??v.phase],
        ['路径',v.path],['旋转类型',v.rotation],['失衡节点',v.unbalancedAt],['修复情形',v.fixupCase]
      ]));
    }
    element.replaceChildren(...views);
  }};
}
