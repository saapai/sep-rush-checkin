import Airtable from 'airtable';
import OpenAI from 'openai';

export const config = {
  maxDuration: 60,
};

const TABLE = "Rush Spring '26";
const FROM_NUMBER = '+17139626862';

// SEP Member directory — phone number → name
const MEMBER_DIRECTORY = {
  '+13853687238': 'Saathvik', '+19175288704': 'Aryan', '+14259790010': 'Abby',
  '+18588293100': 'Kevin', '+13038450766': 'Quinn', '+18573964806': 'Rahul',
  '+13105717011': 'Ani', '+13235091761': 'Johnathan', '+14088051435': 'Arushi',
  '+13105008359': 'Lindsey', '+18588374987': 'Elijah', '+15083175184': 'Kit',
  '+19252971911': 'Sharan', '+13108737200': 'Huixi', '+14244660408': 'Layla',
  '+15102196504': 'Beck', '+14086490769': 'Joanna', '+18189299990': 'Dilnar',
  '+13105059297': 'Barima', '+14438963819': 'Allie', '+13232706359': 'Kera',
  '+14259791041': 'Sonali', '+13105971118': 'Elise', '+15058199928': 'Ming',
  '+18184398818': 'Mark', '+19253369249': 'Yashas', '+19259008019': 'Gary',
  '+14155359656': 'Sophie', '+15108993006': 'Brandon', '+19132938404': 'Ash',
  '+16573637311': 'Sidney', '+13103673514': 'Joseph', '+14692741037': 'Natalie',
  '+19734376074': 'Armaan', '+14086685541': 'Edward', '+14698290081': 'Mahi',
  '+14244075337': 'Ruhaan', '+19967574792': 'Ruhaan', '+16508636891': 'Anusha',
  '+13107808121': 'Charlotte', '+14249770401': 'Unknown', '+17606930594': 'Leilani',
  '+13609314664': 'Simon', '+14087636262': 'Henry', '+18585275611': 'Tyler',
  '+16505186293': 'Sophia', '+13104866781': 'Anannya', '+16508899373': 'Ani',
  '+16503461001': 'Evan', '+19494669092': 'Maddie', '+16577240606': 'Darren',
  '+15596531293': 'Matthew', '+16264786106': 'Harrison', '+14152718271': 'Fiona',
  '+16196435215': 'Franco',
};

function getMemberName(phoneNumber) {
  const normalized = phoneNumber.replace(/[\s\-\(\)]/g, '');
  if (MEMBER_DIRECTORY[normalized]) return MEMBER_DIRECTORY[normalized];
  if (!normalized.startsWith('+') && MEMBER_DIRECTORY[`+1${normalized}`]) return MEMBER_DIRECTORY[`+1${normalized}`];
  const last10 = normalized.replace(/^\+?1?/, '').slice(-10);
  for (const [phone, name] of Object.entries(MEMBER_DIRECTORY)) {
    if (phone.replace(/^\+?1?/, '').slice(-10) === last10) return name;
  }
  return '';
}

// --- Message queue & dedup ---
const processedHandles = new Map();
function isHandleDuplicate(id) {
  if (!id) return false;
  if (processedHandles.has(id)) return true;
  processedHandles.set(id, Date.now());
  for (const [k, v] of processedHandles) {
    if (Date.now() - v > 60000) processedHandles.delete(k);
  }
  return false;
}

// Per-sender message queue — ensures every message gets addressed
const senderQueues = new Map();
function getSenderQueue(sender) {
  if (!senderQueues.has(sender)) {
    senderQueues.set(sender, { processing: false, pending: [] });
  }
  return senderQueues.get(sender);
}

function stripMarkdown(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '- ');
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function getBase() {
  return new Airtable({ apiKey: process.env.VITE_AIRTABLE_API_KEY })
    .base(process.env.VITE_AIRTABLE_BASE_ID);
}

// --- SendBlue helpers ---

async function sbAPI(method, path, body) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'sb-api-key-id': process.env.SENDBLUE_API_KEY,
      'sb-api-secret-key': process.env.SENDBLUE_API_SECRET,
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`https://api.sendblue.com${path}`, opts);
  return res.json();
}

async function markRead(number) {
  return sbAPI('POST', '/api/mark-read', { number, from_number: FROM_NUMBER });
}

async function sendTyping(number) {
  return sbAPI('POST', '/api/send-typing-indicator', { number, from_number: FROM_NUMBER });
}

async function sendReaction(messageId, reaction) {
  return sbAPI('POST', '/api/send-reaction', { reaction, message_id: messageId });
}

async function sendReply(to, content, mediaUrl) {
  const payload = { number: to, from_number: FROM_NUMBER, content };
  if (mediaUrl) payload.media_url = mediaUrl;
  const res = await sbAPI('POST', '/api/send-message', payload);
  if (res.error_message && res.error_message.includes('not authorized')) {
    const fallback = { number: to, content };
    if (mediaUrl) fallback.media_url = mediaUrl;
    return sbAPI('POST', '/api/send-message', fallback);
  }
  return res;
}

async function getMessageHistory(number) {
  const data = await sbAPI('GET', `/api/v2/messages?number=${encodeURIComponent(number)}&limit=20`);
  if (!data.data || !Array.isArray(data.data)) return { messages: [], hasOutbound: true }; // Default true to prevent false first-message triggers
  const hasOutbound = data.data.some(m => m.is_outbound);
  const messages = data.data
    .filter(m => m.content && m.content.trim())
    .sort((a, b) => new Date(a.date_sent) - new Date(b.date_sent))
    .map(m => ({
      role: m.is_outbound ? 'assistant' : 'user',
      content: m.content,
    }));
  return { messages, hasOutbound };
}

