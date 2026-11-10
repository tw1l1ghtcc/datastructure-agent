import { objectInput, integers, integer, LIMITS, recorder, sourceLines } from './util.js';
import { MULTIWAY_SOURCE } from './sources.js';
export const SOURCE_VERSION = 'c-multiway-merge-v1';
export const SOURCE_LINES = sourceLines(MULTIWAY_SOURCE, 'multiway');
export const DEFAULT_INPUT = { runs: [[1, 4], [2, 3], [0, 5]], k: 2 };

export function generateMultiwayMergeSteps(input) {
  objectInput(input);
  const k = integer(input.k === undefined ? 2 : input.k, 'k', 2, LIMITS.runs);
  if (!Array.isArray(input.runs) || input.runs.length > LIMITS.runs) throw new TypeError('runs 必须是最多32段的二维数组');
  let total = 0;
  let runs = input.runs.map((run, i) => {
    const a = integers(run, `runs[${i}]`);
    total += a.length;
    if (total > LIMITS.elements) throw new TypeError('所有段合计最多128个元素');
    if (a.some((v, j) => j && a[j - 1] > v)) throw new TypeError(`runs[${i}] 必须非递减有序`);
    return a;
  });
  const rec = recorder('multiway-merge', SOURCE_VERSION, SOURCE_LINES);
  let pass = 0;
  rec.add('init', 'init', `以最多 ${k} 路归并输入有序段。`, { runs, k, pass, positions: [], output: [] });
  if (runs.some(r => !r.length)) {
    runs = runs.filter(r => r.length);
    rec.add('skip-empty', 'skip-empty', '跳过空段，保留所有非空段中的重复值。', { runs, k, pass, positions: [], output: [] });
  }
  while (runs.length > 1) {
    pass++;
    const producedRuns = [];
    rec.add('pass-start', 'pass-start', `开始第 ${pass} 趟。`, { runs, k, pass, producedRuns, positions: [], output: [] });
    for (let groupStart = 0; groupStart < runs.length; groupStart += k) {
      const group = runs.slice(groupStart, groupStart + k), positions = group.map(() => 0), output = [];
      const view = extra => ({ runs, k, pass, groupStart, group, positions, output, producedRuns, ...extra });
      for (;;) {
        const candidates = group.flatMap((r, i) => positions[i] < r.length ? [{ run: groupStart + i, index: positions[i], value: r[positions[i]] }] : []);
        if (!candidates.length) break;
        // 相等时先取段号较小的一项，与 C 展示代码的严格 < 选择一致。
        let selected = candidates[0];
        for (const c of candidates) if (c.value < selected.value) selected = c;
        rec.add('select', 'select', `选中段 ${selected.run} 的 ${selected.value}。`, view({ candidates, selected }));
        output.push(selected.value); positions[selected.run - groupStart]++;
        rec.add('output', 'output', `输出 ${selected.value} 并推进来源游标。`, view({ candidates: [], selected }));
      }
      producedRuns.push([...output]);
      rec.add('run-end', 'run-end', '本批归并完成。', view({ candidates: [], selected: null }));
    }
    runs = producedRuns;
    rec.add('pass-end', 'pass-end', `第 ${pass} 趟结束，剩 ${runs.length} 段。`, { runs, k, pass, positions: [], output: [] });
  }
  const result = runs[0] ?? [];
  rec.add('done', 'done', `归并完成，共 ${result.length} 个元素，${pass} 趟。`, { runs, k, pass, positions: [], output: result }, result);
  return rec.finish(result);
}
