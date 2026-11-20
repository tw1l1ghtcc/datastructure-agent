import { eInputHelp, validateEInput } from './e-algorithms.js';

function signedInteger(text, label) {
  const value = text.trim();
  if (!/^[+-]?\d+$/.test(value)) throw new TypeError(label + '必须为十进制整数。');
  return Number(value);
}

function commaFields(text) {
  return text.split(/[,，]/).map(value => value.trim());
}

function parseTriples(text) {
  return text.split(/\r?\n/).filter(line => line.trim()).map((line, index) => {
    const parts = commaFields(line);
    if (parts.length !== 3 || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(parts[2]) || !Number.isFinite(Number(parts[2]))) {
      throw new TypeError('第 ' + (index + 1) + ' 行须包含行下标、列下标和有限数值，例如 0,2,4。');
    }
    return { i: signedInteger(parts[0], '行下标'), j: signedInteger(parts[1], '列下标'), e: Number(parts[2]) };
  });
}

export function createEForm({ message, onChange }) {
  const byId = id => document.getElementById(id);
  const data = byId('e-data'), parameters = byId('e-params'), edit = byId('e-edit');
  let config = null, collapsed = false;
  const controls = new Map();

  function update() {
    byId('e-fields').hidden = !config || collapsed;
    byId('e-summary').hidden = !config || !collapsed;
    if (!config) return;
    byId('bfs-next').hidden = true;
    byId('bfs-back').hidden = true;
    byId('fillDemo').parentElement.hidden = collapsed;
    byId('startBtn').hidden = collapsed;
  }

  edit.addEventListener('click', () => {
    collapsed = false;
    update();
    message('');
    data.focus();
  });
  data.addEventListener('input', onChange);
  parameters.addEventListener('input', onChange);

  return {
    setAlgorithm(next) {
      config = next;
      collapsed = false;
      controls.clear();
      data.value = '';
      parameters.replaceChildren();
      if (config) {
        const matrix = config.group === 'matrix';
        data.rows = matrix ? 4 : 2;
        data.placeholder = matrix ? '0,2,4\n1,3,7' : '1, 2, 3';
        byId('e-data-label').textContent = matrix ? '矩阵三元组（每行一项）'
          : config.view === 'linked' ? '链表初始值（从头到尾）' : config.group === 'sort' ? '待排序数组' : '顺序表初始值';
        byId('e-help').textContent = eInputHelp(config);
        for (const [key, title] of config.params ?? []) {
          const label = document.createElement('label');
          const field = document.createElement('input');
          field.id = 'e-' + key;
          field.inputMode = 'numeric';
          field.autocomplete = 'off';
          field.setAttribute('aria-describedby', 'e-help');
          controls.set(key, field);
          label.append(title, field);
          parameters.append(label);
        }
      }
      update();
    },
    fillDemo() {
      const demo = config.example;
      data.value = demo.triples ? demo.triples.map(({ i, j, e }) => [i, j, e].join(', ')).join('\n') : demo.list.join(', ');
      for (const [key, field] of controls) field.value = demo[key];
      update();
      message('示例已填入，可修改输入后运行。');
    },
    read() {
      if (collapsed) return null;
      const input = config.group === 'matrix' ? { triples: parseTriples(data.value) }
        : { list: data.value.trim() ? commaFields(data.value).map(value => signedInteger(value, '序列元素')) : [] };
      for (const [key, label] of config.params ?? []) input[key] = signedInteger(controls.get(key).value, label);
      validateEInput(config, input);
      return input;
    },
    summarize(input) {
      const summary = input.triples ? [input.triples.length + ' 个三元组', input.rows + ' × ' + input.cols]
        : [input.list.length + ' 个元素', ...(config.params ?? []).map(([key, name]) => name + ' ' + input[key])];
      byId('e-summary-text').textContent = [config.title, ...summary].join(' · ');
      collapsed = true;
      update();
      edit.focus();
    },
  };
}
