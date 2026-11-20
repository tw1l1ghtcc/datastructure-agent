const whitespace = /[ \t\r\n\f\v]/;
export const precedence = { '+': 1, '-': 1, '*': 2, '/': 2 };

export class ExpressionError extends Error {
  constructor(index, message, line) {
    super(message + '（下标 ' + index + '）');
    this.index = index;
    this.line = line;
  }
}

export function expressionInput(input) {
  const text = input?.expression;
  if (typeof text !== 'string' || text.length > 256) throw new TypeError('表达式必须是最多 256 字符的字符串。');
  return text;
}

export function tokensOf(text, postfix = false) {
  const tokens = [];
  for (let i = 0; i < text.length;) {
    if (whitespace.test(text[i])) { i += 1; continue; }
    const start = i;
    const digits = /^[0-9]+/.exec(text.slice(i));
    if (digits) {
      const value = Number(digits[0]);
      if (value > 2147483647) throw new ExpressionError(start, '整数词元超出范围', 'lex-error');
      tokens.push({ text: String(value), value, index: start });
      i += digits[0].length;
    } else if (Object.hasOwn(precedence, text[i]) || (!postfix && '()'.includes(text[i]))) {
      tokens.push({ text: text[i], index: i });
      i += 1;
    } else {
      throw new ExpressionError(start, '无法识别的词元', 'lex-error');
    }
    if (postfix && i < text.length && !whitespace.test(text[i])) {
      throw new ExpressionError(i, '后缀词元须用空白分隔', 'lex-error');
    }
    if (tokens.length > 64) throw new ExpressionError(start, '表达式最多 64 个词元', 'lex-error');
  }
  return tokens;
}

export function toPostfix(text, trace, operators, output) {
  const tokens = tokensOf(text);
  trace.record('lex', '分词完成。', { tokens: tokens.map(token => token.text) });
  let expectingOperand = true;
  for (const token of tokens) {
    const { text: symbol, index } = token;
    const number = token.value !== undefined;
    if (expectingOperand !== (number || symbol === '(')) {
      throw new ExpressionError(index, expectingOperand ? '需要操作数或左括号' : '需要二元运算符或右括号', 'syntax');
    }
    const current = { token: symbol, index };
    if (number) {
      output.push(token);
      trace.record('emit-number', '操作数直接加入后缀序列。', current);
    } else if (symbol === '(') {
      operators.push(token);
      trace.record('push-open', '左括号入栈，暂时隔开两侧运算符。', current);
    } else if (symbol === ')') {
      while (operators.length && operators.at(-1).text !== '(') {
        output.push(operators.pop());
        trace.record('close-pop', '弹出括号里的运算符。', current);
      }
      if (!operators.length) throw new ExpressionError(index, '没有与右括号配对的左括号', 'missing-open');
      operators.pop();
      trace.record('close-pair', '括号匹配，移除左括号。', current);
    } else {
      while (operators.length && precedence[operators.at(-1).text] >= precedence[symbol]) {
        output.push(operators.pop());
        trace.record('precedence', '栈顶运算符优先级较高或相同，先输出。', current);
      }
      operators.push(token);
      trace.record('push-op', '当前运算符入栈。', current);
    }
    expectingOperand = !number && symbol !== ')';
  }
  if (expectingOperand) throw new ExpressionError(text.length, '表达式缺少操作数', 'missing-operand');
  while (operators.length) {
    const token = operators.at(-1);
    if (token.text === '(') throw new ExpressionError(token.index, '左括号未闭合', 'missing-close');
    output.push(operators.pop());
    trace.record('drain', '输入结束，弹出剩余运算符。', { token: token.text });
  }
}

export function calculate(op, left, right, index) {
  if (op === '/' && right === 0) throw new ExpressionError(index, '除数为零', 'arithmetic');
  const value = op === '+' ? left + right : op === '-' ? left - right : op === '*' ? left * right : left / right;
  if (!Number.isFinite(value)) throw new ExpressionError(index, '运算结果超出数值范围', 'arithmetic');
  return value === 0 ? 0 : value;
}

export function expressionFailure(trace, error) {
  if (!(error instanceof ExpressionError)) throw error;
  return trace.finish(error.line, error.message, { error: error.message, index: error.index }, { index: error.index });
}

export const tokenizeSource = `
struct FToken { char op; double value; int index; };
bool f_space(char c) { return c == ' ' || (c >= '\\t' && c <= '\\r'); }
int f_priority(char c) { return c == '+' || c == '-' ? 1 : (c == '*' || c == '/' ? 2 : 0); }
int f_tokens(const char *text, bool postfix, FToken tokens[]) {
  int count = 0;
  for (int i = 0; text[i];) {
    if (f_space(text[i])) { ++i; continue; }
    if (count == 64) return -1;
    FToken token = {0, 0, i};
    if (text[i] >= '0' && text[i] <= '9') {
      for (; text[i] >= '0' && text[i] <= '9'; ++i) {
        token.value = token.value * 10 + (text[i] - '0');
        if (token.value > 2147483647.0) return -1;
      }
    } else if (f_priority(text[i]) || (!postfix && (text[i] == '(' || text[i] == ')'))) {
      token.op = text[i++];
    } else return -1;
    if (postfix && text[i] && !f_space(text[i])) return -1;
    tokens[count++] = token;
  }
  return count;
}
`;

export const convertSource = tokenizeSource + `
int f_postfix(const char *text, FToken output[]) {
  FToken tokens[64], operators[64];
  int count = f_tokens(text, false, tokens); // @lex
  if (count < 0) return -1; // @lex-error
  int top = 0, length = 0;
  bool expecting_operand = true;
  for (int i = 0; i < count; ++i) {
    FToken token = tokens[i];
    char op = token.op;
    if (expecting_operand != (op == 0 || op == '(')) return -1; // @syntax
    if (op == 0) output[length++] = token; // @emit-number
    else if (op == '(') operators[top++] = token; // @push-open
    else if (op == ')') {
      while (top && operators[top - 1].op != '(') output[length++] = operators[--top]; // @close-pop
      if (!top) return -1; // @missing-open
      --top; // @close-pair
    } else {
      while (top && f_priority(operators[top - 1].op) >= f_priority(op))
        output[length++] = operators[--top]; // @precedence
      operators[top++] = token; // @push-op
    }
    expecting_operand = op != 0 && op != ')';
  }
  if (expecting_operand) return -1; // @missing-operand
  while (top) {
    if (operators[top - 1].op == '(') return -1; // @missing-close
    output[length++] = operators[--top]; // @drain
  }
  return length; // @converted
}
`;

export const arithmeticSource = `
bool f_calculate(char op, double left, double right, double *result) {
  if (op == '/' && right == 0) return false;
  double value = op == '+' ? left + right : (op == '-' ? left - right : (op == '*' ? left * right : left / right));
  if (!(value <= 1.7976931348623157e308 && value >= -1.7976931348623157e308)) return false;
  *result = value == 0 ? 0 : value;
  return true;
}
`;
