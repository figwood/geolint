import { createRuleParameters } from './rule-parameters.js';
import { qgisRules } from './core/topology/qgis-catalog.js';
import { qgisParameters } from './core/topology/checkers/qgis-common.js';
import { parseTopologyOptions } from './core/topology/config.js';
import { startInspection } from './core/worker/client.js';
import { buildJsonReport, buildCsvReport } from './core/report/export.js';
import { recordPage, completionNotice, unifiedResults, sourceRecordPage } from './core/ui/results.js';
import { reportFileName } from './core/ui/report-filename.js';

import { createRuleSelection } from './rule-selection.js';

import { resultVerdict } from './result-status.js';

import { createWizard } from './wizard.js';
import { createFilePreview } from './file-preview.js';
import { bindFileDrop } from './file-drop.js';

import { ruleIdsForReason, checkRules } from './core/diagnostics.js';

const get = id => document.getElementById(id);
let task, completed, lastFile, page = 0, generation = 0, recordFilter = 'invalid';
let results;
const parameterEditor = createRuleParameters(get('step-rules'), qgisRules, qgisParameters);
const selection = createRuleSelection(get, undefined, checkRules, parameterEditor, parseTopologyOptions);
const wizard = createWizard(get);
const filePreview = createFilePreview(get);
const urls = new Set();
function reset() {
  completed = undefined;
  page = 0;
  recordFilter = 'invalid';
  results = undefined;
  get('output').hidden = true;
  get('rows').replaceChildren();
  get('stats').replaceChildren();
  get('result-verdict').className = 'result-verdict';
  get('verdict-title').textContent = '';
  get('verdict-description').textContent = '';
  get('verdict-icon').textContent = '';
  get('download-menu').open = false;
  get('json').disabled = true;
  get('csv').disabled = true;
  get('export-status').textContent = '';
  renderRuleSelection();
  for (const url of urls) URL.revokeObjectURL(url);
  urls.clear();
}
function renderPage() {
  if (!completed) return;
  const view = recordPage(results.records, recordFilter, page);
  page = view.page;
  for (const card of document.querySelectorAll('.stat-filter')) card.setAttribute('aria-pressed', String(card.dataset.filter === recordFilter));
  get('rows').replaceChildren();
  for (const record of view.records) {
    const row = document.createElement('tr'); row.id = record.sourceRecord ? `record-${record.featureIndex}` : `dataset-${record.recordKey}`; row.tabIndex = -1;
    const id = record.featureId === null ? '#' + record.featureIndex : JSON.stringify(record.featureId);
    for (const value of [record.sourceRecord ? `${record.featureIndex} / ${id}` : `Dataset / ${record.recordKey}`, record.geometryType ?? 'None', record.status,
      [record.sourceRecord && !(record.sourceRecord.status === 'valid' && record.issues.length) ? record.reason : '', ...record.warnings].filter(Boolean).join(' · '),
      record.location ? `${record.location.x}, ${record.location.y}` : 'Not provided']) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    const spatialStatus = document.createElement('span');
    spatialStatus.className = `status-badge status-${record.status}`;
    spatialStatus.textContent = record.status;
    row.children[2].replaceChildren(spatialStatus);
    const references = document.createElement('td');
    const addReference = (id, file) => {
      const link = document.createElement('a');
      link.href = `./${file}.html#${id}`; link.textContent = id;
      references.append(link, document.createTextNode(' '));
    };
    const ruleIds = new Set([...ruleIdsForReason(record.reasonCode), ...record.issues.map(issue => issue.ruleId), ...record.exclusions.map(exclusion => exclusion.ruleId), ...record.uncheckedRuleIds]);
    for (const id of ruleIds) addReference(id, 'rules');
    if (!references.childNodes.length) references.textContent = record.reasonCode;
    row.insertBefore(references, row.children[3]);
    const locationCell = row.children[5];
    const locatedIssues = record.issues.filter(issue => issue.location);
    if (locatedIssues.length) {
      locationCell.replaceChildren();
      for (const issue of locatedIssues) { const item = document.createElement('p'); item.dataset.issueLocation = issue.issueId; item.textContent = `${issue.ruleId} · ${issue.location.x}, ${issue.location.y}`; locationCell.append(item); }
    }
    const reasons = row.children[4], recordTopology = record;
    reasons.className = 'result-reasons';
    if (recordTopology.issues.length) {
      const list = document.createElement('ul'); list.className = 'topology-problems';
      for (const issue of recordTopology.issues) {
        const item = document.createElement('li'); item.dataset.issueId = issue.issueId;
        item.append(document.createTextNode(issue.reason));
        if (issue.measurements) item.append(document.createTextNode(' · ' + Object.entries(issue.measurements).map(([key,value]) => `${key}: ${value}`).join(' · ')));
        if (issue.occurrence) { const detail = document.createElement('span'); detail.textContent = ' · ' + issue.occurrence.sources.map(source => Object.entries(source).filter(([key]) => key !== 'recordKey').map(([key,value]) => `${key} ${value}`).join(', ')).filter(Boolean).join(' / '); item.append(detail); }
        for (const participant of issue.participants) {
          const link = document.createElement('a'); link.href = `#record-${participant.featureIndex}`;
          link.textContent = participant.recordKey + (participant.featureId === null ? '' : ` (ID ${JSON.stringify(participant.featureId)})`);
          link.addEventListener('click', event => {
            event.preventDefault();
            const sourcePage = sourceRecordPage(results.records, participant.recordKey);
            if (sourcePage === null) return;
            recordFilter = 'all'; page = sourcePage; renderPage();
            const target = get(`record-${participant.featureIndex}`); target?.focus(); target?.scrollIntoView({ block: 'center' });
          });
          item.append(document.createTextNode(' · '), link);
        }
        if (issue.geometry) {
          const detail = document.createElement('details'), title = document.createElement('summary'), geometry = document.createElement('pre');
          title.textContent = 'Problem region (GeoJSON)'; geometry.textContent = JSON.stringify(issue.geometry);
          detail.append(title, geometry); item.append(detail);
        }
        list.append(item);
      }
      reasons.append(list);
    }
    for (const reasonCode of new Set(recordTopology.exclusions.map(exclusion => exclusion.reasonCode))) {
      const note = document.createElement('p'); note.textContent = reasonCode; reasons.append(note);
    }
    if (recordTopology.uncheckedRuleIds.length) {
      const note = document.createElement('p'); note.textContent = 'Some selected checks were not run.'; reasons.append(note);
    }
    get('rows').append(row);
  }
  get('page-position').textContent = `${page + 1}/${view.pages}`;
  get('previous').disabled = page === 0;
  get('next').disabled = page + 1 >= view.pages;
}
function display(message) {
  if (message.type === 'progress') {
    const phases = {reading:'Reading file', parsing:'Parsing geometry', 'loading-engine':'Loading geometry engine', checking:'Checking geometry', 'topology-preparing':'Preparing topology', 'topology-checking':'Checking topology'};
    get('status').textContent = `${phases[message.phase]}: ${message.processed}${message.total === null ? '' : ` / ${message.total}`} records`;
    if (message.topology) get('status').textContent += ` · ${message.topology.candidates} candidates · ${message.topology.checks} checks`;
    if (message.total && message.phase === 'checking') { get('progress').max = message.total; get('progress').value = message.processed; }
    else get('progress').removeAttribute('value');
    return;
  }
  get('cancel').disabled = true;
  get('progress').hidden = true;
  if (message.type !== 'completed') {
    reset();
    wizard.finish(false);
    get('status').textContent = message.type === 'cancelled' ? `Cancelled. ${message.processed} records processed; no complete report.` : `${message.code}: ${message.message} Choose another file to try again.`;
    if (message.type === 'failed' || message.type === 'cancelled') {
      for (const id of ruleIdsForReason(message.code)) {
        const link = document.createElement('a');
        link.href = `./rules.html#${id}`;
        link.textContent = ` ${id} — Rule explanation`;
        get('status').append(link);
      }
    }
    return;
  }
  completed = message.result;
  results = unifiedResults(completed);
  const verdict = resultVerdict(results.summary, completed.attributeSummary, completed.topology);
  get('result-verdict').className = `result-verdict verdict-${verdict.tone}`;
  get('verdict-title').textContent = verdict.title;
  get('verdict-description').textContent = verdict.description;
  get('verdict-icon').textContent = { success: '✓', error: '!', warning: '!' }[verdict.tone];
  get('notice').textContent = completed.topology.summary.issues || completed.topology.rules.some(rule => rule.coverage !== 'complete' || rule.status === 'skipped')
    ? '' : completionNotice(completed.summary, completed.attributeSummary);
  get('results-caption').textContent = `${completed.records.length} source records${results.datasetIssues ? ` · ${results.datasetIssues} dataset problems` : ''}. Invalid includes geometry validity and selected constraint or spatial relationship problems; each affected record is counted once. Review check coverage for skipped or unchecked comparisons.`;
  get('notice').hidden = !get('notice').textContent;
  renderCheckCoverage();
  renderRuleSelection();
  for (const [key, label] of Object.entries({total:'Total results',checked:'Checked',valid:'Valid',invalid:'Invalid',skipped:'Skipped',parseFailed:'Parse failed',engineFailed:'Engine failed'})) {
    const card = document.createElement('button'); card.type = 'button'; card.className = 'stat stat-filter';
    card.dataset.filter = { total:'all', checked:'checked', valid:'valid', invalid:'invalid', skipped:'skipped', parseFailed:'parse_failed', engineFailed:'engine_failed' }[key];
    card.setAttribute('aria-controls', 'results');
    card.addEventListener('click', () => { recordFilter = card.dataset.filter; page = 0; renderPage(); });
    if (results.summary[key] > 0) {
      if (key === 'valid') card.classList.add('stat-success');
      if (['invalid', 'parseFailed', 'engineFailed'].includes(key)) card.classList.add('stat-error');
      if (key === 'skipped') card.classList.add('stat-warning');
    }
    const value = document.createElement('strong'); value.textContent = results.summary[key];
    const name = document.createElement('span'); name.textContent = label; card.append(value, name); get('stats').append(card);
  }
  get('output').hidden = false;
  get('json').disabled = false;
  get('csv').disabled = false;
  renderPage();
  wizard.finish(true);
  get('status').textContent = 'Inspection completed.';
}
function selectFile(file) {
  generation++;
  task?.cancel(); reset();
  lastFile = file;
  get('file-name').textContent = `${file.name} · ${(file.size / 1024).toFixed(1)} KiB`;
  get('recheck').disabled = false;
  get('cancel').disabled = true;
  get('progress').hidden = true;
  get('status').textContent = 'File selected. Configure rules, then click Start inspection.';
  get('file-status').textContent = '';
  wizard.setFile(true);
  filePreview.select(file);
}
function begin(file) {
  let selected;
  try { selected = structuredClone(selection.config()); } catch {
    parameterEditor.validate(); wizard.navigate('rules');
    get('selection-notice').textContent = 'Configure the selected rules before starting inspection.'; return;
  }
  if (!wizard.start()) return;
  lastFile = file;
  const token = ++generation;
  task?.cancel(); reset();
  get('file-name').textContent = `${file.name} · ${(file.size / 1024).toFixed(1)} KiB`;
  get('status').textContent = 'Starting inspection…';
  get('cancel').disabled = false;
  get('progress').hidden = false;
  get('progress').removeAttribute('value');
  task = startInspection(file, message => { if (token === generation) display(message); }, selected.attributes, selected.topology);
}
function renderCheckCoverage() {
  const root = get('check-coverage-results'); root.replaceChildren();
  get('check-coverage').hidden = completed.topology.status === 'disabled';
  for (const rule of completed.topology.rules) {
    const item = document.createElement('p');
    const link = document.createElement('a'); link.href = `./rules.html#${rule.ruleId}`; link.textContent = rule.ruleId;
    item.append(link, document.createTextNode(` · ${rule.status} · ${rule.coverage} coverage · ${rule.checkCount} checks · ${rule.issues.length} problems · ${rule.exclusions.length} excluded records`));
    root.append(item);
  }
}
function renderRuleSelection() {
  selection.render(completed);
}
for (const input of document.querySelectorAll('[data-topology-rule]')) input.addEventListener('change', renderRuleSelection);
get('step-rules').addEventListener('input', renderRuleSelection);
selection.render();
bindFileDrop(get('file-drop-zone'), get('file'), selectFile);
get('file').addEventListener('change', event => {
  const file = event.target.files?.[0];
  if (file) selectFile(file);
  event.target.value = '';
});
get('cancel').addEventListener('click', () => task?.cancel());
get('recheck').addEventListener('click', () => { if (lastFile) begin(lastFile); });
get('previous').addEventListener('click', () => { page--; renderPage(); });
get('next').addEventListener('click', () => { page++; renderPage(); });
function download(format) {
  if (!completed) return;
  get('download-menu').open = false;
  get('export-status').textContent = '';
  try {
    const text = format === 'json' ? buildJsonReport(completed) : buildCsvReport(completed);
    const url = URL.createObjectURL(new Blob([text], { type: format === 'json' ? 'application/json;charset=utf-8' : 'text/csv;charset=utf-8' }));
    urls.add(url);
    const link = document.createElement('a'); link.href = url; link.download = reportFileName(completed.run.fileName, format);
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => { URL.revokeObjectURL(url); urls.delete(url); }, 1000);
  } catch { get('export-status').textContent = 'Report export failed. Modify rules and run another inspection, then try again.'; }
}
document.addEventListener('click', event => {
  if (!get('download-menu').contains(event.target)) get('download-menu').open = false;
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && get('download-menu').open) {
    get('download-menu').open = false;
    get('download').focus();
  }
});
get('json').addEventListener('click', () => download('json'));
get('csv').addEventListener('click', () => download('csv'));
window.addEventListener('pagehide', () => { generation++; task?.cancel(); reset(); });
