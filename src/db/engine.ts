/**
 * db/engine.ts — sql.js initialization + IndexedDB persistence.
 * The entire SQLite database is loaded into memory via sql.js (WASM).
 * After every write operation, the DB is serialized and saved to IndexedDB.
 */

import type { Database } from 'sql.js';
// Vite imports the WASM binary as a hashed asset URL (works in dev + production)
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

const IDB_NAME    = 'medtracker';
const IDB_STORE   = 'db';
const IDB_KEY     = 'medtracker_db';
const IDB_VERSION = 1;

let db: Database | null = null;

// ── IndexedDB helpers ──────────────────────────────────────

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function loadFromIndexedDB(): Promise<Uint8Array | null> {
  try {
    const idb = await openIdb();
    return new Promise((resolve) => {
      const tx  = idb.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror   = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function saveDb(): Promise<void> {
  if (!db) return;
  try {
    const data = db.export();
    const idb  = await openIdb();
    await new Promise<void>((resolve, reject) => {
      const tx  = idb.transaction(IDB_STORE, 'readwrite');
      const req = tx.objectStore(IDB_STORE).put(data, IDB_KEY);
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
  } catch (e) {
    console.error('Failed to save DB:', e);
  }
}

// ── Init ──────────────────────────────────────────────────

export async function initDb(): Promise<Database> {
  if (db) return db;

  // Request persistent storage so iOS doesn't evict our IndexedDB data
  if (navigator.storage?.persist) {
    navigator.storage.persist().catch(() => {/* ignore */});
  }

  // Save DB whenever the app goes to background (critical for iOS PWA)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveDb();
  });

  // sql.js is CJS; Vite may wrap it as { default: fn } or expose fn directly
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = await import('sql.js') as any;
  const initSqlJs = mod.default ?? mod;

  const SQL   = await initSqlJs({ locateFile: () => sqlWasmUrl });
  const saved = await loadFromIndexedDB();

  const instance: Database = saved ? new SQL.Database(saved) : new SQL.Database();
  instance.run('PRAGMA foreign_keys = ON');
  db = instance;
  return db;
}

export function getDb(): Database {
  if (!db) throw new Error('DB not initialized — call initDb() first');
  return db;
}

export function closeDb(): void {
  if (db) { db.close(); db = null; }
}
