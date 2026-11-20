# API 契约 v1

更新：2026-11-03。核对至 `main` 的 `8a909c2`（PR #42）。同源前后端，请求使用 JSON 与 `Content-Type: application/json`。联调状态见[接口对齐清单](contract-alignment.md)。

## 当前接口

| 方法与路径 | 当前行为 | 主责 |
|---|---|---|
| GET /api/health | 200；ok=true、stage=scaffold、implemented 包含 static-page/health/runs/exercises/agent/knowledge；mode 为 disabled/mock/deepseek，modelCallsEnabled 按实际模式返回 | 04 |
| POST /api/algorithms/binary-search/runs | 200，创建并返回完整 run | 04 |
| POST /api/algorithms/linear-search/runs | 200，创建并返回顺序查找 run | 01 |
| POST /api/algorithms/block-search/runs | 200，创建并返回分块查找 run | 01 |
| POST /api/algorithms/bubble-sort/runs | 200，创建并返回冒泡排序 run | 01 |
| POST /api/algorithms/{D包树或哈希算法}/runs | 200，创建树或哈希运行 | 01 |
| POST /api/algorithms/{C包算法}/runs | 200，创建归并或多路查找树运行 | 01 |
| POST /api/algorithms/{E包算法}/runs | 200，创建线性表、矩阵或分配排序运行 | 01 |
| POST /api/algorithms/{G包算法}/runs | 200，创建 G 包运行。二叉排序树返回紧凑回放 | 01 |
| POST /api/algorithms/union-find/runs | 200，创建并查集运行 | 01 |
| POST /api/algorithms/{图算法}/runs | 200，创建并返回图算法 run | 01 |
| POST /api/algorithms/custom-array/runs | 本机 Windows，编译并执行自定义数组代码，200 返回实际执行 run | 01 |
| GET /api/runs/:runId | 200，返回与创建接口相同格式的 run | 04 |
| GET /api/runs/:runId/steps/:stepIndex | 200，返回 `{runId,step}` | 04 |
| GET /api/exercises | 200，返回 `{exercises:[...]}`；默认二分查找10题，可用 `topicId=bubble-sort` 读取冒泡排序10题，或 `topicId=all` 读取两个题库 | 04+06 |
| POST /api/exercises/check | 200，程序判分及固定提示 | 04+07 |
| POST /api/agent/explain | 无Key且未开Mock时503；显式AGENT_MOCK=true优先；否则有Key直接调用DeepSeek，返回真实步骤归属；聊天sourceRefs为空 | 05，04整合入口 |
| GET /api/agent/usage?sessionId=... | 200，当前来源/会话的请求数、失败数、耗时及已知用量；未知值null | 05 |
| GET /api/knowledge/cards | 200，verified卡片目录或按q检索；无Key也可使用 | 05+06 |

## 运行与步骤

二分查找的创建输入为 `{"array":[1,3,5,7,9],"target":7}`。

- array 为非递减安全整数数组，最多100项；target 为安全整数。不接受数字字符串、小数或不安全整数。允许空数组、负数、重复值；不自动排序或去重。
- 创建与判分的请求体最多10240字节，按 UTF-8 字节计；超过限制当前返回400 INVALID_INPUT。
- 创建成功为200，完整对象字段如下。输入固定，改输入需创建新 run。

| 字段 | 当前格式 |
|---|---|
| runId | 服务端生成的字符串 |
| createdAt | Date.now()，毫秒时间戳数字 |
| algorithm | binary-search |
| sourceVersion | c-v2 |
| sourceLines | `[{lineId,text}]`，15 行 C/C++ 函数 `binary_search`，包含函数声明与结尾 |
| steps | 完整步骤数组；schemaVersion=1.0，格式见[状态契约](trace-contract.md) |
| result | 匹配下标或-1，与最终步骤一致 |

闭区间、零下标、mid 向下取整；重复值返回实际命中的任一下标，不承诺首个或末个。run 存在服务进程内存 Map 中，保留1小时，每60秒清理；查询过期 run 也会删除。重启丢失，没有持久化或容量上限策略。输入数组位于每个 step 的 array 中，顶层没有单独 array/target 字段。

