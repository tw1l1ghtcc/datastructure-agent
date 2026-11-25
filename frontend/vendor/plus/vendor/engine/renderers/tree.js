/**
 * style 9 —— 树 / 森林渲染器（TTreeForm 复原，07_TREE_GRAPH.md）
 *
 * 两种后端，对应 AnyviewC 的两条真实路径：
 *   · layout='treeview'：**不画线**。节点由控件堆出来，缩进表示层级，
 *     StateIndex 14 = 叶子（▪）、15 = 有子（▸），文本 = 名字 + 分隔 + 值。
 *     这就是 07_TREE_GRAPH.md §1 里 sub_54CD98 的做法。
 *   · layout='canvas'：节点坐标由渲染器按层现算（无场景图），画圆 + 折线边，
 *     这样"节点移动、旋转、变色"才看得见——树形动画需要它。
 *
 * 支持的边语义：left/right（二叉树）、children（多叉/森林）、parent（双亲表示）、
 * threads（线索树的前驱/后继，虚线）、extraEdges（转换类算法的新增边）。
 */

import { LINK, UI } from '../theme.js';
import { P } from '../prims.js';
import { norm, stateOf, styleOf, borderWidth, toneFor } from './_shared.js';

export const STYLES = [9];

function nodeMap(data) {
  return new Map((data.nodes || []).map((n) => [n.id, n]));
}

function childrenOf(n) {
  if (!n) return [];
  if (Array.isArray(n.children)) return n.children;
  const out = [];
  if (n.left) out.push(n.left);
  if (n.right) out.push(n.right);
  return out;
}

