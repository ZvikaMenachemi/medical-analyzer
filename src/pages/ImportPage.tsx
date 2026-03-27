/**
 * ImportPage.tsx — PDF import with drag-and-drop.
 */

import { useState, useRef, useCallback } from 'react';
import { parsePdf } from '../parsers';
import { insertSession, sessionExistsByRecord } from '../db/queries';
import { useDbStore } from '../store/dbStore';
import type { ParsedSession } from '../parsers/types';

type FileStatus = 'pending' | 'parsing' | 'ocr-needed' | 'ocr-running' | 'done' | 'duplicate' | 'error';

interface FileEntry {
  file: File;
  status: FileStatus;
  message: string;
  session?: ParsedSession;
  ocrProgress?: number;
}

export default function ImportPage() {
  const [entries, setEntries]   = useState<FileEntry[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const refreshStats = useDbStore(s => s.refreshStats);

  function updateEntry(idx: number, patch: Partial<FileEntry>) {
    setEntries(prev => prev.map((e, i) => i === idx ? { ...e, ...patch } : e));
  }

  async function runOcr(idx: number) {
    const entry = entries[idx];
    updateEntry(idx, { status: 'ocr-running', message: 'מזהה טקסט... 0%', ocrProgress: 0 });
    try {
      // Re-run parsePdf with an OCR progress callback — this time it will OCR automatically
      const session = await parsePdf(
        entry.file,
        pct => updateEntry(idx, { ocrProgress: pct, message: `זיהוי טקסט... ${pct}%` }),
      );

      if (session.record_num && sessionExistsByRecord(session.record_num)) {
        updateEntry(idx, { status: 'duplicate', message: `כבר קיים (${session.record_num})`, session });
        return;
      }
      insertSession(session);
      refreshStats();
      updateEntry(idx, {
        status: 'done',
        message: `יובא (OCR) — ${session.results.length} בדיקות, ${session.date}`,
        session,
      });
    } catch (e) {
      updateEntry(idx, { status: 'error', message: `שגיאת OCR: ${String(e)}` });
    }
  }

  async function processFile(file: File, idx: number) {
    updateEntry(idx, { status: 'parsing', message: 'מנתח...' });
    try {
      // Always pass an OCR progress callback so vector-path PDFs are OCR'd automatically
      const session = await parsePdf(
        file,
        pct => updateEntry(idx, { status: 'ocr-running', ocrProgress: pct, message: `זיהוי טקסט... ${pct}%` }),
      );

      // Check for duplicate by record_num
      if (session.record_num && sessionExistsByRecord(session.record_num)) {
        updateEntry(idx, {
          status: 'duplicate',
          message: `כבר קיים (מספר רישום: ${session.record_num})`,
          session,
        });
        return;
      }

      insertSession(session);
      refreshStats();

      const conf = session.parse_confidence === 'low' ? ' ⚠ ודא שהתוצאות נכונות (ביטחון נמוך)' : '';
      updateEntry(idx, {
        status: 'done',
        message: `יובא בהצלחה — ${session.results.length} בדיקות, ${session.date}${conf}`,
        session,
      });
    } catch (e) {
      updateEntry(idx, { status: 'error', message: `שגיאה: ${String(e)}` });
    }
  }

  async function addFiles(files: FileList | File[]) {
    const pdfs = [...files].filter(f => f.name.toLowerCase().endsWith('.pdf'));
    if (pdfs.length === 0) return;

    const startIdx = entries.length;
    const newEntries: FileEntry[] = pdfs.map(f => ({
      file: f, status: 'pending', message: 'ממתין...',
    }));
    setEntries(prev => [...prev, ...newEntries]);

    // Process sequentially to avoid overwhelming WASM
    for (let i = 0; i < pdfs.length; i++) {
      await processFile(pdfs[i], startIdx + i);
    }
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  }, [entries.length]);

  const statusIcon: Record<FileStatus, string> = {
    pending:     '⏳',
    parsing:     '🔄',
    'ocr-needed':  '🔍',
    'ocr-running': '🔄',
    done:        '✅',
    duplicate:   '⚠️',
    error:       '❌',
  };

  const statusColor: Record<FileStatus, string> = {
    pending:     'var(--gray-md)',
    parsing:     'var(--blue)',
    'ocr-needed':  '#e67e22',
    'ocr-running': 'var(--blue)',
    done:        'var(--green)',
    duplicate:   '#e67e22',
    error:       'var(--red)',
  };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, color: 'var(--blue)', marginBottom: 20 }}>ייבוא קבצי PDF</h1>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? 'var(--blue)' : 'var(--border)'}`,
          borderRadius: 12,
          background: dragging ? 'var(--blue-lt)' : 'white',
          padding: '48px 24px',
          textAlign: 'center',
          cursor: 'pointer',
          marginBottom: 24,
          transition: 'all .2s',
        }}
      >
        <div style={{ fontSize: 48, marginBottom: 12 }}>📄</div>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--gray-dk)', marginBottom: 8 }}>
          גרור קבצי PDF לכאן
        </div>
        <div style={{ fontSize: 13, color: 'var(--gray-md)' }}>
          או לחץ לבחירת קבצים
        </div>
        <div style={{ fontSize: 12, color: 'var(--gray-md)', marginTop: 8 }}>
          תומך בפורמטים של הדסה, מכבי, ודוחות הדמיה
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf"
          multiple
          style={{ display: 'none' }}
          onChange={e => e.target.files && addFiles(e.target.files)}
        />
      </div>

      {/* File list */}
      {entries.length > 0 && (
        <div style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '12px 16px', borderBottom: '1px solid var(--border)',
          }}>
            <span style={{ fontWeight: 600, color: 'var(--blue)' }}>
              קבצים ({entries.length})
            </span>
            <button
              style={{ background: 'none', border: 'none', color: 'var(--gray-md)', cursor: 'pointer', fontSize: 12 }}
              onClick={() => setEntries([])}
            >
              נקה רשימה
            </button>
          </div>

          {entries.map((entry, idx) => (
            <div key={idx} style={{
              padding: '12px 16px',
              borderBottom: idx < entries.length - 1 ? '1px solid var(--border)' : 'none',
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
            }}>
              <span style={{ fontSize: 18, flexShrink: 0 }}>{statusIcon[entry.status]}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, marginBottom: 2, wordBreak: 'break-all' }}>
                  {entry.file.name}
                </div>
                <div style={{ fontSize: 12, color: statusColor[entry.status] }}>
                  {entry.message}
                </div>
                {entry.status === 'ocr-needed' && (
                  <button
                    onClick={() => runOcr(idx)}
                    style={{
                      marginTop: 8, padding: '6px 14px',
                      background: 'var(--blue)', color: 'white', border: 'none',
                      borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13,
                    }}
                  >
                    זהה טקסט (OCR)
                  </button>
                )}
                {entry.status === 'ocr-running' && (
                  <div style={{ marginTop: 6, fontSize: 12, color: 'var(--blue)' }}>
                    <div style={{ height: 4, background: 'var(--gray-lt)', borderRadius: 2, overflow: 'hidden', marginTop: 4 }}>
                      <div style={{ width: `${entry.ocrProgress ?? 0}%`, height: '100%', background: 'var(--blue)', transition: 'width .3s' }} />
                    </div>
                  </div>
                )}
                {entry.session && entry.session.parse_confidence === 'low' && (
                  <div style={{
                    marginTop: 6, padding: '6px 10px',
                    background: '#fff3cd', border: '1px solid #ffc107',
                    borderRadius: 4, fontSize: 12,
                  }}>
                    ⚠️ הפורמט לא זוהה בוודאות גבוהה — אנא בדוק שהתוצאות יובאו נכון
                  </div>
                )}
              </div>
              {entry.session && (
                <div style={{ fontSize: 11, color: 'var(--gray-md)', textAlign: 'left', flexShrink: 0 }}>
                  {entry.session.lab_source}<br />
                  {entry.session.material}
                </div>
              )}
            </div>
          ))}

          {/* Summary */}
          {entries.every(e => e.status !== 'parsing' && e.status !== 'pending') && (
            <div style={{ padding: '12px 16px', background: 'var(--gray-lt)', fontSize: 13 }}>
              {entries.filter(e => e.status === 'done').length} יובאו ·{' '}
              {entries.filter(e => e.status === 'duplicate').length} כפולים ·{' '}
              {entries.filter(e => e.status === 'error').length} שגיאות
            </div>
          )}
        </div>
      )}
    </div>
  );
}
