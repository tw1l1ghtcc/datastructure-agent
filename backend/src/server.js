import { eAlgorithm } from '../../frontend/src/features/workbench/e-algorithms.js';
import { gAlgorithm } from '../../frontend/src/features/workbench/g-algorithms.js';
import { fAlgorithm } from '../../frontend/src/features/workbench/f-algorithms.js';
import { dAlgorithm } from '../../frontend/src/features/workbench/d-algorithms.js';
import { cAlgorithm } from '../../frontend/src/features/workbench/c-algorithms.js';
import { arraySearch } from '../../frontend/src/features/workbench/array-search.js';
import { graphAlgorithm } from '../../frontend/src/features/workbench/graph-algorithms.js';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleCreateRun, handleCreateSortRun, handleCreateBubbleRun, handleCreateUnionFindRun, handleCreateGRun, handleCreateERun, handleCreateFRun, handleCreateDRun, handleCreateCRun, handleCreateArraySearchRun, handleCreateGraphRun, handleGetRun, handleGetStep } from './routes/runs.js';
import { handleGetExercises, handleCheckExercise } from './routes/exercises.js';
import { getUsage } from './agent/rate-limit.js';
import { knowledgeResponse } from './knowledge/retrieve.js';
import { acceptsLocalCode, CodeRunError, runCustomCode, runCustomCodeWithEngine } from './custom-code/runner.js';
import { handleDetect, handleDetectHealth, handleDetectTrace } from './routes/detect.js';
import { createRun } from './runs/store.js';

const here = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(here, '../../frontend');
const bstReplayPath = '/shared/algorithms/final/g/bst-replay.js';
/* 合并（PR #66 §1）：主分支的 bstReplayPath 保留；自定义代码示例库要的静态素材类型也保留 */
/* .c/.cpp/.h/.txt/.md 是"自定义代码示例库"用的静态素材（frontend/samples/，原样保留网上样例） */
const mime = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.c': 'text/plain', '.h': 'text/plain', '.cpp': 'text/plain', '.txt': 'text/plain', '.md': 'text/markdown',
};