stepIndex 使用十进制非负整数字符串；超出已存在 run 的步骤范围返回400 STEP_OUT_OF_RANGE。负数、小数和非数字路径不匹配当前路由，返回404 NOT_FOUND。不存在或已过期的 run 返回404 RUN_NOT_FOUND。

冒泡排序使用 `{"array":[5,1,4,2]}` 创建运行。接受 0 到 24 个安全整数，允许乱序、负数和重复值。它共用运行和步骤查询接口，`algorithm` 为 `bubble-sort`，`sourceVersion` 为 `bubble-c-v1`，最终 `result` 为升序数组。每一步保存当前 `array`、说明 `description` 和 `variables: {pass, index, sortedFrom}`。其中 `index` 是相邻比较的左下标，无比较时为 `null`，`sortedFrom` 起为已就位区间。事件为 `init`、`compare`、`swap`、`pass-end`、`sorted`。步骤问答使用当前和上一步的数组，回复的 `stepRefs` 包含 `algorithm`、`array` 和排序变量。冒泡排序题可独立作答，和二分查找共用判分接口与本机记录。

顺序查找接受 `{array, target}`，允许无序、重复和空数组，命中时返回第一个匹配下标。分块查找接受 `{blocks, target}`，最多 64 块，跳过空块；非空块之间须满足前块最大值不大于后块最小值。两者的工作台与 API 均最多接受 100 个安全整数元素，未命中返回 -1。分块查找结果使用展开数组的零基下标。分块步骤保留最大值索引和块边界，两个接口均复用步骤查询与「问一步」。

D 包新增 `avl-tree`、`red-black-tree`、`hash-linear-probing`、`hash-quadratic-probing`、`hash-double-hashing` 和 `hash-chaining`。树请求为 `{keys,target?}`，三种探测为 `{keys,capacity,target?}`，拉链法为 `{keys,bucketCount,target?}`。沿用已有 D 包实现及限制，最多 64 个插入键，容量／桶数 1～1024。平方探测容量须为奇素数，双散列容量须为不小于 2 的素数。工作台先展示槽位、桶链和节点状态表，支持建表／建树后查询一个键，留空查询则只执行插入。运行保留输入快照 `input`，与现有接口共用步骤查询及问答。

C 包运行标识为 `optimal-merge-tree`、`multiway-merge`、`replacement-selection`、`b-tree`、`b-plus-tree`。请求分别为 `{weights}`、`{runs,k}`、`{array,capacity}`、`{keys,queries,t}`、`{keys,queries}`。沿用 C 包现有上限及校验，见 [C 包接口](../../shared/algorithms/final/c/README.md)。运行保存输入快照 `input`，共用运行查询、步骤查询和问答接口。主工作台先展示状态表，树结构由引擎自动构建，动画待接入。

E 包复用运行、单步查询及步骤问答。合法输入返回 `{runId,createdAt,algorithm,input,sourceVersion,sourceLines,steps,result}`。参数错误或引擎拒绝输入时返回 400 INVALID_INPUT。

| 算法标识 | 请求体与参数 |
| --- | --- |
| `array-list-reverse`、`singly-linked-list-reverse` | `{list}`，可为空 |
| `array-list-delete-range` | `{list,left,right}`，删除有效的零基闭区间 |
| `singly-linked-list-insert` | `{list,pos,value}`，`pos` 从 0 到表长，`value` 为 32 位整数 |
| `singly-linked-list-delete` | `{list,pos}`，`pos` 为现有元素的零基下标 |
| `kth-from-end` | `{list,k}`，`k` 从 1 到表长，结果为 `{nodeId,value}` |
| `sparse-matrix-transpose` | `{rows,cols,triples:[{i,j,e}]}`，非负矩阵尺寸，最多 64 列和 64 个三元组。行列下标从 0 开始，坐标唯一，`e` 为有限数值 |
| `radix-sort`、`counting-sort` | `{list}`，基数排序接受非负整数，计数排序要求 `max - min + 1 ≤ 5000` |

