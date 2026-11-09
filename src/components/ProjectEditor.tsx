import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { characterCount } from '../domain/dates'
import { DomainError, errorMessage } from '../domain/errors'
import type { Project, ProjectDraft, WriteContext } from '../domain/types'
import { projectDraftSchema } from '../domain/validation'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Textarea } from './ui/textarea'

export interface ProjectEditorProps {
  project?: Project
  generation: string
  onSave: (draft: ProjectDraft, context: WriteContext | null) => Promise<void>
  onClose: () => void
}

export function ProjectEditor({ project, generation, onSave, onClose }: ProjectEditorProps) {
  const [initial] = useState(() => ({
    project,
    generation,
    draft: { name: project?.name ?? '', description: project?.description ?? '' },
    context: project ? { generation, revision: project.revision } : null,
  }))
  const [draft, setDraft] = useState<ProjectDraft>(initial.draft)
  const [touched, setTouched] = useState<Partial<Record<keyof ProjectDraft, boolean>>>({})
  const [attempted, setAttempted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [failure, setFailure] = useState<{ message: string; field?: string } | null>(null)
  const [focusRequest, setFocusRequest] = useState<{ field: string } | null>(null)
  const id = useId()
  const nameRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const keepEditingRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const composing = useRef(false)
  const submitting = useRef(false)
  const dirty = draft.name !== initial.draft.name || draft.description !== initial.draft.description
  const parsed = projectDraftSchema.safeParse(draft)
  const errors: Partial<Record<keyof ProjectDraft, string>> = {}
  if (!parsed.success) for (const issue of parsed.error.issues) errors[issue.path[0] as keyof ProjectDraft] ??= issue.message
  const externalChange = generation !== initial.generation || (initial.project && (!project || project.revision !== initial.project.revision))

  useEffect(() => { if (confirmClose) keepEditingRef.current?.focus() }, [confirmClose])
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

  function update(field: keyof ProjectDraft, value: string) {
    setDraft(previous => ({ ...previous, [field]: value }))
    setFailure(null)
  }

  function visibleError(field: keyof ProjectDraft) {
    return failure?.field === field ? failure.message : attempted || touched[field] ? errors[field] : undefined
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (submitting.current || composing.current) return
    setAttempted(true)
    setConfirmClose(false)
    setFailure(null)
    if (!parsed.success) {
      setFocusRequest({ field: String(parsed.error.issues[0]?.path[0] ?? 'name') })
      return
    }
    submitting.current = true
    setSaving(true)
    try {
      if (generation !== initial.generation) throw new DomainError('generation', 'バックアップが復元されました。入力は残っています。編集を開き直してください。')
      await onSave(parsed.data, initial.context)
      onClose()
    } catch (error) {
      setFailure({ message: errorMessage(error), field: error instanceof DomainError ? error.field : undefined })
    } finally {
      submitting.current = false
      setSaving(false)
    }
  }

  return <Dialog open onOpenChange={open => { if (!open) close() }}>
    <DialogContent className="project-dialog" aria-describedby={undefined} showCloseButton={false} onKeyDownCapture={guardIme}
      onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }}
      onOpenAutoFocus={event => {
        event.preventDefault()
        returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        nameRef.current?.focus()
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
        else if (confirmClose) { event.preventDefault(); setConfirmClose(false); requestAnimationFrame(() => nameRef.current?.focus()) }
      }}>
      <DialogHeader>
        <div className="flex items-start justify-between gap-3">
          <DialogTitle>{initial.project ? 'プロジェクトを編集' : 'プロジェクトを作成'}</DialogTitle>
          <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={close}>閉じる</Button>
        </div>
      </DialogHeader>
      <form ref={formRef} className="editor-form" onSubmit={save} noValidate aria-busy={saving}>
        {externalChange ? <p className="form-error" role="status">別の操作で内容が変更されました。入力は残っています。最新の内容を開き直してください。</p> : null}
        <fieldset disabled={saving} className="grid gap-4" hidden={confirmClose}>
          <div className="field">
            <Label htmlFor={`${id}-name`}>プロジェクト名 <span className="muted">必須</span></Label>
            <Input ref={nameRef} id={`${id}-name`} required value={draft.name} onChange={event => update('name', event.target.value)}
              onBlur={event => { if (!(event.relatedTarget instanceof HTMLButtonElement)) setTouched(previous => ({ ...previous, name: true })) }} aria-invalid={!!visibleError('name')}
              aria-describedby={`${id}-name-hint${visibleError('name') ? ` ${id}-name-error` : ''}`} />
            <p className="muted" id={`${id}-name-hint`}>{characterCount(draft.name.trim())}/60文字</p>
            {visibleError('name') ? <p className="form-error" id={`${id}-name-error`}>{visibleError('name')}</p> : null}
          </div>
          <div className="field">
            <Label htmlFor={`${id}-description`}>説明</Label>
            <Textarea id={`${id}-description`} rows={4} value={draft.description} onChange={event => update('description', event.target.value)}
              onBlur={event => { if (!(event.relatedTarget instanceof HTMLButtonElement)) setTouched(previous => ({ ...previous, description: true })) }} aria-invalid={!!visibleError('description')}
              aria-describedby={`${id}-description-hint${visibleError('description') ? ` ${id}-description-error` : ''}`} />
            <p className="muted" id={`${id}-description-hint`}>{characterCount(draft.description)}/5,000文字</p>
            {visibleError('description') ? <p className="form-error" id={`${id}-description-error`}>{visibleError('description')}</p> : null}
          </div>
        </fieldset>
        {failure ? <p className="form-error" role="alert">{failure.message}</p> : null}
        {confirmClose ? <div className="grid gap-3" role="group" aria-labelledby={`${id}-discard-title`}>
          <p id={`${id}-discard-title`}>未保存の変更があります。保存して閉じますか？</p>
          <div className="form-actions">
            <Button type="submit" disabled={saving}>保存して閉じる</Button>
            <Button type="button" variant="outline" disabled={saving} onClick={onClose}>変更を破棄</Button>
            <Button ref={keepEditingRef} type="button" variant="ghost" disabled={saving} onClick={() => { setConfirmClose(false); requestAnimationFrame(() => nameRef.current?.focus()) }}>編集に戻る</Button>
          </div>
        </div> : <div className="form-actions">
          <Button type="submit" disabled={saving}>{saving ? '保存中…' : initial.project ? '保存' : '作成'}</Button>
          <Button type="button" variant="outline" disabled={saving} onClick={close}>キャンセル</Button>
        </div>}
      </form>
    </DialogContent>
  </Dialog>
}

export default ProjectEditor
