import { emptyAttributeRuleFile, parseAttributeRuleFile, readAttributeRuleFile, serializeAttributeRuleFile, MAX_RULE_FILE_BYTES } from './core/attributes/config.js';
import { numberConstraint } from './core/ui/attribute-input.js';

const example = { kind: 'geolint-attribute-rules', schemaVersion: '1.0', rules: [
  { id: 'pid-required', field: 'PID', required: true },
  { id: 'geo-type', field: 'geo_type', type: 'int' },
  { id: 'geo-area', field: 'geo_area', type: 'double', constraints: { exclusiveMinimum: 0 } },
] };

export function createAttributeRuleEditor(root) {
  let config = emptyAttributeRuleFile(), dirty = false;
  const listeners = new Set();
  const get = id => root.querySelector('#' + id);
  const list = get('rule-list'), message = get('rules-message');
  function validate() {
    try {
      const parsed = parseAttributeRuleFile(config);
      message.textContent = `${parsed.rules.filter(r => r.enabled).length} enabled rules · ${dirty ? 'Unsaved changes' : 'Configuration ready'}.`;
      get('rules-export').disabled = false;
    } catch (error) {
      message.textContent = error.message;
      get('rules-export').disabled = true;
    }
  }
  function changed() { dirty = true; validate(); for (const listener of listeners) listener(); }
  function control(container, rule, key, label, kind = 'text', options, constraint = false) {
    const wrapper = document.createElement('label'); wrapper.className = 'rule-control';
    const name = document.createElement('span'); name.textContent = label; wrapper.append(name);
    const input = document.createElement(kind === 'select' ? 'select' : 'input');
    input.dataset.key = key;
    if (kind === 'select') {
      for (const [value, text] of options) {
        const option = document.createElement('option'); option.value = value; option.textContent = text; input.append(option);
      }
    } else input.type = kind;
    const value = constraint ? rule.constraints?.[key] : rule[key];
    if (kind === 'checkbox') input.checked = !!value;
    else input.value = key === 'enum' && value !== undefined ? JSON.stringify(value) : value ?? '';
    if (kind === 'number') input.step = key.endsWith('Length') ? '1' : 'any';
    if (key === 'enum') input.placeholder = '["A", "B"] or [1, 2]';
    input.addEventListener(kind === 'select' || kind === 'checkbox' ? 'change' : 'input', () => {
      const target = constraint ? (rule.constraints ??= {}) : rule;
      if (kind === 'checkbox') target[key] = input.checked;
      else if (kind === 'number') {
        const number = numberConstraint(input.value, input.validity.badInput);
        if (number === undefined) delete target[key]; else target[key] = number;
      }
      else if (constraint && input.value === '') delete target[key];
      else if (key === 'enum') {
        try { target[key] = JSON.parse(input.value); }
        catch { target[key] = input.value; }
      } else if (key === 'type' && input.value === '') delete target[key];
      else target[key] = input.value;
      if (key === 'type') {
        const c = rule.constraints;
        if (c) {
          if (!['int', 'double'].includes(rule.type)) for (const k of ['minimum','maximum','exclusiveMinimum','exclusiveMaximum']) delete c[k];
          if (rule.type !== 'string') for (const k of ['minLength','maxLength','pattern']) delete c[k];
        }
        render();
      }
      changed();
    });
    wrapper.append(input); container.append(wrapper);
  }
  function render() {
    list.replaceChildren();
    config.rules.forEach((rule, index) => {
      const card = document.createElement('fieldset'); card.className = 'attribute-rule';
      const legend = document.createElement('legend'); legend.textContent = `Field rule ${index + 1}`; card.append(legend);
      const grid = document.createElement('div'); grid.className = 'rule-grid'; card.append(grid);
      control(grid, rule, 'id', 'Configuration ID'); control(grid, rule, 'field', 'Field name');
      control(grid, rule, 'type', 'Type', 'select', [['','Any type'],['string','string'],['int','int (safe integer)'],['double','double (finite number)'],['boolean','boolean'],['date','date (YYYY-MM-DD)']]);
      const flags = document.createElement('div'); flags.className = 'rule-flags'; card.append(flags);
      for (const [key,label] of [['enabled','Enabled'],['required','Field required'],['allowNull','Allow null'],['allowEmpty','Allow empty string']]) control(flags,rule,key,label,'checkbox');
      const constraints = document.createElement('div'); constraints.className = 'rule-grid'; card.append(constraints);
      if (['int','double'].includes(rule.type)) {
        for (const [key,label] of [['minimum','Minimum (≥)'],['maximum','Maximum (≤)'],['exclusiveMinimum','Greater than (>)'],['exclusiveMaximum','Less than (<)']]) control(constraints,rule,key,label,'number',undefined,true);
      }
      if (rule.type === 'string') {
        control(constraints,rule,'minLength','Minimum length','number',undefined,true);
        control(constraints,rule,'maxLength','Maximum length','number',undefined,true);
        control(constraints,rule,'pattern','Regular expression','text',undefined,true);
      }
      control(constraints,rule,'enum','Allowed values (JSON array)','text',undefined,true);
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'rule-delete'; remove.textContent = 'Delete rule';
      remove.addEventListener('click',()=>{config.rules.splice(index,1);render();changed();});card.append(remove);list.append(card);
    });
    if (!config.rules.length) { const note = document.createElement('p'); note.textContent = 'No attribute rules. Only spatial checks will run.'; list.append(note); }
  }
  function replace(next) {
    if (dirty && !window.confirm('Replace the current attribute rules? Unsaved edits will be lost.')) return false;
    config = next; dirty = false; render(); validate(); for (const listener of listeners) listener(); return true;
  }
  get('rules-add').addEventListener('click',()=>{
    if (config.rules.length >= 500) { message.textContent = 'At most 500 rules are allowed.'; return; }
    config.rules.push({id:crypto.randomUUID(),field:'',enabled:true,required:false,allowNull:false,allowEmpty:true});render();changed();
  });
  get('rules-example').addEventListener('click',()=>{ if (replace(parseAttributeRuleFile(example))) { dirty = true; validate(); } });
  get('rules-import').addEventListener('change', async event => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    message.textContent = 'Reading rules…';
    try {
      if (file.size > MAX_RULE_FILE_BYTES) throw new Error('Rule file exceeds 1 MiB.');
      const next = readAttributeRuleFile(await file.text());
      if (!replace(next)) message.textContent = 'Import cancelled. Current rules retained.';
    } catch (error) { message.textContent = error.message; }
  });
  get('rules-export').addEventListener('click',()=>{
    try {
      const text = serializeAttributeRuleFile(config), url = URL.createObjectURL(new Blob([text],{type:'application/json;charset=utf-8'}));
      const link = document.createElement('a'); link.href = url; link.download = 'attribute-rules.json'; document.body.append(link); link.click(); link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1000); dirty = false; validate();
    } catch (error) { message.textContent = error.message; }
  });
  render(); validate();
  return { getConfig: () => parseAttributeRuleFile(config), onChange: listener => listeners.add(listener) };
}
