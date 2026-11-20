/**
 * canvas-stage.js -- **完全对齐 06（add01）的画布模型**
 *
 * 06 的做法（`add01/src/app/viewer.js` L238-299）：
 *   · `buildStage()`：**每个 layer 一张 `.canvas-card` + 一张 `<canvas>`**，卡头写 `标题 + 渲染器类名 · style`
 *   · `resizeCanvases()`：`cv.width = max(320, rect.width*dpr)`、`cv.height = max(180, rect.height*dpr)`，
 *      并 `ctx.setTransform(dpr,0,0,dpr,0,0)`
 *   · `paintCanvas()`：每帧对每张画布调 `drawTween(ctx, rect, fromLayer, toLayer, t, {bg:'#ffffff'})`
 *      （`t>=1` 时就是静态整帧）
 *   · CSS：`.canvas-card canvas { width:100%; height:300px }`，卡片纵向 `grid` 排列
 *
 * 为什么必须这样：add01 的每个渲染器都把**传入的整块 rect 当作自己的画布**（`name` 画在 rect.x+16、
 * `fitRow` 里 y0 = rect.y+40）。把多层叠进同一张画布 = 多个"占满画布"的场景画在同一位置 → 必然互相压
 * （实测：54 案例里有 632/972 步是多层，最多 3 层）。
 *
 * 本文件是 add01 原绘制路径的搬运：`layer → 一张卡`，绘制走 `drawTween`，不做任何二次加工。
 */

import { drawTween } from '../vendor/engine/player.js';
import { dispatch } from '../vendor/engine/dispatch.js';
import { paint2D, clearAll } from '../vendor/engine/prims.js';
import { RENDERERS } from '../vendor/catalog/datastructures.js';

export const CARD_CANVAS_HEIGHT = 300;   // 上限（内容多时用满）
export const CARD_MIN_HEIGHT = 130;     // 内容少时收缩到这个高度      // 与 06 的 `.canvas-card canvas{height:300px}` 一致

/** 卡片副标题：06 的 layerHint（格数 / 结点数） */
export function layerHint(layer) {
  const d = (layer && layer.data) || {};
  if (Array.isArray(d.values)) {
    return Array.isArray(d.values[0]) ? ` · ${d.values.length}×${d.values[0].length}` : ` · ${d.values.length} 格`;
  }
  if (Array.isArray(d.cells)) return ` · ${d.cells.length} 格`;
  if (Array.isArray(d.nodes)) return ` · ${d.nodes.length} 结点`;
  return '';
}

import { classify, profileOf, primBox } from './layout-policy.js';
import { passMark, passTidy, passHeader, passFloat, passBadge, passThread } from './polish-passes.js';

const PASSES = { mark: passMark, tidy: passTidy, header: passHeader, float: passFloat, badge: passBadge };
const UNKNOWN_PASSES = profileOf(-1).passes;   // 未注册 style 的默认：只做 float

/**
 * polishLayout -- 画布内坐标后处理入口（角色驱动，见 layout-policy.js / polish-passes.js）
 *
 * 每个 style 走哪些 pass 由 `profileOf(style).passes` 声明（纯数据）：
 *   mark   标注框贴格 + 标注文字下移      （一维数组 / 堆 这类"格 + 区间框"的渲染器）
 *   tidy   按层整理结点 + 重算边/标签/徽标（树、森林、B 树…）
 *   header 轴标签让位 + 内容整体下移       （标题行会压到气泡的渲染器）
 *   float  浮动标注摆位 + 重锚指示线       （**所有**渲染器都适用，也是未知 style 的默认）
 *
 * 没有注册过 profile 的新 style 会拿到默认策略（只做 float），所以新的"结构 × 算法"组合
 * 只要键名符合 ROLES 约定就自动生效；命名不同则 registerProfile(style, {...})，不改代码。
 *
 * 第三个来源（**正式接口**，优先于键名约定）：
 *   · 图元上带 `meta: { role, id, target, anchor, priority }`
 *   · 或者算法层直接声明 `layer.annotations = [{ id, kind, target, text, anchor, priority }]`
 *     （渲染器没画就由 `synthesizeAnnotations()` 补成气泡）
 *
 * @param {Array} prims
 * @param {{x:number,y:number,w:number,h:number}} rect
 * @param {number} [style]
 * @param {object} [layer] 该层数据（有 annotations 时会补图元）
 */
