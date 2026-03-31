#!/usr/bin/env node
import fs from 'fs';
import Airtable from 'airtable';

const envLines = fs.readFileSync('/tmp/sep-prod-env', 'utf-8').split('\n');
for (const line of envLines) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('=');
  if (eq === -1) continue;
  const key = t.slice(0, eq).trim();
  let val = t.slice(eq + 1).trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
  process.env[key] = val;
}

const TABLE = "Rush Spring '26";
const FIX = process.argv.includes('--fix');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const base = new Airtable({ apiKey: process.env.VITE_AIRTABLE_API_KEY }).base(process.env.VITE_AIRTABLE_BASE_ID);

const MEMBER = 'Fiona';
const DAY_LABEL = 'Day 1';

// Fiona's notes + scores (social, prof)
const entries = [
  // Round 1
  { name: 'Anna Tamayo', notes: 'Lifestyle', social: 2.5, prof: 2.5 },
  { name: 'Sofia', notes: 'Hippy, desmo, textile and ceramics, waterpolo', social: 3.5, prof: 3, hint: 'hippy' },
  { name: 'Rena', notes: 'Communication major, get ready w me or get ready, Dominik Fike, chatty', social: 4, prof: 3 },
  { name: 'Jasmin', notes: 'Neuroscience, backpacking, Beatles class', social: 4, prof: 3 },
  { name: 'Sofia V', notes: 'SF, Filipino culture, very passionate, very bubbly', social: 5, prof: 4, hint: 'valdez' },
  { name: 'Cecilia', notes: 'Food content in SF', social: 3, prof: 3 },
  { name: 'Samita', notes: 'Baking', social: 2, prof: 3 },

  // Round 2
  { name: 'Jason', notes: 'Hong Kong, knows hundred digits of pi, positive news, innovations in biotech', social: 4, prof: 5, hint: 'jason y' },
  { name: 'Rainey', notes: 'Quiet, painting, digital art, funny vids about being international students', social: 2, prof: 3 },
  { name: 'Fatmah', notes: '2nd year, Saudi, innovation and fashion', social: 4, prof: 4, hint: 'fatmah m' },
  { name: 'Kim', notes: 'Taiwan, fashion and tech integration', social: 3, prof: 3, hint: 'kim x' },
  { name: 'Elle', notes: 'Pulled emergency brake, very chatty, Minecraft fail channel', social: 1, prof: 1, hint: 'elle d' },
  { name: 'Grace', notes: 'Desmo, has own YouTube channel about behind the scenes of personal projects, gracechan', social: 3, prof: 4 },

  // Round 3 — liked this group
  { name: 'Aidan', notes: 'Oakland, martial arts, music', social: 3, prof: 3 },
  { name: 'Arhaan', notes: 'Applied math, youngest venture funded in the world, pub bar drinking, funny, Drake, braggy', social: 4, prof: 3 },
  { name: 'Hannah', notes: 'Berlin, cafe journal matcha, only girl', social: 4, prof: 3, hint: 'hannah n' },
  { name: 'Spencer', notes: 'Biz econ poly sci, comedian, car content, funny', social: 4, prof: 3 },
  { name: 'Dev', notes: 'Game of thrones', social: 3, prof: 3, hint: 'dev s' },
  { name: 'Matthew', notes: 'Produce music, troll content', social: 3, prof: 3, hint: 'matthew l' },
  { name: 'Noor', notes: 'Used to make own soap, mukbang, Ariana Grande', social: 4, prof: 4 },

  // Round 4
  { name: 'Ariana', notes: 'Junior transfer but 18, first to speak, food content, bubbly, restaurant review, eager, smart, professional fit', social: 3, prof: 5, hint: 'ariana m' },
  { name: 'Varsha', notes: '14 pets, tell me lies review', social: 3, prof: 3, hint: 'varsha m' },
  { name: 'Amy', notes: 'Danced for Bella Thorne, stalking channel, true crime', social: 3, prof: 3, hint: 'amy g' },
  { name: 'Linda', notes: 'Artery, first one here, animal expert, from grassland', social: 2, prof: 2 },
  { name: 'Phirt', notes: 'Whistle, fitness posture, gaming keyboard mouse mechanics', social: 3, prof: 3, hint: 'phirt t' },
  { name: 'Sam', notes: 'Fortnite, food reviews, weight loss lost 90 pounds', social: 4, prof: 4, hint: 'sam s' },
  { name: 'Meher', notes: 'Dallas, traveling, NDAs', social: 3, prof: 3 },

  // Round 5 — fun and silly
  { name: 'Habeen', notes: 'Social, Irvine, UCLA content, David', social: 2, prof: 3 },
  { name: 'Vibram', notes: 'Bay, CS ling, rating college campuses', social: 3, prof: 3 },
  { name: 'Dheeriu', notes: 'Floats, gives to charity with content', social: 4, prof: 3 },
  { name: 'Rehan', notes: 'Ran over friend', social: 3, prof: 3 },
  { name: 'Sampath', notes: 'Swim instructor, larping, outgoing', social: 4, prof: 3 },
  { name: 'Kota', notes: 'Mukbang drama, seems nice, Kanye', social: 3, prof: 3, hint: 'kota o' },
  { name: 'Shreyes', notes: 'Ghost hunting', social: 4, prof: 3 },
  { name: 'Elisa', notes: 'Lifestyle, T Swift, ok', social: 2, prof: 3 },

  // Round 6
  { name: 'Justin', notes: 'Banjo, rock climbing, backpacking trip', social: 3, prof: 3 },
  { name: 'Aum', notes: 'Applied math, sports content, states and capitals', social: 3, prof: 3 },
  { name: 'Arthur', notes: 'Born in US lived in China, Chinese culture, feminism, competitive debate', social: 2.5, prof: 4 },
  { name: 'Abhimav', notes: 'Hindi fluent, poker', social: 2, prof: 3 },
  { name: 'Gloria', notes: 'Fashion, raving', social: 3, prof: 3 },
  { name: 'Sai', notes: '6 different countries, soccer, Minecraft, aura', social: 3.5, prof: 3 },
];

