import type { ERDSchema } from "../model/types";
import { importFromJSON } from "./index";

/**
 * Browser-local backup of changes that have not reached the server yet.
 *
 * One slot only: the latest unsaved schema. The slot is written while the
 * editor has unsaved changes and cleared once a server save succeeds, so a
 * saved schema does not linger in the browser.
 */

const DB_NAME = "erd-studio";
const DB_VERSION = 1;
const STORE = "drafts";
const SLOT_KEY = "current";

export interface BrowserDraft {
  schema: ERDSchema;
  /** ISO timestamp of the last write. */
  savedAt: string;
  /** True when the draft was based on a project opened from or saved to the server. */
  fromServerProject: boolean;
}

interface StoredDraft {
  format: 1;
  schemaJSON: string;
  savedAt: string;
  fromServerProject: boolean;
}

type Factory = Pick<IDBFactory, "open">;

let factoryOverride: Factory | null | undefined;

/** Test hook: inject an IndexedDB factory (or null to simulate unavailability). */
export function setDraftStorageFactory(factory: Factory | null | undefined): void {
  factoryOverride = factory;
  dbPromise = null;
}

function getFactory(): Factory | null {
  if (factoryOverride !== undefined) return factoryOverride;
  try {
    return typeof indexedDB === "undefined" ? null : indexedDB;
  } catch {
    // Some sandboxed/privacy contexts throw on access.
    return null;
  }
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDB(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  const factory = getFactory();
  if (!factory) return Promise.resolve(null);
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => {
      const db = request.result;
      // Let other tabs upgrade later versions without blocking.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  // A failed open should not be cached forever.
  void dbPromise.then((db) => {
    if (!db) dbPromise = null;
  });
  return dbPromise;
}

function run<T>(
  mode: IDBTransactionMode,
  body: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<{ ok: true; value: T } | { ok: false }> {
  return openDB().then((db) => {
    if (!db) return { ok: false as const };
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE, mode);
        const request = body(tx.objectStore(STORE));
        tx.oncomplete = () => resolve({ ok: true, value: request.result });
        tx.onerror = () => resolve({ ok: false });
        tx.onabort = () => resolve({ ok: false });
      } catch {
        resolve({ ok: false });
      }
    });
  });
}

/** Whether IndexedDB can be opened in this browser context. */
export async function isBrowserDraftStorageAvailable(): Promise<boolean> {
  return (await openDB()) !== null;
}

/** Write the draft slot. Resolves false when browser storage is unavailable. */
export async function saveBrowserDraft(
  schema: ERDSchema,
  options: { fromServerProject: boolean; now?: Date },
): Promise<boolean> {
  const record: StoredDraft = {
    format: 1,
    schemaJSON: JSON.stringify(schema),
    savedAt: (options.now ?? new Date()).toISOString(),
    fromServerProject: options.fromServerProject,
  };
  const result = await run("readwrite", (store) => store.put(record, SLOT_KEY));
  return result.ok;
}

/**
 * Read the draft slot. Invalid or corrupt data is discarded and reported as
 * no draft, using the same validation as JSON import.
 */
export async function loadBrowserDraft(): Promise<BrowserDraft | null> {
  const result = await run<unknown>("readonly", (store) => store.get(SLOT_KEY));
  if (!result.ok || !result.value || typeof result.value !== "object") return null;
  const stored = result.value as Partial<StoredDraft>;
  if (stored.format !== 1 || typeof stored.schemaJSON !== "string" || typeof stored.savedAt !== "string") {
    await clearBrowserDraft();
    return null;
  }
  const { schema, error } = importFromJSON(stored.schemaJSON);
  if (error) {
    await clearBrowserDraft();
    return null;
  }
  return {
    schema,
    savedAt: stored.savedAt,
    fromServerProject: stored.fromServerProject === true,
  };
}

/** Remove the draft slot. Resolves false when browser storage is unavailable. */
export async function clearBrowserDraft(): Promise<boolean> {
  const result = await run("readwrite", (store) => store.delete(SLOT_KEY));
  return result.ok;
}
