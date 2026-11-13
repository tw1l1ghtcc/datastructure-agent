import { treeInput, recorder, sourceLines } from './util.js';
import { treeStore, refresh } from './tree-util.js';
import { BPLUS_SOURCE } from './sources.js';
export const SOURCE_VERSION = 'c-b-plus-tree-v1';
export const SOURCE_LINES = sourceLines(BPLUS_SOURCE, 'bplus');
export const DEFAULT_INPUT = { keys: [10, 20, 30, 40, 50, 60, 70], queries: [30, 35] };

export function generateBPlusTreeSteps(input) {
  const { keys, queries } = treeInput(input);
  if ((input.order !== undefined && input.order !== 3) || (input.leafCapacity !== undefined && input.leafCapacity !== 2)) throw new TypeError('本演示约定内节点最多3个孩子、叶最多2键');
  const store = treeStore(), rec = recorder('b-plus-tree', SOURCE_VERSION, SOURCE_LINES);
  let root = null; const present = new Set(), queryResults = [];
  const leafKeys = () => { const a = []; let n = root; while (n && !n.leaf) n = n.children[0]; while (n) { a.push(...n.keys); n = n.next === null ? null : store.nodes[n.next]; } return a; };
  const view = extra => ({ ...store.snapshot(root), order: 3, leafCapacity: 2, leafKeys: leafKeys(), ...extra });
  function descend(key, phase) {
    const path = [], parents = []; let n = root;
    while (n && !n.leaf) {
      path.push(n.id); let i = 0;
      while (i < n.keys.length && key >= n.keys[i]) i++;
      rec.add('descend', 'descend', `${key} 沿节点 ${n.id} 的第 ${i} 个孩子定位叶。`, view({ key, phase, path, currentNode: n.id, childIndex: i }));
      parents.push({ node: n, index: i }); n = n.children[i];
    }
    if (n) path.push(n.id);
    return { node: n, parents, path };
  }
  rec.add('init', 'init', '建立B+树：内部最多3个孩子，叶最多2键；相等沿右侧下降。', view({ path: [], currentNode: null, overflowNode: null }));
  for (const key of keys) {
    if (present.has(key)) { rec.add('duplicate', 'duplicate', `${key} 已存在，结构不变。`, view({ phase: 'insert', key, path: [], currentNode: null, overflowNode: null })); continue; }
    if (!root) root = store.create(true);
    const found = descend(key, 'insert'); let n = found.node;
    let index = 0; while (index < n.keys.length && n.keys[index] < key) index++;
    n.keys.splice(index, 0, key); present.add(key); refresh(root);
    const overflow = x => x.leaf ? x.keys.length > 2 : x.children.length > 3;
    rec.add(overflow(n) ? 'insert-overflow' : 'insert', 'insert', `向叶节点 ${n.id} 插入 ${key}${overflow(n) ? '，暂时溢出，下一步分裂' : ''}。`, view({ phase: 'insert', key, path: found.path, currentNode: n.id, overflowNode: overflow(n) ? n.id : null }));
    while (overflow(n)) {
      const right = store.create(n.leaf), wasLeaf = n.leaf;
      if (wasLeaf) { right.keys = n.keys.splice(2); right.next = n.next; n.next = right.id; }
      else { right.children = n.children.splice(2); refresh(n); refresh(right); }
      const ancestor = found.parents.pop(); let parent, newRoot = false;
      if (ancestor) { parent = ancestor.node; parent.children.splice(ancestor.index + 1, 0, right); }
      else { parent = store.create(false); parent.children = [n, right]; root = parent; newRoot = true; }
      refresh(root);
      const split = { left: n.id, right: right.id, parent: parent.id, promoted: right.leaf ? right.keys[0] : parent.keys[parent.children.indexOf(right) - 1] };
      rec.add(wasLeaf ? 'split-leaf' : 'split-internal', wasLeaf ? 'split-leaf' : 'split-internal', `分裂${wasLeaf ? '叶' : '内部'}节点 ${n.id}，分隔键更新至父节点 ${parent.id}。`, view({ phase: 'insert', key, path: [], currentNode: parent.id, split, overflowNode: overflow(parent) ? parent.id : null }));
      if (newRoot) rec.add('new-root', 'new-root', `新根为节点 ${root.id}。`, view({ phase: 'insert', key, path: [], currentNode: root.id, overflowNode: null }));
      n = parent;
    }
  }
  for (const key of queries) {
    const { node, path } = descend(key, 'search');
    const index = node?.keys.indexOf(key) ?? -1;
    const answer = { key, found: index >= 0, node: index >= 0 ? node.id : null, index: index >= 0 ? index : null, path };
    queryResults.push(answer);
    rec.add(answer.found ? 'found' : 'not-found', answer.found ? 'found' : 'not-found', `在叶中查找 ${key}：${answer.found ? '命中' : '不存在'}。`, view({ phase: 'search', ...answer, currentNode: node?.id ?? null, overflowNode: null }));
  }
  const result = { ...store.snapshot(root), keys: leafKeys(), queries: queryResults };
  rec.add('done', 'done', 'B+树插入与查询完成，叶链包含全部有序键。', view({ phase: 'done', path: [], currentNode: null, overflowNode: null }), result);
  return rec.finish(result);
}
