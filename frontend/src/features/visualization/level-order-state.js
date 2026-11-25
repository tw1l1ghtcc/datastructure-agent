import { createTraversalList } from './b-traversal-list.js';

export function createLevelOrderState() {
  const element = document.createElement('div');
  element.className = 'g-level-order-state';
  const queue = createTraversalList('binary-tree-level-order');
  const results = document.createElement('div');
  results.className = 'g-level-order-results';
  const heading = document.createElement('p');
  heading.className = 'b-traversal-heading';
  heading.textContent = '分层访问结果';
  const levels = document.createElement('ol');
  levels.className = 'g-level-order-levels';
  const empty = document.createElement('p');
  empty.className = 'g-level-order-no-results';
  empty.textContent = '还没有访问节点';
  results.append(heading, levels, empty);
  element.append(queue.element, results);
  let visitedCount = null;

  return {
    element,
    showStep(step) {
      queue.showStep(step);
      const { order, levels: visitedLevels } = step.variables;
      if (order.length === visitedCount) return;
      visitedCount = order.length;
      empty.hidden = visitedCount > 0;
      levels.replaceChildren(...visitedLevels.map((ids, index) => {
        const row = document.createElement('li');
        const label = document.createElement('span');
        label.textContent = '第 ' + (index + 1) + ' 层';
        const nodes = document.createElement('ol');
        nodes.className = 'g-level-order-visited';
        for (const id of ids) {
          const node = document.createElement('li');
          node.textContent = id;
          node.title = id;
          nodes.append(node);
        }
        row.append(label, nodes);
        return row;
      }));
    },
    destroy: queue.destroy,
  };
}
