import { useState, useEffect, useMemo } from 'react';
import { getAllTestNames, getGroups } from '../../db/queries';
import { useFilterStore } from '../../store/filterStore';
import { TEST_SETS, TEST_SET_LABELS } from '../../data/testSets';
import type { Group } from '../../db/queries';

interface Props {
  onApply?: () => void;
  /** In single-select mode (graphs), clicking a test name replaces the selection */
  singleSelect?: boolean;
}

export default function FilterPanel({ onApply, singleSelect }: Props) {
  const {
    selectedTests, dateFrom, dateTo, materials, abnormalOnly,
    setSelectedTests, setDateFrom, setDateTo, setMaterials,
    setAbnormalOnly, clearFilters,
  } = useFilterStore();

  const [allTests, setAllTests]   = useState<string[]>([]);
  const [groups, setGroups]       = useState<Group[]>([]);
  const [searchQ, setSearchQ]     = useState('');
  const [activeSet, setActiveSet] = useState('');

  useEffect(() => {
    setAllTests(getAllTestNames());
    setGroups(getGroups());
  }, []);

  const visibleTests = useMemo(() =>
    allTests.filter(t => !searchQ || t.toLowerCase().includes(searchQ.toLowerCase())),
    [allTests, searchQ]
  );

  function setQuickDate(period: string) {
    const today = new Date();
    if (period === 'all') { setDateFrom(''); setDateTo(''); return; }
    const from = new Date(today);
    if (period === '3m')   from.setMonth(from.getMonth() - 3);
    if (period === '1y')   from.setFullYear(from.getFullYear() - 1);
    if (period === '6m')   from.setMonth(from.getMonth() - 6);
    setDateFrom(from.toISOString().slice(0, 10));
    setDateTo(today.toISOString().slice(0, 10));
  }

  function selectSet(key: string, tests: string[] | null) {
    setActiveSet(activeSet === key ? '' : key);
    if (activeSet === key) { setSelectedTests([]); return; }
    if (tests === null) {
      // urine — select all urine-relevant tests (case-insensitive)
      const urineNames = new Set(['protein','total protein (24h)','potassium','sodium']);
      setSelectedTests(allTests.filter(t => urineNames.has(t.toLowerCase())));
      setMaterials(['שתן']);
    } else {
      // Match test-set names against DB names case-insensitively so e.g.
      // "PH" in testSets.ts matches "pH" or "ph" stored in the database
      const setLower = new Set(tests.map(t => t.toLowerCase()));
      setSelectedTests(allTests.filter(t => setLower.has(t.toLowerCase())));
      setMaterials(['דם', 'דם ורידי']);
    }
    setSearchQ('');
  }

  function toggleTest(name: string) {
    setActiveSet('');
    if (singleSelect) {
      // In graphs mode: click a test → show only that test (or deselect if same)
      setSelectedTests(
        selectedTests.length === 1 && selectedTests[0] === name ? [] : [name]
      );
    } else {
      setSelectedTests(
        selectedTests.includes(name)
          ? selectedTests.filter(t => t !== name)
          : [...selectedTests, name]
      );
    }
  }

  const matKey = materials.length === 0 ? 'all'
    : materials.includes('שתן') && !materials.includes('דם') ? 'urine'
    : 'blood';

  return (
    <div className="filters-panel" style={{ position: 'sticky', top: 16 }}>
      <h2 style={{ fontSize: 15, color: 'var(--blue)', marginBottom: 14, paddingBottom: 8, borderBottom: '2px solid var(--blue-lt)' }}>
        סינון
      </h2>

      {/* Quick dates */}
      <div className="filter-group">
        <label>תקופה</label>
        <div className="quick-dates" style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {[['3m','3 חודשים'],['6m','6 חודשים'],['1y','שנה'],['all','הכל']].map(([p, lbl]) => (
            <button key={p} className="btn-quick" onClick={() => setQuickDate(p)}>{lbl}</button>
          ))}
        </div>
      </div>

      {/* Date range */}
      <div className="filter-group">
        <label>מ-תאריך</label>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        <label style={{ marginTop: 6 }}>עד-תאריך</label>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
      </div>

      {/* Material */}
      <div className="filter-group">
        <label>חומר</label>
        <div className="material-btns">
          {[['blood','דם'],['urine','שתן'],['all','הכל']].map(([key, lbl]) => (
            <button key={key}
              className={`btn-material${matKey === key ? ' active' : ''}`}
              onClick={() => {
                if (key === 'blood') setMaterials(['דם', 'דם ורידי']);
                else if (key === 'urine') setMaterials(['שתן']);
                else setMaterials([]);
              }}>
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {/* Test sets */}
      <div className="filter-group">
        <label>קבוצות בדיקה</label>
        <div className="test-set-btns">
          {Object.entries(TEST_SETS).map(([key, tests]) => (
            <button key={key}
              className={`btn-set${activeSet === key ? ' active' : ''}`}
              onClick={() => selectSet(key, tests)}>
              {TEST_SET_LABELS[key] ?? key}
            </button>
          ))}
        </div>
      </div>

      {/* Custom groups */}
      {groups.length > 0 && (
        <div className="filter-group">
          <label>קבוצות מותאמות</label>
          <div className="test-set-btns">
            {groups.map(g => (
              <button key={g.id}
                className={`btn-set${activeSet === `g${g.id}` ? ' active' : ''}`}
                onClick={() => selectSet(`g${g.id}`, g.tests)}>
                {g.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Test name search + list */}
      <div className="filter-group">
        <label>בדיקות</label>
        <input type="text" placeholder="חיפוש..." value={searchQ}
          onChange={e => setSearchQ(e.target.value)} />
        <div className="test-name-list">
          {visibleTests.map(name => (
            <label key={name}>
              <input type="checkbox"
                checked={selectedTests.includes(name)}
                onChange={() => toggleTest(name)} />
              {name}
            </label>
          ))}
          {visibleTests.length === 0 && <span style={{ color: 'var(--gray-md)', fontSize: 12 }}>אין תוצאות</span>}
        </div>
      </div>

      {/* Abnormal only */}
      <div className="filter-group">
        <label className="checkbox-inline" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          <input type="checkbox" checked={abnormalOnly} onChange={e => setAbnormalOnly(e.target.checked)} />
          חריגים בלבד
        </label>
      </div>

      {onApply && (
        <button className="btn-primary" onClick={onApply}>הצג</button>
      )}
      <button className="btn-secondary" onClick={() => { clearFilters(); setSearchQ(''); setActiveSet(''); }}>
        נקה סינון
      </button>
    </div>
  );
}
