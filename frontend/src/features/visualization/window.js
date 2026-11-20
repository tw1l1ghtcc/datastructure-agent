/**
 * 成员03可视化窗口，从PR #14的dev-viz-window.js恢复并接入正式工作台。
 */

import { dAlgorithm } from '../workbench/d-algorithms.js';
import { createDAnimation } from './d-animation.js';
import { gAlgorithm } from '../workbench/g-algorithms.js';
import { createGAnimation } from './g-animation.js';
import { eAlgorithm } from '../workbench/e-algorithms.js';
import { createEAnimation } from './e-animation.js';
import { fAlgorithm } from '../workbench/f-algorithms.js';
import { createFAnimation } from './f-animation.js';
import { cAlgorithm } from '../workbench/c-algorithms.js';
import { createCAnimation } from './c-animation.js';
import { createVisualization } from './index.js';
import { arraySearch } from '../workbench/array-search.js';
import { graphAlgorithm } from '../workbench/graph-algorithms.js';
import { createBAnimation } from './b-animation.js';
import { isASort } from './a-sort-state.js';
import { createASortVisualization } from './a-sort-view.js';
import { buildPrototypeArrayFrame } from './prototype-array.js';
import { createPlusView, plusCase, isPlus } from './ext/plus-bridge.js';

const SORT_ALGORITHMS = ['bubble-sort', 'insertion-sort', 'binary-insertion-sort', 'shell-sort', 'selection-sort', 'quick-sort', 'heap-sort', 'merge-sort'];

const TEMPLATE = `
<div class="win-bar">
  <span class="win-dot" aria-hidden="true"></span>
  <span class="win-title">执行过程</span>
  <span class="win-sub">二分查找 · 闭区间 · 数组视图</span>
  <span class="win-actions">
    <button class="win-action" type="button" data-viz-full aria-pressed="false" title="铺满整个屏幕（Esc 退出）">全屏</button>
  </span>
</div>
<div class="win-body-viz">
  <section class="viewport" aria-label="可视化演示">
    <div class="viewport-head">
      <span class="vh-title">数组视图</span>
      <span class="vh-sub">二分查找 · 闭区间</span>
      <span class="vh-actions">
        <button class="bl-btn" type="button" data-viz-view-reset title="复位视图（Home）">复位视图</button>
        <button class="bl-btn" type="button" data-viz-replay>重播入场动效</button>
      </span>
    </div>
    <div class="viewport-body" data-viz-body tabindex="0" aria-label="数组视口，拖拽平移，按住 Ctrl 滚动缩放，Home自适应取景">
      <div class="viewport-scene" data-viz-scene></div>
    </div>
    <div data-explain-host aria-label="本步解释"></div>
    <div class="viewport-legend" aria-label="指针图例"><span><b class="legend-left">L</b> 左边界</span><span><b class="legend-right">R</b> 右边界</span><span><b class="legend-mid">M</b> 比较位置</span><span>淡色：已排除</span></div>
    <div class="viewport-warn" data-viz-warn hidden></div>
    <div class="viewport-hint">拖拽平移 · Ctrl + 滚轮缩放 · Home 复位</div>
  </section>

  <section class="timeline" aria-label="播放控制">
    <div class="tl-transport" data-tl-transport>
        <button class="tl-btn" type="button" id="resetBtn" data-t="reset" title="跳到开始并停止（重置）" aria-label="重置">
          <svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="2.5" width="1.6" height="9"/><path d="M11 2.5 5.2 7 11 11.5z"/></svg>
        </button>
        <button class="tl-btn" type="button" id="prevBtn" data-t="prev" title="上一步（恢复上一个快照）" aria-label="上一步">
          <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M9.5 2.5 4 7l5.5 4.5z"/></svg>
        </button>
        <button class="tl-btn" type="button" id="playBtn" data-t="play" title="播放" aria-label="播放"><span data-play-label class="viz-sr-only">播放</span>
          <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3.5 2.5 10.5 7 3.5 11.5z"/></svg>
        </button>
        <button class="tl-btn" type="button" id="nextBtn" data-t="next" title="下一步" aria-label="下一步">
          <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5 8.4 7 2.5 11.5z"/></svg>
        </button>
        <button class="tl-btn" type="button" data-t="last" title="跳到结束" aria-label="跳到结束">
          <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1 2.5 6.8 7 1 11.5z"/><rect x="8.4" y="2.5" width="1.6" height="9"/></svg>
        </button>
      </div>
    <div class="tl-ruler" data-tl-ruler tabindex="0" role="slider"
         aria-label="步骤时间轴：点击、拖动或按左右方向键跳到某一步"
         aria-valuemin="1" aria-valuemax="1" aria-valuenow="1">
      <div class="tl-ticks" data-tl-ticks></div>
      <div class="tl-playhead" data-tl-playhead aria-hidden="true"></div>
    </div>
  </section>
</div>
`;

