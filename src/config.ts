import { InspectionError } from './errors.ts';
export function assertFileSize(bytes: number): void {
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new InspectionError('READ_ERROR', 'Invalid file size.');
}
