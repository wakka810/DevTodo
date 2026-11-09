import { useMemo, useState } from 'react'
import {
  DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor,
  pointerWithin, rectIntersection, useDraggable, useDroppable, useSensor, useSensors,
} from '@dnd-kit/core'
import type { CollisionDetection, DragEndEvent } from '@dnd-kit/core'
import { CalendarDays, GripVertical, Plus } from 'lucide-react'
import { KIND_LABELS, PRIORITY_LABELS, STATUSES, STATUS_LABELS } from '../domain/types'
import type { Task, TaskStatus } from '../domain/types'
import { ancestorsOf, boardColumns, dateLabel, indexTasks, isOverdue } from './view-model'
import type { TaskIndex } from './view-model'
import './views.css'

export interface BoardViewProps {
  tasks: Task[]
  matchingIds: Set<string>
  filtering: boolean
  onSelect: (id: string) => void
  onStatusChange: (task: Task, status: TaskStatus) => void
  onAdd: (status: TaskStatus) => void
}

// Pointer drops must actually be inside a column: a nearby card is not a drop target.
const columnCollision: CollisionDetection = args => args.pointerCoordinates ? pointerWithin(args) : rectIntersection(args)

function TaskCard({ task, index, onSelect, onStatusChange }: Pick<BoardViewProps, 'onSelect' | 'onStatusChange'> & { task: Task; index: TaskIndex }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({ id: task.id })
  const path = ancestorsOf(task, index).map(parent => parent.title).join(' / ')
  const overdue = isOverdue(task)
  return (
    <article ref={setNodeRef} className={`board-card${isDragging ? ' board-card--dragging' : ''}`} data-task-id={task.id}>
      {path ? <p className="board-path" title={path}>{path}</p> : null}
      <div className="board-card-heading">
        <button type="button" className="board-title" onClick={() => onSelect(task.id)}>{task.title}</button>
        <button
          type="button" ref={setActivatorNodeRef} {...attributes} {...listeners}
          className="board-handle" aria-label={`${task.title}を別の状態へ移動`} title="ドラッグで状態を変更"
        ><GripVertical size={16} aria-hidden="true" /></button>
      </div>
      <div className="board-meta">
        <span>{KIND_LABELS[task.kind]}</span>
        <span className={task.priority === 'high' ? 'board-priority--high' : ''}>優先度 {PRIORITY_LABELS[task.priority]}</span>
      </div>
      {task.dueDate ? (
        <p className={`board-due${overdue ? ' board-due--overdue' : ''}`}>
          <CalendarDays size={13} aria-hidden="true" />
          <time dateTime={task.dueDate}>{dateLabel(task.dueDate)}</time>
          {overdue ? <span>期限超過</span> : null}
        </p>
      ) : null}
      <select
        className="board-status-select" aria-label={`${task.title}の状態`} value={task.status}
        onChange={event => onStatusChange(task, event.target.value as TaskStatus)}
      >{STATUSES.map(status => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}</select>
    </article>
  )
}

function BoardColumn({ status, columnTasks, index, mobileStatus, onAdd, onSelect, onStatusChange }: BoardViewProps & {
  status: TaskStatus; columnTasks: Task[]; index: TaskIndex; mobileStatus: TaskStatus
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `column:${status}` })
  return (
    <section
      ref={setNodeRef} data-status={status} aria-label={STATUS_LABELS[status]}
      className={`board-column${isOver ? ' board-column--over' : ''}${status === mobileStatus ? ' board-column--mobile-active' : ''}`}
    >
      <header className="board-column-heading">
        <h2><span className={`board-state-dot board-state-dot--${status}`} aria-hidden="true" />{STATUS_LABELS[status]}<span className="board-count">{columnTasks.length}</span></h2>
        <button type="button" className="board-add" aria-label={`${STATUS_LABELS[status]}にタスクを追加`} onClick={() => onAdd(status)}><Plus size={17} aria-hidden="true" /></button>
      </header>
      <div className="board-cards">
        {columnTasks.map(task => <TaskCard key={task.id} task={task} index={index} onSelect={onSelect} onStatusChange={onStatusChange} />)}
        {!columnTasks.length ? <p className="board-column-empty">この状態のタスクはありません</p> : null}
      </div>
      <button type="button" className="board-add-text" onClick={() => onAdd(status)}><Plus size={15} aria-hidden="true" />追加</button>
    </section>
  )
}

export default function BoardView(props: BoardViewProps) {
  const { tasks, matchingIds, filtering, onStatusChange } = props
  const [mobileStatus, setMobileStatus] = useState<TaskStatus>('todo')
  const [activeId, setActiveId] = useState<string | null>(null)
  const index = useMemo(() => indexTasks(tasks), [tasks])
  const columns = useMemo(() => boardColumns(tasks, STATUSES, matchingIds, filtering), [tasks, matchingIds, filtering])
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  )
  const active = activeId ? index.byId.get(activeId) : undefined

  function finishDrag({ active: dragged, over }: DragEndEvent) {
    setActiveId(null)
    if (!over) return
    const status = String(over.id).replace(/^column:/, '') as TaskStatus
    const task = index.byId.get(String(dragged.id))
    if (task && STATUSES.includes(status) && task.status !== status) onStatusChange(task, status)
  }

  return (
    <div className="board">
      <div className="board-mobile-filter">
        <label htmlFor="board-visible-status">表示する状態</label>
        <select id="board-visible-status" value={mobileStatus} onChange={event => setMobileStatus(event.target.value as TaskStatus)}>
          {STATUSES.map(status => <option key={status} value={status}>{STATUS_LABELS[status]}（{columns.get(status)?.length ?? 0}）</option>)}
        </select>
      </div>
      {filtering && matchingIds.size === 0 ? <p className="board-no-results" role="status">条件に一致するタスクがありません。</p> : null}
      <DndContext
        sensors={sensors} collisionDetection={columnCollision}
        onDragStart={({ active: dragged }) => setActiveId(String(dragged.id))}
        onDragEnd={finishDrag} onDragCancel={() => setActiveId(null)}
        accessibility={{
          screenReaderInstructions: { draggable: 'Spaceで移動を開始し、矢印キーで移動します。Spaceで確定、Escapeで中止します。各カードの状態メニューでも変更できます。' },
          announcements: {
            onDragStart: ({ active: dragged }) => `${index.byId.get(String(dragged.id))?.title ?? 'タスク'}を移動します。`,
            onDragOver: ({ over }) => over ? `${STATUS_LABELS[String(over.id).replace('column:', '') as TaskStatus]}へ移動できます。` : '列の外です。ここでは変更されません。',
            onDragEnd: ({ over }) => over ? '移動を終了しました。保存結果を確認してください。' : '移動を取り消しました。',
            onDragCancel: () => '移動を取り消しました。',
          },
        }}
      >
        <div className="board-scroll"><div className="board-columns">
          {STATUSES.map(status => <BoardColumn key={status} {...props} status={status} columnTasks={columns.get(status) ?? []} index={index} mobileStatus={mobileStatus} />)}
        </div></div>
        <DragOverlay dropAnimation={null}>{active ? <div className="board-drag-preview">{active.title}</div> : null}</DragOverlay>
      </DndContext>
    </div>
  )
}