async function main() {
  const records = await base(TABLE).select({ maxRecords: 1000 }).all();
  const applicants = records
    .map(r => ({
      id: r.id,
      name: (r.get('applicant_name') || ''),
      notes: (r.get('notes') || ''),
      social: r.get('social') || 0,
      prof: r.get('prof') || 0,
      weight: r.get('weight') || 0,
      scoresRaw: r.get('scores_raw') || '{}',
    }))
    .filter(a => a.name.trim() !== '');

  console.log(`${applicants.length} applicants in Airtable\n`);

  let savedNotes = 0, savedScores = 0, skipped = 0, noMatch = 0;

  for (const entry of entries) {
    const q = entry.name.toLowerCase();
    const hint = (entry.hint || '').toLowerCase();

    // Exact match
    let match = applicants.find(a => a.name.toLowerCase() === q);

    // Try with hint (e.g. "jason y" or "valdez")
    if (!match && hint) {
      match = applicants.find(a => {
        const n = a.name.toLowerCase();
        return n.includes(hint) || hint.split(' ').every(h => n.includes(h));
      });
    }

    // First name match
    if (!match) {
      const firstName = q.split(/\s+/)[0];
      const firstMatches = applicants.filter(a => a.name.toLowerCase().split(/\s+/)[0] === firstName);
      if (firstMatches.length === 1) match = firstMatches[0];
      else if (firstMatches.length > 1) {
        // Try last name from entry name
        const lastName = q.split(/\s+/).slice(1).join(' ');
        if (lastName) {
          const fullMatch = firstMatches.find(a => a.name.toLowerCase().includes(lastName));
          if (fullMatch) match = fullMatch;
        }
        if (!match) {
          console.log(`AMBIGUOUS (${firstMatches.length} matches): "${entry.name}" → ${firstMatches.map(a => a.name).join(', ')}`);
          noMatch++;
          continue;
        }
      }
    }

    // Partial/contains match
    if (!match) {
      const contains = applicants.filter(a => a.name.toLowerCase().includes(q) || q.includes(a.name.toLowerCase()));
      if (contains.length === 1) match = contains[0];
    }

    if (!match) {
      console.log(`NO MATCH: "${entry.name}"`);
      noMatch++;
      continue;
    }

    // --- Save notes ---
    const short = entry.notes.substring(0, 25).toLowerCase().replace(/\s+/g, ' ');
    const existingNotes = (match.notes || '').toLowerCase().replace(/\s+/g, ' ');
    const alreadyHasNotes = short.length > 8 && existingNotes.includes(short);

    if (FIX) {
      // Save notes
      if (!alreadyHasNotes) {
        const noteEntry = `[${MEMBER} — ${DAY_LABEL}]: ${entry.notes}`;
        const updated = match.notes ? match.notes + '\n' + noteEntry : noteEntry;
        try {
          await base(TABLE).update(match.id, { notes: updated });
          match.notes = updated;
          savedNotes++;
          console.log(`NOTES SAVED: ${MEMBER} → ${match.name}`);
        } catch (e) {
          console.error(`NOTES ERROR: ${match.name}: ${e.message}`);
        }
        await sleep(200);
      } else {
        console.log(`NOTES SKIP (already saved): ${match.name}`);
      }

      // Save scores
      let raw = {};
      try { raw = JSON.parse(match.scoresRaw || '{}'); } catch { raw = {}; }

      if (raw[MEMBER]) {
        console.log(`SCORES SKIP (already rated): ${match.name}`);
      } else {
        const socialNew = entry.social;
        const profNew = entry.prof;
        const oldWeight = match.weight || 0;
        const oldSocial = match.social || 0;
        const oldProf = match.prof || 0;

        const newWeight = oldWeight + 1;
        const newSocial = oldWeight === 0 ? socialNew : (oldSocial * oldWeight + socialNew) / newWeight;
        const newProf = oldWeight === 0 ? profNew : (oldProf * oldWeight + profNew) / newWeight;
        const newElo = (newSocial + newProf) / 2;

        raw[MEMBER] = { s: socialNew, p: profNew };

        try {
          await base(TABLE).update(match.id, {
            social: parseFloat(newSocial.toFixed(3)),
            prof: parseFloat(newProf.toFixed(3)),
            elo: parseFloat(newElo.toFixed(3)),
            weight: newWeight,
          });
          match.social = newSocial;
          match.prof = newProf;
          match.weight = newWeight;
          savedScores++;
          console.log(`SCORES SAVED: ${MEMBER} → ${match.name} (s:${socialNew} p:${profNew} elo:${newElo.toFixed(2)} w:${newWeight})`);
        } catch (e) {
          console.error(`SCORES ERROR: ${match.name}: ${e.message}`);
        }

        try {
          await base(TABLE).update(match.id, { scores_raw: JSON.stringify(raw) });
          match.scoresRaw = JSON.stringify(raw);
        } catch (e) {
          console.log(`scores_raw update skipped for ${match.name}: ${e.message}`);
        }
        await sleep(200);
      }
    } else {
      if (alreadyHasNotes) {
        console.log(`NOTES SKIP: ${match.name}`);
      } else {
        console.log(`WOULD SAVE NOTES: ${MEMBER} → ${match.name}: "${entry.notes.substring(0, 50)}..."`);
      }
      console.log(`WOULD SAVE SCORES: ${MEMBER} → ${match.name}: s:${entry.social} p:${entry.prof}`);
    }
  }

  console.log(`\nTotal: ${entries.length} | Notes saved: ${savedNotes} | Scores saved: ${savedScores} | Skipped: ${skipped} | No match: ${noMatch}`);
  if (!FIX) console.log('Run with --fix to actually save.');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
