import Airtable from 'airtable';
import OpenAI from 'openai';

export const config = {
  maxDuration: 300,
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
  '+13107808121': 'Charlotte', '+14249770401': 'Sam', '+17606930594': 'Leilani',
  '+13609314664': 'Simon', '+14087636262': 'Henry', '+18585275611': 'Tyler',
  '+16505186293': 'Sophia', '+13104866781': 'Anannya', '+16508899373': 'Ani',
  '+16503461001': 'Evan', '+19494669092': 'Maddie', '+16577240606': 'Darren',
  '+15596531293': 'Matthew', '+16264786106': 'Harrison', '+14152718271': 'Fiona',
  '+16196435215': 'Franco',
  '+17478888100': 'Eden',
  '+16504714569': 'Cheryl',
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
  const memberLabel = getMemberName(to) || to;
  console.log(`[OUTBOUND] to ${memberLabel}: "${content?.substring(0, 150)}"${mediaUrl ? ` +media` : ''}`);
  const payload = { number: to, from_number: FROM_NUMBER, content };
  if (mediaUrl) payload.media_url = mediaUrl;
  const res = await sbAPI('POST', '/api/send-message', payload);
  if (res.error_message) {
    console.log(`[SEND_ERROR] to ${memberLabel}: ${res.error_message}`);
    if (res.error_message.includes('not authorized')) {
      const fallback = { number: to, content };
      if (mediaUrl) fallback.media_url = mediaUrl;
      return sbAPI('POST', '/api/send-message', fallback);
    }
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

// --- Application data helper ---

const APP_TABLE = "Application Responses";

async function getApplicationData(applicantName) {
  const base = getBase();
  try {
    const records = await base(APP_TABLE).select({
      filterByFormula: `LOWER({applicant_name}) = "${applicantName.toLowerCase().replace(/"/g, '\\"')}"`,
      maxRecords: 1,
    }).all();
    if (records.length === 0) return null;
    const r = records[0];
    return {
      major: (r.get('major_minor')) || '',
      whySep: (r.get('why_sep')) || '',
      drive: (r.get('drive')) || '',
      describeYourself: (r.get('describe_yourself')) || '',
      gpa: r.get('GPA') || null,
      portfolio: (r.get('Portfolio, Website, Github, etc.')) || '',
      phone: (r.get('Phone Number')) || '',
    };
  } catch (e) {
    console.error('Application fetch error:', e.message);
    return null;
  }
}

const SUMMARY_SYSTEM_PROMPT = `You are summarizing information about a rush applicant for a business fraternity. Write a factual, unbiased summary in 3-5 sentences, plain text only.

Rules:
- Do NOT give opinions, judgments, or sentiment analysis
- Do NOT infer personality traits or evaluate "fit"
- Do NOT flag anything as a "red flag" or "standout"
- Simply summarize WHO this person is (year, major, background) and WHAT members observed or discussed with them
- Attribute observations to the members who made them when relevant (e.g. "Tyler noted that...")
- If application data is available, include their major, what they wrote about, and any relevant experience
- Be factual and neutral throughout`;

async function generateSummary(applicantName, notes, rushRecord) {
  const appData = await getApplicationData(applicantName);

  let context = `Notes from members about ${applicantName}:\n\n${notes}`;

  // Pull essays from the Rush table if available
  if (rushRecord) {
    const essay1 = rushRecord.essay_1 || rushRecord.essay1 || '';
    const essay2 = rushRecord.essay_2 || rushRecord.essay2 || '';
    const essay3 = rushRecord.essay_3 || rushRecord.essay3 || '';
    if (essay1 || essay2 || essay3) {
      context += `\n\nEssay responses:`;
      if (essay1) context += `\nEssay 1: ${essay1}`;
      if (essay2) context += `\nEssay 2: ${essay2}`;
      if (essay3) context += `\nEssay 3: ${essay3}`;
    }
    if (rushRecord.major) context += `\nMajor (from rush record): ${rushRecord.major}`;
  }

  if (appData) {
    context += `\n\nApplication data:`;
    if (appData.major) context += `\nMajor: ${appData.major}`;
    if (appData.gpa) context += `\nGPA: ${appData.gpa}`;
    if (appData.whySep) context += `\nWhy SEP: ${appData.whySep}`;
    if (appData.drive) context += `\nDrive: ${appData.drive}`;
    if (appData.describeYourself) context += `\nSelf-description: ${appData.describeYourself}`;
    if (appData.portfolio) context += `\nPortfolio/Links: ${appData.portfolio}`;
  }

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
        { role: 'user', content: context },
      ],
      max_tokens: 250,
      temperature: 0.2,
    });
    return completion.choices[0]?.message?.content || '';
  } catch (e) {
    console.error('Summary error:', e.message);
    return '';
  }
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
      major: (r.get('major')) || '',
      essay_1: (r.get('essay_1')) || '',
      essay_2: (r.get('essay_2')) || '',
      essay_3: (r.get('essay_3')) || '',
    }))
    .filter(a => a.name.trim() !== '');
}

