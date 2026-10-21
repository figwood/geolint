export function parameterValues(values) {
  return Object.fromEntries(Object.entries(values).filter(([,value]) => value !== '').map(([key,value]) => [key, Array.isArray(value) ? [...value] : Number(value)]));
}
export function createRuleParameters(root, definitions, parseRule) {
  const editors = new Map();
  for (const definition of definitions) {
    const row = root.querySelector(`[data-rule-id="${definition.id}"]`);
    if (!row) continue;
    const cell = row.querySelector('td'), toggle = row.querySelector('[data-topology-rule]');
    const panel = document.createElement('div'); panel.className = 'rule-parameters'; panel.hidden = !toggle.checked;
    const inputs = new Map(), error = document.createElement('p');
    error.className = 'parameter-error'; error.setAttribute('role', 'status'); error.id = `error-${definition.id}`;
    const fields = {...(definition.precision ? {toleranceDigits:{min:0,max:15,default:8,unit:'decimal digits (0–15)'}} : {}), ...definition.fields};
    for (const [key, field] of Object.entries(fields)) {
      const label = document.createElement('label'), input = document.createElement('input');
      label.textContent = `${key} · ${field.unit}`;
      input.type = 'number'; input.step = key === 'toleranceDigits' ? '1' : 'any'; input.min = String(field.min);
      if (field.max !== undefined) input.max = String(field.max);
      input.value = field.default === undefined ? '' : String(field.default);
      input.id = `parameter-${definition.id}-${key}`; input.dataset.ruleParameter = key;
      input.setAttribute('aria-describedby', error.id); label.htmlFor = input.id;
      inputs.set(key,input); label.append(input); panel.append(label);
    }
    if (definition.id === 'Rule-040') {
      const fieldset = document.createElement('fieldset'), legend = document.createElement('legend'); legend.textContent = 'Allowed geometry types'; fieldset.append(legend);
      const types = [];
      for (const type of definition.types) {
        const label = document.createElement('label'), input = document.createElement('input'); input.type = 'checkbox'; input.value = type;
        input.setAttribute('aria-label', `${definition.id} allowed type ${type}`); label.append(input, document.createTextNode(type)); fieldset.append(label); types.push(input);
      }
      inputs.set('allowedTypes',types); panel.append(fieldset);
    }
    // Rules without configurable fields need no empty panel.
    if (inputs.size) {panel.append(error);cell.append(panel);}
    editors.set(definition.id,{panel,inputs,error,toggle});
    toggle.addEventListener('change',()=>{panel.hidden=!toggle.checked;if(!toggle.checked)error.textContent='';});
  }
  function read(id) {
    const editor = editors.get(id);
    if (!editor) return {};
    const values = Object.fromEntries([...editor.inputs].map(([key,input])=>[key,Array.isArray(input)?input.filter(i=>i.checked).map(i=>i.value):input.value]));
    try {
      const result = parseRule(id,parameterValues(values)); editor.error.textContent='';
      for(const input of editor.inputs.values())if(!Array.isArray(input))input.removeAttribute('aria-invalid');
      return result;
    } catch {
      editor.error.textContent = `${id}: configure the required values within their displayed ranges.`;
      for(const input of editor.inputs.values())if(!Array.isArray(input))input.setAttribute('aria-invalid','true');
      throw new Error(editor.error.textContent);
    }
  }
  return {read,validate(){let valid=true;for(const [id,editor] of editors)if(editor.toggle.checked)try{read(id);}catch{valid=false;}return valid;}};
}
