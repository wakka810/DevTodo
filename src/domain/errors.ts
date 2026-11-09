export type ErrorCode =
  | 'validation'
  | 'not-found'
  | 'conflict'
  | 'generation'
  | 'hierarchy'
  | 'unfinished-descendants'
  | 'delete-changed'
  | 'undo-conflict'
  | 'storage';

/** Expected domain failures are safe to display; never interpret them as an empty DB. */
export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly field?: string;

  constructor(code: ErrorCode, message: string, field?: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.field = field;
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof DomainError) return error.message;
  if (error instanceof Error && /quota/i.test(error.name)) {
    return 'ブラウザの保存容量が不足しています。入力は残っています。不要なデータを整理して再試行してください。';
  }
  return 'このブラウザへの保存・読み込みに失敗しました。入力を保ったまま再試行してください。';
}
