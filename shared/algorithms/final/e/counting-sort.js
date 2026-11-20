// shared/algorithms/final/e/counting-sort.js
const SOURCE_VERSION = 'counting-sort-c-v2';
const MAX_RANGE = 5000;
const NO_RESULT = Symbol('no-result');

const SOURCE_LINES = [
  { lineId: 'init', text: 'void counting_sort(int arr[], int n) {' },
  { lineId: 'empty', text: '  if (n <= 0) return;' },
  { lineId: 'range', text: '  int minv = arr[0], maxv = arr[0];' },
  { lineId: 'range-scan', text: '  for(int i=1;i<n;i++){ if(arr[i]<minv) minv=arr[i]; if(arr[i]>maxv) maxv=arr[i]; }' },
  { lineId: 'validate', text: '  long long width = (long long)maxv - minv + 1; if (width > 5000) return;' },
  { lineId: 'alloc', text: '  int k = (int)width; int* cnt = new int[k];' },
  { lineId: 'clear', text: '  for(int i=0;i<k;i++) cnt[i] = 0;' },
  { lineId: 'count', text: '  for(int i=0;i<n;i++) cnt[arr[i]-minv]++;' },
  { lineId: 'prefix', text: '  for(int i=1;i<k;i++) cnt[i] += cnt[i-1];' },
  { lineId: 'fill', text: '  int* out = new int[n]; for(int i=n-1;i>=0;i--) out[--cnt[arr[i]-minv]] = arr[i];' },
  { lineId: 'copy', text: '  for(int i=0;i<n;i++) arr[i] = out[i];' },
  { lineId: 'release', text: '  delete[] out; delete[] cnt;' },
  { lineId: 'done', text: '}' },
];

/**
 * 计数排序：增量 countDiff 快照，避免回放体积爆炸
 * @param {{list:number[]}} input
 * @returns {{steps:any[],result:number[]|null,sourceVersion:string,sourceLines:typeof SOURCE_LINES}}
 */
export function generateCountingSortSteps({ list }) {
  const steps = [];
  const input = Array.isArray(list) ? [...list] : [];
  const clone = (o) => JSON.parse(JSON.stringify(o));

  function record(event, lineId, description, vars = {}, finalResult = NO_RESULT) {
    const done = finalResult !== NO_RESULT;
    steps.push({
      schemaVersion: '1.0',
      algorithm: 'counting-sort',
      stepIndex: steps.length,
      sourceVersion: SOURCE_VERSION,
      event,
      lineId,
      array: [...input],
      variables: { input: [...input], ...clone(vars) },
      description,
      done,
      result: done ? clone(finalResult) : null,
    });
  }

  record('init', 'init', `原始数组 [${input.join(',')}]，开始计数排序`);

  for (const num of input) {
    if (!Number.isInteger(num)) {
      record('error', 'validate', `非法元素 ${num}：计数排序只接受整数`, {}, null);
      return { steps, result: null, sourceVersion: SOURCE_VERSION, sourceLines: SOURCE_LINES };
    }
  }

  if (input.length === 0) {
    record('done', 'empty', '数组为空，无需排序', {}, []);
    return { steps, result: [], sourceVersion: SOURCE_VERSION, sourceLines: SOURCE_LINES };
  }

  const min = Math.min(...input);
  const max = Math.max(...input);
  const range = max - min + 1;
  if (range > MAX_RANGE) {
    record('error', 'validate', `值域跨度 ${range} 超过上限 ${MAX_RANGE}，拒绝生成轨迹`, {}, null);
    return { steps, result: null, sourceVersion: SOURCE_VERSION, sourceLines: SOURCE_LINES };
  }

  const count = new Array(range).fill(0);
  record('count_init', 'alloc', `最小值 ${min}，最大值 ${max}，申请计数数组长度 ${range}`, { min, max, countLength: range });

  for (const val of input) {
    const idx = val - min;
    const old = count[idx];
    count[idx] += 1;
    record('count_inc', 'count', `统计数值 ${val} 的频次，cnt[${idx}] = ${count[idx]}`, {
      min,
      max,
      value: val,
      countDiff: { index: idx, old, new: count[idx] },
    });
  }

  for (let i = 1; i < range; i++) {
    const oldVal = count[i];
    count[i] = count[i] + count[i - 1];
    record('prefix_sum', 'prefix', `前缀和：cnt[${i}] = ${count[i]}`, {
      min,
      max,
      countDiff: { index: i, old: oldVal, new: count[i] },
    });
  }

  const output = new Array(input.length).fill(null);
  for (let p = input.length - 1; p >= 0; p--) {
    const val = input[p];
    const cIdx = val - min;
    const pos = count[cIdx] - 1;
    output[pos] = val;
    const oldCnt = count[cIdx];
    count[cIdx] -= 1;
    record('place_output', 'fill', `把 ${val} 放到输出位置 ${pos}`, {
      min,
      max,
      output: [...output],
      countDiff: { index: cIdx, old: oldCnt, new: count[cIdx] },
    });
  }

  const finalResult = [...output];
  record('done', 'done', `排序完成：[${finalResult.join(',')}]`, { min, max, output: [...output] }, finalResult);
  return { steps, result: [...output], sourceVersion: SOURCE_VERSION, sourceLines: SOURCE_LINES };
}
