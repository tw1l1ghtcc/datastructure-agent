function el(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

let explanationId = 0;

export function createExplanationPanel() {
  const caption = el('p', 'bsviz-caption');
  const status = el('p', 'bsviz-status');
  status.setAttribute('role', 'status');

  const explain = el('div', 'bsviz-explain');
  const explainHead = el('div', 'bsviz-explain-head');
  explainHead.append(el('span', 'bsviz-explain-title', '本步解释'));
  const explainToggle = el('button', 'bsviz-explain-toggle', '收起');
  const content = el('div', 'bsviz-explain-content');
  content.id = 'step-explanation-' + (++explanationId);
  content.append(caption, status);
  explainToggle.setAttribute('type', 'button');
  explainToggle.setAttribute('aria-controls', content.id);
  explainToggle.setAttribute('aria-expanded', 'true');
  explainHead.append(explainToggle);
  explain.append(explainHead, content);
  explain.dataset.collapsed = 'false';
  explainToggle.addEventListener('click', () => {
    const collapsed = explain.dataset.collapsed === 'true';
    explain.dataset.collapsed = collapsed ? 'false' : 'true';
    content.hidden = !collapsed;
    explainToggle.textContent = collapsed ? '收起' : '展开';
    explainToggle.setAttribute('aria-expanded', String(collapsed));
  });

  return { explain, caption, status };
}
