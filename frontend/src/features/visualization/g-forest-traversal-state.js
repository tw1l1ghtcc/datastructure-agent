import { createArrayAnimationRow } from './array-animation-row.js';
import { compactLabel } from './trace-animation.js';

export function createForestTraversalState(run) {
  const element = document.createElement('div');
  element.className = 'g-forest-traversal-state';
  const stackRow = createArrayAnimationRow('g-forest-stack');
  const orderRow = createArrayAnimationRow('g-forest-order');
  element.append(stackRow.element, orderRow.element);

  return {
    element,
    label: '递归栈与访问顺序',
    canvasLabel: '森林遍历画布',
    showStep(step) {
      const { stack, order, currentNode, mode } = step.variables;
      const previousStack = run.steps[step.stepIndex - 1]?.variables.stack;
      const stackIds = stack.map(({ id }) => id);
      const active = stack.length - 1;
      const last = order.length - 1;
      const visiting = step.event === 'visit';
      let stackDetail = '栈顶在右';
      if (step.event === 'enter') stackDetail = `${currentNode} 入栈`;
      if (step.event === 'return') stackDetail = `${currentNode} 即将出栈`;
      if (previousStack?.length > stack.length) stackDetail = `${previousStack.at(-1).id} 已出栈`;

      if (!step.stepIndex) {
        stackRow.rewind();
        orderRow.rewind();
      }
      stackRow.show({
        title: '递归栈', detail: stackDetail, values: stackIds.map(id => compactLabel(id, 8)), fullValues: stackIds,
        labels: stack.map(({ level }) => '第 ' + level + ' 层'), focus: active, roles: { swap: active }, emptyText: '栈为空',
      });
      orderRow.show({
        title: '访问顺序', detail: visiting ? `${mode === 'preorder' ? '先根' : '后根'}访问 ${currentNode}` : '',
        values: order.map(id => compactLabel(id, 8)), fullValues: order, focus: last,
        roles: { done: order.map((_, index) => index), swap: visiting ? last : undefined }, emptyText: '尚未访问结点',
      });
    },
    destroy() {
      stackRow.clear();
      orderRow.clear();
    },
  };
}
