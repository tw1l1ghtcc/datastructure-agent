import { createArrayAnimationRow } from './array-animation-row.js';
import { compactLabel } from './trace-animation.js';

const inside = (index, range) => index >= range[0] && index < range[1];
const formatRange = ([start, end]) => `[${start}, ${end})`;

export function createReconstructionState() {
  const element = document.createElement('div');
  element.className = 'g-reconstruction-state';
  const path = document.createElement('p');
  path.className = 'g-reconstruction-path';
  const sequences = [
    { key: 'preorder', title: '前序序列', row: createArrayAnimationRow('g-rebuild-preorder') },
    { key: 'inorder', title: '中序序列', row: createArrayAnimationRow('g-rebuild-inorder') },
  ];
  element.append(...sequences.map(({ row }) => row.element), path);

  return {
    element,
    label: '前序与中序的重建区间',
    showStep(step) {
      const { stack } = step.variables;
      const frame = stack.at(-1);
      const descend = step.lineId === 'descend-left' ? 'left' : step.lineId === 'descend-right' ? 'right' : null;
      for (const { key, title, row } of sequences) {
        const values = step.variables[key];
        const preorder = key === 'preorder';
        const range = frame && (preorder ? [frame.preStart, frame.preEnd] : [frame.inStart, frame.inEnd]);
        const left = frame?.leftRange?.[key];
        const right = frame?.rightRange?.[key];
        const root = preorder ? frame?.preStart : frame?.split;
        const active = descend === 'left' ? left : descend === 'right' ? right : range;
        const roles = { swap: [], added: [], focus2: [], excluded: [] };
        values.forEach((_, index) => {
          if (index === root) roles.swap.push(index);
          else if (active && !inside(index, active)) roles.excluded.push(index);
          else if (left && inside(index, left)) roles.added.push(index);
          else if (right && inside(index, right)) roles.focus2.push(index);
        });
        if (!step.stepIndex || step.done) row.rewind();
        const labels = values.map(value => compactLabel(value, 7));
        const detail = active ? (descend ? '进入区间 ' : '当前区间 ') + formatRange(active) : '';
        row.show({ title, detail, values: labels, fullValues: values,
          focus: descend ? active?.[0] : root ?? range?.[0], roles, emptyText: '空序列' });
      }
      path.textContent = stack.length ? '递归路径 ' + stack.map(({ id }) => id).join(' → ') : '';
      path.hidden = !stack.length;
    },
    destroy() { sequences.forEach(({ row }) => row.clear()); },
  };
}