function fuzzyMatch(applicants, query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  // 1. Exact full name match
  const exact = applicants.filter(a => a.name.toLowerCase() === q);
  if (exact.length >= 1) return exact;

  // 2. Check for parenthetical/alias match e.g. "Rainey" matches "Yuang Liu(Rainey )"
  const aliasMatch = applicants.filter(a => {
    const m = a.name.match(/\((.+?)\)/);
    return m && m[1].trim().toLowerCase() === q;
  });
  if (aliasMatch.length === 1) return aliasMatch;

  // 3. First name + last initial match: "Jack F" matches "Jack Featherston"
  const qWords = q.split(/\s+/);
  if (qWords.length === 2 && qWords[1].length <= 2) {
    const firstName = qWords[0];
    const lastInitial = qWords[1].replace(/[^a-z]/g, '');
    if (lastInitial.length >= 1) {
      const initialMatch = applicants.filter(a => {
        const parts = a.name.toLowerCase().split(/\s+/);
        return parts[0] === firstName && parts.length > 1 && parts[parts.length - 1].startsWith(lastInitial);
      });
      if (initialMatch.length === 1) return initialMatch;
    }
  }

  // 4. Unique first name match: "Peyton" matches "Peyton Carroll" if only one Peyton exists
  if (qWords.length === 1 || (qWords.length === 2 && qWords[1].length <= 2)) {
    const firstName = qWords[0];
    const firstNameMatch = applicants.filter(a => a.name.toLowerCase().split(/\s+/)[0] === firstName);
    if (firstNameMatch.length === 1) return firstNameMatch;
  }

  // 5. Full name includes/contained match
  const includes = applicants.filter(a => a.name.toLowerCase().includes(q) || q.includes(a.name.toLowerCase()));
  if (includes.length === 1) return includes;
  if (includes.length > 1) {
    // Prefer exact first name match within includes
    const firstExact = includes.filter(a => a.name.toLowerCase().split(/\s+/)[0] === qWords[0]);
    if (firstExact.length === 1) return firstExact;
    return includes;
  }

  // 6. Word-level match (only if query has 2+ meaningful words)
  if (qWords.length >= 2) {
    const wordMatch = applicants.filter(a => {
      const nameWords = a.name.toLowerCase().split(/\s+/);
      return qWords.every(qw => qw.length <= 2 || nameWords.some(nw => nw.startsWith(qw) || qw.startsWith(nw)));
    });
    if (wordMatch.length >= 1) return wordMatch;
  }

  return [];
}

async function appendNotes(applicant, memberName, newNotes) {
  const base = getBase();
  const currDay = getCurrDay();
  const dayLabel = `Day ${currDay.num}`;
  const entry = `[${memberName} — ${dayLabel}]: ${newNotes}`;
  const updatedNotes = applicant.notes ? `${applicant.notes}\n${entry}` : entry;

  const summary = await generateSummary(applicant.name, updatedNotes, applicant);

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

  const summary = await generateSummary(applicant.name, updatedNotes, applicant);

  await base(TABLE).update(applicant.id, { notes: updatedNotes, notes_summary: summary });
  return { updatedNotes, summary };
}

