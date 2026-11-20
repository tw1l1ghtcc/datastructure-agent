import { characters, fSource, fTrace } from './f-trace.js';

const source = fSource('kmp', `
int kmp(const unsigned long text[], int n, const unsigned long pattern[], int m,
        bool optimized, int matches[]) {
  int prefix[48] = {0}, next[48], nextval[48]; // @init
  if (m == 0) { matches[0] = 0; return 1; } // @empty
  for (int k = 1, p = 0; k < m; ++k) {
    while (p > 0 && pattern[k] != pattern[p]) p = prefix[p - 1]; // @prefix-fallback
    if (pattern[k] == pattern[p]) ++p;
    prefix[k] = p; // @prefix
  }
  next[0] = nextval[0] = -1; // @table-init
  for (int k = 1; k < m; ++k) {
    next[k] = prefix[k - 1];
    nextval[k] = pattern[k] == pattern[next[k]] ? nextval[next[k]] : next[k]; // @table
  }
  int i = 0, j = 0, count = 0;
  while (i < n) {
    if (j < 0 || text[i] == pattern[j]) { // @compare
      ++i; ++j; // @advance
      if (j == m) {
        matches[count++] = i - m;
        j = prefix[m - 1]; // @match
      }
    } else j = optimized ? nextval[j] : next[j]; // @fallback
  }
  return count; // @done
}
`);

export function generateKmpSteps(input) {
  const text = characters(input?.text, '主串');
  const pattern = characters(input?.pattern, '模式串', 48);
  const mode = input?.mode ?? 'next';
  if (mode !== 'next' && mode !== 'nextval') throw new TypeError('跳转方式必须为 next 或 nextval。');
  const prefix = [], next = [], nextval = [], matches = [];
  const trace = fTrace(source, { mode, prefix, next, nextval, matches });
  trace.record('init', '先计算模式串的最长相等真前后缀长度。');
  if (!pattern.length) return trace.finish('empty', '空模式只匹配下标 0。', [0], { matches: [0] });

  prefix.push(0);
  for (let k = 1, p = 0; k < pattern.length; k += 1) {
    while (p > 0 && pattern[k] !== pattern[p]) {
      const previous = p;
      p = prefix[p - 1];
      trace.record('prefix-fallback', '构表时失配，试用更短的前缀。', { k, j: previous, jump: p });
    }
    if (pattern[k] === pattern[p]) p += 1;
    prefix.push(p);
    trace.record('prefix', '位置 ' + k + ' 的真前后缀长度为 ' + p + '。', { k, j: p });
  }
  next.push(-1);
  nextval.push(-1);
  trace.record('table-init', '模式串第 0 位失配时，用 -1 表示直接推进主串。', { k: 0 });
  for (let k = 1; k < pattern.length; k += 1) {
    const fallback = prefix[k - 1];
    next.push(fallback);
    nextval.push(pattern[k] === pattern[fallback] ? nextval[fallback] : fallback);
    trace.record('table', '计算位置 ' + k + ' 的 next 和 nextval。', { k });
  }

  const table = mode === 'next' ? next : nextval;
  let i = 0, j = 0;
  while (i < text.length) {
    const sentinel = j < 0;
    const equal = !sentinel && text[i] === pattern[j];
    if (!sentinel) trace.record('compare', equal ? '两字符相同。' : '字符失配，查跳转表。', { i, j, equal });
    if (sentinel || equal) {
      i += 1;
      j += 1;
      trace.record('advance', sentinel ? '模式下标复位，主串向前一位。' : '两个下标各前进一位。', { i, j });
      if (j === pattern.length) {
        const start = i - pattern.length;
        matches.push(start);
        j = prefix[pattern.length - 1];
        trace.record('match', '在下标 ' + start + ' 匹配，保留可重叠前缀。', { i, j, start });
      }
    } else {
      const previous = j;
      j = table[j];
      trace.record('fallback', '只回退模式串下标，主串下标不动。', { i, j: previous, jump: j });
    }
  }
  return trace.finish('done', '匹配结束，共找到 ' + matches.length + ' 处。', matches);
}
