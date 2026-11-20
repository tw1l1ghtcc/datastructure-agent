const motionQuery = '(prefers-reduced-motion: reduce)';
const slideTiming = { duration: 240, easing: 'cubic-bezier(.22,.68,.32,1)' };

export function createTraversalList(algorithm) {
  const queue = algorithm === 'bfs';
  const key = queue ? 'queue' : 'stack';
  const title = queue ? '队列' : '栈';
  const element = document.createElement('div');
  element.className = 'b-traversal-list';

  const heading = document.createElement('p');
  heading.className = 'b-traversal-heading';
  heading.textContent = title;
  const labels = document.createElement('div');
  labels.className = 'b-traversal-ends';
  for (const text of queue ? ['队首 · 出队', '队尾 · 入队'] : ['栈底', '栈顶 · 入栈 / 出栈']) {
    const label = document.createElement('span');
    label.textContent = text;
    labels.append(label);
  }

  const lane = document.createElement('div');
  lane.className = 'b-traversal-lane';
  const scroll = document.createElement('div');
  scroll.className = 'b-traversal-scroll';
  const cells = document.createElement('ol');
  cells.className = 'b-traversal-cells';
  cells.setAttribute('role', 'list');
  scroll.append(cells);
  const exits = document.createElement('div');
  exits.className = 'b-traversal-exits';
  exits.setAttribute('aria-hidden', 'true');
  const empty = document.createElement('p');
  empty.className = 'b-traversal-empty';
  empty.textContent = title + '为空';
  lane.append(scroll, empty, exits);
  element.append(heading, labels, lane);

  const motion = window.matchMedia(motionQuery);
  let displayed = [];
  let index = null;
  let animations = [];

  function clearMotion() {
    for (const animation of animations) animation.cancel();
    animations = [];
    exits.replaceChildren();
  }

  function slide(cell, dx, leaving = false) {
    const outside = { transform: 'translateX(' + dx + 'px)', opacity: 0 };
    const inside = { transform: 'translateX(0px)', opacity: 1 };
    const animation = cell.animate(leaving ? [inside, outside] : [outside, inside], slideTiming);
    animations.push(animation);
    return animation;
  }

  function showStep(step) {
    const next = step.variables[key];
    const direction = index === null ? 0 : step.stepIndex - index;
    index = step.stepIndex;
    const adjacent = Math.abs(direction) === 1;
    if (next.length === displayed.length && next.every((value, i) => value === displayed[i])) {
      if (!adjacent) clearMotion();
      return;
    }

    clearMotion();
    const oldCells = new Map(displayed.map((value, i) => [value, cells.children[i]]));
    const nextValues = new Set(next);
    const removed = displayed.find(value => !nextValues.has(value));
    const added = next.find(value => !oldCells.has(value));
    // A backward step returns a dequeued vertex through the head and undoes an enqueue at the tail.
    const head = queue && (direction > 0 ? removed !== undefined : added !== undefined);
    const align = () => { scroll.scrollLeft = head ? 0 : scroll.scrollWidth; };
    const animate = adjacent && !motion.matches;
    if (adjacent && removed !== undefined) align();

    const laneBounds = animate ? lane.getBoundingClientRect() : null;
    const oldBounds = animate ? new Map([...oldCells].map(([value, cell]) => [value, cell.getBoundingClientRect()])) : null;
    const offscreen = box => head ? laneBounds.left - box.right - 8 : laneBounds.right - box.left + 8;
    if (animate && removed !== undefined) {
      const box = oldBounds.get(removed);
      const ghost = document.createElement('div');
      ghost.className = 'b-traversal-cell';
      ghost.textContent = removed;
      exits.append(ghost);
      ghost.style.left = (box.left - laneBounds.left) + 'px';
      ghost.style.top = (box.top - laneBounds.top) + 'px';
      ghost.style.width = box.width + 'px';
      ghost.style.height = box.height + 'px';
      slide(ghost, offscreen(box), true).onfinish = () => ghost.remove();
    }

    const newCells = next.map(value => {
      const existing = oldCells.get(value);
      if (existing) return existing;
      const cell = document.createElement('li');
      cell.className = 'b-traversal-cell';
      cell.textContent = value;
      cell.title = value;
      return cell;
    });
    cells.replaceChildren(...newCells);
    empty.hidden = next.length > 0;
    displayed = next;
    if (adjacent) align();
    else scroll.scrollLeft = 0;

    if (!animate) return;
    for (const [i, cell] of newCells.entries()) {
      const bounds = cell.getBoundingClientRect();
      const previous = oldBounds.get(next[i]);
      if (!previous) slide(cell, offscreen(bounds));
      else if (Math.abs(previous.left - bounds.left) > 1) {
        animations.push(cell.animate([
          { transform: 'translateX(' + (previous.left - bounds.left) + 'px)' },
          { transform: 'translateX(0px)' },
        ], slideTiming));
      }
    }
  }

  return { element, showStep, destroy: clearMotion };
}
