export type ResourceUploadDestination = {
  category: string;
  folderPath: string;
};

export type ResourceUploadTask = {
  id: string;
  packId: string;
  file: File;
  destination: ResourceUploadDestination;
  status: 'queued' | 'uploading' | 'failed' | 'cancelled';
  attempts: number;
  message?: string;
  createdAt: number;
  updatedAt: number;
};

const DATABASE_NAME = 'beegame-resource-upload-queue';
const STORE_NAME = 'tasks';
const memoryTasks = new Map<string, ResourceUploadTask>();

export function createResourceUploadTask(
  packId: string,
  file: File,
  destination: ResourceUploadDestination,
): ResourceUploadTask {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    packId,
    file,
    destination,
    status: 'queued',
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export async function listResourceUploadTasks(packId: string): Promise<ResourceUploadTask[]> {
  const tasks = await readAll();
  return tasks
    .filter((task) => task.packId === packId)
    .map((task): ResourceUploadTask => task.status === 'uploading' ? { ...task, status: 'queued', updatedAt: Date.now() } : task)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function saveResourceUploadTask(task: ResourceUploadTask): Promise<void> {
  const next = { ...task, updatedAt: Date.now() };
  const db = await openDatabase();
  if (!db) {
    memoryTasks.set(next.id, next);
    return;
  }
  await transaction(db, 'readwrite', (store) => store.put(next));
}

export async function removeResourceUploadTask(id: string): Promise<void> {
  const db = await openDatabase();
  if (!db) {
    memoryTasks.delete(id);
    return;
  }
  await transaction(db, 'readwrite', (store) => store.delete(id));
}

async function readAll(): Promise<ResourceUploadTask[]> {
  const db = await openDatabase();
  if (!db) return [...memoryTasks.values()];
  return transaction<ResourceUploadTask[]>(db, 'readonly', (store) => store.getAll());
}

async function openDatabase(): Promise<IDBDatabase | undefined> {
  if (typeof indexedDB === 'undefined') return undefined;
  return new Promise((resolve) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(undefined);
  });
}

function transaction<T = void>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const request = operation(tx.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Resource upload queue storage failed'));
    tx.onerror = () => reject(tx.error ?? new Error('Resource upload queue storage failed'));
  });
}
