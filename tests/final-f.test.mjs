import test from 'node:test';
import assert from 'node:assert/strict';
import { generateBracketMatchingSteps as bracket } from '../shared/algorithms/final/f/bracket-matching.js';
import { generateInfixToPostfixSteps as convert } from '../shared/algorithms/final/f/infix-to-postfix.js';
import { generateExpressionEvaluationSteps as evaluate } from '../shared/algorithms/final/f/expression-evaluation.js';
import { generateNaiveStringMatchSteps as naive } from '../shared/algorithms/final/f/naive-string-match.js';
import { generateKmpSteps as kmp } from '../shared/algorithms/final/f/kmp.js';
import { generateExpressionDagSteps as dag } from '../shared/algorithms/final/f/expression-dag.js';
import { generateCriticalPathSteps as critical } from '../shared/algorithms/final/f/critical-path.js';
import { validateRun } from '../frontend/src/features/workbench/input.js';
import { displaySourceLines } from '../frontend/src/features/workbench/display-source.js';

function verify(run, algorithm) {
  assert.equal(validateRun({ runId: 'test', algorithm, ...run }, algorithm).steps.length, run.steps.length);
  assert.equal(run.steps[0].event, 'init');
  assert.deepEqual(run.steps.at(-1).result, run.result);
  assert.equal(run.steps.at(-1).done, true);
  const visible = new Set(displaySourceLines({ algorithm, ...run }).map(line => line.lineId));
  assert.ok(run.steps.every(step => visible.has(step.lineId)), '每个步骤都能高亮一行可见源码');
  assert.ok(run.steps.slice(0, -1).every(step => !step.done && step.result === null));
  assert.deepEqual(JSON.parse(JSON.stringify(run)), run);
  return run;
}

test('F 括号匹配记录入栈、出栈和三个错误位置', () => {
  const run = verify(bracket({ text: '甲([{}])' }), 'bracket-matching');
  assert.equal(run.result.matched, true);
  assert.deepEqual(run.steps.find(step => step.event === 'push').variables.stack, [{ char: '(', i: 1 }]);
  assert.equal(run.steps.find(step => step.event === 'pop').variables.stack.length, 2);
  for (const [text, index, reason] of [['([)]', 2, 'mismatch'], ['😀]', 1, 'unexpected-close'], ['((', 1, 'unclosed']]) {
    assert.deepEqual(verify(bracket({ text }), 'bracket-matching').result, { matched: false, index, reason });
  }
  assert.equal(bracket({ text: '' }).result.matched, true);
});

test('F 中缀转后缀执行优先级与左结合并拒绝非法输入', () => {
  const run = verify(convert({ expression: '12+3*(4-2)' }), 'infix-to-postfix');
  assert.deepEqual(run.result, ['12', '3', '4', '2', '-', '*', '+']);
  assert.ok(run.steps.some(step => step.lineId === 'close-pop'));
  assert.deepEqual(convert({ expression: '8/4/2' }).result, ['8', '4', '/', '2', '/']);
  for (const expression of ['(1+2', '1+2)', '1 2', '-1+2', '1+', '', '2147483648+1', '2^3']) {
    assert.ok(verify(convert({ expression }), 'infix-to-postfix').result.error, expression);
  }
});

test('F 表达式求值处理运算数顺序、小数、除零和栈异常', () => {
  const run = verify(evaluate({ expression: '8 2 3 - /', mode: 'postfix' }), 'expression-evaluation');
  assert.equal(run.result.value, -8);
  assert.equal(run.steps.find(step => step.event === 'compute').variables.right, 3);
  assert.equal(evaluate({ expression: '5/2' }).result.value, 2.5);
  for (const [expression, line] of [['1 0 /', 'arithmetic'], ['2 +', 'underflow'], ['2 3', 'residue'], ['23+', 'lex-error']]) {
    const result = verify(evaluate({ expression, mode: 'postfix' }), 'expression-evaluation');
    assert.equal(result.steps.at(-1).lineId, line);
    assert.ok(result.result.error);
  }
});

