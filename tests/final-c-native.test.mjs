// 用仓库自带Watcom实际编译完整SOURCE_LINES；与JS的最终树结构/分段/代价逐项比较。
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, delimiter } from 'node:path';
import { execFileSync } from 'node:child_process';
import { algorithms } from '../shared/algorithms/final/c/index.js';
const root=resolve(import.meta.dirname,'..','third_party/open-watcom');
const boot=join(root,'owcpp/boot'),bin=join(boot,'binnt64');
const cCompiler=join(root,'builder/build/binbuild/bwcc386.exe');
const cppCompiler=join(root,'owcpp/out/wpp386.exe');
const linker=join(bin,'wcl386.exe');
const available=process.platform==='win32'&&[cCompiler,cppCompiler,linker].every(existsSync);
const literal=a=>a.length?a.map(n=>`${n}LL`).join(','):'0';
function program(id,input){
  const result=algorithms[id].generate(input),source=result.sourceLines.map(l=>l.text).join('\n');
  let body,expected;
  if(id==='optimal-merge-tree'){
    body=`long long a[]={${literal(input.weights)}};int root,i;long long cost=optimal_merge(a,${input.weights.length},&root);printf("[%lld,%d,[",cost,root);for(i=0;i<merge_count;i++){if(i)printf(",");printf("[%d,%lld,%d,%d]",i,merge_nodes[i].weight,merge_nodes[i].left,merge_nodes[i].right);}printf("]]");`;
    expected=[result.result.cost,result.result.root??-1,result.result.nodes.map(n=>[n.id,n.weight,n.left??-1,n.right??-1])];
  }else if(id==='multiway-merge'){
    const sets=input.runs.map((r,i)=>`r[${i}].length=${r.length};`+r.map((v,j)=>`r[${i}].values[${j}]=${v}LL;`).join('')).join('');
    body=`static Run r[32],out;int i,p;${sets}p=multiway_merge(r,${input.runs.length},${input.k},&out);printf("[%d,[",p);for(i=0;i<out.length;i++){if(i)printf(",");printf("%lld",out.values[i]);}printf("]]");`;
    expected=[result.steps.at(-1).variables.pass,result.result];
  }else if(id==='replacement-selection'){
    body=`static Run r[128];long long a[]={${literal(input.array)}};int i,j,n=replacement_selection(a,${input.array.length},${input.capacity},r);printf("[");for(i=0;i<n;i++){if(i)printf(",");printf("[");for(j=0;j<r[i].length;j++){if(j)printf(",");printf("%lld",r[i].values[j]);}printf("]");}printf("]");`;
    expected=result.result;
  }else{
    const plus=id==='b-plus-tree',pool=plus?'bp':'bnodes',count=plus?'bpcount':'bcount';
    const build=plus?`bplus_build(a,${input.keys.length})`:`btree_build(a,${input.keys.length},${input.t??2})`;
    body=`long long a[]={${literal(input.keys)}};int root=${build},i,j;printf("[%d,[",root);for(i=0;i<${count};i++){if(i)printf(",");printf("[%d,%d,[",i,${pool}[i].leaf);for(j=0;j<${pool}[i].count;j++){if(j)printf(",");printf("%lld",${pool}[i].keys[j]);}printf("],[");if(!${pool}[i].leaf)for(j=0;j<=${pool}[i].count;j++){if(j)printf(",");printf("%d",${pool}[i].child[j]);}printf("],%d]",${plus?'bp[i].next':'-1'});}printf("]]");`;
    expected=[result.result.root??-1,result.result.nodes.map(n=>[n.id,Number(n.leaf),n.keys,n.children,plus?n.next??-1:-1])];
  }
  return {source:'#include <stdio.h>\n'+source+'\nint main(void){'+body+'return 0;}\n',expected};
}
const cases={
  'optimal-merge-tree':[{weights:[2,3,7]},{weights:[]},{weights:[0,0,3,3,3]},{weights:[4294967296,1,1]}],
  'multiway-merge':[{runs:[[1,4],[2,3],[0,5]],k:2},{runs:[[],[-3,0],[0,8],[]],k:3}],
  'replacement-selection':[{array:[4,5,1,2,6],capacity:2},{array:[4,5,1,6,2],capacity:2},{array:[4,3,2,1],capacity:1},{array:[],capacity:1}],
  'b-tree':[{keys:[10,20,5,6]},{keys:Array.from({length:64},(_,i)=>63-i),t:3},{keys:[1,2,3,3]}],
  'b-plus-tree':[{keys:[10,20,30,40,50,60,70]},{keys:Array.from({length:64},(_,i)=>63-i)},{keys:[-3,0,0,4294967296,4]}],
};
for(const lang of ['c','cpp'])test(`完整${lang==='c'?'C':'C++'}展示代码编译、链接并运行：五算法与JS一致`,{skip:!available,timeout:120000},()=>{
  const dir=mkdtempSync(join(tmpdir(),'final-c-native-'));
  const system=process.env.SystemRoot??'C:\\Windows';
  const env={...process.env,WATCOM:boot,INCLUDE:[join(boot,'h'),join(boot,'h/nt')].join(delimiter),LIB:[join(boot,'lib386'),join(boot,'lib386/nt')].join(delimiter),PATH:[bin,join(boot,'binnt'),join(system,'System32')].join(delimiter)};env.LIBPATH=env.LIB;
  try{
    let serial=0;
    for(const [id,inputs]of Object.entries(cases))for(const input of inputs){
      const {source,expected}=program(id,input);writeFileSync(join(dir,'program.'+lang),source,'ascii');
      const options={cwd:dir,env,windowsHide:true,timeout:10000,maxBuffer:1024*1024};
      execFileSync(lang==='c'?cCompiler:cppCompiler,[lang==='c'?'-za99':'-xs','-bt=nt','-q','-fo=program.obj','program.'+lang],options);
      const executable=`case-${serial++}.exe`;
      execFileSync(linker,['-l=nt','-q','-fe='+executable,'program.obj'],options);
      const output=execFileSync(join(dir,executable),[],{...options,encoding:'utf8'});
      assert.deepEqual(JSON.parse(output),expected,`${lang} ${id} ${JSON.stringify(input)}`);
    }
  }finally{
    // 只删除本测试在系统临时目录下新建的目录，解析后的路径必须仍位于临时目录内。
    if(resolve(dir).startsWith(resolve(tmpdir())+'\\')||resolve(dir).startsWith(resolve(tmpdir())+'/'))rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
});
