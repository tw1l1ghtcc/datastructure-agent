import test from 'node:test';
import assert from 'node:assert/strict';
import { algorithms } from '../shared/algorithms/final/c/index.js';
import { createPlayback } from '../frontend/src/features/playback/index.js';
const generate = (id, input) => algorithms[id].generate(input);
const sorted = a => [...a].sort((a,b) => a-b);
const flatSorted = a => sorted(a.flat());
function checkTrace(id, input) {
  const original = structuredClone(input), a = generate(id,input), b = generate(id,input);
  assert.deepEqual(input,original,'不修改调用方输入'); assert.deepEqual(a,b,'轨迹确定性');
  assert.equal(a.steps[0].event,'init'); assert.equal(a.steps.filter(s=>s.done).length,1);
  assert.equal(a.steps.at(-1).event,'done'); assert.deepEqual(a.steps.at(-1).result,a.result);
  const lines=new Set(a.sourceLines.map(l=>l.lineId));assert.equal(lines.size,a.sourceLines.length);
  for(const [i,s]of a.steps.entries()){
    assert.equal(s.stepIndex,i);assert.equal(s.algorithm,id);assert.equal(s.sourceVersion,a.sourceVersion);
    assert.equal(s.schemaVersion,'1.0');assert.ok(lines.has(s.lineId),s.lineId);assert.ok(s.description);
    if(!s.done)assert.equal(s.result,null);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(a)),a,'可经JSON接口往返');
  const before=JSON.stringify(a.steps.slice(0,-1));a.steps.at(-1).variables.mutated=true;
  assert.equal(JSON.stringify(a.steps.slice(0,-1)),before,'历史快照不共享对象');
  const resultBefore=JSON.stringify(a.result);a.steps.at(-1).result.mutationProbe=1;
  assert.equal(JSON.stringify(a.result),resultBefore,'结果与最后一帧独立');
  return b;
}
function treeInvariant(s, plus=false, t=2) {
  const v=s.variables, nodes=new Map(v.nodes.map(n=>[n.id,n]));
  if(v.root===null){assert.equal(nodes.size,0);return [];}
  const seen=new Set(), depths=new Set(), leaves=[];
  function walk(id,depth,lo=-Infinity,hi=Infinity){
    assert.ok(nodes.has(id),'孩子必须存在');assert.ok(!seen.has(id),'不能成环或共享孩子');seen.add(id);
    const n=nodes.get(id);assert.deepEqual(n.keys,sorted(n.keys));assert.equal(new Set(n.keys).size,n.keys.length);
    for(const k of n.keys){assert.ok(k>=lo&&k<hi,`${k}不在[${lo},${hi})`);}
    if(plus){assert.ok(n.keys.length<=(v.overflowNode===id?3:2));}
    else {assert.ok(n.keys.length<=2*t-1);if(id!==v.root)assert.ok(n.keys.length>=t-1);}
    if(n.leaf){assert.equal(n.children.length,0);depths.add(depth);leaves.push(n);return [...n.keys];}
    assert.equal(n.children.length,n.keys.length+1);const all=[];
    for(let i=0;i<n.children.length;i++){
      const a=walk(n.children[i],depth+1,i?n.keys[i-1]:lo,i<n.keys.length?n.keys[i]:hi);
      if(plus&&i)assert.equal(n.keys[i-1],a[0],'分隔键等于右子树最小值');
      all.push(...a);if(!plus&&i<n.keys.length)all.push(n.keys[i]);
    }
    return all;
  }
  const result=walk(v.root,0);assert.equal(seen.size,nodes.size,'全部节点可从根到达');assert.equal(depths.size,1,'叶同深');
  assert.deepEqual(result,sorted(result));assert.equal(new Set(result).size,result.length);
  if(plus){for(let i=0;i<leaves.length;i++)assert.equal(leaves[i].next,leaves[i+1]?.id??null);assert.deepEqual(v.leafKeys,result);}
  return result;
}
test('五项默认案例、独立快照、行映射、输入不变和确定性',()=>{
  for(const [id,a]of Object.entries(algorithms))checkTrace(id,a.example);
});
test('最佳归并树：人工过程、空/单段/同权/零权与溢出',()=>{
  const a=generate('optimal-merge-tree',{weights:[2,3,7]});
  assert.deepEqual(a.steps.filter(s=>s.event==='merge').map(s=>[s.variables.nodes.at(-1).weight,s.variables.cost]),[[5,5],[12,17]]);
  assert.equal(a.result.cost,17);assert.equal(generate('optimal-merge-tree',{weights:[]}).result.root,null);
  assert.equal(generate('optimal-merge-tree',{weights:[7]}).result.cost,0);
  assert.equal(generate('optimal-merge-tree',{weights:[1,1,1,1]}).result.cost,8);
  assert.equal(generate('optimal-merge-tree',{weights:[0,0,1]}).result.cost,1);
  assert.throws(()=>generate('optimal-merge-tree',{weights:[Number.MAX_SAFE_INTEGER,1]}),TypeError);
});
function optimalOracle(weights,memo=new Map()) {
  if(weights.length<2)return 0; const key=sorted(weights).join(',');if(memo.has(key))return memo.get(key);
  let best=Infinity;
  for(let i=0;i<weights.length;i++)for(let j=i+1;j<weights.length;j++){
    const sum=weights[i]+weights[j],rest=weights.filter((_,k)=>k!==i&&k!==j);
    best=Math.min(best,sum+optimalOracle([...rest,sum],memo));
  }
  memo.set(key,best);return best;
}
test('最佳归并代价与枚举所有合并顺序的独立oracle一致',()=>{
  for(const weights of [[0,1,2,3],[2,5,1,8,3],[4,4,4,4,4],[9,2,6,1,3,7]])assert.equal(generate('optimal-merge-tree',{weights}).result.cost,optimalOracle(weights));
});
test('多路归并：两趟人工案例、空段、同值、负数及输入验证',()=>{
  const a=generate('multiway-merge',algorithms['multiway-merge'].example);assert.deepEqual(a.result,[0,1,2,3,4,5]);assert.equal(a.steps.at(-1).variables.pass,2);
  assert.deepEqual(generate('multiway-merge',{runs:[[],[-3,0,0],[],[0,2]],k:3}).result,[-3,0,0,0,2]);
  for(const runs of [[],[[]],[[],[]]])assert.deepEqual(generate('multiway-merge',{runs,k:2}).result,[]);
  assert.deepEqual(generate('multiway-merge',{runs:[[1,2]],k:2}).result,[1,2]);
  assert.throws(()=>generate('multiway-merge',{runs:[[2,1]],k:2}),TypeError);
  for(const k of [0,1,2.5,100,null,'2'])assert.throws(()=>generate('multiway-merge',{runs:[],k}),TypeError);
});
test('置换选择：人工案例、冻结/解冻、容量1和大缓冲',()=>{
  assert.deepEqual(generate('replacement-selection',{array:[4,5,1,2,6],capacity:2}).result,[[4,5],[1,2,6]]);
  assert.deepEqual(generate('replacement-selection',{array:[4,5,1,6,2],capacity:2}).result,[[4,5,6],[1,2]]);
  assert.deepEqual(generate('replacement-selection',{array:[3,2,1],capacity:1}).result,[[3],[2],[1]]);
  assert.deepEqual(generate('replacement-selection',{array:[3,1,2,2],capacity:64}).result,[[1,2,2,3]]);
  assert.deepEqual(generate('replacement-selection',{array:[],capacity:1}).result,[]);
});
let seed=1234567;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
test('归并和置换选择随机数据：有序、元素守恒、缓冲容量',()=>{
  for(let r=0;r<60;r++){
    const array=Array.from({length:random()%50},()=>random()%31-15),capacity=random()%8+1;
    const result=generate('replacement-selection',{array,capacity});assert.deepEqual(flatSorted(result.result),sorted(array));
    for(const run of result.result)assert.deepEqual(run,sorted(run));
    for(const s of result.steps)assert.ok(s.variables.active.length+s.variables.frozen.length<=capacity);
    assert.deepEqual(generate('multiway-merge',{runs:result.result,k:2+random()%7}).result,sorted(array));
  }
});
test('B树：人工根分裂、重复键不改变结构、多查询',()=>{
  const a=generate('b-tree',{keys:[10,20,5,6],queries:[6,7],t:2});const root=a.result.nodes.find(n=>n.id===a.result.root);
  assert.deepEqual(root.keys,[10]);assert.deepEqual(root.children.map(id=>a.result.nodes[id].keys),[[5,6],[20]]);
  assert.deepEqual(a.result.queries.map(q=>q.found),[true,false]);for(const s of a.steps)treeInvariant(s);
  const b=generate('b-tree',{keys:[1,2,3,3]});assert.ok(!b.steps.some(s=>s.event==='split-root'));assert.deepEqual(b.result.keys,[1,2,3]);
});
test('B+树：叶分裂、内部与根分裂、叶链和内部索引命中必须下降到叶',()=>{
  const a=generate('b-plus-tree',algorithms['b-plus-tree'].example);
  assert.ok(a.steps.some(s=>s.event==='split-internal'));assert.ok(a.steps.filter(s=>s.event==='new-root').length>=2);
  assert.deepEqual(a.result.keys,[10,20,30,40,50,60,70]);assert.deepEqual(a.result.queries.map(q=>q.found),[true,false]);
  const hit=a.result.queries[0];assert.equal(a.result.nodes[hit.node].leaf,true);
  for(const s of a.steps)treeInvariant(s,true);
});
test('两类树：空树、重复、负键和每帧结构不变量；随机深层分裂',()=>{
  for(const id of ['b-tree','b-plus-tree']){
    const empty=checkTrace(id,{keys:[],queries:[0]});assert.equal(empty.result.root,null);assert.equal(empty.result.queries[0].found,false);
    for(let r=0;r<35;r++){
      const keys=Array.from({length:64},()=>random()%101-50),queries=[...keys.slice(0,6),200,-200],t=2+random()%4;
      const a=generate(id,{keys,queries,...(id==='b-tree'?{t}:{})});assert.deepEqual(a.result.keys,sorted([...new Set(keys)]));
      assert.deepEqual(a.result.queries.map(q=>q.found),queries.map(q=>keys.includes(q)));
      for(const s of a.steps)treeInvariant(s,id==='b-plus-tree',t);
      for(let i=1;i<a.steps.length;i++)if(a.steps[i].event==='duplicate')assert.deepEqual(a.steps[i].variables.nodes,a.steps[i-1].variables.nodes);
    }
  }
});
test('输入边界：拒绝过量、稀疏、非法类型与非整数',()=>{
  for(const id of Object.keys(algorithms))for(const x of [null,[],true])assert.throws(()=>generate(id,x),TypeError);
  for(const bad of [NaN,Infinity,0.5,'1',null,undefined,Number.MAX_SAFE_INTEGER+1]){
    assert.throws(()=>generate('optimal-merge-tree',{weights:[bad]}),TypeError);
    assert.throws(()=>generate('b-tree',{keys:[bad]}),TypeError);
    assert.throws(()=>generate('b-plus-tree',{keys:[],target:bad}),TypeError);
    assert.throws(()=>generate('replacement-selection',{array:[bad]}),TypeError);
  }
  assert.throws(()=>generate('optimal-merge-tree',{weights:[-1]}),TypeError);
  assert.throws(()=>generate('b-tree',{keys:Array(65).fill(0)}),TypeError);
  assert.throws(()=>generate('b-plus-tree',{keys:[],queries:Array(65).fill(1)}),TypeError);
  assert.throws(()=>generate('multiway-merge',{runs:Array(33).fill([])}),TypeError);
  assert.throws(()=>generate('multiway-merge',{runs:[Array(129).fill(1)]}),TypeError);
  assert.throws(()=>generate('replacement-selection',{array:Array(129).fill(1)}),TypeError);
  assert.throws(()=>generate('replacement-selection',{array:[],capacity:0}),TypeError);
  assert.throws(()=>generate('b-tree',{keys:[],t:1}),TypeError);
  assert.throws(()=>generate('b-plus-tree',{keys:[],order:4}),TypeError);
  assert.throws(()=>generate('multiway-merge',{runs:[Array(2)]}),TypeError);
});
test('全部C包轨迹复用现有播放器前进、回退、跳步和重置',()=>{
  for(const [id,entry]of Object.entries(algorithms)){
    const run=generate(id,entry.example),seen=[];
    const p=createPlayback({runId:id,steps:run.steps,onStepChange:e=>seen.push(e)});
    p.next();p.prev();assert.equal(seen.at(-1).step,run.steps[0]);
    p.seek(run.steps.length-1);assert.equal(seen.at(-1).step.result,run.steps.at(-1).result);
    p.reset();assert.equal(p.getState().stepIndex,0);p.destroy();assert.equal(p.getDiagnostics().activeTimers,0);
  }
});
