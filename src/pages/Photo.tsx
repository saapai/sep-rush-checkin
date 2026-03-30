import { useState, useEffect } from 'react';
import Webcam from '../components/Webcam';
import ApplicantAutocomplete from '../components/ApplicantAutocomplete';
import Airtable from 'airtable';
import {createClient } from '@supabase/supabase-js';
import './Photo.css';

interface PhotoProps {
  navigate?: (path: string) => void;
}

const Photo: React.FC<PhotoProps> = ({ navigate }) => {

  // Rush week: Mar 30 (Mon) – Apr 3 (Fri), 4am PT cutoff
  const getCurrDay = (): string => {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    const month = now.getMonth(); // 0-indexed, Mar=2, Apr=3
    const date = now.getDate();
    const hour = now.getHours();

    // Before 4am counts as previous calendar day
    let effectiveMonth = month;
    let effectiveDate = date;
    if (hour < 4) {
      const yesterday = new Date(now);
      yesterday.setDate(date - 1);
      effectiveMonth = yesterday.getMonth();
      effectiveDate = yesterday.getDate();
    }

    // Mar 30 = day_1, Mar 31 = day_2, Apr 1 = day_3, Apr 2 = day_4, Apr 3 = day_5
    if (effectiveMonth === 2 && effectiveDate === 30) return 'day_1';
    if (effectiveMonth === 2 && effectiveDate === 31) return 'day_2';
    if (effectiveMonth === 3 && effectiveDate === 1) return 'day_3';
    if (effectiveMonth === 3 && effectiveDate === 2) return 'day_4';
    if (effectiveMonth === 3 && effectiveDate === 3) return 'day_5';

    // Before rush week starts, default to day_1
    return 'day_1';
  };

  const currDay = getCurrDay();
  
  // Debug function to check available fields
  const debugAirtableFields = async () => {
    try {
      const records = await base("Rush Spring '26").select({
        maxRecords: 1
      }).all();
      
      if (records.length > 0) {
        const record = records[0];
        console.log('Available fields in Airtable:');
        console.log('Record fields:', Object.keys(record.fields));
        console.log('Day-related fields:', Object.keys(record.fields).filter(key => key.includes('day')));
        console.log('Current currDay value:', currDay);
        console.log('Does currDay field exist?', record.fields.hasOwnProperty(currDay));
      }
    } catch (error) {
      console.error('Error debugging Airtable fields:', error);
    }
  };

  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [rusheeName, setRusheeName] = useState<string>('');
  const [selectedYear, setSelectedYear] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [showWebcam, setShowWebcam] = useState<boolean>(false);
  const [isCheckingApplicant, setIsCheckingApplicant] = useState<boolean>(false);
  const [applicantExists, setApplicantExists] = useState<boolean>(false);
  const [applicantRecord, setApplicantRecord] = useState<any>(null);

  // Airtable configuration
  const base = new Airtable({
    apiKey: import.meta.env.VITE_AIRTABLE_API_KEY
  }).base(import.meta.env.VITE_AIRTABLE_BASE_ID);
  
  // Supabase configuration
  const supabase = createClient(
    import.meta.env.VITE_SUPABASE_URL, 
    import.meta.env.VITE_SUPABASE_ANON_KEY
  )

  async function uploadFile(imageDataUrl: string, fileName: string): Promise<string | null> {
    try {
      // Convert data URL to blob
      const response = await fetch(imageDataUrl);
      const blob = await response.blob();
      
      // Create a file from the blob
      const file = new File([blob], `${fileName}.png`, { type: 'image/png' });
      
      // Upload to Supabase storage
      const bucketName = import.meta.env.VITE_SUPABASE_BUCKET_NAME;
      const { data, error } = await supabase.storage
        .from(bucketName)
        .upload(`${fileName}-${Date.now()}.png`, file);
      
      if (error) {
        console.error('Error uploading file:', error);
        return null;
      }
      
      // Get the public URL
      const { data: urlData } = supabase.storage
        .from(bucketName)
        .getPublicUrl(data.path);
      
      console.log('File uploaded successfully:', data);
      console.log('Public URL:', urlData.publicUrl);
      
      return urlData.publicUrl;
    } catch (error) {
      console.error('Error in uploadFile:', error);
      return null;
    }
  }
  // Check if applicant exists and has photo
  const checkApplicant = async (name: string, yearOverride?: string, emailOverride?: string) => {
    setIsCheckingApplicant(true);
    
    // Debug Airtable fields on first check
    await debugAirtableFields();
    
    try {
      // Use override values if provided, otherwise use state values
      const yearToUse = yearOverride || selectedYear;
      const emailToUse = emailOverride || email;
      
      // Ensure we have a valid year before querying
      if (!yearToUse || yearToUse === '') {
        console.error('No year selected');
        alert('Please select a year');
        setIsCheckingApplicant(false);
        return;
      }
      
      console.log('Checking applicant:', name, 'with year:', yearToUse);
      
      let records;
      try {
        records = await base("Rush Spring '26").select({
          filterByFormula: `AND({applicant_name} = "${name}", {year} = ${parseInt(yearToUse)})`,
          maxRecords: 1
        }).all();
      } catch (filterError) {
        console.log('Filter formula failed, trying alternative approach:', filterError);
        // Fallback: get all records and filter manually
        const allRecords = await base("Rush Spring '26").select({
          filterByFormula: `{applicant_name} = "${name}"`,
          maxRecords: 100
        }).all();
        
        records = allRecords.filter(record => {
          const recordYear = record.get('year');
          return recordYear && parseInt(recordYear.toString()) === parseInt(yearToUse);
        });
      }
      
      // If no exact match found, try to find by name only (for cases where year/email is missing)
      if (records.length === 0) {
        console.log('No exact match found, searching by name only for missing data update');
        const nameOnlyRecords = await base("Rush Spring '26").select({
          filterByFormula: `{applicant_name} = "${name}"`,
          maxRecords: 1
        }).all();
        
        if (nameOnlyRecords.length > 0) {
          // Found by name only - this means we need to update existing record with missing data
          records = nameOnlyRecords;
        }
      }
      
      console.log('Found records:', records.length);
      

      if (records.length > 0) {
        const record = records[0];
        const photoField = record.get('photo');
        const yearField = record.get('year');
        const emailField = record.get('email');
        const statusField = record.get('status');
        
        console.log('Applicant name:', name);
        console.log('Record found:', record);
        console.log('Photo field raw:', photoField);
        console.log('Year field raw:', yearField);
        console.log('Email field raw:', emailField);
        console.log('Status field raw:', statusField);
        console.log('Photo field type:', typeof photoField);
        console.log('Is photo field truthy:', !!photoField);
        console.log('Is photo field not empty string:', photoField !== '');
        
        // Block rejected applicants, and block "not applied" starting day 3 (apps due end of day 2)
        const status = statusField ? statusField.toString().toLowerCase() : '';
        if (status === 'rejected') {
          alert(`Error with check-in: code 6969`);
          setIsCheckingApplicant(false);
          return;
        }
        if (status === 'not applied' && (currDay === 'day_3' || currDay === 'day_4' || currDay === 'day_5')) {
          alert(`Error with check-in: code 6969`);
          setIsCheckingApplicant(false);
          return;
        }

        // Check if already checked in today
        if (record.get(currDay)) {
          setRusheeName(name);
          setShowSuccess(true);
          setTimeout(() => {
            setShowSuccess(false);
            setRusheeName('');
            setSelectedYear('');
            setEmail('');
          }, 2000);
          setIsCheckingApplicant(false);
          return;
        }
        
        // Set the year and email from the existing record (or use provided values)
        if (yearField) {
          setSelectedYear(yearField.toString());
        } else {
          // Use the year from the form if the record doesn't have it
          setSelectedYear(yearToUse);
        }
        if (emailField) {
          setEmail(emailField.toString());
        } else {
          // Use the email from the form if the record doesn't have it
          setEmail(emailToUse);
        }
        
        // Check if photo field exists and is not empty
        if (photoField && photoField !== '' && photoField.toString().trim() !== '') {
          // Applicant exists and has photo - go to check-in success screen
          setApplicantExists(true);
          setApplicantRecord(record);
          
          // Update attendance for existing applicant
            try {
              // First, let's see what the actual field names are in this record
              console.log('=== DEBUGGING FIELD NAMES ===');
              console.log('All fields in record:', Object.keys(record.fields));
              console.log('Day-related fields:', Object.keys(record.fields).filter(key => key.toLowerCase().includes('day')));
              console.log('Looking for field:', currDay);
              console.log('Field exists?', record.fields.hasOwnProperty(currDay));
              
              // Try to update with the exact field name
              const updateResult = await base("Rush Spring '26").update(record.id, {
                [currDay]: true
              });
              
              console.log('Update result:', updateResult);
              console.log(`Successfully updated attendance for ${currDay}`);
              
              // Verify the update by fetching the record again
              const verifyRecord = await base("Rush Spring '26").find(record.id);
              console.log('Verification - day_4 field value:', verifyRecord.get(currDay));
              console.log('Verification - all fields:', Object.keys(verifyRecord.fields));
              
            } catch (error) {
              console.error('Error updating attendance:', error);
              console.error('Error details:', error instanceof Error ? error.message : String(error));
              alert(`Error updating attendance for ${currDay}. Please try again.`);
              setIsCheckingApplicant(false);
              return;
            }
          
          setShowSuccess(true);
          setTimeout(() => {
            setShowSuccess(false);
            setRusheeName('');
            setSelectedYear('');
            setEmail('');
            setApplicantExists(false);
            setApplicantRecord(null);
          }, 2000);
        } else {
          // Applicant exists but no photo - add/update record and take photo
          setApplicantExists(true);
          setApplicantRecord(record);
          setShowWebcam(true);
        }
      } else {
        // Applicant doesn't exist - will create new record when photo is taken
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

  // Handle submit button click
  const handleSubmit = (name: string) => {
    if (name.trim() === '') {
      alert('Please enter a rushee name');
      return;
    }
    if (selectedYear === '') {
      alert('Please select a year');
      return;
    }
    if (email.trim() === '') {
      alert('Please enter an email');
      return;
    }
    checkApplicant(name.trim());
  };

  const capturePhoto = () => {
    setIsCapturing(true);
    
    // Get the video element from the webcam component
    const video = document.querySelector('.webcam-video') as HTMLVideoElement;
    
    if (video && video.srcObject) {
      // Create a canvas to capture the frame
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      
      if (context) {
        // Set canvas dimensions to match video
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        
        // Draw the current video frame to canvas
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // Convert canvas to image data URL
        const imageDataUrl = canvas.toDataURL('image/png');
        setCapturedImage(imageDataUrl);
      }
    }
    
    setIsCapturing(false);
  };

  const savePhoto = async () => {
    if (capturedImage) {
      try {
        // Upload photo to Supabase and get public URL
        const publicUrl = await uploadFile(capturedImage, rusheeName);
        
        if (!publicUrl) {
          alert('Error uploading photo. Please try again.');
          return;
        }
        
        // Update Airtable with the Supabase public URL and mark attendance
        if (applicantExists && applicantRecord) {
          // Update existing record (including email and year if they were missing)
          const updateData: any = {
            'photo': publicUrl,
            [currDay]: true
          };
          
          // Only update year and email if they're provided
          if (selectedYear) {
            updateData['year'] = parseInt(selectedYear);
          }
          if (email) {
            updateData['email'] = email;
          }
          
          console.log('Updating existing record with data:', updateData);
          console.log(`Attempting to update field: ${currDay}`);
          console.log('Record ID:', applicantRecord.id);
          
          // Check if the field exists before updating
          const existingFields = Object.keys(applicantRecord.fields);
          console.log('Existing fields in record:', existingFields);
          console.log(`Field ${currDay} exists:`, existingFields.includes(currDay));
          
          await base("Rush Spring '26").update(applicantRecord.id, updateData);
          console.log('Successfully updated existing record');
        } else {
          // Create new record
          const createData = {
            'applicant_name': rusheeName,
            'photo': publicUrl,
            'year': parseInt(selectedYear),
            'email': email,
            'status': 'Not Applied',
            [currDay]: true
          };
          console.log('Creating new record with data:', createData);
          console.log('Current day variable:', currDay);
          console.log('Year value:', selectedYear, 'Parsed:', parseInt(selectedYear));
          console.log('Email value:', email);
          console.log(`Attempting to create record with field: ${currDay}`);
          
          try {
            await base("Rush Spring '26").create(createData);
            console.log('Successfully created new record');
          } catch (createError) {
            console.error('Error creating record:', createError);
            // If field doesn't exist, try with a different field name
            if (createError instanceof Error && createError.message && createError.message.includes('field')) {
              console.log('Field might not exist, trying alternative field names...');
              // Try common variations
              const alternatives = ['Day 4', 'day4', 'Day_4', 'DAY_4'];
              for (const altField of alternatives) {
                try {
                  const altCreateData: any = { ...createData };
                  delete altCreateData[currDay];
                  altCreateData[altField] = true;
                  console.log(`Trying with field name: ${altField}`);
                  await base("Rush Spring '26").create(altCreateData);
                  console.log(`Successfully created record with field: ${altField}`);
                  break;
                } catch (altError) {
                  console.log(`Failed with field name: ${altField}`, altError instanceof Error ? altError.message : String(altError));
                }
              }
            }
            throw createError;
          }
        }
        
        // Show success animation
        setShowSuccess(true);
        
        // Reset everything after 2 seconds
        setTimeout(() => {
          setCapturedImage(null);
          setShowSuccess(false);
          setShowWebcam(false);
          setRusheeName('');
          setSelectedYear('');
          setEmail('');
          setApplicantExists(false);
          setApplicantRecord(null);
        }, 2000);
        
      } catch (error) {
        console.error('Error saving to Airtable:', error);
        alert('Error saving check-in data. Please try again.');
        return;
      }
    }
  };

  const closeModal = () => {
    setCapturedImage(null);
  };

  const handleBack = () => {
    setShowWebcam(false);
    // Keep the rushee name so it appears in the input field
    setApplicantExists(false);
    setApplicantRecord(null);
  };

  const handleApplicantSelect = async (applicant: { id: string; name: string }) => {
    // When an applicant is selected from autocomplete, fetch their full record
    setRusheeName(applicant.name);
    
    try {
      // Fetch the full record to get year and email
      const records = await base("Rush Spring '26").select({
        filterByFormula: `{applicant_name} = "${applicant.name}"`,
        maxRecords: 1
      }).all();
      
      if (records.length > 0) {
        const record = records[0];
        const yearField = record.get('year');
        const emailField = record.get('email');
        
        // Set the year and email from the record
        let yearValue = '';
        let emailValue = '';
        
        if (yearField) {
          yearValue = yearField.toString();
          setSelectedYear(yearValue);
        }
        if (emailField) {
          emailValue = emailField.toString();
          setEmail(emailValue);
        }
        
        // Check if we have the required fields before proceeding
        if (yearValue && emailValue) {
          // Auto-submit after setting the values, passing the fetched values directly
          setTimeout(() => {
            checkApplicant(applicant.name.trim(), yearValue, emailValue);
          }, 100);
        } else {
          console.log('Missing year or email in record:', { yearValue, emailValue });
          // Don't auto-submit, let user fill in missing information manually
          // The form will remain open for them to complete
        }
      } else {
        console.log('No record found for applicant:', applicant.name);
        alert('No record found for this applicant. Please fill in manually.');
      }
    } catch (error) {
      console.error('Error fetching applicant details:', error);
      alert('Error fetching applicant details. Please fill in manually.');
    }
  };

  return (
    <div className="photo-page">
      <div className="photo-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', maxWidth: 600, margin: '0 auto' }}>
          <h1 style={{ margin: 0 }}>📸 Rush Check-In</h1>
          <a href="/dashboard" style={{ padding: '0.5rem 1.2rem', background: '#667eea', color: 'white', borderRadius: 8, textDecoration: 'none', fontWeight: 500, fontSize: '0.9rem' }}>Dashboard</a>
        </div>
      </div>

      <div className="photo-content">
        <div className="webcam-section">
          {!showWebcam ? (
            <div className="input-section">
              <label className="input-label">
                Applicant Name:
              </label>
              <div className="input-with-button">
                <ApplicantAutocomplete
                  value={rusheeName}
                  onChange={setRusheeName}
                  onSelect={handleApplicantSelect}
                  onAddNew={(name) => setRusheeName(name)}
                  placeholder="Enter applicant name"
                  disabled={isCheckingApplicant}
                />
                <button 
                  onClick={() => handleSubmit(rusheeName)}
                  disabled={isCheckingApplicant || rusheeName.trim() === '' || selectedYear === '' || email.trim() === ''}
                  className="submit-icon-button"
                >
                  {isCheckingApplicant ? '⟳' : '→'}
                </button>
              </div>
              
              <label className="input-label">
                Year:
              </label>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
                disabled={isCheckingApplicant}
                className="year-dropdown"
              >
                <option value="">Select Year</option>
                <option value="2026">2026</option>
                <option value="2027">2027</option>
                <option value="2028">2028</option>
                <option value="2029">2029</option>
              </select>
              
              <label className="input-label">
                Email:
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter email address"
                disabled={isCheckingApplicant}
                className="email-input"
              />

              <button
                onClick={() => handleSubmit(rusheeName)}
                disabled={isCheckingApplicant || rusheeName.trim() === '' || selectedYear === '' || email.trim() === ''}
                className="next-button"
              >
                {isCheckingApplicant ? 'Checking...' : 'Next'}
              </button>
            </div>
          ) : (
            <div className="rushee-display">
              <button 
                onClick={handleBack}
                className="back-button"
              >
                ←
              </button>
              <div className="rushee-name-display">
                {rusheeName}
              </div>
            </div>
          )}

          {showWebcam && (
            <div className="webcam-capture-container">
              <Webcam 
                width={window.innerWidth <= 768 ? 320 : 500} 
                height={window.innerWidth <= 768 ? 240 : 375} 
                autoStart={true} 
              />
              <button 
                onClick={capturePhoto}
                disabled={isCapturing}
                className="capture-button"
                title={isCapturing ? 'Capturing...' : 'Capture Photo'}
              >
              </button>
            </div>
          )}
        </div>

        {capturedImage && (
          <div className="modal-overlay" onClick={closeModal}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>{rusheeName}</h2>
                <button className="close-button" onClick={closeModal}>
                  ✕
                </button>
              </div>
              <div className="photo-preview">
                <img 
                  src={capturedImage} 
                  alt="Captured photo" 
                  className="captured-image"
                />
              </div>
              <div className="photo-actions">
                <button onClick={savePhoto} className="download-button">
                  💾 Check In
                </button>
              </div>
              
              {showSuccess && (
                <div className="success-overlay">
                  <div className="success-checkmark">
                    ✓
                  </div>
                  <div className="success-text">
                    Check In Successful!
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Success screen for existing applicants with photos */}
        {showSuccess && !capturedImage && (
          <div className="success-screen">
            <div className="success-content">
              <div className="success-checkmark">
                ✓
              </div>
              <div className="success-text">
                {rusheeName} is checked in!
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Photo;
