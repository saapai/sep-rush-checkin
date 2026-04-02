import { useState, useEffect } from 'react';
import Airtable from 'airtable';
import Slideshow from '../components/Slideshow';
import { getClassLabel } from '../utils/classYear';
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
  major?: string;
  essay_1?: string;
  essay_2?: string;
  essay_3?: string;
  gender?: string;
  createdAt?: string;
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
  const [statusFilter, setStatusFilter] = useState('applied');
  const [dayFilter, setDayFilter] = useState('all');
  const [sortBy, setSortBy] = useState('name-asc');
  const [showSlideshow, setShowSlideshow] = useState(false);
  const [slideshowStartIndex, setSlideshowStartIndex] = useState(0);
  const [presentNames, setPresentNames] = useState<string[]>([]);
  const [appliedNames, setAppliedNames] = useState<string[]>([]);
  const [showBulkRejectModal, setShowBulkRejectModal] = useState(false);
  const [bulkRejectText, setBulkRejectText] = useState('');
  const [bulkRejectRunning, setBulkRejectRunning] = useState(false);
  const [bulkRejectResult, setBulkRejectResult] = useState<{ rejected: string[], keepUnmatched: string[], alreadyRejected: number } | null>(null);

  const isAdmin = sessionStorage.getItem('dash_auth') === 'admin';

  // Restore presentation session
  useEffect(() => {
    const session = sessionStorage.getItem('present_session');
    if (session) {
      try {
        const parsed = JSON.parse(session);
        if (parsed.names?.length > 0) {
          setPresentNames(parsed.names);
          const idx = parsed.currentIndex || 0;
          setSlideshowStartIndex(Math.min(idx, parsed.names.length - 1));
        }
      } catch { /* ignore */ }
    }
  }, []);

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
      const raw: Applicant[] = records
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
          major: (r.get('major') as string) || '',
          essay_1: (r.get('essay_1') as string) || '',
          essay_2: (r.get('essay_2') as string) || '',
          essay_3: (r.get('essay_3') as string) || '',
          gender: (r.get('gender') as string) || '',
          createdAt: (r.get('created_at') as string) || r._rawJson?.createdTime || '',
        }))
        .filter(a => a.name.trim() !== '');
      // Deduplicate by email — keep the record with the most data (notes, scores, photo)
      const seen = new Map<string, Applicant>();
      for (const a of raw) {
        const key = a.email ? a.email.toLowerCase() : a.id;
        const existing = seen.get(key);
        if (!existing) {
          seen.set(key, a);
        } else {
          // Keep whichever has more data
          const score = (x: Applicant) => (x.notes ? 1 : 0) + (x.photo ? 1 : 0) + x.weight + (x.day_1 ? 1 : 0) + (x.day_2 ? 1 : 0) + (x.day_3 ? 1 : 0) + (x.day_4 ? 1 : 0) + (x.day_5 ? 1 : 0);
          if (score(a) > score(existing)) seen.set(key, a);
        }
      }
      const data = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
      setApplicants(data);
    } catch (error) {
      console.error('Error fetching applicants:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchAppliedNames = async () => {
    try {
      const records = await base("Application Responses").select({
        fields: ['applicant_name'],
        maxRecords: 500,
        filterByFormula: 'AND({applicant_name} != "", YEAR(Created) = 2026)',
      }).all();
      const names = [...new Set(
        records.map(r => (r.get('applicant_name') as string) || '').filter(n => n.trim())
      )];
      setAppliedNames(names);
    } catch (e) {
      console.error('Error fetching applied names:', e);
    }
  };

  useEffect(() => {
    if (authenticated) {
      fetchApplicants();
      fetchAppliedNames();
    }
  }, [authenticated]);

  const getAttendanceCount = (a: Applicant) => [a.day_1, a.day_2, a.day_3, a.day_4, a.day_5].filter(Boolean).length;

  const filtered = applicants
    .filter(a => {
      const q = searchQuery.toLowerCase();
      const matchesSearch = a.name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q);
      const matchesStatus = statusFilter === 'all'
        ? true
        : a.status.toLowerCase() === statusFilter.toLowerCase();
      const matchesDay = dayFilter === 'all' || (a as Record<string, unknown>)[`day_${dayFilter}`] === true;
      return matchesSearch && matchesStatus && matchesDay;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'name-asc': return a.name.localeCompare(b.name);
        case 'name-desc': return b.name.localeCompare(a.name);
        case 'year-asc': return (a.year || 9999) - (b.year || 9999);
        case 'year-desc': return (b.year || 0) - (a.year || 0);
        case 'elo-desc': return b.elo - a.elo;
        case 'elo-asc': return a.elo - b.elo;
        case 'added-asc': return (a.createdAt || '').localeCompare(b.createdAt || '');
        case 'added-desc': return (b.createdAt || '').localeCompare(a.createdAt || '');
        default: return 0;
      }
    });

  const statuses = [...new Set(applicants.map(a => a.status).filter(Boolean))];

  const launchPresentation = (names: string[], appliedMode = false) => {
    setPresentNames(names);
    setSlideshowStartIndex(0);
    sessionStorage.setItem('present_session', JSON.stringify({ names, currentIndex: 0, appliedMode }));
    setShowSlideshow(true);
  };

  const handleResumePresentation = () => {
    const session = JSON.parse(sessionStorage.getItem('present_session') || '{}');
    setSlideshowStartIndex(session.currentIndex || 0);
    setShowSlideshow(true);
  };

  const handleUpdatePresentNames = (names: string[]) => {
    setPresentNames(names);
    const session = JSON.parse(sessionStorage.getItem('present_session') || '{}');
    session.names = names;
    sessionStorage.setItem('present_session', JSON.stringify(session));
  };

  const handleClearPresentation = () => {
    setPresentNames([]);
    sessionStorage.removeItem('present_session');
  };

  // Name matching helpers — ported from bulk-reject.js
  const brNormalize = (name: string) => name.toLowerCase().trim().replace(/\s+/g, ' ');
  const brVariants = (name: string): string[] => {
    const variants = [brNormalize(name)];
    const stripped = brNormalize(name.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim());
    if (stripped !== variants[0]) variants.push(stripped);
    const aliasMatch = name.match(/\(([^)]+)\)/);
    if (aliasMatch) variants.push(brNormalize(aliasMatch[1]));
    return variants;
  };
  const brBuildKeepVariants = (keepList: string[]): Set<string> => {
    const s = new Set<string>();
    for (const name of keepList) brVariants(name).forEach(v => s.add(v));
    return s;
  };
  const brIsOnKeepList = (recordName: string, keepVariants: Set<string>) =>
    brVariants(recordName).some(v => keepVariants.has(v));

  const handleBulkReject = async () => {
    const keepList = bulkRejectText.split('\n').map(n => n.trim()).filter(n => n.length > 0);
    if (keepList.length === 0) return;

    setBulkRejectRunning(true);
    setBulkRejectResult(null);

    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    const keepVariants = brBuildKeepVariants(keepList);

    const toReject = applicants.filter(a =>
      (a.status || '').toLowerCase() !== 'rejected' && !brIsOnKeepList(a.name, keepVariants)
    );
    const alreadyRejected = applicants.filter(a => (a.status || '').toLowerCase() === 'rejected').length;
    const keepUnmatched = keepList.filter(keepName => {
      const kv = new Set(brVariants(keepName));
      return !applicants.some(a => brVariants(a.name).some(v => kv.has(v)));
    });

    for (let i = 0; i < toReject.length; i += 10) {
      const batch = toReject.slice(i, i + 10).map(a => ({
        id: a.id,
        fields: { status: 'Rejected' },
      }));
      await base(TABLE).update(batch);
      await sleep(200);
    }

    setBulkRejectResult({ rejected: toReject.map(a => a.name), keepUnmatched, alreadyRejected });
    setBulkRejectRunning(false);
    fetchApplicants();
  };

  // Poll for new applications when slideshow is open in applied mode
  useEffect(() => {
    if (!showSlideshow) return;
    const session = JSON.parse(sessionStorage.getItem('present_session') || '{}');
    if (!session.appliedMode) return;

    const interval = setInterval(async () => {
      try {
        const records = await base("Application Responses").select({
          fields: ['applicant_name'],
          maxRecords: 500,
          filterByFormula: 'AND({applicant_name} != "", YEAR(Created) = 2026)',
        }).all();
        const freshNames = [...new Set(
          records.map(r => (r.get('applicant_name') as string) || '').filter(n => n.trim())
        )];
        setAppliedNames(freshNames);

        const currentSession = JSON.parse(sessionStorage.getItem('present_session') || '{}');
        const currentNames: string[] = currentSession.names || [];
        const currentSet = new Set(currentNames.map(n => n.toLowerCase()));

        const newNames = freshNames.filter(n => !currentSet.has(n.toLowerCase()));
        if (newNames.length > 0) {
          const updated = [...currentNames, ...newNames];
          setPresentNames(updated);
          currentSession.names = updated;
          sessionStorage.setItem('present_session', JSON.stringify(currentSession));
          // Also refetch main applicants so new people show up
          fetchApplicants();
        }
      } catch (e) {
        console.error('Poll error:', e);
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [showSlideshow]);

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
          <div className="dash-header-actions">
            <a href="/" className="dash-nav-link">Check-In</a>
            <button className="dash-logout" onClick={() => { sessionStorage.removeItem('dash_auth'); setAuthenticated(false); setPassword(''); }}>
              Logout
            </button>
          </div>
        </div>
        <div className="dash-stats">
          {[
            { label: 'Total', value: applicants.filter(a => a.status?.toLowerCase() !== 'rejected').length },
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
          {(() => {
            const active = applicants.filter(a => a.status?.toLowerCase() !== 'rejected');
            const m = active.filter(a => a.gender?.toUpperCase() === 'M').length;
            const f = active.filter(a => a.gender?.toUpperCase() === 'F').length;
            return (
              <div className="dash-stat dash-stat-ratio">
                <span className="dash-stat-value"><span className="dash-ratio-m">{m}</span><span className="dash-ratio-colon">:</span><span className="dash-ratio-f">{f}</span></span>
                <span className="dash-stat-label">M : F</span>
              </div>
            );
          })()}
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
          <option value="applied">Applied</option>
          <option value="rejected">Rejected</option>
          <option value="all">All Statuses</option>
        </select>
        <select className="dash-filter" value={dayFilter} onChange={(e) => setDayFilter(e.target.value)}>
          <option value="all">All Days</option>
          <option value="1">Day 1</option>
          <option value="2">Day 2</option>
          <option value="3">Day 3</option>
          <option value="4">Day 4</option>
          <option value="5">Day 5</option>
        </select>
        <select className="dash-filter" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
          <option value="name-asc">Name A-Z</option>
          <option value="name-desc">Name Z-A</option>
          <option value="year-asc">Year (Oldest)</option>
          <option value="year-desc">Year (Newest)</option>
          <option value="added-asc">Added (Oldest)</option>
          <option value="added-desc">Added (Newest)</option>
          {isAdmin && <option value="elo-desc">Elo (Highest)</option>}
          {isAdmin && <option value="elo-asc">Elo (Lowest)</option>}
        </select>
        <button className="dash-refresh" onClick={fetchApplicants}>Refresh</button>
        {isAdmin && (
          <>
            {presentNames.length > 0 && (
              <button className="dash-present dash-present-resume" onClick={handleResumePresentation}>
                Resume ({presentNames.length})
              </button>
            )}
            <button className="dash-present" onClick={() => launchPresentation(filtered.map(a => a.name))}>
              {presentNames.length > 0 ? 'New Presentation' : 'Present'}
            </button>
            <button className="dash-bulk-reject" onClick={() => { setBulkRejectResult(null); setBulkRejectText(''); setShowBulkRejectModal(true); }}>
              Bulk Reject
            </button>
          </>
        )}
      </div>

      {/* Result count */}
      {(searchQuery || statusFilter !== 'all') && (
        <div className="dash-result-count">
          Showing {filtered.length} of {applicants.length}
        </div>
      )}

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
              <div className="card-meta">
                {getClassLabel(a.year, a.id)} · {getAttendanceCount(a)}/5 days
                {a.major ? ` · ${a.major}` : ''}
              </div>
            </div>
          </div>
        ))}
      </div>

      {filtered.length === 0 && <div className="dash-empty">No applicants found.</div>}

      {showSlideshow && presentNames.length > 0 && (
        <Slideshow
          applicants={applicants}
          presentationNames={presentNames}
          startIndex={slideshowStartIndex}
          onClose={() => setShowSlideshow(false)}
          onUpdateNames={handleUpdatePresentNames}
          isAdmin={isAdmin}
          navigate={navigate}
        />
      )}

      {showBulkRejectModal && (
        <div className="present-modal-overlay" onClick={() => !bulkRejectRunning && setShowBulkRejectModal(false)}>
          <div className="present-modal" onClick={e => e.stopPropagation()}>
            <h2 className="present-modal-title">Bulk Reject</h2>
            <p className="present-modal-desc">Paste the <strong>keep list</strong> — one name per line. Everyone <em>not</em> on this list gets set to Rejected.</p>

            {!bulkRejectResult ? (
              <>
                <textarea
                  className="present-modal-textarea"
                  placeholder={"Jane Doe\nJohn Smith\nAlex Chen"}
                  value={bulkRejectText}
                  onChange={e => setBulkRejectText(e.target.value)}
                  autoFocus
                  rows={12}
                  disabled={bulkRejectRunning}
                />
                {(() => {
                  const keepList = bulkRejectText.split('\n').map(n => n.trim()).filter(n => n.length > 0);
                  if (keepList.length === 0) return null;
                  const kv = brBuildKeepVariants(keepList);
                  const willReject = applicants.filter(a =>
                    (a.status || '').toLowerCase() !== 'rejected' && !brIsOnKeepList(a.name, kv)
                  ).length;
                  const alreadyRej = applicants.filter(a => (a.status || '').toLowerCase() === 'rejected').length;
                  const unmatched = keepList.filter(keepName => {
                    const kv2 = new Set(brVariants(keepName));
                    return !applicants.some(a => brVariants(a.name).some(v => kv2.has(v)));
                  });
                  return (
                    <div className="present-modal-match-info" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.3rem' }}>
                      <span className="present-match-count">{keepList.length - unmatched.length} keep list matches · {willReject} will be rejected</span>
                      {alreadyRej > 0 && <span style={{ color: '#999', fontSize: '0.8rem' }}>{alreadyRej} already rejected (skip)</span>}
                      {unmatched.length > 0 && (
                        <div className="present-unmatched-list">
                          <span className="present-unmatch-count">{unmatched.length} keep list names not found:</span>
                          <ul>{unmatched.map((name, i) => <li key={i}>{name}</li>)}</ul>
                        </div>
                      )}
                    </div>
                  );
                })()}
                <div className="present-modal-footer" style={{ marginTop: '1rem' }}>
                  <div className="present-modal-actions" style={{ width: '100%', justifyContent: 'flex-end' }}>
                    <button className="present-modal-cancel" onClick={() => setShowBulkRejectModal(false)} disabled={bulkRejectRunning}>
                      Cancel
                    </button>
                    <button
                      className="bulk-reject-confirm"
                      disabled={bulkRejectRunning || bulkRejectText.split('\n').filter(n => n.trim()).length === 0}
                      onClick={handleBulkReject}
                    >
                      {bulkRejectRunning ? 'Rejecting...' : (() => {
                        const kl = bulkRejectText.split('\n').map(n => n.trim()).filter(n => n.length > 0);
                        const kv = brBuildKeepVariants(kl);
                        const n = applicants.filter(a => (a.status || '').toLowerCase() !== 'rejected' && !brIsOnKeepList(a.name, kv)).length;
                        return `Reject ${n} applicants`;
                      })()}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="bulk-reject-result">
                <div className="bulk-reject-section">
                  <div className="bulk-reject-section-title bulk-reject-ok">{bulkRejectResult.rejected.length} rejected · {bulkRejectResult.alreadyRejected} already rejected (skipped)</div>
                  <ul className="bulk-reject-list">
                    {bulkRejectResult.rejected.map((name, i) => <li key={i}>{name}</li>)}
                  </ul>
                </div>
                {bulkRejectResult.keepUnmatched.length > 0 && (
                  <div className="bulk-reject-section">
                    <div className="bulk-reject-section-title bulk-reject-warn">{bulkRejectResult.keepUnmatched.length} keep list names had no matching record</div>
                    <ul className="bulk-reject-list">
                      {bulkRejectResult.keepUnmatched.map((name, i) => <li key={i}>{name}</li>)}
                    </ul>
                  </div>
                )}
                <div className="present-modal-footer" style={{ marginTop: '1rem' }}>
                  <div className="present-modal-actions" style={{ width: '100%', justifyContent: 'flex-end' }}>
                    <button className="present-modal-cancel" onClick={() => { setBulkRejectResult(null); setBulkRejectText(''); }}>
                      Back
                    </button>
                    <button className="present-modal-start" onClick={() => setShowBulkRejectModal(false)}>
                      Done
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
