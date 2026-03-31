import { useState, useEffect } from 'react';
import Airtable from 'airtable';
import './ApplicantDetail.css';

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
  const [loading, setLoading] = useState(true);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);
  const [scoresRevealed, setScoresRevealed] = useState(false);

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
        };
        setApplicant(a);
        setNoteText(a.notes);
      } catch (error) {
        console.error('Error fetching applicant:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchApplicant();
  }, [authenticated, applicantId]);

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
              {noteSaved && <span className="note-saved-badge">Saved</span>}
            </div>
            {applicant.notesSummary && (
              <div className="notes-summary">
                <div className="notes-summary-label">AI Summary</div>
                <p className="notes-summary-text">{applicant.notesSummary}</p>
              </div>
            )}
            <textarea
              className="notes-textarea"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Add notes about this applicant..."
              rows={8}
            />
            <button
              className="notes-save"
              onClick={saveNote}
              disabled={savingNote || noteText === applicant.notes}
            >
              {savingNote ? 'Saving...' : 'Save Notes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ApplicantDetail;
