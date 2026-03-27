import { useRef } from 'react';
import { getStats, exportAllData, importAllData, clearAllData } from '../db/queries';
import { useDbStore } from '../store/dbStore';

export default function SettingsPage() {
  const refreshStats = useDbStore(s => s.refreshStats);
  const importRef = useRef<HTMLInputElement>(null);

  function exportJson() {
    const data = exportAllData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `medtracker_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportCsv() {
    const { results } = exportAllData();
    const headers = ['date','test_name','value_num','value_text','unit','range_min','range_max','is_abnormal','material','lab_source'];
    const rows = results.map(r => [
      (r as { date?: string }).date ?? '',
      r.test_name, r.value_num ?? '', r.value_text ?? '',
      r.unit, r.range_min ?? '', r.range_max ?? '',
      r.is_abnormal ?? '', (r as { material?: string }).material ?? '',
      (r as { lab_source?: string }).lab_source ?? '',
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));

    const csv  = [headers.join(','), ...rows].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `medtracker_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function doImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const backup = JSON.parse(reader.result as string);
        if (!backup.sessions || !backup.results) {
          alert('קובץ גיבוי לא תקין');
          return;
        }
        const count = await importAllData(backup);
        refreshStats();
        alert(`שוחזרו ${count} סשנים בהצלחה`);
      } catch {
        alert('שגיאה בקריאת קובץ הגיבוי');
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  }

  function doClear() {
    if (!confirm('האם למחוק את כל הנתונים? פעולה זו אינה הפיכה.')) return;
    clearAllData();
    refreshStats();
  }

  const s = getStats();

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, color: 'var(--blue)', marginBottom: 24 }}>הגדרות</h1>

      {/* Stats */}
      <div style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 8, padding: 20, marginBottom: 20 }}>
        <h3 style={{ fontSize: 15, color: 'var(--blue)', marginBottom: 14 }}>סטטיסטיקות</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {[
            ['בדיקות', s.sessions],
            ['תוצאות', s.results],
            ['חריגים', s.abnormal],
          ].map(([label, val]) => (
            <div key={label} style={{ textAlign: 'center', padding: 12, background: 'var(--gray-lt)', borderRadius: 6 }}>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{val}</div>
              <div style={{ fontSize: 12, color: 'var(--gray-md)' }}>{label}</div>
            </div>
          ))}
        </div>
        {s.earliest && (
          <div style={{ fontSize: 12, color: 'var(--gray-md)', marginTop: 12, textAlign: 'center' }}>
            טווח: {s.earliest} עד {s.latest}
          </div>
        )}
      </div>

      {/* Export */}
      <div style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 8, padding: 20, marginBottom: 20 }}>
        <h3 style={{ fontSize: 15, color: 'var(--blue)', marginBottom: 14 }}>יצוא נתונים</h3>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn-primary" style={{ width: 'auto', flex: 1 }} onClick={exportJson}>
            📦 גיבוי JSON
          </button>
          <button className="btn-secondary" style={{ width: 'auto', flex: 1 }} onClick={() => importRef.current?.click()}>
            📂 שחזור מגיבוי
          </button>
          <button className="btn-secondary" style={{ width: 'auto', flex: 1 }} onClick={exportCsv}>
            📊 יצוא CSV
          </button>
        </div>
        <input
          ref={importRef}
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={doImport}
        />
        <div style={{ fontSize: 12, color: 'var(--gray-md)', marginTop: 10 }}>
          גיבוי JSON מכיל את כל הנתונים. שחזור יחליף את הנתונים הקיימים.
        </div>
      </div>

      {/* Clear data */}
      <div style={{ background: 'white', border: '1px solid var(--red-lt)', borderRadius: 8, padding: 20 }}>
        <h3 style={{ fontSize: 15, color: 'var(--red)', marginBottom: 14 }}>אזור מסוכן</h3>
        <button
          onClick={doClear}
          style={{
            background: 'var(--red)', color: 'white', border: 'none',
            borderRadius: 6, padding: '8px 16px', cursor: 'pointer', fontWeight: 600,
          }}
        >
          מחק את כל הנתונים
        </button>
        <div style={{ fontSize: 12, color: 'var(--gray-md)', marginTop: 8 }}>
          פעולה זו תמחק את כל הבדיקות והתוצאות שנשמרו. לא ניתן לשחזר.
        </div>
      </div>

      {/* About */}
      <div style={{ textAlign: 'center', marginTop: 32, color: 'var(--gray-md)', fontSize: 12 }}>
        מנתח בדיקות v1.0 · כל הנתונים נשמרים באופן מקומי במכשיר בלבד
      </div>
    </div>
  );
}
