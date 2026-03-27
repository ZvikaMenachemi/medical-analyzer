import { useState, useEffect } from 'react';
import { getDashboardData, getAllTestNames } from '../db/queries';
import type { DashboardEntry } from '../db/queries';
import StatCard from '../components/dashboard/StatCard';

export default function DashboardPage() {
  const [entries, setEntries]       = useState<DashboardEntry[]>([]);
  const [allTests, setAllTests]     = useState<string[]>([]);
  const [pinned, setPinned]         = useState<string[]>([]);
  const [searchQ, setSearchQ]       = useState('');

  useEffect(() => {
    const tests = getAllTestNames();
    setAllTests(tests);
    // Default: show first 20 tests
    const initial = tests.slice(0, 20);
    setPinned(initial);
    setEntries(getDashboardData(initial));
  }, []);

  function toggleTest(name: string) {
    const next = pinned.includes(name)
      ? pinned.filter(t => t !== name)
      : [...pinned, name];
    setPinned(next);
    setEntries(getDashboardData(next));
  }

  const visibleTests = allTests.filter(t =>
    !searchQ || t.toLowerCase().includes(searchQ.toLowerCase())
  );

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 20, alignItems: 'start' }}>

      {/* Test selector */}
      <div style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 8, padding: 14, position: 'sticky', top: 16 }}>
        <h3 style={{ fontSize: 13, color: 'var(--blue)', marginBottom: 10 }}>בחר בדיקות</h3>
        <input
          type="text" placeholder="חיפוש..." value={searchQ}
          onChange={e => setSearchQ(e.target.value)}
          className="filter-group"
          style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 5, padding: '5px 8px', fontSize: 12, marginBottom: 8 }}
        />
        <div style={{ maxHeight: 400, overflowY: 'auto', fontSize: 12 }}>
          {visibleTests.map(name => (
            <label key={name} style={{ display: 'flex', gap: 6, padding: '3px 0', cursor: 'pointer', alignItems: 'center' }}>
              <input type="checkbox" checked={pinned.includes(name)} onChange={() => toggleTest(name)} />
              {name}
            </label>
          ))}
        </div>
      </div>

      {/* Stat cards grid */}
      <div>
        <h1 style={{ fontSize: 18, color: 'var(--blue)', marginBottom: 16 }}>
          לוח מחוונים
          <span style={{ fontSize: 12, color: 'var(--gray-md)', fontWeight: 400, marginRight: 8 }}>
            ערכים אחרונים לכל בדיקה
          </span>
        </h1>
        {entries.length === 0 ? (
          <div className="empty-state">אין נתונים — ייבא קבצי PDF תחילה</div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: 12,
          }}>
            {entries.map(entry => (
              <StatCard key={entry.test_name} entry={entry} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
