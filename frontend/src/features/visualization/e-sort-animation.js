import { countingSnapshot } from '../workbench/e-state.js';
import { animateArrayValue, createArrayAnimationRow } from './array-animation-row.js';
import { createRadixBuckets } from './e-radix-buckets.js';
import { createExplanationPanel } from './explanation-panel.js';
import { describeStructuredStep } from './structured-explanation.js';
import { windowStart } from './trace-animation.js';

const digitNames = ['个位', '十位', '百位', '千位', '万位', '十万位', '百万位', '千万位', '亿位', '十亿位'];

function backfillSource(length, output) {
  // Each placement fills one previously empty slot, including when duplicate values are placed.
  return length - output.filter(value => value != null).length;
}

function inputRow(step, title, source, detail) {
  return {
    title, detail, values: step.array, focus: source, emptyText: '数组为空',
    roles: source == null ? {} : { focus2: [source] },
  };
}

function outputRow(title, output, destination, detail, emptyText) {
  return {
    title, detail, values: output, focus: destination, emptyText,
    roles: destination == null ? {} : { added: [destination] },
  };
}

function createRadixFrame(run) {
  const countStarts = new Map(run.steps.filter(step => step.event === 'count-init')
    .map(step => [step.variables.exp, step.stepIndex]));
  const emptySlots = run.input.list.map(() => null);

  return function radixFrame(step) {
    const { cnt, exp, tmp } = step.variables;
    const previous = run.steps[step.stepIndex - 1]?.variables;
    const { event, array, done } = step;
    const countStart = countStarts.get(exp);
    const counting = event === 'count-digit';
    const summing = event === 'prefix';
    const writing = event === 'place';
    const copying = event === 'copy';
    const source = counting ? step.stepIndex - countStart - 1 : writing ? backfillSource(array.length, tmp) : null;
    const digit = source == null ? null : Math.floor(array[source] / exp) % 10;
    const bucket = summing ? step.stepIndex - countStart - array.length : digit;
    const digitName = exp && digitNames[Math.log10(exp)];
    const destination = writing ? cnt[digit] : null;
    const buckets = copying ? previous?.cnt : cnt;
    const output = copying ? previous?.tmp : tmp;
    const filling = writing || copying || event === 'fill-tmp';
    const bucketTitle = filling ? '回填游标' : summing ? '累计计数' : '数位频次';
    const firstTitle = done ? '排序结果' : '当前数组';
    const firstDetail = source != null ? `A[${source}] 的${digitName}是 ${digit}`
      : copying ? '已写回本轮结果' : digitName ? `处理${digitName} · 位权 ${exp}` : '';
    const bucketDetail = summing ? `cnt[${bucket}] += cnt[${bucket - 1}]`
      : bucket != null ? `数位 ${bucket} · ${previous.cnt[bucket]} → ${cnt[bucket]}`
        : filling && !copying ? '先减 1，再按新值写入' : '';
    const members = Array.from({ length: 10 }, () => []);
    if (buckets && event !== 'count-init') {
      const input = run.steps[countStart].array;
      input.slice(0, counting ? source + 1 : input.length).forEach((value, index) => {
        members[Math.floor(value / exp) % 10].push({ value, index });
      });
    }
    return [
      inputRow(step, firstTitle, source, firstDetail),
      {
        title: bucketTitle, detail: bucketDetail, values: buckets, focus: bucket, members, source,
        placedFrom: copying ? 0 : writing ? source : null,
        related: summing ? bucket - 1 : null,
        emptyText: done ? '数位处理完毕' : '等待本轮计数',
      },
      outputRow('本轮输出', done ? [] : output ?? emptySlots, destination,
        writing ? `写入下标 ${destination}` : copying ? '本轮输出已写回' : '',
        done ? '结果见上方数组' : '数组为空'),
    ];
  };
}