顺序表和链表最多 64 个元素，两个排序最多 24 个元素，序列元素均为 32 位有符号整数。链表快照保留 `headId` 和结点的稳定编号。转置从 `variables.triples[k]` 读取本步的三元组，使用 `pos` 标记输出位置。计数排序使用 `countDiff` 记录本步增量，工作台按当前步回放增量还原计数表。

二叉树层序遍历接受 `{root,nodes}`，每个节点为 `{id,left,right}`，最多 64 个唯一非空字符串 ID。孩子为空时使用 null，非空孩子须引用已定义的节点。空树为 `{root:null,nodes:[]}`。拒绝环、共享孩子及从根不可达的节点。运行保留输入快照 `input`，步骤与 G 包引擎一致，包含节点关系、FIFO 队列及层号（根为第 1 层）、当前节点、访问顺序和分层结果。主工作台使用节点、队列和分层状态表，支持单步、回看和问答；树形动画待接入。

其余 G 包运行接口共用以下格式。创建成功保留输入快照 `input`。非法结构、超出算法上限或非法模式返回 400 INVALID_INPUT。各算法继续使用已合并的轨迹字段，见 [G 包算法验收](../team/final/g-validation.md)。

| 算法标识 | 请求体 |
| --- | --- |
| `binary-tree-preorder`、`binary-tree-inorder`、`binary-tree-postorder`、`threaded-binary-tree` | `{root,nodes}`，节点表示与层序遍历相同 |
| `binary-tree-reconstruction` | `{preorder,inorder}`，两个等长序列，每个序列最多 64 个不同节点 ID |
| `tree-forest-conversion` | `{mode:"to-binary",roots,nodes}` 或 `{mode:"to-forest",root,nodes}` |
| `tree-forest-traversal` | `{mode,roots,nodes}`，模式为 `preorder` 或 `postorder` |
| `huffman-coding` | `{symbols:[{id,weight}]}`，最多 64 个唯一符号，权重为 1 到 2147483647 的整数 |
| `binary-search-tree` | `{operations:[{type,key}]}`，类型为 `insert` 或 `search`，键为 32 位有符号整数，最多 128 次操作、64 个不同插入键 |

森林节点为 `{id,children}`，根和孩子均按输入顺序排列，最多 64 个节点。二叉排序树的创建和整次查询返回 `format:"bst-replay-v1"`，`treeStates` 保存每次插入后的节点快照，传输步骤通过下标引用快照和操作路径。工作台用 `restoreBinarySearchTreeRun` 还原为标准步骤。单步查询和「问一步」直接使用服务端按同一轨迹还原的步骤。

并查集接受 `{elements, operations}`，1 至 30 个唯一非空字符串元素，最多 60 个操作。操作格式为 `["union", x, y]` 或 `["find", x]`，引用未知元素时返回 400。空操作序列可运行。运行保存输入快照 `input`，步骤使用现有引擎的 `parent`、`rank`、`setCount`、`currentOp` 和 `findPath`。工作台使用父节点表，单步、回看、源码高亮和问答共用当前步骤；树形动画待接入。

图算法标识为 `bfs`、`dfs`、`prim`、`kruskal`、`dijkstra`、`floyd` 和 `topological-sort`。请求接受 `{nodes, edges, directed, start}`。顶点名须唯一，最多 30 个（Floyd 最多 8 个），边最多 120 条。BFS、DFS、拓扑排序使用 `[from, to]`；其他图算法使用 `[from, to, weight]`，权重为有限数值，绝对值不超过 10¹²。Dijkstra 拒绝负权。BFS、DFS、Prim、Dijkstra 需要起点；Prim、Kruskal 固定无向，拓扑排序固定有向。可选方向默认无向。边端点和起点须在顶点列表内。

