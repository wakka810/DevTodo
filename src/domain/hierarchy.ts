import type { Project, Task } from './types';
import { DomainError } from './errors';

export const MAX_DEPTH = 3;

export function compareCreated(a: { createdAt: string; id: string }, b: { createdAt: string; id: string }): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

export function taskMap(tasks: readonly Task[]): Map<string, Task> {
  return new Map(tasks.map((task) => [task.id, task]));
}

export function childrenMap(tasks: readonly Task[]): Map<string | null, Task[]> {
  const children = new Map<string | null, Task[]>();
  for (const task of tasks) {
    const list = children.get(task.parentId) ?? [];
    list.push(task);
    children.set(task.parentId, list);
  }
  for (const list of children.values()) list.sort(compareCreated);
  return children;
}

export function getDescendants(tasks: readonly Task[], id: string): Task[] {
  const children = childrenMap(tasks);
  const found: Task[] = [];
  const seen = new Set([id]);
  const pending = [...(children.get(id) ?? [])].reverse();
  while (pending.length) {
    const task = pending.pop()!;
    if (seen.has(task.id)) throw new DomainError('hierarchy', '親子関係が循環しています。');
    seen.add(task.id);
    found.push(task);
    const next = children.get(task.id) ?? [];
    for (let index = next.length - 1; index >= 0; index--) pending.push(next[index]);
  }
  return found;
}

/** Ancestors are returned root first, so the same path can be used in every view. */
export function getAncestors(tasks: readonly Task[], id: string): Task[] {
  const byId = taskMap(tasks);
  const ancestors: Task[] = [];
  const seen = new Set([id]);
  let parentId = byId.get(id)?.parentId;
  while (parentId) {
    if (seen.has(parentId)) throw new DomainError('hierarchy', '親子関係が循環しています。');
    seen.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) throw new DomainError('hierarchy', '親タスクが見つかりません。');
    ancestors.unshift(parent);
    parentId = parent.parentId;
  }
  return ancestors;
}

export function completion(tasks: readonly Task[]): { done: number; total: number; percent: number | null } {
  const done = tasks.filter((task) => task.status === 'done').length;
  return { done, total: tasks.length, percent: tasks.length ? Math.round(done / tasks.length * 100) : null };
}

/** Structural checks are linear in the item count because the permitted depth is three. */
export function assertGraph(projects: readonly Project[], tasks: readonly Task[], checkDone = true): void {
  const projectIds = new Set<string>();
  for (const project of projects) {
    if (projectIds.has(project.id)) throw new DomainError('validation', 'プロジェクトの ID が重複しています。');
    projectIds.add(project.id);
  }
  const byId = new Map<string, Task>();
  for (const task of tasks) {
    if (byId.has(task.id)) throw new DomainError('validation', 'タスクの ID が重複しています。');
    byId.set(task.id, task);
    if (!projectIds.has(task.projectId)) throw new DomainError('hierarchy', 'タスクのプロジェクトが存在しません。');
  }
  for (const task of tasks) {
    let current = task;
    let depth = 1;
    const visited = new Set([task.id]);
    while (current.parentId !== null) {
      const parent = byId.get(current.parentId);
      if (!parent) throw new DomainError('hierarchy', '親タスクが存在しません。', 'parentId');
      if (visited.has(parent.id)) throw new DomainError('hierarchy', '自分自身や子孫を親にすることはできません。', 'parentId');
      if (parent.projectId !== task.projectId) throw new DomainError('hierarchy', '親は同じプロジェクトから選んでください。', 'parentId');
      visited.add(parent.id);
      if (++depth > MAX_DEPTH) throw new DomainError('hierarchy', '子孫を含めて最大3階層までにしてください。', 'parentId');
      if (checkDone && task.status !== 'done' && parent.status === 'done') {
        throw new DomainError('unfinished-descendants', '完了したタスクの配下に未完了のタスクがあります。', 'status');
      }
      current = parent;
    }
  }
}

export function statusIssue(tasks: readonly Task[], id: string, status: Task['status']): string | null {
  if (status !== 'done') return null;
  const unfinished = getDescendants(tasks, id).filter((task) => task.status !== 'done').length;
  return unfinished ? `未完了の子タスクが${unfinished}件あります。先に子タスクを完了してください。` : null;
}

/** UI hints only. Mutations repeat validation inside the write transaction. */
export function parentIssue(tasks: readonly Task[], id: string | null, parentId: string | null, projectId: string): string | null {
  return createParentChecker(tasks, id, projectId)(parentId);
}

/** Build once per form render, then check all parent options without rescanning the subtree. */
export function createParentChecker(tasks: readonly Task[], id: string | null, projectId: string): (parentId: string | null) => string | null {
  const byId = taskMap(tasks);
  const children = childrenMap(tasks);
  const descendants = new Set<string>();
  let subtreeDepth = 1;
  const pending = id ? [{ id, depth: 1 }] : [];
  while (pending.length) {
    const current = pending.pop()!;
    subtreeDepth = Math.max(subtreeDepth, current.depth);
    for (const child of children.get(current.id) ?? []) {
      if (descendants.has(child.id)) throw new DomainError('hierarchy', '親子関係が循環しています。');
      descendants.add(child.id);
      pending.push({ id: child.id, depth: current.depth + 1 });
    }
  }
  return (parentId) => {
    if (parentId === null) return null;
    const parent = byId.get(parentId);
    if (!parent) return '親タスクが見つかりません';
    if (parent.projectId !== projectId) return '別のプロジェクトです';
    if (parentId === id) return '自分自身は選べません';
    if (descendants.has(parentId)) return '子孫は親にできません';
    let depth = 1;
    let current = parent;
    while (current.parentId) {
      if (++depth > MAX_DEPTH) return '子孫を含めて3階層を超えます';
      const next = byId.get(current.parentId);
      if (!next) return '親タスクが見つかりません';
      current = next;
    }
    return depth + subtreeDepth > MAX_DEPTH ? '子孫を含めて3階層を超えます' : null;
  };
}
