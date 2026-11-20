import { characters, fSource, fTrace } from './f-trace.js';

const source = fSource('naive-string-match', `
int naive_match(const unsigned long text[], int n, const unsigned long pattern[], int m, int matches[]) {
  int count = 0; // @init
  if (m == 0) { matches[0] = 0; return 1; } // @empty
  for (int start = 0; start + m <= n; ++start) { // @align
    int j = 0;
    for (; j < m; ++j) {
      if (text[start + j] != pattern[j]) break; // @compare
    }
    if (j == m) matches[count++] = start; // @match
  }
  return count; // @done
}
`);

export function generateNaiveStringMatchSteps(input) {
  const text = characters(input?.text, '主串');
  const pattern = characters(input?.pattern, '模式串', 48);
  const matches = [];
  const trace = fTrace(source, { matches });
  trace.record('init', '从主串的第 0 位对齐模式串。');
  if (!pattern.length) return trace.finish('empty', '空模式只匹配下标 0。', [0], { matches: [0] });

  for (let start = 0; start + pattern.length <= text.length; start += 1) {
    trace.record('align', '将模式串对齐到下标 ' + start + '。', { start });
    let j = 0;
    for (; j < pattern.length; j += 1) {
      const i = start + j;
      const equal = text[i] === pattern[j];
      trace.record('compare', equal ? '两字符相同，继续比较。' : '字符失配，下一个候选起点向右移一位。', { start, i, j, equal });
      if (!equal) break;
    }
    if (j === pattern.length) {
      matches.push(start);
      trace.record('match', '在下标 ' + start + ' 匹配，继续检查下一个起点。', { start });
    }
  }
  return trace.finish('done', '匹配结束，共找到 ' + matches.length + ' 处。', matches);
}
