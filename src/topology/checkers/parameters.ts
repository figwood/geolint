import { InspectionError } from '../../errors.ts';
export function noParameters(value: unknown): Record<string, never> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length) throw new InspectionError('TOPOLOGY_CONFIG_ERROR', 'This topology rule does not accept parameters or tolerance.');
  return {};
}
