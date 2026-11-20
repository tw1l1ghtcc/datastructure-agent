/**
 * host-frame.js -- **帧契约适配器**：把 plus01&02 的层数据，输出成
 * `raw/datastructure-agent` 里 `frameBuilder` 期望的东西
 *
 * 他们的契约（`frontend/src/features/visualization/index.js:352`）：
 *     const frame = frameBuilder(step, options) ?? buildFrame(step, options);
 *     track.replaceChildren(...frame.cells);          // ← 只要给我 { cells: [Element] }
 * 默认实现是 `buildPrototypeArrayFrame`（`prototype-array.js`），返回：
 *     { cells: [<svg class="prototype-array">…], pointers: new Map() }
 *
 * 所以"用 plus01&02 的内容替换它的前端逻辑、而它的样式/动画一个都不变"的**最后一公里**就是：
 * 用我的层数据，产出**同样的 SVG 帧结构 + 同样的类名**（这些类名全部定义在它的
 * visualization.css 里：`.prototype-array*`、`.prototype-marker*`、`is-excluded/is-mid/is-found/is-comparing`）。
 *
 * 本文件不依赖 plus01&02 的任何 CSS —— 颜色/字号/动效全部由宿主的样式表决定。
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(doc, name, attrs, text) {
  const node = doc.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) node.setAttribute(k, String(v));
  if (text !== undefined) node.textContent = String(text);
  return node;
}

/** 指针三行在宿主里的固定 y（取自它的 MARKERS 常量语义：左/右在上，中在下） */
const MARKER_Y = { left: 46, right: 46, mid: 26 };
const MARKER_LABEL = { left: 'L', right: 'R', mid: 'M' };
/* 自由指针（自定义代码里的 i / j / k / cur …）用的行位：就是上面三条行位本身，
   只是"没被 L/R/M 占用的那几行"才给它们用 —— 不新增视觉规则，也不改宿主的三行语义。 */
const FREE_ROWS = [46, 26, 8];

/** 从 plus01&02 的层里取"数组 + 区间 + 指针"；也接受已经是 Step v1 形状的入参 */
function normalize(input) {
  if (!input) return null;
  // ① Step v1（{array, variables:{left,right}, event}）
  if (Array.isArray(input.array)) {
    return {
      array: input.array,
      left: input.variables ? input.variables.left : null,
      right: input.variables ? input.variables.right : null,
      mid: input.variables ? input.variables.mid : null,
      event: input.event || 'none',
      result: input.result == null ? null : input.result,
      /* 宿主原本只有 L/R/M；自定义代码带上来的是任意名字的游标（i / j / k …），
         它们是 Step v1 之外的**附加字段**，老调用方不带就相当于空数组。 */
      pointers: Array.isArray(input.pointers) ? input.pointers.map((p) => ({ id: p.id, label: p.label, index: p.index, node: p.node })) : [],
      focus: Array.isArray(input.focus) ? input.focus : [],
      /* 标签也要带过来：字符数组的 `h`/`i`、未初始化格的 `?` 都存在 labels 里，
         只取数值的话格子上会显示 104 / 0（评审报告 §3.5）。 */
      labels: Array.isArray(input.labels) ? input.labels.slice() : null,
      name: input.arrayName || null,
    };
  }
  // ② plus01&02 的 layer（data.values + roles.marks/pointers）
  const d = input.data || {};
  const r = input.roles || {};
  const values = Array.isArray(d.values) ? d.values : (Array.isArray(d.cells) ? d.cells.map((c) => (c && c.value)) : []);
  const marks = r.marks || d.marks || {};
  const range = Array.isArray(marks.range) ? marks.range : null;
  const pointers = (r.pointers || []).map((p) => ({ id: p.id, label: p.label, index: p.index }));
  const found = (r.done && r.done.length) || false;
  return {
    array: values,
    left: range ? Math.min(range[0], range[1]) : null,
    right: range ? Math.max(range[0], range[1]) : null,
    mid: typeof marks.pointer === 'number' ? marks.pointer : (pointers.find((p) => /^(m|mid|middle)$/i.test(String(p.id))) || {}).index ?? null,
    event: found ? 'found' : (input.event || (d && d.event) || 'probe'),
    result: found ? (pointers[0] && pointers[0].index) ?? null : null,
    pointers,
  };
}

/** 指针 → 宿主的三条行（与 host-profile.js 的规则一致，这里独立一份，避免宿主侧多依赖） */
function sideOf(p) {
  const id = String((p && (p.id || p.label)) || '');
  if (/^(l|lo|left|low|begin|start)$/i.test(id)) return 'left';
  if (/^(r|hi|right|high|end|last)$/i.test(id)) return 'right';
  if (/^(m|mid|middle|center|pivot|probe)$/i.test(id)) return 'mid';
  return null;
}