运行结果的 `graph` 保存去重后的边和完整顶点列表，包括孤立顶点。各算法共用运行与步骤查询接口。步骤使用引擎原有的 `variables`、`description` 和 `result`。Floyd 距离矩阵的行列按顶点输入顺序排列。拓扑排序检测到环时，运行正常结束，结果为 `Has Cycle`。

Floyd 将边权按共同的十进制精度转换为定点整数，距离矩阵和 `variables.candidateDistance` 使用十进制显示字符串，`∞` 表示不可达。Kruskal 的 `result.selectedEdges`、`variables.selectedEdges` 和 `variables.sortedEdges` 保留边的 `[from, to, weight]` 结构。

自定义数组代码接受 `{language, source, array}`，语言为 `c` 或 `cpp`，代码最多 5000 字符，数组最多 24 个 32 位整数。入口为单个 `void sort(int a[], int n)` 函数，支持初始化的整数变量、数组读写、带花括号的条件和循环。后端检查语法后插入数组访问检查与记录，再调用 `third_party/open-watcom` 下的本机编译器。运行只接受回环连接，支持用 `http://127.0.0.1:3000` 打开。结果共用运行与步骤查询接口，`algorithm` 为 `custom-array`，事件为 `init`、`condition`、`write` 和 `finished`。每步包含原始源码行、数组和 `variables: {line, index, writes}`。数组越界、运算错误或超出执行限制返回 422，编译器缺失返回 503。

## 题目与判分

GET /api/exercises 当前读取 `content/exercises/binary-search.json`。公开字段只有 id、version、topicId、type、prompt、context、options；不返回 answer、hints 或 explanation。当前数据均为本批已检查题目，但路由没有实现 verified/草稿过滤。可附 `?topicId=binary-search`，当前代码忽略查询参数，不支持按主题筛选。

context 是题目场景，不是实时 run 的 step：可能含 before-probe，sourceVersion 可为 null，以 algorithmContractId=binary-search-content-v1 标识内容口径；不要强行当成引擎事件或实时状态。

POST /api/exercises/check 输入示例：

```json
{"exerciseId":"bs-q02","exerciseVersion":"1.0.0","answer":"A","hintLevel":1}
```

- value：answer 必须为安全整数数字；choice：必须为 options 中的精确选项 ID 字符串；judgement：必须为布尔值。
- hintLevel 缺省为数字1，只接受数字1、2、3，不接受字符串。
- 正确：`{"correct":true}`，包括第三级也不额外返回解析。
- 错误，一级/二级：`{"correct":false,"hint":"对应固定提示"}`。
- 错误，第三级：`{"correct":false,"correctAnswer":"B","explanation":"对应解析"}`；correctAnswer 类型随题型变化，此时无 hint 字段。
- 类型/提示级别/选项非法为400 INVALID_INPUT；题目不存在为404 NOT_FOUND。评分由程序执行，不调用模型，也不保存作答记录。
- exerciseVersion 可省略以兼容既有调用；提供时必须为非空字符串，否则400 INVALID_INPUT。与服务端题目version不一致时409 EXERCISE_VERSION_MISMATCH，客户端提示刷新题库，不保存作答。07始终发送当前展示版本，并在本机记录中保留题目快照、版本、答案、正确性、提示级别、时间和可选run/步骤关联。旧版本记录仅供回顾，不计入当前版本进度；重练使用当前题库。

## 错误与未实现部分

错误使用 `{error:{code,message}}`。非法JSON及上述输入错误为400 INVALID_INPUT；未知 API 为404 NOT_FOUND；请求解析失败可为400 INVALID_REQUEST。

## Agent 与聊天（2026-10-23，直接模型问答）

请求为{runId,stepIndex,question,hintLevel,sessionId?,conversationId?,turnId?}。runId非空；stepIndex为非负安全整数，不能类型转换；question为1至2000字符非空字符串；hintLevel缺省1，显式为数字1/2/3。客户端stepState/history不作为权威状态或历史。

显式AGENT_MOCK=true仍优先使用标注Mock的免费模板；关闭Mock且有Key时，每个通过参数/真实运行/额度检查的新问题直接交给DeepSeek，不做知识检索、问法识别或无资料拒答；无Key时503。成功请求原ID在保留窗口内重试可重放缓存，不重复调用。

