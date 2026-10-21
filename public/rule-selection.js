export function inspectionSelection(attributesEnabled, topologyIds, getAttributeConfig, getRuleParameters = () => ({})) {
  return {
    attributes: attributesEnabled ? structuredClone(getAttributeConfig()) : { kind: 'geolint-attribute-rules', schemaVersion: '1.0', rules: [] },
    topology: { rules: topologyIds.map(id => ({ id, parameters: structuredClone(getRuleParameters(id)) })) },
  };
}

export function createRuleSelection(get, editor, rules, parameterEditor, normalizeTopology = value => value) {
  const root = get('rules-title').closest('section');
  const attributeInputs = [...root.querySelectorAll('[data-attribute-rule]')];
  const selectedTopology = () => [...root.querySelectorAll('[data-topology-rule]:checked')].map(input => input.dataset.topologyRule);
  const config = () => {
    const selected = inspectionSelection(Boolean(get('attribute-enabled')?.checked), selectedTopology(), () => editor.getConfig(), id => parameterEditor?.read(id) ?? {});
    selected.topology = normalizeTopology(selected.topology);
    return selected;
  };
  function setAttributes(checked) {
    for (const input of attributeInputs) input.checked = checked;
  }
  function render(completed) {
    const attributes = Boolean(get('attribute-enabled')?.checked), topologyIds = selectedTopology();
    setAttributes(attributes);
    const attributeEditor = get('attribute-editor');
    if (attributeEditor) attributeEditor.hidden = !attributes;
    let fieldCount = 0, invalid = false;
    if (attributes) {
      try { fieldCount = editor.getConfig().rules.filter(rule => rule.enabled).length; } catch { invalid = true; }
    }
    get('selection-summary').textContent = `11 required rules · ${topologyIds.length + (attributes ? 6 : 0)} optional rules${attributes ? ` · ${fieldCount} field rules${invalid ? ' (configuration needs correction)' : ''}` : ''}`;
    const list = get('selected-rules'); list.replaceChildren();
    for (const rule of rules.filter(rule => rule.required || (topologyIds.includes(rule.id)) || (rule.executionGroup === 'attributes' && attributes))) {
      const item = document.createElement('li'); item.textContent = `${rule.id} · ${rule.title}`;
      if (topologyIds.includes(rule.id) && parameterEditor) {
        try { const values = parameterEditor.read(rule.id); if (Object.keys(values).length) item.textContent += ' · ' + Object.entries(values).map(([key,value]) => `${key}: ${Array.isArray(value)?value.join(', '):value}`).join(' · '); }
        catch { item.textContent += ' · Configuration required'; invalid = true; }
      }
      list.append(item);
    }
    let changed = false;
    if (completed) {
      try {
        const selected = config();
        changed = JSON.stringify(selected.attributes) !== JSON.stringify(completed.attributeRules) || JSON.stringify(selected.topology.rules) !== JSON.stringify(completed.topology?.options.rules ?? []);
      } catch { changed = true; }
    }
    get('selection-notice').textContent = invalid ? 'Configure the selected rules before starting inspection.' : changed ? 'Rules changed. Start another inspection to apply them; the current report retains its original rules.' : attributes && !invalid && !fieldCount ? 'Add or import at least one enabled field rule to run attribute rules.' : '';
  }
  return { config, render, setAttributes };
}

export function fieldRuleResults(run) {
  const results = new Map(run.attributeRules.rules.filter(rule => rule.enabled).map(rule => [rule.id, { id: rule.id, field: rule.field, issues: 0, records: 0 }]));
  for (const record of run.records) {
    const affected = new Set();
    for (const issue of record.attributeResult.issues) {
      const result = results.get(issue.configuredRuleId);
      if (result) { result.issues++; affected.add(result.id); }
    }
    for (const id of affected) results.get(id).records++;
  }
  return [...results.values()];
}
