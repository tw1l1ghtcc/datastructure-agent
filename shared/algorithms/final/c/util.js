// C 包独立辅助模块；公共 Step 字段沿用现有算法，结构数据放在 variables。
export const LIMITS = Object.freeze({ keys: 64, queries: 64, runs: 32, elements: 128, capacity: 64 });
export function objectInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('输入必须为对象');
  return input;
}
export function integer(value, name, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new TypeError(`${name} 必须是 ${min} 到 ${max} 之间的安全整数`);
  return value;
}
export function integers(values, name, max = LIMITS.elements, min = Number.MIN_SAFE_INTEGER) {
  if (!Array.isArray(values) || values.length > max) throw new TypeError(`${name} 必须是数组，最多 ${max} 项`);
  // for...of 同时拒绝稀疏数组中的 undefined。
  for (const value of values) integer(value, name, min);
  return [...values];
}
export function treeInput(input) {
  objectInput(input);
  const keys = integers(input.keys ?? [], 'keys', LIMITS.keys);
  const queries = integers(input.queries ?? [], 'queries', LIMITS.queries);
  if (Object.hasOwn(input, 'target')) { integer(input.target, 'target'); queries.push(input.target); }
  if (queries.length > LIMITS.queries) throw new TypeError('查询总数最多64项');
  return { keys, queries };
}
export function checkedAdd(a, b) {
  const value = a + b;
  if (!Number.isSafeInteger(value)) throw new TypeError('合并权重或累计代价超出安全整数范围');
  return value;
}
export const stableEntryOrder = (a, b) => a.value - b.value || a.index - b.index;
export function recorder(algorithm, sourceVersion, sourceLines) {
  const steps = [], ids = new Set(sourceLines.map(line => line.lineId));
  function add(event, lineId, description, variables, result) {
    if (!ids.has(lineId)) throw new Error(`未定义源码标识 ${lineId}`);
    steps.push(structuredClone({ schemaVersion: '1.0', algorithm, stepIndex: steps.length,
      event, sourceVersion, lineId, description, variables, done: event === 'done', result: event === 'done' ? result : null }));
  }
  return { add, finish: result => ({ steps, result: structuredClone(result), sourceVersion, sourceLines: structuredClone(sourceLines) }) };
}
export function sourceLines(text, prefix) {
  const ids = new Set();
  return text.trim().split('\n').map((line, i) => {
    const tag = line.match(/\/\*@([a-z-]+)\*\//);
    const lineId = tag?.[1] ?? `${prefix}-source-${i + 1}`;
    if (ids.has(lineId)) throw new Error(`重复源码标识 ${lineId}`);
    ids.add(lineId);
    return { lineId, text: line.replace(/\s*\/\*@[a-z-]+\*\//, '') };
  });
}
