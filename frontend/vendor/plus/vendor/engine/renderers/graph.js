/**
 * style 10 —— 图 node-link 渲染器（本项目扩展；AnyviewC 把图归 TTreeForm）
 *
 * 为什么要有它：AnyviewC 用 TTreeView 显示邻接表/邻接矩阵（07_TREE_GRAPH.md §2），
 * 好处是省事，坏处是"边"没有空间位置，BFS/DFS/Prim/Kruskal 的"前沿扩张、选边、松弛"
 * 在 TreeView 里看不出来。所以这里补一个 **node-link 平面渲染器**，
 * 在界面上与 style 9 的 TreeView 形态可以互切（数据结构下拉里能看到两种样式）。
 *
 * 边的状态用样式区分（同时有文字标记，不只靠颜色）：
 *   candidate 候选（虚线）／tree 已选（实线加粗）／active 当前（橙色加粗）
 *   reject 被拒（灰色虚线）／path 路径（绿色）
 */

import { LINK, UI } from '../theme.js';
import { P } from '../prims.js';
import { norm, stateOf, styleOf, borderWidth, toneFor, uniqueKeyer } from './_shared.js';

export const STYLES = [10];

const EDGE_STYLE = {
  idle: { stroke: '#b9c3d6', sw: 1.4, dash: null, label: '' },
  candidate: { stroke: '#b26b00', sw: 1.6, dash: [6, 4], label: '候选' },
  tree: { stroke: '#0a6b4a', sw: 2.4, dash: null, label: '已选' },
  active: { stroke: '#d94b4b', sw: 2.6, dash: null, label: '当前' },
  reject: { stroke: '#c7d0de', sw: 1.2, dash: [3, 5], label: '拒绝' },
  path: { stroke: '#6650cf', sw: 2.2, dash: null, label: '路径' },
};

function toward([x, y], [tx, ty], radius) {
  const length = Math.hypot(tx - x, ty - y) || 1;
  return [x + (tx - x) * radius / length, y + (ty - y) * radius / length];
}

function routeEdge(edge, a, b, radius, rect) {
  if (edge.from === edge.to) {
    const [x, y] = a;
    const side = y < rect.y + 64 ? 1 : -1;
    const left = [x - 23, y + side * 38], right = [x + 23, y + side * 38];
    return {
      points: [toward(a, left, radius), left, right, toward(a, right, radius)],
      label: [x, y + side * 48],
    };
  }
  if (!edge.bend) return null;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const length = Math.hypot(dx, dy) || 1;
  const bend = Number.isFinite(edge.bend) ? edge.bend : 17;
  const middle = [(a[0] + b[0]) / 2 - dy * bend / length, (a[1] + b[1]) / 2 + dx * bend / length];
  return { points: [toward(a, middle, radius), middle, toward(b, middle, radius)], label: middle };
}

