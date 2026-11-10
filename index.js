// 供01/02接入时复用的C包局部注册表，不改变公共算法注册或路由。
import * as optimal from './optimal-merge-tree.js';
import * as merge from './multiway-merge.js';
import * as replacement from './replacement-selection.js';
import * as btree from './b-tree.js';
import * as bplus from './b-plus-tree.js';
export const algorithms = Object.freeze({
  'optimal-merge-tree': { title: '最佳归并树', generate: optimal.generateOptimalMergeTreeSteps, example: optimal.DEFAULT_INPUT },
  'multiway-merge': { title: '多路平衡归并', generate: merge.generateMultiwayMergeSteps, example: merge.DEFAULT_INPUT },
  'replacement-selection': { title: '置换选择', generate: replacement.generateReplacementSelectionSteps, example: replacement.DEFAULT_INPUT },
  'b-tree': { title: 'B树', generate: btree.generateBTreeSteps, example: btree.DEFAULT_INPUT },
  'b-plus-tree': { title: 'B+树', generate: bplus.generateBPlusTreeSteps, example: bplus.DEFAULT_INPUT },
});
