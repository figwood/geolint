const number = value => value.toLocaleString('en-US');

// Scale before subtracting so finite coordinates near Number.MAX_VALUE remain drawable.
export function drawThumbnail(canvas, paths, bounds) {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable.');
  context.clearRect(0, 0, canvas.width, canvas.height);
  let magnitude = 0;
  for (const path of paths) for (const [x, y] of path.points) magnitude = Math.max(magnitude, Math.abs(x), Math.abs(y));
  if (bounds) for (const value of bounds) magnitude = Math.max(magnitude, Math.abs(value));
  magnitude ||= 1;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const path of paths) for (const [x, y] of path.points) {
    minX = Math.min(minX, x / magnitude); maxX = Math.max(maxX, x / magnitude);
    minY = Math.min(minY, y / magnitude); maxY = Math.max(maxY, y / magnitude);
  }
  if (bounds) [minX, minY, maxX, maxY] = bounds.map(value => value / magnitude);
  if (!Number.isFinite(minX)) return;
  const width = maxX - minX, height = maxY - minY;
  const scale = Math.min(width > 0 ? (canvas.width - 32) / width : Infinity, height > 0 ? (canvas.height - 32) / height : Infinity);
  const factor = Number.isFinite(scale) ? scale : 1;
  const project = ([x, y]) => [canvas.width / 2 + (x / magnitude - minX - width / 2) * factor,
    canvas.height / 2 - (y / magnitude - minY - height / 2) * factor];
  context.strokeStyle = '#185b49'; context.fillStyle = '#3575ac'; context.lineWidth = 1.5;
  for (const path of paths) {
    context.beginPath();
    if (path.points.length === 1) {
      const [x, y] = project(path.points[0]); context.arc(x, y, 2.5, 0, Math.PI * 2); context.fill();
    } else {
      path.points.forEach((point, index) => { const [x, y] = project(point); if (index === 0) context.moveTo(x, y); else context.lineTo(x, y); });
      if (path.closed) context.closePath();
      context.stroke();
    }
  }
}

export function createFilePreview(get, options = {}) {
  const document = options.document ?? globalThis.document;
  const createWorker = options.createWorker ?? (() => new Worker(new URL('./core/worker/preview.worker.js', import.meta.url), { type: 'module' }));
  let worker, generation = 0, requestId = 0;
  const element = (tag, text) => { const node = document.createElement(tag); node.textContent = text; return node; };
  function clear() {
    generation++; requestId++;
    worker?.terminate(); worker = undefined;
    get('file-preview').hidden = true;
    get('preview-data').hidden = true; get('preview-geometry').hidden = true;
    get('preview-status').textContent = '';
    get('preview-geometry-status').textContent = '';
    get('preview-head').replaceChildren(); get('preview-rows').replaceChildren();
  }
  function renderSummary(result) {
    const rows = result.rows.slice(0, 20);
    const header = element('tr', '');
    for (const name of [result.fields.includes('geometry') ? 'geometry.type' : 'geometry', ...result.fields]) {
      const cell = element('th', name); cell.scope = 'col'; header.append(cell);
    }
    get('preview-head').replaceChildren(header);
    for (const row of rows) {
      const tr = element('tr', '');
      for (const text of [row.geometryType === 'None' ? '' : row.geometryType, ...row.values]) tr.append(element('td', text));
      get('preview-rows').append(tr);
    }
    get('preview-caption').textContent = `First ${rows.length} of ${number(result.total)} records. ${result.fields.length} displayed attribute fields${result.fieldsTruncated ? ' (limited to 20)' : ''}. Long values are truncated.`;
    get('preview-table').hidden = false;
    get('preview-status').textContent = '';
    get('preview-data').hidden = false;
    requestThumbnail();
  }
  function fail(message) {
    worker?.terminate(); worker = undefined; requestId++;
    get('preview-data').hidden = true; get('preview-geometry').hidden = true;
    get('preview-status').textContent = `Preview unavailable: ${message}`;
  }
  function select(file) {
    clear(); const token = generation;
    get('file-preview').hidden = false; get('preview-status').textContent = 'Reading data for preview…';
    try {
      worker = createWorker();
      worker.onmessage = event => {
        if (token !== generation) return;
        const message = event.data;
        if (message.type === 'failed') { fail(message.message); return; }
        if (message.type === 'summary') { renderSummary(message.result); return; }
        if (message.type !== 'thumbnail' || message.requestId !== requestId || get('preview-geometry').hidden) return;
        const result = message.result;
        try { drawThumbnail(get('preview-canvas'), result.paths, result.bounds); }
        catch { get('preview-geometry-status').textContent = 'Geometry thumbnail is unavailable in this browser.'; return; }
        get('preview-geometry-status').textContent = result.paths.length
          ? ''
          : 'No drawable 2D geometry in this file.';
      };
      worker.onerror = event => { event.preventDefault(); if (token === generation) fail('The preview worker stopped unexpectedly.'); };
      worker.onmessageerror = () => { if (token === generation) fail('Could not receive preview data.'); };
      worker.postMessage({ type: 'load', file });
    } catch { fail('Could not start the preview worker.'); }
  }
  function requestThumbnail() {
    if (!worker) return;
    requestId++;
    get('preview-geometry').hidden = false;
    get('preview-geometry-status').textContent = 'Preparing geometry thumbnail…';
    get('preview-canvas').getContext('2d')?.clearRect(0, 0, get('preview-canvas').width, get('preview-canvas').height);
    worker.postMessage({ type: 'thumbnail', requestId });
  }

  clear();
  return { select, clear };
}
