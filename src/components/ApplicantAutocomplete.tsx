import { useState, useEffect, useRef } from 'react';
import Airtable from 'airtable';
import './ApplicantAutocomplete.css';

interface Applicant {
  id: string;
  name: string;
}

interface ApplicantAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onSelect: (applicant: Applicant) => void;
  onAddNew?: (name: string) => void;
  placeholder?: string;
  disabled?: boolean;
  extraApplicants?: Applicant[];
}

const ApplicantAutocomplete: React.FC<ApplicantAutocompleteProps> = ({
  value,
  onChange,
  onSelect,
  onAddNew,
  placeholder = "Enter applicant name",
  disabled = false,
  extraApplicants = []
}) => {
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const base = new Airtable({
    apiKey: import.meta.env.VITE_AIRTABLE_API_KEY
  }).base(import.meta.env.VITE_AIRTABLE_BASE_ID);

  const fetchApplicants = async () => {
    try {
      setLoading(true);
      const records = await base("Rush Spring '26").select({
        fields: ['applicant_name'],
        maxRecords: 1000
      }).all();

      const applicantList = records
        .map(record => ({
          id: record.id,
          name: record.get('applicant_name') as string
        }))
        .filter(applicant => applicant.name && applicant.name.trim() !== '')
        .sort((a, b) => a.name.localeCompare(b.name));

      setApplicants(applicantList);
    } catch (error) {
      console.error('Error fetching applicants:', error);
    } finally {
      setLoading(false);
    }
  };

  const getAllApplicants = (): Applicant[] => {
    const airtableNames = new Set(applicants.map(a => a.name.toLowerCase()));
    const extras = extraApplicants.filter(a => !airtableNames.has(a.name.toLowerCase()));
    return [...applicants, ...extras].sort((a, b) => a.name.localeCompare(b.name));
  };

  const getFiltered = (): Applicant[] => {
    const all = getAllApplicants();
    if (!value.trim()) return all;
    const query = value.toLowerCase();
    return all.filter(a => a.name.toLowerCase().includes(query));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
    setShowDropdown(true);
  };

  const handleApplicantSelect = (applicant: Applicant) => {
    onChange(applicant.name);
    onSelect(applicant);
    setShowDropdown(false);
  };

  const handleInputFocus = () => {
    setShowDropdown(true);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    fetchApplicants();
  }, []);

  const filtered = getFiltered();
  const hasQuery = value.trim().length > 0;
  const exactMatch = hasQuery && filtered.some(a => a.name.toLowerCase() === value.trim().toLowerCase());

  // All styles inline to guarantee they render correctly regardless of CSS cascade
  const dropdownStyle: React.CSSProperties = {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    backgroundColor: '#ffffff',
    color: '#1a1a1a',
    border: '1.5px solid #e2e2e2',
    borderTop: 'none',
    borderRadius: '0 0 10px 10px',
    maxHeight: '240px',
    overflowY: 'auto',
    zIndex: 1000,
    boxShadow: '0 8px 24px rgba(0,0,0,0.1)',
    colorScheme: 'light',
  };

  const optionStyle = (id: string): React.CSSProperties => ({
    padding: '0.65rem 1rem',
    cursor: 'pointer',
    color: '#1a1a1a',
    backgroundColor: hoveredId === id ? '#f0f0f0' : '#ffffff',
    fontSize: '0.93rem',
    borderBottom: '1px solid #f0f0f0',
    transition: 'background-color 0.15s ease',
  });

  const addNewStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.7rem 1rem',
    cursor: 'pointer',
    color: '#1a1a1a',
    backgroundColor: hoveredId === 'add-new' ? '#eee' : '#f8f8f8',
    fontSize: '0.93rem',
    fontWeight: 500,
    borderTop: '1px solid #e8e8e8',
    position: 'sticky' as const,
    bottom: 0,
    transition: 'background-color 0.15s ease',
  };

  const addNewIconStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px',
    height: '20px',
    borderRadius: '50%',
    backgroundColor: '#111',
    color: '#fff',
    fontSize: '0.8rem',
    fontWeight: 700,
    flexShrink: 0,
  };

  const noResultsStyle: React.CSSProperties = {
    padding: '0.6rem 1rem',
    color: '#888',
    fontSize: '0.85rem',
    textAlign: 'center',
  };

  return (
    <div className="autocomplete-container" style={{ position: 'relative', width: '100%' }}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={handleInputChange}
        onFocus={handleInputFocus}
        placeholder={placeholder}
        disabled={disabled}
        className="autocomplete-input"
        autoComplete="off"
      />

      {loading && (
        <div style={{ ...dropdownStyle, padding: '0.75rem 1rem', textAlign: 'center', color: '#888', fontSize: '0.9rem' }}>
          Loading applicants...
        </div>
      )}

      {showDropdown && !loading && (
        <div ref={dropdownRef} style={dropdownStyle}>
          {filtered.length === 0 && hasQuery && (
            <>
              {onAddNew && (
                <div
                  style={{ ...addNewStyle, borderTop: 'none' }}
                  onClick={() => { onAddNew(value); setShowDropdown(false); }}
                  onMouseEnter={() => setHoveredId('add-new')}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  <span style={addNewIconStyle}>+</span>
                  <span style={{ color: '#1a1a1a' }}>Add "<strong>{value}</strong>"</span>
                </div>
              )}
              <div style={noResultsStyle}>No matching applicants</div>
            </>
          )}

          {filtered.map((applicant) => (
            <div
              key={applicant.id}
              style={optionStyle(applicant.id)}
              onClick={() => handleApplicantSelect(applicant)}
              onMouseEnter={() => setHoveredId(applicant.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              {applicant.name}
            </div>
          ))}

          {filtered.length > 0 && hasQuery && !exactMatch && onAddNew && (
            <div
              style={addNewStyle}
              onClick={() => { onAddNew(value); setShowDropdown(false); }}
              onMouseEnter={() => setHoveredId('add-new')}
              onMouseLeave={() => setHoveredId(null)}
            >
              <span style={addNewIconStyle}>+</span>
              <span style={{ color: '#1a1a1a' }}>Add "<strong>{value}</strong>"</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ApplicantAutocomplete;
