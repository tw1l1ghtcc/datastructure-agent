import { objectInput, integers, integer, LIMITS, stableEntryOrder, recorder, sourceLines } from './util.js';
import { REPLACEMENT_SOURCE } from './sources.js';
export const SOURCE_VERSION = 'c-replacement-selection-v1';
export const SOURCE_LINES = sourceLines(REPLACEMENT_SOURCE, 'replacement');
export const DEFAULT_INPUT = { array: [4, 5, 1, 2, 6], capacity: 2 };

export function generateReplacementSelectionSteps(input) {
  objectInput(input);
  const array = integers(input.array, 'array');
  const capacity = integer(input.capacity === undefined ? 2 : input.capacity, 'capacity', 1, LIMITS.capacity);
  const rec = recorder('replacement-selection', SOURCE_VERSION, SOURCE_LINES);
  let active = [], frozen = [], readIndex = 0, currentRun = [];
  const runs = [];
  const view = extra => ({ array, capacity, active, frozen, readIndex, runs, currentRun, runIndex: runs.length, ...extra });
  rec.add('init', 'init', '建立有限缓冲区，段内按非递减顺序输出。', view({ selected: null }));
  while (readIndex < array.length && active.length < capacity) {
    active.push({ value: array[readIndex], index: readIndex }); readIndex++;
  }
  active.sort(stableEntryOrder);
  rec.add('load', 'load', `初始载入 ${active.length} 项。`, view({ selected: null }));
  while (active.length || frozen.length) {
    if (!active.length) {
      runs.push([...currentRun]); currentRun = [];
      rec.add('run-end', 'run-end', '活动区为空，结束当前有序段。', view({ selected: null }));
      active = frozen.sort(stableEntryOrder); frozen = [];
      rec.add('new-run', 'new-run', '解冻缓冲项，开始下一段。', view({ selected: null }));
    }
    const selected = active.shift(); currentRun.push(selected.value);
    rec.add('output', 'output', `输出最小活动项 ${selected.value}。`, view({ selected }));
    if (readIndex < array.length) {
      const next = { value: array[readIndex], index: readIndex }; readIndex++;
      const freeze = next.value < selected.value;
      (freeze ? frozen : active).push(next); active.sort(stableEntryOrder);
      rec.add(freeze ? 'freeze' : 'activate', freeze ? 'freeze' : 'activate', `读入 ${next.value}，${freeze ? '小于本段末值，冻结到下一段' : '进入活动区'}。`, view({ selected, incoming: next }));
    }
  }
  if (currentRun.length) { runs.push([...currentRun]); currentRun = []; }
  rec.add('done', 'done', `生成 ${runs.length} 个有序段。`, view({ selected: null }), runs);
  return rec.finish(runs);
}
