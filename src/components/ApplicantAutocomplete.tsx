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

  // Merge Airtable + extra applicants, deduplicated
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

  return (
    <div className="autocomplete-container">
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
        <div className="autocomplete-loading">
          Loading applicants...
        </div>
      )}

      {showDropdown && !loading && (
        <div ref={dropdownRef} className="autocomplete-dropdown">
          {filtered.length === 0 && hasQuery && (
            <>
              {onAddNew && (
                <div
                  className="autocomplete-option add-new-option"
                  onClick={() => {
                    onAddNew(value);
                    setShowDropdown(false);
                  }}
                >
                  <span className="add-new-icon">+</span>
                  <span>Add "<strong>{value}</strong>"</span>
                </div>
              )}
              <div className="autocomplete-no-results">
                No matching applicants
              </div>
            </>
          )}

          {filtered.map((applicant) => (
            <div
              key={applicant.id}
              className="autocomplete-option"
              onClick={() => handleApplicantSelect(applicant)}
            >
              {applicant.name}
            </div>
          ))}

          {filtered.length > 0 && hasQuery && !exactMatch && onAddNew && (
            <div
              className="autocomplete-option add-new-option"
              onClick={() => {
                onAddNew(value);
                setShowDropdown(false);
              }}
            >
              <span className="add-new-icon">+</span>
              <span>Add "<strong>{value}</strong>"</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ApplicantAutocomplete;
