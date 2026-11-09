import { useState } from 'react'
import { Download, Upload, FileJson, AlertTriangle } from 'lucide-react'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { exportBackup, parseBackup, restoreBackup } from '../data/store'
import type { Snapshot } from '../domain/types'
import type { Backup } from '../domain/validation'
import { errorMessage } from '../domain/errors'

export function BackupDialog({
  snapshot,
  onClose,
  onRestored,
}: {
  snapshot: Snapshot
  onClose: () => void
  onRestored: () => void
}) {
  const [candidate, setCandidate] = useState<{
    backup: Backup
    name: string
    generation: string
    sequence: number
  } | null>(null)
  const [largeFile, setLargeFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  async function download() {
    setBusy(true)
    setError('')
    try {
      const backup = await exportBackup()
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(backup, null, 2)], {
          type: 'application/json',
        }),
      )
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `devtodo-${backup.exportedAt.slice(0, 10)}.json`
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setMessage(
        `${backup.projects.length}プロジェクト・${backup.tasks.length}タスクを書き出しました。`,
      )
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }
  async function read(file: File) {
    setBusy(true)
    setError('')
    setCandidate(null)
    setLargeFile(null)
    setMessage('')
    try {
      const backup = parseBackup(await file.text())
      setCandidate({
        backup,
        name: file.name,
        generation: snapshot.generation,
        sequence: snapshot.sequence,
      })
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }
  async function restore() {
    if (!candidate) return
    setBusy(true)
    setError('')
    try {
      await restoreBackup(
        candidate.backup,
        candidate.generation,
        candidate.sequence,
      )
      onRestored()
      onClose()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent
        className="backup-dialog"
        aria-describedby={undefined}
        onInteractOutside={(event) => {
          if (busy) event.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>バックアップと復元</DialogTitle>
        </DialogHeader>
        <section className="backup-section">
          <h3>
            <Download size={17} /> JSONを書き出す
          </h3>
          <Button variant="outline" onClick={download} disabled={busy}>
            <Download data-icon="inline-start" />
            現在のデータを書き出す
          </Button>
        </section>
        <section className="backup-section">
          <h3>
            <Upload size={17} /> JSONから復元する
          </h3>
          <p className="muted">内容の確認後、現在の全データを置き換えます。</p>
          <label className="file-picker">
            <FileJson size={18} />
            <span>バックアップファイルを選択</span>
            <input
              aria-label="バックアップファイル"
              type="file"
              accept=".json,application/json"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) {
                  setCandidate(null)
                  setError('')
                  setMessage('')
                  if (file.size > 20 * 1024 * 1024) setLargeFile(file)
                  else void read(file)
                }
                event.target.value = ''
              }}
            />
          </label>
        </section>
        {largeFile && (
          <div className="restore-preview">
            <p>
              {largeFile.name}（{(largeFile.size / 1024 / 1024).toFixed(1)}
              MB）を読み込みます。大きなファイルは確認に時間がかかります。
            </p>
            <Button onClick={() => read(largeFile)}>内容を読み込む</Button>
            <Button variant="ghost" onClick={() => setLargeFile(null)}>
              キャンセル
            </Button>
          </div>
        )}
        {candidate && (
          <div className="restore-preview">
            <h3>
              <AlertTriangle size={17} /> 全データの置き換え
            </h3>
            <p className="break-word">{candidate.name}</p>
            <p>
              <strong>
                {candidate.backup.projects.length}プロジェクト・
                {candidate.backup.tasks.length}タスク
              </strong>
              を復元します。
            </p>
            <p className="muted">
              現在の{snapshot.projects.length}プロジェクト・
              {snapshot.tasks.length}
              タスクは置き換わります。取り消しはできません。
            </p>
            <div className="form-actions">
              <Button variant="destructive" onClick={restore} disabled={busy}>
                この内容で復元する
              </Button>
              <Button
                variant="outline"
                onClick={() => setCandidate(null)}
                disabled={busy}
              >
                キャンセル
              </Button>
            </div>
          </div>
        )}
        {busy && <p role="status">処理しています…</p>}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {message && <p role="status">{message}</p>}
        <p className="storage-note">
          ブラウザのデータを削除すると、タスクも失われます。
        </p>
      </DialogContent>
    </Dialog>
  )
}
