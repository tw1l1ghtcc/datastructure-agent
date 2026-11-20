/**
 * style 2 —— 二维数组 / 矩阵渲染器（TTwoArrayForm 复原）
 * style 6 —— 数组基类 GDI 降级（TArrayForm 复原，平面网格 + 线段）
 *
 * 复原 DrawMode 严格 4 种（不是 12 种画法）：
 *   0 圆柱 —— 圆头竖条
 *   1 柱状 —— 直角竖条
 *   2 球   —— 圆点（半径随值）
 *   3 曲面 —— 网格线（把相邻数据点连成线框；AnyviewC 侧是 GL_LINES，这里同样只连线）
 *
 * 说明：AnyviewC 的这四种模式在 OpenGL 后端里是三维几何；本项目按用户要求不做 3D，
 * 因此用 2D 等效画法保留「四种模式的语义差异」，不做伪三维投影。
 * 一维格仍然按行列定位，数值大小用长度/半径/密度表达，数值永远有文字标注。
 */

import { ARRAY, MEMORY, UI } from '../theme.js';
import { P } from '../prims.js';
import { norm, stateOf, styleOf, borderWidth } from './_shared.js';

export const STYLES = [2];

const MODE_NAME = { 0: '圆柱', 1: '柱状', 2: '球', 3: '曲面' };

