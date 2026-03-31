/**
 * One-off API route to audit & backfill missed notes.
 * GET /api/audit-notes        → audit only (dry run)
 * GET /api/audit-notes?fix=1  → actually write to Airtable
 *
 * Runs on Vercel so SendBlue API works (local IP may be blocked).
 */

import Airtable from 'airtable';

export const config = { maxDuration: 300 };

const TABLE = "Rush Spring '26";

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

const TEST_NAMES = ['buddy heild', 'glizz heild', 'joohhny man', 'buddy', 'glizz', 'heild', 'joohhny', 'group 11', 'johnathan'];

function getMemberName(phone) {
  if (!phone) return '';
  const n = phone.replace(/[\s\-\(\)]/g, '');
  if (MEMBER_DIRECTORY[n]) return MEMBER_DIRECTORY[n];
  if (!n.startsWith('+') && MEMBER_DIRECTORY[`+1${n}`]) return MEMBER_DIRECTORY[`+1${n}`];
  const last10 = n.replace(/^\+?1?/, '').slice(-10);
  for (const [p, name] of Object.entries(MEMBER_DIRECTORY)) {
    if (p.replace(/^\+?1?/, '').slice(-10) === last10) return name;
  }
  return '';
}

async function sbAPI(method, path) {
  const res = await fetch(`https://api.sendblue.com${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'sb-api-key-id': process.env.SENDBLUE_API_KEY,
      'sb-api-secret-key': process.env.SENDBLUE_API_SECRET,
    },
  });
  return res.json();
}

function getBase() {
  return new Airtable({ apiKey: process.env.VITE_AIRTABLE_API_KEY }).base(process.env.VITE_AIRTABLE_BASE_ID);
}

async function getAllApplicants() {
  const base = getBase();
  const records = await base(TABLE).select({ maxRecords: 1000 }).all();
  return records
    .map(r => ({ id: r.id, name: (r.get('applicant_name')) || '', notes: (r.get('notes')) || '' }))
    .filter(a => a.name.trim() !== '');
}

function fuzzyMatch(applicants, query) {
  const q = query.trim().toLowerCase();
  if (!q || TEST_NAMES.includes(q)) return [];
  const exact = applicants.filter(a => a.name.toLowerCase() === q);
  if (exact.length >= 1) return exact;
  const includes = applicants.filter(a => a.name.toLowerCase().includes(q) || q.includes(a.name.toLowerCase()));
  if (includes.length >= 1) return includes;
  const qWords = q.split(/\s+/);
  return applicants.filter(a => {
    const nw = a.name.toLowerCase().split(/\s+/);
    return qWords.some(qw => nw.some(nw2 => nw2.includes(qw) || qw.includes(nw2)));
  });
}

async function getMessages(phone) {
  const all = [];
  let offset = 0;
  for (let i = 0; i < 10; i++) {
    let url = `/api/v2/messages?number=${encodeURIComponent(phone)}&limit=100`;
    if (offset > 0) url += `&offset=${offset}`;
    const data = await sbAPI('GET', url);
    if (!data.data || !Array.isArray(data.data) || data.data.length === 0) break;
    all.push(...data.data);
    if (data.data.length < 100) break;
    offset += 100;
  }
  return all.sort((a, b) => new Date(a.date_sent) - new Date(b.date_sent));
}

function getDayLabel(dateStr) {
  if (!dateStr) return 'Day 1';
  const d = new Date(dateStr);
  const p = new Date(d.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  let month = p.getMonth(), date = p.getDate();
  if (p.getHours() < 4) { const prev = new Date(p); prev.setDate(date - 1); month = prev.getMonth(); date = prev.getDate(); }
  if (month === 2 && date === 30) return 'Day 1';
  if (month === 2 && date === 31) return 'Day 2';
  if (month === 3 && date === 1) return 'Day 3';
  if (month === 3 && date === 2) return 'Day 4';
  if (month === 3 && date === 3) return 'Day 5';
  return 'Day 1';
}

function extractAllNotes(content) {
  const results = [];

  // Format 1: bracket with closing tag [SAVE_NOTES:Name]content[/SAVE_NOTES]
  for (const m of content.matchAll(/\[SAVE_?NOTES:(.+?)\]([\s\S]*?)\[\/SAVE_?NOTES\]/gi)) {
    if (m[1].trim() && m[2].trim()) results.push({ name: m[1].trim(), notes: m[2].trim(), format: 'bracket-closed' });
  }

  // Format 2: colon [SAVENOTES:Name:content]
  for (const m of content.matchAll(/\[SAVE_?NOTES:([^:\]]+):([^\]]+)\]/gi)) {
    const name = m[1].trim();
    if (name && m[2].trim() && !results.some(r => r.name.toLowerCase() === name.toLowerCase())) {
      results.push({ name, notes: m[2].trim(), format: 'colon' });
    }
  }

  // Format 3: bracket WITHOUT closing tag [SAVENOTES:Name]content (runs to next [SAVE or end)
  const unclosedPattern = /\[SAVE_?NOTES:([^\]]+)\]/gi;
  const tagPositions = [];
  let match;
  while ((match = unclosedPattern.exec(content)) !== null) {
    tagPositions.push({ name: match[1].trim(), start: match.index, contentStart: match.index + match[0].length });
  }

  for (let i = 0; i < tagPositions.length; i++) {
    const tag = tagPositions[i];
    if (tag.name.includes(':')) continue; // colon format, already handled
    if (results.some(r => r.name.toLowerCase() === tag.name.toLowerCase())) continue;

    const contentEnd = i + 1 < tagPositions.length ? tagPositions[i + 1].start : content.length;
    let noteContent = content.substring(tag.contentStart, contentEnd).trim();
    noteContent = noteContent.replace(/\[\/SAVE_?NOTES\]/gi, '').trim();
    // Remove trailing visible text (confirmations, rating prompts)
    noteContent = noteContent.replace(/\s*(got it|notes saved|rate |social:|prof:|how'?s|speaking of|by the way|still need|locked in).*/is, '').trim();
    noteContent = noteContent.replace(/\.\s*$/, '').trim();

    if (noteContent && noteContent.length > 3) {
      results.push({ name: tag.name, notes: noteContent, format: 'bracket-unclosed' });
    }
  }

  return results;
}

function isNoteInAirtable(applicantNotes, memberName, noteContent) {
  if (!applicantNotes) return false;
  const norm = noteContent.replace(/\s+/g, ' ').trim().toLowerCase();
  const shortNorm = norm.substring(0, Math.min(25, norm.length));
  const globalNorm = applicantNotes.replace(/\s+/g, ' ').trim().toLowerCase();
  if (shortNorm.length > 8 && globalNorm.includes(shortNorm)) return true;
  if (globalNorm.includes(norm)) return true;
  return false;
}

/**
 * Parse notes from raw member inbound message when bot produced no tags.
 * Format: "name: notes" or "name | notes" or "name\n- note\n- note\n\nname2\n..."
 */
function parseInboundNotes(content, applicants, memberName) {
  const results = [];
  const lines = content.split('\n').map(l => l.trim()).filter(l => l);
  let currentName = null;
  let currentNotes = [];

  function saveCurrent() {
    if (!currentName || currentNotes.length === 0) return;
    const noteText = currentNotes.join(', ');
    if (noteText.length < 5 || TEST_NAMES.includes(currentName.toLowerCase())) return;
    const matches = fuzzyMatch(applicants, currentName);
    if (matches.length === 1) {
      results.push({ applicant: matches[0], name: matches[0].name, notes: noteText });
    }
  }

  for (const line of lines) {
    // "Name: notes" or "Name | notes"
    const colonMatch = line.match(/^([A-Z][a-zA-Z]+(?:\s+[A-Z]\.?)?(?:\s+[a-zA-Z]+)?)\s*[:|-]+\s*(.+)/i);
    if (colonMatch) {
      saveCurrent();
      currentName = colonMatch[1].trim();
      currentNotes = [colonMatch[2].trim()];
      continue;
    }

    // Standalone name line
    const nameOnly = line.match(/^([A-Z][a-z]+(?:\s+[A-Z]\.?)?)\s*$/);
    if (nameOnly) {
      saveCurrent();
      currentName = nameOnly[1].trim();
      currentNotes = [];
      continue;
    }

    // Continuation line
    if (currentName && line.length > 2) {
      currentNotes.push(line.replace(/^[-•]\s*/, '').trim());
    }
  }
  saveCurrent();
  return results;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const fix = req.query.fix === '1';
  const log = [];
  const l = (msg) => { log.push(msg); console.log(msg); };

  try {
    l(`=== NOTES AUDIT (${fix ? 'FIX MODE' : 'DRY RUN'}) ===\n`);

    let applicants = await getAllApplicants();
    l(`Loaded ${applicants.length} applicants from Airtable\n`);

    const phones = Object.keys(MEMBER_DIRECTORY);
    const allMissing = [];

    for (const phone of phones) {
      const memberName = getMemberName(phone);
      if (!memberName) continue;

      let messages;
      try {
        messages = await getMessages(phone);
        l(`  ${memberName}: ${messages.length} msgs`);
      } catch (e) {
        l(`  ERROR ${memberName}: ${e.message}`);
        continue;
      }
      if (messages.length === 0) {
        // Try a test fetch to see raw response
        try {
          const test = await sbAPI('GET', `/api/v2/messages?number=${encodeURIComponent(phone)}&limit=1`);
          l(`  ${memberName}: 0 msgs (raw: ${JSON.stringify(test).substring(0, 100)})`);
        } catch (e2) {
          l(`  ${memberName}: 0 msgs (test error: ${e2.message})`);
        }
        continue;
      }

      l(`--- ${memberName} (${messages.length} msgs) ---`);

      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        if (msg.is_outbound || !msg.content) continue;
        const content = msg.content.trim();

        // Is this a note-like message?
        const lineCount = content.split('\n').filter(l2 => l2.trim()).length;
        const isNoteLike = (lineCount >= 3) || (content.length > 100 && /[a-z].*:/i.test(content)) || (content.length > 200);
        if (!isNoteLike) continue;

        const botResponse = messages.slice(i + 1).find(m => m.is_outbound && m.content);
        if (!botResponse) continue;

        const botContent = botResponse.content;
        const dayLabel = getDayLabel(msg.date_sent || msg.date_created);

        // Extract notes from bot response
        const extracted = extractAllNotes(botContent);

        if (extracted.length > 0) {
          for (const note of extracted) {
            if (TEST_NAMES.includes(note.name.toLowerCase())) continue;
            const matches = fuzzyMatch(applicants, note.name);
            if (matches.length === 0) { l(`  NO MATCH: "${note.name}"`); continue; }
            let applicant;
            if (matches.length > 1) {
              const exact = matches.filter(m => m.name.toLowerCase() === note.name.toLowerCase());
              applicant = exact.length === 1 ? exact[0] : null;
              if (!applicant) { l(`  AMBIGUOUS: "${note.name}" -> ${matches.map(m => m.name).join(', ')}`); continue; }
            } else {
              applicant = matches[0];
            }

            if (!isNoteInAirtable(applicant.notes, memberName, note.notes)) {
              l(`  MISSING: ${applicant.name} (${note.format}) — "${note.notes.substring(0, 60)}..."`);
              allMissing.push({ memberName, applicant, matchedName: applicant.name, notes: note.notes, dayLabel, source: note.format });
            }
          }
        } else {
          // No tags — check if bot hallucinated save
          const botSaidSaved = /notes saved|got it.*saved|locked in/i.test(botContent);
          if (!botSaidSaved) continue;

          l(`  NO TAGS (hallucinated save) — parsing inbound...`);
          const parsed = parseInboundNotes(content, applicants, memberName);
          for (const p of parsed) {
            if (!isNoteInAirtable(p.applicant.notes, memberName, p.notes)) {
              l(`    PARSED MISSING: ${p.name} — "${p.notes.substring(0, 60)}..."`);
              allMissing.push({ memberName, applicant: p.applicant, matchedName: p.name, notes: p.notes, dayLabel, source: 'parsed-inbound' });
            }
          }
        }
      }

      await sleep(200); // Rate limit between members
    }

    // Summary
    l(`\n=== TOTAL MISSING: ${allMissing.length} ===\n`);

    const byMember = {};
    for (const n of allMissing) { byMember[n.memberName] = byMember[n.memberName] || []; byMember[n.memberName].push(n); }
    for (const [member, notes] of Object.entries(byMember)) {
      l(`${member} (${notes.length}):`);
      for (const n of notes) l(`  ${n.matchedName} [${n.dayLabel}] (${n.source}): "${n.notes.substring(0, 70)}..."`);
    }

    // Fix
    if (fix && allMissing.length > 0) {
      l(`\n=== SAVING ${allMissing.length} NOTES TO AIRTABLE ===\n`);
      applicants = await getAllApplicants(); // Refresh
      for (const item of allMissing) {
        const fresh = applicants.find(a => a.id === item.applicant.id);
        if (fresh) item.applicant = fresh;
      }

      const base = getBase();
      let saved = 0, errored = 0;
      for (const item of allMissing) {
        const entry = `[${item.memberName} — ${item.dayLabel}]: ${item.notes}`;
        const updated = item.applicant.notes ? `${item.applicant.notes}\n${entry}` : entry;
        try {
          await base(TABLE).update(item.applicant.id, { notes: updated });
          item.applicant.notes = updated;
          saved++;
          l(`  SAVED: ${item.memberName} -> ${item.matchedName}`);
        } catch (e) {
          errored++;
          l(`  ERROR: ${item.matchedName}: ${e.message}`);
        }
        await sleep(250);
      }
      l(`\nDone: ${saved} saved, ${errored} errors`);
    }

    return res.status(200).json({ missing: allMissing.length, log: log.join('\n'), details: allMissing.map(m => ({ member: m.memberName, applicant: m.matchedName, notes: m.notes, day: m.dayLabel, source: m.source })) });

  } catch (e) {
    l(`FATAL: ${e.message}\n${e.stack}`);
    return res.status(500).json({ error: e.message, log: log.join('\n') });
  }
}