// --- Airtable helpers ---

async function getAllApplicants() {
  const base = getBase();
  const records = await base(TABLE).select({ maxRecords: 1000 }).all();
  return records
    .map(r => ({
      id: r.id,
      name: (r.get('applicant_name')) || '',
      email: (r.get('email')) || '',
      year: r.get('year') || null,
      status: (r.get('status')) || '',
      day_1: !!r.get('day_1'), day_2: !!r.get('day_2'), day_3: !!r.get('day_3'),
      day_4: !!r.get('day_4'), day_5: !!r.get('day_5'),
      elo: r.get('elo') || 0, social: r.get('social') || 0,
      prof: r.get('prof') || 0, weight: r.get('weight') || 0,
      scoresRaw: (r.get('scores_raw')) || '{}',
      notes: (r.get('notes')) || '',
      notesSummary: (r.get('notes_summary')) || '',
      photoUrl: (r.get('photo')) || '',
    }))
    .filter(a => a.name.trim() !== '');
}

function fuzzyMatch(applicants, query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  // Exact full name match
  const exact = applicants.filter(a => a.name.toLowerCase() === q);
  if (exact.length >= 1) return exact;
  // First + last combo match
  const includes = applicants.filter(a => a.name.toLowerCase().includes(q) || q.includes(a.name.toLowerCase()));
  if (includes.length >= 1) return includes;
  // Word-level match
  const qWords = q.split(/\s+/);
  const wordMatch = applicants.filter(a => {
    const nameWords = a.name.toLowerCase().split(/\s+/);
    return qWords.some(qw => nameWords.some(nw => nw.includes(qw) || qw.includes(nw)));
  });
  return wordMatch;
}

async function appendNotes(applicant, memberName, newNotes) {
  const base = getBase();
  const currDay = getCurrDay();
  const dayLabel = `Day ${currDay.num}`;
  const entry = `[${memberName} — ${dayLabel}]: ${newNotes}`;
  const updatedNotes = applicant.notes ? `${applicant.notes}\n${entry}` : entry;

  let summary = applicant.notesSummary || '';
  try {
    const sumCompletion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: `Summarize rush notes about a college applicant for a business fraternity. 3-4 sentences max, plain text:
- Overall sentiment (positive/mixed/negative)
- Social fit (vibe, engagement, social skills)
- Professional fit (substance, projects, ambition)
- Standout details or red flags
No markdown. Be direct.` },
        { role: 'user', content: `Summarize notes about ${applicant.name}:\n\n${updatedNotes}` },
      ],
      max_tokens: 150,
      temperature: 0.3,
    });
    summary = sumCompletion.choices[0]?.message?.content || summary;
  } catch (e) {
    console.error('Summary error:', e.message);
  }

  await base(TABLE).update(applicant.id, {
    notes: updatedNotes,
    notes_summary: summary,
  });

  return { updatedNotes, summary };
}

function recomputeFromRaw(scoresRawStr) {
  let raw = {};
  try { raw = JSON.parse(scoresRawStr || '{}'); } catch { raw = {}; }
  const entries = Object.values(raw);
  if (entries.length === 0) return { social: 0, prof: 0, elo: 0, weight: 0 };
  const totalSocial = entries.reduce((sum, e) => sum + (e.s || 0), 0);
  const totalProf = entries.reduce((sum, e) => sum + (e.p || 0), 0);
  const weight = entries.length;
  const social = totalSocial / weight;
  const prof = totalProf / weight;
  const elo = (social + prof) / 2;
  return { social, prof, elo, weight };
}

async function updateScores(applicant, memberName, socialNew, profNew) {
  const base = getBase();
  const oldSocial = applicant.social || 0;
  const oldProf = applicant.prof || 0;
  const oldWeight = applicant.weight || 0;

  // Try to load per-member tracking (scores_raw may not exist in Airtable)
  let raw = {};
  try { raw = JSON.parse(applicant.scoresRaw || '{}'); } catch { raw = {}; }
  const isUpdate = !!raw[memberName];

  let newSocial, newProf, newWeight;

  if (isUpdate) {
    // Re-rating: remove old contribution, add new (weight stays same)
    const oldS = raw[memberName].s || 0;
    const oldP = raw[memberName].p || 0;
    newWeight = oldWeight;
    if (oldWeight <= 1) {
      newSocial = socialNew;
      newProf = profNew;
    } else {
      newSocial = (oldSocial * oldWeight - oldS + socialNew) / oldWeight;
      newProf = (oldProf * oldWeight - oldP + profNew) / oldWeight;
    }
  } else {
    // New rating: standard weighted average
    newWeight = oldWeight + 1;
    newSocial = (oldSocial * oldWeight + socialNew) / newWeight;
    newProf = (oldProf * oldWeight + profNew) / newWeight;
  }

  const newElo = (newSocial + newProf) / 2;

  // Write ONLY existing Airtable fields (no scores_raw to avoid silent failure)
  await base(TABLE).update(applicant.id, {
    social: Math.round(newSocial * 1000) / 1000,
    prof: Math.round(newProf * 1000) / 1000,
    elo: Math.round(newElo * 1000) / 1000,
    weight: newWeight,
  });
  console.log(`Airtable updated: ${applicant.name} → social=${newSocial.toFixed(3)} prof=${newProf.toFixed(3)} elo=${newElo.toFixed(3)} weight=${newWeight}`);

  // Try to update scores_raw separately (field may not exist)
  raw[memberName] = { s: socialNew, p: profNew };
  try {
    await base(TABLE).update(applicant.id, { scores_raw: JSON.stringify(raw) });
  } catch (e) {
    console.log('scores_raw update skipped (field may not exist):', e.message);
  }

  return { social: newSocial, prof: newProf, elo: newElo, weight: newWeight, isUpdate };
}

