import { useEffect, useId, useMemo, useRef, useState, type FocusEvent, type FormEvent, type KeyboardEvent } from 'react'
import { characterCount } from '../domain/dates'
import { DomainError, errorMessage } from '../domain/errors'
import { createParentChecker, parentIssue, statusIssue } from '../domain/hierarchy'
import { emptyTaskDraft, taskDraftSchema } from '../domain/validation'
import { KIND_LABELS, KINDS, PRIORITIES, PRIORITY_LABELS, STATUSES, STATUS_LABELS, type Task, type TaskDraft, type TaskStatus, type WriteContext } from '../domain/types'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from './ui/sheet'
import { Textarea } from './ui/textarea'

export interface TaskEditorProps {
  task?: Task
  projectId: string
  parentId?: string | null
  defaultStatus?: TaskStatus
  tasks: Task[]
  generation: string
  onSave: (draft: TaskDraft, context: WriteContext | null) => Promise<void>
  onClose: () => void
  onDelete?: (task: Task) => void
  onAddChild?: (task: Task) => void
}

/** These are UI hints; the write transaction repeats the authoritative checks. */
function parentChoices(tasks: Task[], taskId: string | null, projectId: string) {
  const byId = new Map(tasks.map(task => [task.id, task]))
  const checkParent = createParentChecker(tasks, taskId, projectId)
  return tasks.map(candidate => {
    const path = [candidate.title]
    const seen = new Set([candidate.id])
    let current = candidate
    let invalidPath = false
    while (current.parentId) {
      const parent = byId.get(current.parentId)
      if (!parent || seen.has(parent.id)) { invalidPath = true; break }
      seen.add(parent.id)
      path.unshift(parent.title)
      current = parent
    }
    const reason = invalidPath ? '親子関係を確認してください' : checkParent(candidate.id)
    return { task: candidate, label: path.join(' / '), reason }
  })
}

