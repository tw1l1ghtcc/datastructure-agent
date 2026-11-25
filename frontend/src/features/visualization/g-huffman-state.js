import { createStateTable } from './state-table.js';

function weightList(nodes, indices, role) {
  return indices.map(index => {
    const { id, weight } = nodes[index];
    const item = document.createElement('li');
    item.dataset.node = String(index);
    item.dataset.state = role(index);
    const value = document.createElement('strong');
    value.textContent = weight;
    const identity = document.createElement('span');
    identity.textContent = id == null ? `#${index}` : `${id} · #${index}`;
    identity.title = identity.textContent;
    item.append(value, identity);
    return item;
  });
}

function reveal(view, item) {
  if (!item) return;
  const frame = view.getBoundingClientRect();
  const box = item.getBoundingClientRect();
  if (box.top < frame.top) view.scrollTop += box.top - frame.top;
  else if (box.bottom > frame.top + view.clientHeight) view.scrollTop += box.bottom - frame.top - view.clientHeight;
}

export function createHuffmanState() {
  const element = document.createElement('div');
  element.className = 'g-huffman-state';
  element.innerHTML = `
    <div class="g-huffman-build">
      <div data-huffman-picked>
        <h3>本轮取出</h3><ol class="g-huffman-weights" aria-label="本轮取出"></ol>
      </div>
      <header><h3>候选结点</h3><p>按权重从小到大</p></header>
      <div class="g-huffman-scroll" role="region" aria-label="候选结点" tabindex="0">
        <ol class="g-huffman-weights"></ol><p>候选队列为空</p>
      </div>
    </div>
    <div class="g-huffman-encoding">
      <div class="g-huffman-path" data-huffman-path></div>
      <div class="g-huffman-scroll" role="region" aria-label="码字表" tabindex="0" data-huffman-codes></div>
    </div>`;
  const build = element.querySelector('.g-huffman-build');
  const encoding = element.querySelector('.g-huffman-encoding');
  const selected = element.querySelector('[data-huffman-picked]');
  const picked = selected.querySelector('ol');
  const queue = build.querySelector('.g-huffman-scroll');
  const candidates = queue.querySelector('ol');
  const empty = queue.querySelector('p');
  const path = element.querySelector('[data-huffman-path]');
  const codes = element.querySelector('[data-huffman-codes]');
  let wasEncoding;

  return {
    element,
    label: '哈夫曼候选结点与码字',
    canvasLabel: '哈夫曼树画布',
    showStep(step) {
      const v = step.variables;
      const showCodes = v.root != null || step.done;
      build.hidden = showCodes;
      encoding.hidden = !showCodes;
      if (showCodes) {
        path.textContent = step.event === 'code' ? `${v.nodes[v.currentNode].id} 的码字 ${v.path}`
          : v.path == null ? '' : `当前路径 ${v.path}`;
        path.hidden = !path.textContent;
        const table = createStateTable('码字表', ['符号', '权重', '码字'], v.codes.map(code => [code.id, code.weight, code.code]));
        const active = step.event === 'code' ? table.tBodies[0].lastElementChild : null;
        if (active) active.dataset.current = 'true';
        codes.replaceChildren(table);
        if (!wasEncoding || step.done) codes.scrollTop = 0;
        reveal(codes, active);
      } else {
        selected.hidden = !v.selected.length;
        picked.replaceChildren(...weightList(v.nodes, v.selected, index => index === v.currentNode ? 'current' : 'selected'));
        candidates.replaceChildren(...weightList(v.nodes, v.candidates, index => step.event === 'merge' && index === v.currentNode ? 'added' : 'idle'));
        empty.hidden = Boolean(v.candidates.length);
        if (!step.stepIndex || wasEncoding || step.event === 'select') queue.scrollTop = 0;
        reveal(queue, candidates.querySelector('[data-state="added"]'));
      }
      wasEncoding = showCodes;
    },
  };
}