/** 收集从 roots 出发的可达节点（含孤立根） */
function collect(data) {
  const map = nodeMap(data);
  const order = [];
  const seen = new Set();
  const roots = (data.roots && data.roots.length ? data.roots : [...map.keys()].filter((id) => {
    const n = map.get(id);
    return !n || n.parent == null;
  })).filter((id) => map.has(id));
  const walk = (id, depth) => {
    if (!map.has(id) || seen.has(id)) return;
    seen.add(id);
    order.push({ node: map.get(id), depth });
    for (const c of childrenOf(map.get(id))) walk(c, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  for (const id of map.keys()) if (!seen.has(id)) order.push({ node: map.get(id), depth: 0 });
  return { map, order, roots };
}

/* ---------------------------------------------------------------- treeview 后端 */

function layoutAsTreeView(data, rect, roles) {
  const prims = [];
  const nodes = new Map();
  const { order } = collect(data);
  const rowH = Math.max(22, Math.min(30, (rect.h - 44) / Math.max(1, order.length)));
  const y0 = rect.y + 38;
  prims.push(P.text('tl', rect.x + 14, rect.y + 16, `${data.name || 'TreeView'} · StateIndex 15=有子 / 14=叶子`, { align: 'left', size: 10, fill: UI.textMuted }));
  order.forEach(({ node, depth }, i) => {
    const st = stateOf(roles, node.id);
    const s = styleOf(st);
    const y = y0 + i * rowH;
    const x = rect.x + 20 + depth * 18;
    const hasChildren = childrenOf(node).length > 0;
    prims.push(P.rect(`row-${node.id}`, rect.x + 8, y - rowH / 2 + 1, rect.w - 16, rowH - 2, {
      r: 4, fill: st === 'idle' ? (i % 2 ? '#fbfcfe' : '#ffffff') : s.fill, stroke: st === 'idle' ? 'transparent' : s.stroke, sw: 1, opacity: s.opacity,
    }));
    prims.push(P.text(`si-${node.id}`, x, y, hasChildren ? '▸' : '▪', { size: 11, fill: hasChildren ? LINK.LinkNodeFrame : UI.textMuted, z: 2 }));
    const text = `${node.label ?? node.id}${node.value != null ? ' = ' + node.value : ''}`;
    prims.push(P.text(`tx-${node.id}`, x + 14, y, text, { align: 'left', size: 12, fill: st === 'idle' ? LINK.LinkNodeText : s.text, opacity: s.opacity, z: 2 }));
    if (node.badge) prims.push(P.text(`bd-${node.id}`, rect.x + rect.w - 16, y, node.badge, { align: 'right', size: 10, fill: UI.textMuted }));
    nodes.set(`node:${node.id}`, { x: x + 8, y });
  });
  return { prims, nodes };
}

/* ---------------------------------------------------------------- canvas 后端 */

function layoutAsCanvas(data, rect, roles, props) {
  const prims = [];
  const nodes = new Map();
  const { map, order, roots } = collect(data);
  if (!order.length) {
    prims.push(P.text('empty', rect.x + rect.w / 2, rect.y + rect.h / 2, '空树 / 空森林', { size: 12, fill: UI.textMuted }));
    return { prims, nodes };
  }
  const levelGap = Math.min(96, Math.max(56, (rect.h - 70) / Math.max(1, Math.max(...order.map((o) => o.depth)) + 1)));
  const maxDepth = Math.max(...order.map((o) => o.depth));

  // 叶子按出现顺序分配 x，父节点取孩子的中点（tidy layout 的最小实现）
  const xs = new Map();
  let leafCursor = 0;
  const assign = (id, depth) => {
    const n = map.get(id);
    const kids = childrenOf(n).filter((k) => map.has(k));
    if (!kids.length) {
      xs.set(id, leafCursor++);
      return xs.get(id);
    }
    const childXs = kids.map((k) => assign(k, depth + 1));
    const mid = (Math.min(...childXs) + Math.max(...childXs)) / 2;
    xs.set(id, mid);
    return mid;
  };
  roots.forEach((r) => assign(r, 0));

  const leaves = Math.max(1, leafCursor);
  const usableW = rect.w - 76;
  const gapX = props.leafGap ?? Math.min(70, Math.max(24, usableW / Math.max(1, leaves * 1.15)));
  const totalW = (leaves - 1) * gapX;
  const x0 = rect.x + rect.w / 2 - totalW / 2;
  const y0 = rect.y + (props.fitViewport && order.length === 1 ? rect.h / 2 : 62);
  const px = (id) => x0 + (xs.get(id) ?? 0) * gapX;
  const py = (id) => y0 + (order.find((o) => o.node.id === id)?.depth ?? 0) * levelGap;

  if (data.name) prims.push(P.text('name', rect.x + 16, rect.y + 16, data.name, { align: 'left', size: 12, fill: '#b0197f' }));

  // 孩子边（先画线后画点，AnyviewC 的 LinkLinkFirst 思想）
  const highlighted = new Set(props.highlightedEdges ?? []);
  for (const { node } of order) {
    for (const cid of childrenOf(node)) {
      if (!map.has(cid)) continue;
      const x1 = px(node.id);
      const y1 = py(node.id);
      const x2 = px(cid);
      const y2 = py(cid);
      const tag = data.edgeTags ? data.edgeTags[cid] : null;
      const active = highlighted.has(cid);
      prims.push(P.line(`e-${node.id}-${cid}`, x1, y1 + 16, x2, y2 - 16, { stroke: active ? '#6650cf' : '#b9c3d6', sw: active ? 2.8 : 1.4, z: 1 }));
      if (tag) prims.push(P.text(`et-${cid}`, (x1 + x2) / 2 + (tag === 'L' ? -8 : 8), (y1 + y2) / 2, tag, { size: active ? 12 : 10, fill: active ? '#6650cf' : UI.textMuted }));
    }
  }
  // 线索边（前驱/后继）：虚线 + "线索"标记
  for (const t of data.threads || []) {
    if (!map.has(t.from) || !map.has(t.to)) continue;
    const x1 = px(t.from);
    const y1 = py(t.from);
    const x2 = px(t.to);
    const y2 = py(t.to);
    prims.push(P.line(`th-${t.from}-${t.to}`, x1, y1, x2, y2, {
      stroke: t.type === 'next' ? '#0a6b4a' : '#8a4b00', sw: t.active ? 2.8 : 1.2,
      dash: [5, 4], arrow: t.directed ? 'end' : undefined, z: t.active ? 2 : 1,
    }));
  }
  // 新增边（树/森林转换、重建）
  for (const e of data.extraEdges || []) {
    if (!map.has(e.from) || !map.has(e.to)) continue;
    const dx = Math.sign(px(e.to) - px(e.from));
    const from = e.horizontal ? [px(e.from) + dx * (map.get(e.from).boxWidth ?? 32) / 2, py(e.from)]
      : [px(e.from), py(e.from) + 16];
    const to = e.horizontal ? [px(e.to) - dx * (map.get(e.to).boxWidth ?? 32) / 2, py(e.to)]
      : [px(e.to), py(e.to) - 16];
    prims.push(P.line(`x-${e.from}-${e.to}`, ...from, ...to, { stroke: e.color || '#6b3fa0', sw: 2, dash: e.dash || null, arrow: 'end', z: 2 }));
  }

  // 节点
  for (const { node, depth } of order) {
    const cx = px(node.id);
    const cy = py(node.id);
    const st = stateOf(roles, node.id);
    const s = styleOf(st);
    const isRed = node.color === 'red';
    const showColor = st === 'idle' || (props.keepNodeColors && node.color);
    const fill = showColor ? (isRed ? '#fdeaea' : '#ffffff') : s.fill;
    const stroke = st !== 'idle' ? s.stroke : isRed ? '#c0392b' : node.color === 'black' ? '#172033' : LINK.LinkNodeFrame;
    const r = node.radius ?? 16;
    const paint = { fill, stroke, sw: borderWidth(st) + (node.color ? 0.6 : 0), opacity: s.opacity, z: 3 };
    prims.push(node.boxWidth
      ? P.rect(`n-${node.id}`, cx - node.boxWidth / 2, cy - 13, node.boxWidth, 26, { ...paint, r: 5 })
      : P.circle(`n-${node.id}`, cx, cy, r, paint));
    prims.push(P.text(`nv-${node.id}`, cx, cy, String(node.label ?? node.id), { size: node.fontSize ?? 11, fill: showColor ? (isRed ? '#8f2020' : UI.text) : s.text, z: 4, opacity: s.opacity }));
    if (node.value != null) prims.push(P.text(`nval-${node.id}`, cx, cy + r + 11, String(node.value), { size: 9, fill: UI.textMuted, z: 4 }));
    if (node.badge) prims.push(P.chip(`nb-${node.id}`, cx, cy - r - 12, node.badge, toneFor(depth)));
    nodes.set(`node:${node.id}`, { x: cx, y: cy });
  }

  // 指针（pre / p / q 之类）
  roles.pointers.forEach((p, i) => {
    const id = p.node;
    if (!id || !map.has(id)) return;
    const tone = toneFor(i + 1);
    const cx = px(id);
    const cy = py(id);
    prims.push(P.chip(`ptr-${p.id}`, cx + 34, cy - 26, p.label, tone));
    prims.push(P.line(`ptr-line-${p.id}`, cx + 20, cy - 18, cx + 8, cy - 8, { stroke: tone.stroke, sw: 1, arrow: 'end' }));
    nodes.set(`ptr:${p.id}`, { x: cx + 34, y: cy - 26 });
  });

  prims.push(P.text('depth', rect.x + rect.w - 12, rect.y + 16, `层数 ${maxDepth + 1}`, { align: 'right', size: 10, fill: UI.textMuted }));
  return { prims, nodes };
}

export function layout_(layer, rect, env = {}) {
  const roles = norm(layer.roles);
  const mode = layer.props.layout || 'canvas';
  return mode === 'treeview' ? layoutAsTreeView(layer.data, rect, roles) : layoutAsCanvas(layer.data, rect, roles, layer.props);
}

export { layout_ as layout };