async function editMemberNotes(applicant, memberName, newContent) {
  const base = getBase();
  const notes = applicant.notes || '';
  const lines = notes.split('\n');
  // Remove all entries by this member
  const filtered = lines.filter(l => !l.startsWith(`[${memberName} `));
  // Add new entry
  const currDay = getCurrDay();
  const entry = `[${memberName} — Day ${currDay.num}]: ${newContent}`;
  filtered.push(entry);
  const updatedNotes = filtered.filter(l => l.trim()).join('\n');

  // Regenerate summary
  let summary = '';
  try {
    const sumCompletion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: `Summarize rush notes about a college applicant for a business fraternity. 3-4 sentences max, plain text. No markdown.` },
        { role: 'user', content: `Summarize notes about ${applicant.name}:\n\n${updatedNotes}` },
      ],
      max_tokens: 150,
      temperature: 0.3,
    });
    summary = sumCompletion.choices[0]?.message?.content || '';
  } catch (e) {
    console.error('Summary error:', e.message);
  }

  await base(TABLE).update(applicant.id, { notes: updatedNotes, notes_summary: summary });
  return { updatedNotes, summary };
}

async function deleteMemberNotes(applicant, memberName) {
  const base = getBase();
  const notes = applicant.notes || '';
  const lines = notes.split('\n');
  const filtered = lines.filter(l => !l.startsWith(`[${memberName} `));
  const updatedNotes = filtered.filter(l => l.trim()).join('\n');

  let summary = '';
  if (updatedNotes.trim()) {
    try {
      const sumCompletion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: `Summarize rush notes about a college applicant for a business fraternity. 3-4 sentences max, plain text. No markdown.` },
          { role: 'user', content: `Summarize notes about ${applicant.name}:\n\n${updatedNotes}` },
        ],
        max_tokens: 150,
        temperature: 0.3,
      });
      summary = sumCompletion.choices[0]?.message?.content || '';
    } catch (e) {
      console.error('Summary error:', e.message);
    }
  }

  await base(TABLE).update(applicant.id, { notes: updatedNotes, notes_summary: summary });
  return { updatedNotes, summary };
}

async function deleteMemberScores(applicant, memberName) {
  const base = getBase();
  let raw = {};
  try { raw = JSON.parse(applicant.scoresRaw || '{}'); } catch { raw = {}; }
  if (!raw[memberName]) return null;

  const oldS = raw[memberName].s || 0;
  const oldP = raw[memberName].p || 0;
  delete raw[memberName];

  const oldWeight = applicant.weight || 0;
  const oldSocial = applicant.social || 0;
  const oldProf = applicant.prof || 0;

  let newSocial = 0, newProf = 0, newElo = 0, newWeight = Math.max(0, oldWeight - 1);
  if (newWeight > 0) {
    newSocial = (oldSocial * oldWeight - oldS) / newWeight;
    newProf = (oldProf * oldWeight - oldP) / newWeight;
    newElo = (newSocial + newProf) / 2;
  }

  await base(TABLE).update(applicant.id, {
    social: Math.round(newSocial * 1000) / 1000,
    prof: Math.round(newProf * 1000) / 1000,
    elo: Math.round(newElo * 1000) / 1000,
    weight: newWeight,
  });

  try {
    await base(TABLE).update(applicant.id, { scores_raw: JSON.stringify(raw) });
  } catch (e) {
    console.log('scores_raw update skipped:', e.message);
  }

  return { social: newSocial, prof: newProf, elo: newElo, weight: newWeight };
}

function buildApplicantSummary(applicants) {
  if (applicants.length === 0) return 'No applicants registered yet.';
  const total = applicants.length;
  const d1 = applicants.filter(a => a.day_1).length;
  const d2 = applicants.filter(a => a.day_2).length;
  const d3 = applicants.filter(a => a.day_3).length;
  const d4 = applicants.filter(a => a.day_4).length;
  const d5 = applicants.filter(a => a.day_5).length;
  const statuses = {};
  applicants.forEach(a => { const s = a.status || 'Unknown'; statuses[s] = (statuses[s] || 0) + 1; });
  const statusStr = Object.entries(statuses).map(([k, v]) => `${k}: ${v}`).join(', ');

  let summary = `CURRENT RUSH DATA (${total} total applicants):\n`;
  summary += `Attendance — D1: ${d1}, D2: ${d2}, D3: ${d3}, D4: ${d4}, D5: ${d5}\n`;
  summary += `Statuses — ${statusStr}\n\n`;

  // Split applicants: those with notes/scores get detailed entries, rest get compact list
  const withData = applicants.filter(a => a.notes || a.elo || a.weight);
  const withoutData = applicants.filter(a => !a.notes && !a.elo && !a.weight);

  if (withData.length > 0) {
    summary += `APPLICANTS WITH NOTES/SCORES:\n`;
    withData.sort((a, b) => a.name.localeCompare(b.name)).forEach(a => {
      const days = [a.day_1, a.day_2, a.day_3, a.day_4, a.day_5];
      const dayList = days.map((d, i) => d ? `D${i+1}` : '').filter(Boolean).join(',');
      let line = `\n${a.name}`;
      if (a.year) line += ` (${a.year})`;
      if (a.email) line += ` | ${a.email}`;
      line += ` | ${a.status || 'Unknown'}`;
      if (dayList) line += ` | Days: ${dayList}`;
      line += ` | Photo: ${a.photoUrl ? 'yes' : 'no'}`;
      if (a.weight) line += `\n  Scores: ${a.social.toFixed?.(1) ?? a.social}s / ${a.prof.toFixed?.(1) ?? a.prof}p / ${a.elo.toFixed?.(1) ?? a.elo} elo (${a.weight} ratings)`;
      if (a.notesSummary) line += `\n  Summary: ${a.notesSummary}`;
      if (a.notes) line += `\n  Raw notes:\n  ${a.notes.replace(/\n/g, '\n  ')}`;
      summary += line + '\n';
    });
  }

  if (withoutData.length > 0) {
    summary += `\nALL OTHER APPLICANTS:\n`;
    withoutData.sort((a, b) => a.name.localeCompare(b.name)).forEach(a => {
      const days = [a.day_1, a.day_2, a.day_3, a.day_4, a.day_5];
      const dayList = days.map((d, i) => d ? `D${i+1}` : '').filter(Boolean).join(',');
      let line = `- ${a.name}`;
      if (a.year) line += ` (${a.year})`;
      if (a.email) line += ` | ${a.email}`;
      line += ` | ${a.status || 'Unknown'}`;
      if (dayList) line += ` | ${dayList}`;
      if (a.photoUrl) line += ` | has photo`;
      summary += line + '\n';
    });
  }

  return summary;
}

