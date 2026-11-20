import { characters, fSource, fTrace } from './f-trace.js';

const source = fSource('bracket-matching', `
int bracket_match(const unsigned long text[], int n) {
  int stack[120], top = 0; // @init
  for (int i = 0; i < n; ++i) {
    unsigned long ch = text[i];
    if (ch == '(' || ch == '[' || ch == '{') {
      stack[top++] = i; // @push
    } else if (ch == ')' || ch == ']' || ch == '}') {
      unsigned long open = ch == ')' ? '(' : (ch == ']' ? '[' : '{');
      if (top == 0 || text[stack[top - 1]] != open) return i; // @mismatch
      --top; // @pop
    } else continue; // @skip
  }
  if (top != 0) return stack[top - 1]; // @unclosed
  return -1; // @done
}
`);

const openings = new Set(['(', '[', '{']);
const expected = { ')': '(', ']': '[', '}': '{' };

export function generateBracketMatchingSteps(input) {
  const text = characters(input?.text, '待检查字符串');
  const stack = [];
  const trace = fTrace(source, { stack });
  trace.record('init', '从空栈开始检查括号。');
  for (const [i, char] of text.entries()) {
    if (openings.has(char)) {
      stack.push({ char, i });
      trace.record('push', '左括号入栈。', { i, char });
    } else if (Object.hasOwn(expected, char)) {
      if (stack.at(-1)?.char !== expected[char]) {
        const reason = stack.length ? 'mismatch' : 'unexpected-close';
        return trace.finish('mismatch', reason === 'mismatch' ? '右括号与栈顶错配。' : '没有可匹配的左括号。',
          { matched: false, index: i, reason }, { i, char, reason: reason === 'mismatch' ? '括号错配' : '多余右括号' });
      }
      stack.pop();
      trace.record('pop', '右括号与栈顶匹配，弹出左括号。', { i, char });
    } else {
      trace.record('skip', '跳过普通字符。', { i, char });
    }
  }
  const last = stack.at(-1);
  if (last) return trace.finish('unclosed', '栈顶左括号尚未闭合。', { matched: false, index: last.i, reason: 'unclosed' }, { ...last, reason: '左括号未闭合' });
  return trace.finish('done', '括号全部匹配。', { matched: true, index: -1, reason: null });
}
