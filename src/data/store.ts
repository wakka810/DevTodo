import type { Project, ProjectDraft, Snapshot, Task, TaskDraft, TaskStatus, Priority, WriteContext } from '../domain/types';
import { DomainError } from '../domain/errors';
import { assertGraph, compareCreated, getDescendants, statusIssue, taskMap } from '../domain/hierarchy';
import { validateBackup, validateDataset, validateProjectDraft, validateTaskDraft, type Backup } from '../domain/validation';
import { db, newId, type DataState, type DevTodoDatabase } from './db';
import { createDemo } from './demo';

export { db } from './db';
export { parseBackup } from '../domain/validation';
export type { Backup } from '../domain/validation';

export interface TaskResult { task: Task; reopened: string[]; undoToken?: UndoToken | null }
export interface UndoToken { generation: string; sequence: number; before: Task[]; after: Task[] }
export interface StatusResult extends TaskResult { undoToken: UndoToken | null }
export interface DeletePreview {
  kind: 'task' | 'project';
  id: string;
  name: string;
  taskIds: string[];
  taskCount: number;
  generation: string;
  fingerprint: string;
}

function requireRecord<T>(record: T | undefined, label: string): T {
  if (!record) throw new DomainError('not-found', `${label}は削除されています。入力を確認して一覧を読み直してください。`);
  return record;
}

function assertGeneration(state: DataState, expected: string): void {
  if (state.generation !== expected) throw new DomainError('generation', '別のタブでバックアップが復元されました。入力を保ったまま最新データを確認してください。');
}

function assertRevision(record: { revision: number }, expected: number): void {
  if (record.revision !== expected) throw new DomainError('conflict', 'この項目は別の操作で更新されています。入力を保ったまま最新の内容を確認してください。');
}

function deletionPreview(snapshot: Snapshot, kind: DeletePreview['kind'], id: string): DeletePreview {
  const target = kind === 'task'
    ? requireRecord(snapshot.tasks.find((task) => task.id === id), 'タスク')
    : requireRecord(snapshot.projects.find((project) => project.id === id), 'プロジェクト');
  const tasks = kind === 'task'
    ? [target as Task, ...getDescendants(snapshot.tasks, id)]
    : snapshot.tasks.filter((task) => task.projectId === id);
  const entries = tasks.map((task) => [task.id, task.revision]).sort(([a], [b]) => String(a).localeCompare(String(b)));
  return {
    kind, id, name: 'title' in target ? target.title : target.name,
    taskIds: tasks.map((task) => task.id).sort(), taskCount: tasks.length,
    generation: snapshot.generation, fingerprint: JSON.stringify([kind, id, target.revision, entries]),
  };
}