function num(v) {
  if (v === '∞' || v === Infinity) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function layout(layer, rect, env = {}) {
  const { data, props } = layer;
  const roles = norm(layer.roles);
  const rows = data.values || [];
  const R = rows.length;
  const C = R ? rows[0].length : 0;
  const prims = [];
  const nodes = new Map();

  if (data.name) prims.push(P.text('name', rect.x + 16, rect.y + 16, data.name, { align: 'left', fill: ARRAY.ArrName, size: 12 }));
  if (!R || !C) {
    prims.push(P.text('empty', rect.x + rect.w / 2, rect.y + rect.h / 2, '空矩阵', { fill: UI.textMuted, size: 12 }));
    return { prims, nodes };
  }

  const drawMode = props.drawMode ?? 1;
  let maxAbs = 1;
  for (const r of rows) for (const v of r) {
    const n = num(v);
    if (n != null) maxAbs = Math.max(maxAbs, Math.abs(n));
  }

  const padL = 54;
  const padT = 44;
  const padR = 18;
  const padB = 26;
  // 列数很多时不能死守 28px，否则整张矩阵会溢出面板右侧被裁掉
  const cw = Math.max(6, (rect.w - padL - padR) / C);
  const ch = Math.max(6, (rect.h - padT - padB) / R);
  const x0 = rect.x + padL;
  const y0 = rect.y + padT;

  // ---- 底座网格（AnyviewC 的坐标轴 + 网格）
  for (let c = 0; c <= C; c++) prims.push(P.line(`gx-${c}`, x0 + c * cw, y0, x0 + c * cw, y0 + R * ch, { stroke: '#e7ebf4', sw: 1 }));
  for (let r = 0; r <= R; r++) prims.push(P.line(`gy-${r}`, x0, y0 + r * ch, x0 + C * cw, y0 + r * ch, { stroke: '#e7ebf4', sw: 1 }));

  const cellState = (r, c) => stateOf(roles, `${r},${c}`);

  // ---- DrawMode 3（曲面）：先画线框，再叠文字
  if (drawMode === 3) {
    const pt = (r, c) => {
      const v = num(rows[r][c]);
      const hRatio = v == null ? 0 : Math.abs(v) / maxAbs;
      return [x0 + c * cw + cw / 2, y0 + r * ch + ch - 6 - (ch - 16) * hRatio];
    };
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        const st = cellState(r, c);
        const s = styleOf(st);
        const p = pt(r, c);
        if (c + 1 < C) prims.push(P.line(`sf-h-${r}-${c}`, p[0], p[1], pt(r, c + 1)[0], pt(r, c + 1)[1], { stroke: st === 'idle' ? '#9aa6bf' : s.stroke, sw: st === 'idle' ? 1 : 2, opacity: s.opacity }));
        if (r + 1 < R) prims.push(P.line(`sf-v-${r}-${c}`, p[0], p[1], pt(r + 1, c)[0], pt(r + 1, c)[1], { stroke: st === 'idle' ? '#9aa6bf' : s.stroke, sw: st === 'idle' ? 1 : 2, opacity: s.opacity }));
        prims.push(P.circle(`sf-p-${r}-${c}`, p[0], p[1], 3, { fill: s.stroke, opacity: s.opacity, z: 3 }));
      }
    }
  }

  // ---- 数据本体（0/1/2 三种柱体；3 只叠数值）
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      const key = `${r},${c}`;
      const v = rows[r][c];
      const n = num(v);
      const st = cellState(r, c);
      const s = styleOf(st);
      const cx = x0 + c * cw;
      const cy = y0 + r * ch;
      const text = n == null ? '∞' : String(v);
      nodes.set(`cell:${key}`, { x: cx + cw / 2, y: cy + ch / 2 });

      if (drawMode === 3) {
        prims.push(P.text(`v-${key}`, cx + cw / 2, cy + ch / 2, text, { size: 10, fill: st === 'idle' ? UI.textMuted : s.text, opacity: s.opacity, z: 4 }));
        continue;
      }

      const hRatio = n == null ? 0 : Math.abs(n) / maxAbs;
      const barW = Math.max(6, cw * 0.52);
      const barH = Math.max(3, (ch - 22) * hRatio);
      // 聚焦格：给一层淡底，保证"角色"在柱体之外也读得出来
      if (st !== 'idle') prims.push(P.rect(`bg-${key}`, cx + 2, cy + 2, cw - 4, ch - 4, { r: 6, fill: s.fill, stroke: s.stroke, sw: 1, opacity: 0.55, z: 0 }));
      const bx = cx + (cw - barW) / 2;
      const by = cy + ch - 8 - barH;
      if (drawMode === 2) {
        const rr = Math.max(3, Math.min(barW / 2, barH / 2 + 2));
        prims.push(P.circle(`s-${key}`, cx + cw / 2, cy + ch - 8 - rr, rr, { fill: n == null ? '#dfe4ef' : s.stroke, opacity: s.opacity, z: 2 }));
      } else if (drawMode === 0) {
        prims.push(P.pill(`c-${key}`, bx, by, barW, Math.max(barH, barW * 0.9), { fill: n == null ? '#dfe4ef' : s.stroke, opacity: s.opacity, z: 2 }));
      } else {
        prims.push(P.rect(`b-${key}`, bx, by, barW, barH, { r: 3, fill: n == null ? '#dfe4ef' : s.stroke, opacity: s.opacity, z: 2 }));
      }
      prims.push(P.text(`v-${key}`, cx + cw / 2, cy + ch - 12, text, { size: 10, fill: st === 'idle' ? UI.text : s.text, z: 5 }));
    }
  }

  // ---- 行列标号
  for (let c = 0; c < C; c++) prims.push(P.text(`col-${c}`, x0 + c * cw + cw / 2, y0 - 14, data.colLabels ? data.colLabels[c] : String(c), { fill: UI.textMuted, size: 11 }));
  for (let r = 0; r < R; r++) prims.push(P.text(`row-${r}`, x0 - 16, y0 + r * ch + ch / 2, data.rowLabels ? data.rowLabels[r] : String(r), { fill: UI.textMuted, size: 11 }));
  prims.push(P.text('mode', rect.x + rect.w - 12, rect.y + 16, `${MODE_NAME[drawMode]}模式`, { align: 'right', fill: UI.textMuted, size: 11 }));
  return { prims, nodes };
}

/* ---------------------------------------------------------------- style 6：GDI 表格 */

export const GRID_STYLES = [6];

