import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.TEST_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.TEST_PLAYWRIGHT_MODULE).href : 'playwright');
const server = spawn(process.execPath, ['backend/src/server.js'], {
  cwd: fileURLToPath(new URL('../', import.meta.url)),
  env: { ...process.env, PORT: '0', HOST: '127.0.0.1', AGENT_MOCK: 'true', RATE_LIMIT: 'false' },
  windowsHide: true,
});

const panel = page => page.locator('[data-explain-host]');
const status = page => panel(page).locator('.bsviz-status');
async function assertStep(page, position) {
  await page.waitForFunction(expected =>
    document.querySelector('[data-tl-ruler]').getAttribute('aria-valuenow') === String(expected),
  position);
  const action = await panel(page).locator('.bsviz-caption').textContent();
  const detail = await status(page).textContent();
  assert.ok(action.trim());
  assert.match(detail, new RegExp('^第 ' + position + ' 步'));
  assert.ok(detail.length > ('第 ' + position + ' 步').length, await page.locator('#algorithm-trigger').getAttribute('data-algorithm'));
  assert.doesNotMatch(action + detail, /undefined|NaN/);
  return detail;
}

async function measure(page) {
  return panel(page).evaluate(host => {
    const viewport = host.closest('.viewport');
    const box = host.getBoundingClientRect();
    const bounds = viewport.getBoundingClientRect();
    const scene = viewport.querySelector('[data-viz-body]').getBoundingClientRect();
    const caption = getComputedStyle(host.querySelector('.bsviz-caption'));
    const status = getComputedStyle(host.querySelector('.bsviz-status'));
    return {
      inset: Math.round(box.left - bounds.left),
      top: Math.round(box.top - bounds.top),
      width: Math.round(box.width),
      captionSize: caption.fontSize,
      statusSize: status.fontSize,
      clearOfScene: box.bottom <= scene.top + 1,
    };
  });
}

async function open(page, base, id) {
  await page.goto(base + '/#workbench?algorithm=' + encodeURIComponent(id));
  await page.waitForFunction(algorithm => document.querySelector('#algorithm-trigger').dataset.algorithm === algorithm, id);
}

async function runDemo(page, base, id) {
  await open(page, base, id);
  await page.locator('#fillDemo').click();
  for (const id of ['#tree-next', '#c-next', '#bfs-next', '#uf-next']) {
    const next = page.locator(id);
    if (await next.isVisible()) await next.click();
  }
  await page.locator('#startBtn').click();
  await panel(page).locator('.bsviz-caption').waitFor();
}
async function inspectRun(page, expected) {
  const initial = await assertStep(page, 1);
  const layout = await measure(page);
  assert.ok(layout.clearOfScene);
  if (expected) assert.deepEqual(layout, expected);

  const toggle = panel(page).locator('.bsviz-explain-toggle');
  const content = panel(page).locator('.bsviz-explain-content');
  assert.equal(await toggle.getAttribute('aria-controls'), await content.getAttribute('id'));
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(await content.isVisible(), false);
  await page.locator('#nextBtn').click();
  await assertStep(page, 2);
  assert.equal(await content.isVisible(), false);
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(await content.isVisible(), true);
  await page.locator('#prevBtn').click();
  assert.equal(await assertStep(page, 1), initial);
  return layout;
}

let browser;
try {
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Backend startup timed out')), 10000);
    server.once('error', reject);
    server.stdout.on('data', chunk => {
      const url = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);
      if (url) { clearTimeout(timer); resolve(url[0]); }
    });
  });
  browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await runDemo(page, base, 'binary-search');
  const desktop = await inspectRun(page);
  const choices = await page.locator('#algorithm-chapters [data-algorithm-choice]').evaluateAll(nodes =>
    nodes.map(node => node.dataset.algorithmChoice).filter(id => id !== 'custom-array'));
  assert.equal(choices.length, 56);
  assert.equal(new Set(choices).size, 56);
  for (const id of choices.filter(id => id !== 'binary-search')) {
    try {
      await runDemo(page, base, id);
      await inspectRun(page, desktop);
    } catch (error) {
      throw new Error('本步解释 · ' + id, { cause: error });
    }
  }
  console.log('56 项内置算法的解释布局和单步切换通过。');

  await page.setViewportSize({ width: 390, height: 844 });
  await runDemo(page, base, 'binary-search');
  const mobile = await inspectRun(page);
  for (const id of ['heap-sort', 'floyd', 'union-find', 'multiway-merge', 'avl-tree',
    'counting-sort', 'kmp', 'critical-path', 'binary-tree-level-order']) {
    await runDemo(page, base, id);
    await inspectRun(page, mobile);
  }
  await open(page, base, 'heap-sort');
  await page.fill('#arrInput', Array.from({ length: 24 }, (_, i) => Number.MAX_SAFE_INTEGER - i).join(', '));
  await page.locator('#startBtn').click();
  await page.locator('[data-t="last"]').click();
  const scrolls = await panel(page).locator('.bsviz-explain-content').evaluate(content => {
    const toggle = content.previousElementSibling.querySelector('button');
    const top = toggle.getBoundingClientRect().top;
    content.scrollTop = content.scrollHeight;
    return content.scrollTop > 0 && toggle.getBoundingClientRect().top === top;
  });
  assert.ok(scrolls, '长解释可以滚动且折叠按钮始终可见');
  await page.locator('#resetBtn').click();
  await assertStep(page, 1);
  assert.equal(await panel(page).locator('.bsviz-explain-content').evaluate(content => content.scrollTop), 0);
  console.log('窄屏解释布局、长文滚动与重置通过。');

  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page, base, 'custom-array');
  await page.fill('#arrInput', '2, 1');
  await page.fill('#code-input', 'void sort(int a[], int n) {\n  a[0] = -8;\n  a[1] = a[0] + 3;\n}');
  await page.locator('#startBtn').click();
  await panel(page).locator('.bsviz-caption').waitFor();
  await inspectRun(page, desktop);

  const program = await readFile(new URL('../drivenengine/base/samples/03_linked_list.c', import.meta.url), 'utf8');
  await page.fill('#code-input', program);
  await page.locator('#startBtn').click();
  await panel(page).locator('.bsviz-caption').waitFor();
  await inspectRun(page, desktop);
  assert.match(await panel(page).locator('.bsviz-caption').textContent(), /追踪到源码第 \d+ 行/);
  assert.deepEqual(errors, []);
  console.log('自定义数组函数和链表整程序的本步解释通过。');
} finally {
  await browser?.close();
  server.kill();
}
