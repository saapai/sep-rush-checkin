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
}

const ApplicantAutocomplete: React.FC<ApplicantAutocompleteProps> = ({
  value,
  onChange,
  onSelect,
  onAddNew,
  placeholder = "Enter applicant name",
  disabled = false
}) => {
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [filteredApplicants, setFilteredApplicants] = useState<Applicant[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Airtable configuration
  const base = new Airtable({
    apiKey: import.meta.env.VITE_AIRTABLE_API_KEY
  }).base(import.meta.env.VITE_AIRTABLE_BASE_ID);

  // Fetch applicants from Airtable
  const fetchApplicants = async () => {
    try {
      setLoading(true);
      const records = await base("Rush Spring '26").select({
        fields: ['applicant_name'],
        maxRecords: 1000 // Adjust based on your needs
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

  // Filter applicants based on input
  const filterApplicants = (inputValue: string) => {
    if (!inputValue.trim()) {
      setFilteredApplicants([]);
      return;
    }

    const filtered = applicants.filter(applicant =>
      applicant.name.toLowerCase().includes(inputValue.toLowerCase())
    );
    setFilteredApplicants(filtered);
  };

  // Handle input change
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value;
    onChange(inputValue);
    filterApplicants(inputValue);
    setShowDropdown(inputValue.length > 0);
  };

  // Handle applicant selection
  const handleApplicantSelect = (applicant: Applicant) => {
    onChange(applicant.name);
    onSelect(applicant);
    setShowDropdown(false);
    setFilteredApplicants([]);
  };

  // Handle input focus
  const handleInputFocus = () => {
    if (value.length > 0) {
      filterApplicants(value);
      setShowDropdown(true);
    }
  };

  // Handle click outside to close dropdown
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

  // Fetch applicants on component mount
  useEffect(() => {
    fetchApplicants();
  }, []);

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

      {showDropdown && filteredApplicants.length > 0 && (
        <div ref={dropdownRef} className="autocomplete-dropdown">
          {filteredApplicants.map((applicant) => (
            <div
              key={applicant.id}
              className="autocomplete-option"
              onClick={() => handleApplicantSelect(applicant)}
            >
              {applicant.name}
            </div>
          ))}
        </div>
      )}

      {showDropdown && filteredApplicants.length === 0 && value.length > 0 && !loading && (
        <div ref={dropdownRef} className="autocomplete-dropdown">
          <div className="autocomplete-no-results">
            No applicants found
          </div>
          {onAddNew && (
            <div
              className="autocomplete-option add-new-option"
              onClick={() => {
                onAddNew(value);
                setShowDropdown(false);
              }}
            >
              + Add New Applicant: "{value}"
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ApplicantAutocomplete;
