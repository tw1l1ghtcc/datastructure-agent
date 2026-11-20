import { arithmeticSource, calculate, convertSource, expressionFailure, expressionInput, ExpressionError, toPostfix, tokensOf } from './expression-common.js';
import { fSource, fTrace } from './f-trace.js';

const source = fSource('expression-evaluation', convertSource + arithmeticSource + `
bool evaluate_expression(const char *text, bool postfix, double *result) { // @init
  FToken output[64];
  int n = postfix ? f_tokens(text, true, output) : f_postfix(text, output); // @postfix
  if (n < 0) return false;
  double stack[64]; int top = 0;
  for (int i = 0; i < n; ++i) {
    if (output[i].op == 0) stack[top++] = output[i].value; // @value-push
    else {
      if (top < 2) return false; // @underflow
      double right = stack[--top], left = stack[--top], value;
      if (!f_calculate(output[i].op, left, right, &value)) return false; // @arithmetic
      stack[top++] = value; // @compute
    }
  }
  if (top != 1) return false; // @residue
  *result = stack[0]; return true; // @done
}
`);

export function generateExpressionEvaluationSteps(input) {
  const text = expressionInput(input);
  const mode = input?.mode ?? 'infix';
  if (mode !== 'infix' && mode !== 'postfix') throw new TypeError('输入格式必须为 infix 或 postfix。');
  const operators = [], output = [], stack = [];
  const trace = fTrace(source, { mode, operators, output, stack });
  trace.record('init', '初始化操作数栈。');
  try {
    if (mode === 'infix') toPostfix(text, trace, operators, output);
    else output.push(...tokensOf(text, true));
    trace.record('postfix', '按后缀序列从左到右求值。');
    for (const token of output) {
      const info = { token: token.text, index: token.index };
      if (token.value !== undefined) {
        stack.push(token.value);
        trace.record('value-push', '将操作数压入栈。', info);
      } else {
        if (stack.length < 2) throw new ExpressionError(token.index, '运算符缺少两个操作数', 'underflow');
        const right = stack.pop();
        const left = stack.pop();
        const value = calculate(token.text, left, right, token.index);
        stack.push(value);
        trace.record('compute', '先弹出右操作数，再弹出左操作数，计算后将结果压回栈。', { ...info, left, right, value });
      }
    }
    if (stack.length !== 1) throw new ExpressionError(text.length, '求值结束时栈中必须恰有一个值', 'residue');
    return trace.finish('done', '表达式结果为 ' + stack[0] + '。', { value: stack[0] });
  } catch (error) {
    return expressionFailure(trace, error);
  }
}
