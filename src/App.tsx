import { lazy, Suspense, useMemo, useRef, useState, useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Terminal,
  Plus,
  Folder,
  List,
  Columns3,
  GitBranch,
  Search,
  SlidersHorizontal,
  Download,
  Pencil,
  Trash2,
  Menu,
  X,
  ArrowUpRight,
  CircleAlert,
  RotateCcw,
} from 'lucide-react'
import { Button } from './components/ui/button'
import { Input } from './components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './components/ui/dialog'
import { TaskEditor } from './components/TaskEditor'
import { ProjectEditor } from './components/ProjectEditor'
import { TaskList } from './components/TaskList'
import { BackupDialog } from './components/BackupDialog'
import {
  STATUSES,
  PRIORITIES,
  KINDS,
  STATUS_LABELS,
  PRIORITY_LABELS,
  KIND_LABELS,
  type Task,
  type TaskStatus,
  type Project,
  type Priority,
  type TaskKind,
} from './domain/types'
import { completion } from './domain/hierarchy'
import { errorMessage } from './domain/errors'
import * as store from './data/store'
import type { UndoToken, DeletePreview } from './data/store'
import './app.css'

const BoardView = lazy(() => import('./views/BoardView'))
const StructureView = lazy(() => import('./views/StructureView'))
type View = 'list' | 'board' | 'structure'
type Editor = {
  key: string
  task?: Task
  parentId?: string
  projectId: string
  status?: TaskStatus
  generation: string
}

