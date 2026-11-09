import type { Transaction } from 'dexie';
import type { Project, Task } from '../../domain/types';
import { DomainError } from '../../domain/errors';
import { validateDataset } from '../../domain/validation';
import type { DataState } from '../db';

// Historical v1 seed values. Keep them independent of the current demo: only
// these exact values, inside the project identified by its stored marker, change.
const legacyProjectDescription = 'Vine の構成を参考にした架空の開発タスク。状態・期限・優先度は操作確認用です。';
const legacyTaskDescriptions = new Map<string, string>([
  ['JIT とブラウザ境界の性能を計測する', 'STATUS.md と browser/runtime-worker/game-worker.ts、v86-mirror.ts の構成を参考にした計測作業の例。JIT は既存構成に含まれます。'],
  ['短時間フローの比較条件を揃える', '同じ入力と観測区間を使うという架空の確認タスクです。'],
  ['CPU スライスとブラウザ yield の関係を確認する', 'Windows 側の状態を持つ Rust/Wasm と、ブラウザ資源を扱う TypeScript の境界を確認する例。'],
  ['MessagePort RTT と表示遅延の指標を分ける', '指標の意味を区別するための操作確認用タスク。実測値や改善効果を示すものではありません。'],
  ['メモリ拡張後の CPU ミラーを回帰確認する', 'v86-mirror.ts を参照する架空の回帰確認。'],
  ['未対応の DLL ロード経路を整理する', 'STATUS.md と crates/vine-core/src/module_graph.rs を参考にした調査例。'],
  ['未読み込み DLL を実行中に読む場合の境界を調べる', '調査候補を分解する例。確認済みの実在不具合を示すものではありません。'],
  ['循環インポートの停止条件を整理する', 'module_graph.rs に関する架空の確認作業。'],
  ['描画・音声・保存の回帰確認を整理する', 'D3D9、音声、OPFS の確認項目をまとめる管理例。'],
  ['D3D9 の LockRect フラグ対応範囲を確認する', 'crates/vine-core/src/d3d9.rs を参考にした確認タスクの例。'],
  ['OPFS 保存を新しい Worker から読み直す', 'browser/runtime-worker/writable-tree.ts を参考にした保存確認の例。'],
  ['音声 Stop 後の無音と通知待ちを回帰確認する', '操作確認用の架空タスク。実在する不具合を主張するものではありません。'],
  ['将来の x64 対応に必要な変更を調査する', '現在の対象は PE32/i386。x64/PE32+・Win64 は対象外であり、対応済みという意味ではありません。'],
  ['PE32+ と64bitアドレスへの変更箇所を洗い出す', 'STATUS.md と crates/vine-core/src/pe32.rs を基にした将来調査の例。'],
  ['CPU/JIT と Win64 側の対応範囲を整理する', 'CPU/JIT を提供する Vine-v86 fork との責務を整理する架空のタスク。'],
]);

function migrationError(): DomainError {
  return new DomainError('storage', '保存データの整合性を確認できず、サンプルの説明を更新できませんでした。データは変更していません。');
}

/** Runs once, in IndexedDB's atomic v1→v2 upgrade transaction. */
export async function removeLegacyDemoDescriptions(transaction: Transaction): Promise<void> {
  const projects = transaction.table<Project, string>('projects');
  const tasks = transaction.table<Task, string>('tasks');
  const meta = transaction.table<DataState, string>('meta');
  const state = await meta.get('state');
  if (!state || typeof state.generation !== 'string' || !state.generation || !Number.isSafeInteger(state.sequence) || state.sequence < 0) {
    throw migrationError();
  }
  // Backups do not carry this marker. Never infer ownership from a project name.
  if (state.demoProjectId === undefined) return;
  if (typeof state.demoProjectId !== 'string' || !state.demoProjectId) throw migrationError();
  const project = await projects.get(state.demoProjectId);
  // A deleted demo leaves a harmless stale marker in v1.
  if (!project) return;
  const projectTasks = await tasks.where('projectId').equals(project.id).toArray();
  const clearProject = project.description === legacyProjectDescription;
  const clearTasks = projectTasks.filter(task => typeof task.description === 'string' && legacyTaskDescriptions.get(task.title) === task.description);
  if (!clearProject && clearTasks.length === 0) return;

  // Check before any write; malformed records or counters must not be repaired,
  // discarded or silently carried through a partial migration.
  validateDataset([project], projectTasks);
  const changedRecords = [...(clearProject ? [project] : []), ...clearTasks];
  if (state.sequence >= Number.MAX_SAFE_INTEGER || changedRecords.some(record => record.revision >= Number.MAX_SAFE_INTEGER)) {
    throw migrationError();
  }
  const now = new Date().toISOString();
  if (clearProject) {
    await projects.update(project.id, { description: '', revision: project.revision + 1, updatedAt: now });
  }
  for (const task of clearTasks) {
    await tasks.update(task.id, { description: '', revision: task.revision + 1, updatedAt: now });
  }
  // Keep the data generation and every other metadata field. Bump sequence once
  // to invalidate old Undo and revision once per affected record for stale forms.
  await meta.update('state', { sequence: state.sequence + 1 });
}
