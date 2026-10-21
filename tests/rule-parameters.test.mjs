import test from 'node:test';import assert from 'node:assert/strict';
import { parameterValues } from '../public/rule-parameters.js';
import { qgisParameters } from '../src/topology/checkers/qgis-common.ts';
import { inspectionSelection } from '../public/rule-selection.js';
test('parameter input preserves required blanks and normalizes finite business thresholds',()=>{
 assert.deepEqual(parameterValues({minLength:'2',toleranceDigits:'8'}),{minLength:2,toleranceDigits:8});
 assert.throws(()=>qgisParameters('Rule-031',parameterValues({minLength:''})));
 assert.throws(()=>qgisParameters('Rule-031',parameterValues({minLength:'Infinity'})));
 const values=parameterValues({allowedTypes:['Point','MultiPoint']});assert.deepEqual(qgisParameters('Rule-040',values).allowedTypes,['Point','MultiPoint']);
});
test('selection clones rule parameters as part of the immutable run snapshot',()=>{
 const parameters={minLength:2,toleranceDigits:8};
 const selected=inspectionSelection(false,['Rule-031'],()=>{},()=>parameters);parameters.minLength=5;
 assert.equal(selected.topology.rules[0].parameters.minLength,2);
});
