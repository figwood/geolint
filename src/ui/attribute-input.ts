// Number controls expose an empty value for both deliberate clearing and invalid text.
export function numberConstraint(value: string, badInput: boolean): number | undefined {
  if (badInput) return NaN;
  if (value === '') return undefined;
  return Number(value);
}