export function layout(layer, rect, env = {}) {
  const { data, props } = layer;
  const roles = norm(layer.roles);
  const prims = [];
  // 平行边 / 同名指针在真实数据里会出现，key 统一去重，避免补间错位与互相覆盖
  const key = uniqueKeyer();
  const nodes = new Map();
  const list = data.nodes || [];
  const edges = data.edges || [];
  if (data.name) prims.push(P.text('name', rect.x + 16, rect.y + 16, data.name, { align: 'left', size: 12, fill: '#b0197f' }));
  if (!list.length) {
    prims.push(P.text('empty', rect.x + rect.w / 2, rect.y + rect.h / 2, '空图', { size: 12, fill: UI.textMuted }));
    return { prims, nodes };
  }

  // ---- 布局：circle（默认）/ line / 显式坐标（x,y 归一到 0..1）
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2 + 6;
  const R = Math.min(rect.w, rect.h) / 2 - 46;
  const pos = new Map();
  const n = list.length;
  list.forEach((nd, i) => {
    if (Number.isFinite(nd.x) && Number.isFinite(nd.y)) {
      pos.set(nd.id, [rect.x + 40 + nd.x * (rect.w - 80), rect.y + 40 + nd.y * (rect.h - 80)]);
    } else if (data.layout === 'line') {
      pos.set(nd.id, [rect.x + 60 + (i * (rect.w - 120)) / Math.max(1, n - 1), cy]);
    } else if (data.layout === 'tree') {
      pos.set(nd.id, [rect.x + 60 + (i * (rect.w - 120)) / Math.max(1, n - 1), rect.y + 60 + (nd.level || 0) * 76]);
    } else {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      pos.set(nd.id, [cx + Math.cos(a) * R, cy + Math.sin(a) * R]);
    }
  });

  const nodeR = props.nodeRadius ?? Math.min(22, Math.max(14, R / Math.max(4, n) + 12));

  // ---- 边
  for (const e of edges) {
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    if (!a || !b) continue;
    const st = EDGE_STYLE[e.state] || EDGE_STYLE.idle;
    const directed = e.directed ?? props.directed ?? false;
    const paint = { stroke: st.stroke, sw: st.sw, dash: st.dash, arrow: directed ? 'end' : null, z: 1 };
    const route = props.routedEdges ? routeEdge(e, a, b, nodeR, rect) : null;
    const edgeKey = key(`e-${e.from}-${e.to}`);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const x1 = a[0] + (dx / len) * nodeR;
    const y1 = a[1] + (dy / len) * nodeR;
    const x2 = b[0] - (dx / len) * nodeR;
    const y2 = b[1] - (dy / len) * nodeR;
    prims.push(route ? P.poly(edgeKey, route.points, paint) : P.line(edgeKey, x1, y1, x2, y2, paint));
    if (e.w != null && props.weighted !== false) {
      const [labelX, labelY] = route?.label ?? [(x1 + x2) / 2, (y1 + y2) / 2 - 10];
      prims.push(P.chip(key(`w-${e.from}-${e.to}`), labelX, labelY, String(e.w), { size: props.edgeLabelSize ?? 10, fill: '#ffffff', stroke: st.stroke, color: st.stroke }));
    }
  }

  // ---- 节点
  for (const nd of list) {
    const p = pos.get(nd.id);
    if (!p) continue;
    const st = stateOf(roles, nd.id);
    const s = styleOf(st);
    const fill = st !== 'idle' ? s.fill : nd.fill || '#eef4ff';
    const stroke = st !== 'idle' ? s.stroke : nd.stroke || LINK.LinkNodeFrame;
    prims.push(P.circle(`n-${nd.id}`, p[0], p[1], nodeR, { fill, stroke, sw: borderWidth(st) + 0.4, opacity: s.opacity, z: 3 }));
    prims.push(P.text(`nv-${nd.id}`, p[0], p[1], String(nd.label ?? nd.id), { size: props.nodeLabelSize ?? 12, fill: st !== 'idle' ? s.text : UI.text, z: 4, opacity: s.opacity }));
    if (nd.sub != null) prims.push(P.text(`ns-${nd.id}`, p[0], p[1] + nodeR + (props.nodeDetailOffset ?? 11),
      String(nd.sub), { size: props.nodeDetailSize ?? 9, fill: UI.textMuted, z: 4 }));
    if (nd.badge) prims.push(P.chip(`nb-${nd.id}`, p[0], p[1] - nodeR - 12, nd.badge, toneFor(0)));
    nodes.set(`node:${nd.id}`, { x: p[0], y: p[1] });
  }

  // ---- 指针
  roles.pointers.forEach((pt, i) => {
    const p = pos.get(pt.node);
    if (!p) return;
    const tone = toneFor(i + 1);
    prims.push(P.chip(key(`ptr-${pt.id}`), p[0] + nodeR + 18, p[1] - nodeR - 6, pt.label, tone));
    nodes.set(`ptr:${pt.id}`, { x: p[0] + nodeR + 18, y: p[1] - nodeR - 6 });
  });

  if (props.showLegend !== false && props.weighted !== false && edges.some((e) => e.w != null)) {
    const legend = ['候选=虚线', '已选=实粗线', '当前=红', '拒绝=灰细线'];
    prims.push(P.text('legend', rect.x + rect.w - 12, rect.y + 16, legend.join(' · '), { align: 'right', size: 10, fill: UI.textMuted }));
  }
  return { prims, nodes };
}
