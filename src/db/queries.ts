/**
 * db/queries.ts — All SQL query functions.
 * Ported from Hadassah app.py and database.py.
 */

import { getDb, saveDb } from './engine';

// ── Types ─────────────────────────────────────────────────

export interface Session {
  id: number;
  record_num: string | null;
  date: string;              // ISO "YYYY-MM-DD"
  lab_source: string | null;
  department: string | null;
  material: string | null;
  urine_volume: number | null;
  urine_hours: number | null;
  original_filename: string | null;
  version: number;
  imported_at: string;
}

export interface Result {
  id: number;
  session_id: number;
  category: string | null;
  test_name: string;
  test_name_normalized: string | null;
  value_num: number | null;
  value_text: string | null;
  is_less_than: number;
  is_numeric: number;
  unit: string;
  range_min: number | null;
  range_max: number | null;
  raw_range: string;
  is_abnormal: number | null;
  notes: string;
  // joined from sessions:
  date?: string;
  material?: string;
  lab_source?: string;
  range_display?: string;
}

export interface Group {
  id: number;
  name: string;
  tests: string[];
}

export interface ResultsFilter {
  tests?: string[];
  dateFrom?: string;
  dateTo?: string;
  materials?: string[];
  abnormalOnly?: boolean;
  labSource?: string;
}

// ── Helpers ───────────────────────────────────────────────

function rows<T>(sql: string, params: (string | number | null)[] = []): T[] {
  const db   = getDb();
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const result: T[] = [];
  while (stmt.step()) result.push(stmt.getAsObject() as T);
  stmt.free();
  return result;
}

function exec(sql: string, params: (string | number | null)[] = []): void {
  getDb().run(sql, params);
}

function formatRange(rMin: number | null, rMax: number | null, raw: string): string {
  if (rMin !== null && rMax !== null) return `${rMin} – ${rMax}`;
  if (rMin !== null) return `> ${rMin}`;
  if (rMax !== null) return `< ${rMax}`;
  return raw?.split('\n')[0] ?? '';
}

// ── Sessions ──────────────────────────────────────────────

export function sessionExistsByRecord(recordNum: string): boolean {
  const r = rows<{ c: number }>(
    'SELECT COUNT(*) as c FROM sessions WHERE record_num = ?',
    [recordNum]
  );
  return (r[0]?.c ?? 0) > 0;
}

export function insertSession(session: {
  record_num: string | null;
  date: string;
  lab_source: string;
  department: string | null;
  material: string | null;
  urine_volume: number | null;
  urine_hours: number | null;
  original_filename: string;
  version: number;
  results: Array<{
    category: string | null;
    test_name: string;
    value_num: number | null;
    value_text: string | null;
    is_less_than: number;
    is_numeric: number;
    unit: string;
    range_min: number | null;
    range_max: number | null;
    raw_range: string;
    is_abnormal: number | null;
    notes: string;
  }>;
}): number {
  const db = getDb();

  db.run(
    `INSERT INTO sessions (record_num, date, lab_source, department, material,
       urine_volume, urine_hours, original_filename, version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      session.record_num,
      session.date,
      session.lab_source,
      session.department,
      session.material,
      session.urine_volume,
      session.urine_hours,
      session.original_filename,
      session.version,
    ]
  );

  const sessionId = (db.exec('SELECT last_insert_rowid() as id')[0].values[0][0] as number);

  for (const r of session.results) {
    db.run(
      `INSERT INTO results
         (session_id, category, test_name, test_name_normalized, value_num, value_text,
          is_less_than, is_numeric, unit, range_min, range_max, raw_range, is_abnormal, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sessionId,
        r.category,
        r.test_name,
        r.test_name.toLowerCase().trim(),
        r.value_num,
        r.value_text,
        r.is_less_than,
        r.is_numeric,
        r.unit,
        r.range_min,
        r.range_max,
        r.raw_range,
        r.is_abnormal,
        r.notes,
      ]
    );
  }

  saveDb();
  return sessionId;
}

export function deleteSession(sessionId: number): void {
  exec('DELETE FROM sessions WHERE id = ?', [sessionId]);
  saveDb();
}

