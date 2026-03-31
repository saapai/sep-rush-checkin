import { useState, useEffect } from 'react';
import Airtable from 'airtable';
import Slideshow from '../components/Slideshow';
import './Dashboard.css';

const base = new Airtable({
  apiKey: import.meta.env.VITE_AIRTABLE_API_KEY
}).base(import.meta.env.VITE_AIRTABLE_BASE_ID);

const TABLE = "Rush Spring '26";
const PASSCODE = 'quinnanish';
const ADMIN_PASSCODE = 'quinnanishadmin';

interface Applicant {
  id: string;
  name: string;
  email: string;
  year: number | null;
  photo: string;
  status: string;
  day_1: boolean;
  day_2: boolean;
  day_3: boolean;
  day_4: boolean;
  day_5: boolean;
  elo: number;
  notes: string;
  notesSummary: string;
  pm_notes: string;
  social: number;
  prof: number;
  weight: number;
}

interface DashboardProps {
  navigate: (path: string) => void;
}

const Dashboard: React.FC<DashboardProps> = ({ navigate }) => {
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [passError, setPassError] = useState(false);
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState('name-asc');
  const [showSlideshow, setShowSlideshow] = useState(false);
  const [slideshowStartIndex, setSlideshowStartIndex] = useState(0);
  const [showPresentModal, setShowPresentModal] = useState(false);
  const [slideStatuses, setSlideStatuses] = useState<string[]>([]);
  const [slideDays, setSlideDays] = useState<number[]>([]);
  const [slideDayMode, setSlideDayMode] = useState<'any' | 'all'>('any');

  const isAdmin = sessionStorage.getItem('dash_auth') === 'admin';

  useEffect(() => {
    const auth = sessionStorage.getItem('dash_auth');
    if (auth === '1' || auth === 'admin') setAuthenticated(true);
  }, []);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === ADMIN_PASSCODE) {
      setAuthenticated(true);
      sessionStorage.setItem('dash_auth', 'admin');
    } else if (password === PASSCODE) {
      setAuthenticated(true);
      sessionStorage.setItem('dash_auth', '1');
    } else {
      setPassError(true);
      setTimeout(() => setPassError(false), 1500);
    }
  };

  const fetchApplicants = async () => {
    setLoading(true);
    try {
      const records = await base(TABLE).select({ maxRecords: 1000 }).all();
      const data: Applicant[] = records
        .map(r => ({
          id: r.id,
          name: (r.get('applicant_name') as string) || '',
          email: (r.get('email') as string) || '',
          year: (r.get('year') as number) || null,
          photo: (r.get('photo') as string) || '',
          status: (r.get('status') as string) || '',
          day_1: !!r.get('day_1'),
          day_2: !!r.get('day_2'),
          day_3: !!r.get('day_3'),
          day_4: !!r.get('day_4'),
          day_5: !!r.get('day_5'),
          elo: (r.get('elo') as number) || 0,
          notes: (r.get('notes') as string) || '',
          notesSummary: (r.get('notes_summary') as string) || '',
          pm_notes: (r.get('pm_notes') as string) || '',
          social: (r.get('social') as number) || 0,
          prof: (r.get('prof') as number) || 0,
          weight: (r.get('weight') as number) || 0,
        }))
        .filter(a => a.name.trim() !== '')
        .sort((a, b) => a.name.localeCompare(b.name));
      setApplicants(data);
    } catch (error) {
      console.error('Error fetching applicants:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (authenticated) fetchApplicants();
  }, [authenticated]);

  const getAttendanceCount = (a: Applicant) => [a.day_1, a.day_2, a.day_3, a.day_4, a.day_5].filter(Boolean).length;

  const filtered = applicants
    .filter(a => {
      const q = searchQuery.toLowerCase();
      const matchesSearch = a.name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q);
      const matchesStatus = statusFilter === 'all' || a.status.toLowerCase() === statusFilter.toLowerCase();
      return matchesSearch && matchesStatus;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'name-asc': return a.name.localeCompare(b.name);
        case 'name-desc': return b.name.localeCompare(a.name);
        case 'year-asc': return (a.year || 9999) - (b.year || 9999);
        case 'year-desc': return (b.year || 0) - (a.year || 0);
        case 'elo-desc': return b.elo - a.elo;
        case 'elo-asc': return a.elo - b.elo;
        default: return 0;
      }
    });

  const statuses = [...new Set(applicants.map(a => a.status).filter(Boolean))];

  const slideshowApplicants = filtered.filter(a => {
    if (slideStatuses.length > 0 && !slideStatuses.includes(a.status)) return false;
    if (slideDays.length > 0) {
      const dayMap: Record<number, boolean> = { 1: a.day_1, 2: a.day_2, 3: a.day_3, 4: a.day_4, 5: a.day_5 };
      const attended = slideDays.map(d => dayMap[d]);
      if (slideDayMode === 'any' ? !attended.some(Boolean) : !attended.every(Boolean)) return false;
    }
    return true;
  });

  const toggleSlideStatus = (s: string) =>
    setSlideStatuses(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);

  const toggleSlideDay = (d: number) =>
    setSlideDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]);

  if (!authenticated) {
    return (
      <div className="login-page">
        <form onSubmit={handleLogin} className="login-card">
          <h1 className="login-title">Rush Dashboard</h1>
          <p className="login-subtitle">Enter passcode to continue</p>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Passcode"
            className={`login-input ${passError ? 'login-error' : ''}`}
            autoFocus
          />
          <button type="submit" className="login-button">Enter</button>
        </form>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="dash-page">
        <div className="dash-loading">Loading...</div>
      </div>
    );
  }

  return (
    <div className="dash-page">
      {/* Header */}
      <div className="dash-header">
        <div className="dash-header-top">
          <h1 className="dash-title">Rush Dashboard</h1>
          <a href="/" className="dash-nav-link">Check-In</a>
        </div>
        <div className="dash-stats">
          {[
            { label: 'Total', value: applicants.length },
            { label: 'Photos', value: applicants.filter(a => a.photo).length },
            { label: 'D1', value: applicants.filter(a => a.day_1).length },
            { label: 'D2', value: applicants.filter(a => a.day_2).length },
            { label: 'D3', value: applicants.filter(a => a.day_3).length },
            { label: 'D4', value: applicants.filter(a => a.day_4).length },
            { label: 'D5', value: applicants.filter(a => a.day_5).length },
          ].map(s => (
            <div key={s.label} className="dash-stat">
              <span className="dash-stat-value">{s.value}</span>
              <span className="dash-stat-label">{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Controls */}
      <div className="dash-controls">
        <input
          type="text"
          className="dash-search"
          placeholder="Search by name or email..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <select className="dash-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All Statuses</option>
          {statuses.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="dash-filter" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
          <option value="name-asc">Name A-Z</option>
          <option value="name-desc">Name Z-A</option>
          <option value="year-asc">Year (Oldest)</option>
          <option value="year-desc">Year (Newest)</option>
          {isAdmin && <option value="elo-desc">Elo (Highest)</option>}
          {isAdmin && <option value="elo-asc">Elo (Lowest)</option>}
        </select>
        <button className="dash-refresh" onClick={fetchApplicants}>Refresh</button>
        {isAdmin && (
          <button
            className="dash-present"
            onClick={() => setShowPresentModal(true)}
            disabled={filtered.length === 0}
          >
            Present
          </button>
        )}
      </div>

      {/* Card grid */}
      <div className="card-grid">
        {filtered.map((a, idx) => (
          <div key={a.id} className="applicant-card" onClick={() => {
            sessionStorage.setItem('dash_nav_ids', JSON.stringify(filtered.map(x => x.id)));
            sessionStorage.setItem('dash_nav_idx', String(idx));
            navigate(`/applicant/${a.id}`);
          }}>
            <div className="card-photo-wrap">
              {a.photo ? (
                <img src={a.photo} alt={a.name} className="card-photo" loading="lazy" />
              ) : (
                <div className="card-no-photo">
                  <span>{a.name.charAt(0).toUpperCase()}</span>
                </div>
              )}
              <div className="card-attendance-dots">
                {[a.day_1, a.day_2, a.day_3, a.day_4, a.day_5].map((d, i) => (
                  <div key={i} className={`att-dot ${d ? 'att-present' : ''}`} />
                ))}
              </div>
              {a.status && (
                <span className={`card-status-pill ${a.status.toLowerCase().replace(/\s+/g, '-')}`}>
                  {a.status}
                </span>
              )}
            </div>
            <div className="card-info">
              <div className="card-name">{a.name}</div>
              <div className="card-meta">{a.year || '—'} · {getAttendanceCount(a)}/5 days</div>
            </div>
          </div>
        ))}
      </div>

      {filtered.length === 0 && <div className="dash-empty">No applicants found.</div>}

      {showPresentModal && (
        <div className="present-modal-overlay" onClick={() => setShowPresentModal(false)}>
          <div className="present-modal" onClick={e => e.stopPropagation()}>
            <h2 className="present-modal-title">Presentation Filters</h2>

            <div className="present-modal-section">
              <div className="present-modal-label">Status</div>
              <div className="present-modal-chips">
                {statuses.map(s => (
                  <button
                    key={s}
                    className={`present-chip ${slideStatuses.includes(s) ? 'active' : ''}`}
                    onClick={() => toggleSlideStatus(s)}
                  >
                    {s}
                  </button>
                ))}
                {slideStatuses.length > 0 && (
                  <button className="present-chip-clear" onClick={() => setSlideStatuses([])}>
                    Clear
                  </button>
                )}
              </div>
              {slideStatuses.length === 0 && <p className="present-modal-hint">All statuses included</p>}
            </div>

            <div className="present-modal-section">
              <div className="present-modal-label-row">
                <div className="present-modal-label">Attendance</div>
                {slideDays.length > 0 && (
                  <div className="present-day-mode">
                    <button
                      className={`present-mode-btn ${slideDayMode === 'any' ? 'active' : ''}`}
                      onClick={() => setSlideDayMode('any')}
                    >
                      Any
                    </button>
                    <button
                      className={`present-mode-btn ${slideDayMode === 'all' ? 'active' : ''}`}
                      onClick={() => setSlideDayMode('all')}
                    >
                      All
                    </button>
                  </div>
                )}
              </div>
              <div className="present-modal-chips">
                {[1, 2, 3, 4, 5].map(d => (
                  <button
                    key={d}
                    className={`present-chip ${slideDays.includes(d) ? 'active' : ''}`}
                    onClick={() => toggleSlideDay(d)}
                  >
                    Day {d}
                  </button>
                ))}
                {slideDays.length > 0 && (
                  <button className="present-chip-clear" onClick={() => setSlideDays([])}>
                    Clear
                  </button>
                )}
              </div>
              {slideDays.length === 0 && <p className="present-modal-hint">All attendance included</p>}
              {slideDays.length > 0 && (
                <p className="present-modal-hint">
                  Attended <strong>{slideDayMode === 'any' ? 'any' : 'all'}</strong> of the selected days
                </p>
              )}
            </div>

            <div className="present-modal-footer">
              <span className="present-modal-count">
                {slideshowApplicants.length} applicant{slideshowApplicants.length !== 1 ? 's' : ''}
              </span>
              <div className="present-modal-actions">
                <button className="present-modal-cancel" onClick={() => setShowPresentModal(false)}>
                  Cancel
                </button>
                <button
                  className="present-modal-start"
                  disabled={slideshowApplicants.length === 0}
                  onClick={() => { setShowPresentModal(false); setSlideshowStartIndex(0); setShowSlideshow(true); }}
                >
                  Start &rarr;
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showSlideshow && slideshowApplicants.length > 0 && (
        <Slideshow
          applicants={slideshowApplicants}
          startIndex={slideshowStartIndex}
          onClose={() => setShowSlideshow(false)}
          isAdmin={isAdmin}
          navigate={navigate}
        />
      )}
    </div>
  );
};

export default Dashboard;
