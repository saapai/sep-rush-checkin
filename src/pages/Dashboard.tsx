import { useState, useEffect } from 'react';
import Airtable from 'airtable';
import './Dashboard.css';

interface Applicant {
  id: string;
  name: string;
  email: string;
  year: number | null;
  photo: string;
  status: string;
  notes: string;
  day_1: boolean;
  day_2: boolean;
  day_3: boolean;
  day_4: boolean;
  day_5: boolean;
  elo: number;
  social: number;
  prof: number;
  weight: number;
  created_at: string;
}

const Dashboard: React.FC = () => {
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedApplicant, setSelectedApplicant] = useState<Applicant | null>(null);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortField, setSortField] = useState<string>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const base = new Airtable({
    apiKey: import.meta.env.VITE_AIRTABLE_API_KEY
  }).base(import.meta.env.VITE_AIRTABLE_BASE_ID);

  const fetchApplicants = async () => {
    setLoading(true);
    try {
      const records = await base("Rush Spring '26").select({
        maxRecords: 1000
      }).all();

      const data: Applicant[] = records
        .map(record => ({
          id: record.id,
          name: (record.get('applicant_name') as string) || '',
          email: (record.get('email') as string) || '',
          year: (record.get('year') as number) || null,
          photo: (record.get('photo') as string) || '',
          status: (record.get('status') as string) || '',
          notes: (record.get('notes') as string) || '',
          day_1: !!(record.get('day_1')),
          day_2: !!(record.get('day_2')),
          day_3: !!(record.get('day_3')),
          day_4: !!(record.get('day_4')),
          day_5: !!(record.get('day_5')),
          elo: (record.get('elo') as number) || 0,
          social: (record.get('social') as number) || 0,
          prof: (record.get('prof') as number) || 0,
          weight: (record.get('weight') as number) || 0,
          created_at: (record.get('created_at') as string) || '',
        }))
        .filter(a => a.name.trim() !== '');

      setApplicants(data);
    } catch (error) {
      console.error('Error fetching applicants:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchApplicants();
  }, []);

  const openNotes = (applicant: Applicant) => {
    setSelectedApplicant(applicant);
    setNoteText(applicant.notes);
  };

  const saveNote = async () => {
    if (!selectedApplicant) return;
    setSavingNote(true);
    try {
      await base("Rush Spring '26").update(selectedApplicant.id, {
        notes: noteText
      });
      setApplicants(prev =>
        prev.map(a =>
          a.id === selectedApplicant.id ? { ...a, notes: noteText } : a
        )
      );
      setSelectedApplicant(prev => prev ? { ...prev, notes: noteText } : null);
    } catch (error) {
      console.error('Error saving note:', error);
      alert('Error saving note. Please try again.');
    } finally {
      setSavingNote(false);
    }
  };

  const appendNote = async () => {
    if (!selectedApplicant || noteText.trim() === selectedApplicant.notes.trim()) return;
    await saveNote();
  };

  const getAttendanceCount = (a: Applicant) => {
    return [a.day_1, a.day_2, a.day_3, a.day_4, a.day_5].filter(Boolean).length;
  };

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const filteredApplicants = applicants
    .filter(a => {
      const matchesSearch = a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        a.email.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = statusFilter === 'all' || a.status.toLowerCase() === statusFilter.toLowerCase();
      return matchesSearch && matchesStatus;
    })
    .sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      switch (sortField) {
        case 'name': return dir * a.name.localeCompare(b.name);
        case 'year': return dir * ((a.year || 0) - (b.year || 0));
        case 'status': return dir * a.status.localeCompare(b.status);
        case 'attendance': return dir * (getAttendanceCount(a) - getAttendanceCount(b));
        case 'elo': return dir * (a.elo - b.elo);
        case 'social': return dir * (a.social - b.social);
        case 'prof': return dir * (a.prof - b.prof);
        default: return 0;
      }
    });

  const statuses = [...new Set(applicants.map(a => a.status).filter(Boolean))];

  const SortIcon = ({ field }: { field: string }) => {
    if (sortField !== field) return <span className="sort-icon">↕</span>;
    return <span className="sort-icon active">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  if (loading) {
    return (
      <div className="dashboard-page">
        <div className="dashboard-loading">Loading applicants...</div>
      </div>
    );
  }

  return (
    <div className="dashboard-page">
      <div className="dashboard-header">
        <div className="header-top">
          <h1>Rush Dashboard</h1>
          <a href="/" className="nav-link">Check-In</a>
        </div>
        <div className="dashboard-stats">
          <div className="stat-card">
            <div className="stat-number">{applicants.length}</div>
            <div className="stat-label">Total</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">{applicants.filter(a => a.photo).length}</div>
            <div className="stat-label">Checked In</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">{applicants.filter(a => a.day_1).length}</div>
            <div className="stat-label">Day 1</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">{applicants.filter(a => a.day_2).length}</div>
            <div className="stat-label">Day 2</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">{applicants.filter(a => a.day_3).length}</div>
            <div className="stat-label">Day 3</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">{applicants.filter(a => a.day_4).length}</div>
            <div className="stat-label">Day 4</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">{applicants.filter(a => a.day_5).length}</div>
            <div className="stat-label">Day 5</div>
          </div>
        </div>
      </div>

      <div className="dashboard-controls">
        <input
          type="text"
          className="search-input"
          placeholder="Search by name or email..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <select
          className="status-filter"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">All Statuses</option>
          {statuses.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <button className="refresh-button" onClick={fetchApplicants}>
          Refresh
        </button>
      </div>

      <div className="dashboard-table-container">
        <table className="dashboard-table">
          <thead>
            <tr>
              <th>Photo</th>
              <th className="sortable" onClick={() => handleSort('name')}>
                Name <SortIcon field="name" />
              </th>
              <th className="sortable" onClick={() => handleSort('year')}>
                Year <SortIcon field="year" />
              </th>
              <th>Email</th>
              <th className="sortable" onClick={() => handleSort('status')}>
                Status <SortIcon field="status" />
              </th>
              <th className="sortable" onClick={() => handleSort('attendance')}>
                Attendance <SortIcon field="attendance" />
              </th>
              <th>D1</th>
              <th>D2</th>
              <th>D3</th>
              <th>D4</th>
              <th>D5</th>
              <th className="sortable" onClick={() => handleSort('elo')}>
                Elo <SortIcon field="elo" />
              </th>
              <th className="sortable" onClick={() => handleSort('social')}>
                Social <SortIcon field="social" />
              </th>
              <th className="sortable" onClick={() => handleSort('prof')}>
                Prof <SortIcon field="prof" />
              </th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {filteredApplicants.map(applicant => (
              <tr key={applicant.id} className={`applicant-row ${applicant.status.toLowerCase().replace(/\s+/g, '-')}`}>
                <td className="photo-cell">
                  {applicant.photo ? (
                    <img src={applicant.photo} alt={applicant.name} className="applicant-photo" />
                  ) : (
                    <div className="no-photo">?</div>
                  )}
                </td>
                <td className="name-cell">{applicant.name}</td>
                <td>{applicant.year || '—'}</td>
                <td className="email-cell">{applicant.email || '—'}</td>
                <td>
                  <span className={`status-badge ${applicant.status.toLowerCase().replace(/\s+/g, '-')}`}>
                    {applicant.status || '—'}
                  </span>
                </td>
                <td className="attendance-count">{getAttendanceCount(applicant)}/5</td>
                <td>{applicant.day_1 ? '✓' : ''}</td>
                <td>{applicant.day_2 ? '✓' : ''}</td>
                <td>{applicant.day_3 ? '✓' : ''}</td>
                <td>{applicant.day_4 ? '✓' : ''}</td>
                <td>{applicant.day_5 ? '✓' : ''}</td>
                <td>{applicant.elo || '—'}</td>
                <td>{applicant.social || '—'}</td>
                <td>{applicant.prof || '—'}</td>
                <td>
                  <button className="notes-button" onClick={() => openNotes(applicant)}>
                    {applicant.notes ? '📝' : '➕'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filteredApplicants.length === 0 && (
        <div className="no-results">No applicants found.</div>
      )}

      {/* Notes Modal */}
      {selectedApplicant && (
        <div className="notes-modal-overlay" onClick={() => setSelectedApplicant(null)}>
          <div className="notes-modal" onClick={(e) => e.stopPropagation()}>
            <div className="notes-modal-header">
              <div className="notes-applicant-info">
                {selectedApplicant.photo && (
                  <img src={selectedApplicant.photo} alt={selectedApplicant.name} className="notes-photo" />
                )}
                <div>
                  <h2>{selectedApplicant.name}</h2>
                  <p>{selectedApplicant.email} · Class of {selectedApplicant.year || '?'}</p>
                  <span className={`status-badge ${selectedApplicant.status.toLowerCase().replace(/\s+/g, '-')}`}>
                    {selectedApplicant.status}
                  </span>
                </div>
              </div>
              <button className="close-button" onClick={() => setSelectedApplicant(null)}>✕</button>
            </div>

            <div className="notes-applicant-stats">
              <div className="mini-stat">Elo: {selectedApplicant.elo}</div>
              <div className="mini-stat">Social: {selectedApplicant.social}</div>
              <div className="mini-stat">Prof: {selectedApplicant.prof}</div>
              <div className="mini-stat">Weight: {selectedApplicant.weight}</div>
              <div className="mini-stat">
                Days: {[
                  selectedApplicant.day_1 && '1',
                  selectedApplicant.day_2 && '2',
                  selectedApplicant.day_3 && '3',
                  selectedApplicant.day_4 && '4',
                  selectedApplicant.day_5 && '5',
                ].filter(Boolean).join(', ') || 'None'}
              </div>
            </div>

            <div className="notes-content">
              <label className="notes-label">Notes</label>
              <textarea
                className="notes-textarea"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Add notes about this applicant..."
                rows={8}
              />
              <div className="notes-actions">
                <button
                  className="save-note-button"
                  onClick={appendNote}
                  disabled={savingNote || noteText.trim() === selectedApplicant.notes.trim()}
                >
                  {savingNote ? 'Saving...' : 'Save Notes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
