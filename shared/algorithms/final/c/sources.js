// 自包含的 C 展示实现（也可按 C++ 编译）。入口由已校验的演示输入调用。
// @ 标记为稳定行 ID，展示时移除；无标记的辅助行仍完整保留。
export const OPTIMAL_SOURCE = `
typedef struct { long long weight; int left, right; } MergeNode;
MergeNode merge_nodes[128];
int merge_count;
void queue_sort(int q[], int n) {
  int i, j, x;
  for (i=1;i<n;i++) {
    x=q[i]; j=i;
    while (j>0 && (merge_nodes[q[j-1]].weight>merge_nodes[x].weight ||
      (merge_nodes[q[j-1]].weight==merge_nodes[x].weight && q[j-1]>x))) {
      q[j]=q[j-1]; --j;
    }
    q[j]=x;
  }
}
/* n<=64; nonnegative safe weights and safe total cost checked by caller. */
long long optimal_merge(const long long weights[], int n, int *root) {
  int q[64], count=n, i, a, b, p; long long cost=0;
  merge_count=n;
  for(i=0;i<n;i++) { merge_nodes[i].weight=weights[i]; merge_nodes[i].left=merge_nodes[i].right=-1; q[i]=i; }
  queue_sort(q,count); /*@init*/
  while(count>1) {
    a=q[0]; b=q[1]; /*@select*/
    for(i=2;i<count;i++) q[i-2]=q[i];
    count-=2; p=merge_count++;
    merge_nodes[p].weight=merge_nodes[a].weight+merge_nodes[b].weight;
    merge_nodes[p].left=a; merge_nodes[p].right=b;
    cost+=merge_nodes[p].weight; q[count++]=p; queue_sort(q,count); /*@merge*/
  }
  *root=count?q[0]:-1;
  return cost; /*@done*/
}
`;
export const MULTIWAY_SOURCE = `
typedef struct { long long values[128]; int length; } Run;
/* <=32 sorted runs, <=128 items total, 2<=k<=32. */
int multiway_merge(Run runs[], int count, int k, Run *result) {
  Run next[32]; int i,j,start,size,outCount,selected,pass=0,pos[32];
  int kept=0; /*@init*/
  for(i=0;i<count;i++) if(runs[i].length) runs[kept++]=runs[i]; /*@skip-empty*/
  count=kept;
  while(count>1) {
    ++pass; outCount=0; /*@pass-start*/
    for(start=0;start<count;start+=k) {
      size=count-start<k?count-start:k;
      for(i=0;i<size;i++) pos[i]=0;
      next[outCount].length=0;
      for(;;) {
        selected=-1;
        for(j=0;j<size;j++) if(pos[j]<runs[start+j].length &&
          (selected<0 || runs[start+j].values[pos[j]]<runs[start+selected].values[pos[selected]])) selected=j;
        if(selected<0) break; /*@select*/
        next[outCount].values[next[outCount].length++]=runs[start+selected].values[pos[selected]++]; /*@output*/
      }
      ++outCount; /*@run-end*/
    }
    for(i=0;i<outCount;i++) runs[i]=next[i];
    count=outCount; /*@pass-end*/
  }
  result->length=0;
  if(count) *result=runs[0];
  return pass; /*@done*/
}
`;
export const REPLACEMENT_SOURCE = `
typedef struct { long long value; int index, frozen; } BufferItem;
typedef struct { long long values[128]; int length; } Run;
/* n<=128, 1<=capacity<=64; original index breaks equal-value ties. */
int replacement_selection(const long long input[], int n, int capacity, Run runs[]) {
  BufferItem buf[64]; int used=0,read=0,run=0,i,best; long long last;
  runs[0].length=0; /*@init*/
  while(read<n && used<capacity) { buf[used].value=input[read]; buf[used].index=read++; buf[used++].frozen=0; } /*@load*/
  while(used) {
    best=-1;
    for(i=0;i<used;i++) if(!buf[i].frozen && (best<0 || buf[i].value<buf[best].value ||
      (buf[i].value==buf[best].value && buf[i].index<buf[best].index))) best=i;
    if(best<0) {
      ++run; runs[run].length=0; /*@run-end*/
      for(i=0;i<used;i++) buf[i].frozen=0; /*@new-run*/
      continue;
    }
    last=buf[best].value; runs[run].values[runs[run].length++]=last; /*@output*/
    if(read<n) {
      buf[best].value=input[read]; buf[best].index=read++;
      if(buf[best].value<last) buf[best].frozen=1; /*@freeze*/
      else buf[best].frozen=0; /*@activate*/
    } else { buf[best]=buf[--used]; }
  }
  return n?run+1:0; /*@done*/
}
`;
export const BTREE_SOURCE = `
typedef struct { long long keys[16]; int count,child[17],leaf; } BNode;
BNode bnodes[128]; int bcount, broot, degree;
int bnew(int leaf) { int id=bcount++; bnodes[id].count=0; bnodes[id].leaf=leaf; return id; }
int bsearch(int p, long long key) {
  int i;
  while(p>=0) {
    i=0; while(i<bnodes[p].count && key>bnodes[p].keys[i]) ++i; /*@compare*/
    if(i<bnodes[p].count && key==bnodes[p].keys[i]) return p; /*@found*/
    if(bnodes[p].leaf) break;
    p=bnodes[p].child[i]; /*@descend*/
  }
  return -1; /*@not-found*/
}
void bsplit(int p,int i) {
  int y=bnodes[p].child[i], z=bnew(bnodes[y].leaf), j;
  long long middle=bnodes[y].keys[degree-1];
  bnodes[z].count=degree-1;
  for(j=0;j<degree-1;j++) bnodes[z].keys[j]=bnodes[y].keys[j+degree];
  if(!bnodes[y].leaf) for(j=0;j<degree;j++) bnodes[z].child[j]=bnodes[y].child[j+degree];
  bnodes[y].count=degree-1;
  for(j=bnodes[p].count;j>i;j--) bnodes[p].child[j+1]=bnodes[p].child[j];
  for(j=bnodes[p].count;j>i;j--) bnodes[p].keys[j]=bnodes[p].keys[j-1];
  bnodes[p].child[i+1]=z; bnodes[p].keys[i]=middle; ++bnodes[p].count; /*@split*/
}
/* n<=64, 2<=t<=8; duplicates ignored before any split. */
int btree_build(const long long keys[],int n,int t) {
  int a,p,i,r; long long key;
  bcount=0; broot=-1; degree=t; /*@init*/
  for(a=0;a<n;a++) {
    key=keys[a];
    if(bsearch(broot,key)>=0) continue; /*@duplicate*/
    if(broot<0) broot=bnew(1);
    if(bnodes[broot].count==2*degree-1) { r=bnew(0); bnodes[r].child[0]=broot; broot=r; bsplit(r,0); }
    p=broot;
    while(!bnodes[p].leaf) {
      i=0; while(i<bnodes[p].count && key>bnodes[p].keys[i]) ++i; /*@insert-descend*/
      if(bnodes[bnodes[p].child[i]].count==2*degree-1) { bsplit(p,i); if(key>bnodes[p].keys[i]) ++i; }
      p=bnodes[p].child[i];
    }
    i=bnodes[p].count;
    while(i>0 && key<bnodes[p].keys[i-1]) { bnodes[p].keys[i]=bnodes[p].keys[i-1]; --i; }
    bnodes[p].keys[i]=key; ++bnodes[p].count; /*@insert*/
  }
  return broot; /*@done*/
}
`;
export const BPLUS_SOURCE = `
typedef struct { long long keys[4]; int count,child[5],leaf,next; } BPNode;
BPNode bp[128]; int bpcount,bproot;
int bpnew(int leaf) { int p=bpcount++; bp[p].count=0; bp[p].leaf=leaf; bp[p].next=-1; return p; }
long long bpmin(int p) { while(!bp[p].leaf) p=bp[p].child[0]; return bp[p].keys[0]; }
void bprefresh(int p) {
  int i;
  if(p<0 || bp[p].leaf) return;
  for(i=0;i<=bp[p].count;i++) bprefresh(bp[p].child[i]);
  for(i=0;i<bp[p].count;i++) bp[p].keys[i]=bpmin(bp[p].child[i+1]);
}
int bpsearch(long long key) {
  int p=bproot,i;
  while(p>=0 && !bp[p].leaf) {
    i=0; while(i<bp[p].count && key>=bp[p].keys[i]) ++i;
    p=bp[p].child[i]; /*@descend*/
  }
  if(p>=0) for(i=0;i<bp[p].count;i++) if(bp[p].keys[i]==key) return p; /*@found*/
  return -1; /*@not-found*/
}
/* Max 3 children/internal node and 2 keys/leaf; leaf split is 2+1. */
int bplus_build(const long long keys[], int n) {
  int a,p,i,j,z,parent,newroot,path[64],at[64],depth,leaf; long long key;
  bpcount=0; bproot=-1; /*@init*/
  for(a=0;a<n;a++) {
    key=keys[a]; if(bpsearch(key)>=0) continue; /*@duplicate*/
    if(bproot<0) bproot=bpnew(1);
    p=bproot; depth=0;
    while(!bp[p].leaf) {
      i=0; while(i<bp[p].count && key>=bp[p].keys[i]) ++i;
      path[depth]=p; at[depth++]=i; p=bp[p].child[i];
    }
    i=bp[p].count;
    while(i>0 && key<bp[p].keys[i-1]) { bp[p].keys[i]=bp[p].keys[i-1]; --i; }
    bp[p].keys[i]=key; ++bp[p].count; bprefresh(bproot); /*@insert*/
    while(bp[p].count>2) {
      leaf=bp[p].leaf; z=bpnew(leaf);
      if(leaf) {
        bp[z].keys[0]=bp[p].keys[2]; bp[z].count=1; bp[p].count=2;
        bp[z].next=bp[p].next; bp[p].next=z;
      } else {
        bp[z].child[0]=bp[p].child[2]; bp[z].child[1]=bp[p].child[3];
        bp[z].count=1; bp[p].count=1;
      }
      newroot=depth==0;
      if(!newroot) {
        --depth; parent=path[depth]; i=at[depth];
        for(j=bp[parent].count+1;j>i+1;j--) bp[parent].child[j]=bp[parent].child[j-1];
        bp[parent].child[i+1]=z; ++bp[parent].count;
      } else { parent=bpnew(0); bp[parent].count=1; bp[parent].child[0]=p; bp[parent].child[1]=z; bproot=parent; }
      bprefresh(bproot);
      if(leaf) bprefresh(parent); /*@split-leaf*/
      else bprefresh(parent); /*@split-internal*/
      if(newroot) bproot=parent; /*@new-root*/
      p=parent;
    }
  }
  return bproot; /*@done*/
}
`;
