/** Count Unicode code points consistently, including characters outside the BMP. */
export const characterCount = (text: string): number => Array.from(text).length;

export function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** A due date is a local calendar value, never a UTC midnight timestamp. */
export function localDateOnly(date = new Date()): string {
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function relativeDateOnly(days: number, from = new Date()): string {
  const result = new Date(from.getFullYear(), from.getMonth(), from.getDate() + days, 12);
  return localDateOnly(result);
}

export function isOverdue(task: { dueDate: string | null; status: string }, today = localDateOnly()): boolean {
  return task.dueDate !== null && task.dueDate < today && task.status !== 'done';
}

export function formatDueDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(12, 0, 0, 0);
  return new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric' }).format(date);
}
