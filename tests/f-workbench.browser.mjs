import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { selectWorkbenchAlgorithm } from './select-workbench-algorithm.mjs';

const { chromium } = await import(process.env.TEST_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.TEST_PLAYWRIGHT_MODULE).href : 'playwright');
const server = spawn(process.execPath, ['backend/src/server.js'], {
  cwd: fileURLToPath(new URL('../', import.meta.url)),
  env: { ...process.env, PORT: '0', HOST: '127.0.0.1', AGENT_MOCK: 'true', RATE_LIMIT: 'false' },
  windowsHide: true,
});
const cases = [
  { id: 'bracket-matching', result: true, field: 'matched', caption: /括号栈/ },
  { id: 'infix-to-postfix', result: ['12','3','4','2','-','*','+'], caption: /后缀序列/ },
  { id: 'expression-evaluation', mode: 'postfix', result: -8, field: 'value', caption: /操作数栈/ },
  { id: 'naive-string-match', result: [0,1,2], caption: /匹配位置/ },
  { id: 'kmp', mode: 'nextval', result: [2], caption: /预处理表.*nextval/ },
  { id: 'expression-dag', result: 25, field: 'value', caption: /依赖边/ },
  { id: 'critical-path', result: 5, field: 'duration', caption: /关键路径/ },
];

async function assertStep(page, run, index) {
  const step = run.steps[index];
  await page.waitForFunction(({ index, lineId }) => (
    document.querySelector('[data-tl-ruler]')?.getAttribute('aria-valuenow') === String(index + 1) &&
    document.querySelector('#code-lines [aria-current="step"]')?.dataset.lineId === lineId
  ), { index, lineId: step.lineId });
  assert.equal(await page.locator('#step-description').textContent(), step.description);
}

let browser;
try {
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Backend startup timed out')), 10000);
    server.once('error', reject);
    server.stdout.on('data', chunk => {
      const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
  });
  browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'msedge', headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  for (const item of cases) {
    const { id, mode, field, result, caption } = item;
    await selectWorkbenchAlgorithm(page, id);
    if (mode) await page.selectOption('#f-mode', mode);
    await page.click('#fillDemo');
    const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/algorithms/' + id + '/runs'));
    await page.click('#startBtn');
    const response = await responsePromise;
    assert.equal(response.status(), 200, id);
    const run = await response.json();
    assert.deepEqual(field ? run.result[field] : run.result, result, id);
    if (mode) assert.equal(run.input.mode, mode, id);
    await assertStep(page, run, 0);
    await page.click('#nextBtn');
    await assertStep(page, run, 1);
    await page.click('[data-t="last"]');
    await assertStep(page, run, run.steps.length - 1);
    assert.match(await page.locator('.c-state-tables').innerText(), caption, id);
    await page.click('#prevBtn');
    const index = run.steps.length - 2;
    await assertStep(page, run, index);
    const stepResponse = await page.request.get(base + '/api/runs/' + run.runId + '/steps/' + index);
    assert.equal(stepResponse.status(), 200, id);
    assert.deepEqual((await stepResponse.json()).step, run.steps[index]);
    const answer = await page.request.post(base + '/api/agent/explain', {
      data: { runId: run.runId, stepIndex: index, question: '这一步发生了什么？', hintLevel: 2 },
    });
    assert.equal(answer.status(), 200, id);
    const { stepRefs } = await answer.json();
    assert.equal(stepRefs[0].algorithm, id);
    assert.equal(stepRefs[0].stepIndex, index);
    assert.deepEqual(stepRefs[0].variables, run.steps[index].variables);
    await page.click('#resetBtn');
    await assertStep(page, run, 0);
    console.log(id + ' · 示例、状态表、源码、步骤查询、单步回退、重置和 Mock 问答通过');
  }
  await page.click('#c-edit');
  await page.fill('#c-data', 'A, B');
  await page.fill('#f-secondary', 'A, B, 1\nB, A, 1');
  const cycleResponse = page.waitForResponse(response => response.url().endsWith('/api/algorithms/critical-path/runs'));
  await page.click('#startBtn');
  const cycle = await (await cycleResponse).json();
  await assertStep(page, cycle, 0);
  await page.click('[data-t="last"]');
  assert.match(await page.locator('.c-state-tables').innerText(), /有向环/);
  await assertStep(page, cycle, cycle.steps.length - 1);
  const invalid = await page.request.post(base + '/api/algorithms/critical-path/runs', {
    data: { nodes: ['A'], edges: [['A', 'B', 1]], directed: true },
  });
  assert.equal(invalid.status(), 400);
  assert.equal((await invalid.json()).error.code, 'INVALID_INPUT');
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  server.kill();
}
