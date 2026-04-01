import Airtable from 'airtable';
import OpenAI from 'openai';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

let _openai;
function getOpenAI() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

const APP_TABLE = "Application Responses";

function getBase() {
  return new Airtable({ apiKey: process.env.VITE_AIRTABLE_API_KEY || process.env.AIRTABLE_API_KEY })
    .base(process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID);
}

const SUMMARY_PROMPT = `Write a quick snapshot of this applicant. Facts only.

Here is an example of the exact style and tone to match:

"Business Economics, class of 2029. Built a tutoring business from scratch in the San Gabriel Valley, working with students with ADHD — took them from failing to Bs and As. Program Management Intern at UCLA Residential Life, ran quarterly events, grew event awareness 300%. Rushing because he wants to "connect with like-minded people who aren't afraid to turn ideas into action." Describes himself as "sunshine and rainbows.""

Follow these rules exactly:
- Short sentences and fragments. Mix them up
- State what they did. Not what it means, not what it shows
- Use their exact words in quotes for why they're rushing and how they describe themselves
- Pick only the 3-4 most interesting or concrete things from their resume. Skip the generic stuff
- No adjectives about them as a person. No "strong", "driven", "passionate", "impressive", "active"
- No "She is a..." or "He has a..." openers. Just jump into the facts
- No GPA. No semicolons. No markdown
- End with how they describe themselves in their own words

Output only the snapshot, nothing else.`;

async function fetchResumeText(resumeAttachments) {
  if (!resumeAttachments || resumeAttachments.length === 0) return null;

  const url = resumeAttachments[0].url;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
    let text = '';
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map(item => item.str).join(' ') + '\n';
    }
    return text.trim() || null;
  } catch (e) {
    console.error('Resume extraction error:', e.message);
    return null;
  }
}

async function summarizeApplicant(recordId) {
  const base = getBase();
  const record = await base(APP_TABLE).find(recordId);
  const fields = record.fields;

  const name = fields.applicant_name || 'Unknown';
  if (!name || name === 'Unknown') throw new Error('Record has no applicant_name');

  const major = fields.major_minor || '';
  const year = fields.year || '';
  const gpa = fields.GPA || '';
  const whySep = fields.why_sep || '';
  const drive = fields.drive || '';
  const describeYourself = fields.describe_yourself || '';
  const portfolio = fields['Portfolio, Website, Github, etc.'] || '';
  const resumeAttachments = fields.resume || [];

  const resumeText = await fetchResumeText(resumeAttachments);

  let context = `Applicant: ${name}`;
  if (year) context += `\nYear: ${year}`;
  if (major) context += `\nMajor: ${major}`;
  if (gpa) context += `\nGPA: ${gpa}`;
  if (describeYourself) context += `\nDescribes themselves as: ${describeYourself}`;
  if (whySep) context += `\n\nWhy they want to join SEP:\n${whySep}`;
  if (drive) context += `\n\nWhat drives them / what they're most proud of:\n${drive}`;
  if (portfolio) context += `\nPortfolio/Links: ${portfolio}`;
  if (resumeText) {
    context += `\n\nResume text:\n${resumeText.slice(0, 4000)}`;
  } else {
    context += `\n\n(No resume uploaded or could not be read)`;
  }

  const completion = await getOpenAI().chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: SUMMARY_PROMPT },
      { role: 'user', content: context },
    ],
    max_tokens: 250,
    temperature: 0.3,
  });

  const summary = completion.choices[0]?.message?.content || '';

  await base(APP_TABLE).update(recordId, { application_summary: summary });

  // Mark as "Applied" in the Rush table
  const email = (fields.email || '').trim().toLowerCase();
  try {
    const RUSH_TABLE = "Rush Spring '26";
    // Try to find by name first, then by email
    let rushRecords = await base(RUSH_TABLE).select({
      maxRecords: 1,
      filterByFormula: `LOWER({applicant_name}) = "${name.toLowerCase().replace(/"/g, '\\"')}"`,
    }).all();

    if (rushRecords.length === 0 && email) {
      rushRecords = await base(RUSH_TABLE).select({
        maxRecords: 1,
        filterByFormula: `LOWER({email}) = "${email.replace(/"/g, '\\"')}"`,
      }).all();
    }

    if (rushRecords.length > 0) {
      const rushRecord = rushRecords[0];
      if (rushRecord.get('status') !== 'Applied') {
        await base(RUSH_TABLE).update(rushRecord.id, { status: 'Applied' });
      }
    }
  } catch (e) {
    console.error('Failed to update Rush status for', name, e.message);
  }

  return { name, summary, hadResume: !!resumeText };
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { record_id, run_all } = req.method === 'POST' ? (req.body || {}) : (req.query || {});

  try {
    // Single record
    if (record_id) {
      const result = await summarizeApplicant(record_id);
      return res.status(200).json({ ok: true, ...result });
    }

    // All unsummarized records
    if (run_all === 'true') {
      const base = getBase();
      const records = await base(APP_TABLE).select({
        maxRecords: 200,
        filterByFormula: `AND({applicant_name} != "", {application_summary} = "", YEAR(Created) = 2026)`,
      }).all();

      const results = [];
      for (const r of records) {
        try {
          const result = await summarizeApplicant(r.id);
          results.push(result);
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (e) {
          results.push({ name: r.get('applicant_name'), error: e.message });
        }
      }

      return res.status(200).json({ ok: true, processed: results.length, results });
    }

    // Webhook: Airtable automation sends { record: { id: "recXXX" } }
    if (req.method === 'POST' && req.body?.record) {
      const rid = typeof req.body.record === 'string' ? req.body.record : req.body.record.id;
      const result = await summarizeApplicant(rid);
      return res.status(200).json({ ok: true, ...result });
    }

    return res.status(400).json({ error: 'Provide record_id, run_all=true, or POST with record' });
  } catch (e) {
    console.error('Summarize error:', e);
    return res.status(500).json({ error: e.message });
  }
}