export default function App() {
  const [retry, setRetry] = useState(0)
  const result = useLiveQuery(async () => {
    try {
      return { data: await store.readSnapshot(), error: '' }
    } catch (cause) {
      return { data: null, error: errorMessage(cause) }
    }
  }, [retry])
  const snapshot = result?.data
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [view, setView] = useState<View>('list')
  const [query, setQuery] = useState('')
  const [statuses, setStatuses] = useState<TaskStatus[]>([])
  const [priorities, setPriorities] = useState<Priority[]>([])
  const [kinds, setKinds] = useState<TaskKind[]>([])
  const [showFilters, setShowFilters] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [projectEditor, setProjectEditor] = useState<{
    project?: Project
    generation: string
  } | null>(null)
  const [backupOpen, setBackupOpen] = useState(false)
  const [deletion, setDeletion] = useState<DeletePreview | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [undo, setUndo] = useState<UndoToken | null>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const lastGeneration = useRef<string | null>(null)
  useEffect(() => {
    if (!snapshot) return
    if (
      lastGeneration.current !== null &&
      lastGeneration.current !== snapshot.generation
    ) {
      setUndo(null)
      setDeletion(null)
      setNotice(
        'バックアップからデータが復元されました。編集中の入力は保存前に確認してください。',
      )
    }
    lastGeneration.current = snapshot.generation
  }, [snapshot])
  const project =
    snapshot?.projects.find((item) => item.id === selectedId) ??
    snapshot?.projects[0]
  const tasks = useMemo(
    () =>
      snapshot?.tasks.filter((task) => task.projectId === project?.id) ?? [],
    [snapshot, project?.id],
  )
  const progress = completion(tasks)
  const filtering = !!(
    query.trim() ||
    statuses.length ||
    priorities.length ||
    kinds.length
  )
  const matchingIds = useMemo(
    () =>
      new Set(
        tasks
          .filter((task) => {
            const text = query.trim().toLocaleLowerCase('ja')
            return (
              (!text ||
                `${task.title}\n${task.description}`
                  .toLocaleLowerCase('ja')
                  .includes(text)) &&
              (!statuses.length || statuses.includes(task.status)) &&
              (!priorities.length || priorities.includes(task.priority)) &&
              (!kinds.length || kinds.includes(task.kind))
            )
          })
          .map((task) => task.id),
      ),
    [tasks, query, statuses, priorities, kinds],
  )
  const clearFilters = () => {
    setQuery('')
    setStatuses([])
    setPriorities([])
    setKinds([])
  }
  const rememberFocus = () => {
    returnFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
  }
  const restoreFocus = () => {
    requestAnimationFrame(() => {
      const previous = returnFocus.current
      if (previous?.isConnected && previous.getClientRects().length) {
        previous.focus()
        return
      }
      const fallback = [
        ...document.querySelectorAll<HTMLElement>(
          '[data-add-task], .mobile-menu, main button',
        ),
      ].find((element) => element.getClientRects().length > 0)
      fallback?.focus()
    })
  }
  function closeEditor() {
    setEditor(null)
    restoreFocus()
  }
  function addTask(status: TaskStatus = 'todo', parentId?: string) {
    if (!project || !snapshot) return
    rememberFocus()
    setEditor({
      key: crypto.randomUUID(),
      projectId: project.id,
      parentId,
      status,
      generation: snapshot.generation,
    })
  }
  function selectTask(id: string) {
    const task = tasks.find((item) => item.id === id)
    if (task && snapshot) {
      rememberFocus()
      setEditor({
        key: crypto.randomUUID(),
        task,
        projectId: task.projectId,
        generation: snapshot.generation,
      })
    }
  }
  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }
  function changeStatus(task: Task, status: TaskStatus) {
    if (!snapshot) return
    void run(async () => {
      const updated = await store.changeStatus(task.id, status, {
        generation: snapshot.generation,
        revision: task.revision,
      })
      setUndo(updated.undoToken)
      setNotice(
        `${STATUS_LABELS[status]}に変更しました。${updated.reopened.length ? `「${updated.reopened.join('、')}」も作業中に戻しました。` : ''}`,
      )
    })
  }
  async function askDelete(kind: 'task' | 'project', id: string) {
    rememberFocus()
    setDeleteError('')
    await run(async () => {
      const preview =
        kind === 'task'
          ? await store.previewDeleteTask(id)
          : await store.previewDeleteProject(id)
      setDeletion(preview)
    })
  }
  async function confirmDelete() {
    if (!deletion) return
    setBusy(true)
    setDeleteError('')
    try {
      await store.deleteConfirmed(deletion)
      if (deletion.kind === 'project') {
        setSelectedId(null)
        clearFilters()
      }
      setDeletion(null)
      setEditor(null)
      setUndo(null)
      setNotice(`${deletion.name}を削除しました。`)
      restoreFocus()
    } catch (cause) {
      setDeleteError(errorMessage(cause))
      try {
        const latest =
          deletion.kind === 'task'
            ? await store.previewDeleteTask(deletion.id)
            : await store.previewDeleteProject(deletion.id)
        setDeletion(latest)
      } catch {
        /* Keep the already-removed-target error. */
      }
    } finally {
      setBusy(false)
    }
  }
  function chooseProject(id: string) {
    setSelectedId(id)
    clearFilters()
    setNavOpen(false)
    setEditor(null)
    setNotice('')
    setError('')
  }
  const toggle = <T,>(value: T, values: T[], update: (items: T[]) => void) =>
    update(
      values.includes(value)
        ? values.filter((item) => item !== value)
        : [...values, value],
    )
  const sidebar = (
    <>
      <a
        className="brand"
        href={import.meta.env.BASE_URL}
        aria-label="DevTodo ホーム"
      >
        <span className="brand-mark">
          <Terminal size={19} />
        </span>
        <span>DevTodo</span>
      </a>
      <div className="nav-heading">
        <span>プロジェクト</span>
        <button
          className="icon-button"
          aria-label="プロジェクトを追加"
          onClick={() => {
            if (snapshot) {
              rememberFocus()
              setProjectEditor({ generation: snapshot.generation })
              setNavOpen(false)
            }
          }}
          disabled={!snapshot}
        >
          <Plus />
        </button>
      </div>
      <nav className="project-nav" aria-label="プロジェクト">
        {snapshot?.projects.map((item) => {
          const stats = completion(
            snapshot.tasks.filter((task) => task.projectId === item.id),
          )
          return (
            <button
              key={item.id}
              className={`project-link ${item.id === project?.id ? 'active' : ''}`}
              aria-current={item.id === project?.id ? 'page' : undefined}
              onClick={() => chooseProject(item.id)}
            >
              <Folder size={17} />
              <span>
                <span className="project-link-name">{item.name}</span>
                <span className="project-mini-progress">
                  {stats.total
                    ? `${stats.done}/${stats.total}件完了 · ${stats.percent}%`
                    : 'タスクなし'}
                </span>
              </span>
            </button>
          )
        })}
      </nav>
      <div className="sidebar-bottom">
        <button
          className="sidebar-action"
          onClick={() => {
            rememberFocus()
            setBackupOpen(true)
            setNavOpen(false)
          }}
          disabled={!snapshot}
        >
          <Download size={17} />
          バックアップ
        </button>
      </div>
    </>
  )
  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace">
        作業領域へスキップ
      </a>
      <aside className="sidebar">{sidebar}</aside>
      {navOpen && (
        <Dialog
          open
          onOpenChange={(open) => {
            setNavOpen(open)
            if (!open)
              requestAnimationFrame(() =>
                document
                  .querySelector<HTMLButtonElement>('.mobile-menu')
                  ?.focus(),
              )
          }}
        >
          <DialogContent className="mobile-nav">
            <DialogHeader className="sr-only">
              <DialogTitle>プロジェクト選択</DialogTitle>
              <DialogDescription>
                操作するプロジェクトを選びます。
              </DialogDescription>
            </DialogHeader>
            {sidebar}
          </DialogContent>
        </Dialog>
      )}
      <main id="workspace" className="workspace" tabIndex={-1}>
        <div className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="プロジェクトを開く"
            onClick={() => setNavOpen(true)}
          >
            <Menu />
          </button>
          <span className="workspace-label">
            <Folder size={15} />
            ワークスペース<span>/</span>
            <span>{project?.name ?? 'はじめる'}</span>
          </span>
        </div>
        {!result ? (
          <div className="empty-state" role="status">
            保存データを読み込んでいます…
          </div>
        ) : result.error ? (
          <div className="empty-state">
            <CircleAlert />
            <h1>データを読み込めませんでした</h1>
            <p role="alert">{result.error}</p>
            <p className="muted">保存データは削除していません。</p>
            <Button onClick={() => setRetry((value) => value + 1)}>
              再試行
            </Button>
          </div>
        ) : !project ? (
          <div className="empty-state welcome">
            <div className="empty-symbol">
              <Folder size={28} />
            </div>
            <h1>プロジェクトがありません</h1>
            <div className="welcome-actions">
              <Button
                onClick={() => {
                  rememberFocus()
                  setProjectEditor({ generation: snapshot!.generation })
                }}
              >
                <Plus data-icon="inline-start" />
                プロジェクトを作成
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const added = await store.loadDemo(snapshot!.generation)
                    setSelectedId(added.id)
                    setNotice('Vineのサンプルを追加しました。')
                  })
                }
              >
                Vineのサンプルを試す
                <ArrowUpRight data-icon="inline-end" />
              </Button>
            </div>
          </div>
        ) : (
          <>
            <header className="project-header">
              <div className="project-heading">
                <h1>{project.name}</h1>
                <div className="project-actions">
                  <button
                    className="icon-button"
                    aria-label="プロジェクトを編集"
                    onClick={() => {
                      rememberFocus()
                      setProjectEditor({
                        project,
                        generation: snapshot!.generation,
                      })
                    }}
                  >
                    <Pencil />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="プロジェクトを削除"
                    onClick={() => askDelete('project', project.id)}
                  >
                    <Trash2 />
                  </button>
                </div>
              </div>
              <div className="project-summary">
                {project.description && <p>{project.description}</p>}
                <span className="progress-caption">
                  {progress.total ? (
                    <>
                      完了{' '}
                      <strong>
                        {progress.done}/{progress.total}件
                      </strong>
                      <span className="progress-track">
                        <span style={{ width: `${progress.percent}%` }} />
                      </span>
                      {progress.percent}%
                    </>
                  ) : (
                    'タスクなし'
                  )}
                </span>
              </div>
            </header>
            <div className="workspace-toolbar">
              <div className="view-tabs" role="group" aria-label="表示形式">
                {(
                  [
                    { value: 'list', label: 'リスト', Icon: List },
                    { value: 'board', label: 'ボード', Icon: Columns3 },
                    { value: 'structure', label: '構造', Icon: GitBranch },
                  ] as const
                ).map(({ value, label, Icon }) => (
                  <button
                    key={value}
                    aria-pressed={view === value}
                    className={view === value ? 'active' : ''}
                    onClick={() => setView(value)}
                  >
                    <Icon size={16} />
                    {label}
                  </button>
                ))}
              </div>
              <Button
                data-add-task
                data-editor-focus-fallback
                onClick={() => addTask()}
              >
                <Plus data-icon="inline-start" />
                <span>タスクを追加</span>
              </Button>
            </div>
            <div className="search-toolbar">
              <div className="search-box">
                <Search size={16} />
                <Input
                  aria-label="タスクを検索"
                  placeholder="タイトル・説明を検索…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                {query && (
                  <button
                    className="icon-button"
                    aria-label="検索文字を消す"
                    onClick={() => setQuery('')}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              <button
                className={`filter-toggle ${showFilters ? 'active' : ''}`}
                aria-expanded={showFilters}
                aria-controls="task-filters"
                onClick={() => setShowFilters((value) => !value)}
              >
                <SlidersHorizontal size={15} />
                絞り込み
                {statuses.length + priorities.length + kinds.length > 0 && (
                  <span className="filter-count">
                    {statuses.length + priorities.length + kinds.length}
                  </span>
                )}
              </button>
              <span className="match-count">
                {filtering ? `${matchingIds.size}件一致` : `${tasks.length}件`}
              </span>
              {filtering && (
                <button className="text-button" onClick={clearFilters}>
                  すべて解除
                </button>
              )}
            </div>
            {showFilters && (
              <div className="filters" id="task-filters">
                <fieldset>
                  <legend>状態</legend>
                  {STATUSES.map((status) => (
                    <label key={status}>
                      <input
                        type="checkbox"
                        checked={statuses.includes(status)}
                        onChange={() => toggle(status, statuses, setStatuses)}
                      />
                      {STATUS_LABELS[status]}
                    </label>
                  ))}
                </fieldset>
                <fieldset>
                  <legend>優先度</legend>
                  {PRIORITIES.map((priority) => (
                    <label key={priority}>
                      <input
                        type="checkbox"
                        checked={priorities.includes(priority)}
                        onChange={() =>
                          toggle(priority, priorities, setPriorities)
                        }
                      />
                      {PRIORITY_LABELS[priority]}
                    </label>
                  ))}
                </fieldset>
                <fieldset>
                  <legend>種別</legend>
                  {KINDS.map((kind) => (
                    <label key={kind}>
                      <input
                        type="checkbox"
                        checked={kinds.includes(kind)}
                        onChange={() => toggle(kind, kinds, setKinds)}
                      />
                      {KIND_LABELS[kind]}
                    </label>
                  ))}
                </fieldset>
              </div>
            )}
            <div className="view-area">
              {!tasks.length ? (
                <div className="empty-state compact">
                  <List size={28} />
                  <h2>タスクがありません</h2>
                  <Button variant="outline" onClick={() => addTask()}>
                    <Plus data-icon="inline-start" />
                    最初のタスクを追加
                  </Button>
                </div>
              ) : !matchingIds.size ? (
                <div className="empty-state compact">
                  <Search size={26} />
                  <h2>一致するタスクがありません</h2>
                  <Button variant="outline" onClick={clearFilters}>
                    条件を解除する
                  </Button>
                </div>
              ) : view === 'list' ? (
                <TaskList
                  tasks={tasks}
                  matchingIds={matchingIds}
                  filtering={filtering}
                  onSelect={selectTask}
                  onStatusChange={changeStatus}
                  onPriorityChange={(task, priority) => {
                    void run(async () => {
                      await store.changePriority(task.id, priority, {
                        generation: snapshot!.generation,
                        revision: task.revision,
                      })
                      setUndo(null)
                      setNotice('優先度を保存しました。')
                    })
                  }}
                  onAdd={() => addTask()}
                />
              ) : (
                <Suspense
                  fallback={
                    <div className="empty-state compact" role="status">
                      表示を読み込んでいます…
                    </div>
                  }
                >
                  {view === 'board' ? (
                    <BoardView
                      tasks={tasks}
                      matchingIds={matchingIds}
                      filtering={filtering}
                      onSelect={selectTask}
                      onStatusChange={changeStatus}
                      onAdd={addTask}
                    />
                  ) : (
                    <StructureView
                      tasks={tasks}
                      matchingIds={matchingIds}
                      filtering={filtering}
                      onSelect={selectTask}
                      onStatusChange={changeStatus}
                      onAdd={addTask}
                    />
                  )}
                </Suspense>
              )}
            </div>
          </>
        )}
        {(notice || error) && (
          <div className={`notice-bar ${error ? 'error-notice' : ''}`}>
            <span role={error ? 'alert' : 'status'}>{error || notice}</span>
            {undo && !error && (
              <button
                className="text-button"
                onClick={() =>
                  run(async () => {
                    await store.undoStatus(undo)
                    setUndo(null)
                    setNotice('状態の変更を取り消しました。')
                  })
                }
              >
                <RotateCcw size={14} />
                取り消す
              </button>
            )}
            <button
              className="icon-button"
              aria-label="メッセージを閉じる"
              onClick={() => {
                setError('')
                setNotice('')
              }}
            >
              <X />
            </button>
          </div>
        )}
      </main>
      {editor && snapshot && (
        <TaskEditor
          key={editor.key}
          task={
            editor.task
              ? snapshot.tasks.find((task) => task.id === editor.task!.id)
              : undefined
          }
          projectId={editor.projectId}
          parentId={editor.parentId}
          defaultStatus={editor.status}
          tasks={snapshot.tasks}
          generation={snapshot.generation}
          onClose={closeEditor}
          onSave={async (draft, context) => {
            const updated =
              editor.task && context
                ? await store.updateTask(editor.task.id, draft, context)
                : await store.createTask(
                    editor.projectId,
                    draft,
                    editor.generation,
                  )
            setUndo(updated.undoToken ?? null)
            setNotice(
              `タスクを保存しました。${updated.reopened.length ? `「${updated.reopened.join('、')}」も作業中に戻しました。` : ''}`,
            )
          }}
          onDelete={(task) => {
            void askDelete('task', task.id)
          }}
          onAddChild={(task) => {
            setEditor({
              key: crypto.randomUUID(),
              projectId: task.projectId,
              parentId: task.id,
              generation: snapshot.generation,
            })
          }}
        />
      )}
      {projectEditor && (
        <ProjectEditor
          project={
            projectEditor.project
              ? snapshot?.projects.find(
                  (project) => project.id === projectEditor.project!.id,
                )
              : undefined
          }
          generation={snapshot?.generation ?? projectEditor.generation}
          onClose={() => {
            setProjectEditor(null)
            restoreFocus()
          }}
          onSave={async (draft, context) => {
            const changed =
              projectEditor.project && context
                ? await store.updateProject(
                    projectEditor.project.id,
                    draft,
                    context,
                  )
                : await store.createProject(draft, projectEditor.generation)
            if (!projectEditor.project) {
              setSelectedId(changed.id)
              clearFilters()
            }
            setUndo(null)
            setNotice('プロジェクトを保存しました。')
          }}
        />
      )}
      {backupOpen && snapshot && (
        <BackupDialog
          snapshot={snapshot}
          onClose={() => {
            setBackupOpen(false)
            restoreFocus()
          }}
          onRestored={() => {
            setEditor(null)
            setSelectedId(null)
            setUndo(null)
            clearFilters()
            setNotice('バックアップを復元しました。')
          }}
        />
      )}
      {deletion && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !busy) {
              setDeletion(null)
              restoreFocus()
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {deletion.kind === 'project' ? 'プロジェクト' : 'タスク'}
                を削除しますか？
              </DialogTitle>
              <DialogDescription>
                <span className="break-word">「{deletion.name}」</span>と
                {deletion.kind === 'project' ? '配下の' : '子孫を含む'}
                {deletion.taskCount}
                件のタスクを削除します。この操作は取り消せません。
              </DialogDescription>
            </DialogHeader>
            {deleteError && (
              <p role="alert" className="form-error">
                {deleteError}
                <br />
                最新の対象を表示しました。件数を確認してください。
              </p>
            )}
            <div className="form-actions">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setDeletion(null)
                  restoreFocus()
                }}
              >
                キャンセル
              </Button>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={confirmDelete}
              >
                削除する
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
