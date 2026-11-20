import { defineSource, createTrace } from '../g/g-trace.js';

export function fSource(algorithm, code) {
  return defineSource(algorithm, code.trim().split('\n').map((line, index) => {
    const match = /^(.*?)\s*\/\/ @([\w-]+)$/.exec(line);
    return match ? [match[2], match[1]] : ['source-' + (index + 1), line];
  }));
}

export function fTrace(source, state) {
  const trace = createTrace(source);
  return {
    record(line, description, extra = {}) {
      trace.record(line, line, description, { ...state, ...extra });
    },
    finish(line, description, result, extra = {}) {
      return trace.finish(line, description, { ...state, ...extra }, structuredClone(result));
    },
  };
}

export function characters(value, label, limit = 120) {
  if (typeof value !== 'string') throw new TypeError(label + '必须是字符串。');
  const chars = Array.from(value);
  if (chars.length > limit) throw new RangeError(label + '最多 ' + limit + ' 个字符。');
  return chars;
}
