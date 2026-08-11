import type { WordlistRecord, WordlistSource } from './types';
import { pageWindow } from './window-env';
import { normalizeImportedWords } from './wordlist';

const DB_NAME = 'xddh-custom-wordlist';
const DB_VERSION = 1;
const STORE_WORDLISTS = 'wordlists';
const STORE_META = 'meta';
const ACTIVE_KEY = 'activeWordlistId';

let dbPromise: Promise<IDBDatabase> | null = null;
let activeWordlist: WordlistRecord | null = null;
let wordListReady = false;
let resolveWordListReady: (() => void) | null = null;
let onWordlistChanged: (() => boolean) | null = null;
let refreshWordListUI: (() => Promise<void> | void) | null = null;

export const wordListReadyPromise = new Promise<void>(resolve => {
  resolveWordListReady = resolve;
});

export function getActiveWordlist(): WordlistRecord | null {
  return activeWordlist;
}

export function setWordlistChangeHandler(handler: () => boolean): void {
  onWordlistChanged = handler;
}

export function setWordListUIRefresh(handler: () => Promise<void> | void): void {
  refreshWordListUI = handler;
}

function notifyWordlistChanged(): boolean {
  return onWordlistChanged?.() ?? false;
}

function markWordListReady(): void {
  if (wordListReady) {
    return;
  }

  wordListReady = true;
  resolveWordListReady?.();
}

function openWordListDb(): Promise<IDBDatabase> {
  if (dbPromise) {
    return dbPromise;
  }

  const promise = new Promise<IDBDatabase>((resolve, reject) => {
    if (!pageWindow.indexedDB) {
      reject(new Error('当前环境不支持 IndexedDB'));
      return;
    }

    const request = pageWindow.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_WORDLISTS)) {
        db.createObjectStore(STORE_WORDLISTS, { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch(error => {
    dbPromise = null;
    throw error;
  });

  dbPromise = promise;

  return promise;
}

function dbRequest<T>(
  storeName: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openWordListDb().then(
    db =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);
        const request = operation(store);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      })
  );
}

export function dbGetAllWordlists(): Promise<WordlistRecord[]> {
  return dbRequest(STORE_WORDLISTS, 'readonly', store =>
    store.getAll()
  );
}

function dbPutWordlist(record: WordlistRecord): Promise<IDBValidKey> {
  return dbRequest(STORE_WORDLISTS, 'readwrite', store => store.put(record));
}

function dbDeleteWordlist(id: string): Promise<undefined> {
  return dbRequest(STORE_WORDLISTS, 'readwrite', store => store.delete(id));
}

async function dbGetActiveId(): Promise<string | null> {
  const row = await dbRequest<{ value?: unknown } | undefined>(STORE_META, 'readonly', store =>
    store.get(ACTIVE_KEY)
  );

  return typeof row?.value === 'string' ? row.value : null;
}

function dbSetActiveId(id: string | null): Promise<IDBValidKey> {
  return dbRequest(STORE_META, 'readwrite', store =>
    store.put({
      key: ACTIVE_KEY,
      value: id
    })
  );
}

function pickUniqueName(lists: readonly WordlistRecord[], preferred: string): string {
  if (!lists.some(list => list.name === preferred)) {
    return preferred;
  }

  let index = 2;

  while (lists.some(list => list.name === `${preferred} (${index})`)) {
    index += 1;
  }

  return `${preferred} (${index})`;
}

export async function addWordlist({
  name,
  words,
  source
}: {
  name: string;
  words: readonly unknown[];
  source: WordlistSource;
}): Promise<{ record: WordlistRecord; applied: boolean }> {
  const normalizedWords = normalizeImportedWords(words);

  if (normalizedWords.length === 0) {
    throw new Error('词库中没有有效内容');
  }

  const lists = await dbGetAllWordlists();
  const record: WordlistRecord = {
    id: `wl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    name: pickUniqueName(lists, name),
    words: normalizedWords,
    source,
    updatedAt: Date.now()
  };

  await dbPutWordlist(record);
  activeWordlist = record;
  await dbSetActiveId(record.id);

  return {
    record,
    applied: notifyWordlistChanged()
  };
}

export async function selectWordlist(id: string): Promise<WordlistRecord | null> {
  if (id) {
    const lists = await dbGetAllWordlists();
    activeWordlist = lists.find(list => list.id === id) ?? null;
    await dbSetActiveId(activeWordlist?.id ?? null);
  } else {
    activeWordlist = null;
    await dbSetActiveId(null);
  }

  notifyWordlistChanged();

  return activeWordlist;
}

export async function deleteWordlist(id: string): Promise<void> {
  await dbDeleteWordlist(id);

  if (activeWordlist?.id === id) {
    activeWordlist = null;
    await dbSetActiveId(null);
    notifyWordlistChanged();
  }
}

export async function initWordListStorage(): Promise<void> {
  const timeoutId = window.setTimeout(markWordListReady, 8000);

  try {
    const activeId = await dbGetActiveId();

    if (activeId) {
      const lists = await dbGetAllWordlists();
      activeWordlist = lists.find(list => list.id === activeId) ?? null;

      if (!activeWordlist) {
        await dbSetActiveId(null);
      }
    }
  } catch (error) {
    console.error('[XDDH Hook] 读取 IndexedDB 词库失败', error);
  } finally {
    window.clearTimeout(timeoutId);
  }

  notifyWordlistChanged();
  refreshWordListUI?.();
  markWordListReady();
}
