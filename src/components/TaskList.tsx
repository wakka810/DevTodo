import { useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Check,
  Circle,
  CircleDashed,
  CircleDot,
  CircleCheck,
  CircleEllipsis,
} from 'lucide-react'
import {
  STATUSES,
  STATUS_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
  KIND_LABELS,
  type Task,
  type TaskStatus,
  type Priority,
} from '../domain/types'
import {
  visibleTree,
  dateLabel,
  isOverdue,
  indexTasks,
} from '../views/view-model'

const statusIcons = {
  backlog: CircleDashed,
  todo: Circle,
  in_progress: CircleDot,
  review: CircleEllipsis,
  done: CircleCheck,
}
export function StatusIcon({ status }: { status: TaskStatus }) {
  const Icon = statusIcons[status]
  return (
    <Icon
      size={16}
      className={`status-icon status-${status}`}
      aria-hidden="true"
    />
  )
}

export function TaskList({
  tasks,
  matchingIds,
  filtering,
  onSelect,
  onStatusChange,
  onPriorityChange,
  onAdd,
}: {
  tasks: Task[]
  matchingIds: Set<string>
  filtering: boolean
  onSelect: (id: string) => void
  onStatusChange: (task: Task, status: TaskStatus) => void
  onPriorityChange: (task: Task, priority: Priority) => void
  onAdd: () => void
}) {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())
  const rows = useMemo(
    () => visibleTree(tasks, { matchingIds, filtering, collapsedIds }),
    [tasks, matchingIds, filtering, collapsedIds],
  )
  const index = useMemo(() => indexTasks(tasks), [tasks])
  const counts = useMemo(() => {
    const result = new Map<string, { done: number; total: number }>()
    function visit(id: string): { done: number; total: number } {
      const count = { done: 0, total: 0 }
      for (const task of index.children.get(id) ?? []) {
        const below = visit(task.id)
        count.done += below.done + Number(task.status === 'done')
        count.total += below.total + 1
      }
      result.set(id, count)
      return count
    }
    for (const task of index.children.get(null) ?? []) visit(task.id)
    return result
  }, [index])
  return (
    <div className="task-list">
      <div className="list-head" aria-hidden="true">
        <span>タスク</span>
        <span>状態</span>
        <span>優先度</span>
        <span>期限</span>
      </div>
      <ul className="task-rows" aria-label="タスク一覧">
        {rows.map(({ task, depth, contextOnly, hasChildren, expanded }) => {
          const descendants = counts.get(task.id)
          // Reuse the whole-project totals: scanning the entire tree per row made a
          // 1000-row render quadratic. The write transaction still validates Done.
          const unfinished = descendants
            ? descendants.total - descendants.done
            : 0
          const issue = unfinished
            ? `未完了の子タスクが${unfinished}件あります。先に子タスクを完了してください。`
            : null
          return (
            <li
              className={`task-row ${contextOnly ? 'context-row' : ''}`}
              key={task.id}
              data-task-id={task.id}
              style={{
                contentVisibility: 'auto',
                containIntrinsicBlockSize: 'auto 69px',
              }}
            >
              <div
                className="task-identity"
                style={{ paddingInlineStart: `${depth * 18}px` }}
              >
                {hasChildren ? (
                  <button
                    className="icon-button collapse-toggle"
                    aria-label={`${task.title}の${expanded ? '折りたたみ' : '展開'}`}
                    aria-expanded={expanded}
                    onClick={() =>
                      setCollapsedIds((current) => {
                        const next = new Set(current)
                        if (next.has(task.id)) next.delete(task.id)
                        else next.add(task.id)
                        return next
                      })
                    }
                  >
                    {expanded ? <ChevronDown /> : <ChevronRight />}
                  </button>
                ) : (
                  <span className="collapse-spacer" />
                )}
                <button
                  className={`completion-toggle ${task.status === 'done' ? 'is-done' : ''}`}
                  aria-pressed={task.status === 'done'}
                  aria-label={`${task.title}を${task.status === 'done' ? '再開' : '完了'}`}
                  title={issue || undefined}
                  onClick={() =>
                    onStatusChange(
                      task,
                      task.status === 'done' ? 'todo' : 'done',
                    )
                  }
                >
                  {task.status === 'done' && <Check size={12} />}
                </button>
                <button
                  className="task-title-button"
                  onClick={() => onSelect(task.id)}
                >
                  <span className={task.status === 'done' ? 'done-title' : ''}>
                    {task.title}
                  </span>
                  <span className="task-meta">
                    <span>{KIND_LABELS[task.kind]}</span>
                    {descendants && descendants.total > 0 && (
                      <span>
                        配下 {descendants.done}/{descendants.total}件完了
                      </span>
                    )}
                    {contextOnly && (
                      <span className="context-label">一致したタスクの親</span>
                    )}
                  </span>
                </button>
              </div>
              <label className="row-status">
                <StatusIcon status={task.status} />
                <select
                  aria-label={`${task.title}の状態`}
                  value={task.status}
                  onChange={(event) =>
                    onStatusChange(task, event.target.value as TaskStatus)
                  }
                >
                  {STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {STATUS_LABELS[status]}
                      {status === 'done' && issue ? '（未完了の子あり）' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <select
                className={`row-priority priority-${task.priority}`}
                aria-label={`${task.title}の優先度`}
                value={task.priority}
                onChange={(event) =>
                  onPriorityChange(task, event.target.value as Priority)
                }
              >
                {PRIORITIES.map((priority) => (
                  <option value={priority} key={priority}>
                    {PRIORITY_LABELS[priority]}
                  </option>
                ))}
              </select>
              <span className={`row-date ${isOverdue(task) ? 'overdue' : ''}`}>
                {task.dueDate ? (
                  <>
                    <span className="sr-only">期限 </span>
                    {dateLabel(task.dueDate)}
                    {isOverdue(task) && (
                      <span className="sr-only"> 期限超過</span>
                    )}
                  </>
                ) : (
                  <span className="muted">—</span>
                )}
              </span>
            </li>
          )
        })}
      </ul>
      <button className="list-add" onClick={onAdd}>
        <Plus size={16} />
        タスクを追加
      </button>
    </div>
  )
}
