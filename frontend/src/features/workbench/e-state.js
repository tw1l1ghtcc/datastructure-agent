import { stateText } from './c-algorithms.js';

export function linkedChain({ nodes, headId }) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const visited = new Set();
  const chain = [];
  let id = headId;
  while (byId.has(id) && !visited.has(id)) {
    const node = byId.get(id);
    chain.push(node);
    visited.add(id);
    id = node.next;
  }
  return chain;
}

export function countingSnapshot(run, step, init) {
  if (!init || step.stepIndex < init.stepIndex) return null;
  const { min, countLength } = init.variables;
  const counts = Array(countLength).fill(0);
  let current = 0;
  // Use only deltas through the displayed step, including during a backward seek.
  for (let i = init.stepIndex + 1; i <= step.stepIndex; i++) {
    const change = run.steps[i].variables.countDiff;
    if (change) {
      counts[change.index] = change.new;
      current = change.index;
    }
  }
  return { min, counts, current };
}

export function eVariableText(key, step, input, previous) {
  const v = step.variables;
  switch (key) {
    case 'chain':
      return linkedChain(v).map(node => node.value).join(' → ') || '空';
    case 'removed': {
      if (!step.event.startsWith('delete_') || !previous) return '—';
      const currentIds = new Set(linkedChain(v).map(node => node.id));
      return linkedChain(previous.variables).find(node => !currentIds.has(node.id))?.id ?? '—';
    }
    case 'shape':
      return v.rows + ' × ' + v.cols;
    case 'countDiff':
      return v.countDiff ? '下标 ' + v.countDiff.index + '：' + v.countDiff.old + ' → ' + v.countDiff.new : '—';
    case 'value':
      return input.value ?? step.result?.value ?? '—';
    case 'pos':
      return v.pos ?? input.pos ?? '—';
    case 'k':
      return v.k ?? input.k ?? '—';
    default:
      return stateText(v[key]);
  }
}
