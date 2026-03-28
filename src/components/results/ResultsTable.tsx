import type { Result } from '../../db/queries';
import StatusBadge from '../common/StatusBadge';

interface Props {
  results: Result[];
}

function formatValue(r: Result): string {
  if (!r.is_numeric) return r.value_text ?? '';
  if (r.value_num === null) return '';
  return r.is_less_than ? `< ${r.value_num}` : String(r.value_num);
}

export default function ResultsTable({ results }: Props) {
  if (results.length === 0) {
    return <div className="empty-state">אין תוצאות בסינון הנוכחי</div>;
  }

  return (
    <div className="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>תאריך</th>
            <th>שם בדיקה</th>
            <th>קטגוריה</th>
            <th>ערך</th>
            <th>יחידות</th>
            <th>טווח נורמה</th>
            <th>חומר</th>
            <th>מקור</th>
            <th>סטטוס</th>
          </tr>
        </thead>
        <tbody>
          {results.map(r => (
            <tr key={r.id} className={r.is_abnormal === 1 ? 'abnormal' : ''}>
              <td style={{ whiteSpace: 'nowrap' }}>{r.date}</td>
              <td style={{ fontWeight: 600 }}>{r.test_name}</td>
              <td style={{ color: 'var(--gray-md)' }}>{r.category ?? ''}</td>
              <td style={{ fontWeight: 600, color: r.is_abnormal === 1 ? 'var(--red)' : 'inherit' }}>
                {formatValue(r)}
              </td>
              <td style={{ color: 'var(--gray-md)' }}>{r.unit}</td>
              <td style={{ color: 'var(--gray-md)', fontSize: 12 }} dir="ltr">{r.range_display}</td>
              <td>{r.material ?? ''}</td>
              <td style={{ color: 'var(--gray-md)', fontSize: 12 }}>{r.lab_source ?? ''}</td>
              <td><StatusBadge isAbnormal={r.is_abnormal ?? null} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
