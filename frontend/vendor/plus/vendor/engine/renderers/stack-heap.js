/**
 * style 7 —— 栈渲染器（TDSStackForm 复原，06_STACK_HEAP.md）
 * style 8 —— 堆 / 内存单元渲染器（THeapForm 复原 + MemCellUnit 单元格原语，08_MEMORY_CELL.md）
 *
 * 两者的关键设计（复原自 sub_59A434 / sub_59A324）：
 *   · **不用增量绘制**：每次数据变化 → 释放旧单元格对象 → 清列表 → 按新数据重建 → 整幅重绘；
 *   · 一格 = 一个单元格对象 + 一套属性（TMemCellAttirbute），所以栈、堆、内存三视图长得一样；
 *   · 栈 = 竖向堆叠 + top 高亮；堆 = 按地址稀疏摆放（有空洞就画 MemEmpty）。
 */

import { LINK, MEMORY, UI } from '../theme.js';
import { P } from '../prims.js';
import { norm, stateOf, styleOf, borderWidth, toneFor } from './_shared.js';
import { memCell } from '../model.js';

export const STYLES = [7];
export const HEAP_STYLES = [8];

/* ---------------------------------------------------------------- style 7：栈 */

export function layout(layer, rect, env = {}) {
  const { data, props } = layer;
  const roles = norm(layer.roles);
  const prims = [];
  const nodes = new Map();
  const cells = data.cells || [];
  const cap = data.capacity ?? cells.length;
  const cellH = Math.min(props.cellH || 30, Math.max(22, (rect.h - 90) / Math.max(1, cap)));
  const cellW = Math.min(props.cellW || 150, rect.w * 0.52);
  const x = rect.x + rect.w / 2 - cellW / 2;
  const yTop = rect.y + 52;

  if (data.name) prims.push(P.text('name', rect.x + 16, rect.y + 16, data.name, { align: 'left', fill: LINK.LinkRefHead, size: 12 }));
  prims.push(P.text('cap', rect.x + rect.w - 14, rect.y + 16, `容量 ${cap} · 元素 ${cells.length}`, { align: 'right', size: 11, fill: UI.textMuted }));

  if (cells.length === 0) {
    prims.push(P.rect('empty', x, yTop, cellW, cellH, { r: 6, fill: MEMORY.MemEmpty, stroke: '#c7d0de', dash: [5, 4] }));
    prims.push(P.text('empty-t', x + cellW / 2, yTop + cellH / 2, '空栈', { size: 12, fill: UI.textMuted }));
  }

  // 从栈底往上画：cells[0] 是栈底
  cells.forEach((c, i) => {
    const y = yTop + (cells.length - 1 - i) * (cellH + 2);
    const st = stateOf(roles, i);
    const s = styleOf(st);
    const state = c.state || (st === 'idle' ? 'normal' : st === 'focus' ? 'focus' : 'normal');
    const box = memCell({ label: c.label || String(i), name: typeof c.value === 'string' ? c.value : '', value: c.value ?? '', addr: c.addr, state: state === 'focus' ? 'focus' : state === 'done' ? 'done' : state === 'empty' ? 'empty' : 'node' });
    prims.push(P.rect(`cell-${i}`, x, y, cellW, cellH, { r: 4, fill: st === 'idle' ? box.fill : s.fill, stroke: st === 'idle' ? MEMORY.MemFrame : s.stroke, sw: borderWidth(st), opacity: s.opacity, z: 1 }));
    prims.push(P.text(`cell-l-${i}`, x + 12, y + cellH / 2, box.label, { align: 'left', size: 10, fill: UI.textMuted, opacity: s.opacity }));
    prims.push(P.text(`cell-v-${i}`, x + cellW / 2 + 14, y + cellH / 2, box.value || '·', { size: 13, fill: st === 'idle' ? MEMORY.MemNode === '#fff5cc' ? UI.text : UI.text : s.text, opacity: s.opacity }));
    if (c.badge) prims.push(P.text(`cell-b-${i}`, x + cellW - 10, y + cellH / 2, c.badge, { align: 'right', size: 10, fill: UI.textMuted }));
    nodes.set(`cell:${i}`, { x: x + cellW / 2, y: y + cellH / 2 });
  });

  // top 指针
  const topIdx = data.top != null ? data.top : cells.length - 1;
  if (topIdx >= 0 && topIdx < cells.length) {
    const y = yTop + (cells.length - 1 - topIdx) * (cellH + 2) + cellH / 2;
    const tone = toneFor(1);
    prims.push(P.chip('top', x + cellW + 34, y, data.topLabel || 'top', tone));
    prims.push(P.line('top-line', x + cellW + 8, y, x + cellW + 2, y, { stroke: tone.stroke, sw: 1.2, arrow: 'end' }));
    nodes.set('ptr:top', { x: x + cellW + 34, y });
  }
  prims.push(P.text('bottom', x - 10, yTop + cells.length * (cellH + 2), data.bottomLabel || 'bottom', { align: 'right', size: 10, fill: UI.textMuted }));

  roles.pointers.forEach((p, i) => {
    if (p.index == null) return;
    const idx = p.index;
    if (idx < 0 || idx >= cells.length) return;
    const y = yTop + (cells.length - 1 - idx) * (cellH + 2) + cellH / 2;
    const tone = toneFor(i);
    prims.push(P.chip(`ptr-${p.id}`, x - 34, y, p.label, tone));
    prims.push(P.line(`ptr-line-${p.id}`, x - 16, y, x - 2, y, { stroke: tone.stroke, sw: 1.2, arrow: 'end' }));
    nodes.set(`ptr:${p.id}`, { x: x - 34, y });
  });

  return { prims, nodes };
}

