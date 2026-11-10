# C包 · 成员06（秦文贵）

基于主仓库 `35d13d4` 实现；分支 `feat/final-c-external-multiway`。五项算法及自测已实现，独立预览可供01/02联调；正式工作台的算法菜单、公共路由和结构渲染尚待01/02接入，未代签团队验收。

## 直接查看效果

在项目根目录运行：

```powershell
node scripts/preview-final-c.mjs
```

打开 <http://127.0.0.1:3106>，选择算法，点击“填入示例”“生成步骤”，再使用上一步、下一步、播放、暂停、末步、重置和时间轴。该预览复用现有`createPlayback`，每一步读取实际生成的快照；展示源码和JSON状态，树视图由节点及孩子ID绘制。换算法或输入时取消旧请求并清理旧播放器。

`npm start`继续启动原项目。C包预览使用独立入口，方便先检查本组实现；其临时`/api/run`不替代正式API契约，也不调用模型。

## 模块与接口

每个算法返回`{steps,result,sourceVersion,sourceLines}`，与已有冒泡排序保持同一外层形状；同时导出`SOURCE_VERSION`、`SOURCE_LINES`和`DEFAULT_INPUT`。局部注册表为`index.js`。

| 模块 | 导出函数 | 输入 | 最终result |
|---|---|---|---|
| optimal-merge-tree.js | generateOptimalMergeTreeSteps | `{weights:[2,3,7]}` | `{root,nodes,cost}`，例中cost=17 |
| multiway-merge.js | generateMultiwayMergeSteps | `{runs:[[1,4],[2,3],[0,5]],k:2}` | `[0,1,2,3,4,5]`，末帧pass=2 |
| replacement-selection.js | generateReplacementSelectionSteps | `{array:[4,5,1,2,6],capacity:2}` | `[[4,5],[1,2,6]]` |
| b-tree.js | generateBTreeSteps | `{keys:[10,20,5,6],queries:[6,7],t:2}` | `{root,nodes,keys,queries}` |
| b-plus-tree.js | generateBPlusTreeSteps | `{keys:[10,20,30,40,50,60,70],queries:[30,35]}` | `{root,nodes,keys,queries}` |

树也支持单个`target`，它追加到queries尾部。省略keys/queries默认为空；显式输入键及目标必须为安全整数。查询结果各含`key,found,node,index,path`，未命中node/index为null。B树内部键可以命中；B+树始终下降到叶后确定命中。

## 已固定的本包算法口径

- 最佳归并树默认二路，每次取两个最小权重；同权按创建ID。权重非负，空输入root=null/cost=0，单段cost=0；任何合并或累计代价超出JS安全整数范围会拒绝。
- 多路平衡归并要求输入段非递减，每批最多k段，一趟产物继续归并；空段跳过；相等时优先段号较小者，不丢重复值。
- 置换选择保持至多capacity个缓冲项；读入值小于刚输出的段末值才冻结；活动区耗尽后解冻开新段。同值按原输入下标稳定选择。
- B树按最小度数t定义，2<=t<=8，默认2，每节点最多2t-1键、非根至少t-1键；进入满孩子前分裂。重复键先检查，结构不变。
- B+树固定内部最多3个孩子、叶最多2键，叶溢出按左2右1分裂；内部4个孩子按2+2拆分，分隔键等于右子树最小键。等于分隔键时向右下降。叶链保存全部有序唯一键。
- B树、B+树仅实现本次要求的查找与插入；重复键按集合处理。

这些是本包可执行的内容与输入约定。01/02接入公共协议时可讨论字段调整，但不能在交接前声称已经冻结全队接口。

## 输入上限

生成快照前校验：权重、树插入键最多64个；查询总数最多64个；最多32个归并段、合计128元素；置换选择最多128元素；k为2～32，缓冲容量为1～64。拒绝稀疏数组、非整数及非安全整数，输入数组不被修改。上限用于控制教学快照规模，不冒充算法理论限制。

## 02需要的步骤数据

