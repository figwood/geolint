// Binary fixtures follow ESRI's published layout; ring coordinates are explicit in tests.
export function shapeRecord(rings, type = 5) {
  if (type === 0) return new Uint8Array(4);
  if ([1, 11, 21].includes(type)) {
    const bytes = new Uint8Array(type === 1 ? 20 : 28), view = new DataView(bytes.buffer);
    view.setInt32(0, type, true);
    view.setFloat64(4, 500000, true); view.setFloat64(12, 3000000, true);
    return bytes;
  }
  const points = rings.flat();
  if ([8, 18, 28].includes(type)) {
    const extra = type === 8 ? 0 : 16 + points.length * 8;
    const bytes = new Uint8Array(40 + points.length * 16 + extra), view = new DataView(bytes.buffer);
    view.setInt32(0, type, true); view.setInt32(36, points.length, true);
    points.forEach(([x, y], i) => {
      view.setFloat64(40 + i * 16, x, true); view.setFloat64(48 + i * 16, y, true);
    });
    return bytes;
  }
  const extra = [13, 15, 23, 25].includes(type) ? 16 + points.length * 8 : 0;
  const bytes = new Uint8Array(44 + rings.length * 4 + points.length * 16 + extra);
  const view = new DataView(bytes.buffer);
  view.setInt32(0, type, true);
  view.setInt32(36, rings.length, true); view.setInt32(40, points.length, true);
  let start = 0;
  rings.forEach((ring, i) => { view.setInt32(44 + i * 4, start, true); start += ring.length; });
  points.forEach(([x, y], i) => {
    view.setFloat64(44 + rings.length * 4 + i * 16, x, true);
    view.setFloat64(52 + rings.length * 4 + i * 16, y, true);
  });
  return bytes;
}

export function shapefile(records, type = 5) {
  const bytes = new Uint8Array(100 + records.reduce((sum, record) => sum + 8 + record.length, 0));
  const view = new DataView(bytes.buffer);
  view.setInt32(0, 9994); view.setInt32(24, bytes.length / 2);
  view.setInt32(28, 1000, true); view.setInt32(32, type, true);
  let offset = 100;
  records.forEach((record, i) => {
    view.setInt32(offset, i + 1); view.setInt32(offset + 4, record.length / 2);
    bytes.set(record, offset + 8); offset += 8 + record.length;
  });
  return bytes;
}

export const square = [[500000,3000000],[500000,3000010],[500010,3000010],[500010,3000000],[500000,3000000]];