export function polishLayout(prims, rect, style, layer) {
  const c = classify(prims, rect, style, layer);
  const passes = c.profile.passes || (UNKNOWN_PASSES);
  for (const name of passes) {
    const fn = PASSES[name];
    if (fn) fn(c, rect, layer);
  }
  /* 全风格通用的一条几何不变量：**线索虚线不许压在树边实线上**。
     放在所有 profile pass 之后，量的就是最终几何；没有 `th-*` 时它立刻返回（零成本）。 */
  passThread(c, rect);
  // `layer.annotations` 声明、渲染器却没画的标注，classify 已经补进 c.list；
  // 这里同步回调用方数组（幂等：靠 meta.id 去重），调用方拿到的就是最终图元。
  if (Array.isArray(prims)) for (const p of c.list) if (!prims.includes(p)) prims.push(p);
  return c.list;
}

/** 兼容入口：树整理（tree-audit 直接调用） */
export function polishTreeCanvas(prims, rect, style = 9) {
  // 直接复用正式入口，保证审计与页面走的是**同一条** pass 链（style 9 的 profile）
  return polishLayout(prims, rect, style);
}

/** 兼容入口：一维数组系（mark + header + float） */
export function polishArrayLayout(prims, rect, style = 1) {
  const c = classify(prims, rect, style);
  passMark(c, rect);
  passHeader(c, rect);
  passFloat(c, rect);
  return c.list;
}

/** 兼容入口：只摆浮动标注（图 / 栈 / 堆） */
export function relocateFloatingChips(prims, rect, style = 10) {
  const c = classify(prims, rect, style);
  passFloat(c, rect);
  return c.list;
}


/**
 * drawFrame -- 一层的绘制入口
 *
 * 与 06 的 `drawTween(ctx, rect, from, to, t, env)` **同一套底层**
 * （`dispatch(style).instance.layout()` + 06 的 `paint2D()`），只多一步：
 * 静态帧（t>=1，本项目实际只画静态帧）先过 `polishLayout()` 微调坐标；
 * 需要补间（t<1）时直接交给 06 的 `drawTween`，行为与 06 完全一致。
 */
export function drawFrame(ctx, rect, fromLayer, toLayer, t, env = {}) {
  const tt = t == null ? 1 : t;
  if (fromLayer && tt < 1) return drawTween(ctx, rect, fromLayer, toLayer, tt, env);
  clearAll(ctx, rect, env.bg || '#ffffff');
  if (!toLayer) return { prims: [], nodes: new Map() };
  const res = dispatch(toLayer.style).instance.layout(toLayer, rect, env);
  const prims = polishLayout(res.prims, rect, toLayer.style, toLayer);
  paint2D(ctx, prims);
  return { prims, nodes: res.nodes || new Map() };
}

