import { useState, useEffect, useCallback } from 'react';
import './Slideshow.css';

const SHOW_AI_SUMMARY = false;

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

interface SlideshowProps {
  applicants: Applicant[];
  startIndex: number;
  onClose: () => void;
  isAdmin: boolean;
  navigate: (path: string) => void;
}

const normalizeForDedup = (text: string) => {
  return text
    .toLowerCase()
    .replace(/[.,;:!?—–-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

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
    const isDuplicate = dayNotes[day][name].some(item => item.normalized === normalized);
    if (!isDuplicate) {
      dayNotes[day][name].push({ original: text, normalized });
    }
  }

  // Convert to formatted display
  const formatted: { [key: number]: string[] } = {};
  Object.entries(dayNotes).forEach(([dayStr, namesMap]) => {
    const day = parseInt(dayStr);
    formatted[day] = Object.entries(namesMap).map(([name, textItems]) => {
      if (textItems.length === 1) {
        return `${name}: ${textItems[0].original}`;
      }
      return `${name}:\n${textItems.map(item => `  • ${item.original}`).join('\n')}`;
    });
  });

  return formatted;
};

const Slideshow: React.FC<SlideshowProps> = ({ applicants, startIndex, onClose, isAdmin, navigate }) => {
  const [currentIndex, setCurrentIndex] = useState(startIndex);
  const [scoresRevealed, setScoresRevealed] = useState(false);
  const [activeDay, setActiveDay] = useState(1);

  const applicant = applicants[currentIndex];

  useEffect(() => {
    setScoresRevealed(false);
    setActiveDay(1);
  }, [currentIndex]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const goNext = useCallback(() => {
    if (currentIndex < applicants.length - 1) {
      setCurrentIndex(prev => prev + 1);
    }
  }, [currentIndex, applicants.length]);

  const goPrev = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
    }
  }, [currentIndex]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') goNext();
      else if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goNext, goPrev, onClose]);


  const attendanceCount = [applicant.day_1, applicant.day_2, applicant.day_3, applicant.day_4, applicant.day_5].filter(Boolean).length;
  const attendanceDays = [
    { label: 'D1', present: applicant.day_1 },
    { label: 'D2', present: applicant.day_2 },
    { label: 'D3', present: applicant.day_3 },
    { label: 'D4', present: applicant.day_4 },
    { label: 'D5', present: applicant.day_5 },
  ];
  const statusClass = applicant.status.toLowerCase().replace(/\s+/g, '-');

  return (
    <div className="slideshow-overlay">
      <div className="slideshow-topbar">
        <button className="slideshow-close" onClick={onClose}>
          <span className="slideshow-close-icon">&times;</span>
          <span className="slideshow-close-label">ESC</span>
        </button>
        <span className="slideshow-counter">{currentIndex + 1} / {applicants.length}</span>
        <button className="slideshow-view-profile" onClick={() => navigate(`/applicant/${applicant.id}`)}>
          View Profile
        </button>
      </div>

      <div className="slideshow-body">
        <button className="slideshow-nav-arrow" onClick={goPrev} disabled={currentIndex === 0}>
          &#8592;
        </button>

        <div className="slideshow-content">
          <div className="slideshow-left">
            <div className="slideshow-photo-wrap">
              {applicant.photo ? (
                <img src={applicant.photo} alt={applicant.name} className="slideshow-photo" />
              ) : (
                <div className="slideshow-no-photo">
                  <span>{applicant.name.charAt(0).toUpperCase()}</span>
                </div>
              )}
            </div>

            <div className="slideshow-info">
              <h2 className="slideshow-name">{applicant.name}</h2>
              <p className="slideshow-email">{applicant.email || 'No email'}</p>

              <div className="slideshow-badges">
                {applicant.year && <span className="slideshow-badge">{applicant.year}</span>}
                {applicant.status && (
                  <span className={`slideshow-badge slideshow-badge-status ${statusClass}`}>
                    {applicant.status}
                  </span>
                )}
                <span className="slideshow-badge">{attendanceCount}/5 days</span>
              </div>

              <div className="slideshow-attendance">
                {attendanceDays.map((d, i) => (
                  <div key={i} className={`slideshow-att-dot ${d.present ? 'att-yes' : ''}`}>
                    {d.label}
                  </div>
                ))}
              </div>

              {isAdmin && (
                <div
                  className={`slideshow-scores ${!scoresRevealed ? 'scores-blurred' : ''}`}
                  onClick={() => setScoresRevealed(prev => !prev)}
                >
                  {[
                    { label: 'Elo', value: applicant.elo },
                    { label: 'Social', value: applicant.social },
                    { label: 'Prof', value: applicant.prof },
                    { label: 'Weight', value: applicant.weight },
                  ].map(s => (
                    <div key={s.label} className="slideshow-score">
                      <span className="slideshow-score-val">{s.value || '—'}</span>
                      <span className="slideshow-score-label">{s.label}</span>
                    </div>
                  ))}
                  {!scoresRevealed && <div className="slideshow-scores-hint">Tap to reveal</div>}
                </div>
              )}
            </div>
          </div>

          <div className="slideshow-right">
            {isAdmin && applicant.pm_notes && (
              <div className="slideshow-pm-notes">
                <div className="slideshow-pm-notes-label">PM Notes</div>
                <p className="slideshow-pm-notes-text">{applicant.pm_notes}</p>
              </div>
            )}

            <div className="slideshow-notes-header">
              <h3 className="slideshow-notes-title">Notes</h3>
            </div>

            {SHOW_AI_SUMMARY && applicant.notesSummary && (
              <div className="slideshow-summary">
                <div className="slideshow-summary-label">AI Summary</div>
                <p className="slideshow-summary-text">{applicant.notesSummary}</p>
              </div>
            )}

            {(() => {
              const dayNotes = parseNotesByDay(applicant.notes);
              const days = Object.keys(dayNotes).map(Number).sort((a, b) => a - b);

              if (days.length === 0) {
                return (
                  <div className="slideshow-no-notes">
                    <p>No notes for this applicant yet</p>
                  </div>
                );
              }

              return (
                <>
                  <div className="slideshow-day-tabs">
                    {days.map(day => (
                      <button
                        key={day}
                        className={`slideshow-day-tab ${activeDay === day ? 'active' : ''}`}
                        onClick={() => setActiveDay(day)}
                      >
                        Day {day}
                      </button>
                    ))}
                  </div>
                  <div className="slideshow-notes-content">
                    {dayNotes[activeDay]?.map((note, idx) => (
                      <div key={idx} className="slideshow-note-entry">
                        {note.split('\n').map((line, lineIdx) => (
                          <div key={lineIdx}>{line}</div>
                        ))}
                      </div>
                    ))}
                  </div>
                </>
              );
            })()}
          </div>
        </div>

        <button className="slideshow-nav-arrow" onClick={goNext} disabled={currentIndex === applicants.length - 1}>
          &#8594;
        </button>
      </div>

      <div className="slideshow-mobile-nav">
        <button onClick={goPrev} disabled={currentIndex === 0}>&#8592; Prev</button>
        <span>{currentIndex + 1} / {applicants.length}</span>
        <button onClick={goNext} disabled={currentIndex === applicants.length - 1}>Next &#8594;</button>
      </div>
    </div>
  );
};

export default Slideshow;
