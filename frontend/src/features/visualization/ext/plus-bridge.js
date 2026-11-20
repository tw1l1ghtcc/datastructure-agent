/**
 * plus-bridge.js -- 把 plus01&02 的 54 个示例接进本项目的**可视化窗口**
 *
 * 原则（对既有样式/动画零改动）：
 *   · **数组族**：交给本项目自己的 `createVisualization`（.bsviz-* + 8 组 keyframes + 指针 FLIP），
 *     只把 `frameBuilder` 换成 `vendor/plus/app/host-frame.js` 的 `asFrameBuilder`
 *     —— 帧结构与 `prototype-array.js` 一致，所以 visualization.css 不用动。
 *   · **其它族**（树/图/链表/栈/堆/矩阵…）：本项目没有这些族的样式，走 `vendor/plus` 的
 *     svg-stage（新增原型，类名 avc-*），样式在 `./plus-viz.css`（**新增**文件）。
 *
 * 对外暴露：
 *   PLUS_CASES                  54 个示例（给算法菜单用）
 *   isPlus(id)                  是否是我们的示例
 *   buildPlusRun(id, variantId) 本地生成 run（不走后端）
 *   createPlusView(host, run, {explainContainer})  与 createVisualization 同接口
 */

import { createVisualization } from '../index.js';
import { createExplanationPanel } from '../explanation-panel.js';
import { ITEMS } from '../../../../vendor/plus/vendor/catalog/index.js';
import { toStepV1, COVERED_BY_EXISTING_PROTOTYPE } from '../../../../vendor/plus/app/step-adapter.js';
import { asFrameBuilder } from '../../../../vendor/plus/app/host-frame.js';
import { createStage as createSvgStage } from '../../../../vendor/plus/app/svg-stage.js';

export const PLUS_PREFIX = 'plus:';
const ARRAY_ALGORITHM = 'binary-search';        // 让本项目的数组可视化链路生效（arraySearch 只认这三个 id）

/** 包名（菜单章节标题用） */
const PKG_NAME = {
  A: '比较排序', B: '图算法与并查集', C: '多路归并与多路查找树', D: '查找与哈希',
  E: '串、栈与链表', F: '串、栈与 DAG 应用', G: '二叉树与树的应用',
};

/** 54 个示例（按包分组） */
export const PLUS_CASES = ITEMS.map((it) => {
  const pkg = String(it.uid).split('/')[0].toUpperCase();
  return { id: PLUS_PREFIX + it.uid, uid: it.uid, title: it.title, pkg, pkgName: PKG_NAME[pkg] || pkg, variants: it.variants || [{ id: 'v1' }] };
});

export const isPlus = (id) => typeof id === 'string' && id.startsWith(PLUS_PREFIX);

const moduleCache = new Map();
async function modOf(uid) {
  if (moduleCache.has(uid)) return moduleCache.get(uid);
  const item = ITEMS.find((i) => i.uid === uid);
  if (!item) throw new Error('没有这个示例：' + uid);
  const mod = await import('../../../../vendor/plus/vendor/' + item.path);
  moduleCache.set(uid, mod);
  return mod;
}

const ARRAY_STYLES = new Set([1, 5, 6]);

/** 结构族判定：只有"所有层都是数组类画法"且"首层是一维数值序列"才走本项目的数组可视化 */
function styleOf(trace) {
  let first = null;
  for (const st of trace.steps || []) {
    for (const l of st.layers || []) {
      first = first || l.style;
      if (!ARRAY_STYLES.has(l.style)) return { style: l.style, isArray: false };   // 混了别的族 → 走新增原型
    }
  }
  const l0 = ((trace.steps || [])[0] || {}).layers || [];
  const values = (l0[0] && l0[0].data && l0[0].data.values) || null;
  const isArray = Array.isArray(values) && values.length > 0 && !Array.isArray(values[0]) && values.every((v) => typeof v === 'number');
  return { style: first || 1, isArray };
}

/**
 * 本地生成 run（与后端 run 同形状，供 window.js 的 setRun 直接吃）
 * @param {string} id  'plus:<uid>'
 * @param {string} variantId  'v1' | 'v2' | 'v3'
 * @param {object|null} inputOverride  工作台里填好的输入（省略=用样例库第一份）
 */
