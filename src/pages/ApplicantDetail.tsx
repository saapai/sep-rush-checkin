import { useState, useEffect } from 'react';
import Airtable from 'airtable';
import './ApplicantDetail.css';

const normalizeForDedup = (text: string) =>
  text.toLowerCase().replace(/[.,;:!?—–-]/g, '').replace(/\s+/g, ' ').trim();

const parseNotesByDay = (notes: string) => {
  const dayNotes: { [key: number]: { [name: string]: { original: string; normalized: string }[] } } = {};
  const regex = /\[([^\]]+)\s—\s+Day\s+(\d+)\]:\s*([^\[]*?)(?=\[|$)/g;
  let match;
  while ((match = regex.exec(notes)) !== null) {
    const day = parseInt(match[2]);
    const name = match[1].trim();
    const text = match[3].trim();
    if (!text) continue;
    if (!dayNotes[day]) dayNotes[day] = {};
    if (!dayNotes[day][name]) dayNotes[day][name] = [];
    const normalized = normalizeForDedup(text);
    if (!dayNotes[day][name].some(item => item.normalized === normalized)) {
      dayNotes[day][name].push({ original: text, normalized });
    }
  }
  const formatted: { [key: number]: string[] } = {};
  Object.entries(dayNotes).forEach(([dayStr, namesMap]) => {
    const day = parseInt(dayStr);
    formatted[day] = Object.entries(namesMap).map(([name, textItems]) =>
      textItems.length === 1
        ? `${name}: ${textItems[0].original}`
        : `${name}:\n${textItems.map(item => `  • ${item.original}`).join('\n')}`
    );
  });
  return formatted;
};

const base = new Airtable({
  apiKey: import.meta.env.VITE_AIRTABLE_API_KEY
}).base(import.meta.env.VITE_AIRTABLE_BASE_ID);

const TABLE = "Rush Spring '26";
const PASSCODE = 'quinnanish';
const ADMIN_PASSCODE = 'quinnanishadmin';

const SHOW_AI_SUMMARY = false;

interface Applicant {
  id: string;
  name: string;
  email: string;
  year: number | null;
  photo: string;
  status: string;
  notes: string;
  notesSummary: string;
  day_1: boolean;
  day_2: boolean;
  day_3: boolean;
  day_4: boolean;
  day_5: boolean;
  elo: number;
  social: number;
  prof: number;
  weight: number;
  pm_notes: string;
}

interface ApplicationData {
  major: string;
  gpa: number | null;
  whySep: string;
  drive: string;
  describeYourself: string;
  portfolio: string;
  resume: { url: string; filename: string }[] | null;
  applicationSummary: string;
}

interface ApplicantDetailProps {
  applicantId: string;
  navigate: (path: string) => void;
}

const ApplicantDetail: React.FC<ApplicantDetailProps> = ({ applicantId, navigate }) => {
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [passError, setPassError] = useState(false);
  const [applicant, setApplicant] = useState<Applicant | null>(null);

  const navIds: string[] = (() => {
    try { return JSON.parse(sessionStorage.getItem('dash_nav_ids') || '[]'); } catch { return []; }
  })();
  const navIdx = navIds.indexOf(applicantId);
  const prevId = navIdx > 0 ? navIds[navIdx - 1] : null;
  const nextId = navIdx >= 0 && navIdx < navIds.length - 1 ? navIds[navIdx + 1] : null;
  const [loading, setLoading] = useState(true);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);
  const [pmNoteText, setPmNoteText] = useState('');
  const [savingPmNote, setSavingPmNote] = useState(false);
  const [pmNoteSaved, setPmNoteSaved] = useState(false);
  const [scoresRevealed, setScoresRevealed] = useState(false);
  const [activeDay, setActiveDay] = useState(1);
  const [appData, setAppData] = useState<ApplicationData | null>(null);
  const [resumeModal, setResumeModal] = useState(false);

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

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      if (e.key === 'ArrowRight' && nextId) navigate(`/applicant/${nextId}`);
      if (e.key === 'ArrowLeft' && prevId) navigate(`/applicant/${prevId}`);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [prevId, nextId, navigate]);

  useEffect(() => {
    if (!authenticated) return;
    const fetchApplicant = async () => {
      setLoading(true);
      try {
        const record = await base(TABLE).find(applicantId);
        const a: Applicant = {
          id: record.id,
          name: (record.get('applicant_name') as string) || '',
          email: (record.get('email') as string) || '',
          year: (record.get('year') as number) || null,
          photo: (record.get('photo') as string) || '',
          status: (record.get('status') as string) || '',
          notes: (record.get('notes') as string) || '',
          notesSummary: (record.get('notes_summary') as string) || '',
          day_1: !!record.get('day_1'),
          day_2: !!record.get('day_2'),
          day_3: !!record.get('day_3'),
          day_4: !!record.get('day_4'),
          day_5: !!record.get('day_5'),
          elo: (record.get('elo') as number) || 0,
          social: (record.get('social') as number) || 0,
          prof: (record.get('prof') as number) || 0,
          weight: (record.get('weight') as number) || 0,
          pm_notes: (record.get('pm_notes') as string) || '',
        };
        setApplicant(a);
        setNoteText(a.notes);
        setPmNoteText(a.pm_notes);
      } catch (error) {
        console.error('Error fetching applicant:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchApplicant();
  }, [authenticated, applicantId]);

  // Fetch application data
  useEffect(() => {
    if (!applicant) return;
    const fetchAppData = async () => {
      try {
        const records = await base("Application Responses").select({
          filterByFormula: `LOWER({applicant_name}) = "${applicant.name.toLowerCase().replace(/"/g, '\\"')}"`,
          maxRecords: 1,
        }).all();
        if (records.length > 0) {
          const r = records[0];
          setAppData({
            major: (r.get('major_minor') as string) || '',
            gpa: (r.get('GPA') as number) || null,
            whySep: (r.get('why_sep') as string) || '',
            drive: (r.get('drive') as string) || '',
            describeYourself: (r.get('describe_yourself') as string) || '',
            portfolio: (r.get('Portfolio, Website, Github, etc.') as string) || '',
            resume: (r.get('resume') as { url: string; filename: string }[]) || null,
            applicationSummary: (r.get('application_summary') as string) || '',
          });
        }
      } catch (e) {
        console.error('Error fetching application data:', e);
      }
    };
    fetchAppData();
  }, [applicant?.id]);

  const saveNote = async () => {
    if (!applicant) return;
    setSavingNote(true);
    try {
      await base(TABLE).update(applicant.id, { notes: noteText });
      setApplicant(prev => prev ? { ...prev, notes: noteText } : null);
      setNoteSaved(true);
      setTimeout(() => setNoteSaved(false), 2000);
    } catch (error) {
      console.error('Error saving note:', error);
      alert('Error saving note.');
    } finally {
      setSavingNote(false);
    }
  };

  const savePmNote = async () => {
    if (!applicant) return;
    setSavingPmNote(true);
    try {
      await base(TABLE).update(applicant.id, { pm_notes: pmNoteText });
      setApplicant(prev => prev ? { ...prev, pm_notes: pmNoteText } : null);
      setPmNoteSaved(true);
      setTimeout(() => setPmNoteSaved(false), 2000);
    } catch (error) {
      console.error('Error saving PM note:', error);
      alert('Error saving PM note.');
    } finally {
      setSavingPmNote(false);
    }
  };

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
      <div className="profile-page">
        <div className="profile-loading">Loading...</div>
      </div>
    );
  }

  if (!applicant) {
    return (
      <div className="profile-page">
        <div className="profile-not-found">
          <p>Applicant not found.</p>
          <button onClick={() => navigate('/dashboard')} className="profile-back-btn">Back to Dashboard</button>
        </div>
      </div>
    );
  }

  const attendanceDays = [
    { key: 'day_1', label: 'Day 1', date: 'Mar 30', present: applicant.day_1 },
    { key: 'day_2', label: 'Day 2', date: 'Mar 31', present: applicant.day_2 },
    { key: 'day_3', label: 'Day 3', date: 'Apr 1', present: applicant.day_3 },
    { key: 'day_4', label: 'Day 4', date: 'Apr 2', present: applicant.day_4 },
    { key: 'day_5', label: 'Day 5', date: 'Apr 3', present: applicant.day_5 },
  ];
  const attendanceCount = attendanceDays.filter(d => d.present).length;

  const scores = [
    { label: 'Elo', value: applicant.elo },
    { label: 'Social', value: applicant.social },
    { label: 'Professional', value: applicant.prof },
    { label: 'Weight', value: applicant.weight },
  ];

  const statusClass = applicant.status.toLowerCase().replace(/\s+/g, '-');

  return (
    <div className="profile-page">
      <div className="profile-container">
        {/* Top bar */}
        <div className="profile-topbar">
          <button onClick={() => navigate('/dashboard')} className="profile-back">
            <span className="back-arrow">&#8592;</span>
            <span>Dashboard</span>
          </button>
          {navIds.length > 0 && (
            <div className="profile-nav">
              <button
                className="profile-nav-btn"
                disabled={!prevId}
                onClick={() => prevId && navigate(`/applicant/${prevId}`)}
              >
                &#8592; Prev
              </button>
              <span className="profile-nav-count">
                {navIdx + 1} / {navIds.length}
              </span>
              <button
                className="profile-nav-btn"
                disabled={!nextId}
                onClick={() => nextId && navigate(`/applicant/${nextId}`)}
              >
                Next &#8594;
              </button>
            </div>
          )}
        </div>

        {/* Hero section */}
        <div className="profile-hero">
          <div className="profile-photo-container">
            {applicant.photo ? (
              <img src={applicant.photo} alt={applicant.name} className="profile-photo" />
            ) : (
              <div className="profile-no-photo">
                <span>{applicant.name.charAt(0).toUpperCase()}</span>
              </div>
            )}
          </div>
          <div className="profile-identity">
            <h1 className="profile-name">{applicant.name}</h1>
            <p className="profile-email">{applicant.email || 'No email provided'}</p>
            <div className="profile-badges">
              {applicant.year && <span className="profile-badge badge-year">Class of {applicant.year}</span>}
              <span className={`profile-badge badge-status ${statusClass}`}>
                {applicant.status || 'Unknown'}
              </span>
              <span className="profile-badge badge-attendance">{attendanceCount}/5 days</span>
            </div>
          </div>
        </div>

        {/* Content grid */}
        <div className="profile-content">
          {/* Application */}
          {appData && (
            <div className="profile-card card-full">
              <h2 className="card-title">Application</h2>

              {appData.applicationSummary && (
                <div className="app-summary-block">
                  <p className="app-summary-text">{appData.applicationSummary}</p>
                </div>
              )}

              <div className="app-details">
                {appData.major && <div className="app-detail-row"><span className="app-label">Major</span><span className="app-value">{appData.major}</span></div>}
                {appData.describeYourself && <div className="app-detail-row"><span className="app-label">Self</span><span className="app-value">"{appData.describeYourself}"</span></div>}
              </div>

              <div className="app-links">
                {appData.resume && appData.resume.length > 0 && (
                  <button className="app-link-btn" onClick={() => setResumeModal(true)}>
                    Resume
                  </button>
                )}
                {appData.portfolio && (() => {
                  const urls = appData.portfolio.split(/[\s,;\n]+/).map(s => s.trim()).filter(s => s.match(/^https?:\/\//i));
                  if (urls.length === 0) return null;
                  const getLabel = (url: string) => {
                    try {
                      const host = new URL(url).hostname.replace('www.', '');
                      if (host.includes('github')) return 'GitHub';
                      if (host.includes('linkedin')) return 'LinkedIn';
                      if (host.includes('drive.google')) return 'Google Drive';
                      if (host.includes('behance')) return 'Behance';
                      if (host.includes('figma')) return 'Figma';
                      if (host.includes('youtube') || host.includes('youtu.be')) return 'YouTube';
                      return host.split('.')[0].charAt(0).toUpperCase() + host.split('.')[0].slice(1);
                    } catch { return 'Link'; }
                  };
                  return urls.map((url, i) => (
                    <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="app-link-btn">{getLabel(url)}</a>
                  ));
                })()}
              </div>

              {appData.whySep && (
                <div className="app-essay">
                  <div className="app-essay-label">Why SEP</div>
                  <p className="app-essay-text">{appData.whySep}</p>
                </div>
              )}
              {appData.drive && (
                <div className="app-essay">
                  <div className="app-essay-label">Drive</div>
                  <p className="app-essay-text">{appData.drive}</p>
                </div>
              )}
            </div>
          )}

          {/* Attendance */}
          <div className="profile-card">
            <h2 className="card-title">Attendance</h2>
            <div className="attendance-grid">
              {attendanceDays.map(d => (
                <div key={d.key} className={`attendance-block ${d.present ? 'att-yes' : 'att-no'}`}>
                  <div className="att-indicator">{d.present ? '✓' : '—'}</div>
                  <div className="att-label">{d.label}</div>
                  <div className="att-date">{d.date}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Scores — admin only */}
          {isAdmin && (
            <div className="profile-card">
              <h2 className="card-title">Scores</h2>
              <div
                className={`scores-grid ${!scoresRevealed ? 'scores-blurred' : ''}`}
                onClick={() => setScoresRevealed(prev => !prev)}
              >
                {scores.map(s => (
                  <div key={s.label} className="score-card">
                    <div className="score-number">{s.value || '—'}</div>
                    <div className="score-name">{s.label}</div>
                  </div>
                ))}
              </div>
              {!scoresRevealed && <p className="scores-hint">Tap to reveal</p>}
            </div>
          )}

          {/* Notes */}
          <div className="profile-card card-full">
            <div className="notes-header">
              <h2 className="card-title">Notes</h2>
              {isAdmin && noteSaved && <span className="note-saved-badge">Saved</span>}
            </div>
            {SHOW_AI_SUMMARY && applicant.notesSummary && (
              <div className="notes-summary">
                <div className="notes-summary-label">AI Summary</div>
                <p className="notes-summary-text">{applicant.notesSummary}</p>
              </div>
            )}
            {(() => {
              const dayNotes = parseNotesByDay(applicant.notes);
              const days = Object.keys(dayNotes).map(Number).sort((a, b) => a - b);
              if (days.length === 0) {
                return <p className="notes-empty">No notes yet.</p>;
              }
              const displayDay = days.includes(activeDay) ? activeDay : days[0];
              return (
                <>
                  <div className="notes-day-tabs">
                    {days.map(day => (
                      <button
                        key={day}
                        className={`notes-day-tab ${displayDay === day ? 'active' : ''}`}
                        onClick={() => setActiveDay(day)}
                      >
                        Day {day}
                      </button>
                    ))}
                  </div>
                  <div className="notes-day-content">
                    {dayNotes[displayDay]?.map((note, idx) => (
                      <div key={idx} className="notes-entry">
                        {note.split('\n').map((line, lineIdx) => (
                          <div key={lineIdx}>{line}</div>
                        ))}
                      </div>
                    ))}
                  </div>
                </>
              );
            })()}
            {isAdmin && (
              <>
                <div className="notes-edit-divider" />
                <textarea
                  className="notes-textarea"
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Edit raw notes..."
                  rows={6}
                />
                <button
                  className="notes-save"
                  onClick={saveNote}
                  disabled={savingNote || noteText === applicant.notes}
                >
                  {savingNote ? 'Saving...' : 'Save Notes'}
                </button>
              </>
            )}
          </div>

          {/* PM Notes — admin only */}
          {isAdmin && (
            <div className="profile-card card-full pm-notes-card">
              <div className="notes-header">
                <h2 className="card-title">PM Notes</h2>
                {pmNoteSaved && <span className="note-saved-badge">Saved</span>}
              </div>
              <textarea
                className="notes-textarea"
                value={pmNoteText}
                onChange={(e) => setPmNoteText(e.target.value)}
                placeholder="Add internal PM notes about this applicant..."
                rows={5}
              />
              <button
                className="notes-save"
                onClick={savePmNote}
                disabled={savingPmNote || pmNoteText === applicant.pm_notes}
              >
                {savingPmNote ? 'Saving...' : 'Save PM Notes'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Resume modal */}
      {resumeModal && appData?.resume && appData.resume.length > 0 && (
        <div className="resume-modal-overlay" onClick={() => setResumeModal(false)}>
          <div className="resume-modal" onClick={e => e.stopPropagation()}>
            <div className="resume-modal-header">
              <h3>Resume — {applicant.name}</h3>
              <div className="resume-modal-actions">
                <a href={appData.resume[0].url} target="_blank" rel="noopener noreferrer" className="resume-open-tab">
                  Open in new tab
                </a>
                <button className="resume-modal-close" onClick={() => setResumeModal(false)}>&times;</button>
              </div>
            </div>
            <iframe
              src={appData.resume[0].url}
              className="resume-iframe"
              title={`Resume - ${applicant.name}`}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default ApplicantDetail;