export function TaskEditor({ task, projectId, parentId = null, defaultStatus = 'todo', tasks, generation, onSave, onClose, onDelete, onAddChild }: TaskEditorProps) {
  // Do not reset the draft or revision when live data changes in another tab.
  const [initial] = useState(() => ({
    task,
    generation,
    draft: task ? {
      title: task.title, description: task.description, status: task.status, priority: task.priority,
      kind: task.kind, dueDate: task.dueDate, parentId: task.parentId,
    } : emptyTaskDraft({ parentId, status: defaultStatus }),
    context: task ? { generation, revision: task.revision } : null,
  }))
  const [draft, setDraft] = useState<TaskDraft>(initial.draft)
  const [touched, setTouched] = useState<Partial<Record<keyof TaskDraft, boolean>>>({})
  const [attempted, setAttempted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [failure, setFailure] = useState<{ message: string; field?: string } | null>(null)
  const [focusRequest, setFocusRequest] = useState<{ field: string } | null>(null)
  const id = useId()
  const formRef = useRef<HTMLFormElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const keepEditingRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const composing = useRef(false)
  const submitting = useRef(false)
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial.draft)
  const choices = useMemo(() => parentChoices(tasks, initial.task?.id ?? null, projectId), [tasks, initial.task?.id, projectId])
  const doneIssue = useMemo(() => initial.task ? statusIssue(tasks, initial.task.id, 'done') : null, [tasks, initial.task])
  const childIssue = useMemo(() => initial.task ? parentIssue(tasks, null, initial.task.id, projectId) : null, [tasks, initial.task, projectId])
  const parsed = taskDraftSchema.safeParse(draft)
  const errors: Partial<Record<keyof TaskDraft, string>> = {}
  if (!parsed.success) for (const issue of parsed.error.issues) {
    const field = issue.path[0] as keyof TaskDraft
    errors[field] ??= issue.message
  }
  const selectedParentIssue = choices.find(choice => choice.task.id === draft.parentId)?.reason
  if (selectedParentIssue) errors.parentId = selectedParentIssue
  if (draft.parentId && !choices.some(choice => choice.task.id === draft.parentId)) errors.parentId = '親タスクが見つかりません。選び直してください。'
  if (draft.status === 'done' && doneIssue) errors.status = doneIssue
  const externalChange = generation !== initial.generation || (initial.task && (!task || task.revision !== initial.task.revision))

  useEffect(() => {
    if (confirmClose) keepEditingRef.current?.focus()
  }, [confirmClose])
  useEffect(() => {
    if (focusRequest) document.getElementById(`${id}-${focusRequest.field}`)?.focus()
  }, [focusRequest, id])
  useEffect(() => {
    if (!dirty) return
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeLeaving)
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving)
  }, [dirty])

  function update<K extends keyof TaskDraft>(field: K, value: TaskDraft[K]) {
    setDraft(previous => ({ ...previous, [field]: value }))
    setFailure(null)
  }

  function visibleError(field: keyof TaskDraft) {
    return failure?.field === field ? failure.message : attempted || touched[field] ? errors[field] : undefined
  }

  function close() {
    if (submitting.current || composing.current) return
    if (dirty) setConfirmClose(true)
    else onClose()
  }

  function guardIme(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Enter' && (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  async function save(event?: FormEvent) {
    event?.preventDefault()
    if (submitting.current || composing.current) return
    setAttempted(true)
    setConfirmClose(false)
    setFailure(null)
    if (!parsed.success || Object.keys(errors).length) {
      setFocusRequest({ field: Object.keys(errors)[0] ?? 'title' })
      return
    }
    submitting.current = true
    setSaving(true)
    try {
      if (generation !== initial.generation) throw new DomainError('generation', 'バックアップが復元されました。入力は残っています。編集を開き直してください。')
      const parentError = parentIssue(tasks, initial.task?.id ?? null, parsed.data.parentId, projectId)
      if (parentError) throw new DomainError('hierarchy', parentError, 'parentId')
      await onSave(parsed.data, initial.context)
      onClose()
    } catch (error) {
      setFailure({ message: errorMessage(error), field: error instanceof DomainError ? error.field : undefined })
    } finally {
      submitting.current = false
      setSaving(false)
    }
  }

  const fieldError = (field: keyof TaskDraft) => visibleError(field)
    ? <p className="form-error" id={`${id}-${field}-error`}>{visibleError(field)}</p> : null
  const fieldProps = (field: keyof TaskDraft) => ({
    'aria-invalid': !!visibleError(field),
    'aria-describedby': [
      field !== 'status' || doneIssue ? `${id}-${field}-hint` : null,
      visibleError(field) ? `${id}-${field}-error` : null,
    ].filter(Boolean).join(' ') || undefined,
    // Do not move the action under the pointer between mousedown and click.
    // Submitting validates the whole form after the button has been activated.
    onBlur: (event: FocusEvent<HTMLElement>) => {
      if (!(event.relatedTarget instanceof HTMLButtonElement)) setTouched(previous => ({ ...previous, [field]: true }))
    },
  })

  return <Sheet open onOpenChange={open => { if (!open) close() }}>
    <SheetContent className="task-sheet" aria-describedby={undefined} showCloseButton={false} onKeyDownCapture={guardIme}
      onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }}
      onOpenAutoFocus={event => {
        event.preventDefault()
        returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        titleRef.current?.focus()
      }}
      onCloseAutoFocus={event => {
        event.preventDefault()
        const target = returnFocusRef.current
        requestAnimationFrame(() => {
          if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) return
          if (target?.isConnected) target.focus()
          else document.querySelector<HTMLElement>('[data-editor-focus-fallback], main button, button')?.focus()
        })
      }}
      onEscapeKeyDown={event => {
        if (composing.current || event.isComposing || event.keyCode === 229 || submitting.current) event.preventDefault()
        else if (confirmClose) { event.preventDefault(); setConfirmClose(false); requestAnimationFrame(() => titleRef.current?.focus()) }
      }}>
      <SheetHeader>
        <div className="flex items-start justify-between gap-3">
          <SheetTitle>{initial.task ? 'タスクの詳細' : parentId ? '子タスクを追加' : 'タスクを追加'}</SheetTitle>
          <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={close}>閉じる</Button>
        </div>
      </SheetHeader>
      <form className="editor-form" ref={formRef} noValidate onSubmit={save} aria-busy={saving}>
        {externalChange ? <p className="form-error" role="status">別の操作で内容が変更されました。入力は残っています。最新の内容を開き直してください。</p> : null}
        <fieldset disabled={saving} className="grid gap-4" hidden={confirmClose}>
          <div className="field">
            <Label htmlFor={`${id}-title`}>タイトル <span className="muted">必須</span></Label>
            <Input ref={titleRef} id={`${id}-title`} required value={draft.title} onChange={event => update('title', event.target.value)} {...fieldProps('title')} />
            <p className="muted" id={`${id}-title-hint`}>{characterCount(draft.title.trim())}/160文字</p>{fieldError('title')}
          </div>
          <div className="field">
            <Label htmlFor={`${id}-description`}>説明</Label>
            <Textarea id={`${id}-description`} rows={6} value={draft.description} onChange={event => update('description', event.target.value)} {...fieldProps('description')} />
            <p className="muted" id={`${id}-description-hint`}>{characterCount(draft.description)}/5,000文字</p>{fieldError('description')}
          </div>
          <div className="field-row">
            <div className="field">
              <Label htmlFor={`${id}-status`}>状態</Label>
              <select id={`${id}-status`} value={draft.status} onChange={event => update('status', event.target.value as TaskStatus)} {...fieldProps('status')}>
                {STATUSES.map(status => <option value={status} key={status} disabled={status === 'done' && !!doneIssue}>{STATUS_LABELS[status]}{status === 'done' && doneIssue ? '（未完了の子タスクあり）' : ''}</option>)}
              </select>
              {doneIssue && <p className="muted" id={`${id}-status-hint`}>{doneIssue}</p>}{fieldError('status')}
            </div>
            <div className="field">
              <Label htmlFor={`${id}-priority`}>優先度</Label>
              <select id={`${id}-priority`} value={draft.priority} onChange={event => update('priority', event.target.value as TaskDraft['priority'])}>
                {PRIORITIES.map(priority => <option value={priority} key={priority}>{PRIORITY_LABELS[priority]}</option>)}
              </select>
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <Label htmlFor={`${id}-kind`}>種別</Label>
              <select id={`${id}-kind`} value={draft.kind} onChange={event => update('kind', event.target.value as TaskDraft['kind'])}>
                {KINDS.map(kind => <option value={kind} key={kind}>{KIND_LABELS[kind]}</option>)}
              </select>
            </div>
            <div className="field">
              <Label htmlFor={`${id}-dueDate`}>期限</Label>
              <Input id={`${id}-dueDate`} type="date" min="0001-01-01" max="9999-12-31" value={draft.dueDate ?? ''} onChange={event => update('dueDate', event.target.value || null)} {...fieldProps('dueDate')} />
              <p className="muted" id={`${id}-dueDate-hint`}>空欄は期限なし</p>{fieldError('dueDate')}
            </div>
          </div>
          <div className="field">
            <Label htmlFor={`${id}-parentId`}>親タスク</Label>
            <select id={`${id}-parentId`} value={draft.parentId ?? ''} onChange={event => update('parentId', event.target.value || null)} {...fieldProps('parentId')}>
              <option value="">親なし</option>
              {draft.parentId && !choices.some(choice => choice.task.id === draft.parentId) ? <option value={draft.parentId} disabled>削除された親タスク</option> : null}
              {choices.map(choice => <option key={choice.task.id} value={choice.task.id} disabled={!!choice.reason}>{choice.label}{choice.reason ? `（${choice.reason}）` : ''}</option>)}
            </select>
            <p className="muted" id={`${id}-parentId-hint`}>最大3階層</p>{fieldError('parentId')}
          </div>
        </fieldset>
        {failure ? <p className="form-error" role="alert">{failure.message}</p> : null}
        {confirmClose ? <div className="grid gap-3" role="group" aria-labelledby={`${id}-discard-title`}>
          <p id={`${id}-discard-title`}>未保存の変更があります。保存して閉じますか？</p>
          <div className="form-actions">
            <Button type="submit" disabled={saving}>保存して閉じる</Button>
            <Button type="button" variant="outline" disabled={saving} onClick={onClose}>変更を破棄</Button>
            <Button ref={keepEditingRef} type="button" variant="ghost" disabled={saving} onClick={() => { setConfirmClose(false); requestAnimationFrame(() => titleRef.current?.focus()) }}>編集に戻る</Button>
          </div>
        </div> : <>
          <div className="form-actions">
            <Button type="submit" disabled={saving}>{saving ? '保存中…' : initial.task ? '保存' : '追加'}</Button>
            <Button type="button" variant="outline" disabled={saving} onClick={close}>キャンセル</Button>
          </div>
          {initial.task && (onAddChild || onDelete) ? <div className="grid gap-2">
            <div className="form-actions">
              {onAddChild ? <Button type="button" variant="outline" disabled={saving || dirty || !!childIssue || !!externalChange} onClick={() => onAddChild(task ?? initial.task!)}>子タスクを追加</Button> : null}
              {onDelete ? <Button type="button" variant="ghost" disabled={saving || dirty || !!externalChange} onClick={() => onDelete(task ?? initial.task!)}>このタスクを削除</Button> : null}
            </div>
            {dirty ? <p className="muted">子の追加・削除は、変更を保存するか破棄してから行えます。</p> : null}
            {childIssue ? <p className="muted">子を追加できません：{childIssue}。</p> : null}
            {externalChange ? <p className="muted">子の追加・削除を行うには、最新のタスクを開き直してください。</p> : null}
          </div> : null}
        </>}
      </form>
    </SheetContent>
  </Sheet>
}

export default TaskEditor