function createCountingFrame(run) {
  const init = run.steps.find(step => step.event === 'count_init');
  const emptySlots = run.input.list.map(() => null);

  return function countingFrame(step) {
    const { countDiff, output } = step.variables;
    const { event, array, done } = step;
    const summing = event === 'prefix_sum';
    const writing = event === 'place_output';
    const source = event === 'count_inc' ? step.stepIndex - init.stepIndex - 1
      : writing ? backfillSource(array.length, output) : null;
    const destination = writing ? countDiff.new : null;
    const snapshot = countingSnapshot(run, step, init);
    const countTitle = writing || (done && snapshot) ? '回填游标' : summing ? '累计计数' : '数值频次';
    const size = 21;
    const first = snapshot ? windowStart(snapshot.counts.length, size, snapshot.current) : 0;
    const shown = snapshot?.counts.slice(first, first + size) ?? [];
    const labels = shown.map((_, offset) => snapshot.min + first + offset);
    const focus = snapshot ? snapshot.current - first : null;
    const largeRange = snapshot?.counts.length > size;
    const range = largeRange ? `下标 ${first}–${first + shown.length - 1}，共 ${snapshot.counts.length} 项` : '';
    const detail = countDiff ? `数值 ${snapshot.min + countDiff.index} · ${countDiff.old} → ${countDiff.new}` : '格下为数值';

    return [
      inputRow(step, '输入数组', source, source == null ? '' : `读取 A[${source}]`),
      {
        title: [countTitle, range].filter(Boolean).join(' · '), detail, values: shown, labels, focus,
        roles: countDiff ? { swap: [focus], focus2: summing ? [focus - 1] : [] } : {},
        emptyText: done ? '没有可统计的数值' : '等待确定最小值和最大值',
      },
      outputRow(done ? '排序结果' : '输出数组', output ?? emptySlots, destination,
        writing ? `写入下标 ${destination}` : '', '数组为空'),
    ];
  };
}

export function createESortAnimation(host, explainHost, run, config) {
  const radix = run.algorithm === 'radix-sort';
  const frameFor = radix ? createRadixFrame(run) : createCountingFrame(run);
  const middle = radix ? createRadixBuckets() : createArrayAnimationRow('e-counts');
  const rows = [createArrayAnimationRow('e-array'), middle, createArrayAnimationRow('e-output')];
  const element = document.createElement('div');
  element.className = 'e-sort-animation';
  element.classList.toggle('e-radix-animation', radix);
  element.dataset.vizEngine = 'plus-e';
  element.append(...rows.map(row => row.element));
  host.append(element);

  const { explain, caption, status } = createExplanationPanel();
  explainHost.replaceChildren(explain);
  let current = null;
  let cancelMove;

  function draw(step) {
    const frames = frameFor(step);
    frames.forEach((frame, index) => rows[index].show(frame));
    if (step.stepIndex === 0) rows.forEach(row => row.rewind());
    return frames;
  }

  function slideValue(step, frames) {
    const counting = step.event === 'count-digit';
    if (!counting && step.event !== 'place') return;
    const bucket = middle.activeBounds();
    const source = frames[0].focus;
    const row = counting ? rows[0].visibleCell(source) : rows[2].visibleCell(frames[2].focus);
    if (!bucket || !row) return;
    const chip = box => ({ left: box.left + (box.width - bucket.width) / 2, top: box.top + (box.height - bucket.height) / 2,
      width: bucket.width, height: bucket.height });
    cancelMove = animateArrayValue(element, step.array[source], chip(counting ? row : bucket), chip(counting ? bucket : row));
  }

  return {
    getStep: () => current,
    showStep(step) {
      cancelMove?.();
      const animate = radix && current?.stepIndex + 1 === step.stepIndex && !matchMedia('(prefers-reduced-motion: reduce)').matches;
      current = step;
      const frames = draw(step);
      if (animate) slideValue(step, frames);
      caption.textContent = step.description;
      status.textContent = describeStructuredStep(run, step, config, 'e');
    },
    playEnterAnimation() {
      if (!current) return;
      cancelMove?.();
      rows.forEach(row => row.clear?.());
      draw(current);
    },
    destroy() {
      cancelMove?.();
      rows.forEach(row => row.clear?.());
      element.remove();
      explain.remove();
    },
  };
}