function layoutIndexedArray(layer, rect) {
  const values = layer.data.values[0] ?? [];
  const prims = [];
  const nodes = new Map();
  if (!values.length) {
    prims.push(P.text('empty', rect.x + rect.w / 2, rect.y + rect.h / 2, '顺序表为空', { fill: UI.textMuted, size: 14 }));
    return { prims, nodes };
  }

  const gap = 8;
  const width = Math.max(1, rect.w - 32);
  const height = Math.max(1, rect.h - 32);
  const rowsAtDefaultHeight = Math.max(1, Math.floor((height + gap) / 44));
  const columns = Math.min(values.length, Math.max(
    Math.ceil(values.length / rowsAtDefaultHeight), Math.floor((width + gap) / 76)
  ));
  const rows = Math.ceil(values.length / columns);
  const cellW = Math.max(1, Math.min(176, (width + gap) / columns - gap));
  const cellH = Math.max(1, Math.min(124, (height + gap) / rows - gap));
  const left = rect.x + (rect.w - columns * (cellW + gap) + gap) / 2;
  const top = rect.y + (rect.h - rows * (cellH + gap) + gap) / 2;
  const roles = norm(layer.roles);

  values.forEach((value, index) => {
    const x = left + index % columns * (cellW + gap);
    const y = top + Math.floor(index / columns) * (cellH + gap);
    const cx = x + cellW / 2;
    const state = stateOf(roles, index);
    const style = styleOf(state);
    const label = String(value);
    const size = Math.max(5, Math.min(25, cellH * 0.38, (cellW - 8) / (label.length * 0.65)));
    const position = String(layer.data.cellLabels?.[index] ?? index);
    prims.push(P.rect(`g-${index}`, x, y, cellW, cellH, { r: 7, fill: style.fill, stroke: style.stroke, sw: borderWidth(state) }));
    prims.push(P.text(`gv-${index}`, cx, y + cellH * 0.38, label, { size, fill: style.text }));
    prims.push(P.text(`idx-${index}`, cx, y + cellH * 0.79, position, { size: Math.min(13, cellH * 0.26), fill: state === 'idle' ? UI.textMuted : style.text }));
    nodes.set(`cell:${index}`, { x: cx, y: y + cellH / 2 });
  });
  return { prims, nodes };
}

/** style 6：TArrayForm 的 TCanvas 平面表示（无 OpenGL 时的降级路径） */
export function layoutGrid(layer, rect) {
  const { data, props } = layer;
  if (props.indexedArray) return layoutIndexedArray(layer, rect);
  const roles = norm(layer.roles);
  const values = data.values || [];
  const prims = [];
  const nodes = new Map();
  const R = values.length;
  const C = R ? values[0].length : 0;
  if (data.name) prims.push(P.text('name', rect.x + 14, rect.y + 14, data.name, { align: 'left', fill: ARRAY.ArrName, size: 12 }));
  if (!R || !C) {
    prims.push(P.text('empty', rect.x + rect.w / 2, rect.y + rect.h / 2, '空表格', { fill: UI.textMuted, size: 12 }));
    return { prims, nodes };
  }
  const pad = 34;
  const cw = Math.max(8, Math.min(props.cellW || 52, (rect.w - pad * 2) / (C + 1)));
  const chh = Math.max(8, Math.min(props.cellH || 30, (rect.h - pad * 2) / (R + 1)));
  const x0 = rect.x + pad + cw;
  const y0 = rect.y + pad + chh;

  for (let c = 0; c < C; c++) {
    prims.push(P.rect(`ch-${c}`, x0 + c * cw, y0 - chh, cw, chh, { r: 0, fill: '#eef2f8', stroke: '#dce2ec' }));
    prims.push(P.text(`cht-${c}`, x0 + c * cw + cw / 2, y0 - chh / 2, data.colLabels ? data.colLabels[c] : String(c), { size: 10, fill: UI.textMuted }));
  }
  for (let r = 0; r < R; r++) {
    prims.push(P.rect(`rh-${r}`, x0 - cw, y0 + r * chh, cw, chh, { r: 0, fill: '#eef2f8', stroke: '#dce2ec' }));
    prims.push(P.text(`rht-${r}`, x0 - cw / 2, y0 + r * chh + chh / 2, data.rowLabels ? data.rowLabels[r] : String(r), { size: 10, fill: UI.textMuted }));
    for (let c = 0; c < C; c++) {
      const key = `${r},${c}`;
      const st = stateOf(roles, key);
      const s = styleOf(st);
      prims.push(P.rect(`g-${key}`, x0 + c * cw, y0 + r * chh, cw, chh, { r: 0, fill: s.fill, stroke: st === 'idle' ? MEMORY.MemFrame : s.stroke, sw: borderWidth(st), opacity: s.opacity }));
      const raw = values[r][c];
      prims.push(P.text(`gv-${key}`, x0 + c * cw + cw / 2, y0 + r * chh + chh / 2, raw === Infinity ? '∞' : String(raw), { size: 11, fill: s.text, opacity: s.opacity }));
      nodes.set(`cell:${key}`, { x: x0 + c * cw + cw / 2, y: y0 + r * chh + chh / 2 });
    }
  }
  if (data.triples) prims.push(P.text('tri', rect.x + rect.w / 2, y0 + R * chh + 18, data.triples, { size: 11, fill: UI.textMuted }));
  return { prims, nodes };
}
