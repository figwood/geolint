// Compare coordinates and ring ownership, never GEOS validity or repaired geometry.
function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

// Linear-time least cyclic rotation; repeated vertices must remain in the sequence.
function rotate(tokens) {
  const length = tokens.length;
  let first = 0, second = 1, offset = 0;
  while (first < length && second < length && offset < length) {
    const a = tokens[(first + offset) % length], b = tokens[(second + offset) % length];
    if (a === b) { offset++; continue; }
    if (a > b) { first += offset + 1; if (first === second) first++; }
    else { second += offset + 1; if (first === second) second++; }
    offset = 0;
  }
  const start = Math.min(first, second);
  return JSON.stringify([...tokens.slice(start), ...tokens.slice(0, start)]);
}

function ringKey(ring) {
  requireValue(Array.isArray(ring) && ring.length >= 4, 'Expected a closed polygon ring.');
  for (const point of ring) requireValue(Array.isArray(point) && point.length === 2 && point.every(Number.isFinite), 'Expected finite 2D coordinates.');
  requireValue(ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1], 'Expected a closed polygon ring.');
  const tokens = ring.slice(0, -1).map(point => JSON.stringify(point));
  const forward = rotate(tokens), backward = rotate([...tokens].reverse());
  return forward < backward ? forward : backward;
}

export function canonicalPolygon(geometry) {
  requireValue(geometry && ['Polygon', 'MultiPolygon'].includes(geometry.type) && Array.isArray(geometry.coordinates), 'Expected a Polygon or MultiPolygon.');
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  requireValue(polygons.length > 0, 'Expected nonempty polygon coordinates.');
  return polygons.map(rings => {
    requireValue(Array.isArray(rings) && rings.length > 0, 'Expected a polygon shell.');
    return JSON.stringify({ shell: ringKey(rings[0]), holes: rings.slice(1).map(ringKey).sort() });
  }).sort();
}

function pointKey(point) {
  requireValue(Array.isArray(point) && point.length === 2 && point.every(Number.isFinite), 'Expected finite 2D coordinates.');
  return JSON.stringify(point);
}

function canonicalGeometry(geometry, depth = 0) {
  requireValue(geometry && depth <= 64, 'Expected a geometry within the nesting limit.');
  if (geometry.type === 'GeometryCollection') {
    requireValue(depth < 64, 'GeometryCollection nesting exceeds the comparison limit.');
    requireValue(Array.isArray(geometry.geometries) && geometry.geometries.length > 0, 'Expected collection members.');
    return { type: 'GeometryCollection', members: geometry.geometries.map(member => canonicalGeometry(member, depth + 1)) };
  }
  if (['Polygon', 'MultiPolygon'].includes(geometry.type)) return { type: 'polygon', parts: canonicalPolygon(geometry) };
  requireValue(Array.isArray(geometry.coordinates) && geometry.coordinates.length > 0, 'Expected nonempty coordinates.');
  if (['Point', 'MultiPoint'].includes(geometry.type)) {
    const points = geometry.type === 'Point' ? [geometry.coordinates] : geometry.coordinates;
    return { type: 'point', parts: points.map(pointKey).sort() };
  }
  requireValue(['LineString', 'MultiLineString'].includes(geometry.type), 'Unsupported geometry in independent comparison.');
  const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
  return { type: 'line', parts: lines.map(line => {
    requireValue(Array.isArray(line) && line.length >= 2, 'Expected at least two line positions.');
    const tokens = line.map(pointKey);
    const forward = JSON.stringify(tokens), backward = JSON.stringify([...tokens].reverse());
    return forward < backward ? forward : backward;
  }).sort() };
}

function compareInputRecords(expected, reference, file) {
  requireValue(Array.isArray(expected) && Array.isArray(reference) && expected.length === reference.length, `${file}: record counts differ.`);
  const indexes = new Set();
  for (let i = 0; i < expected.length; i++) {
    const a = expected[i], b = reference[i];
    requireValue(a && b && Number.isSafeInteger(a.featureIndex) && a.featureIndex >= 0 && a.featureIndex === b.featureIndex && !indexes.has(b.featureIndex), `${file}: record indexes are missing, duplicated or reordered.`);
    indexes.add(b.featureIndex);
    if (a.disposition === 'check') {
      requireValue(JSON.stringify(canonicalGeometry(a.geometry)) === JSON.stringify(canonicalGeometry(b.geometry)), `${file} record ${a.featureIndex}: geometry differs.`);
    } else {
      requireValue(a.disposition === 'skipped' && a.reasonCode === 'EMPTY_GEOMETRY' && b.geometry === null, `${file} record ${a.featureIndex}: expected an independently read empty geometry.`);
    }
  }
}

export function compareInputFiles(expected, reference) {
  requireValue(Array.isArray(expected) && expected.length > 0 && reference?.status === 'completed' && Array.isArray(reference.files), 'Independent input reading did not complete.');
  requireValue(expected.length === reference.files.length, 'Independent input file counts differ.');
  const files = new Set();
  for (let i = 0; i < expected.length; i++) {
    const a = expected[i], b = reference.files[i];
    requireValue(a && b && typeof a.file === 'string' && a.file === b.file && !files.has(b.file) && b.status === 'completed', 'Independent input files are missing, duplicated, reordered or failed.');
    files.add(b.file);
    compareInputRecords(a.records, b.records, a.file);
  }
}