export function createStage(host) {
  let cards = new Map();        // layerId -> { card, canvas, ctx, id }
  let lastMetrics = { cards: 0, prims: 0, styles: [], hidden: 0, raised: 0 };

  function makeCard(layer, index) {
    const card = document.createElement('div');
    card.className = 'canvas-card' + (index === 0 ? ' main' : '');
    card.dataset.layer = layer.id;

    const header = document.createElement('header');
    const b = document.createElement('b');
    b.textContent = layer.title || layer.id || ('layer' + index);
    const span = document.createElement('span');
    span.textContent = (RENDERERS[layer.style]?.cls || '') + ' · style ' + layer.style + layerHint(layer);
    header.appendChild(b);
    header.appendChild(span);
    card.appendChild(header);

    const canvas = document.createElement('canvas');
    canvas.dataset.canvas = layer.id;
    canvas.style.width = '100%';
    canvas.style.height = CARD_CANVAS_HEIGHT + 'px';
    card.appendChild(canvas);
    host.appendChild(card);

    return { card, canvas, ctx: canvas.getContext('2d'), id: layer.id };
  }

  /** 按层列表对齐卡片（同 id 复用，多了删、少了建）——等价 06 的 buildStage */
  function syncCards(layers) {
    const ids = (layers || []).map((l, i) => l.id || ('layer' + i));
    for (const [id, rec] of [...cards.entries()]) {
      if (!ids.includes(id)) { rec.card.remove(); cards.delete(id); }
    }
    (layers || []).forEach((layer, i) => {
      const id = ids[i];
      if (!cards.has(id)) cards.set(id, makeCard(layer, i));
      const rec = cards.get(id);
      // 卡头信息随层数据更新（结点的增删会改变 hint）
      const span = rec.card.querySelector('header span');
      if (span) span.textContent = (RENDERERS[layer.style]?.cls || '') + ' · style ' + layer.style + layerHint(layer);
    });
  }

  /** 06 的 resizeCanvases：宽度跟容器、高度按卡片当前 CSS 高度（再按 dpr 放大） */
  function sizeOne(canvas, ctx) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    const cssH = parseFloat(canvas.style.height) || CARD_CANVAS_HEIGHT;
    canvas.width = Math.max(320, Math.round((r.width || host.clientWidth || 800) * dpr));
    canvas.height = Math.max(120, Math.round(cssH * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function resize() {
    for (const { canvas, ctx } of cards.values()) sizeOne(canvas, ctx);
  }

/** 在固定高度上量"内容下边界"（不落画布，只布局） */
  function measureAt(layer, w, h) {
    try {
      const rect = { x: 0, y: 0, w, h };
      const res = dispatch(layer.style).instance.layout(layer, rect, { bg: '#ffffff' });
      const prims = polishLayout(res.prims || [], rect, layer.style, layer);
      return contentBottom(prims);
    } catch { return 0; }
  }
  /** 图元内容的下边界（用来把"只有两格却有 300px 空卡"收短） */
  function contentBottom(prims) {
    let bottom = 0;
    for (const p of prims || []) {
      const b = primBox(p);
      if (b) bottom = Math.max(bottom, b.y + b.h);
    }
    return bottom;
  }

  /**
   * 渲染一层或多层（每层画到自己那张卡里）
   *
   * 卡片高度**跟着内容走**：先按当前高度画一帧，量出内容下边界；
   * 差得多就把这张卡改高再画一次（装不下就退回 300）。否则像 style 8 的
   * "2 个格子"会占满 300px、底下留一大片空白（截图里就是这个观感问题）。
   *
   * @param {Array} layers
   * @param {{prevLayers?:Array, t?:number, bg?:string}} opt
   */
  function render(layers, opt = {}) {
    const list = (layers || []).filter(Boolean);
    syncCards(list);
    resize();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let prims = 0;
    const styles = [];
    const drawIn = (rec, from, to) => {
      const rect = { x: 0, y: 0, w: rec.canvas.width / dpr, h: rec.canvas.height / dpr };
      if (opt.t != null && opt.t < 1) return drawFrame(rec.ctx, rect, from, to, opt.t, { bg: opt.bg || '#ffffff' });
      return drawFrame(rec.ctx, rect, from, to, 1, { bg: opt.bg || '#ffffff' });
    };
    for (const [id, rec] of cards.entries()) {
      const to = list.find((l) => (l.id || '') === id) || null;
      if (!to) continue;
      const from = (opt.prevLayers || []).find((l) => (l.id || '') === id) || null;
      styles.push(to.style);
      try {
        const curH = parseFloat(rec.canvas.style.height) || CARD_CANVAS_HEIGHT;
        /* 高度自适应：**先在固定探针高度上量一次**再决定终高。
           栈/堆的格高是 (rect.h-90)/cap——"按当前高度量 → 想变高 → 再量"会每按一次 +14px（棘轮）。 */
        const probeBottom = measureAt(to, rec.canvas.width / dpr, CARD_CANVAS_HEIGHT);
        let want = Math.min(CARD_CANVAS_HEIGHT, Math.max(CARD_MIN_HEIGHT, Math.ceil(probeBottom + 14)));
        if (Math.abs(want - CARD_CANVAS_HEIGHT) <= 12) want = CARD_CANVAS_HEIGHT;
        if (want !== curH) {
          rec.canvas.style.height = want + 'px';
          sizeOne(rec.canvas, rec.ctx);
        }
        let res = drawIn(rec, from, to);
        if (want !== CARD_CANVAS_HEIGHT) {
          const bottom = contentBottom(res && res.prims);
          if (bottom + 6 > want) {                           // 换高度后装不下（层距会变）→ 退回满高
            rec.canvas.style.height = CARD_CANVAS_HEIGHT + 'px';
            sizeOne(rec.canvas, rec.ctx);
            res = drawIn(rec, from, to);
            want = CARD_CANVAS_HEIGHT;
          }
        }
        prims += (res && res.prims ? res.prims.length : 0);
      } catch (e) {
        rec.ctx.fillStyle = '#a92e35';
        rec.ctx.font = '13px system-ui';
        rec.ctx.fillText('渲染失败：' + e.message, 16, 28);
      }
    }
    lastMetrics = { cards: cards.size, prims, styles, hidden: 0, raised: 0 };
    return lastMetrics;
  }

  function clear() {
    for (const rec of cards.values()) { rec.card.remove(); }
    cards = new Map();
    lastMetrics = { cards: 0, prims: 0, styles: [], hidden: 0, raised: 0 };
  }

  /* 相机：06 没有缩放，这里保留一个可选的整体缩放（默认 1，不影响对齐） */
  const cam = { k: 1 };
  function resetCam() { cam.k = 1; }
  function zoomAt(factor) { cam.k = Math.max(0.5, Math.min(3, cam.k * factor)); }

  return {
    render,
    clear,
    resize,
    resetCam,
    zoomAt,
    metrics: () => lastMetrics,
    cardCount: () => cards.size,
    host,
  };
}
