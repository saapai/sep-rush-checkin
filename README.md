# Rush Check-In System

A web application for managing check-ins during SEP Recruitment. This system allows applicants to check in by taking a photo, which is then stored securely and linked to their applicant record.

### 1. Clone the repository
```bash
git clone https://github.com/rahulnanda15/sep-ats
cd app
```

### 2. Add API keys
Create a `.env` file in the root directory:
```env
VITE_AIRTABLE_API_KEY=your_airtable_api_key
VITE_AIRTABLE_BASE_ID=your_airtable_base_id
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_SUPABASE_BUCKET_NAME=your_bucket_name
```

### 3. Install dependencies
```bash
npm install
```

### 4. Run the development server
```bash
npm run dev
```