export function getAllSessions(): Session[] {
  return rows<Session>('SELECT * FROM sessions ORDER BY date DESC');
}

// ── Results ───────────────────────────────────────────────

export function getResults(filter: ResultsFilter = {}): Result[] {
  let sql = `
    SELECT r.*, s.date, s.material, s.lab_source
    FROM results r
    JOIN sessions s ON s.id = r.session_id
    WHERE 1=1
  `;
  const params: (string | number | null)[] = [];

  if (filter.tests && filter.tests.length > 0) {
    sql += ` AND r.test_name IN (${filter.tests.map(() => '?').join(',')})`;
    params.push(...filter.tests);
  }
  if (filter.dateFrom) {
    sql += ' AND s.date >= ?';
    params.push(filter.dateFrom);
  }
  if (filter.dateTo) {
    sql += ' AND s.date <= ?';
    params.push(filter.dateTo);
  }
  if (filter.materials && filter.materials.length > 0) {
    sql += ` AND s.material IN (${filter.materials.map(() => '?').join(',')})`;
    params.push(...filter.materials);
  }
  if (filter.abnormalOnly) {
    sql += ' AND r.is_abnormal = 1';
  }
  if (filter.labSource) {
    sql += ' AND s.lab_source = ?';
    params.push(filter.labSource);
  }

  sql += ' ORDER BY s.date DESC, r.test_name';

  const result = rows<Result>(sql, params);
  return result.map(r => ({
    ...r,
    range_display: formatRange(r.range_min, r.range_max, r.raw_range),
  }));
}

export function getAllTestNames(): string[] {
  return rows<{ test_name: string }>(
    'SELECT DISTINCT test_name FROM results ORDER BY test_name'
  ).map(r => r.test_name);
}

// ── Groups ────────────────────────────────────────────────

export function getGroups(): Group[] {
  const groups = rows<{ id: number; name: string }>('SELECT id, name FROM groups ORDER BY name');
  return groups.map(g => {
    const members = rows<{ test_name: string }>(
      'SELECT test_name FROM group_members WHERE group_id = ? ORDER BY test_name',
      [g.id]
    );
    return { ...g, tests: members.map(m => m.test_name) };
  });
}

export function createGroup(name: string, tests: string[]): number {
  const db = getDb();
  db.run('INSERT INTO groups (name) VALUES (?)', [name]);
  const gid = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0] as number;
  for (const t of tests) db.run('INSERT INTO group_members VALUES (?, ?)', [gid, t]);
  saveDb();
  return gid;
}

export function updateGroup(gid: number, name: string, tests: string[]): void {
  const db = getDb();
  db.run('UPDATE groups SET name=? WHERE id=?', [name, gid]);
  db.run('DELETE FROM group_members WHERE group_id=?', [gid]);
  for (const t of tests) db.run('INSERT INTO group_members VALUES (?, ?)', [gid, t]);
  saveDb();
}

export function deleteGroup(gid: number): void {
  exec('DELETE FROM groups WHERE id=?', [gid]);
  saveDb();
}

// ── Settings ──────────────────────────────────────────────

