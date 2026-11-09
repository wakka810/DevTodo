import { relativeDateOnly } from '../domain/dates';
import type { Project, Task, TaskStatus } from '../domain/types';
import { newId } from './db';

export function createDemo(now = new Date()): { project: Project; tasks: Task[] } {
  const timestamp = now.toISOString();
  const project: Project = {
    id: newId(), name: 'Vine / サンプル',
    description: '',
    createdAt: timestamp, updatedAt: timestamp, revision: 1,
  };
  // Vine の構成を題材にしたサンプル。
  const rows: [string, number | null, TaskStatus][] = [
    ['JIT とブラウザ境界の性能を計測する', null, 'in_progress'],
    ['短時間フローの比較条件を揃える', 0, 'done'],
    ['CPU スライスとブラウザ yield の関係を確認する', 0, 'in_progress'],
    ['MessagePort RTT と表示遅延の指標を分ける', 2, 'todo'],
    ['メモリ拡張後の CPU ミラーを回帰確認する', 0, 'review'],
    ['未対応の DLL ロード経路を整理する', null, 'todo'],
    ['未読み込み DLL を実行中に読む場合の境界を調べる', 5, 'backlog'],
    ['循環インポートの停止条件を整理する', 5, 'todo'],
    ['描画・音声・保存の回帰確認を整理する', null, 'review'],
    ['D3D9 の LockRect フラグ対応範囲を確認する', 8, 'done'],
    ['OPFS 保存を新しい Worker から読み直す', 8, 'done'],
    ['音声 Stop 後の無音と通知待ちを回帰確認する', 8, 'review'],
    ['将来の x64 対応に必要な変更を調査する', null, 'backlog'],
    ['PE32+ と64bitアドレスへの変更箇所を洗い出す', 12, 'backlog'],
    ['CPU/JIT と Win64 側の対応範囲を整理する', 12, 'backlog'],
  ];
  const ids = rows.map(() => newId());
  const tasks: Task[] = rows.map(([title, parent, status], index) => ({
    id: ids[index], projectId: project.id, parentId: parent === null ? null : ids[parent],
    title, description: '', status, priority: index % 5 === 0 ? 'high' : index % 4 === 0 ? 'low' : 'medium',
    kind: index === 5 || index === 7 ? 'refactor' : index === 12 ? 'feature' : 'other',
    dueDate: index === 0 ? relativeDateOnly(-2, now) : index === 3 ? relativeDateOnly(0, now) : index === 11 ? relativeDateOnly(3, now) : null,
    createdAt: new Date(now.getTime() + index).toISOString(), updatedAt: new Date(now.getTime() + index).toISOString(), revision: 1,
  }));
  return { project, tasks };
}
