import { useState } from 'react';
import Webcam from '../components/Webcam';
import ApplicantAutocomplete from '../components/ApplicantAutocomplete';
import Airtable from 'airtable';
import { createClient } from '@supabase/supabase-js';
import './Photo.css';

interface PhotoProps {
  navigate?: (path: string) => void;
}

const base = new Airtable({
  apiKey: import.meta.env.VITE_AIRTABLE_API_KEY
}).base(import.meta.env.VITE_AIRTABLE_BASE_ID);

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const TABLE = "Rush Spring '26";

const MEMBERS = [
  'Allie Young', 'Eden Tan', 'Lindsey Lee', 'Giancarlo Novelli', 'Jayson Tian',
  'Sidney Muntean', 'Abby Kearny', 'Anish Thalamati', 'Anusha Chatterjee',
  'Franco Cachay', 'Quinn Kiefer', 'Kareena Gupta-Martinez', 'Sofia Barajas',
  'Theo Luu', 'Valerie Fan', 'Ash Barett', 'Arushi Gupta', 'Mahi Ghia',
  'Sophie Liu', 'Anirudh Chatterjee', 'Annika Danne', 'Charlotte Chiang',
  'Cheryl Wu', 'Huixi Lee', 'Leilani Pradis', 'Edward Ke', 'Ming Lo',
  'Layla AlGhamdi', 'Brandon Bao', 'Dilnar Yu', 'Jonathan Gossaye', 'Elise Wu',
  'Samantha Waugh', 'Natalie Tan', 'Yashas Shashidara', 'Amanda Lee',
  'Aryan Dutta Baruah', 'Saathvik Pai', 'Kit He', 'Rahul Nanda', 'Ved Vedere',
  'Sonali Vaid', 'Barima Adusei-Poku', 'Ruhaan Mahindru', 'Fiona Macleitch',
  'Kera Chang', 'Sharan Subramanian', 'Kevin He', 'Armaan Bassi', 'Joanna Bui',
  'Beck Peterson', 'Elijah Bautista', 'Joseph Wang', 'Gary Li', 'Anannya Shah',
  'Anirudh Kishore', 'Darren Le', 'Evan Rose', 'Harrison Nguyen',
  'Henry Mcnamara', 'Maddie Kuan', 'Matthew Hun', 'Sophia Bao', 'Tyler Kastenholz',
];

const MEMBER_APPLICANTS = MEMBERS.map(name => ({ id: `member-${name}`, name }));

const getCurrDay = (): string => {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const month = now.getMonth();
  const date = now.getDate();
  const hour = now.getHours();
  let effectiveMonth = month;
  let effectiveDate = date;
  if (hour < 4) {
    const yesterday = new Date(now);
    yesterday.setDate(date - 1);
    effectiveMonth = yesterday.getMonth();
    effectiveDate = yesterday.getDate();
  }
  if (effectiveMonth === 2 && effectiveDate === 30) return 'day_1';
  if (effectiveMonth === 2 && effectiveDate === 31) return 'day_2';
  if (effectiveMonth === 3 && effectiveDate === 1) return 'day_3';
  if (effectiveMonth === 3 && effectiveDate === 2) return 'day_4';
  if (effectiveMonth === 3 && effectiveDate === 3) return 'day_5';
  return 'day_1';
};

