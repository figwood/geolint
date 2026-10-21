import type { GeometryEngine, InspectionRecord, NormalizedRecord } from '../contracts.ts';
import type { AttributeRule } from '../attributes/contracts.ts';
import { inspectAttributes } from '../attributes/inspect.ts';
export function inspectRecord(record: NormalizedRecord, engine: GeometryEngine, rules: readonly AttributeRule[] = []): InspectionRecord {
  const ref = { recordKey: record.recordKey, featureIndex: record.featureIndex, featureId: record.featureId,
    featureIdType: record.featureIdType, geometryType: record.geometryType, warnings: [...record.warnings], ...(record.preflightEvidence ? {preflightEvidence:structuredClone(record.preflightEvidence)} : {}),
    attributeResult: inspectAttributes(record.attributes, rules, record.featureIdType) };
  if (record.disposition !== 'check') return { ...ref, status: record.disposition, reasonCode: record.reasonCode, reason: record.reason, location: null };
  const result = engine.check(record.geometry);
  return { ...ref, status: result.valid ? 'valid' : 'invalid', reasonCode: result.valid ? 'VALID' : 'GEOMETRY_INVALID', reason: result.reason, location: result.location };
}