/**
 * buildArrayFrame -- 产出与宿主 `buildPrototypeArrayFrame` **同结构**的帧
 *
 * 几何完全照它的实现（spacing 26~56、padLeft 34、height 202、top 64 / bottom 158、index 文本 y=187），
 * 这样它的 `.prototype-array*` 样式与 `.prototype-marker*` 药丸/配色原样生效。
 *
 * @param {object} input plus01&02 的 layer，或 Step v1
 * @param {{doc?:Document, width?:number, height?:number}} [opts]
 * @returns {{cells: Element[], pointers: Map<string, Element>}|null}
 */
export function buildArrayFrame(input, opts = {}) {
  const doc = opts.doc || (globalThis.document);
  const st = normalize(input);
  if (!st || !st.array || !st.array.length) return null;

  const count = st.array.length;
  const padLeft = 34;
  const spacing = opts.width ? Math.max(5, (opts.width - padLeft - 24) / count)
    : Math.max(26, Math.min(56, Math.floor(640 / count)));
  const width = opts.width || (padLeft + spacing * count + 18);
  const height = opts.height || 202;
  const bottom = height - 44;
  const top = opts.height ? Math.min(80, bottom - 15) : 64;

  const min = Math.min(0, ...st.array);
  const max = Math.max(0, ...st.array);
  const yFor = (v) => bottom - ((v - min) / (max - min || 1)) * (bottom - top);
  const zero = yFor(0);
  const center = (i) => padLeft + (i + 0.5) * spacing;

  const chart = svgEl(doc, 'svg', { class: 'prototype-array', width, height, viewBox: `0 0 ${width} ${height}`, role: 'img' });
  const xEnd = width - 10;
  chart.appendChild(svgEl(doc, 'path', {
    class: 'prototype-array-axis',
    d: `M ${padLeft} ${zero} H ${xEnd} m -4 -4 l 4 4 -4 4 M ${padLeft} ${bottom} V ${top - 6} m -4 4 l 4 -4 4 4`,
  }));
  chart.appendChild(svgEl(doc, 'text', { x: xEnd - 4, y: zero - 9 }, 'X'));
  chart.appendChild(svgEl(doc, 'text', { x: padLeft - 10, y: top - 2 }, 'Y'));

  const barWidth = Math.min(80, spacing * 0.6);
  const midIndex = st.mid;
  const foundIndex = st.event === 'found' ? st.result : null;
  /* 自定义代码的"这一步动的格子"（引擎给的 focus1）。宿主没有 is-focus，用已有的
     is-comparing（同色系高亮，见 visualization.css），不加任何新样式。 */
  const focusSet = new Set((st.focus || []).map(Number).filter((i) => Number.isInteger(i)));
  /* 只有"自定义代码的步"才带 focus 字段 → 入场/写入动效也只在自定义代码里加。
     54 个 plus 示例不带这个字段，走的是和以前完全一样的路径（零视觉变化）。 */
  const customStep = Array.isArray(input && input.focus);
  const prevArray = customStep && opts.previous && Array.isArray(opts.previous.array) ? opts.previous.array : null;
  const reducedMotion = Boolean(opts.reduced);   // 尊重"减少动效"；假 DOM 里没有 element.animate，见下面的 typeof 判断

  st.array.forEach((value, index) => {
    const x = center(index);
    const y = yFor(value);
    const excluded = st.left != null && (index < st.left || index > st.right);

    const cell = svgEl(doc, 'g', { class: 'prototype-array-cell', 'data-index': index });
    if (excluded) cell.classList.add('is-excluded');            // ← 宿主的 .prototype-array-cell.is-excluded
    if (midIndex != null && index === midIndex) cell.classList.add('is-mid');
    if (foundIndex != null && index === foundIndex) cell.classList.add('is-found');
    if (focusSet.has(index)) cell.classList.add('is-comparing');

    /* 格子文字优先用层给的 labels（字符数组的 h/i、未初始化格的 ?）；
       没有 labels 才退回数值文本（宿主 54 个示例走的就是这条，行为不变）。 */
    const label = st.labels && st.labels[index] != null ? String(st.labels[index]) : String(value);
    const valueLabel = svgEl(doc, 'text', { class: 'prototype-array-value', x, y: value < 0 ? y + 13 : y - 6 }, label);
    const labelWidth = spacing - 4;
    const mark = svgEl(doc, 'g', {});
    if (label.length > Math.floor(labelWidth / 6)) {
      valueLabel.setAttribute('textLength', String(labelWidth));
      valueLabel.setAttribute('lengthAdjust', 'spacingAndGlyphs');
      if (opts.width) mark.appendChild(svgEl(doc, 'title', {}, label));
    }
    mark.appendChild(svgEl(doc, 'rect', {
      x: x - barWidth / 2,
      y: value === 0 ? zero - 2 : Math.min(y, zero),
      width: barWidth,
      height: Math.max(2, Math.abs(zero - y)),
      rx: 2,
    }));
    mark.appendChild(valueLabel);
    cell.appendChild(mark);
    cell.appendChild(svgEl(doc, 'path', { class: 'prototype-array-axis', d: `M ${x} ${zero} v 4` }));
    cell.appendChild(svgEl(doc, 'text', { x, y: height - 15 }, index));
    chart.appendChild(cell);

    /* 自定义代码：值变了的格子淡入一下（宿主在 prototype-array.js 里对"写入格"用的就是这招：
       element.animate 的透明度过渡）。首帧按 index 错峰入场，和宿主一致。 */
    if (customStep && !reducedMotion && typeof cell.animate === 'function') {
      const prevValue = prevArray && index < prevArray.length ? prevArray[index] : null;
      const appeared = prevArray ? prevValue == null : true;
      const changed = prevArray ? prevValue !== value : false;
      const isFocus = focusSet.has(index);
      if (appeared || changed || isFocus) {
        cell.animate(
          [{ opacity: appeared ? 0.2 : 0.55 }, { opacity: excluded ? 0.4 : 1 }],
          { duration: appeared ? 260 : 220, easing: 'ease-out', delay: appeared && opts.enter ? (index % 8) * 35 : 0 },
        );
      }
    }
  });

  // 指针药丸（宿主的 .prototype-marker.is-left/right/mid + data-ptr 用于 FLIP 量取）
  const pointers = new Map();
  const seen = new Set();
  for (const p of st.pointers) {
    const side = sideOf(p);
    if (!side || seen.has(side)) continue;
    if (p.index == null) continue;
    seen.add(side);
    const x = center(Number(p.index));
    const y = MARKER_Y[side];
    const marker = svgEl(doc, 'g', { class: `prototype-marker is-${side}`, 'data-ptr': side });
    marker.appendChild(svgEl(doc, 'rect', { x: x - 8, y: y - 9, width: 16, height: 16, rx: 4 }));
    marker.appendChild(svgEl(doc, 'text', { x, y: y + 2 }, MARKER_LABEL[side]));
    chart.appendChild(marker);
    pointers.set(side, marker);
  }

  /* 自由指针（自定义代码的 i / j / k / cur …）：
     名字不是 L/R/M，所以不能用三行语义；但**药丸本体、配色、FLIP 量取方式完全一样** ——
     用同一套 .prototype-marker + data-ptr，键换成变量名，宿主那边的指针 FLIP 自动生效
     （它按 map 的键量旧位置 → 新位置，见 visualization/index.js 的 flipPointers）。
     行位只在 L/R/M 没用掉的那几行里挑，两个游标落在同一格时上下叠一层。 */
  const usedRows = new Set(['left', 'right', 'mid'].filter((s) => seen.has(s)).map((s) => MARKER_Y[s]));
  const freeRows = FREE_ROWS.filter((y) => !usedRows.has(y));
  const stacked = new Map();
  for (const p of st.pointers) {
    if (sideOf(p)) continue;
    const idx = Number(p.index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= st.array.length) continue;
    const key = String(p.id || p.label || 'ptr');
    if (pointers.has(key)) continue;
    const rowKey = opts.width && spacing < 32 ? 'nearby' : idx;
    const row = stacked.get(rowKey) || 0;
    stacked.set(rowKey, row + 1);
    const y = freeRows[Math.min(row, freeRows.length - 1)];
    const text = String(p.label == null ? key : p.label);
    const w = Math.max(16, 10 + text.length * 7);
    const x = center(idx);
    const marker = svgEl(doc, 'g', { class: 'prototype-marker is-free', 'data-ptr': key });
    marker.appendChild(svgEl(doc, 'rect', { x: x - w / 2, y: y - 9, width: w, height: 16, rx: 4 }));
    marker.appendChild(svgEl(doc, 'text', { x, y: y + 2 }, text));
    chart.appendChild(marker);
    pointers.set(key, marker);
  }

  return { cells: [chart], pointers };
}

/** 宿主 frameBuilder 签名适配：buildPrototypeArrayFrame(step, {previous, enter, reduced}) */
export function asFrameBuilder(input, opts = {}) {
  return buildArrayFrame(input, opts);
}
