import test from 'node:test';import assert from 'node:assert/strict';
import {checkGeometryCheckerRegression,compareGeometryChecker} from '../validation/topology/geometry-checker.mjs';
test('all QGIS single-layer fixtures have independent fixed expectations and real WASM output',async()=>{
 const {report,expected}=await checkGeometryCheckerRegression();assert.equal(report.cases.length,58);assert.equal(new Set(expected.cases.map(c=>c.ruleId)).size,17);
 const reference={...structuredClone(report),qgisVersion:'3.44.0',referenceKind:'pyqgis-geometry-checker-algorithms'};
 reference.cases.find(c=>c.ruleId==='Rule-034'&&c.issues.length).issues[0].measurements={area:10,thinness:10,maxArea:0,maxThinness:9};
 assert.equal(compareGeometryChecker(report,reference,expected).status,'matched');
 for(const mutate of [r=>r.cases.pop(),r=>r.cases[0].issues.pop(),r=>r.cases[0].issues[0].location.x=20,r=>r.geosVersion='3.12.0',r=>r.referenceKind='product-copy']){
  const r=structuredClone(reference);mutate(r);assert.equal(compareGeometryChecker(report,r,expected).status,'failed');
 }
 const missing=structuredClone(report);missing.cases[0].issues=[];const both={...structuredClone(missing),qgisVersion:'3.44.0',referenceKind:'pyqgis-geometry-checker-algorithms'};assert.equal(compareGeometryChecker(missing,both,expected).status,'failed');
});
