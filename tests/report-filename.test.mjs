import test from 'node:test';
import assert from 'node:assert/strict';
import { reportFileName } from '../src/ui/report-filename.ts';

test('report filenames use the input basename and chosen export extension', () => {
  for (const [input, base] of [
    ['roads.geojson','roads'], ['roads.json','roads'], ['roads.shp','roads'],
    ['roads.zip','roads'], ['roads.GEOJSON','roads'], ['roads.v2.geojson','roads.v2'],
    ['café layer.zip','café layer'], ['roads','roads'],
  ]) {
    for (const format of ['csv','json']) assert.equal(reportFileName(input, format), `${base}_check_result.${format}`);
  }
});