function getCurrDay() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const month = now.getMonth();
  const date = now.getDate();
  const hour = now.getHours();
  let em = month, ed = date;
  if (hour < 4) { const y = new Date(now); y.setDate(date - 1); em = y.getMonth(); ed = y.getDate(); }
  if (em === 2 && ed === 30) return { day: 'day_1', num: 1, name: 'Meet the Chapter' };
  if (em === 2 && ed === 31) return { day: 'day_2', num: 2, name: 'Social Night' };
  if (em === 3 && ed === 1) return { day: 'day_3', num: 3, name: 'Professional Night' };
  if (em === 3 && ed === 2) return { day: 'day_4', num: 4, name: 'Coffee Chats' };
  if (em === 3 && ed === 3) return { day: 'day_5', num: 5, name: 'Final Interviews' };
  if (em === 3 && ed === 4) return { day: null, num: 6, name: 'Final Deliberations' };
  return { day: 'day_1', num: 1, name: 'Meet the Chapter' };
}

// --- System prompt ---

const RUSH_CONTEXT = `You are Friday — SEP's (Sigma Eta Pi) rush bot, a sharp and casually witty iMessage assistant for Spring 2026 rush at UCLA. You text like a real person: lowercase, contractions, short messages. Dry humor with a pinch of clever — never over the top. Incredibly helpful and proactive.

You help SEP members with:
- Looking up rushee/applicant info (names, attendance, scores, notes, status)
- Rush schedule, rules, logistics, and timeline
- Collecting notes and ratings on rushees (updates Airtable + dashboard in real time)
- Conversation guidelines, sample questions, and interview prep
- Attendance tracking and real-time stats
- The check-in app, dashboard, and Airtable workflow

PERSONALITY:
- Dry humor, not corny. Witty one-liners, not joke-telling.
- Incredibly helpful — always answer the question first, then add value.
- Proactive — if someone asks about today's event, also mention what they should wear or bring.
- Concise — iMessage length. No essays. Break into multiple short lines if needed.
- Use emojis sparingly and only when natural.
- Be aware of the CURRENT TIME and DAY. Reference it naturally.

FORMATTING RULES (CRITICAL):
- NEVER use markdown formatting. No asterisks, no bold, no italic, no headers, no backticks. Plain text only — this is iMessage.
- NEVER end messages with filler like "let me know if you need anything else!" or "anything else you need?" — just end naturally.
- Use dashes (-) for lists, never asterisks or bullets.

FIRST MESSAGE BEHAVIOR:
- If there is NO conversation history (first time texting), introduce yourself and give today's rush info.
- You already know who's texting from the member directory — greet them by name if available.

DATA ACCESS:
The applicant data below is LIVE from Airtable — fetched fresh every message. It includes full raw notes (with member attribution), AI summaries, scores, attendance, emails, and photo status. You can answer ANY query about ANY applicant using this data. When asked about notes, quote the raw notes with attribution (who said what). When asked about scores, use the real numbers. The data is the single source of truth.

NOTES & SCORING SYSTEM:
Members text notes about rushees → you save them to Airtable with tags → then ask for ratings.
READ ACCESS: Members can query ANY applicant data (name, attendance, scores, notes, status — everything).
WRITE ACCESS: Members can only modify THEIR OWN notes and scores. They cannot edit another member's contributions.

CRITICAL TAG RULES:
- Tags are INVISIBLE to the user — they get stripped from your reply before sending.
- Your visible reply text must make sense WITHOUT the tags. Do NOT structure your reply around the tags.
- Put ALL tags at the very START of your reply, BEFORE your visible text.
- NEVER repeat the notes content in your visible text — the user already knows what they wrote.
- Always use the FULL NAME of the applicant in all tags, exactly as it appears in the applicant list.

1. SAVING NOTES: When a member shares feedback about rushees, wrap each person's notes in tags. Use EXACTLY this format:
   [SAVE_NOTES:Firstname Lastname]notes here[/SAVE_NOTES]
   Multiple people: [SAVE_NOTES:Firstname Lastname]notes[/SAVE_NOTES][SAVE_NOTES:Another Person]notes[/SAVE_NOTES]
   IMPORTANT: Use [SAVE_NOTES:] with the underscore and bracket-style closing tags. NOT colon-separated.
   After all tags, just write "got it" or similar — the system auto-generates a pretty confirmation with all names and rating prompts. Do NOT write your own confirmation or list names.

2. ASKING FOR RATINGS: The system auto-generates rating prompts after notes are saved. You do NOT need to ask for ratings — it's handled automatically. Just put the tags and a short "got it" or similar.

3. SAVING SCORES: When the user gives ratings, put ALL score tags first, then just say "locked in":
   [SAVE_SCORES:Firstname Lastname:4:3][SAVE_SCORES:Another Person:5:4]locked in
   The system auto-appends the real elo tally from Airtable. Do NOT write your own tally.
   Scores are tracked per-member. If they re-rate someone, their old score is replaced (not stacked).

4. EDITING OWN NOTES: If a member wants to change/replace their previous notes on someone:
   [EDIT_MY_NOTES:Full Name Here]the replacement notes[/EDIT_MY_NOTES]
   This replaces only THEIR notes, not other members' notes.

5. DELETING OWN NOTES: If a member wants to remove their notes:
   [DELETE_MY_NOTES:Full Name Here]
   This removes only THEIR notes, not other members' notes.

6. DELETING OWN SCORES: If a member wants to remove their rating:
   [DELETE_MY_SCORES:Full Name Here]

7. PERMISSION ENFORCEMENT:
   - A member can only edit/delete THEIR OWN notes and scores
   - If someone asks to change another member's notes, refuse: "you can only edit your own notes"
   - If someone asks to see raw notes, show all notes with attribution (who said what)
   - Scores show the composite average — individual member scores are private

8. PARSING FLEXIBLE SCORE FORMATS:
   - "4 3 5 2" with 2 people → social=[4,3] prof=[5,2]
   - "social 4 3 prof 5 2" → same
   - "3 4" with 1 person → social=3, prof=4

9. NAME DISAMBIGUATION: ONLY disambiguate when the name the user typed matches multiple applicants in the data above.
   - Check the APPLICANT DETAILS data. If the user's text matches only ONE person, use their full name — no disambiguation needed.
   - A first name that is unique among all applicants is NOT ambiguous.
   - A last name shared by 2+ applicants IS ambiguous if the user only typed the last name.
   - When disambiguation IS needed:
     - Do NOT save/edit/delete anything
     - Ask which one, listing the full names
     - Include: [CLARIFY_PHOTOS:Full Name 1|Full Name 2]
   This applies to ALL operations: lookups, notes, scores, edits, deletes.

10. DIVERSIONS: If the user changes topic while you're waiting for ratings:
   - Answer their question first
   - Then remind: "btw still need ratings for [name] — social and prof 1-5?"

11. OTHER: If notes don't specify who, ask. When looking up someone with notes, show the notes_summary.

PHOTO INSTRUCTIONS:
- EVERY TIME you give info about ONE specific applicant, include: [PHOTO:Full Name]
- Place it at the END of your reply on its own line.
- Do NOT use photo tags when listing multiple people or clarifying.

REACTION INSTRUCTIONS:
- If the message deserves a reaction, start with: [REACT:love] or [REACT:like] or [REACT:laugh] or [REACT:emphasize] or [REACT:question]
- Only when it genuinely fits.

RUSH SCHEDULE:
Day 1 — Meet the Chapter (3/30): 6:30 PM - 12:00 AM, Pauley Pavilion → Hitch Suites, Rush T-Shirts + casual
  6:15-6:30 setup, 6:30-7:10 directing/checking in, 7:10-7:30 speeches + active intros, 7:30-9:00 group interviews/networking
Day 2 — Social Night (3/31): 6:30 PM - TBD, Pauley Pavilion → TBD, Casual
  6:30-6:45 setup, 6:45-7:10 check-in, 7:10-7:20 speech (Mahi then Lindsey), 7:20-7:40 activity, 7:40-9:00 group interviews
Day 3 — Professional Night (4/1): 6:30 PM - TBD, Kerchoff Grand Salon → TBD, Business Professional
  6:30-6:45 setup, 6:45-7:10 check-in, 7:10-7:20 speech (Lance Ding), 7:20-7:40 activity, 7:40-9:00 group interviews
Day 4 — Coffee Chats (4/2): 6:30 PM - TBD, Engineering IV Patio → TBD, Casual
  6:15-6:30 setup, 6:30-7:10 check-in, 7:10-9:00 1-on-1 coffee chats with assigned pairings
Day 5 — Final Interviews (4/3): 11:00 AM - 6:00 PM, John Wooden Center, Business Professional
  30-minute interview blocks
Day 6 — Final Deliberations (4/4): 10:00 AM - 6:00 PM, SAC, Dress to impress (INTERNAL — members only)

CHECK-IN SYSTEM & TOOLS:
- Rush Check-In Page: https://sep-ats.vercel.app/
- Rush Dashboard: https://sep-ats.vercel.app/dashboard
- Airtable (full data): https://airtable.com/invite/l?inviteId=invgz3AQC2Y0QrVyo&inviteToken=539996ea83e3725cfecdce431877eb34316ef68a2fd79bf96cd4be166fcb9fb8
- The check-in app auto-detects rush day with 4 AM PT cutoff.
- Rejected rushees blocked from check-in. "Not Applied" blocked starting Day 3.
- Anyone texting this number is an SEP member — be fully transparent.

RUSH RULES:
- Don't say: "pledge", "pledge masters", "drop/ped"
- Don't talk about drugs/alcohol
- If asked about retreats/concerts: "fun vibes with your brothers — music, dancing, hanging out"
- Don't talk about pledge process. If asked: "there's an onboarding quarter equivalent to an internship / extra class."
- DO NOT: give final interview tips, show favorites, be mean/rude/disrespectful

CONVERSATION GUIDELINES:
Group Convos: observe social fit — respectful, engaging, listening?
1-on-1 Convos: informal grill sessions, dig deep. Come out with a vouch FOR or AGAINST.
Key Lookouts: buzzword BS (overuse of "AI", "blockchain" — ask specifics), overcoming implicit bias.

DELIBERATION PROCESS:
1-5 ranking: 1=don't want, 2=not impressive, 3=neutral, 4=like them, 5=bid them.
Social Night delibs: top 30% / middle 40% / bottom 30%, vouches, 3+2 min, ~100 continue.
Professional Night: 30s slides + 3+2 min delibs, no abstaining, ~50 continue.
Coffee Chats: 30s slides + 4+3 min, those who chatted speak first, ~28 to finals.
Final Delibs: all reviewed, no hard time limit.
Must attend 3/4 rush days for finals. Must attend final delibs.

SAMPLE INTERVIEW QUESTIONS:
Self-awareness: main strength/weakness, 3 words to describe personality, what stresses you out
Teamwork: favorite community, best team, what makes a good leader
Values/Motivation: what inspires you, green flags in friends, ideal weekend, TED talk topic
Entrepreneurship: what attracts you, how do you demonstrate it, company you're inspired by
Fun: favorite Halloween costume, hot take, Spotify playlist, tell me about your summer`;