export async function buildPlusRun(id, variantId = 'v1', inputOverride = null) {
  const uid = String(id).slice(PLUS_PREFIX.length);
  const item = ITEMS.find((i) => i.uid === uid);
  if (!item) throw new Error('没有这个示例：' + uid);
  if (!plusVariants(id).some((v) => v.id === variantId)) throw new Error('没有这个变体：' + variantId);
  const mod = await modOf(uid);
  const sample = (mod.samples?.[0] || {});
  const input = (inputOverride && typeof inputOverride === 'object') ? inputOverride : (sample.input || {});
  const trace = mod.run(variantId, input);
  const fam = styleOf(trace);
  const style = fam.style;
  const isArray = fam.isArray;

  // 数组族：转成 Step v1（array/variables/event/result），交给本项目的 createVisualization
  const steps = isArray
    ? (trace.steps || []).map((st, i) => toStepV1(st, { uid: ARRAY_ALGORITHM, variantId, stepIndex: i }).step)
    : (trace.steps || []);

  /* 源码面板：**用模块自带的 sourceLines(variantId)**（真正的 C/C++ 代码，
     lineId 与每一步的 lineId 一一对应）。早期拿 step.note 顶替，代码区显示的
     就是中文说明了。模块没导出时才退化成 note。 */
  let sourceLines = [];
  try {
    const fn = mod.sourceLines;
    const raw = typeof fn === 'function' ? fn(variantId) : fn;
    if (Array.isArray(raw)) {
      sourceLines = raw
        .filter((line) => line && line.lineId && typeof line.text === 'string')
        .map((line) => ({ lineId: String(line.lineId), text: line.text }));
    }
  } catch (error) { sourceLines = []; }
  if (!sourceLines.length) {
    const seenLine = new Set();
    (trace.steps || []).forEach((st, i) => {
      const lineId = st.lineId || ('L' + i);
      if (seenLine.has(lineId)) return;
      seenLine.add(lineId);
      sourceLines.push({ lineId, text: String(st.note || lineId).slice(0, 120) });
    });
  }
  if (!sourceLines.length) sourceLines.push({ lineId: 'L0', text: item.title });

  return {
    runId: 'plus-' + uid.replace(/[^\w]+/g, '-') + '-' + variantId,
    /* 对外身份必须是**真实的 plus 示例 id**（评审报告 §3.10）：以前数组族被改写成 binary-search，
       复制地址、问答上下文、日志里都看不出这是"插入排序"示例。
       渲染适配（借用本项目数组链路）放在 createPlusView 里用独立参数，不改对外身份。 */
    algorithm: PLUS_PREFIX + id,
    /* 明确这是**本地预览**：后端没有这次运行的记录，所以步骤问答不可用（前端按 preview 关闭入口） */
    preview: true,
    /* 页面上明确说一句，别让用户以为问答/持久化也能用（评审报告 §3.10） */
    notice: '本地示例预览：动画与步骤由本机生成，不接步骤问答，也没有后端运行记录。',
    noticeIsInfo: true,
    plus: true,
    plusId: id,
    uid,
    variantId,
    title: item.title,
    structure: isArray ? 'array' : 'structure',
    style,
    sourceVersion: 'plus01&02 · ' + (variantId || 'v1'),
    sourceLines,
    steps,
    rawSteps: trace.steps || [],
    input,
  };
}

/**
 * 与 createVisualization 同接口的视图
 * @returns {{showStep:Function, getStep:Function, playEnterAnimation:Function, destroy:Function}}
 */
export function createPlusView(host, run, { explainContainer = null } = {}) {
  if (!host) throw new Error('createPlusView 需要一个容器');
  const raw = run.rawSteps || [];
  function describe(step, index, caption, status) {
    if (!step || !caption || !status) return;
    const trace = raw[index] ?? step;
    const position = '第 ' + (index + 1) + ' 步';
    if (run.algorithm === 'custom-engine') {
      caption.textContent = '追踪到源码第 ' + (step.variables?.line ?? step.lineId) + ' 行。';
      const layers = trace.layers?.length ?? 0;
      status.textContent = position + (layers ? ' ｜ 本步记录 ' + layers + ' 个结构' : '') + (step.done ? ' ｜ 运行结束' : '');
    } else {
      caption.textContent = trace.note || step.description || trace.event || position;
      status.textContent = position + (step.done ? ' ｜ 运行结束' : '');
    }
  }

  if (run.structure === 'array') {
    // 走本项目自己的数组可视化（样式/动画原样），只替换帧构造器
    const view = createVisualization(host, {
      run: { ...run, algorithm: ARRAY_ALGORITHM },
      explainContainer,
      frameBuilder: (step, opts) => asFrameBuilder(step, opts),
    });
    const scope = explainContainer ?? host;
    const caption = scope.querySelector('.bsviz-caption');
    const status = scope.querySelector('.bsviz-status');
    const updateExplanation = () => {
      const step = view.getStep();
      describe(step, step?.stepIndex, caption, status);
    };
    const showStep = view.showStep;
    const replay = view.playEnterAnimation;
    view.showStep = (step, meta) => {
      showStep(step, meta);
      updateExplanation();
    };
    view.playEnterAnimation = () => {
      replay();
      updateExplanation();
    };
    updateExplanation();
    return view;
  }

  // 其它族：新增原型（svg-stage）+ 新增样式（plus-viz.css）
  const wrap = document.createElement('div');
  wrap.className = 'plus-viz';
  host.replaceChildren(wrap);
  const { explain, caption, status } = createExplanationPanel();
  (explainContainer ?? host).append(explain);
  const stage = createSvgStage(wrap);
  let current = null;
  let index = -1;
  function showStep(step, meta = {}) {
    const i = (meta && typeof meta.stepIndex === 'number') ? meta.stepIndex : (step && typeof step.stepIndex === 'number' ? step.stepIndex : index + 1);
    const traceStep = raw[i] || step;
    current = traceStep;
    index = i;
    stage.render((traceStep && traceStep.layers) || [], { animate: true, prevLayers: null });
    describe(step, index, caption, status);
    return traceStep;
  }
  return {
    showStep,
    getStep: () => current,
    playEnterAnimation: () => { if (current) stage.render(current.layers || [], { animate: true }); },
    destroy: () => { stage.clear(); wrap.remove(); explain.remove(); },
  };
}

