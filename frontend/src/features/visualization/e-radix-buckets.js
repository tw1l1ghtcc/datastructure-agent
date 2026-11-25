function node(tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

function reveal(view, target, axis) {
  const bounds = view.getBoundingClientRect();
  const tile = target.getBoundingClientRect();
  if (axis === 'x') {
    if (tile.left < bounds.left) view.scrollLeft += tile.left - bounds.left;
    else if (tile.right > bounds.left + view.clientWidth) view.scrollLeft += tile.right - bounds.left - view.clientWidth;
  } else {
    if (tile.top < bounds.top) view.scrollTop += tile.top - bounds.top;
    else if (tile.bottom > bounds.top + view.clientHeight) view.scrollTop += tile.bottom - bounds.top - view.clientHeight;
  }
}

export function createRadixBuckets() {
  const element = node('div', 'array-animation-row e-radix-buckets');
  const label = node('div', 'array-animation-label');
  const title = node('h3', '', '数位桶');
  const note = node('p', 'e-radix-bucket-note');
  const indexKey = node('p', 'e-radix-index-key', '# 为本轮输入下标');
  label.append(title, note, indexKey);
  const track = node('div', 'e-radix-bucket-track');
  track.setAttribute('role', 'region');
  track.setAttribute('aria-label', '数位桶');
  track.tabIndex = 0;
  const grid = node('div', 'e-radix-bucket-grid');
  const empty = node('p', 'array-animation-empty');
  track.append(grid, empty);
  element.append(label, track);

  const columns = Array.from({ length: 10 }, (_, digit) => {
    const column = node('div', 'e-radix-bucket');
    column.dataset.bucket = digit;
    const head = node('div', 'e-radix-bucket-head');
    const count = node('strong', 'e-radix-bucket-count');
    head.append(node('span', '', digit + ' 号桶'), count);
    const body = node('ol', 'e-radix-bucket-members');
    body.setAttribute('aria-label', digit + ' 号桶的元素');
    column.append(head, body);
    grid.append(column);
    return { column, head, count, body };
  });
  let activeTile = null;

  return {
    element,
    show({ title: phase, detail, values, focus, related, members, source, placedFrom, emptyText }) {
      note.textContent = values ? [phase, detail].filter(Boolean).join(' · ') : '';
      indexKey.hidden = !values;
      grid.hidden = !values;
      empty.hidden = Boolean(values);
      activeTile = null;
      if (!values) {
        empty.textContent = emptyText;
        return;
      }

      for (const [digit, { column, head, count, body }] of columns.entries()) {
        count.textContent = values[digit];
        head.classList.toggle('is-focused', focus === digit);
        head.classList.toggle('is-related', related === digit);
        const tiles = members[digit].map(({ value, index }) => {
          const tile = node('li', 'e-radix-member');
          tile.dataset.inputIndex = index;
          const active = digit === focus && index === source;
          tile.classList.toggle('is-focused', active);
          tile.classList.toggle('is-written', placedFrom != null && index >= placedFrom && !active);
          tile.append(node('span', 'e-radix-member-value', value), node('span', 'e-radix-member-index', '#' + index));
          if (active) activeTile = tile;
          return tile;
        });
        body.replaceChildren(...tiles);
        if (focus === digit) {
          reveal(track, column, 'x');
          if (activeTile) reveal(body, activeTile, 'y');
        }
      }
    },
    activeBounds() { return activeTile?.getBoundingClientRect(); },
    rewind() {
      track.scrollLeft = 0;
      columns.forEach(({ body }) => { body.scrollTop = 0; });
    },
  };
}
