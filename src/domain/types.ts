export const STATUSES = ['backlog', 'todo', 'in_progress', 'review', 'done'] as const
export type TaskStatus = typeof STATUSES[number]
export const PRIORITIES = ['high', 'medium', 'low'] as const
export type Priority = typeof PRIORITIES[number]
export const KINDS = ['feature', 'bug', 'refactor', 'other'] as const
export type TaskKind = typeof KINDS[number]
export interface Project { id: string; name: string; description: string; createdAt: string; updatedAt: string; revision: number }
export interface Task { id: string; projectId: string; parentId: string | null; title: string; description: string; status: TaskStatus; priority: Priority; kind: TaskKind; dueDate: string | null; createdAt: string; updatedAt: string; revision: number }
export type TaskDraft = Pick<Task, 'parentId' | 'title' | 'description' | 'status' | 'priority' | 'kind' | 'dueDate'>
export type ProjectDraft = Pick<Project, 'name' | 'description'>
export interface Snapshot { projects: Project[]; tasks: Task[]; generation: string; sequence: number }
export interface WriteContext { generation: string; revision: number }
export const STATUS_LABELS: Record<TaskStatus, string> = { backlog: 'バックログ', todo: '着手予定', in_progress: '作業中', review: '確認中', done: '完了' }
export const PRIORITY_LABELS: Record<Priority, string> = { high: '高', medium: '中', low: '低' }
export const KIND_LABELS: Record<TaskKind, string> = { feature: '機能追加', bug: 'バグ修正', refactor: 'リファクタリング', other: 'その他' }
