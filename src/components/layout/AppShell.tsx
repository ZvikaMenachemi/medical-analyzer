import { NavLink, Outlet } from 'react-router-dom';

const NAV_ITEMS = [
  { to: '/import',    label: 'ייבוא',     icon: '📄' },
  { to: '/results',   label: 'תוצאות',    icon: '📋' },
  { to: '/graphs',    label: 'גרפים',     icon: '📈' },
  { to: '/dashboard', label: 'לוח מחוונים', icon: '🔢' },
  { to: '/groups',    label: 'קבוצות',    icon: '🗂️' },
  { to: '/settings',  label: 'הגדרות',    icon: '⚙️' },
];

export default function AppShell() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {/* ── Header ──────────────────────────────────────── */}
      <header style={{
        background: 'var(--blue)', color: 'white',
        padding: '0 20px', height: 52,
        display: 'flex', alignItems: 'center',
        boxShadow: '0 2px 6px rgba(0,0,0,.18)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>🩺 מנתח בדיקות</span>

          {/* Desktop nav */}
          <nav style={{ display: 'flex', gap: 4 }} className="desktop-nav">
            {NAV_ITEMS.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                style={({ isActive }) => ({
                  color: isActive ? 'white' : 'rgba(255,255,255,.85)',
                  textDecoration: 'none',
                  padding: '4px 10px',
                  borderRadius: 4,
                  fontSize: 13,
                  background: isActive ? 'rgba(255,255,255,.2)' : 'transparent',
                  transition: 'background .15s',
                })}
              >
                {item.icon} {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      {/* ── Page content ────────────────────────────────── */}
      <main style={{ flex: 1, padding: 20, paddingBottom: 70 }}>
        <Outlet />
      </main>

      {/* ── Mobile bottom tab bar ────────────────────────── */}
      <nav style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        background: 'white',
        borderTop: '1px solid var(--border)',
        display: 'flex',
        boxShadow: '0 -2px 8px rgba(0,0,0,.08)',
        zIndex: 100,
      }} className="mobile-nav">
        {NAV_ITEMS.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            style={({ isActive }) => ({
              flex: 1,
              display: 'flex',
              flexDirection: 'column' as const,
              alignItems: 'center',
              justifyContent: 'center',
              padding: '6px 2px',
              textDecoration: 'none',
              fontSize: 10,
              color: isActive ? 'var(--blue)' : 'var(--gray-md)',
              fontWeight: isActive ? 700 : 400,
              gap: 2,
            })}
          >
            <span style={{ fontSize: 18 }}>{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>

      <style>{`
        @media (min-width: 768px) {
          .mobile-nav { display: none !important; }
          main { padding-bottom: 20px; }
        }
        @media (max-width: 767px) {
          .desktop-nav { display: none !important; }
        }
      `}</style>
    </div>
  );
}
