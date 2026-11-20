const matchFields = [['i', '主串下标'], ['j', '模式串下标'], ['start', '对齐起点'], ['matches', '匹配位置']];
const expressionHelp = '支持多位非负整数、空白、括号和二元 + - * /。最多 64 个词元，整数词元不超过 2147483647。';
const configs = {
  'bracket-matching': { chapter: 3, title: '括号匹配', field: 'text', label: '待检查字符串', example: '([{}])',
    help: '最多 120 个字符。检查 ()、[]、{}，其余字符原位跳过。',
    fields: [['i', '字符下标'], ['char', '当前字符'], ['stack', '栈（底到顶）'], ['reason', '错误原因']] },
  'infix-to-postfix': { chapter: 3, title: '中缀转后缀', field: 'expression', label: '中缀表达式', example: '12+3*(4-2)',
    help: expressionHelp, fields: [['index', '原串下标'], ['token', '当前词元'], ['operators', '运算符栈'], ['output', '后缀序列']] },
  'expression-evaluation': { chapter: 3, title: '表达式求值', field: 'expression', label: '表达式', example: '8/(2-3)',
    modes: [['infix', '中缀'], ['postfix', '后缀']], modeExamples: { postfix: '8 2 3 - /' },
    help: expressionHelp + '后缀词元间用空白分隔。除法保留小数。',
    fields: [['token', '当前词元'], ['left', '左操作数'], ['right', '右操作数'], ['value', '本步计算结果']] },
  'naive-string-match': { chapter: 4, title: '朴素模式匹配', field: 'text', label: '主串', example: 'aaaa',
    secondary: { label: '模式串', example: 'aa' },
    help: '主串最多 120 个字符，模式串最多 48 个字符。下标从 0 开始，空模式返回 0。',
    fields: matchFields },
  kmp: { chapter: 4, title: 'KMP 模式匹配', field: 'text', label: '主串', example: 'abababaca',
    secondary: { label: '模式串', example: 'ababaca' }, modes: [['next', 'next'], ['nextval', 'nextval']],
    help: '主串最多 120 个字符，模式串最多 48 个字符。结束一次匹配后保留可重叠前缀，空模式返回 0。',
    fields: [['i', '主串下标'], ['j', '模式串下标'], ['jump', '回退到'], ['matches', '匹配位置']] },
  'expression-dag': { chapter: 6, title: '表达式有向无环图', field: 'expression', label: '中缀表达式', example: '(2+3)*(2+3)',
    help: expressionHelp + '相同子表达式共享节点，两个操作数的顺序参与判断。',
    fields: [['currentNode', '当前节点'], ['root', '根节点'], ['stack', '构图栈'], ['order', '求值顺序']] },
  'critical-path': { chapter: 6, title: '关键路径', field: 'nodes', label: '顶点（逗号分隔）', example: 'A, B, C, D',
    secondary: { label: '活动（每行一项）', example: 'A, B, 2\nA, C, 2\nB, D, 3\nC, D, 3' },
    help: '每行按「起点, 终点, 工期」填写。最多 30 个顶点和 120 项活动，工期 0 到 10 亿，最多三位小数。',
    fields: [['currentNode', '当前事件'], ['currentEdge', '当前活动'], ['order', '拓扑序'], ['duration', '总工期']] },
};

export const fAlgorithmIds = Object.keys(configs);
export function fAlgorithm(id) { return Object.hasOwn(configs, id) ? configs[id] : null; }

export function readFInput(config, value, other, mode) {
  if (config.field === 'nodes') {
    const split = (text) => text.split(/[,，]/).map(item => item.trim());
    const nodes = split(value);
    const edges = other.split(/\r?\n/).filter(line => line.trim()).map((line) => {
      const [from, to, weight, ...rest] = split(line);
      if (!from || !to || !/^\d+(?:\.\d{1,3})?$/.test(weight ?? '') || rest.length) {
        throw new Error('每行填写「起点, 终点, 工期」，工期最多三位小数。');
      }
      return [from, to, Number(weight)];
    });
    return { nodes, edges, directed: true };
  }
  return { [config.field]: value, ...(config.secondary ? { pattern: other } : {}), ...(config.modes ? { mode } : {}) };
}
