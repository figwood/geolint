export class InspectionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'InspectionError';
    this.code = code;
  }
}
export class RecoverableEngineError extends InspectionError {
  constructor() { super('ENGINE_ERROR', 'The geometry engine could not check this record.'); }
}