test('F 朴素匹配与两种 KMP 对重复字符、空串和 Unicode 给出一致的全部位置', () => {
  for (const [text, pattern, expected] of [
    ['aaaa', 'aa', [0, 1, 2]], ['abc', 'abcd', []], ['abc', '', [0]], ['', '', [0]], ['', 'a', []],
    ['😀甲😀甲', '😀甲', [0, 2]], ['ababaababaca', 'ababaca', [5]],
  ]) {
    assert.deepEqual(verify(naive({ text, pattern }), 'naive-string-match').result, expected);
    for (const mode of ['next', 'nextval']) assert.deepEqual(verify(kmp({ text, pattern, mode }), 'kmp').result, expected);
  }
  const run = kmp({ text: 'abaac', pattern: 'ababaca', mode: 'nextval' });
  const v = run.steps.at(-1).variables;
  assert.deepEqual(v.prefix, [0, 0, 1, 2, 3, 0, 1]);
  assert.deepEqual(v.next, [-1, 0, 0, 1, 2, 3, 0]);
  assert.deepEqual(v.nextval, [-1, 0, -1, 0, -1, 3, -1]);
  const fallback = run.steps.find(step => step.event === 'fallback');
  assert.equal(run.steps[fallback.stepIndex + 1].variables.i, fallback.variables.i);
});

test('F KMP 两种模式对短二元串与独立穷举结果一致', () => {
  const strings = length => Array.from({ length: 2 ** length }, (_, mask) =>
    Array.from({ length }, (_, i) => mask & (1 << i) ? 'b' : 'a').join(''));
  const patterns = [...strings(0), ...strings(1), ...strings(2), ...strings(3)];
  for (const text of strings(6)) for (const pattern of patterns) {
    const expected = pattern.length ? Array.from({ length: text.length }, (_, i) => i).filter(i => text.startsWith(pattern, i)) : [0];
    for (const mode of ['next', 'nextval']) assert.deepEqual(kmp({ text, pattern, mode }).result, expected);
  }
});

test('F 表达式 DAG 共享重复子式，保留左右依赖并缓存一次', () => {
  const input = { expression: '(2+3)*(2+3)' };
  const run = verify(dag(input), 'expression-dag');
  assert.equal(run.result.value, 25);
  assert.equal(run.result.nodes.filter(node => node.token === '+').length, 1);
  assert.deepEqual([run.result.nodes.at(-1).left, run.result.nodes.at(-1).right], [2, 2]);
  assert.deepEqual(run.steps.filter(step => step.event === 'evaluate').map(step => step.variables.currentNode), [2, 3]);
  assert.deepEqual(run.steps[0].variables.nodes, []);
  assert.deepEqual(run, dag(input));
  assert.equal(dag({ expression: '(3-2)-(2-3)' }).result.value, 2);
  assert.equal(dag({ expression: '2/0' }).steps.at(-1).lineId, 'arithmetic');
  assert.equal(dag({ expression: '(2+)' }).steps.at(-1).lineId, 'syntax');
});

test('F 关键路径记录两条路径、时差、多源多汇小数工期与有环输入', () => {
  const edges = [['A','B',2], ['A','C',2], ['B','D',3], ['C','D',3]];
  const run = verify(critical({ nodes: ['A','B','C','D'], edges, directed: true }), 'critical-path');
  assert.equal(run.result.duration, 5);
  assert.deepEqual(run.result.earliest, { A: 0, B: 2, C: 2, D: 5 });
  assert.deepEqual(run.result.latest, run.result.earliest);
  assert.deepEqual(run.result.criticalPaths, [[edges[0], edges[2]], [edges[1], edges[3]]]);
  assert.ok(run.result.activities.every(activity => activity.float === 0));
  const decimal = [['A','B',0.1], ['B','D',0.2], ['C','E',0.3], ['A','E',0.1], ['A','B',0]];
  const multi = critical({ nodes: ['A','B','C','D','E'], edges: decimal });
  assert.equal(multi.result.duration, 0.3);
  assert.deepEqual(multi.result.activities.map(activity => activity.float), [0, 0, 0, 0.2, 0.1]);
  assert.deepEqual(multi.result.criticalPaths, [[decimal[0], decimal[1]], [decimal[2]]]);
  assert.equal(verify(critical({ nodes: ['A','B'], edges: [['A','B',1], ['B','A',0]] }), 'critical-path').steps.at(-1).lineId, 'cycle');
  assert.throws(() => critical({ nodes: ['A'], edges: [['A','A',-1]] }), /工期/);
  assert.throws(() => critical({ nodes: ['A'], edges: [['A','B',1]] }), /未声明/);
  assert.throws(() => critical({ nodes: ['A'], edges: [], directed: false }), /有向图/);
});