公共字段沿用`schemaVersion=1.0, algorithm, stepIndex, event, sourceVersion, lineId, variables, description, done, result`。只有最后`done`事件设置done=true并给result；中间的found/not-found只是某次查询结果。所有嵌套字段均深拷贝，回看不重算。

| 算法 | variables中的结构数据 | 主要事件 |
|---|---|---|
| 最佳归并树 | nodes、candidates（ID列表）、selected、parent、cost | init/select/merge/done |
| 多路归并 | runs、k、pass、groupStart、group、positions、candidates、selected、output、producedRuns | init/skip-empty/pass-start/select/output/run-end/pass-end/done |
| 置换选择 | array、capacity、readIndex、active/frozen（value/index）、currentRun、runs、selected/incoming | init/load/output/freeze/activate/run-end/new-run/done |
| B树 | root、nodes、t、maxKeys、key、phase、path、currentNode、index/childIndex、split | init/descend/split-root/split-child/insert/duplicate/compare/found/not-found/done |
| B+树 | root、nodes、leafKeys、order、leafCapacity、key、phase、path、currentNode、overflowNode、split | init/descend/insert/insert-overflow/split-leaf/split-internal/new-root/duplicate/found/not-found/done |

树节点格式：`{id,leaf,keys,children,next}`。children为孩子ID，next为B+叶链ID或null。最佳归并树节点为`{id,weight,left,right,inputIndex}`，孩子也是ID。ID从0按创建顺序递增；0是合法ID，不能用真假判断代替null检查。

B+树采用自底向上分裂：insert-overflow或父节点待分裂时，`overflowNode`明确标出唯一暂时超容量的节点；其余节点仍满足容量。分裂、父链接与分隔键更新作为一次可回放动作完成后记录，保证每一帧的节点都可从根访问。叶链始终有序且与树一致。

## C/C++源码

`sources.js`保存完整自包含的C函数和辅助定义，`sourceLines`去除内部标记后给出全部源码。该源码也可按C++编译，未使用外部伪函数。固定数组容量与上述输入上限对应；输入合法性及安全整数范围由调用方校验。关键lineId为稳定语义标识，不依赖排版行号。

`tests/final-c-native.test.mjs`将返回的完整源码直接拼接测试main，使用仓库已有Open Watcom分别编译C和C++、链接并执行。16组输入分别对比JS代价、每个归并树节点、多路结果与趟数、置换分段、B树/B+树的全部键/孩子/叶链，合计32次执行。未安装该Windows工具链的环境明确skip该测试，不伪装通过。

## 人工预期与测试

最佳归并树`[2,3,7]`：初始候选ID0/1/2权重2/3/7；取0/1，创建ID3权重5，累计5；取3/2，创建ID4权重12，累计17；root=4。空段集合无节点，单段不合并，同权按ID取出。

置换选择样例修正：M=2，初始活动4/5；输出4读1并冻结；输出5读2并冻结；活动区空，因此第一段为[4,5]；解冻1/2，输出1后读6，依次输出2/6，第二段为[1,2,6]。任务单原分段已同步修正；输入[4,5,1,6,2]才得到[4,5,6]与[1,2]。

B树插入10/20/5后根为[5,10,20]；插入6之前拆根，提升10，叶为[5]和[20]，再把6插入左叶，最终[5,6]与[20]。B+树插入10～70（步长10）后叶链为[10,20]→[30,40]→[50,60]→[70]，根分隔键50，下一层分别包含分隔键30和70。

```powershell
npm run check
node --test tests/final-c.test.mjs tests/final-c-native.test.mjs tests/final-c-preview.test.mjs
npm test
# 可选，需Playwright与可用浏览器；沿用项目测试环境变量
node tests/final-c-preview.browser.mjs
```

单元测试包括独立枚举最优代价、随机排序/元素守恒、缓冲容量、每一步树节点可达/叶同深/键范围/容量/分隔键/叶链、输入拒绝、历史快照独立及现有播放器回看。源码与真实HTTP检查不能代替01/02正式页面联调。真实结果见[本次检查记录](../../../../docs/team/final/c-validation.md)。