const Photo: React.FC<PhotoProps> = ({ navigate }) => {
  const currDay = getCurrDay();
  const dayNum = currDay.replace('day_', '');

  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [rusheeName, setRusheeName] = useState('');
  const [selectedYear, setSelectedYear] = useState('');
  const [email, setEmail] = useState('');
  const [showWebcam, setShowWebcam] = useState(false);
  const [isCheckingApplicant, setIsCheckingApplicant] = useState(false);
  const [applicantExists, setApplicantExists] = useState(false);
  const [applicantRecord, setApplicantRecord] = useState<any>(null);

  async function uploadFile(imageDataUrl: string, fileName: string): Promise<string | null> {
    try {
      const response = await fetch(imageDataUrl);
      const blob = await response.blob();
      const file = new File([blob], `${fileName}.png`, { type: 'image/png' });
      const bucketName = import.meta.env.VITE_SUPABASE_BUCKET_NAME;
      const { data, error } = await supabase.storage
        .from(bucketName)
        .upload(`${fileName}-${Date.now()}.png`, file);
      if (error) return null;
      const { data: urlData } = supabase.storage.from(bucketName).getPublicUrl(data.path);
      return urlData.publicUrl;
    } catch {
      return null;
    }
  }

  const showSuccessAnimation = (message: string) => {
    setSuccessMessage(message);
    setShowSuccess(true);
    setTimeout(() => {
      setShowSuccess(false);
      setSuccessMessage('');
      setCapturedImage(null);
      setShowWebcam(false);
      setRusheeName('');
      setSelectedYear('');
      setEmail('');
      setApplicantExists(false);
      setApplicantRecord(null);
    }, 2000);
  };

  const checkApplicant = async (name: string, yearOverride?: string, emailOverride?: string) => {
    setIsCheckingApplicant(true);
    try {
      const yearToUse = yearOverride || selectedYear;
      const emailToUse = emailOverride || email;
      if (!yearToUse) { setIsCheckingApplicant(false); return; }

      let records;
      try {
        records = await base(TABLE).select({
          filterByFormula: `AND({applicant_name} = "${name}", {year} = ${parseInt(yearToUse)})`,
          maxRecords: 1
        }).all();
      } catch {
        const allRecords = await base(TABLE).select({
          filterByFormula: `{applicant_name} = "${name}"`,
          maxRecords: 100
        }).all();
        records = allRecords.filter(r => {
          const y = r.get('year');
          return y && parseInt(y.toString()) === parseInt(yearToUse);
        });
      }

      if (records.length === 0) {
        const nameOnly = await base(TABLE).select({
          filterByFormula: `{applicant_name} = "${name}"`,
          maxRecords: 1
        }).all();
        if (nameOnly.length > 0) records = nameOnly;
      }

      if (records.length > 0) {
        const record = records[0];
        const photoField = record.get('photo');
        const statusField = record.get('status');
        const status = statusField ? statusField.toString().toLowerCase() : '';

        if (status === 'rejected') {
          alert('Error with check-in: code 6969');
          setIsCheckingApplicant(false);
          return;
        }
        if (status === 'not applied' && (currDay === 'day_3' || currDay === 'day_4' || currDay === 'day_5')) {
          alert('Error with check-in: code 6969');
          setIsCheckingApplicant(false);
          return;
        }

        if (record.get(currDay)) {
          setRusheeName(name);
          showSuccessAnimation(`${name} already checked in!`);
          setIsCheckingApplicant(false);
          return;
        }

        const yearField = record.get('year');
        const emailField = record.get('email');
        if (yearField) setSelectedYear(yearField.toString());
        else setSelectedYear(yearToUse);
        if (emailField) setEmail(emailField.toString());
        else setEmail(emailToUse);

        if (photoField && photoField !== '' && photoField.toString().trim() !== '') {
          setApplicantExists(true);
          setApplicantRecord(record);
          await base(TABLE).update(record.id, { [currDay]: true });
          showSuccessAnimation(`${name} is checked in!`);
        } else {
          setApplicantExists(true);
          setApplicantRecord(record);
          setShowWebcam(true);
        }
      } else {
        setApplicantExists(false);
        setApplicantRecord(null);
        setShowWebcam(true);
      }
    } catch (error) {
      console.error('Error checking applicant:', error);
      alert('Error checking applicant. Please try again.');
    } finally {
      setIsCheckingApplicant(false);
    }
  };

  const handleSubmit = () => {
    if (!rusheeName.trim() || !selectedYear || !email.trim()) return;
    checkApplicant(rusheeName.trim());
  };

  const capturePhoto = () => {
    setIsCapturing(true);
    const video = document.querySelector('.webcam-video') as HTMLVideoElement;
    if (video && video.srcObject) {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (ctx) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        setCapturedImage(canvas.toDataURL('image/png'));
      }
    }
    setIsCapturing(false);
  };

  const savePhoto = async () => {
    if (!capturedImage) return;
    try {
      const publicUrl = await uploadFile(capturedImage, rusheeName);
      if (!publicUrl) { alert('Error uploading photo. Please try again.'); return; }

      if (applicantExists && applicantRecord) {
        const updateData: any = { photo: publicUrl, [currDay]: true };
        if (selectedYear) updateData.year = parseInt(selectedYear);
        if (email) updateData.email = email;
        await base(TABLE).update(applicantRecord.id, updateData);
      } else {
        await base(TABLE).create({
          applicant_name: rusheeName,
          photo: publicUrl,
          year: parseInt(selectedYear),
          email: email,
          status: 'Not Applied',
          [currDay]: true
        });
      }
      showSuccessAnimation(`${rusheeName} is checked in!`);
    } catch (error) {
      console.error('Error saving:', error);
      alert('Error saving check-in data. Please try again.');
    }
  };

  const handleApplicantSelect = async (applicant: { id: string; name: string }) => {
    // If a member is selected, navigate to dashboard
    if (applicant.id.startsWith('member-')) {
      if (navigate) navigate('/dashboard');
      return;
    }

    setRusheeName(applicant.name);
    try {
      const records = await base(TABLE).select({
        filterByFormula: `{applicant_name} = "${applicant.name}"`,
        maxRecords: 1
      }).all();
      if (records.length > 0) {
        const record = records[0];
        const yearField = record.get('year');
        const emailField = record.get('email');
        let yearValue = '', emailValue = '';
        if (yearField) { yearValue = yearField.toString(); setSelectedYear(yearValue); }
        if (emailField) { emailValue = emailField.toString(); setEmail(emailValue); }
        if (yearValue && emailValue) {
          setTimeout(() => checkApplicant(applicant.name.trim(), yearValue, emailValue), 100);
        }
      }
    } catch (error) {
      console.error('Error fetching applicant:', error);
    }
  };

  const formReady = rusheeName.trim() !== '' && selectedYear !== '' && email.trim() !== '';

  return (
    <div className="photo-page">
      {/* Success overlay */}
      {showSuccess && (
        <div className="success-screen">
          <div className="success-content">
            <div className="success-checkmark">✓</div>
            <div className="success-text">{successMessage}</div>
          </div>
        </div>
      )}

      <div className="photo-container">
        <div className="photo-nav">
          <span className="day-badge">Day {dayNum}</span>
        </div>

        <h1 className="photo-title">Rush Check-In</h1>

        {!showWebcam ? (
          <div className="form-card">
            <div className="form-group">
              <label className="form-label">Name</label>
              <ApplicantAutocomplete
                value={rusheeName}
                onChange={setRusheeName}
                onSelect={handleApplicantSelect}
                onAddNew={(name) => setRusheeName(name)}
                placeholder="Search or add new..."
                disabled={isCheckingApplicant}
                extraApplicants={MEMBER_APPLICANTS}
              />
            </div>

            <div className="form-row">
              <div className="form-group form-group-half">
                <label className="form-label">Year</label>
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(e.target.value)}
                  disabled={isCheckingApplicant}
                  className="form-select"
                >
                  <option value="">Select</option>
                  <option value="2026">2026</option>
                  <option value="2027">2027</option>
                  <option value="2028">2028</option>
                  <option value="2029">2029</option>
                </select>
              </div>
              <div className="form-group form-group-half">
                <label className="form-label">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="email@ucla.edu"
                  disabled={isCheckingApplicant}
                  className="form-input"
                />
              </div>
            </div>

            <button
              onClick={handleSubmit}
              disabled={!formReady || isCheckingApplicant}
              className="form-submit"
            >
              {isCheckingApplicant ? 'Checking...' : 'Check In'}
            </button>
          </div>
        ) : (
          <div className="camera-card">
            <div className="camera-header">
              <button onClick={() => { setShowWebcam(false); setApplicantExists(false); setApplicantRecord(null); }} className="camera-back">
                ← Back
              </button>
              <span className="camera-name">{rusheeName}</span>
            </div>
            <div className="camera-body">
              <Webcam
                width={window.innerWidth <= 768 ? 300 : 440}
                height={window.innerWidth <= 768 ? 225 : 330}
                autoStart={true}
              />
              <button
                onClick={capturePhoto}
                disabled={isCapturing}
                className="shutter-button"
              >
                <div className="shutter-inner" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Photo confirm modal */}
      {capturedImage && (
        <div className="modal-overlay" onClick={() => setCapturedImage(null)}>
          <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
            <img src={capturedImage} alt="Captured" className="confirm-image" />
            <div className="confirm-name">{rusheeName}</div>
            <div className="confirm-actions">
              <button onClick={() => setCapturedImage(null)} className="confirm-retake">Retake</button>
              <button onClick={savePhoto} className="confirm-save">Check In</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Photo;
