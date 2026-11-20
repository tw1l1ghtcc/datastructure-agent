import { convertSource, expressionFailure, expressionInput, toPostfix } from './expression-common.js';
import { fSource, fTrace } from './f-trace.js';

const source = fSource('infix-to-postfix', convertSource + `
int infix_to_postfix(const char *text, FToken output[]) { // @init
  return f_postfix(text, output);
}
`);

export function generateInfixToPostfixSteps(input) {
  const text = expressionInput(input);
  const operators = [], output = [];
  const trace = fTrace(source, { operators, output });
  trace.record('init', '从空的输出序列和运算符栈开始。');
  try {
    toPostfix(text, trace, operators, output);
    return trace.finish('converted', '转换完成。', output.map(token => token.text));
  } catch (error) {
    return expressionFailure(trace, error);
  }
}