// --- Handler ---

async function processMessage({ content, sender, message_handle }) {
  try {
    markRead(sender).catch(() => {});
    sendTyping(sender).catch(() => {});

    const [historyResult, applicants] = await Promise.all([
      getMessageHistory(sender),
      getAllApplicants(),
    ]);
    const history = historyResult.messages;

    const currDay = getCurrDay();
    const now = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
    const isFirstMessage = !historyResult.hasOutbound;
    const knownName = getMemberName(sender);

    console.log(`From ${knownName || sender} | history: ${history.length} | first: ${isFirstMessage}`);

    const systemPrompt = `${RUSH_CONTEXT}

CURRENT TIME (Pacific): ${now}
CURRENT RUSH DAY: Day ${currDay.num} — ${currDay.name}
${knownName ? `MEMBER TEXTING: ${knownName}` : 'UNKNOWN MEMBER'}
${isFirstMessage ? 'THIS IS THEIR FIRST MESSAGE EVER — follow FIRST MESSAGE BEHAVIOR.' : ''}

${buildApplicantSummary(applicants)}`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-15),
    ];

    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.role !== 'user' || lastMsg.content !== content) {
      messages.push({ role: 'user', content });
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      max_tokens: 2500,
      temperature: 0.7,
    });

    let reply = completion.choices[0]?.message?.content || "hmm something went wrong, try again?";
    console.log(`GPT raw: ${reply.substring(0, 300)}`);

    // --- Parse ALL tags (handle both [SAVE_NOTES:] and [SAVENOTES:] formats) ---
    const reactMatch = reply.match(/^\[REACT:(love|like|dislike|laugh|emphasize|question)\]\s*/i);
    // Format 1: [SAVE_NOTES:Name]content[/SAVE_NOTES] or [SAVENOTES:Name]content[/SAVENOTES]
    const bracketNotesMatches = [...reply.matchAll(/\[SAVE_?NOTES:(.+?)\]([\s\S]*?)\[\/SAVE_?NOTES\]/gi)];
    // Format 2: [SAVENOTES:Name:content] (colon-separated, no closing tag)
    const colonNotesMatches = [...reply.matchAll(/\[SAVE_?NOTES:([^:\]]+):([^\]]+)\]/gi)];
    // Merge both formats, avoiding duplicates
    const allNotesMatches = [...bracketNotesMatches];
    for (const m of colonNotesMatches) {
      const name = m[1].trim();
      const isDupe = allNotesMatches.some(existing => existing[1].trim().toLowerCase() === name.toLowerCase());
      if (!isDupe) allNotesMatches.push(m);
    }
    const allScoresMatches = [...reply.matchAll(/\[SAVE_?SCORES:(.+?):(\d):(\d)\]/gi)];
    const allEditNotesMatches = [...reply.matchAll(/\[EDIT_MY_NOTES:(.+?)\]([\s\S]*?)\[\/EDIT_MY_NOTES\]/gi)];
    const allDeleteNotesMatches = [...reply.matchAll(/\[DELETE_MY_NOTES:(.+?)\]/gi)];
    const allDeleteScoresMatches = [...reply.matchAll(/\[DELETE_MY_SCORES:(.+?)\]/gi)];
    const clarifyMatch = reply.match(/\[CLARIFY_PHOTOS:(.+?)\]/i);
    const photoMatch = reply.match(/\[PHOTO:(.+?)\]/i);

    console.log(`Tags: notes=${allNotesMatches.length} scores=${allScoresMatches.length} editNotes=${allEditNotesMatches.length} delNotes=${allDeleteNotesMatches.length} photo=${!!photoMatch} clarify=${!!clarifyMatch}`);

    // Strip all tags from reply (handle all format variants)
    if (reactMatch) reply = reply.replace(reactMatch[0], '').trim();
    // Strip bracket-style notes: [SAVE_NOTES:Name]content[/SAVE_NOTES] and [SAVENOTES:Name]content[/SAVENOTES]
    reply = reply.replace(/\[SAVE_?NOTES:(.+?)\]([\s\S]*?)\[\/SAVE_?NOTES\]/gi, '').trim();
    // Strip colon-style notes: [SAVENOTES:Name:content] and [SAVE_NOTES:Name:content]
    reply = reply.replace(/\[SAVE_?NOTES:[^\]]+\]/gi, '').trim();
    // Strip score tags (both formats)
    reply = reply.replace(/\[SAVE_?SCORES:[^\]]+\]/gi, '').trim();
    for (const m of allEditNotesMatches) reply = reply.replace(m[0], '').trim();
    for (const m of allDeleteNotesMatches) reply = reply.replace(m[0], '').trim();
    for (const m of allDeleteScoresMatches) reply = reply.replace(m[0], '').trim();
    if (clarifyMatch) reply = reply.replace(clarifyMatch[0], '').trim();
    if (photoMatch) reply = reply.replace(photoMatch[0], '').trim();
    reply = reply.replace(/\[SET_NAME:.+?\]/gi, '').trim();
    reply = reply.replace(/\[SCORE_SUMMARY\]/gi, '').trim();

    // --- Execute actions ---
    if (reactMatch && message_handle) {
      sendReaction(message_handle, reactMatch[1].toLowerCase()).catch(e => console.error('React err:', e));
    }

    const memberName = knownName || sender;
    let serverClarifyNames = [];

    // Save notes — collect results for pretty confirmation
    const savedNotes = [];
    const failedNotes = [];
    for (const notesMatch of allNotesMatches) {
      const notesName = notesMatch[1].trim();
      const notesContent = notesMatch[2].trim();
      if (!notesContent) continue;
      const matches = fuzzyMatch(applicants, notesName);
      if (matches.length === 1) {
        try {
          await appendNotes(matches[0], memberName, notesContent);
          savedNotes.push(matches[0].name);
          console.log(`Notes saved: ${matches[0].name} by ${memberName}`);
        } catch (e) {
          failedNotes.push(notesName);
          console.error(`Notes err ${notesName}:`, e.message);
        }
      } else if (matches.length > 1) {
        console.log(`Ambiguous "${notesName}": ${matches.map(m => m.name).join(', ')}`);
        matches.forEach(m => { if (!serverClarifyNames.includes(m.name)) serverClarifyNames.push(m.name); });
        reply += `\n\nhold on — which ${notesName}? ${matches.map(m => m.name).join(' or ')}?`;
      } else {
        failedNotes.push(notesName);
        console.log(`No match: "${notesName}"`);
      }
    }

    // Build pretty confirmation for saved notes (overrides GPT reply)
    if (savedNotes.length > 0) {
      const firstNames = savedNotes.map(n => n.split(' ')[0].toLowerCase());
      let prettyReply = `notes locked in for ${savedNotes.length} rushee${savedNotes.length > 1 ? 's' : ''}:\n`;
      savedNotes.forEach(name => {
        prettyReply += `- ${name}\n`;
      });
      prettyReply += `\nrate em 1-5 (1=red flag, 5=amazing)\nsocial: ${firstNames.join(', ')}\nprof: ${firstNames.join(', ')}`;
      if (failedNotes.length > 0) {
        prettyReply += `\n\ncouldn't find: ${failedNotes.join(', ')} — double check the names?`;
      }
      reply = prettyReply;
    }

    // Save scores + build server-side tally
    const scoreResults = [];
    for (const scoresMatch of allScoresMatches) {
      const scoreName = scoresMatch[1].trim();
      const socialScore = parseInt(scoresMatch[2]);
      const profScore = parseInt(scoresMatch[3]);
      const matches = fuzzyMatch(applicants, scoreName);
      if (matches.length === 1 && socialScore >= 1 && socialScore <= 5 && profScore >= 1 && profScore <= 5) {
        try {
          const result = await updateScores(matches[0], memberName, socialScore, profScore);
          console.log(`Scores: ${matches[0].name} by ${memberName} elo=${result.elo.toFixed(2)}${result.isUpdate ? ' (updated)' : ''}`);
          scoreResults.push({
            name: matches[0].name.split(' ')[0].toLowerCase(),
            social: socialScore,
            prof: profScore,
            updated: result.isUpdate,
            elo: result.elo,
            weight: result.weight,
          });
        } catch (e) {
          console.error(`Score err ${scoreName}:`, e.message);
        }
      } else if (matches.length > 1) {
        matches.forEach(m => { if (!serverClarifyNames.includes(m.name)) serverClarifyNames.push(m.name); });
        reply += `\n\nwhich ${scoreName}? ${matches.map(m => m.name).join(' or ')}?`;
      }
    }

    // Edit member's own notes
    for (const m of allEditNotesMatches) {
      const editName = m[1].trim();
      const editContent = m[2].trim();
      const matches = fuzzyMatch(applicants, editName);
      if (matches.length === 1 && editContent) {
        try {
          await editMemberNotes(matches[0], memberName, editContent);
          console.log(`Notes edited: ${matches[0].name} by ${memberName}`);
        } catch (e) {
          console.error(`Edit notes err ${editName}:`, e.message);
        }
      } else if (matches.length > 1) {
        matches.forEach(a => { if (!serverClarifyNames.includes(a.name)) serverClarifyNames.push(a.name); });
        reply += `\n\nwhich ${editName}? ${matches.map(a => a.name).join(' or ')}?`;
      }
    }

    // Delete member's own notes
    for (const m of allDeleteNotesMatches) {
      const delName = m[1].trim();
      const matches = fuzzyMatch(applicants, delName);
      if (matches.length === 1) {
        try {
          await deleteMemberNotes(matches[0], memberName);
          console.log(`Notes deleted: ${matches[0].name} by ${memberName}`);
        } catch (e) {
          console.error(`Delete notes err ${delName}:`, e.message);
        }
      }
    }

    // Delete member's own scores
    for (const m of allDeleteScoresMatches) {
      const delName = m[1].trim();
      const matches = fuzzyMatch(applicants, delName);
      if (matches.length === 1) {
        try {
          await deleteMemberScores(matches[0], memberName);
          console.log(`Scores deleted: ${matches[0].name} by ${memberName}`);
        } catch (e) {
          console.error(`Delete scores err ${delName}:`, e.message);
        }
      }
    }

    // Server-side score confirmation — overwrite GPT's guesses with real Airtable data
    if (scoreResults.length > 0) {
      let tally = '';
      for (const r of scoreResults) {
        const updateLabel = r.updated ? ' (updated)' : '';
        tally += `${r.name} — you: ${r.social}s/${r.prof}p, composite: ${r.elo.toFixed(1)} elo (${r.weight} ratings)${updateLabel}\n`;
      }

      if (savedNotes.length > 0) {
        // Notes + scores in same message — append score tally to notes confirmation
        reply += `\n\nscores locked in:\n${tally}`;
      } else {
        // Scores only — clean GPT reply and build tally
        reply = reply.replace(/^.*—\s*you:.*$/gm, '').trim();
        reply = reply.replace(/^.*composite:.*$/gim, '').trim();
        reply = reply.replace(/^.*elo.*rating.*$/gim, '').trim();
        reply = reply.replace(/(locked in)\s*/i, 'locked in').trim();
        if (reply.toLowerCase().includes('locked in')) {
          reply = reply.replace(/(locked in)/i, `$1\n\n${tally}`).trim();
        } else {
          reply = `locked in\n\n${tally}`.trim();
        }
      }
    }

    // Strip markdown
    reply = stripMarkdown(reply).trim();
    // Clean up excessive newlines
    reply = reply.replace(/\n{3,}/g, '\n\n');

    // Merge GPT clarify + server clarify
    const allClarifyNames = [];
    if (clarifyMatch) {
      clarifyMatch[1].split('|').map(n => n.trim()).forEach(n => allClarifyNames.push(n));
    }
    serverClarifyNames.forEach(n => { if (!allClarifyNames.includes(n)) allClarifyNames.push(n); });

    // Send reply
    if (allClarifyNames.length > 0) {
      await sendReply(sender, reply);
      for (const name of allClarifyNames) {
        const match = applicants.find(a => a.name.toLowerCase() === name.toLowerCase())
          || applicants.find(a => a.name.toLowerCase().includes(name.toLowerCase()));
        if (match && match.photoUrl) {
          await sendReply(sender, match.name, match.photoUrl);
        }
      }
    } else {
      let photoUrl = null;
      if (photoMatch) {
        const photoName = photoMatch[1].trim().toLowerCase();
        const match = applicants.find(a => a.name.toLowerCase() === photoName)
          || applicants.find(a => a.name.toLowerCase().includes(photoName))
          || applicants.find(a => photoName.includes(a.name.toLowerCase()));
        if (match && match.photoUrl) photoUrl = match.photoUrl;
      }
      await sendReply(sender, reply, photoUrl || undefined);
    }

    // Contact card ONLY on true first message
    if (isFirstMessage) {
      console.log('First message — sending contact card');
      await sendReply(sender, "save my contact so you don't lose me", "https://sep-ats.vercel.app/friday.vcf");
    }

    // Safety net: check for any unaddressed inbound messages after sending
    try {
      const finalCheck = await sbAPI('GET', `/api/v2/messages?number=${encodeURIComponent(sender)}&limit=5`);
      if (finalCheck.data && Array.isArray(finalCheck.data)) {
        const sorted = finalCheck.data.sort((a, b) => new Date(b.date_sent) - new Date(a.date_sent));
        const latestInbound = sorted.find(m => !m.is_outbound && m.content?.trim());
        const latestOutbound = sorted.find(m => m.is_outbound);
        if (latestInbound && latestOutbound &&
            new Date(latestInbound.date_sent) > new Date(latestOutbound.date_sent)) {
          console.log(`Unaddressed msg found after send: "${latestInbound.content?.substring(0, 50)}"`);
          const queue = getSenderQueue(sender);
          const alreadyQueued = queue.pending.some(m => m.content === latestInbound.content);
          if (!alreadyQueued) {
            queue.pending.push({ content: latestInbound.content, message_handle: null, time: Date.now() });
          }
        }
      }
    } catch (e) {
      console.log('Post-send check error:', e.message);
    }
  } catch (error) {
    console.error('Webhook error:', error?.message, error?.stack);
    try {
      await sendReply(sender, "sorry, had a brain fart. try again?");
    } catch (_) {}
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).json({ ok: true });

  const { content, from_number, number, is_outbound, message_handle } = req.body;
  const sender = from_number || number;

  if (is_outbound || !content || !sender || sender === FROM_NUMBER) {
    return res.status(200).json({ ok: true });
  }

  const dedupKey = message_handle || `${sender}:${content}`;
  if (isHandleDuplicate(dedupKey)) {
    console.log(`Dedup skip: ${dedupKey}`);
    return res.status(200).json({ ok: true });
  }

  console.log(`Msg from ${sender}: "${content}"`);

  const queue = getSenderQueue(sender);
  queue.pending.push({ content, message_handle, time: Date.now() });

  // If already processing for this sender, this message is queued — return immediately
  if (queue.processing) {
    console.log(`Queued for ${sender}: "${content}"`);
    return res.status(200).json({ ok: true, queued: true });
  }

  // Start processing loop — handles current + any messages that arrive during processing
  queue.processing = true;
  try {
    while (queue.pending.length > 0) {
      const batch = queue.pending.splice(0);
      // Combine multiple messages into one GPT call
      const combinedContent = batch.length === 1
        ? batch[0].content
        : batch.map(m => m.content).join('\n');
      const latestHandle = batch[batch.length - 1].message_handle;

      console.log(`Processing ${batch.length} msg(s) for ${sender}${batch.length > 1 ? ' (batched)' : ''}`);
      await processMessage({ content: combinedContent, sender, message_handle: latestHandle });
    }
  } finally {
    queue.processing = false;
    // Clean up queue after 2 minutes of inactivity
    setTimeout(() => {
      const q = senderQueues.get(sender);
      if (q && !q.processing && q.pending.length === 0) senderQueues.delete(sender);
    }, 120000);
  }

  return res.status(200).json({ ok: true });
}
