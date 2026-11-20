import { readFInput } from './f-algorithms.js';

function integers(text) {
  if (!text.trim()) return [];
  return text.split(/[,，]/).map(part => {
    const value = part.trim();
    if (!/^[+-]?\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('请输入逗号分隔的安全整数。');
    return Number(value);
  });
}
export function createDataForm({ message, onChange }) {
  const byId = id => document.getElementById(id);
  const data = byId('c-data'), param = byId('c-param'), queries = byId('c-queries'), target = byId('d-target');
  const secondary = byId('f-secondary'), mode = byId('f-mode');
  let config = null, second = false, collapsed = false;
  function update() {
    byId('c-fields').hidden = !config || collapsed;
    byId('c-summary').hidden = !config || !collapsed;
    if (!config) return;
    byId('fillDemo').parentElement.hidden = collapsed;
    byId('startBtn').hidden = collapsed || (config.tree && !second);
    byId('c-data-step').hidden = second;
    byId('c-query-step').hidden = !second;
    byId('c-next').hidden = !config.tree;
    byId('bfs-next').hidden = true; byId('bfs-back').hidden = true;
  }
  function readData(includeQueries = true) {
    if (config.chapter) return readFInput(config, data.value, secondary.value, mode.value);
    const input = { [config.field]: config.field === 'runs' ? (data.value.trim() ? data.value.split(/\r?\n/).map(integers) : []) : integers(data.value) };
    if (config.param) {
      const value = Number(param.value);
      if (!Number.isInteger(value) || value < config.min || value > config.max) throw new Error(config.paramLabel + '须为 ' + config.min + ' 到 ' + config.max + ' 的整数。');
      if(config.prime) {
        let prime=true;
        for(let divisor=2;divisor*divisor<=value;divisor++)if(value%divisor===0){prime=false;break;}
        if(!prime)throw new Error(config.paramLabel+'必须为素数。');
      }
      input[config.param] = value;
    }
    if (config.singleTarget && includeQueries) {
      const values=integers(config.tree ? queries.value : target.value);
      if(values.length>1)throw new Error('当前算法只支持查询一个键。');
      if(values.length)input.target=values[0];
    } else if (config.tree && !config.singleTarget) input.queries = includeQueries ? integers(queries.value) : [];
    const groups = config.field === 'runs' ? input.runs : [input[config.field]];
    const total = groups.reduce((sum, group) => sum + group.length, 0);
    if (groups.length > 32 || total > (config.field === 'keys' || config.field === 'weights' ? 64 : 128)) throw new Error('输入数量超过当前算法上限，请查看输入说明。');
    if (input.queries && input.queries.length > 64) throw new Error('查询最多 64 个键。');
    if (config.field === 'weights' && input.weights.some(value => value < 0)) throw new Error('权重不能为负数。');
    if (config.field === 'runs' && groups.some(group => group.some((value,index) => index > 0 && value < group[index-1]))) throw new Error('每个输入段必须非递减有序。');
    return input;
  }
  byId('c-next').addEventListener('click', () => {
    try { readData(false); } catch (error) { message(error.message,true); return; }
    second = true; update(); message(''); queries.focus();
  });
  byId('c-back').addEventListener('click', () => { second=false; update(); message(''); data.focus(); });
  byId('c-edit').addEventListener('click', () => { collapsed=false; update(); message(''); (second ? queries : data).focus(); });
  for (const field of [data,param,queries,target,secondary]) field.addEventListener('input',onChange);
  mode.addEventListener('change', onChange);
  return {
    setAlgorithm(next) {
      if (config !== next) {
        config=next; second=false; collapsed=false;
        data.value=''; queries.value=''; target.value='';
        secondary.value = '';
        byId('f-secondary-field').hidden = !config?.secondary;
        byId('f-secondary-label').textContent = config?.secondary?.label ?? '';
        secondary.placeholder = config?.secondary?.example ?? '';
        byId('f-mode-field').hidden = !config?.modes;
        mode.replaceChildren(...(config?.modes ?? []).map(([value, label]) => new Option(label, value)));
        if (config) {
          byId('d-target-field').hidden=!config.singleTarget || config.tree;
          byId('data-query-label').textContent=config.singleTarget ? '第 2 步 · 查询值（可选，只填一个键）' : '第 2 步 · 查询值（可选）';
          queries.placeholder=config.singleTarget ? '留空则只建树' : '逗号分隔，留空则只建树';
          byId('c-data-label').textContent=(config.tree ? '第 1 步 · ' : '')+config.label;
          data.rows=config.field==='runs' ? 4 : 2;
          data.placeholder=config.example;
          byId('c-help').textContent=config.help;
          byId('c-param-field').hidden=!config.param;
          byId('c-param-label').textContent=config.paramLabel ?? '';
          param.min=config.min ?? 0; param.max=config.max ?? 0; param.value=config.default ?? '';
        }
      }
      update();
    },
    fillDemo() {
      data.value=config.modeExamples?.[mode.value] ?? config.example;
      secondary.value = config.secondary?.example ?? '';
      param.value=config.default ?? '';
      queries.value=config.tree ? config.targetExample ?? (config.param ? '6, 7' : '30, 35') : '';
      target.value=config.targetExample ?? '';
      second=false; collapsed=false; update();
    },
    read() {
      if (collapsed) return null;
      if (config.tree && !second) { byId('c-next').click(); return null; }
      return readData();
    },
    summarize(input) {
      if (config.chapter) {
        const label = config.modes?.find(([value]) => value === input.mode)?.[1];
        byId('c-summary-text').textContent = config.title + (label ? ' · ' + label : '');
        collapsed = true;
        update();
        byId('c-edit').focus();
        return;
      }
      byId('c-summary-text').textContent=config.title+' · '+(config.field==='runs' ? input.runs.length+' 段' : input[config.field].length+' 项输入')+
        (config.param ? ' · '+config.paramLabel+' '+input[config.param] : '')+
        (config.singleTarget ? (input.target===undefined ? ' · 未设置查询' : ' · 查询 '+input.target) : config.tree ? ' · '+input.queries.length+' 个查询' : '');
      collapsed=true; update(); byId('c-edit').focus();
    }
  };
}
