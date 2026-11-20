/**
 * svg-stage.js -- **SVG/DOM 渲染机制 + 元素级动画挂载点**（替代 canvas-stage.js）
 *
 * 为什么要换：canvas 只能"整帧重绘 + 补间"，没有元素可以挂 CSS 动画；
 * 而 `raw/datastructure-agent` 的可视化是 **SVG 节点 + CSS keyframes**（8 组 bsviz-*）。
 * 要在不改它样式/动画的前提下把 plus01&02 的逻辑接进去，渲染机制必须先对齐。
 *
 * 接口与 canvas-stage.js **完全一致**（viz-window.js 只依赖这 5 个方法）：
 *   createStage(host) -> { render(layers,{prevLayers,t,bg}), clear(), resize(), metrics(), cardCount(), host }
 *
 * 每个 layer 一张卡：.canvas-card > header + .avc-svg-wrap > <svg viewBox="0 0 w h">
 * 图元 → <g class="avc-el" data-avc-key=…>（见 prim-dom.js）
 *
 * 动画挂载点（两处，都是 DOM）：
 *   ① 位置：<g> 的 style.transform → CSS `transition: transform` 自动补间（替代 canvas 的 drawTween）
 *   ② 状态：<g> 上的 avc-enter / avc-exit / avc-flash / avc-dim 类 → CSS @keyframes（见 anim.css）
 * 语义由"步进差分"推出，不需要每个渲染器提供动画信息：
 *   新出现 → enter｜消失 → exit（保留一帧再删）｜同 key 文本变了 → flash｜opacity<1 → dim
 */

import { dispatch } from '../vendor/engine/dispatch.js';
import { RENDERERS } from '../vendor/catalog/datastructures.js';
import { polishLayout } from './canvas-stage.js';
import { primBox, chipBox, profileOf } from './layout-policy.js';
import { upsertPrim, applyAnim, clearAnim } from './prim-dom.js';

export const CARD_CANVAS_HEIGHT = 300;   // 与 canvas-stage 同名同义（viz-window 直接 import 这个名字）
export const CARD_MIN_HEIGHT = 130;
const SVG_NS = 'http://www.w3.org/2000/svg';

/** 卡片副标题：与 canvas-stage 一致（格数 / 结点数） */
export function layerHint(layer) {
  const d = (layer && layer.data) || {};
  if (Array.isArray(d.values)) {
    return Array.isArray(d.values[0]) ? ` · ${d.values.length}×${d.values[0].length}` : ` · ${d.values.length} 格`;
  }
  if (Array.isArray(d.cells)) return ` · ${d.cells.length} 格`;
  if (Array.isArray(d.nodes)) return ` · ${d.nodes.length} 结点`;
  return '';
}

