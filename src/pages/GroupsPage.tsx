import { useState, useEffect } from 'react';
import { getGroups, createGroup, updateGroup, deleteGroup, getAllTestNames } from '../db/queries';
import type { Group } from '../db/queries';

export default function GroupsPage() {
  const [groups, setGroups]     = useState<Group[]>([]);
  const [allTests, setAllTests] = useState<string[]>([]);
  const [editing, setEditing]   = useState<Group | null>(null);
  const [newName, setNewName]   = useState('');
  const [newTests, setNewTests] = useState<string[]>([]);
  const [searchQ, setSearchQ]   = useState('');

  function reload() {
    setGroups(getGroups());
    setAllTests(getAllTestNames());
  }

  useEffect(() => { reload(); }, []);

  function startNew() {
    setEditing({ id: 0, name: '', tests: [] });
    setNewName('');
    setNewTests([]);
    setSearchQ('');
  }

  function startEdit(g: Group) {
    setEditing(g);
    setNewName(g.name);
    setNewTests([...g.tests]);
    setSearchQ('');
  }

  function save() {
    if (!newName.trim()) return;
    if (editing!.id === 0) {
      createGroup(newName.trim(), newTests);
    } else {
      updateGroup(editing!.id, newName.trim(), newTests);
    }
    setEditing(null);
    reload();
  }

  function remove(g: Group) {
    if (!confirm(`מחק את הקבוצה "${g.name}"?`)) return;
    deleteGroup(g.id);
    reload();
  }

  function toggleTestInNew(name: string) {
    setNewTests(prev =>
      prev.includes(name) ? prev.filter(t => t !== name) : [...prev, name]
    );
  }

  const visibleTests = allTests.filter(t =>
    !searchQ || t.toLowerCase().includes(searchQ.toLowerCase())
  );

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, color: 'var(--blue)' }}>קבוצות בדיקה מותאמות</h1>
        <button className="btn-primary" style={{ width: 'auto', padding: '8px 16px' }} onClick={startNew}>
          + קבוצה חדשה
        </button>
      </div>

      {/* Edit form */}
      {editing && (
        <div style={{
          background: 'white', border: '1px solid var(--blue)',
          borderRadius: 8, padding: 20, marginBottom: 20,
        }}>
          <h3 style={{ fontSize: 15, color: 'var(--blue)', marginBottom: 14 }}>
            {editing.id === 0 ? 'קבוצה חדשה' : `עריכת: ${editing.name}`}
          </h3>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--gray-md)', marginBottom: 5 }}>
              שם קבוצה
            </label>
            <input
              type="text" value={newName} onChange={e => setNewName(e.target.value)}
              style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 5, padding: '7px 10px', fontSize: 14 }}
              placeholder="שם..."
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--gray-md)', marginBottom: 5 }}>
              בדיקות ({newTests.length} נבחרו)
            </label>
            <input
              type="text" placeholder="חיפוש..." value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
              style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 5, padding: '5px 8px', fontSize: 13, marginBottom: 6 }}
            />
            <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 5, padding: '4px 8px' }}>
              {visibleTests.map(name => (
                <label key={name} style={{ display: 'flex', gap: 8, padding: '3px 0', cursor: 'pointer', fontSize: 13 }}>
                  <input type="checkbox" checked={newTests.includes(name)} onChange={() => toggleTestInNew(name)} />
                  {name}
                </label>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button className="btn-primary" style={{ width: 'auto', flex: 1 }} onClick={save}>שמור</button>
            <button className="btn-secondary" style={{ width: 'auto', flex: 1 }} onClick={() => setEditing(null)}>ביטול</button>
          </div>
        </div>
      )}

      {/* Groups list */}
      {groups.length === 0 && !editing ? (
        <div className="empty-state">לא נוצרו קבוצות עדיין</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {groups.map(g => (
            <div key={g.id} style={{
              background: 'white', border: '1px solid var(--border)',
              borderRadius: 8, padding: '14px 16px',
              display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
            }}>
              <div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>{g.name}</div>
                <div style={{ fontSize: 12, color: 'var(--gray-md)' }}>
                  {g.tests.length} בדיקות: {g.tests.slice(0, 5).join(', ')}{g.tests.length > 5 ? '...' : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => startEdit(g)}
                  style={{ background: 'var(--blue-lt)', border: 'none', borderRadius: 5, padding: '5px 12px', cursor: 'pointer', color: 'var(--blue)', fontSize: 12 }}>
                  עריכה
                </button>
                <button onClick={() => remove(g)}
                  style={{ background: 'var(--red-lt)', border: 'none', borderRadius: 5, padding: '5px 12px', cursor: 'pointer', color: 'var(--red)', fontSize: 12 }}>
                  מחיקה
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
