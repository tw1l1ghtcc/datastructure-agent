# G 包算法验收与接入说明

G 包 10 项算法的模块、步骤轨迹和 C 展示源码已交付。层序遍历随 [PR #64](https://github.com/tw1l1ghtcc/datastructure-agent/pull/64) 合并并接入工作台。前序、中序、后序及本批六项的实现与验收汇总见 [PR #70](https://github.com/tw1l1ghtcc/datastructure-agent/pull/70)。递归栈及回退说明见[深度优先遍历验收](g-depth-first-validation.md)。

## 本批六项算法

各模块位于 `shared/algorithms/final/g/`，均导出默认输入、源码版本、展示源码行和下表的生成函数。每步记录 `stepIndex`、`event`、`lineId`、中文解释和独立的 `variables` 快照，结束步骤附结果。结果结构和展示所需的变量见下表。

| 算法 | 生成函数及输入 | 状态与默认结果 | 边界 |
|---|---|---|---|
| 二叉树重建 | `generateBinaryTreeReconstructionSteps({preorder,inorder})` | `stack` 记录前序和中序的左闭右开区间及左右子区间，`edge` 给出新增链接。返回 `{root,nodes}`，还原 A 的孩子 B、C 及 B 的右孩子 D。 | 空输入返回空树，拒绝重复标识、不同长度或不能构造同一棵树的序列。 |
| 二叉树线索化 | `generateThreadedBinaryTreeSteps({root,nodes})` | `currentNode`、`previous` 和 `edge` 标注新增前驱或后继。节点以 `leftThread`、`rightThread` 区分线索与孩子边。返回 `{root,nodes,order}`，沿线索访问 B、D、A、C。 | 首节点的前驱和末节点的后继为空。一个节点的两个空链接均标为线索。 |
| 树与森林转换 | `generateTreeForestConversionSteps({mode,roots,nodes})` 或 `({mode,root,nodes})` | `to-binary` 按首个孩子和右兄弟连边，返回 `{root,nodes}`。默认结果为 A 的左链接 B、右链接 D，B 的右链接 C。`to-forest` 按孩子兄弟链恢复有序的 `{roots,nodes}`。状态提供 `forestNodes`、`binaryNodes` 与变化的 `edge`。 | 支持空森林、多个根和单链；拒绝环、重复访问、缺失引用及不可达节点。 |
| 树与森林遍历 | `generateTreeForestTraversalSteps({mode,roots,nodes})` | `preorder` 默认输出 A、B、C、D，`postorder` 输出 B、C、A、D。用从 1 开始的 `treeIndex`、`stack` 和 `currentNode` 回放进入、访问与回退。 | 空森林结果为空，从输入顺序逐一访问根。 |
| 哈夫曼编码 | `generateHuffmanCodingSteps({symbols:[{id,weight}]})` | `candidates`、`selected` 和 `nodes` 展示选取与合并。权重 2、3、7 生成码字 00、01、1，带权路径长 17。返回 `{root,nodes,codes,weightedPathLength,encodedBitLength}`，其中编码项含输入编号、ID、权重及码字。 | 支持空输入。等权重时先取编号较小者，内部节点按创建顺序继续编号。单符号码字为 0，树的带权路径长为 0，实际编码位数为该符号权重。 |
| 二叉排序树 | `generateBinarySearchTreeSteps({operations:[{type,key}]})` | `type` 为 `insert` 或 `search`。`path` 保存比较过的节点编号，`edge` 标注下一条链接。返回 `{root,nodes,operations,inorder}`，默认查找 4 的路径键为 5、3、4，中序为 3、4、5、7。 | 重复键保留原节点，未命中返回空节点。允许 32 位有符号键、64 个不同键和 128 次操作。 |

普通二叉树使用 `{root,nodes:[{id,left,right}]}`，空树的 `root` 为 null。有序森林使用 `{roots,nodes:[{id,children}]}`，空森林的 `roots` 为空数组。两种表示的 ID 均为唯一的非空字符串，节点上限 64。哈夫曼编码的符号上限 64，输入权重为 1 到 2147483647 的整数。

C 源码使用数组下标表示节点，`-1` 表示空链接。森林使用根下标数组、按节点顺序拼接的孩子数组和偏移表。树和森林结构在传给 C 函数前完成输入验证。哈夫曼累计权重和代价使用 64 位整数。

## 二叉排序树复审

生成轨迹前验证全部操作，并按 `insert` 操作的不同键检查 64 节点上限。65 个不同键在首个快照前抛出原有 `TypeError`。查找和重复插入不占用容量，重复插入仍返回原节点。

`generateBinarySearchTreeSteps(input)` 保留完整的回放字段、步号和源码映射。相邻步骤在树结构相同时共用只读节点数组。紧凑传输入口为 `generateBinarySearchTreeReplay(input)`，返回 `bst-replay-v1` 格式。空树及每次成功插入各保存一个 `treeStates` 快照，步骤保存快照下标、操作下标、比较路径长度和最近结果下标。完整路径按操作保存一次。读取端使用 `restoreBinarySearchTreeRun(replay)` 还原 `steps` 和变量，传入的 `runId`、`algorithm` 与 `input` 会保留。

| 输入 | 步数 | 原完整 JSON | 紧凑 JSON | 首次播放回调中位数 |
|---|---:|---:|---:|---:|
| 默认样例 | 36 | 24,231 字节 | 10,762 字节 | 0.32 → 0.16 ms |
| 插入 0–63，再查找缺失键 64 共 64 次 | 12,482 | 37,975,549 字节 | 2,593,964 字节 | 604.76 → 41.90 ms |

在同一 Node.js v24.22.3 进程中交替运行 PR 原提交 `4ec10fb` 和紧凑版本。预热后各测 7 次，计时包括算法生成、JSON 序列化与解析、紧凑版本还原、现有播放器分发首帧。字节数为未压缩算法数据，计时为本地模块测量。工作台集成后的浏览器验收见下节。

新增回归通过同一 `runId` 将紧凑轨迹还原到播放器，并在最后一次未命中与回退后的移动步骤分别调用现有问答处理器。测试核对 64 个比较节点、当前与上一步的状态，以及 `missing` / `right` 高亮行。问答后端已识别二叉排序树的步骤状态。

## 工作台集成

G 包集成分支补齐前序、中序、后序遍历和六项进阶算法。二叉排序树位于「第七章 · 查找」，其余九项位于「第五章 · 树与二叉树」。树表单、序列、森林、符号权重和插入／查找操作都可从「填入示例」开始。各状态表随当前步骤更新，源码和问答使用同一运行编号及步骤索引。树形动画待引擎修复后接入。

二叉排序树的运行创建和整次查询传输紧凑格式。浏览器和服务端复用同一还原函数，服务端使用标准快照处理单步查询和问答。12,482 步边界样例的完整 HTTP 查询响应为 2,597,517 字节，含运行元数据和输入。时间轴只渲染最多 100 个可见刻度，保留全部步号，可逐步定位和回看。

## 复现

在 Windows x64 项目根目录执行以下命令。

```powershell
npm.cmd run check
node --test tests/final-g-*.test.mjs
node tests/g-workbench.browser.mjs
```

G 包专项包含 30 项测试。仓库自带的 Open Watcom 从返回的 `SOURCE_LINES` 编译和运行全部 10 份 C 源码，共 357 组原生用例。其中层序遍历 5 组，前序、中序、后序各 105 组，本批六项共 37 组。层序默认结果为 A、B、C、D，D 在第 3 层。空树、单节点以及左偏、右偏的 64 节点树均已实跑。专项同时校验 `enqueue-root`、`enqueue-left`、`enqueue-right` 的高亮和入队状态。

工作台专项使用 Edge 验证全部十项的菜单、示例输入、结果、状态表、源码高亮、单步、回退、重置和 Mock 问答，并覆盖森林双向转换、后根遍历、非法输入保留旧运行，以及 12,482 步的二叉排序树回放。Playwright 配置见[测试说明](../../../tests/README.md)。

## 主工作台 Plus 动画

G 包十项使用本次运行的树节点与边绘制动画。四种二叉树遍历显示队列或递归栈及访问顺序，重建显示逐步接上的孩子边，线索化用虚线区分前驱和后继。森林转换同时显示两种表示，哈夫曼编码显示候选权重、森林和 0／1 分支，二叉排序树显示比较路径。长序列的完整内容可在下方状态表查看。

使用 Edge 和 Playwright 运行 `node tests/g-workbench.browser.mjs`，检查十项动画和步进、回退、源码同步，含 64 节点深树与超过一万步的压缩回放。步骤辅导使用 Mock。
