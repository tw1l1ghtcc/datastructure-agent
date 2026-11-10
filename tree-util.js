export function treeStore() {
  const nodes = [];
  const create = leaf => { const n = { id: nodes.length, leaf, keys: [], children: [], next: null }; nodes.push(n); return n; };
  const snapshot = root => ({ root: root?.id ?? null, nodes: nodes.map(n => ({ ...n, keys: [...n.keys], children: n.children.map(c => c.id) })) });
  return { nodes, create, snapshot };
}
export function btreeKeys(root) {
  if (!root) return [];
  if (root.leaf) return [...root.keys];
  const keys = [];
  for (let i = 0; i < root.keys.length; i++) keys.push(...btreeKeys(root.children[i]), root.keys[i]);
  keys.push(...btreeKeys(root.children.at(-1)));
  return keys;
}
export function minimum(node) { while (!node.leaf) node = node.children[0]; return node.keys[0]; }
export function refresh(node) {
  if (!node || node.leaf) return;
  for (const c of node.children) refresh(c);
  node.keys = node.children.slice(1).map(minimum);
}
