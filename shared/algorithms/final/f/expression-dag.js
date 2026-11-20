import { arithmeticSource, calculate, convertSource, expressionFailure, expressionInput, ExpressionError, toPostfix } from './expression-common.js';
import { fSource, fTrace } from './f-trace.js';

const source = fSource('expression-dag', convertSource + arithmeticSource + `
struct FNode { char op; int left, right; double literal; };
bool expression_dag(const char *text, FNode nodes[], int *count, int *root, double cache[]) { // @init
  FToken output[64]; int stack[64], top = 0;
  int n = f_postfix(text, output);
  if (n < 0) return false;
  *count = 0;
  for (int i = 0; i < n; ++i) {
    FNode node = {output[i].op, -1, -1, output[i].value};
    if (node.op) {
      if (top < 2) return false; // @build-error
      node.right = stack[--top]; node.left = stack[--top];
    }
    int id = 0;
    while (id < *count && (nodes[id].op != node.op || nodes[id].left != node.left ||
                           nodes[id].right != node.right || nodes[id].literal != node.literal)) ++id;
    if (id == *count) nodes[(*count)++] = node; // @add-node
    stack[top++] = id; // @reuse
  }
  if (top != 1) return false; // @root-error
  *root = stack[0]; // @root
  for (int i = 0; i < *count; ++i) {
    FNode node = nodes[i];
    if (!node.op) cache[i] = node.literal; // @literal
    else {
      if (node.left < 0 || node.right < 0 || node.left >= i || node.right >= i) return false; // @dependency
      double value;
      if (!f_calculate(node.op, cache[node.left], cache[node.right], &value)) return false; // @arithmetic
      cache[i] = value; // @evaluate
    }
  }
  return true; // @done
}
`);

export function generateExpressionDagSteps(input) {
  const text = expressionInput(input);
  const operators = [], output = [], nodes = [], edges = [], stack = [], cache = [], order = [];
  const indexes = new Map();
  const trace = fTrace(source, { operators, output, nodes, edges, stack, cache, order });
  trace.record('init', '先生成后缀词元，再按依赖建立表达式图。');
  try {
    toPostfix(text, trace, operators, output);
    for (const token of output) {
      const isLiteral = token.value !== undefined;
      if (!isLiteral && stack.length < 2) throw new ExpressionError(token.index, '子表达式缺少操作数', 'build-error');
      const right = isLiteral ? null : stack.pop();
      const left = isLiteral ? null : stack.pop();
      const key = isLiteral ? 'literal:' + token.value : JSON.stringify([token.text, left, right]);
      let id = indexes.get(key);
      const reused = id !== undefined;
      if (!reused) {
        id = nodes.length;
        indexes.set(key, id);
        nodes.push({ id, token: token.text, value: token.value ?? null, left, right, index: token.index });
        if (!isLiteral) edges.push([left, id, '左操作数'], [right, id, '右操作数']);
      }
      stack.push(id);
      trace.record(reused ? 'reuse' : 'add-node', reused ? '复用已有的相同子表达式。' : '建立新节点及操作数依赖。', { currentNode: id });
    }
    if (stack.length !== 1) throw new ExpressionError(text.length, '无法确定表达式的唯一根节点', 'root-error');
    const root = stack[0];
    trace.record('root', '根节点确定，按依赖顺序计算。', { root });
    for (const node of nodes) {
      if (node.value === null && (!Object.hasOwn(cache, node.left) || !Object.hasOwn(cache, node.right))) {
        throw new ExpressionError(node.index, '节点引用了尚未求值的依赖', 'dependency');
      }
      const value = node.value ?? calculate(node.token, cache[node.left], cache[node.right], node.index);
      cache.push(value);
      order.push(node.id);
      trace.record(node.value !== null ? 'literal' : 'evaluate', '节点 ' + node.id + ' 的缓存结果为 ' + value + '。', { currentNode: node.id, root });
    }
    return trace.finish('done', '根节点结果为 ' + cache[root] + '。', { value: cache[root], root, nodes, edges, order }, { root });
  } catch (error) {
    return expressionFailure(trace, error);
  }
}
