import { z } from 'zod';
import { characterCount, isValidDateOnly } from './dates';
import { DomainError } from './errors';
import { assertGraph } from './hierarchy';
import { KINDS, PRIORITIES, STATUSES, type Project, type ProjectDraft, type Task, type TaskDraft } from './types';

const boundedText = (max: number, label: string) => z.string().refine((value) => characterCount(value) <= max, `${label}は${max}文字以内にしてください。`);
const requiredText = (max: number, label: string) => z.string().trim()
  .refine((value) => characterCount(value) > 0, `${label}を入力してください。`)
  .refine((value) => characterCount(value) <= max, `${label}は${max}文字以内にしてください。`);
const idSchema = z.string().min(1).refine((value) => value === value.trim(), 'ID の前後に空白は使えません。');
const timestampSchema = z.string().datetime({ offset: true }).refine((value) => isValidDateOnly(value.slice(0, 10)), '実在する日時を指定してください。');
const revisionSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);

export const projectDraftSchema = z.object({
  name: requiredText(60, 'プロジェクト名'),
  description: boundedText(5000, '説明'),
}).strict();

export const taskDraftSchema = z.object({
  title: requiredText(160, 'タイトル'),
  description: boundedText(5000, '説明'),
  status: z.enum(STATUSES),
  priority: z.enum(PRIORITIES),
  kind: z.enum(KINDS),
  dueDate: z.string().refine(isValidDateOnly, '実在する日付を YYYY-MM-DD で指定してください。').nullable(),
  parentId: idSchema.nullable(),
}).strict();

export const projectSchema = projectDraftSchema.extend({
  id: idSchema, createdAt: timestampSchema, updatedAt: timestampSchema, revision: revisionSchema,
}).strict();

export const taskSchema = taskDraftSchema.extend({
  id: idSchema, projectId: idSchema, createdAt: timestampSchema, updatedAt: timestampSchema, revision: revisionSchema,
}).strict();

export const backupSchema = z.object({
  format: z.literal('devtodo-backup'),
  schemaVersion: z.literal(1),
  exportedAt: timestampSchema,
  projects: z.array(projectSchema),
  tasks: z.array(taskSchema),
}).strict();

export type Backup = z.infer<typeof backupSchema>;

type ValidationSource = 'input' | 'backup' | 'projects' | 'tasks';
const fieldLabels: Record<string, string> = {
  name: 'プロジェクト名', title: 'タイトル', description: '説明',
  status: '状態', priority: '優先度', kind: '種別', dueDate: '期限',
  parentId: '親タスク', projectId: '所属プロジェクト', id: '識別情報',
  createdAt: '作成日時', updatedAt: '更新日時', revision: '更新情報',
  exportedAt: '書き出し日時', format: 'ファイル形式', schemaVersion: 'ファイル形式',
  projects: 'プロジェクト一覧', tasks: 'タスク一覧',
};

function validationMessage(issue: z.core.$ZodIssue, source: ValidationSource): string {
  const path = source === 'projects' || source === 'tasks' ? [source, ...issue.path] : issue.path;
  const collection = path[0] === 'projects' ? 'プロジェクト' : path[0] === 'tasks' ? 'タスク' : null;
  const record = collection && typeof path[1] === 'number' ? `${path[1] + 1}件目の${collection}` : '';
  const last = path.at(-1);
  const field = typeof last === 'string' && Object.hasOwn(fieldLabels, last) ? last : undefined;
  const label = field === 'name' && record ? `${record}名`
    : field ? `${record ? `${record}の` : ''}${fieldLabels[field]}`
      : record || (source === 'backup' ? 'バックアップ' : '入力内容');
  const nextStep = source === 'backup' ? '別のDevTodoバックアップを選んでください。' : '内容を確認してください。';

  if (issue.code === 'unrecognized_keys') return `${label}に読み取れない項目があります。${nextStep}`;
  // Only these schema-owned messages contain the useful input length/required rules.
  // Other Zod messages and unknown property names must never reach the UI verbatim.
  if (field && ['name', 'title', 'description'].includes(field)) {
    if (issue.code === 'custom') return `${record ? `${record}：` : ''}${issue.message}`;
    return source === 'input' ? `${label}は文字で入力してください。` : `${label}を読み取れません。${nextStep}`;
  }
  if (field && ['status', 'priority', 'kind'].includes(field)) {
    return source === 'input' ? `${label}を選び直してください。` : `${label}が正しくありません。${nextStep}`;
  }
  if (field === 'dueDate') return `${label}に実在する日付を指定してください。`;
  if (field && ['createdAt', 'updatedAt', 'exportedAt'].includes(field)) return `${label}に実在する日時を指定してください。`;
  return `${label}の形式が正しくありません。${nextStep}`;
}

function parse<T>(schema: z.ZodType<T>, value: unknown, source: ValidationSource = 'input'): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new DomainError('validation', validationMessage(issue, source), typeof issue.path[0] === 'string' ? issue.path[0] : undefined);
  }
  return result.data;
}

export const validateTaskDraft = (draft: TaskDraft): TaskDraft => parse(taskDraftSchema, draft);
export const validateProjectDraft = (draft: ProjectDraft): ProjectDraft => parse(projectDraftSchema, draft);

export function emptyTaskDraft(patch: Partial<TaskDraft> = {}): TaskDraft {
  return { title: '', description: '', status: 'todo', priority: 'medium', kind: 'other', dueDate: null, parentId: null, ...patch };
}

export function validateDataset(projects: unknown, tasks: unknown): { projects: Project[]; tasks: Task[] } {
  const checkedProjects = parse(z.array(projectSchema), projects, 'projects');
  const checkedTasks = parse(z.array(taskSchema), tasks, 'tasks');
  assertGraph(checkedProjects, checkedTasks);
  return { projects: checkedProjects, tasks: checkedTasks };
}

export function validateBackup(input: unknown): Backup {
  if (input && typeof input === 'object' && 'schemaVersion' in input && input.schemaVersion !== 1) {
    throw new DomainError('validation', 'このバックアップには対応していません。別のDevTodoバックアップを選んでください。');
  }
  const backup = parse(backupSchema, input, 'backup');
  assertGraph(backup.projects, backup.tasks);
  return backup;
}

export function parseBackup(text: string): Backup {
  let input: unknown;
  try { input = JSON.parse(text); }
  catch { throw new DomainError('validation', 'JSON を読み取れませんでした。DevTodo から書き出した JSON ファイルを選んでください。'); }
  return validateBackup(input);
}
