import type { Task, TaskStatus } from '../domain/types'

export interface TaskIndex {
  byId: Map<string, Task>
  children: Map<string | null, Task[]>
}

/** Stable sibling and board order: edits never reorder unrelated tasks. */
export function stableTaskOrder(a: Task, b: Task): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
}

export function indexTasks(tasks: Task[]): TaskIndex {
  const byId = new Map(tasks.map(task => [task.id, task]))
  const children = new Map<string | null, Task[]>()
  for (const task of tasks) {
    const siblings = children.get(task.parentId) ?? []
    siblings.push(task)
    children.set(task.parentId, siblings)
  }
  for (const siblings of children.values()) siblings.sort(stableTaskOrder)
  return { byId, children }
}

export function ancestorsOf(task: Task, index: TaskIndex): Task[] {
  const ancestors: Task[] = []
  const visited = new Set([task.id])
  let parentId = task.parentId
  while (parentId !== null && !visited.has(parentId)) {
    const parent = index.byId.get(parentId)
    if (!parent) break
    ancestors.unshift(parent)
    visited.add(parent.id)
    parentId = parent.parentId
  }
  return ancestors
}

export function boardColumns(tasks: Task[], statuses: readonly TaskStatus[], matchingIds: Set<string>, filtering: boolean): Map<TaskStatus, Task[]> {
  const columns = new Map<TaskStatus, Task[]>(statuses.map(status => [status, []]))
  for (const task of tasks) {
    if (!filtering || matchingIds.has(task.id)) columns.get(task.status)?.push(task)
  }
  for (const column of columns.values()) column.sort(stableTaskOrder)
  return columns
}

export interface TreeRow {
  task: Task
  depth: number
  contextOnly: boolean
  hasChildren: boolean
  expanded: boolean
}

export interface TreeOptions {
  matchingIds: Set<string>
  filtering: boolean
  collapsedIds: Set<string>
  rootId?: string | null
}

/** Filtering keeps only matching tasks and their ancestors; collapsed matching branches reopen. */
export function visibleTree(tasks: Task[], options: TreeOptions): TreeRow[] {
  const index = indexTasks(tasks)
  const included = new Set<string>()
  if (options.filtering) {
    for (const id of options.matchingIds) {
      const task = index.byId.get(id)
      if (!task) continue
      included.add(id)
      for (const ancestor of ancestorsOf(task, index)) included.add(ancestor.id)
    }
  } else {
    for (const task of tasks) included.add(task.id)
  }

  const rows: TreeRow[] = []
  const seen = new Set<string>()
  function visit(task: Task, depth: number): void {
    if (seen.has(task.id) || !included.has(task.id)) return
    seen.add(task.id)
    const children = (index.children.get(task.id) ?? []).filter(child => included.has(child.id))
    const hasChildren = children.length > 0
    const expanded = hasChildren && (options.filtering || !options.collapsedIds.has(task.id))
    rows.push({ task, depth, hasChildren, expanded, contextOnly: options.filtering && !options.matchingIds.has(task.id) })
    if (expanded) for (const child of children) visit(child, depth + 1)
  }

  const selectedRoot = options.rootId ? index.byId.get(options.rootId) : undefined
  const roots = selectedRoot ? [selectedRoot] : index.children.get(null) ?? []
  for (const root of roots) visit(root, 0)
  return rows
}

/** Date-only deadlines are compared to the user's local calendar, never parsed as UTC. */
export function isOverdue(task: Task, now = new Date()): boolean {
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return task.status !== 'done' && task.dueDate !== null && task.dueDate < today
}

export function dateLabel(date: string): string {
  const [year, month, day] = date.split('-')
  return `${year}/${Number(month)}/${Number(day)}`
}