/** All entry points re-read records and metadata within the same write transaction. */
export function createStore(database: DevTodoDatabase) {
  async function current(): Promise<{ snapshot: Snapshot; state: DataState }> {
    const [projects, tasks, state] = await Promise.all([
      database.projects.toArray(), database.tasks.toArray(), database.meta.get('state'),
    ]);
    if (!state || typeof state.generation !== 'string' || !state.generation || !Number.isSafeInteger(state.sequence) || state.sequence < 0) {
      throw new DomainError('storage', '保存データの管理情報を読み取れません。データは初期化していません。再読み込みするかバックアップから復元してください。');
    }
    const checked = validateDataset(projects, tasks);
    return {
      snapshot: { projects: checked.projects.sort(compareCreated), tasks: checked.tasks.sort(compareCreated), generation: state.generation, sequence: state.sequence },
      state,
    };
  }

  async function advance(state: DataState): Promise<void> {
    if (state.sequence >= Number.MAX_SAFE_INTEGER) throw new DomainError('storage', '更新回数の上限に達しました。バックアップを書き出してください。');
    await database.meta.put({ ...state, sequence: state.sequence + 1 });
  }

  async function write<T>(generation: string, operation: (snapshot: Snapshot, state: DataState) => Promise<T>): Promise<T> {
    return database.transaction('rw', database.projects, database.tasks, database.meta, async () => {
      const { snapshot, state } = await current();
      assertGeneration(state, generation);
      return operation(snapshot, state);
    });
  }

  async function readSnapshot(): Promise<Snapshot> {
    return database.transaction('r', database.projects, database.tasks, database.meta, async () => (await current()).snapshot);
  }

  async function createProject(input: ProjectDraft, generation: string): Promise<Project> {
    const draft = validateProjectDraft(input);
    return write(generation, async (_snapshot, state) => {
      const timestamp = new Date().toISOString();
      const project: Project = { ...draft, id: newId(), createdAt: timestamp, updatedAt: timestamp, revision: 1 };
      await database.projects.add(project);
      await advance(state);
      return project;
    });
  }

  async function updateProject(id: string, input: ProjectDraft, context: WriteContext): Promise<Project> {
    const draft = validateProjectDraft(input);
    return write(context.generation, async (snapshot, state) => {
      const previous = requireRecord(snapshot.projects.find((project) => project.id === id), 'プロジェクト');
      assertRevision(previous, context.revision);
      const project = { ...previous, ...draft, updatedAt: new Date().toISOString(), revision: previous.revision + 1 };
      await database.projects.put(project);
      await advance(state);
      return project;
    });
  }

  /** Stage a task plus only its necessary Done ancestors. The caller writes all together. */
  function stageTask(snapshot: Snapshot, task: Task): { changes: Task[]; reopened: string[] } {
    requireRecord(snapshot.projects.find((project) => project.id === task.projectId), 'プロジェクト');
    const next = snapshot.tasks.filter((item) => item.id !== task.id).concat(task);
    assertGraph(snapshot.projects, next, false);
    const issue = statusIssue(next, task.id, task.status);
    if (issue) throw new DomainError('unfinished-descendants', issue, 'status');
    const byId = taskMap(next);
    const reopenedIds = new Set<string>();
    for (const item of next) {
      if (item.status === 'done') continue;
      let ancestorId = item.parentId;
      while (ancestorId) {
        const ancestor = byId.get(ancestorId)!;
        if (ancestor.status === 'done') reopenedIds.add(ancestor.id);
        ancestorId = ancestor.parentId;
      }
    }
    const reopened = [...reopenedIds].map((id) => byId.get(id)!);
    const changes = [task, ...reopened.map((ancestor): Task => ({
      ...ancestor, status: 'in_progress', revision: ancestor.revision + 1, updatedAt: task.updatedAt,
    }))];
    const changed = new Map(changes.map((item) => [item.id, item]));
    assertGraph(snapshot.projects, next.map((item) => changed.get(item.id) ?? item));
    return { changes, reopened: reopened.map((ancestor) => ancestor.title) };
  }

  async function createTask(projectId: string, input: TaskDraft, generation: string): Promise<TaskResult> {
    const draft = validateTaskDraft(input);
    return write(generation, async (snapshot, state) => {
      const timestamp = new Date().toISOString();
      const task: Task = { ...draft, id: newId(), projectId, createdAt: timestamp, updatedAt: timestamp, revision: 1 };
      const staged = stageTask(snapshot, task);
      await database.tasks.add(task);
      if (staged.changes.length > 1) await database.tasks.bulkPut(staged.changes.slice(1));
      await advance(state);
      return { task, reopened: staged.reopened };
    });
  }

  async function updateTask(id: string, input: TaskDraft, context: WriteContext): Promise<TaskResult> {
    const draft = validateTaskDraft(input);
    return write(context.generation, async (snapshot, state) => {
      const previous = requireRecord(snapshot.tasks.find((task) => task.id === id), 'タスク');
      assertRevision(previous, context.revision);
      const task: Task = { ...previous, ...draft, updatedAt: new Date().toISOString(), revision: previous.revision + 1 };
      const staged = stageTask(snapshot, task);
      const beforeMap = taskMap(snapshot.tasks);
      const undoToken: UndoToken | null = previous.status === task.status ? null : {
        generation: state.generation, sequence: state.sequence + 1,
        before: staged.changes.map((item) => beforeMap.get(item.id)!), after: staged.changes,
      };
      await database.tasks.bulkPut(staged.changes);
      await advance(state);
      return { task, reopened: staged.reopened, undoToken };
    });
  }

  async function changeStatus(id: string, status: TaskStatus, context: WriteContext): Promise<StatusResult> {
    return write(context.generation, async (snapshot, state) => {
      const previous = requireRecord(snapshot.tasks.find((task) => task.id === id), 'タスク');
      assertRevision(previous, context.revision);
      if (previous.status === status) return { task: previous, reopened: [], undoToken: null };
      const draft = validateTaskDraft({ ...pickTaskDraft(previous), status });
      const task: Task = { ...previous, ...draft, updatedAt: new Date().toISOString(), revision: previous.revision + 1 };
      const staged = stageTask(snapshot, task);
      const beforeMap = taskMap(snapshot.tasks);
      const undoToken: UndoToken = {
        generation: state.generation, sequence: state.sequence + 1,
        before: staged.changes.map((item) => beforeMap.get(item.id)!), after: staged.changes,
      };
      await database.tasks.bulkPut(staged.changes);
      await advance(state);
      return { task, reopened: staged.reopened, undoToken };
    });
  }

  async function changePriority(id: string, priority: Priority, context: WriteContext): Promise<Task> {
    return write(context.generation, async (snapshot, state) => {
      const previous = requireRecord(snapshot.tasks.find((task) => task.id === id), 'タスク');
      assertRevision(previous, context.revision);
      const draft = validateTaskDraft({ ...pickTaskDraft(previous), priority });
      const task: Task = { ...previous, priority: draft.priority, updatedAt: new Date().toISOString(), revision: previous.revision + 1 };
      await database.tasks.put(task);
      await advance(state);
      return task;
    });
  }

  async function undoStatus(token: UndoToken): Promise<void> {
    return write(token.generation, async (snapshot, state) => {
      if (state.sequence !== token.sequence) throw new DomainError('undo-conflict', 'その後にデータが変更されたため取り消せません。現在の内容を確認してください。');
      const byId = taskMap(snapshot.tasks);
      for (const after of token.after) {
        const latest = byId.get(after.id);
        if (!latest || latest.revision !== after.revision) throw new DomainError('undo-conflict', '対象が変更・削除されたため取り消せません。');
      }
      const now = new Date().toISOString();
      // A form can save title/description/parent and status together. Undo restores
      // only statuses, keeping the other fields from that same committed save.
      const restored = token.before.map((task): Task => ({ ...byId.get(task.id)!, status: task.status, revision: byId.get(task.id)!.revision + 1, updatedAt: now }));
      const restoredMap = taskMap(restored);
      try {
        assertGraph(snapshot.projects, snapshot.tasks.map((task) => restoredMap.get(task.id) ?? task));
      } catch (error) {
        if (error instanceof DomainError) throw new DomainError('undo-conflict', '一緒に保存した親子関係では元の状態に戻せません。現在の親子関係と完了状態を確認してください。');
        throw error;
      }
      await database.tasks.bulkPut(restored);
      await advance(state);
    });
  }

  const previewDeleteTask = async (id: string): Promise<DeletePreview> => deletionPreview(await readSnapshot(), 'task', id);
  const previewDeleteProject = async (id: string): Promise<DeletePreview> => deletionPreview(await readSnapshot(), 'project', id);

  async function deleteConfirmed(preview: DeletePreview): Promise<void> {
    return write(preview.generation, async (snapshot, state) => {
      const latest = deletionPreview(snapshot, preview.kind, preview.id);
      if (latest.fingerprint !== preview.fingerprint || JSON.stringify(latest.taskIds) !== JSON.stringify(preview.taskIds)) {
        throw new DomainError('delete-changed', '削除対象が変更されています。最新の対象名と件数を確認し、もう一度削除してください。');
      }
      await database.tasks.bulkDelete(latest.taskIds);
      if (preview.kind === 'project') await database.projects.delete(preview.id);
      await advance(state);
    });
  }

  async function exportBackup(): Promise<Backup> {
    const snapshot = await readSnapshot();
    // Serialization/download happens in the UI, after this coherent read transaction.
    return { format: 'devtodo-backup', schemaVersion: 1, exportedAt: new Date().toISOString(), projects: snapshot.projects, tasks: snapshot.tasks };
  }

  async function restoreBackup(input: Backup, expectedGeneration: string, expectedSequence?: number): Promise<void> {
    const backup = validateBackup(input);
    await write(expectedGeneration, async (snapshot, state) => {
      if (expectedSequence !== undefined && snapshot.sequence !== expectedSequence) {
        throw new DomainError('conflict', '確認後にデータが更新されました。最新データのバックアップと置換内容をもう一度確認してください。');
      }
      await database.tasks.clear();
      await database.projects.clear();
      await database.projects.bulkAdd(backup.projects);
      await database.tasks.bulkAdd(backup.tasks);
      // A restore invalidates old forms, delete confirmations and Undo, even for identical IDs/revisions.
      await database.meta.put({ key: 'state', generation: newId(), sequence: state.sequence + 1 });
    });
  }

  async function loadDemo(generation: string): Promise<Project> {
    return write(generation, async (snapshot, state) => {
      const existing = state.demoProjectId && snapshot.projects.find((project) => project.id === state.demoProjectId);
      if (existing) return existing;
      const { project, tasks } = createDemo();
      validateDataset([project], tasks);
      await database.projects.add(project);
      await database.tasks.bulkAdd(tasks);
      await advance({ ...state, demoProjectId: project.id });
      return project;
    });
  }

  return { readSnapshot, createProject, updateProject, createTask, updateTask, changeStatus, changePriority, undoStatus, previewDeleteTask, previewDeleteProject, deleteConfirmed, exportBackup, restoreBackup, loadDemo };
}

export function pickTaskDraft(task: Task): TaskDraft {
  const { parentId, title, description, status, priority, kind, dueDate } = task;
  return { parentId, title, description, status, priority, kind, dueDate };
}

export const {
  readSnapshot, createProject, updateProject, createTask, updateTask, changeStatus, changePriority,
  undoStatus, previewDeleteTask, previewDeleteProject, deleteConfirmed, exportBackup, restoreBackup, loadDemo,
} = createStore(db);
