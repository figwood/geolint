import type { AttributeType } from './contracts.ts';

export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7)), day = Number(value.slice(8));
  const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]!;
}
export function matchesType(value: unknown, type: AttributeType): boolean {
  switch (type) {
    case 'int': return typeof value === 'number' && Number.isSafeInteger(value);
    case 'double': return typeof value === 'number' && Number.isFinite(value);
    case 'date': return typeof value === 'string' && validDate(value);
    default: return typeof value === type;
  }
}
