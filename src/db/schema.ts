/**
 * db/schema.ts — DDL for all tables.
 * Ported from Hadassah database.py with the following changes:
 *   - dates stored as ISO "YYYY-MM-DD" (not "DD/MM/YYYY") → ORDER BY date works naturally
 *   - added lab_source, original_filename, test_name_normalized columns
 *   - added settings table for persisting UI preferences
 */

import { getDb } from './engine';
import { saveDb } from './engine';

export function initSchema(): void {
  const db = getDb();

  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      record_num        TEXT,
      date              TEXT NOT NULL,          -- ISO "YYYY-MM-DD"
      lab_source        TEXT,                   -- "hadassah" | "maccabi" | "generic" | "imaging"
      department        TEXT,
      material          TEXT,                   -- "דם" | "שתן" | "דם ורידי" | "דיווח הדמיה"
      urine_volume      INTEGER,
      urine_hours       INTEGER,
      original_filename TEXT,
      version           INTEGER DEFAULT 1,
      imported_at       TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now'))
    );

    CREATE TABLE IF NOT EXISTS results (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id          INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      category            TEXT,
      test_name           TEXT NOT NULL,
      test_name_normalized TEXT,
      value_num           REAL,
      value_text          TEXT,
      is_less_than        INTEGER DEFAULT 0,
      is_numeric          INTEGER DEFAULT 1,
      unit                TEXT,
      range_min           REAL,
      range_max           REAL,
      raw_range           TEXT,
      is_abnormal         INTEGER,     -- 0=normal, 1=abnormal, NULL=unknown
      notes               TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_results_test_name
      ON results(test_name);
    CREATE INDEX IF NOT EXISTS idx_results_normalized
      ON results(test_name_normalized);
    CREATE INDEX IF NOT EXISTS idx_sessions_date
      ON sessions(date);
    CREATE INDEX IF NOT EXISTS idx_sessions_lab
      ON sessions(lab_source);

    CREATE TABLE IF NOT EXISTS groups (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS group_members (
      group_id  INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      test_name TEXT NOT NULL,
      PRIMARY KEY (group_id, test_name)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  saveDb();
}
