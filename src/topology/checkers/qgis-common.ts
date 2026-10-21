import { verifyQgisIssue } from '../qgis-output.ts';
import { InspectionError } from '../../errors.ts';
import { qgisRules, simpleTypes } from '../qgis-catalog.ts';
import type { RuleParameters, TopologyChecker, TopologyDatasetContext, SourcePath, Measurements } from '../contracts.ts';

export function qgisParameters(id: string, value: unknown): RuleParameters {
  const definition = qgisRules.find(rule => rule.id === id)!;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InspectionError('TOPOLOGY_CONFIG_ERROR', 'Expected rule parameters.');
  const input = value as Record<string, unknown>, result: Record<string, number | readonly string[]> = {};
  const allowed = [...Object.keys(definition.fields), ...(definition.precision ? ['toleranceDigits'] : []), ...(id === 'Rule-040' ? ['allowedTypes'] : [])];
  const invalid = () => new InspectionError('TOPOLOGY_CONFIG_ERROR', `Invalid parameters for ${id}.`);
  if (Object.keys(input).some(key => !allowed.includes(key))) throw invalid();
  if (definition.precision) {
    const digits = Object.hasOwn(input,'toleranceDigits') ? input.toleranceDigits : 8;
    if (typeof digits !== 'number' || !Number.isInteger(digits) || digits < 0 || digits > 15) throw invalid();
    result.toleranceDigits = digits;
  }
  for (const [key, field] of Object.entries(definition.fields)) {
    const number = Object.hasOwn(input,key) ? input[key] : field.default;
    if (typeof number !== 'number' || !Number.isFinite(number) || (field.exclusive ? number <= field.min : number < field.min) || (field.max !== undefined && number > field.max)) throw invalid();
    result[key] = number;
  }
  if (id === 'Rule-040') {
    const types = input.allowedTypes;
    if (!Array.isArray(types) || !types.length || new Set(types).size !== types.length || types.some(type => !simpleTypes.includes(type))) throw invalid();
    result.allowedTypes = simpleTypes.filter(type => types.includes(type));
  }
  return result;
}
export function qgisChecker(id: string, checkDataset: (context: TopologyDatasetContext) => Promise<void>, inputPolicy: 'valid' | 'normalized' | 'preflight' = 'normalized'): TopologyChecker {
  const definition = qgisRules.find(rule => rule.id === id)!;
  return {id, geometryTypes:definition.types, candidateMode:'dataset', inputPolicy,
    parseParameters:value => qgisParameters(id, value), checkDataset,
    outputSchema: {scopes:['record'],participants:{min:1,max:1},location:'required',geometry:'forbidden',measurementKeys:definition.measurements,occurrence:'required',validate:(issue,records,parameters)=>verifyQgisIssue(id,issue,records,parameters)},
  };
}
export function emitQgis(context: TopologyDatasetContext, id: string, sources: readonly SourcePath[], location: {x:number;y:number} | null, measurements?: Measurements, geometry?: import('../../contracts.ts').PolygonalGeometry, region?: number): void {
  const definition = qgisRules.find(rule => rule.id === id)!;
  const keys = [...new Set(sources.map(source => source.recordKey))];
  context.emit({reasonCode:definition.code, reason:definition.title, location, occurrence:{sources, ...(region === undefined ? {} : {region})}, ...(measurements ? {measurements} : {}), ...(geometry ? {geometry} : {})}, keys, id === 'Rule-035' ? 'record' : keys.length > 1 ? 'pair' : keys.length ? 'record' : 'dataset');
}
