import { eAlgorithmsIn } from './e-algorithms.js';
import { gAlgorithm, gAlgorithmIds } from './g-algorithms.js';
import { dAlgorithm, dAlgorithmIds } from './d-algorithms.js';
import { cAlgorithm, cAlgorithmIds } from './c-algorithms.js';
import { graphAlgorithm, graphAlgorithmIds } from './graph-algorithms.js';
import { fAlgorithm, fAlgorithmIds } from './f-algorithms.js';

const fOptions = chapter => fAlgorithmIds.filter(id => fAlgorithm(id).chapter === chapter).map(id => [id, fAlgorithm(id).title]);
const chapters = [
  ['第二章 · 线性表', eAlgorithmsIn('list')],
  ['第三章 · 栈、队列与数组', [...fOptions(3), ...eAlgorithmsIn('matrix')]],
  ['第四章 · 串', fOptions(4)],
  ['第五章 · 树与二叉树', gAlgorithmIds.filter(id => id !== 'binary-search-tree').map(id => [id, gAlgorithm(id).title])],
  ['第六章 · 图', [...graphAlgorithmIds.map(id => [id, graphAlgorithm(id).title]), ...fOptions(6)]],
  ['并查集', [['union-find', '并查集']]],
  ['第七章 · 查找', [['binary-search', '二分查找'], ['linear-search', '顺序查找'], ['block-search', '分块查找'], ['binary-search-tree', gAlgorithm('binary-search-tree').title], ...cAlgorithmIds.filter(id => cAlgorithm(id).tree).map(id => [id, cAlgorithm(id).title]), ...dAlgorithmIds.map(id => [id, dAlgorithm(id).title])]],
  ['第八章 · 排序', [
    ['bubble-sort', '冒泡排序'],
    ['insertion-sort', '直接插入排序'],
    ['binary-insertion-sort', '折半插入排序'],
    ['shell-sort', '希尔排序'],
    ['selection-sort', '简单选择排序'],
    ['quick-sort', '快速排序'],
    ['heap-sort', '堆排序'],
    ['merge-sort', '归并排序'],
    ...eAlgorithmsIn('sort'),
    ...cAlgorithmIds.filter(id => !cAlgorithm(id).tree).map(id => [id, cAlgorithm(id).title]),
  ]],
  ['自定义', [['custom-array', '自定义代码']]]
];

export function createAlgorithmMenu(root, onSelect) {
  const trigger = root.querySelector('#algorithm-trigger');
  const selection = root.querySelector('#algorithm-selection');
  const list = root.querySelector('#algorithm-chapters');
  const choices = new Map();
  const controller = new AbortController();
  const options = { signal: controller.signal };
  let activeChapter = null;
  let hoverTimer;

  function cancelHover() { clearTimeout(hoverTimer); }
  function alignSubmenu(submenu) {
    submenu.style.removeProperty('--submenu-shift');
    if (window.matchMedia('(max-width: 680px)').matches) return;
    const { top, height } = submenu.getBoundingClientRect();
    const alignedTop = Math.max(8, Math.min(top, window.innerHeight - height - 8));
    submenu.style.setProperty('--submenu-shift', (alignedTop - top) + 'px');
  }

  function showChapter(chapter) {
    cancelHover();
    if (activeChapter) {
      activeChapter.button.setAttribute('aria-expanded', 'false');
      activeChapter.submenu.hidden = true;
    }
    activeChapter = chapter;
    if (chapter) {
      chapter.button.setAttribute('aria-expanded', 'true');
      chapter.submenu.hidden = false;
      alignSubmenu(chapter.submenu);
    }
  }
  function setOpen(open) {
    trigger.setAttribute('aria-expanded', String(open));
    list.hidden = !open;
    if (!open) showChapter(null);
  }
  function close() {
    setOpen(false);
    if (root.contains(document.activeElement)) trigger.focus({ preventScroll: true });
  }

  for (const [index, [name, algorithms]] of chapters.entries()) {
    const row = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    const arrow = document.createElement('span');
    arrow.textContent = '▸';
    arrow.setAttribute('aria-hidden', 'true');
    button.append(name, arrow);
    button.setAttribute('aria-expanded', 'false');

    const submenu = document.createElement('ul');
    submenu.className = 'algorithm-menu-list algorithm-submenu';
    submenu.id = 'algorithm-chapter-' + index;
    submenu.setAttribute('aria-label', name);
    submenu.hidden = true;
    button.setAttribute('aria-controls', submenu.id);

    const chapter = { button, submenu };
    row.append(button, submenu);
    list.append(row);
    button.addEventListener('pointerenter', event => {
      if (event.pointerType !== 'mouse') return;
      cancelHover();
      if (!activeChapter) showChapter(chapter);
      else if (activeChapter !== chapter) hoverTimer = setTimeout(() => showChapter(chapter), 160);
    }, options);
    submenu.addEventListener('pointerenter', cancelHover, options);
    button.addEventListener('click', () => showChapter(chapter), options);
    button.addEventListener('keydown', event => {
      if (event.key !== 'ArrowRight') return;
      event.preventDefault();
      showChapter(chapter);
      submenu.querySelector('button').focus();
    }, options);
    submenu.addEventListener('keydown', event => {
      if (event.key !== 'ArrowLeft') return;
      event.preventDefault();
      showChapter(null);
      button.focus();
    }, options);
    for (const [id, title] of algorithms) {
      const item = document.createElement('li');
      const choice = document.createElement('button');
      choice.type = 'button';
      choice.dataset.algorithmChoice = id;
      choice.textContent = title;
      choice.addEventListener('click', () => {
        close();
        onSelect(id);
      }, options);
      choices.set(id, choice);
      item.append(choice);
      submenu.append(item);
    }
  }

  trigger.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse') setOpen(true); }, options);
  trigger.addEventListener('click', () => {
    if (list.hidden) setOpen(true);
    else if (document.activeElement === trigger) list.querySelector('button').focus();
  }, options);
  trigger.addEventListener('keydown', event => {
    if (event.key !== 'ArrowDown') return;
    event.preventDefault();
    setOpen(true);
    list.querySelector('button').focus();
  }, options);
  root.addEventListener('pointerleave', event => { if (event.pointerType === 'mouse') close(); }, options);
  window.addEventListener('resize', () => {
    if (activeChapter) alignSubmenu(activeChapter.submenu);
  }, options);
  root.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || list.hidden) return;
    event.preventDefault();
    event.stopPropagation();
    close();
  }, options);
  root.addEventListener('focusout', event => {
    if (event.relatedTarget && !root.contains(event.relatedTarget)) setOpen(false);
  }, options);
  document.addEventListener('pointerdown', event => { if (!root.contains(event.target)) setOpen(false); }, options);

  return {
    setSelected(id) {
      const choice = choices.get(id);
      if (!choice) return;
      trigger.dataset.algorithm = id;
      selection.textContent = choice.textContent;
      for (const item of choices.values()) {
        if (item === choice) item.setAttribute('aria-current', 'true');
        else item.removeAttribute('aria-current');
      }
      setOpen(false);
    },
    destroy() { cancelHover(); controller.abort(); }
  };
}