prompt 提供当前运行输入（图或数组及目标）、步骤和变量、上一步真实快照、展示代码全部sourceLines/高亮lineId/sourceVersion及最近最多10轮问答。历史只作上下文，不覆盖服务端事实。成功回复包含runId/stepIndex/hintLevel/answer/stepRefs/usage；兼容字段sourceRefs=[]、knowledgeUsed=false、retrieval={method:none,status:disabled,matchedCardIds:[],contextCardId:null,matches:[]}。图算法的 stepRefs 包含 algorithm、event 和图步骤的 variables。stepRefs 不含 knowledgeCard。聊天界面不显示知识卡出处。

conversationId和turnId须同时提供，均为8至80位字母/数字/下划线/连字符；不传时保持无历史单轮兼容。服务端按socket来源+runId+conversationId隔离，最多10轮成功完整问答、总8000个UTF-16字符，超限移除最早整轮。1小时无活动过期，最多200个会话，重启清空；切步骤保留，新运行换ID隔离。失败不入历史，成功回复不再受knowledgeUsed控制。

同会话并发409 CONVERSATION_BUSY；全容量执行中429 CONVERSATION_BUSY；同turnId改写问题/步骤/级别400。重试保存原运行、步骤、级别及ID。限流依据socket来源，sessionId只作统计，换会话不重置来源额度。预算调用前同步预留，账本及未知用量处理保持原行为，详见[Agent说明](../../backend/src/agent/README.md)。

其他错误：400 INVALID_INPUT（含非法JSON、超过10KB）、404 RUN_NOT_FOUND、400 STEP_OUT_OF_RANGE、429 RATE_LIMIT_EXCEEDED/TOKEN_LIMIT_EXCEEDED/BUDGET_EXCEEDED、503 BUDGET_UNAVAILABLE、502 MODEL_CALL_FAILED、504 MODEL_TIMEOUT。空模型输出为502可重试，不缓存成成功固定话术。usage保留model/mock/tokens/elapsedMs/cost/CNY/估算依据，缺失或无价格仍为null；GET /api/agent/usage的统计及预算持久化边界不变。

检查记录：[直接模型问答](agent-direct-chat-check-20261023.md)。本地桩不代表真实模型效果或08独立验收。

## 已核验知识查询与问题检索

GET /api/knowledge/cards?topicId=binary-search&q=问题&limit=3：topicId缺省binary-search；q可省略，省略时列目录（默认10张），存在时须为1至2000字符非空值（默认3张）；limit是1至10的十进制整数。只返回同主题verified=true且具备有效出处/版本的卡片。未知主题/无匹配200空数组；非法参数400 INVALID_INPUT；资料读取失败503 KNOWLEDGE_UNAVAILABLE。

返回 `{topicId,query,cards,sourceRefs,retrieval}`。cards含id/topicId/title/content/keywords及出处版本字段；不返回内部review记录。retrieval.method=keyword-v1，status为catalog/matched/no-match；matches含cardId/score/matchedTerms，score是排序权重，不是模型置信度。

此独立接口仅供知识卡阅读/查询，不参与聊天的模型调用与来源生成。

本批只覆盖现有10张自编二分查找卡，不使用向量数据库，无额外依赖；排序细节及限制见[知识检索说明](../../backend/src/knowledge/README.md)。

## 正式工作台步骤上下文

工作台使用服务端完整运行和一个播放指针，初次运行分发步骤 0。输入失效时广播 `null` 并取消旧请求。源码按 `sourceLines` 和 `lineId` 渲染。内置算法提问时暂停播放，更换运行取消旧问答。`subscribeStep(listener)` 与 `workbench:step` 事件提供只读上下文 `{runId,algorithm,stepIndex,step,total,playing,sourceVersion}` 或 `null`。练习用固定题目情境，作答只关联同主题的运行。具体生命周期见[工作台接入说明](../../frontend/src/features/workbench/README.md)。