/* ---------------------------------------------------------------- style 8：堆 / 内存单元 */

export function layoutHeap(layer, rect, env = {}) {
  const { data, props } = layer;
  const roles = norm(layer.roles);
  const prims = [];
  const nodes = new Map();
  const cells = (data.cells || []).map((c) => (c.state || c.fill ? c : memCell(c)));
  const showTree = props.showTree !== false && Array.isArray(data.tree) && data.tree.length > 0;

  if (data.name) prims.push(P.text('name', rect.x + 16, rect.y + 16, data.name, { align: 'left', fill: ARRAY_NAME(), size: 12 }));

  const listH = showTree ? rect.h * 0.52 : rect.h - 40;
  const cellH = Math.min(props.cellH || 30, Math.max(20, (listH - 30) / Math.max(1, cells.length)));
  const cellW = Math.min(props.cellW || 64, (rect.w - 80) / 6);
  const cols = Math.max(1, Math.min(8, Math.floor((rect.w - 40) / (cellW + 8))));
  const x0 = rect.x + 24;
  const y0 = rect.y + 40;

  cells.forEach((c, i) => {
    const st = stateOf(roles, i);
    const s = styleOf(st);
    const r = Math.floor(i / cols);
    const cc = i % cols;
    const x = x0 + cc * (cellW + 10);
    const y = y0 + r * (cellH + 22);
    prims.push(P.rect(`cell-${i}`, x, y, cellW, cellH, { r: 4, fill: st === 'idle' ? c.fill : s.fill, stroke: st === 'idle' ? c.stroke : s.stroke, sw: borderWidth(st), opacity: s.opacity, z: 1 }));
    prims.push(P.text(`cell-v-${i}`, x + cellW / 2, y + cellH / 2, String(c.value ?? ''), { size: 12, fill: st === 'idle' ? UI.text : s.text, opacity: s.opacity }));
    prims.push(P.text(`cell-a-${i}`, x + cellW / 2, y + cellH + 10, c.label ?? (c.addr != null ? `@${c.addr}` : String(i)), { size: 9, fill: UI.textMuted, opacity: s.opacity }));
    nodes.set(`cell:${i}`, { x: x + cellW / 2, y: y + cellH / 2 });
  });

  // 逻辑堆形态（完全二叉树）：把数组画成父子关系，方便核对堆性质
  if (showTree) {
    const arr = data.tree;
    const depth = Math.floor(Math.log2(arr.length));
    const fitTree = props.fitTree && cells.length === 0;
    let top = y0 + Math.ceil(cells.length / cols) * (cellH + 22) + 26;
    let levelH = depth ? Math.max(30, Math.min(56, (rect.y + rect.h - top - 16) / (depth + 1))) : 0;
    let radius = 13;
    let inset = 40;
    if (fitTree) {
      inset = 16;
      const slotWidth = Math.max(1, rect.w - 2 * inset) / 2 ** depth;
      levelH = depth ? Math.max(1, Math.min(136, (rect.h - 100) / depth)) : 0;
      radius = Math.max(2, Math.min(27, slotWidth * 0.42, depth ? levelH * 0.32 : 27));
      top = rect.y + Math.max(50, (rect.h - depth * levelH) / 2);
    }
    const root = data.treeRoot ?? 0;
    const pos = new Map();
    const place = (k, depth, lo, hi) => {
      if (k >= arr.length) return;
      const mid = (lo + hi) / 2;
      pos.set(k, [rect.x + mid, top + depth * levelH]);
      place(2 * k + 1, depth + 1, lo, mid);
      place(2 * k + 2, depth + 1, mid, hi);
    };
    place(root, 0, inset, rect.w - inset);
    for (let k = 0; k < arr.length; k++) {
      const left = 2 * k + 1;
      const right = 2 * k + 2;
      for (const ch of [left, right]) {
        if (ch < arr.length && pos.has(k) && pos.has(ch)) {
          const a = pos.get(k);
          const b = pos.get(ch);
          prims.push(P.line(`te-${k}-${ch}`, a[0], a[1] + radius - 1, b[0], b[1] - radius + 1, { stroke: '#c7d0de', sw: 1.2 }));
        }
      }
    }
    for (let k = 0; k < arr.length; k++) {
      if (!pos.has(k)) continue;
      const [x, y] = pos.get(k);
      const st = stateOf(roles, k);
      const s = styleOf(st);
      prims.push(P.circle(`tn-${k}`, x, y, radius, { fill: st === 'idle' ? '#ffffff' : s.fill, stroke: st === 'idle' ? MEMORY.MemFrame : s.stroke, sw: borderWidth(st), opacity: s.opacity, z: 3 }));
      prims.push(P.text(`tnv-${k}`, x, y, String(arr[k] ?? ''), { size: fitTree ? Math.min(15, Math.max(8, radius * 0.65)) : 10, fill: st === 'idle' ? UI.text : s.text, z: 4 }));
      prims.push(P.text(`tni-${k}`, x, y + radius + 7, String(k), { size: 9, fill: UI.textMuted }));
      nodes.set(`tree:${k}`, { x, y });
    }
    if (!fitTree) prims.push(P.text('treelabel', rect.x + 16, top - 22, '逻辑堆（完全二叉树形态）', { align: 'left', size: 10, fill: UI.textMuted }));
  }

  roles.pointers.forEach((p, i) => {
    if (p.index == null) return;
    const r = Math.floor(p.index / cols);
    const cc = p.index % cols;
    const tone = toneFor(i);
    const x = x0 + cc * (cellW + 10) + cellW / 2;
    const y = y0 + r * (cellH + 22) - 14;
    prims.push(P.chip(`ptr-${p.id}`, x, y, p.label, tone));
    nodes.set(`ptr:${p.id}`, { x, y });
  });

  return { prims, nodes };
}

function ARRAY_NAME() {
  return '#b0197f';
}
