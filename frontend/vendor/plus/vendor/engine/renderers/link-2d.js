/**
 * style 3 —— 链表 2D 渲染器（TLinkForm 复原，04_LINK_2D.md）
 *
 * 复原要点：
 *  · 节点 = 一个矩形，但用 4 条边分别画（逐边换色：LinkNodeFrame / LinkNodeLine / LinkHead）；
 *  · 边 = 直角折线（先竖后横），不是直线+贝塞尔；
 *  · 箭头 = 两段 3×5 像素短线；连接处小圆点用 LinkDot；
 *  · 头指针 / 引用头是独立的标记（LinkHead / LinkRefHead），不是节点的一部分；
 *  · LinkRoundShape / LinkLinkFirst 是两个独立开关（圆角、先画线还是先画节点）。
 */

import { LINK, UI } from '../theme.js';
import { P } from '../prims.js';
import { norm, stateOf, styleOf, borderWidth, toneFor, elbow } from './_shared.js';

export const STYLES = [3];

/** 沿 head → next 收集显示顺序（避免出现环时死循环） */
function chainOrder(data) {
  const map = new Map((data.nodes || []).map((n) => [n.id, n]));
  if (data.order) return data.order.filter((id) => map.has(id)).map((id) => map.get(id));
  const out = [];
  const seen = new Set();
  let cur = data.head ?? (data.nodes && data.nodes[0] && data.nodes[0].id);
  while (cur && map.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    out.push(map.get(cur));
    const link = (data.links || []).find((l) => l.from === cur && (l.type ?? 'next') === 'next');
    cur = link ? link.to : map.get(cur).next;
  }
  // 未被 head 链到的孤立节点也显示（画在最右边，标注孤立）
  for (const n of data.nodes || []) if (!seen.has(n.id)) out.push(n);
  return out;
}

function fitChain(rect, count, preferredWidth) {
  const width = Math.max(1, rect.w - 56);
  const height = Math.max(1, rect.h - 88);
  const rowsAtDefaultHeight = Math.max(1, Math.floor(height / 50));
  const perRow = Math.min(count, Math.max(Math.ceil(count / rowsAtDefaultHeight),
    Math.floor((width + 40) / (preferredWidth + 40))));
  const rows = Math.ceil(count / perRow);
  const gap = Math.min(54, width / perRow * 0.28);
  const nodeW = Math.max(1, Math.min(148, (width + gap) / perRow - gap));
  const nodeH = Math.max(1, Math.min(64, height / rows * 0.54));
  const rowGap = Math.min(nodeH + 72, height / rows);
  const y0 = rect.y + Math.max(48, (rect.h - nodeH - (rows - 1) * rowGap) / 2);
  return { nodeW, nodeH, gap, perRow, rowGap, y0 };
}