const reduceMotion = () => {
  try { return !!(globalThis.matchMedia && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch { return false; }
};

/* childNodes 在各家假 DOM 里不一定是真数组（可能只是 length + 下标），
   所以不要用 includes/slice，统一走这两个小工具。 */
function listChildren(el) {
  const out = [];
  const cs = (el && el.childNodes) || [];
  for (let i = 0; i < cs.length; i++) out.push(cs[i]);
  return out;
}
function hasChild(el, child) {
  const cs = (el && el.childNodes) || [];
  for (let i = 0; i < cs.length; i++) if (cs[i] === child) return true;
  return false;
}

export function createStage(host) {
  const doc = (host && host.ownerDocument) || globalThis.document;
  let cards = new Map();          // layerId -> { card, svg, group, byKey:Map, id, height }
  let lastMetrics = { cards: 0, prims: 0, styles: [], created: 0, updated: 0, removed: 0, anim: {} };

  function makeCard(layer, index) {
    const card = doc.createElement('div');
    card.className = 'canvas-card' + (index === 0 ? ' main' : '');
    card.dataset.layer = layer.id;

    const header = doc.createElement('header');
    const b = doc.createElement('b');
    b.textContent = layer.title || layer.id || ('layer' + index);
    const span = doc.createElement('span');
    span.textContent = (RENDERERS[layer.style]?.cls || '') + ' · style ' + layer.style + layerHint(layer);
    header.appendChild(b);
    header.appendChild(span);
    card.appendChild(header);

    const wrap = doc.createElement('div');
    wrap.className = 'avc-svg-wrap';
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'avc-svg');
    svg.setAttribute('data-avc-svg', layer.id);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.style.width = '100%';
    svg.style.height = CARD_CANVAS_HEIGHT + 'px';
    const group = doc.createElementNS(SVG_NS, 'g');
    group.setAttribute('class', 'avc-layer');
    svg.appendChild(group);
    wrap.appendChild(svg);
    card.appendChild(wrap);
    host.appendChild(card);

    return { card, svg, group, byKey: new Map(), id: layer.id, height: CARD_CANVAS_HEIGHT };
  }

  function syncCards(layers) {
    const ids = (layers || []).map((l, i) => l.id || ('layer' + i));
    for (const [id, rec] of [...cards.entries()]) {
      if (!ids.includes(id)) { rec.card.remove(); cards.delete(id); }
    }
    (layers || []).forEach((layer, i) => {
      const id = ids[i];
      if (!cards.has(id)) cards.set(id, makeCard(layer, i));
      const rec = cards.get(id);
      if (Number.isFinite(layer.props?.canvasWidth)) rec.card.style.width = layer.props.canvasWidth + 'px';
      const hd = rec.card.querySelector('header');
      if (hd) hd.setAttribute('data-size', measure(rec).w + 'x' + rec.height);
      const title = rec.card.querySelector('header b');
      if (title) title.textContent = layer.title || id;
      const span = rec.card.querySelector('header span');
      if (span) span.textContent = (RENDERERS[layer.style]?.cls || '') + ' · style ' + layer.style + layerHint(layer);
    });
  }

  /**
   * 卡片尺寸：宽度取**容器宽度**（不是卡片自己的 rect，避免"卡片高度影响自身宽度"的回环），
   * 并且变化 < 24px 时沿用它——滚动条、舍入这类抖动不该重排布局。
   */
  function measure(rec) {
    /* 宽度用**卡片的布局宽度**（clientWidth/offsetWidth），不要用 getBoundingClientRect()：
       rect 会被祖先的 CSS transform（宿主视口的 fitView 缩放）一起缩放，
       于是一边排版一边被缩放 → 越走越偏。rect 只在拿不到布局宽度时兜底。 */
    const layoutW = rec.card && (rec.card.clientWidth || rec.card.offsetWidth);
    const r = layoutW ? null : (rec.card && rec.card.getBoundingClientRect ? rec.card.getBoundingClientRect() : null);
    const raw = Math.max(240, Math.round(layoutW || (r && r.width) || (host && host.clientWidth) || 800));
    if (rec.lastW == null || Math.abs(raw - rec.lastW) >= 24) rec.lastW = raw;
    return { w: rec.lastW, h: rec.height };
  }
  function resize() {
    for (const rec of cards.values()) {
      const { w, h } = measure(rec);
      rec.svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
      rec.svg.style.height = h + 'px';
    }
  }

  function contentBottom(prims, P) {
    let bottom = 0;
    for (const p of prims || []) {
      const b = primBox(p, P);
      if (b) bottom = Math.max(bottom, b.y + b.h);
    }
    return bottom;
  }

  /** 一层的图元 → 该层 <g> 里的元素（按 key 复用；新增/消失判动画） */
  function paintLayer(rec, layer, rect, opt) {
    const P = profileOf(layer.style).policy;
    const res = dispatch(layer.style).instance.layout(layer, rect, { bg: opt.bg || '#ffffff' });
    const prims = polishLayout(res.prims, rect, layer.style, layer);
    const motion = !reduceMotion() && opt.animate !== false;
    const keepExit = Math.max(0, (P.exitRetain != null ? P.exitRetain : 0)) > 0;   // 默认 0：消失就删，绝不留残影

    // 按 z 排序（SVG 用文档顺序表达层级），同 z 保持原顺序
    const ordered = prims.map((p, i) => ({ p, i })).sort((a, b) => ((a.p.z || 0) - (b.p.z || 0)) || (a.i - b.i)).map((o) => o.p);

    const seen = new Set();
    const desired = [];
    let created = 0;
    let updated = 0;
    const animCount = { enter: 0, exit: 0, move: 0, flash: 0, dim: 0 };
    const prev = rec.byKey;

    for (const p of ordered) {
      const key = p.key || ('k' + seen.size);
      const dup = seen.has(key);
      seen.add(key);
      const box = p.kind === 'chip' ? chipBox(p, P) : (primBox(p, P) || { w: 0, h: 0 });
      const old = dup ? null : prev.get(key);   // 同帧重名的图元不复用元素（否则两个图元会抢同一个 <g>）
      const el = upsertPrim(doc, old && old.el, p, box);
      if (!old) { if (!dup && !hasChild(rec.group, el)) rec.group.appendChild(el); created += 1; }
      else updated += 1;
      desired.push(el);
      clearAnim(el);

      // 语义差分 → 动画类
      let kind = null;
      if (!old) kind = 'enter';
      else {
        const prevText = old.text != null ? String(old.text) : '';
        const nowText = p.text != null ? String(p.text) : '';
        const moved = Math.abs(old.x - (p.kind === 'circle' ? p.cx : p.x)) > 0.5 || Math.abs(old.y - (p.kind === 'circle' ? p.cy : p.y)) > 0.5;
        if (prevText !== nowText && nowText) kind = 'flash';
        else if (moved) kind = 'move';
        else if ((p.opacity != null && p.opacity < 1)) kind = 'dim';
      }
      if (!kind && p.opacity != null && p.opacity < 1) kind = 'dim';
      if (motion && kind) { applyAnim(el, kind); if (animCount[kind] != null) animCount[kind] += 1; }
      if (!dup) prev.set(key, { el, x: p.kind === 'circle' ? p.cx : p.x, y: p.kind === 'circle' ? p.cy : p.y, text: p.text });
    }

    /* Z 序 = DOM 文档顺序。复用元素时它还在上一帧的位置，层级会随"谁先创建"漂移，
       表现为遮挡错误 + 元素顺序与图元顺序不一致（也就没法按序号做数据↔DOM 比对）。
       顺序真的变了才重建；没变就一个字都不动（避免白白重启 CSS 动画）。 */
    const cur = listChildren(rec.group);
    const sameOrder = cur.length === desired.length && desired.every((el, i) => cur[i] === el);
    if (!sameOrder) {
      for (const el of cur) if (el.parentNode === rec.group) rec.group.removeChild(el);
      for (const el of desired) rec.group.appendChild(el);
    }

    // 消失的图元：留一帧（让 avc-exit 播完），下一帧开头统一删
    let removed = 0;
    for (const [key, old] of [...prev.entries()]) {
      if (seen.has(key)) { continue; }
      if (keepExit && motion && old.el && !old.el.__avcExiting) {
        old.el.__avcExiting = true;
        applyAnim(old.el, 'exit');
        // 即使 anim.css 没加载/被缓存挡住，也不许留下可见的残留元素（直接置 0 透明度）
        try { if (old.el.style) old.el.style.opacity = '0'; } catch (e) { void e; }
        animCount.exit += 1;
        /* 兜底清理：即使这一层之后不再重绘（或 prev 被重建），动画结束后也必须真正删掉。
           否则"上一帧的线"会留在画布上——看起来就是一根错位的线。 */
        const el = old.el;
        const timer = setTimeout(() => {
          if (el && el.parentNode) el.parentNode.removeChild(el);
          const cur = prev.get(key);
          if (cur && cur.el === el) prev.delete(key);
        }, 260);
        if (timer && typeof timer.unref === 'function') timer.unref();
        continue;
      }
      if (old.el && old.el.parentNode) old.el.parentNode.removeChild(old.el);
      prev.delete(key);
      removed += 1;
    }

    /* 双保险：DOM 里有、本帧却不存在、且已不在 exit 过程中的元素，直接扫掉。
       任何残留都会表现成"一根错位的线"，宁可每帧多扫一遍。 */
    for (const node of [...(rec.group.childNodes || [])]) {
      const k = node && node.getAttribute ? node.getAttribute('data-avc-key') : null;
      if (!k || seen.has(k)) continue;
      if (node.__avcExiting) continue;
      if (node.parentNode) node.parentNode.removeChild(node);
      prev.delete(k);
    }

    /* ?debug=1：把本帧每个 DOM 元素（键名/类型/几何）打到控制台，并给 SVG 元素描虚线框。
       截图/控制台输出就能直接指认"那根多余的线"到底是哪个 key —— 不用再猜。 */
    try {
      if (doc && doc.body && doc.body.classList && doc.body.classList.contains('is-debug')) {
        const rows = [...prev.entries()].map(([k, v]) => ({
          key: k,
          kind: v.el && v.el.getAttribute ? v.el.getAttribute('data-avc-kind') : '?',
          anim: v.el && v.el.getAttribute ? (v.el.getAttribute('data-avc-anim') || '-') : '-',
          transform: v.el && v.el.style ? v.el.style.transform : '?',
          opacity: v.el && v.el.style ? (v.el.style.opacity || '1') : '1',
          inFrame: seen.has(k),
        }));
        if (console && console.table) console.table(rows);
      }
    } catch (e) { void e; }
    // primsList 用 **已按 z 排序的 ordered**：它的顺序就是 DOM 里追加元素的顺序，
    // 测试可以用它逐个对齐 DOM 元素做"数据 ↔ DOM 等价"比对。
    return { prims: prims.length, primsList: ordered, created, updated, removed, animCount };
  }

  /**
   * 渲染一层或多层
   * @param {Array} layers
   * @param {{prevLayers?:Array,t?:number,bg?:string,animate?:boolean}} opt
   */
  function render(layers, opt = {}) {
    const list = (layers || []).filter(Boolean);
    syncCards(list);
    resize();
    let prims = 0;
    let created = 0;
    let updated = 0;
    let removed = 0;
    const styles = [];
    const allPrims = [];
    const anim = { enter: 0, exit: 0, move: 0, flash: 0, dim: 0 };

    for (const [id, rec] of cards.entries()) {
      const to = list.find((l) => (l.id || '') === id) || null;
      if (!to) continue;
      styles.push(to.style);
      try {
        const acc = { prims: 0, created: 0, updated: 0, removed: 0, animCount: { enter: 0, exit: 0, move: 0, flash: 0, dim: 0 } };
        const add = (r) => { acc.prims = r.prims; acc.created += r.created; acc.updated += r.updated; acc.removed += r.removed; for (const k of Object.keys(acc.animCount)) acc.animCount[k] += r.animCount[k] || 0; };
        const P = profileOf(to.style).policy;
        const w = measure(rec).w;

        /* 高度自适应：**只用"探针布局"决定终高，然后只画一次**。
           ① 不能"按当前高度量 → 想变高 → 再量"：栈/堆格高是 (rect.h-90)/cap，会每按一次 +14px（棘轮）
           ② 也不能"画完发现装不下再重画"：重画会把这一帧的 enter/flash 全冲成 move（动画错乱）
           所以：探针 300 → 得 want → 再探针 want 验证装得下 → 定稿 → 一次绘制。 */
        let want = to.props?.canvasHeight;
        if (Number.isFinite(want)) {
          want = Math.max(CARD_MIN_HEIGHT, Math.ceil(want));
        } else {
          const probeBottom = contentBottom(probePrims(to, { x: 0, y: 0, w, h: CARD_CANVAS_HEIGHT }), P);
          want = Math.min(CARD_CANVAS_HEIGHT, Math.max(CARD_MIN_HEIGHT, Math.ceil(probeBottom + 14)));
          if (Math.abs(want - CARD_CANVAS_HEIGHT) <= 12) want = CARD_CANVAS_HEIGHT;
          if (want !== CARD_CANVAS_HEIGHT) {
            const fitBottom = contentBottom(probePrims(to, { x: 0, y: 0, w, h: want }), P);
            if (fitBottom + 2 > want) want = CARD_CANVAS_HEIGHT;
          }
        }
        if (Math.abs(want - rec.height) >= 20) { rec.height = want; resize(); }
        const rect = { x: 0, y: 0, w, h: rec.height };
        const r = paintLayer(rec, to, rect, opt); add(r);
        if (r.primsList) for (const p of r.primsList) allPrims.push(p);
        prims += acc.prims;
        created += acc.created;
        updated += acc.updated;
        removed += acc.removed;
        for (const k of Object.keys(anim)) anim[k] += acc.animCount[k] || 0;
      } catch (e) {
        if (globalThis.__AVC_DEBUG) console.error('[paint] 渲染失败 style=' + to.style + ' : ' + e.message + '\n' + String(e.stack || '').split('\n').slice(0, 6).join('\n'));
        const t = doc.createElementNS(SVG_NS, 'text');
        t.setAttribute('x', '16');
        t.setAttribute('y', '28');
        t.setAttribute('fill', '#a92e35');
        t.setAttribute('font-size', '13');
        t.textContent = '渲染失败：' + e.message;
        rec.group.appendChild(t);
      }
    }
    lastMetrics = { cards: cards.size, prims, styles, created, updated, removed, anim, primsList: allPrims };
    return lastMetrics;
  }

  /** 只取图元（用于量内容高度），不落 DOM */
  function probePrims(layer, rect) {
    try {
      const res = dispatch(layer.style).instance.layout(layer, rect, { bg: '#ffffff' });
      const prims = res.prims || [];
      polishLayout(prims, rect, layer.style, layer);
      return prims;
    } catch { return []; }
  }

  function clear() {
    for (const rec of cards.values()) rec.card.remove();
    cards = new Map();
    lastMetrics = { cards: 0, prims: 0, styles: [], created: 0, updated: 0, removed: 0, anim: {} };
  }

  /* 只读诊断：控制台执行 __avcReport() 就能拿到每张卡的真实尺寸
     （排查"高度棘轮"一举定案，不靠猜：看 height 是否在涨、lastW 是否在变、elements 是否在涨） */
  try {
    globalThis.__avcReport = () => ({
      mode: 'svg',
      cards: [...cards.entries()].map(([id, rec]) => {
        const hd = rec.card && rec.card.querySelector ? rec.card.querySelector('header') : null;
        return {
          id,
          stageW: host && host.clientWidth,
          lastW: rec.lastW,
          height: rec.height,
          svgCssH: rec.svg && rec.svg.style && rec.svg.style.height,
          viewBox: rec.svg && rec.svg.getAttribute && rec.svg.getAttribute('viewBox'),
          elements: rec.byKey.size,
          headerSize: hd && hd.getAttribute ? hd.getAttribute('data-size') : null,
        };
      }),
    });
  } catch (e) { void e; }

  return {
    render,
    clear,
    resize,
    metrics: () => lastMetrics,
    cardCount: () => cards.size,
    host,
    /** 测试/调试用：某层当前的元素数与动画类分布 */
    snapshot: (id) => {
      const rec = cards.get(id);
      if (!rec) return null;
      const els = [...rec.byKey.values()].map((v) => v.el);
      const counts = { enter: 0, exit: 0, move: 0, flash: 0, dim: 0 };
      for (const el of els) {
        const a = el.getAttribute && el.getAttribute('data-avc-anim');
        if (a && counts[a] != null) counts[a] += 1;
      }
      return { elements: els.length, anim: counts, height: rec.height, viewBox: rec.svg.getAttribute('viewBox') };
    },
  };
}