export function getSetting(key: string): string | null {
  const r = rows<{ value: string }>('SELECT value FROM settings WHERE key=?', [key]);
  return r[0]?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  exec('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);
  saveDb();
}

// ── Dashboard data ────────────────────────────────────────

export interface DashboardEntry {
  test_name: string;
  unit: string;
  current_value: number | null;
  current_text: string | null;
  current_date: string;
  is_less_than: number;
  is_abnormal: number | null;
  range_min: number | null;
  range_max: number | null;
  raw_range: string;
  prev_value: number | null;
  prev_date: string | null;
}

export function getDashboardData(tests: string[]): DashboardEntry[] {
  if (tests.length === 0) return [];

  const result: DashboardEntry[] = [];

  for (const testName of tests) {
    const latest2 = rows<Result>(
      `SELECT r.*, s.date FROM results r
       JOIN sessions s ON s.id = r.session_id
       WHERE r.test_name = ? AND r.is_numeric = 1 AND r.value_num IS NOT NULL
       ORDER BY s.date DESC LIMIT 2`,
      [testName]
    );

    if (latest2.length === 0) continue;

    const cur  = latest2[0];
    const prev = latest2[1] ?? null;

    result.push({
      test_name:     testName,
      unit:          cur.unit,
      current_value: cur.value_num,
      current_text:  cur.value_text,
      current_date:  cur.date!,
      is_less_than:  cur.is_less_than,
      is_abnormal:   cur.is_abnormal,
      range_min:     cur.range_min,
      range_max:     cur.range_max,
      raw_range:     cur.raw_range,
      prev_value:    prev?.value_num ?? null,
      prev_date:     prev?.date ?? null,
    });
  }

  return result;
}

// ── Stats ─────────────────────────────────────────────────

export function getStats(): { sessions: number; results: number; abnormal: number; earliest: string | null; latest: string | null } {
  const db = getDb();
  const r = db.exec(`
    SELECT
      (SELECT COUNT(*) FROM sessions) as sessions,
      (SELECT COUNT(*) FROM results)  as results,
      (SELECT COUNT(*) FROM results WHERE is_abnormal = 1) as abnormal,
      (SELECT MIN(date) FROM sessions) as earliest,
      (SELECT MAX(date) FROM sessions) as latest
  `);
  const row = r[0]?.values[0] ?? [0, 0, 0, null, null];
  return {
    sessions: row[0] as number,
    results:  row[1] as number,
    abnormal: row[2] as number,
    earliest: row[3] as string | null,
    latest:   row[4] as string | null,
  };
}

// ── Export / Import ───────────────────────────────────────

export function exportAllData(): { sessions: Session[]; results: Result[]; groups: Group[] } {
  return {
    sessions: rows<Session>('SELECT * FROM sessions ORDER BY date'),
    results:  rows<Result>('SELECT * FROM results ORDER BY session_id, id'),
    groups:   getGroups(),
  };
}

/**
 * Restore a full JSON backup produced by exportAllData().
 * Existing data is replaced entirely.
 * Returns the number of sessions restored.
 */
export async function importAllData(backup: { sessions: Session[]; results: Result[]; groups: Group[] }): Promise<number> {
  const db = getDb();

  // Clear everything first
  db.run('DELETE FROM results');
  db.run('DELETE FROM sessions');
  db.run('DELETE FROM group_members');
  db.run('DELETE FROM groups');

  // Map old session id → new session id
  const idMap = new Map<number, number>();

  for (const s of backup.sessions) {
    db.run(
      `INSERT INTO sessions (record_num, date, lab_source, department, material,
         urine_volume, urine_hours, original_filename, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [s.record_num, s.date, s.lab_source, s.department, s.material,
       s.urine_volume, s.urine_hours, s.original_filename, s.version]
    );
    const newId = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0] as number;
    idMap.set(s.id, newId);
  }

  for (const r of backup.results) {
    const newSessionId = idMap.get(r.session_id);
    if (newSessionId === undefined) continue;
    db.run(
      `INSERT INTO results
         (session_id, category, test_name, test_name_normalized, value_num, value_text,
          is_less_than, is_numeric, unit, range_min, range_max, raw_range, is_abnormal, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newSessionId, r.category, r.test_name, r.test_name_normalized,
       r.value_num, r.value_text, r.is_less_than, r.is_numeric,
       r.unit, r.range_min, r.range_max, r.raw_range, r.is_abnormal, r.notes]
    );
  }

  for (const g of backup.groups) {
    db.run('INSERT INTO groups (name) VALUES (?)', [g.name]);
    const gid = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0] as number;
    for (const t of g.tests) {
      db.run('INSERT INTO group_members (group_id, test_name) VALUES (?, ?)', [gid, t]);
    }
  }

  await saveDb();
  return backup.sessions.length;
}

export function clearAllData(): void {
  const db = getDb();
  db.run('DELETE FROM results');
  db.run('DELETE FROM sessions');
  db.run('DELETE FROM group_members');
  db.run('DELETE FROM groups');
  db.run('DELETE FROM settings');
  saveDb();
}
