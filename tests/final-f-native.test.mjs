import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { generateBracketMatchingSteps as bracket } from '../shared/algorithms/final/f/bracket-matching.js';
import { generateInfixToPostfixSteps as convert } from '../shared/algorithms/final/f/infix-to-postfix.js';
import { generateExpressionEvaluationSteps as evaluate } from '../shared/algorithms/final/f/expression-evaluation.js';
import { generateNaiveStringMatchSteps as naive } from '../shared/algorithms/final/f/naive-string-match.js';
import { generateKmpSteps as kmp } from '../shared/algorithms/final/f/kmp.js';
import { generateExpressionDagSteps as dag } from '../shared/algorithms/final/f/expression-dag.js';
import { generateCriticalPathSteps as critical } from '../shared/algorithms/final/f/critical-path.js';

const toolchain = resolve(import.meta.dirname, '../third_party/open-watcom/owcpp');
const boot = join(toolchain, 'boot');
const bin = join(boot, 'binnt64');
const compiler = join(toolchain, 'out/wpp386.exe');
const linker = join(bin, 'wcl386.exe');
const available = process.platform === 'win32' && [compiler, linker].every(existsSync);
const matchInput = { text: 'aaaa', pattern: 'aa' };
const graphInput = { nodes: ['A', 'B', 'C', 'D'], edges: [['A','B',2], ['A','C',2], ['B','D',3], ['C','D',3]] };
const declaration = 'unsigned long text[]={97,97,97,97}, pat[]={97,97}; int found[121];';
const printMatches = 'for(int i=0;i<n;++i) printf("%d ",found[i]);';

const fixtures = [
  ['括号匹配', bracket({ text: '([)]' }),
    'unsigned long text[]={40,91,41,93}; printf("%d",bracket_match(text,4));',
    result => String(result.index)],
  ['中缀转后缀', convert({ expression: '12+3*(4-2)' }),
    'FToken out[64]; int n=infix_to_postfix("12+3*(4-2)",out); for(int i=0;i<n;++i){if(out[i].op)printf("%c ",out[i].op);else printf("%.0f ",out[i].value);}',
    result => result.join(' ')],
  ['表达式求值', evaluate({ expression: '8 2 3 - /', mode: 'postfix' }),
    'double result; if(!evaluate_expression("8 2 3 - /",true,&result)) return 1; printf("%.8g ",result); if(evaluate_expression("2/0",false,&result))return 2;',
    result => String(result.value)],
  ['朴素匹配', naive(matchInput), declaration + 'int n=naive_match(text,4,pat,2,found);' + printMatches,
    result => result.join(' ')],
  ['KMP', kmp(matchInput), declaration + 'for(int mode=0;mode<2;++mode){int n=kmp(text,4,pat,2,mode!=0,found);' + printMatches + 'puts("");}',
    result => result.join(' ') + ' \n' + result.join(' ')],
  ['表达式 DAG', dag({ expression: '(2+3)*(2+3)' }),
    'FNode nodes[64]; double cache[64]; int n,root; if(!expression_dag("(2+3)*(2+3)",nodes,&n,&root,cache))return 1; printf("%.8g %d %d %d",cache[root],n,nodes[root].left,nodes[root].right);',
    result => [result.value, result.nodes.length, result.nodes[result.root].left, result.nodes[result.root].right].join(' ')],
  ['关键路径', critical(graphInput),
    'Activity edges[]={{0,1,2000},{0,2,2000},{1,3,3000},{2,3,3000}}; int order[30],paths[9][30],lengths[9],count; long long e[30],l[30],slack[120],duration; bool key[120]; if(!critical_path(4,edges,4,order,e,l,slack,&duration,key,paths,lengths,&count))return 1; printf("%lld %d",duration,count); for(int i=0;i<4;++i)printf(" %lld",slack[i]); for(int i=0;i<count;++i)for(int j=0;j<lengths[i];++j)printf(" %d",paths[i][j]); Activity cycle[]={{0,1,0},{1,0,0}}; if(critical_path(2,cycle,2,order,e,l,slack,&duration,key,paths,lengths,&count))return 2;',
    result => [result.duration * 1000, result.criticalPaths.length, ...result.activities.map(item => item.float * 1000),
      ...result.criticalPaths.flatMap(path => path.map(edge => graphInput.edges.findIndex(candidate => candidate.join() === edge.join())))].join(' ')],
];

for (const [name, run, body, expected] of fixtures) {
  test('F 原生展示源码 · ' + name, { skip: !available, timeout: 20000 }, () => {
    const parent = resolve(tmpdir());
    const dir = mkdtempSync(join(parent, 'final-f-native-'));
    const lib = [join(boot, 'lib386'), join(boot, 'lib386/nt')].join(delimiter);
    const env = {
      ...process.env, WATCOM: boot, LIB: lib, LIBPATH: lib,
      INCLUDE: [join(boot, 'h'), join(boot, 'h/nt')].join(delimiter),
      PATH: [bin, join(boot, 'binnt'), process.env.PATH].join(delimiter),
    };
    const options = { cwd: dir, env, timeout: 8000, windowsHide: true, encoding: 'utf8', stdio: 'pipe' };
    try {
      const source = run.sourceLines.map(line => line.text).join('\n');
      writeFileSync(join(dir, 'program.cpp'), '#include <stdio.h>\n' + source + '\nint main(){\n' + body + '\nreturn 0;\n}\n', 'ascii');
      execFileSync(compiler, ['-bt=nt', '-q', '-xs', '-fo=program.obj', 'program.cpp'], options);
      execFileSync(linker, ['-l=nt', '-q', '-fe=program.exe', 'program.obj'], options);
      const output = execFileSync(join(dir, 'program.exe'), [], options).replace(/\r/g, '').trim();
      assert.equal(output, expected(run.result));
    } finally {
      if (resolve(dir).startsWith(join(parent, 'final-f-native-'))) rmSync(dir, { recursive: true, force: true });
    }
  });
}