export function layout(layer, rect, env = {}) {
  const { data, props } = layer;
  const roles = norm(layer.roles);
  const prims = [];
  const nodes = new Map();
  const list = chainOrder(data);
  if (data.name) prims.push(P.text('name', rect.x + 14, rect.y + 15, data.name, { align: 'left', fill: ARRAY_NAME(), size: 12 }));
  if (list.length === 0) {
    prims.push(P.rect('empty', rect.x + 24, rect.y + rect.h / 2 - 26, 220, 52, { r: 10, fill: '#fbfcfe', stroke: UI.border }));
    prims.push(P.text('empty-t', rect.x + 134, rect.y + rect.h / 2, data.head ? '头指针为空 head = NULL' : '空链表', { fill: UI.textMuted, size: 12 }));
    return { prims, nodes };
  }

  const preferredWidth = props.nodeW ?? 92;
  const fitViewport = props.fitViewport;
  const fixedNodeH = props.nodeH ?? 44;
  const fixedGap = props.gap ?? 46;
  const fixedPerRow = Math.max(1, Math.floor((rect.w - 36 + fixedGap) / (preferredWidth + fixedGap)));
  const fixedRowGap = fixedNodeH + 54;
  const { nodeW, nodeH, gap, perRow, rowGap, y0 } = fitViewport ? fitChain(rect, list.length, preferredWidth) : {
    nodeW: preferredWidth, nodeH: fixedNodeH, gap: fixedGap, perRow: fixedPerRow, rowGap: fixedRowGap,
    y0: rect.y + Math.max(20, (rect.h - Math.ceil(list.length / fixedPerRow) * fixedRowGap) / 2 + 8),
  };
  const round = props.roundShape ? 10 : 0;
  const linkFirst = !!props.linkFirst;

  const geo = new Map();
  list.forEach((n, i) => {
    const r = Math.floor(i / perRow);
    const c = i % perRow;
    const cntInRow = Math.min(perRow, list.length - r * perRow);
    const rowSlots = fitViewport ? perRow : cntInRow;
    const rowW = rowSlots * nodeW + (rowSlots - 1) * gap;
    // Keep row turns vertical when the full-canvas chain wraps.
    const column = fitViewport && r % 2 ? perRow - 1 - c : c;
    const x = rect.x + (rect.w - rowW) / 2 + column * (nodeW + gap);
    const y = y0 + r * rowGap;
    geo.set(n.id, { x, y, w: nodeW, h: nodeH });
    nodes.set(`node:${n.id}`, { x: x + nodeW / 2, y: y + nodeH / 2 });
  });

  /* 连线：先按"目标在哪个方向"选出入口边；如果这条线会横穿**别的结点**（逆置后的反向 next、
     跳过中间结点、删结点后的重连……），就改走结点上方/下方的绕行折线。
     不同方向各画一条横穿结点的直线，屏幕上就是"一条穿过方框的整线"——这正是使用者反馈的那个错。 */
  const segCrosses = (p, q, r, pad = 1) => {
    const steps = 40;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = p[0] + (q[0] - p[0]) * t;
      const y = p[1] + (q[1] - p[1]) * t;
      if (x > r.x + pad && x < r.x + r.w - pad && y > r.y + pad && y < r.y + r.h - pad) return true;
    }
    return false;
  };
  const crossesAny = (pts, obstacles) => {
    for (let i = 0; i < pts.length - 1; i++) {
      for (const r of obstacles) if (segCrosses(pts[i], pts[i + 1], r)) return true;
    }
    return false;
  };
  const drawLink = (fromId, toId, label) => {
    const a = geo.get(fromId);
    const b = geo.get(toId);
    if (!a || !b || fromId === toId) return;
    const obstacles = [...geo.entries()].filter(([id]) => id !== fromId && id !== toId).map(([, g]) => g);
    const aMidY = a.y + a.h / 2;
    const bMidY = b.y + b.h / 2;
    const aMidX = a.x + a.w / 2;
    const bMidX = b.x + b.w / 2;
    const sameRow = Math.abs(a.y - b.y) < 1;

    /* 候选路线：直连（正/反向）或上下绕行；取第一条不穿任何结点的 */
    const candidates = [];
    if (sameRow && b.x >= a.x + a.w) candidates.push([[a.x + a.w, aMidY], [b.x, bMidY]]);            // 正序：右 → 左
    if (sameRow && b.x + b.w <= a.x) {                                                              // 逆序：左 → 右
      const dy = 7;
      candidates.push([[a.x, aMidY + dy], [b.x + b.w, bMidY + dy]]);
    }
    if (b.y >= a.y + a.h) candidates.push(elbow(aMidX, a.y + a.h, bMidX, b.y, 'v'));                 // 目标在下
    if (b.y + b.h <= a.y) candidates.push(elbow(aMidX, a.y, bMidX, b.y + b.h, 'v'));                 // 目标在上
    /* 绕行：从结点下方（优先）或上方走一条"下-横-上"的折线 */
    const bottomLimit = rect.y + rect.h - 6;
    const topLimit = rect.y + 6;
    const detourY = Math.min(bottomLimit, Math.max(a.y + a.h, b.y + b.h) + 20);
    if (detourY > Math.max(a.y + a.h, b.y + b.h) + 2) {
      candidates.push([[aMidX, a.y + a.h], [aMidX, detourY], [bMidX, detourY], [bMidX, b.y + b.h]]);
    }
    const upY = Math.max(topLimit, Math.min(a.y, b.y) - 20);
    if (upY < Math.min(a.y, b.y) - 2) {
      candidates.push([[aMidX, a.y], [aMidX, upY], [bMidX, upY], [bMidX, b.y]]);
    }
    let pts = candidates.find((route) => !crossesAny(route, obstacles)) || candidates[0];
    if (!pts) return;

    prims.push(P.poly(`link-${fromId}-${toId}`, pts, { stroke: LINK.LinkNodeLine, sw: 1.6, arrow: 'end', z: 1 }));
    const mid = pts[pts.length - 1];
    prims.push(P.circle(`dot-${fromId}-${toId}`, mid[0], mid[1], 3.2, { fill: LINK.LinkDot, z: 2 }));
    if (label) prims.push(P.text(`ll-${fromId}-${toId}`, (pts[0][0] + mid[0]) / 2, (pts[0][1] + mid[1]) / 2 - 9, label, { size: 10, fill: UI.textMuted }));
  };

  const drawNode = (n) => {
    const g = geo.get(n.id);
    const st = stateOf(roles, n.id);
    const s = styleOf(st);
    const fill = n.fill || (st === 'idle' ? LINK.LinkNode : s.fill);
    const stroke = st === 'idle' ? LINK.LinkNodeFrame : s.stroke;

    // 4 条边逐条画（复原"逐边换色"，因此不用 Rectangle）
    const edges = [
      [g.x, g.y, g.x + g.w, g.y],
      [g.x + g.w, g.y, g.x + g.w, g.y + g.h],
      [g.x + g.w, g.y + g.h, g.x, g.y + g.h],
      [g.x, g.y + g.h, g.x, g.y],
    ];
    prims.push(P.rect(`nfill-${n.id}`, g.x, g.y, g.w, g.h, { r: round, fill, stroke: 'none', opacity: s.opacity, z: 1 }));
    edges.forEach((e, i) => prims.push(P.line(`ne-${n.id}-${i}`, e[0], e[1], e[2], e[3], { stroke, sw: borderWidth(st), opacity: s.opacity, z: 2 })));

    // 数据域 / 指针域 分隔（有 fields 时按字段表切分，复原"字段表驱动"）
    const fields = n.fields || data.fields;
    if (fields && fields.length >= 2) {
      const fw = g.w / fields.length;
      fields.forEach((f, i) => {
        if (i > 0) prims.push(P.line(`nf-${n.id}-${i}`, g.x + fw * i, g.y, g.x + fw * i, g.y + g.h, { stroke, sw: 1, opacity: s.opacity, z: 2 }));
        const val = n[f.name] ?? (f.name === 'next' ? (n.next ?? '∧') : n.value);
        prims.push(P.text(`nft-${n.id}-${f.name}`, g.x + fw * (i + 0.5), g.y + g.h / 2, String(val), { size: 12, fill: st === 'idle' ? LINK.LinkNodeText : s.text, opacity: s.opacity }));
      });
    } else {
      const value = String(n.value ?? n.label ?? n.id);
      const size = fitViewport ? Math.max(5, Math.min(20, nodeH * 0.34, (nodeW - 7) / (value.length * 0.63))) : 14;
      prims.push(P.text(`nv-${n.id}`, g.x + g.w / 2, g.y + g.h * (fitViewport ? 0.38 : 0.5), value,
        { size, fill: st === 'idle' ? LINK.LinkNodeText : s.text, opacity: s.opacity }));
      if (fitViewport && n.label) prims.push(P.text(`nid-${n.id}`, g.x + g.w / 2, g.y + g.h * 0.76, n.label,
        { size: Math.min(12, nodeH * 0.27), fill: st === 'idle' ? UI.textMuted : s.text }));
    }
    if (n.badge) prims.push(P.text(`nb-${n.id}`, g.x + g.w / 2, g.y - 10, n.badge, { size: 10, fill: UI.textMuted }));
  };

  if (linkFirst) {
    for (const n of list) {
      const link = (data.links || []).find((l) => l.from === n.id);
      const tgt = link ? link.to : n.next;
      if (tgt) drawLink(n.id, tgt, link && link.label);
    }
    for (const n of list) drawNode(n);
  } else {
    for (const n of list) drawNode(n);
    for (const n of list) {
      const link = (data.links || []).find((l) => l.from === n.id);
      const tgt = link ? link.to : n.next;
      if (tgt) drawLink(n.id, tgt, link && link.label);
    }
  }

  // 尾结点的 NULL 标记
  const tail = list[list.length - 1];
  const tg = geo.get(tail.id);
  const tailNext = (data.links || []).find((l) => l.from === tail.id);
  if (!tailNext && !tail.next && tg) {
    const tailX = fitViewport && Math.floor((list.length - 1) / perRow) % 2 ? tg.x - 18 : tg.x + tg.w + 18;
    prims.push(P.text('null', tailX, tg.y + tg.h / 2, '∧', { size: 16, fill: LINK.LinkNodeLine }));
  }

  // 头指针标记（LinkHead，独立于节点）
  if (data.head) {
    const hg = geo.get(data.head);
    if (hg) {
      const tone = toneFor(0);
      prims.push(P.chip('head', hg.x + hg.w / 2, hg.y - 18, 'head', tone));
      prims.push(P.line('head-line', hg.x + hg.w / 2, hg.y - 10, hg.x + hg.w / 2, hg.y - 1, { stroke: tone.stroke, sw: 1, arrow: 'end' }));
    }
  } else if (list.length) {
    const hg = geo.get(list[0].id);
    prims.push(P.text('null-head', hg.x - 14, hg.y + hg.h / 2, 'head=∧', { size: 10, fill: UI.textMuted, align: 'right' }));
  }

  // 指针（prev / cur / next 之类）：文字一定在，颜色只是辅助
  roles.pointers.forEach((p, i) => {
    const g = geo.get(p.node);
    if (!g) return;
    const tone = toneFor(i + 1);
    const gapBelow = fitViewport ? Math.min(16, (rowGap - g.h) / 2) : 16;
    const py = g.y + g.h + gapBelow;
    prims.push(P.chip(`ptr-${p.id}`, g.x + g.w / 2, py, p.label, tone));
    prims.push(P.line(`ptr-line-${p.id}`, g.x + g.w / 2, py - 9, g.x + g.w / 2, g.y + g.h + 1, { stroke: tone.stroke, sw: 1, dash: [3, 2] }));
    nodes.set(`ptr:${p.id}`, { x: g.x + g.w / 2, y: py });
  });

  return { prims, nodes };
}

function ARRAY_NAME() {
  return '#b0197f';
}