function json(response, code, value) {
  response.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

async function readBody(request, maxBytes = 10240) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const mockEnabled = process.env.AGENT_MOCK === 'true';
const hasRealModel = !mockEnabled && Boolean(process.env.DEEPSEEK_API_KEY);

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const method = request.method;

    if (pathname === '/api/health' && method === 'GET') {
      return json(response, 200, {
        ok: true, stage: 'scaffold', implemented: ['static-page', 'health', 'runs', 'exercises', 'agent', 'knowledge'],
        modelCallsEnabled: hasRealModel, mode: mockEnabled ? 'mock' : (hasRealModel ? 'deepseek' : 'disabled')
      });
    }

    if (pathname === '/api/algorithms/binary-search/runs' && method === 'POST') {
      return handleCreateRun(request, response, await readBody(request));
    }
    if (pathname === '/api/algorithms/bubble-sort/runs' && method === 'POST') {
      return handleCreateBubbleRun(response, await readBody(request));
    }
    const algorithmRunMatch = pathname.match(/^\/api\/algorithms\/([a-z-]+)\/runs$/);
    if (method === 'POST' && algorithmRunMatch) {
      const [, algorithm] = algorithmRunMatch;
      if(dAlgorithm(algorithm))return handleCreateDRun(response,await readBody(request),algorithm);
      if (eAlgorithm(algorithm)) return handleCreateERun(response, await readBody(request), algorithm);
      if (gAlgorithm(algorithm)) return handleCreateGRun(response, await readBody(request), algorithm);
      if (fAlgorithm(algorithm)) return handleCreateFRun(response, await readBody(request), algorithm);
      if (cAlgorithm(algorithm)) return handleCreateCRun(response, await readBody(request), algorithm);
      if (algorithm === 'union-find') return handleCreateUnionFindRun(response, await readBody(request));
      if (graphAlgorithm(algorithm)) return handleCreateGraphRun(response, await readBody(request), algorithm);
      if (arraySearch(algorithm)) return handleCreateArraySearchRun(response, await readBody(request), algorithm);
      // A包新增路由分发
      if (algorithm.endsWith('-sort') && algorithm !== 'bubble-sort') {
        return handleCreateSortRun(response, await readBody(request), algorithm);
      }
    }
    // 2b. 自动识别（base 识别器 + 本仓库 third_party 的 Open Watcom）：只在本机工作台可用
    if (pathname === '/api/detect/health' && method === 'GET') {
      return handleDetectHealth(request, response, json);
    }
    if (pathname === '/api/detect' && method === 'POST') {
      /* 自定义代码可能带注释/空白，比 10KB 的默认上限更宽；识别器自己还有 20000 字符上限 */
      return handleDetect(request, response, await readBody(request, 262144), json);
    }
    if (pathname === '/api/detect/trace' && method === 'POST') {
      return await handleDetectTrace(request, response, await readBody(request, 262144), json);
    }

    if (pathname === '/api/algorithms/custom-array/runs' && method === 'POST') {
      if (!acceptsLocalCode(request)) return json(response, 403, { error: { code: 'LOCAL_ONLY', message: '请从本机工作台打开自定义代码。' } });
      if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') return json(response, 400, { error: { code: 'INVALID_INPUT', message: '请求必须是 JSON。' } });
      const body = await readBody(request);
      let input;
      try { input = JSON.parse(body); } catch {
        return json(response, 400, { error: { code: 'INVALID_INPUT', message: '请求体不是合法 JSON。' } });
      }
      try {
        /* mode:'engine' → 真编译 + 插桩（detect-engine）；缺省仍是极简子集翻译器（老行为不变） */
        const produce = input && input.mode === 'engine' ? runCustomCodeWithEngine : runCustomCode;
        return json(response, 200, createRun(await produce(input)));
      } catch (error) {
        if (!(error instanceof CodeRunError)) throw error;
        return json(response, error.status, { error: { code: error.code, message: error.message } });
      }
    }

    const stepMatch = pathname.match(/^\/api\/runs\/([^/]+)\/steps\/(\d+)$/);
    if (stepMatch && method === 'GET') return handleGetStep(request, response, stepMatch[1], stepMatch[2]);

    const runMatch = pathname.match(/^\/api\/runs\/([^/]+)$/);
    if (runMatch && method === 'GET') return handleGetRun(request, response, runMatch[1]);

    if (pathname === '/api/exercises' && method === 'GET') return handleGetExercises(request, response);
    if (pathname === '/api/exercises/check' && method === 'POST') return handleCheckExercise(request, response, await readBody(request));

    if (pathname === '/api/agent/explain' && method === 'POST') {
      if (mockEnabled) {
        try {
          const body = await readBody(request);
          let input = {};
          try { input = body ? JSON.parse(body) : {}; } catch { return json(response, 400, { error: { code: 'INVALID_INPUT', message: '请求体不是合法 JSON' } }); }
          const { handleAgentExplain } = await import('./agent/explain.mjs');
          const result = await handleAgentExplain(input, { mode: 'mock', req: request });
          return json(response, result.status, result.body);
        } catch (err) {
          if (err.message === 'BODY_TOO_LARGE') throw err;
          return json(response, 400, { error: { code: 'INVALID_INPUT', message: 'Agent 请求处理失败' } });
        }
      }
      if (hasRealModel) {
        try {
          const body = await readBody(request);
          let input = {};
          try { input = body ? JSON.parse(body) : {}; } catch { return json(response, 400, { error: { code: 'INVALID_INPUT', message: '请求体不是合法 JSON' } }); }
          const { handleAgentExplain } = await import('./agent/explain.mjs');
          const result = await handleAgentExplain(input, { mode: 'real', req: request });
          return json(response, result.status, result.body);
        } catch (err) {
          if (err.message === 'BODY_TOO_LARGE') throw err;
          if (err.message === 'MODEL_TIMEOUT') return json(response, 504, { error: { code: 'MODEL_TIMEOUT', message: '模型响应超时，请稍后重试' } });
          return json(response, 502, { error: { code: 'MODEL_CALL_FAILED', message: '模型调用失败' } });
        }
      }
      return json(response, 503, { error: { code: 'MODEL_NOT_CONFIGURED', message: '模型未配置。' } });
    }

    if (pathname === '/api/agent/usage' && method === 'GET') {
      const url = new URL(request.url, 'http://localhost');
      const sessionId = url.searchParams.get('sessionId') || request.headers['x-session-id'] || 'anon';
      return json(response, 200, { ok: true, ...getUsage(request, sessionId) });
    }

    if (pathname === '/api/knowledge/cards' && method === 'GET') {
      const result = knowledgeResponse(new URL(request.url, 'http://localhost').searchParams);
      return json(response, result.status, result.body);
    }

    if (pathname.startsWith('/api/')) return json(response, 404, { error: { code: 'NOT_FOUND', message: '接口不存在。' } });
    if (!['GET', 'HEAD'].includes(method)) return json(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: '请求方法不支持。' } });
    const isReplayModule = pathname === bstReplayPath;
    const file = isReplayModule ? resolve(here, '../..' + bstReplayPath)
      : resolve(frontendRoot, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!isReplayModule && !file.startsWith(frontendRoot + sep)) return json(response, 403, { error: { code: 'FORBIDDEN', message: '路径不允许。' } });
    const type = mime[extname(file)];
    if (!type) return json(response, 404, { error: { code: 'NOT_FOUND', message: '文件不存在。' } });
    try {
      const body = await readFile(file);
      /* 静态资源一律 no-cache：改名/改内容后必须能立刻拿到新版本
         （否则前端 app.js 走缓存，用户看到的是旧逻辑 —— 例如整程序被当成函数体跑）。 */
      response.writeHead(200, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-cache, must-revalidate' });
      response.end(method === 'HEAD' ? undefined : body);
    } catch (error) {
      if (['ENOENT', 'EISDIR', 'ENOTDIR'].includes(error.code)) return json(response, 404, { error: { code: 'NOT_FOUND', message: '文件不存在。' } });
      throw error;
    }
  } catch (error) {
    if (error.message === 'BODY_TOO_LARGE') return json(response, 400, { error: { code: 'INVALID_INPUT', message: '请求体超过 10KB 限制' } });
    console.error(error);
    json(response, 400, { error: { code: 'INVALID_REQUEST', message: '请求无法处理。' } });
  }
});

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be an integer between 0 and 65535');
server.listen(port, process.env.HOST ?? '127.0.0.1', () => {
  console.log(`Scaffold running at http://${process.env.HOST ?? '127.0.0.1'}:${server.address().port}`);
});
server.on('error', (error) => { console.error(`Server startup failed: ${error.code}`); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
