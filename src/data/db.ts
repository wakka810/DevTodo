import Dexie, { type Table } from 'dexie';
import type { Project, Task } from '../domain/types';
import { removeLegacyDemoDescriptions } from './migrations/remove-legacy-demo-descriptions';

export interface DataState {
  key: 'state';
  generation: string;
  sequence: number;
  demoProjectId?: string;
}

export const newId = (): string => crypto.randomUUID();

/** The path suffix isolates other apps hosted on the same GitHub Pages origin. */
export const DATABASE_NAME = `devtodo:${import.meta.env.BASE_URL}`;

export class DevTodoDatabase extends Dexie {
  projects!: Table<Project, string>;
  tasks!: Table<Task, string>;
  meta!: Table<DataState, string>;

  constructor(name = DATABASE_NAME) {
    super(name);
    this.version(1).stores({
      projects: 'id, createdAt',
      tasks: 'id, projectId, parentId, [projectId+status], createdAt',
      meta: 'key',
    });
    this.version(2).stores({}).upgrade(removeLegacyDemoDescriptions);
    // Keep Dexie's default versionchange handler: it closes older connections so
    // an upgrade can proceed, without reloading a tab and discarding its draft.
    // Metadata is created only for a genuinely new database. Never seed tasks here.
    this.on('populate', (transaction) => transaction.table('meta').add({ key: 'state', generation: newId(), sequence: 0 }));
  }
}

export const db = new DevTodoDatabase();
