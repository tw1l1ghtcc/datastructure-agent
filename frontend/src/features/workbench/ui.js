import { eAlgorithm } from './e-algorithms.js';
import { gAlgorithm } from './g-algorithms.js';
import { dataAlgorithm as cAlgorithm } from './data-algorithms.js';
import { arraySearch } from './array-search.js';
import { graphAlgorithm } from './graph-algorithms.js';
import { isPlus, plusCase } from '../visualization/ext/plus-bridge.js';

export function createWorkbenchUI({ onNavigate = () => {} } = {}) {
  const $ = id => document.getElementById(id);
  const lifetime = new AbortController();
  const listen = (node, type, fn) => node.addEventListener(type, fn, { signal: lifetime.signal });
  const panel = $('tutor-window'), ball = $('tutor-toggle'), sidebar = $('sidebar-toggle');
  let algorithm = 'binary-search';
  const uiKey = 'datastructure-agent:workbench-ui:v1';
  const nav = document.querySelector('.sidebar nav');
  function syncNavIndicator() {
    const active = nav.querySelector('.nav-item.active');
    if (!active?.getClientRects().length) return;
    const item = active.getBoundingClientRect(), bounds = nav.getBoundingClientRect();
    nav.style.setProperty('--nav-active-y', (item.top-bounds.top)+'px');
    nav.style.setProperty('--nav-active-height', item.height+'px');
    if (!nav.dataset.indicatorReady) {
      nav.dataset.indicatorReady = 'true';
      nav.getBoundingClientRect();
      nav.classList.add('indicator-animated');
    }
  }
  const navObserver = new ResizeObserver(syncNavIndicator); navObserver.observe(nav);
  let open = false, returnFocus = ball, drag = null;
  const notePicker = $('note-unit'), noteContent = $('note-content'), noteStatus = $('note-status');
  let activeNote = '', renderedUnit = '', noteRequest = null;
  let positionFrame = null;
  function queuePosition() {
    if (positionFrame !== null) return;
    positionFrame = requestAnimationFrame(() => {
      positionFrame = null;
      const timeline = document.querySelector('.vizwin .timeline')?.getBoundingClientRect();
      const base = innerWidth <= 540 ? 14 : 24, right = innerWidth <= 540 ? 14 : 26;
      const x = innerWidth - right - ball.offsetWidth, y = innerHeight - base - ball.offsetHeight;
      const overlaps = timeline && timeline.bottom > y && timeline.top < innerHeight - base && timeline.right > x && timeline.left < innerWidth - right;
      ball.style.bottom = (overlaps ? innerHeight - timeline.top + 12 : base) + 'px';
    });
  }
  try { document.body.dataset.sidebarCollapsed = localStorage.getItem(uiKey) !== 'expanded' ? 'true' : 'false'; } catch { /* Layout preference is optional. */ }
  function updateSidebar() {
    const collapsed = document.body.dataset.sidebarCollapsed === 'true';
    sidebar.setAttribute('aria-expanded', String(!collapsed));
    sidebar.setAttribute('aria-label', collapsed ? '展开侧栏' : '收起侧栏');
    sidebar.title = collapsed ? '展开侧栏' : '收起侧栏';
    sidebar.querySelector('[data-sidebar-arrow]').textContent = collapsed ? '›' : '‹';
    syncNavIndicator();
  }
  updateSidebar();
  listen(sidebar, 'click', () => {
    document.body.dataset.sidebarCollapsed = document.body.dataset.sidebarCollapsed === 'true' ? 'false' : 'true';
    updateSidebar();
    try { localStorage.setItem(uiKey, document.body.dataset.sidebarCollapsed === 'true' ? 'collapsed' : 'expanded'); } catch { /* Optional preference. */ }
  });
  async function showNote(unit, section) {
    noteRequest?.abort();
    noteStatus.hidden = true;
    notePicker.value = unit;
    noteContent.hidden = !unit || renderedUnit !== unit;
    if (!unit) return;
    if (renderedUnit !== unit) {
      const request = new AbortController();
      noteRequest = request;
      try {
        const response = await fetch('/assets/notes/' + encodeURIComponent(unit) + '.html', { signal: request.signal });
        if (!response.ok) throw new Error('笔记读取失败');
        const html = await response.text();
        if (request.signal.aborted) return;
        noteContent.innerHTML = html;
        renderedUnit = unit;
        noteContent.hidden = false;
      } catch {
        if (request.signal.aborted) return;
        noteContent.hidden = true;
        noteStatus.textContent = '笔记读取失败，请重新选择单元。';
        noteStatus.hidden = false;
        return;
      }
    }
    if (section) {
      const heading = noteContent.querySelector('#' + CSS.escape(section));
      heading?.focus({ preventScroll: true });
      heading?.scrollIntoView({ block: 'start' });
    }
  }
  const pages = { catalog: '课程目录', workbench: '算法工作台', knowledge: '学习笔记', practice: '过程练习', records: '错题与记录' };
  let currentPage = null;
  function route() {
    const [hash, query] = location.hash.slice(1).split('?');
    const name = ({ 'exercise-panel': 'practice', 'records-mount': 'records', 'tutor-knowledge-view': 'knowledge' })[hash] || hash;
    const params = new URLSearchParams(query);
    const legacyIntro = params.get('topic') === 'overview-1';
    return [name, {
      replace: true,
      unit: legacyIntro ? 'intro' : params.get('unit'),
      section: legacyIntro ? 'basics' : params.get('section'),
      algorithm: params.get('algorithm')
    }];
  }
  function navigate(name, { replace = false, unit = '', section = '', algorithm: requestedAlgorithm = null } = {}) {
    if (!Object.hasOwn(pages,name)) name = 'workbench';
    const query = new URLSearchParams();
    if (name === 'knowledge' && unit && Array.from(notePicker.options).some(option => option.value === unit)) {
      query.set('unit', unit);
      if (section && /^[a-z0-9-]{1,50}$/.test(section)) query.set('section', section);
    }
    /* 合并（PR #66 §1）：主分支的 8 种排序 + G/C/并查集白名单，加上我们的 plus 示例白名单 */
    /* plus 示例也要能写进地址（评审报告 §3.11）：以前白名单里没有 isPlus，
       选完示例后 hash 不带 plus 参数，复制地址/刷新/前进后退就回到默认算法。
       按目录校验 id（plusCase），避免接受任意脏值。 */
    const plusId = isPlus(requestedAlgorithm) ? String(requestedAlgorithm).slice('plus:'.length) : null;
    const knownPlus = Boolean(plusId && plusCase(plusId));
    if (name === 'workbench' && (['insertion-sort', 'binary-insertion-sort', 'shell-sort', 'selection-sort', 'quick-sort', 'heap-sort', 'merge-sort', 'binary-search', 'bubble-sort', 'custom-array', 'union-find'].includes(requestedAlgorithm) || eAlgorithm(requestedAlgorithm) || gAlgorithm(requestedAlgorithm) || graphAlgorithm(requestedAlgorithm) || arraySearch(requestedAlgorithm) || cAlgorithm(requestedAlgorithm) || knownPlus)) {
      query.set('algorithm', requestedAlgorithm);
    }
    const hash = '#' + name + (query.size ? '?' + query : '');
    if (location.hash !== hash) history[replace ? 'replaceState' : 'pushState'](null,'',hash);
    const pageChanged = currentPage !== name;
    const nextAlgorithm = query.get('algorithm');
    const algorithmChanged = nextAlgorithm !== null && nextAlgorithm !== algorithm;
    if (!pageChanged && !algorithmChanged && (name !== 'knowledge' || activeNote === hash)) return;
    if (name !== 'knowledge') noteRequest?.abort();
    document.querySelector('.vizwin[data-full="true"] [data-viz-full]')?.click();
    onNavigate(name, nextAlgorithm);
    if (open) show(false, false);
    for (const view of document.querySelectorAll('[data-page-view]')) view.hidden = view.dataset.pageView !== name;
    for (const link of document.querySelectorAll('.nav-item[data-page-link]')) {
      const active = link.dataset.pageLink === name;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current','page'); else link.removeAttribute('aria-current');
    }
    syncNavIndicator();
    currentPage = name; document.body.dataset.page = name;
    if (innerWidth <= 540) { document.body.dataset.sidebarCollapsed = 'true'; updateSidebar(); }
    $('page-breadcrumb').textContent = pages[name]; document.title = pages[name] + ' · 看懂每一步';
    ball.hidden = name !== 'workbench' || algorithm === 'custom-array';
    if (pageChanged) document.querySelector('[data-page-view="'+name+'"] h1')?.focus({preventScroll:true});
    window.scrollTo(0,0); queuePosition();
    if (name === 'knowledge') {
      activeNote = hash;
      showNote(query.get('unit') ?? '', query.get('section'));
    }
  }
  for (const link of document.querySelectorAll('[data-page-link]')) listen(link, 'click', event => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); navigate(link.dataset.pageLink);
  });
  listen(window,'hashchange',()=>navigate(...route()));
  listen(window,'popstate',()=>navigate(...route()));

  function clampPosition() {
    if (!open || !panel.style.left) return;
    const rect = panel.getBoundingClientRect();
    panel.style.left = Math.max(12, Math.min(innerWidth - rect.width - 12, rect.left)) + 'px';
    panel.style.top = Math.max(12, Math.min(innerHeight - rect.height - 12, rect.top)) + 'px';
  }
  function show(value, restoreFocus = true) {
    open = value; panel.hidden = !value; ball.setAttribute('aria-expanded', String(value));
    ball.setAttribute('aria-label', value ? '收起步骤辅导' : '打开步骤辅导');
    if (value) {
      clampPosition(); $('tutor-close').focus({ preventScroll: true });
    } else if (restoreFocus) returnFocus.focus({ preventScroll: true });
  }
  listen(ball, 'click', () => { returnFocus = ball; show(!open); });
  listen($('tutor-close'), 'click', () => show(false));
  listen(document, 'pointerdown', event => {
    if (open && !drag && !panel.contains(event.target) && !ball.contains(event.target)) show(false, false);
  });
  listen(notePicker, 'change', () => navigate('knowledge', { unit: notePicker.value }));
  listen(panel, 'keydown', event => {
    if (event.key === 'Escape' && !document.body.classList.contains('is-viz-full')) { event.preventDefault(); event.stopPropagation(); show(false); }
  });
  const handle = panel.querySelector('[data-tutor-drag]');
  listen(handle, 'pointerdown', event => {
    if (event.button !== 0 || event.target.closest('button')) return;
    const rect = panel.getBoundingClientRect();
    drag = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    panel.style.left = rect.left + 'px'; panel.style.top = rect.top + 'px'; panel.style.right = 'auto'; panel.style.bottom = 'auto';
    handle.setPointerCapture(event.pointerId); event.preventDefault();
  });
  listen(handle, 'pointermove', event => {
    if (!drag) return;
    panel.style.left = (event.clientX - drag.x) + 'px'; panel.style.top = (event.clientY - drag.y) + 'px'; clampPosition();
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(handle, type, () => { drag = null; });
  listen(window, 'resize', () => { clampPosition(); queuePosition(); });
  listen(window, 'scroll', queuePosition);
  const layoutObserver = new ResizeObserver(queuePosition);
  layoutObserver.observe($('visualization-panel'));
  const prompts = {
    init: '二分查找为什么要求数组有序？',
    probe: '这次比较后，可以排除哪一半区间？',
    'move-left': '更新左边界后，为什么 mid 暂时是“未计算”？',
    'move-right': '更新右边界后，为什么 mid 暂时是“未计算”？',
    found: '如果数组有重复值，这次一定返回第一个位置吗？',
    'not-found': '哪个边界条件说明目标已经不在数组中了？'
  };
  const bfsPrompts = {
    init: 'BFS 为什么用队列？',
    'mark-start': '为什么要先标记起点？',
    'enqueue-start': '为什么起点要先入队？',
    dequeue: '为什么取出的是队首顶点？',
    'check-neighbor': '这条边会让哪个顶点进入队列？',
    'enqueue-neighbor': '为什么这个顶点要排到队尾？',
    'skip-neighbor': '为什么跳过这个邻点？',
    end: '为什么有的顶点没有被访问？'
  };
  const sortingPrompts = {
    init: '这步发生了什么？',
    compare: '这两个元素需要交换吗？',
    swap: '这次交换改变了什么？',
    'pass-end': '为什么这一轮结束有元素就位？',
    sorted: '如果有两个相等的元素，它们的相对顺序会变吗？',
  };
  return {
    start() { navigate(...route()); },
    navigate,
    setAlgorithm(value) {
      algorithm = value;
      /* 合并（PR #66 §1）：主分支把 G/C/并查集也算"无练习"；我们另加 plus 预览不接问答 */
      panel.querySelector('.tutor-practice').hidden = Boolean(graphAlgorithm(value) || arraySearch(value) || cAlgorithm(value) || value === 'union-find' || gAlgorithm(value) || eAlgorithm(value));
      /* plus 示例是本地预览：后端没有这次运行的记录，步骤问答必然 404（评审报告 §3.10）→ 直接关掉入口 */
      const tutorUnavailable = value === 'custom-array' || isPlus(value);
      if (tutorUnavailable && open) show(false, false);
      ball.hidden = currentPage !== 'workbench' || tutorUnavailable;
    },
    setContext(context) {
      const data = eAlgorithm(algorithm) ?? gAlgorithm(algorithm);
      if (data) {
        $('tutor-prompt').textContent = data.prompt;
        return;
      }
      if (cAlgorithm(algorithm)) {
        $('tutor-prompt').textContent = '这一步改变了哪些状态，为什么？';
        return;
      }
      if (algorithm === 'union-find') {
        $('tutor-prompt').textContent = '这次合并为什么改变了父节点和集合数量？';
        return;
      }
      if (arraySearch(algorithm)) {
        $('tutor-prompt').textContent = algorithm === 'block-search' ? '为什么可以跳过这一块？' : '顺序查找遇到重复值时会返回哪个下标？';
        return;
      }
      const activePrompts = algorithm === 'bfs' ? bfsPrompts
        : algorithm.endsWith('-sort') ? sortingPrompts : prompts;
      if (algorithm !== 'bfs' && graphAlgorithm(algorithm)) {
        $('tutor-prompt').textContent = context?.step?.done ? '这次运行得到了什么结果？' : '这一步改变了哪些状态，为什么？';
        return;
      }
      $('tutor-prompt').textContent = activePrompts[context?.step?.event] || activePrompts.init;
      queuePosition();
    },
    destroy() { lifetime.abort(); noteRequest?.abort(); navObserver.disconnect(); delete nav.dataset.indicatorReady; nav.classList.remove('indicator-animated'); layoutObserver.disconnect(); if (positionFrame !== null) cancelAnimationFrame(positionFrame); }
  };
}