async function deleteMemberNotes(applicant, memberName) {
  const base = getBase();
  const notes = applicant.notes || '';
  const lines = notes.split('\n');
  const filtered = lines.filter(l => !l.startsWith(`[${memberName} `));
  const updatedNotes = filtered.filter(l => l.trim()).join('\n');

  const summary = updatedNotes.trim() ? await generateSummary(applicant.name, updatedNotes, applicant) : '';

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

function buildApplicantSummary(applicants, mentionedNames) {
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

  // Determine which applicants are "mentioned" in the current message for full detail
  const mentionedSet = new Set((mentionedNames || []).map(n => n.toLowerCase()));

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
      // Only include raw notes for applicants mentioned in the current message
      const isMentioned = mentionedSet.size === 0 || [...mentionedSet].some(n =>
        a.name.toLowerCase().includes(n) || n.includes(a.name.toLowerCase().split(' ')[0])
      );
      if (a.notes && isMentioned) {
        line += `\n  Raw notes:\n  ${a.notes.replace(/\n/g, '\n  ')}`;
      } else if (a.notes) {
        line += `\n  Notes: ${a.notes.split('\n').length} entries`;
      }
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
- Collecting notes on rushees (updates Airtable + dashboard in real time)
- Conversation guidelines, sample questions, and interview prep
- Attendance tracking and real-time stats
- The check-in app, dashboard, and Airtable workflow

PERSONALITY & TONE:
- You're the friend who always has the answer and never makes it weird. Warm, sharp, effortlessly helpful.
- Dry wit when it fits — never forced. If a joke doesn't land naturally, skip it.
- Write in clean, elegant conversational English. Proper grammar, natural flow, easy to read.
- Lowercase is fine for casual vibes, but never sloppy. Think "cool and composed" not "lazy texter."
- Emojis only when they genuinely add something. One max per message, if any.
- Be aware of the CURRENT TIME and DAY. Reference it naturally when relevant.

FORMATTING RULES (CRITICAL):
- NEVER use markdown. No asterisks, bold, italic, headers, backticks. Plain text only — this is iMessage.
- NEVER end with filler ("let me know!", "anything else?"). Just land the message cleanly.
- Use line breaks generously to separate thoughts. White space makes texts feel elegant.
- Dashes (-) for lists when needed, but prefer flowing sentences over bullet dumps.
- Every reply should look good as an iMessage bubble — clean, breathable, easy on the eyes.

RESPONSE LENGTH:
- Your ENTIRE reply must fit in ONE message. Never expect multiple messages to be sent.
- 1-3 lines for simple stuff. 6-8 lines max for complex answers.
- For confirmations (notes saved, scores logged), keep it to 1-2 lines — the system handles the details.

FIRST MESSAGE BEHAVIOR:
- If there is NO conversation history (first time texting), introduce yourself and give today's rush info.
- You already know who's texting from the member directory — greet them by name if available.

DATA ACCESS:
The applicant data below is LIVE from Airtable — fetched fresh every message. It includes full raw notes (with member attribution), AI summaries, scores, attendance, emails, and photo status. You can answer ANY query about ANY applicant using this data. When asked about notes, quote the raw notes with attribution (who said what). When asked about scores, use the real numbers. The data is the single source of truth.

NOTES SYSTEM:
Members text notes about rushees → you save them to Airtable with tags.
ALL notes happen RIGHT HERE in this text conversation. Members just text you their notes — you handle everything. They do NOT need to go to Airtable or the Dashboard to submit notes. The dashboard is view-only for checking data.
READ ACCESS: Members can query ANY applicant data (name, attendance, scores, notes, status — everything).
WRITE ACCESS: Members can only modify THEIR OWN notes and scores. They cannot edit another member's contributions.
IMPORTANT: Do NOT proactively ask members to rate or score rushees after saving notes. Do NOT prompt for ratings. If a member voluntarily includes scores in their message (like "S 4 P 3" or "social 4 prof 5"), generate [SAVE_SCORES] tags for those. But NEVER prompt, remind, or ask for ratings yourself.

CRITICAL TAG RULES:
- Tags are INVISIBLE to the user — they get stripped from your reply before sending.
- Your visible reply text must make sense WITHOUT the tags. Do NOT structure your reply around the tags.
- Put ALL tags at the very START of your reply, BEFORE your visible text.
- NEVER repeat the notes content in your visible text — the user already knows what they wrote.
- Always use the FULL NAME of the applicant in all tags, exactly as it appears in the applicant list.

1. SAVING NOTES: When a member shares feedback about rushees, IMMEDIATELY save — NEVER ask "do you want me to save?" or "should I save these?". Just do it. Wrap EACH person's notes in tags. CRITICAL: Generate a tag for EVERY SINGLE person mentioned — do NOT skip anyone. Use EXACTLY this format:
   [SAVE_NOTES:Firstname Lastname]notes here[/SAVE_NOTES]
   Multiple people: [SAVE_NOTES:Firstname Lastname]notes[/SAVE_NOTES][SAVE_NOTES:Another Person]notes[/SAVE_NOTES]
   IMPORTANT: Use [SAVE_NOTES:] with the underscore and bracket-style closing tags. NOT colon-separated.
   IMPORTANT: Always use the FULL NAME from the applicant list below. Match first names to the list — e.g. if user writes "Kevin H" and there's "Kevin Henderson" in the list, use "Kevin Henderson".
   IMPORTANT: If the user sends notes about 10+ people, you MUST generate tags for ALL of them. Do NOT stop partway. Even 30+ people — tag EVERY single one.
   IMPORTANT: If the user includes scores inline with notes (like "S 3 P 2" or "S 4 P 3" after each person), generate BOTH [SAVE_NOTES] AND [SAVE_SCORES] tags for each person in the same reply.
   IMPORTANT: If the user uses a last initial like "Sofia L" or "Ethan D" to disambiguate, match it to the right person from the applicant list.
   After all tags, just write "got it" or similar — the system auto-generates a pretty confirmation. Do NOT write your own confirmation or list names.

2. SAVING SCORES (ONLY when user voluntarily provides them — NEVER ask for ratings):
   [SAVE_SCORES:Firstname Lastname:4:3][SAVE_SCORES:Another Person:5:4]locked in
   Decimal scores are supported: [SAVE_SCORES:Name:2.5:1.5]
   The system auto-appends the real elo tally from Airtable. Do NOT write your own tally.
   Scores are tracked per-member. If they re-rate someone, their old score is replaced (not stacked).
   CRITICAL: Only generate score tags when the USER explicitly provides numerical ratings. NEVER infer, guess, or hallucinate scores from notes content.

3. EDITING OWN NOTES: If a member wants to change/replace their previous notes on someone:
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

8. PARSING FLEXIBLE SCORE FORMATS (only when user voluntarily provides scores):
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

10. OTHER: If notes don't specify who, ask. When looking up someone with notes, show the notes_summary.

PHOTO INSTRUCTIONS:
- You CAN send photos, but ONLY when the user EXPLICITLY asks to see someone's photo or look up a profile.
- Examples of explicit requests: "show me X", "what does X look like", "pull up X", "photo of X", "who is X"
- When the user explicitly requests a photo/lookup: [PHOTO:Full Name]
- Do NOT attach photos automatically when discussing, saving notes, giving scores, or answering general questions.
- NEVER say "I can't send photos" — you can, but only when asked.
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
- Rush Dashboard: https://sep-ats.vercel.app/dashboard — password: quinnanish
- When anyone asks about the dashboard, ALWAYS include the password. The link is useless without it.
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

RUSH GUIDE DOC: https://docs.google.com/document/d/1VJwsVYwmMkbEe5un8Occyp_L0phZog04XUdFeUeojso/edit

NOTE-TAKING RULES:
- At least one person in every group MUST take notes each night.
- After rush, text notes to this number (+1 713-962-6862) — that's you, Friday.
- Members lose 2 SEP points for each night they or their partner doesn't submit notes.

CONVERSATION GUIDELINES:
Group Convos: observe social fit — respectful, engaging, listening?
1-on-1 Convos: informal grill sessions, dig deep into personal experiences. Come out with a vouch FOR or AGAINST.
Key Lookouts:
- Buzzword BS: overuse of "AI", "blockchain", "machine learning" — ask specifics about their startups/projects (skills used, stage of development, reach, impact, goals)
- Overcoming implicit bias: actively try to overcome biases. Talkative guys seen as confident, talkative girls seen as fake. Imagine them as another gender/ethnicity — would your impression be the same? Hold yourself accountable.

WHAT PMs ARE LOOKING FOR:
- Genuinely passionate about something and can prove it. Not surface-level — follow-up questions should reveal MORE, not less.
- Entrepreneurial by nature. If they can't clearly explain why they want to be in an entrepreneurship fraternity because of entrepreneurship, they're not for us.
- Builders. People who see problems and want to make things, not just talk about ideas.
- Someone everyone would want to hang out with. Not just a small part of SEP.
- Drive over resume. Extremely passionate with little experience > stacked resume with no care.
- The most important thing you can do during rush is ask follow-up questions. That's how you find out if someone is real.

DELIBERATION PROCESS:
1-5 ranking: 1=don't want/did something bad, 2=not impressive/prefer not to see again, 3=neutral, 4=like them/impressive, 5=bid them/really impressive/100% want.
Social Night delibs: top 30% / middle 40% / bottom 30% based on initial ATS ranking. Bottom 30% can be vouched up, top 30% can be vouched against. Middle 50% + objections deliberated. 3+2 min per rushee (hard max 5 min). Vouches under 30 seconds. ~100 continue to prof night.
Professional Night: 30s slides + 3+2 min delibs, no abstaining, vote based on what you've heard. ~50 continue to coffee chats. Pairings made based on major/interests.
Coffee Chats: 30s slides + 4+3 min delibs, those who chatted speak first, then additional vouches. ~28 to finals.
Final Delibs: all reviewed, no hard time limit.
Must attend 3/4 rush days for finals. Must attend final delibs.

STRUCTURED GROUP QUESTIONS (assigned by group number):
Group 1: What's the most impulsive thing you've ever done? / What's your most recent obsession, and how'd you get into it?
Group 2: If you had to delete every app except one, which would you keep? / What's something you started doing on your own this year just because you were curious?
Group 3: What could you talk about for 30 minutes straight with zero preparation? / What's the most useless talent you have? Prove it if you can.
Group 4: What's the funniest thing that happened to you last quarter? / When was the last time you were so locked into something you completely lost track of time?
Group 5: If you became a YouTuber tomorrow, what kind of content are you making and why? / What's a topic you've gone way deeper into than most people would expect?
Group 6: If you dropped out of school tomorrow, what would you do? / What's something you spent a long time being bad at before you got good at it?
Group 7: Would you rather be the best player on a losing team or the worst player on a winning team? / If you could swap lives with one person for a week, who are you picking?
Group 8: What's your craziest story? / What's something you've spent way more time on than you probably should have, but you don't regret it?
Group 9: Give me a hot take. / What would you be doing right now if money and other people's opinions didn't exist?
Group 10: What's something you're way too competitive about? / What's something you think everyone should experience at least once?
Group 11: What's the most spontaneous thing you've done this year? / If you had to teach a class on anything right now, what would you teach?
Group 12: What's something you care about enough that you'd work on it for free? / How have you changed from who you were a year ago?
Group 13: What's a skill you're surprisingly good at that nobody would guess? / If you had to start a business with the person to your left using only what's in this room, what would you build?
Group 14: What is one of the most unusual or unique experiences you've had? / Imagine you just graduated and money isn't an issue — what are you doing with your first year?
Group 15: If you could shadow anyone in the world at their job for a week, who? / What's something you struggled with growing up that shaped who you are now?
Group 16: What's your craziest story from college so far? / What did you think you wanted to do two years ago, and how has that changed?
Group 17: If you started with $10 and had to make it $1,000 in a week with no job, how? / What's a phase you went through that actually ended up shaping who you are?
Group 18: You have 20 seconds to sell me on your favorite thing. Go. / Tell me about something you want to learn more about over the next year.
Group 19: What's on your bucket list for this year? / What's one event in your life that changed everything for you?
Group 20: You're offered your dream job, but it's in a city where you know nobody. Do you take it? / If you could go back and give yourself one piece of advice at the start of college, what would it be?`;

// --- Extract notes from ALL tag formats GPT may produce ---
// --- Split large note dumps into per-person sections ---
// Split raw text into chunks at line boundaries (for GPT to parse names, not regex)
function chunkRawText(text, maxChars = 3000) {
  const lines = text.split('\n');
  const chunks = [];
  let current = '';
  for (const line of lines) {
    if (current.length + line.length + 1 > maxChars && current.length > 0) {
      chunks.push(current.trim());
      current = '';
    }
    current += line + '\n';
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [text];
}

function extractAllNoteTags(text) {
  const results = [];
  const seen = new Set();

  // Format 1: [SAVE_NOTES:Name]content[/SAVE_NOTES] — proper bracket with closing tag
  for (const m of text.matchAll(/\[SAVE_?NOTES:(.+?)\]([\s\S]*?)\[\/SAVE_?NOTES\]/gi)) {
    const name = m[1].trim();
    const notes = m[2].trim();
    if (name && notes && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      results.push([m[0], name, notes]); // [fullMatch, name, content]
    }
  }

  // Format 2: [SAVENOTES:Name:content] — colon-separated, no closing tag
  for (const m of text.matchAll(/\[SAVE_?NOTES:([^:\]]+):([^\]]+)\]/gi)) {
    const name = m[1].trim();
    const notes = m[2].trim();
    if (name && notes && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      results.push([m[0], name, notes]);
    }
  }

  // Format 3: [SAVENOTES:Name]content (NO closing tag — runs to next [SAVE tag or end)
  const tagPattern = /\[SAVE_?NOTES:([^\]]+)\]/gi;
  const positions = [];
  let match;
  while ((match = tagPattern.exec(text)) !== null) {
    positions.push({ name: match[1].trim(), start: match.index, contentStart: match.index + match[0].length, fullTag: match[0] });
  }

  for (let i = 0; i < positions.length; i++) {
    const tag = positions[i];
    if (tag.name.includes(':')) continue; // colon format already handled
    if (seen.has(tag.name.toLowerCase())) continue; // already captured by format 1 or 2

    // Content runs to next [SAVE tag or end of text
    const contentEnd = i + 1 < positions.length ? positions[i + 1].start : text.length;
    let noteContent = text.substring(tag.contentStart, contentEnd).trim();
    // Remove closing tags and trailing confirmations
    noteContent = noteContent.replace(/\[\/SAVE_?NOTES\]/gi, '').trim();
    noteContent = noteContent.replace(/\s*(got it|notes saved|rate |social:|prof:|how'?s|speaking of|by the way|still need|locked in).*/is, '').trim();
    noteContent = noteContent.replace(/\.\s*$/, '').trim();

    if (noteContent && noteContent.length > 3) {
      seen.add(tag.name.toLowerCase());
      results.push([tag.fullTag + noteContent, tag.name, noteContent]);
    }
  }

  return results;
}

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

    // Build compact name list for matching
    const nameList = applicants.map(a => a.name).sort().join(', ');

    // Extract names mentioned in the user's message for targeted raw notes inclusion
    // Use word-boundary matching to avoid false positives from note content
    const contentLower = content.toLowerCase();
    const mentionedNames = [];
    const seenFirstNames = new Set();
    for (const a of applicants) {
      const firstName = a.name.toLowerCase().split(/\s+/)[0];
      if (firstName.length < 2 || seenFirstNames.has(firstName)) continue;
      // Match first name at word boundary (not as part of another word)
      const pattern = new RegExp(`(?:^|[\\s,;:.\\-—•\\t(])${firstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[\\s,;:.\\-—•\\t)])`, 'i');
      if (pattern.test(contentLower)) {
        mentionedNames.push(firstName);
        seenFirstNames.add(firstName);
      }
    }

    // --- Large note dump detection & chunking ---
    const CHUNK_THRESHOLD = 8;
    let reply;
    let finishReason = 'stop';

    if (mentionedNames.length > CHUNK_THRESHOLD) {
      console.log(`Large note dump detected: ${mentionedNames.length} names. Chunking...`);

      // Split raw text into ~3000 char chunks at line boundaries — GPT handles all name matching
      const rawChunks = chunkRawText(content, 3000);
      console.log(`Split into ${rawChunks.length} raw text chunks`);

      const chunkTagPrompt = `You are a tag generator for a rush note-taking system. Your ONLY job is to output SAVE_NOTES tags (and SAVE_SCORES tags if scores are included).

APPLICANT NAME LIST (use these EXACT full names in all tags):
${nameList}

RULES:
- Parse the notes below. Each person's name appears as a header/label followed by their notes.
- Match each name to the CORRECT full name from the applicant list above.
- Output ONLY tags, nothing else. No visible text, no confirmations, no lists.
- Use this format for each person: [SAVE_NOTES:Full Name]their notes here[/SAVE_NOTES]
- If the notes include scores like "S 3 P 2" or "social 4 prof 5" or "4 3", also generate: [SAVE_SCORES:Full Name:social:prof]
- Generate a tag for EVERY person mentioned. Do NOT skip anyone.
- Keep notes as-is — do NOT rewrite or summarize.

NAME MATCHING:
- If a first name matches ONLY ONE person in the list, use that person's full name. No ambiguity.
- If a first name + last initial is given (e.g., "Sofia V"), match to the person whose last name starts with that letter.
- Misspellings or close names should be matched to the closest person — do NOT flag these as ambiguous.
- ONLY flag as ambiguous when JUST a first name is given AND multiple people share that exact first name (e.g., just "Sofia" when there's Sofia Valdez AND Sofia Llabres). Use: [AMBIGUOUS:Sofia|Sofia Valdez|Sofia Llabres]
- When a last initial or any other distinguishing info is provided, ALWAYS resolve — never flag ambiguous.`;

      const allTagOutputs = [];
      for (let i = 0; i < rawChunks.length; i++) {
        try {
          const chunkCompletion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: chunkTagPrompt },
              { role: 'user', content: rawChunks[i] },
            ],
            temperature: 0.1,
            max_tokens: 4096,
          });
          const chunkReply = chunkCompletion.choices[0]?.message?.content || '';
          console.log(`Chunk ${i + 1}/${rawChunks.length}: ${chunkReply.substring(0, 200)}`);
          allTagOutputs.push(chunkReply);
        } catch (e) {
          console.error(`Chunk ${i + 1} error:`, e.message);
        }
      }

      reply = allTagOutputs.join('\n') + '\ngot it';
    } else {
      const systemPrompt = `${RUSH_CONTEXT}

CURRENT TIME (Pacific): ${now}
CURRENT RUSH DAY: Day ${currDay.num} — ${currDay.name}
${knownName ? `MEMBER TEXTING: ${knownName}` : 'UNKNOWN MEMBER'}
${isFirstMessage ? 'THIS IS THEIR FIRST MESSAGE EVER — follow FIRST MESSAGE BEHAVIOR.' : ''}

APPLICANT NAME LIST (use these EXACT names in all tags):
${nameList}

${buildApplicantSummary(applicants, mentionedNames)}`;

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
        temperature: 0.7,
        max_tokens: 4096,
      });

      reply = completion.choices[0]?.message?.content || "hmm something went wrong, try again?";
      finishReason = completion.choices[0]?.finish_reason || 'unknown';
    }
    console.log(`GPT raw (${finishReason}): ${reply.substring(0, 500)}`);
    if (finishReason === 'length') {
      console.warn('WARNING: GPT output was truncated (max_tokens hit)');
      // Count how many note tags we got vs how many names were mentioned
      const gotTags = extractAllNoteTags(reply).length;
      if (mentionedNames.length > 3 && gotTags < mentionedNames.length - 1) {
        console.log(`Truncation lost notes: got ${gotTags} tags for ${mentionedNames.length} names. Re-processing full message as chunks...`);
        const rawChunks = chunkRawText(content, 3000);
        const allTagOutputs = [reply]; // keep whatever tags we already got
        const recoveryPrompt = `You are a tag generator. Output ONLY SAVE_NOTES tags.

APPLICANT NAME LIST (use EXACT full names):
${nameList}

RULES:
- Parse the notes and match each person to the correct full name from the list.
- Format: [SAVE_NOTES:Full Name]notes[/SAVE_NOTES]
- Misspellings or close names: match to the closest person, do NOT flag ambiguous.
- ONLY flag ambiguous when just a first name is given AND multiple people share that first name: [AMBIGUOUS:name|Full Name 1|Full Name 2]
- When a last initial or any distinguishing info is given, ALWAYS resolve.
- Tag EVERY person. Do NOT skip anyone. Keep notes verbatim.`;

        for (const chunk of rawChunks) {
          try {
            const c = await openai.chat.completions.create({
              model: 'gpt-4o-mini',
              messages: [{ role: 'system', content: recoveryPrompt }, { role: 'user', content: chunk }],
              temperature: 0.1,
              max_tokens: 4096,
            });
            allTagOutputs.push(c.choices[0]?.message?.content || '');
          } catch (e) {
            console.error(`Truncation recovery error:`, e.message);
          }
        }
        reply = allTagOutputs.join('\n') + '\ngot it';
      }
    }

    // --- Parse ALL tags (handle ALL GPT output formats) ---
    const reactMatch = reply.match(/^\[REACT:(love|like|dislike|laugh|emphasize|question)\]\s*/i);

    // Normalize invented tag variants before parsing (GPT hallucinations)
    reply = reply.replace(/\[LOCKED?_?SCORES:/gi, '[SAVE_SCORES:');

    // Extract notes from ALL tag formats GPT has ever produced
    const allNotesMatches = extractAllNoteTags(reply);
    const allScoresMatches = [...reply.matchAll(/\[SAVE_?SCORES:(.+?):(\d+\.?\d*):(\d+\.?\d*)\]/gi)];
    const allEditNotesMatches = [...reply.matchAll(/\[EDIT_MY_NOTES:(.+?)\]([\s\S]*?)\[\/EDIT_MY_NOTES\]/gi)];
    const allDeleteNotesMatches = [...reply.matchAll(/\[DELETE_MY_NOTES:(.+?)\]/gi)];
    const allDeleteScoresMatches = [...reply.matchAll(/\[DELETE_MY_SCORES:(.+?)\]/gi)];
    const allAmbiguousMatches = [...reply.matchAll(/\[AMBIGUOUS:(.+?)\]/gi)];
    const clarifyMatch = reply.match(/\[CLARIFY_PHOTOS:(.+?)\]/i);
    const photoMatch = reply.match(/\[PHOTO:(.+?)\]/i);

    console.log(`Tags: notes=${allNotesMatches.length} scores=${allScoresMatches.length} editNotes=${allEditNotesMatches.length} delNotes=${allDeleteNotesMatches.length} ambiguous=${allAmbiguousMatches.length} photo=${!!photoMatch} clarify=${!!clarifyMatch}`);

    // Strip ALL tags from reply — if notes were saved, reply gets overwritten anyway
    if (reactMatch) reply = reply.replace(reactMatch[0], '').trim();
    // Strip bracket-closed notes: [SAVE_NOTES:Name]content[/SAVE_NOTES]
    reply = reply.replace(/\[SAVE_?NOTES:(.+?)\]([\s\S]*?)\[\/SAVE_?NOTES\]/gi, '').trim();
    // Strip closing tags
    reply = reply.replace(/\[\/SAVE_?NOTES\]/gi, '').trim();
    // Strip Format 3 unclosed tags AND their trailing content (up to next tag or natural break)
    // This prevents note content from leaking into the visible reply
    reply = reply.replace(/\[SAVE_?NOTES:[^\]]+\][^\[]*/gi, '').trim();
    // Strip score tags
    reply = reply.replace(/\[SAVE_?SCORES:[^\]]+\]/gi, '').trim();
    for (const m of allEditNotesMatches) reply = reply.replace(m[0], '').trim();
    for (const m of allDeleteNotesMatches) reply = reply.replace(m[0], '').trim();
    for (const m of allDeleteScoresMatches) reply = reply.replace(m[0], '').trim();
    if (clarifyMatch) reply = reply.replace(clarifyMatch[0], '').trim();
    if (photoMatch) reply = reply.replace(photoMatch[0], '').trim();
    reply = reply.replace(/\[SET_NAME:.+?\]/gi, '').trim();
    reply = reply.replace(/\[SCORE_SUMMARY\]/gi, '').trim();
    reply = reply.replace(/\[AMBIGUOUS:[^\]]+\]/gi, '').trim();

    // --- Execute actions ---
    if (reactMatch && message_handle) {
      sendReaction(message_handle, reactMatch[1].toLowerCase()).catch(e => console.error('React err:', e));
    }

    const memberName = knownName || sender;

    // Save notes — collect results for pretty confirmation
    const savedNotes = [];
    const failedNotes = [];

    // Collect GPT-flagged ambiguous names (e.g., [AMBIGUOUS:Sofia|Sofia Valdez|Sofia Llabres])
    for (const ambMatch of allAmbiguousMatches) {
      const parts = ambMatch[1].split('|').map(p => p.trim());
      const typed = parts[0] || 'unknown';
      const options = parts.slice(1);
      if (options.length >= 2) {
        failedNotes.push(`${typed} (${options.join(' or ')}?)`);
        console.log(`Ambiguous (GPT): "${typed}" → ${options.join(', ')}`);
      }
    }

    // Build a map of first names that are shared by multiple applicants (e.g., Sofia, Jason, Caroline)
    const firstNameCounts = {};
    for (const a of applicants) {
      const fn = a.name.toLowerCase().split(/\s+/)[0];
      firstNameCounts[fn] = (firstNameCounts[fn] || 0) + 1;
    }
    const ambiguousFirstNames = new Set(
      Object.entries(firstNameCounts).filter(([, count]) => count > 1).map(([fn]) => fn)
    );

    // Pre-resolve all note matches first
    const resolvedNotes = [];
    for (const notesMatch of allNotesMatches) {
      const notesName = notesMatch[1].trim();
      const notesContent = notesMatch[2].trim();
      if (!notesContent) continue;
      const matches = fuzzyMatch(applicants, notesName);
      if (matches.length === 1) {
        // Server-side disambiguation check: did the user actually type enough to distinguish?
        // If the first name is shared by multiple applicants, check if the user's raw message
        // contains a last name or initial — if not, GPT just guessed and we should ask.
        const firstName = matches[0].name.toLowerCase().split(/\s+/)[0];
        if (ambiguousFirstNames.has(firstName)) {
          // Check if the user's message contains ANY distinguishing info beyond just the first name
          // (e.g., last name, last initial, full name)
          const lastName = matches[0].name.toLowerCase().split(/\s+/).slice(1).join(' ');
          const lastInitial = lastName ? lastName[0] : '';
          const contentLow = content.toLowerCase();

          // Look for: full name, "firstName lastName", "firstName L", "firstName L."
          const hasFullName = contentLow.includes(matches[0].name.toLowerCase());
          const hasLastInitial = lastInitial && new RegExp(
            `${firstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+${lastInitial}[\\s.,:\\-—\\n]`,
            'i'
          ).test(contentLow + '\n'); // add newline so end-of-string matches
          const hasLastName = lastName && contentLow.includes(lastName);

          if (!hasFullName && !hasLastInitial && !hasLastName) {
            // User just typed the first name — GPT guessed wrong, ask for clarification
            const sameFirstName = applicants.filter(a =>
              a.name.toLowerCase().split(/\s+/)[0] === firstName
            );
            console.log(`Server-side disambig: "${notesName}" → GPT picked ${matches[0].name} but user only typed "${firstName}" (${sameFirstName.length} matches)`);
            failedNotes.push(`${firstName} (${sameFirstName.map(a => a.name).join(' or ')}?)`);
            continue;
          }
        }
        resolvedNotes.push({ applicant: matches[0], notesContent, notesName });
      } else if (matches.length > 1) {
        console.log(`Ambiguous note "${notesName}": ${matches.map(m => m.name).join(', ')}`);
        failedNotes.push(`${notesName} (${matches.map(m => m.name).join(' or ')}?)`);
      } else {
        failedNotes.push(notesName);
        console.log(`No match for note: "${notesName}"`);
      }
    }

    // Save in parallel batches of 5
    const BATCH_SIZE = 5;
    for (let i = 0; i < resolvedNotes.length; i += BATCH_SIZE) {
      const batch = resolvedNotes.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async ({ applicant, notesContent, notesName }) => {
          await appendNotes(applicant, memberName, notesContent);
          return { name: applicant.name, notesName };
        })
      );
      for (let j = 0; j < results.length; j++) {
        if (results[j].status === 'fulfilled') {
          savedNotes.push(results[j].value.name);
          console.log(`Notes saved: ${results[j].value.name} by ${memberName}`);
        } else {
          failedNotes.push(batch[j].notesName);
          console.error(`Notes err ${batch[j].notesName}:`, results[j].reason?.message);
        }
      }
    }

    // Detect dropped names: people mentioned in the message but not in any tag
    if (savedNotes.length > 0 && mentionedNames.length > savedNotes.length + failedNotes.length + 2) {
      const savedFirstNames = new Set(savedNotes.map(n => n.toLowerCase().split(/\s+/)[0]));
      const failedFirstNames = new Set(failedNotes.map(n => n.toLowerCase().split(/\s+/)[0]));
      const droppedNames = mentionedNames.filter(n =>
        !savedFirstNames.has(n) && !failedFirstNames.has(n)
      );
      if (droppedNames.length > 0) {
        console.warn(`Dropped names detected (${droppedNames.length}): ${droppedNames.join(', ')}`);
        failedNotes.push(...droppedNames.map(n => `${n} (might be missing)`));
      }
    }

    // Build elegant confirmation for saved notes (overrides GPT reply)
    if (savedNotes.length > 0 || failedNotes.length > 0) {
      let prettyReply = '';
      if (savedNotes.length > 0) {
        prettyReply += `locked in ${savedNotes.length} ${savedNotes.length > 1 ? 'rushees' : 'rushee'}\n\n`;
        savedNotes.forEach(name => {
          prettyReply += `${name}\n`;
        });
      }
      if (failedNotes.length > 0) {
        // Check if any are disambiguation (contain "or")
        const disambig = failedNotes.filter(n => n.includes(' or '));
        const other = failedNotes.filter(n => !n.includes(' or '));
        if (disambig.length > 0) {
          prettyReply += `\nwhich one?\n${disambig.join('\n')}`;
        }
        if (other.length > 0) {
          prettyReply += `\ncouldn't match: ${other.join(', ')}`;
        }
      }
      if (prettyReply.trim()) reply = prettyReply;
    }

    // Save scores if user proactively includes them (but bot never asks for ratings)
    const scoreResults = [];
    for (const scoresMatch of allScoresMatches) {
      const scoreName = scoresMatch[1].trim();
      const socialScore = parseFloat(scoresMatch[2]);
      const profScore = parseFloat(scoresMatch[3]);
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
        console.log(`Ambiguous score "${scoreName}": ${matches.map(m => m.name).join(', ')}`);
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

    // Safety net: strip any leaked tags that slipped through (including invented formats)
    if (/\[[A-Z_]{3,}:/i.test(reply)) {
      console.warn('LEAKED TAGS detected in reply, stripping all brackets');
      reply = reply.replace(/\[[^\]]*\]/g, '').trim();
    }

    // Guard against empty reply after tag stripping
    if (!reply.trim()) {
      reply = 'got it';
      console.log('Empty reply after tag stripping, defaulting to "got it"');
    }

    // Only send clarify photos on pure lookups (no notes/scores/edits/deletes in this message)
    const isLookup = allNotesMatches.length === 0 && allScoresMatches.length === 0
      && allEditNotesMatches.length === 0 && allDeleteNotesMatches.length === 0 && allDeleteScoresMatches.length === 0;

    const allClarifyNames = [];
    if (clarifyMatch && isLookup) {
      clarifyMatch[1].split('|').map(n => n.trim()).forEach(n => allClarifyNames.push(n));
    }

    // --- SEND AT MOST 2 MESSAGES per inbound (reply + optional photo/contact) ---
    let photoUrl = null;

    // Resolve photo URL from [PHOTO:] tag or first clarify name
    if (photoMatch) {
      const photoName = photoMatch[1].trim().toLowerCase();
      const match = applicants.find(a => a.name.toLowerCase() === photoName)
        || applicants.find(a => a.name.toLowerCase().includes(photoName))
        || applicants.find(a => photoName.includes(a.name.toLowerCase()));
      if (match && match.photoUrl) {
        photoUrl = match.photoUrl;
      } else {
        console.log(`[PHOTO] tag "${photoMatch[1]}" — no photo found`);
      }
    } else if (allClarifyNames.length > 0 && isLookup) {
      // For disambiguation, send first match's photo inline with the reply (not separate messages)
      const firstName = allClarifyNames[0];
      const match = applicants.find(a => a.name.toLowerCase() === firstName.toLowerCase())
        || applicants.find(a => a.name.toLowerCase().includes(firstName.toLowerCase()));
      if (match && match.photoUrl) {
        photoUrl = match.photoUrl;
      }
    }

    // Message 1: the reply (with photo attached if applicable)
    await sendReply(sender, reply, photoUrl || undefined);

    // Message 2 (max): contact card ONLY on true first message
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

  // --- Project Lux join code handler ---
  const trimmedContent = content.trim().toUpperCase();
  if (trimmedContent === 'LUX' || trimmedContent === 'JOIN LUX') {
    console.log(`[LUX] Join request from ${sender}`);
    try {
      const joinRes = await fetch('https://www.duttapad.com/api/editors/add-by-phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: sender,
          ownerUsername: 'Amia',
          role: 'member',
          secret: process.env.DUTTAPAD_JOIN_SECRET
        })
      });
      const joinData = await joinRes.json();
      console.log(`[LUX] Join result:`, joinData);
      await sendReply(sender, "You've been added to Project Lux! View the page at duttapad.com/Amia");
    } catch (err) {
      console.error(`[LUX] Join error:`, err.message);
      await sendReply(sender, "Something went wrong joining Project Lux. Try again or visit duttapad.com/Amia directly.");
    }
    return res.status(200).json({ ok: true });
  }

  const dedupKey = message_handle || `${sender}:${content}`;
  if (isHandleDuplicate(dedupKey)) {
    console.log(`Dedup skip: ${dedupKey}`);
    return res.status(200).json({ ok: true });
  }

  const memberLabel = getMemberName(sender) || sender;
  console.log(`[INBOUND] ${memberLabel}: "${content.substring(0, 200)}"`);

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