/* ----------------------------------------------------------------------------
 * 样例库（给工作台的「填入示例」用）
 *
 * 每个 plus 示例自带 samples[]（1～7 份，每份有 id/label/input/expect），
 * label 本身就是"这份输入是什么"的中文说明，input 是 run 的唯一入参。
 * 所以「填入示例」不需要我们另写 54 份硬编码输入：直接取样例库即可。
 *
 * 文本层只做形状适配（可编辑）：
 *   单字段数字数组 {array|list|keys|…:[1,2]}  →  "1, 2"
 *   单字段字符串   {text:"([{}])"}             →  "([{}])"
 *   其它（图/树/多参数）                          →  缩进 JSON
 * 反向解析时按"原样例的形状"还原，避免猜错键名。
 * ------------------------------------------------------------------------- */

/** 该示例的变体清单（同步：catalog 里就有，无需加载算法模块） */
export function plusVariants(id) {
  const uid = String(id).slice(PLUS_PREFIX.length);
  const item = ITEMS.find((i) => i.uid === uid);
  const list = (item && item.variants) || [];
  return list.length
    ? list.map((v) => ({ id: v.id, name: v.name || v.id, note: v.note || '' }))
    : [{ id: 'v1', name: 'v1', note: '' }];
}

/** 该示例的菜单条目（标题/结构/包名），找不到返回 null */
export function plusCase(id) {
  return PLUS_CASES.find((c) => c.id === id) || null;
}

/** 单字段样例的紧凑写法（不能紧凑 → null） */
function compactShape(input) {
  const keys = Object.keys(input || {});
  if (keys.length !== 1) return null;
  const key = keys[0];
  const value = input[key];
  if (typeof value === 'string') return { key, kind: 'text' };
  if (Array.isArray(value) && value.every((n) => typeof n === 'number')) return { key, kind: 'numbers' };
  return null;
}

/** 样例输入 → 编辑框文本 */
export function plusSampleText(input) {
  const shape = compactShape(input);
  if (shape && shape.kind === 'text') return input[shape.key];
  if (shape && shape.kind === 'numbers') return input[shape.key].join(', ');
  return JSON.stringify(input || {}, null, 2);
}

/**
 * 编辑框文本 → run 需要的输入对象
 * @param {string} text 编辑框内容
 * @param {object} sampleInput 原样例输入（只用来认形状）
 */
export function plusParseText(text, sampleInput) {
  const raw = String(text ?? '');
  const trimmed = raw.trim();
  const shape = compactShape(sampleInput);
  const looksObject = trimmed.startsWith('{');   // 只有整个对象才算 JSON，"[3, 1]" 仍按数字数组读
  if (shape && shape.kind === 'text' && !looksObject) return { [shape.key]: raw };
  if (shape && shape.kind === 'numbers' && !looksObject) {
    const body = trimmed.replace(/^\[/, '').replace(/\]$/, '').trim();
    const parts = body ? body.split(/[,，\s]+/).filter(Boolean) : [];
    const numbers = parts.map((part) => {
      const value = Number(part);
      if (!Number.isFinite(value)) throw new Error('数组元素必须是数字：' + part);
      return value;
    });
    return { [shape.key]: numbers };
  }
  let parsed;
  try { parsed = JSON.parse(trimmed); }
  catch (error) { throw new Error('这份输入要用 JSON 描述（例如 {"array":[3,1,2]}），当前文本无法解析。'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('输入必须是一个 JSON 对象，例如 {"array":[3,1,2]}。');
  return parsed;
}

/** 该示例的全部样例（异步：要加载算法模块才拿得到 samples[]） */
export async function plusSamples(id) {
  const uid = String(id).slice(PLUS_PREFIX.length);
  const item = ITEMS.find((i) => i.uid === uid);
  if (!item) throw new Error('没有这个示例：' + uid);
  const mod = await modOf(uid);
  return (mod.samples || []).map((sample, index) => ({
    index,
    id: String(sample.id || ('s' + index)),
    label: String(sample.label || ('示例 ' + (index + 1))),
    input: sample.input || {},
    text: plusSampleText(sample.input || {}),
    expectError: Boolean(sample.expect && sample.expect.error),
  }));
}

void COVERED_BY_EXISTING_PROTOTYPE;