export function createVizWindow(host, {
  run = null,
  algorithm = run?.algorithm ?? 'binary-search',
  onSeek = null,
  onTransport = null
} = {}) {
  if (!host) throw new Error('createVizWindow 需要一个容器');

  const root = document.createElement('section');
  root.className = 'win vizwin';
  root.dataset.win = 'viz';
  const c = cAlgorithm(algorithm);
  const f = fAlgorithm(algorithm);
  const g = gAlgorithm(algorithm);
  const e = eAlgorithm(algorithm);
  const d = dAlgorithm(algorithm);
  const traceView = e ?? f ?? g ?? c ?? d;
  const unionFind = algorithm === 'union-find';
  /* 合并（PR #66 §1）：主分支把"排序"扩成 8 种，我们的 plus 示例也要用同一套窗口 */
  const sorting = SORT_ALGORITHMS.includes(algorithm);
  const plusId = isPlus(algorithm) ? algorithm : null;

  /** 自定义代码的标题与图例：按本次 run 的真实形态（数组 / 结构）说人话 */
  function applyCustomChrome(current) {
    const structured = Boolean(current && current.structure === 'structure');
    root.querySelector('.win-sub').textContent = structured ? '自定义代码 · 结构视图' : '自定义代码 · 数组视图';
    root.querySelector('.vh-sub').textContent = '按实际执行记录播放';
    const legend = root.querySelector('.viewport-legend');
    legend.hidden = false;
    legend.setAttribute('aria-label', structured ? '结构图例' : '数组写入图例');
    legend.innerHTML = structured
      ? '<span><b class="legend-right">橙</b> 药丸＝指针变量现在指哪个结点</span>'
      : '<span><b class="legend-mid">蓝</b> 药丸＝本行游标（i / j …）</span><span><b class="legend-right">橙</b> 本步写入的格子</span>';
  }
  const custom = algorithm === 'custom-array';
  const graph = graphAlgorithm(algorithm);
  const search = arraySearch(algorithm);
  const useLegacy = !traceView && !unionFind && !search && !graph && !sorting && !custom && new URLSearchParams(window.location.search).get('viz') === 'legacy';
  root.innerHTML = TEMPLATE;
  if (graph || unionFind) root.dataset.graphView = unionFind || algorithm === 'floyd' ? 'table' : 'graph';
  if (traceView) {
    root.dataset.traceAnimation = 'true';
    root.dataset.tableView = 'true';
    root.querySelector('.win-sub').textContent = traceView.title + ' · 执行过程';
    root.querySelector('.vh-title').textContent = '动画与状态';
    root.querySelector('.vh-sub').textContent = traceView.title;
    root.querySelector('.viewport-legend').hidden = true;
    root.querySelector('[data-viz-body]').setAttribute('aria-label', '结构动画和执行状态，可滚动查看');
    root.querySelector('[data-viz-view-reset]').hidden = true;
    root.querySelector('.viewport-hint').hidden = true;
  }
  if (unionFind) {
    root.querySelector('.win-sub').textContent = '并查集 · 父指针森林';
    root.querySelector('.vh-title').textContent = '森林与父节点表';
    root.querySelector('.vh-sub').textContent = '按步骤更新';
    root.querySelector('.viewport-legend').hidden = true;
  }
  if (graph) {
    root.querySelector('.win-sub').textContent = graph.name + ' · 图视图';
    root.querySelector('.vh-title').textContent = '图结构';
    root.querySelector('.vh-sub').textContent = graph.title;
    root.querySelector('[data-viz-body]').setAttribute('aria-label', '图视口，拖拽平移，按住 Ctrl 滚动缩放，Home自适应取景');
    root.querySelector('.viewport-legend').hidden = true;
  }
  
  if (search) {
    root.querySelector('.win-sub').textContent = search.title + ' · 数组视图';
    root.querySelector('.vh-sub').textContent = search.title;
    const legend = root.querySelector('.viewport-legend');
    legend.setAttribute('aria-label', '查找图例');
    legend.innerHTML = '<span><b class="legend-right">橙</b> 当前比较</span><span><b class="legend-mid">绿</b> 命中</span>';
  }
  
  if (sorting) {
    const sortNames = {
      'bubble-sort': '冒泡排序', 'insertion-sort': '直接插入排序', 'binary-insertion-sort': '折半插入排序', 'shell-sort': '希尔排序', 
      'selection-sort': '简单选择排序', 'quick-sort': '快速排序', 'heap-sort': '堆排序', 'merge-sort': '归并排序'
    };
    const sortName = sortNames[algorithm] || '排序';
    const sortView = algorithm === 'heap-sort' ? '数组与堆树' : algorithm === 'merge-sort' ? '数组与临时区' : '数组视图';
    root.querySelector('.win-sub').textContent = sortName + ' · ' + sortView;
    root.querySelector('.vh-title').textContent = sortView;
    root.querySelector('.vh-sub').textContent = `${sortName} · 升序`;
    const legend = root.querySelector('.viewport-legend');
    legend.setAttribute('aria-label', '排序图例');
    legend.innerHTML = '<span><b class="legend-mid">绿</b> 已就位/最终位置</span><span><b class="legend-right">橙</b> 比较/操作</span>';
  }
  
  if (custom) {
    /* 自定义代码可能是数组，也可能是链表/树/图/矩阵（run.structure 由后端折叠结果决定）。
       窗口是页面初始化时建的（那时还没有 run），所以先按"数组"占位，
       run 到了再由 bindRun 里的 applyCustomChrome 按真实形态重挂。 */
    applyCustomChrome(run);
  }
  // plus01&02 示例：标题别再显示"二分查找 · 数组视图"（B 树/图/栈那些根本不是数组）
  if (isPlus(algorithm)) {
    const plusItem = plusCase(algorithm);
    root.querySelector('.win-sub').textContent = (plusItem ? plusItem.pkgName : '示例库') + ' · ' + (plusItem ? plusItem.title : '示例');
    root.querySelector('.vh-title').textContent = '示例视图';
    root.querySelector('.vh-sub').textContent = plusItem ? plusItem.title : '';
  }
  host.append(root);

  if (!document.querySelector('.vizwin[data-full="true"]')) {
    document.body.classList.remove('is-viz-full');
  }

  const $ = (selector) => root.querySelector(selector);
  const vizHost = $('[data-viz-scene]');
  const explainHost = $('[data-explain-host]');
  const body = $('[data-viz-body]');
  const scene = $('[data-viz-scene]');
  const warn = $('[data-viz-warn]');
  const tickHost = $('[data-tl-ticks]');
  const playhead = $('[data-tl-playhead]');
  const ruler = $('[data-tl-ruler]');
  const transport = $('[data-tl-transport]');

  const view = { x: 0, y: 0, scale: 1, min: 0.01, maxFit: 3, max: 6 };
  let destroyed = false, fitFrame = null;
  const queueFit = () => {
    if (destroyed) return;
    if (fitFrame !== null) cancelAnimationFrame(fitFrame);
    fitFrame = requestAnimationFrame(() => { fitFrame = null; if (!destroyed) fitView(); });
  };
  let viz = null;
  let currentRun = run;
  let state = { stepIndex: 0, total: 0, playing: false, canPrev: false, canNext: false };

  function applyView() {
    scene.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
  }

  function warnIfCanvasTiny() {
    const w = Math.round(body.clientWidth);
    const h = Math.round(body.clientHeight);
    const tiny = w < 240 || h < 170;
    warn.hidden = !tiny;
    if (tiny) warn.textContent = graph ? '可视区较小，可以点「全屏」放大查看。' : `可视区只有 ${w}×${h}px，数组会被压得很小：可以点「全屏」放大查看。`;
  }

  function fitView() {
    /* 合并（PR #66 §1）：主分支的可滚动树表不取景；plus 结构族卡片也不取景（各管各的 return） */
    if (traceView) return;
    /* plus01&02 的**结构族**示例是"文档流卡片"（每层一张卡），本来就按容器宽度排好版，
       不能被视口的自动取景缩放：否则上一轮的 scale 会被继承/反复相乘，
       卡越走越小、最后看不见。这里对结构族 plus 运行只把视图复位成 1:1。
       数组族 plus 仍然走本项目的数组链路，照旧自动取景。 */
    if (currentRun && currentRun.plus && currentRun.structure !== 'array') {
      view.scale = 1; view.x = 0; view.y = 0;
      applyView();
      warnIfCanvasTiny();
      return;
    }
    const cw = body.clientWidth || 1;
    const ch = body.clientHeight || 1;
    const sw = scene.offsetWidth || 1;
    const sh = scene.offsetHeight || 1;
    const fit = Math.min(cw / sw, ch / sh) * 0.92;
    view.scale = Math.min(view.maxFit, Math.max(view.min, fit));
    view.x = 0;
    view.y = 0;
    applyView();
    warnIfCanvasTiny();
  }

  let panning = false;
  let panStart = { x: 0, y: 0 };
  body.addEventListener('pointerdown', (event) => {
    if (traceView || event.button !== 0 || event.target.closest?.('button, select, input, .bsviz-explain, .b-animation-data')) return;
    body.focus({preventScroll:true});
    panning = true;
    panStart = { x: event.clientX - view.x, y: event.clientY - view.y };
    body.classList.add('is-panning');
    body.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });
  body.addEventListener('pointermove', (event) => {
    if (!panning) return;
    view.x = event.clientX - panStart.x;
    view.y = event.clientY - panStart.y;
    applyView();
  });
  const stopPan = () => { panning = false; body.classList.remove('is-panning'); };
  body.addEventListener('pointerup', stopPan);
  body.addEventListener('pointercancel', stopPan);
  body.addEventListener('wheel', (event) => {
    if (traceView || !event.ctrlKey || event.deltaY === 0) return;
    event.preventDefault();
    const rect = body.getBoundingClientRect();
    const cx = event.clientX - rect.left - rect.width / 2;
    const cy = event.clientY - rect.top - rect.height / 2;
    const next = Math.min(view.max, Math.max(view.min, view.scale * (event.deltaY < 0 ? 1.12 : 1 / 1.12)));
    const k = next / view.scale;
    view.x = cx - (cx - view.x) * k;
    view.y = cy - (cy - view.y) * k;
    view.scale = next;
    applyView();
  }, { passive: false });

  const onHomeKey = (event) => {
    if (traceView || event.key !== 'Home') return;
    if (!host.contains(document.activeElement)) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '')) return;
    event.preventDefault();
    fitView();
  };
  window.addEventListener('keydown', onHomeKey);

  $('[data-viz-view-reset]').addEventListener('click', fitView);
  $('[data-viz-replay]').addEventListener('click', () => viz?.playEnterAnimation());

  const fullBtn = $('[data-viz-full]');
  let fitTimer = null;

  function setFull(on) {
    root.dataset.full = on ? 'true' : 'false';
    document.body.classList.toggle('is-viz-full', on);
    if (on) {
      root.style.left = '';
      root.style.top = '';
      root.style.width = '';
      root.style.height = '';
    }
    if (on) { root.setAttribute('role','dialog'); root.setAttribute('aria-modal','true'); root.setAttribute('aria-label', traceView ? traceView.title + '可视化' : graph ? graph.title + '可视化' : unionFind ? '并查集可视化' : sorting ? '排序可视化' : '二分查找可视化'); }
    else { root.removeAttribute('role'); root.removeAttribute('aria-modal'); root.removeAttribute('aria-label'); }
    if (fullBtn) {
      fullBtn.textContent = on ? '退出全屏' : '全屏';
      fullBtn.title = on ? '退出全屏（Esc）' : '铺满整个屏幕（Esc 退出）';
      fullBtn.setAttribute('aria-pressed', String(on));
    }
    queueFit();
    if (fitTimer) clearTimeout(fitTimer);
    fitTimer = setTimeout(() => { fitTimer = null; fitView(); }, 260);
  }
  fullBtn.addEventListener('click', () => setFull(root.dataset.full !== 'true'));
  const onEsc = (event) => {
    if (event.key === 'Tab' && root.dataset.full === 'true') {
      const controls = [...root.querySelectorAll('button:not(:disabled),select:not(:disabled),[tabindex="0"]')].filter(node=>node.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    if (event.key === 'Escape' && root.dataset.full === 'true') {
      event.preventDefault();
      setFull(false);
    }
  };
  window.addEventListener('keydown', onEsc);

  function renderRuler(total) {
    ruler.setAttribute('aria-valuemin', '1');
    const count = Math.max(1, total);
    const tickCount = Math.min(count, 100);
    const sampled = tickCount < count;
    tickHost.classList.toggle('is-sampled', sampled);
    tickHost.replaceChildren(...Array.from({ length: tickCount }, (_, tickIndex) => {
      const index = sampled ? Math.round(tickIndex * (count - 1) / (tickCount - 1)) : tickIndex;
      const tick = document.createElement('div');
      tick.className = 'tl-tick';
      tick.dataset.index = String(index);
      if (sampled) tick.style.left = ((index + 0.5) / count * 100) + '%';
      const dot = document.createElement('span');
      dot.className = 'tl-dot';
      const label = document.createElement('span'); label.className = 'tl-label'; label.textContent = String(index + 1);
      tick.title = `第 ${index + 1} 步`; tick.append(dot, label);
      return tick;
    }));
    ruler.setAttribute('aria-valuemax', String(count));
    updateLabelDensity();
  }

  function renderPlayhead() {
    const total = Math.max(1, state.total);
    const pos = ((state.stepIndex + 0.5) / total) * 100;
    const pct = `${Math.min(100, Math.max(0, pos))}%`;
    playhead.style.left = pct;
    ruler.setAttribute('aria-valuenow', String(state.stepIndex + 1));
    tickHost.querySelectorAll('.tl-tick').forEach(tick => {
      const index = Number(tick.dataset.index);
      tick.classList.toggle('is-done', index < state.stepIndex);
      tick.classList.toggle('is-current', index === state.stepIndex);
      tick.classList.toggle('is-end', index === state.total - 1);
    });
    ruler.setAttribute('aria-valuetext', `第 ${state.stepIndex + 1} 步，共 ${state.total} 步`);
    updateLabelDensity();
  }

  function updateLabelDensity() {
    const count = Math.max(1, tickHost.children.length);
    const width = ruler.clientWidth;
    const cellWidth = width / count;
    const stepWidth = width / Math.max(1, state.total);
    const stride = Math.max(1, Math.ceil(26 / Math.max(1, cellWidth)));
    [...tickHost.children].forEach((tick, tickIndex) => {
      const index = Number(tick.dataset.index);
      const current = index === state.stepIndex;
      const nearCurrent = state.stepIndex >= 0 && Math.abs(index - state.stepIndex) * stepWidth < 24;
      tick.querySelector('.tl-label').style.visibility = current || (!nearCurrent && (tickIndex % stride === 0 || tickIndex === count - 1)) ? 'visible' : 'hidden';
    });
  }

  let rulerPointer = null;
  function seekFromEvent(event) {
    if (!currentRun || !state.total) return;
    const rect = ruler.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / Math.max(1, rect.width);
    const total = Math.max(1, state.total);
    const index = Math.min(total - 1, Math.max(0, Math.floor(ratio * total)));
    if (index !== state.stepIndex || state.playing) onSeek?.(index);
  }
  ruler.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || rulerPointer !== null || !currentRun || !state.total) return;
    ruler.focus({ preventScroll: true });
    ruler.setPointerCapture(event.pointerId);
    rulerPointer = event.pointerId;
    seekFromEvent(event);
  });
  ruler.addEventListener('pointermove', (event) => {
    if (event.pointerId === rulerPointer) seekFromEvent(event);
  });
  function stopRulerDrag(event) {
    if (event.pointerId === rulerPointer) rulerPointer = null;
  }
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    ruler.addEventListener(type, stopRulerDrag);
  }
  ruler.addEventListener('keydown', (event) => {
    if (!currentRun || !state.total) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); event.stopPropagation(); onSeek?.(Math.max(0, state.stepIndex - 1)); return; }
    if (event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); onSeek?.(Math.min(state.total - 1, state.stepIndex + 1)); return; }
    if (event.key === 'Home') { event.preventDefault(); event.stopPropagation(); onSeek?.(0); return; }
    if (event.key === 'End') { event.preventDefault(); event.stopPropagation(); onSeek?.(state.total - 1); }
  });

  transport.addEventListener('click', (event) => {
    const button = event.target.closest('[data-t]');
    if (!button || button.disabled) return;
    const action = button.dataset.t;
    if (action === 'reset') { onTransport?.('reset'); viz?.playEnterAnimation(); }
    else if (action === 'last') onSeek?.(Math.max(0, state.total - 1), { stop: true });
    else onTransport?.(action);
  });

  function bindRun(nextRun) {
    currentRun = nextRun;
    if (!nextRun) return;
    /* 自定义代码的标题/图例要等 run 到了才知道是"数组"还是"结构"（窗口是页面初始化时建的，
       那时还没有 run）。按 run.structure 重挂一次，避免"跑 Trie 却写着数组视图"。 */
    if (custom) applyCustomChrome(nextRun);
    if (viz) viz.destroy();
    scene.replaceChildren();
    if (e) {
      viz = createEAnimation(vizHost, explainHost, nextRun, e);
    } else if (f) {
      viz = createFAnimation(vizHost, explainHost, nextRun, f);
    } else if (g) {
      viz = createGAnimation(vizHost, explainHost, nextRun, g);
    } else if (c) {
      viz = createCAnimation(vizHost, nextRun, c, explainHost);
    } else if (d) {
      viz = createDAnimation(vizHost, nextRun, d, explainHost);
    } else if (graph || unionFind) {
      viz = createBAnimation(vizHost, nextRun, explainHost);
    } else if (nextRun.plus) {
      // plus01&02 demo library: arrays keep this project's array visualization (only frameBuilder swapped);
      // other families use the new prototype (vendor/plus + plus-viz.css). Existing styles/animations untouched.
      viz = createPlusView(vizHost, nextRun, { explainContainer: explainHost });
    } else if (isASort(nextRun.algorithm)) {
      viz = createASortVisualization(vizHost, nextRun, explainHost);
    } else viz = createVisualization(vizHost, {
      run: nextRun,
      explainContainer: explainHost,
      frameBuilder: useLegacy ? undefined : buildPrototypeArrayFrame,
    });
    renderRuler(nextRun.steps.length);
    queueFit();
  }

  function setStep(step, nextState = {}) {
    state = { ...state, ...nextState };
    if (viz && step && (useLegacy || viz.getStep() !== step)) {
      viz.showStep(step);
      const explanation = explainHost.querySelector('.bsviz-explain-content');
      if (explanation) explanation.scrollTop = 0;
    }
    const active = Boolean(currentRun && state.total > 0);
    const play = $('#playBtn');
    const label = state.playing ? '暂停' : '播放';
    play.dataset.t = state.playing ? 'pause' : 'play';
    play.setAttribute('aria-label', label); play.title = label;
    $('[data-play-label]').textContent = label;
    play.querySelector('svg').innerHTML = state.playing ? '<path d="M3 2h2v9H3z M7 2h2v9H7z"/>' : '<path d="M3.5 2.5 10.5 7 3.5 11.5z"/>';
    play.disabled = !active || (!state.canNext && !state.playing);
    $('#prevBtn').disabled = !active || !state.canPrev;
    $('#nextBtn').disabled = !active || !state.canNext;
    $('#resetBtn').disabled = !active;
    $('[data-t="last"]').disabled = !active || !state.canNext;
    ruler.setAttribute('aria-disabled', String(!active));
    ruler.tabIndex = active ? 0 : -1;
    root.dataset.empty = String(!active);
    if (active) renderPlayhead();
    else {
      ruler.setAttribute('aria-valuenow','0');
      ruler.setAttribute('aria-valuemin','0');
      ruler.setAttribute('aria-valuemax','0');
      ruler.setAttribute('aria-valuetext','尚未创建运行');
    }
  }

  renderRuler(run ? run.steps.length : 0);
  if (run) bindRun(run);
  else {
    const empty = document.createElement('p'); empty.className = 'viz-empty';
    empty.textContent = traceView ? '填写输入或载入示例，运行后查看结构动画和状态。' : unionFind ? '填写元素和操作，运行后查看父指针森林和父节点表。' : graph ? '填写顶点和边，再运行 ' + graph.name + '。' : '填入示例并开始分析，查看真实执行过程。'; scene.append(empty);
    applyView();
  }
  setStep(run?.steps[0] ?? null, {stepIndex:run ? 0 : -1,total:run?.steps.length ?? 0,canPrev:false,canNext:Boolean(run && run.steps.length > 1),playing:false});

  const observer = new ResizeObserver(queueFit); observer.observe(body);
  const rulerObserver = new ResizeObserver(updateLabelDensity); rulerObserver.observe(ruler);
  const bar = $('.win-bar'); let drag = null;
  bar.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('button') || root.dataset.full === 'true') return;
    const box = root.getBoundingClientRect(), bounds = host.getBoundingClientRect();
    drag = {x:event.clientX,y:event.clientY,left:box.left-bounds.left,top:box.top-bounds.top};
    root.style.width = box.width+'px'; root.style.height = box.height+'px';
    root.classList.add('is-dragging'); bar.setPointerCapture(event.pointerId); event.preventDefault();
  });
  bar.addEventListener('pointermove', event => {
    if (!drag) return;
    root.style.left = Math.max(0,Math.min(host.clientWidth-root.offsetWidth,drag.left+event.clientX-drag.x))+'px';
    root.style.top = Math.max(0,Math.min(host.clientHeight-root.offsetHeight,drag.top+event.clientY-drag.y))+'px';
  });
  for (const type of ['pointerup','pointercancel','lostpointercapture']) bar.addEventListener(type,()=>{drag=null;root.classList.remove('is-dragging');});

  return {
    el: root,
    setRun: bindRun,
    setStep,
    fitView,
    replay: () => viz?.playEnterAnimation(),
    destroy: () => {
      destroyed = true; observer.disconnect(); rulerObserver.disconnect();
      if (fitFrame !== null) cancelAnimationFrame(fitFrame);
      window.removeEventListener('keydown', onHomeKey);
      window.removeEventListener('keydown', onEsc);
      if (root.dataset.full === 'true' || document.body.classList.contains('is-viz-full')) setFull(false);
      if (fitTimer) { clearTimeout(fitTimer); fitTimer = null; }
      viz?.destroy();
      root.remove();
    }
  };
}
