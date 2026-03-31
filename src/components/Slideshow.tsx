import { useState, useEffect, useCallback, useRef } from 'react';
import './Slideshow.css';

const SHOW_AI_SUMMARY = false;
const SESSION_KEY = 'present_session';
const APP_TABLE = "Application Responses";

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
  resume?: string;
}

interface ApplicationData {
  major: string;
  gpa: number | null;
  whySep: string;
  drive: string;
  describeYourself: string;
  portfolio: string;
  resume: { url: string; filename: string }[] | null;
}

interface SlideshowProps {
  applicants: Applicant[];
  presentationNames: string[];
  startIndex: number;
  onClose: () => void;
  onUpdateNames: (names: string[]) => void;
  isAdmin: boolean;
  navigate: (path: string) => void;
}

type ModalType = 'essay' | 'manage' | null;

interface ModalState {
  type: ModalType;
  title?: string;
  content?: string;
}

const normalizeForDedup = (text: string) =>
  text.toLowerCase().replace(/[.,;:!?—–-]/g, '').replace(/\s+/g, ' ').trim();

const parseAllNotes = (notes: string) => {
  const days: { day: number; entries: { member: string; text: string }[] }[] = [];
  const dayMap: Map<number, { member: string; text: string; normalized: string }[]> = new Map();
  const regex = /\[([^\]]+)\s—\s+Day\s+(\d+)\]:\s*([^\[]*?)(?=\[|$)/g;
  let match;
  while ((match = regex.exec(notes)) !== null) {
    const day = parseInt(match[2]);
    const member = match[1].trim();
    const text = match[3].trim();
    if (!text) continue;
    if (!dayMap.has(day)) dayMap.set(day, []);
    const dayEntries = dayMap.get(day)!;
    const normalized = normalizeForDedup(text);
    const isDupe = dayEntries.some(e => {
      if (e.member !== member) return false;
      if (e.normalized === normalized) return true;
      const wordsA = new Set(normalized.split(' '));
      const wordsB = new Set(e.normalized.split(' '));
      if (wordsA.size < 4) return false;
      const overlap = [...wordsA].filter(w => wordsB.has(w)).length;
      return overlap / Math.max(wordsA.size, wordsB.size) > 0.8;
    });
    if (!isDupe) dayEntries.push({ member, text, normalized });
  }
  const sortedDays = [...dayMap.keys()].sort((a, b) => a - b);
  for (const day of sortedDays) {
    const entries = dayMap.get(day)!;
    days.push({ day, entries: entries.map(e => ({ member: e.member, text: e.text })) });
  }
  return days;
};

const Slideshow: React.FC<SlideshowProps> = ({
  applicants, presentationNames, startIndex, onClose, onUpdateNames, isAdmin, navigate,
}) => {
  const [currentIndex, setCurrentIndex] = useState(startIndex);
  const [scoresRevealed, setScoresRevealed] = useState(false);
  const [modal, setModal] = useState<ModalState>({ type: null });
  const [appData, setAppData] = useState<ApplicationData | null>(null);
  const [appLoading, setAppLoading] = useState(false);

  // Jump-to search
  const [jumpSearch, setJumpSearch] = useState('');
  const [jumpOpen, setJumpOpen] = useState(false);
  const jumpInputRef = useRef<HTMLInputElement>(null);
  const jumpDropdownRef = useRef<HTMLDivElement>(null);

  // Manage modal: add search
  const [manageAddSearch, setManageAddSearch] = useState('');
  const [manageAddOpen, setManageAddOpen] = useState(false);
  const manageAddInputRef = useRef<HTMLInputElement>(null);
  const manageAddDropdownRef = useRef<HTMLDivElement>(null);

  // Export copied state
  const [exportCopied, setExportCopied] = useState(false);

  const orderedApplicants = presentationNames
    .map(name => applicants.find(a => a.name.toLowerCase() === name.toLowerCase()))
    .filter(Boolean) as Applicant[];

  const applicant = orderedApplicants[currentIndex];

  // Persist index
  useEffect(() => {
    const session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || '{}');
    session.currentIndex = currentIndex;
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }, [currentIndex]);

  // Fetch application data
  useEffect(() => {
    setScoresRevealed(false);
    setAppData(null);
    if (!applicant) return;
    const fetchAppData = async () => {
      setAppLoading(true);
      try {
        const Airtable = (await import('airtable')).default;
        const base = new Airtable({ apiKey: import.meta.env.VITE_AIRTABLE_API_KEY })
          .base(import.meta.env.VITE_AIRTABLE_BASE_ID);
        const records = await base(APP_TABLE).select({
          filterByFormula: `{applicant_name} = "${applicant.name.replace(/"/g, '\\"')}"`,
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
          });
        }
      } catch (e) { console.error('Error fetching application data:', e); }
      finally { setAppLoading(false); }
    };
    fetchAppData();
  }, [currentIndex, applicant?.id]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const goNext = useCallback(() => {
    if (currentIndex < orderedApplicants.length - 1) setCurrentIndex(prev => prev + 1);
  }, [currentIndex, orderedApplicants.length]);

  const goPrev = useCallback(() => {
    if (currentIndex > 0) setCurrentIndex(prev => prev - 1);
  }, [currentIndex]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (jumpOpen) { setJumpOpen(false); setJumpSearch(''); return; }
        if (modal.type) { setModal({ type: null }); return; }
        onClose();
        return;
      }
      if (modal.type || jumpOpen) return;
      if (e.key === 'ArrowRight') goNext();
      else if (e.key === 'ArrowLeft') goPrev();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goNext, goPrev, onClose, modal.type, jumpOpen]);

  // --- Jump-to search ---
  const jumpFiltered = (() => {
    if (!jumpSearch.trim()) return orderedApplicants;
    const q = jumpSearch.toLowerCase();
    return orderedApplicants.filter(a => a.name.toLowerCase().includes(q));
  })();

  const handleJumpTo = (a: Applicant) => {
    const idx = orderedApplicants.findIndex(x => x.id === a.id);
    if (idx >= 0) setCurrentIndex(idx);
    setJumpSearch('');
    setJumpOpen(false);
  };

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        jumpDropdownRef.current && !jumpDropdownRef.current.contains(e.target as Node) &&
        jumpInputRef.current && !jumpInputRef.current.contains(e.target as Node)
      ) setJumpOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // --- Manage modal: add people ---
  const manageAddFiltered = (() => {
    const inPres = new Set(presentationNames.map(n => n.toLowerCase()));
    const available = applicants.filter(a => !inPres.has(a.name.toLowerCase()));
    if (!manageAddSearch.trim()) return available;
    const q = manageAddSearch.toLowerCase();
    return available.filter(a => a.name.toLowerCase().includes(q));
  })();

  const handleManageAdd = (name: string) => {
    // Insert in order based on position in the master applicants list
    const masterOrder = applicants.map(a => a.name.toLowerCase());
    const newIdx = masterOrder.indexOf(name.toLowerCase());
    const updated = [...presentationNames];
    let insertAt = updated.length; // default: end
    for (let i = 0; i < updated.length; i++) {
      const existingIdx = masterOrder.indexOf(updated[i].toLowerCase());
      if (existingIdx > newIdx) {
        insertAt = i;
        break;
      }
    }
    updated.splice(insertAt, 0, name);
    onUpdateNames(updated);
    // Adjust currentIndex if we inserted before it
    if (insertAt <= currentIndex) setCurrentIndex(prev => prev + 1);
    setManageAddSearch('');
    setManageAddOpen(false);
  };

  const handleManageRemove = (idx: number) => {
    const updated = presentationNames.filter((_, i) => i !== idx);
    onUpdateNames(updated);
    if (updated.length === 0) {
      setCurrentIndex(0);
    } else if (idx < currentIndex) {
      setCurrentIndex(prev => prev - 1);
    } else if (currentIndex >= updated.length) {
      setCurrentIndex(updated.length - 1);
    }
  };

  useEffect(() => {
    if (modal.type !== 'manage') return;
    const handleClick = (e: MouseEvent) => {
      if (
        manageAddDropdownRef.current && !manageAddDropdownRef.current.contains(e.target as Node) &&
        manageAddInputRef.current && !manageAddInputRef.current.contains(e.target as Node)
      ) setManageAddOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [modal.type]);

  // --- Export script ---
  const handleExport = () => {
    const scriptApplicants = orderedApplicants.map(a => {
      const photoUrl = a.photo || '';
      return `    {name: "${a.name.replace(/"/g, '\\"')}", photo: "${photoUrl}"}`;
    });

    const script = `function createRushForm() {
  var form = FormApp.create("SEP Rush - Voting (${orderedApplicants.length} people)");
  form.setDescription("Rate each applicant 1-5");

  var applicants = [
${scriptApplicants.join(',\n')}
  ];

  for (var i = 0; i < applicants.length; i++) {
    var a = applicants[i];

    try {
      var img = UrlFetchApp.fetch(a.photo);
      form.addImageItem()
        .setTitle("")
        .setImage(img.getBlob());
    } catch(e) {
      Logger.log("Failed to load image for " + a.name);
    }

    form.addScaleItem()
      .setTitle(a.name)
      .setBounds(1, 5)
      .setLabels("Weak", "Strong")
      .setRequired(false);
  }

  Logger.log("Form URL: " + form.getEditUrl());
  Logger.log("Response URL: " + form.getPublishedUrl());
}`;

    navigator.clipboard.writeText(script).then(() => {
      setExportCopied(true);
      setTimeout(() => setExportCopied(false), 2000);
    });
  };

  // --- Render ---
  if (!applicant) {
    return (
      <div className="slideshow-overlay">
        <div className="slideshow-topbar">
          <button className="slideshow-close" onClick={onClose}>
            <span className="slideshow-close-icon">&times;</span>
            <span className="slideshow-close-label">ESC</span>
          </button>
        </div>
        <div className="slideshow-empty-state">
          <p>No matching applicants found.</p>
          <button className="slide-btn-add" onClick={() => setModal({ type: 'manage' })}>Manage List</button>
        </div>
      </div>
    );
  }

  const attendanceCount = [applicant.day_1, applicant.day_2, applicant.day_3, applicant.day_4, applicant.day_5].filter(Boolean).length;
  const attendanceDays = [
    { label: 'D1', present: applicant.day_1 },
    { label: 'D2', present: applicant.day_2 },
    { label: 'D3', present: applicant.day_3 },
    { label: 'D4', present: applicant.day_4 },
    { label: 'D5', present: applicant.day_5 },
  ];
  const statusClass = applicant.status.toLowerCase().replace(/\s+/g, '-');
  const allNotes = parseAllNotes(applicant.notes);
  const hasResume = appData?.resume && appData.resume.length > 0;
  const hasApplication = appData && (appData.whySep || appData.drive || appData.describeYourself);

  return (
    <div className="slideshow-overlay">
      {/* Top bar */}
      <div className="slideshow-topbar">
        <div className="slideshow-topbar-left">
          <button className="slideshow-close" onClick={onClose}>
            <span className="slideshow-close-icon">&times;</span>
            <span className="slideshow-close-label">ESC</span>
          </button>
          {/* Jump-to search */}
          <div className="slide-jump-wrap">
            <input
              ref={jumpInputRef}
              type="text"
              className="slide-jump-input"
              placeholder="Jump to..."
              value={jumpSearch}
              onChange={e => { setJumpSearch(e.target.value); setJumpOpen(true); }}
              onFocus={() => setJumpOpen(true)}
              autoComplete="off"
            />
            {jumpOpen && jumpSearch.trim() && (
              <div ref={jumpDropdownRef} className="slide-jump-dropdown">
                {jumpFiltered.length === 0 ? (
                  <div className="slide-jump-empty">Not in presentation</div>
                ) : (
                  jumpFiltered.slice(0, 6).map((a) => {
                    const idx = orderedApplicants.findIndex(x => x.id === a.id);
                    return (
                      <div key={a.id} className="slide-jump-item" onClick={() => handleJumpTo(a)}>
                        <span>{a.name}</span>
                        <span className="slide-jump-idx">#{idx + 1}</span>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>
        <div className="slideshow-topbar-center">
          <span className="slideshow-counter">{currentIndex + 1} / {orderedApplicants.length}</span>
        </div>
        <div className="slideshow-topbar-actions">
          <button className="slide-btn-topbar" onClick={() => { setManageAddSearch(''); setManageAddOpen(false); setModal({ type: 'manage' }); }}>
            Manage
          </button>
          <button className="slide-btn-topbar slide-btn-export" onClick={handleExport}>
            {exportCopied ? 'Copied!' : 'Export'}
          </button>
          <button className="slideshow-view-profile" onClick={() => navigate(`/applicant/${applicant.id}`)}>
            Full Profile
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="slideshow-body">
        <button className="slideshow-nav-arrow" onClick={goPrev} disabled={currentIndex === 0}>&#8592;</button>

        <div className="slideshow-content">
          {/* Left panel */}
          <div className="slideshow-left">
            <div className="slideshow-photo-wrap">
              {applicant.photo ? (
                <img src={applicant.photo} alt={applicant.name} className="slideshow-photo" />
              ) : (
                <div className="slideshow-no-photo"><span>{applicant.name.charAt(0).toUpperCase()}</span></div>
              )}
            </div>
            <div className="slideshow-info">
              <h2 className="slideshow-name">{applicant.name}</h2>
              <p className="slideshow-email">{applicant.email || 'No email'}</p>
              {(appData?.major || applicant.major) && <p className="slideshow-major">{appData?.major || applicant.major}</p>}
              {appData?.gpa && <p className="slideshow-gpa">GPA: {appData.gpa}</p>}
              <div className="slideshow-badges">
                {applicant.year && <span className="slideshow-badge">{applicant.year}</span>}
                {applicant.status && <span className={`slideshow-badge slideshow-badge-status ${statusClass}`}>{applicant.status}</span>}
                <span className="slideshow-badge">{attendanceCount}/5 days</span>
              </div>
              <div className="slideshow-attendance">
                {attendanceDays.map((d, i) => (
                  <div key={i} className={`slideshow-att-dot ${d.present ? 'att-yes' : ''}`}>{d.label}</div>
                ))}
              </div>
              <div className="slideshow-actions">
                {hasResume ? (
                  <a href={appData!.resume![0].url} target="_blank" rel="noopener noreferrer" className="slide-action-btn">Resume</a>
                ) : (
                  <span className="slide-action-btn slide-action-disabled">No Resume</span>
                )}
                {hasApplication ? (
                  <>
                    {appData!.whySep && <button className="slide-action-btn" onClick={() => setModal({ type: 'essay', title: 'Why SEP?', content: appData!.whySep })}>Why SEP</button>}
                    {appData!.drive && <button className="slide-action-btn" onClick={() => setModal({ type: 'essay', title: 'Drive', content: appData!.drive })}>Drive</button>}
                    {appData!.describeYourself && <button className="slide-action-btn" onClick={() => setModal({ type: 'essay', title: 'Describe Yourself', content: appData!.describeYourself })}>Self</button>}
                  </>
                ) : (
                  <span className="slide-action-btn slide-action-disabled">{appLoading ? 'Loading...' : 'No Application'}</span>
                )}
                {appData?.portfolio && <a href={appData.portfolio} target="_blank" rel="noopener noreferrer" className="slide-action-btn">Portfolio</a>}
              </div>
              {(applicant.essay_1 || applicant.essay_2 || applicant.essay_3) && (
                <div className="slideshow-actions">
                  {applicant.essay_1 && <button className="slide-action-btn" onClick={() => setModal({ type: 'essay', title: 'Essay 1', content: applicant.essay_1! })}>Essay 1</button>}
                  {applicant.essay_2 && <button className="slide-action-btn" onClick={() => setModal({ type: 'essay', title: 'Essay 2', content: applicant.essay_2! })}>Essay 2</button>}
                  {applicant.essay_3 && <button className="slide-action-btn" onClick={() => setModal({ type: 'essay', title: 'Essay 3', content: applicant.essay_3! })}>Essay 3</button>}
                </div>
              )}
              {isAdmin && (
                <div className={`slideshow-scores ${!scoresRevealed ? 'scores-blurred' : ''}`} onClick={() => setScoresRevealed(prev => !prev)}>
                  {[{ label: 'Elo', value: applicant.elo }, { label: 'Social', value: applicant.social }, { label: 'Prof', value: applicant.prof }, { label: 'Weight', value: applicant.weight }].map(s => (
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

          {/* Right panel — notes */}
          <div className="slideshow-right">
            {isAdmin && applicant.pm_notes && (
              <div className="slideshow-pm-notes">
                <div className="slideshow-pm-notes-label">PM Notes</div>
                <p className="slideshow-pm-notes-text">{applicant.pm_notes}</p>
              </div>
            )}
            {SHOW_AI_SUMMARY && applicant.notesSummary && (
              <div className="slideshow-summary">
                <div className="slideshow-summary-label">Summary</div>
                <p className="slideshow-summary-text">{applicant.notesSummary}</p>
              </div>
            )}
            <div className="slideshow-notes-header"><h3 className="slideshow-notes-title">Member Notes</h3></div>
            <div className="slideshow-notes-scroll">
              {allNotes.length === 0 ? (
                <div className="slideshow-no-notes"><p>No notes for this applicant yet</p></div>
              ) : (
                allNotes.map((dayGroup) => (
                  <div key={dayGroup.day} className="slideshow-day-group">
                    <div className="slideshow-day-label">Day {dayGroup.day}</div>
                    {dayGroup.entries.map((entry, idx) => (
                      <div key={idx} className="slideshow-note-entry">
                        <span className="slideshow-note-member">{entry.member}</span>
                        <span className="slideshow-note-text">{entry.text}</span>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <button className="slideshow-nav-arrow" onClick={goNext} disabled={currentIndex === orderedApplicants.length - 1}>&#8594;</button>
      </div>

      {/* Mobile nav */}
      <div className="slideshow-mobile-nav">
        <button onClick={goPrev} disabled={currentIndex === 0}>&#8592; Prev</button>
        <span>{currentIndex + 1} / {orderedApplicants.length}</span>
        <button onClick={goNext} disabled={currentIndex === orderedApplicants.length - 1}>Next &#8594;</button>
      </div>

      {/* Essay modal */}
      {modal.type === 'essay' && (
        <div className="slide-modal-overlay" onClick={() => setModal({ type: null })}>
          <div className="slide-modal" onClick={e => e.stopPropagation()}>
            <div className="slide-modal-header">
              <h3>{modal.title}</h3>
              <button className="slide-modal-close" onClick={() => setModal({ type: null })}>&times;</button>
            </div>
            <div className="slide-modal-body"><p>{modal.content}</p></div>
          </div>
        </div>
      )}

      {/* Manage modal */}
      {modal.type === 'manage' && (
        <div className="slide-modal-overlay" onClick={() => setModal({ type: null })}>
          <div className="slide-modal slide-modal-wide" onClick={e => e.stopPropagation()}>
            <div className="slide-modal-header">
              <h3>Manage Presentation ({presentationNames.length})</h3>
              <button className="slide-modal-close" onClick={() => setModal({ type: null })}>&times;</button>
            </div>
            <div className="slide-modal-body">
              {/* Add search */}
              <div className="slide-add-search-wrap">
                <input
                  ref={manageAddInputRef}
                  type="text"
                  className="slide-add-search-input"
                  placeholder="Add an applicant..."
                  value={manageAddSearch}
                  onChange={e => { setManageAddSearch(e.target.value); setManageAddOpen(true); }}
                  onFocus={() => setManageAddOpen(true)}
                  autoComplete="off"
                />
                {manageAddOpen && (
                  <div ref={manageAddDropdownRef} className="slide-add-dropdown">
                    {manageAddFiltered.length === 0 ? (
                      <div className="slide-add-dropdown-empty">No matching applicants</div>
                    ) : (
                      manageAddFiltered.slice(0, 8).map((a) => (
                        <div key={a.id} className="slide-add-dropdown-item" onClick={() => handleManageAdd(a.name)}>
                          {a.name}
                          {a.year && <span className="slide-add-dropdown-year">{a.year}</span>}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* Full list */}
              <div className="slide-manage-list">
                {presentationNames.map((name, idx) => {
                  const match = applicants.find(a => a.name.toLowerCase() === name.toLowerCase());
                  return (
                    <div key={idx} className={`slide-manage-item ${idx === currentIndex ? 'slide-manage-current' : ''}`}>
                      <span className="slide-manage-num">{idx + 1}</span>
                      <span className="slide-manage-name">{name}</span>
                      {match?.year && <span className="slide-manage-year">{match.year}</span>}
                      {!match && <span className="slide-manage-warn">not found</span>}
                      <button className="slide-manage-remove" onClick={() => handleManageRemove(idx)}>&times;</button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Slideshow;
