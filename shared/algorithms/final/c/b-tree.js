import { treeInput, integer, recorder, sourceLines } from './util.js';
import { treeStore, btreeKeys } from './tree-util.js';
import { BTREE_SOURCE } from './sources.js';
export const SOURCE_VERSION = 'c-b-tree-v1';
export const SOURCE_LINES = sourceLines(BTREE_SOURCE, 'btree');
export const DEFAULT_INPUT = { keys: [10, 20, 5, 6], queries: [6, 7], t: 2 };

export function generateBTreeSteps(input) {
  const { keys, queries } = treeInput(input);
  const t = integer(input.t === undefined ? 2 : input.t, 't（最小度数）', 2, 8), maxKeys = 2 * t - 1;
  const store = treeStore(), rec = recorder('b-tree', SOURCE_VERSION, SOURCE_LINES);
  let root = null;
  const present = new Set(), queryResults = [];
  const view = extra => ({ ...store.snapshot(root), t, maxKeys, ...extra });
  function locate(key, phase) {
    let n = root; const path = [];
    while (n) {
      path.push(n.id);
      let index = 0;
      while (index < n.keys.length) {
        rec.add('compare', 'compare', `在节点 ${n.id} 比较 ${key} 和 ${n.keys[index]}。`, view({ key, phase, path, currentNode: n.id, index }));
        if (key <= n.keys[index]) break;
        index++;
      }
      if (index < n.keys.length && key === n.keys[index]) return { key, found: true, node: n.id, index, path };
      if (n.leaf) break;
      rec.add('descend', 'descend', `下降到第 ${index} 个孩子。`, view({ key, phase, path, currentNode: n.id, childIndex: index }));
      n = n.children[index];
    }
    return { key, found: false, node: null, index: null, path };
  }
  function split(parent, index, isRoot, key) {
    const left = parent.children[index], right = store.create(left.leaf), promoted = left.keys[t - 1];
    right.keys = left.keys.slice(t); left.keys = left.keys.slice(0, t - 1);
    if (!left.leaf) { right.children = left.children.slice(t); left.children = left.children.slice(0, t); }
    parent.keys.splice(index, 0, promoted); parent.children.splice(index + 1, 0, right);
    rec.add(isRoot ? 'split-root' : 'split-child', 'split', `分裂节点 ${left.id}，提升 ${promoted}${isRoot ? '，产生新根' : ''}。`, view({ phase: 'insert', key, currentNode: parent.id, split: { left: left.id, right: right.id, parent: parent.id, promoted }, path: [] }));
  }
  rec.add('init', 'init', `建立最小度数 t=${t} 的B树，最多 ${maxKeys} 键。`, view({ phase: 'insert', path: [], currentNode: null }));
  for (const key of keys) {
    // 先去重，防止重复插入满根时引起无意义分裂。
    if (present.has(key)) { rec.add('duplicate', 'duplicate', `${key} 已存在，结构不变。`, view({ phase: 'insert', key, path: [], currentNode: null })); continue; }
    if (!root) root = store.create(true);
    if (root.keys.length === maxKeys) {
      const parent = store.create(false); parent.children = [root]; root = parent;
      split(root, 0, true, key);
    }
    let n = root; const path = [];
    while (!n.leaf) {
      path.push(n.id); let i = 0;
      while (i < n.keys.length && key > n.keys[i]) i++;
      rec.add('descend', 'insert-descend', `为 ${key} 选择节点 ${n.id} 的第 ${i} 个孩子。`, view({ phase: 'insert', key, path, currentNode: n.id, childIndex: i }));
      if (n.children[i].keys.length === maxKeys) { split(n, i, false, key); if (key > n.keys[i]) i++; }
      n = n.children[i];
    }
    let i = 0; while (i < n.keys.length && n.keys[i] < key) i++;
    n.keys.splice(i, 0, key); present.add(key);
    rec.add('insert', 'insert', `在叶节点 ${n.id} 插入 ${key}。`, view({ phase: 'insert', key, path: [...path, n.id], currentNode: n.id, index: i }));
  }
  for (const key of queries) {
    const answer = locate(key, 'search'); queryResults.push(answer);
    rec.add(answer.found ? 'found' : 'not-found', answer.found ? 'found' : 'not-found', `查找 ${key}：${answer.found ? '命中' : '不存在'}。`, view({ phase: 'search', key, ...answer, currentNode: answer.node }));
  }
  const result = { ...store.snapshot(root), keys: btreeKeys(root), queries: queryResults };
  rec.add('done', 'done', 'B树插入与查询完成。', view({ phase: 'done', path: [], currentNode: null }), result);
  return rec.finish(result);
}
